import { expect, test, type Page } from "@playwright/test";
import {
  addAccount,
  collectBrowserErrors,
  createExpenseRow,
  expectNoClippedText,
  expectReadableWidth,
  measureRows,
  openWorkspace,
  ROW_CONTAINER_SELECTOR,
  ROW_SELECTOR,
  SECTION_SUMMARY_SELECTOR,
  setRowContainerWidth,
  type ExpenseRowFields,
} from "./layout-support";

// The compact ledger row has to survive the widest content a user can actually
// create — not the tidy seed the other specs use. Every value below is a legal
// input, and together they are wider than any fixed column budget: the point of
// these specs is that the row gives way in a defined order (title, then
// merchant, then account · category) instead of turning a field into a stub.
// See docs/testing/visual-regression.md.

const LONG_CJK_ACCOUNT = "緊急預備金與長期投資專用帳戶不可隨意動用";
const LATIN_ACCOUNT = "US Travel Rewards Checking Account 2026";
const JPY_ACCOUNT = "Japan cash";
const LONG_MERCHANT = "這是一個非常非常長的商家名稱用來測試省略號截斷效果是否正常運作";
const LONG_ITEM = "有夠長的品項名稱也應該先被截斷而不是把整列撐爆";

// Values with a bounded length. A date, a status badge, and a currency total
// always fit in a row of any supported width, so an ellipsis on one of them is
// a defect at every width.
const BOUNDED_FIELDS = [".record-date", ".record-status", ".record-amount strong"];
// Values with an unbounded length: these may be ellipsised, but must keep
// enough room to stay recognisable.
const MAY_TRUNCATE = [".record-item", ".record-merchant"];

// The narrowest container the row supports is documented in
// docs/testing/visual-regression.md. A 320px phone (the narrowest viewport the
// app targets) leaves the ledger section roughly this much room.
const SUPPORTED_WIDTHS = [900, 620, 440, 405, 404, 320, 260, 240];
// Below the supported floor the row must still degrade gracefully: bounded
// values stay whole and nothing spills out of the card.
const SUB_FLOOR_WIDTHS = [220, 200];

const MIN_TRUNCATABLE_WIDTH = 40;
// What the account · category line may be reduced to before it stops saying
// anything: about eight CJK characters, or the tail of a long latin name.
const MIN_DETAIL_WIDTH = 56;

const TWD_ROW: ExpenseRowFields = {
  account: LONG_CJK_ACCOUNT,
  category: "日用",
  merchant: LONG_MERCHANT,
  item: LONG_ITEM,
  amount: "1234567",
};
const USD_ROW: ExpenseRowFields = {
  account: LATIN_ACCOUNT,
  category: "日用",
  merchant: LONG_MERCHANT,
  item: LONG_ITEM,
  amount: "98765.43",
};
const JPY_ROW: ExpenseRowFields = {
  account: JPY_ACCOUNT,
  category: "日用",
  merchant: LONG_MERCHANT,
  item: LONG_ITEM,
  amount: "12345678",
};

// Totals the section summary has to show, formatted the way the app formats
// them: one per currency, in the currencies' own precision.
const EXPECTED_TOTALS = ["TWD 1,234,567", "USD 98,765.43", "JPY 12,345,678"];

const ROWS = [TWD_ROW, USD_ROW, JPY_ROW];

async function seedHostileLedger(page: Page): Promise<void> {
  await openWorkspace(page);
  await addAccount(page, LONG_CJK_ACCOUNT, "TWD");
  await addAccount(page, LATIN_ACCOUNT, "USD");
  await addAccount(page, JPY_ACCOUNT, "JPY");
  for (const row of ROWS) {
    // createExpenseRow asserts the row landed, so a silently dropped save fails
    // here rather than leaving this spec to assert against two rows.
    await createExpenseRow(page, row);
  }
  await expect(page.locator(ROW_SELECTOR)).toHaveCount(ROWS.length);
}

