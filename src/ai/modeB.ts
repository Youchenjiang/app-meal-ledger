import { t } from "../i18n";
import { createTransactionDraft, type DraftForm, type TransactionDraft } from "../appShell/drafts";
import type { AiEntityPolicy } from "./entityPolicy";
import type { AiLedgerAccounts, NewEntityCarrier } from "./parse";

// The fields a mode B (step-by-step) capture walks through, in the fixed
// order from ADR 0009. When the user says the kind is a transfer, an extra
// transferAccount step is inserted after the account (and the category step
// is skipped, since transfers carry no category).
export type ModeBField = "date" | "kind" | "account" | "transferAccount" | "category" | "counterparty" | "itemName" | "amount";

export const MODE_B_FIELDS: ModeBField[] = ["date", "kind", "account", "category", "counterparty", "itemName", "amount"];

// Field labels and speech prompts resolve through the copy dictionary at call
// time so they follow the selected locale (keys ai.field.* / ai.prompt.*).
export function modeBFieldLabel(field: ModeBField): string {
  return t(`ai.field.${field}`);
}

export function modeBFieldPrompt(field: ModeBField): string {
  return t(`ai.prompt.${field}`);
}

// The step sequence for the current kind: transfers add a destination step
// and drop the category step.
export function modeBStepsFor(kind: string | undefined): ModeBField[] {
  const isTransfer = kind === "transfer";
  const steps: ModeBField[] = ["date", "kind", "account"];
  if (isTransfer) {
    steps.push("transferAccount");
  } else {
    steps.push("category");
  }
  steps.push("counterparty", "itemName", "amount");
  return steps;
}

export type ModeBCorrectionContext = {
  accounts: AiLedgerAccounts;
  categories: string[];
  today: string;
  entityPolicy: AiEntityPolicy;
};

function entityRuleText(
  entity: "account" | "category",
  policy: AiEntityPolicy,
  list: string,
): string {
  const noun = entity === "account" ? "帳戶" : "類別";
  if (policy[entity] === "existing") {
    return `只能用現有${noun}名稱,從這裡選最接近的:${list}。`;
  }
  return `用使用者講的${noun}名稱;若接近現有${noun}請用現有名稱。現有${noun}:${list}。`;
}

// The per-field correction prompt (ADR 0010): normalizes the current field's
// raw speech transcript into the format the ledger form expects.
export function buildFieldCorrectionSystemPrompt(field: ModeBField, context: ModeBCorrectionContext): string {
  const accountList = context.accounts.map((account) => account.name).join("、") || "(尚未建立帳戶)";
  const categoryList = context.categories.join("、") || "(尚未建立類別)";
  const fieldRule = correctionRule(field, context, accountList, categoryList);
  return [
    "你是記帳助理。把使用者的口語輸入轉成單一欄位的正確格式。",
    "只能回傳 JSON,不要任何其他文字或 markdown。",
    '回傳格式: {"value":"欄位值"}',
    `目前欄位: ${modeBFieldLabel(field)}`,
    fieldRule,
    "無法判斷時 value 回空字串,不要編造。",
  ].join("\n");
}

function correctionRule(
  field: ModeBField,
  context: ModeBCorrectionContext,
  accountList: string,
  categoryList: string,
): string {
  switch (field) {
    case "amount":
      return "把口語金額轉成阿拉伯數字(「兩百五十」→250、「一千二」→1200),不含逗號與貨幣符號;已是數字就原樣輸出。";
    case "date":
      return `把口語日期轉成 YYYY-MM-DD(「七月二十五」→${context.today.slice(0, 4)}-07-25、「昨天」→${yesterday(context.today)});今天為 ${context.today}。`;
    case "kind":
      return "類型只能是 expense(支出)、income(收入)、transfer(轉帳);「買了/花了」→expense、「薪水/收入」→income、「轉帳/轉出」→transfer;不確定回空字串。";
    case "account":
      return entityRuleText("account", context.entityPolicy, accountList);
    case "category":
      return entityRuleText("category", context.entityPolicy, categoryList);
    case "counterparty":
    case "itemName":
    case "transferAccount":
      return "保留使用者說的名稱,移除前後空白;無法判斷回空字串。";
    default:
      // Defensive: the switch is exhaustive over ModeBField; unknown fields
      // fall back to the generic name rule rather than an empty prompt.
      return "保留使用者說的名稱,移除前後空白;無法判斷回空字串。";
  }
}

