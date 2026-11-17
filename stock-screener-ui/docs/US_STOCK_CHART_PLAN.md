# US stock chart plan

> **Status: shipped (2026-11-17).** All 7 lanes below landed. A US stock opened as
> `/chart/:symbol?market=usa` renders an in-app chart from Yahoo (Alpaca optional).
> The live endpoint is
> `GET /api/chart-patterns/symbol/{symbol}/chart?market=usa`; it returns
> `market`, `feed`, `delay_label`, `session_date` plus candles and pattern hits.
> The OpenAPI schema documents this via `SymbolChartResponse` (no hand edits to
> `openapi.yaml`; regenerate with `scripts/export_openapi.py`).

## Goal

When a **US stock** (NASDAQ/NYSE/AMEX, `universe=us`) is opened, render a real
chart in-app on `/chart/:symbol?market=usa` — 1D by default, 1m/5m/15m/1h
available — with honest source/delay labels. India stays byte-identical.

## What existed before this work (verified, 2026-11-16)

These were the findings that drove the design; they are no longer true on
`main` after the shipped lanes below.

- **Runtime charts are Upstox/NSE only.** `ChartView` → `fetchSymbolChart` →
  `api/chart_patterns.py` → `market_data.market_data.fetch_candles_for_timeframe`
  → Upstox instrument keys. A US symbol has no instrument key.
- **US report is not a stock chart.** `api/reports_api/us*.py` is NQ futures
  (Barchart + TradingView scanner), not AAPL/MSFT candles.
- **yfinance is installed but research-only.** It appears in `.prime` skills and
  `scripts/market/*`, never in `api/` or `src/` runtime paths.
- US market rows already have `currency=USD`, `marketCapUsdB`, exchange and a
  TradingView symbol; Deep Value links US rows out to TradingView.

## Data source decision

**Yahoo/yfinance = default.** Measured on 2026-11-16 during the US session:

- 1m last bar = current ET minute, ~0.5 min behind; 5m ~1.5 min behind.
- The newest bar is **forming**: OHLC/volume mutate until the minute closes.
- 1m ~7–8 days; 5m ~60 days; 1h ~730 days; daily unbounded.
- No key, but unofficial/rate-limit/ToS risk. Label `Yahoo · ~1 min (forming)`.

**Alpaca Basic = optional, keyed.** IEX real-time + SIP 15-min delayed, 1m since
2016, 200 req/min, 30 WS symbols. Label `Alpaca IEX · live` (IEX is one venue,
not the consolidated tape). Enabled only when `ALPACA_API_KEY/SECRET` are set.

**Never** use the TradingView scanner for runtime candles (research-only,
redistribution not allowed). No Twelve Data/Finnhub/Polygon free tiers: delayed,
paid candles, or EOD-only.

### Validated library behaviour (yfinance 1.7.0, 2026-11-16)

- `AAPL` 1m: 320 bars, last bar **~10–12 s** behind; 5m last bar ~4 min.
- 1m: **8 days per request**, 30 days total (longer requests return an empty
  frame, not an exception). 5m ~60 days, 1h ~730 days.
- `Ticker.history()` → flat columns; `yf.download()` → MultiIndex unless
  `multi_level_index=False`. Daily `Ticker.history` is NY-tz-aware; `download`
  daily can be naive — normalise both.
- **`BRK.B` does not resolve; `BRK-B` does** → map `.` → `-` for US classes.
- Last 1m bar is **forming** (`Volume=0`, mutable OHLC); drop or flag it.
- `auto_adjust=True`, `actions=False`, `prepost=False` gives clean OHLCV.
- Yahoo's own README says **personal use only**; commercial redistribution needs
  permission. Alpaca is a fallback, not installed today.

```python
yf.Ticker(symbol.replace(".", "-")).history(
    interval="1m", period="5d", auto_adjust=True, prepost=False, actions=False,
)
```

## Architecture

Add a provider boundary; do not fork the chart UI.

