import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";
import { LanguageProvider } from "./i18n/react";
import type { LocalLedgerRecord } from "./manualLedger/records";

vi.mock("./ai/client", () => ({ requestAiJson: vi.fn() }));

import { requestAiJson } from "./ai/client";

function renderWorkspace(path = "/") {
  window.history.pushState(null, "", path);
  return render(<LanguageProvider><App /></LanguageProvider>);
}

function testLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function openWorkspace(user: ReturnType<typeof userEvent.setup>) {
  const skipSetup = screen.queryByRole("button", { name: "瀏覽工作區" });
  if (skipSetup) {
    await user.click(skipSetup);
  }
}

async function goToCapture(user: ReturnType<typeof userEvent.setup>) {
  // 新增 is now the voice-capture flow; the manual/scan/meal/attachment tools
  // live on the Zone page, which is where these tests interact with them.
  await user.click(screen.getByRole("button", { name: "專區" }));
}

async function addCaptureAccount(user: ReturnType<typeof userEvent.setup>, name: string, currency = "TWD", trigger = "新增帳戶") {
  const firstAccountButton = screen.queryByRole("button", { name: "建立第一個帳戶" });
  if (firstAccountButton) {
    await user.click(firstAccountButton);
  } else {
    await user.click(screen.getByRole("button", { name: trigger }));
  }
  await user.type(screen.getByLabelText("帳戶名稱"), name);
  await user.selectOptions(screen.getByLabelText("幣別"), currency);
  await user.click(screen.getByRole("button", { name: "新增並選用" }));
}

async function addAccount(user: ReturnType<typeof userEvent.setup>, name: string, currency = "TWD") {
  await user.click(screen.getByRole("button", { name: "設定" }));
  await user.clear(screen.getByLabelText("帳戶名稱"));
  await user.selectOptions(screen.getByLabelText("幣別"), currency);
  await user.type(screen.getByLabelText("帳戶名稱"), name);
  await user.click(screen.getByRole("button", { name: "新增帳戶" }));
}

async function createExpenseRecord(user: ReturnType<typeof userEvent.setup>) {
  await addAccount(user, "Daily wallet");
  await goToCapture(user);
  expect(screen.getByLabelText("帳戶")).toHaveTextContent("Daily wallet");
  await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
  await user.selectOptions(screen.getByLabelText("類別"), "日用");
  await user.clear(screen.getByLabelText("商家"));
  await user.type(screen.getByLabelText("商家"), "全聯");
  await user.clear(screen.getByLabelText("品項名稱"));
  await user.type(screen.getByLabelText("品項名稱"), "香蕉");
  await user.clear(screen.getByLabelText("金額"));
  await user.type(screen.getByLabelText("金額"), "417");
  await user.click(screen.getByRole("button", { name: "儲存記錄" }));
}

