# Options Payoff Workstation — Implementation Spec

**Status:** Proposed · **Owner:** design (subagent lane) · **Date:** 2026-11-23
**Scope:** a tastytrade-style strike × expiry P&L workstation for an already-built multi-leg options structure.
**Non-goals:** no new order entry, no new broker calls, no new backend endpoint, no new persistence. This is a *read/replay surface* over data the app already owns.

---

## 0. Grounding — what this spec builds on (verified, not assumed)

| Need | Existing source | Reuse rule |
|---|---|---|
| Leg shape + exact expiry payoff | `src/utils/optionsMath.ts` — `OptionLeg`, `payoffAt()`, `payoffCurve()`, `probabilityOfProfit()`, `aggregateGreeks()`, `MIN_DTE_YEARS`, 365-day calendar basis | **Never re-implement** intrinsic payoff, breakevens, POP, or greek aggregation |
| Time value | `options_paper/greeks.py` — `black76()`, `greeks_from_iv()`, `RISK_FREE=0.065`, `DAYS_PER_YEAR=365`, `MIN_T_YEARS=15min` | Canonical *reference*. Port to a pure TS module; prove parity with golden values |
| IV surface (strike × expiry, nullable) | `GET /api/options/analytics/{symbol}?expiries=6` → `src/api/optionsAnalytics.ts` `OptionsAnalytics.surface.iv`, `.missing`, `.expiries`, `.strikes`; `src/utils/optionsAnalyticsMath.ts` `SurfaceGrid`; `src/state/optionsAnalytics.ts` `loadAnalytics` | Single IV source. **No new request** for a slider move |
| Front-expiry chain (premiums for parity forward) | `src/state/optionsDock.ts` `currentChain()`, `src/api/optionsDock.ts` `ChainRow` | Optional refinement; not required for v1 |
| Structure + replay frames | `src/types/optionsPaper.ts` `OptionReplayResult`, `ReplayFrame`; `src/pages/options-replay/ReplayPanel.tsx` | The workstation is mounted **inside** this page, not beside it |
| Heatmap ECharts precedent | `src/components/options-dock/analytics/surfaceChart.ts` (`buildSurfaceOption`, missing-cell decal, `expiryShort`, `strikeLabel`, `categoryAxisInterval`) | Copy the *pattern*, not the axes: we transpose strikes to rows |
| Colour / contrast | `src/ui/palette.ts` (`RAMP_*`, `NEGATIVE`, `POSITIVE`, `SURFACE_ALT`, `TOOLTIP_*`, `OPTION_PAYOFF_TOOLTIP_TEXT`, `MONO`); `src/utils/contrast.ts` (`pickTextColor`, `compositeOver`, `contrastRatio`, `parseColor`) | No raw hex outside `palette.ts` |
| Charts | `src/pages/report/echartsSolid.ts` `createECharts({onChartClick})` | Already has ResizeObserver + click hook. Use it; do not add a second chart wrapper |
| Tabs | `src/ui/data-display/Tabs.tsx` — controlled `Tabs`, roving tabindex, Arrow/Home/End built in | Use it; the six metric tabs are one registered concept list |
| Number format | `src/utils/ui-helpers.ts` — `formatSignedPnl`, `formatCurrencyCompact`, `formatPercentage` | Single formatter contract |

**Naming decision:** the codebase has no `payoffMatrix` symbol today. The new pure module is `src/utils/payoffMatrix.ts`. "Payoff workstation" is the *feature* name; `PayoffMatrix` is the data model.

---

## 1. Information architecture

### 1.1 Exact vertical order (both hosts)

```
┌ 1. POSITION HEADER        symbol · spot · expiry · DTE · status chips        [fixed 28px]
├ 2. KPI STRIP              NET DEBIT/CR · MAX LOSS · MAX PROFIT · CHANCE OF PROFIT · BREAKEVENS  [fixed 34px]
├ 3. LEG ANNOTATION ROW     4 chips: BUY/SELL K CE/PE ×lots · entry premium     [fixed 30px]
├ 4. CONTROLS               range ±% slider · IV multiplier slider · ×2 zoom · IV-source badge [fixed 34px]
├ 5. TAB STRIP              TABLE · GRAPH · P&L $ · P&L % · CONTRACT VALUE · % OF MAX RISK [fixed 30px]
├ 6. MATRIX (flex:1)        y = strikes (15 max), x = listed expiries (≤6)       [fills remaining]
└ 7. FOOTNOTE               model disclosures: r=6.5%, 365d, T floor, null state [fixed 20px]
```

The heatmap sits **between** the controls/tabs and the footnote. It is the only flexible child: `flex: 1; min-height: 0`. Every other band is `shrink-0` with an explicit height. This is what prevents layout jump on tab switch, slider drag, and a slow analytics load.

### 1.2 Replay page **vs** dock drawer

