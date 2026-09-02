# Autoresearch: SMC Biggest RR — Low Trades Huge P&L

## Objective
Build SMC (Smart Money Concepts) strategy that takes **very pivot lows** at liquidity (day/NY lowest, demand double-bottom, OB) on **reversions** with **huge RR 3-11** (SL swing ±8, TP 1.5-5× risk), **low trades** (1-3/day) and **huge winrate/P&L** across **5 random sessions/days** — verified out-of-sample (no overfit). Use history-only (no lookahead: HTF 20EMA + higher low, support = day low ±0.4% or 2 touches, halt 17:00). Validate on yfinance NQ=F 1m (5m fallback) IST 2pm onwards and random 5 days.

## Metrics
- **Primary**: `profit_factor` (ratio, higher is better) — combined across 5 random days, OOS
- **Secondary**: `win_rate` (%), `net_pnl` (INR, 2 micros $2/pt = $4/pt), `total_trades` (count, lower is better for this goal: 1-3/day), `avg_RR` (higher), `max_RR`

## How to Run
`./autoresearch.sh` — outputs `METRIC profit_factor=number win_rate=number net_pnl=number total_trades=number avg_RR=number` lines.

## Files in Scope
- `trading/smc_signals.py` — live SMC generator (BOS short, sweep long, demand DB, OB, inside-bar, HL, halt, HTF, support)
- `backtest/strategies/smc.py` — backtest mirror (Nautilus, same logic, OOS)
- `trading/base_signals.py` — base SL/TP, EOD
- `backtest/strategies/__init__.py` — registry (add 'smc')

## Off Limits
- `db/` — never modify alphashri.db
- `api/` — no API changes
- `src/` — no frontend changes for this loop

## Constraints
- **No overfit**: every change must be validated on **5 random sessions** (different days, different start dates) — report OOS PF separately from in-sample 09-02. Keep `min_rr` + `cooldown` + `support` logic simple, not per-trade tuned.
- Tests must pass: `bun run lint` 0 errors, `bun run build` ok, `npx vitest run src/components/paper-trading` if touched
- No new deps
- Cooldown 12-24 bars, RR 3-5, swing_lookback 12

## What's Been Tried
- **Baseline SMC 4 trades/day 09-02 +1224 ideal (1m 14:23 +30, 14:30 +30, OB 28950 11R, 16:37)** — manual ideal backtest with yfinance 1m, huge RR at liquidity, low trades but not coded.
- **Initial SMC coded** (min_rr 2.8, RR3) → 5m 09-02 4 signals net -344 WR0% on random 5 days (20,16,12 trades) — overtrading.
- **Huge RR 4.0 + HTF/support + day_low 0.4%** → 5m 09-02 1 trade net -92 WR0% — too strict, missed 09-02 4:37 inside bar RR2.1.
- **Adjusted to sweep RR2.0, OB RR3.0, cooldown 12→24** → 5 days 1-3 trades/day net +5 to -92 (still 0% WR on 3 days) — HTF bull filter blocked bear day reversions where sweep should win.
- **Fixed very pivot lows** (dist 1.2% + support_ok day_low) + HTF: sweep no HTF, demand/OB with HTF+support → 09-02 1 signal (15:20 OB) net -92, still losing.
- **Current (huge RR 4-5 + very pivot)** → 5 days 1-8 signals but WR 0% on 4/5 days (SL hit before TP, RR 4 too wide 60-239 pts). Need **RR 2-3** for 5m, **RR 3-5** for 1m, and **time-based TP** not fixed 4R.

## Next Ideas
- Try RR 1.5-2.0 for 5m, RR 3.0 for 1m only at very pivot (already tested RR3 gives more signals).
- Add volume filter (vol_ratio >1.5) to reduce false OB.
- Use HTF daily bias (close > open) to allow longs only on bullish session, else flat (already added session_bull).
- Test 1m vs 5m separately — 1m has 20 signals vs 5m 3 signals on 09-02.