describe("App shell draft flow", () => {
  beforeEach(() => {
    let nextId = 0;
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `local-${++nextId}`),
    });
    window.localStorage.clear();
    window.history.pushState(null, "", "/");
  });

  test("opens first-account setup from Settings when requested", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "設定" }));
    await user.click(screen.getByRole("button", { name: "開啟首次帳戶設定" }));
    expect(screen.getByRole("heading", { name: "建立你的第一個帳戶" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("帳戶名稱"), "Travel wallet");
    await user.click(screen.getByRole("button", { name: "建立帳戶" }));
    await user.click(screen.getByRole("button", { name: "概覽" }));

    expect(await screen.findByRole("heading", { name: "概覽" })).toBeInTheDocument();
    expect(screen.getByText("1 個帳戶")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.custom-categories") ?? "[]")).toEqual(expect.arrayContaining(["飲食", "AI"]));
    expect(JSON.parse(window.localStorage.getItem("mealledger.taxonomy.tags") ?? "[]")).toEqual(expect.arrayContaining(["訂閱"]));
  });

  test("stores the spoken-capture entity policy chosen in Settings", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.getByRole("heading", { name: "AI 口說偏好" })).toBeInTheDocument();

    const accountRow = screen.getByRole("group", { name: "帳戶" });
    await user.click(within(accountRow).getByRole("radio", { name: "直接新增" }));

    const categoryRow = screen.getByRole("group", { name: "類別" });
    await user.click(within(categoryRow).getByRole("radio", { name: "詢問是否新增" }));

    expect(JSON.parse(window.localStorage.getItem("mealledger.ai.entity-policy") ?? "{}")).toEqual({
      account: "auto",
      category: "ask",
    });
  });

  test("switches the UI language from 相關設定 and persists the preference", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "設定" }));
    const languageGroup = screen.getByRole("group", { name: "語言" });
    await user.click(within(languageGroup).getByRole("radio", { name: "English" }));

    // The whole shell re-renders in en-US: nav, settings headings, and <html lang>.
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(window.localStorage.getItem("mealledger.locale")).toBe("en-US");
    expect(document.documentElement.lang).toBe("en");

    // Switching back restores the zh-TW baseline.
    const englishLanguageGroup = screen.getByRole("group", { name: "Language" });
    await user.click(within(englishLanguageGroup).getByRole("radio", { name: "繁體中文" }));
    expect(screen.getByRole("button", { name: "設定" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-Hant");
  });

  test("records an entered starting balance as fund addition", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "設定" }));
    await user.click(screen.getByRole("button", { name: "開啟首次帳戶設定" }));
    await user.type(screen.getByLabelText("帳戶名稱"), "Bank account");
    await user.click(screen.getByRole("radio", { name: "輸入目前餘額" }));
    await user.type(screen.getByLabelText("目前餘額"), "2500");
    await user.click(screen.getByRole("button", { name: "建立帳戶" }));
    await user.click(screen.getByRole("button", { name: "概覽" }));

    expect(await screen.findByRole("heading", { name: "概覽" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "fund-addition", amount: "2500" })]),
    );

    // The opening balance is an account anchor, not a transaction: it stays
    // out of the ledger history and is surfaced on the account report card.
    await user.click(screen.getByRole("button", { name: "明細" }));
    expect(screen.getByText("尚無已確認的明細記錄。")).toBeInTheDocument();
    expect(screen.queryByText("Initial funds")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "概覽" }));
    const reports = screen.getByLabelText("帳戶報表");
    const bankRow = within(reports).getByText("Bank account").closest(".report-row");
    expect(bankRow?.textContent).toMatch(/期初餘額/);
    expect(bankRow?.textContent).toMatch(/TWD 2,500/);
  });

  test("creates an official local expense record", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await createExpenseRecord(user);

    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開啟明細" }));

    expect(screen.getByRole("heading", { name: "明細" })).toBeInTheDocument();
    const recordList = screen.getByLabelText("已確認的明細記錄");
    expect(within(recordList).getByRole("heading", { name: "明細歷史" })).toBeInTheDocument();
    expect(within(recordList).getByText("全聯")).toBeInTheDocument();
    expect(within(recordList).getByText("TWD 417")).toBeInTheDocument();
    expect(screen.queryByText("No confirmed ledger records yet.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "概覽" }));
    expect(screen.getByText("1 個帳戶")).toBeInTheDocument();
    expect(screen.getByText("Daily wallet: TWD -417")).toBeInTheDocument();
  });

  test("switches between all capture intents without creating a ledger record", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await user.click(screen.getByRole("button", { name: /掃描發票/ }));
    expect(screen.getByRole("heading", { name: "掃描發票" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "儲存記錄" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /記錄餐點/ }));
    expect(screen.getByRole("heading", { name: "記錄餐點" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual([]);

  });

  test("warns when browser storage cannot persist local changes", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });

    try {
      renderWorkspace();
      await openWorkspace(user);
      expect(await screen.findByLabelText(/本機儲存空間不可用/)).toBeInTheDocument();
      expect(screen.getByLabelText(/變更可能會遺失/)).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
  });

  test("saves a meal with multiple photos without creating a ledger record", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await user.click(screen.getByRole("button", { name: /記錄餐點/ }));
    await user.upload(screen.getByLabelText("餐點照片"), [
      new File(["one"], "meal-1.jpg", { type: "image/jpeg" }),
      new File(["two"], "meal-2.jpg", { type: "image/jpeg" }),
    ]);
    await user.click(screen.getByRole("button", { name: "儲存餐點" }));

    expect(screen.getByText("餐點已存至本機,含 2 張照片。")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.capture.meals") ?? "[]")).toEqual(
      [expect.objectContaining({ transactionIds: [], mediaAssetIds: [expect.stringContaining("meal-local-1-0-meal-1.jpg"), expect.stringContaining("meal-local-1-1-meal-2.jpg")] })],
    );
    expect(JSON.parse(window.localStorage.getItem("mealledger.capture.upload-queue") ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "queued", kind: "meal-photo", name: "meal-1.jpg" }), expect.objectContaining({ kind: "meal-photo", name: "meal-2.jpg" })]),
    );
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "概覽" }));
    expect(within(screen.getByRole("region", { name: "應用程式狀態" })).getByText("2 張本機圖片")).toBeInTheDocument();
    expect(screen.getByText("2 張本機圖片")).toBeInTheDocument();
  });

  test("opens a real camera capture dialog for meal photos", async () => {
    const user = userEvent.setup();
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
    });
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await user.click(screen.getByRole("button", { name: /記錄餐點/ }));
    await user.click(screen.getByRole("button", { name: "拍照" }));

    expect(await screen.findByRole("dialog", { name: "拍攝餐點照片" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(stop).toHaveBeenCalledOnce();
  });

  test("keeps scanned sources separate from official ledger records", async () => {
    const user = userEvent.setup();
    const originalCreateObjectURL = window.URL.createObjectURL;
    const originalRevokeObjectURL = window.URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => "blob:scan-preview");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(window.URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await user.click(screen.getByRole("button", { name: /掃描收據/ }));
    await user.upload(screen.getByLabelText("掃描圖片"), new File(["scan"], "receipt.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "保留掃描草稿" }));

    expect(screen.getByText("1 筆掃描草稿已存至本機待審核。")).toBeInTheDocument();
    expect(screen.getByText("receipt.jpg")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "receipt.jpg 的預覽" })).toHaveAttribute("src", "blob:scan-preview");
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "保留來源" }));
    expect(screen.getByText("保留待審核")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.capture.temporary-scans") ?? "[]")).toEqual(
      [expect.objectContaining({ state: "retained", expiresAt: null })],
    );

    await user.click(screen.getByRole("button", { name: "移除來源" }));
    expect(screen.queryByText("保留待審核")).not.toBeInTheDocument();
    expect(screen.queryByText("1 個掃描檔已排入本機佇列,等待日後上傳。")).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:scan-preview");
    expect(JSON.parse(window.localStorage.getItem("mealledger.capture.temporary-scans") ?? "[]")).toEqual(
      [expect.objectContaining({ state: "discarded" })],
    );
    Object.defineProperty(window.URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(window.URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
  });

  test("saves explicit fixed labels when expense details are unavailable", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.click(screen.getByRole("checkbox", { name: "商家不詳" }));
    await user.click(screen.getByRole("checkbox", { name: "品項不詳" }));
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "80");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開啟明細" }));

    expect(screen.getByText("商家不詳")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          counterparty: "商家不詳",
          counterpartyMissing: true,
          itemName: "品項不詳",
          itemNameMissing: true,
        }),
      ]),
    );
  });

  test("lets income sources be selected or added inline", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類型"), "income");
    await user.selectOptions(screen.getByLabelText("類別"), "零用錢");
    await user.click(screen.getByRole("button", { name: "新增來源" }));
    await user.type(screen.getByLabelText("新來源"), "Parent");
    await user.click(screen.getByRole("button", { name: "新增並選用" }));
    await user.clear(screen.getByLabelText("金額", { exact: true }));
    await user.type(screen.getByLabelText("金額", { exact: true }), "500");
    expect(screen.getByLabelText("來源")).toHaveValue("Parent");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));
    await user.click(screen.getByRole("button", { name: "開啟明細" }));

    expect(screen.getByText("Parent")).toBeInTheDocument();
  });

  test("exposes clean CSV, JSON, and ZIP exports from Settings", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:mealledger");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = window.URL.createObjectURL;
    const originalRevokeObjectURL = window.URL.revokeObjectURL;
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(window.URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(window.URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    renderWorkspace();

    await openWorkspace(user);
    await user.click(screen.getByRole("button", { name: "設定" }));

    expect(screen.getByRole("button", { name: "匯出 CSV" })).toHaveClass("primary-action");
    expect(screen.getByRole("button", { name: "匯出 JSON" })).toHaveClass("secondary-action");
    expect(screen.getByRole("button", { name: "匯出 ZIP" })).toHaveClass("secondary-action");
    await user.click(screen.getByRole("button", { name: "匯出 CSV" }));
    expect(screen.getByText("CSV 匯出已下載,未包含圖片內容。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "匯出 JSON" }));
    expect(screen.getByText("JSON 匯出已下載,未包含圖片內容。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "匯出 ZIP" }));

    expect(createObjectURL).toHaveBeenCalledTimes(3);
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(anchorClick).toHaveBeenCalledTimes(3);
    anchorClick.mockRestore();
    Object.defineProperty(window.URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(window.URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
  });

  test("validates a CSV selection without writing ledger records", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await user.click(screen.getByRole("button", { name: "設定" }));
    const file = new File([`date,account,amount\n${testLocalDate()},Cash,417\n`], "ledger.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("CSV 匯入檔案"), file);

    expect(await screen.findByText("CSV 已就緒待審核:1 列、3 欄。已對應:date, account, amount。可直接匯入:0 列;需審核:1 列。尚未建立任何記錄。")).toBeInTheDocument();
    expect(window.localStorage.getItem("mealledger.manual-ledger.records")).toBe("[]");
  });

  test("confirms a valid CSV row into the local ledger through review", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await user.click(screen.getByRole("button", { name: "設定" }));
    const file = new File([
      `date,kind,account,amount,currency,merchant,item_name,category\n${testLocalDate()},expense,Daily wallet,417,TWD,全聯,香蕉,日用\n`,
    ], "ledger.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("CSV 匯入檔案"), file);

    await user.click(await screen.findByRole("button", { name: "確認匯入第 2 列" }));
    expect(screen.getByText("第 2 列已匯入本機明細。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^明細/u }));

    expect(screen.getByText("全聯")).toBeInTheDocument();
    expect(screen.getByText("TWD 417")).toBeInTheDocument();
  });

  test("blocks a CSV row that duplicates an existing active ledger record", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await createExpenseRecord(user);
    await user.click(screen.getByRole("button", { name: "設定" }));
    const file = new File([
      `date,kind,account,amount,currency,merchant,item_name,category\n${testLocalDate()},expense,Daily wallet,417,TWD,全聯,香蕉,日用\n`,
    ], "duplicate.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("CSV 匯入檔案"), file);

    expect(await screen.findByText(/重複候選:record-/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "確認匯入第 2 列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "略過第 2 列" })).toBeEnabled();
  });

  test("supports keeping a duplicate separate and linking another duplicate", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await createExpenseRecord(user);
    await user.click(screen.getByRole("button", { name: "設定" }));
    const file = new File([
      `date,kind,account,amount,currency,merchant,item_name,category\n${testLocalDate()},expense,Daily wallet,417,TWD,全聯,香蕉,日用\n${testLocalDate()},expense,Daily wallet,417,TWD,全聯,香蕉,日用\n`,
    ], "duplicate-actions.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("CSV 匯入檔案"), file);

    await user.click(await screen.findByRole("button", { name: "保留為獨立第 2 列" }));
    await user.click(screen.getByRole("button", { name: "連結現有第 3 列" }));
    expect(screen.getByText("狀態:kept-separate")).toBeInTheDocument();
    expect(screen.getByText("狀態:linked")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^明細/u }));
    expect(screen.getAllByText("全聯")).toHaveLength(2);
  });

  test("moves a duplicate into the persisted local draft queue", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await createExpenseRecord(user);
    await user.click(screen.getByRole("button", { name: "設定" }));
    const file = new File([
      `date,kind,account,amount,currency,merchant,item_name,category\n${testLocalDate()},expense,Daily wallet,417,TWD,全聯,香蕉,日用\n`,
    ], "duplicate-draft.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("CSV 匯入檔案"), file);

    await user.click(await screen.findByRole("button", { name: "合併為草稿第 2 列" }));
    await user.click(screen.getByRole("button", { name: /^明細/u }));
    expect(screen.getByText("1 筆本機草稿")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^明細/u }).querySelector(".nav-badge")).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "確認寫入明細" }));
    expect(screen.getByText("草稿已確認寫入本機明細。")).toBeInTheDocument();
    expect(screen.queryByText("1 筆本機草稿")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toHaveLength(2);
  });

  test("offers cancel choices and persists an incomplete manual entry as a local draft", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.type(screen.getByLabelText("商家"), "全聯");
    await user.click(screen.getByRole("button", { name: "取消輸入" }));

    expect(screen.getByRole("dialog", { name: "取消輸入" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "繼續編輯" }));
    expect(screen.queryByRole("dialog", { name: "取消輸入" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("商家")).toHaveValue("全聯");

    await user.click(screen.getByRole("button", { name: "取消輸入" }));
    await user.click(screen.getByRole("button", { name: "保留為草稿" }));
    expect(screen.getByText("已取消輸入。")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.app-shell.drafts") ?? "[]")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /^明細/u }));
    expect(screen.getByText("1 筆本機草稿")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "在新增頁繼續" }));
    expect(screen.getByRole("heading", { name: "專區" })).toBeInTheDocument();
    expect(screen.getByLabelText("商家")).toHaveValue("全聯");
    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.type(screen.getByLabelText("品項名稱"), "香蕉");
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "80");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));
    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.app-shell.drafts") ?? "[]")).toHaveLength(0);
  });

  test("discarding a manual entry clears the changed form without creating a record", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.type(screen.getByLabelText("商家"), "全聯");
    await user.click(screen.getByRole("button", { name: "取消輸入" }));
    await user.click(screen.getByRole("button", { name: "丟棄變更" }));

    expect(screen.getByText("已取消輸入。")).toBeInTheDocument();
    expect(screen.getByText("請先選擇帳戶以繼續")).toBeInTheDocument();
    expect(window.localStorage.getItem("mealledger.manual-ledger.records")).toBe("[]");
  });

  test("offers recurrence intent and keeps variable amounts out of auto-record", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.type(screen.getByLabelText("商家", { exact: true }), "全聯");
    await user.type(screen.getByLabelText("品項名稱", { exact: true }), "香蕉");
    await user.clear(screen.getByLabelText("金額", { exact: true }));
    await user.type(screen.getByLabelText("金額", { exact: true }), "417");

    const recurrence = screen.getByLabelText("記錄行為");
    expect(within(recurrence).getByRole("option", { name: "下期自動記錄" })).toBeEnabled();
    // 僅本期 has no next cycle: a hint replaces the dead next-cycle controls.
    expect(screen.getByText("此記錄只記錄本期，不會重複。")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "下期金額可能變動" })).not.toBeInTheDocument();

    // Picking a recurring behavior reveals the amount control and the schedule.
    await user.selectOptions(recurrence, "prompt-next-cycle");
    await user.click(screen.getByRole("checkbox", { name: "下期金額可能變動" }));
    expect(within(recurrence).getByRole("option", { name: "下期自動記錄" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "下期金額可能變動" }));
    await user.selectOptions(recurrence, "auto-record-next-cycle");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));
    await user.click(screen.getByRole("button", { name: "開啟明細" }));

    // Cycle controls live in the floating record dialog footer.
    await user.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByRole("button", { name: "暫停週期" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消週期" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "暫停週期" }));
    expect(screen.getByRole("button", { name: "恢復週期" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "恢復週期" }));
    expect(screen.getByRole("button", { name: "暫停週期" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消週期" }));
    await user.click(screen.getByRole("button", { name: "確認" }));
    expect(screen.queryByRole("button", { name: "暫停週期" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消週期" })).not.toBeInTheDocument();
  });

  test("converts an unresolved expense in place after completing its details", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類型"), "unresolved-expense");
    await user.click(screen.getByRole("radio", { name: "日" }));
    await user.clear(screen.getByLabelText("日期"));
    await user.type(screen.getByLabelText("日期"), "2026-07-12");
    await user.clear(screen.getByLabelText("金額", { exact: true }));
    await user.type(screen.getByLabelText("金額", { exact: true }), "80");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));
    await user.click(screen.getByRole("button", { name: "開啟明細" }));

    await user.click(screen.getByRole("button", { name: "編輯" }));
    await user.click(screen.getByRole("button", { name: "補齊細節" }));
    // The dialog is named after the record's translated kind, not the raw enum:
    // "unresolved-expense" was leaking into a user-facing name.
    const editor = screen.getByRole("form", { name: "補齊 缺漏支出" });
    await user.clear(within(editor).getByLabelText("日期"));
    await user.type(within(editor).getByLabelText("日期"), "2026-07-12");
    await user.type(within(editor).getByLabelText("類別"), "日用");
    await user.type(within(editor).getByLabelText("商家"), "Store");
    await user.type(within(editor).getByLabelText("品項名稱"), "Tea");
    await user.click(within(editor).getByRole("button", { name: "轉為支出" }));

    expect(screen.getByText("Store")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "補齊細節" })).not.toBeInTheDocument();
  });

  test("opens the workspace and navigates between core routes", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    expect(screen.queryByRole("button", { name: /open workspace/i })).not.toBeInTheDocument();
    await openWorkspace(user);

    expect(screen.getByRole("heading", { name: "概覽" })).toBeInTheDocument();

    for (const [navigationLabel, heading] of [["概覽", "概覽"], ["明細", "明細"], ["新增", "新增"], ["專區", "專區"], ["設定", "設定"]]) {
      await user.click(screen.getByRole("button", { name: navigationLabel }));
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: navigationLabel })).toHaveAttribute("aria-current", "page");
    }
  });

  test("uses the root URL as the canonical Overview path", async () => {
    const user = userEvent.setup();
    renderWorkspace("/overview");

    await openWorkspace(user);
    expect(screen.getByRole("heading", { name: "概覽" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");

    await user.click(screen.getByRole("button", { name: "概覽" }));
    expect(window.location.pathname).toBe("/");
  });

  test("uses the FAB and ledger record entry actions", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await user.click(screen.getByRole("button", { name: "新增" }));
    expect(screen.getByRole("heading", { name: "新增" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^明細/u }));
    await user.click(screen.getByRole("button", { name: "開始一筆記錄" }));
    expect(screen.getByRole("heading", { name: "新增" })).toBeInTheDocument();
  });

  test("recovers safely from an unknown route", async () => {
    const user = userEvent.setup();
    renderWorkspace("/missing");

    await openWorkspace(user);

    expect(screen.getByRole("heading", { name: "未知頁面" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "找不到頁面" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /前往概覽/i }));

    expect(screen.getByRole("heading", { name: "概覽" })).toBeInTheDocument();
  });

  test("resolves supported nested routes without losing the shell route", async () => {
    const user = userEvent.setup();
    renderWorkspace("/ledger/draft/draft-42");

    await openWorkspace(user);
    expect(screen.getByRole("heading", { name: "明細" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "未知頁面" })).not.toBeInTheDocument();

    window.history.pushState(null, "", "/settings/localization");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
  });

  test("updates the status strip for offline and online events", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);

    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("離線")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "應用程式狀態" })).not.toBeInTheDocument();

    act(() => window.dispatchEvent(new Event("online")));
    await user.click(screen.getByRole("button", { name: "概覽" }));
    expect(screen.queryByRole("region", { name: "應用程式狀態" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "設定" }));
    expect(screen.getByRole("heading", { name: "選用雲端同步" })).toBeInTheDocument();
  });

  test("keeps an offline manual record visibly local-only", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    act(() => window.dispatchEvent(new Event("offline")));
    await createExpenseRecord(user);

    expect(screen.getByText("離線")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "local-only", kind: "expense" })]),
    );

    await user.click(screen.getByRole("button", { name: "開啟明細" }));
    expect(screen.getByLabelText("已確認的明細記錄")).toHaveTextContent("僅本機");
  });

  test("rejects malformed CSV without touching the local ledger", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await user.click(screen.getByRole("button", { name: "設定" }));
    await user.upload(screen.getByLabelText("CSV 匯入檔案"), new File(["unknown,other\nvalue\n"], "invalid.csv", { type: "text/csv" }));

    const rejectionMessage = await screen.findByText(/CSV 已拒絕:/);
    expect(rejectionMessage).toHaveTextContent("CSV 標題未包含受支援的明細欄位。");
    expect(window.localStorage.getItem("mealledger.manual-ledger.records")).toBe("[]");
  });

  test("shows local record counts as records are created", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    expect(screen.queryByText("沒有待審草稿")).not.toBeInTheDocument();

    await goToCapture(user);
    await createExpenseRecord(user);

    await user.click(screen.getByRole("button", { name: /^明細/u }));
    expect(screen.getByLabelText("已確認的明細記錄")).toHaveTextContent("全聯");
  });

  test("requires a transfer account before saving a transfer", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await addAccount(user, "Savings");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類型"), "transfer");
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "1000");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.queryByText("記錄已存入本機明細。")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("商家")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("來源")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("目的地帳戶"), "Savings");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
  });

  test("shows cross-currency and fee fields only for transfers", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await addAccount(user, "Japan cash");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類型"), "transfer");
    await user.click(screen.getByRole("radio", { name: "跨幣別" }));

    expect(screen.getByLabelText("來源帳戶")).toBeInTheDocument();
    expect(screen.getByLabelText("目的地帳戶")).toBeInTheDocument();
    expect(screen.getByLabelText("來源金額")).toBeInTheDocument();
    expect(screen.getByLabelText("目的地金額")).toBeInTheDocument();
    expect(screen.queryByLabelText("手續費帳戶")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "加入轉帳手續費" }));

    expect(screen.getByLabelText("手續費帳戶")).toBeInTheDocument();
    expect(screen.getByLabelText("手續費金額")).toBeInTheDocument();
    expect(screen.getByLabelText("手續費類別")).toBeInTheDocument();
    expect(screen.queryByLabelText("商家")).not.toBeInTheDocument();
  });

  test("derives record currencies from the selected accounts", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await addAccount(user, "Japan cash", "JPY");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Japan cash");

    expect(screen.getByText("JPY", { exact: true })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類型"), "transfer");
    expect(within(screen.getByLabelText("目的地帳戶")).queryByRole("option", { name: "Japan cash (JPY)" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "跨幣別" }));
    await user.selectOptions(screen.getByLabelText("目的地帳戶"), "Japan cash");
    expect(screen.getByText("JPY", { exact: true })).toBeInTheDocument();
  });

  test("uses native radios for keyboard transfer switching", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類型"), "transfer");

    const sameCurrency = screen.getByRole("radio", { name: "同幣別" });
    sameCurrency.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: "跨幣別" })).toBeChecked();
  });

  test("requires local account setup before a capture account can be selected", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);

    expect(screen.getByText("需要帳戶")).toBeInTheDocument();
    expect(screen.queryByText("Create an account before saving a ledger record.")).not.toBeInTheDocument();
    await addCaptureAccount(user, "Travel cash");

    expect(screen.getByLabelText("帳戶")).not.toBeDisabled();
    expect(screen.getByRole("option", { name: "Travel cash (TWD)" })).toBeInTheDocument();
    expect(screen.getByLabelText("帳戶")).toHaveValue("Travel cash");
  });

  test("records a quick-added account balance as initial funds", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await user.click(screen.getByRole("button", { name: "建立第一個帳戶" }));
    await user.type(screen.getByLabelText("帳戶名稱"), "Travel cash");
    expect(screen.getByRole("button", { name: "增加期初餘額(選填) 10" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "減少期初餘額(選填) 10" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("期初餘額(選填)"), "2500");
    fireEvent.change(screen.getByLabelText("餘額截至"), { target: { value: "2026-07-14" } });
    await user.click(screen.getByRole("button", { name: "新增並選用" }));

    expect(screen.getByLabelText("帳戶")).toHaveValue("Travel cash");
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "fund-addition", accountName: "Travel cash", amount: "2500" })]),
    );
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "income", accountName: "Travel cash", amount: "2500" })]),
    );
  });

  test("allows a quick-added account to start from zero", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await user.click(screen.getByRole("button", { name: "建立第一個帳戶" }));
    await user.type(screen.getByLabelText("帳戶名稱"), "Empty wallet");
    await user.clear(screen.getByLabelText("期初餘額(選填)"));
    await user.type(screen.getByLabelText("期初餘額(選填)"), "0");

    expect(screen.queryByLabelText("餘額截至")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新增並選用" }));

    expect(screen.getByLabelText("帳戶")).toHaveValue("Empty wallet");
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual([]);
  });

  test("saves attachment photos without creating a meal or ledger record", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await user.click(screen.getByRole("button", { name: /附加照片/ }));
    await user.upload(screen.getByLabelText("附件照片"), [
      new File(["evidence"], "evidence-1.jpg", { type: "image/jpeg" }),
      new File(["evidence-2"], "evidence-2.jpg", { type: "image/jpeg" }),
    ]);
    await user.click(screen.getByRole("button", { name: "清除已選" }));
    expect(screen.getByRole("button", { name: "保留附件" })).toBeDisabled();

    await user.upload(screen.getByLabelText("附件照片"), [
      new File(["evidence"], "evidence-1.jpg", { type: "image/jpeg" }),
      new File(["evidence-2"], "evidence-2.jpg", { type: "image/jpeg" }),
    ]);
    await user.click(screen.getByRole("button", { name: "保留附件" }));

    expect(screen.getByText("2 張照片已存至本機作為附件佐證。")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.capture.upload-queue") ?? "[]")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "attachment", name: "evidence-1.jpg" }),
        expect.objectContaining({ kind: "attachment", name: "evidence-2.jpg" }),
      ]),
    );
    expect(JSON.parse(window.localStorage.getItem("mealledger.capture.meals") ?? "[]")).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "清除待上傳附件" }));
    expect(JSON.parse(window.localStorage.getItem("mealledger.capture.upload-queue") ?? "[]")).toEqual([]);
  });

  test("offers practical quick amount adjustments", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await addCaptureAccount(user, "Daily wallet");

    const amount = screen.getByLabelText("金額");
    await user.click(screen.getByRole("button", { name: "增加金額 1000" }));
    await user.click(screen.getByRole("button", { name: "增加金額 100" }));
    await user.click(screen.getByRole("button", { name: "減少金額 10" }));

    expect(amount).toHaveValue(1090);
  });

  test("shows an inline error when quick account setup is incomplete or duplicated", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await user.click(screen.getByRole("button", { name: "建立第一個帳戶" }));
    await user.click(screen.getByRole("button", { name: "新增並選用" }));

    expect(screen.getByRole("alert")).toHaveTextContent("請輸入帳戶名稱");

    await user.type(screen.getByLabelText("帳戶名稱"), "Daily wallet");
    await user.click(screen.getByRole("button", { name: "新增並選用" }));
    await user.click(screen.getByRole("button", { name: "新增帳戶" }));
    await user.type(screen.getByLabelText("帳戶名稱"), "daily wallet");
    await user.click(screen.getByRole("button", { name: "新增並選用" }));

    expect(screen.getByRole("alert")).toHaveTextContent("同名");
  });

  test("selects a seeded category or adds a local category", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await addCaptureAccount(user, "Daily wallet");

    const category = screen.getByLabelText("類別");
    await user.selectOptions(category, "AI");
    expect(category).toHaveValue("AI");

    await user.click(screen.getByRole("button", { name: "新增類別" }));
    await user.type(screen.getByLabelText("新類別名稱"), "Household");
    await user.click(screen.getByRole("button", { name: "新增並選用" }));

    expect(category).toHaveValue("Household");
  });

  test("reports invalid categories and stores explicit unresolved time ranges", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await addCaptureAccount(user, "Daily wallet");

    await user.click(screen.getByRole("button", { name: "新增類別" }));
    await user.click(screen.getByRole("button", { name: "新增並選用" }));
    expect(screen.getByRole("alert")).toHaveTextContent("請輸入類別名稱");
    await user.type(screen.getByLabelText("新類別名稱"), "日用");
    await user.click(screen.getByRole("button", { name: "新增並選用" }));
    expect(screen.getByRole("alert")).toHaveTextContent("此類別已存在");
    await user.click(screen.getByRole("button", { name: "取消" }));

    await user.selectOptions(screen.getByLabelText("類型"), "unresolved-expense");
    await user.click(screen.getByRole("radio", { name: "月" }));
    fireEvent.change(screen.getByLabelText("記錄月份"), { target: { value: "2026-07" } });
    await user.click(screen.getByRole("radio", { name: "期間" }));
    fireEvent.change(screen.getByLabelText("期間開始"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("期間結束"), { target: { value: "2026-07-31" } });
    await user.type(screen.getByLabelText("金額"), "20");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
  });

  test("supports inline transfer accounts and balance adjustments", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await addCaptureAccount(user, "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類型"), "transfer");
    await user.click(screen.getByRole("button", { name: "新增目的地帳戶" }));
    await user.type(screen.getByLabelText("帳戶名稱"), "Japan cash");
    await user.selectOptions(screen.getByLabelText("幣別"), "JPY");
    await user.click(screen.getByRole("button", { name: "新增並選用" }));
    await user.click(screen.getByRole("radio", { name: "跨幣別" }));
    await user.type(screen.getByLabelText("來源金額"), "1000");
    await user.type(screen.getByLabelText("目的地金額"), "46000");
    await user.click(screen.getByRole("checkbox", { name: "加入轉帳手續費" }));
    await user.click(screen.getByRole("button", { name: "新增手續費帳戶" }));
    await user.type(screen.getByLabelText("帳戶名稱"), "Fee wallet");
    await user.click(screen.getByRole("button", { name: "新增並選用" }));
    await user.type(screen.getByLabelText("手續費金額"), "15");
    await user.type(screen.getByLabelText("手續費類別"), "手續費");

    await user.selectOptions(screen.getByLabelText("類型"), "adjustment");
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "-10");
    await user.type(screen.getByLabelText("調整原因"), "Cash count");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
  });

  test("keeps duplicate Settings accounts out of the local account list", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    expect(screen.queryByRole("region", { name: "帳戶管理" })).not.toBeInTheDocument();
    await addAccount(user, "daily wallet");

    expect(screen.getByLabelText("可用帳戶").querySelectorAll("li")).toHaveLength(1);
  });

  test("records a Settings account current balance as initial funds", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await user.click(screen.getByRole("button", { name: "設定" }));
    await user.type(screen.getByLabelText("帳戶名稱"), "Savings");
    await user.selectOptions(screen.getByLabelText("帳戶類型"), "bank");
    await user.click(screen.getByRole("radio", { name: "輸入目前餘額" }));
    await user.type(screen.getByLabelText("目前餘額"), "2500");
    await user.click(screen.getByRole("button", { name: "新增帳戶" }));

    expect(screen.getByLabelText("可用帳戶")).toHaveTextContent("Savings");
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "fund-addition", accountName: "Savings", amount: "2500" })]),
    );
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "income", accountName: "Savings", amount: "2500" })]),
    );
  });

  test("uses native form validation to block incomplete manual records", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);

    await addCaptureAccount(user, "Daily wallet");

    const merchant = screen.getByLabelText("商家");
    const itemName = screen.getByLabelText("品項名稱");
    const amount = screen.getByLabelText("金額");
    expect(merchant).toBeInvalid();
    expect(itemName).toBeInvalid();
    expect(amount).toBeInvalid();
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.queryByText("記錄已存入本機明細。")).not.toBeInTheDocument();
  });

  test("shows a fallback error when draft validation rejects submission", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await addCaptureAccount(user, "Daily wallet");

    const form = document.querySelector("form");
    if (!form) {
      throw new Error("Manual draft form was not rendered");
    }

    fireEvent.submit(form);

    expect(screen.getByRole("alert")).toHaveTextContent("儲存前請填寫所有必填欄位");
    expect(screen.queryByText("記錄已存入本機明細。")).not.toBeInTheDocument();
  });

  test("keeps official local records after a reload", async () => {
    const user = userEvent.setup();
    const view = renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await createExpenseRecord(user);

    view.unmount();
    renderWorkspace();
    await openWorkspace(user);
    await user.click(screen.getByRole("button", { name: /^明細/u }));
    expect(screen.getByLabelText("已確認的明細記錄")).toHaveTextContent("全聯");
  });

  test("keeps accounts available after a reload", async () => {
    const user = userEvent.setup();
    const view = renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Daily wallet");

    view.unmount();
    renderWorkspace("/zone");
    await openWorkspace(user);

    expect(screen.getByRole("option", { name: "Daily wallet (TWD)" })).toBeInTheDocument();
  });

  test("edits and voids a local official record while retaining audit history", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await createExpenseRecord(user);
    await user.click(screen.getByRole("button", { name: "開啟明細" }));

    await user.click(screen.getByRole("button", { name: "編輯" }));
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "500");
    await user.click(screen.getByRole("button", { name: "儲存變更" }));
    expect(screen.getByText("TWD 500")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "作廢" }));
    await user.click(screen.getByRole("button", { name: "確認" }));
    expect(screen.getByText("已作廢")).toBeInTheDocument();

    const storedRecords = JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]") as Array<{ recordState: string; version: number }>;
    const storedAuditEvents = JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.audit-events") ?? "[]") as Array<{ eventType: string }>;
    expect(storedRecords[0]).toMatchObject({ recordState: "voided", version: 3 });
    expect(storedAuditEvents.map((event) => event.eventType)).toEqual(["record-created", "record-updated", "record-voided"]);
  });

  test("hard-delete mode removes the record and its audit history entirely", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await createExpenseRecord(user);

    // Switch the delete behavior to 真正刪除 in 相關設定.
    await user.click(screen.getByRole("button", { name: "設定" }));
    await user.click(screen.getByRole("radio", { name: "真正刪除" }));
    expect(window.localStorage.getItem("mealledger.settings.delete-action")).toBe("hard-delete");

    await user.click(screen.getByRole("button", { name: "明細" }));
    await user.click(screen.getByRole("button", { name: "刪除" }));
    await user.click(screen.getByRole("button", { name: "確認" }));
    expect(screen.queryByText(/TWD \d+/)).not.toBeInTheDocument();

    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.audit-events") ?? "[]")).toEqual([]);

    // Hard-deleted records must not leave pending/failed cloud-sync entries behind.
    const queue = JSON.parse(window.localStorage.getItem("mealledger.cloud-sync.queue") ?? "[]") as Array<{ target: string }>;
    expect(queue.some((item) => item.target === "record")).toBe(false);
  });

  test("theme control persists the choice and applies it to the document", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "設定" }));
    await user.click(screen.getByRole("radio", { name: "淺色" }));

    expect(window.localStorage.getItem("mealledger.settings.theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    await user.click(screen.getByRole("radio", { name: "深色" }));
    expect(window.localStorage.getItem("mealledger.settings.theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("manages custom categories from the 類別 section", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "設定" }));

    // Categories without records must not render a bare count glyph.
    expect(screen.queryByText(/筆/u)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新增類別" }));
    await user.type(screen.getByLabelText("新類別"), "寵物");
    await user.click(screen.getByRole("button", { name: "新增此類別" }));
    expect(screen.getByText("寵物")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.custom-categories") ?? "[]")).toContain("寵物");

    await user.click(screen.getByRole("button", { name: "刪除" }));
    expect(screen.queryByText("寵物")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.custom-categories") ?? "[]")).not.toContain("寵物");
  });

  test("negative-balance policy rejects a write that pushes an account below zero", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    // Account with a 2500 starting balance.
    await user.click(screen.getByRole("button", { name: "設定" }));
    await user.click(screen.getByRole("button", { name: "開啟首次帳戶設定" }));
    await user.type(screen.getByLabelText("帳戶名稱"), "Daily wallet");
    await user.click(screen.getByRole("radio", { name: "輸入目前餘額" }));
    await user.type(screen.getByLabelText("目前餘額"), "2500");
    await user.click(screen.getByRole("button", { name: "建立帳戶" }));

    // Enable the policy in 相關設定.
    await user.click(screen.getByRole("button", { name: "設定" }));
    await user.click(screen.getByRole("radio", { name: "不允許負餘額" }));
    expect(window.localStorage.getItem("mealledger.settings.negative-balance-policy")).toBe("reject");

    // An expense over the balance is rejected with a readable reason.
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.clear(screen.getByLabelText("商家"));
    await user.type(screen.getByLabelText("商家"), "全聯");
    await user.clear(screen.getByLabelText("品項名稱"));
    await user.type(screen.getByLabelText("品項名稱"), "香蕉");
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "3000");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.getByText(/「Daily wallet」餘額將低於零/u)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]")).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ kind: "expense" })]),
    );

    // Disabling the policy allows the same expense.
    await user.click(screen.getByRole("button", { name: "設定" }));
    await user.click(screen.getByRole("radio", { name: "允許負餘額" }));
    await goToCapture(user);
    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.clear(screen.getByLabelText("商家"));
    await user.type(screen.getByLabelText("商家"), "全聯");
    await user.clear(screen.getByLabelText("品項名稱"));
    await user.type(screen.getByLabelText("品項名稱"), "香蕉");
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "3000");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
  });

  test("links a friend payback to an existing expense", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await createExpenseRecord(user);
    await user.selectOptions(screen.getByLabelText("類型"), "refund");
    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.selectOptions(screen.getByLabelText("退款類型"), "payback");
    await user.selectOptions(screen.getByLabelText("原始支出"), "record-local-2");
    await user.clear(screen.getByLabelText("商家或來源"));
    await user.type(screen.getByLabelText("商家或來源"), "朋友");
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "100");
    await user.type(screen.getByLabelText("退款原因"), "朋友還款");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
    const storedRecords = JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]") as Array<{ kind: string; refundSubtype: string; refundLinkedRecordId: string }>;
    expect(storedRecords).toHaveLength(2);
    expect(storedRecords[1]).toMatchObject({ kind: "refund", refundSubtype: "payback", refundLinkedRecordId: "record-local-2" });
  });

  test("blocks an excess payback until the excess is classified", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await createExpenseRecord(user);
    await user.selectOptions(screen.getByLabelText("類型"), "refund");
    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.selectOptions(screen.getByLabelText("退款類型"), "payback");
    await user.selectOptions(screen.getByLabelText("原始支出"), "record-local-2");
    await user.clear(screen.getByLabelText("商家或來源"));
    await user.type(screen.getByLabelText("商家或來源"), "朋友");
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "500");
    await user.type(screen.getByLabelText("退款原因"), "朋友還款");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.getByRole("alert")).toHaveTextContent("請先分類超出");
    await user.selectOptions(screen.getByRole("combobox", { name: "超額處理" }), "income");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));
    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
  });

  test("requires an exchange-difference classification for a cross-currency payback", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await addAccount(user, "Japan cash", "JPY");
    await addAccount(user, "Taiwan wallet", "TWD");
    await goToCapture(user);

    await user.selectOptions(screen.getByLabelText("帳戶"), "Japan cash");
    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.clear(screen.getByLabelText("商家"));
    await user.type(screen.getByLabelText("商家"), "Tokyo store");
    await user.clear(screen.getByLabelText("品項名稱"));
    await user.type(screen.getByLabelText("品項名稱"), "Travel item");
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "1000");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    const storedExpenses = JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]") as Array<{ id: string }>;
    await user.selectOptions(screen.getByLabelText("帳戶"), "Taiwan wallet");
    await user.selectOptions(screen.getByLabelText("類型"), "refund");
    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.selectOptions(screen.getByLabelText("退款類型"), "payback");
    await user.selectOptions(screen.getByLabelText("原始支出"), storedExpenses[0].id);
    await user.clear(screen.getByLabelText("商家或來源"));
    await user.type(screen.getByLabelText("商家或來源"), "朋友");
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "30");
    await user.type(screen.getByLabelText("退款原因"), "跨幣別還款");

    const differenceHandling = screen.getByRole("combobox", { name: "匯差處理" });
    expect(differenceHandling).toBeInTheDocument();
    await user.selectOptions(differenceHandling, "exchange_difference");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    expect(screen.getByText("記錄已存入本機明細。")).toBeInTheDocument();
    const storedRecords = JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]") as Array<{ refundExcessHandling?: string }>;
    expect(storedRecords[1]).toMatchObject({ refundExcessHandling: "exchange_difference" });
  });

  test("offers field-by-field history suggestions for merchant and item input", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await createExpenseRecord(user);

    await user.type(screen.getByLabelText("商家"), "全");
    const merchantSuggestions = screen.getByRole("region", { name: "商家歷史建議" });
    expect(merchantSuggestions).toHaveTextContent("全聯");
    await user.click(within(merchantSuggestions).getByRole("button", { name: "使用金額 TWD 417" }));
    expect(screen.getByLabelText("金額")).toHaveValue(417);
    await user.click(within(merchantSuggestions).getByRole("button", { name: "使用帳戶 Daily wallet" }));
    expect(screen.getByLabelText("帳戶")).toHaveValue("Daily wallet");
    await user.click(within(merchantSuggestions).getByRole("button", { name: "清除商家" }));
    expect(screen.getByLabelText("商家")).toHaveValue("");

    await user.type(screen.getByLabelText("品項名稱"), "香蕉");
    const itemSuggestions = screen.getByRole("region", { name: "品項歷史建議" });
    expect(itemSuggestions).toHaveTextContent("香蕉");
    await user.click(within(itemSuggestions).getByRole("button", { name: "使用商家 全聯" }));
    expect(screen.getByLabelText("商家")).toHaveValue("全聯");
  });

  test("does not place official records in the draft review queue", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await createExpenseRecord(user);
    await user.click(screen.getByRole("button", { name: "開啟明細" }));

    expect(screen.queryByLabelText("待審核的草稿記錄")).not.toBeInTheDocument();
    expect(screen.getByLabelText("已確認的明細記錄")).toHaveTextContent("全聯");
    expect(screen.queryByText("沒有待審草稿")).not.toBeInTheDocument();
  });

  test("offers separate capture intents and keeps manual entry selected by default", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);

    expect(screen.getByRole("button", { name: /手動明細/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /掃描發票/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /掃描收據/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /記錄餐點/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /附加照片/ })).toBeEnabled();
  });

  test("offers every spec-one draft kind", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await addCaptureAccount(user, "Daily wallet");

    const type = screen.getByLabelText("類型") as HTMLSelectElement;
    expect([...type.options].map((option) => option.value)).toEqual([
      "expense",
      "income",
      "transfer",
      "refund",
      "fund-addition",
      "adjustment",
      "unresolved-expense",
    ]);

    for (const kind of ["expense", "income", "transfer", "refund", "fund-addition", "adjustment", "unresolved-expense"]) {
      await user.selectOptions(type, kind);
      expect(type.value).toBe(kind);
    }
  });

  test("switches to the required field language for each manual record kind", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openWorkspace(user);
    await goToCapture(user);
    await addCaptureAccount(user, "Daily wallet");
    const type = screen.getByLabelText("類型");

    await user.selectOptions(type, "income");
    expect(screen.getByLabelText("來源")).toBeInTheDocument();
    expect(screen.queryByLabelText("商家")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("品項名稱")).not.toBeInTheDocument();

    await user.selectOptions(type, "refund");
    expect(screen.getByLabelText("商家或來源")).toBeInTheDocument();
    expect(screen.getByLabelText("退款原因")).toBeInTheDocument();

    await user.selectOptions(type, "fund-addition");
    expect(screen.getByLabelText("來源")).toBeInTheDocument();
    expect(screen.queryByLabelText("類別")).not.toBeInTheDocument();

    await user.selectOptions(type, "adjustment");
    expect(screen.getByLabelText("調整原因")).toBeInTheDocument();
    expect(screen.queryByLabelText("商家")).not.toBeInTheDocument();

    await user.selectOptions(type, "unresolved-expense");
    expect(screen.getByRole("group", { name: "時間精確度" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "月" }));
    expect(screen.getByLabelText("記錄月份")).toBeInTheDocument();
  });

  test("applies an AI suggestion to the manual ledger form for completion", async () => {
    vi.mocked(requestAiJson).mockResolvedValue({
      ok: true,
      data: { items: [{ kind: "expense", date: "7/25", itemName: "牛肉麵", amount: 480 }] },
    });
    const user = userEvent.setup();

    renderWorkspace();
    await openWorkspace(user);
    await addAccount(user, "Daily wallet");
    await goToCapture(user);
    await user.click(screen.getByRole("button", { name: "AI 補帳" }));

    await user.type(screen.getByLabelText("記帳內容"), "7/25 牛肉麵 480");
    await user.click(screen.getByRole("button", { name: /產生記帳草稿/u }));

    await user.click(await screen.findByRole("button", { name: "填入表單" }));

    // The manual ledger form opens in its account-first state; the unknown
    // account stays blank for manual selection.
    expect(screen.getByLabelText("帳戶")).toHaveValue("");

    await user.selectOptions(screen.getByLabelText("帳戶"), "Daily wallet");

    // Once the account is chosen the remaining fields appear prefilled from
    // the suggestion.
    expect(screen.getByLabelText("金額")).toHaveValue(480);
    expect(screen.getByLabelText("品項名稱")).toHaveValue("牛肉麵");

    await user.selectOptions(screen.getByLabelText("類別"), "日用");
    await user.click(screen.getByLabelText("商家不詳"));
    await user.clear(screen.getByLabelText("商家"));
    await user.type(screen.getByLabelText("商家"), "全聯");
    await user.click(screen.getByRole("button", { name: "儲存記錄" }));

    const stored = JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]") as Array<{ amount: string; accountName: string; itemName: string }>;
    expect(stored).toHaveLength(1);
    expect(stored[0].amount).toBe("480");
    expect(stored[0].accountName).toBe("Daily wallet");
    expect(stored[0].itemName).toBe("牛肉麵");
  });
});

