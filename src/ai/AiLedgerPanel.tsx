import { Fragment, useEffect, useRef, useState } from "react";
import { ImagePlus, Mic, Sparkles } from "lucide-react";
import { t } from "../i18n";
import { useI18n } from "../i18n/react";
import { missingCounterpartyLabel, missingItemNameLabel, type TransactionDraft } from "../appShell/drafts";
import type { LocalAccount } from "../manualLedger/accounts";
import { isAiConfigured } from "./config";
import { requestAiJson } from "./client";
import { DEFAULT_AI_ENTITY_POLICY, type AiEntityPolicy } from "./entityPolicy";
import { FieldBlocks, InferredSpan, type FieldBlockItem } from "./fieldBlocks";
import { ModeBPanel } from "./ModeBPanel";
import { modeBFieldLabel, modeBStepsFor } from "./modeB";
import { buildLedgerSystemPrompt, buildUserPrompt } from "./prompt";
import { parseDraftSuggestions, type AiDraftSuggestion, type AiLedgerAccounts, type AiSuggestionInput, type NewEntityCarrier } from "./parse";
import { speechRecognition, type SpeechRecognitionLike } from "./speech";

// Kind display names resolve through the copy dictionary (keys kind.*) at
// call time so they follow the selected locale.
function kindLabelValue(kind: string): string {
  return t(`kind.${kind}`);
}

export type AiLedgerPanelProps = Readonly<{
  accounts: Array<{ name: string; currency: string }>;
  categories: string[];
  // Per-entity-type policy for whether capture may mention accounts or
  // categories that do not exist yet (see ADR 0012). Defaults to existing-only
  // so current behavior is preserved.
  entityPolicy?: AiEntityPolicy;
  // Creates the not-yet-existing accounts/categories a suggestion carries
  // (account with TWD like the default wallet, category appended to custom
  // categories). Called only for ask/auto policies, right before the confirmed
  // write. Returns the created accounts (empty when none were needed), or
  // false when creation fails.
  onResolveNewEntities?: (suggestion: NewEntityCarrier) => LocalAccount[] | false;
  // Writes the official record. extraAccounts carries the accounts that were
  // just created for this write, so validation and balance tracking see them
  // even though the caller's accounts state has not re-rendered yet.
  onSaveRecord: (draft: TransactionDraft, extraAccounts?: LocalAccount[]) => string | null;
  onSaveDraft: (draft: TransactionDraft) => void;
  // Prefills the ledger form with the fields the AI could identify so the
  // user can complete the remaining ones (account, category, …) manually.
  // Optional: the 新增 voice page has no manual form, so the button hides.
  onApplyToForm?: (suggestion: AiDraftSuggestion) => void;
  // Controlled mode for the 新增 header switch: when onModeChange is provided
  // the panel uses the given mode and does not render its own switch.
  mode?: "a" | "b";
  onModeChange?: (mode: "a" | "b") => void;
}>;

// The 整段口說 / 逐欄口說 pill switch. Rendered in the page header on 新增
// and inside the panel on the Zone page.
export function AiModeSwitch({ mode, onModeChange }: Readonly<{ mode: "a" | "b"; onModeChange: (mode: "a" | "b") => void }>) {
  const { t } = useI18n();
  return (
    <div className="ai-mode-switch" role="tablist" aria-label={t("ai.modeAria")}>
      <button className={`ai-mode-tab ${mode === "a" ? "active" : ""}`} type="button" role="tab" aria-selected={mode === "a"} onClick={() => onModeChange("a")}>{t("ai.modeA")}</button>
      <button className={`ai-mode-tab ${mode === "b" ? "active" : ""}`} type="button" role="tab" aria-selected={mode === "b"} onClick={() => onModeChange("b")}>{t("ai.modeB")}</button>
    </div>
  );
}

