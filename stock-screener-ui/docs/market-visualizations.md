# Market "Vis" tab — which visualizations earn their place

Decision: this document ranks visualizations for **live NSE market hours** on a ~2,000-name
universe. A visualization that does not change a trading decision is noise, no matter how good
it looks. Everything below is tied to data that actually exists in the repo, with file:line
citations; anything unavailable is labelled explicitly.

Context: the Market tab currently exposes `table | map | movers | value`
(`src/components/screener/ScreenerPage.tsx:32`). The old Dashboard tab was folded into Market as
the `movers` view (`src/components/screener/ScreenerPage.tsx:238-243`). The `map` view is the
treemap heatmap. The proposed "Vis" registry should host several of the views below, not invent
new data paths.

## 1. Data inventory (verify before proposing)

### 1.1 The market snapshot — the only cross-sectional feed we have

`GET /api/market/snapshot` is one TradingView scan per universe
(`api/market_screen/snapshot.py:298-317`), shaped once per row in
`api/market_screen/snapshot.py:399-453`. The TypeScript contract is
`src/types/marketScreener.ts:7-45` (`MarketRow`) and `:47-58` (`MarketSnapshot`).

| Field(s) present | Source / derivation | Notes |
|---|---|---|
| `symbol`, `name`, `sector`, `exchange` | `snapshot.py:422-426`; TV columns `config.py:17-20` | `sector` is nullable; the UI already filters on it (`marketFilters.ts:60-61,171`) |
| `close`, `change` | `snapshot.py:427-428` | Day change in percent |
| `relativeVolume` | `relative_volume_10d_calc` via `snapshot.py:429` | Multiple vs trailing average — the only volume field in the snapshot |
| `marketCapCr` / `marketCapUsdB`, `capTier` | `snapshot.py:418-431`; tiers in `config.py:102-114` | INR ₹ crore or USD $bn; `capTier` is `mega/large/mid/small/micro` |
| `rsi`, `adx` | `snapshot.py:432-433` | TV daily indicators, not intraday |
| `sma20`, `sma50`, `sma200` | `snapshot.py:434-436` | Enable "% above SMA" breadth without backend work |
| `perfW`, `perf1m` | `snapshot.py:437-438` | Weekly/monthly return |
| `high52w`, `low52w`, `pos52w` | `snapshot.py:413-417,439-441` | `pos52w` is `(close-low)/(high-low)*100`, already 0–100 |
| `peRatio`, `pbRatio`, `dividendYield`, `roe` | `snapshot.py:444-447` | Null where TV has no coverage |
| `fno`, `etf`, `currency` | `snapshot.py:448-450` | NSE tag sets + quote currency |
| `asOf`, `updateMode`, `stale`, `ageSec`, `cached` | `snapshot.py:691-711` | `updateMode` is the **TV feed mode** (`streaming` vs `delayed…`, `snapshot.py:320-355`), *not* a tick stream to the UI |

**Not in the snapshot:** absolute traded volume/turnover, VWAP, open/high/low, bid/ask, tick
history, 1-year return, or per-symbol intraday OHLCV. The treemap's `perf_1y` is deliberately
`null` with a comment explaining the backend has no such field
(`src/components/market/marketTreemap.ts:42-44`) — any "1Y" chart would be a lie today.

**Cadence:** 5s live / 60s closed server TTL (`snapshot.py:56,66`), and the UI polls at
`MARKET_LIVE_POLL_MS = 5_000` while the universe's session is open
(`src/components/market/useMarketSnapshotSolid.ts:16-17,91-101`). An optional columnar wire
format exists for large frames (`api/market_screen/wire.py:1`). So the honest claim for every
snapshot-based view is **near-live 5-second snapshots**, not ticks.

### 1.2 Live tick streaming — exists, but not for the market universe

`GET /api/paper/live/stream` connects to Upstox `MarketDataStreamerV3`
(`api/paper/live_stream.py:1-6`) but resolves instrument keys **only from open paper-trading
positions** (`api/paper/live_stream.py:39-90`). The frontend consumer
`src/components/paper-trading/LivePriceUpdater.tsx:17-80` updates `state.positions` only; it is
not wired to market screener rows. It also requires the broker OAuth token.

