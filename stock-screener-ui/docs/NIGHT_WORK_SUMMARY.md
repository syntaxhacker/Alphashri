# Night work summary — morning review (2026-11-17)

Docs-only handoff. Facts below are from repo docs (`docs/OPTIONS_ANALYTICS_PLAN.md`,
`docs/US_STOCK_CHART_PLAN.md`, `docs/MARKET_VALUE_V2_PLAN.md`, `docs/market-screener.md`,
`docs/DECOUPLING.md`, `docs/AGENT_QUICKSTART.md`, `docs/CHANGELOG_2026-11-16.md`) and the night's test runs.
No code, no git in this pass.

## 1. Options analytics dashboard

- Full-screen dashboard at `/options/analytics/:symbol`, shell
  `src/pages/options/OptionsAnalyticsPage.tsx`. Four lazy pillar tabs
  (`volatility | positioning | dealer | liquidity`, `src/types/optionsDashboard.ts`).
- **One request**: a single `GET /api/options/analytics/{symbol}` (public, no auth change)
  feeds all four pillars. Endpoint registered in `api_server_fastapi.py`, in `openapi.yaml`.
- Pillars / blocks:
  - VOLATILITY — ATM IV smile, IV term structure by DTE, RND/PDF, IV vs realised-vol cone.
  - POSITIONING — call/put OI, OI change (ΔOI) + volume by strike, PCR (cumulative), max-pain payout curve.
  - DEALER — GEX, DEX, Vanna + Charm profiles, Theta decay by expiry/tenor.
  - LIQUIDITY — median-spread/illiquid KPIs, bid-ask spread heatmap (strike × expiry), volume/OI ratio.
- Chart set reported **14/14 live**. Engines `api/options_{positioning,dealer,liquidity,rnd,rv}.py`
  are best-effort: a missing block degrades to `null` + warning (`rv_unavailable`,
  `used_smile_fallback`), never a 500. Wire blocks are nullable — missing ≠ 0.
- RND is derived from a fitted / arbitrage-repaired smile, not raw second differences
  (raw quotes show 34–37% negative butterflies). `IV_MAX` raised 60→100 so genuine
  high-vol prints (KAYNES 79–83) are kept. Test counts in plan: backend analytics 262
  collected, frontend 114 across 13 files, E2E 6+4, OpenAPI drift 26/26.

## 2. US stock chart

- `market=usa` route `GET /api/chart-patterns/symbol/{symbol}/chart?market=usa`.
  Provider registry: Yahoo default, Alpaca optional when `ALPACA_API_KEY/SECRET` set.
- Symbol mapping `BRK.B` → `BRK-B` (`.`→`-`, strip `NASDAQ:`). Timeframes `1m/5m/15m/1h/1D`
  (default 1D). US rows render in-app (NASDAQ/NYSE/AMEX), no `₹`; no SCAN/LIVE badge.
- `is_partial` flags the newest forming 1m bar (mutable OHLC, often volume 0).
  Live patterns engine now runs on demand with `?detect_patterns=1` — pure price engine
  on the provider frame, hits tagged `source="live"` (validated AAPL 1D, 3 hits);
  detection off → empty hits. Deep-link timeframe fix shipped. `market=usa` never calls
  Upstox, the NSE calendar or the stored scan. All 7 lanes shipped; US yfinance is
  **personal use only** (commercial redistribution needs permission; Alpaca licensed fallback).

## 3. Market / Value

- Single screen: NSE (~3,229) or US NASDAQ/NYSE/AMEX. USA universe absolute USD cap
  tiers: mega ≥ $200B, large $10–200B, mid $2–10B, small $0.3–2B, micro < $0.3B.
- F&O removed for US (F&O/ETF tags are India-scoped); active filter row is fixed
  (`FilterStatusRow`, E2E-covered). Stable filter row above result tables.
- **Market Value view (V1, shipped)**: `MarketViewToggle` Table/Map/Movers/Value; Value
  swaps the table for lazy `ValuePanel` (`embedded`/`market`), mapped india/usa.
  Deep Value tab (`?tab=deepvalue`) kept. V2 plan doc (`docs/MARKET_VALUE_V2_PLAN.md`)
  is PLAN/not started; gate: V1 must be reviewed. V2 = value columns joined into the
  existing table via one shared universe/column registry, not a second Value view.

## 4. Patterns

- Stored-first vs live source mismatch fixed (e.g. APLAPOLLO): `close_bar_date` decides
  dated-close vs live source; refresh preserves the selected hit; fresh close never
  paired with a stale bar date. US chart pattern engine now runs (see §2).

## 5. Decoupling / optimizations / security

- Single-source presets `api/value_scan/presets.json` (ids/labels/gates → `filters.py`
  + generated `src/api/valuePresets.generated.ts`). Currency registry `src/config/currency.ts`
  / `currencyFor()`; no `₹`/Cr in components. Tokenized colors via `src/ui/palette.ts`
  + `alpha()`, contrast via `src/utils/contrast.ts` (`contrast.test.ts`).
- Optimizations: RND vectorized (**~19×**, parity to reference); one chain flatten
  (tape/native); single-flight store; cache bounds **512** + TTLs; currency/type/dash
  dedupe; dead deps removed; npm lockfile removed. Prior git history also shows
  vectorized envelope/trendline scans, shaped snapshot cache + singleflight,
  covering indexes / one JSON parse, chain cache-for-session, and tape-chain trims.
- Security hardening: US chart cold limiter, symbol allowlist, redacted 502;
  analytics cost by expiries; cache bounds 512; market 502 redacted.
- `npx tsc --noEmit` baseline **322 errors**; `docs/AGENT_QUICKSTART.md` pins 322
  as the current baseline.

## 6. Verification (final, verified)

- Backend **841 passed** — options analytics, US chart, market, user-configs, OpenAPI.
- Frontend: touched **2100 passed**; paper/options **922**; value **74**;
  reports **134 frontend / 195 backend**.
- E2E: combined **64/64**; post-keyboard **20/20**; workers=4 **24/24 twice**.
- Build + lint green (oxlint 0 warnings/0 errors); tsc **322** (< 327);
  contrast **98/98**.

## 7. Known remaining

- Pre-existing `tsc` clusters (322) in `src/pages/**` beyond report plus
  components/options|sector|strategies|replay|backtest|news — bug hunts, not tidying.
- Backend E2E `backtest-features.spec.ts` / `all-strategies-backtest.spec.ts` have known
  stale-selector failures; do not chase unless touching those screens.
- yfinance personal-use caveat (§2); no stored US pattern scan (live detection only).
- Analytics payload size remains a risk (multi-expiry chains + per-strike arrays).
- **Live-auth caveat (verified 2026-11-17):** `/api/options/analytics/{symbol}` is public but needs a warm chain cache or valid Upstox OAuth; without a token it returns **401 `upstox_auth_required`**, not 503. Dashboard E2E mocks analytics; live check requires reconnecting Upstox in Settings. US chart uses Yahoo (no broker token) and works live.
