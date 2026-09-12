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

Don't take it on faith. Reintroduce the defect without touching the source:

```sh
# in a scratch spec, after seeding a row
await page.addStyleTag({ content:
  ".ledger-record-card { grid-template-columns: auto minmax(0, 1fr) 24px auto auto auto !important; }" });
await expect(expectNoClippedText(page, ROW_SELECTOR, [".record-detail-line"], "injected"))
  .rejects.toThrow(/record-detail-line renders ellipsised/);
```

24px is the track the account · category line actually got before the fix. That
check passed when this document was written, which is the evidence that the
sweep fails on the original defect rather than merely describing it.

## Running it

| Situation | Command |
| --- | --- |
| Layout sweep and snapshots only | `npx playwright test tests/e2e/ledger-layout.spec.ts` |
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
