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
  // A wide window keeps the same bottom bar (ADR 0006): full width, parked on the
  // bottom edge, short enough to leave the viewport to the content.
  expect(navBox?.x).toBe(0);
  expect(Math.round(navBox?.width ?? 0)).toBe(1440);
  expect(Math.round((navBox?.y ?? 0) + (navBox?.height ?? 0))).toBe(900);
  expect(navBox?.height).toBeLessThanOrEqual(90);
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

// ADR 0006 makes the center 新增 button the raised, visually dominant item, and
// dark is the default theme. This measures what a reader sees rather than the
// declarations that carry it: on a near-black bar a green circle plus a
// green-tinted drop shadow read as one flat surface, and the plus was drawn at
// the same size and weight as the four flat icons beside it.
test("keeps the center 新增 button raised and dominant in both themes", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => window.localStorage.setItem("mealledger.settings.theme", value), theme);
    await page.reload();
    await expect(page.getByRole("heading", { name: "概覽", exact: true })).toBeVisible();

    const fab = await page.evaluate(() => {
      const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const rgba = (value: string) => {
        const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
        if (parts.length < 3) throw new Error(`Cannot read colour "${value}"`);
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
      };
      const luminance = ({ r, g, b }: { r: number; g: number; b: number }) =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const contrast = (
        first: { r: number; g: number; b: number },
        second: { r: number; g: number; b: number },
      ) => {
        const a = luminance(first);
        const b = luminance(second);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      // A translucent layer is only visible against what it is painted on, so the
      // shadow is composited over the bar before it is measured.
      const over = (
        top: { r: number; g: number; b: number; a: number },
        bottom: { r: number; g: number; b: number },
      ) => ({
        r: top.a * top.r + (1 - top.a) * bottom.r,
        g: top.a * top.g + (1 - top.a) * bottom.g,
        b: top.a * top.b + (1 - top.a) * bottom.b,
      });

      const circle = document.querySelector<HTMLElement>(".nav-create .nav-icon");
      const bar = document.querySelector<HTMLElement>(".bottom-nav");
      const glyph = circle?.querySelector("svg");
      const flatGlyph = document.querySelector<HTMLElement>(".nav-item-ledger .nav-icon svg");
      if (!circle || !bar || !glyph || !flatGlyph) {
        throw new Error("The bottom bar is missing its FAB or a flat item to compare it with.");
      }

      // The circle is painted by ::before so that its size never moves the caption
      // under it, so the paint is what has to be measured here, not the 26px icon
      // box the flat items share.
      const circleStyle = getComputedStyle(circle, "::before");
      const barColour = rgba(getComputedStyle(bar).backgroundColor);
      // The first shadow layer is the ring the dark theme draws around the circle.
      // Only its colour is read: the layer list itself is comma-separated and so
      // is every rgb() inside it, which splits a layer into three fake ones.
      const outermostShadow = rgba(circleStyle.boxShadow.match(/rgba?\([^)]+\)/)?.[0] ?? "");

      return {
        theme: document.documentElement.dataset.theme,
        circleWidth: Math.round(Number.parseFloat(circleStyle.width)),
        glyphWidth: Math.round(glyph.getBoundingClientRect().width),
        flatGlyphWidth: Math.round(flatGlyph.getBoundingClientRect().width),
        strokeWidth: Number.parseFloat(getComputedStyle(glyph).strokeWidth),
        circleContrast: Math.round(contrast(rgba(circleStyle.backgroundColor), barColour) * 100) / 100,
        ringAlpha: outermostShadow.a,
        ringContrast: Math.round(contrast(over(outermostShadow, barColour), barColour) * 100) / 100,
      };
    });

    expect(fab.theme, "the theme under test is the one that rendered").toBe(theme);
    expect(fab.circleWidth, `${theme}: the center item is a raised circle`).toBeGreaterThanOrEqual(40);
    expect(fab.glyphWidth, `${theme}: the FAB plus is larger than a flat item's icon`).toBeGreaterThan(
      fab.flatGlyphWidth,
    );
    expect(fab.strokeWidth, `${theme}: the FAB plus is drawn heavier than a flat item's icon`).toBeGreaterThanOrEqual(2.5);
    expect(fab.circleContrast, `${theme}: the circle stays a legible object on the bar`).toBeGreaterThanOrEqual(3);

    if (theme === "dark") {
      // The light theme's soft shadow is plenty against a warm bar; the dark bar
      // needs a solid edge, otherwise the FAB is a flat green dot again.
      expect(fab.ringAlpha, "dark: the raised edge is a ring, not a shadow the bar swallows").toBeGreaterThan(0.99);
      expect(fab.ringContrast, "dark: the ring separates the circle from the bar").toBeGreaterThanOrEqual(3);
    }
  }

  expect(errors).toEqual([]);
});

