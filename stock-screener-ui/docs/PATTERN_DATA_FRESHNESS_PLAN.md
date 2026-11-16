# Pattern data freshness — KAYNES incident

Status: **audit complete (2026-11-16)**. Root cause and task ownership below.

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

### T2 — Backend single frame + date + keys

- `_last_close_change` → return `(close, change, bar_date)`; `_finalize_item`
  adds `close_bar_date` and includes the frame date in `series_key`.
- `/results`, `/matrix`, `/lookup` response-cache keys include the frame date.
- `_read_cached` stops tolerating a multi-day daily lag on the enrichment path
  (serve stale for the chart only, with an explicit `stale` flag; never for the
  computed close).
- Forced refresh clears the symbol+timeframe candle and enrichment entries.
- Tests: newer frame invalidates the old close; `/results` exposes
  `close_bar_date` equal to the last candle's date; a 3-day-old daily file is
  refreshed before enrichment.

Implementation note (2026-11-16): the shipped T2 uses `_frame_identity` in the
series/timeline/matrix keys and computes closes from the returned frame; it did
**not** add `close_bar_date` to the response. The UI therefore falls back to the
chart candle (the series actually drawn) when the field is absent — correct for
display, but a future `close_bar_date` would let enrichment win when it is
genuinely newer.

### T3 — Frontend dated close + refresh

- Use `close_bar_date` when present; **do not use `hit.end_date` as a proxy**.
  Fall back to the chart candle's timestamp, never to the pattern end date.
- Label `CLOSE · 13 NOV` (or `PREV CLOSE` when the bar is not today), with the %
  from the same pair of bars.
- Add `data-testid="patterns-dock-refresh"` that invalidates the
  `(symbol,timeframe)` entry in `usePatternFullscreenSolid`'s cache and refetches.
- If a live quote is supplied by the opener, show it separately; otherwise omit.

### T4 — Sweep + E2E

- 10-symbol data sweep (enrichment close/date vs chart last bar vs live LTP),
  assert zero stale enrichment after T2.
- E2E: dock opened from a table row shows the dated close and, when supplied,
  the live LTP; clicking refresh updates the `cached`/`stale` state.
- Re-check KAYNES: `CLOSE · 13 NOV ₹3,430` (not 3,382) and the live line, if
  shown, reads `₹2,986 −12.94%`.

## Acceptance

- No pattern surface displays an undated historical close as if it were live.
- Enrichment and candles always refer to the same frame; a frame change
  invalidates the old value.
- A user can force a refresh from the pattern dock and see the new frame.
- KAYNES: dated 13 Nov close + live LTP, matching the table.
