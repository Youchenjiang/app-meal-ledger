# Agent Persistent Memory

> **Every agent session MUST read this file first** (defined in .agent/rules.md).
> **Every agent session MUST update this file before ending.**

---

## 🔑 User Preferences
- **Language**: 繁體中文 preferred for casual conversation; code/commits in English.
- **Style**: Direct, no fluff. Get things done with high engineering rigor.

---

## 📋 Current Active Tasks
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