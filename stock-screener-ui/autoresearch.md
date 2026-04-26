# Autoresearch: ORB Best Conditions for Highest Profit Factor

## Objective
Find the optimal ORB strategy parameters (or_minutes, sl_pct, tp_pct, breakout_buffer_pct, cooldown_bars, enable_shorts) that maximize profit factor on the top 25 most volatile NSE stocks over 90 days of historical data.

## Metrics
- **Primary**: profit_factor (ratio, higher is better)
- **Secondary**: win_rate (%), net_pnl (INR), total_trades (count), stocks_with_trades (count)

## How to Run
`./autoresearch.sh` — reads cached data from `../experiments/data/orb_cache.pkl`, outputs `METRIC` lines. Fast (< 30s), no API calls.

Parameters via env vars: `ORB_OR_MIN`, `ORB_SL`, `ORB_TP`, `ORB_BUFFER`, `ORB_COOLDOWN`, `ORB_SHORTS`, `ORB_TRADE_SIZE`, `ORB_MIN_ENTRY`, `ORB_CACHE_DIR`.

## Files in Scope
- `experiments/orb_cache.py` — Pre-fetches intraday data for top 25 volatile stocks
- `experiments/orb_benchmark.py` — Standalone ORB simulation on cached data, outputs METRIC lines
- `autoresearch.sh` — Shell wrapper that sets env vars and runs benchmark
- `backtest/costs.py` — Trading costs calculator (imported by benchmark, DO NOT modify)
- `backtest/strategies/orb.py` — Reference Nautilus ORB strategy (DO NOT modify)

## Off Limits
- No changes to ORB strategy code (`backtest/strategies/orb.py`)
- No changes to API endpoints or DB models
- No new dependencies
- No changes to trading/live strategy code

## Constraints
- Benchmark uses cached data (pre-fetched once via `python3 experiments/orb_cache.py`)
- Simulation must match Nautilus strategy behavior (PF calculated from net_pnl after costs)
- Data is 90 days of 5-min candles
- Only F&O stocks (liquid enough for real trading)

## What's Been Tried

### Baseline (PF=0.91)
OR_MIN=45, SL=0.4%, TP=1.2%, buffer=0.3%, cooldown=3, no shorts → 1485 trades, net=-56K

### Parameter Sweeps (individual)
| Parameter | Best | PF | Notes |
|-----------|------|----|-------|
| SL | 1.0% | 1.00 | Wider SL reduces SL exits but not enough alone |
| TP | 2.0% | 0.98 | Moderate TP best; 0.6% too tight, 3.0% too ambitious |
| OR_MIN | 45 (base) | 0.91 | Shorter = more noise, longer = fewer trades |
| Buffer | 0.2% | 0.94 | 0.3% best when combined with other params |
| Cooldown | **6** | **1.15** | **Biggest single lever. Reduces overtrading.** |
| Shorts | OFF | better | Doubles trades without improving WR |

### Grid Search (CD=6 + SL×TP×Buffer)
Best: SL=0.8/TP=2.0/BUF=0.3 or SL=1.0/TP=1.5/BUF=0.3 → PF=1.27

### Cooldown Sweep with best SL/TP/Buffer
CD=15 (75 min) → PF=1.29 (best). CD=30 → PF=1.28 (diminishing returns)

### Time Filter
min_entry=10:30 → PF=1.08 (no help, cooldown already handles it)

### Best Config Found
```
OR_MIN=45, SL=1.0%, TP=1.5%, buffer=0.3%, cooldown=15 bars (75 min), shorts=OFF
→ PF=1.29, WR=41.5%, 615 trades/90 days, net_pnl=+101,690 INR
```