| Concern | `/options/replay/:positionId` (authoritative host) | Options dock drawer (secondary host) |
|---|---|---|
| Position header | Committed/paper position, `positionId`, source chip, playhead clock | Pending dock legs; label `PREVIEW — NOT COMMITTED` |
| KPI strip | From `OptionReplayResult` (`netDebit`, `maxProfit`, `maxLoss`, `breakevens`) + `probabilityOfProfit()` at **playhead DTE** | From `payoffCurve(legs, spot)` + dock chain IV; labelled `AT EXPIRY` |
| Leg annotation | `result.legs` (entry premium × qty) | `optionsDockState.legs` (`DockLeg`, keyed by `${expiry}|${type}|${strike}`) |
| Matrix columns | All listed expiries from analytics; **only the column equal to `position.expiry` is scrubbable** | All listed expiries; no scrub, click sets a scenario lens only |
| Cell click | Scrub playhead to the frame whose `spot` is nearest the clicked strike, **only in the position's expiry column**; other columns set the lens and expose “Open this expiry in dock” | Set scenario lens; no navigation. “Replay this structure” deep-links to `/options/replay` after commit |
| Playback controls | Existing `ReplayPanel` PLAY / speed / scrubber stay above the workstation | Absent |
| Analytics fetch | `loadAnalytics(symbol, signal)` once per host mount; cached per symbol by `optionsAnalyticsState` | Same shared store; a second open costs **zero** requests |

**Why this split:** the replay has one real expiry and a frame timeline; a cell from a different expiry cannot name a frame in that timeline. Pretending it can is data corruption. The dock has no frames at all, so it can only present scenarios. One component (`PayoffWorkstation`) serves both via a thin host adapter — no duplicated math, no duplicated chart.

**Not in either host:** the existing five-tab `AnalyticsTabStrip` (`PAYOFF/IV BY STRIKE/IV BY EXPIRY/IV MAP/POSITION ODDS`). It answers *market* questions; the workstation answers *my position* questions. Do not merge them; link from analytics `PAYOFF` → workstation.

---

## 2. Data model

### 2.1 Inputs

```ts
interface MatrixInput {
  legs: readonly OptionLeg[];          // from replay result OR DockLeg (same shape)
  spot: number;                        // live/playhead spot; > 0
  analytics: OptionsAnalytics | null;  // IV surface + expiries + dte + atmIv
  entryTimeMs: number;                 // replay as-of, else Date.now()
  rangePct: number;                    // 0.02..0.25, default 0.10
  ivMultiplier: number;                // 0.5..1.5, default 1.00 (scenario, not a quote)
  ivSource: "surface" | "nearest" | "atm"; // default "surface"
  zoom: 1 | 2;                         // sampling density only
  forward?: number | null;             // optional parity-implied F from the dock chain
}
```

### 2.2 Matrix lattice

```ts
interface MatrixCell {
  strike: number;         // row: scenario S_T
  expiry: string;         // column: YYYY-MM-DD, one of analytics.expiries
  dte: number;            // calendar days (integer) from analytics.expiries[].dte
  tYears: number;         // max((close-expiry - now)/365d, 15min/365d)
  pnl: number | null;     // null == NO IV — never 0
  contractValue: number | null;
  iv: number | null;      // row strike's IV (for tooltip/legend)
  ivResolved: { value: number; source: "surface"|"nearest"|"atm"|"override" }[]; // per leg
  greeks: { delta: number|null; gamma: number|null; theta: number|null; vega: number|null; partial: boolean };
  forward: number;
}

interface PayoffMatrix {
  strikes: number[];        // ascending, ≤15 (zoom 1) / ≤8 (zoom 2), snapped to SurfaceGrid.tick
  expiries: string[];       // ≤ ANALYTICS_MAX_EXPIRIES (6), ascending by date
  cells: MatrixCell[];      // dense row-major: index = col * strikes.length + row
  domain: { min: number; max: number }; // fixed = ±max(|maxProfit|, |maxLoss|, 1)
  definedRisk: number;      // abs(maxLoss), floored at 1
  rowCount: number; colCount: number; sampledFrom: number;
}
```

- **Rows** are the scenario terminal spot, never " leg strikes". They are the analytics lattice strikes inside `[spot·(1−rangePct), spot·(1+rangePct)]`, snapped to `SurfaceGrid.tick`. Synthetic strikes are forbidden. All leg strikes are force-included (so the annotation marks land on real rows) even if they fall just outside the window; the badge then reads `n of m strikes · leg strikes pinned`.
- **Columns** are the *listed* expiries from `analytics.expiries` (max 6, per `ANALYTICS_MAX_EXPIRIES`). No interpolated DTE columns: a fabricated expiry would imply a quoted IV that does not exist.
- `dte` comes from the backend (`AnalyticsExpiry.dte`), `tYears` is computed from the expiry's 15:30 IST close and `entryTimeMs`, floored at `15/(365·24·60)` exactly as `greeks.py`. Never derive DTE from `df.index` UTC.

