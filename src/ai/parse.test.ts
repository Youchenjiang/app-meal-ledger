import { describe, expect, test } from "vitest";
import { buildPrefillForm, parseDraftSuggestions } from "./parse";

const accounts = [
  { name: "Daily wallet", currency: "TWD" },
  { name: "Bank", currency: "TWD" },
];
const categories = ["飲食", "午餐", "交通", "租賃", "薪資", "日用"];
const today = "2026-08-08";

describe("parseDraftSuggestions", () => {
  test("parses a valid expense draft and normalizes the date", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "expense", date: "7/25", account: "Daily wallet", category: "午餐", counterparty: "麵店", itemName: "牛肉麵", amount: 480, currency: "TWD" }],
    }, accounts, categories, today);

    expect(suggestion.ok).toBe(true);
    expect(suggestion.issues).toEqual([]);
    expect(suggestion.draft?.kind).toBe("expense");
    expect(suggestion.draft?.date).toBe("2026-07-25");
    expect(suggestion.draft?.amount).toBe("480");
    expect(suggestion.draft?.currency).toBe("TWD");
    expect(suggestion.draft?.category).toBe("午餐");
    expect(suggestion.draft?.counterparty).toBe("麵店");
    expect(suggestion.draft?.itemName).toBe("牛肉麵");
  });

  test("accepts slashed dates and defaults a missing date to today", () => {
    const [withYear] = parseDraftSuggestions({ items: [{ account: "Bank", category: "薪資", amount: 50000, date: "2026/8/1" }] }, accounts, categories, today);
    expect(withYear.draft?.date).toBe("2026-08-01");

    const [noDate] = parseDraftSuggestions({ items: [{ account: "Bank", category: "薪資", amount: 50000 }] }, accounts, categories, today);
    expect(noDate.draft?.date).toBe(today);
  });

  test("parses a same-currency transfer", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "transfer", account: "Bank", transferAccount: "Daily wallet", amount: 1000 }],
    }, accounts, categories, today);

    expect(suggestion.ok).toBe(true);
    expect(suggestion.draft?.kind).toBe("transfer");
    expect(suggestion.draft?.transferAccount).toBe("Daily wallet");
    expect(suggestion.draft?.amount).toBe("1000");
  });

  test("rejects an unknown account with a readable issue", () => {
    const [suggestion] = parseDraftSuggestions({ items: [{ account: "不存在的帳戶", amount: 100 }] }, accounts, categories, today);

    expect(suggestion.ok).toBe(false);
    expect(suggestion.draft).toBeNull();
    expect(suggestion.issues.join(" ")).toContain("不存在的帳戶");
  });

  test("rejects an unknown category", () => {
    const [suggestion] = parseDraftSuggestions({ items: [{ account: "Bank", category: "星巴克", amount: 180 }] }, accounts, categories, today);

    expect(suggestion.ok).toBe(false);
    expect(suggestion.issues.join(" ")).toContain("類別");
  });

  test("rejects an unparseable amount", () => {
    const [suggestion] = parseDraftSuggestions({ items: [{ account: "Bank", amount: "abc" }] }, accounts, categories, today);

    expect(suggestion.ok).toBe(false);
    expect(suggestion.issues.join(" ")).toContain("金額");
  });

  test("rejects unsupported kinds", () => {
    const [suggestion] = parseDraftSuggestions({ items: [{ kind: "refund", account: "Bank", amount: 100 }] }, accounts, categories, today);

    expect(suggestion.ok).toBe(false);
    expect(suggestion.issues.join(" ")).toContain("不支援的類型");
  });

  test("canonicalizes a case-insensitive transfer destination", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "transfer", account: "Bank", transferAccount: "daily wallet", amount: 1000 }],
    }, accounts, categories, today);

    expect(suggestion.ok).toBe(true);
    expect(suggestion.issues).toEqual([]);
    expect(suggestion.draft?.transferAccount).toBe("Daily wallet");
  });

  test("rejects a transfer to the same account even with different casing", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "transfer", account: "Bank", transferAccount: "BANK", amount: 1000 }],
    }, accounts, categories, today);

    expect(suggestion.ok).toBe(false);
    expect(suggestion.issues.join(" ")).toContain("轉帳來源與目標帳戶相同");
  });

  test("accepts a transfer that provides transferAmount without amount", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "transfer", account: "Bank", transferAccount: "Daily wallet", transferAmount: 2000 }],
    }, accounts, categories, today);

    expect(suggestion.ok).toBe(true);
    expect(suggestion.issues).toEqual([]);
    expect(suggestion.draft?.kind).toBe("transfer");
    expect(suggestion.draft?.transferAccount).toBe("Daily wallet");
    expect(suggestion.draft?.amount).toBe("2000");
  });

  test("rejects a transfer with no amount at all", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "transfer", account: "Bank", transferAccount: "Daily wallet" }],
    }, accounts, categories, today);

    expect(suggestion.ok).toBe(false);
    expect(suggestion.issues.join(" ")).toContain("金額");
  });

  test("rejects a transfer whose target account is missing", () => {
    const [suggestion] = parseDraftSuggestions({ items: [{ kind: "transfer", account: "Bank", transferAccount: "消失的帳戶", amount: 100 }] }, accounts, categories, today);

    expect(suggestion.ok).toBe(false);
    expect(suggestion.issues.join(" ")).toContain("目標帳戶");
  });

  test("handles mixed items independently", () => {
    const suggestions = parseDraftSuggestions({
      items: [
        { account: "Bank", category: "日用", amount: 100 },
        { account: "未知帳戶", amount: 200 },
      ],
    }, accounts, categories, today);

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].ok).toBe(true);
    expect(suggestions[1].ok).toBe(false);
  });

  test("carries the explicit field list through to the suggestion", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "expense", date: "7/25", account: "Daily wallet", category: "午餐", itemName: "牛肉麵", amount: 480, currency: "TWD", explicit: ["date", "itemName", "amount"] }],
    }, accounts, categories, today);

    expect(suggestion.ok).toBe(true);
    expect(suggestion.input.explicit).toEqual(["date", "itemName", "amount"]);
  });

  test("ignores non-array payloads", () => {
    expect(parseDraftSuggestions({ foo: 1 }, accounts, categories, today)).toEqual([]);
  });
});

