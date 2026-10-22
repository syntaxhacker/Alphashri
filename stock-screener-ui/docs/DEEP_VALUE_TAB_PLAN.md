# PLAN — "Deep Value" tab: seriously undervalued stocks (India / USA / Global)

> Status: **PLAN ONLY — not implemented.** Awaiting sign-off on the 5 open questions in §12.
> Owner: agent. Stack: React 19 + Vite + MUI 9 (`@/ui`) front, FastAPI back, TradingView scanner as data source.

---

## 1. Goal

Add a **new tab** to the Screener that answers one question, fast:

> *"Which stocks are seriously undervalued right now — and are they cheap for a reason?"*

Requirements from the request:
- Compact, dense UI in the style of the **Trendline & Pattern Scan** panel (`src/pages/patterns/PatternsPage.tsx`).
- Full filter set (not just P/E).
- Covers **India, USA and global** markets, switchable.
- Re-usable as a buying screen: "check it whenever I want cheap stocks with value".

Non-goals (v1): portfolio backtesting, live prices for US/global (TV close prices only), news integration, earnings-beat enrichment (phase 2).

---

## 2. Where it lives (decision)

**Recommended: a new tab inside the existing Screener page** (`/` route) — a top-level `Tabs` strip with `SCREENER | DEEP VALUE`.

Why not a new rail entry in `ScreenerNav`:
- The existing screener pipeline (`api/screener_api/screener_scan.py` → `trending_upside.fetch_trending_stocks`) is **NSE/Upstox-centric**: live prices from Upstox, 52-week touch logic, NSE symbol conventions. US/global names have no Upstox quote path, no 52w bucket logic, and different currency/sector semantics.
- The existing table (`ScreenerTable.tsx`) is a standard app table, not the compact dense style requested.

Why not a new route (`/value`): the user asked for a tab inside the screener; a tab avoids nav/route churn and keeps one "scanning" home. If the panel grows (watchlist tab, comparison view), promoting it to `/value` later is a 20-line change (move the component, add a route).

**Layout sketch (compact, one bordered section, dividers inside — no nested cards):**

```
┌ DEEP VALUE ────────────────────────────────────────────────────────────────────────┐
│  [ INDIA ] [ USA ] [ GLOBAL ]        Presets ▾  P/E≤ P/S≤ ROE≥ ▾ FCF≥ ▾ More ▾ ⟳  │
├──────────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────────────┤
│ NAME     │ PRICE│ CH%  │ MCAP  │ P/E  │ P/S  │ FCF%  │ ROE%  │ REV% │ SCORE  FLAGS  │
├──────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼───────────────┤
│ SBI Life │ 940  │ +1.2 │ ₹1.4T │ 9.1  │ 1.4  │ 6.8   │ 21.3  │ +12  │  █ 87  ▲200  │
├──────────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴───────────────┤
│ 42 of 1,486 · sectors: Fin 9 · IT 6 · ... · as of 21:10 IST · cached 6m ago       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Row click → right drawer: score breakdown, peer medians, "why it's cheap" flags, 52w distance, 200-DMA position.

---

## 3. Data source

**TradingView public scanner** (`https://scanner.tradingview.com/{market}/scan`) — already used repo-wide (`api/sector.py`, `api/heatmap.py`, `upstox_trader/screeners/*`), no auth needed for the public endpoint, ~1-3 s per query.

Markets: `india`, `america`, `global` (all three verified reachable; `global` returns ~200 with wide coverage).

### 3.1 Field matrix (raw scanner names)

Verified live in this session (`america` + `india` + `futures`):

