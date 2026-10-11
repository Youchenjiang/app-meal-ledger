import { expect, test, type Page } from "@playwright/test";
import { addAccount, collectBrowserErrors, createExpenseRow, openWorkspace } from "./layout-support";

// The overview used to render each account twice — once as a balance summary
// card and again in the per-account report — so the same name and the same
// balance appeared twice on one screen, and the 期初 column came and went
// depending on whether a figure happened to be non-zero. These specs pin the
// merged shape: one block per account, the same four figures in the same order
// for every account, and each figure printed once.

type Metric = {
  label: string;
  labelWidth: number;
  value: string;
  valueLeft: number;
  valueRight: number;
  valueWidth: number;
};

type Row = {
  name: string;
  identityTop: number;
  metricsTop: number;
  metricLefts: number[];
  metrics: Metric[];
};

type Measurement = {
  headVisible: boolean;
  headLabels: string[];
  headTops: number[];
  /** Right edge of each column name, which is what its figures line up under. */
  headRights: number[];
  rows: Row[];
  /** How many times each account name is printed inside the overview. */
  namePrints: number[];
  /** How many value cells the overview gives each figure. */
  labelPrints: number[];
  overflow: number;
};

async function measureOverview(page: Page): Promise<Measurement> {
  return page.evaluate(() => {
    const rounded = (value: number) => Math.round(value);
    const head = document.querySelector<HTMLElement>(".account-overview-head");
    const headLabels = head
      ? Array.from(head.querySelectorAll("span")).map((span) => (span.textContent ?? "").trim())
      : [];
    const headTops = head
      ? Array.from(head.querySelectorAll("span")).map((span) => rounded(span.getBoundingClientRect().top))
      : [];
    const headRights = head
      ? Array.from(head.querySelectorAll("span")).map((span) => rounded(span.getBoundingClientRect().right))
      : [];

    const rows: Row[] = Array.from(
      document.querySelectorAll<HTMLElement>(".account-overview-row"),
    ).map((row) => {
      const identity = row.querySelector<HTMLElement>(".account-overview-identity");
      const metrics = row.querySelector<HTMLElement>(".account-overview-metrics");
      const cells = Array.from(row.querySelectorAll<HTMLElement>(".account-overview-metrics div"));
      return {
        name: (row.querySelector(".account-overview-identity strong")?.textContent ?? "").trim(),
        identityTop: identity ? rounded(identity.getBoundingClientRect().top) : 0,
        metricsTop: metrics ? rounded(metrics.getBoundingClientRect().top) : 0,
        metricLefts: [...new Set(cells.map((cell) => rounded(cell.getBoundingClientRect().left)))].sort(
          (a, b) => a - b,
        ),
        metrics: cells.map((cell) => {
          const dt = cell.querySelector<HTMLElement>("dt");
          const dd = cell.querySelector<HTMLElement>("dd");
          const rect = dd?.getBoundingClientRect();
          return {
            label: (dt?.textContent ?? "").trim(),
            labelWidth: dt ? rounded(dt.getBoundingClientRect().width) : 0,
            value: (dd?.textContent ?? "").trim(),
            valueLeft: rect ? rounded(rect.left) : 0,
            valueRight: rect ? rounded(rect.right) : 0,
            valueWidth: rect ? rounded(rect.width) : 0,
          };
        }),
      };
    });

    // The defect was two stacked surfaces describing the same account, so the
    // account name was printed twice. Counting prints of the name is what
    // distinguishes one merged surface from a summary card plus a report; a
    // repeated *figure* would not, because two different measures legitimately
    // hold the same value (an account with no income has balance = cash flow).
    const leafTexts = Array.from(
      document.querySelectorAll<HTMLElement>(".overview-page *"),
    ).filter((element) =>
      Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0,
      ),
    );
    const printsOf = (needle: string) =>
      leafTexts.filter((element) => (element.textContent ?? "").includes(needle)).length;

    const workspace = document.querySelector<HTMLElement>(".workspace") ?? document.body;
    return {
      headVisible: head ? getComputedStyle(head).display !== "none" : false,
      headLabels,
      headTops,
      headRights,
      rows,
      namePrints: rows.map((row) => printsOf(row.name)),
      labelPrints: ["餘額", "期初餘額", "淨支出", "現金流"].map(
        (label) =>
          Array.from(document.querySelectorAll(".overview-page dt")).filter(
            (element) => (element.textContent ?? "").trim() === label,
          ).length,
      ),
      overflow: Math.max(0, workspace.scrollWidth - workspace.clientWidth),
    };
  });
}

