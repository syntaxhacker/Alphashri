# Options Report — adding SENSEX / RELIANCE via a symbol selector

Status: audit + design constraints (no code changed by this doc).
Scope: can the NIFTY report take a `symbol` selector (SENSEX, RELIANCE, …) without
starving the NIFTY recorder or burning the Upstox budget?

## 1. Architecture

Two different products behind one tab.

| | NIFTY (today) | SENSEX / stocks (proposed) |
|---|---|---|
| Data path | **Recorder** (background, always on) + on-demand report | **On-demand live chain only** |
| Recorded artifacts | 1-min tape `nifty_snapshots/*.jsonl`, 1-min full replay frames, 10 s slim chain `nifty_chain10s/*.jsonl`, 1 s spot ticks | none |
| Endpoint | `GET /api/reports/nifty/live` (5 s shared TTL, `nifty.py:65,1200,1428`) | `GET /api/reports/options/{underlying}/live` (contract, **not yet implemented**) |
| Recorder tasks | `start_nifty_tape_task` (`nifty.py:2683`), `start_chain10s_task` (`chain10s.py:31`), `start_tick_tape_task` (`ticks.py:27`), `start_nifty_spot_tick_task` (`nifty_ws.py:58`) — started unconditionally in `api_server_fastapi.py:622-658` | none |

Client side is already half-wired: `fetchOptionsLive(underlying, expiry)` exists at
`src/api/reportNifty.ts:634-649` and is imported but unused
(`src/pages/report/NiftyReportPanel.tsx:119`). The backend route does **not** exist yet
(`grep "options/" api/reports_api/*.py` → no match). `api/options.py` already resolves
stock instrument keys (`NSE_EQ|ISIN`, `api/options.py:153-206`) and SENSEX
(`BSE_INDEX|SENSEX`, `api/options.py:149`), so the chain fetch itself is ready.

## 2. Request budget (per minute, market hours, one API process)

| Consumer | Cadence | Upstream req/min | Evidence |
|---|---|---|---|
| NIFTY tape recorder | 1/min | **~8** — 1 chain + Sensex chain/max-pain/OHLC (3) + spot + VIX + pivots/intraday (cached) | `nifty.py:1603` (`TAPE_INTERVAL_SEC=60`), tick at `2289-2340`, Sensex block at `1093-1160`, `1984` |
| NIFTY spot poller | 1/s | **60** | `nifty_ws.py:58` (`SPOT_POLL_INTERVAL_SEC=1.0`), task `123` |
| chain10s | 10 s (3 s burst) | **6** (20 in burst) | `chain10s.py:31-32`, `poll_once` `100-140` |
| NIFTY live report (shared 5 s TTL) | ≤12/min regardless of users | **≤12** | `nifty.py:65` (`_LIVE_TTL=5`), `1200-1218` |
| **NIFTY baseline total** | | **~75–95** | |
| 1 selected stock @ **15 s** cache | 4/min | 4 | proposed contract |
| 1 selected stock @ **30 s** cache | 2/min | 2 | proposed contract |
| 20 users, same symbol (shared cache) | | **≤4** | cache is per-underlying |
| 20 users, 20 distinct symbols @15 s | | **80** | worst case |
| 219 stocks @10 s (a "scan all" recorder) | | **1,314** | **forbidden** |

Headroom check against the `api` slice (`start.sh:32-35`: api 150, bot 300, orderflow 50,
global 500 — `upstox_trader/rate_limiter.py:65-83`):

- 15 s floor, 20 distinct symbols: ~95 + 80 = **175 > 150** → the api slice is breached
  (and 175 + bot 300 = 475/500 globally, leaving nothing for orderflow).
- 30 s floor, 20 distinct symbols: ~95 + 40 = **135 ≤ 150** → safe, thin margin.
- 219 symbols at any sub-minute cadence: impossible under any cap. 1,314/min is 2.6× the
  *global* 500/min and 66 % of the 2000/30 min window in a single minute.

