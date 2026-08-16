import { t } from "../i18n";
import type { ManualRecordKind } from "../manualLedger/kinds";
import type { NormalizedImportField } from "./mapping";

export type NormalizedImportRow = Partial<Record<NormalizedImportField, string>>;

export type ImportAccount = {
  name: string;
  currency: string;
};

export type ImportRowValidation = {
  rowNumber: number;
  ok: boolean;
  normalized: NormalizedImportRow;
  errors: string[];
};

const supportedKinds = new Set<ManualRecordKind>([
  "expense",
  "income",
  "transfer",
  "refund",
  "fund-addition",
  "adjustment",
  "unresolved-expense",
]);

function text(row: NormalizedImportRow, field: NormalizedImportField): string {
  return row[field]?.trim() ?? "";
}

function required(row: NormalizedImportRow, field: NormalizedImportField, label: string, errors: string[]): string {
  const value = text(row, field);
  if (!value) {
    errors.push(t("validation.required", { label }));
  }
  return value;
}

function normalizeDate(value: string): string | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeAmount(value: string): string | null {
  const cleaned = value.replace(/[,$\s]/g, "");
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? cleaned : null;
}

function validatePrecision(amount: string, currency: string, errors: string[]): void {
  const precision = currency === "TWD" || currency === "JPY" ? 0 : 2;
  const fractionalDigits = amount.split(".")[1]?.length ?? 0;
  if (fractionalDigits > precision) {
    errors.push(t("validation.precision", { currency, precision }));
  }
}

function positiveAmount(amount: string, label: string, errors: string[]): string {
  const normalized = normalizeAmount(amount);
  if (normalized === null || Number(normalized) <= 0) {
    errors.push(t("validation.amountPositive", { label }));
    return "";
  }
  return normalized;
}

function accountFor(accounts: ImportAccount[], name: string): ImportAccount | undefined {
  return accounts.find((account) => account.name === name);
}

function validateAccount(row: NormalizedImportRow, accounts: ImportAccount[], errors: string[]): ImportAccount | undefined {
  const name = required(row, "account", t("field.account"), errors);
  const account = accountFor(accounts, name);
  if (name && !account) {
    errors.push(t("validation.accountMissing", { name }));
  }
  return account;
}

function validateDate(row: NormalizedImportRow, errors: string[]): string {
  const value = required(row, "date", t("field.date"), errors);
  if (!value) {
    return "";
  }
  const normalized = normalizeDate(value);
  if (!normalized) {
    errors.push(t("validation.dateFormat"));
    return "";
  }
  return normalized;
}

export function validateImportRows(rows: NormalizedImportRow[], accounts: ImportAccount[]): ImportRowValidation[] {
  return rows.map((input, index) => validateImportRow(input, index, accounts));
}

function validateImportRow(input: NormalizedImportRow, index: number, accounts: ImportAccount[]): ImportRowValidation {
  const normalized: NormalizedImportRow = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value?.trim() ?? ""])) as NormalizedImportRow;
  const errors: string[] = [];
  const kind = text(normalized, "kind") as ManualRecordKind;
  const account = validateAccount(normalized, accounts, errors);
  const amount = normalizeImportAmount(normalized, kind, account, errors);
  if (amount) normalized.amount = amount;
  validateKindFields(normalized, kind, account, accounts, amount, errors);
  validateImportFees(normalized, kind, accounts, errors);
  return { rowNumber: index + 2, ok: errors.length === 0, normalized, errors };
}

function normalizeImportAmount(normalized: NormalizedImportRow, kind: ManualRecordKind, account: ImportAccount | undefined, errors: string[]): string {
  if (!text(normalized, "currency") && account) normalized.currency = account.currency;
  const currency = text(normalized, "currency") || account?.currency || "";
  const rawAmount = text(normalized, "amount");
  const parsedAmount = normalizeAmount(rawAmount);
  const amount = kind === "adjustment" ? parsedAmount ?? "" : positiveAmount(rawAmount, t("field.amount"), errors);
  if (kind === "adjustment" && (parsedAmount === null || Number(parsedAmount) === 0)) errors.push(t("validation.adjustmentNonZero"));
  if (currency && amount) validatePrecision(amount, currency, errors);
  return amount;
}

function validateKindFields(normalized: NormalizedImportRow, kind: ManualRecordKind, account: ImportAccount | undefined, accounts: ImportAccount[], amount: string, errors: string[]): void {
  if (!supportedKinds.has(kind)) {
    errors.push(t("validation.kindRequired"));
    return;
  }
  if (kind === "expense") {
    validateExpenseFields(normalized, errors);
    return;
  }
  if (kind === "income") {
    validateIncomeFields(normalized, errors);
    return;
  }
  if (kind === "fund-addition") {
    validateDateAndRequired(normalized, "source", t("field.source"), errors);
    return;
  }
  if (kind === "adjustment") {
    validateAdjustmentFields(normalized, amount, errors);
    return;
  }
  if (kind === "refund") {
    validateRefundFields(normalized, errors);
    return;
  }
  if (kind === "transfer") {
    validateTransferFields(normalized, account, accounts, amount, errors);
    return;
  }
  validateUnresolvedExpenseFields(normalized, errors);
}

