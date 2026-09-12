# Testing Policy

## Status

**Single source of truth** for what verification is required per change area.
This mapping used to be copied into three places with different wording —
`development-workflow.md` (Risk-Driven Testing), `CONTRIBUTING.md`
(Verification Expectations), and `pr-review-checklist.md` (Test Expectations
By Risk) — which could drift apart. Those files now reference this document
and do not restate the mapping.

## Single source of truth

- **What to run** — the commands are defined in exactly one machine-readable
  place: `package.json` (`scripts`). This document explains when to use each;
  it does not restate command strings.
- **What evidence is required** — the table below is the only copy of the
  per-area verification mapping.
- **Local and CI** — the repository convention is minimal CI: GitHub Actions
  runs only `policy.yml` and `test.yml` (see `frontend-hosting.md`). The
  `Tests` workflow (`.github/workflows/test.yml`) runs `npm run typecheck`,
  `npm run build`, and `npm test` in its `test` job, and `npm run test:e2e`
  (with Chromium installed as a step of its own) in its `e2e` job — the exact
  `package.json` scripts developers run locally — so local and CI
  verification use the same commands by construction. If more test steps are
  ever added, they must invoke these same scripts, not duplicate them.

## Required verification per change area

| Change area | Required evidence |
| --- | --- |
| Ledger amounts, transfers, fund additions, refunds | Acceptance tests, or explicit manual cases, before implementation |
| Exports and import/export | Automated shape/content checks; generated-file inspection; exports never include image bytes or base64 media |
| Invoice import | Fixture-based tests for duplicates and drafts |
| RLS and auth / schema | Policy tests or SQL verification; SQL applies cleanly to a fresh or local Supabase DB |
| Production Supabase changes | [Supabase Deployment Policy](supabase-deployment.md): Git-reviewed forward-only migrations merged into `main`, deployed by the GitHub integration |
| AI / OCR | Schema validation and confirmation-flow tests; AI output stays draft/suggestion data unless the user confirms it |
| Media / privacy / R2 | Ownership, retention, and export-exclusion checks; signed upload URLs never expose R2 secrets |
| Sync / offline | Idempotency, conflict, and no-silent-overwrite checks (see `pr-review-checklist.md`) |
| UI shell / frontend | `npm run build` plus the browser smoke test (checklist in `development-workflow.md`) and a console-error check |
| Ledger row layout / narrow containers | Container-width layout sweep in `tests/e2e/ledger-layout.spec.ts`; see [Visual Regression for Layout](../testing/visual-regression.md) |
| Docs-only | Link check or reviewer walkthrough |

## When to run which command

| Situation | Command |
| --- | --- |
| TypeScript check | `npm run typecheck` |
| Unit/component suite | `npm test` (coverage: `npm run test:coverage`) |
| Commit policy self-test | `npm run test:policy` |
| RLS policy tests | `npm run test:rls` |
| Edge Function handler tests | `npm run test:edge` |
| Remote persistence smoke (needs `.env.local`) | `npm run test:remote` |
| End-to-end (Playwright, port 4174) | `npm run test:e2e` |
| Layout / visual regression of one surface | `npx playwright test tests/e2e/ledger-layout.spec.ts` ([details](../testing/visual-regression.md)) |
| Production build | `npm run build` (runs `tsc -b` then `vite build`) |

In CI, the `Tests` workflow (`.github/workflows/test.yml`) runs `npm run
typecheck`, `npm run build`, and `npm test` using these same scripts.

Ports are pinned in `package.json` scripts; see `development-workflow.md` for
the local server URL map.

## Changing this policy

Edit this table only, then update the referencing docs if the change-area
list or wording changes. Do not re-introduce per-area verification tables in
`development-workflow.md`, `CONTRIBUTING.md`, or `pr-review-checklist.md`.

CI and local `npm run test:docs` (scripts/check-docs.mjs) enforce that the
mapping lives only in this file: if a rule phrase from this table shows up in
any other file, the check fails.
