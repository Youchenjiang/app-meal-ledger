import type { LocalAccount } from "./accounts";
import { canCreateManualDraft, type DraftAccount, type DraftKind, type RecurrenceChoice, type TransactionDraft } from "../appShell/drafts";

export type LocalRecordStatus = "local-only" | "synced";
export type LocalRecordState = "active" | "voided";
export type LocalRecurrenceStatus = "inactive" | "active" | "paused" | "cancelled";

export type LocalLedgerRecord = {
  id: string;
  idempotencyKey: string;
  userId: string;
  kind: DraftKind;
  status: LocalRecordStatus;
  recordState: LocalRecordState;
  version: number;
  localDate: string;
  accountId: string;
  accountName: string;
  amount: string;
  currency: string;
  category: string;
  counterparty: string;
  counterpartyMissing: boolean;
  itemName: string;
  itemNameMissing: boolean;
  transferAccountId: string;
  transferAccountName: string;
  transferMode: TransactionDraft["transferMode"];
  destinationAmount: string;
  destinationCurrency: string;
  feeAccountId: string;
  feeAccountName: string;
  feeAmount: string;
  feeCurrency: string;
  feeCategory: string;
  refundReason: string;
  refundSubtype: TransactionDraft["refundSubtype"];
  refundLinkedRecordId: string;
  refundLinkedRecordIds?: string[];
  refundExcessHandling: TransactionDraft["refundExcessHandling"];
  recurrenceChoice: RecurrenceChoice;
  recurrenceAmountMode: TransactionDraft["recurrenceAmountMode"];
  recurrenceStatus: LocalRecurrenceStatus;
  reason: string;
  timePrecision: TransactionDraft["timePrecision"];
  periodStart: string;
  periodEnd: string;
  note: string;
  tags?: string[];
  event?: string;
  sourceLabel?: string;
  createdAt: string;
  updatedAt: string;
  linkedRecordId?: string;
};

export type LocalAuditEvent = {
  id: string;
  userId: string;
  eventType: "record-created" | "record-updated" | "record-voided";
  targetType: "ledger-record";
  targetId: string;
  summary: string;
  changedFields: string[];
  createdAt: string;
};

export type OfficialRecordBundle = {
  records: LocalLedgerRecord[];
  auditEvents: LocalAuditEvent[];
};

export type OfficialRecordOptions = {
  userId: string;
  recordId: string;
  idempotencyKey: string;
  createdAt: string;
  feeRecordId?: string;
};

export type EditableRecordFields = Pick<
  LocalLedgerRecord,
  | "amount"
  | "category"
  | "counterparty"
  | "itemName"
  | "refundReason"
  | "reason"
  | "note"
  | "recurrenceChoice"
  | "recurrenceAmountMode"
  | "recurrenceStatus"
>;

export type UnresolvedExpenseConversion = Pick<
  LocalLedgerRecord,
  "localDate" | "category" | "counterparty" | "counterpartyMissing" | "itemName" | "itemNameMissing"
>;

function accountByName(accounts: LocalAccount[], name: string): LocalAccount | undefined {
  return accounts.find((account) => account.name === name);
}

function asDraftAccounts(accounts: LocalAccount[]): DraftAccount[] {
  return accounts.map(({ name, currency }) => ({ name, currency }));
}

function auditFor(record: LocalLedgerRecord): LocalAuditEvent {
  return {
    id: `audit-${record.id}`,
    userId: record.userId,
    eventType: "record-created",
    targetType: "ledger-record",
    targetId: record.id,
    summary: `Created ${record.kind} record`,
    changedFields: ["kind", "localDate", "account", "amount", "currency"],
    createdAt: record.createdAt,
  };
}

