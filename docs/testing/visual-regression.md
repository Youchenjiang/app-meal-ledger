# Visual Regression for Layout

Status: **active**. The compact ledger row is the first surface covered; add
selectors here when another surface gains the same guarantee.

## Why this exists

A row can keep its container size while the text inside it is clipped away. The
ledger row shipped a real instance of that: the account and category line was
allocated 24px inside a 325px row and rendered as `Da…`, while the geometry
looked fine to every other check — the container had a width, the icon actions
were on one row, and nothing overflowed the page.

Two facts shape the mechanism:

1. Unit tests cannot see it. `vitest` runs in happy-dom, which computes no box
   model, so `getBoundingClientRect()` is meaningless there.
2. Pixel diffs alone cannot explain it. A snapshot tells you something moved; it
   does not tell you that account · category collapsed into a stub.

So the guard has two layers, and the first one is the one a review can reason
about.

## Layer 1 — container-width geometry sweep (no baselines)

`tests/e2e/ledger-layout.spec.ts` seeds one ledger row through the UI, then
resizes the row's **container** (`.ledger-kind-section`) instead of the window
and asserts, per width:

- every field the row exists to expose (`.record-date`, `.record-detail-line`,
  `.record-status`, `.record-amount strong`) renders in full — `scrollWidth`
  past the element width is a failure, and the failure message names the text;
- the may-truncate fields (`.record-item`, `.record-merchant`) keep at least
  40px, so they can be shortened but not collapsed;
- both icon actions stay on one row, and a row never exceeds three text lines;
- the layout mode (one line vs stacked) matches the container width, not the
  window.

That last assertion is the regression net for the original bug: the spec runs at
a 1280px window with the container forced down to 280px, which only passes if
the row is sizing itself from its container. The row's own switch point is
documented in
[ledger-row-compact-plan.md](../product/ledger-row-compact-plan.md); keep the
spec's `ONE_LINE_MIN_CONTAINER` in step with it when it moves.

**The width argument is a content-box width.** A container query measures the
container's content box, but the container that holds the rows has 12px of
padding and a 1px border. `setRowContainerWidth` adds that chrome back before
setting `width` and then asserts the content box it actually produced, so the
number in `CONTAINER_WIDTHS` is the number the query compares against. Without
that correction the sweep silently drifts a whole layout mode: a border-box
`405px` leaves the query `379px`, i.e. the stacked layout, and an assertion that
meant "the tightest one-line row" quietly tests something else.

Field priority is asserted, not assumed: with a deliberately long merchant and
item name, the spec requires the merchant to be ellipsised while account ·
category still render in full. The title gives way first by design.

## Hostile content, not a tidy seed

`tests/e2e/ledger-hostile-content.spec.ts` repeats the sweep with the widest
values a user can actually enter, because a row that survives `香蕉 / 全聯` says
nothing about one holding `緊急預備金與長期投資專用帳戶不可隨意動用`:

- a 21-character CJK account name, a 36-character latin name, and a third
  account in a second currency;
- three records whose totals are `TWD 1,234,567`, `USD 98,765.43`, and
  `JPY 12,345,678` — one per currency, with the decimal amount on the currency
  that has cents;
- merchant and item names long enough to need the full width of a wide row.

Fields are split by whether their length is bounded, and each class gets the
weaker guarantee it can actually keep:

| Class | Fields | Guarantee |
| --- | --- | --- |
| Bounded | `.record-date`, `.record-status`, `.record-amount strong` | never ellipsised, at any width |
| Unbounded | `.record-item`, `.record-merchant` | may be ellipsised; must keep ≥ 40px |
| Unbounded, but what the row is for | `.record-detail-line` | may be ellipsised; must keep ≥ 56px (about eight CJK characters) |

The distinction is the point. A date and a currency total always fit, so an
ellipsis on one is a defect at every width; an account name has no maximum
length, so the honest guarantee is that it is shortened rather than reduced to
the `Da…` stub the original defect produced.

**The supported floor is 240px of container content width** — the room a 320px
phone (the narrowest viewport the app targets) leaves the ledger section. At and
above it every guarantee above holds. Below it the sweep still runs at 220px and
200px and asserts the weaker contract: the bounded values stay whole and no row
is wider than its card. The row degrades by giving the account · category line
less room, not by dropping a field.

### A shortened value stays reachable

An ellipsis changes what is painted, not what exists, so every field the row may
shorten carries its full value in a `title`: the item, the merchant, and the
account · category line (the date already did, and the amount, the currency, and
the actions are never shortened). The sweep asserts the title *equals* the
untruncated text, which fails both when the title is missing and when someone
fills it with the already-shortened copy. Until this check existed the row had no
title on those three fields at all, so a clipped account name was simply lost.

Limits worth knowing: a `title` is a hover affordance. Keyboard and touch users
reach the full values through the edit dialog (the row's pencil action opens it
with every field labelled), but there is no per-field expand affordance yet. The
pending content-UI restructure plan — still uncommitted, so it is named rather
than linked — is the place to settle that (§5.3 and §7), because it also moves
the row to 44px touch targets and a larger type floor, both of which these
expectations will follow.

