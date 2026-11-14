# Index Report hangs: `GET /api/reports/breakouts`

Status: **root cause identified, not fixed**. Diagnosis only — no application code was changed.

Date of investigation: 2026-11-13, ~21:24–21:50 IST (after NSE close, on a trading day).

---

## 1. Route and handler

| What | Where |
|---|---|
| OpenAPI entry | `openapi.yaml:8962` — `/api/reports/breakouts` → `operationId: get_breakouts_api_reports_breakouts_get` |
| Router | `api/reports_api/breakouts.py:41` — `APIRouter(prefix="/api/reports", tags=["reports"])` |
| Decorator | `api/reports_api/breakouts.py:387` — `@router.get("/breakouts")` |
| Handler | `api/reports_api/breakouts.py:388` — `def get_breakouts(date: Optional[str], universe: str)` |
| Sibling handler with the same cost | `api/reports_api/followthrough.py:352` — `def get_follow_through(...)` |

Call chain (all line numbers verified in the working tree):

```
breakouts.py:388  get_breakouts
  -> breakouts.py:415  serve_report(date_str, univ)
       -> breakouts.py:358  compute_report(...)            # today path: 60 s in-process dict
            -> breakouts.py:301  run_symbols(fn, symbols, workers=6, use_processes=False)
                 -> breakouts.py:213  _scan_one(symbol, ...)
                      -> breakouts.py:223  fetch_for_timeframe(sym, "1D", include_partial_today=True)
                           -> candles.py:790  if include_partial_today and tf_id == "1D" and is_today:
                                -> candles.py:791  _with_partial_today(df, symbol, api_client)
                                     -> candles.py:858  _cached_synthetic_today(api, symbol)
                                          -> market_data.py:822  _synthetic_today_bar(api, symbol)
                                               -> market_data.py:749  api.fetch_intraday_data_v3(symbol, "1")
                                                    -> upstox_api.py:289  fetch_intraday_data_v3
                                                         -> upstox_api.py:80  _request
                                                              -> queued_rate_limiter.py:187  QueuedRateLimiter.execute
```

`get_breakouts` is a **sync** `def`, so it runs in FastAPI's AnyIO threadpool and does not block the event loop. That is why the rest of the API stays healthy while this one request never returns.

---

## 2. Measured timings

All probes bounded with `--max-time`; no command was allowed to hang.

### 2.1 Endpoint probes (while the reported request was in flight)

```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}\n" --max-time 60 \
  "http://localhost:8765/api/reports/breakouts?date=2026-11-13&universe=nifty500"
```

| Endpoint | HTTP | `time_total` | Note |
|---|---|---|---|
| `GET /health` | 200 | **0.0293 s** | server is alive |
| `GET /api/reports/daily?date=2026-11-13&universe=nifty500` | 200 | **0.0055 s** | cached |
| `GET /api/reports/delivery?date=2026-11-13&universe=nifty500&limit=15` | 200 | **0.0033 s** | cached |
| `GET /api/reports/breakouts?date=2026-11-13&universe=nifty500` (attempt 1) | **000** | **60.0024 s** | `curl` exit 28 — client timed out |
| `GET /api/reports/breakouts?date=2026-11-13&universe=nifty500` (attempt 2) | **000** | **60.0024 s** | `curl` exit 28 — client timed out |
| `GET /api/reports/breakouts?date=2026-11-13&universe=nifty500` (attempt 3) | **000** | **60.0024 s** | `curl` exit 28 |

### 2.2 Cost of the per-symbol work (project venv, separate process)

```bash
.venv/bin/python -c "
from chart_patterns.candles import fetch_for_timeframe
import time
for s in ['SBIN','ITC']:
    t=time.time(); fetch_for_timeframe(s,'1D'); print(s,'cache-path',round(time.time()-t,2))
    t=time.time(); fetch_for_timeframe(s,'1D',include_partial_today=True); print(s,'partial-today',round(time.time()-t,2))
"
```

