import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { useI18n } from "../i18n/react";
import type { TransactionDraft } from "../appShell/drafts";
import type { LocalAccount } from "../manualLedger/accounts";
import { isAiConfigured } from "./config";
import { requestAiJson } from "./client";
import { DEFAULT_AI_ENTITY_POLICY, type AiEntityPolicy } from "./entityPolicy";
import {
  buildFieldCorrectionSystemPrompt,
  buildModeBDraft,
  localToday,
  modeBFieldLabel,
  modeBFieldPrompt,
  modeBStepsFor,
  parseFieldCorrection,
  parseSpokenDate,
  type ModeBField,
} from "./modeB";
import type { NewEntityCarrier } from "./parse";
import { speechRecognition, type SpeechRecognitionLike } from "./speech";

export type ModeBPanelProps = Readonly<{
  accounts: Array<{ name: string; currency: string }>;
  categories: string[];
  entityPolicy?: AiEntityPolicy;
  // Creates the not-yet-existing accounts/categories the user mentioned
  // (ADR 0012), right before the confirmed write. Returns the created
  // accounts, or false when creation fails.
  onResolveNewEntities?: (suggestion: NewEntityCarrier) => LocalAccount[] | false;
  // Writes the official record. extraAccounts carries the accounts created
  // for this write so validation sees them before the caller re-renders.
  onSaveRecord: (draft: TransactionDraft, extraAccounts?: LocalAccount[]) => string | null;
  onSaveDraft?: (draft: TransactionDraft) => void;
}>;

function micNoteText(
  starting: boolean,
  listening: boolean,
  hasTranscript: boolean,
  corrected: string | null,
  inputValue: string,
): string {
  if (starting) return t("ai.micStarting");
  if (listening) return t("ai.micListening");
  if (hasTranscript) return t("ai.micCorrected", { value: corrected ?? inputValue });
  return t("ai.micIdle");
}

