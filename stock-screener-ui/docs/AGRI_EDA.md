# Agri prices — EDA & visual specification

Status: **target-state design record for the `/agri` W10 redesign.** This document
defines the category-first layout, reliability tiers, product/unit strata,
gap-aware charts and acceptance checks. Source facts live in
[`AGRI_PRICES.md`](./AGRI_PRICES.md); descriptors live in `src/config/agri.ts`;
the wire contract in `src/types/agri.ts`; aggregation rules in
`api/agri/aggregate.py`; refresh operations in
[`RUNBOOK_REFRESH.md`](./RUNBOOK_REFRESH.md).

Where this document and a screenshot disagree, this document is the target state
and the screenshot is the baseline being replaced. The UI may lag the backend:
tests for an unwired control must carry an explicit `TODO(W10)` / `test.fixme`,
never a fake pass.

> **No invented metrics.** Every number is computed from the returned daily
> `series`, `kpis`, `comparison` or quote payload. Missing inputs stay `null` and
> render `—` with a reason. MSP is `null` for every commodity until a notified
> value is verified from an official source. A metric that cannot be computed
> renders `—`, never `0`, and no price is forecast.

---

## 0. Data contract at a glance

One point per date, aggregated across mandis by `aggregate_daily()`:

| Field | Meaning | Unit / shape | Notes |
|---|---|---|---|
| `date` | ISO arrival date | `YYYY-MM-DD` | Anchored to `as_of`, never today. |
| `modal` | Median of the day's per-mandi modal prices; a mandi modal is the most-traded price, not a mean and not a close | ₹/quintal | Primary level measure. |
| `min` | Robust **2nd percentile across mandis** (exact min on days with <5 prices) | ₹/quintal | Cross-sectional dispersion, not an intraday low. |
| `max` | Robust **98th percentile across mandis** (exact max on days with <5 prices) | ₹/quintal | Cross-sectional dispersion, not an intraday high. |
| `arrivals_qtl` | Reported arrivals; CKAN metric tonnes ×10, daily feed has none | qtl | Never zero-filled. `null` means “not published”. |
| `market_count` | Distinct reporting mandis | count | Per date and per selected stratum. |
| `price_unit` | Published unit for the row | e.g. `Rs./Quintal`, `Rs./Bundle` | Not a global constant. |
| `product_form` | Product line | e.g. `common`, `basmati`, `green`, `dry`, `leaves`, `seed` | Splits chilli, coriander, paddy and rice. |
| `source` | Row provenance | `agmarknet_daily`, `agmarknet_ckan` | Mixed days are allowed. |
| `commodity_key` | Canonical registry key | e.g. `onion` | Read path filters this, never the raw spelling. |
| `source_commodity` | Raw API spelling | string | Audit only; never used for joins. |

`kpis` carries `modal`, `min`, `max`, `chg_1w_pct`, `chg_1m_pct`,
`chg_6m_pct`, `market_count`, `arrivals_qtl`, `arrivals_unit`, `unit`, `msp`,
`distance_to_msp_pct`. `quotes_total` is the full row count for the selected
facts, independent of the page limit. `comparison` carries up to five other
commodity series.

### Per-key date and freshness

`as_of` is **not one global date**. Each commodity key has its own `MAX(date)`
and freshness. A partial day must not advance every key, and a key missing on
the newest date shows its own latest date rather than a stale anchor. The
freshness panel therefore reports the selected key's date, `n` sessions, mandi
count and gap state.

### Current cache (2026-11-22)

- `reports/agri/agri_prices.db`: **1,215,303 rows**, **2025-10-27 → 2026-11-21**.
- The CKAN seed spans **2025-10-27 → 2026-05-31** and carries arrivals.
- There are **173 missing dates** (`2026-06-01 → 2026-11-20`); the observed
  boundary span is 174 days. Charts and rolling windows must break the line.
- **2026-11-21 is partial:** the collector found **3,942 rows** while the API
  reported **15,843** for that date (≈24.9%). Rice, arhar, chilli, groundnut and
  chana are 1–10% of their normal coverage. It is **not** a complete session and
  must not advance the completeness ledger.
- The official daily feed publishes no arrivals; CKAN arrivals remain for
  historical dates only. Never fill a daily null with `0`.