test("keeps every bounded value whole when the ledger holds hostile content", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedHostileLedger(page);

  for (const width of SUPPORTED_WIDTHS) {
    await setRowContainerWidth(page, width);
    const label = `container ${width}px with long names and three currencies`;

    await expectNoClippedText(page, ROW_SELECTOR, BOUNDED_FIELDS, label);
    for (const selector of MAY_TRUNCATE) {
      await expectReadableWidth(page, ROW_SELECTOR, selector, MIN_TRUNCATABLE_WIDTH, label);
    }

    const { containerContentWidth, containerOverflow, rows } = await measureRows(page);
    expect(rows, `${label}: every seeded record should be listed`).toHaveLength(ROWS.length);
    expect(containerOverflow, `${label}: the section must not scroll sideways`).toBe(0);

    for (const row of rows) {
      expect(
        row.width,
        `${label}: "${row.text}" is ${row.width}px wide inside a ${containerContentWidth}px card`,
      ).toBeLessThanOrEqual(containerContentWidth + 1);

      if (row.detailClipped) {
        expect(
          row.detailWidth,
          `${label}: "${row.detailText}" is reduced to ${row.detailWidth}px`,
        ).toBeGreaterThanOrEqual(MIN_DETAIL_WIDTH);
      }
    }
  }

  await setRowContainerWidth(page, null);
  expect(errors, `browser errors while rendering hostile content: ${errors.join(" | ")}`).toEqual([]);
});

test("still degrades gracefully below the supported floor", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedHostileLedger(page);

  for (const width of SUB_FLOOR_WIDTHS) {
    await setRowContainerWidth(page, width);
    const label = `container ${width}px, below the supported floor`;

    // A width the row does not claim to support may not cost the user a value
    // it can always show: the date, the status, and the total stay whole, and
    // the row stays inside its card instead of spilling over the page.
    await expectNoClippedText(page, ROW_SELECTOR, BOUNDED_FIELDS, label);

    const { containerContentWidth, containerOverflow, rows } = await measureRows(page);
    expect(containerOverflow, `${label}: the section must not scroll sideways`).toBe(0);
    for (const row of rows) {
      expect(
        row.width,
        `${label}: "${row.text}" is ${row.width}px wide inside a ${containerContentWidth}px card`,
      ).toBeLessThanOrEqual(containerContentWidth + 1);
    }
  }

  await setRowContainerWidth(page, null);
});

test("shows every currency total in the section summary at any supported width", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedHostileLedger(page);

  for (const width of SUPPORTED_WIDTHS) {
    await setRowContainerWidth(page, width);
    const label = `container ${width}px with three currencies`;

    // The summary carries one total per currency. Ellipsising it silently drops
    // whole currencies, so it wraps instead, and no width may clip it.
    await expectNoClippedText(page, ROW_CONTAINER_SELECTOR, [SECTION_SUMMARY_SELECTOR], label);

    const summary = (await page.locator(SECTION_SUMMARY_SELECTOR).first().textContent()) ?? "";
    for (const total of EXPECTED_TOTALS) {
      expect(summary, `${label}: the summary should still show ${total}`).toContain(total);
    }

    // Guards the coupling behind the original defect: a summary that cannot
    // wrap sets the section's min-content width and drags every row out of the
    // card with it, so a summary that fits in isolation is not enough.
    const { containerContentWidth, containerOverflow, rows } = await measureRows(page);
    expect(containerOverflow, `${label}: the summary must not push the card sideways`).toBe(0);
    for (const row of rows) {
      expect(
        row.width,
        `${label}: a row was widened by the summary and now spills out of its card`,
      ).toBeLessThanOrEqual(containerContentWidth + 1);
    }
  }

  await setRowContainerWidth(page, null);
  expect(errors, `browser errors while rendering the summary: ${errors.join(" | ")}`).toEqual([]);
});
