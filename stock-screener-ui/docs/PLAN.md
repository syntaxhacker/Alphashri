# SENSEX Strategy Improvement Plan

Created: 2026-08-06 (expiry day). Todos from the live horse-race post-mortem.
None of these should be done mid-session; implement on a fresh day.

## Priority 1 — Realism (do these first, they change whether results are real)

### 1.1 Add slippage / spread costs
- **Problem:** `paper_sensex.py` uses mid-premium (BS price) for entry AND exit. Real
  option fills happen at ask (buy) / bid (sell). SENSEX option spreads ~₹1-5 (0.3-0.8%).
- **Fix:** add `--spread-pct` (default ~0.5%) applied to every entry/exit:
  - buy premium = mid + spread/2, sell = mid − spread/2.
  - Apply in: `paper_sensex_scalp_backtest.py`, `paper_sensex_orb_backtest.py`,
    `paper_sensex_hourly_backtest.py`, live monitor (`sample_once`/`cmd_top5` close logic).
- **Verify:** rerun the 23-day 1-min sweep + 7-day window. Check if momentum-scalp
  (+₹799/day) and notrend (+₹584 OOS) edges survive spread. If they don't, the edge
  was illusory.

### 1.2 Expiry-day awareness
- **Problem:** today (2026-08-06) IS expiry. `DEFAULT_EXPIRY = 2026-08-06`. On expiry day
  theta decays to ~0 by 15:30; BS pricing with `t_years=1/365` overprices mid-day theta;
  spreads widen near close.
- **Fix:**
  - Detect `nearest_expiry == today` → price with `t_years = (15:30 - now)/86400` (time
    to close), not a fixed 1 day.
  - Warn in `check`/`top5`/`monitor`: "EXPIRY DAY — avoid new entries after ~14:00".
  - Optionally block new entries after 14:00 on expiry day (config flag).
- **Verify:** compare expiry-day results vs non-expiry days in the journal.

### 1.3 Walk-forward re-validation
- **Problem:** configs chosen on ~23 days can overfit as data grows.
- **Fix:** a script that re-runs train/test split weekly (train 70% / test 30%), reports
  whether the top config still holds OOS, and flags degradation. Reuse the OOS harness
  already written for the scalp/1-min sweeps.

## Priority 2 — Regime / selection

### 2.1 VIX-gated strategy auto-selection
- **Done:** `vix` command + `check` prints VIX regime (`65793b5`).
- **Fix (next):** `top5` and `monitor` print the regime at startup and auto-pick the
  family:
  - VIX < 13 → notrend + range-scalp (today: notrend +₹1,976 ✅)
  - VIX 13-16 → notrend ok; momentum marginal
  - VIX 16-20 → momentum/breakout better
  - VIX > 20 → momentum/breakout; avoid range-fade

### 2.2 Position sizing by VIX / capital
- Size inversely to VIX: low VIX → 2-3 lots, high VIX → 1 lot.
- Add a max daily-loss stop (e.g. −₹2,000 kills the session) in the monitor/top5.

### 2.3 Auto-promote horse-race winner
- After 15:30, compute the day's winner from `top5_live_<date>.csv`, and (with the VIX
  gate) recommend/promote it to the real live monitor next day.

## Priority 3 — Evidence

### 3.1 Multi-day journal + equity curve
- Track per-day: date, VIX, regime, SENSEX range, each strategy's net, winner.
- Append to `experiments/data/top5_daily_journal.csv`.
- Build an equity curve so we accumulate evidence of **which family wins under which
  VIX**, turning the single-day insight into a validated rule.
- A small script `scripts/paper_sensex_journal.py` to summarize.

## Notes
- Do NOT implement mid-session (today). Implement on a fresh day, then rerun sweeps.
- All changes stay in `scripts/paper_sensex*.py` + `docs/` + `experiments/data/`.
- Slippage + expiry-day are the highest priority — without them, results may be overstated.