- 48 rows have `modal < min`, 16 have `modal > max`, 5 have `min > max`; these
  are data errors, not market signals, and are quarantined/flagged separately.
- MSP is `null` for every commodity. `hasMsp` in `config/agri.ts` is eligibility,
  not a value, and must never be rendered as one.

---

## 1. Agri taxonomy — one registry, explicit reliability

The backend registry (`api/agri/registry.py`) is the single source of truth. The
UI consumes its key/label/group/unit; there is no second label list.

### Groups and commodities

| Group | Commodities | Character |
|---|---|---|
| **Cereals** | Rice, Paddy, Wheat, Maize, Bajra, Jowar | Deep, low-volatility staples; wheat is a tight market |
| **Pulses** | Arhar/Tur, Urad, Moong, Masoor, Chana/Gram | Policy/seasonality sensitive; thinner than cereals |
| **Vegetables** | Onion, Potato, Tomato | High volatility, wide cross-mandi dispersion; best scanner candidates |
| **Oilseeds** | Soyabean, Groundnut, Mustard, Sunflower | Crush/import context; thinner coverage |
| **Spices** | Chilli, Turmeric, Coriander, Jeera | Thin, product/grade-sensitive; split green/red and bundle/quintal |

### Reliability tier (shown on every screen)

Derived from observed coverage, never hardcoded:

| Tier | Rule | Examples | UI rule |
|---|---|---|---|
| **A** | ≥100 mandis/day and ≥80% date coverage | Onion, Potato, Tomato, Wheat, Paddy, Rice | Rank and leaderboard claims allowed with `n` shown |
| **B** | 20–99 mandis/day | Maize, Bajra, Jowar, Chana, Soyabean, Mustard, Chilli | Rank allowed, sample size shown |
| **C** | <20 mandis/day | Turmeric, Jeera, Sunflower, Groundnut, Coriander | **“Thin sample”** badge; disable broad rank/leaderboard claims |

A tier must fall when coverage falls; it is a computed property of the selected
window, not a constant in config.

### Product / unit strata

Add a second selector wherever the source mixes product lines:

- **Chilli:** Green Chilli / Red Chilli / Dry Chillies
- **Coriander:** Leaves (bundle) / Seed (quintal)
- **Paddy:** Common / Basmati
- **Rice:** Rice / Broken Rice / Beaten Rice
- **Groundnut:** Seed / Pods
- **Mustard:** Mustard / Sarson / Toria

Rules:

- Never aggregate across `Rs./Bundle` and `Rs./Quintal`.
- Default to the dominant quintal product and print the selected stratum in the
  chart title and tooltip.
- If no conversion exists, display separate series; never blend medians.
- `product_form` and `price_unit` travel on every quote and series point.
- Exclude non-quintal rows from quintal aggregates and say so in the coverage
  panel. The backend warning for non-quintal units stays visible.

---

## 2. Visual hierarchy — category first

The goal is one glance answering: **is this commodity expensive or cheap versus
its own history, and is the move broad or local?** A user must not have to pick a
commodity before seeing what moved.

### P0 — orientation and trust

| # | Surface | Question | Default |
|---|---|---|---|
| 1 | **Market Pulse strip** | What is the selected commodity doing, and how good is the sample? | Always above the plot |
| 2 | **Group overview** | Which of the five groups moved, and how broadly? | Five cards |
| 3 | **Small multiples by group** | Which commodities drove the group move? | One sparkline per commodity |
| 4 | **Fluctuation matrix** | What are the 1W/1M/3M/6M moves in one grid? | Sorted by 1M |
| 5 | **Price level vs percentile** | Is today high or low versus own trailing 90 days? | Main line/band |
| 6 | **Coverage + freshness panel** | How real is this sample? | Always visible |

### P1 — cross-section and risk

7. **Mandi scanner** — latest-date table with state, district, mandi,
   variety/grade, modal, min–max spread, % vs commodity median, arrivals, rank.
   Server-side sort + `quotes_total`, explicit “showing X of Y”.
8. **Gross spread / dispersion** — commodity daily p25–p75, IQR/median,
   p90/p10, then state/district spreads. Label **“gross, before transport,
   commission and spoilage”**; no arbitrage profit without cost data.
