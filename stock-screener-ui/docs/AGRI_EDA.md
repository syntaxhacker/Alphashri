# Agri prices — EDA & visual specification

Status: **design decision record for the `/agri` redesign.** This document defines the
exploratory views, their exact encodings, the derived-only summary strip above the
chart, the cross-view interactions, and the acceptance checks. Source facts live in
[`AGRI_PRICES.md`](./AGRI_PRICES.md); descriptors live in `src/config/agri.ts`; the
wire contract in `src/types/agri.ts`; the aggregation rules in
`api/agri/aggregate.py`. Where this document and a screenshot disagree, the document
is the target state and the screenshot is the baseline being replaced.

> **No invented metrics.** Every number shown is computed from the returned daily
> `series` / `kpis` / `comparison` payload. Fields the payload leaves `null`
> (`msp`, `distance_to_msp_pct`, missing `arrivals_qtl`) stay `null` and render `—`
> with a reason. Nothing is filled from memory, from a vendor's "typical" value,
> or from a plausible-looking default. A metric that cannot be computed renders
> `—`, never `0`.

---

## 0. Data contract at a glance

One point per date, already aggregated across mandis by `aggregate_daily()`:

| Field | Meaning (source) | Unit | Notes |
|---|---|---|---|
| `date` | ISO arrival date | `YYYY-MM-DD` | Series is anchored to `as_of`, not to today. |
| `modal` | **Median of the day's per-mandi modal prices**; a mandi's modal is the *most-traded* price, not a mean and not a close | ₹/quintal | This is the primary measure of level. |
| `min` | Robust **2nd percentile across mandis** on that date (exact min on days with <5 prices) | ₹/quintal | Cross-sectional dispersion, *not* an intraday low. |
| `max` | Robust **98th percentile across mandis** on that date (exact max on days with <5 prices) | ₹/quintal | Cross-sectional dispersion, *not* an intraday high. |
| `arrivals_qtl` | Sum across mandis; source metric tonnes ×10 | qtl | Coverage warnings are emitted by the backend. |
| `market_count` | Distinct reporting mandis | count | Also shown in the freshness banner. |

`kpis` carries `modal`, `min`, `max`, `chg_1w_pct`, `chg_1m_pct`, `chg_6m_pct`,
`market_count`, `arrivals_qtl`, `msp`, `distance_to_msp_pct`. `comparison` carries
up to 5 other commodities' `{date, modal}` points. No new backend field is required
for any view in this document.

---

## 1. Why proxy-OHLC must not be a primary mode

`agriChartOption.ts:buildOhlc()` currently synthesises candles as
`[open = previous day's modal, close = today's modal, low = min, high = max]` and
labels them "Proxy OHLC from min/max/modal — not traded OHLC". Even with that
label, the chart reads as a tradable instrument (see
`reports/agri/screenshots/desktop-ohlc.png`): rows of long red/green wicks whose
tops and bottoms invite interpretations the data cannot support.

1. **There is no open.** Agmarknet publishes a daily *modal* price (the most-traded
   price at a mandi); it does not publish a session open. Using yesterday's modal
   as today's open invent a continuity and a gap that were never observed. The
   green/red body then asserts "up/down from an open" for a series that has no
   traded path.
2. **`min`/`max` are not a traded high/low.** They are the 2nd/98th percentiles
   *across mandis on that date*, after the aggregator clips impossible prints.
   A wick drawn from modal to p98 suggests the price travelled to that level
   during the day. It did not — another mandi quoted it. The wick length encodes
   cross-market disagreement, not intraday volatility.
3. **`modal` is not a close.** It is a mode across trades and then a median across
   mandis. Labelling it "Close (modal)" in the tooltip is a category error.
4. **It crowds out the views that fit the data.** The same pixel budget can show
   the min–max band (honest range), a boxplot (honest dispersion), or arrivals vs
   price (honest supply/demand). Candles make the least defensible view the most
   visually dominant one.
5. **It invites derived strategies that cannot be backtested.** Candles imply
   gap, body, wick and range signals; none have a traded-time referent in mandi
   data. That is an invented metric risk, not a presentation choice.

**Decision:** remove `ohlc` from `AGRI_CHART_MODES` / `AgriChartMode` and from the
mode strip. Do not retain it as a hidden or advanced mode. `min`, `max` and
`modal` remain first-class inputs to the band and boxplot views — only the
candle *encoding* is retired. If a raw-range check is ever needed for debugging,
it belongs in a backend/CSV artifact, not on the screen.

