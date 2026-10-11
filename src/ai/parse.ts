import { t } from "../i18n";
import { createTransactionDraft, missingCounterpartyLabel, missingItemNameLabel, type DraftForm, type TransactionDraft } from "../appShell/drafts";
import { DEFAULT_AI_ENTITY_POLICY, type AiEntityPolicy } from "./entityPolicy";

export type AiDraftKind = "expense" | "income" | "transfer";

export type AiSuggestionInput = {
  kind?: unknown;
  date?: unknown;
  account?: unknown;
  category?: unknown;
  counterparty?: unknown;
  itemName?: unknown;
  amount?: unknown;
  currency?: unknown;
  transferAccount?: unknown;
  transferAmount?: unknown;
  note?: unknown;
  // Field names the user explicitly mentioned; fields not listed here were
  // inferred by the model. Absent (not an array) means no provenance was
  // reported, which the suggestion card treats as "no marking".
  explicit?: unknown;
};

export type AiDraftSuggestion = {
  // Stable per-parse identity used as the React list key: the draft fields
  // mutate in place during mode A editing, so a content-derived key would
  // change mid-edit and break the editing state matching.
  id: string;
  input: AiSuggestionInput;
  draft: TransactionDraft | null;
  ok: boolean;
  issues: string[];
  // Names the user mentioned that do not exist yet. With an ask/auto entity
  // policy these are carried into the draft (account with TWD like the
  // default wallet) and are only created as part of the confirmed write, per
  // ADR 0012.
  newAccount?: string;
  newCategory?: string;
  newTransferAccount?: string;
};

export type AiLedgerAccounts = Array<{ name: string; currency: string }>;

// The not-yet-existing entities a capture flow may carry (see ADR 0012).
// Shared by the suggestion parser and the mode B panel's confirm flow.
export type NewEntityCarrier = Pick<AiDraftSuggestion, "newAccount" | "newCategory" | "newTransferAccount">;

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function normalizeKind(value: unknown): AiDraftKind | null {
  const kind = asText(value).toLowerCase();
  if (kind === "income" || kind === "收入") return "income";
  if (kind === "transfer" || kind === "轉帳" || kind === "轉出") return "transfer";
  if (kind === "expense" || kind === "支出" || kind === "") return "expense";
  return null;
}

