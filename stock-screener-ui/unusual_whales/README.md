# Unusual Whales API — Exploration

Research workspace for the [Unusual Whales](https://api.unusualwhales.com/docs) API.
Contains a full endpoint inventory, a live access probe, a daily alpha snapshot,
and a profit playbook.

> **Not investment advice.** Research tooling only.

## Folder layout

```
unusual_whales/
├── .env                      # UW_API_KEY (gitignored — never commit)
├── .gitignore
├── README.md
├── dashboard/                # local web terminal (key stays server-side)
│   ├── index.html            # shell: header + bell + search + view container + styles
│   ├── app.js                # snapshot view, router, symbol search, alert watcher
│   ├── symbol.js             # symbol drill-down shell (header + 12 lazy tabs + masonry)
│   ├── tour.js               # first-visit guided tour of the Today cockpit
│   ├── charts.js             # interactive chart engine (ECharts + lightweight-charts)
│   ├── info.js               # right-side ⓘ documentation drawer
│   ├── news.js               # market-wide ticker-tagged news view (#/news)
│   ├── alerts.js             # OI-change alert notification section (#/alerts)
│   ├── pulse.js              # Market Pulse — market-wide options sentiment (#/pulse)
│   ├── freshness.js          # market phase + adaptive poll policy (/api/status)
│   ├── vendor/               # local copies of echarts.min.js + lightweight-charts.js
│   └── panels/
│       ├── _util.js          # shared helpers + tiny SVG chart lib
│       ├── overview.js       # price, key stats, gamma, max pain, IV rank
│       ├── news.js           # per-ticker ticker-tagged headlines
│       ├── flow.js           # tape, flow alerts, net premium, greek flow, NOPE
│       ├── gex.js            # GEX by strike/expiry, spot gamma, OI, max pain
│       ├── options.js        # contracts, OI, volume profile, greeks, ATM
│       ├── vol.js            # IV/RV, rank, term structure, VRP, anomaly, skew
│       ├── darkpool.js       # dark pool + lit flow prints and price levels
│       ├── shorts.js         # SI/float, FTDs, fee rate, short volume by exchange
│       ├── insiders.js       # insider flow, filings, institutional ownership
│       ├── etf.js            # ETF info, holdings, exposure, flows, weights
│       └── fundamentals.js   # income/balance/cashflow, earnings, seasonality, TA
├── docs/
│   ├── openapi.yaml          # full spec downloaded from /docs/openapi.yaml
│   ├── endpoints.json        # 237 parsed endpoints (path/tag/params)
│   ├── probe_results.json    # live probe: status + entitlement per endpoint
│   ├── symbol_schema.json    # response field map for all 81 per-ticker endpoints
│   ├── symbol_groups.json    # symbol-view groups -> endpoints + fields
│   ├── REPORT.md             # access report: working vs gated, by category
│   └── PROFIT_IDEAS.md       # strategy/edge playbook mapped to endpoints
├── samples/                  # scratch for captured payloads (gitignored)
└── scripts/
    ├── uw_client.py          # reusable client + usage-header parser
    ├── parse_spec.py         # openapi.yaml -> endpoints.json
    ├── probe_all.py          # probes every endpoint, writes probe_results.json
    ├── make_report.py        # probe_results.json -> REPORT.md
    ├── discover_symbol.py    # field-shape discovery for per-ticker endpoints
    ├── snapshot_data.py      # global snapshot bundle builder
    ├── symbol_data.py        # per-ticker lazy groups + ticker universe
    ├── dashboard_server.py   # local server (static + /api/*)
    ├── news_data.py          # ticker-tagged headlines feed (/api/news)
    ├── alerts_data.py        # OI-change + native account alerts (/api/alerts)
    ├── pulse_data.py         # market-wide options pulse + sentiment (/api/pulse)
    ├── live_alerts.py        # real-time flow/unusual/dark-pool alerts (/api/live)
    ├── alert_store.py        # SQLite alert history (data/alerts.db, /api/alerts/history)
    ├── asset_class.py        # index / etf / stock classifier for the filters
    ├── notify.py             # optional Telegram bridge (reuses trading/telegram_notifier)
    ├── market_status.py      # US phase + adaptive TTL/poll policy (/api/status)
    └── daily_snapshot.py     # CLI one-command daily alpha snapshot
```

## Setup

```bash
cd stock-screener-ui/unusual_whales
source ../.venv/bin/activate          # project venv (has requests + pyyaml)
# token lives in .env (gitignored)
```

## Run the terminal

```bash
python scripts/dashboard_server.py --port 8901     # then open http://127.0.0.1:8901
```

- **Global snapshot** (`#/`): market tide, top net impact, dealer gamma, unusual flow,
  OI changes, dark pool, squeeze, vol anomalies, congress, insiders.
- **Search** any symbol in the header (type-ahead over the 18,716-ticker universe).
- **Symbol drill-down** (`#/symbol/NVDA`): a sticky header with a **Ticker brief** (net premium,
  gamma regime, magnet), a **Bullish/Bearish/Mixed bias chip**, a 30-day **sparkline**, a
  **watchlist ★**, and a ⚡ alert when spot is within 0.4% of a key level — then **12 lazy tabs**:
  `Today · Overview · Intraday · Heatmap · Whales · Timeline · Flow · GEX/Options · Volatility · Dark Pool · Positioning · Fundamentals & ETF`.
  (Options is merged into GEX/Options, Shorts+Insiders → Positioning, ETF+Fundamentals.)
- **Today tab** (default landing) — the one-screen daily cockpit: a **levels strip** (spot, day %,
  IV rank, net premium, bias, and call wall / put wall / gamma flip / magnet / max pain with
  distance-from-spot), an **intraday 5m chart with those dealer levels drawn on it**, the
  **strike × expiry exposure heatmap** (GEX / VEX / Delta / Charm), and a **"what to watch today"
  checklist** (✓/✗: price vs flip, near a wall, flow direction, 0DTE concentration, range vs implied
  move). A **first-visit guided tour** spotlights each block in order (replay via `UW.tour.start()`).
  Data comes from a single `/api/symbol/{t}/?group=today` request that bundles the levels, quote, IV,
  5m bars, net-premium ticks and the strike × expiry matrix.
  Flow tables carry an inferred **Side** column (`BTO/STO/BTC/STC` from ask-vs-bid premium and
  open/close proxies, green = bullish side, red = bearish).
  The Overview price panel is the free **TradingView** widget (intervals/indicators/drawing),
  with an SVG-candle fallback if the widget script can't load.
- **Timeline tab** — when did whales buy or sell? Every strike-tick of the session plotted by
  time (ET), colored by intent (green call-dominated, red put-dominated, gray mixed) with
  whale-size premium highlighted; rich hover tooltips show call/put premium, ask% side split,
  volume, net and trade count (so a $44M all-bid-side print reads as the SELL it is).
- **Opportunities view** (`#/opps`, linked from the top nav) — a market-wide intraday screener from
  `/api/screener/stocks`: preset filters (Momentum, High relative volume, Cheap IV, Bullish flow,
  Unusual GEX, Near 52w high) + sortable, heat-mapped columns (rel vol, IV rank, net premium,
  net GEX, 1w %, z-score, RSI, % of 52-week range).
- **Tape** (`#/tape`) — live 1m/5m/15m/30m % movers + volume surge + sparklines for the
  watchlist (★ any symbol to add it) plus liquid defaults. Sortable columns, auto-refreshes
  every 30s while visible (server caches 60s market-open, 15 min closed).
- **Day Trader board** (`#/day`) — the day-trading scan: **squeeze board** (fresh short-interest %
  float + day move), **long/short bias** (biggest net call/put premium), **gainers vs losers**,
  **unusual volume** (relative volume), **OI movers**, **dark pool biggest prints** — all compact
  bars/tables, every ticker clickable. Note: the dedicated short-interest endpoint is stale
  (2021), so squeeze data comes from the live stock screener instead.
- **News** (`#/news`) — the market-wide **ticker-tagged headline wire**: presets (All / Major only /
  Bullish / Bearish / Ticker-tagged) + free-text or ticker filter, newest first, ★ = price-moving.
  The feed is live through the **premarket**, so it answers "why is it moving?" before options data
  updates. Every ticker chip jumps to that symbol. Each symbol also has its own **News** tab.
- **Pulse** (`#/pulse`) — market-wide options sentiment: the options-pulse tape (call/put transactions,
  sentiment score, market sentiment) + intraday sentiment chart, total market option volume (calls vs
  puts, premium), the **top bullish / bearish names by option sentiment**, and a sector pulse.
  Backed by `/api/pulse` (`options-pulse/total`, `options-pulse/sectors`, `volatility/option-sentiment/top`,
  `market/total-options-volume`).
- **Alerts** (`#/alerts`) — two feeds. (1) **⚡ Live flow alerts** — the **real-time** stream while the
  market is open: rule-based tape alerts (`/api/option-trades/flow-alerts`, sweeps / repeated hits),
  live unusual contracts (`/api/option-activity/unusual`) and off-exchange blocks
  (`/api/darkpool/recent`), filtered by a **minimum premium** (≥ $250k default; 500k / 1M presets),
  ⚡ sweep flag, inferred side and ★ watchlist. New prints highlight as **NEW** and ring the 🔔 bell /
  desktop notification + beep. (2) **OI-change alerts** — market-wide open-interest builds vs the prior
  session (`/api/market/oi-change`), ranked CRITICAL / HIGH / WATCH; note this only updates **once a day
  (~06:45 ET)**. Also shows your **native Unusual Whales account alerts** (`/api/alerts`). A compact
  version of both sits on Home. There is an optional **✈ Telegram** toggle (**off by default**) that
  mirrors new live prints + high OI builds to your Telegram via the project notifier
  (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`); it degrades to a no-op when unconfigured.
  Both tables share **inline filters** — asset class (**Stocks / ETFs / Indexes / Other**), Calls/Puts,
  expiry (**Today / ≤7d / All**), **⚡ Sweeps**, min premium, ★ watchlist, muted tickers — behind a
  **▾ Filters** toggle you can collapse to reclaim vertical space.
  Every alert is persisted to `unusual_whales/data/alerts.db` (a **dedicated** DB — never the app's
  `db/alphashri.db`; auto-pruned after 30 days) and shown **in the same table** via a time-range
  control: **Live / 1h / Today / All** — history is mixed into the alerts, not a separate panel.
- **Home page** also carries a **Whale screener** — a market-wide, heat-mapped table of net
  premium, biggest unusual premium, OI change and dark-pool premium across the busiest tickers —
  plus **Latest whale tickets**, the most recent large unusual trades across all tickers sorted by
  latest fill (call/put colored, premium heat, click any ticker to verify in its symbol view).
  Ticket tables carry **expiry, open interest and delta**; dark-pool prints show **price**; OI-change
  rows show **call/put type**; insiders show **price**.
- **Masonry packer** backfills holes and runs an **equalizer** pass so columns end evenly.
- **Whales tab** — a visual answer to "where are the big players betting?": a diverging
  **money map** (net premium by strike, green calls / red puts), a **dark-pool shelf** (volume by
  price), **biggest tickets** (top option prints, ⚡ sweeps), **new positions** (OI change),
  **day OI change by strike** (net call-Δ minus put-Δ per strike — where positioning flowed),
  net premium by expiry, intraday premium and **key levels vs spot** — all charts, colour-coded.
- **Intraday tab** — the latest session for a ticker: 5-min price with VWAP and the key levels
  (open, prev close, gamma flip, call wall, put wall, magnet) drawn as lines, ▲/▼ marks where
  price crossed the flip, a **flip log** (gamma-flip and VWAP crossings), **exit signals**
  (fresh 5-min breakdowns through VWAP: close ≥0.4% under on 2x median volume after trading
  above it, pre-9:45 ET opening flush ignored, amber ▼ on the map), and a **"does it make
  sense?" scorecard** (`N/M checks matched`) that validates the levels/flow against the actual
  price action (regime, walls held, pin, expected move, flow-vs-price). Data is server-trimmed
  to the latest session and downsampled; on weekends it shows the most recent trading day.
- **Every tab has an ⓘ doc button** — click it to open a right-side drawer explaining that
  tab in depth: what it shows, each panel and its exact fields, how to read it, a worked
  number example with a trade decision, and caveats. Docs live on the panel objects as
  `UW.PANELS.<tab>.info` and are rendered by `dashboard/info.js`.
- **Interactive charts** — all line/bar/candle charts are live **ECharts** canvases
  (hover tooltips, legend toggling, resize) and **TradingView Lightweight Charts** for
  candlesticks, served locally from `dashboard/vendor/` (no CDN). Panels keep the old
  `_util` chart signatures, so they emit chart specs that `dashboard/charts.js` mounts.
- Every ticker in any table is clickable → jumps to its symbol view.
- Panels fetch their group on demand (4 concurrent, cached 120s); the API key never
  reaches the browser.

## Focus modes (Intraday / EOD / All)

The header has a persisted **Intraday · EOD · All** toggle (`UW.mode`, `localStorage "uw_mode"`):

- **Intraday (default)** — top nav `Tape · Day Trader · News · Alerts`; symbol tabs `Today · Intraday · Flow · Timeline · Whales · Dark Pool · News`.
- **EOD** — top nav `Pulse · Opportunities · Next week`; symbol tabs `Overview · Heatmap · GEX/Options · Volatility · Positioning · Fundamentals & ETF`.
- **All** — everything, with `INTRA` / `EOD` group labels.

`Home` (top nav) and `Today` (symbol tab) are always visible. Switching to a mode that hides the
current route/tab auto-jumps to the first visible one (`#/` / `Today`).

## Heatmaps

Compact matrix heatmaps (rows × cols, diverging green/red, sticky header + first column) are a shared
component: **`UW.util.matrix({rows, cols, get, fmt, height, corner})`** in `dashboard/panels/_util.js`.
They render the **full** data set and scroll inside the card so they fit the viewport — nothing is
truncated. Used by the symbol **Heatmap** tab (dealer exposure strike × expiry), the **Flow** tab
(strike × time flow), the **Dark Pool** tab (price × time) and the Home **Whale screener** (ticker × metric).

## Freshness & API cadence

Data freshness is adaptive so the dashboard never serves stalled data while the US market is open and
never burns UW quota while it is shut. The policy lives in `scripts/market_status.py` and is served at
`GET /api/status`; the browser reads it via `dashboard/freshness.js` and views poll with
`UW.every("<kind>", fn)` — skipped while the tab is hidden or the docs drawer is open.

| Phase (ET) | Server cache | live | news | pulse | snapshot | opps | symbol | OI alerts |
|---|---|---|---|---|---|---|---|---|
| **open** 09:30–16:00 | 25s | 20s | 30s | 40s | 45s | 60s | 90s | 10m |
| **premarket** 04:00–09:30 | 40s | 45s | 30s | 60s | 60s | 90s | 120s | 5m |
| **afterhours** 16:00–20:00 | 75s | 60s | 45s | 90s | 90s | 120s | 180s | 10m |
| **closed** | 180s | 5m | 2m | 5m | 3m | 5m | 5m | 30m |

**live** = the real-time flow / unusual / dark-pool alert stream (`/api/live`); it is the fastest
because it actually changes intraday. **OI alerts** (`/api/market/oi-change`) are deliberately slow:
the API updates open interest only **once a day at ~06:45 ET**, so polling it during the session
cannot reveal anything new.

The header shows the current phase (green = open). Options/OI data only changes after a session closes,
so premarket the alerts/IV/OI reflect the most recent completed session while news is live. US-market
holidays are not special-cased (the API simply returns no new data).

## Usage (scripts)

```bash
# 1. Refresh the endpoint inventory when UW ships changes
curl -s https://api.unusualwhales.com/docs/openapi.yaml -o docs/openapi.yaml
python scripts/parse_spec.py

# 2. Re-probe entitlements for the current token
python scripts/probe_all.py
python scripts/make_report.py          # -> docs/REPORT.md

# 3. CLI daily snapshot
python scripts/daily_snapshot.py
python scripts/daily_snapshot.py --tickers NVDA,SPY,TSLA,AMD

# 4. CLI news / OI-change alerts (same builders the dashboard views use)
python scripts/news_data.py NVDA        # ticker-tagged headlines
python scripts/alerts_data.py           # ranked OI-build alerts + native account alerts

# 5. CLI market pulse / freshness policy
python scripts/pulse_data.py            # market-wide options pulse + sentiment
python scripts/live_alerts.py           # real-time flow / unusual / dark-pool alerts
python scripts/alert_store.py           # persisted alert-history stats (sqlite)
python scripts/market_status.py         # current phase + adaptive TTL/poll policy
```

Direct API call:

```bash
KEY=$(grep UW_API_KEY .env | cut -d= -f2)
curl -s -H "Authorization: Bearer $KEY" -H "UW-CLIENT-API-ID: 100001" \
  "https://api.unusualwhales.com/api/option-activity/unusual?limit=5"
```

## Current token status (probed 2026-09-25)

| | |
|---|---|
| Working endpoints | **184 / 236** (~78%) |
| Daily quota | **40,000 req/day** (`x-uw-token-req-limit`) |
| Rate limit | effectively none; burst-limited (429 at ~6 concurrent) |
| Usage check | read `x-uw-daily-req-count` from any response, or `client.usage()` |

**Live:** options flow (flow-alerts, unusual, tape, multi-leg, volume profile),
dark pool + lit flow, GEX/greeks/interpolated-IV/max-pain, IV rank/realized
vol/variance-risk-premium, market & sector & ETF tide, net-flow expiry, top net
impact, OI change, congress recent trades, insider transactions/flow, shorts
(interest/float, FTDs, screener), earnings, ETF holdings/flows, institutional
holdings/filings, stock + option screeners, seasonality, technical indicators,
crypto, prediction markets, POTUS posts.

**Gated:** Futures add-on (7) · Advanced+ tier (19: fundamentals, macro, FX,
crypto history, intel/movers, exchange breakdown) · politics/FEC scope (6) ·
volatility scope (1: VIX term structure) · enterprise-only (5: politician
portfolios, stock ownership) · premium add-on (13: private markets, unusual
congress trades) · real-time WebSocket (requires Advanced).

Full breakdown: [`docs/REPORT.md`](docs/REPORT.md).

## Not wired (for now)

- **Crypto** (`/api/crypto/*`) and **prediction markets** (`/api/predictions/*`) — intentionally skipped.
- **Futures** (`/api/futures/*`) and **Advanced+** endpoints (movers, company profile/dividends, forex,
  economy, politics/FEC, VIX term structure) — gated by the token tier; see `docs/REPORT.md`.
- **WebSocket** (`/api/socket/*`) — real-time streams; this terminal is REST/poll-based.

## How to profit

See [`docs/PROFIT_IDEAS.md`](docs/PROFIT_IDEAS.md) — 12 edge families mapped to
exact endpoints (flow continuation, dark-pool levels, gamma pinning/squeezes,
VRP premium harvesting, regime dial, congress/insider clusters, squeeze triggers,
earnings, screener-factory, ETF/institutional, crypto/prediction/POTUS
catalysts), plus monetization paths, limitations, and a fastest-path plan.

## Security

- The API key is a **secret**. It lives in `.env`, which is gitignored. Do not
  commit it, paste it into code, or log it.
- If the key is ever exposed, rotate it at https://unusualwhales.com/dashboard/api.