---

## 2. Ranked EDA views for this dataset

Ranked by how directly each view answers a question the data can actually answer.

| # | View | Question it answers | Key requirement | Default state |
|---|---|---|---|---|
| 1 | **Price band + modal trend** | "What is the level and the cross-mandi spread over time?" | daily series | **Default ON**, always available |
| 2 | **Monthly distribution / boxplot** | "How dispersed is the modal within each month; which months are wide?" | ≥6 months | ON, gated |
| 3 | **Arrivals ↔ price scatter + correlation** | "Do high-arrival days line up with low/high prices?" | ≥6 months + arrivals on ≥60% of days | ON, gated |
| 4 | **Commodity × month heatmap** | "Which commodity is relatively expensive in which month?" | ≥3 commodities, ≥3 months | ON, gated |
| 5 | **Rolling mean ± volatility band** | "Is the current move trend or noise?" | ≥30 daily points | ON, gated |
| 6 | **Seasonality by calendar month** | "Is this month seasonally high or low across years?" | **≥2 years** | **OFF / disabled on the 7-month seed** |
| 7 | **Top movers / small multiples / sparklines** | "Which commodities moved most, on a comparable scale?" | ≥2 commodities, ≥2 dates | ON, gated |
| 8 | **MSP gap / below-MSP flags** | "Are prices below a *verified* minimum support price?" | verified MSP in `registry` | **OFF / disabled — all MSPs are null today** |

The existing `arrivals` dual-axis (modal line + arrivals bar) is **demoted**: it
survives only as the lower companion strip inside view 3, never as a top-level
mode. The existing indexed `compare` overlay survives inside view 7 as the
"Indexed (100 = window start)" toggle, not as a separate rank.

---

## 3. Exact chart specification per view

Shared conventions for every view:

- **Theme** — reuse `themeTokens(isDark)` from `agriChartOption.ts`. Axes/split
  lines use the theme `border` / `split` tokens; labels use `text` / `muted`.
  No raw hex, no new colour pairs.
- **Colour meaning** — `PRIMARY` = the modal/central estimate; `INFO` (via
  `alpha(INFO, …)`) = informational range/volume/correlation; `POSITIVE` /
  `NEGATIVE` = signed direction only; `WARNING` = attention (outliers, gaps,
  gating); `SCALE_VIOLET[4]` / `SCALE_CYAN[4]` = additional compare series.
  Never use red for "selected" or "informational". Labels on filled cells use
  `pickTextColor(fill)` from `src/utils/contrast.ts`.
- **Number format** — prices via `formatAgriPrice` (grouped Indian rupees,
  suffix `₹/quintal` in axis title / tooltip); arrivals via `formatArrivals`
  (`K`/`L`/`Cr qtl`); percentages via `formatChangePct` (signed, 1 decimal).
  Axis compact labels use the existing `en-IN` ladder.
- **Tooltip shell** — the existing `tooltipShell` + `field()` helpers: monospace
  11px, header = date/month/commodity, one row per series, `—` for null.
  Escape all labels; never concatenate unescaped source strings.
- **Empty state** — `EmptyState kind="no-data"` with a title, a description that
  names the *specific* missing precondition, and (where useful) a `Show MAX` /
  `Switch to 1Y` action. Never a blank canvas and never a zero-filled series.
- **Disabled view** — the mode button is hidden when its requirement can never
  be met by the loaded payload (e.g. MSP), or shown disabled with `title`
  explaining the requirement when the requirement is data-dependent (e.g.
  seasonality needs 2 years). A disabled mode cannot be selected via URL either:
  fall back to `band` and keep the URL clean.

### 3.1 Price band + modal trend (primary, `band`)

- **x** — `date`, category axis, labelled with `formatAgriDateLabel` (`DD Mon`),
  `hideOverlap`, zoom slider (`dataZoom`) as today.
- **y** — modal in ₹/quintal, value axis, `scale: true` (do not force zero).
- **Encode** — modal line `PRIMARY`, 2px, no symbols, `z: 5`; min–max band = two
  stacked invisible lines whose `areaStyle` is `ORB_AREA` (an `alpha(INFO, …)`
  tint), `silent: true`, `z: 1–2`. The band is an informational range, not a
  P&L fill. Raw `min`/`max` are *not* plotted as separate visible lines.
