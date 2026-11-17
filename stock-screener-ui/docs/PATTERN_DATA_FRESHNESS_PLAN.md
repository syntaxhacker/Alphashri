# Pattern data freshness — KAYNES incident

Status: **T1–T4 complete (2026-11-16)**. The 1D display fix is partly live: the
tape bar is appended to the displayed series (verified on 10 symbols), while the
display-side freshness fields (`as_of` / `stale` / `detection_as_of`) are in
flight — see T5.

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

## Live LTP follow-up (2026-11-16 audit)

The dated close + LTP line shipped, but a read-only audit found the LTP is not
actually live:

- **F1 HIGH** — `fetchLiveQuote` runs once in `loadSymbolChart` and never
  refreshes. No interval exists; the price freezes until the dock is reopened.
- **F2 HIGH** — `openFromCard` (the results-grid entry) never calls
  `fetchLiveQuote`, so the LTP line is absent for cards.
- **F3/F4 MED** — timeframe and as-of/replay changes neither refetch nor clear
  `livePrice`, so a live quote is shown over a different/historical frame.
- **F5/F7 LOW** — no client-side 20-symbol guard in `fetchQuotes` (backend 400 →
  null), and a null change renders green. (fix in flight)
- **F6 LOW** — the quote fetch is not aborted on token mismatch (state is
  guarded; only the request is wasted).

Fix: a 15 s poll inside `fetchLiveQuote`, gated by the request token and current
symbol, cleared on close/symbol change; call it from `openFromCard`; reset
`livePrice` on timeframe/as-of changes; same change in both pattern hooks. Test:
open → advance 15 s → a second quote request and an updated `livePrice`;
card open → quote fetched.

## Acceptance

- No pattern surface displays an undated historical close as if it were live.
- Enrichment and candles always refer to the same frame; a frame change
  invalidates the old value.
- A user can force a refresh from the pattern dock and see the new frame.
- KAYNES: dated 13 Nov close + live LTP, matching the table.
- A 1D chart whose display includes today's tape bar reports `as_of` = today,
  `stale: false`, and `detection_as_of` = the last completed session.

## T5 — 1D display freshness (2026-11-16; fields in flight)

The dock showed a stale `as_of` (13 Nov) over a chart whose last candle was
already today's. The fix keeps the displayed series and the detected series
separate: **display may be newer than detection**, and every payload field says
which one it describes.

### Backend — `/symbol/{symbol}/chart` (stale-first path)

- Today's tape bar is appended to the **display series only**. Detection,
  `_remember_frame`, `_frame_identity`, `_store_pattern_block` and the disk
  cache stay on the last completed session, so a hit can never form on an
  unfinished bar and `bars_ago` stays comparable across polls.
- `with_partial_today` / `is_partial`: the synthetic bar is marked
  `partial_today` and `partial_today_in_progress`; only the **trailing displayed
  candle** carries `is_partial: true`, and only while the session is in progress.
  After the 15:30 IST close the bar is final — the marker is absent
  (`_synthetic_bar_in_progress` compares the bar date to `_last_completed_session`).
- Freshness contract (`_chart_freshness`), describing the **displayed** series:
  - `as_of` = last displayed bar date (so it is today when the tape bar is shown);
  - `stale` = false whenever the chart is current; `expected_as_of` is echoed
    only when the display really is behind the last completed session;
  - `detection_as_of` = the base frame date whose hits `bars_ago` refers to.
  The tape append and the display-side `stale` suppression are already live; the
  field contract is **in flight** — implemented and unit-tested
  (`tests/api/test_chart_patterns_frame_freshness.py`, 21 pass), but the running
  API still answers `as_of` 13 Nov / `stale: true` / `detection_as_of: null`
  until the process is restarted on it.
- `?refresh=1` (same lane) bypasses the stale-first and negative caches, forces
  the fetch, and returns the **same fields** — a forced current chart is never
  labelled stale. On the timeout/error fallback path `detection_as_of = as_of`
  (no tape append, so display and detection share a date).

### Frontend

- `CLOSE` / `PREV CLOSE` come from the last candle (`resolveCloseSeries`), never
  from `hit.last_close` unless its `close_bar_date` proves the same-or-newer bar.
- A partial trailing candle shows the `(live)` marker next to the dated label.
- The stale/"Cached `<date>`" badge is suppressed when the displayed candle is
  newer than `as_of` (`staleFields` in `patternsFullscreen.ts` and
  `usePatternFullscreenSolid.ts`); the backend `stale` flag alone is not trusted
  when the two disagree.

### Live evidence (10 symbols, 16 Nov close)

`/symbol/{sym}/chart?timeframe=1D` — all 10 series end **16 Nov**, and the
appended bar's OHLCV matches `yfinance <SYM>.NS` exactly:

| Symbol | Last candle | Close | Volume |
|---|---|---|---|
| ASIANPAINT | 16 Nov | 2,572.9 | 1,146,195 |
| HDFCBANK | 16 Nov | 816.5 | 27,143,063 |
| ICICIBANK | 16 Nov | 1,585.0 | 10,069,097 |
| INFY | 16 Nov | 1,145.1 | 4,851,757 |
| KAYNES | 16 Nov | 2,980.0 | 9,882,559 |
| LT | 16 Nov | 4,140.0 | 1,136,716 |
| MARUTI | 16 Nov | 12,571.0 | 662,297 |
| RELIANCE | 16 Nov | 1,344.8 | 7,653,026 |
| SBIN | 16 Nov | 1,090.5 | 16,215,258 |
| TCS | 16 Nov | 2,405.0 | 1,802,297 |

`POST /detect {sym,1D}` for the same 10 symbols stays at **`data_through:
2026-11-13`** — detection deliberately ignores the tape bar.

**Caveat:** Upstox's official daily candle can lag a session (its own EOD
publish runs after the close). The tape bar is therefore **display-only** — it
is never written to the candle cache, never fed to detection, and never used to
enrich `last_close`/`close_bar_date`. When the official bar lands, the frame
identity rolls and the synthesized bar stops being appended.
