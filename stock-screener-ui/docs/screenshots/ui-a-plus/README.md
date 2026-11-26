# UI A+ evidence — all screens (`ui-a-plus`)

Final viewport captures for the UI A+ wave: 15 in-scope routes at 1600×1000 and 390×844, plus loading / error / empty states for 5 of those routes at both widths. The evidence `head` is the final source commit `68eef22c0a336736e8adb440257f656c36d1157f`.

All 60 PNGs sit at the root of this folder so `scripts/evidence-audit.mjs` discovers and validates them:

- `<slug>-<width>.png` — 30 final route captures, e.g. `home-1600.png`, `report-index-390.png`.
- `state-<screen>-<state>-<width>.png` — 30 state captures, e.g. `state-home-loading-1600.png`, `state-sector-empty-390.png`. States were produced with delayed / 500 / zero-row API responses; visible state test ids are recorded in the source capture manifest.
- `manifest.json` — 30 audit states (15 screens + 15 states) with both-width `files` maps, SHA-256 for all 60 root PNGs, and informational references to existing repo evidence.
- Sector sections (8 PNGs) and canonical app evidence (6 PNGs) are **not duplicated here**. The manifest references their existing repo paths: `docs/screenshots/sector-single-page/*.png` and `docs/screenshots/app/*.png`.

All images are viewport screenshots, not full-page captures. Green = positive / advancing, red = negative / declining unless a chart legend says otherwise. Values shown are honest QA-fixture data, not fabricated for the screenshots.

## Screens — one line each, and how to read the data

