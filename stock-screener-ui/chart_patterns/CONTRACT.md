# Chart Patterns — Frozen Build Contract (v1)

Repo root: `/home/mysyntax/Documents/Alphashri/stock-screener-ui`
Feature: **new top-level page "Patterns"** (`/patterns`), algorithmic chart-pattern
detection on **real Upstox V3 candles**. No mocks. Nothing from the existing
screener (`ScreenerPage`/`ScreenerContent`/`columns/*`/screener state) is reused.

> This file is the single source of truth for interfaces shared across parallel
> workstreams. Do not change a contract without updating this file.

---

## 0. Non-negotiables

- **Real data only.** Candles come from the existing Upstox V3 transport:
  `market_data/market_data.py` → `fetch_candles(symbol, tf, from_date, to_date, resample_to=None, api_client=None)` and `get_api_client()`.
  Do **not** fork the broker client.
- **Instruments source:** `../upstox_trader/config_and_utils/nse_instruments.json`
  (relative to repo root → `/home/mysyntax/Documents/Alphashri/upstox_trader/config_and_utils/nse_instruments.json`).
  It is a JSON **list** of objects with keys: `segment`, `name`, `exchange`,
  `isin`, `instrument_type`, `instrument_key`, `lot_size`, `trading_symbol`,
  `security_type`. `segment` values include `NSE_EQ` (~9.7k), `NSE_FO`, `NSE_INDEx`.
  Use this file for the universe (equities = `segment == "NSE_EQ"` and
  `instrument_type == "EQ"`; F&O = `NSE_FO` underlyings). Never hardcode a list.
- **Git:** agents must NOT run any state-changing git command. `status`, `log`,
  `diff` are the only git allowed. No commit/push/checkout/reset/stash.
- **No `styles={{...}}`**, no hardcoded hex outside `src/ui/palette.ts`, follow
  `UI_RULES.md` / `UI_CHECKLIST.md` / `TABLE_CHECKLIST.md`.
- **Queue is bounded** and every computation has an id + observable state.

---

## 1. Timeframe registry (full ladder: minutes → months)

`chart_patterns/timeframes.py` exposes `TIMEFRAMES: list[TFSpec]` and
`get_timeframe(id) -> TFSpec`. `TFSpec = {id, label, minutes, native, source_tf, max_lookback_days, min_bars}`.

| id | label | minutes | native Upstox unit/interval | source_tf (resample) | max_lookback_days | min_bars |
|----|-------|---------|------------------------------|----------------------|-------------------|----------|
| `1m` | 1m | 1 | minutes/1 | — | 30 | 60 |
| `3m` | 3m | 3 | — | 1m | 30 | 60 |
| `5m` | 5m | 5 | minutes/5 | — | 90 | 60 |
| `10m` | 10m | 10 | minutes/10 | — | 90 | 60 |
| `15m` | 15m | 15 | minutes/15 | — | 90 | 60 |
| `30m` | 30m | 30 | minutes/30 | — | 180 | 60 |
| `1h` | 1h | 60 | hours/1 | — | 365 | 60 |
| `2h` | 2h | 120 | — | 1h | 365 | 60 |
| `3h` | 3h | 180 | — | 1h | 365 | 60 |
| `4h` | 4h | 240 | hours/4 | — | 365 | 60 |
| `1D` | 1D | 1440 | days/1 | — | 730 | 60 |
| `1W` | 1W | 10080 | weeks/1 | — | 1825 | 52 |
| `1M` | 1M | 43200 | months/1 | — | 3650 | 24 |

- `min_bars` = minimum post-warmup bars to attempt detection; below it, symbol is
  counted `skipped` (reason "history needed").
- `fetch_candles` is the adapter; `3m/2h/3h` are produced with `resample_to`.

---

## 2. Pattern catalog (v1)

`chart_patterns/detectors/` — each detector is a pure function
`detect(df, ctx) -> list[PatternHit]`. Family ids: `reversal`, `continuation`, `curve_cup`.