export function AiLedgerPanel({ accounts, categories, entityPolicy = DEFAULT_AI_ENTITY_POLICY, onResolveNewEntities, onSaveRecord, onSaveDraft, onApplyToForm, mode: controlledMode, onModeChange }: AiLedgerPanelProps) {
  const [internalMode, setInternalMode] = useState<"a" | "b">("a");
  const mode = controlledMode ?? internalMode;
  const setMode = onModeChange ?? setInternalMode;
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AiDraftSuggestion[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const configured = isAiConfigured();
  const hasValidSuggestion = suggestions.some((item) => item.ok);
  const anyInferred = suggestions.some((suggestion) => suggestion.draft && hasInferredField(suggestion.input));

  const speech = useAiSpeech({
    onTranscript: (text) => {
      setInputText((current) => `${current}${current ? " " : ""}${text}`.trim());
    },
    onError: setError,
  });
  const { editing, setEditing, handleFieldEdit, handleFieldConfirm } = useSuggestionEditing({ setSuggestions, accounts, categories, entityPolicy });
  const draftActions = useDraftActions({
    entityPolicy,
    onResolveNewEntities,
    onSaveRecord,
    onSaveDraft,
    setSuggestions,
    setMessage,
    setError,
  });

  const handleSubmit = useAiSubmit({ accounts, categories, entityPolicy, setSuggestions, setLoading, setMessage, setError });

  return (
    <div className="ai-ledger-panel">
      {!onModeChange ? <AiModeSwitch mode={mode} onModeChange={setMode} /> : null}
      {mode === "b" ? (
        <ModeBPanel
          accounts={accounts}
          categories={categories}
          entityPolicy={entityPolicy}
          onResolveNewEntities={onResolveNewEntities}
          onSaveRecord={onSaveRecord}
          onSaveDraft={onSaveDraft}
        />
      ) : (
        <AiCaptureView
          configured={configured}
          loading={loading}
          inputText={inputText}
          onInputTextChange={setInputText}
          onSubmit={handleSubmit}
          onClearError={() => setError("")}
          listening={speech.listening}
          starting={speech.starting}
          onToggleListening={speech.toggleListening}
          error={error}
          message={message}
          pendingNewEntity={draftActions.pendingNewEntities}
          onApproveNewEntities={draftActions.approveNewEntities}
          onCancelNewEntities={draftActions.cancelNewEntities}
          suggestions={suggestions}
          hasValidSuggestion={hasValidSuggestion}
          anyInferred={anyInferred}
          editing={editing}
          onEditField={(index, field) => setEditing({ index, field })}
          onFieldChange={handleFieldEdit}
          onFieldConfirm={handleFieldConfirm}
          onConfirm={draftActions.confirmSuggestion}
          onSaveDraft={draftActions.saveSuggestionAsDraft}
          onApplyToForm={onApplyToForm}
        />
      )}
    </div>
  );
}

// The mode A view: text/speech/photo entry, inline messages, the new-entity
// approval dialog, and the draft suggestion list. Kept as its own component so
// the branching stays out of AiLedgerPanel (cognitive complexity).
function AiCaptureView({
  configured,
  loading,
  inputText,
  onInputTextChange,
  onSubmit,
  onClearError,
  listening,
  starting,
  onToggleListening,
  error,
  message,
  pendingNewEntity,
  onApproveNewEntities,
  onCancelNewEntities,
  suggestions,
  hasValidSuggestion,
  anyInferred,
  editing,
  onEditField,
  onFieldChange,
  onFieldConfirm,
  onConfirm,
  onSaveDraft,
  onApplyToForm,
}: Readonly<{
  configured: boolean;
  loading: boolean;
  inputText: string;
  onInputTextChange: (value: string) => void;
  onSubmit: (text: string, imageDataUrl: string | undefined) => void;
  onClearError: () => void;
  listening: boolean;
  starting: boolean;
  onToggleListening: () => void;
  error: string;
  message: string;
  pendingNewEntity: AiDraftSuggestion | null;
  onApproveNewEntities: () => void;
  onCancelNewEntities: () => void;
  suggestions: AiDraftSuggestion[];
  hasValidSuggestion: boolean;
  anyInferred: boolean;
  editing: { index: number; field: string } | null;
  onEditField: (index: number, field: string) => void;
  onFieldChange: (index: number, field: string, value: string) => void;
  onFieldConfirm: (index: number, field: string) => void;
  onConfirm: (suggestion: AiDraftSuggestion) => void;
  onSaveDraft: (suggestion: AiDraftSuggestion) => void;
  onApplyToForm: AiLedgerPanelProps["onApplyToForm"];
}>) {
  const { t } = useI18n();
  return (
    <>
      <AiCaptureForm
        configured={configured}
        loading={loading}
        inputText={inputText}
        onInputTextChange={onInputTextChange}
        onSubmit={onSubmit}
        onClearError={onClearError}
        onToggleListening={onToggleListening}
        listening={listening}
        starting={starting}
      />

      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {message ? <output className="inline-message">{message}</output> : null}

      {pendingNewEntity ? (
        <AskNewEntitiesDialog
          suggestion={pendingNewEntity}
          onApprove={onApproveNewEntities}
          onCancel={onCancelNewEntities}
        />
      ) : null}

      {suggestions.length > 0 ? (
        <section className="ai-suggestions" aria-label={t("ai.suggestionsAria")}>
          <div className="draft-list-heading">
            <div>
              <p className="eyebrow">{t("ai.eyebrow")}</p>
              <h3>{hasValidSuggestion ? t("ai.confirmHeading") : t("ai.issuesHeading")}</h3>
            </div>
            <span>{t("ai.entryCount", { count: suggestions.length })}</span>
          </div>
          {anyInferred ? <p className="field-help">{t("ai.inferredHint")}</p> : null}
          {suggestions.map((suggestion, index) => (
            <SuggestionGroupCard
              key={suggestion.id}
              suggestion={suggestion}
              index={index}
              count={suggestions.length}
              editing={editing}
              onEditField={(targetIndex, field) => onEditField(targetIndex, field)}
              onFieldChange={onFieldChange}
              onFieldConfirm={onFieldConfirm}
              onConfirm={onConfirm}
              onSaveDraft={onSaveDraft}
              onApplyToForm={onApplyToForm}
            />
          ))}
        </section>
      ) : null}
    </>
  );
}

// Parses the typed/said text (and optional photo) into draft suggestions.
// Kept in a hook so the submit pipeline's branching does not count toward the
// panel component's cognitive complexity.
function useAiSubmit({
  accounts,
  categories,
  entityPolicy,
  setSuggestions,
  setLoading,
  setMessage,
  setError,
}: Readonly<{
  accounts: AiLedgerPanelProps["accounts"];
  categories: AiLedgerPanelProps["categories"];
  entityPolicy: AiEntityPolicy;
  setSuggestions: React.Dispatch<React.SetStateAction<AiDraftSuggestion[]>>;
  setLoading: (loading: boolean) => void;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
}>) {
  const { t } = useI18n();
  return async (text: string, imageDataUrl: string | undefined) => {
    setError("");
    setMessage("");
    if (!text.trim() && !imageDataUrl) {
      setError(t("ai.enterOrSayError"));
      return;
    }
    setLoading(true);
    try {
      // Compute once per submit so the system prompt and the parsed drafts
      // always agree on the reference date, even across midnight.
      const today = localToday();
      const system = buildLedgerSystemPrompt({ accounts, categories, today, entityPolicy });
      const user = buildUserPrompt(text, imageDataUrl);
      const result = await requestAiJson({ system, user, imageDataUrl });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const parsed = parseDraftSuggestions(result.data, accounts, categories, today, entityPolicy);
      setSuggestions(parsed);
      if (parsed.length === 0) {
        setError(t("ai.noTransactionsError"));
      }
    } finally {
      setLoading(false);
    }
  };
}

// Mode A speech capture: toggles the microphone and streams the recognized
// text to the caller. Kept separate from the panel so the recognition
// instance and its callbacks do not outlive the component.
function useAiSpeech({
  onTranscript,
  onError,
}: Readonly<{
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}>) {
  const [listening, setListening] = useState(false);
  // True from the click until the engine's onstart fires (the browser may
  // take a few seconds to load the speech model / grant the microphone).
  const [starting, setStarting] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Stop any in-flight speech session when the panel unmounts so the
  // recognition instance and its callbacks do not outlive the component.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const { t } = useI18n();
  const toggleListening = () => {
    const Ctor = speechRecognition();
    if (!Ctor) {
      onError(t("ai.speechUnsupported"));
      return;
    }
    if (listening || starting) {
      recognitionRef.current?.stop();
      return;
    }
    // Reuse the previous instance so a warm engine starts hearing right away;
    // fall back to a fresh one if the engine rejects the restart.
    const recognition: SpeechRecognitionLike = recognitionRef.current ?? new Ctor();
    recognition.lang = "zh-TW";
    recognition.interimResults = false;
    recognition.onstart = () => setStarting(false);
    recognition.onresult = (event) => {
      let transcript = "";
      for (const result of event.results) {
        transcript += result[0].transcript;
      }
      onTranscript(transcript);
    };
    recognition.onend = () => {
      setListening(false);
      setStarting(false);
    };
    recognition.onerror = () => {
      setListening(false);
      setStarting(false);
      onError(t("ai.speechFailed"));
    };
    recognitionRef.current = recognition;
    setListening(true);
    setStarting(true);
    try {
      recognition.start();
    } catch {
      const fresh = new Ctor();
      recognitionRef.current = fresh;
      fresh.lang = "zh-TW";
      fresh.interimResults = false;
      fresh.onstart = () => setStarting(false);
      fresh.onresult = recognition.onresult;
      fresh.onend = recognition.onend;
      fresh.onerror = recognition.onerror;
      fresh.start();
    }
  };

  return { listening, starting, toggleListening };
}

// In-place editing of a suggestion's fields (mode A): the editing index is
// kept here so the block input stays controlled while the draft mutates.
function useSuggestionEditing({
  setSuggestions,
  accounts,
  categories,
  entityPolicy,
}: Readonly<{
  setSuggestions: React.Dispatch<React.SetStateAction<AiDraftSuggestion[]>>;
  accounts: AiLedgerAccounts;
  categories: string[];
  entityPolicy: AiEntityPolicy;
}>) {
  const [editing, setEditing] = useState<{ index: number; field: string } | null>(null);

  const handleFieldEdit = (index: number, field: string, value: string) => {
    setSuggestions((current) => current.map((suggestion, i) =>
      i === index && suggestion.draft
        ? { ...suggestion, draft: { ...suggestion.draft, [field]: value } as TransactionDraft }
        : suggestion,
    ));
  };

  const handleFieldConfirm = (index: number, field: string) => {
    setSuggestions((current) => current.map((suggestion, i) => {
      if (i !== index || !suggestion.draft) return suggestion;
      const value = suggestion.draft[field as keyof TransactionDraft];
      return syncEntityFlagsAfterEdit(suggestion, field, typeof value === "string" ? value : "", accounts, categories, entityPolicy);
    }));
    setEditing(null);
  };

  return { editing, setEditing, handleFieldEdit, handleFieldConfirm };
}

// Whether confirming this suggestion must first ask the user to create the
// not-yet-existing entities, per the per-entity-type ask policy.
function needsNewEntityAsk(suggestion: AiDraftSuggestion, policy: AiEntityPolicy): boolean {
  return Boolean(
    (suggestion.newAccount && policy.account === "ask")
    || (suggestion.newTransferAccount && policy.account === "ask")
    || (suggestion.newCategory && policy.category === "ask"),
  );
}

// The confirm/save flows for draft suggestions, including the new-entity
// approval dialog (ADR 0012). Creation never happens as a side effect of the
// AI call itself; only of the user's confirmed write.
function useDraftActions({
  entityPolicy,
  onResolveNewEntities,
  onSaveRecord,
  onSaveDraft,
  setSuggestions,
  setMessage,
  setError,
}: Readonly<{
  entityPolicy: AiEntityPolicy;
  onResolveNewEntities: AiLedgerPanelProps["onResolveNewEntities"];
  onSaveRecord: AiLedgerPanelProps["onSaveRecord"];
  onSaveDraft: AiLedgerPanelProps["onSaveDraft"];
  setSuggestions: React.Dispatch<React.SetStateAction<AiDraftSuggestion[]>>;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
}>) {
  const [pendingNewEntities, setPendingNewEntities] = useState<AiDraftSuggestion | null>(null);

  // Creates any new entities the policy allows (auto, or the approved ask
  // flow), then writes the official record.
  const { t } = useI18n();
  const resolveAndPersist = (suggestion: AiDraftSuggestion) => {
    if (!suggestion.draft) return;
    const needsCreation = Boolean(suggestion.newAccount || suggestion.newCategory || suggestion.newTransferAccount);
    let created: LocalAccount[] = [];
    if (needsCreation) {
      if (!onResolveNewEntities) {
        setError(t("ai.newEntityFirst"));
        return;
      }
      const resolved = onResolveNewEntities(suggestion);
      if (resolved === false) {
        setError(t("ai.newEntityFailed"));
        return;
      }
      created = resolved;
    }
    const saveReason = onSaveRecord(suggestion.draft, created);
    if (saveReason !== null) {
      setError(saveReason);
      return;
    }
    setSuggestions((current) => current.filter((item) => item !== suggestion));
    setMessage(t("ai.confirmedWritten"));
  };

  const confirmSuggestion = (suggestion: AiDraftSuggestion) => {
    if (!suggestion.draft) return;
    setError("");
    setMessage("");
    if (needsNewEntityAsk(suggestion, entityPolicy)) {
      setPendingNewEntities(suggestion);
      return;
    }
    resolveAndPersist(suggestion);
  };

  const approveNewEntities = () => {
    const suggestion = pendingNewEntities;
    setPendingNewEntities(null);
    if (suggestion) {
      resolveAndPersist(suggestion);
    }
  };

  const cancelNewEntities = () => {
    setPendingNewEntities(null);
  };

  const saveSuggestionAsDraft = (suggestion: AiDraftSuggestion) => {
    if (!suggestion.draft) return;
    onSaveDraft(suggestion.draft);
    setSuggestions((current) => current.filter((item) => item !== suggestion));
    setMessage(t("ai.savedToQueue"));
  };

  return { pendingNewEntities, confirmSuggestion, approveNewEntities, cancelNewEntities, saveSuggestionAsDraft };
}

// The mode A input form: text/speech/photo entry plus the parse submit. Owns
// the photo selection (downscaled to the edge-function body limit).
function AiCaptureForm({
  configured,
  loading,
  inputText,
  onInputTextChange,
  onSubmit,
  onClearError,
  onToggleListening,
  listening,
  starting,
}: Readonly<{
  configured: boolean;
  loading: boolean;
  inputText: string;
  onInputTextChange: (value: string) => void;
  onSubmit: (text: string, imageDataUrl: string | undefined) => void;
  onClearError: () => void;
  onToggleListening: () => void;
  listening: boolean;
  starting: boolean;
}>) {
  const { t } = useI18n();
  const [selectedImage, setSelectedImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelection = (file: File | undefined) => {
    setSelectedImage(null);
    onClearError();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // readAsDataURL always resolves to a string; guard the union type.
      const result = reader.result;
      if (typeof result !== "string") return;
      // Downscale large photos so the request stays within the edge-function
      // body limit (base64 inflates ~33%). downscaleImage never rejects, so
      // the follow-up cannot fail silently.
      downscaleImage(result, 1600, 0.82).then((scaled) => {
        setSelectedImage({ name: file.name, dataUrl: scaled });
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <form
      className="ai-ledger-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(inputText, selectedImage?.dataUrl);
      }}
    >
      <p className="field-help">
        {t("ai.inputHelp")}
      </p>
      {!configured ? (
        <output className="inline-message">{t("ai.notConfiguredA")}</output>
      ) : null}
      <label htmlFor="ai-ledger-input">{t("ai.inputLabel")}</label>
      <textarea
        id="ai-ledger-input"
        className="ai-ledger-input"
        rows={3}
        value={inputText}
        onChange={(event) => onInputTextChange(event.target.value)}
        placeholder={t("ai.inputPlaceholder")}
      />
      <div className="ai-ledger-actions">
        <button className="secondary-action" type="button" onClick={onToggleListening} aria-pressed={listening || starting}>
          <Mic size={16} aria-hidden="true" />
          {listening || starting ? t("ai.stopListening") : t("ai.sayIt")}
        </button>
        <button
          className="secondary-action"
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={16} aria-hidden="true" />
          {t("ai.takeReceipt")}
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(event) => handleImageSelection(event.target.files?.[0])}
        />
        <button className="primary-action" type="submit" disabled={loading}>
          <Sparkles size={16} aria-hidden="true" />
          {loading ? t("ai.recognizing") : t("ai.generateDraft")}
        </button>
      </div>
      {selectedImage ? <p className="field-help">{t("ai.selectedImage", { name: selectedImage.name })}</p> : null}
    </form>
  );
}

// Maps a draft field to its raw value, used to decide whether a suggestion
// is complete and to feed the in-place editor.
function fieldValueFor(draft: TransactionDraft, field: string): string {
  switch (field) {
    case "date": return draft.date;
    case "kind": return kindLabelValue(draft.kind as string) ?? draft.kind;
    case "account": return draft.account;
    case "transferAccount": return draft.transferAccount;
    case "category": return draft.category;
    case "counterparty": return draft.counterparty;
    case "itemName": return draft.itemName;
    case "amount": return draft.amount;
    default: return "";
  }
}

// The display value in the blocks: the parser fills placeholder text for
// a missing counterparty/item name, which is suppressed here so the block
// reads as 待填 instead of leaking the placeholder.
function displayValueFor(draft: TransactionDraft, field: string): string {
  if (field === "counterparty" && draft.counterparty === missingCounterpartyLabel) return "";
  if (field === "itemName" && draft.itemName === missingItemNameLabel) return "";
  return fieldValueFor(draft, field);
}

function badgeFor(suggestion: AiDraftSuggestion, field: string): string | undefined {
  if ((field === "account" || field === "transferAccount") && (suggestion.newAccount || suggestion.newTransferAccount)) return t("ai.accountNotExist");
  if (field === "category" && suggestion.newCategory) return t("ai.categoryNotExist");
  return undefined;
}

// The field-block items for a valid suggestion, in the same order both
// modes use (ADR 0009), with inferred marking and new-entity badges.
function blockItemsFor(suggestion: AiDraftSuggestion): FieldBlockItem[] {
  const draft = suggestion.draft;
  if (!draft) return [];
  return modeBStepsFor(draft.kind).map((field) => ({
    field,
    label: modeBFieldLabel(field),
    value: displayValueFor(draft, field),
    state: "filled" as const,
    inferred: isInferred(suggestion.input, field),
    badge: badgeFor(suggestion, field),
    ...(field === "date"
      ? { valueContent: <DateDisplay inputDate={suggestion.input.date} date={draft.date} inferred={isInferred(suggestion.input, "date")} /> }
      : {}),
  }));
}

// One AI draft suggestion card: the field blocks plus the confirm/save
// actions once every mode B step is filled.
function SuggestionGroupCard({
  suggestion,
  index,
  count,
  editing,
  onEditField,
  onFieldChange,
  onFieldConfirm,
  onConfirm,
  onSaveDraft,
  onApplyToForm,
}: Readonly<{
  suggestion: AiDraftSuggestion;
  index: number;
  count: number;
  editing: { index: number; field: string } | null;
  onEditField: (index: number, field: string) => void;
  onFieldChange: (index: number, field: string, value: string) => void;
  onFieldConfirm: (index: number, field: string) => void;
  onConfirm: (suggestion: AiDraftSuggestion) => void;
  onSaveDraft: (suggestion: AiDraftSuggestion) => void;
  onApplyToForm?: (suggestion: AiDraftSuggestion) => void;
}>) {
  const { t } = useI18n();
  const blocks = blockItemsFor(suggestion);
  const complete = suggestion.draft
    ? modeBStepsFor(suggestion.draft.kind).every((field) => fieldValueFor(suggestion.draft as TransactionDraft, field) !== "")
    : false;
  return (
    <div className="field-block-group">
      <div className="field-block-group-heading">
        <strong>
          {count > 1 ? t("ai.entryPrefix", { index: index + 1 }) : ""}
          {suggestion.draft ? (
            <>
              <InferredSpan inferred={isInferred(suggestion.input, "kind")}>{kindLabelValue(suggestion.draft.kind as string) ?? t("ai.unknownKind")}</InferredSpan>
              {" · "}
              <InferredSpan inferred={isInferred(suggestion.input, "currency")}>{suggestion.draft.currency}</InferredSpan>
              {" "}
              <InferredSpan inferred={isInferred(suggestion.input, "amount")}>{suggestion.draft.amount}</InferredSpan>
            </>
          ) : (
            suggestionHeading(suggestion)
          )}
        </strong>
      </div>
      {suggestion.draft ? (
        <FieldBlocks
          items={blocks}
          editingField={editing?.index === index ? editing.field : null}
          onEditField={(field) => onEditField(index, field)}
          onFieldChange={(field, value) => onFieldChange(index, field, value)}
          onFieldConfirm={(field) => onFieldConfirm(index, field)}
        />
      ) : (
        <p className="field-help">{partialLine(suggestion.input) || t("ai.unrecognizedItem")}</p>
      )}
      {suggestion.draft && !complete ? <p className="field-help">{t("ai.fieldsIncomplete")}</p> : null}
      <SuggestionActions
        suggestion={suggestion}
        complete={complete}
        onConfirm={onConfirm}
        onSaveDraft={onSaveDraft}
        onApplyToForm={onApplyToForm}
      />
    </div>
  );
}

// The confirm/save actions for a completed suggestion, or the issues list and
// the form fallback for a rejected one.
function SuggestionActions({
  suggestion,
  complete,
  onConfirm,
  onSaveDraft,
  onApplyToForm,
}: Readonly<{
  suggestion: AiDraftSuggestion;
  complete: boolean;
  onConfirm: (suggestion: AiDraftSuggestion) => void;
  onSaveDraft: (suggestion: AiDraftSuggestion) => void;
  onApplyToForm?: (suggestion: AiDraftSuggestion) => void;
}>) {
  const { t } = useI18n();
  const canWrite = Boolean(suggestion.ok && suggestion.draft && complete);
  if (canWrite) {
    return (
      <div className="record-actions">
        <button className="primary-action" type="button" onClick={() => onConfirm(suggestion)}>
          {t("ai.confirmWrite")}
        </button>
        <button className="secondary-action" type="button" onClick={() => onSaveDraft(suggestion)}>
          {t("ai.saveDraft")}
        </button>
        {onApplyToForm ? (
          <button className="secondary-action" type="button" onClick={() => onApplyToForm(suggestion)}>
            {t("ai.applyToForm")}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <>
      {suggestion.issues.length > 0 ? (
        <ul className="ai-issues">
          {suggestion.issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : null}
      {onApplyToForm ? (
        <div className="record-actions">
          <button className="secondary-action" type="button" onClick={() => onApplyToForm(suggestion)}>
            {t("ai.applyToForm")}
          </button>
        </div>
      ) : null}
    </>
  );
}

function AskNewEntitiesDialog({
  suggestion,
  onApprove,
  onCancel,
}: Readonly<{
  suggestion: AiDraftSuggestion;
  onApprove: () => void;
  onCancel: () => void;
}>) {
  const { t } = useI18n();
  const entities = [
    suggestion.newAccount ? t("ai.accountQuote", { name: suggestion.newAccount }) : "",
    suggestion.newTransferAccount ? t("ai.accountQuote", { name: suggestion.newTransferAccount }) : "",
    suggestion.newCategory ? t("ai.categoryQuote", { name: suggestion.newCategory }) : "",
  ].filter(Boolean).join(t("common.and"));
  return (
    <dialog className="ask-new-entities" open aria-label={t("ai.newEntitiesDialogAria")}>
      <p>
        {t("ai.newEntitiesQuestion", { entities })}
      </p>
      <div className="record-actions">
        <button className="primary-action" type="button" onClick={onApprove}>
          {t("ai.createAndWrite")}
        </button>
        <button className="secondary-action" type="button" onClick={onCancel}>
          {t("ai.cancel")}
        </button>
      </div>
    </dialog>
  );
}

async function downscaleImage(dataUrl: string, maxDimension: number, quality: number): Promise<string> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image-load-failed"));
      img.src = dataUrl;
    });
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    if (scale >= 1) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

// Local calendar date (YYYY-MM-DD). toISOString would return the UTC date,
// which trails the local calendar for timezones east of UTC in the early hours.
function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// Shows what the model did recognize on a card whose draft was rejected
// (missing account/category/amount), so a failed item is not reduced to a
// cryptic snippet. Inferred marking still applies from the explicit list.
function partialLine(input: AiSuggestionInput): React.ReactNode {
  const parts: Array<{ text: string; field: string }> = [];
  if (typeof input.date === "string" && input.date.trim()) parts.push({ text: input.date.trim(), field: "date" });
  if (typeof input.counterparty === "string" && input.counterparty.trim()) parts.push({ text: input.counterparty.trim(), field: "counterparty" });
  if (typeof input.itemName === "string" && input.itemName.trim()) parts.push({ text: input.itemName.trim(), field: "itemName" });
  if (typeof input.amount === "string" || typeof input.amount === "number") {
    const rawAmount = String(input.amount).trim();
    if (rawAmount) parts.push({ text: rawAmount, field: "amount" });
  }
  if (parts.length === 0) return null;
  return parts.map((part, index) => (
    <Fragment key={part.field}>
      {index > 0 ? " · " : null}
      <InferredSpan inferred={isInferred(input, part.field)}>{part.text}</InferredSpan>
    </Fragment>
  ));
}

// Fields the model reports the user explicitly mentioned. An absent or
// non-array explicit list means no provenance was reported, so nothing is
// marked as inferred (legacy responses keep their current look).
function explicitFieldNames(input: AiSuggestionInput): Set<string> {
  const raw = input.explicit;
  if (!Array.isArray(raw)) return new Set();
  const names = new Set<string>();
  for (const value of raw) {
    if (typeof value === "string" && value.trim()) {
      names.add(value.trim().toLowerCase());
    }
  }
  return names;
}

function isInferred(input: AiSuggestionInput, field: string): boolean {
  const explicit = explicitFieldNames(input);
  return explicit.size > 0 && !explicit.has(field);
}

// Whether the year of the draft date was derived by the app: the parser fills
// the current year when the model input has no 4-digit year (e.g. "7/25").
function isDerivedYear(inputDate: unknown): boolean {
  return typeof inputDate !== "string" || !/\d{4}/.test(inputDate);
}

// Whether the suggestion card shows any inferred marking (used for the hint).
function hasInferredField(input: AiSuggestionInput): boolean {
  if (isDerivedYear(input.date)) return true;
  const explicit = explicitFieldNames(input);
  if (explicit.size === 0) return false;
  return ["kind", "date", "account", "category", "counterparty", "itemName", "amount", "currency", "transferAccount"].some((field) => !explicit.has(field));
}

// After the user edits a field in place, keep the new-entity flags consistent
// with the edited value: matching an existing entity clears the flag, a new
// name carries the flag under ask/auto, and the existing-only policy turns
// the suggestion invalid with a clear issue (mirroring the parser).
function syncEntityFlagsAfterEdit(
  suggestion: AiDraftSuggestion,
  field: string,
  value: string,
  accounts: AiLedgerAccounts,
  categories: string[],
  policy: AiEntityPolicy,
): AiDraftSuggestion {
  const next = { ...suggestion };
  const trimmed = value.trim();
  const existingAccount = accounts.some((account) => account.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  const existingCategory = categories.some((category) => category.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  if (field === "account") {
    if (existingAccount) {
      delete next.newAccount;
    } else if (policy.account === "existing") {
      next.ok = false;
      next.issues = [...next.issues, `帳戶「${trimmed}」不存在。`];
    } else {
      next.newAccount = trimmed;
    }
  } else if (field === "transferAccount") {
    if (existingAccount) {
      delete next.newTransferAccount;
    } else if (policy.account === "existing") {
      next.ok = false;
      next.issues = [...next.issues, `轉帳目標帳戶「${trimmed}」不存在。`];
    } else {
      next.newTransferAccount = trimmed;
    }
  } else if (field === "category") {
    if (existingCategory) {
      delete next.newCategory;
    } else if (policy.category === "existing") {
      next.ok = false;
      next.issues = [...next.issues, `類別「${trimmed}」不存在。`];
    } else {
      next.newCategory = trimmed;
    }
  }
  return next;
}

// Renders the draft date, marking the year as inferred when the parser derived
// it from today (the model input carried no 4-digit year).
function DateDisplay({ inputDate, date, inferred }: Readonly<{ inputDate: unknown; date: string; inferred: boolean }>): React.ReactElement {
  if (!isDerivedYear(inputDate)) {
    return <InferredSpan inferred={inferred}>{date}</InferredSpan>;
  }
  const year = date.slice(0, 4);
  const rest = date.slice(4);
  return (
    <Fragment>
      <InferredSpan inferred>{year}</InferredSpan>
      <InferredSpan inferred={inferred}>{rest}</InferredSpan>
    </Fragment>
  );
}

// The group heading for a rejected suggestion: kind plus a short note
// explaining why it is not confirmable.
const knownKindKeys = new Set(["expense", "income", "transfer"]);

function suggestionHeading(suggestion: AiDraftSuggestion): string {
  const raw = suggestion.input.kind as string;
  if (knownKindKeys.has(raw)) {
    return t("ai.incompleteHeading", { kind: kindLabelValue(raw) });
  }
  return t("ai.unrecognizedHeading");
}