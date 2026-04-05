# Autoresearch: SR Breakout Win Rate & Profit Factor

## Objective
Optimize the Classic S/R Breakout strategy parameters to maximize profit factor (PF) and win rate (WR) without overfitting. The strategy enters when price breaks above R1 (or below S1) pivot level with a buffer. The current issue is a 19% win rate and PF of 1.2 on Apr 2 data — too many false breakouts, especially at market open.

## Metrics
- **Primary**: profit_factor (ratio, higher is better)
- **Secondary**: win_rate (%), total_pnl (INR), total_trades (count)

## How to Run
`./autoresearch.sh` — reads cached data, outputs `METRIC` lines. Fast, no API calls.

Parameters via env vars: `SR_SL`, `SR_TP`, `SR_BUFFER`, `SR_PIVOT`, `SR_MIN_HOUR`, `SR_MIN_MIN`, `SR_MAX_HOUR`, `SR_MAX_MIN`.

## Files in Scope
- `trading/sr_breakout_signals.py` — Signal generator (pivot calc, entry/exit logic)
- `trading/multi_strategy_runner.py` — Scan loop, entry price source, position monitoring
- `experiments/sr_data_cache.pkl` — Cached 1-min intraday + daily data for 18 symbols (Apr 2, 2026)
- `scripts/sr_benchmark.py` — Benchmark script (reads cache, runs simulation)
- `scripts/optimize_sr_sltp.py` — Grid search optimizer (reference)

## Off Limits
- No changes to ORB strategy or other strategies
- No changes to DB models or API endpoints
- No new dependencies

## Constraints
- Data is a single day (Apr 2, 2026) — avoid overfitting to this specific day
- Strategy must remain simple (fixed % SL/TP, pivot-based entry)
- Must work with the existing `multi_strategy_runner.py` architecture

## What's Been Tried
- **Entry price fix**: Changed from stale daily close to live 1-min close (already applied)
- **SL=0.5% TP=1.5%**: Original config. 0-min hold bug made it look like 77% WR but was fake
- **SL=1.0% TP=3.0%**: Current config. 19% WR, PF=1.2 on real data
- **SL=0.75% TP=2.0%**: Best P&L in grid search (+113), PF=4.0 but only 25% WR
- **Key insight**: 5 of 11 SLs are 9:15-9:16 opening gap entries that reverse immediately. Time filter should help.
- **Key insight**: Breakout entries use close price. Wider buffer may filter false breakouts better.