describe("ledger filters and type sections", () => {
  beforeEach(() => {
    let nextId = 0;
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `local-${++nextId}`),
    });
    window.localStorage.clear();
    window.history.pushState(null, "", "/");
  });

  function seedRecord(overrides: Partial<LocalLedgerRecord> = {}): LocalLedgerRecord {
    return {
      id: `rec-${Math.random().toString(36).slice(2)}`,
      idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
      userId: "local-user",
      kind: "expense",
      status: "local-only",
      recordState: "active",
      version: 1,
      localDate: "2026-08-17",
      accountId: "acc-wallet",
      accountName: "錢包",
      amount: "100",
      currency: "TWD",
      category: "日用",
      counterparty: "全聯",
      counterpartyMissing: false,
      itemName: "香蕉",
      itemNameMissing: false,
      transferAccountId: "",
      transferAccountName: "",
      transferMode: "same-currency",
      destinationAmount: "",
      destinationCurrency: "JPY",
      feeAccountId: "",
      feeAccountName: "",
      feeAmount: "",
      feeCurrency: "TWD",
      feeCategory: "",
      refundReason: "",
      refundSubtype: "refund",
      refundLinkedRecordId: "",
      refundExcessHandling: "unclassified",
      recurrenceChoice: "current-cycle-only",
      recurrenceAmountMode: "fixed",
      recurrenceStatus: "inactive",
      reason: "",
      timePrecision: "day",
      periodStart: "",
      periodEnd: "",
      note: "",
      createdAt: "2026-08-17T04:00:00.000Z",
      updatedAt: "2026-08-17T04:00:00.000Z",
      ...overrides,
    };
  }

  const mixedLedger = (): LocalLedgerRecord[] => [
    seedRecord({ id: "r1", kind: "expense", localDate: "2026-08-17", amount: "80", counterparty: "7-11", itemName: "咖啡" }),
    seedRecord({ id: "r2", kind: "expense", localDate: "2026-08-10", amount: "417", counterparty: "全聯", itemName: "香蕉" }),
    seedRecord({ id: "r3", kind: "income", accountName: "銀行", amount: "5000", category: "薪資", counterparty: "公司", itemName: "" }),
    seedRecord({ id: "r4", kind: "transfer", accountName: "錢包", transferAccountName: "銀行", amount: "1000", category: "", counterparty: "", itemName: "" }),
  ];

  async function seedLedger(user: ReturnType<typeof userEvent.setup>, records: LocalLedgerRecord[]) {
    window.localStorage.setItem("mealledger.manual-ledger.records", JSON.stringify(records));
    renderWorkspace("/ledger");
    await openWorkspace(user);
  }

  function expenseSection(): HTMLElement {
    const heading = screen.getByRole("heading", { name: "支出" });
    return heading.closest(".ledger-kind-section") as HTMLElement;
  }

  test("groups confirmed records into type sections with subtotals", async () => {
    const user = userEvent.setup();
    await seedLedger(user, mixedLedger());

    expect(screen.getByRole("heading", { name: "支出" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "收入" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "轉帳" })).toBeInTheDocument();

    const expense = expenseSection();
    // The row title leads with the purchased item; the merchant stays visible
    // as the second line of the name cell.
    expect(within(expense).getByText("香蕉")).toBeInTheDocument();
    expect(within(expense).getByText("咖啡")).toBeInTheDocument();
    expect(within(expense).getByText("全聯")).toBeInTheDocument();
    expect(within(expense).getByText("7-11")).toBeInTheDocument();
    // Default sort is date newest-first: 8/17 (80) before 8/10 (417).
    expect(within(expense).getAllByText(/^TWD/).map((el) => el.textContent)).toEqual(["TWD 80", "TWD 417"]);
    // The section subtotal sums the 支出 family.
    expect(screen.getByText(/小計 TWD 497/)).toBeInTheDocument();
  });

  test("writes a row amount and its section subtotal the same way", async () => {
    const user = userEvent.setup();
    await seedLedger(user, [
      seedRecord({ id: "big", kind: "expense", amount: "1234567", counterparty: "旅行社", itemName: "機票" }),
    ]);

    const expense = expenseSection();
    const rowAmount = expense.querySelector(".record-amount strong")?.textContent?.trim() ?? "";
    // The summary guards its currency code with a non-breaking space so the code
    // cannot be orphaned from its number. Normalise that away so this guard is
    // about the number's written form, not about wrap control.
    const summary = (expense.querySelector(".ledger-section-heading > span")?.textContent ?? "").replace(/\u00A0/g, " ");

    // A one-record section's subtotal *is* that record's amount, so the row text
    // has to appear verbatim inside it. Grouping, decimals or spacing that drift
    // apart between the two surfaces break this without either being read by hand.
    expect(rowAmount).toBe("TWD 1,234,567");
    expect(summary).toContain(rowAmount);
  });

  test("filters by account chip, category, merchant, and free-text search", async () => {
    const user = userEvent.setup();
    await seedLedger(user, mixedLedger());

    // Account chips are the fast lane: one tap focuses a single account.
    await user.click(screen.getByRole("button", { name: "銀行" }));
    expect(screen.getByRole("heading", { name: "收入" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "支出" })).not.toBeInTheDocument();
    expect(screen.queryByText("全聯")).not.toBeInTheDocument();

    // Tapping the active chip again clears the account filter.
    await user.click(screen.getByRole("button", { name: "銀行" }));
    expect(screen.getByText("全聯")).toBeInTheDocument();

    // Category dropdown narrows to 日用.
    await user.click(screen.getByRole("button", { name: "類別" }));
    await user.click(screen.getByRole("option", { name: /日用/ }));
    expect(screen.getByText("全聯")).toBeInTheDocument();
    expect(screen.queryByText("公司")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "收入" })).not.toBeInTheDocument();

    // Merchant/source dropdown narrows further to the 全聯 expense.
    await user.click(screen.getByRole("button", { name: /商家/ }));
    await user.click(screen.getByRole("option", { name: /全聯/ }));
    expect(within(expenseSection()).getByText("全聯")).toBeInTheDocument();
    expect(screen.queryByText("7-11")).not.toBeInTheDocument();

    // Free-text search matches item names too.
    await user.click(screen.getByRole("button", { name: "清除篩選" }));
    await user.type(screen.getByLabelText("搜尋明細"), "咖啡");
    expect(screen.getByText("7-11")).toBeInTheDocument();
    expect(screen.queryByText("全聯")).not.toBeInTheDocument();
  });

  test("sorts records within a section by amount", async () => {
    const user = userEvent.setup();
    await seedLedger(user, mixedLedger());

    await user.click(screen.getByRole("button", { name: /排序/ }));
    await user.click(screen.getByRole("option", { name: /金額（高 → 低）/ }));
    expect(within(expenseSection()).getAllByText(/^TWD/).map((el) => el.textContent)).toEqual(["TWD 417", "TWD 80"]);
  });

  test("shows a filter empty state with a one-tap reset", async () => {
    const user = userEvent.setup();
    await seedLedger(user, mixedLedger());

    await user.type(screen.getByLabelText("搜尋明細"), "不存在的商家");
    expect(screen.getByText("沒有符合篩選條件的記錄")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清除篩選" }));
    expect(screen.queryByText("沒有符合篩選條件的記錄")).not.toBeInTheDocument();
    expect(screen.getByText("全聯")).toBeInTheDocument();
  });

  test("turns an existing record into a recurring expense from the ledger editor", async () => {
    const user = userEvent.setup();
    await seedLedger(user, [seedRecord({ id: "r1", kind: "expense", amount: "80", counterparty: "7-11", itemName: "咖啡" })]);

    await user.click(screen.getByRole("button", { name: "編輯" }));
    // Non-recurring records keep the cycle controls collapsed behind a
    // one-line entry point; expanding it defaults to a real recurring choice
    // (ask me next cycle) and shows a live schedule preview.
    await user.click(screen.getByRole("button", { name: "設為週期" }));
    expect(screen.getByLabelText("記錄行為")).toHaveValue("prompt-next-cycle");
    expect(screen.getByText(/每月 09\/17/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("記錄行為"), "auto-record-next-cycle");
    await user.click(screen.getByRole("button", { name: "儲存變更" }));

    // The record is now recurring: the edit dialog offers pause/cancel, and the
    // cycle summary shows the concrete schedule (monthly cadence + next date +
    // next amount) instead of abstract settings labels.
    await user.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByRole("button", { name: "暫停週期" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消週期" })).toBeInTheDocument();
    expect(screen.getByText(/每月 09\/17/)).toBeInTheDocument();
    expect(screen.getByText(/下期自動記錄 · TWD 80/)).toBeInTheDocument();

    const stored = JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]") as Array<{
      recurrenceChoice: string;
      recurrenceAmountMode: string;
      recurrenceStatus: string;
    }>;
    expect(stored[0]).toMatchObject({
      recurrenceChoice: "auto-record-next-cycle",
      recurrenceAmountMode: "fixed",
      recurrenceStatus: "active",
    });
  });

  test("an amount-only edit keeps a paused recurrence paused", async () => {
    const user = userEvent.setup();
    await seedLedger(user, [seedRecord({
      id: "r1",
      kind: "expense",
      amount: "80",
      counterparty: "7-11",
      itemName: "咖啡",
      recurrenceChoice: "auto-record-next-cycle",
      recurrenceAmountMode: "fixed",
      recurrenceStatus: "paused",
    })]);

    await user.click(screen.getByRole("button", { name: "編輯" }));
    await user.clear(screen.getByLabelText("金額"));
    await user.type(screen.getByLabelText("金額"), "85");
    await user.click(screen.getByRole("button", { name: "儲存變更" }));

    // Editing the amount alone must not silently resume a paused cycle.
    await user.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByRole("button", { name: "恢復週期" })).toBeInTheDocument();
    expect(screen.getByText("已暫停")).toBeInTheDocument();

    const stored = JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]") as Array<{
      amount: string;
      recurrenceStatus: string;
    }>;
    expect(stored[0].amount).toBe("85");
    expect(stored[0].recurrenceStatus).toBe("paused");
  });

  test("collapses an expanded cycle-settings preview back to the one-line entry", async () => {
    const user = userEvent.setup();
    await seedLedger(user, [seedRecord({ id: "r1", kind: "expense", amount: "80", counterparty: "7-11", itemName: "咖啡" })]);

    await user.click(screen.getByRole("button", { name: "編輯" }));
    await user.click(screen.getByRole("button", { name: "設為週期" }));
    expect(screen.getByLabelText("記錄行為")).toBeInTheDocument();

    // Collapsing the preview hides the controls and restores the entry point.
    await user.click(screen.getByRole("button", { name: "收合週期設定" }));
    expect(screen.queryByLabelText("記錄行為")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設為週期" })).toBeInTheDocument();

    // Saving without touching the cycle keeps the record non-recurring.
    await user.click(screen.getByRole("button", { name: "儲存變更" }));
    const stored = JSON.parse(window.localStorage.getItem("mealledger.manual-ledger.records") ?? "[]") as Array<{ recurrenceStatus: string }>;
    expect(stored[0].recurrenceStatus).toBe("inactive");
  });

  test("shows a hint instead of dead next-cycle controls while 僅本期 is selected", async () => {
    const user = userEvent.setup();
    await seedLedger(user, [seedRecord({ id: "r1", kind: "expense", amount: "80", counterparty: "7-11", itemName: "咖啡" })]);

    await user.click(screen.getByRole("button", { name: "編輯" }));
    await user.click(screen.getByRole("button", { name: "設為週期" }));
    await user.selectOptions(screen.getByLabelText("記錄行為"), "current-cycle-only");

    // 僅本期 means there is no next cycle: the amount-variance checkbox (and
    // the schedule preview) are meaningless, so a hint replaces them.
    expect(screen.getByText("此記錄只記錄本期，不會重複。")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "下期金額可能變動" })).not.toBeInTheDocument();
    expect(screen.queryByText(/每月 09\/17/)).not.toBeInTheDocument();

    // Choosing a recurring behavior brings the controls and schedule back.
    await user.selectOptions(screen.getByLabelText("記錄行為"), "auto-record-next-cycle");
    expect(screen.getByRole("checkbox", { name: "下期金額可能變動" })).toBeInTheDocument();
    expect(screen.getByText(/每月 09\/17/)).toBeInTheDocument();
  });

  test("clamps the next cycle to the last valid day of short months", async () => {
    const user = userEvent.setup();
    await seedLedger(user, [seedRecord({
      id: "r1",
      kind: "expense",
      localDate: "2026-01-31",
      amount: "80",
      counterparty: "7-11",
      itemName: "咖啡",
      recurrenceChoice: "auto-record-next-cycle",
      recurrenceAmountMode: "fixed",
      recurrenceStatus: "active",
    })]);

    // Monthly recurrence on the 31st falls back to the last valid day (Feb 28).
    await user.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByText("每月 02/28")).toBeInTheDocument();
  });

  test("labels the editor counterparty field by record kind", async () => {
    const user = userEvent.setup();
    await seedLedger(user, [
      seedRecord({ id: "r1", kind: "expense", counterparty: "全聯" }),
      seedRecord({ id: "r2", kind: "income", accountName: "銀行", counterparty: "公司", category: "薪資" }),
    ]);

    // An expense record labels the counterparty field 商家, never 商家／來源.
    await user.click(screen.getAllByRole("button", { name: "編輯" })[0]);
    let dialog = screen.getByRole("dialog", { name: /編輯/ });
    expect(within(dialog).getByLabelText("商家", { exact: true })).toHaveValue("全聯");
    expect(within(dialog).queryByLabelText("商家／來源")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "關閉" }));

    // An income record labels it 來源 instead.
    await user.click(screen.getAllByRole("button", { name: "編輯" })[1]);
    dialog = screen.getByRole("dialog", { name: /編輯/ });
    expect(within(dialog).getByLabelText("來源", { exact: true })).toHaveValue("公司");
    expect(within(dialog).queryByLabelText("商家", { exact: true })).not.toBeInTheDocument();
  });

  test("hides the editor reason field except for adjustments or existing data", async () => {
    const user = userEvent.setup();
    await seedLedger(user, [
      seedRecord({ id: "r1", kind: "expense", amount: "80", counterparty: "7-11", itemName: "咖啡" }),
      seedRecord({ id: "r2", kind: "adjustment", amount: "-10", counterparty: "", itemName: "", reason: "盤點差額" }),
      seedRecord({ id: "r3", kind: "income", amount: "500", counterparty: "公司", reason: "年中獎金" }),
    ]);

    const editButtonFor = (title: string) => within(screen.getByText(title).closest("article") as HTMLElement).getByRole("button", { name: "編輯" });

    // A plain expense has no redundant 原因 field (the capture form never
    // collects one for expenses either).
    await user.click(editButtonFor("咖啡"));
    let dialog = screen.getByRole("dialog", { name: /編輯/ });
    expect(within(dialog).queryByLabelText("原因", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "關閉" }));

    // Adjustments always show it, labeled 調整原因.
    await user.click(editButtonFor("盤點差額"));
    dialog = screen.getByRole("dialog", { name: /編輯/ });
    expect(within(dialog).getByLabelText("調整原因", { exact: true })).toHaveValue("盤點差額");
    await user.click(screen.getByRole("button", { name: "關閉" }));

    // Non-adjustment records that already carry a reason (import/voice) keep
    // it visible and editable.
    await user.click(editButtonFor("公司"));
    dialog = screen.getByRole("dialog", { name: /編輯/ });
    expect(within(dialog).getByLabelText("原因", { exact: true })).toHaveValue("年中獎金");
  });
});