### 2.3 Pricing — Black-76, not intrinsic-only

`payoffAt()` is an **expiry** payoff (intrinsic). A DTE=0 column must keep using it; every DTE>0 column is **mark-to-model**:

```
r      = 0.065                          # options_paper/greeks.py RISK_FREE
T      = max((close_15_30_IST - now)/ (365·86400·1000), 15/(365·24·60))
F      = forward ?? spot · e^(rT)       # forward from put-call parity when available
d1     = (ln(F/K) + 0.5·σ²·T) / (σ·√T)
d2     = d1 − σ·√T
CE     = e^(−rT) · (F·N(d1) − K·N(d2))
PE     = e^(−rT) · (K·N(−d2) − F·N(−d1))
```

`N` is the Abramowitz–Stegun CDF already in `utils/optionsMath.ts` (export it; do not add a second approximation). Python uses `math.erf`, TS uses A&S — expect ≤2e-7 divergence, so the parity tolerance is **1e-4 on premium** and **1e-3 on greeks**, not exact equality.

**Forward**: `options_paper/greeks.py:implied_forward()` uses `F = K + (C−P)e^{rT}` from a CE/PE quote pair — that is the market's own forward and is preferred when the dock chain is available. The analytics surface carries IV but no premiums, so the default is `F = S·e^{rT}`. Never mix this with `greeks.py:bs_price()` (spot-based, r default 5%); the two differ by the forward adjustment and would silently reprice every cell.

**Per-cell P&L** — note the scenario spot is the *row*, but each leg's vol is read at the *leg's* strike:

```
scenarioSpot S* = cell.strike
σ_leg           = resolveIv(leg.strike, cell.expiry) applied ivMultiplier
theo_leg        = black76(F, leg.strike, T, σ_leg, leg.type, r)
sign_leg        = +1 BUY / −1 SELL
units_leg       = leg.lots · leg.lotSize
cell.pnl        = Σ sign_leg · units_leg · (theo_leg − leg.premium)
cell.contractValue = Σ sign_leg · units_leg · theo_leg
```

`ivSource="flat"/"atm"` replaces **every** σ_leg with that expiry's `atmIv` — that is the only case where the row's displayed IV and the legs' IV agree. Tooltip must disclose when they differ.

### 2.4 IV resolution and the explicit null state

3-tier, deterministic, no silent zero-fill:

1. `surface`: `analytics.surface.iv[expiryIdx][strikeIdx]` when `missing[expiryIdx][strikeIdx] === false` and value > 0.
2. `nearest`: nearest quoted strike in the same expiry column within **one tick** (`SurfaceGrid.tick`); record `ivResolved.source = "nearest"` with the matched strike.
3. `atm`: `analytics.expiries[i].atmIv`; record source `"atm"`.

If none resolves → `cell.pnl = null`, `cell.iv = null`, painted with the hatched "NO IV" treatment from `surfaceChart.ts`, excluded from domain computation and tooltip prints `NO IV QUOTE · <expiry> <strike>`. A missing cell is never `0`, never interpolated across DTE, never filled from the next expiry. `ivMultiplier` applies multiplicatively (`σ·m`) to preserve smile shape; it is a **scenario control**, labelled `IV ×1.00 (scenario)`, never merged into the quote.

### 2.5 KPI definitions (no re-derivation)

| KPI | Source | Rule |
|---|---|---|
| NET DEBIT / CREDIT | `result.netDebit` or `netPremiumOf(legs)` | Credit positive; label flips at 0 |
| MAX LOSS | `payoffCurve().maxLoss` | **Signed negative P&L** — display with `formatSignedPnl`; `definedRisk = Math.abs()`; never assume magnitude |
| MAX PROFIT | `payoffCurve().maxProfit` | `null` ⇒ `∞`, never a window-truncated number |
| CHANCE OF PROFIT | `probabilityOfProfit(legs, spot, atmIv, tYears).pop` | Closed-form at the **selected** DTE; NaN ⇒ `—`, never `0%` |
| BREAKEVENS | `payoffCurve().breakevens` | Expiry breakevens; label `BE (expiry)`; markLines snap to nearest row with `(≈)` |

---

## 3. Visual encoding — exact ECharts option

### 3.1 Colour ramp (derived, no raw hex)

```ts
const RAMP = [
  palette.NEGATIVE,                                  // −M   (solid)
  compositeOver(palette.NEGATIVE, palette.BG, 0.42),  // −M/2
  palette.SURFACE_ALT,                               //  0
  compositeOver(palette.POSITIVE, palette.BG, 0.42),  // +M/2
  palette.POSITIVE,                                  // +M   (solid)
];
```

