import { describe, expect, test } from "vitest";
import { canCreateManualDraft, createTransactionDraft, monthToPeriodRange, type DraftForm } from "./drafts";

const completeExpense: DraftForm = {
  date: "2026-07-11",
  account: "Daily wallet",
  kind: "expense",
  category: "Daily",
  counterparty: "7-Eleven",
  counterpartyMissing: false,
  itemName: "Tea egg",
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

const accounts = [
  { name: "Daily wallet", currency: "TWD" },
  { name: "Savings", currency: "TWD" },
  { name: "Japan cash", currency: "JPY" },
  { name: "USD wallet", currency: "USD" },
];

const canCreate = (form: DraftForm) => canCreateManualDraft(form, accounts);
const createDraft = (form: DraftForm, id: string) => createTransactionDraft(form, id, accounts);

describe("manual transaction drafts", () => {
  test.each(["account", "category", "counterparty", "itemName", "amount"] as const)("rejects blank expense %s after trimming", (field) => {
    expect(canCreate({ ...completeExpense, [field]: "   " })).toBe(false);
  });

  test("accepts fixed missing-value labels but rejects arbitrary replacements", () => {
    const missingExpense = {
      ...completeExpense,
      counterparty: "商家不詳",
      counterpartyMissing: true,
      itemName: "品項不詳",
      itemNameMissing: true,
    };

    expect(canCreate(missingExpense)).toBe(true);
    expect(canCreate({ ...missingExpense, counterparty: "Unknown merchant" })).toBe(false);
    expect(canCreate({ ...missingExpense, itemName: "Unknown item" })).toBe(false);
  });

  test("allows auto-record only for complete fixed-amount records", () => {
    expect(canCreate({ ...completeExpense, recurrenceChoice: "auto-record-next-cycle" })).toBe(true);
    expect(canCreate({ ...completeExpense, kind: "income", recurrenceChoice: "auto-record-next-cycle" })).toBe(true);
    expect(
      canCreate({
        ...completeExpense,
        kind: "transfer",
        category: "",
        counterparty: "",
        itemName: "",
        transferAccount: "Savings",
        recurrenceChoice: "auto-record-next-cycle",
      }),
    ).toBe(true);
    expect(canCreate({ ...completeExpense, recurrenceChoice: "auto-record-next-cycle", recurrenceAmountMode: "variable" })).toBe(false);
    expect(canCreate({ ...completeExpense, recurrenceChoice: "auto-record-next-cycle", amount: "" })).toBe(false);
    expect(canCreate({ ...completeExpense, recurrenceChoice: "prompt-next-cycle", recurrenceAmountMode: "variable" })).toBe(true);
  });

  test("uses transfer-specific requirements without merchant or category", () => {
    const transfer: DraftForm = {
      ...completeExpense,
      kind: "transfer",
      category: "",
      counterparty: "",
      itemName: "",
      transferAccount: "Savings",
    };

    expect(canCreate(transfer)).toBe(true);
    expect(canCreate({ ...transfer, transferAccount: "" })).toBe(false);
    expect(canCreate({ ...transfer, transferAccount: "Daily wallet" })).toBe(false);
    expect(canCreate({ ...transfer, currency: "JPY" })).toBe(false);
  });

  test("requires both amounts and currencies for cross-currency transfers", () => {
    const transfer: DraftForm = {
      ...completeExpense,
      kind: "transfer",
      category: "",
      counterparty: "",
      itemName: "",
      transferAccount: "Japan cash",
      transferMode: "cross-currency",
      destinationAmount: "46000",
      destinationCurrency: "JPY",
    };

    expect(canCreate(transfer)).toBe(true);
    expect(canCreate({ ...transfer, destinationAmount: "" })).toBe(false);
    expect(canCreate({ ...transfer, destinationCurrency: "TWD" })).toBe(false);
  });

  test("requires complete fee fields when a transfer fee is enabled", () => {
    const transfer: DraftForm = {
      ...completeExpense,
      kind: "transfer",
      category: "",
      counterparty: "",
      itemName: "",
      transferAccount: "Savings",
      feeEnabled: true,
      feeAccount: "Daily wallet",
      feeAmount: "15",
      feeCurrency: "TWD",
      feeCategory: "Fees",
    };

    expect(canCreate(transfer)).toBe(true);
    expect(canCreate({ ...transfer, feeCategory: "" })).toBe(false);
    expect(canCreate({ ...transfer, feeCurrency: "JPY" })).toBe(false);
  });

  test("uses distinct fields for income, refunds, funding, adjustments, and unresolved expenses", () => {
    expect(canCreate({ ...completeExpense, kind: "income", itemName: "" })).toBe(true);
    expect(canCreate({ ...completeExpense, kind: "refund", itemName: "", refundReason: "Returned item" })).toBe(true);
    expect(canCreate({ ...completeExpense, kind: "fund-addition", category: "", itemName: "" })).toBe(true);
    expect(canCreate({ ...completeExpense, kind: "adjustment", category: "", counterparty: "", itemName: "", reason: "Balance correction" })).toBe(true);
    expect(
      canCreate({
        ...completeExpense,
        kind: "unresolved-expense",
        date: "",
        category: "",
        counterparty: "",
        itemName: "",
        timePrecision: "month",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    ).toBe(true);
    expect(
      canCreate({
        ...completeExpense,
        kind: "unresolved-expense",
        date: "",
        category: "",
        counterparty: "",
        itemName: "",
        timePrecision: "period",
        periodStart: "2026-07-01",
        periodEnd: "",
      }),
    ).toBe(false);
  });

  test("rejects an unresolved period that ends before it starts", () => {
    expect(
      canCreate({
        ...completeExpense,
        kind: "unresolved-expense",
        date: "",
        category: "",
        counterparty: "",
        itemName: "",
        timePrecision: "period",
        periodStart: "2026-07-31",
        periodEnd: "2026-07-01",
      }),
    ).toBe(false);
  });

  test("normalizes a calendar month into explicit inclusive period boundaries", () => {
    expect(monthToPeriodRange("2026-07")).toEqual({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
    expect(monthToPeriodRange("2024-02")).toEqual({ periodStart: "2024-02-01", periodEnd: "2024-02-29" });
    expect(monthToPeriodRange("2026-13")).toBeNull();
  });

  test("rejects zero, negative, and non-numeric amounts outside adjustments", () => {
    expect(canCreate({ ...completeExpense, amount: "0" })).toBe(false);
    expect(canCreate({ ...completeExpense, amount: "-10" })).toBe(false);
    expect(canCreate({ ...completeExpense, amount: "not-a-number" })).toBe(false);
    expect(canCreate({ ...completeExpense, kind: "adjustment", category: "", counterparty: "", itemName: "", amount: "-10", reason: "Cash count" })).toBe(true);
    expect(canCreate({ ...completeExpense, kind: "adjustment", category: "", counterparty: "", itemName: "", amount: "0", reason: "Cash count" })).toBe(false);
  });

  test("rejects fractional amounts for zero-decimal currencies", () => {
    expect(canCreate({ ...completeExpense, amount: "0.5" })).toBe(false);
    expect(canCreate({ ...completeExpense, account: "USD wallet", currency: "USD", amount: "0.001" })).toBe(false);
  });

  test("requires every record currency to match its selected account", () => {
    expect(canCreate({ ...completeExpense, currency: "JPY" })).toBe(false);
    expect(
      canCreate({
        ...completeExpense,
        kind: "transfer",
        category: "",
        counterparty: "",
        itemName: "",
        transferMode: "cross-currency",
        transferAccount: "Japan cash",
        destinationAmount: "46000",
        destinationCurrency: "TWD",
      }),
    ).toBe(false);
  });

  test("trims fields before a draft is created", () => {
    expect(
      createDraft(
        {
          ...completeExpense,
          account: " Daily wallet ",
          category: " Daily ",
          counterparty: " 全聯 ",
          itemName: " 茶葉蛋 ",
          amount: " 417 ",
          reason: " dinner ",
        },
        "draft-1",
      ),
    ).toMatchObject({
      id: "draft-1",
      account: "Daily wallet",
      category: "Daily",
      counterparty: "全聯",
      itemName: "茶葉蛋",
      amount: "417",
      reason: "dinner",
    });
  });

  test("creates only a local draft shape, never a confirmed ledger record", () => {
    const draft = createDraft(completeExpense, "draft-1");

    expect(draft).toMatchObject({ id: "draft-1", counterparty: "7-Eleven" });
    expect(draft).not.toHaveProperty("status");
    expect(draft).not.toHaveProperty("recordId");
  });
});