// Speech engine state: microphone toggling, interim/final transcripts, and
// the single-field AI correction call (ADR 0010). Calls back with the raw
// transcript and the AI-corrected text ("" when AI is off or failed).
function useModeBSpeech({
  configured,
  currentField,
  accounts,
  categories,
  entityPolicy,
  onTranscript,
  onError,
}: Readonly<{
  configured: boolean;
  currentField: ModeBField;
  accounts: ModeBPanelProps["accounts"];
  categories: string[];
  entityPolicy: AiEntityPolicy;
  onTranscript: (field: ModeBField, raw: string, corrected: string) => void;
  onError: (message: string) => void;
}>) {
  const [transcript, setTranscript] = useState("");
  // Interim speech text shown while listening (the final result replaces it).
  const [liveText, setLiveText] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [listening, setListening] = useState(false);
  // True from the click until the engine's onstart fires: the browser may
  // take a few seconds to load the speech model / grant the microphone, and
  // during that window nothing is being recorded yet.
  const [starting, setStarting] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Stop any in-flight speech session when the panel unmounts.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const applyTranscript = (field: ModeBField, raw: string) => {
    setTranscript(raw);
    if (!configured) {
      onTranscript(field, raw, "");
      return;
    }
    setCorrecting(true);
    const today = localToday();
    requestAiJson({
      system: buildFieldCorrectionSystemPrompt(field, { accounts, categories, today, entityPolicy }),
      user: raw,
    })
      .then((result) => {
        onTranscript(field, raw, result.ok ? parseFieldCorrection(result.data) : "");
      })
      .finally(() => setCorrecting(false));
  };

  const { t } = useI18n();
  const toggleListening = () => {
    const Ctor = speechRecognition();
    if (!Ctor) {
      onError(t("ai.speechUnsupportedB"));
      return;
    }
    if (listening || starting) {
      recognitionRef.current?.stop();
      return;
    }
    // Reuse the previous recognition instance when possible: the browser
    // loads the speech model on the first start, so a warm instance begins
    // hearing almost immediately on later clicks. Some engines reject
    // restarting the same object, so fall back to a fresh one.
    const recognition: SpeechRecognitionLike = recognitionRef.current ?? new Ctor();
    recognition.lang = "zh-TW";
    // Interim results stream the words as they are heard; the final result
    // (the last item, flagged isFinal) drives the correction flow.
    recognition.interimResults = true;
    // The latest interim text, so a session that ends without a final result
    // (some engines never flag the last item isFinal) still fills the field.
    let lastInterim = "";
    recognition.onstart = () => setStarting(false);
    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const text = last?.[0]?.transcript ?? "";
      if (last?.[0]?.isFinal) {
        lastInterim = "";
        setLiveText("");
        applyTranscript(currentField, text);
      } else {
        lastInterim = text;
        setLiveText(text);
      }
    };
    recognition.onend = () => {
      setListening(false);
      setStarting(false);
      // The engine ended without flagging a final result; promote the last
      // interim words so the spoken value is still applied (e.g. 念「昨天」
      // 後停頓,Chrome 常見只送 interim 就結束)。
      if (lastInterim.trim()) {
        const pending = lastInterim;
        lastInterim = "";
        setLiveText("");
        applyTranscript(currentField, pending);
      }
    };
    recognition.onerror = () => {
      setListening(false);
      setStarting(false);
      setLiveText("");
      onError(t("ai.speechFailed"));
    };
    recognitionRef.current = recognition;
    setLiveText("");
    setStarting(true);
    setListening(true);
    try {
      recognition.start();
    } catch {
      // The reused instance may be in a state the engine rejects (e.g. a
      // previous session errored out); start over with a fresh one.
      const fresh = new Ctor();
      recognitionRef.current = fresh;
      fresh.lang = "zh-TW";
      fresh.interimResults = true;
      fresh.onstart = () => setStarting(false);
      fresh.onresult = recognition.onresult;
      fresh.onend = recognition.onend;
      fresh.onerror = recognition.onerror;
      fresh.start();
    }
  };

  const clearTranscript = () => {
    setTranscript("");
    setLiveText("");
  };

  return { listening, starting, liveText, transcript, correcting, toggleListening, clearTranscript };
}

