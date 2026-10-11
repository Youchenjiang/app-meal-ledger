# App Shell Test Plan

The app shell is low accounting risk, so verification focuses on build, routing, smoke tests, layout, and state visibility.

## Automated Gate

Test `npm run test` succeeds.

Test `npm run test:coverage` succeeds before committing app-shell behavior changes.

The app-shell coverage threshold is 90% lines, 90% functions, 90% statements, and 85% branches. Manual Ledger owns the detailed validation cases even when its local preview is rendered from Capture.

Automated tests must cover the local-only entry path, optional authentication-state handling, local draft handoff, draft review visibility, draft discard, and the rule that draft creation does not create confirmed ledger records. Detailed field and transfer validation belongs to the Manual Ledger test plan.

## Test Layers

### Unit Tests

Run `npm run test`.

Vitest covers the local-draft handoff helper in `src/appShell/drafts.ts`. Its accounting validation cases are tracked by the Manual Ledger spec:

- trim and required-field validation
- draft-only output shape with no confirmed-record fields

### React Integration Tests

Run `npm run test`.

React Testing Library covers the local-only entry point, all core navigation, safe unknown-route recovery, offline/online state, zero/non-zero draft counts, Capture availability states, local draft creation, and discard behavior.

### Browser Smoke

Run `npm run test:e2e`.

Playwright uses a dedicated local Vite server on `127.0.0.1:4174`, so it does not reuse the regular development server. It covers the local-only-to-Ledger draft flow, console/page errors, and document-level horizontal overflow at 1440px desktop, 720px compact, and 390px mobile viewports.

Playwright HTML reports and failed-test artifacts remain ignored by git.

### Independent Review

Before closing the spec, use three read-only reviews:

- UX: first-use clarity and whether Capture/Ledger communicate the ledger-first workflow.
- QA: requirements and test-plan coverage against the implementation.
- Responsive: mobile and desktop layout stability, overflow, and touch-target concerns.

Blocking review findings must be fixed before the final verification run. Non-blocking findings are documented as later-spec follow-ups.

## Verification Evidence

The original app-shell verification is retained as historical evidence. The current branch includes later Manual Ledger, Schema Core, Auth/Onboarding, Capture Media, and Import/Export work; its consolidated verification is recorded in `docs/specs/v1-hardening/test-plan.md`.

Read-only reviews were performed for UX, QA, and responsive behavior. UX and QA blocking findings were fixed before final verification:

- Copy now makes clear that Spec 1 stops at local draft review; it does not advertise an unavailable confirmation action.
- Local-only status appears while local drafts exist and disappears after the final draft is discarded.
- Tests cover native incomplete-form validation, offline navigation, and the active navigation state.

The responsive review found no blocking issue. It confirmed that the Ledger table deliberately scrolls inside its own `.table-card` container; Playwright asserts this containment at mobile width.

Later-spec follow-ups include dynamic field labels by transaction kind, a plain-language explanation of adjustments, localization implementation, and fully actionable import/export tools.

## Build

Test `npm run build` succeeds.

Test generated artifacts such as `dist/` are not committed.

## Routing

Test app loads at a local Vite URL.

Test Overview route renders.

Test Ledger route renders.

Test Capture route renders.

Test Settings route renders.

Test unknown routes recover to a safe state or not-found page.

## Navigation

Test primary navigation is visible after signed-in state renders.

Test active route indicator updates when navigating.

Test navigation is usable at mobile width.

Test navigation is usable at desktop width.

Test the bar keeps one shape at 320, 390, 1000, and 1440px: pinned to the bottom
edge, spanning the viewport, five equal-width items on one row sharing a single
icon row, no caption laid out as visible text, every item still reachable by its
name (the captions are the accessible names), the center 新增 a raised circle that
breaks the bar's top edge without covering the glyphs beside it, and the content
column centred with clearance for the bar.

Test the center 新增 button stays raised and dominant in both themes: the circle is
legible against the bar, its "+" is larger and heavier than a flat item's icon, and
the dark theme draws a solid ring that separates it from the near-black bar.

## State Indicators

Test unauthenticated state opens the local-only workspace without requiring sign-in.

Test signed-in state shows primary navigation.

Test offline indicator can render without blocking navigation.

Test sync-not-enabled indicator can render without presenting itself as an error.

Test review queue entry can show zero and non-zero counts.

## Empty States

Test each V1 section has a useful empty state.

Test empty states do not claim that fake balances or fake records are real.

Test Zone page shows the Manual Ledger entry point and local-draft preview.

Test Zone page shows scan, meal photo, and attachment actions; 新增 shows the voice-capture flow instead of the capture choices.

## Capture-To-Review Handoff

Test Overview Start a record navigates to Capture.

Test required manual draft fields reject an empty submit through native browser validation.

Test a valid manual draft can be submitted with date, account, type, category, merchant/source, amount, currency, and optional note.

Test expense, income, transfer, refund, and adjustment draft kinds can be selected.

Test transfer draft submission requires a transfer account.

Test transfer drafts do not render or require category and merchant fields.

Test submitted manual draft appears in the Capture review summary.

Test submitted manual draft appears in the Ledger review queue.

Test a submitted manual draft can be discarded from the Ledger review queue.

Test confirmed ledger records remain empty after draft creation.

Test local drafts remain visible after the app is remounted from persisted browser storage.

## Browser Smoke

Test browser console has no errors on initial load.

Test browser console has no errors after creating a manual draft.

Test desktop layout has no obvious overlapping text.

Test mobile layout has no obvious overlapping text.

Test UI remains readable with longer Traditional Chinese labels.

## Scope Boundary

The browser and integration suites must not claim that a draft can be confirmed in Spec 1. This spec intentionally stops at local draft creation, review visibility, and discard; official ledger writes and detailed accounting validation belong to Manual Ledger.
