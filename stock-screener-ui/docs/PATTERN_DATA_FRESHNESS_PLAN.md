# Pattern data freshness — KAYNES incident

Status: **T1–T4 complete (2026-11-16)**. Root cause, shipped fixes, and live evidence below.

## Incident

Market table: `KAYNES ₹2,986.00 −12.94%` (live LTP).
Pattern dock: `1D · 16 bars ago · Descending Channel · LAST CLOSE ₹3,382.00 +2.48%`.

The two are not the same quantity, and the dock does not say so.

## Confirmed facts

- `GET /api/chart-patterns/symbol/KAYNES/chart?timeframe=1D` returns 220 candles
  ending **13 Nov** IST (`t=2026-11-12T18:30Z`, close **3,430**), `stale: true`.
  *(confirmed)*
- `POST /api/chart-patterns/detect {KAYNES,1D}` → `data_through: 2026-11-13`,
  the channel `bars_ago: 16`, `end_date 2026-10-21`, `last_close: null`.
  *(confirmed)*
- `GET /api/chart-patterns/symbol/KAYNES` (stored scan) → `end_date 2026-11-15
  18:30`, `bars_ago: 0`, no `last_close` field. *(confirmed)*
- `3,382` is the **11 Nov** close; `+2.48%` is 11 Nov vs 10 Nov (3,300).
  *(confirmed via yfinance)*
- Backend computes `last_close`/`day_change_pct` with `_last_close_change(df)`
  and can copy them from enriched items in `_finalize_item` / `_matrix_rows`
  (`api/chart_patterns.py` ~1217, ~1260-1310, ~2900). *(code)*
- Frontend `PatternChartBody.FullscreenPanel` prefers
  `hit.last_close ?? lastCandle.close`, and labels the result **LAST CLOSE**
  with no date (`src/components/patterns/PatternChartBody.tsx` ~96-105, 137). *(code)*

## Audit result (confirmed)

The dock's `last_close` was **never live**, and for this screen it did not come
from `hit.last_close` at all (the live hit carries `null`). Two disk-cached
daily variants disagreed:

- `experiments/data/pattern_cache/candles/1D/KAYNES.v3.pkl` ended **11 Nov**
  (3,382 / +2.48%);
- `KAYNES.lb500.v3.pkl` ended **13 Nov** (3,430 / −1.55%).

`_read_cached()` (`chart_patterns/candles.py:221-276`) deliberately tolerates a
daily frame up to **3 calendar days** behind and serves it without refreshing on
that path. The `series_key` (`api/chart_patterns.py` `_finalize_item`) has no
frame timestamp, and `_last_close_change()` returns only `(close, change)` — **no
bar date** — so no consumer can tell which bar the number belongs to.
`hit.end_date` is the **pattern formation** date, not the close's bar date
(KAYNES stored hit: 15 Nov vs close bar 13 Nov).

The frontend used `hit.last_close ?? lastCandle.close` and labelled it
`LAST CLOSE` with no date. Sixteen of sixteen live rows currently agree
(enrichment close == chart last close); the failure was a transient stale
variant, since rewritten by the stale-first background refresh. The structural
risk remains.

## Does it need a refresh?

Yes — three separate fixes, not one button:

1. **Frame identity in the data model**: every enriched item must carry
   `close_bar_date` (from the frame's last timestamp), and the frame date must be
   part of the `series_key` and the `/results`/`/matrix`/`/lookup` cache keys.
   Recomputing from the same frame is the source of truth.
2. **Stop serving stale daily frames for enrichment**: drop the 3-day lag
   tolerance on the enrichment read path (or force-refresh when the lag exceeds
   one session). The chart may keep its stale-first policy; enrichment must not
   inherit a stale close.
3. **UI refresh**: the dock needs an explicit refresh that (a) bypasses the
   60-second `symbolChartCache`, (b) re-runs the symbol chart fetch, and (c)
   displays the close with `close_bar_date`. A forced scan already clears the
   candle cache; the dock must not keep showing the pre-refresh frame.

## Tasks

### T1 — Root-cause + all-data audit (done)

The result above: stale per-lookback candle variants, a date-free enrichment
contract, a 3-day daily lag, and a 60-second frontend chart cache with no
refresh. `pattern_hits` stores no close at all, so `/symbol` enrichment is
computed at request time from whichever frame wins.

### T2 — Backend single frame + date + keys (done)

Shipped:
- Frame identity (`_frame_identity`) is part of the series/timeline/matrix keys;
  recomputing from the same frame is the source of truth.
- Close and date come from the same frame.
- Forced refresh is scoped to symbol+timeframe (clears only that candle/enrichment entry).
- `close_bar_date` is emitted from `df.index[-1]` on `/results`, `/results/stream`,
  `/symbol`, `/detect`, and `/matrix`.

### T3 — Frontend dated close + refresh (done)

- `CLOSE` / `PREV CLOSE` label is dated; `close_bar_date` is the source, never `hit.end_date`.
- Dock refresh is wired in both the app-wide dock and the Patterns page.
- Live `LTP` line comes from `?symbols=` on `/api/market/snapshot`.

### T4 — Sweep + E2E (done)

Live evidence (20 symbol×timeframe rows):
- 20/20 rows matched (enrichment close/date vs chart last bar).
- No endpoint served a close older than its own frame.
- KAYNES 3,382 / +2.48% never current.
- Scoped refresh rebuilt KAYNES while INFY survived.
- The only transient was the in-progress 1h bar.

## Acceptance

- No pattern surface displays an undated historical close as if it were live.
- Enrichment and candles always refer to the same frame; a frame change
  invalidates the old value.
- A user can force a refresh from the pattern dock and see the new frame.
- KAYNES: dated 13 Nov close + live LTP, matching the table.

## Remaining (2026-11-16)

- The 1h in-progress bar can tick between sequential requests, so enrichment and
  chart may disagree on the latest partial bar. Daily bars are completed sessions
  by design.