describe("parseDraftSuggestions with an allow-new entity policy", () => {
  const allowNew = { account: "auto", category: "auto" } as const;

  test("carries a new account into the draft with TWD and marks it", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "expense", account: "新錢包", category: "午餐", amount: 480 }],
    }, accounts, categories, today, allowNew);

    expect(suggestion.ok).toBe(true);
    expect(suggestion.issues).toEqual([]);
    expect(suggestion.newAccount).toBe("新錢包");
    expect(suggestion.draft?.account).toBe("新錢包");
    expect(suggestion.draft?.currency).toBe("TWD");
  });

  test("carries a new category into the draft and marks it", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "expense", account: "Bank", category: "咖啡廳", amount: 180 }],
    }, accounts, categories, today, allowNew);

    expect(suggestion.ok).toBe(true);
    expect(suggestion.newCategory).toBe("咖啡廳");
    expect(suggestion.draft?.category).toBe("咖啡廳");
  });

  test("carries a new transfer destination into the draft and marks it", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "transfer", account: "Bank", transferAccount: "新儲蓄戶", amount: 1000 }],
    }, accounts, categories, today, allowNew);

    expect(suggestion.ok).toBe(true);
    expect(suggestion.newTransferAccount).toBe("新儲蓄戶");
    expect(suggestion.draft?.transferAccount).toBe("新儲蓄戶");
  });

  test("still rejects a blank account even when new accounts are allowed", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "expense", category: "午餐", amount: 100 }],
    }, accounts, categories, today, allowNew);

    expect(suggestion.ok).toBe(false);
    expect(suggestion.issues.join(" ")).toContain("帳戶");
  });

  test("still rejects a blank category even when new categories are allowed", () => {
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "expense", account: "Bank", amount: 100 }],
    }, accounts, categories, today, allowNew);

    expect(suggestion.ok).toBe(false);
    expect(suggestion.issues.join(" ")).toContain("類別");
  });

  test("treats the ask policy the same as auto at parse time", () => {
    const askPolicy = { account: "ask", category: "ask" } as const;
    const [suggestion] = parseDraftSuggestions({
      items: [{ kind: "expense", account: "新錢包", category: "午餐", amount: 480 }],
    }, accounts, categories, today, askPolicy);

    expect(suggestion.ok).toBe(true);
    expect(suggestion.newAccount).toBe("新錢包");
  });
});

describe("buildPrefillForm", () => {
  test("fills the fields the model provided and leaves unknown account/category blank", () => {
    const form = buildPrefillForm({
      kind: "expense",
      date: "7/25",
      itemName: "牛肉麵",
      amount: 480,
      counterparty: "麵店",
    }, accounts, categories, today);

    expect(form.kind).toBe("expense");
    expect(form.date).toBe("2026-07-25");
    expect(form.itemName).toBe("牛肉麵");
    expect(form.counterparty).toBe("麵店");
    expect(form.amount).toBe("480");
    expect(form.account).toBe("");
    expect(form.category).toBe("");
  });

  test("uses the matched account currency when the account exists", () => {
    const form = buildPrefillForm({ account: "Bank", amount: 100 }, accounts, categories, today);

    expect(form.account).toBe("Bank");
    expect(form.currency).toBe("TWD");
  });

  test("resolves the transfer destination to a matched account name", () => {
    const form = buildPrefillForm({
      kind: "transfer",
      account: "Bank",
      transferAccount: "Daily wallet",
      amount: 1000,
    }, accounts, categories, today);

    expect(form.kind).toBe("transfer");
    expect(form.account).toBe("Bank");
    expect(form.transferAccount).toBe("Daily wallet");
    expect(form.amount).toBe("1000");
  });

  test("leaves an unknown transfer destination blank for manual selection", () => {
    const form = buildPrefillForm({
      kind: "transfer",
      account: "Bank",
      transferAccount: "消失的帳戶",
      amount: 1000,
    }, accounts, categories, today);

    expect(form.transferAccount).toBe("");
  });
});