| Call | Time |
|---|---|
| `fetch_for_timeframe("SBIN","1D")` (disk cache) | **0.50 s** |
| `fetch_for_timeframe("SBIN","1D", include_partial_today=True)` | **11.50 s** |
| `fetch_for_timeframe("ITC","1D")` (disk cache) | **0.00 s** |
| `fetch_for_timeframe("ITC","1D", include_partial_today=True)` | **10.01 s** |
| `_scan_one("SBIN", ...)` end-to-end | **1.56 s** |
| `_scan_one("ITC"/"WIPRO"/"TCS", ...)` end-to-end | **0.12–0.15 s** |
| `_cached_synthetic_today(api, sym)` × 10 symbols | mean **4.27 s**, max **10.91 s** |

### 2.3 The limiter is pinned at its cap (Redis, read-only)

```bash
.venv/bin/python -c "
from cache.redis_client import get_redis_client; import time
r=get_redis_client(); now=time.time()
print('api_hits_60s', r.zcount('upstox:rl:hits:api', now-60, now))
print('circuit_until', r.get('upstox:circuit:until'), time.time())
"
```

| Key | Value | Meaning |
|---|---|---|
| `upstox:rl:hits:api` (last 60 s) | **120** | exactly at the `api` slice cap of 120 req/min (`upstox_trader/rate_limiter.py:79-84`) |
| `upstox:rl:hits` (last 60 s) | 125 | global budget not the binding constraint |
| `upstox:circuit:until` | **+45.4 s remaining** | the 429 circuit breaker was **open** during the scan |

Rates were sampled twice, ~10 minutes apart, and were identical (120/60 s, circuit re-opening), i.e. not a transient spike.

### 2.4 Scan fan-out arithmetic

```bash
.venv/bin/python -c "
from chart_patterns.universes import get_universe
from chart_patterns.parallel import max_workers
u=get_universe('nifty500'); print(len(u), max_workers())
"
# 501 6      (8 cores -> _MAX_WORKERS_CAP = 6)
```

| Quantity | Value |
|---|---|
| Symbols scanned | **501** |
| Outer threads (`max_workers()`) | **6** |
| Symbols needing a 1D daily fetch (no `.meta` sidecar) | **7** |
| Symbols needing a per-symbol **intraday tape** fetch | **501** |
| Upstream calls per scan | **≈508** |
| Hard floor at 120 req/min | **4.2 min** |
| Worst case with the 429 circuit open (10 s stall per call, 6 threads) | **501 × 10 s ÷ 6 ≈ 14 min** per scan |

---

## 3. Root cause

`_scan_one` (`api/reports_api/breakouts.py:223`) passes **`include_partial_today=True`** on every symbol. That flag exists for the *single-symbol chart* path; in a universe scan it forces `chart_patterns/candles.py:790-791` → `_with_partial_today` → `candles.py:858` `_cached_synthetic_today` → `market_data.py:822` `_synthetic_today_bar` → **one `GET /v3/historical-candle/intraday/{key}/minutes/1` per symbol** (`upstox_api.py:289,313`).

So the scan issues **501 individual intraday HTTP requests** that the daily-bar logic does not need as a fan-out. Those requests go through the process-wide `QueuedRateLimiter` (`upstox_api.py:80` → `queued_rate_limiter.py:187`) which is capped at **120 requests/minute for the `api` consumer** (`rate_limiter.py:79-84`). 508 calls ÷ 120/min = **4.2 minutes floor**, and the measured Redis counter sits at exactly 120/60 s — the scan is consuming the entire budget.