function yesterday(today: string): string {
  const date = new Date(`${today}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

// Extracts the corrected value from the per-field JSON response. Returns an
// empty string when the payload is missing or malformed; the panel falls back
// to the raw transcript, so correction never blocks the flow.
export function parseFieldCorrection(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const value = (payload as { value?: unknown }).value;
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

export type ModeBDraftResult = {
  draft: TransactionDraft | null;
  issues: string[];
  newAccount?: string;
  newCategory?: string;
  newTransferAccount?: string;
};

function normalizeKindValue(value: string | undefined): "expense" | "income" | "transfer" {
  const kind = (value ?? "").trim().toLowerCase();
  if (kind === "income" || kind === "收入") return "income";
  if (kind === "transfer" || kind === "轉帳" || kind === "轉出") return "transfer";
  return "expense";
}

// Resolves a spoken account name against the existing accounts under the
// entity policy (ADR 0012): existing-only rejects unknown names, ask/auto
// carry them as new entities to create on the confirmed write. Pushes an
// issue for a blank name and for an unknown name under existing-only.
function resolveAccountField(
  raw: string,
  accounts: AiLedgerAccounts,
  policy: AiEntityPolicy,
  label: string,
  entityKey: "newAccount" | "newTransferAccount",
  newEntities: NewEntityCarrier,
  issues: string[],
): { name: string; currency: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    issues.push(t("validation.fieldBlank", { label }));
    return null;
  }
  const matched = matchAccountName(trimmed, accounts);
  if (matched) return matched;
  if (policy.account === "existing") {
    issues.push(t("validation.entityMissing", { label, name: trimmed }));
    return null;
  }
  newEntities[entityKey] = trimmed;
  return { name: trimmed, currency: "TWD" };
}

// Same resolution as resolveAccountField but for categories (which have no
// currency), used only for non-transfer records.
function resolveCategoryField(
  raw: string,
  categories: string[],
  policy: AiEntityPolicy,
  newEntities: NewEntityCarrier,
  issues: string[],
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    issues.push(t("validation.fieldBlank", { label: t("field.category") }));
    return "";
  }
  const matched = matchCategoryName(trimmed, categories);
  if (matched) return matched;
  if (policy.category === "existing") {
    issues.push(t("validation.entityMissing", { label: t("field.category"), name: trimmed }));
    return "";
  }
  newEntities.newCategory = trimmed;
  return trimmed;
}

function matchAccountName(value: string, accounts: AiLedgerAccounts): { name: string; currency: string } | null {
  const normalized = value.toLocaleLowerCase();
  return accounts.find((account) => account.name.toLocaleLowerCase() === normalized) ?? null;
}

function matchCategoryName(value: string, categories: string[]): string {
  const normalized = value.toLocaleLowerCase();
  return categories.find((category) => category.toLocaleLowerCase() === normalized) ?? "";
}

// Parses a locally typed or (offline) spoken date into YYYY-MM-DD, covering
// the formats the mode B date prompt suggests plus the canonical form:
//   "2026-07-25" / "2026/7/5"  → kept as-is (padded)
//   "7/25", "7-25"            → this year
//   "七月二十五", "7月25日"      → this year, Chinese numerals resolved
//   "今天/昨天/前天/明天"        → relative to today
// Returns null when the value cannot be resolved, so the caller rejects the
// draft instead of writing a non-ISO date into the official record.
export function parseSpokenDate(value: string, today: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  const normalized = raw.replace(/[./]/g, "-");
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (full) {
    return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
  }

  const short = /^(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (short) {
    return `${today.slice(0, 4)}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  }

  // Chinese numerals: 七月二十五 / 七月25日 / 7月25日.
  const chinese = /^(\d{1,2}|[一二三四五六七八九十]{1,2})月(\d{1,2}|[一二三四五六七八九十]{1,3})日?$/u.exec(raw);
  if (chinese) {
    const month = chineseNumeral(chinese[1]);
    const day = chineseNumeral(chinese[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${today.slice(0, 4)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const relative: Record<string, number> = { 今天: 0, 昨天: -1, 前天: -2, 明天: 1 };
  if (raw in relative) {
    return shiftDate(today, relative[raw]);
  }

  return null;
}

function chineseNumeral(text: string): number {
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return 10;
  const tens = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/u.exec(text);
  if (tens) {
    return (tens[1] ? digits[tens[1]] : 1) * 10 + (tens[2] ? digits[tens[2]] : 0);
  }
  return digits[text] ?? 0;
}

// Shifts a local YYYY-MM-DD by a signed number of days without the UTC
// off-by-one that a bare toISOString would introduce.
function shiftDate(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00`);
  date.setDate(date.getDate() + days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// Assembles the confirmed mode B field values into a validated draft. The
// account/category resolution follows the entity policy (ADR 0012): a
// not-yet-existing name is carried as a new-entity flag under ask/auto and
// rejected under existing-only, mirroring the suggestion parser.
export function buildModeBDraft(
  values: Partial<Record<ModeBField, string>>,
  accounts: AiLedgerAccounts,
  categories: string[],
  today: string,
  policy: AiEntityPolicy,
): ModeBDraftResult {
  const issues: string[] = [];
  const newEntities: NewEntityCarrier = {};

  const kind = normalizeKindValue(values.kind);
  const isTransfer = kind === "transfer";

  const sourceAccount = resolveAccountField(values.account ?? "", accounts, policy, "帳戶", "newAccount", newEntities, issues);
  const category = isTransfer ? "" : resolveCategoryField(values.category ?? "", categories, policy, newEntities, issues);
  const transferName = isTransfer
    ? resolveAccountField(values.transferAccount ?? "", accounts, policy, "轉帳目標帳戶", "newTransferAccount", newEntities, issues)?.name ?? ""
    : "";

  const amount = values.amount?.trim() ?? "";
  if (!amount) {
    issues.push(t("validation.fieldBlank", { label: t("field.amount") }));
  }
  const rawDate = values.date?.trim() ?? "";
  const date = parseSpokenDate(rawDate, today) ?? "";
  if (!rawDate) {
    issues.push(t("validation.fieldBlank", { label: t("field.date") }));
  } else if (!date) {
    issues.push(t("validation.dateUnparsable", { value: rawDate }));
  }

  if (issues.length > 0 || !sourceAccount) {
    return { draft: null, issues, ...newEntities };
  }

  const form: DraftForm = {
    date,
    account: sourceAccount.name,
    kind,
    category: isTransfer ? "" : category,
    counterparty: values.counterparty?.trim() ?? "",
    counterpartyMissing: false,
    itemName: values.itemName?.trim() ?? "",
    itemNameMissing: false,
    transferAccount: transferName,
    transferMode: "same-currency",
    amount,
    currency: sourceAccount.currency,
    destinationAmount: "",
    destinationCurrency: "TWD",
    feeEnabled: false,
    feeAccount: "",
    feeAmount: "",
    feeCurrency: "TWD",
    feeCategory: "",
    refundReason: "",
    refundSubtype: "refund",
    refundLinkedRecordId: "",
    refundExcessHandling: "unclassified",
    recurrenceChoice: "current-cycle-only",
    recurrenceAmountMode: "fixed",
    reason: "",
    timePrecision: "day",
    periodStart: "",
    periodEnd: "",
    note: "",
    tags: ["AI", "語音"],
    sourceLabel: "voice",
  };

  // A new account (or transfer destination) must be visible to the draft
  // validator's exact-name account lookup; synthesize it with TWD like the
  // default wallet so validation passes before the confirmed write.
  const syntheticAccounts: AiLedgerAccounts = [];
  if (newEntities.newAccount) {
    syntheticAccounts.push({ name: newEntities.newAccount, currency: "TWD" });
  }
  if (newEntities.newTransferAccount && newEntities.newTransferAccount !== newEntities.newAccount) {
    syntheticAccounts.push({ name: newEntities.newTransferAccount, currency: "TWD" });
  }
  const draft = createTransactionDraft(form, `mode-b-${crypto.randomUUID()}`, [...accounts, ...syntheticAccounts]);
  if (!draft) {
    issues.push(t("validation.ruleViolation"));
    return { draft: null, issues, ...newEntities };
  }
  return { draft, issues, ...newEntities };
}

// Local calendar date (YYYY-MM-DD). toISOString would return the UTC date,
// which trails the local calendar for timezones east of UTC in the early
// hours.
export function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