// The step-by-step capture state: the filled values, the current step, the
// editable input, and the confirm/save flows. Kept separate from the speech
// engine so each unit stays small and testable.
function useModeBCapture({
  accounts,
  categories,
  entityPolicy,
  onResolveNewEntities,
  onSaveRecord,
  onSaveDraft,
}: Readonly<{
  accounts: ModeBPanelProps["accounts"];
  categories: string[];
  entityPolicy: AiEntityPolicy;
  onResolveNewEntities: ModeBPanelProps["onResolveNewEntities"];
  onSaveRecord: ModeBPanelProps["onSaveRecord"];
  onSaveDraft: ModeBPanelProps["onSaveDraft"];
}>) {
  const [values, setValues] = useState<Partial<Record<ModeBField, string>>>({});
  const [step, setStep] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [corrected, setCorrected] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Which completion banner is showing after a confirmed write.
  const [done, setDone] = useState<"" | "saved" | "draft">("");

  const steps = useMemo(() => modeBStepsFor(values.kind), [values.kind]);
  const isComplete = step >= steps.length;
  const currentField = steps[Math.min(step, steps.length - 1)];

  // The date field is a native date picker that only accepts YYYY-MM-DD, so a
  // spoken date (or a typed one in the offline fallback) must be resolved
  // locally before it can be filled. Other fields accept the raw value.
  const handleTranscript = (field: ModeBField, raw: string, correctedText: string) => {
    let value = correctedText || raw;
    if (!correctedText && field === "date") {
      value = parseSpokenDate(raw, localToday()) ?? "";
    }
    setCorrected(value || raw);
    setInputValue(value);
  };

  const enterField = (index: number) => {
    setStep(index);
    setInputValue(values[steps[index]] ?? "");
    setCorrected(null);
    setError("");
  };

  const { t } = useI18n();
  const confirmField = () => {
    const value = inputValue.trim();
    if (!value) {
      setError(t("ai.fieldBlank"));
      return;
    }
    const field = currentField;
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    // The step list re-computes when the kind changes (a transfer inserts a
    // destination step and drops the category step); the counter advancing
    // by one still lands on the right next field.
    setStep((current) => current + 1);
    setInputValue("");
    setCorrected(null);
    setError("");
  };

  const retryField = () => {
    setInputValue("");
    setCorrected(null);
  };

  const resetAll = () => {
    setValues({});
    setStep(0);
    setInputValue("");
    setCorrected(null);
    setError("");
    setDone("");
  };

  const save = () => {
    setError("");
    const today = localToday();
    const result = buildModeBDraft(values, accounts, categories, today, entityPolicy);
    if (!result.draft) {
      setError(t("ai.fieldIssues", { issues: result.issues.join(" ") }));
      return;
    }
    const needsCreation = Boolean(result.newAccount || result.newCategory || result.newTransferAccount);
    let created: LocalAccount[] = [];
    if (needsCreation) {
      if (!onResolveNewEntities) {
        setError(t("ai.newEntityFirstB"));
        return;
      }
      const resolved = onResolveNewEntities({
        newAccount: result.newAccount,
        newCategory: result.newCategory,
        newTransferAccount: result.newTransferAccount,
      });
      if (resolved === false) {
        setError(t("ai.newEntityFailed"));
        return;
      }
      created = resolved;
    }
    const saveReason = onSaveRecord(result.draft, created);
    if (saveReason !== null) {
      setError(saveReason);
      return;
    }
    setDone("saved");
  };

  const saveDraft = () => {
    setError("");
    if (!onSaveDraft) return;
    const today = localToday();
    const result = buildModeBDraft(values, accounts, categories, today, entityPolicy);
    if (!result.draft) {
      setError(t("ai.fieldIssues", { issues: result.issues.join(" ") }));
      return;
    }
    onSaveDraft(result.draft);
    setDone("draft");
  };

  return {
    values,
    step,
    steps,
    isComplete,
    currentField,
    inputValue,
    setInputValue,
    corrected,
    error,
    done,
    canSaveDraft: Boolean(onSaveDraft),
    enterField,
    confirmField,
    retryField,
    resetAll,
    save,
    saveDraft,
    handleTranscript,
    setError,
  };
}

export function ModeBPanel({
  accounts,
  categories,
  entityPolicy = DEFAULT_AI_ENTITY_POLICY,
  onResolveNewEntities,
  onSaveRecord,
  onSaveDraft,
}: ModeBPanelProps) {
  const configured = isAiConfigured();
  const capture = useModeBCapture({ accounts, categories, entityPolicy, onResolveNewEntities, onSaveRecord, onSaveDraft });
  const speech = useModeBSpeech({
    configured,
    currentField: capture.currentField,
    accounts,
    categories,
    entityPolicy,
    onTranscript: capture.handleTranscript,
    onError: capture.setError,
  });
  const hasTranscript = speech.transcript !== "";
  const micNote = micNoteText(speech.starting, speech.listening, hasTranscript, capture.corrected, capture.inputValue);

  if (capture.done) {
    return <ModeBDoneView done={capture.done} onReset={capture.resetAll} />;
  }

  const { t } = useI18n();
  return (
    <div className="mode-b-panel">
      <p className="field-help">
        {t("ai.modeBIntro")}
      </p>
      {!configured ? (
        <output className="inline-message">{t("ai.notConfiguredB")}</output>
      ) : null}

      <ModeBProgress steps={capture.steps} step={capture.step} values={capture.values} />

      {!capture.isComplete ? (
        <ModeBStage
          step={capture.step}
          steps={capture.steps}
          currentField={capture.currentField}
          transcript={speech.transcript}
          liveText={speech.liveText}
          listening={speech.listening}
          starting={speech.starting}
          correcting={speech.correcting}
          micNote={micNote}
          inputValue={capture.inputValue}
          onToggleListening={speech.toggleListening}
          onInputChange={capture.setInputValue}
          onRetry={() => {
            capture.retryField();
            speech.clearTranscript();
          }}
          onConfirm={capture.confirmField}
        />
      ) : (
        <ModeBSummaryView
          steps={capture.steps}
          values={capture.values}
          onSave={capture.save}
          onSaveDraft={capture.canSaveDraft ? capture.saveDraft : undefined}
          onBack={() => {
            capture.enterField(capture.steps.length - 1);
            speech.clearTranscript();
          }}
        />
      )}
      {capture.error ? <p className="auth-message" role="alert">{capture.error}</p> : null}
    </div>
  );
}