function createRecord(
  draft: TransactionDraft,
  accounts: LocalAccount[],
  options: OfficialRecordOptions,
  overrides: Partial<LocalLedgerRecord> = {},
): LocalLedgerRecord | null {
  const account = accountByName(accounts, draft.account);

  if (!account) {
    return null;
  }

  const transferAccount = accountByName(accounts, draft.transferAccount);
  const feeAccount = accountByName(accounts, draft.feeAccount);

  return {
    id: options.recordId,
    idempotencyKey: options.idempotencyKey,
    userId: options.userId,
    kind: draft.kind,
    status: "local-only",
    recordState: "active",
    version: 1,
    localDate: draft.date,
    accountId: account.id,
    accountName: account.name,
    amount: draft.amount,
    currency: draft.currency,
    category: draft.category,
    counterparty: draft.counterparty,
    counterpartyMissing: draft.counterpartyMissing,
    itemName: draft.itemName,
    itemNameMissing: draft.itemNameMissing,
    transferAccountId: transferAccount?.id ?? "",
    transferAccountName: transferAccount?.name ?? "",
    transferMode: draft.transferMode,
    destinationAmount: draft.destinationAmount,
    destinationCurrency: draft.destinationCurrency,
    feeAccountId: feeAccount?.id ?? "",
    feeAccountName: feeAccount?.name ?? "",
    feeAmount: draft.feeAmount,
    feeCurrency: draft.feeCurrency,
    feeCategory: draft.feeCategory,
    refundReason: draft.refundReason,
    refundSubtype: draft.refundSubtype,
    refundLinkedRecordId: draft.refundLinkedRecordId,
    refundLinkedRecordIds: draft.refundLinkedRecordIds ?? (draft.refundLinkedRecordId ? [draft.refundLinkedRecordId] : []),
    refundExcessHandling: draft.refundExcessHandling,
    recurrenceChoice: draft.recurrenceChoice,
    recurrenceAmountMode: draft.recurrenceAmountMode,
    recurrenceStatus: draft.recurrenceChoice === "current-cycle-only" ? "inactive" : "active",
    reason: draft.reason,
    timePrecision: draft.timePrecision,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    note: draft.note,
    tags: draft.tags,
    event: draft.event,
    sourceLabel: draft.sourceLabel,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    ...overrides,
  };
}

export function createOfficialRecordBundle(
  draft: TransactionDraft,
  accounts: LocalAccount[],
  options: OfficialRecordOptions,
): OfficialRecordBundle | null {
  const draftAccounts = asDraftAccounts(accounts);
  const sourceAccount = accountByName(accounts, draft.account);

  if (!sourceAccount || !options.idempotencyKey.trim()) {
    return null;
  }

  // Keep domain validation in one place before an official local write.
  // The UI may call this after a native form submit, but the record boundary must remain defensive.
  if (!canCreateManualDraft(draft, draftAccounts)) {
    return null;
  }

  const record = createRecord(draft, accounts, options);
  if (!record) {
    return null;
  }

  const records = [record];
  const auditEvents = [auditFor(record)];

  if (draft.kind === "transfer" && draft.feeEnabled) {
    const feeRecord = createRecord(
      {
        ...draft,
        id: `${draft.id}-fee`,
        kind: "expense",
        category: draft.feeCategory,
        counterparty: "Transfer fee",
        itemName: "Transfer fee",
        account: draft.feeAccount,
        amount: draft.feeAmount,
        currency: draft.feeCurrency,
        transferAccount: "",
        transferMode: "same-currency",
        destinationAmount: "",
        destinationCurrency: "",
        feeEnabled: false,
        feeAccount: "",
        feeAmount: "",
        feeCurrency: "",
        feeCategory: "",
      },
      accounts,
      {
        ...options,
        recordId: options.feeRecordId ?? `${options.recordId}-fee`,
        idempotencyKey: `${options.idempotencyKey}:fee`,
      },
      { linkedRecordId: record.id },
    );

    if (!feeRecord) {
      return null;
    }

    records.push(feeRecord);
    auditEvents.push(auditFor(feeRecord));
  }

  return { records, auditEvents };
}

