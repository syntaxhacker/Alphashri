# Missed-breakouts post-mortem — Nifty-500, week 42 (Mon 2026-10-05 → Fri 2026-10-09)

Setup snapshot uses **only bars with IST session date ≤ 2026-10-03** (sliced in
`experiments/missed_breakouts_week42_run.py`, never peeking past Friday).
Outcome side uses IST sessions Oct 5–9 only. All candles from the local
`experiments/data/pattern_cache/candles/1D` cache — no network. Full per-symbol
table (box/accumulation/technicals, breakout day, excursion, volume, verdict,
failure mode, screen flags) is in `missed_breakouts_week42.json`.

## 0. Calendar verification (do not skip — the mission premise was half wrong)

| Date | DOW | `trading.calendar` says | Reality (bars in cache) |
|---|---|---|---|
| Oct 2 | Fri | `is_trading_day=True`, `is_trading_holiday=False` | **holiday — 0/40 sampled symbols have an Oct-2 IST bar** |
| Oct 3 | Sat | weekend | weekend, no bars |
| Oct 5–9 | Mon–Fri | trading days | trading bars present |

- Oct 2 = Gandhi Jayanti. `trading/holidays_seed.py` **does** list it (twice —
  lines 30 and 54, a duplicate worth deduping), but `trading.utils`
  `is_trading_holiday(Oct 2)` returns **False** because the DB-backed holiday
  cache (`_get_cache()["trading"]`) doesn't contain it. **The calendar module
  is missing a real NSE holiday — genuine bug, worth a fix.**
- Consequence: "data through Friday Oct 3 close" is really **data through
  Thursday Oct 1 close**. The slicer (`dates <= 2026-10-03`) and an
  end-at-Oct-1 slicer are identical on this data (verified: setup frames end
  2026-10-01). All "Oct-3" figures below = Oct-1 close figures.

## 1. Setup snapshot (as of Oct 1 close, n=494)

- Universe `nifty500` = 501 symbols; **7 have no 1D cache at all**
  (BAGMANE, BIRET, DUMMYHEG, EMBASSY, HFCL, MTARTECH, STLTECH — HFCL/MTARTECH
  are real names, warm their cache before next week) → **494 analyzed**.
- `detect_consolidation` fired on **96/494 (19%)**; statuses: 75 `failed`
  (mid-box base, the normal pre-breakout state), 21 `confirmed`.
- `_near52w_row` (imported from `chart_patterns/watch.py`) computed for all;
  EMAs 20/50/200 + manual-Wilder ADX(14) (`trading.indicators` needs
  `pandas_ta` — present only in `.venv`, script ran under it but the
  `trend.adx` import still failed, so ADX is a local Wilder implementation;
  recorded as `adx_src=manual-wilder` in JSON meta).

## 2. Outcome labeling (Oct 5–9)

Reference level = Oct-3 box high if a box exists, else trailing-20d high.
Breakout = first week **close** above the level **and** Oct-1 close at/below it.

| Class | n | Meaning |
|---|---|---|
| `broke_monday` | **4** | first close-break Oct 5 (gap/run at week start — likely unchaseable) |
| `broke_midweek` | **17** | first close-break Oct 6–9 (detectable intraday) |
| `extended` | 21 | Oct-1 close **already above** the box (stale breakouts, excluded — matches the watch `arm` policy of rejecting stale `confirmed` hits; mixed follow-through: HONASA +9.5% vs SCHNEIDER −7.7%, so exclusion looks right) |
| `no_break` | 452 | — |

Volume confirmation (break-day vol / 20d avg): median ~1.8x for midweek breaks
(e.g. TRENT 9.1x, AETHER 4.9x, BHEL 3.5x); Monday gaps mostly <1.5x.

## 3. Miss analysis

Verdicts on the 21 true breakouts: **should-have-caught 1** (BHEL),
**partial-signal 1** (GLAND), **accum-no-box 4** (CUPID, AETHER, TDPOWERSYS,
KOTAKBANK), **came-from-nowhere 15**.

**Top failure modes (concrete, ranked):**

1. **`min_base_days=60` arm gate too strict (BHEL, GLAND — the two best
   setups).** Both were textbook 42-day, ~9% range, mid-box (`failed`) bases
   5–6% below the trigger with positive OBV slope. The detector found them;
   the *watch* gate (`SETUPS["breakout"]`, `min_base_days: 60`) would never
   arm them. A 30-day floor catches both.
2. **`near_52w` `max_gap=5.0` too tight (BHEL 5.7%, GLAND 5.5%, AETHER 7.1%,
   KOTAKBANK 7.7%).** Four of the best accumulation rows sat 5–8% below the
   prior high — just outside the computed-arm filter, which applies the gap
   gate but no accumulation gate at all.
