import { expect, test, type Page } from "@playwright/test";
import {
  addAccount,
  clippedTexts,
  collectBrowserErrors,
  createExpenseRow,
  expectNoClippedText,
  expectReadableWidth,
  openWorkspace,
  ROW_CONTAINER_SELECTOR,
  ROW_SELECTOR,
  setRowContainerWidth,
  type ExpenseRowFields,
} from "./layout-support";

// Fields the row exists to expose: never ellipsised, at any width.
const MUST_FIT = [".record-date", ".record-detail-line", ".record-status", ".record-amount strong"];
// Fields allowed to truncate (long merchant and item names are normal), but
// they must keep enough room to stay recognisable.
const MAY_TRUNCATE = [".record-item", ".record-merchant"];

// Container widths the row has to survive. 404px is the documented content
// width where the one-line layout switches to the stacked one.
const CONTAINER_WIDTHS = [900, 620, 470, 440, 405, 404, 380, 320, 280];
const SNAPSHOT_WIDTHS = [900, 440, 320];
const ONE_LINE_MIN_CONTAINER = 405;
const COLUMNS_ONE_LINE = 6;
const COLUMNS_STACKED = 4;

const SHORT_ROW: ExpenseRowFields = {
  account: "Daily wallet",
  category: "日用",
  merchant: "全聯",
  item: "香蕉",
  amount: "417",
};

async function openLedgerWithRow(page: Page, fields: ExpenseRowFields): Promise<void> {
  await openWorkspace(page);
  await addAccount(page, fields.account);
  await createExpenseRow(page, fields);
}

test("keeps every field the row exists to show readable at any container width", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  // Deliberately wide: the row must follow its own container, so a wide window
  // with a narrow container (side panel) gets the same treatment as on a phone.
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLedgerWithRow(page, SHORT_ROW);

  for (const width of CONTAINER_WIDTHS) {
    await setRowContainerWidth(page, width);
    const label = `container ${width}px`;

    await expectNoClippedText(page, ROW_SELECTOR, MUST_FIT, label);
    for (const selector of MAY_TRUNCATE) {
      await expectReadableWidth(page, ROW_SELECTOR, selector, 40, label);
    }

    const layout = await page.locator(ROW_SELECTOR).evaluate((row) => {
      const iconTops = Array.from(row.querySelectorAll(".record-actions button")).map((button) =>
        Math.round(button.getBoundingClientRect().top),
      );
      return {
        columns: getComputedStyle(row).gridTemplateColumns.split(" ").length,
        iconRows: new Set(iconTops).size,
        height: Math.round(row.getBoundingClientRect().height),
      };
    });

    expect(layout.iconRows, `${label}: both icon actions must stay on one row`).toBe(1);
    expect(
      layout.columns,
      `${label}: the layout mode follows the container, not the window`,
    ).toBe(width >= ONE_LINE_MIN_CONTAINER ? COLUMNS_ONE_LINE : COLUMNS_STACKED);
    expect(layout.height, `${label}: a row may use at most three text lines`).toBeLessThan(100);
  }

  await setRowContainerWidth(page, null);
  expect(errors).toEqual([]);
});

test("truncates the title and merchant before the account and category", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLedgerWithRow(page, {
    account: "Daily wallet",
    category: "日用",
    merchant: "這是一個非常非常長的商家名稱用來測試省略號截斷效果是否正常運作",
    item: "有夠長的品項名稱也應該先被截斷而不是把整列撐爆",
    amount: "417",
  });

  // Just above the switch point the one-line layout is at its tightest.
  await setRowContainerWidth(page, ONE_LINE_MIN_CONTAINER);
  await expectNoClippedText(page, ROW_SELECTOR, MUST_FIT, `container ${ONE_LINE_MIN_CONTAINER}px with long names`);

  const clipped = await clippedTexts(page, ROW_SELECTOR, ".record-merchant");
  expect(clipped.length, "the long merchant name is expected to be ellipsised first").toBe(1);
  expect(clipped[0].text).toContain("這是一個非常非常長的商家名稱");

  await setRowContainerWidth(page, null);
  expect(errors).toEqual([]);
});

test("matches the recorded row visuals", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLedgerWithRow(page, SHORT_ROW);

  for (const width of SNAPSHOT_WIDTHS) {
    await setRowContainerWidth(page, width);
    const label = `container ${width}px`;

    // A baseline that does not exist yet is recorded rather than compared (see
    // docs/testing/visual-regression.md), so the pixel layer can be a no-op on
    // a fresh platform. Keep a geometry assertion in the same test so it always
    // says something even while the baselines are bootstrapping.
    await expectNoClippedText(page, ROW_SELECTOR, MUST_FIT, label);

    await expect(page.locator(ROW_CONTAINER_SELECTOR)).toHaveScreenshot(`ledger-row-${width}.png`, {
      // The row prints today's date and the capture form cannot set one, so mask
      // it: a stable baseline without pretending the date is under test.
      mask: [page.locator(".record-date")],
    });
  }

  await setRowContainerWidth(page, null);
  expect(errors).toEqual([]);
});
