# Performance Backlog — findings only

**Date:** 2026-11-21
**Status: BACKLOG, NOT A PLAN TO EXECUTE NOW.** Nothing in this document has been implemented. It is a cold-start reference: each entry records a measured-or-cited problem, the exact `file:line`, and the shape of a future fix so a later session can pick one up without re-investigating.

**Method:** static reading of source/config only. No builds, no servers, no profiler, no full test runs, no git commands (per the subagent contract). Where a number came from a config constant or an existing measurement note it is quoted; where it did not, the entry says so explicitly.

**Counts:** FE 3 · BE 2 · DB 1 · DX 0 (no significant DX finding — see "DX" below). Top 3 by expected gain: **FE-01**, **BE-01**, **BE-02**.

---

## Ranked table

| ID | Area | Finding | Evidence (file:line) | Expected gain | Effort | Risk |
|----|------|---------|----------------------|---------------|--------|------|
| FE-01 | FE | Every distinct live price tick rebuilds the whole positions array and notifies **all** paper-trading subscribers (~4 ticks/s during market hours), even when no held position changed | `src/components/paper-trading/LivePriceUpdater.tsx:29-46`; `src/state/paperTrading.ts:120-122`; `src/state/createSubscriber.ts:4-6`; `AGENTS.md:206` | High — removes up to ~4 full paper-trading tree re-renders/s | M | M (live P&L correctness) |
| BE-01 | BE | `load_daily_bars` re-fetches ~660 calendar days of NSE daily candles on every replay call with no cache, while the sibling 1-minute loader memoizes | `trading/replay/datasources.py:22-23,26-52` vs `:55-90`; `backtest/utils.py:95`; `AGENTS.md:708` | High — removes a repeated 400–660-day Upstox fetch per replay | S–M | M (today's bar freshness) |
| BE-02 | BE | Events feed pulls the newest 5,000 news rows with **no SQL date predicate**, then date-filters in Python; a window older than those 5,000 rows silently returns empty | `api/reports_api/events_feed.py:60,155-161,173`; `db/models/news.py:19-20` | Medium — bounded join/sort + fixes a stale-window correctness hole | S | L |
| FE-02 | FE | Index Report runs ~6 independent poll loops at once (3 s / 10 s / 15 s / 30 s / 60 s, plus a 1 s clock) with separate timers and timeouts | `src/pages/report/niftyReportStore.ts:138-144,1734-1746,1782-1870,2075,2132,2150-2154`; `src/pages/report/useNiftyBlasts.ts:21,172`; `src/pages/report/NiftyDataFreshness.tsx:40` | Unmeasured — endpoint is pure file reads (`useNiftyBlasts.ts:11`), so likely small | M | M (live freshness) |
| DB-01 | DB | `news_symbol_mentions.symbol_code` is equality-queried but has no index (its two sibling columns do) | `db/models/news.py:78,87-90`; `services/news_persistence.py:158-161`; `api/reports_api/events_feed.py:175-178` | Low / unsized — depends on table size | S | L |
| FE-03 | FE | Chart-pattern scan job is polled every 2 s for its entire queued/running lifetime | `src/state/chartPatterns.ts:43,1023-1066` | Low — one cheap status endpoint | S | L |

---

## FE-01 — Live price ticks fan out through the whole paper-trading store

**Evidence**
- `src/components/paper-trading/LivePriceUpdater.tsx:29-46`: `applyPrice()` maps over `state.positions`, then calls `setPositions(updated)` **unconditionally** — there is no "nothing matched → no write" guard. The only early-outs are a non-finite/non-positive LTP (`:30`) and an unchanged LTP for that symbol (`:32`).
- `src/state/paperTrading.ts:120-122`: `setPositions` does `state = { ...state, positions }` then `notify()`.
- `src/state/createSubscriber.ts:4-6`: `notify()` calls every subscriber with no field-level selectivity.
- Subscribers to the whole snapshot (each re-runs on every tick): `PaperPositionsTable.tsx:92`, `PaperTradingView.tsx:119`, `AggregatedDashboard.tsx:306`, `ActivityFeed.tsx:15`, `PerformanceAnalytics.tsx:179`, `PaperChart.tsx:413`, `PaperSettings.tsx:170`.
- `AGENTS.md:206`: live ticks stream at ~4/sec during market hours.

**Fix shape (later)**
1. Skip the write when the map produced no changed position (`updated === state.positions` by reference, or track a `changed` flag).
2. Coalesce multiple frames into one flush per animation frame (16 ms) rather than one `notify()` per SSE frame.
3. If that is not enough, move live quotes to a fine-grained keyed store (`${strategy_id}-${symbol}` — the composite key rule in `AGENTS.md:161`) and have only the matching row subscribe.

**Guard to add with the fix:** a probe test that fires N ticks and asserts the subscriber callback count is < N (pattern: `src/components/window/perfProbe.test.tsx:93-138`).

---

## BE-01 — Uncached 400-day daily-bar refetch in replay/swing paths

**Evidence**
- `trading/replay/datasources.py:26-52`: `load_daily_bars()` calls `fetch(symbol, tf=1440, from_date=..., to_date=...)` directly. Line 34 builds `from_date` as `date - (lookback_days + 260)` days — at the default `lookback_days=400` (`:26`) that is ~660 days of daily candles on every call.
- Contrast `trading/replay/datasources.py:22-23,55-90`: `load_nse_1m()` has an explicit process-level `_NSE_1M_CACHE` keyed `(SYMBOL, date)`, checked at `:65-67` and filled at `:90`. The daily loader has no equivalent.
- `backtest/utils.py:95`: `fetch_days = max(days + 400, 500)` — the same oversized lookback convention.
- `AGENTS.md:708` lists this as a known deferred issue: "52W daily data caching — fetches 400 days per chart request with no caching".

**Fix shape (later)**
Memoize `load_daily_bars` on `(symbol, date, lookback_days)` with the same pattern as `load_nse_1m`, but make it **session-aware** for today: reuse the established contract from `AGENTS.md:464-477` (today = short TTL while the market is open; historical = no TTL; pin to last completed session when closed). Do not use a plain unbounded `dict` — add a size cap / eviction.

**Measure first:** count `fetch_candles(tf=1440)` calls per replay run before/after. The existing `experiments/data/...` caches and `chart_patterns/candles.py` are the reference implementation, not a new cache format.

---

## BE-02 — Events feed: unbounded news join, date filtering after LIMIT

**Evidence**
- `api/reports_api/events_feed.py:60`: `_FEED_NEWS_ROW_CAP = 5000`.
- `:155-161`: `db.query(NewsArticle, NewsSymbolMention).join(...).order_by(published_at.desc()).limit(5000).all()` — there is no `where` on the date window.
- `:173`: the actual `[start_day, end_day]` check happens in Python, **after** the limit.
- `db/models/news.py:19-20`: `published_at` and `fetched_at` are already indexed, so the fix needs no new index.

**Consequence:** the DB sorts/scans the whole join to materialise 5,000 rows, then most are discarded; and a `recent?days=7` window whose newest 5,000 articles are all newer than the window returns nothing even when matching rows exist. This is both a perf finding and a correctness hole.

**Fix shape (later)**
Push the window into SQL: `.where(NewsArticle.published_at >= start_ts, NewsArticle.published_at < end_ts_exclusive)` (with the `fetched_at` fallback expressed as an OR), keep the Python check at `:173` as a defensive invariant, and lower/review `_FEED_NEWS_ROW_CAP`. Add a regression test with a date window older than the cap — per `TEST_RULES.md`, prove it fails first.

---

## FE-02 — Index Report poll fan-out

**Evidence**
- `src/pages/report/niftyReportStore.ts:138-144`: `GENERIC_POLL_MS=15_000`, `BREADTH_POLL_MS=60_000`, `CHAIN10S_POLL_MS=10_000`, `GENERIC_BURST_POLL_MS=30_000`, `SESSION_CLOSE_POLL_MS=30_000`.
- Same file: generic live poll at `:1782-1870` (with its own `AbortController` + timeout at `:1789`), breadth `:2075`, chain10s `:2132`, bursts `:2150-2154`, session close `:1734-1746`.
- `src/pages/report/useNiftyBlasts.ts:21` polls the blast feed every **3 s** (`:172`); the comment at `:11` says it is "pure file reads, no provider calls".
- `src/pages/report/NiftyDataFreshness.tsx:40`: a 1 s interval purely to advance a clock.
- `AGENTS.md:444` documents the ~15 s generic-underlying poll as intentional.

**Honest caveat:** this is a measured *cadence*, not a measured bottleneck. The blast feed is file-only and the others are already gated to live sessions. Treat as low priority.

**Fix shape (later):** one visibility-gated scheduler for the report page; share an `AbortController`/timeout budget across probes; raise the blast poll to ≥5 s or move it onto the existing WS/SSE stream; replace the 1 s clock with a derived value updated by the next real poll.

---

## DB-01 — Missing index on `news_symbol_mentions.symbol_code`

**Evidence**
- `db/models/news.py:78`: `symbol_code = Column(String(50), nullable=False)` — no `index=True`.
- `:87-90`: indexes exist only for `instrument_key` and `trading_symbol` (plus `article_id` from the FK at `:76`).
- `services/news_persistence.py:158-161`: `filter((trading_symbol == sym) | (symbol_code == sym))` — an OR, so the `trading_symbol` index cannot cover the other branch.
- `api/reports_api/events_feed.py:175-178`: falls back to `symbol_code` when `trading_symbol` is blank.

**Fix shape (later):** add a migration creating `ix_news_symbol_mentions_symbol_code`; validate with `python scripts/validate_migrations.py` (`AGENTS.md:618-620`). Before spending effort, check row count — this table's size was not measured here. Longer-term, the two-column OR suggests a single canonical symbol key rather than two indexes.

---

## FE-03 — 2-second chart-pattern job poll

**Evidence**
- `src/state/chartPatterns.ts:43`: `POLL_INTERVAL_MS = 2000`.
- `:1023-1066`: `pollJob()` arms `setInterval(..., POLL_INTERVAL_MS)` while the job is queued/running, and only stops on a terminal status (`:1034-1035`).

**Fix shape (later):** exponential backoff 2 s → 5 s → 10 s (cap) for long scans; keep the first few ticks at 2 s for short jobs. No correctness change; the status endpoint is cheap. Lowest-value item in this backlog.

---

## Already good — do not re-litigate

These were previously optimised. Do not propose them again without new evidence that they regressed.

- **Staggered screener prewarm** — `api_server_fastapi.py:96-102` documents the old "six screeners / up to 120 threads" burst and the fix; `:119-124` sleeps `PREWARM_STAGGER_SEC` between screeners so at most one heavy compute is in flight; `AGENTS.md:229,479-487`.
- **Prompt-first + daily-staleness 52W batch** — `api_server_fastapi.py:317-326` (5 s first run, then interval), `:328-331` (market-hours gate), `AGENTS.md:481-487`.
- **Single-flight stores** — `src/state/createSingleFlightStore.ts:1-12` (LRU + in-flight dedupe + generation guard); wrappers `src/state/optionsAnalytics.ts:20` and `src/state/optionsDashboard.ts:21`.
- **Deduped market snapshot fetches** — `src/components/window/panels/marketSnapshotHub.ts:34-44,45-107` (one hook per universe, ref-counted, disposed on last minimise) with 3-failure backoff at `:16-19,71-95`; cadence itself is 5 s live / 60 s closed in `src/components/market/useMarketSnapshotSolid.ts:17-23,93-121`, and a still-running request is skipped at `:108-111`.
- **Perf probes that assert the above** — `src/components/window/perfProbe.test.tsx:93-238` (drag/resize commits once, minimise tears down polls), `src/components/window/panels/pollingProbe.test.tsx:90-138` (two heatmaps = one fetch stream), `src/components/window/perfChartResizeProbe.test.tsx:116-130` (dragging one window does not resize siblings' charts).
- **`manualChunks` scoping** — `vite.config.ts:38-46`: Solid in `vendor`, ECharts/zrender in `echarts`, with an explicit comment that a bare `echarts` match used to pull `loadEcharts.ts` into the entry chunk. ECharts is dynamically imported at `src/utils/loadEcharts.ts:7`.
- **Options/tape retry backoff** — `api/reports_api/nifty.py:2323` (`TAPE_RETRY_BACKOFF_SEC`), `:3518-3520`; `api/reports_api/fyers_ws.py:66-67,312`; reconnect backoff `api/reports_api/nifty_md.py:623-711`.
- **Blocking work already offloaded** — sync handlers deliberately run on the anyio pool (`api/bots_api/bot_operations.py:175-177`); `asyncio.to_thread` / `run_in_threadpool` at `api/news/news_poller.py:259`, `api/market_ticker.py:144-147`, `api/sector.py:162,291`, `api/chart_patterns.py:2464,2603-2604,3546`; `api/event_radar/poller.py:149,199`. The synchronous `requests.post` at `api/news/news_impact.py:137` is called through `to_thread` at `api/news/news_poller.py:259` — it is **not** an event-loop blocker.
- **Cache TTLs and negative caching** — `AGENTS.md:464-477` (chart cache 60 s today / no TTL historical, pre-market poison fix; chart-pattern session-aware cache + scan freshness); `api/value_scan/cache.py:197-215` (stampede lock + loser poll). `scripts/market/perf_market_screener.py:8-23` records the agreed latency budgets.
- **Payload caps / columnar wire format** — `src/config/apiLimits.ts:9-14` (`MARKET_ROW_CAP=4000`, `MARKET_SYMBOL_CAP=20`, `VALUE_ROW_CAP=100`); `src/components/market/useMarketSnapshotSolid.ts:57-64` (`wireFormat: "columns"`).
- **Dev-server watch exclusions** — `vite.config.ts:52-76` ignores `experiments/`, `reports/`, `logs/`, `db/` and `*.db-wal` so WAL checkpoints do not reload the app.
- **CI/DX hygiene** — 20-shard cap, no `globalSetup`, no pixel tests, no `waitForTimeout`, deduped push/PR runs (`AGENTS.md:515-524`); mandatory CPU-idle floor before fan-out tests (`AGENTS.md:573-580`); targeted-test guidance (`AGENTS.md:526-543`).

---

## Needs measurement before acting

These are suspicions with citations but **no timing data**. Do not turn them into changes until measured with the existing probes (`scripts/market/perf_market_screener.py`, `scripts/market/market_snapshot_probe.py`, `scripts/slow_api_report.py`) or a short trace.

- **Startup task burst.** `api_server_fastapi.py:827-943` spawns ~25 background asyncio tasks in one startup block (news poller, prewarm, 52W, recovery, backup, orderflow, patterns, watch, dashboard prewarm, market snapshot prewarm, digest, touch recorder, NIFTY tape/snapshot/futures, SENSEX futures, options recorder, chain10s, tick tape, burst watcher, spot tick, MD, OI, event radar). Only the *internal* prewarm loop is staggered (`:96-124`); there is no global start order. `:811` also calls `_load_instruments()` synchronously. A cold-start trace is needed to see whether these actually contend — several are market-hours-gated or off by default (`:903-939`).
- **Report payload size.** The generic Index Report polls `live` + tape + bursts every ~15/30 s (`AGENTS.md:444`, `src/pages/report/niftyReportStore.ts:138-144`). Whether those responses are larger than the UI renders has not been measured here; the FE already derives candles from tape/spot points (`AGENTS.md:437-442`), so there may be redundant fields.
- **4,000-row snapshot vs. rendered tiles.** `src/config/apiLimits.ts:10` requests up to 4,000 rows every 5 s in a live session; the heatmap is bounded by viewport. The snapshot is cached (15 s) and gzipped (`scripts/market/perf_market_screener.py:18-23`), so this may already be fine — measure before changing `MARKET_ROW_CAP`.
- **Missing `impact_score` index.** `api/news/news_impact.py:243-249` filters `impact_score IS NULL` and orders by `published_at`; `db/models/news.py:11-24` indexes `published_at` but not `impact_score`. Likely cheap given the `LIMIT` and `MAX_HEADLINES`, but unmeasured.
- **Per-row TanStack work.** `src/components/common/TanStackTable.tsx:1-80` centralises column resolution and uses `createMemo`/`For`; no per-row `createEffect` was found in the shared table. Individual column factories were not exhaustively reviewed — if a specific 4,000-row table feels slow, profile that screen rather than changing the shared component.

---

## DX

No significant finding. The repo already has: perf probe tests (cited above), an explicit CPU-idle floor before fan-out test runs (`AGENTS.md:573-580`), targeted-test recipes (`AGENTS.md:526-543`), and the 20-shard CI cap (`AGENTS.md:515-524`). Test-time slowness, if any, is environmental (shared 8-core box) rather than a code pattern worth a backlog entry. `MUTATION_TESTING.md` / `TEST_RULES.md` were checked for relevance; no perf-specific finding came from them.