`compositeOver` lives in `src/utils/contrast.ts` and returns opaque `#RRGGBB`, so ECharts never composites alpha over an unknown background. Add `mixColors(a,b,t)` to that module and use it for both `rampColorAt()` (label ink) and the ramp stops — one interpolation implementation, no drift.

`rampColorAt(v, min, max, RAMP)` mirrors ECharts' continuous `inRange.color` behaviour: clamp `t=(v−min)/(max−min)`, scale to `[0,n−1]`, linearly interpolate RGB between adjacent stops. Per-datum `label.color = pickTextColor(rampColorAt(v,…))`. Every pair is registered in `src/test/contrast.test.ts` with `contrastRatio ≥ 4.5`.

Rejected: `RAMP_STRONG_*` / `RAMP_RED` / `RAMP_GREEN` from `palette.ts` are byte-pinned by NIFTY/sector snapshots and their luminance is not monotonic around zero. Rejected: a piecewise `visualMap` — band edges would move with the structure and the same colour would mean different money after a slider drag.

### 3.2 Option builder — `buildPayoffMatrixOption(input)`

```ts
{
  animation: false,
  backgroundColor: "transparent",
  grid: { left: 2, right: 8, top: 18, bottom: 2, containLabel: true },
  tooltip: {
    trigger: "item", position: "top",
    backgroundColor: palette.TOOLTIP_BG,
    borderColor: palette.TOOLTIP_BORDER,
    textStyle: { color: palette.OPTION_PAYOFF_TOOLTIP_TEXT, fontSize: 10 },
    formatter: (p) => payoffCellTooltip(cellAt(p.data)),  // HTML-escaped
  },
  xAxis: {                                   // expiries across the top
    type: "category",
    data: expiries.map((d,i) => `DTE ${dte[i]} · ${expiryShort(d)}`),
    axisLine: { lineStyle: { color: palette.AXIS_LINE } },
    axisTick: { show: false },
    axisLabel: { color: ink, fontSize: 10, interval: categoryAxisInterval(colCount, 6), hideOverlap: true },
    splitArea: { show: false },
  },
  yAxis: {                                   // strikes down the left, ascending = top is highest
    type: "category", data: strikes.map(strikeLabel),
    axisLine: { show: false }, axisTick: { show: false },
    axisLabel: { color: ink, fontSize: 10, hideOverlap: true },
    splitArea: { show: false },
  },
  visualMap: {
    type: "continuous", min: -domain.max, max: domain.max,
    calculable: false, orient: "horizontal", top: 0, right: 2,
    itemWidth: 44, itemHeight: 6, series: [0],
    text: ["PROFIT", "LOSS"], textGap: 4,
    textStyle: { color: ink, fontSize: 10 },
    inRange: { color: RAMP },
  },
  series: [
    {
      name: "P&L", type: "heatmap",
      data: pricedCells.map(c => ({
        value: [c.col, c.row, metricValue(c)],
        label: { color: pickTextColor(rampColorAt(metricValue(c), -M, M, RAMP)) },
      })),
      label: { show: true, fontSize: 9, fontFamily: palette.MONO,
               formatter: (p) => metricLabel(p.value[2]) },
      itemStyle: { borderColor: palette.BG, borderWidth: 0.5 },
      emphasis: { itemStyle: { borderColor: palette.TEXT, borderWidth: 1 } },
    },
    {
      name: "NO IV", type: "heatmap",
      data: nullCells.map(c => ({ value: [c.col, c.row, 0],
        tooltip: { formatter: () => noIvTooltip(c) } })),
      itemStyle: { color: palette.SURFACE_ALT, borderColor: palette.BORDER, borderWidth: 0.5,
        decal: { symbol: "rect", symbolSize: 1, dashArrayX: [1,5], dashArrayY: [1,0],
                 rotation: Math.PI/4, color: palette.BORDER } },
      silent: false,
    },
    {
      name: "marks", type: "line", data: [], silent: true,
      markLine: { silent: true, symbol: "none",
        data: [
          { yAxis: strikeLabel(nearestStrike(spot)), lineStyle: { color: palette.PRIMARY, type: "dashed", width: 1 },
            label: { formatter: "SPOT", color: palette.PRIMARY, fontSize: 9,
                     backgroundColor: palette.SURFACE, padding: [1,3] } },
          ...legs.map(leg => ({ yAxis: strikeLabel(leg.strike),
            lineStyle: { color: leg.side === "buy" ? palette.POSITIVE : palette.NEGATIVE, type: "dotted", width: 1 },
            label: { formatter: `${leg.side.toUpperCase()} ${leg.strike} ${leg.type}`, color: ink, fontSize: 9,
                     backgroundColor: palette.SURFACE, padding: [1,3] } })),
          ...breakevens.map(be => ({ yAxis: strikeLabel(nearestStrike(be)),
            lineStyle: { color: palette.CHART_AVG_ENTRY, type: "dashed", width: 1 },
            label: { formatter: `BE ${formatCurrencyCompact(be)} ≈`, color: palette.CHART_AVG_ENTRY, fontSize: 9,
                     backgroundColor: palette.SURFACE, padding: [1,3] } })),
        ]},
      markArea: {
        silent: true, itemStyle: { color: alpha(palette.POSITIVE, 0.06) },
        label: { show: true, formatter: "PROFIT ZONE", position: "insideTop",
                 color: palette.POSITIVE, fontSize: 9 },
        data: beLow != null && beHigh != null
          ? [[{ yAxis: strikeLabel(nearestStrike(beLow)) }, { yAxis: strikeLabel(nearestStrike(beHigh)) }]]
          : [],
      },
    },
  ],
}
```