9. **Volatility quadrant** — x = gap-guarded 30-day return, y = return
   volatility (not level CV), size = mandi count, colour = group. Tier C is
   visibly small/greyed.
10. **Anomaly layer** — return-z flags on the price band plus separate
    data-error flags (unit mismatch, `min > modal`, `modal > max`, extreme vs
    day median). Click a flag to jump to that date.
11. **Seasonality** — month-of-year only when every month has ≥2 calendar years
    (prefer 5); show `years` and `n` per month. One year shows an explanatory
    empty state, never a cycle.

### P2 — later

12. State/district leaderboard.
13. Saved views + CSV/PNG export with `as_of`.
14. India map only after state aggregates and boundaries exist.
15. Watchlist/threshold alerts — “next import”, never real-time.

---

## 3. Exact encodings

Shared conventions:

- **Theme** — `themeTokens(isDark)` in the chart-option modules. Axes/splits use
  theme `border`/`split`; labels use `text`/`muted`; no raw hex.
- **Colour meaning** — `PRIMARY` = modal/central estimate; `INFO` = range,
  volume or correlation; `POSITIVE`/`NEGATIVE` = signed direction only;
  `WARNING` = gaps, outliers or gating. Colour is never the only encoding.
- **Number format** — prices via `formatAgriPrice`, arrivals via
  `formatArrivals` (`K`/`L`/`Cr qtl`), percentages via `formatChangePct`.
- **Empty state** — `EmptyState kind="no-data"`, names the missing precondition,
  offers `Show MAX` / `Switch to 1Y` where useful. Never a blank canvas and
  never a zero-filled series.
- **Accessible table** — every chart has a table or CSV equivalent carrying
  `as_of`, `n` and units.

### 3.1 Market Pulse strip

Compacts, in order: current modal, percentile vs trailing 90 days, 1W/1M/3M/6M
change, coverage (mandis, % of normal, arrivals coverage), and `as_of`.
Changes use backend `chg_*_pct`; each is `null` when its anchor is missing or
outside the 3/7/14-day tolerance for 1W/1M/6M. A gap-guarded change renders `—`
with a “gap” tooltip, never a multi-month move labelled as one week.

### 3.2 Group overview

Five cards (Cereals, Pulses, Vegetables, Oilseeds, Spices). Each shows:

- normalized group index, 100 at window start;
- breadth = % of group commodities with a positive window change;
- median price dispersion (level CV, labelled as such);
- best and worst commodity with their own changes.

Clicking a card filters the commodity list and opens that group's dashboard.
No card is rendered from a single commodity and called a group move.

### 3.3 Small multiples by group

One mini sparkline per commodity, all indexed to 100 at the same start, with the
same y-scale inside the group. Direction uses red/green **plus** a signed label.
This is where broad moves versus one-off spikes become obvious. A commodity with
no overlapping dates renders a “no data” tile, not a flat line at 100.

### 3.4 Fluctuation matrix

Rows = commodities in the active group; columns = 1W / 1M / 3M / 6M. Each cell
is a signed % change plus a sparkline; any column sorts. A null cell shows `—`
with a gap tooltip. Tier C rows carry the “thin sample” badge.

### 3.5 Price band + modal trend (`band`)

- **x** — `date`, category axis, `DD Mon`, zoom slider; gap dates break the line.
- **y** — modal ₹/quintal, `scale: true`.
- **Encode** — modal line `PRIMARY` 2px, no symbols; min–max band as a tinted
  `INFO` area, `silent: true`; raw `min`/`max` are not separate visible lines.
- **Gaps** — insert `null` for any observed step >7 calendar days. Never connect
  2026-05-31 to 2026-11-21 with a continuous line. A gap annotation states the
  missing span.
- **Tooltip** — Modal, Min, Max, Markets, source/unit, and `as of`.
- **Percentile strip** — below the band, current modal's percentile vs the same
  commodity's trailing 90 days. Label “vs own 90-day median”; no forecast.
- **Empty/when** — no series → empty state with `Show MAX` when not already max.

### 3.6 Monthly distribution / boxplot (`distribution`)

- **x** — calendar month present in the window, chronological, label `Mon 'YY`
  plus `n=`.
- **y** — daily modal; shared across months.
- **Encode** — box = p25–p75; median `PRIMARY`; whiskers = values within
  1.5×IQR; outliers `WARNING` dots. This is a distribution, not a histogram.
