# Agent Persistent Memory

> **Every agent session MUST read this file first** (defined in .agent/rules.md).
> **Every agent session MUST update this file before ending.**

---

## 🔑 User Preferences
- **Language**: 繁體中文 preferred for casual conversation; code/commits in English.
- **Style**: Direct, no fluff. Get things done with high engineering rigor.

---

## 📋 Current Active Tasks
- **`feature/ledger-row-compact` 落地中**：已 push，PR **[app-meal-ledger#27](https://github.com/Youchenjiang/app-meal-ledger/pull/27)** 開在 `main`（2026-10-11）。
  - **Repo 已搬家**：`Youchenjiang/MealLedger` → `Youchenjiang/app-meal-ledger`（舊 URL 仍 redirect；`origin` 尚未更新，gh 指令需 `--repo Youchenjiang/app-meal-ledger`）。
  - **Windows e2e 驗收**：第一次跑出 7 個真實失敗（乾淨 Linux 檢查抓不到，因截圖基準只有 win32、且重整後 e2e 從未重跑）。已修復並 `npm run test:e2e` 全綠 28/28：
    - `fix(ui)`（0341e61）：`ef8180b` 內容/導覽重整把明細列 padding/gap/border 撐大，偷走精簡列需要的 ~32px 橫向空間→帳戶·類別行在 450–470px 被截、300px 擠到 57px、320px 列高超標。還原列盒預算 + 權重 meta 軌（1.3fr）+ 重錄 win32 基準（900/380/262）。
    - `test(e2e)`（4b62740）：`ef8180b` 把 新增 預設從 mode B（逐欄口說）改成 mode A（整段口說）但沒更新測試。**使用者裁示：保留 mode A**，故改測試對齊。
  - **e2e 已雙平台全綠**：用官方 Playwright Docker image（`mcr.microsoft.com/playwright:v1.61.1-noble`，對齊 CI 的 ubuntu）在本機重現 Linux，修好跨平台列寬並產生 `*-linux.png` 基準。Windows 28/28、Linux 28/28。commit `bddad26`（fix(ui) + 3 win32 重錄 + 3 linux 新增）。
    - 關鍵：Linux 的 CJK+latin「帳戶·類別」行比 Windows 寬約 10px（需 123px），故把 meta 軌加到 1.7fr、column-gap 降到 4px、橫向 padding 歸零。
  - **PR #27 CI 其餘紅燈（非本功能程式，屬帳號/設定，會擋 merge）**：
    - CodeQL（1s fail）：repo 的 default setup 為 `not-configured`，此紅燈應為 branch protection 要求了一個沒有 job 產生的 `CodeQL` required check（實際分析 `CodeQL SAST (...)` 是綠的）。需調 branch protection 必要檢查清單。
    - SonarCloud ×2：專案 key 仍綁舊名 `Youchenjiang_MealLedger`（repo 已改名 app-meal-ledger），且可能卡 new-code quality gate。需在 SonarCloud dashboard 更新綁定/門檻。
    - DeepSource: JavaScript：「blocking issues or failing metrics」，需看 DeepSource dashboard 的具體 issue/覆蓋率門檻。
  - **待辦**：(1) push `bddad26` 後確認 CI e2e 轉綠；(2) 使用者處理上述 3 個外部掃描器（帳號/設定層）；(3) 使用者決定 merge（未啟用 auto-merge，mergeStateStatus 曾為 BLOCKED）。
  - `feature/settings-restructure`（7 commits 未 push）使用者本輪未授權，暫不動。
- 餐飲記帳與記帳分析核心功能開發。
- Supabase RLS 權限策略、Edge Functions (`ai-parse`) 與 Playwright E2E 測試維護。

---

## 🏗️ Architectural Context
- **Project**: MealLedger (個人化餐飲記帳與智能辨識平台)
- **Tech Stack**: React 18, Vite 6, TypeScript, Tailwind/Lucide, Supabase (PostgreSQL + RLS + Edge Functions)
- **Quality & Testing**:
  - `npm test`: Vitest 單元測試
  - `npm run test:rls`: Supabase Row Level Security 權限驗證
  - `npm run test:e2e`: Playwright 端對端測試
  - `npm run typecheck`: TypeScript 靜態型別檢驗

---

## ✅ Completed Decisions & Lessons Learned
- Initialized with `web` scaffolding preset.
- Standardized Conventional Commits, TruffleHog secrets scan, and ZAP security baseline.
- **node_modules 必須與執行平台相符**：本 repo 透過 rollup/vite 建置，`npm run build` 與 `vitest` 需要平台對應的 rollup 原生套件。在 Windows 安裝的 `node_modules` 於 Linux 執行會因缺 `@rollup/rollup-linux-x64-gnu` 而失敗——這是跨平台 artifact，不是程式缺陷（`tsc` 型別檢查不受影響，照常通過）。
- **e2e 視覺回歸基準圖為 win32 專屬**（`*-win32.png`）：權威、乾淨的 `npm run test:e2e` 只能在 Windows 跑；在 Linux 上截圖項會因缺對應平台基準而報錯，屬環境雜訊。
- **2026-10-11 止血工作階段**：分支停擺約 4 週，留有一層未提交 WIP（內容/底部導覽重整）與一批未追蹤基礎設施。驗證後（typecheck、460 單元測試、build、commit-policy、docs 皆通過）整理成 6 個原子 commit：feat(ui) 內容/導覽重整、docs(quality)、chore(ci)、security(ci)、chore(workflow)、chore(ops)。
- **2026-10-11 落地工作階段（教訓）**：
  - **跨平台 e2e 盲點**：乾淨 Linux 上「全綠」不代表 win32 全綠。版面用 DOM 幾何量測（像素門檻）+ win32 專屬截圖基準，字型度量差異會讓 Linux 過、Windows 掛。任何動到版面的改動，**務必在 Windows 重跑 `npm run test:e2e`**，別只信 Linux。
  - **`| tee` 會吃掉 exit code**：`playwright test | tee log` 的 exit 是 tee 的（0），會把失敗偽裝成成功。要判斷成敗用重導向 `> log` 後讀 `$?`，或 `${PIPESTATUS[0]}`。
  - **第一次跑 e2e 前先 `npx playwright install chromium`**：否則每個測試會以「瀏覽器不存在」在數 ms 內全掛，看似大規模失敗其實是環境。
  - **精簡列幾何預算極薄**：帳戶·類別行在最窄一行寬（450px）只有約 1px 餘裕（需 113px、配 114px）；任何列 padding/gap/border 的增加都可能壓垮它。改 hover 等視覺時要顧及它偷走的橫向空間。
  - **在本機重現 Linux CI（避免盲改）**：e2e 的版面幾何門檻在 Windows 過不代表 Linux 過（字型度量差）。要在本機跑 CI 等效 Linux，用 `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/work" -v /work/node_modules -w /work mcr.microsoft.com/playwright:v<ver>-noble bash -lc "npm ci --ignore-scripts && npx playwright test ..."`。重點：(a) 匿名 volume `-v /work/node_modules` 遮蔽 host 的 win32 node_modules，npm ci 裝 Linux 版不會污染本機；(b) git-bash 會把 `/work` 竄改成 Windows 路徑，必須 `MSYS_NO_PATHCONV=1`；(c) `$(pwd -W)` 取 Windows 路徑給 bind mount。基準經 bind mount 直接寫回 host。
  - **Docker Desktop daemon 需先啟動**：`docker --version`/CLI 在 daemon 關閉時仍可用，但 `docker pull/run` 會報 `npipe:////./pipe/dockerDesktopLinuxEngine ... cannot find the file`。Docker Desktop.exe 在 `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`，啟動後約數秒 daemon 就緒。