- **Tooltip** — trigger `axis`, cross pointer; rows: Modal, Min, Max, Markets,
  and `as of` in the header. Show raw values from the source row, never the
  stacked `span` value.
- **Annotations** — a dashed `as_of` marker when `as_of < today - 7d` is already
  covered by the freshness banner; do not duplicate it in the plot. Below-MSP
  markers are added **only** in view 8 and only for verified MSPs.
- **Empty state** — "No chart history for this selection" + `emptyCopy()`; action
  `Show MAX` when `range !== "max"`.
- **Disable when** — `series.length === 0` (show empty state, keep the mode).
- **Interaction** — the scatter's `highlightDate` draws a thin dashed vertical
  marker here; no refetch.

### 3.2 Monthly distribution / boxplot (`distribution`)

- **x** — calendar month present in the active window, ordered chronologically,
  label `Mon 'YY` plus `n=` daily observations.
- **y** — daily `modal` in ₹/quintal, value axis, shared across months.
- **Encode** — one box per month: box = p25–p75 of that month's daily modal;
  median line = `PRIMARY` 2px; whiskers = smallest/largest values within
  1.5×IQR; outlier dots = `WARNING` 4px (attention, not bearish). A small `n`
  badge in each axis label prevents "one observation looks like a distribution".
- **Tooltip** — trigger `item`; Month, Median, p25, p75, whisker low/high,
  outlier count, n sessions, unit. If `n < 5`, add the line
  "Small sample — treat spread as indicative".
- **Annotations** — a subtle `INFO` band for the overall window median modal,
  labelled "window median", so a month can be judged against the whole window.
- **Empty state** — "Need at least 6 months of history" when the window spans
  <6 calendar months; otherwise the generic no-data state.
- **Disable when** — active window spans <6 calendar months **or** any month has
  <2 modal points. The 7-month seed supports this view (Oct 2025–May 2026 ≈ 7
  months, ~20–26 points per month).
- **Interaction** — brushing/clicking a month box sets the `month` selection →
  filters the table and re-scopes the other views (§6).

### 3.3 Arrivals ↔ price scatter + correlation (`scatter`)

- **x** — `arrivals_qtl` (sum across reporting mandis for that date), compact qtl
  (`K`/`L`/`Cr`), value axis starting at 0.
- **y** — daily `modal`, ₹/quintal, value axis, `scale: true`.
- **Encode** — one dot per date, 6px, colour by calendar month using an `INFO`
  hue ramp derived from a single anchor (do not add seven new colour tokens);
  least-squares regression line `y = a + b·x` dashed `INFO` 1.5px; a companion
  lower strip (height ~20% of the panel) reuses today's arrivals bar series in
  `alpha(INFO, 0.45)` with a linked axis pointer so the time context is kept.
- **Tooltip** — trigger `item`; Date, Modal, Arrivals, Markets, Month; plus a
  panel-level caption showing `Pearson r`, slope `b`, and `n` paired points.
- **Annotations** — the caption states "Association, not causality — arrivals
  and price are both seasonal". No causal arrow, no "supply caused price" label.
- **Empty state** — "Arrivals are missing for this selection" when coverage is
  <60% of dates; "Need at least 8 paired days" when pairs are too few.
- **Disable when** — <8 dates with both `arrivals_qtl` and `modal` non-null, or
  arrivals coverage <60%. Missing arrivals never become 0.
- **Interaction** — clicking a dot sets `highlightDate` (§6). Brushing an x-range
  filters to those arrival days and the table.

### 3.4 Commodity × month heatmap (`heatmap`)

- **x** — calendar month present in the window (`Jan … Dec` or the 7 seed months);
  absent months render a hatched "no data" cell, never 0.
- **y** — commodity label from `agriCommodityLabel` (≤5 rows visible by default,
  ordered by group then label; user-selected commodity pinned to the top).
- **Encode** — cell = **median modal** for that commodity × month; colour =
  that commodity's *row-relative percentile* (0–100) on a single-hue `INFO` ramp
  derived with `alpha(INFO, t)`, five steps. Row-relative normalisation is
  mandatory: raw ₹/quintal differs by an order of magnitude between onion and
  wheat, so an absolute colour scale would show only "vegetables are cheap".
  Cell text (the raw median, compacted) uses `pickTextColor(fill)`; small cells
  drop the text and rely on tooltip.
