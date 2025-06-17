# 🚀 Unified Trading Strategy Optimizer

A comprehensive, modular system for testing and optimizing multiple trading strategies simultaneously with advanced Bayesian optimization.

## 📁 Project Structure

```
earner/
├── strategies/               # Trading strategies
│   ├── __init__.py
│   ├── base_strategy.py      # Base class for all strategies
│   ├── bar_updn_strategy.py  # BarUpDn reversal strategy
│   ├── breakout_strategy.py  # Momentum breakout strategy
│   └── ...                   # Future strategies
│
├── optimizers/               # Optimization engines
│   ├── __init__.py
│   ├── unified_optimizer.py  # Multi-strategy optimizer
│   ├── backtest_engine.py    # Unified backtesting engine
│   └── ...                   # Future optimizers
│
├── reports/                  # Generated reports
│   ├── *.html               # Interactive HTML reports
│   └── *.json               # Optimization results
│
├── data/                     # Cached data (auto-generated)
└── main_strategy_optimizer.py # Main entry point
```

## 🎯 Available Strategies

### 1. BarUpDn Enhanced
- **Type**: Reversal Strategy
- **Description**: Pattern-based reversal strategy with volume and trend filters
- **Best For**: Range-bound markets, reversal patterns
- **Parameters**: Stop loss, trailing stop, volume filters, trend filters

### 2. Crypto Breakout
- **Type**: Momentum Strategy  
- **Description**: Momentum-based breakout strategy optimized for crypto markets
- **Best For**: Trending markets, volatility breakouts
- **Parameters**: Lookback periods, volume multiplier, breakout thresholds

## 🚀 Quick Start

### 1. Run Interactive Optimizer

```bash
python main_strategy_optimizer.py
```

The interactive menu will guide you through:
- Strategy selection (single or multiple)
- Symbol selection (BTCUSDT, ETHUSDT, etc.)
- Optimization settings (data period, evaluations)

### 2. Example: Test Both Strategies

```python
from strategies.bar_updn_strategy import BarUpDnStrategy
from strategies.breakout_strategy import BreakoutStrategy
from optimizers.unified_optimizer import UnifiedOptimizer

# Initialize strategies
strategies = [BarUpDnStrategy(), BreakoutStrategy()]

# Initialize optimizer
optimizer = UnifiedOptimizer(
    strategies=strategies,
    symbols=["BTCUSDT", "ETHUSDT"],
    days_back=60,
    api_key="your_api_key",
    api_secret="your_api_secret"
)

# Run optimization
results = optimizer.optimize_all_strategies(n_calls=150)

# Display results and generate reports
optimizer.display_results(results)
html_file = optimizer.run_detailed_backtest(results)
```

## 📊 Features

### ✅ Multi-Strategy Support
- Test multiple strategies simultaneously
- Compare performance side-by-side
- Find the best strategy for your needs

### ✅ Advanced Optimization
- Bayesian optimization with Gaussian Processes
- 10-100x faster than grid search
- Intelligent parameter space exploration

### ✅ Comprehensive Backtesting
- Unified backtesting engine for all strategies
- Risk management (stop loss, take profit, trailing stops)
- Intraday loss limits and position sizing

### ✅ Rich Reporting
- Interactive HTML reports with charts
- JSON exports for further analysis
- Strategy comparison tables
- Performance insights and recommendations

### ✅ Modular Architecture
- Easy to add new strategies
- Consistent interface across all strategies
- Reusable optimization and backtesting components

## 🔧 Adding New Strategies

### 1. Create Strategy Class

```python
# strategies/my_strategy.py
from .base_strategy import BaseStrategy
from skopt.space import Real, Integer

class MyStrategy(BaseStrategy):
    def __init__(self, **kwargs):
        defaults = {
            'param1': 10,
            'param2': 0.5
        }
        defaults.update(kwargs)
        super().__init__("My Strategy", **defaults)
    
    def generate_signals(self, df):
        # Implement your signal logic
        df['signal'] = 'HOLD'
        # ... your logic here ...
        return df
    
    def get_parameter_space(self):
        return {
            'param1': Integer(5, 20, name='param1'),
            'param2': Real(0.1, 1.0, name='param2')
        }
```

### 2. Register Strategy

Add to `strategies/__init__.py`:
```python
from .my_strategy import MyStrategy
__all__ = [..., 'MyStrategy']
```

### 3. Add to Main Script

Update `main_strategy_optimizer.py` to include your strategy in the menu.

## 📈 Performance Insights

The optimizer provides detailed insights:

- **Win Rate**: Percentage of profitable trades
- **Return %**: Total return percentage
- **Max Drawdown**: Maximum portfolio decline
- **Profit Factor**: Ratio of wins to losses
- **Sharpe Ratio**: Risk-adjusted returns
- **Optimization Score**: Composite performance metric

## 🎛️ Configuration Options

### Optimization Settings
- **Timeframe**: 15-minute bars (optimal for strategy performance)
- **Evaluations**: More evaluations = better optimization (default: 150)
- **Data Period**: Historical data range (default: 60 days)
- **Symbols**: Crypto pairs to test (default: BTCUSDT, ETHUSDT)

### Risk Management
- **Position Size**: Percentage of capital per trade
- **Stop Loss**: Maximum loss per trade
- **Take Profit**: Target profit per trade  
- **Trailing Stop**: Dynamic profit protection
- **Daily Loss Limit**: Maximum intraday loss

## 🔍 Understanding Results

### Strategy Comparison Table
Shows side-by-side performance metrics for easy comparison.

### Optimization Score
Composite metric weighing:
- Win Rate (45%)
- Returns (20%) 
- Drawdown Control (15%)
- Profit Factor (8%)
- Sharpe Ratio (7%)
- Bonuses for consistency and trade volume

### HTML Reports
Interactive charts showing:
- Equity curves
- Trade distribution
- Parameter sensitivity
- Performance over time

## 🛠️ Dependencies

```bash
pip install pandas numpy scikit-optimize rich binance-python yfinance
```

## 📝 Future Enhancements

- [ ] More built-in strategies (RSI, MACD, Mean Reversion)
- [ ] Portfolio optimization across multiple strategies  
- [ ] Walk-forward analysis
- [ ] Paper trading integration
- [ ] Real-time strategy monitoring
- [ ] Machine learning strategy templates

## 🤝 Contributing

1. Fork the repository
2. Create a new strategy in `strategies/`
3. Follow the `BaseStrategy` interface
4. Add tests and documentation
5. Submit a pull request

## 📄 License

MIT License - feel free to use and modify for your trading needs.

---

**⚠️ Disclaimer**: This software is for educational and research purposes. Trading involves risk. Always test strategies thoroughly before using real money. 