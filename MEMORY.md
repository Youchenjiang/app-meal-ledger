# Agent Persistent Memory

> **Every agent session MUST read this file first** (defined in .agent/rules.md).
> **Every agent session MUST update this file before ending.**

---

## 🔑 User Preferences
- **Language**: 繁體中文 preferred for casual conversation; code/commits in English.
- **Style**: Direct, no fluff. Get things done with high engineering rigor.

---

## 📋 Current Active Tasks
- **`feature/ledger-row-compact` 收尾與落地**：此分支承載 i18n（zh-TW 預設 + en-US fallback）、主題系統、設定頁重整、明細列精簡，以及各頁內容與底部導覽重整，共 **51 個 commit，超前 `origin/main`，尚未 push、尚未合併**。
  - 待辦：(1) `git push -u origin feature/ledger-row-compact` 與 `git push origin feature/settings-restructure`（需在有 GitHub 憑證的環境，如 Windows）；(2) 開 PR 併回 `main`；(3) 在 Windows 跑 `npm run test:e2e` 做最終視覺/版面驗收。
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
