# App Shell Design

## Product Shape

The app opens directly into the working application, not a marketing landing page. The first viewport should make the product feel like a personal finance tool: calm, scannable, and built for repeated use.

The shell reserves product space for future ledger features while avoiding fake data that could be mistaken for real balances.

## Navigation

Primary navigation is a fixed bottom bar used at every viewport width (see
[ADR 0006](../../decisions/0006-unified-bottom-navigation.md)):

- 概覽 (Overview) — `/`
- 明細 (Ledger) — `/ledger`
- 新增 (Add) — `/capture`, rendered as the center raised circular "+" button
- 專區 (Zone) — `/zone`, hosts the capture tools (manual entry, scan, meal
  photo, attachment) that moved off `/capture` when that became the
  voice-capture flow; the content feed remains a roadmap item
- 設定 (Settings) — `/settings`

The bar shows icons only: each item's name is rendered as its accessible name
rather than a visible label. A caption under the center 新增 item alone read as
that item *missing* its label instead of as a deliberate FAB, and dropping it
only there left the captions and the circle fighting for the same strip of the
bar. With no captions the bar is one icon row tall (`--nav-height`), the five
glyphs sit centred on it, and every item is named by its clipped `.nav-caption`
so assistive tech and the UI tests still address 概覽/明細/新增/專區/設定.

The center 新增 button is the shell's only raised element: a circular
primary-colour button that breaks the bar's top edge, with a larger and heavier
"+" than the flat items beside it. Its separation from the bar is theme-specific
(the `--fab-shadow` token) — a green drop shadow reads against the light bar but
disappears against the dark one, which draws a lighter brand ring instead.

The circle is painted around the item's icon slot (`::before`, sized by
`--fab-size`) rather than replacing it, so the icon row cannot move when the
circle changes and the "+" stays centred in it. Its height above the bar is
`--fab-overhang`, and `--fab-raise` is derived from the circle size, the bar
height, and that overhang, so changing either keeps the overhang rather than
silently lifting the circle past the bar. An earlier version absolutely
positioned the circle and padded the item to compensate, which put the two on
different lines and let the ring overlap the glyphs.

The bar carries no brand block: five equal-width items leave no room for one, and
the shell used to keep the wordmark in a desktop-only rail that this decision
removes. Identity comes from the page-header eyebrow (`nav.brandCaption`), which
every route already renders at every width.

Desktop keeps the same bottom bar and caps the content area at a readable max
width instead of switching to a sidebar. Mobile and desktop use the same
layout with the same route names.

Route paths:

- `/` (Overview; legacy `/overview` redirects here)
- `/ledger` (draft review at `/ledger/draft/:draftId`)
- `/capture`
- `/zone`
- `/settings` (localization preferences at `/settings/localization`)
- `/account` — account verification; not in the primary navigation, reached from Settings

Meals and Imports are later product areas. They remain covered by their own specs and should not appear as primary app-shell navigation until their first usable workflow exists.

## Page Responsibilities

Overview shows:

- account summary placeholder
- confirmed ledger records placeholder
- draft review count
- sync/local-only status

Ledger shows:

- confirmed ledger list empty state
- local drafts waiting for review
- quick entry path back to Capture

Capture shows:

- the voice-capture flow (mode A / mode B, per the
  [voice capture spec](../voice-capture/requirements.md))

Zone shows:

- manual transaction draft form
- scan receipt or invoice action
- meal photo action
- attachment action

Settings shows:

- auth/account placeholder
- sync status placeholder
- import/export safeguard copy

## Capture Flow Across Tabs

The end-to-end capture flow spans two routes:

- 新增 (`/capture`) is the voice-first capture surface: Mode A (整段口說) and
  Mode B (逐欄口說) turn a spoken or typed description into field-block
  drafts (see the [voice capture spec](../voice-capture/requirements.md)).
- 專區 (`/zone`) hosts the non-voice capture tools — the manual transaction
  draft form, scan receipt/invoice, meal photo, and attachment actions —
  which moved off `/capture` when it became the voice flow.

Both surfaces hand off the same way: capture produces a local draft that
appears in the Ledger review queue, and an official record is written only
through the existing confirmed-record boundary.

## Minimal Manual Draft Flow

The app-shell spec includes one real, local-only path so the shell is not a dead end:

1. The user opens Overview.
2. The user selects Start a record, which lands on 新增 (/capture), the
   voice-capture flow.
3. Zone (專區) shows the minimal manual transaction draft form.
4. Zone hands the user into a local draft preview.
5. The submitted record appears as a local draft in the Ledger review queue.
6. The user can discard a local draft from the Ledger review queue.
7. The confirmed ledger table stays empty because confirmation and official ledger writes belong to later specs.

The preview is intentionally not final accounting CRUD. It does not create official records, calculate balances, persist to Supabase, or export data. Its detailed fields, account/category setup affordances, record-kind validation, and local draft shape are defined and accepted by the Manual Ledger spec. App Shell only verifies that Capture, the review queue, and the empty confirmed-ledger state remain connected.

## State Model

The shell should work with a small local UI state model before real backend wiring:

- `authState`: signed out, signed in, loading
- `networkState`: online, offline
- `drafts`: local transaction drafts waiting for review

Initial implementation can use local component state as long as the component boundaries make future Supabase wiring straightforward. Local drafts must be visibly separate from confirmed ledger records.

## Accessibility And Responsiveness

Navigation controls should be keyboard reachable.

Current route should be visually indicated.

Icon buttons need accessible labels or tooltips.

Text must fit on mobile and desktop without overlap.

The shell currently ships hardcoded Traditional Chinese copy (the [localization spec](../localization/requirements.md) defines the eventual dictionary). Layout and component sizing should still tolerate longer Traditional Chinese labels.

## Boundaries

This spec should not define database schema.

This spec should not claim acceptance of record-kind validation beyond the local-draft handoff. Domain validation belongs to the manual-ledger and schema-core specs.

This spec should not decide AI/OCR provider behavior.

This spec should link to later feature specs instead of embedding them.

## References

- [Development workflow](../../engineering/development-workflow.md)
- [Spec-driven workflow](../../engineering/spec-driven-workflow.md)
- [Product flows](../../product/flows.md)
- [Technical operations](../../v1/technical-ops.md)
