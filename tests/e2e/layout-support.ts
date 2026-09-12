import { expect, type Locator, type Page } from "@playwright/test";

// Shared helpers for the layout specs. The flow helpers mirror the ones the
// other specs keep locally; the layout helpers are new and exist so a clipped
// row fails by name instead of by pixel count alone.

/** Console errors and uncaught page errors collected for the rest of the test. */
export function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  return errors;
}

export async function openWorkspace(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "概覽", exact: true })).toBeVisible();
}

export async function addAccount(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  // The settings page is one scrollable page in the committed layout and a tab
  // strip in the working tree; click the tab only when it is there so this seed
  // step survives either shape.
  const preferencesTab = page.getByRole("tab", { name: "相關設定", exact: true });
  if ((await preferencesTab.count()) > 0) {
    await preferencesTab.click();
  }
  await page.getByLabel("帳戶名稱").fill(name);
  await page.getByRole("button", { name: "新增帳戶" }).click();
  await expect(page.getByLabel("可用帳戶")).toContainText(name);
}

export type ExpenseRowFields = {
  account: string;
  category: string;
  merchant: string;
  item: string;
  amount: string;
};

/** Creates one confirmed expense through the UI and lands on the ledger page. */
export async function createExpenseRow(page: Page, fields: ExpenseRowFields): Promise<void> {
  await page.getByRole("button", { name: "專區" }).click();
  // The capture form has no date field: a new expense is dated today. Callers
  // that need a stable picture mask the date rather than trying to pin it.
  await page.getByLabel("帳戶", { exact: true }).selectOption(fields.account);
  await page.getByLabel("類別", { exact: true }).selectOption(fields.category);
  await page.getByLabel("商家", { exact: true }).fill(fields.merchant);
  await page.getByLabel("品項名稱", { exact: true }).fill(fields.item);
  await page.getByLabel("金額", { exact: true }).fill(fields.amount);
  await page.getByRole("button", { name: "儲存記錄" }).click();
  await page.getByRole("button", { name: "開啟明細" }).click();
  await expect(page.getByRole("heading", { name: "明細", exact: true })).toBeVisible();
}

export const ROW_SELECTOR = ".ledger-record-card";
export const ROW_CONTAINER_SELECTOR = ".ledger-kind-section";

/**
 * Sets the width of the container that holds the ledger rows. The row sizes
 * itself with a container query, so this is what decides its layout: a narrow
 * container inside a wide window is a supported state (that is how the ledger
 * renders in a side panel), and asserting it needs no window resizing.
 *
 * `contentWidth` is the width the container *query* compares against, which is
 * the content box, not the border box — the container has 12px of padding and a
 * 1px border. Setting a border-box width of 405px would leave the query 379px
 * to work with and silently test the stacked layout instead of the tightest
 * one-line one. Pass null to drop the override.
 */
export async function setRowContainerWidth(page: Page, contentWidth: number | null): Promise<void> {
  const measured = await page.evaluate(
    ({ selector, value }) => {
      const container = document.querySelector<HTMLElement>(selector);
      if (!container) {
        throw new Error(`No ${selector} container found on the ledger page.`);
      }
      const styles = getComputedStyle(container);
      if (value === null) {
        container.style.removeProperty("width");
      } else {
        const chrome =
          Number.parseFloat(styles.paddingLeft) +
          Number.parseFloat(styles.paddingRight) +
          Number.parseFloat(styles.borderLeftWidth) +
          Number.parseFloat(styles.borderRightWidth);
        container.style.boxSizing = "border-box";
        container.style.width = `${value + chrome}px`;
      }
      // Report the content box back so the caller's number is verified rather
      // than assumed — this is the width the container query sees.
      const rect = container.getBoundingClientRect();
      return Math.round(
        rect.width -
          Number.parseFloat(styles.paddingLeft) -
          Number.parseFloat(styles.paddingRight) -
          Number.parseFloat(styles.borderLeftWidth) -
          Number.parseFloat(styles.borderRightWidth),
      );
    },
    { selector: ROW_CONTAINER_SELECTOR, value: contentWidth },
  );

  if (contentWidth !== null) {
    expect(
      measured,
      `${ROW_CONTAINER_SELECTOR} content width should be the requested ${contentWidth}px`,
    ).toBe(contentWidth);
  }
}

export type ClippedText = {
  selector: string;
  text: string;
  width: number;
  scrollWidth: number;
};

/** Text that cannot fit the width it was given, i.e. it renders ellipsised. */
export async function clippedTexts(page: Page, scope: string, selector: string): Promise<ClippedText[]> {
  const base: Page | Locator = scope === "page" ? page : page.locator(scope);
  return base.locator(selector).evaluateAll((elements) =>
    elements
      .filter((element) => (element.textContent ?? "").trim().length > 0)
      .map((element) => ({
        selector: typeof element.className === "string" && element.className ? element.className : element.tagName,
        text: (element.textContent ?? "").trim(),
        width: Math.ceil(element.getBoundingClientRect().width),
        scrollWidth: element.scrollWidth,
      }))
      .filter((item) => item.scrollWidth > item.width + 1),
  );
}

/** Fails with the offending text named, so a clipped value is never a mystery. */
export async function expectNoClippedText(
  page: Page,
  scope: string,
  selectors: string[],
  label: string,
): Promise<void> {
  for (const selector of selectors) {
    const clipped = await clippedTexts(page, scope, selector);
    expect(clipped, `${label}: ${selector} renders ellipsised (${JSON.stringify(clipped)})`).toEqual([]);
  }
}

/** Asserts a may-truncate field is still given room, rather than collapsing. */
export async function expectReadableWidth(
  page: Page,
  scope: string,
  selector: string,
  minimum: number,
  label: string,
): Promise<void> {
  const widths = await page
    .locator(`${scope} ${selector}`)
    .evaluateAll((elements) => elements.map((element) => Math.ceil(element.getBoundingClientRect().width)));

  for (const width of widths) {
    expect(width, `${label}: ${selector} collapsed to ${width}px`).toBeGreaterThan(minimum);
  }
}
