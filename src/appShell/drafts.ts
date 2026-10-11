import type { ManualRecordKind } from "../manualLedger/kinds";
import { isNonZeroMoney, isPositiveMoney } from "../manualLedger/money";

export { manualRecordKinds as draftKinds } from "../manualLedger/kinds";

export type DraftKind = ManualRecordKind;
export type TransferMode = "same-currency" | "cross-currency";
export type TimePrecision = "day" | "month" | "period";
export type RefundSubtype = "refund" | "payback";
export type RefundExcessHandling = "unclassified" | "income" | "negative-expense" | "exchange_difference";
export type RecurrenceChoice = "current-cycle-only" | "prompt-next-cycle" | "auto-record-next-cycle";
export type RecurrenceAmountMode = "fixed" | "variable";
export const missingCounterpartyLabel = "商家不詳";
export const missingItemNameLabel = "品項不詳";

export type DraftForm = {
  date: string;
  account: string;
  kind: DraftKind;
  category: string;
  counterparty: string;
  counterpartyMissing: boolean;
  itemName: string;
  itemNameMissing: boolean;
  transferAccount: string;
  transferMode: TransferMode;
  amount: string;
  currency: string;
  destinationAmount: string;
  destinationCurrency: string;
  feeEnabled: boolean;
  feeAccount: string;
  feeAmount: string;
  feeCurrency: string;
  feeCategory: string;
  refundReason: string;
  refundSubtype: RefundSubtype;
  refundLinkedRecordId: string;
  refundLinkedRecordIds?: string[];
  refundExcessHandling: RefundExcessHandling;
  recurrenceChoice: RecurrenceChoice;
  recurrenceAmountMode: RecurrenceAmountMode;
  reason: string;
  timePrecision: TimePrecision;
  periodStart: string;
  periodEnd: string;
  note: string;
  tags?: string[];
  event?: string;
  sourceLabel?: string;
};

export type TransactionDraft = DraftForm & {
  id: string;
};

export type DraftAccount = {
  name: string;
  currency: string;
};

type TextDraftField =
  | "date"
  | "account"
  | "category"
  | "counterparty"
  | "itemName"
  | "transferAccount"
  | "amount"
  | "currency"
  | "destinationAmount"
  | "destinationCurrency"
  | "feeAccount"
  | "feeAmount"
  | "feeCurrency"
  | "feeCategory"
  | "refundReason"
  | "refundLinkedRecordId"
  | "reason"
  | "periodStart"
  | "periodEnd"
  | "note";

const textFields: TextDraftField[] = [
  "date",
  "account",
  "category",
  "counterparty",
  "itemName",
  "transferAccount",
  "amount",
  "currency",
  "destinationAmount",
  "destinationCurrency",
  "feeAccount",
  "feeAmount",
  "feeCurrency",
  "feeCategory",
  "refundReason",
  "refundLinkedRecordId",
  "reason",
  "periodStart",
  "periodEnd",
  "note",
];

export function normalizeDraftForm(form: DraftForm): DraftForm {
  const normalized = { ...form };

  for (const field of textFields) {
    normalized[field] = normalized[field].trim();
  }

  return normalized;
}

