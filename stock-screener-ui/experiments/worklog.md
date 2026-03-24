# Worklog: 52W Target VectorBT Parameter Optimization

## Session: vbt-52w-target-opt
Started: 2026-03-25

## Objective
Find optimal 52W Target strategy params using vectorbt across 10 NSE stocks with walk-forward anti-overfitting.

## Setup
- Branch: autoresearch/vbt-52w-target-opt-20250325
- Data: Upstox v3 API (upstox_client SDK), daily bars, ~3 years
- Stocks: RELIANCE, TCS, INFY, HDFCBANK, ICICIBANK, SBIN, BAJFINANCE, MARUTI, TATASTEEL, ADANIENT
- Strategy: 52W high approach entry, trailing stop after target, SL, max holding, cooldown
- Anti-overfitting: Walk-forward (12m train / 6m test / 3 folds), cross-stock consistency, param stability
- Primary metric: avg_oos_sharpe (higher is better)