### The summary wraps, and that is load-bearing

The section heading (`.ledger-section-heading`) carries `1 筆 · 小計 TWD …` and,
with several currencies in one section, one total per currency. It used to be
`white-space: nowrap` with `text-overflow: ellipsis`, which failed twice at once:
it hid whole currencies in an ellipsis, and its min-content width became the
min-content of the section's only grid column — so the heading dragged every row
out of the card at narrow widths (measured: rows 268px wide inside a 240px card
with two currencies, 361px with three). It now wraps, breaking at separators and
never inside a currency total: the code and its amount are joined with a
non-breaking space, because a plain space still let the break land inside a
total and strand `JPY` on the line above its own number.

Both halves are asserted, because fixing either one alone leaves the other
broken: the summary must render every currency total in full, *and* the rows must
stay inside the card while it does.

## Layer 2 — pixel snapshots (baselines)

The same spec writes `toHaveScreenshot` baselines for the row at three container
widths (900 / 440 / 320). They catch shifts the geometry sweep is blind to —
spacing, borders, colour, icon size — at the cost of being platform specific.

- Baselines live next to the spec
  (`tests/e2e/ledger-layout.spec.ts-snapshots/`) and carry a platform suffix, so
  a baseline generated on Windows does not satisfy the Linux CI runner (only the
  Windows set is committed today).
- Generate or refresh them on the platform that runs CI:

  ```sh
  npx playwright test tests/e2e/ledger-layout.spec.ts --update-snapshots
  ```

  then commit the PNGs.
- `updateSnapshots: "missing"` in `playwright.config.ts` means a missing baseline
  is **written to disk and still fails the run**, once. A new platform is loud
  rather than silently unguarded: run the spec again to compare against what was
  just written, or take the PNG from the CI artifact and commit it. An existing
  baseline is compared, and a mismatch fails with the diff in `test-results/`.
- The row prints today's date and the capture form has no date field, so the
  snapshot masks `.record-date` instead of pretending the date is stable. A
  boundary case never depends on the two-digit date being any particular width.

## Does the guard actually fire?

Don't take it on faith. Reintroduce a defect without touching the source and
watch the guard fail:

```ts
// the 24px track the account · category line got before its fix
await page.addStyleTag({ content:
  ".ledger-record-card { grid-template-columns: auto minmax(0, 1fr) 24px auto auto auto !important; }" });
await expect(expectNoClippedText(page, ROW_SELECTOR, [".record-detail-line"], "injected"))
  .rejects.toThrow(/record-detail-line renders ellipsised/);

// the nowrap summary, restored exactly (the parent has to go back too)
await page.addStyleTag({ content:
  ".ledger-section-heading { flex-wrap: nowrap !important; }\n" +
  ".ledger-section-heading > span { white-space: nowrap !important; overflow: hidden !important;" +
  " text-overflow: ellipsis !important; margin-left: 0 !important; }" });
// rows now measure 268px inside a 260px card, so this fails:
expect(row.width).toBeLessThanOrEqual(containerContentWidth + 1);

// the amount restriction that made every decimal save a silent no-op
await page.evaluate(() => document.querySelector<HTMLInputElement>("#entry-amount")!.setAttribute("step", "1"));
await page.getByRole("button", { name: "儲存記錄" }).click();
// no row is created and no draft is stored:
await expect(page.locator(ROW_SELECTOR)).toHaveCount(0);
```

All three were run against this document's revision and did fail as written. The
third one is why `createExpenseRow` asserts the row count instead of trusting the
save: a `type="number"` input with `step="1"` makes the browser reject every
amount with a fractional part, and because native validation runs before the
submit handler, the app saw nothing to report — `USD 98,765.43` could not be
saved at all, and a spec that only checked "the form is on screen" would have
passed.

## Running it

| Situation | Command |
| --- | --- |
| Layout sweep, hostile content, and snapshots | `npx playwright test tests/e2e/ledger-layout.spec.ts tests/e2e/ledger-hostile-content.spec.ts` |
| Whole end-to-end suite | `npm run test:e2e` |
| Refresh pixel baselines | `npx playwright test tests/e2e/ledger-layout.spec.ts --update-snapshots` |

CI runs the whole suite in the `e2e` job of `.github/workflows/test.yml`, which
installs Chromium and — when a layout assertion fails — uploads `test-results/`
and the snapshot directory, so a baseline written on a fresh runner is
downloadable and committable rather than lost with the workspace.

Known limit: the geometry sweep is what CI currently gates on end to end. The
pixel layer becomes a hard gate on a platform only after that platform's
baselines are committed, and the committed set is Windows-only today.

## Adding another surface

1. Give the container that holds the repeated rows `container: <name> / inline-size`.
2. Add the spec's must-fit selectors — the values a user would miss — and the
   may-truncate selectors separately; do not put both in one list.
3. Drive the container width directly (the sweep does this) rather than the
   window, so a narrow panel on a wide screen is covered.
4. Add a snapshot only if the surface has pixel-level risks the geometry sweep
   cannot see.