**Conclusion:** there is no tick feed for the 2,000-name screener universe. Any visualization
advertised as "live tape" or "tick-true" would be dishonest today; tick-dependent ideas are
backend projects, not Vis registry entries.

### 1.3 Existing views and adjacent data we can reuse

- **Treemap:** 12 selectable size metrics (`change_pct`, `rel vol`, `rsi`, `adx`, `pos_52w`,
  `perf_w`, `perf_1m`, `market_cap`, `pe`, `pb`, `roe`, `div yield`) in
  `src/components/market/marketTreemap.ts:91-120,143-166`. Colour is **intentionally** fixed to
  day change for every size metric, one code path (`:181-193`). Sector-grouped treemapping
  already exists in a different component, `src/components/sector/SectorHeatmapView.tsx`.
- **Movers ladder:** already shipped as the `movers` view, backed by
  `GET /api/screener/dashboard?universe=…` (`api/screener_api/dashboard.py:1-31,614`). Its rows
  carry `spark` (last 30 1-minute closes, normalized — `dashboard.py:56,76-86,136-156`),
  `vwap`, `atr`, `volume`, `relvol`, `price_52_week_high`, `market_cap`
  (`dashboard.py:463-472`; contract `src/types/screenerDashboard.ts:15-48`). Panels cover
  gainers/losers, near-52W high/low, most active, turnover, volume surge, gaps, range expansion.
  Server TTL 60s (`:55,27-30`); UI auto-refreshes intraday movers every 10s
  (`src/api/index.ts:263-266`). Sparks are **1-minute bars**, not ticks.
- **Sector performance:** `GET /api/sector` (`api/sector.py:33,92-158`) gives cap-weighted
  `avg_change`, `stock_count`, `advances`, `declines`, `avg_rsi`, `avg_adx`, `top_movers`, with a
  15s TTL (`api/sector.py:79-80`).
- **Rotation / RRG:** already built in the Sector page. `GET /api/rotation/overview`
  (`api/rotation.py:22,115-120`) returns sector/industry/theme rows with `rs_1m`, `rs_1w`,
  `rank_delta`, per-group `breadth`, a quadrant (`leading/weakening/lagging/improving`) and a
  regime object with benchmark, VIX and breadth (`api/rotation.py:64-104`). TTL 60s
  (`api/rotation.py:29`); UI is `src/components/sector/RotationTab.tsx:120-155,186`. Inputs are
  TradingView `Perf.W`/`Perf.1M`/… (`api/rotation.py:33-46`) — a **swing-timeframe** measure,
  not an intraday one.
- **Correlation infra:** `POST /api/correlation` (`src/api/correlation.ts:10-42`) returns a
  matrix plus normalized **historical** series for a caller-supplied symbol list; store in
  `src/state/correlation.ts:12-20`. It is an on-demand analytical tool, not a live feed, and it
  needs a symbol set chosen by the user — it is not a ready-made market-wide RRG source.
- **Breadth pieces:** per-sector advances/declines in `api/sector.py:114-115,126-127` and
  `api/rotation.py:243-245,360-361`; a cached market breadth reading in
  `api/rotation.py:383-447`. `new_highs`/`new_lows` appear in the **daily digest** contract
  (`api/reports_api/digest.py:60-72`), not in the live snapshot.

## 2. Ranked proposal (value per effort)

Effort: **S** = reuse snapshot fields + one component; **M** = new component with aggregation
or layout work; **L** = backend/data work first. "Polled" means the 5s snapshot; "10s/60s"
means the dashboard endpoint.

