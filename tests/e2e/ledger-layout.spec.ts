import { expect, test, type Page } from "@playwright/test";
import {
  addAccount,
  clippedTexts,
  collectBrowserErrors,
  createExpenseRow,
  expectNoClippedText,
  expectReadableWidth,
  fontSizeOf,
  openWorkspace,
  ROW_CONTAINER_SELECTOR,
  ROW_SELECTOR,
  rowTextProminence,
  setRowContainerWidth,
  type ExpenseRowFields,
} from "./layout-support";

// Fields the row exists to expose: never ellipsised, at any width.
const MUST_FIT = [".record-date", ".record-detail-line", ".record-status", ".record-amount strong"];
// Fields allowed to truncate (long merchant and item names are normal), but
// they must keep enough room to stay recognisable.
const MAY_TRUNCATE = [".record-item", ".record-merchant"];

// The row's type scale, from the plan's §5.2 floor: the item and the amount are
// body text and the rest is auxiliary. This is the contract the layout tiers are
// derived from, so it is asserted directly rather than assumed by the tiers.
const BODY_TEXT_FIELDS = [".record-item", ".record-amount strong"];
const AUXILIARY_FIELDS = [
  ".record-date",
  ".record-merchant",
  ".record-detail-line",
  ".record-status",
];
const BODY_TEXT_FLOOR = 16;
const AUXILIARY_FLOOR = 14;

// How much room a shortened field must keep, counted in characters at its own
// size so the floor tracks the type scale instead of quietly meaning less.
// Three characters of an item name, five of the account · category line.
const MIN_ITEM_CHARS = 3;
const MIN_DETAIL_CHARS = 5;

// Container widths the row has to survive, with both tier boundaries and the
// width just under each one.
const CONTAINER_WIDTHS = [900, 620, 470, 450, 449, 440, 420, 380, 320, 300, 299, 280];
// One snapshot per layout tier. 262px is what a 320px phone actually leaves the
// ledger section, so the narrowest tier is pinned at the narrowest screen the
// plan supports rather than at a round number nothing renders at.
const SNAPSHOT_WIDTHS = [900, 380, 262];
const ONE_LINE_MIN_CONTAINER = 450;
const TWO_LINE_MIN_CONTAINER = 300;
const COLUMNS_ONE_LINE = 6;
const COLUMNS_TWO_LINE = 4;
const COLUMNS_THREE_LINE = 3;

/** Tracks the row's grid should have at a container width, from its tiers. */
function expectedTracks(width: number): number {
  if (width >= ONE_LINE_MIN_CONTAINER) return COLUMNS_ONE_LINE;
  return width >= TWO_LINE_MIN_CONTAINER ? COLUMNS_TWO_LINE : COLUMNS_THREE_LINE;
}

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
    ).toBe(expectedTracks(width));
    // Four text lines at the narrowest tier: the amount takes one of its own
    // instead of squeezing the name and the account line into stubs.
    expect(layout.height, `${label}: a row may use at most four text lines`).toBeLessThan(100);
  }

  await setRowContainerWidth(page, null);
  expect(errors).toEqual([]);
});

test("keeps the row's text on the documented type floor", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLedgerWithRow(page, SHORT_ROW);

  for (const selector of BODY_TEXT_FIELDS) {
    const size = await fontSizeOf(page, ROW_SELECTOR, selector);
    expect(size, `${selector} is body text and must not fall under ${BODY_TEXT_FLOOR}px`).toBeGreaterThanOrEqual(
      BODY_TEXT_FLOOR,
    );
  }
  for (const selector of AUXILIARY_FIELDS) {
    const size = await fontSizeOf(page, ROW_SELECTOR, selector);
    expect(
      size,
      `${selector} is auxiliary and must not fall under ${AUXILIARY_FLOOR}px — the row is not allowed to buy width with unreadable type`,
    ).toBeGreaterThanOrEqual(AUXILIARY_FLOOR);
  }

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

// What the row is *for* outranks what it merely reports. The item is the row's
// reason to exist, the amount is the number it carries, and the date, merchant,
// and account \u00b7 category are the context around both. The row shipped this
// inverted: the title inherited the muted colour while the amount kept the
// brightest text on the page, so a reader's eye landed on the figure first.
const PRIMARY_FIELD = ".record-item";
const AMOUNT_FIELD = ".record-amount strong";
const SECONDARY_FIELDS = [".record-merchant", ".record-detail-line", ".record-date"];

// The app defaults to the dark theme and offers a light one, so the ordering has
// to hold for a palette pair that resolves in opposite directions.
const THEMES = ["dark", "light"] as const;

test("makes the item the loudest value in the row, above the amount it reports", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLedgerWithRow(page, SHORT_ROW);

  for (const theme of THEMES) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);

    const measured = await rowTextProminence(page, [
      PRIMARY_FIELD,
      AMOUNT_FIELD,
      ...SECONDARY_FIELDS,
    ]);
    const fields = new Map(measured.map((entry) => [entry.selector, entry]));
    const item = fields.get(PRIMARY_FIELD)!;
    const amount = fields.get(AMOUNT_FIELD)!;
    const describe = (entry: { contrast: number; color: string }) => `${entry.contrast}:1 ${entry.color}`;

    expect(item.text, `${theme}: the measured element is the item title`).toBe(SHORT_ROW.item);

    for (const selector of SECONDARY_FIELDS) {
      const secondary = fields.get(selector)!;
      expect(
        item.contrast,
        `${theme}: the item (${describe(item)}) must outrank ${selector} (${describe(secondary)})`,
      ).toBeGreaterThan(secondary.contrast);
    }

    expect(
      item.contrast,
      `${theme}: the item (${describe(item)}) must outrank the amount (${describe(amount)})`,
    ).toBeGreaterThan(amount.contrast);
    expect(
      item.fontWeight,
      `${theme}: the item must not be lighter than the amount it belongs to`,
    ).toBeGreaterThanOrEqual(amount.fontWeight);

    // Demoted is not the same as dimmed away: the amount is still a number the
    // user came to read, so it keeps body-text contrast.
    expect(
      amount.contrast,
      `${theme}: the amount (${describe(amount)}) must stay readable, not fade into the meta tier`,
    ).toBeGreaterThanOrEqual(4.5);
  }

  // Leave the page on the theme it loads with, so a failure in a later test in
  // this file is not explained by state this one left behind.
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
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
