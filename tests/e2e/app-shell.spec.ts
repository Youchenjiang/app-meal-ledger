import { expect, test, type Page } from "@playwright/test";

function collectBrowserErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  return errors;
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "概覽", exact: true })).toBeVisible();
}

async function addAccount(page: Page, name: string) {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("tab", { name: "相關設定", exact: true }).click();
  await page.getByLabel("帳戶名稱").fill(name);
  await page.getByRole("button", { name: "新增帳戶" }).click();
  await expect(page.getByLabel("可用帳戶")).toContainText(name);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBe(true);
}

async function expectHorizontallyWithinViewport(page: Page, selector: string) {
  const viewport = page.viewportSize();
  const boxes = await page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }),
  );

  if (!viewport) {
    throw new Error("Playwright viewport size is unavailable.");
  }

  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(viewport.width);
  }
}

test("creates a local official record and shows it in Ledger", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await openWorkspace(page);
  await addAccount(page, "Daily wallet");
  await page.getByRole("button", { name: "專區" }).click();
  await page.getByLabel("帳戶", { exact: true }).selectOption("Daily wallet");
  await page.getByLabel("類別", { exact: true }).selectOption("日用");
  await page.getByLabel("商家", { exact: true }).fill("全聯");
  await page.getByLabel("品項名稱", { exact: true }).fill("香蕉");
  await page.getByLabel("金額", { exact: true }).fill("417");
  await page.getByRole("button", { name: "儲存記錄" }).click();

  await expect(page.getByText("記錄已存入本機明細。")).toBeVisible();
  await page.getByRole("button", { name: "開啟明細" }).click();

  await expect(page.getByRole("heading", { name: "明細", exact: true })).toBeVisible();
  await expect(page.getByLabel("已確認的明細記錄")).toContainText("全聯");
  await expect(page.getByText("尚無已確認的明細記錄。")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps compact ledger rows readable at 320px", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 320, height: 900 });

  await openWorkspace(page);
  await addAccount(page, "Daily wallet");
  await page.getByRole("button", { name: "專區" }).click();
  await page.getByLabel("帳戶", { exact: true }).selectOption("Daily wallet");
  await page.getByLabel("類別", { exact: true }).selectOption("日用");
  await page.getByLabel("商家", { exact: true }).fill("這是一個非常非常長的商家名稱用來測試省略號截斷效果是否正常運作");
  await page.getByLabel("品項名稱", { exact: true }).fill("香蕉");
  await page.getByLabel("金額", { exact: true }).fill("417");
  await page.getByRole("button", { name: "儲存記錄" }).click();
  await page.getByRole("button", { name: "開啟明細" }).click();

  await expect(page.getByRole("heading", { name: "明細", exact: true })).toBeVisible();
  const card = page.locator(".ledger-record-card");
  await expect(card).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  const metrics = await card.evaluateAll((cards) => cards.map((element) => {
    const cardBox = element.getBoundingClientRect();
    const name = element.querySelector(".record-name")?.getBoundingClientRect();
    const meta = element.querySelector(".record-meta")?.getBoundingClientRect();
    const detail = element.querySelector(".record-detail-line");
    const iconTops = [...element.querySelectorAll(".record-actions button")].map((button) => Math.round(button.getBoundingClientRect().top));
    return {
      rowHeight: cardBox.height,
      nameWidth: Math.round(name?.width ?? 0),
      metaWidth: Math.round(meta?.width ?? 0),
      detailWidth: Math.ceil(detail?.getBoundingClientRect().width ?? 0),
      detailScrollWidth: detail?.scrollWidth ?? 0,
      iconRows: new Set(iconTops).size,
    };
  }));
  // The name must stay visible (it collapsed to 0px before the two-line layout).
  expect(metrics[0].nameWidth).toBeGreaterThan(50);
  // The secondary meta line must also be visible, not starved to nothing.
  expect(metrics[0].metaWidth).toBeGreaterThan(50);
  // Account · category is the dimension this row exists to expose, so it must
  // render in full at the narrowest supported width — not clipped into a "Da…"
  // stub, which is what happened while the meta column sat behind the title
  // column and shared its track with the status badge.
  expect(metrics[0].detailWidth).toBeGreaterThan(50);
  expect(metrics[0].detailScrollWidth).toBeLessThanOrEqual(metrics[0].detailWidth + 1);
  // The two icon actions must stay on a single row.
  expect(metrics[0].iconRows).toBe(1);
  // Below the 440px breakpoint the meta wraps to its own row, so a row is three
  // text lines tall there but never more.
  expect(metrics[0].rowHeight).toBeLessThan(100);
  expect(errors).toEqual([]);
});