- **Tooltip** — Month, Median, p25, p75, whisker low/high, outlier count, n,
  unit. `n < 5` adds “Small sample — treat spread as indicative”.
- **Interaction** — clicking a month sets `from`/`to` and a removable chip.

### 3.7 Commodity × month heatmap (`heatmap`)

- **x** — chronological month-year columns for the window, not a collapsed
  Jan–Dec axis.
- **y** — commodities, ordered by group then label; selected commodity pinned.
- **Encode** — cell = median modal for that commodity × month; colour =
  **row-relative percentile** on one hue ramp. An absolute ₹ scale would only
  say “vegetables are cheap”. Absent months are hatched “no data”, never 0.
- **Tooltip** — Commodity, Month, Median, row percentile, n, `partial year`
  where applicable.
- **Interaction** — clicking a cell sets commodity **and** the month in one
  batch.

### 3.8 Rolling mean ± dispersion band (`rolling`)

- **x** — dates, with the window measured in **elapsed calendar days**, not
  observation count, so a long gap cannot silently become the next session.
- **y** — modal ₹/quintal.
- **Encode** — raw modal thin muted line; rolling mean `PRIMARY`; ±1σ and ±2σ
  `INFO` bands, `silent: true`. A break >7 days starts a new segment and shows
  `n` plus skipped-gap count.
- **Tooltip** — Date, Modal, mean, σ, z-score (`—` when σ = 0), window, n.
- **When** — fewer than the required elapsed days → empty state naming the
  requirement; no line is drawn across the hole.

### 3.9 Arrivals ↔ price (`supplyDemand`)

- **x** — `arrivals_qtl`, compacted qtl, from 0.
- **y** — daily modal ₹/quintal.
- **Encode** — one dot per paired date, month hue from one `INFO` anchor, dashed
  least-squares line; a lower companion strip keeps the time context.
- **Missing arrivals** — new daily rows have none. Show “arrivals unavailable for
  this source” and omit those dots; never call `0` an arrival. A coverage <60%
  disables the view.
- **Tooltip/caption** — `Pearson r`, slope, `n`, and “association, not causality”.

### 3.10 Seasonality (`seasonality`)

- **x** — calendar month, Jan–Dec.
- **y** — median modal across years; a tooltip row gives % deviation from the
  window-wide median.
- **Encode** — per-month box + across-year median line.
- **Gate** — every month must have **≥2 distinct calendar years**; prefer 5.
  One year shows: “Seasonality needs at least 2 years of daily history…”
- **Tooltip** — Month, years covered, across-year median, IQR, n years.
- Do not shade sowing/harvest windows without an official calendar in the
  registry.

### 3.11 Mandi scanner, spread and anomalies

The scanner is a latest-date table, not the whole universe: show
`quotes_total`, sorting, a liquidity filter and “showing X of Y”. Clicking a row
sets state → district → market. Spread views label gross spread; no profit
number. Anomaly flags are separate from market moves and carry the failing
validation (unit mismatch, `min > modal`, `modal > max`, extreme vs day median).

---

## 4. Interactions and selection precedence

One selection store mirrored to the URL is the source of truth:

| Action | State change | Effect |
|---|---|---|
| Click a group card | `group = key` | Filters commodity list and opens the group dashboard |
| Brush a boxplot month | `month = YYYY-MM` → `from`/`to` | Refetches prices, filters table, shows chip |
| Click a scatter point | `highlightDate` (client only) | Dashed marker on band/rolling; no request |
| Click a heatmap cell | batch `commodity` + `month` | All views and table re-render |
| Click a sparkline/mover | `commodity = key` | Same as the commodity select |
| Toggle compare | `compare` list | Always includes the active commodity; max 5 |

Invariants:

1. `range` + month bounds gate the window; `as_of` is always the upper bound.
2. `highlightDate` is view-only and never filters or refetches.
3. Clearing a month chip restores the previous URL range; clearing commodity
   clears a heatmap-driven selection.
4. Keyboard parity: every clickable mark has a focusable table/list equivalent;
   `Escape` clears `highlightDate` then the month chip.
5. ECharts containers use `flex: 1; min-height: 0`, never `ScrollArea`.

---

## 5. Data requirements and caveats