export function monthToPeriodRange(month: string): { periodStart: string; periodEnd: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    periodStart: `${month}-01`,
    periodEnd: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function hasRequiredFields(form: DraftForm, fields: Array<keyof DraftForm>): boolean {
  return fields.every((field) => Boolean(form[field]));
}

function hasCompleteFee(form: DraftForm): boolean {
  return !form.feeEnabled
    || (hasRequiredFields(form, ["feeAccount", "feeAmount", "feeCurrency", "feeCategory"])
      && isPositiveMoney(form.feeAmount, form.feeCurrency));
}

function accountFor(accounts: DraftAccount[], name: string): DraftAccount | undefined {
  return accounts.find((account) => account.name === name);
}

function hasMatchingAccountCurrency(form: DraftForm, accounts: DraftAccount[]): boolean {
  const account = accountFor(accounts, form.account);
  return account?.currency === form.currency;
}

function hasValidFeeAccount(form: DraftForm, accounts: DraftAccount[]): boolean {
  if (!form.feeEnabled) {
    return true;
  }

  const account = accountFor(accounts, form.feeAccount);
  return account?.currency === form.feeCurrency;
}

function validateExpenseDraft(form: DraftForm): boolean {
  return hasRequiredFields(form, ["date", "account", "amount", "currency", "category", "counterparty", "itemName"])
    && isPositiveMoney(form.amount, form.currency)
    && (!form.counterpartyMissing || form.counterparty === missingCounterpartyLabel)
    && (!form.itemNameMissing || form.itemName === missingItemNameLabel);
}

function validateIncomeDraft(form: DraftForm): boolean {
  return hasRequiredFields(form, ["date", "account", "amount", "currency", "category", "counterparty"])
    && isPositiveMoney(form.amount, form.currency);
}

function validateTransferDraft(form: DraftForm, accounts: DraftAccount[]): boolean {
  const destinationAccount = accountFor(accounts, form.transferAccount);
  if (!hasCompleteFee(form) || !hasValidFeeAccount(form, accounts) || !destinationAccount || form.account === form.transferAccount) {
    return false;
  }

  if (form.transferMode === "same-currency") {
    return hasRequiredFields(form, ["date", "account", "transferAccount", "amount", "currency"])
      && isPositiveMoney(form.amount, form.currency)
      && destinationAccount.currency === form.currency;
  }

  return hasRequiredFields(form, [
    "date",
    "account",
    "transferAccount",
    "amount",
    "currency",
    "destinationAmount",
    "destinationCurrency",
  ])
    && isPositiveMoney(form.amount, form.currency)
    && isPositiveMoney(form.destinationAmount, form.destinationCurrency)
    && destinationAccount.currency === form.destinationCurrency;
}

function validateRefundDraft(form: DraftForm): boolean {
  return hasRequiredFields(form, ["date", "account", "amount", "currency", "category", "counterparty", "refundReason"])
    && isPositiveMoney(form.amount, form.currency)
    && (form.refundSubtype !== "payback" || Boolean(form.refundLinkedRecordIds?.length || form.refundLinkedRecordId));
}

function validateFundAdditionDraft(form: DraftForm): boolean {
  return hasRequiredFields(form, ["date", "account", "amount", "currency", "counterparty"])
    && isPositiveMoney(form.amount, form.currency);
}

function validateAdjustmentDraft(form: DraftForm): boolean {
  return hasRequiredFields(form, ["date", "account", "amount", "currency", "reason"])
    && isNonZeroMoney(form.amount, form.currency);
}

function validateUnresolvedExpenseDraft(form: DraftForm): boolean {
  if (!hasRequiredFields(form, ["account", "amount", "currency", "timePrecision"]) || !isPositiveMoney(form.amount, form.currency)) {
    return false;
  }

  if (form.timePrecision === "day") {
    return Boolean(form.date);
  }

  return hasRequiredFields(form, ["periodStart", "periodEnd"])
    && form.periodStart <= form.periodEnd;
}

const draftValidators: Record<DraftKind, (form: DraftForm, accounts: DraftAccount[]) => boolean> = {
  expense: (form) => validateExpenseDraft(form),
  income: (form) => validateIncomeDraft(form),
  transfer: (form, accounts) => validateTransferDraft(form, accounts),
  refund: (form) => validateRefundDraft(form),
  "fund-addition": (form) => validateFundAdditionDraft(form),
  adjustment: (form) => validateAdjustmentDraft(form),
  "unresolved-expense": (form) => validateUnresolvedExpenseDraft(form),
};

export function canCreateManualDraft(form: DraftForm, accounts: DraftAccount[]): boolean {
  const normalized = normalizeDraftForm(form);

  if (normalized.recurrenceChoice === "auto-record-next-cycle" && !canAutoRecordNextCycle(normalized, accounts)) {
    return false;
  }

  if (!hasMatchingAccountCurrency(normalized, accounts)) {
    return false;
  }

  return draftValidators[normalized.kind](normalized, accounts);
}

export function canAutoRecordNextCycle(form: DraftForm, accounts: DraftAccount[]): boolean {
  if (form.recurrenceAmountMode !== "fixed" || !form.amount.trim()) {
    return false;
  }

  return canCreateManualDraft({ ...form, recurrenceChoice: "current-cycle-only" }, accounts);
}

export function createTransactionDraft(form: DraftForm, id: string, accounts: DraftAccount[]): TransactionDraft | null {
  const normalized = normalizeDraftForm(form);

  if (!canCreateManualDraft(normalized, accounts)) {
    return null;
  }

  return { id, ...normalized };
}