The second multiplier is the **429 circuit breaker** (`queued_rate_limiter.py:31,165-185`): while `upstox:circuit:until` is in the future, *every* queued request burns up to `_CIRCUIT_WAIT_MAX = 10 s` before raising `CircuitOpenError`, and `fetch_intraday_data_v3` swallows it and returns `None`. That is exactly the 10.0–11.5 s per-symbol figure measured in §2.2. 501 symbols × 10 s ÷ 6 threads ≈ **14 minutes** for one scan. The scan's own 500-request burst is what keeps re-arming the 429 circuit, so the scan feeds its own stall.

The third multiplier: `GET /api/reports/follow-through` for a date with no stored artifact calls `breakouts_mod.compute_report` **directly** (`api/reports_api/followthrough.py:102-121`) instead of the cached `serve_report`. `experiments/data/reports/breakouts/` has no `2026-11-13_nifty500.json`, so **the page fires two full 501-symbol scans concurrently** (~1,016 upstream calls → 8.5 min floor before any circuit penalty). The singleflight in `candles.py:_coalesced_fetch` only wraps the *cached daily* fetch; the intraday call at `candles.py:790` happens **after** coalescing and is therefore duplicated per scan.

Nothing is deadlocked or CPU-bound: the API process had 114 threads, all in state `S`, **3.6 % CPU**, and 112 open sockets during the hang.

---

## 4. Was the XHR still in flight or timed out at 180 s?

**Still in flight server-side.** Uvicorn writes the access-log line only when the response is sent, and there is no completion line for the reported request:

```
logs/alphashri.log:37646  OPTIONS /api/reports/breakouts?date=2026-11-13&universe=nifty500  204
(logs/alphashri.log)      GET     /api/reports/breakouts?date=2026-11-13&universe=nifty500  <never logged>
```

Whole-log counts: **5** `OPTIONS /api/reports/breakouts` vs **3** `GET … 200 OK` — every page load preflights, two of the GETs never completed. The page load was at ~21:24:21 (adjacent vite HMR markers at `logs/alphashri.log:37630`) and the request still had no completion line at the last log entry (~21:43), i.e. **>18 minutes** in flight, far past the client's 180 s. My three 60 s curls likewise never produced a log line.

The client gave up; the server did not. A sync handler is not cancelled on client disconnect, so the scan kept running and kept holding the 120 req/min budget.

---

## 5. Frontend behaviour (amplifier, not the cause)

`src/pages/report/DailyReportPage.tsx`:

* **`REPORT_FETCH_TIMEOUT_MS = 120000`** (line 30) — yes, the UI silently shows the skeleton for a full **2 minutes** before surfacing anything. `withTimeout` (lines 90-104) only rejects the promise; it does **not** abort the underlying fetch (`controller` is aborted only when the effect re-runs, line 85). So each timeout leaves a 500-symbol scan running on the server and every retry stacks another one.
* **`const loading = () => dailyLoading() && breakoutLoading();`** (line 313) — this *does* contradict the comment above it ("loading only while both sections are still pending" / "loads independently", lines 79-81, 139-140, 154-155). The value is consumed by the **outer** `<Show when={loading()}>` at line 414, whose children are the whole page body; the skeleton `data-testid="report-loading"` is line 697. Because `dailyLoading()` goes false in ~2 s but `breakoutLoading()` stays true for minutes, `dailyLoading() && breakoutLoading()` is **false → true is never needed**: the gate stays `true` whenever breakouts are pending, so the entire tab body (already-loaded market moves included) is replaced by four skeleton bars.
* **`const error = () => (dailyError() != null && breakoutError() != null ? dailyError() : null);`** (line 314) — requires *both* sections to fail. With `daily` succeeding, the page-level error never renders; after 120 s the body renders and only the inner breakouts panel (`line 549`) shows its own error. So the observed sequence is: skeleton for 120 s → breakouts panel error, with no indication that the other sections were ready almost immediately.

---

## 6. Minimal recommended fix (not implemented)

**Do not fetch the intraday tape per symbol. Use the batch quote path that already exists for the pattern scanner.**

`chart_patterns/scan.py:789-799,824-829` already does exactly this:

