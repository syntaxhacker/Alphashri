# Nifty Intraday Trading Bot

A backtesting framework for intraday trading strategies on Nifty 50.

## Project Structure

```
nifty_intraday_bot/
├── data/                 # Data storage
│   └── cache/            # Cached data files
├── strategies/           # Trading strategies
├── backtests/            # Backtest results
├── utils/                # Utility functions
│   └── data_fetcher.py   # Data fetching module
├── results/              # Results and visualizations
└── fetch_data.py         # Data fetching script
```

## Setup

1. Install the required dependencies:

```bash
pip install pandas numpy matplotlib yfinance
```

2. Make sure you have the `data_cache.py` file in your project root directory.

## Fetching Data

To fetch 3 months of intraday data for Nifty 50:

```bash
python nifty_intraday_bot/fetch_data.py --visualize
```

This will:
- Download 3 months of intraday data at multiple timeframes (5m, 15m, 30m, 1h)
- Cache the data for future use
- Create visualizations if `--visualize` flag is provided
- Save processed data to CSV files

### Options

```
--symbol SYMBOL         Symbol to fetch data for (default: ^NSEI for Nifty 50)
--intervals INTERVALS   Data intervals to fetch (default: 5m 15m 30m 1h)
--period PERIOD         Period to fetch (default: 3mo)
--cache-dir CACHE_DIR   Directory to cache data
--visualize             Generate visualizations of the data
--output-dir OUTPUT_DIR Directory to save processed data
```

For example, to fetch data for a specific symbol and timeframe:

```bash
python nifty_intraday_bot/fetch_data.py --symbol RELIANCE.NS --intervals 5m 15m --period 1mo
```

## Data Processing

The fetcher automatically adds the following technical indicators:
- Simple Moving Averages (5, 10, 20, 50, 200)
- Exponential Moving Averages (5, 10, 20, 50, 200)
- Bollinger Bands (20-period with 2 standard deviations)
- RSI (14-period)
- MACD (12, 26, 9)
- Volatility and returns calculations

## Next Steps

1. Implement trading strategies in the `strategies/` directory
2. Create a backtesting engine to evaluate strategy performance
3. Add position sizing and risk management rules
4. Build a visualization dashboard for strategy results 