| Concept | Raw scanner column | Notes |
|---|---|---|
| Price / change | `close`, `change`, `open`, `high`, `low` | |
| Size | `market_cap_basic`, `total_revenue`, `net_income` | |
| Valuation | `price_earnings_ttm`, `price_sales_ratio`, `price_book_fq` | ⚠️ raw names differ from the *library* aliases in `upstox_trader/docs/tv_fields.md` (`price_book_ratio`, `return_on_equity`, `dividend_yield_recent`) |
| Cash flow | `free_cash_flow_ttm`, `total_cash_flow_ttm` | ⚠️ coverage per market to be confirmed |
| Balance sheet | `total_cash`, `total_debt`, `debt_to_equity_fq` | |
| Profitability | `return_on_equity_fq`, `gross_margin_ttm`, `operating_margin_ttm` | |
| Growth | `total_revenue_yoy_growth_ttm`, `earnings_per_share_diluted_yoy_growth_ttm` | |
| Shareholder return | `dividends_yield_current` | |
| Trend (for the value-trap gate) | `SMA50`, `SMA200`, `RSI`, `Recommend.All`, `Perf.W`, `Perf.1M`, `price_52_week_high` | |
| Classification | `sector`, `industry`, `exchange`, `name` | |

**STEP 0 (blocking, ~30 min): field-coverage spike.** Write `scripts/market/field_coverage.py` that requests every field above for `india` / `america` / `global` and prints a ✅/❌ matrix. Outcome decides the fallback set per market (see §11).

### 3.2 Raw scanner vs `tradingview_screener` library

The repo has both paths. The **raw requests path is preferred** for this feature:
- it supports the full filter dialect (AND/OR/nested), sorting on any column, and `markets: [..]` multi-market;
- the bundled library (`tradingview_screener` 1.0.0) rejects the `futures` market and mangles some field aliases.

New module: `stock-screener-ui/scripts/market/tv_client.py` (already written this session) is the reference implementation — the backend will get a leaner sibling at `api/value_scan/tv_source.py` (or reuse the script module by import; decide at implementation time — recommended: a thin `api/value_scan/tv_source.py` so the API package has no dependency on `scripts/`).

---

## 4. Scoring model — "seriously undervalued"

One number, **0-100**, with four visible sub-scores so the UI can explain itself. Two layers: **absolute floor** (quality) then **peer-relative ranking** (value within sector/market).

### 4.1 Quality floor (hard gates — a name that fails is excluded, not merely penalised)

| Gate | Default | Why |
|---|---|---|
| `price_earnings_ttm` | 3 – 40 | exclude non-meaningful and loss-making |
| `earnings_per_share_diluted_yoy_growth_ttm` | > 0 (toggle) | shrinking earnings = value trap |
| `return_on_equity_fq` | ≥ 8% (toggle) | must actually earn on capital |
| `free_cash_flow_ttm` | > 0 (toggle) | cash-backed cheapness |
| `total_debt / total_cash` | net cash OR D/E ≤ 1.5 (toggle) | leverage kills value |
| `market_cap_basic` | ≥ ₹200cr / $200m (toggle) | liquidity |
| `volume` | > 100k (toggle) | tradability |
| price vs `SMA200` | ≥ 0% (toggle, default ON) | "cheap **and** basing" vs "cheap and collapsing" |

### 4.2 Sub-scores (each 0-25, sum → 0-100)

**VALUE (25)** — cheapness *relative to its own peer bucket* (sector × market bucket median):
- earnings yield: `min(1 / pe, 0.20) / peer_ey` capped → 10 pts
- FCF yield vs peer FCF yield → 6 pts
- P/S vs peer P/S (sector-aware: P/S is meaningless for banks/insurers → drop P/S for `Finance`/`Insurance` and redistribute) → 5 pts
- P/B vs peer P/B → 4 pts

**QUALITY (25)**
- ROE vs peer median (ROE is the cleanest quality proxy) → 8 pts
- gross margin vs peer median → 5 pts
- operating margin vs peer median → 4 pts
- net-cash / low-leverage bonus → 4 pts
- dividend yield (retained cash should be paid or reinvested well) → 4 pts