`ink` comes from `useChartInk()` (`analytics/chartInk.ts`) — canvas cannot resolve CSS vars. `visualMap.series:[0]` keeps the hatched null series off the value ramp, exactly as the existing IV map does.

**markLine caveat:** category axes only accept existing category values. Spot and breakevens snap to the nearest sampled row and are labelled `≈`; leg strikes are force-included rows so they never snap. The profit-zone band is a row-interval approximation, not a continuous price interval — state that in the footnote.

### 3.3 Tooltip content (fixed order)

```
NIFTY · 24 NOV 26 · DTE 3 · 24 NOV 15:30 IST
Scenario spot  ₹24,150     IV  14.2%  (surface, K 24,150)
P&L            +₹3,210     +42.8% of max risk
Contract value ₹1,140
Δ +12.4   Γ 0.31   θ −86.4/day   ν ₹420/pt
Breakevens 24,050 / 24,450  ·  POP 68%
```

- Escape every string field (`symbol`, expiry) with `escapeHtml` before concatenation — chain strings are upstream data.
- `null` greek renders `—`, and a `partial` flag appends `some greeks unavailable`; zero-filling a missing delta would turn a neutral basket directional on paper.
- When `ivResolved` differs per leg, append `leg vols: 24,000 CE 13.8% · 24,500 PE 15.1%` so the row IV is not mistaken for every leg's vol.

### 3.4 Six metric tabs — one registry, six transforms

`src/components/options/payoff-workstation/matrixTabs.ts` is the only place ids, labels and formatters live:

| id | label | value | domain |
|---|---|---|---|
| `table` | TABLE | P&L ₹ exact in a TanStackTable DOM grid | — (no colour ramp; `TINT_POSITIVE`/`TINT_NEGATIVE` only) |
| `graph` | GRAPH | P&L ₹ heatmap + labels | `±max(|maxProfit|,|maxLoss|,1)` |
| `pnlRs` | P&L $ | same as graph | same |
| `pnlPct` | P&L % | `pnl / |entryNetPremium| · 100`, zero divisor ⇒ `null` | `±100` clamped to observed |
| `contractValue` | CONTRACT VALUE | `cell.contractValue` | symmetric `±max|contractValue|` |
| `riskPct` | % OF MAX RISK | `pnl / definedRisk · 100` | `±100` |

`table` uses the shared `src/components/common/TanStackTable.tsx` with explicit `meta.align` per column (text left, numbers right, flags centre) per `TABLE_CHECKLIST.md`. It is a second rendering of the **same** `MatrixCell[]`, not a second data path. A test asserts the registry ids equal the six tab ids in the E2E spec — no hand-maintained duplicate list.

### 3.5 Layout at 1600 and 390

- **1600**: matrix panel ~360px tall, 15 rows × 6 cols → ~22px row height; full `+₹3,210` labels fit. KPI strip 5-up; legend right-aligned above grid.
- **390**: KPI strip goes 2-up (per the existing `ReplayPanel` `CompactStatGrid` precedent); tab strip `overflow-x-auto` with no wrap and fixed 30px height; matrix keeps 6 columns (≈56px each) and 8 rows at `zoom=2`; strike labels thin to ≤7; cell label is compact (`+3.2k`, `−1.1k`, or just sign below 320px) with the exact number in tooltip and the a11y grid. No vertical scroll inside the chart: row cap guarantees ≥26px rows in a 260px panel.
- **No layout jump**: fixed band heights, `font-variant-numeric: tabular-nums`, fixed-width value readouts (`w-16`), skeleton with identical geometry, `contain-intrinsic-size` on the lazy chart slot, and `createECharts`' ResizeObserver for canvas resize. Never key the panel on loading state.

---

## 4. Interaction

