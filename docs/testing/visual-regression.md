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
  three characters of room at their own rendered size, so they can be shortened
  but not collapsed;
- every field is at or above the plan's type floor — 16px body, 14px auxiliary —
  because the row is not allowed to buy width with unreadable type;
- the item outranks the amount, and both outrank the date / merchant /
  account · category line, measured as contrast rather than a named colour;
- both icon actions stay on one row, and a row never exceeds four text lines;
- the layout tier (one line, two, or three) matches the container width, not the
  window.

That last assertion is the regression net for the original bug: the spec runs at
a 1280px window with the container forced down to 280px, which only passes if
the row is sizing itself from its container. The tier boundaries are documented
in [ledger-row-compact-plan.md](../product/ledger-row-compact-plan.md); the
spec's `ONE_LINE_MIN_CONTAINER` and `TWO_LINE_MIN_CONTAINER` have to move with
them, and the sweep carries both boundaries plus the width just under each one.

**The width argument is a content-box width.** A container query measures the
container's content box, but the container that holds the rows has 12px of
padding and a 1px border. `setRowContainerWidth` adds that chrome back before
setting `width` and then asserts the content box it actually produced, so the
number in `CONTAINER_WIDTHS` is the number the query compares against. Without
that correction the sweep silently drifts a whole layout mode: a border-box
`450px` leaves the query `424px`, i.e. the two-line tier, and an assertion that
meant "the tightest one-line row" quietly tests something else.

Field priority is asserted, not assumed: with a deliberately long merchant and
item name, the spec requires the merchant to be ellipsised while account ·
category still render in full. The title gives way first by design.

### The type floor is what decides the tiers

The row used to carry 10px dates, an 11px merchant and account line, and a 13px
title — the "buy width with smaller type" trade the plan's §5.2 rules out: 16px
body text, 14px auxiliary, "not smaller because the data has to fit". Raising it
is not a styling change, it moves geometry, so the tiers came with it:

| Tier | Container | Tracks | Row height | item / account · category at its narrow end |
| --- | --- | --- | --- | --- |
| one line | ≥ 450px | 6 | 47px | 79 / 91px at 450 |
| two lines, meta under the name | 300–449px | 4 | 70px | 85 / 85px at 300 |
| three lines, amount on its own | ≤ 299px | 3 | 91px | 195 / 109px at 299 |

(Those are the hostile-content numbers. Against the short seed the same tiers
give 99 / 114px, 129 / 114px, and 195 / 114px — the account line stops being
squeezed at all below 450px, which is the trade working.)

The boundaries are measured, not chosen. At 16/14px a one-line row needs about
450px of container before even a *short* account · category line fits whole — the
sweep failed at 440 and at 420 with `Daily wallet · 日用` needing 113px inside
109 and then 98 — and the three-line tier exists because a 320px phone leaves the
ledger section 262px, where two lines gave the account line 45–50px: the stub
this whole document exists to prevent. The trade is row height for legibility,
and it is taken only where the width genuinely cannot pay for it.

Every floor is counted in characters and converted with the size the field
renders at (`fontSizeOf` in `layout-support.ts`): three characters of an item
name, five of the account · category line. Frozen pixels do not survive a type
change — the old `40px` floor meant three characters at 13px and would have meant
2.4 of them at 16px, so the guarantee would have shrunk while the test stayed
green.

### The item is the loudest value, not the amount

Which field *gives way* was asserted; which field *speaks loudest* was not, and
that one shipped inverted. The title inherited the muted colour from
`.draft-card span` — a rule written for the draft list the row is built from —
while the amount kept the brightest text on the page, so a reader's eye landed
on the figure before the item. No geometry assertion could see it: every
clipping check passed while the row's least important relationship was backwards.

Stated where it can be read: the item carries `--text-primary` and an explicit
`font-weight: 700` (explicit because `<strong>`'s default is `bolder`, which
would climb if an ancestor ever became bold), the amount drops to
`--text-secondary` at 600, and the date, merchant, and account · category line
stay on `--text-muted`.

`rowTextProminence` in `layout-support.ts` measures what a reader actually gets:
each field's colour, size, weight, and the WCAG contrast of that colour against
the nearest opaque ancestor of the row — the surface it is painted on, not a
hardcoded token. The guard asserts strict ordering in **both** themes, because
the app defaults to dark but also ships a light palette whose tokens resolve in
the opposite direction:

| Field | Colour (dark / light) | Contrast |
| --- | --- | --- |
| item | `rgb(233,230,223)` / `rgb(36,35,33)` | 12.70 / 15.45 |
| amount | `rgb(200,196,187)` / `rgb(76,71,64)` | 9.10 / 9.05 |
| merchant, account · category, date | `rgb(158,154,145)` / `rgb(105,100,92)` | 5.64 / 5.77 |

