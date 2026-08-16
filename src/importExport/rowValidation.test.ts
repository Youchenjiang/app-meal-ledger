import { describe, expect, test } from "vitest";
import { validateImportRows } from "./rowValidation";

const accounts = [
  { name: "Cash", currency: "TWD" },
  { name: "Japan cash", currency: "JPY" },
];

describe("import row validation", () => {
  test("normalizes dates and accepts a complete expense row", () => {
    const [result] = validateImportRows([
      { kind: "expense", date: "2026/07/13", account: "Cash", amount: "1,000", category: "Daily", merchant: "Store", item_name: "Tea" },
    ], accounts);

    expect(result).toMatchObject({ rowNumber: 2, ok: true });
    expect(result.normalized).toMatchObject({ date: "2026-07-13", amount: "1000", currency: "TWD" });
  });

  test("pads single-digit imported month and day values", () => {
    const [result] = validateImportRows([
      { kind: "expense", date: "2026/7/5", account: "Cash", amount: "10", category: "Daily", merchant: "Store", item_name: "Tea" },
    ], accounts);

    expect(result).toMatchObject({ ok: true, normalized: { date: "2026-07-05" } });
  });

  test("requires kind and kind-specific fields instead of guessing", () => {
    const [result] = validateImportRows([{ date: "2026-07-13", account: "Cash", amount: "70" }], accounts);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("類型為必填,且必須是受支援的明細類型。");
  });

  test("validates same-currency and cross-currency transfer fields", () => {
    const [sameCurrency, crossCurrency] = validateImportRows([
      { kind: "transfer", date: "2026-07-13", account: "Cash", amount: "100", target_account: "Cash" },
      { kind: "transfer", date: "2026-07-13", account: "Cash", amount: "10000", target_account: "Japan cash", target_amount: "45000", target_currency: "JPY" },
    ], accounts);

    expect(sameCurrency.ok).toBe(false);
    expect(sameCurrency.errors).toContain("來源與目標帳戶必須不同。");
    expect(crossCurrency).toMatchObject({ ok: true });
    expect(crossCurrency.normalized).toMatchObject({ target_currency: "JPY", currency: "TWD" });
  });

  test("validates unresolved periods and refund payback links", () => {
    const [unresolved, payback] = validateImportRows([
      { kind: "unresolved-expense", account: "Cash", amount: "500", time_precision: "period", period_start: "2026-08-01", period_end: "2026-07-31" },
      { kind: "refund", date: "2026-07-13", account: "Cash", amount: "50", category: "Daily", merchant: "Store", refund_reason: "Return", refund_subtype: "payback" },
    ], accounts);

    expect(unresolved.errors).toContain("期間開始不得晚於期間結束。");
    expect(payback.errors).toContain("還款需要連結一筆支出。");
  });

  test("rejects invalid currency precision and unknown accounts", () => {
    const [result] = validateImportRows([
      { kind: "income", date: "2026-07-13", account: "Missing", amount: "10.123", currency: "TWD", category: "Salary", source: "Work" },
    ], accounts);

    expect(result.errors).toContain("帳戶「Missing」不存在。");
    expect(result.errors).toContain("TWD 最多支援 0 位小數。");
  });
});
