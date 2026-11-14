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

## Wave 4 — performance (Ernie)

Measured baselines recorded before dispatch so every claim is comparable.

| Surface | Baseline |
|---|---|
| prod bundle total | **4.0 MB** in `dist/assets` |
| `echarts` chunk | **1114 KB**; statically imported by EChart/HeatmapTreemap/DepthChart → Vite warns `INEFFECTIVE_DYNAMIC_IMPORT` |
| `NiftyReportShell` chunk | **577 KB** (biggest page chunk) |
| `lightweight-charts.development` | **340 KB** (dev build shipped?) |
| Screener dev DCL / FCP | **4126 ms / 4156 ms** |
| `PatternGrid` 60-card mount | **1152 ms** |
| 200-card mount | **2771 ms** (~14 ms/card) |
| 200-card identical update | 1.13 ms (good — must not regress) |

| # | Job | Files | Status |
|---|---|---|---|
| 28 | echarts must be lazy-only | 5 + vite.config | **DONE**: manualChunks matched app path `echartsSolid.ts`; scoped to `node_modules`. Chunk 1093K, referenced only by `import()`, absent from modulepreload, warning gone |
| 29 | tab paint: lazy panels, option identity, memo churn | 2 | **DONE**: ScreenerContainer shell 42.78→21.59 kB (gzip 11.97→6.19) |
| 30 | PatternCard mount cost | 4 | **DONE**: 60 cards 1152→971 ms; 200 cards 2771→2195 ms; identical-update 1.13→0.29 ms |
| 31 | NiftyReportShell chunk split | 3 | **DONE**: 591.61→26.20 kB (gzip 173.30→9.18), 13 lazy panels, each with skeleton + ErrorBoundary |
| 32 | last 3 theme offenders | 3 + palette | **DONE**: theme guard **fully green (3/3)** |

## Wave 4 results (measured)

| Metric | Before | After |
|---|---|---|
| echarts chunk | 1114 KB, preloaded, 92 static importers | 1093 KB, `import()` only, 0 preload |
| NiftyReportShell chunk | 591.61 kB | 26.20 kB (−95.6%) |
| Screener shell chunk | 42.78 kB | 21.59 kB (−49.5%) |
| PatternGrid 60 cards | 1152 ms | **310 ms** |
| 200 pattern cards | 2771 ms | **728 ms** |
| 200 cards × 120 candles | n/a | **755 ms** |
| 200-card identical update | 1.13 ms | 0.29 ms |
| Icon render (200×) | 98–101 ms | 36–56 ms (−43…−65%) |

Per-card mount is DOM-node bound (~46 nodes), not compute bound — the remaining
floor needs markup changes, which the rules forbid. The real browser-side win
left on the table is **one ECharts instance per pattern card**; gating `init`
behind an IntersectionObserver is the next candidate.

## Fixed flake

`ScreenerPage > displays loading state` failed only under 8-worker load: the
lazy `ScreenerContent` chunk paid its cold module transform *inside* the
`findBy*` budget. Resolved at collection instead. 37/37 × 3 consecutive runs.

## Outstanding (next candidates)

1. `ScreenerContent.tsx` memo churn: `sections` rebuilds columns + `new Set()` on
   every store tick (including `setIsLoading`), so `TanStackTable` reconciles the
   whole table on every poll even while hidden.
2. `PatternMiniChart` inits one ECharts instance per card — IntersectionObserver
   gating is the biggest remaining paint cost on a full results grid.
3. `bun run typecheck` — ~2200 pre-existing errors across 449 files, untouched.
4. `lightweight-charts.development` chunk is 340 KB — the dev build may be
   shipping in production.
5. `patternChartOption.test.ts` "under 20ms (median of 20)" flakes at ~26 ms
   under heavy parallel load (passes 10/10 in isolation).

## Guard status (must stay green on every commit)

- `src/test/style-keys.test.ts` — **green**
- `src/test/no-props-destructure.test.ts` — **green**
- `src/test/theme-single-source.test.ts` — **3 files left** (job 32 closes it)
- `src/test/ui-guard.test.ts` — green
- `src/test/pages.test.tsx` — **green** (backtest crash fixed: unbound `chartMode`)
- `src/ui/inputs/inputs.w-h.test.tsx` — green (19 tests)

## Git rules
Main agent only. Feature branch. Small commits. Never push develop/main.

## Wave 5 — layout / loading / professional polish

| # | Job | Scope | Status |
|---|---|---|---|
| 33 | Patterns page clipped to viewport | PatternsPage + TanStackTable | **DONE**: page/Tabs/panel/wrappers were `flex:0 1 auto`; chain now grows, table `fillContainer`. 155px dead space gone (fills to 3px), all 3 views |
| 34 | LoadingOverlay white sheet | LoadingOverlay | **DONE**: default scrim derived from `MARKER_BORDER` (#FFFFFF) @60% → now `SURFACE` @55% |
| 35 | Symbol column clipped its own key | PatternListView | **DONE**: `pattern` had no size → ate 822px; symbol 134→176, pattern→210. TATASTEEL renders 179px, no ellipsis |
| 36 | Watch tab upper bands (5 rows → 3) | WatchView | in flight |
| 37 | Admin page redesign | pages/admin | in flight |
| 38 | Remaining Min/Max → RangeInput | FnoScreenerTab, ValueFilters | in flight |
| 39 | Redundant loaders audit | heatmap/agri/paper/patterns | in flight |
| 40 | Scan tab chrome (ScanStats/AppliedFilters/Rail) | 3 components | in flight |

### Layout invariants discovered (reuse these)
- A flex child that must fill needs ALL of: `flex-1`, `min-h-0`, `h-0` on ancestors, and
  `items-stretch` (NOT `items-start`) on the row — `items-start` sizes children to content.
- `height: 100%` inside an auto-height flex parent grows to content; use `flex: 1 1 0%`.
- A column with no `size` absorbs all slack and starves its neighbours (the symbol-column bug).
- Numbers must be `font-mono tabular-nums`; the primary identifier column never truncates.
