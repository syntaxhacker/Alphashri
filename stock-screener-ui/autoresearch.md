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
- **SL Sensitivity**: PF increases monotonically as SL tightens (2%→0.001%)
  - 2% SL: PF=0.82, 1% SL: PF=1.08, 0.5% SL: PF=1.47, 0.1% SL: PF=2.74, 0.001% SL: PF=4.04
  - **No SL is worse** (PF=1.05) — SL is essential
- **No TP beats any TP**: Removing TP gives PF=1.08 vs TP=3% gives PF=0.82
- **any_day beats up_day**: No entry threshold gives PF=1.16 vs up_day PF=1.08 (buying after up-day means buying high)
- **Higher mcap helps marginally**: mcap>=10000Cr gives PF=4.18 (best) vs mcap>=1000 gives PF=4.04
- **Price filter doesn't help**: price>=200 gave PF=4.10 vs baseline at same SL
- **100% stocks profitable** at SL<=0.05% with any_day/no TP config