// ADR 0006 keeps one navigation structure at every viewport width: a fixed bottom
// bar of five equal-width items with the center 新增 raised as a circular button.
// The shell used to swap in a full-height left sidebar above 900px, so this asserts
// the same shape on both sides of that retired breakpoint — the previous version of
// this test asserted the sidebar and would call the ADR violation a pass.
//
// The bar renders icons only, so the captions are the accessible names rather than
// visible labels, and that is the part of this shape a reader cannot see for
// themselves: every item has to stay reachable by name, and no caption may grow back
// into a visible label on one item out of five.
test("keeps one bottom-bar navigation shape at every viewport width", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  for (const width of [320, 390, 1000, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openWorkspace(page);

    // Names come from the clipped captions, so a caption that stops being rendered
    // (or a button that loses it) drops an item out of this list.
    for (const name of ["概覽", "明細", "新增", "專區", "設定"]) {
      await expect(page.getByRole("button", { name }), `${width}px: ${name} is named`).toBeVisible();
    }

    const report = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".bottom-nav");
      const circle = document.querySelector<HTMLElement>(".nav-create .nav-icon");
      const items = Array.from(document.querySelectorAll<HTMLElement>(".nav-item"));
      const captions = Array.from(document.querySelectorAll<HTMLElement>(".nav-caption"));
      const workspace = document.querySelector<HTMLElement>(".workspace");
      const header = document.querySelector<HTMLElement>(".page-header");
      if (!nav || !circle || !workspace || !header || items.length === 0 || captions.length === 0) {
        throw new Error("The shell is missing part of its navigation.");
      }

      // `left/top: 50%` puts the painted circle's corner at the icon box's centre
      // and the transform centres it there before lifting it, so the painted box
      // is the icon centre plus the resolved translate.
      const fabStyle = getComputedStyle(circle, "::before");
      const fabSize = Number.parseFloat(fabStyle.width);
      const fabShift = new DOMMatrix(fabStyle.transform === "none" ? "" : fabStyle.transform);
      const iconBox = circle.getBoundingClientRect();
      const painted = {
        left: iconBox.left + iconBox.width / 2 + fabShift.m41,
        top: iconBox.top + iconBox.height / 2 + fabShift.m42,
        width: fabSize,
      };

      const navBox = nav.getBoundingClientRect();
      const workspaceStyle = getComputedStyle(workspace);
      const workspaceBox = workspace.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        labels: items.map((item) => (item.textContent ?? "").trim()),
        itemBoxes: items.map((item) => {
          const box = item.getBoundingClientRect();
          return { top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
        }),
        nav: {
          left: Math.round(navBox.left),
          right: Math.round(navBox.right),
          top: Math.round(navBox.top),
          bottom: Math.round(navBox.bottom),
        },
        circle: {
          width: Math.round(painted.width),
          top: Math.round(painted.top),
          bottom: Math.round(painted.top + painted.width),
        },
        iconTops: items.map((item) =>
          Math.round(item.querySelector(".nav-icon")!.getBoundingClientRect().top),
        ),
        captionBoxes: captions.map((caption) => {
          const box = caption.getBoundingClientRect();
          return { width: Math.round(box.width), height: Math.round(box.height) };
        }),
        workspace: {
          left: Math.round(workspaceBox.left),
          width: Math.round(workspaceBox.width),
          paddingLeft: Math.round(Number.parseFloat(workspaceStyle.paddingLeft)),
          paddingBottom: Math.round(Number.parseFloat(workspaceStyle.paddingBottom)),
        },
        headerLeft: Math.round(header.getBoundingClientRect().left),
      };
    });

    const label = `${width}px`;
    expect(report.labels, `${label}: the bar lists every route once`).toEqual([
      "概覽",
      "明細",
      "新增",
      "專區",
      "設定",
    ]);

    // One fixed bar pinned to the bottom edge and spanning the viewport: never a
    // rail down the side, never a stacked list that only shares a left edge.
    expect(report.nav.left, `${label}: the bar starts at the left edge`).toBe(0);
    expect(report.nav.right, `${label}: the bar reaches the right edge`).toBe(report.viewport.width);
    expect(report.nav.bottom, `${label}: the bar sits on the bottom edge`).toBe(report.viewport.height);
    expect(report.viewport.height - report.nav.top, `${label}: bar height`).toBeGreaterThanOrEqual(44);

    // Five equal-width items sharing one row, each still a touch target.
    expect(new Set(report.itemBoxes.map((box) => box.top)).size, `${label}: one row`).toBe(1);
    expect(new Set(report.itemBoxes.map((box) => box.width)).size, `${label}: equal widths`).toBe(1);
    for (const box of report.itemBoxes) {
      expect(box.height, `${label}: touch target height`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${label}: touch target width`).toBeGreaterThanOrEqual(44);
    }

    // The center item stays the raised circle that breaks the bar's top edge.
    expect(report.circle.width, `${label}: the center item is a circle`).toBeGreaterThanOrEqual(40);
    expect(report.circle.top, `${label}: the circle breaks the bar's top edge`).toBeLessThan(report.nav.top);

    // Icon-only: the five glyphs sit on one centred row, and no caption is laid
    // out as visible text — a label under one item out of five read as a missing
    // label rather than a label, which is why the bar carries none at all.
    expect(new Set(report.iconTops).size, `${label}: every item shares one icon row`).toBe(1);
    for (const [index, box] of report.captionBoxes.entries()) {
      expect(box.width, `${label}: caption ${index} takes no room in the row`).toBeLessThanOrEqual(2);
      expect(box.height, `${label}: caption ${index} takes no room in the row`).toBeLessThanOrEqual(2);
    }

    // The circle is the only thing the bar shows besides the icons: it has to keep
    // rising past the bar's top edge, and it has to stay inside its own column
    // instead of covering the glyphs beside it.
    expect(report.nav.top - report.circle.top, `${label}: the FAB is lifted clear of the bar`).toBeGreaterThanOrEqual(14);
    expect(report.circle.width, `${label}: the circle stays inside its own column`).toBeLessThanOrEqual(
      Math.min(...report.itemBoxes.map((box) => box.width)),
    );
    expect(
      report.workspace.paddingBottom,
      `${label}: the content clears the fixed bar and the circle's overhang`,
    ).toBeGreaterThanOrEqual(report.viewport.height - report.nav.top + 14);

    // Nothing is reserved for a side rail: the capped content column is centred in
    // the viewport, and the header starts at its padding rather than beside a rail.
    expect(
      Math.abs(report.workspace.left - (report.viewport.width - report.workspace.width) / 2),
      `${label}: the content column is centred`,
    ).toBeLessThanOrEqual(1);
    expect(report.headerLeft, `${label}: the header starts inside the content column`).toBe(
      report.workspace.left + report.workspace.paddingLeft,
    );

    await expectNoHorizontalOverflow(page);
  }

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
