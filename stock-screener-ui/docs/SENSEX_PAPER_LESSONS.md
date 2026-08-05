# SENSEX Paper Trading — Mistake Log & Rules (live document)

Session: 2026-08-05. Update this file whenever a mistake is made or a lesson is learned.
**Current paper P&L: −₹3,687** (as of 12:40 IST).

---

## 1. THE BIGGEST MISTAKE — fighting the trend (bought CEs on a down-day)

**What happened:** SENSEX opened at the day high (79,055) and fell all morning to 78,439
(−616 pts). We bought **6 long calls** during this down-move. 5 lost on SL, only 1 won.

| # | Time | What we did | Result |
|---|---|---|---|
| 1 | 09:45 | CE 78500 @518 | **−1,167** |
| 2 | 09:45 | CE 79000 @228 | **−657** |
| 3 | 10:05 | CE 78800 @325 | **−1,064** |
| 4 | 09:55 | PE 78700 @266 (only short) | **−743** (entered wrong spot) |
| 5 | 11:11 | PE 78800 @271 (resistance reject) | **+774 TARGET** ✅ |
| 6 | 11:53 | CE 78600 @344 (forced support bounce) | **−484** |
| 7 | 12:33 | CE 78500 @359 (forced support bounce) | **−346** |

**Cost:** −₹4,461 in losses vs +₹774 win = −₹3,687 net.
**Missed PE potential** (what buying puts instead would have returned): ≈ +₹12,500.
**Total swing missed:** ≈ **−₹16,900**.

**RULE #1: Trade WITH the day's direction.**
- spot < day open = **down-day → shorts/PE only**. NEVER buy a CE (long) on a down-day.
- spot > day open = **up-day → longs/CE only**. NEVER buy a PE on an up-day.
- Implemented in `RangeStrategy.decide_with_levels` as the `trend` filter (verified working).

---

## 2. "Support bounce" in a downtrend is a trap

**What happened:** Multiple times the index bounced off a support level (e.g. 78,500) with
rising momentum, so the strategy fired a CE "support bounce" — then the support broke and
the bounce failed. In a trend day, supports are not floors; they're speed bumps.

**RULE #2:** On a down-day, do NOT buy support bounces (CE). Only trade breakdowns (PE below
support) — the continuation, not the reversal.

---

## 3. Support level must be FROZEN, not ratcheting

**What happened:** The breakdown rule used `spot <= day_low - 15`. But in a cascade the day
low keeps updating (78,500 → 78,489 → 78,460 → 78,439), so the break level chases the price
and **never fires**. We missed every PE breakdown signal.

**RULE #3:** Anchor the breakdown level to a FIXED reference (first day-low observed when the
strategy starts a down-day, or OI PE magnet), not the ever-updating day-low. Implemented via
`_anchor_low` (freeze-once) in `RangeStrategy`.

---

## 4. Poll interval + confirmation lag = missed fast moves

**What happened:** Monitor polled every 2 min with 2-sample confirmation → up to 4 min lag.
SENSEX moved 100+ pts in under a minute on multiple occasions; by the time the strategy
"confirmed," the entry was gone or already stopped out.

**RULE #4:** Use short poll interval (60s) during market hours. Use `force` for instant
entry on a confirmed live signal when a fast move is happening.

---

## 5. Code bugs cost real (paper) money

**What happened:**
- `TARGET_NET` referenced as instance attr instead of module constant → monitor crashed
  4 polls in a row mid-trade (10:44–10:52), missing the rally entry.
- Old processes not cleanly killed → stale monitor with old logic kept running.

**RULE #5:** Test every code change (`python -c "import/run"`) before relying on it. Before
restarting a monitor, kill ALL old pids. Never trust "it's running" without checking the log.

---

## 6. Too many scripts = drift

**What happened:** 9 fragmented scripts each had slightly different logic. Fixed by
consolidating into ONE `scripts/paper_sensex.py` (single source of truth).

