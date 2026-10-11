# ADR 0006: Unified Bottom Navigation Bar

## Status

Accepted

## Context

The original app shell shipped two navigation structures: a left sidebar on
desktop and a top five-item tab row on narrow screens, maintained as two
separate media-query blocks in `src/styles.css`. MealLedger's primary use case
is capturing expenses from a phone, so mobile is not a secondary layout to
bolt on; it is the main surface. Maintaining two structures duplicated nav
state, split UI tests across desktop and mobile selectors, and made the mobile
experience feel like an afterthought.

The previous nav items were Overview (`/`), Ledger (`/ledger`), Capture
(`/capture`), Workspace/Settings (`/settings`), and Cloud & account
(`/account`).

## Decision

Replace the sidebar and top tab row with a single fixed bottom navigation bar
used at every viewport width:

- Five equal-width items: 概覽 (Overview), 明細 (Ledger), 新增 (Add, the
  center item), 專區 (Zone), 設定 (Settings).
- The center 新增 item is a raised circular "+" button in the primary color,
  visually dominant, and links to `/capture`.
- On wide screens the bottom bar stays and the content area is capped at a
  readable max width.
- `/account` remains as a route but is removed from the navigation; it is
  reached from the Settings page.
- 專區 is reserved as a tab and initially showed an empty-state placeholder.
  When 新增 became the voice-capture flow (voice capture spec), the capture
  tools (manual entry, scan, meal photo, attachment) moved to 專區, so the
  tab now has content; a future content feed (meals, photos, scan sources)
  is still tracked in the [roadmap](../product/roadmap.md).

## Consequences

Becomes easier:

- One navigation structure to style, test, and reason about; mobile and
  desktop behave identically.
- The center "+" makes the primary capture action always one tap away.
- 專區 can be filled in later without another navigation restructure.

Becomes harder:

- Desktop loses the sidebar, so wide-screen users must use the bottom bar and
  a capped content width.
- `/account` is no longer directly reachable from navigation; discoverability
  depends on the Settings entry point.
- Navigation labels are now Chinese (概覽/明細/新增/專區/設定), so UI tests
  must target those labels.

## Amendment: the bar renders icons only

The bar was implemented with a caption under each of the five items. That made
the center FAB the one item without a caption, which read as a missing label, and
any attempt to lift the circle off the bar's top edge put it in the same strip as
the captions. The bar now renders icons only: each `.nav-caption` is clipped, so
it is the item's accessible name rather than a visible label, and the bar is one
icon row tall.

The decision above is unchanged — one bottom bar at every width, five equal-width
items, the center 新增 raised as a circular "+".

Becomes harder:

- The four flat items are identified by glyph alone. 概覽/明細/設定 use widely
  understood icons, but 專區 is a name this app invented, so its grid glyph
  carries no meaning for a first-time reader until they open it.
- The names live in CSS-clipped text. An item that loses its caption loses its
  name too, which the navigation tests now assert against.

## References

- [App shell requirements](../specs/app-shell/requirements.md)
- [Voice capture plan](../product/voice-capture-plan.md)
- `src/App.tsx`
- `src/styles.css`
