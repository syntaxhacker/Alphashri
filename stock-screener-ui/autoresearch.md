# Autoresearch: Optimize Screener Filters for EMA Cross 60-min

## Objective
Find the best combination of TV screener filter thresholds (min market cap, min ATR%, min price, min volume) that produces the highest-quality pool of stocks for the EMA Cross 60-min (SL=8%, TP=12%) strategy.

The screener fetches from TV's `volatility_trend` profile, which already selects for high-ATR trending stocks. We then apply additional filters to narrow down to the best subset.

## Metrics
- **Primary**: `aggregate_pf` (ratio, higher is better) — combined profit factor across ALL trades from ALL qualifying stocks (total gross wins / total gross losses)
- **Secondary**: `qual_stocks` (count), `total_trades` (count), `total_net_pnl` (INR), `avg_pf` (ratio), `profitable_ratio` (% of qualifying stocks with PF >= 1.0)

## How to Run
```bash
./autoresearch.sh
```
Outputs `METRIC name=value` lines.

## Parameters Being Optimized
| Parameter | Baseline | Range |
|-----------|----------|-------|
| `min_mcap_cr` | 1000 | 100, 500, 1000, 2000, 5000 |
| `min_atr_pct` | 3.0 | 1.0, 2.0, 3.0, 4.0, 5.0, 6.0 |
| `min_price` | 100 | 20, 50, 100, 150, 200 |
| `min_volume` | 500000 | 100000, 250000, 500000, 1000000 |

## Strategy Config (fixed)
```
EMA Cross 60-min | SL=8% | TP=12% | FAST=1 | SLOW=2 | COOLDOWN=1 bar | EOD=15:00
Date range: Jan-Jun 2026
Trade capital per stock: ₹100,000
Max 3 parallel workers
```

## Files in Scope
- `experiments/benchmark_screener_params.py` — the benchmark script that does TV query → filter → backtest → metrics
- `experiments/ema_benchmark.py` — EMA Cross simulation engine (sim_symbol, compute_metrics) — DO NOT MODIFY
- `market_data/market_data.py` — data fetching — DO NOT MODIFY

## Off Limits
- `db/` — database models
- `api/` — API routes
- `src/` — frontend code
- Any production code outside experiments/

## Constraints
- Must have >= 3 qualifying stocks for valid result (otherwise skip)
- Each stock must have >= 2 trades to count as "qualified"
- No new dependencies
- Fast: pre-cached data means each experiment should take < 10s

## What's Been Tried
(Baseline will be added after first run)