**Conclusion:** non-NIFTY symbols need a **30 s floor** (not 15 s) plus a cap on distinct
simultaneously-cached underlyings (≈15). SENSEX is the cheap exception: it is already
fetched once a minute by the recorder (`nifty.py:1093`, 5 s cache at `1439-1453`).

## 3. Why NIFTY cannot be starved — three isolation invariants

1. **Separate endpoint and separate cache namespace.** `get_cached_live` keys
   `_live_cache` on **expiry only** (`nifty.py:1209`). Reusing it for a stock would let a
   stock report overwrite NIFTY's frame for the same date string. The generic route must
   own `_chain_cache[underlying][expiry]`, and must never touch `_live_cache`,
   `_live_ws_cache` or `_sensex_cache`.
2. **Separate single-flight + concurrency limit.** Today `get_cached_live` has a TTL
   check but **no lock** (`nifty.py:1200-1218`) — N concurrent clients on a cold key all
   fetch. The stock route needs one `asyncio.Lock` per underlying (single-flight) and a
   global `asyncio.Semaphore` (e.g. 4) so 20 users cannot open 20 simultaneous chains.
   NIFTY keeps its own path, untouched.
3. **Recorder path is never on the request path.** No handler for a stock may call
   `record_nifty_tape_tick`, `_append_minute_snapshot`, `_write_tape_row`, or
   `chain10s.poll_once`; nothing may write to `nifty_snapshots/`, `nifty_reports/`,
   `nifty_chain10s/`, `nifty_ticks/`. The stock endpoint is read-only and stateless
   except for its own cache. `_ensure_tape_task()` stays in the NIFTY handler only.

Budget isolation (invariant 4, operational): every upstream call on the stock path should
acquire a token. **It currently would not** — `fetch_upstox` (`api/options.py:260-300`)
issues the HTTP call with no limiter; only `nifty_intel.py:85-88` and the bot path
(`upstox_trader/queued_rate_limiter.py`) acquire. So the 150/min api slice is *advisory*
for report endpoints until the new route acquires per call.

## 4. What works for stocks vs indices

**Works today, per symbol (chain snapshot only):** strikes table, OI/PCR, max pain,
expected move, GEX/walls, ATM IV, delta-flip — all pure functions over one
`/option/chain` payload (`api/options.py:549-620`, `nifty.py:410` `compute_gex` is
lot-size agnostic; OI is already in units).

**Needs a per-symbol recorder (do not ship in v1):** 10 s OI heatmap
(`chain10s.py` writes NIFTY only), squeeze radar / pressure lane / burst alerts (need a
10 s series), replay (needs the per-minute snapshot JSONL), spot-blasts (need the 1 s
spot tick). Each of these is a background writer; at 219 symbols the writer alone is
1,314 req/min.

**Stock data-quality caveats (label them in the UI):**
- **Monthly expiries only.** DTE 1–30 vs NIFTY's weeklies → theta dominates, expected
  move and IV are not comparable across symbols; no "expiry-day pin" analogue.
- **Wide spreads / stale LTP.** Stock options are thin away from ATM; LTP-derived GEX,
  max pain and "walls" get noisy. Prefer OI-based levels and mark premium-derived blocks
  as indicative.
- **Non-uniform strike spacing and missing deep strikes.** `calculate_max_pain`
  (`api/options.py:112`) and GEX jump when the strike ladder is sparse.
- **Lot sizes vary per symbol** (SENSEX 20, RELIANCE-scale names differ) — never apply
  NIFTY's 65.
- **NIFTY-only blocks must be skipped.** `_compute_live` attaches NIFTY baseline, VIX,
  pivots (`NIFTY_PIVOT_KEY`, `nifty.py:633`) and the ATM reference. A stock report should
  reuse `build_report` only, not `_compute_live`.

## 5. Concurrency answer

- **REST:** Upstox Standard APIs allow **50/s, 500/min, 2000/30 min per user**. Concurrent
  requests are fine — the constraint is the window, not parallelism. A stock chain read is
  one `GET /option/chain` (plus one `/option/contract` per 5 min for expiries,
  `api/options.py:322-338`).
