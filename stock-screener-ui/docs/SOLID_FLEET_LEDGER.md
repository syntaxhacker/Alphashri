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
| 16 | `@/ui/inputs` w/h + reactivity | 14 files | **IN FLIGHT** | 17 tsc errors live here |

## Verified no-op findings (do not redo)

- Screener/patterns already use `<For>` for every real list; the `.map()` calls
  found by regex were data builders (ECharts options, `Select data={}`,
  `Math.max` args). AST script `find-jsx-maps.mjs` is the source of truth.
- `CorrelationChart.tsx` `const {normalized, symbols} = props` is inside
  `buildOption()`, re-run per chart build — allowed, documented in the guard.

## Remaining known defects (next waves)

1. `IndexMoversStrip.tsx` `MoverSection({rows, isGainer})` — destructured props (owned by report agent).
2. `NiftyChartPanel` cold-load: `/api/reports/daily` took **37.9s** and
   `breakouts`/`follow-through` never fired → page sat on `report-loading`.
   Reload renders fine. Investigate: are those fetches serialised behind the
   daily call, or does `REPORT_FETCH_TIMEOUT_MS` abort them silently?
3. `src/ui/inputs/**` — 17 tsc errors; check `w`/`h` prop handling.
4. `src/utils/chart/**` — 14 tsc errors.

## Git rules
Main agent only. Feature branch. Small commits. Never push develop/main.
