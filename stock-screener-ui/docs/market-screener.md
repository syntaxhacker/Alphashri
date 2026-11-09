# Market Screener — one-page NSE universe

> Single screen: all NSE stocks (~3,229) with cap tiers, client-side filters, tags (F&O/ETF), and a detail dock.
> Backend: `api/market_screen/` — `router.py` + `snapshot.py`, `GET /api/market/snapshot`.
> Frontend: `src/components/market/`, `src/pages/market/MarketScreenerPage.tsx`; tab `?tab=market` in `ScreenerPage.tsx` (default tab unchanged).
> No page navigation — toolbar, filter rail, virtualized table, detail dock on one screen.

## 1. Purpose

One screen for the full NSE universe (~3,229 stocks). No routing between pages:

- **Toolbar**: market status badge (`market-mode-badge`: Live / Delayed / Unknown), last-updated, force-refresh.
- **Filter rail** (`MarketFilterRail`): exchange segment, cap tier (large / mid / small / micro), price band, change %, volume, F&O / ETF tags, search.
- **Table** (`marketColumns.tsx`): `TanStackTable` with `rowWindowSize={80}`, `fillContainer`, sortable columns, fin-app alignment (text left, numbers right, badges/actions centre), row click opens the detail dock.
- **Detail dock**: per-stock quote, tier, tags, 52w position; canvas reserved for a future map/sparkline mode — never inside the table.

Non-goals: fundamentals scoring (Deep Value tab), corporate-event lenses (Event Radar tab), pattern detection (chart-patterns). Those remain separate tabs.

## 2. Backend — `GET /api/market/snapshot`

Files: `api/market_screen/router.py` + `api/market_screen/snapshot.py`.

| Param | Type | Meaning |
|---|---|---|
| `universe` | string | `all_equity` (default) \| `nifty500` \| `nifty50` \| `nse_fo` |
| `limit` | int | row cap; default 4000 |
| `force` | bool | bypass the 15 s cache and re-scan TradingView |

Response row fields:

| Field | Notes |
|---|---|
| `symbol`, `name` | NSE symbol + long name |
| `sector`, `industry`, `exchange` | classification + `NSE` |
| `close`, `change`, `volume`, `relative_volume` | quote + volume vs average |
| `market_cap`, `market_cap_cr` | cap value and ₹ crore |
| `cap_tier` | `large` (rank 1–100), `mid` (101–250), `small` (251–500), `micro` (501+) — rank by market cap |
| `rsi`, `adx`, `atr`, `sma20`, `sma50`, `sma200` | technicals |
| `perf_w`, `perf_1m`, `perf_3m` | performance windows |
| `high_52w`, `low_52w`, `pos_52w` | 52w range and position within it |
| `fno`, `etf` | boolean tags |

Caching: 15 s TTL per universe; `force=true` clears it. Stale-while-revalidate is acceptable — never block the UI on a re-scan.

Auth: TradingView scanner cookies resolve exactly as in `api/tv/auth.py`:

1. `TRADINGVIEW_COOKIES` / `TV_COOKIES` env (JSON object/array or `name=value; ...`) — production path.
2. Local browser via `upstox_trader.screeners.tv_cookies` — dev only, never in CI/tests.

With cookies → `streaming` (real-time). Without → `delayed_streaming_900` (15-minute delay). Feed freshness is observed by `api/tv/status.py` (`tv_feed_status()`) and surfaced as the `market-mode-badge` text Live / Delayed / Unknown. `.env.example` already documents `TRADINGVIEW_COOKIES`; production must set it. Locally the browser fallback covers dev.

## 3. Frontend

Files (confirmed): `src/components/market/MarketScreenerPanel.tsx`, `MarketFilterRail.tsx`, `marketColumns.tsx`, `marketFilters.ts`; `src/pages/market/MarketScreenerPage.tsx`; `src/api/marketScreener.ts`; `src/hooks/useMarketSnapshot.ts`; `src/types/marketScreener.ts`. Tab `?tab=market` in `src/components/screener/ScreenerPage.tsx`.

Layout: fixed toolbar at top, collapsible filter rail, virtualized table filling the rest, detail dock sliding from the right on row selection. No nested bordered cards — one border per section, dividers inside.

- All filtering (tier, tags, price band, change, volume, search) is **client-side** on the snapshot payload — no round-trip per filter change.
- Table uses **DOM virtualization** via `TanStackTable` with `rowWindowSize={80}` and `fillContainer`; only visible rows are in the DOM.

Why not a canvas grid:

- ~3,229 rows exceed comfortable canvas hit-testing/selection complexity for this app; `TanStackTable` + virtualizer already gives sticky headers, row selection, and per-column `meta: { align }` alignment.
- Canvas is reserved for a future map/sparkline mode — not added in v1.

Performance budgets:

| Metric | Budget | How |
|---|---|---|
| Warm load (cached snapshot) | < 1 s | 15 s cache + client-side filter |
| Filter apply (any rail change) | < 50 ms | pure JS over the in-memory frame |
| Scroll | 60 fps | virtualized rows, no layout thrash on scroll |

## 4. How to run / verify

```bash
# Full stack (API + UI), then open ?tab=market
./start.sh

# Backend
source .venv/bin/activate
python -m pytest tests/api/ -q          # targeted: tests/api/test_market_snapshot.py
python scripts/validate_migrations.py   # if a migration ships with this feature

# Frontend
npx vitest run src/api/marketScreener.test.ts src/hooks/useMarketSnapshot.test.ts \
  src/components/market src/pages/market
npx vitest run src/test/ui-guard.test.ts src/ui/inputs/inputs.w-h.test.tsx
npx playwright test tests/e2e/market-screener.spec.ts --list
bun run lint                            # oxlint — 0 warnings/errors required
bun run build                           # vite production build
```

Before marking done: a chrome-devtools screenshot at a real viewport in empty / loading / full states, confirming the `market-mode-badge`, filter rail alignment, virtualized scroll at ~3k rows, and detail dock open/closed. Guards (`ui-guard`, `inputs.w-h`) plus the feature's unit/E2E tests are part of definition of done — build/lint do not catch alignment bugs.

## 5. Environment

| Variable | Default | Notes |
|---|---|---|
| `TRADINGVIEW_COOKIES` | *(empty)* | Production: cookie header or JSON from a logged-in TradingView browser session. Without it, scanner is 15 min delayed. |
| `TV_COOKIE_TTL_SEC` | `600` | Jar cache TTL (`api/tv/auth.py`). |

Local dev: leave blank — cookies are read from the local Chrome profile (dev only, disabled under `CI`/`pytest`).

## 6. Limitations (known, not bugs)

- Fundamentals coverage ~85% across the universe; FCF only ~3.6% (3.6% of names carry `free_cash_flow_ttm`). No net-cash, EV, or price/EBITDA filters — TV scanner does not expose those fields.
- No analyst targets, no EV multiples, no price-target column.
- Pattern detection and event lenses (Event Radar) are separate tabs — not part of this screen.
- Canvas grid not implemented; added only if a map/sparkline mode is added later.
- Without `TRADINGVIEW_COOKIES` in production, data is `delayed_streaming_900`; badge shows "Delayed".