Two floors keep "secondary" from being satisfied the lazy way. The amount is
held at 4.5:1, so a demoted amount cannot become a number the user strains to
read; and the item's weight must be no lighter than the amount's, so colour alone
cannot let a heavier amount win the eye back.

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
| Unbounded | `.record-item`, `.record-merchant` | may be ellipsised; must keep ≥ 3 characters at their own size |
| Unbounded, but what the row is for | `.record-detail-line` | may be ellipsised; must keep ≥ 5 characters at its own size |

The distinction is the point. A date and a currency total always fit, so an
ellipsis on one is a defect at every width; an account name has no maximum
length, so the honest guarantee is that it is shortened rather than reduced to
the `Da…` stub the original defect produced.

**The supported floor is the width a 320px phone leaves the ledger section.**
Measured in the spec at a 320px viewport rather than assumed: **262px**. The
sweep runs down to 240px, deliberately below that. At and above the floor every
guarantee above holds — in the three-line tier that is 136px for the item and
109px for the account · category line at 240px, against floors of 48px and 70px.
Below the floor the sweep still runs at 220px and 200px and asserts the weaker
contract: the bounded values stay whole and no row is wider than its card. The
row degrades by giving the account · category line less room, not by dropping a
field.

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
than linked — is the place to settle that (§5.3 and §7). Its type floor (§5.2:
16px body, 14px auxiliary) has now landed and these expectations follow it; its
44×44px touch target has not — `.icon-action` is 22×22px around a 16px glyph,
about half what the plan asks for.

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

### One formatter, so a row and its total cannot disagree

The row printed its stored value verbatim (`TWD 1234567`) while the section
summary directly above it grouped (`小計 TWD 1,234,887`) — the same list showing
two conventions for the same number, and the row is where the number is actually
read. Both surfaces now go through `formatAmount` in `src/manualLedger/money.ts`:
`formatAccountBalance` (balances, reports, overview) delegates to it, and the row
calls `formatAmountString`, which parses the record's decimal string first and
falls back to the raw text rather than printing `NaN` for a value it cannot read.

The guard is a cross-surface identity rather than a copied literal. A section
holding exactly one record has a subtotal that *is* that record's amount, so the
test asserts the row's amount text appears verbatim inside the summary. Grouping
or decimals that drift apart break it without either value being read by hand. It
runs in two places: `src/App.test.tsx` ("writes a row amount and its section
subtotal the same way") and, against real rendering, in
`ledger-hostile-content.spec.ts`, where the three-currency section yields three
row-to-total pairs at once.

The summary's non-breaking space is the one deliberate difference — it stops a
currency code being stranded from its number when the summary wraps — so both
guards normalise it away and compare the number's written form instead.

## Layer 2 — pixel snapshots (baselines)

The same spec writes `toHaveScreenshot` baselines for the row at three container
widths (900 / 380 / 262) — one per layout tier, with the narrowest taken at the
262px a 320px phone actually leaves the section rather than at a round number
nothing renders at. They catch shifts the geometry sweep is blind to — spacing,
borders, colour, icon size — at the cost of being platform specific.

A legitimate refresh and a reflow look the same in a diff, so read the frame
before re-recording one, and be able to account for every number in it:

- The contrast change moved **no** frame: 346×107 / 466×90 / 926×90 before and
after, only the text pixels different. That is what a colour change looks like.
- The type-floor change moved every frame, and had to: 926×90 → 926×98 for the
one-line tier (a 39px row became 47px), with the two lower snapshots new because
the tiers themselves are new. A frame that changes with **no** documented reason
is a layout change wearing a baseline update, and belongs in the geometry sweep
instead.

Re-recording two of the three also means the superseded `ledger-row-440` and
`ledger-row-320` baselines are deleted rather than left in the directory: an
orphan PNG satisfies nothing and only suggests coverage that is gone.

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
// the type scale the row shipped before the plan's floor (10–13px)
await page.addStyleTag({ content:
  ".ledger-record-card .record-item { font-size: 13px !important; }\n" +
  ".ledger-record-card .record-detail-line { font-size: 11px !important; }" });
// item 13px against a 16px floor, account line 11px against 14px:
expect(itemSize).toBeGreaterThanOrEqual(16);
expect(detailSize).toBeGreaterThanOrEqual(14);

// and a floor frozen at the old scale (three characters at 13px) no longer
// covers three characters at 16px: 39px against 48px, so this fails:
expect(3 * 13).toBeGreaterThanOrEqual(3 * newItemSize);

// the pre-fix hierarchy: muted title, brightest amount
await page.addStyleTag({ content:
  ".ledger-record-card .record-item { color: var(--text-muted) !important; }\n" +
  ".ledger-record-card .record-amount strong { color: var(--text-primary) !important; }" });
// the item now measures 5.64:1 against an amount at 12.70:1, so the ordering
// assertion fails in the direction it is written:
expect(item.contrast).toBeGreaterThan(amount.contrast);

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

All five were run against this document's revision and did fail as written. The
last one is why `createExpenseRow` asserts the row count instead of trusting the
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