test("opens the account page with provider sign-in actions", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await openWorkspace(page);
  // /account merged into Settings: the 登入 section is the default tab.
  await page.getByRole("button", { name: "設定", exact: true }).click();

  await expect(page.getByRole("heading", { name: "選用雲端同步", exact: true })).toBeVisible();
  expect(page.url()).toMatch(/\/settings$/);
  const emailInput = page.getByLabel("電子郵件", { exact: true });
  if (await emailInput.count()) {
    await expect(emailInput).toBeVisible();
    await expect(page.getByLabel("密碼", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "繼續", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用 Google 繼續", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用 Facebook 繼續", exact: true })).toBeVisible();
  } else {
    await expect(page.getByText("此本機預覽中無法使用雲端驗證。", { exact: false })).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});

test("captures a meal with multiple photos without a ledger write", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await openWorkspace(page);
  await expect(page.getByRole("button", { name: "登出" })).toHaveCount(0);
  await page.getByRole("button", { name: "專區" }).click();
  await page.getByRole("button", { name: /記錄餐點/ }).click();
  const mealLabels = page.locator(".meal-form > label");
  await expect(mealLabels).toHaveCount(2);
  for (const label of await mealLabels.all()) {
    const labelBox = await label.locator("span").boundingBox();
    const controlBox = await label.locator("input, textarea").boundingBox();
    if (!labelBox || !controlBox) throw new Error("Expected meal form controls to be measurable.");
    expect(controlBox.y).toBeGreaterThan(labelBox.y + labelBox.height);
  }
  await expect(page.getByRole("button", { name: "拍照" })).toBeVisible();
  await page.getByLabel("餐點照片").setInputFiles([
    { name: "meal-1.jpg", mimeType: "image/jpeg", buffer: Buffer.from("one") },
    { name: "meal-2.jpg", mimeType: "image/jpeg", buffer: Buffer.from("two") },
  ]);
  await page.getByRole("button", { name: "儲存餐點" }).click();

  await expect(page.getByText("餐點已存至本機,含 2 張照片。")).toBeVisible();
  await page.getByRole("button", { name: "明細", exact: true }).click();
  await expect(page.getByText("尚無已確認的明細記錄。")).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps invoice scans in review without creating a ledger record", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await openWorkspace(page);
  await page.getByRole("button", { name: "專區" }).click();
  await page.getByRole("button", { name: /掃描發票/ }).click();
  await page.getByLabel("掃描圖片").setInputFiles({
    name: "invoice.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("invoice"),
  });
  await page.getByRole("button", { name: "保留掃描草稿" }).click();

  await expect(page.getByText("1 筆掃描草稿已存至本機待審核。")).toBeVisible();
  await expect(page.getByText("invoice.jpg")).toBeVisible();
  await page.getByRole("button", { name: /^明細/u }).click();
  await expect(page.getByRole("button", { name: /^明細/u }).locator(".nav-badge")).toHaveText("1");
  await expect(page.getByText("尚無已確認的明細記錄。")).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps the desktop shell within its viewport", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await openWorkspace(page);
  const navigation = page.locator("nav[aria-label='MealLedger 導覽']");
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("heading", { name: "概覽", exact: true })).toBeVisible();
  const navBox = await navigation.boundingBox();
  expect(navBox?.x).toBe(0);
  expect(navBox?.height).toBeGreaterThanOrEqual(899);
  expect(navBox?.width).toBeGreaterThan(180);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("switches the theme from 相關設定 and persists it across reloads", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await openWorkspace(page);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("tab", { name: "相關設定", exact: true }).click();
  await page.getByRole("radio", { name: "淺色", exact: true }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Restore the default 深色 choice so the rest of the suite is unaffected.
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("tab", { name: "相關設定", exact: true }).click();
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("keeps the account page compact and aligned on mobile", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await openWorkspace(page);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "選用雲端同步", exact: true })).toBeVisible();
  const tabRows = await page.getByRole("tab").evaluateAll((tabs) => new Set(tabs.map((tab) => Math.round(tab.getBoundingClientRect().top))).size);
  expect(tabRows).toBe(1);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("keeps mobile navigation usable without horizontal overflow", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await openWorkspace(page);
  await page.getByRole("button", { name: "專區" }).click();
  await expect(page.getByRole("heading", { name: "專區", exact: true })).toBeVisible();
  await expect(page.locator(".capture-intent-button")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "你要記錄什麼?" })).toBeVisible();
  await page.getByRole("button", { name: "明細", exact: true }).click();
  await expect(page.getByRole("heading", { name: "明細", exact: true })).toBeVisible();
  await expectHorizontallyWithinViewport(page, "nav[aria-label='MealLedger 導覽'] .nav-item");
  await expect(page.locator(".table-card")).toHaveCount(0);
  await expect(page.locator(".ledger-record-card")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("keeps the mobile workspace header aligned across routes", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await openWorkspace(page);
  expect(await page.locator(".bottom-nav").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(90);
  const headerPositions: number[] = [];
  const navHeights: number[] = [];
  for (const routeName of ["概覽", "明細", "新增", "專區", "設定"]) {
    await page.getByRole("button", { name: routeName, exact: true }).click();
    await expect(page.locator(".page-header")).toBeVisible();
    const measurements = await page.locator(".page-header, .bottom-nav").evaluateAll((elements) =>
      elements.map((element) => ({ className: element.className, top: element.getBoundingClientRect().top, height: element.getBoundingClientRect().height })),
    );
    headerPositions.push(measurements.find((item) => item.className === "page-header")?.top ?? -1);
    navHeights.push(measurements.find((item) => item.className === "bottom-nav")?.height ?? -1);
  }

  expect(new Set(headerPositions.map((position) => Math.round(position))).size).toBe(1);
  expect(new Set(navHeights.map((height) => Math.round(height))).size).toBe(1);
  expect(errors).toEqual([]);
});

// Above the 900px breakpoint the shell is a left sidebar, not the bottom bar the
// mobile breakpoint falls back to (see `.bottom-nav` in src/styles.css), so the
// items share a left edge and stack downwards instead of sharing one row. 設定 is
// pinned to the bottom of the column on purpose, so the gap between items is not
// uniform and is deliberately not asserted.
test("keeps the desktop navigation a full-height left sidebar", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1000, height: 900 });

  await openWorkspace(page);
  const navigation = page.locator("nav[aria-label='MealLedger 導覽']");
  await expect(navigation).toBeVisible();
  const items = await navigation.locator(".nav-item").evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        label: (element.textContent ?? "").trim(),
        left: Math.round(box.left),
        top: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    }),
  );

  expect(items.map((item) => item.label), "the sidebar lists every route once").toEqual([
    "概覽",
    "明細",
    "新增",
    "專區",
    "設定",
  ]);
  expect(new Set(items.map((item) => item.left)).size, "every item shares one left edge").toBe(1);

  const tops = items.map((item) => item.top);
  expect(tops, "the items stack downwards in DOM order").toEqual([...tops].sort((a, b) => a - b));
  expect(new Set(tops).size, "no two items sit on one row").toBe(items.length);

  // Every nav item is a touch target, per content-ui-restructure-handoff.md §5.2.
  for (const item of items) {
    expect(item.height, `${item.label}: touch target height`).toBeGreaterThanOrEqual(44);
    expect(item.width, `${item.label}: touch target width`).toBeGreaterThanOrEqual(44);
  }

  // A sidebar means the content column starts to the right of the rail. If the
  // rail ever became a full-width stacked list, the arrangement assertions above
  // would still hold and only this one would notice.
  const navigationBox = await navigation.boundingBox();
  const contentLeft = await page
    .locator(".page-header")
    .first()
    .evaluate((element) => Math.round(element.getBoundingClientRect().left));
  expect(contentLeft, "the content column sits beside the sidebar").toBeGreaterThanOrEqual(
    Math.round(navigationBox?.right ?? 0),
  );

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("keeps the first-account flow usable at 320px", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 320, height: 900 });

  await openWorkspace(page);
  await page.getByRole("button", { name: "專區" }).click();
  await page.getByRole("button", { name: "建立第一個帳戶" }).click();

  const dialog = page.getByRole("dialog", { name: "新增帳戶" });
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const amountSteps = dialog.locator(".amount-step");
  await expect(amountSteps).toHaveCount(3);
  const positions = await amountSteps.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  }));
  expect(new Set(positions.map((position) => `${position.top}:${position.bottom}`)).size).toBe(1);
  expect(errors).toEqual([]);
});

test("keeps compact navigation stable near its breakpoint", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 720, height: 900 });

  await openWorkspace(page);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("tab", { name: "相關設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "明細帳戶", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