function validateExpenseFields(normalized: NormalizedImportRow, errors: string[]): void {
  validateDateAndRequired(normalized, "category", t("field.category"), errors);
  required(normalized, "merchant", t("field.merchant"), errors);
  required(normalized, "item_name", t("field.itemName"), errors);
}

function validateIncomeFields(normalized: NormalizedImportRow, errors: string[]): void {
  validateDateAndRequired(normalized, "category", t("field.category"), errors);
  required(normalized, "source", t("field.source"), errors);
}

function validateDateAndRequired(normalized: NormalizedImportRow, field: keyof NormalizedImportRow, label: string, errors: string[]): void {
  normalized.date = validateDate(normalized, errors);
  required(normalized, field, label, errors);
}

function validateAdjustmentFields(normalized: NormalizedImportRow, amount: string, errors: string[]): void {
  validateDateAndRequired(normalized, "reason", t("field.reason"), errors);
  if (amount && Number(amount) === 0) errors.push(t("validation.adjustmentZero"));
}

function validateRefundFields(normalized: NormalizedImportRow, errors: string[]): void {
  validateDateAndRequired(normalized, "category", t("field.category"), errors);
  required(normalized, "merchant", t("field.merchantOrSource"), errors);
  required(normalized, "refund_reason", t("field.refundReason"), errors);
  const isPayback = text(normalized, "refund_subtype") === "payback";
  const hasLinkedExpense = Boolean(text(normalized, "refund_linked_record_ids") || text(normalized, "refund_linked_record_id"));
  if (isPayback && !hasLinkedExpense) errors.push(t("validation.paybackNeedsExpense"));
}

function validateTransferFields(normalized: NormalizedImportRow, account: ImportAccount | undefined, accounts: ImportAccount[], amount: string, errors: string[]): void {
  normalized.date = validateDate(normalized, errors);
  const targetName = required(normalized, "target_account", t("field.targetAccount"), errors);
  const targetAccount = accountFor(accounts, targetName);
  if (targetName && !targetAccount) errors.push(t("validation.targetAccountMissing", { name: targetName }));
  if (account?.name && account.name === targetAccount?.name) errors.push(t("validation.sameAccount"));
  const targetCurrency = text(normalized, "target_currency") || targetAccount?.currency || "";
  const isCrossCurrency = Boolean(targetAccount && account && targetAccount.currency !== account.currency);
  if (isCrossCurrency) {
    normalized.target_amount = positiveAmount(text(normalized, "target_amount"), t("field.targetAmount"), errors);
    required(normalized, "target_currency", t("field.targetCurrency"), errors);
    if (targetCurrency && targetAccount && targetCurrency !== targetAccount.currency) errors.push(t("validation.targetCurrencyMismatch"));
  } else if (targetAccount) {
    normalized.target_amount = text(normalized, "target_amount") || amount;
    normalized.target_currency = targetAccount.currency;
  }
}

function validateUnresolvedExpenseFields(normalized: NormalizedImportRow, errors: string[]): void {
  const precision = required(normalized, "time_precision", t("field.timePrecision"), errors);
  if (precision === "day") {
    normalized.date = validateDate(normalized, errors);
    return;
  }
  if (precision !== "month" && precision !== "period") {
    if (precision) errors.push(t("validation.timePrecisionValue"));
    return;
  }
  const start = required(normalized, "period_start", t("field.periodStart"), errors);
  const end = required(normalized, "period_end", t("field.periodEnd"), errors);
  const normalizedStart = normalizeDate(start);
  const normalizedEnd = normalizeDate(end);
  if (start && !normalizedStart) errors.push(t("validation.periodStartFormat"));
  if (end && !normalizedEnd) errors.push(t("validation.periodEndFormat"));
  if (normalizedStart && normalizedEnd && normalizedStart > normalizedEnd) errors.push(t("validation.periodOrder"));
  normalized.period_start = normalizedStart ?? start;
  normalized.period_end = normalizedEnd ?? end;
}

function validateImportFees(normalized: NormalizedImportRow, kind: ManualRecordKind, accounts: ImportAccount[], errors: string[]): void {
  const feeFields = ["fee_account", "fee_amount", "fee_currency", "fee_category"] as const;
  if (!feeFields.some((field) => Boolean(text(normalized, field)))) return;
  if (kind !== "transfer") errors.push(t("validation.feeTransferOnly"));
  const feeAccountName = required(normalized, "fee_account", t("field.feeAccount"), errors);
  const feeAccount = accountFor(accounts, feeAccountName);
  if (feeAccountName && !feeAccount) errors.push(t("validation.feeAccountMissing", { name: feeAccountName }));
  const feeCurrency = text(normalized, "fee_currency") || feeAccount?.currency || "";
  if (!text(normalized, "fee_currency") && feeAccount) normalized.fee_currency = feeAccount.currency;
  const feeAmount = positiveAmount(text(normalized, "fee_amount"), t("field.feeAmount"), errors);
  if (feeAmount) normalized.fee_amount = feeAmount;
  if (feeCurrency && feeAmount) validatePrecision(feeAmount, feeCurrency, errors);
  if (feeAccount && feeCurrency && feeAccount.currency !== feeCurrency) errors.push(t("validation.feeCurrencyMismatch"));
  required(normalized, "fee_category", t("field.feeCategory"), errors);
}
