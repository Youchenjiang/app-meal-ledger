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

/**
 * Adds an account on the settings page. `currency` is optional so callers that
 * only need one TWD account stay one line long; the currency select is matched
 * through its wrapping label because a wrapping label's text includes its own
 * option text, which makes getByLabel ambiguous.
 */
export async function addAccount(page: Page, name: string, currency?: string): Promise<void> {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  // The settings page is one scrollable page in the committed layout and a tab
  // strip in the working tree; click the tab only when it is there so this seed
  // step survives either shape.
  const preferencesTab = page.getByRole("tab", { name: "相關設定", exact: true });
  if ((await preferencesTab.count()) > 0) {
    await preferencesTab.click();
  }
  // Once an account exists the form sits behind a toggle button that carries
  // the same accessible name as the form's submit button, so open it only when
  // the field is missing and submit with the last match.
  const nameInput = page.getByLabel("帳戶名稱");
  if ((await nameInput.count()) === 0) {
    await page.getByRole("button", { name: "新增帳戶" }).first().click();
  }
  await nameInput.fill(name);
  if (currency) {
    await page.locator('label:has(span:text-is("幣別")) select').selectOption(currency);
  }
  await page.getByRole("button", { name: "新增帳戶" }).last().click();
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
  const rowsBefore = await page.locator(ROW_SELECTOR).count();
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
  // The save is a no-op when a native constraint fails (the amount field used
  // to reject every decimal amount with a step error the app never saw), and
  // that failure shows no message on this page — so assert the row landed
  // instead of letting a silently dropped record make the caller vacuous.
  await expect(
    page.locator(ROW_SELECTOR),
    "saving a complete record should add a confirmed ledger row",
  ).toHaveCount(rowsBefore + 1);
}

export const ROW_SELECTOR = ".ledger-record-card";
export const ROW_CONTAINER_SELECTOR = ".ledger-kind-section";
export const SECTION_SUMMARY_SELECTOR = ".ledger-section-heading > span";

export type RowMeasurement = {
  /** Whole row text, so a failure can name the record that misbehaved. */
  text: string;
  /** Border-box width of the row. */
  width: number;
  /** Width of the account \u00b7 category line. */
  detailWidth: number;
  detailText: string;
  /** True when that line is ellipsised rather than fully rendered. */
  detailClipped: boolean;
  columns: number;
};

/**
 * Measures the rows against the container they live in. Both questions here are
 * about the relationship, not about absolute pixels: rows must not spill out of
 * their card, and the account \u00b7 category line must not be squeezed below the
 * width at which it stops saying anything.
 *
 * `containerOverflow` matters because a row wider than its card does not clip
 * the row: it spills, which the container's own scrollWidth reports.
 */
export async function measureRows(
  page: Page,
): Promise<{ containerContentWidth: number; containerOverflow: number; rows: RowMeasurement[] }> {
  return page.evaluate(
    ({ rowSel, containerSel }) => {
      const container = document.querySelector<HTMLElement>(containerSel);
      if (!container) throw new Error(`No ${containerSel} container found on the ledger page.`);
      const styles = getComputedStyle(container);
      const chrome =
        Number.parseFloat(styles.paddingLeft) +
        Number.parseFloat(styles.paddingRight) +
        Number.parseFloat(styles.borderLeftWidth) +
        Number.parseFloat(styles.borderRightWidth);
      return {
        containerContentWidth: Math.round(container.getBoundingClientRect().width - chrome),
        containerOverflow: Math.max(0, container.scrollWidth - container.clientWidth),
        rows: Array.from(document.querySelectorAll<HTMLElement>(`${containerSel} ${rowSel}`)).map((row) => {
          const detail = row.querySelector<HTMLElement>(".record-detail-line");
          const detailWidth = detail ? Math.round(detail.getBoundingClientRect().width) : 0;
          return {
            text: (row.textContent ?? "").trim(),
            width: Math.round(row.getBoundingClientRect().width),
            detailWidth,
            detailText: (detail?.textContent ?? "").trim(),
            detailClipped: detail ? detail.scrollWidth > detailWidth + 1 : false,
            columns: getComputedStyle(row).gridTemplateColumns.split(" ").length,
          };
        }),
      };
    },
    { rowSel: ROW_SELECTOR, containerSel: ROW_CONTAINER_SELECTOR },
  );
}


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
