# Layout invariants (no-jump)

Measured geometry for status/filter rows above result tables. Absolute pixel values below
are **observed from E2E runs, not assertions** — the specs enforce 24px heights and Δ ≤ 1px.
Re-measure before changing any header, filter band or section layout.

## 1. Market screen

- **Route**: canonical `/screener/market` (bare `/screener` defaults to market). Legacy
  `/?tab=market` redirects via `RootRedirect`; `/screener?tab=market` resolves via
  `legacyTab()` then replaces to the path form (`src/App.tsx`,
  `src/components/screener/ScreenerPage.tsx`). E2E uses `SNAPSHOT_PATH = "/?tab=market"` (`…spec.ts:20`).
- Active-filter row `market-active-chips`, rendered by the shared `FilterStatusRow`
  (`src/components/common/FilterStatusRow.tsx`): **always mounted**, **24px** (`h-6`),
  `flex-nowrap`, `whitespace-nowrap`, `overflow-x:auto` — chips scroll instead of
  wrapping. Focusable `role="region"`, `aria-label="Active filters"`, `tabIndex=0`.
  A muted "No filters" placeholder holds the same height at zero chips.
- `market-grid` top is stable across 0 ↔ 1 filter and India ↔ USA universe: observed
  **143px at 1600×900**; E2E asserts Δ ≤ 1px (not strict 0) and chips height === 24.
  E2E: `tests/e2e/market-screener.spec.ts` ("active filter row is fixed…", "USA…").

## 2. Screener page

- `screener-inline-filters` is always mounted at **24px** (`h-[24px]`, `flex-nowrap`,
  `overflow-hidden`, `whitespace-nowrap`; `src/components/screener/ScreenerInlineFilters.tsx`).
  Observed: **band top 56**, `screener-approaching-section` **top 80** (E2E: height 24, Δ ≤ 1px).
- Inner table `screener-table-approaching` top, observed: **118px at 1600×900**,
  **110px at 390×844**; unchanged across `trending` ↔ `buyer_interest_enhanced` and filter
  apply/remove (E2E asserts Δ ≤ 1px, not strict 0).
- Header (`src/components/screener/ScreenerSection.tsx`) reserves one description line
  at ≥sm (`hidden sm:block`, NBSP placeholder when the profile has no description);
  below sm the slot is hidden and titles are single-line (`max-sm:truncate`).
  E2E: `tests/e2e/screener-inline-band.spec.ts`.

## 3. Symbol chips (backtest/experiments vs replay)

- `src/components/backtest/SymbolChips.tsx` (used on `/backtest` via `BacktestConfig` and
  `/experiments` via `ExperimentsConfig`) is **still conditionally mounted**: the
  `config-symbols-chips` row appears only when `selectedSymbols.length > 0`. Measured as
  not shifting results/chart because an existing scroll/fixed container absorbs that row;
  its 12 tests in `SymbolChips.test.tsx` cover behaviour, not geometry.
- `src/components/replay/ReplayConfig.tsx:329-356` is a **different component**: a one-line
  `max-height:18px`, `overflow-hidden`, `nowrap` readout replacing a stacked chip block.

## 4. Rules

- No conditional 0↔N rows above a table: reserve the height or mount with a placeholder.
- Status rows never wrap (`nowrap` + horizontal scroll). Do not truncate desktop
  content to buy stability — collapse/compact only at narrow breakpoints.
- Measure with `getBoundingClientRect()` before and after; put both numbers and the Δ
  in the commit message. Assertions: exact 24px height, Δ ≤ 1px for tops (not strict 0),
  web-first waits (`expect.poll`, `waitForResponse`) — no `waitForTimeout`.

## 5. How to re-measure

```
npx playwright test tests/e2e/market-screener.spec.ts --workers=4
npx playwright test tests/e2e/screener-inline-band.spec.ts --workers=4
```
Use `--output=/tmp/...` to avoid clobbering. Read the `[layout]` / `[inline-band]` console
lines. Helpers: `measureLayout` (market) and `measureInlineFilterBand` (screener) — each
a single `page.evaluate` reading rects + computed style; nulls make a missing node
observable instead of a locator timeout.

## Observed, not asserted

Absolute values 143 / 56 / 24 / 80 / 118 / 110 come from E2E-run measurements; the specs
assert only 24px heights and Δ ≤ 1px, never those literals. Re-measure before relying on them.