```python
partial_bars = fetch_ohlc_batch(symbols, interval="1d") or {}   # 1-2 HTTP calls, 500 keys each
...
functools.partial(..., partial_bars.get(symbol))
```

Change, ~10 lines:

1. In `compute_report` (`breakouts.py:279`), before the fan-out, call
   `market_data.fetch_ohlc_batch(symbols, interval="1d")` once (guarded by `_today_is_session()` and `is_today`).
2. Thread the dict into `_scan_one` and pass `partial_bar=partial_bars.get(sym)` to
   `fetch_for_timeframe(...)` — `_with_partial_today` already accepts `partial_bar` and skips the per-symbol tape call when it is supplied (`candles.py:829-860`).

Effect: **501 intraday requests → 1–2**, scan drops from ~4–14 min to a few seconds (the 494/501 symbols whose daily frame is already cached need no upstream call at all).

Follow-ups (separate change, worth doing):

* `followthrough.py:102-121` should reuse `breakouts_mod.serve_report(date, universe)` (or an in-flight future) for the today/no-artifact case so the page does not launch two identical 501-symbol scans.
* `serve_report` (`breakouts.py:339`) should run the compute once (background task / Redis-backed single-flight) and return the last payload instead of computing per request; the 60 s in-process `_TODAY_CACHE` cannot help while a scan takes longer than 60 s.
* `DailyReportPage.tsx:313` should gate on the union of the sections it actually hides, or the outer `Show` should be removed so each tab renders its own loading/error state (as `followthrough` and `delivery` already do).
* `withTimeout` should `controller.abort()` on expiry, otherwise a timed-out scan keeps burning the shared Upstox budget.

---

## 7. Secondary findings worth filing separately

1. **The report is computed on stale bars.** Cached 1D frames across the NIFTY-500 universe end on: `2026-11-11` → **485**, `2026-11-12` → **9**, missing → **7** (0 end on 2026-11-13). `_read_cached(..., is_daily=True)` (`candles.py:242-255`) accepts a frame up to **3 calendar days** behind the last completed session, so a `date=2026-11-13` request evaluates the **2026-11-11** bar for 97 % of the universe (or a synthetic today bar when the intraday fetch succeeds, which still leaves 2026-11-12 missing from the prior-20-bar window). This is also *why* the synthetic-today path is being exercised at all.
2. **Empty past-date payloads are cached as truth forever.** `serve_report` writes the computed payload to `experiments/data/reports/breakouts/{date}_{universe}.json` unconditionally (`breakouts.py:374-378`), including empty ones — `2026-11-12_nifty500.json` is **233 bytes**, i.e. a zero-row report that will be served from disk indefinitely.
3. **No log line on circuit open.** The 429 circuit path logs nothing at INFO; 45+ minutes of stall left no trace in `logs/alphashri.log` (`grep -c circuit` → 0), which is why this looked like a silent hang.

---

## 8. Reproduction commands (safe, all bounded)

```bash
# 1. Confirm the endpoint never returns
curl -s -o /dev/null -w "%{http_code} %{time_total}\n" --max-time 60 \
  "http://localhost:8765/api/reports/breakouts?date=2026-11-13&universe=nifty500"

# 2. Confirm it is the per-symbol intraday leg
.venv/bin/python -c "
import time
from chart_patterns.candles import fetch_for_timeframe
t=time.time(); fetch_for_timeframe('SBIN','1D'); print('cached', round(time.time()-t,2))
t=time.time(); fetch_for_timeframe('SBIN','1D',include_partial_today=True); print('+partial', round(time.time()-t,2))"

# 3. Confirm the limiter is pinned at 120/min and the circuit is open
.venv/bin/python -c "
from cache.redis_client import get_redis_client; import time
r=get_redis_client(); now=time.time()
print('api_hits_60s', r.zcount('upstox:rl:hits:api', now-60, now))
print('circuit_until', r.get('upstox:circuit:until'))"
```