- **Tooltip** — Commodity, Month, Median modal ₹/quintal, row percentile, n daily
  points, and "partial year" when the month comes from the 7-month seed.
- **Annotations** — caption: "Colour = percentile within each commodity's own
  window; n = daily points". No "hot/cold" or bearish/bullish wording.
- **Empty state** — "Need at least 3 commodities and 3 months" with the exact
  measured counts.
- **Disable when** — <3 commodities with data, <3 months, or fewer than 2 daily
  points in any plotted cell (that cell renders "no data", the view stays up).
- **Interaction** — clicking a cell sets `commodity` **and** the month selection
  in one batch (§6).

### 3.5 Rolling mean ± volatility band (`rolling`)

- **x** — `date` of each available daily point (category axis; window measured
  in *observations*, not calendar days, because mandi series have gaps).
- **y** — modal ₹/quintal.
- **Encode** — raw modal thin muted line (`alpha(PRIMARY, 0.35)`), 1px, behind;
  rolling mean (default 20 observations; choices 7/20/60) `PRIMARY` or
  `SCALE_VIOLET[4]` 2px; ±1σ band `alpha(INFO, 0.18)`; ±2σ band
  `alpha(INFO, 0.08)`; both `silent: true`, `z: 1`.
- **Tooltip** — Date, Modal, 20d mean, 20d σ (same window size as selected),
  z-score `(modal − mean) / σ` (show `—` when σ = 0), window size.
- **Annotations** — a `WARNING` marker at points where |z| > 2, labelled only on
  hover; the caption reads "σ = standard deviation of modal over the trailing
  window (observations, not days)".
- **Empty state** — "Need at least 30 sessions for a 20-day rolling band".
- **Disable when** — `series.length < 30`, or a 60-observation window is selected
  with <75 points (drop that window choice, keep the view).
- **Interaction** — `highlightDate` draws the shared vertical marker.

### 3.6 Seasonality by calendar month (`seasonality`)

- **x** — month of year, Jan–Dec.
- **y** — median modal per calendar month **across years**, ₹/quintal; a second
  y-axis (or tooltip row) expresses the same value as % deviation from the
  window-wide median modal.
- **Encode** — per-month box (p25–p75 across years, whiskers 1.5×IQR, `WARNING`
  outlier dots), median line `PRIMARY`; an `INFO` dashed line connects the
  across-year medians to make the seasonal shape readable.
- **Tooltip** — Month, years covered (e.g. `2024, 2025, 2026`), across-year
  median, IQR, n years, % vs window median.
- **Annotations** — caption "Requires ≥2 years; n = distinct years, not days".
  Do **not** shade sowing/harvest windows unless an official calendar is added to
  the registry — an unsourced seasonal claim is an invented metric.
- **Empty state** — "Seasonality needs at least 2 years of daily history. The
  current cache spans 7 months (Oct 2025 → May 2026). Backfill from data.gov.in
  (2009→today) to enable this view." No fallback boxplot from a single year.
- **Disable when** — <24 months of history **or** <2 distinct years **or** any
  month has <2 years of observations. This view is disabled for the 7-month seed.
- **Interaction** — clicking a month box sets the month selection (§6); the
  month then resolves to each year in the backfilled series, not to a single
  30-day slice.

### 3.7 Top movers / small multiples / commodity sparklines (`movers`)

- **x** — date (each sparkline shares the active window); **y** — modal indexed
  to 100 at the first available date in the window (same method as
  `buildCompare()`). Indexing is mandatory: absolute ₹/quintal makes cereals and
  vegetables incomparable.
- **Encode** — one 48px sparkline per commodity in a responsive grid, ordered by
  window % change descending; top 3 gainers and top 3 losers also appear as a
  compact strip with `POSITIVE` / `NEGATIVE` signed badges; line colour from the
  existing `COMPARE_COLORS` cycle, `PRIMARY` for the selected commodity. A dashed
  `100` baseline is drawn once per sparkline, muted.
- **Tooltip** — Commodity, start modal, end modal, window % change, n sessions.
- **Annotations** — caption "Indexed to 100 at window start; % = last / first − 1".
- **Empty state** — "Need at least 2 commodities with overlapping dates".
- **Disable when** — <2 commodities or <2 dates. The `Indexed (100 = start)`
  toggle here replaces the old standalone `compare` mode button.
- **Interaction** — clicking a sparkline or a mover badge selects that commodity
  and re-renders views 1–3; keyboard equivalent is a focusable button per tile.

