# Autoresearch: EMA Cross Trending Strategy for Indian Stocks

## Objective
Find the optimal EMA crossover parameters (ema_fast_period, ema_slow_period, sl_pct, tp_pct, cooldown_bars, enable_shorts, eod_exit_time) that maximize profit factor on liquid Indian F&O stocks.

EMA cross is a trend-following strategy that enters long when fast EMA crosses above slow EMA, and exits on SL/TP/EOD. The hypothesis: longer-term EMAs (20/50, 10/30) produce fewer but higher-quality signals, while shorter-term EMAs (5/15) capture more trends but with higher noise.

## Metrics
- **Primary**: profit_factor (ratio, higher is better)
- **Secondary**: win_rate (%), net_pnl (INR), total_trades (count), stocks_with_trades (count), tp_exits, sl_exits, eod_exits

## How to Run
`./autoresearch.sh` — reads cached 5-min data from `experiments/data/ema_cache.pkl`, outputs `METRIC` lines. Fast (< 30s), no API calls after first run.

Parameters via env vars: `EMA_FAST`, `EMA_SLOW`, `EMA_SL`, `EMA_TP`, `EMA_COOLDOWN`, `EMA_SHORTS`, `EMA_EOD_HOUR`, `EMA_EOD_MINUTE`, `EMA_CACHE_DIR`.

## Files in Scope
- `experiments/ema_benchmark.py` — Standalone EMA cross simulation on cached data, outputs METRIC lines
- `autoresearch.sh` — Shell wrapper that sets env vars and runs benchmark

## Off Limits
- No changes to EMA strategy code (`trading/ema_cross_signals.py`)
- No changes to API endpoints or DB models
- No new dependencies
- No changes to trading/live strategy code
- No modification to cached data

## Constraints
- Benchmark uses 5-min data for 34 liquid F&O stocks (Jan 2026 - present)
- Cost model: simple gross P&L (no brokerage/SLT/STT for speed)
- EOD exit at configurable time
- Cooldown prevents re-entry for N bars after exit
- No shorts by default (enable_shorts=0)

## What's Been Tried

### Baseline (PF=1.0585)
FAST=9, SLOW=21, SL=1.0%, TP=1.5%, CD=3, no shorts, EOD=14:45
→ 3057 trades, WR=49.3%, net=Rs +53,299