| Screen | Route | What it shows | How to read it |
| --- | --- | --- | --- |
| `home` | `/home` | Window-manager desk with an Options Chain window and a Market Heatmap window. | Heatmap tiles are stocks: **size** follows the "Size by" selector (default day change) and **colour** follows the colour metric; tile label is symbol + day %. Header shows universe, sizing metric, filter count and the number of stocks/ETFs shown. Options Chain columns are OI / IV / LTP / STRIKE / LTP / IV / OI; the sparse-chain note explains the single listed strike. |
| `screener` | `/screener` | Full-market screener: breadth strip, filter sidebar and a dense 16-column results table. | Breadth counts advances/declines/unchanged/new highs/new lows and the "as of" time; the amber coverage note flags fields with <80% data. In the table, text columns are left-aligned and numbers right-aligned: DAY %, 1M/3M/6M/1Y momentum, a 52W range bar, RSI, ADX, rel vol, mcap and cap tier. Filters on the left narrow the rows; tabs switch Table / Vis / Movers / Deep Value / Sections. |
| `news` | `/news` | Market-intelligence reading desk: three sourced stories grouped by outlet on the left, story reader on the right. | Settled frame: "3 stories across 3 sources" — MONEYCONTROL (Reliance all-time high, 8/10 BULLISH), ECONOMICTIMES (IT sector headwinds, 7/10 BEARISH) and LIVEMINT (RBI repo rate at 6.5%, 5/10 NEUTRAL). The right pane prompt ("Your reading desk is ready") is the no-selection state; select a headline to open the full story, catalysts and AI-assisted brief. |
| `backtest` | `/backtest` | Backtest workspace: results canvas plus a right-hand Config rail and collapsed Results / Trades / Edge AI panels. | The centre card is the three-step empty state (Open Config → Pick symbols → Run). Config holds strategy, symbols (NETWEB, SBILIFE), lookback days and "Include costs"; press Run to populate the lower panels with equity, trade list and edge summary. |
| `paper` | `/paper` | Paper-trading positions grouped by bot, plus a watchlist scan panel; chart pane is empty until a position is selected. | Each bot section shows open positions with qty × entry → current price, P&L in ₹ and %, and age. Watchlist Scan tabs split All / Signals / Watching / Rejected and show the strategy tag (e.g. ORB CONSERVATIVE) and distance to trigger. "No position selected" is expected until a row is clicked. |
| `strategy-runner` | `/strategy-runner` | Side-by-side strategy comparison runner. | Pick bots, a from/to date range and symbols, then Run. "No bot data yet" is the untouched empty state. Tabs are By Bot, By Symbol, Trade Log and Correlation; a completed run fills them with comparative stats. |
| `sector` | `/sector` | Sector dashboard overview: top sector, breadth, performance table, real-time alerts, interval movers and top gainers. | Table columns: CHANGE (day %), MOVE (diverging bar from −3% to +3%), A/D (advancing/declining), ADX strength badge (STRONG / NEUTRAL) and TOP MOVERS with per-symbol %. Green/red bars = up/down sectors. `sector-1600.png` is the route capture; `sector-390.png` is a byte copy of the canonical `sector-single-page/overview-390.png`. The deeper sections are the 8 `sector-single-page` PNGs referenced in the manifest. |
| `patterns` | `/patterns` | Chart-pattern scan results in Matrix view with scope/timeframe controls. | The top strip reads SCANNED 500 / PATTERNS 3 / IN VIEW 3 / CONFIRMED 2, plus last candle and last scan. Each row shows symbol, LTP, CHG %, pattern score (0–100), POS % (where price sits inside the detected pattern), timeframe and a pattern chip; green chips are bullish (Falling Wedge, Cup & Handle), red chips bearish (Head & Shoulders). |
| `strategies` | `/strategies` | Strategy tree and performance management table. | Rows are strategies (ORB Default, 52W Chaser, Momentum) with editable SL %, TP % and MaxPos; the tree tab manages templates/variations and the Performance tab shows outcomes. |
| `bots` | `/bots` | Configured bots with live status, attached strategies, limits and execution controls. | STOPPED vs RUNNING (#pid) badges show bot state; the strategy column lists attached strategy chips. Top-right controls Start All / Stop All / New Bot; row actions are view, start/stop, edit and delete. |
| `report-index` | `/report/index` | NIFTY index report desk: 1-minute candle reconstruction, option-chain OI ladder, OI heatmap and walls strip. | Main chart = white OHLC candles + EMA9, volume bars at the base, a dotted last-price line and dashed NEAR CW/PW (call/put walls) and MP (market pivot) levels; "AS OF 10:00 · market closed" marks the snapshot. Right rail: CE/PE ΔOI per strike with BULL/BEAR flags; heatmap cells are coloured by OI with the spot line overlaid. Walls strip summarises max-OI call/put and expiries (NEAR CW 22,450 / NEAR PW 22,350; PIN +37). The chain header resolves signal text as `CE SIG IBEAR · PE SIG IBULL` at 390. Both widths are byte copies of the canonical `app/report-{1600,390}.png` captures. The WebSocket connection-refused console line is backend noise in the QA environment, not a UI failure. |
| `report-profit` | `/report/profit` | Pattern-profitability report: summary strip, per-strategy table and top signals. | Strip: NET ₹ P&L, PF (profit factor; >1 = profitable), MAX DD. Strategy rows give TRADES, WIN%, NET ₹, EXP/TRADE, PF, MAXDD and HOLD(d). Top signals list symbol, pattern, entry date, in/out ₹ and net ₹ — positive green / negative red. |
| `settings` | `/settings` | Broker connections and display preferences. | CONNECTED / DISCONNECTED badges state whether Upstox and Fyers OAuth links are live; Market Ticker toggles the header ticker; Table density switches Compact (dense) vs Comfortable (roomier row/card padding). |
| `admin` | `/admin` | Honest access-denied screen: the QA `TestUser` has no `is_admin` flag. | "Access denied — admin only" with a Back to dashboard link; no admin privileges were faked for the capture. |
| `chart-RELIANCE` | `/chart/RELIANCE` | RELIANCE 1-day candlestick history with volume bars and a pattern-detection rail. | White candles = up days, green bars = volume; the dotted horizontal line is the last price (1,414.50). The right rail lists detected patterns for the selected timeframe — "No patterns detected" with a 15m chip is the honest result for 1D. |

## State captures

| Screen | Loading | Error | Empty | What the frame proves |
| --- | --- | --- | --- | --- |
| `home` | `state-home-loading-{width}.png` | `state-home-error-{width}.png` | `state-home-empty-{width}.png` | Market heatmap skeleton → `market-heatmap-error` with Retry (forced HTTP 500) → `market-heatmap-empty` with Refresh (zero-row payload). |
| `screener` | `state-screener-loading-{width}.png` | `state-screener-error-{width}.png` | `state-screener-empty-{width}.png` | Screener skeleton → `screener-error-container` with Retry → `screener-empty`. |
| `patterns` | `state-patterns-loading-{width}.png` | `state-patterns-error-{width}.png` | `state-patterns-empty-{width}.png` | Skeleton grid → `patterns-error` alert → `patterns-empty` with relax filters chips; scoped query strings are recorded in the manifest. |
| `report-index` | `state-report-index-loading-{width}.png` | `state-report-index-error-{width}.png` | `state-report-index-empty-{width}.png` | `nifty-report-loading` → page-level ErrorAlert with Retry → empty chain window / report content. |
| `sector` | `state-sector-loading-{width}.png` | `state-sector-error-{width}.png` | `state-sector-empty-{width}.png` | Sector LoadingPanel → ErrorPanel with Retry → EmptyPanel. |

## Validation

- Every PNG was read back; all are exactly 1600×1000 or 390×844, ≥8 KiB, and none is a blank frame.
- No two files in this folder share a SHA-256 hash; every manifest path resolves.
- `sha256` in `manifest.json` covers all 60 PNGs at the folder root (not `manifest.json` or this README).
- `node scripts/evidence-audit.mjs` discovers this folder from its root-level `manifest.json` and validates its 30 states / 60 PNGs against that schema.
- Final replacements: `sector-390.png` ← canonical `sector-single-page/overview-390.png` (`overview-1600.png` still matches its manifest hash, so `sector-1600.png` was kept); `report-index-{1600,390}.png` ← canonical `app/report-{1600,390}.png`; `news-{1600,390}.png` ← settled 3-story captures. Provenance is recorded in the affected manifest states via `stateNote`; the home and screener loading states are marked `stateConfirmed: true`.