| Gesture | Behaviour |
|---|---|
| Hover cell | ECharts item tooltip (§3.3); emphasis border `palette.TEXT`; no DOM reflow |
| Click cell, replay page, position-expiry column | Set scenario lens; find replay frame minimising `|frame.spot − cell.strike|` among frames with `t ≤ asOf` and matching expiry; call `setReplayIndex` via a new optional `playheadRequest` prop on `ReplayPanel`. Never write to a different expiry's timeline |
| Click cell, other column / dock | Set scenario lens only; show “Open this expiry in dock” action. Lens persists until cleared; it does **not** change `netDebit`/KPI provenance — the KPI strip stays position facts, lens values are prefixed `SCENARIO` |
| Range slider | Rebuild row lattice. No request. `onInput` → `createMemo`; 15×6×4 legs ≈ 1.8k flops, sub-ms |
| IV slider | Multiplier `0.5–1.5` step `0.05`; recompute all cells; tooltip always shows base + effective IV |
| ×2 zoom | Toggle sampling density: max rows 15 → 8; row height doubles. **Not** CSS `transform: scale` (blurs 9px text and breaks hit testing) |
| Tab switch | `Tabs` controlled `value`; one chart instance, `setOption(option, true)`; fixed panel height |
| Keyboard | Visible canvas is `aria-hidden="true"`. A sibling `sr-only` `role="grid"` mirror exposes one focusable `<button>` per cell with full `aria-label`; roving `tabIndex`, Arrow/Home/End/PageUp/PageDown, Enter/Space = click. `Tabs` already supplies tab keyboard parity |
| Reduced motion | No animation on the chart; reuse `reducedMotionClass()` from `src/pages/options-replay/replayMotion.ts` for the lens highlight |

`onChartClick` receives ECharts params; map `dataIndex` back through the same dense `cells` array used by the a11y grid so mouse and keyboard select identical cells.

---

## 5. Components and files (exact)

**New files**

| Path | Responsibility |
|---|---|
| `src/utils/payoffMatrix.ts` | Pure: Black-76 price + greeks port, `resolveIv`, `buildPayoffMatrix`, `metricValue`, `sampleStrikes`. No fetch/store/DOM |
| `src/utils/payoffMatrix.test.ts` | Lattice, sampling, null handling, domain, parity with `payoffAt` at DTE 0 |
| `src/utils/payoffMatrix.black76.parity.test.ts` | Golden values from `options_paper/greeks.py` (CE/PE/IV/greeks; 1e-4 / 1e-3 tolerance) |
| `src/components/options/payoff-workstation/matrixTabs.ts` | `MATRIX_TABS` descriptor registry + formatters + domains |
| `src/components/options/payoff-workstation/payoffMatrixChart.ts` | `buildPayoffMatrixOption` + `rampColorAt` + `payoffCellTooltip`; pure, assertable without canvas |
| `src/components/options/payoff-workstation/payoffMatrixChart.test.ts` | Option shape, markLine/markArea, null series, ramp, tooltip escaping |
| `src/components/options/payoff-workstation/MatrixKeyboardGrid.tsx` | `sr-only` a11y mirror |
| `src/components/options/payoff-workstation/PayoffMatrixPanel.tsx` | Header, KPIs, annotation, controls, tabs, chart, footnote; host-agnostic props |
| `src/components/options/payoff-workstation/PayoffWorkstation.tsx` | Host adapter: replay vs dock props, analytics load, scrub callback |
| `src/components/options/payoff-workstation/PayoffWorkstation.test.tsx` | Both host modes, sliders, tabs, scrub, null state |
| `tests/e2e/payoff-workstation.spec.ts` | 1600/390, six tabs, null IV, scrub, keyboard |
| `tests/mocks/apiResponses.ts` | **Edit**: add `setupPayoffWorkstationMocks(page)` next to `setupValueScanMocks` |

**Existing files touched (small, named changes)**

| Path | Change |
|---|---|
| `src/utils/optionsMath.ts` | Export `normalCdf` (one line) for the Black-76 port |
| `src/utils/contrast.ts` | Add `mixColors(a,b,t)`; no other change |
| `src/pages/options-replay/ReplayPanel.tsx` | Optional `playheadRequest?: {strike:number; expiry:string; token:number}` prop + effect mapping it to `setIndex`; mount `<PayoffWorkstation>` below playback |
| `src/test/contrast.test.ts` | Add 5 ramp-stop × text pairs |
| `docs/AGENT_QUICKSTART.md`, `docs/MAP.md` | One-line pointers to the new module |
| `changelog/YYYY-MM-DD.md` | Feature entry (per repo rule) |

**No new endpoint.** `GET /api/options/analytics/{symbol}?expiries=6` already returns everything needed. No backend change means no `openapi.yaml` regeneration.

---

## 6. Tests and E2E

**Unit / integration (narrow commands only)**

```
npx vitest run src/utils/payoffMatrix.test.ts
npx vitest run src/utils/payoffMatrix.black76.parity.test.ts
npx vitest run src/components/options/payoff-workstation/
```

