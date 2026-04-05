# Autoresearch: SR Breakout Win Rate & Profit Factor

## Objective
Optimize the Classic S/R Breakout strategy parameters to maximize profit factor (PF) and win rate (WR) without overfitting. The strategy enters when price breaks above R1 (or below S1) pivot level with a buffer.

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

## Off Limits
- No changes to ORB strategy or other strategies
- No changes to DB models or API endpoints
- No new dependencies

## Constraints
- Data is a single day (Apr 2, 2026) — avoid overfitting to this specific day
- Strategy must remain simple (fixed % SL/TP, pivot-based entry)
- Must work with the existing `multi_strategy_runner.py` architecture

## What's Been Tried
- **Entry price fix**: Changed from stale daily close to live 1-min close (already applied before session)
- **Baseline SL=1.0% TP=3.0%**: PF=1.25, WR=18.8% — most breakouts at 9:15 reverse immediately
- **Time filter min=10:30**: Biggest single improvement. PF=6.05. Opening gaps are false breakouts.
- **Camarilla pivot**: Better than classic for NSE intraday. PF=13.93 when combined with time filter.
- **SL=0.6% TP=2.0%**: Sweet spot. PF=17.42, WR=53.3%. Tight SL works because time filter prevents early whipsaws.
- **Buffer variation (0.05-0.3)**: No significant effect with camarilla pivot.
- **Max entry time**: No significant effect (14:00-15:30 all similar).
- **Fibonacci pivot**: Worse than classic and camarilla for this data set.

## Best Result
**PF=17.42, WR=53.3%** — camarilla pivot, SL=0.6%, TP=2.0%, buffer=0.1%, min_entry=10:30