function normalizeDate(value: unknown, today: string): string {
  const raw = asText(value).replace(/[./]/g, "-");
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (full) {
    const [, year, month, day] = full;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const short = /^(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (short) {
    const year = today.slice(0, 4);
    return `${year}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  }
  return today;
}

function parseAmount(value: unknown): string {
  const raw = asText(value).replace(/[,$\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return "";
  }
  return raw;
}

function matchAccount(value: unknown, accounts: AiLedgerAccounts): { name: string; currency: string } | null {
  const raw = asText(value);
  const normalized = raw.toLocaleLowerCase();
  return accounts.find((account) => account.name.toLocaleLowerCase() === normalized) ?? null;
}

function matchCategory(value: unknown, categories: string[]): string {
  const raw = asText(value);
  if (!raw) return "";
  const normalized = raw.toLocaleLowerCase();
  return categories.find((category) => category.toLocaleLowerCase() === normalized) ?? "";
}

function buildForm(input: AiSuggestionInput, account: { name: string; currency: string }, accounts: AiLedgerAccounts, today: string, category: string): DraftForm {
  const kind = normalizeKind(input.kind) ?? "expense";
  const amount = parseAmount(input.amount);
  const date = normalizeDate(input.date, today);
  const counterparty = asText(input.counterparty);
  const itemName = asText(input.itemName);

  const form: DraftForm = {
    date,
    account: account.name,
    kind,
    category,
    counterparty: counterparty || missingCounterpartyLabel,
    counterpartyMissing: !counterparty,
    itemName: itemName || missingItemNameLabel,
    itemNameMissing: !itemName,
    transferAccount: "",
    transferMode: "same-currency",
    amount,
    currency: account.currency,
    destinationAmount: "",
    destinationCurrency: "",
    feeEnabled: false,
    feeAccount: "",
    feeAmount: "",
    feeCurrency: "",
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
    note: asText(input.note),
    tags: ["AI"],
    sourceLabel: "ai",
  };

  if (kind === "transfer") {
    // Resolve to the matched account name so the draft validator's exact
    // name lookup accepts case-insensitive input from the model, and so the
    // same-account check compares canonical names. An unmatched destination
    // keeps its raw name so an allow-new policy can create it on confirm.
    form.transferAccount = matchAccount(input.transferAccount, accounts)?.name ?? asText(input.transferAccount);
    const transferAmount = parseAmount(input.transferAmount);
    if (transferAmount) {
      form.transferMode = "same-currency";
      form.amount = transferAmount;
    }
  }

  return form;
}

// Builds a ledger form from an AI suggestion, filling only the fields the
// model actually provided. An unknown account or category is left blank
// instead of rejecting the suggestion, so the user can complete it in the
// ledger form before saving. The manual ledger form uses account/category
// selectors, so a not-yet-existing name cannot be prefilled here even when
// the entity policy allows new entities; creation happens on the confirm
// path in the AI panel.
export function buildPrefillForm(
  input: AiSuggestionInput,
  accounts: AiLedgerAccounts,
  categories: string[],
  today: string,
): DraftForm {
  const account = matchAccount(input.account, accounts) ?? { name: "", currency: "TWD" };
  const category = matchCategory(input.category, categories);
  const form = buildForm(input, account, accounts, today, category);
  // The manual ledger form uses account selectors, so the destination must be
  // a matched account name; an unknown destination stays blank for the user
  // to pick manually.
  if (form.kind === "transfer") {
    form.transferAccount = matchAccount(input.transferAccount, accounts)?.name ?? "";
  }
  return form;
}

// Resolves the account name the user mentioned against the existing list, or
// carries it as a not-yet-existing entity when the policy allows new accounts
// (ADR 0012). A new account is synthesized with TWD, the same default the
// default wallet uses, so it flows through the existing draft validation and
// is only created on the user's confirmed write.
function resolveAccount(
  value: unknown,
  accounts: AiLedgerAccounts,
  policy: AiEntityPolicy,
): { account: { name: string; currency: string } | null; newAccount?: string; issue?: string } {
  const matched = matchAccount(value, accounts);
  if (matched) {
    return { account: matched };
  }
  const raw = asText(value);
  if (policy.account === "existing" || !raw) {
    return { account: null, issue: t("validation.entityMissing", { label: t("field.account"), name: raw || t("common.blankName") }) };
  }
  return { account: { name: raw, currency: "TWD" }, newAccount: raw };
}

// Same resolution for categories. Transfers carry no category, so an
// unmatched category on a transfer is ignored rather than rejected.
function resolveCategory(
  value: unknown,
  categories: string[],
  policy: AiEntityPolicy,
  kind: AiDraftKind | null,
): { category: string; newCategory?: string; issue?: string } {
  const matched = matchCategory(value, categories);
  if (matched || kind === "transfer") {
    return { category: matched };
  }
  const raw = asText(value);
  if (policy.category === "existing" || !raw) {
    return { category: "", issue: t("validation.entityMissing", { label: t("field.category"), name: raw || t("common.blankName") }) };
  }
  return { category: raw, newCategory: raw };
}

// Resolves the destination account of a transfer against the existing list.
function resolveTransferDestination(
  value: unknown,
  accounts: AiLedgerAccounts,
  policy: AiEntityPolicy,
): { newTransferAccount?: string; issue?: string } {
  if (matchAccount(value, accounts)) {
    return {};
  }
  const raw = asText(value);
  if (policy.account === "existing" || !raw) {
    return { issue: t("validation.entityMissing", { label: t("field.targetAccount"), name: raw || t("common.blankName") }) };
  }
  return { newTransferAccount: raw };
}

// A new account (or transfer destination) must be visible to the draft
// validator's exact-name account lookup; synthesize it with TWD, the same
// default the default wallet uses, so the draft passes validation before the
// user confirms and the entity is really created.
function syntheticAccountsFor(newEntities: NewEntityCarrier): AiLedgerAccounts {
  const syntheticAccounts: AiLedgerAccounts = [];
  if (newEntities.newAccount) {
    syntheticAccounts.push({ name: newEntities.newAccount, currency: "TWD" });
  }
  if (newEntities.newTransferAccount && newEntities.newTransferAccount !== newEntities.newAccount) {
    syntheticAccounts.push({ name: newEntities.newTransferAccount, currency: "TWD" });
  }
  return syntheticAccounts;
}

// Resolves the account, category, and (for transfers) destination the model
// mentioned against the existing lists, carrying not-yet-existing names as
// new-entity flags per the policy (ADR 0012).
function resolveEntitiesFor(
  input: AiSuggestionInput,
  accounts: AiLedgerAccounts,
  categories: string[],
  policy: AiEntityPolicy,
  kind: AiDraftKind | null,
): { issues: string[]; newEntities: NewEntityCarrier; account: { name: string; currency: string } | null; category: string } {
  const issues: string[] = [];
  const newEntities: NewEntityCarrier = {};

  const resolvedAccount = resolveAccount(input.account, accounts, policy);
  if (resolvedAccount.issue) {
    issues.push(resolvedAccount.issue);
  }
  if (resolvedAccount.newAccount) {
    newEntities.newAccount = resolvedAccount.newAccount;
  }

  const resolvedCategory = resolveCategory(input.category, categories, policy, kind);
  if (resolvedCategory.issue) {
    issues.push(resolvedCategory.issue);
  }
  if (resolvedCategory.newCategory) {
    newEntities.newCategory = resolvedCategory.newCategory;
  }

  if (kind === "transfer") {
    const resolvedTransfer = resolveTransferDestination(input.transferAccount, accounts, policy);
    if (resolvedTransfer.issue) {
      issues.push(resolvedTransfer.issue);
    }
    if (resolvedTransfer.newTransferAccount) {
      newEntities.newTransferAccount = resolvedTransfer.newTransferAccount;
    }
  }

  return { issues, newEntities, account: resolvedAccount.account, category: resolvedCategory.category };
}

export function parseDraftSuggestions(
  payload: unknown,
  accounts: AiLedgerAccounts,
  categories: string[],
  today: string,
  policy: AiEntityPolicy = DEFAULT_AI_ENTITY_POLICY,
): AiDraftSuggestion[] {
  let items: unknown[];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (Array.isArray((payload as { items?: unknown })?.items)) {
    items = (payload as { items: unknown[] }).items;
  } else {
    items = [];
  }

  return items.map((item): AiDraftSuggestion => {
    const input = (item && typeof item === "object" ? item : {}) as AiSuggestionInput;
    const id = crypto.randomUUID();
    const issues: string[] = [];

    const kind = normalizeKind(input.kind);
    if (!kind) {
      issues.push(t("validation.unsupportedKind", { kind: asText(input.kind) || t("common.blankName") }));
    }

    const { issues: entityIssues, newEntities, account, category } = resolveEntitiesFor(input, accounts, categories, policy, kind);
    issues.push(...entityIssues);

    const amount = parseAmount(input.amount);
    const transferAmount = parseAmount(input.transferAmount);
    // Transfers may omit the redundant top-level amount and only provide
    // transferAmount, which buildForm already prefers when building the draft.
    const effectiveAmount = kind === "transfer" && !amount ? transferAmount : amount;
    if (!effectiveAmount) {
      issues.push(t("validation.amountUnrecognized"));
    }

    if (!kind || !account || !effectiveAmount) {
      return { id, input, draft: null, ok: false, issues, ...newEntities };
    }

    const form = buildForm(input, account, accounts, today, category);
    // buildForm already canonicalizes a matched destination (and keeps the raw
    // name when the policy allows a new one); only the same-account check is
    // left here.
    if (form.transferAccount === form.account) {
      issues.push(t("validation.sameTransferAccount"));
    }

    if (issues.length > 0) {
      return { id, input, draft: null, ok: false, issues, ...newEntities };
    }

    const draft = createTransactionDraft(form, `ai-${crypto.randomUUID()}`, [...accounts, ...syntheticAccountsFor(newEntities)]);
    if (!draft) {
      issues.push(t("validation.ruleViolation"));
      return { id, input, draft: null, ok: false, issues, ...newEntities };
    }
    return { id, input, draft, ok: true, issues, ...newEntities };
  });
}
