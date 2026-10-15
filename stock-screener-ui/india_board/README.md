# India Board — NSE Options Terminal (Fyers)

Indian-style options dashboard powered by the Fyers API: OI ladders, change-in-OI,
PCR, Max Pain and support/resistance walls for NSE F&O stocks and indices.

Universe view (`#/universe`) scans all ~210 optionable NSE stocks for where big
players are positioned: call/put OI buildup, PCR extremes, unusual OI jumps.

> **Not investment advice.** Research tooling only. Fyers token stays server-side
> (via the main app's recorder); never commit secrets. Market data is shown as of
> the last session (on weekends, Friday's OI).

Run: `python scripts/dashboard_server.py --port 8902` → http://127.0.0.1:8902

## Folder layout

```
unusual_whales/
├── .env                      # UW_API_KEY (gitignored — never commit)
├── .gitignore
├── README.md
├── dashboard/                # local web terminal (key stays server-side)
│   ├── index.html            # shell: header + search + view container + styles
│   ├── app.js                # snapshot view, router, symbol search
│   ├── symbol.js             # symbol drill-down shell (header + 10 lazy tabs + masonry)
│   ├── charts.js             # interactive chart engine (ECharts + lightweight-charts)
│   ├── info.js               # right-side ⓘ documentation drawer
│   ├── vendor/               # local copies of echarts.min.js + lightweight-charts.js
│   └── panels/
│       ├── _util.js          # shared helpers + tiny SVG chart lib
│       ├── overview.js       # price, key stats, gamma, max pain, IV rank
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
  **watchlist ★**, and a ⚡ alert when spot is within 0.4% of a key level — then **10 lazy tabs**:
  `Overview · Intraday · Whales · Timeline · Flow · GEX/Options · Volatility · Dark Pool · Positioning · Fundamentals & ETF`.
  (Options is merged into GEX/Options, Shorts+Insiders → Positioning, ETF+Fundamentals.)
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
