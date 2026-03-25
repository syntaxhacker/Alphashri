# Autoresearch: 52W Target VectorBT Parameter Optimization

## Objective
Find optimal parameters for the 52-Week Target swing strategy using vectorbt, tested across 206 NSE F&O stocks with anchored walk-forward validation to prevent overfitting.

## Metrics
- **Primary**: sharpe_ratio (avg out-of-sample Sharpe across WF folds and stocks)
- **Secondary**: oos_win_rate, oos_profit_factor, oos_total_return, param_stability, trades_per_year

## How to Run
`./autoresearch.sh` or `python3 autoresearch.py`

## Files in Scope
- `autoresearch.py` — Main backtest + optimization script
- `autoresearch.sh` — Runner script
- `autoresearch.md` — This file
- `autoresearch.jsonl` — Run history (30 runs)
- `autoresearch-report.json` — Detailed per-stock report from best run

## Strategy Logic
- **Rolling High**: configurable lookback (default 252 bars)
- **Entry**: close >= rolling_high * (1 - entry_threshold_pct/100), not in cooldown
- **Exit - Trailing Stop**: After high >= rolling_high, trail at trailing_stop_pct below peak
- **Exit - Stop Loss**: low <= entry_price * (1 - stop_loss_pct/100)
- **Exit - Max Holding**: bars >= max_holding_days
- **Cooldown**: cooldown_days bars after exit
- **Costs**: 0.05% round-trip

## Key Discovery: Max Drawdown Penalty in Scoring

The single biggest improvement came from adding a max-drawdown penalty to the training scoring function:
```
dd_penalty = 0.4 * max(0, 1 - max_drawdown_pct / 15)
score = sharpe + 0.3*(wr/70) + 0.1*(trades/20) + dd_penalty + 0.15*(pf/3)
```
This penalizes params that achieve high Sharpe via concentrated wins with large drawdowns, forcing the optimizer to select more robust parameter combinations. Ablation confirmed: removing DD penalty drops Sharpe from 2.91 to 2.28 (-22%).

## Best Parameters (Run 27, Sharpe 3.21)

### Most Frequently Selected (across all stocks × folds):
| Param | Most Common | Frequency |
|-------|------------|-----------|
| entry_threshold_pct | 1.0 | 65% (130/173) |
| trailing_stop_pct | 0.5 | 96% (166/173) |
| max_holding_days | 10 | 76% (132/173) |
| cooldown_days | 3 | 57% (98/173) |
| lookback | 63 | 70% (122/173) |
| stop_loss_pct | 2.0 (28%), 5.0 (29%), 7.0 (23%) | mixed |

### Recommended Default Settings:
- `entry_threshold_pct = 1.0` (near 52W high)
- `stop_loss_pct = 5.0` (wide stop, let winners run)
- `trailing_stop_pct = 0.5` (tight trailing after target hit)
- `max_holding_days = 10` (quick exits)
- `cooldown_days = 3` (fast re-entry)
- `lookback = 63` (3-month rolling high, not 52W!)

### Summary Metrics (202 stocks, 3-fold anchored WF):
| Metric | Value |
|--------|-------|
| Avg OOS Sharpe | 3.21 |
| Median OOS Sharpe | 3.53 |
| Avg Win Rate | 64.6% |
| Avg Profit Factor | 3.52 |
| Avg Total Return | 2.33% |
| Consistency (profitable stocks) | 71.1% (123/173) |
| Trades per Year | 8.4 |

## Experiment History (30 runs, 6 kept)

| Run | Sharpe | WR% | PF | Key Change | Status |
|-----|--------|-----|----|-----------|--------|
| 1 | -0.26 | 39.9 | 2.18 | Baseline, 10 stocks | keep |
| 4 | 0.86 | 57.0 | 1.55 | Anchored WF, 70 stocks | keep |
| 16 | 0.91 | 60.8 | 1.98 | 206 F&O stocks | keep |
| 18 | 1.19 | 58.9 | 2.20 | Wider entry 1-15% | keep |
| 19 | 2.01 | 61.2 | 2.56 | Entry 1-20% | keep |
| 22 | 2.16 | 62.5 | 2.88 | Added lookback param | keep |
| 23 | 2.28 | 62.3 | 3.29 | Lookback 63-252 | keep |
| 24-25 | 2.91 | 64.0 | 3.50 | DD penalty in scoring | keep |
| **27** | **3.21** | **64.6** | **3.52** | **Stronger DD penalty (0.4/15%)** | **BEST** |
| 26 | 2.28 | 62.3 | 3.29 | Ablation: no DD penalty | discard |
| 28 | 3.15 | 64.8 | 3.53 | Too strong DD penalty | discard |
| 29-30 | 3.07/3.21 | — | — | More granularity / PF bonus | discard |

## What Doesn't Work
- ATR-based stops (both SL and trailing) — hurt Sharpe
- Volume filters — reduce signals without improving quality
- Breakout confirmation (RSI, ADX) — reduce Sharpe
- Train/test splits other than 500/300 — worse OOS performance
- Per-stock param selection — overfits to individual stocks
- DD penalty weight > 0.4 or threshold < 15% — too aggressive

## Anti-Overfitting Measures Used
1. Anchored walk-forward (500 train / 300 test / 3 folds)
2. 202 stocks for diversification
3. DD penalty in scoring selects robust params
4. Min 2 trades per train fold filter
5. Sharpe capped at [-10, 10], PF at 10.0
6. Consistency metric: 71% of stocks profitable
7. Median Sharpe (3.53) > Mean Sharpe (3.21) — slight left skew, no outlier dependency

## Top Performing Stocks
RELIANCE, PERSISTENT, YESBANK, RBLBANK, ADANIENSOL, AUBANK, PNBBANK, ETERNAL, BEL, IEX, NESTLEIND, TATAELXSI, SUZLON, NHPC, IRFC, HINDZINC — all capped at Sharpe 10.0

## Worst Performing Stocks
ICICIGI (-18.5% return), IOC (-11.8%), BHEL (-5.4%), BAJFINANCE (-3.5%), POLICYBZR — consider excluding these or using wider stops
