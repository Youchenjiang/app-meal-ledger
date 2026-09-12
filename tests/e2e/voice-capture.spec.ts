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

async function openVoiceCapture(page: Page) {
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新增", exact: true })).toBeVisible();
}

test("switches the voice capture mode from the page header", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await openWorkspace(page);
  await openVoiceCapture(page);

  // The header hosts the shared 整段口說 / 逐欄口說 switch.
  await expect(page.getByRole("tab", { name: "整段口說" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "逐欄口說" })).toBeVisible();

  // 新增 defaults to 逐欄口說 (mode B): the field-by-field panel renders.
  await expect(page.getByRole("tab", { name: "整段口說" })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tab", { name: "逐欄口說" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("第 1 步 · 共 7 步")).toBeVisible();

  // 整段口說 (mode A) swaps in the free-text parse panel.
  await page.getByRole("tab", { name: "整段口說" }).click();
  await expect(page.getByPlaceholder(/例如:7\/25/u)).toBeVisible();

  // Back to 逐欄口說 restores the step panel.
  await page.getByRole("tab", { name: "逐欄口說" }).click();
  await expect(page.getByText("第 1 步 · 共 7 步")).toBeVisible();

  expect(errors).toEqual([]);
});

test("completes a mode B capture from typed fields and saves an official record", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await openWorkspace(page);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("帳戶名稱").fill("Daily wallet");
  await page.getByRole("button", { name: "新增帳戶" }).click();
  await expect(page.getByLabel("可用帳戶")).toContainText("Daily wallet");

  await openVoiceCapture(page);
  await expect(page.getByRole("tab", { name: "逐欄口說" })).toHaveAttribute("aria-selected", "true");

  // Without an AI key the panel falls back to the raw typed/recognized value;
  // drive every step through the field input (the same control the speech
  // correction fills).
  const steps: Array<[label: string, value: string]> = [
    ["日期", "2026-08-01"],
    ["類型", "支出"],
    ["帳戶", "Daily wallet"],
    ["類別", "日用"],
    ["對象", "全聯"],
    ["品項", "香蕉"],
    ["金額", "417"],
  ];
  for (const [label, value] of steps) {
    await expect(page.getByText("第 1 步 · 共 7 步").or(page.getByText(/^第 [2-7] 步/u))).toBeVisible();
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "✓ 填入此欄", exact: true }).click();
  }

  // All fields confirmed: the summary lists every value before the write.
  await expect(page.getByRole("heading", { name: "確認這筆記錄", exact: true })).toBeVisible();
  await expect(page.locator(".mode-b-summary")).toContainText("全聯");
  await expect(page.locator(".mode-b-summary")).toContainText("417");
  await page.getByRole("button", { name: "✓ 確認寫入", exact: true }).click();

  await expect(page.getByText("已確認並寫入正式記錄。")).toBeVisible();

  // The confirmed record lands in the local ledger.
  await page.getByRole("button", { name: "明細", exact: true }).click();
  await expect(page.getByRole("heading", { name: "明細", exact: true })).toBeVisible();
  await expect(page.getByLabel("已確認的明細記錄")).toContainText("全聯");
  await expect(page.getByText("尚無已確認的明細記錄。")).not.toBeVisible();

  expect(errors).toEqual([]);
});