function ModeBProgress({
  steps,
  step,
  values,
}: Readonly<{
  steps: ModeBField[];
  step: number;
  values: Partial<Record<ModeBField, string>>;
}>) {
  const { t } = useI18n();
  return (
    <>
      <div className="mode-b-progress" aria-hidden="true">
        {steps.map((field, index) => (
          <div
            className={`mode-b-p${index < step ? " done" : ""}${index === step ? " now" : ""}`}
            key={field}
          />
        ))}
      </div>

      <div className="mode-b-filled" aria-label={t("ai.filledAria")}>
        {steps.slice(0, step).map((field) => (
          <span className="mode-b-chip" key={field}>
            <span>{modeBFieldLabel(field)}</span>
            <b>{values[field]}</b>
          </span>
        ))}
      </div>
    </>
  );
}

function ModeBDoneView({ done, onReset }: Readonly<{ done: "saved" | "draft"; onReset: () => void }>) {
  const { t } = useI18n();
  return (
    <div className="mode-b-panel">
      <div className="mode-b-done">
        <span className="mode-b-done-icon">✓</span>
        <p>{done === "saved" ? t("ai.confirmedWritten") : t("ai.savedToQueue")}</p>
        <button className="primary-action" type="button" onClick={onReset}>
          {t("ai.restart")}
        </button>
      </div>
    </div>
  );
}

function ModeBStage({
  step,
  steps,
  currentField,
  transcript,
  liveText,
  listening,
  starting,
  correcting,
  micNote,
  inputValue,
  onToggleListening,
  onInputChange,
  onRetry,
  onConfirm,
}: Readonly<{
  step: number;
  steps: ModeBField[];
  currentField: ModeBField;
  transcript: string;
  liveText: string;
  listening: boolean;
  starting: boolean;
  correcting: boolean;
  micNote: string;
  inputValue: string;
  onToggleListening: () => void;
  onInputChange: (value: string) => void;
  onRetry: () => void;
  onConfirm: () => void;
}>) {
  const { t } = useI18n();
  const hasTranscript = transcript !== "";
  return (
    <>
      <div className="mode-b-stage">
        <p className="mode-b-step">{t("ai.stepCount", { step: step + 1, total: steps.length })}</p>
        <p className="mode-b-field-name">{modeBFieldLabel(currentField)}</p>
        <p className="mode-b-hint">{modeBFieldPrompt(currentField)}</p>
        <ModeBMicControl
          listening={listening}
          starting={starting}
          liveText={liveText}
          micNote={micNote}
          onToggle={onToggleListening}
        />
      </div>
      <ModeBResultRow
        currentField={currentField}
        transcript={transcript}
        inputValue={inputValue}
        correcting={correcting}
        onInputChange={onInputChange}
      />
      <ModeBStageActions
        hasTranscript={hasTranscript}
        listening={listening}
        correcting={correcting}
        inputValue={inputValue}
        onRetry={onRetry}
        onConfirm={onConfirm}
      />
    </>
  );
}