- `payoffAt` parity: for `dte=0`, matrix cells equal `payoffAt(cell.strike, legs)` within 1e-6.
- Black-76 parity: golden CE/PE prices + delta/gamma/theta/vega generated once from `options_paper/greeks.py` and pasted as fixture constants; this is the only Python-backed test, no subprocess in CI.
- Missing IV: one `null` cell cannot compress the ramp; tooltip says `NO IV QUOTE`, cell is excluded from domain.
- Flat/nearest/ATM resolution: source recorded per leg; nearest never crosses one tick.
- `aggregateGreeks` null propagation: one missing greek ⇒ `partial: true`, that greek `null`.
- `rampColorAt` at all 5 stops equals the stop token; `pickTextColor` ≥4.5:1 for each.

**Guard suite (run once, after the lane is quiet)**

```
npx vitest run src/test/ui-guard.test.ts
npx vitest run src/ui/inputs/inputs.w-h.test.tsx
npx vitest run src/test/contrast.test.ts
npx vitest run src/test/design-scale.test.ts
npx vitest run src/test/style-keys.test.ts
npx vitest run src/test/no-props-destructure.test.ts
npx vitest run src/test/routes.test.ts
npx oxlint src/utils/payoffMatrix.ts src/components/options/payoff-workstation/
bun run build
npx tsc --noEmit 2>&1 | grep -c "error TS"   # must not exceed the recorded 322
```

**E2E testids** (stable, no raw numbers in selectors):

```
payoff-workstation            payoff-header            payoff-kpi
payoff-leg-annotation         payoff-controls          payoff-range-slider
payoff-iv-slider              payoff-iv-readout        payoff-zoom-toggle
payoff-tabs                   payoff-tab-table         payoff-tab-graph
payoff-tab-pnl-rs             payoff-tab-pnl-pct       payoff-tab-contract-value
payoff-tab-risk-pct           payoff-matrix-chart      payoff-a11y-grid
payoff-cell-{col}-{row}       payoff-no-iv             payoff-tooltip
payoff-lens-banner            payoff-open-expiry       payoff-scrub-hint
```

E2E cases: (1) 1600 all six tabs, (2) 390 all six tabs with no horizontal overflow, (3) IV slider changes cell values but **not** the URL or request count, (4) range slider changes row count, (5) ×2 halves row count, (6) click a cell in the position column moves `replay-clock`, (7) click a cell in another column does **not** move it, (8) keyboard ArrowRight + Enter selects the same cell as mouse, (9) a null-IV fixture renders the hatch and `NO IV QUOTE`, (10) no `undefined`/`NaN` in any rendered frame.

**Visual evidence (mandatory per `AGENTS.md`):** screenshots at 1600 and 390 for every tab, plus empty/loading/no-IV; commit under `docs/screenshots/payoff-workstation/`, **read each PNG back**, embed raw URLs in the PR. A blank/suspiciously small frame means the change is not done.

---

## 7. Phases and commit boundaries

**Phase 1 — smallest reviewable chart** (`feat/payoff-workstation-chart`)
- `payoffMatrix.ts` + both pure test files; `payoffMatrixChart.ts` + option tests.
- Mount a **read-only** `<PayoffMatrixPanel>` on `/options/replay/:positionId` using the shared analytics store; no sliders, no tabs, no click. Defaults: range ±10%, IV ×1.00, metric `graph`, 15 rows.
- Gate: build + lint + the two pure test files + one 1600 and one 390 screenshot, **read back**. This is the first reviewable commit; it proves the pricing and the chart, nothing else.

**Phase 2 — interactions** (`feat/payoff-workstation-interactions`)
- Add controls, six-tab registry, DOM table, a11y grid, scenario lens, replay scrub wiring, `playheadRequest` prop.
- Gate: the narrow vitest set + one E2E spec (`--workers=4`, `--output=/tmp/payoff-e2e`) + keyboard/number-invariance checks.

**Phase 3 — polish** (`chore/payoff-workstation-polish`)
- 390 tuning, contrast guard entries, docs/map/changelog pointers, full screenshot set, `tsc` count check.
- Gate: all guard suites + `bun run build` + `npx oxlint`; PR body includes screenshots and the measured before/after panel heights.

**Commit size:** ≤120 lines per commit; commit after each green checkpoint on the feature branch. Never push `develop`/`main`.

---

## 8. Decision log — trade-offs (the ten that matter)

### D1 — Compute premiums client-side in TS, with Python only as the golden reference
**Pros:** zero added requests; slider moves are pure `createMemo`; matches the dock's "leg change costs zero requests" invariant.
**Cons:** two implementations of Black-76 must stay in sync.
**Alternatives:** new backend `/api/payoff/matrix` (extra round trip, rate-limit pressure, breaks instant sliders); pure intrinsic-only (silently ignores theta/vega — the exact bug this feature fixes).
**Decision:** TS port + parity fixture. Python stays canonical; drift is caught by a test, not by discipline.

