# Autoresearch: Optimize BTST (Buy Today Sell Tomorrow) Parameters

## Objective
Find the best combination of SL%, TP%, and entry threshold that maximizes profit factor for a BTST strategy across a universe of high-volatility Indian stocks.

BTST = Buy at market close when entry signal triggers (e.g., stock was up > X% that day), sell at next trading day's close (or when SL/TP hits intraday).

## Metrics
- **Primary**: `profit_factor` (ratio, higher is better) — combined profit factor across ALL trades
- **Secondary**: `win_rate` (%), `net_pnl` (INR), `total_trades` (count), `stocks_with_trades` (count), `sl_exits` / `tp_exits` / `close_exits` (counts)

## How to Run
```bash
./autoresearch.sh
```
Outputs `METRIC name=value` lines.

## Parameters Being Optimized
| Parameter | Baseline | Range |
|-----------|----------|-------|
| `BTST_SL_PCT` | 2.0 | 0.5, 1.0, 1.5, 2.0, 3.0, 5.0 |
| `BTST_TP_PCT` | 3.0 | 0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 0.0 (no TP) |
| `BTST_ENTRY_THRESHOLD` | 0.5 | 0.0, 0.5, 1.0, 2.0, 3.0 |
| `BTST_ENTRY_MODE` | up_day | up_day, any_day, volume_surge |

## Fixed Settings
```
Date range: Jan-Jun 2026
Trade capital per trade: ₹100,000
Stock universe: TV volatile_trend screener, min mcap=1000Cr, min price=50
Max stocks: 100
Costs: Delivery trading (STT=0.1%, stamp=0.015%)
Data: yfinance daily (NSE/BSE)
```

## Files in Scope
- `experiments/benchmark_btst.py` — the BTST benchmark script (TV screener → yfinance daily → BTST sim → metrics)
- Modify this file to add new entry modes or signal logic

## Off Limits
- `db/` — database models
- `api/` — API routes
- `src/` — frontend code
- `trading/` — production trading code
- `backtest/` — production backtest framework

## Constraints
- Must have >= 5 qualifying stocks for valid result (otherwise skip)
- Each stock must have >= 2 trades to count as "qualified" for per-stock PF
- No new dependencies beyond what's already in requirements
- Fast execution: 5 workers, yfinance cached data

## What's Been Tried
- **Baseline** (SL=2%, TP=3%, entry>+0.5%, up_day): PF=0.8188, WR=39.3%, Net=₹-712K, 3689 trades across 79 stocks
  - SL exits (1632) outnumber TP exits (1009) significantly — SL/TP ratio is asymmetric in favor of losses
  - Most exits are via CLOSE (1048) — many trades held to expiration without hitting either target
