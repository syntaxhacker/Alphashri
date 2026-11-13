# Solid migration — fleet ledger

Branch: `chore/solid-style-keys` (from `refactor/solidjs-terminal`)
Scope agreed with user: **patterns, Index Report, screener, common/`@/ui`**.
Objective: remove remaining React-era reactivity defects with no visual or
performance regression. Gate for every item: targeted tests pass, `oxlint`
clean, and a regression test that FAILS before the fix.

## Shared tooling (built once, committed)

- `scripts/codemod-solid-styles.mjs` — kebab-cases `style={{}}` keys, px-quotes
  numeric lengths, skips spreads/computed, idempotent.
- `src/test/style-keys.test.ts` — guard: no camelCase key / unitless length.
- `scripts/find-jsx-maps.mjs` — AST finder for JSX-returning `.map()`.
- `src/test/no-props-destructure.test.ts` — guard: no destructured props.

## Waves

| # | Item | Files | Verdict | Evidence |
|---|---|---|---|---|
| 0 | Inline style silent-drop | 90 files | **DONE** | 3503 tests, build+lint green; live DOM shows 9.5/11/13px computed |
| 0b | Duplicate `NiftyOiHeatmap.test.tsx` shadowing (broke `tsc` ts1149) | 1 file | **DONE** | 10 unique tests merged → 54 pass, ts1149 gone |
| 1 | Patterns props destructure | 5 src + 5 test | **DONE** | 808 pass; 6 new tests fail on pre-fix code |
| 2 | Options props destructure | 3 src + 3 test | **DONE** | 308 pass |
| 3 | Backtest props destructure | 9 src | **DONE** | 241 pass |
| 4 | Report props destructure | 11 src | **IN FLIGHT** | agent working; 6/11 modified |
| 5 | `@/ui` primitives (Accordion/Menu/Tree/Overlay) | 4 src | **IN FLIGHT** | new agent dispatched |
| 6 | Report JSX `.map()` → `<For>` | NiftyDepthMap etc | **NO-OP** | agent proved all `.map()` build data, not JSX |
| 7 | Screener JSX `.map()` → `<For>` | 5 files | **NO-OP** | agent proved Lists already use `<For>` |
| 8 | `RangeToggle` + `Icons` | 2 | **DONE** | 323 pass; both had real defects |
| 9 | `FullscreenPatternList` `<For>`/`<Show>` | 1 | **DONE** | 9 pass |
| 10 | `@/ui` primitives (Accordion/Menu/Tree/Overlay) | 4 src + 4 test | **DONE** | 107 pass; fixed bool-called-as-fn crash in Accordion |
| 11 | `Collapse` + `PressureBars` destructure | 2 | **DONE** | guards green; 18 pass |
| 12 | Report props destructure (walls/pressure/erosion/movers/coil) | 11 src + 7 test | **DONE** | 1345 report tests pass |
| 13 | Breakouts endpoint hang (blank Report) | diagnosis | **IN FLIGHT** | breakouts >180s; daily 2s |
| 14 | common/ component reactivity audit | 30 files | **IN FLIGHT** | signal-read-outside-context hunt |
| 15 | Screener deep reactivity audit | 7 files | **IN FLIGHT** | memos/effects/leaks |
| 16 | `@/ui/inputs` w/h + reactivity | 14 files | **DONE** | 131 ui tests; 16/17 new tests fail pre-fix; fixed 17 defects |
| 17 | `useScreenerState` store reactivity | 1 + test | **DONE** | `state.*` are plain `let`s → memos never re-ran; tab showed "0 stocks" over a real payload |
| 18 | `formatOneDecimal` NaN | 1 + test | **DONE** | card printed `52W: -NaN%` on a half-streamed hit |
| 19 | Report per-section loading gate | 1 + test | **IN FLIGHT** | `dailyLoading() && breakoutLoading()` blanks a 2s section behind a 14min scan |
| 20 | Breakouts scan upstream-call explosion | backend | **IN FLIGHT** | 501 symbols × intraday fetch @120/min, circuit-wait 10s each |
| 21 | common table/states audit | 6 files | **IN FLIGHT** | flexRender/rowModel/body-signal hunts |

## Measured facts (do not re-derive)

- `GET /api/reports/daily` 0.0055s · `delivery` 0.0033s · `health` 0.0293s.
- `GET /api/reports/breakouts` = **>18 min** (never completed; client aborted at 180s).
- `fetch_for_timeframe(sym,"1D",include_partial_today=True)` = **10–12s**; cached 1D without it = 0.5s.
- Rate limiter `api` consumer = **120 req/min**; `upstox:circuit:until` open with +45s remaining.
- Cached 1D frames ending 2026-11-13: **0 of 501**.

## Verified no-op findings (do not redo)

- Screener/patterns already use `<For>` for every real list; the `.map()` calls
  found by regex were data builders (ECharts options, `Select data={}`,
  `Math.max` args). AST script `find-jsx-maps.mjs` is the source of truth.
- `CorrelationChart.tsx` `const {normalized, symbols} = props` is inside
  `buildOption()`, re-run per chart build — allowed, documented in the guard.

## Remaining known defects (next waves)

1. ~~`IndexMoversStrip.tsx` `MoverSection` destructured props~~ — **DONE** (wave 1 report agent).
2. ~~`NiftyChartPanel` cold-load blank page~~ — **DONE**: backend `compute_report` 3.8s cold /
   0.005s cached (was >18 min). Frontend loading scoped per tab.
3. `src/ui/inputs/**` — **DONE** (17 defects fixed, 131 ui tests).
4. `src/utils/chart/**` — 14 tsc errors, still open.
5. Theme: 25 → 21 → (in flight) files with hardcoded hex (owner groups dispatched).
6. `src/test/pages.test.tsx` backtest mount throw — in flight.

## Wave 3 — Ernie (openrouter/baidu/ernie-5.5-flash-preview:free)

Ernie verified as a capable worker (correct token mapping, honest scope reporting,
green targeted suites). Rolling all remaining work to it per user instruction.

| # | Group | Files | Status |
|---|---|---|---|
| 22 | backtest theme literals | 6 | **DONE** | 244 pass, lint clean |
| 23 | replay theme literals | 7 | in flight |
| 24 | report/patterns theme literals | 5 | in flight |
| 25 | sector/news/experiments theme literals | 6 | in flight |
| 26 | chart/options/trading theme literals | 5 | in flight |
| 27 | pages.test backtest mount throw | 1+ | in flight |

## Guard status (must stay green on every commit)

- `src/test/style-keys.test.ts` — **green**
- `src/test/no-props-destructure.test.ts` — **green**
- `src/test/theme-single-source.test.ts` — 1 case open (hardcoded hex, being cleared)
- `src/test/ui-guard.test.ts` — green
- `src/ui/inputs/inputs.w-h.test.tsx` — green (19 tests)

## Git rules
Main agent only. Feature branch. Small commits. Never push develop/main.