**GROWTH (25)** — cheap + growing beats cheap + shrinking:
- revenue YoY vs peer median → 9 pts
- EPS YoY vs peer median → 9 pts
- `Perf.3M`/`Perf.1M` (market's own verdict) → 4 pts
- `Recommend.All` (TradingView's composite technical rating) → 3 pts

**HEALTH / RISK (25)**
- earnings volatility proxy (abs EPS YoY > 60% → penalise) → 6 pts
- `debt_to_equity_fq` vs peer → 5 pts
- distance from 52w high (too far = broken; too near = not cheap) → 5 pts
- RSI extremes (very overbought → penalise) → 4 pts
- market cap / liquidity tier bonus → 5 pts

### 4.3 Presets (one click, the "serious" thresholds)

| Preset | Rules |
|---|---|
| **SERIOUS** (default) | P/E ≤ 12, P/S ≤ 1.5 (ex-Finance), ROE ≥ 12%, FCF yield ≥ 4%, EPS growth > 0, net cash or D/E ≤ 0.8, mcap ≥ ₹500cr/$500m, above 200-DMA |
| **DEEP** | P/E ≤ 8, P/B ≤ 1.0, ROE ≥ 15%, FCF yield ≥ 6%, net cash, above 200-DMA |
| **GARP-VALUE** | P/E ≤ 18, ROE ≥ 15%, rev YoY ≥ 8%, EPS YoY ≥ 5%, FCF yield ≥ 2% |
| **YIELD** | div yield ≥ 4%, P/E ≤ 14, FCF yield ≥ 5%, EPS growth > 0 |
| **TURNAROUND** | P/E ≤ 12, EPS YoY > 0 but rev YoY < 3, price > SMA200 (early inflection) |
| **NO GATE** | everything off, pure value ranking (research mode) |

---

## 5. Filters (all markets, all optional, server-side)

Market · Preset · Min mcap · Max P/E · Max P/S · Max P/B · Min ROE · Min FCF yield · Min rev growth · Min EPS growth · Min div yield · Max D/E · Require net cash · Exclude negative FCF · Exclude negative EPS growth · Sector (multi) · Above 200-DMA only · RSI max · Min price · Min volume · Sort by (score | P/E | FCF% | ROE% | distance from 52wH) · Limit (25-500).

All filters are **server-side** (§6) but the client also re-filters the returned frame for instant feedback while a request is in flight.

---

## 6. API contract

`GET /api/value/scan`

**Query** (all optional except `market`):
```
market      india | america | global
limit       int (default 100, max 500)
min_mcap_bn / max_mcap_bn   float (currency-native)
max_pe, min_pe, max_ps, max_pb, min_roe, min_fcf_yield,
min_rev_yoy, min_eps_yoy, min_div_yield, max_de
require_net_cash   bool
exclude_neg_fcf    bool
exclude_neg_eps    bool
above_200dma       bool
sectors            csv
sort               score | pe | fcf_yield | roe | dist_52w
```

**Response**
```jsonc
{
  "market": "india",
  "currency": "INR",
  "as_of": "2026-10-21T15:35:00+05:30",
  "scanned": 1486,          // names in the TV frame after hard gates
  "matched": 42,            // rows returned
  "fields_complete": true,  // false → some fundamental columns missing for this market
  "filters_applied": { "max_pe": 12, "min_roe": 12, ... },
  "rows": [{
    "symbol": "SBILIFE", "name": "SBI Life Insurance", "exchange": "NSE",
    "currency": "INR", "price": 940.1, "change": 1.2,
    "mcap_bn": 1420.0, "rev_bn": 410.0,
    "pe": 9.1, "ps": 1.4, "pb": 1.1, "fcf_yield": 6.8, "div_yield": 1.9,
    "roe": 21.3, "gross_margin": 55.0, "op_margin": 18.0,
    "rev_yoy": 12.0, "eps_yoy": 14.2, "debt_to_equity": 0.3, "net_cash_bn": 120.0,
    "rsi": 58.0, "vs_200dma": 6.4, "off_52w_high": -14.2,
    "score": 87, "subscores": { "value": 24, "quality": 23, "growth": 19, "health": 21 },
    "peer": { "bucket": "Finance", "pe_median": 11.2, "roe_median": 15.4 },
    "flags": ["net-cash", "below-52w-high"]
  }],
  "sectors": [{ "name": "Finance", "count": 9, "avg_score": 74 }],
  "warnings": []
}
```

Errors: `400` invalid market / limit; `502` upstream (TradingView) failure with `warnings[]` explaining; never a bare 500.

---

## 7. Backend design

**New package** `api/value_scan/`
| File | Responsibility |
|---|---|
| `__init__.py` | router export |
| `router.py` | `GET /api/value/scan`, param validation, cache orchestration |
| `tv_source.py` | raw TradingView scanner client (one request per market, all filters applied *after* fetch) |
| `scoring.py` | **pure functions** — peer bucketing, sub-scores, flags, presets. No I/O → trivially unit-testable |
| `filters.py` | filter application + preset definitions (pure) |
| `cache.py` | redis keys/TTL/lock, `invalidate_value_cache()` |

**Key perf decision:** fetch **once per market** (~1,500 names × 25 columns, 1 HTTP request), then filter + score in Python. Filters must therefore be applied *after* the fetch, not pushed into the TV filter dialect (which would need N round-trips). The only TV-side filter is a coarse pre-filter (mcap floor + `price_earnings_ttm` range) to keep the frame small.

**Caching** (`cache/redis_client.py` already has everything needed):
- key: `make_cache_key("value_scan", market, preset_version)` → TTL **900 s** for `india` (market hours), **3600 s** for `america`/`global` (close-based).
- `cache_set_smart` (refresh-if-stale) + `_try_acquire_lock` to prevent stampedes on a cold cache.
- `invalidate_value_cache()` added next to `invalidate_screener_cache()`; wired into `scripts/clear_screener_cache.py`.
- Graceful degradation: if redis is down → compute live (still ~2 s) and return `warnings: ["cache_unavailable"]`.

**Background refresh (optional, phase 2):** a lifespan task that pre-warms the three markets every 15 min during market hours, mirroring the existing 52W range batch pattern.

**Lifespan/CI:** must not break `CI_MODE=1` (no network in CI) → the endpoint returns `502`/`warnings` in CI, and unit tests mock `tv_source`.

---

## 8. Frontend design

**New files**
```
src/api/valueScan.ts               typed client (valueScan(), types matching §6)
src/hooks/useValueScan.ts          fetch + abort + debounce(300ms) + in-memory frame cache
src/components/value/ValuePanel.tsx     compact panel shell (header, market tabs, filter bar, table, footer)
src/components/value/ValueTable.tsx     dense table (sticky header, 12px, right-aligned numbers)
src/components/value/ValueFilters.tsx   compact filter bar + preset menu + "more filters" drawer
src/components/value/ValueScoreCell.tsx  score chip + sub-score micro-bars + tooltip
src/components/value/ValueDetailDrawer.tsx row detail (breakdown, peer medians, flags)
src/components/value/valueColumns.ts    column defs + CSV column list
src/components/value/*.test.tsx
```
**Modified:** `src/pages/screener/ScreenerContainer.tsx` (add the `SCREENER | DEEP VALUE` tab strip), `src/components/screener/ScreenerContainer.test.tsx`, `src/api/index.ts` (screener option list — keep the existing `undervalued` entry untouched).

**Styling rules (AGENTS.md):** `@/ui` wrappers only; `FIN_*` tokens from `src/ui/palette.ts` (no hardcoded hex); 8pt grid; table text 12px; `size="sm"` for inputs/buttons; **one border per section, dividers inside** (no nested bordered cards); `ToolbarRow` for control rows; `Tabs`/`SegmentedControl` for market switch; numeric columns right-aligned, names left, flags centre. Respect `TABLE_CHECKLIST.md` alignment rules.

**Compactness spec (match the reference image):** single dense toolbar row (market tabs + preset + 4 inline numeric filters + "more" + refresh + count), 26-30px row height, sticky header, no vertical padding beyond 4px, flags rendered as 1-2 character chips (`▲200`, `NC`, `FCF−`), sector summary as a single footer line. Target: 40+ rows visible without scrolling on a 1440×900 viewport.

**Interaction:** row click → detail drawer; column sorting client-side over the fetched frame; `CSV` export; "copy symbols" (TradingView-compatible list, like `upstox_trader/screeners` does); link to the existing chart route for the symbol.

---

## 9. Tests

Per `TEST_RULES.md`:

**Backend** `tests/api/test_value_scan/`
- `test_scoring.py` — pure scoring: peer-relative value, quality floor gates, P/S exclusion for Finance, NaN handling (banks without FCF), flag generation, preset application.
- `test_filters.py` — each filter, combined filters, empty result, invalid params.
- `test_router.py` — 200 shape, 400 on bad market, cache hit (mocked redis), upstream failure → 502 + warnings, CI_MODE behaviour.
- `test_tv_source.py` — mocked `requests.post`: correct body, 1 request per market, NaN coercion.

**Frontend** `src/components/value/`
- `ValuePanel.test.tsx` — market tab switch, preset apply, filter apply → refetch with params, loading/empty/error states, sort, CSV export.
- `useValueScan.test.ts` — debounce, abort on unmount, param serialisation.
- `valueScan.test.ts` — client URL/params, error mapping.

**Guards (must pass before commit):** `npx vitest run src/test/ui-guard.test.ts` and `npx vitest run src/ui/inputs/inputs.w-h.test.tsx`.

**E2E:** `e2e/value-scan.spec.ts` — open tab, switch India→USA, apply SERIOUS preset, assert rows + score chips, screenshot at 1440×900. Never run the full E2E suite (per AGENTS.md).

---

## 10. Phasing (small commits, feature branch per AGENTS.md)

| # | Commit | Deliverable |
|---|---|---|
| 0 | `chore: tv field coverage matrix for india/america/global` | `scripts/market/field_coverage.py` + matrix in `docs/` → de-risks the whole feature |
| 1 | `feat(value): scoring + filter engine (pure, unit-tested)` | `api/value_scan/scoring.py`, `filters.py` + tests |
| 2 | `feat(value): tv source + cache + GET /api/value/scan` | `tv_source.py`, `cache.py`, `router.py` + tests |
| 3 | `feat(value): api client + hook` | `src/api/valueScan.ts`, `src/hooks/useValueScan.ts` + tests |
| 4 | `feat(value): compact panel + dense table` | `ValuePanel/ValueTable/ValueScoreCell` + tests |
| 5 | `feat(value): filter bar + presets + market tabs` | `ValueFilters` + tests |
| 6 | `feat(value): detail drawer + CSV + docs` | drawer, export, AGENTS.md section |
| 7 | `test(value): e2e + visual check` | Playwright spec + screenshot review |

---

## 11. Risks & fallbacks

| Risk | Mitigation |
|---|---|
| Fundamental columns missing for `india` (e.g. `free_cash_flow_ttm`) | STEP 0 spike; fallback score = P/E + P/B + ROE + D/E + div yield (the repo's existing `undervalued` profile) and mark `fields_complete: false` + a UI badge |
| P/S meaningless for banks/insurers | sector-aware: drop P/S from VALUE for `Finance`/`Insurance`, redistribute the 5 pts |
| Value traps (cheap because it's broken) | quality floor + 200-DMA gate + explicit flags; "NO GATE" preset available for research |
| TV rate limits / 429 | 1 request per market, 15-60 min cache, lock, exponential backoff, cached-stale fallback |
| Currency mixing | per-market currency in the payload; never compare raw prices across markets; the score is currency-free |
| CI has no network | mock in tests; endpoint returns a clean 502 in CI, never hangs |
| TV "close" for `global` includes OTC/noisy names | restrict `global` to exchanges NASDAQ/NYSE/AMEX/LSE/XETR, exclude OTC |

---

## 12. Open questions (need your call before implementation)

> **Resolved 2026-10-22 — proceeding with the recommended defaults** (user said "let's go"):
> 1. **Placement** → tab inside the Screener page (`SCREENER | DEEP VALUE`), full-width compact panel in the content area; the nav rail stays for the SCREENER tab only.
> 2. **Default market** → **INDIA** (primary trading market); USA / GLOBAL one click away.
> 3. **200-DMA gate** → **ON by default** ("cheap *and* basing"). `NO GATE` preset available for research.
> 4. **Preset thresholds** → as in §4.3.
> 5. **Phase-2 enrichment** → deferred, but the row schema carries an `enrichment` slot so it can be added without a breaking change.

---

## 12b. SELF-REVIEW — corrections applied before implementation

Reviewing my own plan surfaced 8 real defects. All are fixed in the design above:

| # | Defect found | Fix |
|---|---|---|
| 1 | **Circular peer medians** — if peer medians are computed *after* the hard gates, an expensive bucket (AI semis) gets a low median and every survivor looks "cheap vs peers". Self-referential ranking. | **Two-pass**: peer medians from the **full market frame** (pre-gate), then gate, then score. Peer medians are cached with the frame. |
| 2 | **Cache key = filters** → hit rate collapses (every filter combo = a new key) | **Cache the scored frame per market** (post-gate, pre-user-filter) and apply user filters in Python per request. Key = market only. TTL 900 s (india) / 3600 s (america/global). |
| 3 | **Planned a custom `ValueTable.tsx`** — repo rule (`TABLE_CHECKLIST.md`): *"all 25 use the shared TanStackTable — NO custom tables"* | Use the shared `src/components/common/TanStackTable.tsx` with explicit `meta: { align }` per column. No bespoke table component. |
| 4 | **No instrument-type hygiene** — TV frames contain ETFs, funds, warrants, ADRs, rights; `global` also carries OTC shells | Filter `type == 'stock'`, exclude `fund`/`dr`/`warrant`/`unit`, exclude OTC; `global` restricted to major exchanges (NASDAQ/NYSE/AMEX/LSE/XETR/SEHK/TSE). |
| 5 | **Currency mixing** — `global` rows are in EUR/GBP/JPY; mcap sorting/filtering across currencies is meaningless | Per-row `currency`; mcap filter/format is **currency-native** (₹cr / $mn / €bn labels); `global` mcap ranking uses a converted bucket only for display, never for scoring. |
| 6 | **Distorted P/E** — a one-off gain can print P/E 3-4 (looks like the cheapest stock in the world) | P/E floor raised to **4**; names with `P/E < 6 && ROE > 25%` get a `distorted-pe` flag and are demoted in the score (their earnings aren't repeatable). NaN P/E → excluded with a `no-earnings` flag. |
| 7 | **Chart link assumption** — `/chart/:symbol` is Upstox/NSE-backed, so it breaks for US/global rows | Chart/analysis links rendered **only for NSE/BSE symbols**; other rows show the TV symbol instead of a broken link. |
| 8 | **Cold-cache stampede + stale data** | `_try_acquire_lock` (already in `cache/redis_client.py`) + **stale-while-revalidate**: serve the last cached frame immediately and refresh in the background. |

Additional hardening agreed during review:
- **Invariant to unit-test**: exactly **1 TV request per market per cache window** — filters never reach the network.
- **Row payload carries the score components** (`subscores` + `peer` medians + `flags`) so the drawer explains a row without recomputing anything.
- **Self-contained state**: the DEEP VALUE tab owns its hook/store and does **not** touch `useScreenerApi` / the Upstox pipeline (that pipeline is NSE-only).
- **Align to `TABLE_CHECKLIST.md`**: text left, numbers right, badges centred, explicit `meta.align`, and the shared `TanStackTable` cell wrapper.

---


## Appendix A — the engine, in pseudo-code

```
frame = tv_source.fetch(market, prefilter={mcap_floor, pe_range})      # 1 HTTP request
frame = apply_hard_gates(frame, quality_floor)                          # pure
peers  = bucket_medians(frame, key=(market, sector))                    # pure
rows   = [score_row(r, peers) for r in frame.itertuples()]              # pure
rows   = apply_filters(rows, user_filters)                              # pure
rows   = sort(rows, user_sort)[:limit]
return { rows, sectors: aggregate(rows), scanned, matched }
```

Pure functions in §7 `scoring.py`/`filters.py` are the unit-test target; `tv_source.py` and `cache.py` are the only I/O boundaries.

## Appendix B — STEP 0 RESULTS: TV field coverage (measured 2026-10-22, `scripts/market/field_coverage.py`)

**`india` and `america`: 53 usable columns, 9 blocked. `global` is NOT a stocks market** (returns 0 rows
for the stocks scanner — it only works for futures). Global stocks require an explicit country list.

| Field group | india | america | global (multi-country) |
|---|---|---|---|
| identity, price, size, valuation (P/E, P/S, P/B) | yes | yes | yes |
| `free_cash_flow_ttm`, `total_debt` | yes | yes | yes (~85% non-null) |
| `return_on_equity_fq`, `gross_margin_ttm`, `operating_margin_ttm`, `debt_to_equity_fq`, `current_ratio` | yes | yes | yes |
| `total_revenue_yoy_growth_ttm`, `earnings_per_share_diluted_yoy_growth_ttm`, `dividends_yield_current` | yes | yes | yes |
| `SMA50/200`, `RSI`, `Recommend.All`, `Perf.W/1M/3M/Y`, `price_52_week_high` | yes | yes | yes |
| **`total_cash`** | BLOCKED | BLOCKED | BLOCKED |
| **`total_cash_flow_ttm`** | BLOCKED | BLOCKED | BLOCKED |
| **`enterprise_value`** | BLOCKED | BLOCKED | BLOCKED |
| **`price_ebitda_ttm`, `price_enterprise_value_ebitda_ttm`** | BLOCKED | BLOCKED | BLOCKED |
| **`price_target`, `analyst_rating`, `total_analyst_opinions`** | BLOCKED | BLOCKED | BLOCKED |
| `basic_average_shares` | BLOCKED | BLOCKED | BLOCKED |

### Consequences (design changes forced by the measurement)

1. **No net cash** -> replaced by `debt_to_equity_fq` + `current_ratio` + `free_cash_flow_ttm`.
   The "net-cash" preset filter became `max_de` (D/E <= 0.8) + `exclude_negative_fcf`.
2. **No EV/EBITDA, no EV/Sales** -> the engine uses P/S and P/B only.
3. **No analyst target / rating** -> no target-price column in v1; phase-2 enrichment via yfinance.
4. **GLOBAL tab = multi-country request**, one HTTP call:
   `["uk","germany","japan","hongkong","korea","canada","australia","taiwan","singapore","france",
   "sweden","spain","italy","netherlands","switzerland","brazil"]` on `.../global/scan`.
   Measured: 87,820 names total; with a mcap>1e9 pre-filter 33,125; ~20% of rows are `type: "dr"`.
5. **GLOBAL needs de-duplication.** The same company appears on many exchanges — NVDA alone appeared
   8+ times (BMFBOVESPA, BX, SIX, EUROTL, NEO, TSX, TRADEGATE, SWB, XETR, HAM) with different
   currencies and slightly different fundamentals (P/E 4.50 on NEO/TSX vs 28.3 on SIX). Rule:
   keep `type == "stock"`, group by root symbol, keep the listing with the most non-null fundamentals.
   Market cap on a foreign listing is already reported in the **primary** currency (USD) -> no FX maths.
6. **`global` fundamentals coverage is ~85-90%** (vs ~100% for india/america) -> the response carries
   `fields_complete` so the UI can show a "partial fundamentals" badge.

---

## Appendix C — reference: values found in this session (sanity anchors for the engine)

| Name | P/E | P/S | FCF yld | ROE | Rev YoY | Score |
|---|---|---|---|---|---|---|
| GOOGL | 16.8x | 10.2x | 1.3% | 48.7% | +20.2% | 108 (hyperscaler) |
| ADBE | 14.2x | 4.6x | 10.7% | 61.9% | +12.0% | 109 (AI sw) |
| DELL | 28.2x | 2.9x | 2.8% | – | +48.9% | 119 (AI hw) |
| MU | 12.3x | 7.8x | 5.7% | 88.3% | +256% | 134 (AI semis) |
| LRCX | 45.2x | 14.2x | 1.5% | 65.1% | +26.0% | 117 (semicap) |
| IBM | 22.3x | 3.5x | 5.8% | 34.6% | +7.9% | 102 |
| QCOM | 20.6x | 4.4x | 5.5% | 33.8% | +1.9% | – |
| ARM | 232.9x | 49.2x | 0.6% | 13.4% | +25.1% | – (excluded by any sane gate) |

A working engine should rank ADBE/GOOGL/DELL/IBM/MU into the top band for USA and surface Indian large-caps (banks/insurers with ROE 15-20% at 1-1.5x book) in the India tab.
