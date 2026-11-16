# Pattern data freshness — KAYNES incident

Status: **root-cause audit running** (read-only). Plan and task ownership below;
facts marked *(confirmed)* were reproduced on 2026-11-16.

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

## Working root cause

Two sources of truth with different freshness:

1. The chart candles pin to the **last completed session** (13 Nov) — correct
   for daily pattern detection, which must not use a partial bar.
2. The dock's `last_close`/`day_change_pct` come from an **enriched scan item**
   captured at an older frame (11 Nov) and override the newer chart candle.
3. The label has no date, so a historical daily close reads as "today".

Today's dump (16 Nov, intraday) is in **neither** daily series by design; the
table's LTP is the only live value. The bug is the stale enrichment plus the
undated label, not the intraday/daily difference alone.

## Does it need a refresh?

Yes, in two places:

- **Data**: an enrichment value must be invalidated when the candle frame moves.
  The frame's last timestamp (or the existing interior digest) must be part of
  the cache/persistence key; a forced scan must clear the per-symbol timeline /
  series cache, not only the candle file.
- **UI**: the pattern dock needs a refresh action that actually re-fetches the
  symbol chart/enrichment (today the panel has no such affordance), and the
  value must be labelled with its bar date.

## Tasks

### T1 — Root-cause + all-data audit (read-only, running)

Owner: audit subagent. Trace the dock's `last_close` to its exact producer;
list every cache (candle file, `tl_cache`, Redis/matrix, stored scan columns)
with key + TTL + invalidation; compare enrichment vs chart candle vs live LTP
for 8–12 symbols × `1D`/`1h`; rank fix options. **No edits.**

### T2 — Backend single source + invalidation

- Derive `last_close`/`day_change_pct` from the **same frame** used for
  detection/chart candles; never from an older persisted item when a newer
  frame exists.
- Include `timeframe`, `lookback`, `as_of`, and the frame's last timestamp /
  digest in every cache key (candle, series, matrix, stored enrichment).
- On a forced scan / refresh, clear the affected symbol+timeframe enrichment
  and matrix entries as well as the candle cache.
- Tests: (a) a newer frame invalidates an older enrichment; (b) the value equals
  the last candle's close/change; (c) forced refresh replaces stale rows.

### T3 — Frontend source + label + refresh

- Prefer the **chart's last candle** when its timestamp is newer than the hit's
  enrichment; do not let a stale hit override it.
- Label the value with its date: `CLOSE · 13 NOV ₹3,430 −1.55%` (and
  `PREV CLOSE` when the last bar is not today). Never bare `LAST CLOSE` with a
  historical bar.
- If the dock is opened from the market table, show the live quote as a separate
  `LTP · ₹2,986 −12.94%` line (pass it in the open payload; the table already
  has it). Otherwise omit it rather than imply freshness.
- Add a refresh button in the pattern dock that calls the symbol chart refresh
  (and clear the in-memory `symbolChartCache` entry for that key).
- Tests: stale enrichment + fresh candle → candle wins; label contains the bar
  date; live quote is only shown when supplied; refresh clears the cache key.

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