| # | Visualization | Decision it enables | Data needed — exists? | Live vs polled | Effort | Main failure mode |
|---|---|---|---|---|---|---|
| 1 | **Market breadth + concentration strip** (A/D, % above SMA20/50/200, 52W-high vs -low count, cap-weighted vs equal-weighted day change) | "Is today's move broad or just a handful of megacaps?" — sizes risk and tells you whether to trust an index move | All in `MarketRow`: `change`, `close`, `sma20/50/200`, `pos52w`, `marketCapCr` (`types:7-45`, `snapshot.py:427-441`). No backend work. VWAP variant needs `/api/screener/dashboard` (`screenerDashboard.ts:35`) | 5s polled | **S** | Nulls/stale rows silently skew ratios; must show `asOf`/`ageSec` and treat null as "unknown", not zero |
| 2 | **Sector performance bars + drill-down** | "Where is today's money flowing, and which names in that sector are doing it?" — allocates attention before stock selection | Aggregatable from `sector`+`change`+`marketCapCr` in the snapshot (`marketFilters.ts:60-61,171` already filters by sector); richer aggregate already at `GET /api/sector` (`sector.py:92-158`) | 5s polled (or 15s via sector endpoint) | **S** | Cap-weighted vs equal-weighted not stated → misleading "leading sector"; null `sector` rows become a phantom group |
| 3 | **Relative-volume × day-change bubble** (x=rel vol, y=change, size=cap, colour=day change) | "Which names have unusual participation *and* price confirmation?" — a breakout/breakdown watchlist generator | `relativeVolume`, `change`, `marketCapCr`, `sector` all in `MarketRow` (`types:15-19`); same fields the treemap already maps (`marketTreemap.ts:93-113`) | 5s polled | **S–M** | Overplotting at 2,000 points and extreme rel-vol outliers; needs log-x, sampling and tooltip-driven drill-down |
| 4 | **Treemap improvements (existing)** — sector-grouped tiles, explicit "no 1Y" handling, tile → filtered table | "Which sector is driving the tape, and what are its large/convicted constituents?" | `sector`, `marketCapCr`, size metrics in `marketTreemap.ts:91-120`; grouping pattern in `SectorHeatmapView.tsx`; table filter in `marketFilters.ts:171` | 5s polled | **M** | Sector grouping at 2,000 tiles destroys legibility; must aggregate small caps into an "Other" block. Do **not** add "1Y return" (field does not exist — `:42-44`) |
| 5 | **Movers ladder (existing)** — surface in the Vis registry, optionally add sector/cap-tier group headers | "What is moving right now, and is it a real move or a gap?" — idea generation | Already shipped: `movers` view (`ScreenerPage.tsx:32,238-243`) via `/api/screener/dashboard` (`dashboard.py:614`); rows include sparks, vwap, relvol (`screenerDashboard.ts:15-48`) | 10s UI poll / 60s server TTL | **S** (registry only) | Sparks are 30×1-min closes, not ticks; don't label them "live". 60s cache makes it the slowest "live" view in Vis |
| 6 | **Sector rotation / RRG quadrant (existing elsewhere)** — link or re-host, do not rebuild | "Which sectors are in a multi-week leadership regime?" — swing positioning, not intraday execution | Already built: `/api/rotation/overview` (`rotation.py:22,64-104`), `RotationTab.tsx`; correlation infra is on-demand historical (`correlation.ts:10-42`) | 60s TTL, manual refresh | **M** to re-host / **S** to link | Low *incremental* value in live hours: inputs are daily/weekly `Perf.*`, so it cannot answer "what is happening at 11:30 today?" |
| 7 | **Volume profile / value area** | "Where is the price-accepted value area for this stock?" — execution levels for a chosen name | **Does not exist** in the snapshot (no OHLCV distribution, no absolute volume). The only volume-profile code is the *NIFTY options tape* tool `src/pages/report/niftyVolumeProfile.ts:25-82` / `NiftyVolumeProfile.tsx:31-42` — different data, different host | Needs tick/1-min OHLCV backend work | **L** | Wrong abstraction for a cross-sectional screener; a static daily profile on 5s-poll data is decorative |
| 8 | **Live ticker tape / sparkline grid** | "Can I watch prices print?" — not a decision on a 2,000-name universe | **Does not exist** for this universe. SSE is positions-only (`live_stream.py:39-90`, `LivePriceUpdater.tsx:17-80`) and broker-token gated. Dashboard sparks are 1-min bars at 60s TTL (`dashboard.py:56,76-86`) | Requires new streaming backend | **L** | Would show a handful of positions or stale 1-min proxies while claiming "live" — the honesty failure is worse than the missing feature |

## 3. Top 2 to build next

