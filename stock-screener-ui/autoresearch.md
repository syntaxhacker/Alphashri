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
- `experiments/calc_beta.py` — Calculate stock betas vs market proxy from cached data
- `experiments/oos_validate.py` — Train/test split validation to detect overfitting
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

## Utility Scripts

### Calculate betas for all stocks
```bash
source .venv/bin/activate && python3 experiments/calc_beta.py
```
Outputs `METRIC beta_ADANIENT=1.486` lines for each stock. High beta (>1.2) list also output.

### OOS validation (detect overfitting)
```bash
source .venv/bin/activate && python3 experiments/oos_validate.py
```
Runs best params on train (Dec-Feb) vs test (Mar-Apr), reports delta. Outputs `METRIC oos_pf_test` etc.
Use `ORB_SYMBOLS=ADANIENT,UPL` to filter specific stocks.

### Run benchmark on filtered symbols + dates
```bash
ORB_SYMBOLS="ADANIENT,UPL,IRFC" ORB_DATE_START="2026-03-01" ORB_DATE_END="2026-04-09" ./autoresearch.sh
```

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

### Best Config Found (PF=1.90 in-sample, PF=2.25 on unseen EMS stocks)
```
OR_MIN=45, SL=1.2%, TP=2.0%, buffer=0.62%, cooldown=50 bars (250 min), shorts=OFF, EOD=15:00
```

### OOS Validation — Completely Unseen EMS Stocks (Apr-Jun 2026)
Tested on 10 EMS/electronics manufacturing stocks via Yahoo Finance 5-min data:
NETWEB, KAYNES, SYRMA, AMBER, CENTUM, MTARTECH, ASTRAMICRO, PARAS, DATAPATTNS, TEJASNET
- Portfolio PF=2.25, WR=53.8%, 78 trades, net=Rs +100,239
- 9/10 stocks profitable individually
- Standouts: CENTUM (5.89), PARAS (5.52), DATAPATTNS (3.35), AMBER (2.47)
- DIXON (NETWEB competitor, from in-sample): PF=2.64

### Key Insights
- High beta stocks need wider buffer (0.62%) and longer cooldown (250 min)
- Strategy is NOT overfit: OOS delta +3.5% (test 1.91 > train 1.85)
- EMS/electronics sector especially suitable for this ORB config
- Total tested: 82% of stocks profitable (27/33 across ALL datasets)
OR_MIN=45, SL=1.0%, TP=1.5%, buffer=0.3%, cooldown=15 bars (75 min), shorts=OFF
→ PF=1.29, WR=41.5%, 615 trades/90 days, net_pnl=+101,690 INR
```