**Minimums**

- Daily series with `date`, `modal`, `min`, `max`, `arrivals_qtl`,
  `market_count`, `price_unit` and `product_form`.
- Arrivals on ≥60% of dates for view 3.9; missing arrivals remain visible.
- ≥2 commodities and ≥2 dates for small multiples; ≥3 commodities/months for
  the heatmap; ≥30 elapsed days for rolling.
- ≥2 distinct calendar years **per month** for seasonality.
- A verified MSP with a notification source before any MSP view; until then the
  view is absent and every MSP value is `—`.

**Caveats to keep visible**

- `min`/`max` are cross-mandi p2/p98, not traded extremes.
- `modal` is a mode then a median, not a close or a mean.
- Arrivals from metric tonnes are ×10 to qtl; the backend warning is shown.
- `Rs./Bundle` rows are not converted or blended into ₹/quintal.
- Nulls (`msp`, `distance_to_msp_pct`, missing arrivals, gap-guarded changes)
  render `—` with a reason.
- A partial date never advances completeness or every key's `as_of`.

---

## 6. Explicit non-goals

- **No OHLC/candles.** There is no open, and `min`/`max` are cross-mandi
  percentiles, not an intraday traded range.
- **No price forecasts** or “best time to sell next week”.
- **No MSP number** until verified from an official notification.
- No net arbitrage/profit without transport, commission, fees and spoilage.
- No seasonality from one annual cycle.
- No zero-filled arrivals.
- No blended bundle/quintal aggregates.
- No Railway or hosted-backend assumptions.

---

## 7. Acceptance checklist (1600 and 390)

**Content correctness**

- [ ] Five group cards render and each shows index, breadth, dispersion and
      best/worst with `n`.
- [ ] Small multiples share one start and one y-scale inside a group.
- [ ] Fluctuation matrix has 1W/1M/3M/6M columns; gap-guarded cells show `—`.
- [ ] The 2026-05-31 → 2026-11-21 hole breaks every line; no chart connects it.
- [ ] 2026-11-21 is labelled partial (3,942 of 15,843) and does not advance
      every commodity's `as_of`.
- [ ] Tier C commodities show “thin sample”; the badge is derived from coverage.
- [ ] Chilli/coriander/paddy/rice strata are selectable; bundle and quintal are
      never blended.
- [ ] `quotes_total` and “showing X of Y” are visible on the mandi table.
- [ ] Compare includes the active commodity (max 5).
- [ ] No `undefined`, `NaN`, `function`, `Infinity`, `null` or impossible print
      in a plot or tooltip.
- [ ] Every tooltip shows units; nulls show `—` with a reason.
- [ ] MSP is absent/hidden and no MSP number appears anywhere.
- [ ] Seasonality shows the ≥2-year empty state when the gate fails.

**Layout / visual**

- [ ] At 1600 the Market Pulse + group overview + plot are above the fold; the
      chart region is ≥280px.
- [ ] At 390 no horizontal page overflow; controls wrap; the table scrolls
      internally; the 4 primary KPI cells + “More stats” layout is used.
- [ ] At 390 the mode strip is replaced by the mode select and every view is
      reachable from it.
- [ ] Chart region uses flex (`flex: 1`, `min-height: 0`), not `ScrollArea`.
- [ ] Axes/labels ≥9px; meaningful graphics ≥3:1 and text ≥4.5:1.
- [ ] Empty/loading/error states collapse instead of reserving data height.

**Interactions**

- [ ] Group card → commodity list + dashboard.
- [ ] Boxplot month brush → table filtered + chip + URL `from`/`to`.
- [ ] Scatter click → highlight marker + row, no network request.
- [ ] Heatmap cell → commodity select + month chip agree with band and table.
- [ ] Sparkline/mover → selects commodity; Enter/Space/Escape work.
- [ ] Zoom works in band, scatter and rolling without breaking companions.

**Code gates**

- [ ] `bun run lint && bun run build` clean.
- [ ] Targeted agri unit + backend agri tests green.
- [ ] `tests/e2e/agri.spec.ts` covers the gap warning, partial day, 390 mode
      select, and the `quotes_total`/compare TODOs are `test.fixme`, not silent
      passes.
- [ ] Screenshots at 1600 and 390 for full/empty/loading/error and every mode.