```text
ChartView (market=usa)
  -> /api/chart-patterns/symbol/{symbol}/chart?market=usa
     -> MarketDataProvider registry
        india -> UpstoxProvider (existing path, unchanged)
        usa   -> YahooProvider (default) | AlpacaProvider (if key)
     -> tz-aware UTC OHLCV
     -> {symbol, timeframe, candles, overlays:[], trend_lines:[], hits:[], market, feed}
```

- **Provider protocol:** `candles(symbol, timeframe, range) -> DataFrame` with
  tz-aware **UTC** index and `open/high/low/close/volume`; optional `quote()`.
- **Timestamps:** always emit ISO with an explicit offset. The frontend
  `toEpochSeconds` pins naive strings to IST — a naive US timestamp would plot
  ~9.5 h off.
- **Sessions:** `ZoneInfo("America/New_York")`, 09:30–16:00 ET, US holidays.
  Do not reuse `config.IST` for US.
- **Symbols:** `AAPL` → `AAPL`; `BRK.B` ↔ `BRK-B`; strip `NASDAQ:`; preserve the
  URL/display symbol.
- **Cache:** `pattern_cache/candles/{market}/{tf}/{SYMBOL}.pkl`, 30–60 s while
  the US session is open; pin after close. Bump `CACHE_VERSION`. Namespace the
  negative cache too.
- **Patterns (shipped, revised):** the original v1 returned empty
  `hits`/`overlays`/`trend_lines`. The US pattern engine now runs on demand:
  `?detect_patterns=1` applies the **pure price engine** directly to the
  provider frame (no NSE scan store, no Upstox, no IST calendar) and returns
  `hits` tagged `source="live"` with overlays/trend lines. Validated on a live
  AAPL 1D chart — **3 hits**. With detection off, hits stay empty.

## API contract (shipped)

`GET /api/chart-patterns/symbol/{symbol}/chart?market=usa` — live endpoint;
the provider registry selects **Yahoo** by default and **Alpaca** only when
`ALPACA_API_KEY`/`ALPACA_API_SECRET` are set (IEX real-time, SIP 15-min delayed).

- `market` query param: `india` (default) | `usa`; any other value → 400.
- existing `timeframe` (US: `1m`/`5m`/`15m`/`1h`/`1D`), `limit`,
  `lookback_bars`, `detect_patterns`, `compute_trendlines`;
  `as_of_date`/`from_date` are India-only (US replay is not in v1).
- response (documented by `SymbolChartResponse` in `openapi.yaml`) is the
  existing chart payload plus:
  - `market: "usa"`
  - `feed: "yahoo" | "alpaca-iex" | "alpaca-sip"`
  - `delay_label: "~1 min (forming)" | "live (IEX)" | "15 min delayed (SIP)"`
  - `session_date: "YYYY-MM-DD"` (ET)
  - `hits`/`overlays`/`trend_lines` from live detection when `detect_patterns=1`
- `market=usa` never calls Upstox, the NSE holiday calendar, or the stored scan.

**Validated limits (measured, not assumed):** `BRK.B` does not resolve but
`BRK-B` does (`.` → `-` for US share classes; `NASDAQ:` prefixes stripped);
Yahoo 1m history is **8 days per request** (longer → empty frame), 5m ~60 days,
1h ~730 days; the newest 1m bar is **forming** (mutable OHLC, often volume 0)
and is flagged `is_partial`; Yahoo data is **personal use only** — commercial
redistribution needs permission (Alpaca is the licensed fallback).

## Frontend

- `fetchSymbolChart(..., { market })` + `ChartView` reads `?market=usa` (and
  derives it from `?market` / exchange when opened from a row).
- `isInAppChartExchange()` allows NASDAQ/NYSE/AMEX; US rows link to
  `/chart/AAPL?market=usa` instead of TradingView.
- Chart header shows the source badge and US session date; no SCAN/LIVE pattern
  badge for US.
- Time axis uses the candle's own timezone/offset; do not force IST.
- Default timeframe 1D; offer 1m/5m/15m/1h where the provider supports it.

## Tests

### Backend (shipped)

