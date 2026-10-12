# Edge Scanner TV — Indian + US intraday scanner on the TradingView scanner lib

Port of the [simonro/edge-scanner](https://github.com/simonro/edge-scanner)
architecture (DataFeed → warmup → per-bar triggers → alerts) with the data
layer swapped to this repo's existing stack:

| edge-scanner (US only) | this folder (India + US) |
|---|---|
| `DataFeed` = Alpaca / Schwab WS | `TradingViewFeed` = `tradingview_screener` snapshot/universe + `yfinance` history |
| Nasdaq Trader symbol directory | `tradingview_screener` `set_markets('india' / 'america')` |
| 1-min bar websocket | snapshot polling aggregated into 1-min bars (same pattern as `scanners/trending_upside.py::scan_intraday_3m`) |
| React dashboard | CLI table output (bring your own UI later) |

No orders are ever placed. Scanner only.

## Layout

```
edge_scanner_tv/
  markets.py      MarketSpec for india (NSE, IST) + america (US, ET)
  tv_universe.py  universe + snapshot via tradingview_screener (batched set_tickers)
  tv_feed.py      TradingViewFeed: edge-scanner DataFeed interface over TV + yfinance
  triggers.py     pure-function triggers (HOD/LOD, VWAP, EMA cross, ORB, RVOL, momentum)
  scanner.py      EdgeScannerTV: warmup() → on_bar() → alerts
  run_scan.py     CLI: one-shot scan or --watch polling loop
  server.py       FastAPI server for the web app (serves 1 or both markets)
  dashboard-v2/   React web dashboard (served at /v2/)
  requirements.txt
  tests/test_edge_scanner_tv.py
  tests/test_server_markets.py
```

## Quick start

```bash
source .venv/bin/activate
pip install -r edge_scanner_tv/requirements.txt

# one-shot: top-50 liquid India universe, snapshot + setups
python -m edge_scanner_tv.run_scan --market india --limit 50

# US universe
python -m edge_scanner_tv.run_scan --market america --limit 50

# both markets
python -m edge_scanner_tv.run_scan --market both --limit 50

# live-ish polling loop (snapshot every 60s, default)
python -m edge_scanner_tv.run_scan --market india --watch --interval 60
```

Options: `--setup {all,breakout,vwap,ema,orb,momentum,rvol}` `--min-price`
`--min-volume` `--min-mcap` `--no-history` (skip yfinance warmup, snapshot-only).

## Web app (dashboard-v2)

A desktop-style multi-window dashboard over the same engine (see
[dashboard-v2/README.md](./dashboard-v2/README.md)). One server process can
serve **both** markets, and the top bar exposes an **India / US** switcher:

```bash
# backend: both markets on :7777 (--market india|america|both, default both)
python -m edge_scanner_tv.server --market both --port 7777 --limit 50

# UI: Vite dev server on :5174/v2/, proxies /api -> :7777
cd dashboard-v2 && npm install && npm run dev
```

The dashboard reads `GET /api/v2/markets`; when more than one market is
available it renders the MKT switcher (India | US). Every REST call and the
alert WebSocket carry `?market=<active>`, so the whole page — feed, universe,
charts, screens and watchlists — follows the switch. Screens and watchlists
persist per market under `data/<market>/`. Switching reloads the page, like the
existing ET/IST timezone toggle. A single-market run (`--market india`) hides
the switcher and behaves exactly as before.

## Design notes

- **Universe**: `Query().set_markets('india'|'america').select(...).where(...).limit(N)`
  — same call shape as `scanners/trending_upside.py` and
  `api/screener_api/screener_52w.py::_enrich_with_tv_scanner_data`.
- **Snapshot batching**: `set_tickers(*tickers)` in batches of 80 (TV returns
  empty responses for oversized ticker lists — same `BATCH_SIZE = 80` as
  `screener_52w.py`).
- **History**: the `tradingview_screener` lib exposes scanner fields only, no
  OHLC history endpoint, so daily/5m warmup bars come from `yfinance`
  (India symbols mapped to `SYMBOL.NS`, US symbols used raw). Frames are
  normalized to the edge-scanner schema: UTC tz-aware index,
  columns `open high low close volume vwap trade_count`.
- **Live bars (web app)**: the server feeds the scanner **real 1-minute bars
  from yfinance** — `TradingViewFeed.get_intraday_minute_frames` batch-downloads
  the session for every symbol in one call, seeds each symbol's opening range
  once, then passes only genuinely new bars to `EdgeScannerTV.on_bar`. That runs
  the *real* triggers (`hod_breakout`/`lod_breakdown`, `vwap_reclaim`/`reject`,
  `ema3_9_cross`, `orb15_breakout`, `momentum_5m`, `rvol_spike`). Polled once a
  minute while the session is open. Alerts carry the trigger in `setup_label`
  and the setup-group code (`breakout`/`vwap`/`ema`/`orb`/`momentum`/`rvol`) in
  `setup`, so the dashboard's setup filters match.
- **Live bars (CLI `--watch`)**: edge-scanner's `subscribe_minute_bars` websocket
  has no TV equivalent, so `TradingViewFeed.subscribe_minute_bars` polls
  `get_snapshot` and folds successive snapshots into synthetic 1-min bars.
  Fidelity is lower than a real bar feed (no true high/low per minute) — the
  server's yfinance path above is preferred when available.
- **Snapshot proxies**: `scan_snapshot()` still adds snapshot-only signals
  (`near_52w_high`, `momentum_day`, `above_vwap_proxy`, `rvol_spike`) that need
  no bar history; these also map to the same setup groups.
- **Sessions**: India 09:15–15:30 IST, US 09:30–16:00 ET. Outside session the
  scanner still runs (snapshot data is available) but 1-min bars stop updating,
  so the bar-driven triggers (breakout/ORB/EMA/VWAP) only fire while the market
  is open. Snapshot proxies keep flowing.