3. **`above_ema20` style gates exclude mid-box bases.** BHEL (421.0 vs
   EMA20 421.29) and GLAND (2874 vs 2903) closed a hair *below* EMA20 —
   normal for a mid-box consolidation. Strict `close > EMA20` fails them;
   `close/EMA20 ≥ 0.98` passes. (Found while backtesting; applied once, see §4.)
4. **`_range_bound_swings` rejects spike-top bases (PETRONET).**
   60d range 11.7%, drift +2.9% — a genuine squeeze — but one old spike high
   (300.6) leaves a half-window with no touch within 0.75·ATR. Single-touch
   spike tops are invisible to the detector by design; the 20d-squeeze rule
   (§4, rule C) is the backstop.
5. **Breakdown-reversal breakouts are a different species (PWL, TRENT, PTCIL,
   BBOX).** Negative OBV slope, 20–38% off highs or no base at all, then
   +10–20% weeks on huge volume. No base/accumulation screen catches these
   without drowning in false positives — accept as misses, don't loosen the
   screen for them.
6. **Monday gaps are unchaseable by a daily screen (CPPLUS, CYIENT, ICICIGI,
   VBL).** The signal (gap + volume) exists only intraday-Day-1; an EOD screen
   can only flag them Tuesday, mid-move. Separate intraday gap job, not this
   screen.

Also fixed during analysis (my own bugs, disclosed): (a) first pass treated
`PatternHit` objects as dicts → 0 boxes; (b) first outcome pass counted
already-above-box names as Monday breakouts (24 phantom events) — the
`already_above` guard (§2) corrected this to 4 real Monday breaks.

## 4. Next-week screen spec (thresholds) + in-sample backtest

All features as-of Friday close. Flag if **any** rule fires:

- **A — tight base:** consolidation box AND `base_days ≥ 30` AND
  `range_pct ≤ 12` AND `dist_to_box ≤ 6%` AND `close/EMA20 ≥ 0.98` AND
  (`obv_slope > 0` OR `up/down_vol > 1.2`).
- **B — accumulation near high:** `close_gap_to_52w ≤ 8%` AND `obv_slope > 0`
  AND (`up/down_vol ≥ 1.5` OR `vol_ratio_5/20 ≥ 1.2`) AND `close/EMA20 ≥ 0.98`.
- **C — fresh 20d squeeze (no box):** no consolidation hit AND
  `range60 ≤ 18%` AND `dist_to_20d_high ≤ 4%` AND `vol_ratio ≥ 1.0` AND
  `close/EMA20 ≥ 0.98` AND `obv_slope > 0`.

In-sample on this week (494 names, 21 events — **honestly in-sample**: one
tuning round, thresholds saw the outcomes; expect worse live):

| Rule | Flagged | Events caught | Precision |
|---|---|---|---|
| A | 11 | 2 (BHEL, GLAND) | 0.18 |
| B | 25 | 5 (AETHER, BHEL, CUPID, KOTAKBANK, TDPOWERSYS) | 0.20 |
| C | 7 | 2 (LEMONTREE, PETRONET) | 0.29 |
| **Union** | **35** | **8/21 (recall 0.38)** | **0.23** |

7 of the 8 caught had MFE ≥ 5% (missed only PETRONET at 4.9%).
Unreachable-by-design 13/21: breakdown-reversals (PWL/TRENT/PTCIL/BBOX),
Monday gaps (CPPLUS/CYIENT/ICICIGI/VBL), weak-accumulation drifts
(DEEPAKFERT/MOTILALOFS/PERSISTENT/PAGEIND/RRKABEL). False positives (27)
skew negative next-week (median wkret ≈ −3%) — the screen flags late-stage
names; size positions accordingly and require Day-1 volume confirmation
(`vol_adj`/break-day vol ≥ 1.5x) before entry, exactly as `watch.live` does.

## 5. Hand verification (raw candles, §2 figures)

- **BHEL:** Oct-1 C 421.0; box high 442.65; Oct-6 C 452.0 > box ✓ first-break
  Oct-6 ✓; MFE (455.9−421)/421 = 8.29% ✓ (JSON 8.3); break-vol 22.9M ≈ 3.5x.
- **PETRONET:** Oct-1 C 285.5; Oct-5 C 290.0 ≤ 20d-high, Oct-6 C 297.5 > it ✓;
  MFE (299.6−285.5)/285.5 = 4.94% ✓.
- **CUPID:** Oct-1 C 312.5 (≈52w high, touched); Oct-6 C 324.2 > 20d-high ✓;
  MFE (368.0−312.5)/312.5 = 17.76% ✓. (Sep-29/30 +8%/+8% on 37M/66M shares —
  momentum continuation, correctly no-box.)

## 6. Hindsight-bias statement

Rules A/B/C were fit on this week's 21 events (one round). Reported
precision 0.23 / recall 0.38 are **ceilings**, not expectations. Validate on
2–3 unseen weeks before trusting; the 13 structurally-missed events bound
what any EOD base/accumulation screen can catch (~40% recall ceiling for this
week's *type* of moves).