async function seedTwoAccounts(page: Page): Promise<void> {
  await openWorkspace(page);
  await addAccount(page, "Daily wallet");
  await addAccount(page, "新儲蓄戶");
  await createExpenseRow(page, {
    account: "Daily wallet",
    category: "日用",
    merchant: "全聯",
    item: "香蕉",
    amount: "417",
  });
  await page.getByRole("button", { name: "概覽", exact: true }).click();
  await expect(page.getByRole("heading", { name: "概覽", exact: true })).toBeVisible();
}

test.describe("overview account summary", () => {
  test("desktop compares accounts down four fixed columns", async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedTwoAccounts(page);

    const measurement = await measureOverview(page);

    // One block per account, and the column names come from the header row
    // rather than being reprinted next to every figure.
    expect(measurement.headVisible).toBe(true);
    expect(measurement.headLabels).toEqual(["帳戶／幣別", "餘額", "期初餘額", "淨支出", "現金流"]);
    expect(new Set(measurement.headTops).size, "the column names sit on one line").toBe(1);
    expect(measurement.rows).toHaveLength(2);
    for (const row of measurement.rows) {
      expect(row.metrics.map((metric) => metric.label)).toEqual([
        "餘額",
        "期初餘額",
        "淨支出",
        "現金流",
      ]);
      for (const metric of row.metrics) {
        expect(metric.labelWidth, `${row.name} ${metric.label} is read from the header`).toBeLessThan(2);
      }
      // Each figure ends under the column name it belongs to, and the four
      // figure columns are the same width, so a value can be tracked straight
      // down the page and compared with the account below it.
      expect(
        row.metrics.map((metric) => metric.valueRight),
        `${row.name}: figures line up under 餘額/期初餘額/淨支出/現金流`,
      ).toEqual(measurement.headRights.slice(1));
      expect(
        new Set(row.metrics.map((metric) => metric.valueWidth)).size,
        `${row.name}: the four figure columns share one width`,
      ).toBe(1);
    }

    // Each account is described by exactly one surface, and each figure label
    // belongs to exactly one cell per account. Two prints of a name, or more
    // labels than accounts, is the duplicated summary coming back.
    expect(measurement.namePrints, "each account name is printed once").toEqual([1, 1]);
    for (const prints of measurement.labelPrints) {
      expect(prints, "one cell per account per figure").toBe(2);
    }
    expect(measurement.overflow, "the account list stays inside the workspace").toBe(0);
    expect(errors).toEqual([]);
  });

  test("narrow widths stack each account into a two-column figure grid", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await seedTwoAccounts(page);

    const measurement = await measureOverview(page);

    expect(measurement.headVisible, "the header row is replaced by per-figure labels").toBe(false);
    expect(measurement.rows).toHaveLength(2);
    for (const row of measurement.rows) {
      expect(row.metrics.map((metric) => metric.label)).toEqual([
        "餘額",
        "期初餘額",
        "淨支出",
        "現金流",
      ]);
      for (const metric of row.metrics) {
        expect(metric.labelWidth, `${row.name} ${metric.label} is visible here`).toBeGreaterThan(1);
      }
      expect(row.metricsTop, `${row.name}: the name comes first`).toBeGreaterThan(row.identityTop);
      // Four figures in two fixed columns, whatever the figures happen to be.
      expect(row.metricLefts, `${row.name}: four figures in two columns`).toHaveLength(2);
    }
    expect(measurement.namePrints, "each account name is printed once").toEqual([1, 1]);
    expect(measurement.overflow, "no horizontal scroll on a narrow screen").toBe(0);
  });

  test("an account with no records still shows all four figures as zero", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page);
    await addAccount(page, "空的帳戶");
    await page.getByRole("button", { name: "概覽", exact: true }).click();

    const measurement = await measureOverview(page);

    expect(measurement.rows).toHaveLength(1);
    const metrics = measurement.rows[0].metrics;
    expect(metrics.map((metric) => metric.label)).toEqual(["餘額", "期初餘額", "淨支出", "現金流"]);
    for (const metric of metrics) {
      // Zero is a value, not a missing column: it still prints and stays aligned.
      expect(metric.value, `${metric.label} should read zero`).toBe("TWD 0");
    }
  });
});