**1) Market breadth + concentration strip.** It is the only candidate that is both free (every
input is already in `MarketRow`) and answers the risk question a trader actually asks at 11:30:
*is this move real or is it five megacaps?* Cap-weighted change vs equal-weighted change plus
advance/decline and % above SMA20/50/200 is computable in one `createMemo` over `rows()`
(`useMarketSnapshotSolid.ts:198`) and updates on the existing 5s poll. It also acts as a sanity
check on the treemap: a red map with positive breadth is a different trade from a red map with
collapse breadth. Effort S; failure mode is data hygiene (nulls, stale frames), contained by
rendering "—" for unknowns and surfacing `ageSec`/`updateMode` from the envelope.

**2) Sector performance bars + drill-down.** This is the natural companion to breadth: breadth
says *how broad*, sector bars say *where*. The aggregation can be computed client-side from the
same rows, and the existing sector filter (`marketFilters.ts:171`) gives a one-click drill-down
into the table — so the viz routes to a decision rather than ending in a dead end (per the repo's
UX principles). `GET /api/sector` (`sector.py:92-158`) is an optional upgrade for cap-weighted
`avg_change`/`advances`/`declines` if we want a richer aggregate without new scans. Effort S;
make the weighting explicit in the label, and drop null-sector rows into an "Unclassified"
bucket rather than a fake sector.

Both are honest at the cadence we already have (5s polled snapshots), need **no backend work**,
and compose: breadth → sector → relative-volume bubble → table is a coherent live-hours workflow
where each step narrows a decision. The treemap stays the visual anchor; these two give it context
it currently lacks.

## 4. Not worth building (and why)

- **Tick-true tape / sparkline grid as a "live" feature.** The only stream is positions-only and
  OAuth-gated (`api/paper/live_stream.py:39-90`); building it would require a new 2,000-key
  Upstox stream and would still be a gimmick — a human cannot read 2,000 scrolling tapes. The
  honest version is the existing movers ladder with its 1-min sparks, already in the registry.
- **Cross-sectional volume profile / value area.** Needs per-symbol intraday OHLCV distribution
  that the snapshot does not carry; the existing profile tool is NIFTY **options** tape
  (`niftyVolumeProfile.ts:25-82`) and does not generalize to equities here. High effort, no
  decision that a relative-volume bubble + 52W position cannot already inform.
- **Duplicating RRG/correlation inside Vis.** The quadrant view already exists
  (`RotationTab.tsx`, `rotation.py`) and is driven by daily/weekly returns — useful for swing
  planning, misleading as an intraday signal. Re-hosting it adds a second home, not a second
  decision. A link from Vis to the Sector → Rotation tab is enough.
- **"Colour by any metric" treemap.** Colour is deliberately tied to day change in one code path
  (`marketTreemap.ts:181-193`), which is what makes every sizing option readable as a
  green/red day map. Making colour user-selectable breaks that contract for no new decision —
  the bubble chart (#3) covers "two metrics at once" more legibly.
- **Any "1Y return" view sourced from this snapshot.** The field does not exist; the treemap
  explicitly nulls it (`marketTreemap.ts:42-44`). sourcing perf1m under a 1Y label would be a
  correctness bug, not a feature.
- **Standalone advance/decline gauge with no context.** A single A/D number is a breadth
  headline; it earns its place only as part of the concentration strip (#1) where it is compared
  against cap-weighted change and SMA position.

## 5. What could not be verified

- Whether the in-progress "Vis" registry has a fixed set of view ids beyond the current
  `MARKET_VIEWS` (`ScreenerPage.tsx:32`) — I read the working tree but did not inspect the
  in-progress Vis diff, so the integration cost of adding a registry entry is assumed, not measured.
- Whether the treemap supports tile → filtered-table drill-down today. The filter hook exists
  (`marketFilters.ts:171`) but I did not confirm the `map` view wires a click to it; treat that
  as a small unknown inside the effort M estimate for #4.
- Live intraday freshness of `GET /api/sector` and `/api/rotation/overview` is defined by their
  TTLs (15s / 60s) and TradingView's own `update_mode`; I did not verify their upstream feed mode
  at runtime.
- `new_highs`/`new_lows` are confirmed only in the daily digest path
  (`api/reports_api/digest.py:60-72`); I did not confirm a live endpoint that serves them, so the
  breadth proposal derives 52W extremes from `pos52w`/`high52w`/`low52w` instead.
