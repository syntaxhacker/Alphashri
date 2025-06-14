# BarUpDn Strategy Extreme Backtester

A comprehensive 1-minute timeframe backtesting system for the BarUpDn trading strategy, directly translated from Pine Script to Python.

## 🚀 Strategy Overview

The BarUpDn strategy is a simple yet effective pattern-based trading approach:

**Long Entry Conditions:**
- `close > open` AND `open > close[1]` (Current bar is green AND opened above previous close)

**Short Entry Conditions:**
- `close < open` AND `open < close[1]` (Current bar is red AND opened below previous close)

**Risk Management:**
- Stop Loss: 3.5% (configurable)
- Trailing Stop: 40 points (configurable)
- Position Size: 10% of equity per trade
- Max Intraday Loss: 2% of equity per day

## 📁 Files Created

```
bar_updn_extreme_backtest.py    # Main backtesting engine
run_bar_updn_example.py         # Usage examples
bar_updn_requirements.txt       # Dependencies
BAR_UPDN_README.md             # This documentation
```

## 🛠 Installation

1. Install required dependencies:
```bash
pip install -r bar_updn_requirements.txt
```

2. For Binance API access (optional but recommended):
   - Create account at [Binance](https://binance.com)
   - Generate API keys (read-only permissions sufficient)
   - Set environment variables:
```bash
export BINANCE_API_KEY="your_api_key"
export BINANCE_API_SECRET="your_api_secret"
```

## 🎯 Quick Start

### Basic Usage (No API Keys Required)

```python
from bar_updn_extreme_backtest import run_extreme_backtest

# Test BTC for last 7 days using yfinance
result = run_extreme_backtest(
    symbol="BTCUSDT",
    days_back=7,
    save_results_flag=True
)
```

### Command Line Usage

```bash
# Basic backtest
python bar_updn_extreme_backtest.py --symbol BTCUSDT --days 7

# Test multiple symbols
python bar_updn_extreme_backtest.py --symbol ALL --days 14

# With Binance API
python bar_updn_extreme_backtest.py --symbol ETHUSDT --days 30 --api-key d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3 --api-secret 7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c

#  2703  export BINANCE_API_KEY=d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3 && export BINANCE_API_SECRET=7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c && python binance_paper_trader.py --balance 100 --symbol BTCUSDT --live --strategy trend_following
```

### Run Examples

```bash
python run_bar_updn_example.py
```

## 📊 Features

### Advanced Backtesting Engine
- **1-minute precision**: Full 1-minute bar-by-bar simulation
- **Realistic execution**: Accounts for slippage and market conditions
- **Risk management**: Stop loss, trailing stops, daily loss limits
- **Position sizing**: Percentage-based position sizing
- **Comprehensive reporting**: Detailed trade analysis and metrics

### Data Sources
- **Binance API**: For extensive historical data (recommended)
- **Yahoo Finance**: Fallback for recent data (no API keys needed)
- **Auto-detection**: Automatically uses best available source

### Strategy Customization
```python
from bar_updn_extreme_backtest import BarUpDnStrategy, BarUpDnBacktester

# Custom parameters
strategy = BarUpDnStrategy(
    sl_percent=2.0,                    # Tighter stop loss
    trailing_stop_points=30.0,         # Closer trailing stop  
    position_size_percent=15.0,        # Larger position size
    max_intraday_loss_percent=1.5      # Stricter daily loss limit
)

backtester = BarUpDnBacktester(initial_capital=10000)
backtester.strategy = strategy
```

### Results and Analytics

**Comprehensive Metrics:**
- Total return and percentage
- Win rate and trade statistics  
- Average win/loss amounts
- Maximum drawdown
- Sharpe ratio
- Detailed trade-by-trade breakdown

**Output Files:**
- `bar_updn_trades_{symbol}_{timestamp}.csv` - Individual trade records
- `bar_updn_equity_{symbol}_{timestamp}.csv` - Equity curve data
- `bar_updn_summary_{symbol}_{timestamp}.json` - Performance summary

## 📈 Strategy Logic (Pine Script Translation)

### Original Pine Script
```pinescript
// Entry Conditions
longCondition  = inDateRange and (close > open and open > close[1])
shortCondition = inDateRange and (close < open and open < close[1])

// Risk Management  
strategy.risk.max_intraday_loss(maxIdLossPcnt, strategy.percent_of_equity)
strategy.exit("Exit Long", from_entry="BarUp", stop=close * (1 - slPcnt / 100), trail_points=trailStopPts)
```

### Python Implementation
```python
# Entry signals
df['long_condition'] = (df['close'] > df['open']) & (df['open'] > df['close'].shift(1))
df['short_condition'] = (df['close'] < df['open']) & (df['open'] < df['close'].shift(1))

# Risk management
intraday_loss_percent = ((daily_start_capital - capital) / daily_start_capital) * 100
if intraday_loss_percent > self.strategy.max_intraday_loss_percent:
    # Stop trading for the day

# Dynamic stop loss and trailing stops
if position.side == 'LONG':
    stop_loss = entry_price * (1 - self.strategy.sl_percent / 100)
    if current_price > entry_price:
        trailing_stop = current_price - self.strategy.trailing_stop_points
```

## 🎛 Configuration Options

### Strategy Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `sl_percent` | 3.5 | Stop loss percentage |
| `trailing_stop_points` | 40.0 | Trailing stop distance in points |
| `position_size_percent` | 10.0 | Position size as % of equity |
| `max_intraday_loss_percent` | 2.0 | Daily loss limit as % of equity |

### Backtester Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `initial_capital` | 5000 | Starting capital in USD |
| `symbol` | "BTCUSDT" | Trading pair |
| `days_back` | 30 | Historical data period |

## 📊 Sample Output

```
┌─────────────────────────────────────────────────────────────┐
│                BarUpDn Strategy Results - BTCUSDT          │
├─────────────────────┬───────────────────────────────────────┤
│ Symbol              │ BTCUSDT                               │
│ Timeframe           │ 1m                                    │
│ Period              │ 2024-01-01 to 2024-01-07             │
│ Initial Capital     │ $5,000.00                             │
│ Final Capital       │ $5,247.30                             │
│ Total Return        │ $247.30                               │
│ Total Return %      │ 4.95%                                 │
│                     │                                       │
│ Total Trades        │ 23                                    │
│ Winning Trades      │ 14                                    │
│ Losing Trades       │ 9                                     │
│ Win Rate            │ 60.9%                                 │
│ Average Win         │ $35.20                                │
│ Average Loss        │ -$18.90                               │
│                     │                                       │
│ Max Drawdown        │ 2.1%                                  │
│ Sharpe Ratio        │ 1.34                                  │
└─────────────────────┴───────────────────────────────────────┘
```

## 🔧 Advanced Usage

### Multi-Symbol Comparison
```python
symbols = ["BTCUSDT", "ETHUSDT", "ADAUSDT"]
results = {}

for symbol in symbols:
    result = run_extreme_backtest(symbol=symbol, days_back=14)
    if result:
        results[symbol] = result

# Find best performer
best = max(results.keys(), key=lambda x: results[x].total_return_percent)
print(f"Best performer: {best} with {results[best].total_return_percent:.2f}% return")
```

### Parameter Optimization
```python
# Test different stop loss levels
for sl in [2.0, 3.5, 5.0]:
    strategy = BarUpDnStrategy(sl_percent=sl)
    backtester = BarUpDnBacktester()
    backtester.strategy = strategy
    result = backtester.run_backtest(df, "BTCUSDT")
    print(f"SL {sl}%: {result.total_return_percent:.2f}% return")
```

## ⚠️ Important Notes

1. **Realistic Expectations**: Past performance doesn't guarantee future results
2. **1-minute Data Limitations**: Yahoo Finance has limited historical 1-minute data
3. **API Rate Limits**: Binance API has rate limits; use appropriate delays
4. **Point Values**: Trailing stop "points" are in price units (e.g., $40 for BTC)
5. **Time Zones**: All timestamps are in UTC

## 🤝 Contributing

This backtester leverages your existing trading infrastructure while implementing the exact BarUpDn strategy logic. You can extend it by:

- Adding more sophisticated entry/exit rules
- Implementing additional risk management features
- Adding more data sources
- Creating visualization tools
- Optimizing performance for larger datasets

## 📄 License

Use responsibly for educational and research purposes. Trading involves risk of loss.

---

**Happy Backtesting! 🚀**

For questions or improvements, check the existing codebase patterns in your `backtester.py` and `strategies.py` files which this implementation follows. 