### 3.8 MSP gap / below-MSP flags (`msp`)

- **x** — date (time series of `distance_to_msp_pct`) when MSP is verified;
  **y** — distance from MSP in %, with a dashed zero line. Below-zero points use
  `NEGATIVE`, at/above use `POSITIVE`; the verified MSP value is shown in the
  header with its notification source and date.
- **Encode** — line + symbol per date, 2px; below-MSP points additionally flag the
  same date on the band view with a small `NEGATIVE` triangle at the modal line.
- **Tooltip** — Date, modal ₹/quintal, verified MSP ₹/quintal, gap %, source.
- **Annotations** — "MSP verified from <notification>; gap = (modal − MSP)/MSP".
- **Empty state** — "MSP not verified for <commodity>; gap remains null." Do not
  substitute a remembered or estimated MSP.
- **Disable when** — `kpis.msp == null` or `distance_to_msp_pct == null` (true for
  every commodity today: `registry.msp_for()` returns `None`, and `hasMsp` in
  `config/agri.ts` is a declaration, not data). The mode stays hidden until a
  value is verified against an official notification and added to the registry.
- **Interaction** — clicking a flagged date sets `highlightDate`; clicking the
  MSP stat in the KPI strip opens this view only when enabled.

---

## 4. EDA summary above the chart

Insert a `CompactStatGrid` with `data-testid="agri-eda-summary"` between the freshness
banner and the chart panel. Six cells covering the five requested concepts (best
and worst month are separate cells). Desktop 6 columns → mid 3 → mobile 2, using
`CompactStat` with `label`, `value`, `hint` (formula/definition) and `tone`.

