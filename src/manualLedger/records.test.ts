import { describe, expect, test } from "vitest";
import type { TransactionDraft } from "../appShell/drafts";
import type { LocalAccount } from "./accounts";
import { appendIdempotentRecords, convertUnresolvedExpense, createOfficialRecordBundle, updateOfficialRecord, voidOfficialRecord } from "./records";

const accounts: LocalAccount[] = [
  { id: "cash-id", name: "Cash", currency: "TWD" },
  { id: "savings-id", name: "Savings", currency: "TWD" },
];

const expense: TransactionDraft = {
  id: "draft-1",
  date: "2026-07-12",
  account: "Cash",
  kind: "expense",
  category: "Daily",
  counterparty: "Store",
  counterpartyMissing: false,
  itemName: "Tea",
  itemNameMissing: false,
  transferAccount: "",
  transferMode: "same-currency",
  amount: "100",
  currency: "TWD",
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
  note: "",
};

const options = {
  userId: "local-user",
  recordId: "record-1",
  idempotencyKey: "action-1",
  createdAt: "2026-07-12T12:00:00.000Z",
};

describe("local official ledger records", () => {
  test("creates a local-only official record with an audit event", () => {
    const bundle = createOfficialRecordBundle(expense, accounts, options);

    expect(bundle?.records).toHaveLength(1);
    expect(bundle?.records[0]).toMatchObject({
      id: "record-1",
      status: "local-only",
      recordState: "active",
      version: 1,
      accountId: "cash-id",
      amount: "100",
      currency: "TWD",
      idempotencyKey: "action-1",
    });
    expect(bundle?.auditEvents[0]).toMatchObject({
      targetId: "record-1",
      eventType: "record-created",
    });
  });

  test("preserves explicit missing expense fields in the official record", () => {
    const missingExpense: TransactionDraft = {
      ...expense,
      counterparty: "商家不詳",
      counterpartyMissing: true,
      itemName: "品項不詳",
      itemNameMissing: true,
    };

    const bundle = createOfficialRecordBundle(missingExpense, accounts, options);

    expect(bundle?.records[0]).toMatchObject({
      counterparty: "商家不詳",
      counterpartyMissing: true,
      itemName: "品項不詳",
      itemNameMissing: true,
    });
  });

  test("persists recurrence intent with an active lifecycle status", () => {
    const recurringExpense: TransactionDraft = {
      ...expense,
      recurrenceChoice: "auto-record-next-cycle",
    };

    const bundle = createOfficialRecordBundle(recurringExpense, accounts, options);

    expect(bundle?.records[0]).toMatchObject({
      recurrenceChoice: "auto-record-next-cycle",
      recurrenceAmountMode: "fixed",
      recurrenceStatus: "active",
    });
  });

  test("converts an unresolved expense in place and records the audit change", () => {
    const unresolved: TransactionDraft = {
      ...expense,
      kind: "unresolved-expense",
      date: "",
      category: "",
      counterparty: "",
      itemName: "",
      timePrecision: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    };
    const bundle = createOfficialRecordBundle(unresolved, accounts, options);
    if (!bundle) {
      throw new Error("Expected a valid unresolved record.");
    }

    const result = convertUnresolvedExpense(bundle.records[0], {
      localDate: "2026-07-12",
      category: "Daily",
      counterparty: "Store",
      counterpartyMissing: false,
      itemName: "Tea",
      itemNameMissing: false,
    }, accounts, "2026-07-12T13:00:00.000Z");

    expect(result?.record).toMatchObject({ id: "record-1", kind: "expense", localDate: "2026-07-12", version: 2, status: "local-only" });
    expect(result?.auditEvent).toMatchObject({ eventType: "record-updated", targetId: "record-1" });
  });

  test("rejects unresolved conversion without the required details", () => {
    const unresolved: TransactionDraft = {
      ...expense,
      kind: "unresolved-expense",
      date: "",
      category: "",
      counterparty: "",
      itemName: "",
      timePrecision: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    };
    const bundle = createOfficialRecordBundle(unresolved, accounts, options);
    if (!bundle) {
      throw new Error("Expected a valid unresolved record.");
    }

    expect(convertUnresolvedExpense(bundle.records[0], {
      localDate: "2026-07-12",
      category: "",
      counterparty: "Store",
      counterpartyMissing: false,
      itemName: "Tea",
      itemNameMissing: false,
    }, accounts, "2026-07-12T13:00:00.000Z")).toBeNull();
  });

  test("updates editable fields with a new version and audit event", () => {
    const bundle = createOfficialRecordBundle(expense, accounts, options);
    if (!bundle) {
      throw new Error("Expected a valid record bundle.");
    }

    const result = updateOfficialRecord(bundle.records[0], { amount: "120", note: "Corrected" }, "2026-07-12T13:00:00.000Z");

    expect(result.record).toMatchObject({ amount: "120", note: "Corrected", version: 2, idempotencyKey: "record:record-1:v2", recordState: "active", status: "local-only" });
    expect(result.auditEvent).toMatchObject({ eventType: "record-updated", changedFields: ["amount", "note"] });
  });

  test("voids a record without deleting its audit target", () => {
    const bundle = createOfficialRecordBundle(expense, accounts, options);
    if (!bundle) {
      throw new Error("Expected a valid record bundle.");
    }

    const result = voidOfficialRecord(bundle.records[0], "2026-07-12T13:30:00.000Z");

    expect(result.record).toMatchObject({ id: "record-1", recordState: "voided", version: 2, idempotencyKey: "record:record-1:v2", status: "local-only" });
    expect(result.auditEvent).toMatchObject({ eventType: "record-voided", targetId: "record-1" });
  });

  test("creates a linked expense record for a transfer fee", () => {
    const transfer: TransactionDraft = {
      ...expense,
      id: "draft-transfer",
      kind: "transfer",
      category: "",
      counterparty: "",
      itemName: "",
      transferAccount: "Savings",
      feeEnabled: true,
      feeAccount: "Cash",
      feeAmount: "10",
      feeCurrency: "TWD",
      feeCategory: "Fees",
    };

    const bundle = createOfficialRecordBundle(transfer, accounts, options);

    expect(bundle?.records).toHaveLength(2);
    expect(bundle?.records[0].kind).toBe("transfer");
    expect(bundle?.records[1]).toMatchObject({
      kind: "expense",
      accountName: "Cash",
      amount: "10",
      category: "Fees",
      linkedRecordId: "record-1",
    });
  });

  test("preserves refund subtype and linked expense identity", () => {
    const refund: TransactionDraft = {
      ...expense,
      id: "draft-refund",
      kind: "refund",
      category: "Daily",
      counterparty: "Friend",
      itemName: "",
      amount: "50",
      refundReason: "Payback",
      refundSubtype: "payback",
      refundLinkedRecordId: "record-original",
    };

    const bundle = createOfficialRecordBundle(refund, accounts, options);

    expect(bundle?.records[0]).toMatchObject({
      kind: "refund",
      refundSubtype: "payback",
      refundLinkedRecordId: "record-original",
    });
  });

  test("preserves multiple linked expenses for a shared payback", () => {
    const refund: TransactionDraft = {
      ...expense,
      id: "draft-multi-refund",
      kind: "refund",
      category: "Daily",
      counterparty: "Friend",
      itemName: "",
      amount: "80",
      refundReason: "Shared payback",
      refundSubtype: "payback",
      refundLinkedRecordId: "record-original",
      refundLinkedRecordIds: ["record-original", "record-second"],
    };

    const bundle = createOfficialRecordBundle(refund, accounts, options);

    expect(bundle?.records[0]).toMatchObject({
      refundLinkedRecordId: "record-original",
      refundLinkedRecordIds: ["record-original", "record-second"],
    });
  });

  test("rejects a payback without a linked expense", () => {
    const refund: TransactionDraft = {
      ...expense,
      id: "draft-refund",
      kind: "refund",
      category: "Daily",
      counterparty: "Friend",
      itemName: "",
      amount: "50",
      refundReason: "Payback",
      refundSubtype: "payback",
      refundLinkedRecordId: "",
    };

    expect(createOfficialRecordBundle(refund, accounts, options)).toBeNull();
  });

  test("rejects a record whose account or currency does not match", () => {
    expect(createOfficialRecordBundle({ ...expense, account: "Missing" }, accounts, options)).toBeNull();
    expect(createOfficialRecordBundle({ ...expense, currency: "JPY" }, accounts, options)).toBeNull();
  });

  test("does not append a repeated idempotency key", () => {
    const bundle = createOfficialRecordBundle(expense, accounts, options);
    if (!bundle) {
      throw new Error("Expected a valid record bundle.");
    }

    expect(appendIdempotentRecords(bundle.records, bundle)).toHaveLength(1);
    expect(appendIdempotentRecords([], bundle)).toHaveLength(1);
  });
});