export function appendIdempotentRecords(
  current: LocalLedgerRecord[],
  next: OfficialRecordBundle,
): LocalLedgerRecord[] {
  if (current.some((record) => next.records.some((candidate) => candidate.idempotencyKey === record.idempotencyKey))) {
    return current;
  }

  return [...current, ...next.records];
}

function auditEvent(
  record: LocalLedgerRecord,
  eventType: LocalAuditEvent["eventType"],
  changedFields: string[],
  createdAt: string,
): LocalAuditEvent {
  return {
    id: `audit-${record.id}-${record.version}`,
    userId: record.userId,
    eventType,
    targetType: "ledger-record",
    targetId: record.id,
    summary: `${eventType === "record-voided" ? "Voided" : "Updated"} ${record.kind} record`,
    changedFields,
    createdAt,
  };
}

function nextRecordActionKey(record: LocalLedgerRecord, version: number): string {
  return `record:${record.id}:v${version}`;
}

export function updateOfficialRecord(
  record: LocalLedgerRecord,
  patch: Partial<EditableRecordFields>,
  updatedAt: string,
): { record: LocalLedgerRecord; auditEvent: LocalAuditEvent } {
  const changedFields = (Object.keys(patch) as Array<keyof EditableRecordFields>).filter(
    (field) => patch[field] !== undefined && patch[field] !== record[field],
  );
  const updatedRecord = {
    ...record,
    ...patch,
    status: "local-only" as const,
    version: record.version + 1,
    idempotencyKey: nextRecordActionKey(record, record.version + 1),
    updatedAt,
  };

  return {
    record: updatedRecord,
    auditEvent: auditEvent(updatedRecord, "record-updated", changedFields, updatedAt),
  };
}

export function convertUnresolvedExpense(
  record: LocalLedgerRecord,
  fields: UnresolvedExpenseConversion,
  accounts: LocalAccount[],
  updatedAt: string,
): { record: LocalLedgerRecord; auditEvent: LocalAuditEvent } | null {
  if (record.kind !== "unresolved-expense" || record.recordState === "voided") {
    return null;
  }

  const draft: TransactionDraft = {
    id: record.id,
    date: fields.localDate.trim(),
    account: record.accountName,
    kind: "expense",
    category: fields.category,
    counterparty: fields.counterparty,
    counterpartyMissing: fields.counterpartyMissing,
    itemName: fields.itemName,
    itemNameMissing: fields.itemNameMissing,
    transferAccount: "",
    transferMode: "same-currency",
    amount: record.amount,
    currency: record.currency,
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
    recurrenceChoice: record.recurrenceChoice,
    recurrenceAmountMode: record.recurrenceAmountMode,
    reason: "",
    timePrecision: "day",
    periodStart: "",
    periodEnd: "",
    note: record.note,
  };

  if (!canCreateManualDraft(draft, asDraftAccounts(accounts))) {
    return null;
  }

  const convertedRecord: LocalLedgerRecord = {
    ...record,
    kind: "expense",
    localDate: draft.date,
    category: draft.category,
    counterparty: draft.counterparty,
    counterpartyMissing: draft.counterpartyMissing,
    itemName: draft.itemName,
    itemNameMissing: draft.itemNameMissing,
    status: "local-only",
    version: record.version + 1,
    idempotencyKey: nextRecordActionKey(record, record.version + 1),
    updatedAt,
  };

  return {
    record: convertedRecord,
    auditEvent: auditEvent(convertedRecord, "record-updated", ["kind", "localDate", "category", "counterparty", "itemName"], updatedAt),
  };
}

export function voidOfficialRecord(
  record: LocalLedgerRecord,
  updatedAt: string,
): { record: LocalLedgerRecord; auditEvent: LocalAuditEvent } {
  const voidedRecord = {
    ...record,
    recordState: "voided" as const,
    status: "local-only" as const,
    version: record.version + 1,
    idempotencyKey: nextRecordActionKey(record, record.version + 1),
    updatedAt,
  };

  return {
    record: voidedRecord,
    auditEvent: auditEvent(voidedRecord, "record-voided", ["recordState"], updatedAt),
  };
}