Shipped backend coverage: `tests/api/test_us_chart_provider.py` (provider
selection + symbol mapping), `tests/api/test_chart_us_route.py` (route payload,
AAPL 1D shape, no-data/502 paths — still on the old `test_chart_us_` prefix),
`tests/api/test_us_chart_alpaca.py` (keyed Alpaca feed),
`tests/api/test_us_chart_sessions_cache.py` (ET sessions + cache namespace).
OpenAPI drift is guarded by `tests/contract/test_openapi_sync.py`
(regenerate with `python scripts/export_openapi.py` — do not hand-edit
`openapi.yaml`).

`tests/api/test_us_chart_provider.py`
- provider selection: `india` → Upstox, `usa` → Yahoo, `usa` + Alpaca key →
  Alpaca; unknown market → 400.
- Yahoo fixture: 1m frame, tz-aware index, OHLCV validation, empty frame → 502
  with a fixed error, never a 500.
- `BRK.B` ↔ `BRK-B`; `NASDAQ:AAPL` stripped; original symbol echoed.
- US route does **not** call Upstox / NSE calendar / stored scan / `config.IST`;
  `hits=[]` with detection off, live `source="live"` hits with `detect_patterns=1`.
- cache key contains the market; TTL open vs closed; negative cache.
- `openapi.yaml` regenerated; `tests/contract/test_openapi_sync.py`.

### Frontend
- `chartPatterns.test.ts`: URL includes `market=usa`.
- `ChartView.test.tsx`: US route renders candles; no pattern fetch; feed badge.
- `time.test.ts`: `-05:00`/`Z` offsets correct; naive US strings never IST.
- `valueColumns.test.tsx` / `ValuePanel`: US rows open in-app.
- `chart-us.spec.ts` (E2E, mocked): US row → chart renders → India chart
  unchanged → mobile 390.

### Live smoke (optional, not built)
`scripts/market/us_chart_smoke.py` does **not exist** — this is optional, not built.
If added, it should pull AAPL/MSFT/NVDA 1m, report last-bar lag and forming-bar
volume, and only run during US hours.

## 7 implementation lanes — all shipped ✅

1. ✅ **Provider core** — `market_data/providers/{base,registry,yahoo,symbol_map}.py`
   + unit tests. No route edits.
2. ✅ **Backend route** — `market` dispatch in `api/chart_patterns.py`, US branch,
   session/cache namespace (`chart_patterns/us_cache.py`), OpenAPI
   (`SymbolChartResponse`), backend integration tests.
3. ✅ **Alpaca optional** — `providers/alpaca.py` behind env keys, feed labels,
   tests; no UI.
4. ✅ **Frontend client/route** — `chartPatterns.ts`, `ChartView.tsx`, `market`
   param, US timeframe handling, tests.
5. ✅ **Chart rendering/timezone** — `PatternChartBody`, `patternTVData`,
   `utils/chart/time.ts`, source badge, no-pattern panel, tests.
6. ✅ **US links** — `valueColumns.tsx`, `ValuePanel.tsx`, market row chart action,
   `isInAppChartExchange`, tests.
7. ✅ **E2E + docs/contract** — `tests/e2e/chart-us.spec.ts` (3 cases), India
   regression, `openapi.yaml` regenerated, plan/docs, final gate.

Lanes 1/2/3 are backend; 4/5/6 frontend; 7 test/docs. File sets were disjoint;
2 depended on 1, 4/5/6 on 2, 7 on all. The legacy NQ-futures US report
(`api/reports_api/us*.py`, `src/pages/report/us/**`, `src/api/usReport.ts`,
`src/types/usReport.ts`) was removed as superseded by this in-app chart.

## Risks

- Yahoo blocks/rate-limits; cache and fail over without breaking India.
- Forming last bar mutates; either drop it or label it.
- IEX is a partial venue; never label Alpaca free as consolidated/live.
- US DST/holidays; a fixed +5:30 will silently misplace bars.
- Terms: internal display is one thing; public redistribution is another.
- 1m history is short; don't promise deep intraday history on Yahoo.

## Approval gate — closed

The plan was approved and all 7 lanes dispatched and shipped. Final gate
(backend US tests, frontend chart tests, E2E `chart-us.spec.ts`, India
regression, build/lint/tsc, OpenAPI regen + drift guard) was run by the owning
sessions; `openapi.yaml` is regenerated, not hand-edited.