function ModeBMicControl({
  listening,
  starting,
  liveText,
  micNote,
  onToggle,
}: Readonly<{
  listening: boolean;
  starting: boolean;
  liveText: string;
  micNote: string;
  onToggle: () => void;
}>) {
  const { t } = useI18n();
  const active = listening || starting;
  return (
    <div className="mode-b-mic-wrap">
      <div className={`mode-b-ring${active ? " pulse" : ""}`} />
      <button
        className={`mode-b-mic${active ? " listening" : ""}`}
        type="button"
        aria-label={active ? t("ai.stopListening") : t("ai.sayIt")}
        onClick={onToggle}
      >
        🎙
      </button>
      <div className={`mode-b-wave${listening ? " on" : ""}`} aria-hidden="true">
        <i /><i /><i /><i /><i /><i /><i />
      </div>
      <p className={`mode-b-live${liveText ? " on" : ""}`} aria-live="polite">{liveText}</p>
      <p className={`mode-b-note${active ? " listening" : ""}`}>{micNote}</p>
    </div>
  );
}

function ModeBResultRow({
  currentField,
  transcript,
  inputValue,
  correcting,
  onInputChange,
}: Readonly<{
  currentField: ModeBField;
  transcript: string;
  inputValue: string;
  correcting: boolean;
  onInputChange: (value: string) => void;
}>) {
  const { t } = useI18n();
  const isDate = currentField === "date";
  return (
    <div className="mode-b-result">
      <div className="mode-b-row">
        <span className="mode-b-tag raw">{t("ai.heard")}</span>
        <span className="mode-b-txt" aria-live="polite">{transcript || "—"}</span>
      </div>
      <div className="mode-b-row ai-row">
        <span className="mode-b-tag ai">{t("ai.aiCorrected")}</span>
        <input
          id="mode-b-input"
          className="mode-b-input"
          type={isDate ? "date" : "text"}
          value={inputValue}
          aria-label={modeBFieldLabel(currentField)}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={isDate ? undefined : t("ai.typePlaceholder")}
        />
      </div>
      <p className="mode-b-ai-note">{t("ai.correctionNote")}</p>
      {correcting ? <p className="field-help">{t("ai.correcting")}</p> : null}
    </div>
  );
}

function ModeBStageActions({
  hasTranscript,
  listening,
  correcting,
  inputValue,
  onRetry,
  onConfirm,
}: Readonly<{
  hasTranscript: boolean;
  listening: boolean;
  correcting: boolean;
  inputValue: string;
  onRetry: () => void;
  onConfirm: () => void;
}>) {
  const { t } = useI18n();
  return (
    <div className="mode-b-actions">
      <button className="secondary-action" type="button" onClick={onRetry} disabled={!hasTranscript || listening}>
        {t("ai.sayAgain")}
      </button>
      <button className="primary-action" type="button" onClick={onConfirm} disabled={!inputValue.trim() || listening || correcting}>
        {t("ai.fillField")}
      </button>
    </div>
  );
}

function ModeBSummaryView({
  steps,
  values,
  onSave,
  onSaveDraft,
  onBack,
}: Readonly<{
  steps: ModeBField[];
  values: Partial<Record<ModeBField, string>>;
  onSave: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
}>) {
  const { t } = useI18n();
  return (
    <div className="mode-b-summary">
      <h2>{t("ai.confirmRecord")}</h2>
      <div className="mode-b-summary-list">
        {steps.map((field) => (
          <div className="mode-b-s-row" key={field}>
            <dt>{modeBFieldLabel(field)}</dt>
            <dd>{values[field]}</dd>
          </div>
        ))}
      </div>
      <div className="mode-b-actions">
        <button className="primary-action" type="button" onClick={onSave}>
          {t("ai.confirmWriteB")}
        </button>
        {onSaveDraft ? (
          <button className="secondary-action" type="button" onClick={onSaveDraft}>
            {t("ai.saveDraftB")}
          </button>
        ) : null}
        <button className="secondary-action" type="button" onClick={onBack}>
          {t("ai.backToEdit")}
        </button>
      </div>
    </div>
  );
}