### D2 — Black-76 on the forward, with `F = S·e^{rT}` default and parity forward when available
**Pros:** consistent with `options_paper/greeks.py`; no mixing with the 5% spot-based backtest model.
**Cons:** forward assumption is a model choice; must be disclosed.
**Alternatives:** `bs_price()` (spot-based, different r); intrinsic-only (wrong for DTE>0).
**Decision:** forward-based, r=6.5%, calendar 365, 15-minute floor; footnote discloses all three.

### D3 — Columns are listed expiries only; no interpolated DTE
**Pros:** every column has real quotes; no invented IV; max 6 matches the analytics contract.
**Cons:** irregular DTE spacing (e.g. 1, 4, 11, 18) looks less tidy than a 7/14/21 ladder.
**Alternatives:** synthetic DTE grid from term-structure interpolation (fast, but presents fabricated quotes as market data).
**Decision:** real expiries, labelled `DTE n · DD MON`; spacing is a property of the market.

### D4 — Missing IV is `null` + hatch, never 0 and never ATM-filled by default
**Pros:** matches `optionsAnalytics.ts`'s "missing stays null" contract; prevents fake 0-vol wings.
**Cons:** some cells are blank on a thin chain.
**Alternatives:** zero-fill (corrupts the ramp); silent ATM fill (hides coverage gaps).
**Decision:** strict surface resolution; nearest-within-one-tick and ATM are *explicit* modes with source badges.

### D5 — Fixed colour domain anchored to defined risk, not per-frame min/max
**Pros:** the same colour always means the same money; slider drags do not recolour the whole sheet.
**Cons:** on a wide structure small P&Ls look neutral.
**Alternatives:** auto-scale (pretty, unreadable across states); piecewise bands (edges move).
**Decision:** `±max(|maxProfit|,|maxLoss|,1)`, derived from the expiry payoff.

### D6 — Replay scrub only in the position's expiry column
**Pros:** a cell never maps to a frame that does not exist; no silent timeline corruption.
**Cons:** three columns are read-only in replay.
**Alternatives:** map any column to the nearest frame by spot (looks fine, is a lie).
**Decision:** strict column gate + explicit “Open this expiry in dock” action.

### D7 — DOM a11y grid behind the canvas, not an ARIA label on a div
**Pros:** real roving tabindex, screen-reader values, and stable E2E selectors for a canvas component.
**Cons:** a few extra DOM nodes and a duplicated cell loop.
**Alternatives:** `aria-label` on the chart div (unusable for 90 cells); no a11y (keyboard parity violation).
**Decision:** `sr-only` `role="grid"` mirror sharing the dense cell array.

### D8 — `Tabs` compound component + one metric registry
**Pros:** keyboard parity free; one descriptor per concept; no six hand-maintained switch branches.
**Cons:** the DOM-table tab needs a second renderer.
**Alternatives:** custom buttons (re-implement roving tabindex); six separate components (drift).
**Decision:** registry drives values, formatters, domains and tab ids; Table is a renderer, not a data path.

### D9 — No new backend endpoint / OpenAPI change
**Pros:** no drift-guard work, no rate-limit cost, release path stays short.
**Cons:** the parity forward cannot be derived when only analytics is loaded.
**Alternatives:** backend matrix endpoint (more correct forward, much slower interaction).
**Decision:** v1 client-side; parity forward is an optional enhancement when the dock chain is present.

### D10 — Mount in replay first, dock second; one component, two adapters
**Pros:** replay supplies the position, frames and expiry identity the feature needs to be meaningful; dock reuse is then mechanical.
**Cons:** dock users do not see it in phase 1.
**Alternatives:** dock-only (no frames → no scrub → misses the user's request); two components (drift).
**Decision:** phase 1 on `/options/replay/:positionId`; phase 2 adds the dock adapter only if the host contract stays small.

---

## 9. Acceptance checklist

- [ ] DTE 0 column equals `payoffAt()` within 1e-6
- [ ] Black-76 parity vs `greeks.py` golden values within 1e-4 / 1e-3
- [ ] Slider moves issue **zero** HTTP requests (E2E request-count assertion)
- [ ] Missing IV is hatched, labelled, and excluded from the domain
- [ ] Six tabs share one registry and one `MatrixCell[]`
- [ ] Clicking a non-position expiry never moves the replay clock
- [ ] Keyboard can reach and select every cell
- [ ] All ramp text pairs ≥4.5:1 in `contrast.test.ts`
- [ ] 1600 + 390 screenshots for all tabs, empty/loading/no-IV, read back and embedded
- [ ] `tsc` error count ≤ recorded baseline; lint/build/oxlint clean