**RULE #6:** One script, one source of truth. Change one file, not eight.

---

## What NOT to do (quick reference)

- ❌ Don't buy calls (CE) when the index is below its day open (down-day).
- ❌ Don't buy "support bounces" in a downtrend — buy breakdowns (PE) instead.
- ❌ Don't let the breakdown level chase the falling day-low; freeze it.
- ❌ Don't use long poll intervals (>60s) for a fast-moving index.
- ❌ Don't enter manually on emotion — let the strategy/force decide.
- ❌ Don't run stale processes after a code change.

## What to do (quick reference)

- ✅ Check day direction first: `spot < open → PE only`, `spot > open → CE only`.
- ✅ Use `./psc` for quick checks, `./psc pnl` for the book.
- ✅ Use `force --dry-run` then `force` for instant confirmed entries.
- ✅ Keep the monitor on 60s interval until 15:30.
- ✅ Update this log after every mistake/lesson.

---

## 7. Multi-day sweep: single-day ranking is misleading

**What we learned:** Picking a strategy by ONE day's backtest = overfitting. The max of
28-48 configs always beats the average even if all are noise. Today's winner may be
tomorrow's loser (we proved it: brk-only won today but has median ₹0 across 15 days).

**Fix (implemented in paper_sensex.py):**
- `fetch-candles` → multi-day 1-min cache (14+ days verified).
- `sweep` → per-day P&L matrix; **rank by MEDIAN day P&L** (primary), % profitable
  days, max drawdown, trade count. Hold-out: confirm winner on last 2 days.
- 15-day sweep result: `notrend-t600-sl200-on` median +₹1,454/day (93% profitable
  days) — trades both directions (no trend filter), highest robustness.
  `brk-t600-sl400-on` (breakdown-only) has median ₹0 / 40% pos days — only trades
  down-days, idle on up/flat days. Today brk=+₹197 (down-day) vs notrend +₹1,165.
- `sweep-live`: live signal board across all 48 configs.

**RULE #7:** Always evaluate a strategy over multiple days and rank by median day P&L
(robustness), not single-day net. Single-day = preview; multi-day = verdict.

---

## 8. Always include option charges

Added realistic premium-based charges to backtest + live paper tracking:
STT 0.1% (sell), brokerage 0.03% (min ₹20), exchange 0.03503%, SEBI, GST 18%,
stamp 0.003% — ≈₹15-16 per round-trip on a ~₹6k option trade.

**Impact on the sweep (15 days):**
- notrend-t600-sl200-on: +₹18,452 → **+₹13,850** net; profitable days 93% → **87%**
- High-churn configs (343+ trades) hurt most — every trade pays ~₹15.

**RULE #8:** Always model charges — a strategy's edge can disappear after costs,
especially for high-frequency configs. `sweep --no-costs` shows the difference.

---

## 9. Data limits: 1-min intraday is capped ~30 days

Upstox 1-min historical is hard-capped at ~30 days (all intervals return 400 past 45d).
yfinance 5m/15m ~60d. Only 60-min gives months (6mo verified for SENSEX).

**Validation ladder:**
- 1-min (real live strategy): extend cache to full ~30d → 23 trading days. Winner
  `notrend-t600-sl200-on` median +₹1,134/day, 78% pos days, +₹21,506 net. Stable as data grows.
- 60-min (adapted hourly variant, 3 months): `notrend-t900-sl200-on` mean +₹495/day,
  47% pos days (median 0 = >50% of days no hourly signal), +₹59,949 net over 121 days.
  Holds out-of-sample. Costs ~-3%, no rank flips. Caveat: re-tuned thresholds for hourly.

**RULE #9:** Match the backtest horizon to data availability. For the LIVE 1-min strategy,
the honest validation window is ~20-30 days (Upstox cap). Longer horizons require adapting
to 60-min bars — a different (hourly) variant, not the same strategy. Both are now tooled.