- **WebSocket:** **2 connections per user (5 on Plus)**, LTPC 5,000 keys, Greeks 3,000,
  Full 2,000 per connection. The app uses **at most one** optional market-data WS
  (`nifty_md.py`, `NIFTY_MD_WS=1`, off by default — `api_server_fastapi.py:660-684`), which
  already subscribes NIFTY + India VIX + SENSEX in `ltpc` (`nifty_md.py:373-382`).
- **A symbol selector needs no new WebSocket.** It is a request-scoped REST read. If live
  tick streaming for a stock is ever wanted, it must reuse the single existing connection
  and stay under the 5,000-key LTPC budget.

## 6. Test / rollout checklist

```bash
TOKEN=$(curl -s -X POST localhost:8765/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"qa@test.com","password":"qa123"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")

# 1. SENSEX (index, BSE_INDEX key)
curl -s -H "Authorization: Bearer $TOKEN" \
  localhost:8765/api/reports/options/SENSEX/live | head -c 400
# 2. RELIANCE (stock, NSE_EQ key via _stock_instrument_map)
curl -s -H "Authorization: Bearer $TOKEN" \
  localhost:8765/api/reports/options/RELIANCE/live | head -c 400
# 3. NIFTY still served by its own path
curl -s -H "Authorization: Bearer $TOKEN" localhost:8765/api/reports/nifty/live | head -c 200
```

- [ ] `RELIANCE` resolves to an `NSE_EQ|…` key, not `NSE_INDEX|RELIANCE` (the old fallback
      at `api/options.py:163`).
- [ ] Stock chain has ≥ 10 usable strikes and non-zero OI; a 502/empty chain is surfaced,
      never rendered as `max_pain: 0 / regime: flat` (`nifty.py:1059-1071`).
- [ ] **NIFTY tape still fresh** while the stock endpoint is hammered:
      `curl .../api/reports/nifty/tape/status` (`nifty.py:2748`) — `last_tick` within 90 s
      and `last_error` null.
- [ ] Switch-back: select RELIANCE → NIFTY; the NIFTY frame must not carry stock strikes
      (proves cache namespacing, invariant 1).
- [ ] Cache hit ratio: 10 sequential calls in 30 s produce **one** upstream chain fetch
      (log count of `fetch_upstox("/option/chain")`); TTL floor is 30 s.
- [ ] 429 path: force an upstream 429 (or stub `fetch_upstox` to raise
      `HTTPException(429)`) → client gets 429, cache keeps last good frame, no retry storm;
      NIFTY path unaffected.
- [ ] **No full-universe recording:** grep the diff for any loop over the F&O universe
      calling `/option/chain`; assert no new background task in
      `api_server_fastapi.py:622-700` and no writes under `nifty_*` dirs from the stock route.
- [ ] Concurrency: 20 parallel requests across 20 symbols stay under the 150/min api slice
      (`remaining_minute_budget("api")`, `rate_limiter.py:329-350`) or are rejected with 429
      by an explicit per-underlying bucket.

## Top risks

1. **The api rate slice is not enforced on this path.** `api/options.py:260` calls Upstox
   without `UpstoxRateLimiter.acquire()`; only `nifty_intel.py:85` and the bot do. Adding a
   per-symbol endpoint without an explicit bucket means the 150/min reservation is fiction —
   a 20-symbol fan-out at 15 s would push the process past 150/min and eat into the bot's
   300 (475/500 global).
2. **Cache key collision / no single-flight.** `_live_cache` is keyed by expiry alone
   (`nifty.py:1209`) and `get_cached_live` has no lock (`1200-1218`). Reusing either for a
   stock either serves stock strikes under the NIFTY key or stampedes N chain fetches on
   every TTL expiry.
3. **NIFTY-only blocks leaking into stock reports.** `_compute_live` unconditionally pulls
   NIFTY pivots/baseline/VIX/reference (`nifty.py:1034-1092`, `633`). Reusing it for
   RELIANCE produces a report that looks valid but carries NIFTY levels — worse than an
   error. Stock reports must call `build_report` directly and skip verdicts/pivots.
