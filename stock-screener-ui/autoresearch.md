# Autoresearch: ORB Best Params for High Beta Indian Stocks

## Objective
Find the optimal ORB 45-min strategy parameters (sl_pct, tp_pct, breakout_buffer_pct, cooldown_bars, eod_exit_time, enable_shorts) that maximize profit factor on high beta Indian F&O stocks.

High beta stocks (beta > 1.2) show amplified moves vs Nifty 50. The hypothesis: ORB works better on high beta stocks because they have stronger trending tendencies after the opening range breaks out.

## Metrics
- **Primary**: profit_factor (ratio, higher is better)
- **Secondary**: win_rate (%), net_pnl (INR), total_trades (count), stocks_with_trades (count), tp_exits, sl_exits, eod_exits

## How to Run
`./autoresearch.sh` — reads cached data from `../experiments/data/orb_cache.pkl`, outputs `METRIC` lines. Fast (< 30s), no API calls.

Parameters via env vars: `ORB_OR_MIN`, `ORB_SL`, `ORB_TP`, `ORB_BUFFER`, `ORB_COOLDOWN`, `ORB_SHORTS`, `ORB_TRADE_SIZE`, `ORB_MIN_ENTRY`, `ORB_MAX_PER_DAY`, `ORB_EOD_EXIT`, `ORB_CACHE_DIR`.

## Files in Scope
- `experiments/orb_benchmark.py` — Standalone ORB simulation on cached data, outputs METRIC lines
- `autoresearch.sh` — Shell wrapper that sets env vars and runs benchmark

## Off Limits
- No changes to ORB strategy code (`backtest/strategies/orb.py`)
- No changes to API endpoints or DB models
- No new dependencies
- No changes to trading/live strategy code
- No modification to cached data

## Constraints
- Benchmark uses cached 5-min data for 23 high-volatility F&O stocks (Dec 2025 - Apr 2026)
- Simulation must match Nautilus ORB behavior
- OR period starts at 9:15 IST, default or_minutes=45
- Cost model: equity intraday rates (brokerage 0.03%, STT 0.025% sell, etc.)
- OR range filter: min 0.5%, max 3.0% (skip tight/wide ranges)
- Min 5 candles in OR period, min 3 candles post-OR

## What's Been Tried

### Baseline (PF=1.41)
OR_MIN=45, SL=1.0%, TP=1.5%, buffer=0.3%, cooldown=3, no shorts, EOD=15:00
→ 800 trades, WR=36.8%, net=Rs +128,401

### Key Findings
| Experiment | Best | PF | Notes |
|-----------|------|----|-------|
| EOD=15:00 | vs 14:45 | 1.41→1.41 | Huge jump from EOD change (800 trades) |
| CD sweep | CD=30 | 1.54 | Fewer but higher quality trades (507 trades) |
| SL/TP grid (CD=30) | SL=1.2/TP=2.0 | 1.66 | Wider SL + moderate TP works best (425 trades) |
| CD refine (SL=1.2/TP=2.0) | CD=40-50 | 1.69 | Longer cooldown plateaus (406-414 trades) |
| Buffer sweep | 0.62% | **1.90** | Sweet spot. 0.1% (1.74), 0.6% (1.88), 0.62% (1.90) |
| Shorts | OFF | better | Doubles trades to 657, PF drops to 1.26 |
| Max per day | 1-2 | same | Cooldown already handles it |

### Best Config Found (PF=1.90)
```
OR_MIN=45, SL=1.2%, TP=2.0%, buffer=0.62%, cooldown=50 bars (250 min), shorts=OFF, EOD=15:00
→ PF=1.90, WR=55.7%, 291 trades/120 days, net_pnl=+Rs 125,432

Key insight: High beta stocks need wider buffer (0.62%) and longer cooldown (250 min)
compared to general volatile stocks (0.3% buffer, 75 min cooldown).
SL=1.2% and TP=2.0% give better risk/reward than tighter stops.
```
OR_MIN=45, SL=1.0%, TP=1.5%, buffer=0.3%, cooldown=15 bars (75 min), shorts=OFF
→ PF=1.29, WR=41.5%, 615 trades/90 days, net_pnl=+101,690 INR
```
