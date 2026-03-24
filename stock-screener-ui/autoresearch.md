# Autoresearch: 52W Target VectorBT Parameter Optimization with Anti-Overfitting

## Objective
Find optimal parameters for the 52-Week Target swing strategy using vectorbt, tested across 10 NSE large-cap stocks. The strategy enters LONG when price is within X% of the rolling 52-week high, exits via trailing stop (after reaching 52W high) or stop-loss or max holding days. Use walk-forward validation and cross-stock stability analysis to prevent overfitting.

## Metrics
- **Primary**: sharpe_ratio (dimensionless, higher is better) — measured as average out-of-sample Sharpe across walk-forward windows and stocks
- **Secondary**: oos_win_rate (%), oos_profit_factor, oos_total_return (%), param_stability (std of best params across folds), trades_per_year

## How to Run
`./autoresearch.sh` — outputs `METRIC name=number` lines.

## Files in Scope
- `autoresearch.py` — Main vectorbt 52W target backtest + optimization script (NEW)
- `autoresearch.sh` — Benchmark runner script (NEW)
- `autoresearch.md` — This file (experiment context)
- `experiments/worklog.md` — Detailed experiment log

## Off Limits
- `db/` — Database models and migrations
- `api/` — FastAPI route handlers
- `src/` — React frontend
- `config.py` — Central configuration
- `cache/` — Redis caching layer
- `trading/` — Live trading modules
- `tests/` — Test files
- `backtest/` — Existing NautilusTrader backtest code (don't modify)

## Constraints
- Use vectorbt for backtesting (already installed: 0.28.0)
- Fetch data via Upstox v3 API (upstox_client SDK, already installed: 2.17.0)
- No new dependencies beyond what's already pip-installed
- Must use walk-forward validation (train/test splits) to prevent overfitting
- 10 stocks: RELIANCE, TCS, INFY, HDFCBANK, ICICIBANK, SBIN, BAJFINANCE, MARUTI, TATASTEEL, ADANIENT
- Instrument keys from nse_instruments.json in ../upstox_trader/config_and_utils/
- Daily data, ~3 years backtest window (with extra for 52W lookback)

## Strategy Logic (vectorbt translation)
- **52W High**: `df['high'].rolling(252, min_periods=100).max().shift(1)` (exclude current bar, avoid look-ahead)
- **Entry**: close >= 52w_high * (1 - entry_threshold_pct/100) AND not in cooldown
- **Exit - Trailing Stop**: After high >= 52w_high (target reached), trail at trailing_stop_pct below peak
- **Exit - Stop Loss**: close <= entry_price * (1 - stop_loss_pct/100)
- **Exit - Max Holding**: bars since entry >= max_holding_days
- **Cooldown**: After exit, skip cooldown_days bars before next entry
- **Costs**: Indian equity costs ~0.05% round-trip (brokerage + STT + exchange charges)

## Tunable Parameters
| Param | Default | Range | Description |
|-------|---------|-------|-------------|
| entry_threshold_pct | 2.0 | 1.0 - 10.0 | Enter when within X% of 52W high |
| stop_loss_pct | 2.0 | 1.0 - 5.0 | Stop loss % |
| trailing_stop_pct | 0.5 | 0.3 - 3.0 | Trailing stop % after 52W reached |
| max_holding_days | 15 | 5 - 30 | Max bars to hold |
| cooldown_days | 7 | 3 - 20 | Bars to wait after exit |

## Anti-Overfitting Measures
1. **Walk-Forward Validation**: 6-month train, 3-month test, rolling windows
2. **Cross-Stock Consistency**: Best params must work across all 10 stocks
3. **Parameter Stability**: Low std of optimal params across walk-forward folds
4. **Minimum Trade Filter**: Discard param combos with <5 trades in any test window
5. **Monte Carlo Shuffling**: Compare real Sharpe vs shuffled-baseline Sharpe (p-value)
6. **Penalize Complexity**: Simpler param sets preferred at equal performance

## What's Been Tried
(Updated as experiments accumulate)