| pattern_id | name | family | direction |
|---|---|---|---|
| `falling_wedge` | Falling Wedge | reversal | bullish |
| `rising_wedge` | Rising Wedge | reversal | bearish |
| `diamond_bottom` | Diamond Bottom | reversal | bullish |
| `triple_bottom` | Triple Bottom | reversal | bullish |
| `double_bottom` | Double Bottom | reversal | bullish |
| `head_shoulders` | Head & Shoulders | reversal | bearish |
| `inverse_head_shoulders` | Inverse H&S | reversal | bullish |
| `rounding_bottom` | Rounding Bottom | reversal | bullish |
| `ascending_channel` | Ascending Channel | continuation | bullish |
| `descending_channel` | Descending Channel | continuation | bearish |
| `bull_flag` | Bull Flag | continuation | bullish |
| `bear_flag` | Bear Flag | continuation | bearish |
| `pennant` | Pennant | continuation | bullish |
| `rectangle` | Rectangle (unresolved range) | continuation | neutral |
| `ascending_triangle` | Ascending Triangle | continuation | bullish |
| `descending_triangle` | Descending Triangle | continuation | bearish |
| `curve_bearish` | Curve Pattern (Bearish) | curve_cup | bearish |
| `cup_handle` | Cup & Handle | curve_cup | bullish |

`chart_patterns/engine.py`: `detect_patterns(df, timeframe, symbol) -> list[PatternHit]`
applies every detector, dedupes overlapping same-family hits, computes
status/target/stop/rr, sorts by confidence desc.

### PatternHit (dataclass, `detectors/common.py`)
```python
PatternHit(
  pattern_id: str, pattern_name: str, family: str, direction: str,
  status: str,            # forming | confirmed | failed | marginal
  quality: str,           # textbook | strong | fair | marginal
  confidence: float,      # 0..100
  start_date: str, end_date: str,
  start_price: float, end_price: float,
  breakout_level: float, target: float, stop: float, rr: float,
  bars_ago: int, volume_confirmed: bool,
  trendlines: list[list[dict]],  # [[{"t": iso, "price": float}, ...], ...]
  notes: str,
)
```
### Status / target / stop rules (`detectors/common.py`, recommended & tunable)
- `breakout_level` = pattern neckline / trendline value at last bar.
- `target` = measured move = breakout ± pattern height (widest swing projected).
- `stop` = opposite pattern extreme, but never wider than `k * ATR(14)` (k default 1.5).
- `rr = (target - entry) / (entry - stop)`; reject non-positive.
- `status`: `confirmed` if last close crossed breakout line; `forming` if within
  `PROXIMITY_PCT` (default 2%) of it; `failed` if crossed back after confirmation;
  `marginal` if quality < fair.
- `quality` from pivot touch-count + trendline R² + volume confirmation.
- `volume_confirmed` = end swing volume > `1.2 ×` mean of prior 20 bars.

---

## 3. Compute queue (bounded, per-job state)

`chart_patterns/jobs.py` — a **bounded** in-process queue + worker pool.

- Env: `PATTERN_SCAN_MAX_QUEUE` (default `8`), `PATTERN_SCAN_MAX_WORKERS` (default `3`).
- Job id: `cpj_<uuid4hex>`. Persisted in DB so jobs survive process restart.
- Job states: `queued | running | completed | failed | cancelled`.
- Each job tracks `{total, done, failed, skipped, queue_position, started_at,
  finished_at, data_through, error}`.
- When the queue is full, `POST /scan` returns HTTP `429` with
  `{detail, queue_size, max_queue}` (never silently drop).
- Live status mirrored to Redis key `pattern_job:{job_id}` (TTL 24h) and read by
  the API; DB row is source of truth.
- One job = one `(universe, timeframe)` computation for the user. Per-symbol
  failures increment `failed`, never abort the job.

---

## 4. DB schema (new table(s) + migration)