| Cell | Value | Derivation (from the active window's `series`) | Tone / empty |
|---|---|---|---|
| **Window trend** | signed % | `(last modal − first modal) / first modal × 100`, using the first/last non-null modal in the window; do not annualise | `success`/`error` by sign; `—` if either endpoint null. For the 1w/1m/6m windows prefer backend `chg_*_pct` and label the cell accordingly |
| **Realized volatility** | daily σ % | sample stdev of `rᵢ = (modalᵢ / modalᵢ₋₁ − 1) × 100` over consecutive available dates whose calendar gap ≤7 days; require ≥10 returns; hint shows `n` and, optionally, `σ × √252` labelled "annualised (252d)" | neutral; `—` when <10 returns |
| **Best month** | `Mon 'YY` + median ₹/qtl | highest median modal among months with ≥2 daily points; ties → earliest month | neutral (a high price is not "good"); `—` when no month qualifies |
| **Worst month** | `Mon 'YY` + median ₹/qtl | lowest median modal under the same rule | neutral; `—` |
| **Arrivals correlation** | `r` (2 dp) | Pearson r of paired `(arrivals_qtl, modal)` on dates where both are non-null; require ≥8 pairs; hint states n | neutral; `—` when pairs <8. Tooltip: "association, not causality" |
| **Outliers** | count + share | daily modal points outside the window's robust fence `median ± 3 × 1.4826 × MAD`; if MAD = 0 use `median ± 3 × IQR`; if both degenerate, `—` | `warning` when >0, neutral when 0; `—` only when undefined |

Rules: the summary recomputes from the same `series` the chart draws, so the
strip can never disagree with the plot; it is recomputed on `range`, `group`,
commodity and geo filter changes; `msp`/`distance_to_msp_pct` are never summarised
while null. A backend `warnings` entry (e.g. impossible prints, missing arrivals,
MT→qtl conversion) stays in the freshness banner — the summary does not absorb or
hide it.

---

## 5. Recommended default order and deprecations

Mode strip order (left → right), with the default selection first:

| Order | Key | Label | Default | Gate |
|---|---|---|---|---|
| 1 | `band` | Price band | **yes** | none |
| 2 | `distribution` | Distribution | no | ≥6 months |
| 3 | `scatter` | Arrivals ↔ price | no | ≥6 months, arrivals coverage ≥60% |
| 4 | `heatmap` | Commodity × month | no | ≥3 commodities, ≥3 months |
| 5 | `rolling` | Rolling band | no | ≥30 sessions |
| 6 | `movers` | Movers | no | ≥2 commodities |
| 7 | `seasonality` | Seasonality | no | ≥2 years (disabled on the seed) |
| 8 | `msp` | MSP gap | no | verified MSP (hidden today) |

Key mapping: this document calls view 3 `scatter`; the chart-option module's
canonical id is `supplyDemand` and already normalises `scatter`, `supply-demand`,
`supplydemand` and `regression` to it. Both names refer to the same view — use
`supplyDemand` in code, `Arrivals ↔ price` in the UI.

**Remove:** `ohlc` (§1) — no replacement candle view.
**Deprecate as standalone modes:** `arrivals` (fold into `scatter` as its lower
companion strip) and `compare` (fold into `movers` as the indexed toggle). Keep
legacy URL values `?mode=ohlc` / `?mode=arrivals` / `?mode=compare` accepted on
read and normalised to `band` / `scatter` / `movers` respectively, so an old
shared link never lands on a blank or misleading screen.

With the 7-month seed the usable strip is `band · distribution · scatter ·
heatmap · rolling · movers`; `seasonality` is visible-but-disabled with the 2-year
requirement in its `title`, and `msp` is absent.

---

## 6. Interactions and selection precedence

One selection store, mirrored to the URL, is the source of truth:

| Action | State change | Effect |
|---|---|---|
| Brush/click a **boxplot month** | set `month = YYYY-MM` → `from`/`to` = first/last day of that month clipped to the active range and `as_of` | Refetch prices with the narrowed bounds; table shows only that month's quotes; an active chip "May 2026 ×" appears above the chart. Band/rolling/scatter re-scope to the same days. |
| Click a **scatter point** | set `highlightDate = YYYY-MM-DD`, client-only (no refetch) | Dashed vertical marker on band/rolling/scatter; matching table row(s) highlighted; a pinned tooltip shows that date's values. Click again or `Escape` clears. |
| Click a **heatmap cell** | batch: `commodity = key` **and** `month = YYYY-MM` | Commodity select updates, month chip appears, all views and the table re-render for that commodity+month. |
| Click a **sparkline / mover** | `commodity = key` | Same as changing the commodity select; the selected tile uses `PRIMARY`. |

Precedence and invariants:

1. `range` (plus `from`/`to` from the month selection) bounds the window; geo and
   group filters are independent and combine with it. `as_of` is always the upper
   bound — never today's date.
2. `highlightDate` is a view-only highlight; it does not filter and does not
   trigger a request. A month filter can coexist with a highlight.
3. Clearing the month chip restores the previous `range` URL state; clearing the
   commodity from the select also clears a heatmap-driven selection.
4. Keyboard parity: every clickable brush/point/cell/tile has a focusable table
   or list equivalent with `role="button"`, a visible focus ring and Enter/Space
   activation; `Escape` clears `highlightDate` and the month chip in that order.
5. ECharts containers stay inside a flex parent (`flex: 1`, `min-height: 0`),
   never inside `ScrollArea`; the table is the only scrolling region.

---

## 7. Data requirements and caveats

**Minimums**

- Daily series with `date`, `modal`, `min`, `max`, `arrivals_qtl`, `market_count`
  — already present in `AgriPricesResponse.series`.
- Arrivals on ≥60% of dates for view 3; coverage warnings must remain visible.
- **≥6 months** for distribution, scatter, rolling (≥30 sessions) and a partial
  heatmap.
- **≥2 years (24 months, ≥2 observations per calendar month)** for seasonality;
  this is a hard gate, not a soft warning.
- ≥3 commodities with overlapping dates for the heatmap and movers.
- A verified MSP in `api/agri/registry.py` with a source notification for view 8.
  `hasMsp` in `config/agri.ts` only declares eligibility — it is **not** an MSP
  value and must never be rendered as one.

**The 7-month seed (current cache)**

- CKAN seed spans **2025-10-27 → 2026-05-31** (~7 months, ~217 dates; the 6M view
  shows ~183 sessions). At the screenshot date `as_of` is 175 days stale, surfaced
  in the freshness banner; charts must be titled "as of 2026-05-31", never "today".
- Only seven calendar months are present (Oct 2025–May 2026), each with at most
  **one annual observation**. Month-to-month differences in the boxplot are real
  within this window but cannot be called seasonality; view 6 stays disabled.
- The heatmap may render seven columns with a "partial year" caption; it must not
  imply a full Jan–Dec cycle. Absent months are hatched "no data".
- `chg_1m` / `chg_6m` can be computed; `chg_1y` cannot — the KPI shows `—` for any
  window longer than the cache, never a wrapped-around value.
- The production path to ≥2 years is the data.gov.in historical resource
  (`35985678-…`, 2009→today, `DATA_GOV_IN_API_KEY` required). Enable seasonality
  only after backfill has actually advanced `as_of` and month coverage.

**Caveats to keep visible**

- `min`/`max` are cross-mandi p2/p98, not traded extremes (§1).
- `modal` is a mode then a median, not a close or a mean.
- Arrivals from metric tonnes are ×10 to qtl; the backend warning is shown.
- Nulls (`msp`, `distance_to_msp_pct`, missing arrivals) render `—` with a reason.
- A summary figure that lacks data is omitted, not zero-filled; no value is
  inferred from memory or from another commodity.

---

## 8. Test / visual acceptance checklist (1600 and 390)

Run for every view in §3, in **full / empty / loading / error** states, in dark and
light themes. Screenshot at **1600×900** and **390×844**, then `read` each PNG back
and look at it — a green build is not evidence the screen works.

**Content correctness**

- [ ] Mode strip order matches §5; `OHLC` is absent; legacy `?mode=ohlc` falls back
      to `band` with a clean URL.
- [ ] Every mode renders plausible values: no `undefined`, `NaN`, `function`,
      `Infinity`, `null`, or "13,50,000" impossible prints in plot or tooltip.
- [ ] Every tooltip shows all documented fields; null fields show `—`; units are
      `₹/quintal` and qtl, never bare numbers.
- [ ] EDA summary values match a hand calculation on
      `tests/fixtures/agri_prices_sample.csv` (or a mocked response) to 1 dp;
      `—` appears with an explanatory tooltip when inputs are insufficient.
- [ ] `MSP gap` mode is hidden and the MSP KPI reads "No MSP notified"; no MSP
      number appears anywhere.
- [ ] Seasonality shows the 2-year empty state on the seed; heatmap shows the
      "partial year" caption and hatched absent months.

**Layout / visual**

- [ ] At 1600 the chart panel is above the fold; measure
      `getBoundingClientRect()`: KPI + EDA summary + chart header do not push the
      plot below 900px; chart region ≥280px tall.
- [ ] At 390 no horizontal page overflow (`document.scrollWidth <= 390`); controls
      wrap in `ToolbarRow`; the table scrolls internally (min width 980), the page
      does not; EDA summary is 2 columns.
- [ ] Chart region uses flex (`flex:1`, `min-height:0`), not `ScrollArea`; no fixed
      heights that collapse when the panel resizes.
- [ ] Axes/labels ≥9px, meaningful graphics ≥3:1 and text ≥4.5:1; heatmap cell
      labels use `pickTextColor`; `bun run contrast` plus new fill pairs in
      `src/test/contrast.test.ts`.
- [ ] Empty/loading/error states collapse rather than reserving the data height;
      they never show a blank canvas.
- [ ] Distrust suspiciously small PNGs and any error text in the frame; check
      every non-default mode, not just `band`.

**Interactions**

- [ ] Boxplot month brush → table row count drops to that month, chip appears,
      URL carries `from`/`to`; clearing restores the window.
- [ ] Scatter click → highlight marker + table row, pinned tooltip; click again
      and `Escape` clear it; no network request fired.
- [ ] Heatmap cell click → commodity select + month chip both update; band chart
      and table agree.
- [ ] Sparkline/mover click selects the commodity; keyboard Enter/Space and
      `Escape` work; focus ring visible on all clickable marks.
- [ ] Zoom slider / dataZoom works in band, scatter and rolling without breaking
      the linked lower strip.

**Code gates (for the implementing agent / main)**

- [ ] `bun run lint && bun run build` clean.
- [ ] `npx vitest run <agri component + chart-option tests>` green; backend
      `.venv/bin/python -m pytest tests/api/test_agri -q` green.
- [ ] Guard suite: `src/test/{style-keys,no-props-destructure,numeric-typography,
      table-structure,ui-guard,design-scale,theme-single-source}.test.ts` and
      `src/ui/inputs/inputs.w-h.test.tsx` green.
- [ ] `npx tsc --noEmit 2>&1 | grep -c "error TS"` must not rise above the branch
      baseline.
- [ ] `tests/e2e/agri.spec.ts` (mocked payloads) covers all modes, the three
      interactions, both viewports and the disabled/empty states.

This document is a specification only; no source, test or backend file is changed
by it.
