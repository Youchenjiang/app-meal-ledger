import { describe, expect, test } from "vitest";
import { csvImportLimits, validateCsvBytes, validateCsvText } from "./csv";

describe("CSV import validation", () => {
  test("accepts UTF-8 with BOM, quoted values, and normalized headers", () => {
    const result = validateCsvText("\ufeffdate,account,amount,merchant\r\n2026/07/13,Cash,417,\"Store, North\"\r\n");

    expect(result).toMatchObject({ ok: true, headers: ["date", "account", "amount", "merchant"], rowCount: 1 });
    expect(result.rows[0]).toEqual(["2026/07/13", "Cash", "417", "Store, North"]);
  });

  test("accepts legacy Traditional Chinese headers", () => {
    const result = validateCsvText("日期,帳戶,金額,店家\n2026/07/13,小狗錢包,70,全聯\n");

    expect(result.ok).toBe(true);
    expect(result.headers).toEqual(["日期", "帳戶", "金額", "店家"]);
  });

  test("rejects invalid UTF-8, malformed rows, and unsupported headers", () => {
    expect(validateCsvBytes(new Uint8Array([0xff, 0xfe])).errors).toContain("CSV 檔案必須是有效的 UTF-8。");
    expect(validateCsvText("unknown,other\nvalue\n").errors).toContain("CSV 標題未包含受支援的明細欄位。");
    expect(validateCsvText("date,amount\n2026-07-13,417,extra\n").errors).toContain("第 2 列有 3 個欄位;預期 2 個。");
  });

  test("rejects files above the row limit before processing", () => {
    const csv = `date,amount\n${Array.from({ length: csvImportLimits.maxRows + 1 }, (_, index) => `2026-07-13,${index}`).join("\n")}`;
    const result = validateCsvText(csv);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`CSV 檔案超過 ${csvImportLimits.maxRows} 列資料上限。`);
    expect(result.rowCount).toBe(csvImportLimits.maxRows + 1);
  });
});