`db/models/chart_patterns.py`:

**`pattern_compute_jobs`** (`__tablename__ = "pattern_compute_jobs"`)
```
id            String(40) PK          # cpj_...
universe      String(32)  not null
timeframe     String(8)   not null
status        String(16)  not null   # queued|running|completed|failed|cancelled
total         Integer     default 0
done          Integer     default 0
failed        Integer     default 0
skipped       Integer     default 0
queue_position Integer    nullable
data_through  String(20)  nullable
error         String(500) nullable
requested_by  Integer     nullable     # user_id
params_json   String      nullable
created_at    DateTime    server_default now()
started_at    DateTime    nullable
finished_at   DateTime    nullable
```

**`pattern_hits`** (`__tablename__ = "pattern_hits"`)
```
id            Integer PK autoincrement
uuid          String(36) unique
job_id        String(40) index
symbol        String(32) index
name          String(128) nullable
timeframe     String(8)  index
pattern_id    String(48) index
pattern_name  String(96)
family        String(24)
direction     String(12)      # bullish|bearish|neutral
status        String(16)      # forming|confirmed|failed|marginal
quality       String(16)
confidence    Float
start_date    String(20)
end_date      String(20)
start_price   Float
end_price     Float
breakout_level Float
target        Float
stop          Float
rr            Float
bars_ago      Integer
volume_confirmed Boolean
payload_json  Text           # trendlines + notes
created_at    DateTime server_default now()
```
Indexes: `(symbol, timeframe)`, `(job_id, status)`, `(pattern_id)`.

Migration `db/migrations/versions/2026_10_03_1200-cp1a2b3c4d5e_add_chart_patterns.py`
(new `revision`, `down_revision` = current head — find it from the latest
migration's `revision` var, never the filename). Validate with
`python scripts/validate_migrations.py`. Export both models from
`db/models/__init__.py`.

---

## 5. API contract — router `api/chart_patterns.py`, prefix `/api/chart-patterns`

All responses JSON-sanitized via `_sanitize_for_json`. Auth: `Depends(get_current_user)`
except read-only market endpoints may be open (match `/api/chart` precedent).
Registered in `api_server_fastapi.py` + background task `chart_patterns_bootstrap_task()`
in lifespan (prompt initial run during market hours, then interval
`PATTERN_SCAN_INTERVAL_SEC` default 900).

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/timeframes` | — | `{timeframes:[TFSpec]}` |
| GET | `/universes` | — | `{universes:[{id,label,count}], default:"nifty500"}` |
| GET | `/patterns` | — | `{families:[{id,label}], patterns:[{pattern_id,name,family,direction,description}]}` |
| POST | `/scan` | `{universe, timeframe, force?}` | `{job_id, status, queue_position, queue_size}` / 429 if full |
| GET | `/jobs` | `?active=1` | `{jobs:[JobDTO]}` |
| GET | `/jobs/{job_id}` | — | `JobDTO` |
| GET | `/results` | `job_id, universe, timeframe, family[], direction[], status[], quality, formed_within_bars, volume_confirmed, min_rr, symbol, limit=100, offset=0` | `{items:[PatternHitDTO], total, summary, data_through}` |
| GET | `/summary` | same filters | `{scanned, patterns, in_view, confirmed, bullish, bearish, data_through}` |
| GET | `/symbol/{symbol}` | `?timeframe` | `{symbol,name,last_close,day_change_pct,history_bars,timeframes:[...],counts:{confirmed,forming},patterns:[PatternHitDTO]}` |
| GET | `/symbol/{symbol}/chart` | `?timeframe&limit` | `{symbol,timeframe,candles:[{t,o,h,l,c,v}],overlays}` |

**JobDTO**
```json
{"job_id":"cpj_...","universe":"nifty500","timeframe":"1D","status":"running",
 "total":500,"done":210,"failed":3,"skipped":40,"queue_position":null,
 "started_at":"...","finished_at":null,"data_through":"2026-09-30","error":null}
```

**PatternHitDTO**
```json
{"id":123,"symbol":"IRCON","name":"IRCON International Ltd.","timeframe":"1D",
 "pattern_id":"falling_wedge","pattern_name":"Falling Wedge","family":"reversal",
 "direction":"bullish","status":"confirmed","quality":"strong","confidence":78.4,
 "start_date":"2026-04-26","end_date":"2026-09-26","start_price":129.8,"end_price":112.6,
 "breakout_level":112.6,"target":129.6,"stop":102.5,"rr":1.7,"bars_ago":1,
 "volume_confirmed":true,"trendlines":[[{"t":"...","price":...}]],"notes":"..."}
```

---

## 6. Frontend contract

### Route / nav
- `src/App.tsx`: add lazy route `<Route path="/patterns" element={<PatternsContainer />} />`.
- `src/components/layout/NavbarNested.tsx`: add `{ label: "Patterns", icon: IconChartCandle, link: "/patterns" }`.

### Files & ownership
- `src/types/chartPatterns.ts` — all DTO types (mirror §5 exactly).
- `src/api/chartPatterns.ts` — typed fns using `fetchWithAuth` + `API_URL`.
- `src/state/chartPatterns.ts` — `createSubscriber` store (net-new).
- `src/hooks/useChartPatterns.ts` — `useStoreSubscription` hook.
- `src/pages/patterns/PatternsContainer.tsx` + `PatternsPage.tsx`.
- `src/components/patterns/*` — all presentational components (new).

### Hook return shape (frozen)
```ts
useChartPatterns() -> {
  timeframes: TFSpec[]; universes: Universe[]; patterns: PatternDef[];
  timeframe: string; setTimeframe(v:string):void;
  universe: string; setUniverse(v:string):void;
  filters: PatternFilters; setFilter(k,v):void; resetFilters():void;
  job: JobDTO | null; scanning: boolean; queuePosition: number | null;
  summary: PatternSummary | null;
  results: PatternHitDTO[]; total: number;
  selectedSymbol: string | null; setSelectedSymbol(s:string|null):void;
  detail: SymbolDetail | null; detailChart: ChartPayload | null;
  loading: boolean; error: string | null;
  scan(): void; refresh(): void; loadSymbol(s:string): void;
}
```

### Required data-testids (visual/E2E contract — must exist)
`patterns-page`, `patterns-universe-bar`, `patterns-universe-<id>`,
`patterns-scan-again`, `patterns-job-status`, `patterns-stats`,
`patterns-stat-<key>` (keys: `scanned|patterns|in_view|confirmed|bull_bear|data_through`),
`patterns-timeframe-select`, `patterns-filter-rail`,
`patterns-card`, `patterns-card-<symbol>-<pattern_id>`,
`patterns-detail-pane`, `patterns-detail-chart`, `patterns-empty`, `patterns-loading`.

### UI rules
- Use `@/ui` components; `ToolbarRow` for control rows; `SimpleGrid` for the card
  grid; palette tokens only; 8pt grid; one border per section; no nested cards.
- TF selector is server-driven from `/timeframes`.
- 3-column desktop layout: filter rail | card grid | detail pane; detail pane
  collapses below `lg`.

---

## 7. Verification (definition of done)

- Backend: detector unit tests on synthetic geometries; engine edge cases; API
  tests with `test_engine`; migration validation.
- `scripts/verify_chart_patterns.py --symbols "RELIANCE,TCS,..." --timeframes all`
  runs the engine on **real** V3 candles for every pattern × every TF and writes
  a report flagging patterns that never fire (possible detector bug).
- Frontend: vitest component/state/API tests; Playwright spec
  `e2e/patterns.spec.ts` (open `/patterns`, see cards, switch TF, filter, open
  detail).
- Visual: main agent captures chrome-devtools screenshots per TF and per selected
  pattern on the final build and verifies overlays render correctly.
