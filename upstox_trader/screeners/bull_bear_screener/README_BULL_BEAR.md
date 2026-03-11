# Bullish & Bearish Stock Screener

## Overview
This tool identifies stocks showing bullish or bearish signals for potential upcoming moves based on technical analysis and momentum indicators. It's designed for research purposes to help identify potential trading opportunities.

## Features
- **Bullish Stock Identification** - Stocks with positive technical signals
- **Bearish Stock Identification** - Stocks with negative technical signals  
- **Consensus Stocks** - Stocks with very strong directional signals
- **Technical Analysis** - RSI, MACD, Moving Averages, Bollinger Bands
- **Momentum Analysis** - Volume, Price Action, Performance Metrics
- **Rich Terminal Interface** - Beautifully formatted tables with color coding
- **Export Capabilities** - Save results to CSV files for further analysis

## Requirements
- Python 3.7+
- tradingview-screener
- rich
- pandas
- numpy
- talib (optional, for advanced technical analysis)

## Installation
```bash
pip install tradingview-screener rich pandas numpy

# Optional for advanced technical analysis
# pip install TA-Lib
```

## Usage

### Complete Analysis
```bash
# Run complete bullish/bearish analysis
python bull_bear_screener.py
```

### Individual Screens
```bash
# Bullish stocks only
python bull_bear_screener.py --bullish

# Bearish stocks only
python bull_bear_screener.py --bearish

# Strong consensus stocks only
python bull_bear_screener.py --consensus
```

### Customized Analysis
```bash
# Save results to CSV files
python bull_bear_screener.py --save

# Limit results to specific number
python bull_bear_screener.py --limit 50

# Indian market analysis
python bull_bear_screener.py --market india

# Combination of options
python bull_bear_screener.py --bullish --save --limit 30 --market america
```

## Technical Analysis Methods

### Bullish Signals Detected
- **RSI Analysis** - RSI between 45-70 (healthy momentum)
- **MACD Crossover** - MACD line above signal line
- **Moving Averages** - Price above key EMAs with upward trend
- **Volume Confirmation** - Above average volume
- **Price Action** - Positive moves with strong momentum
- **Bollinger Bands** - Price near lower band (potential bounce)

### Bearish Signals Detected
- **RSI Analysis** - RSI < 35 (oversold) or > 80 (overbought failure)
- **MACD Crossover** - MACD line below signal line
- **Moving Averages** - Price below key EMAs with downward trend
- **Volume Confirmation** - Above average volume
- **Price Action** - Negative moves with strong momentum
- **Bollinger Bands** - Price near upper band (potential breakdown)

### Consensus Signals
- **Very Strong Technical Scores** - Multiple indicators aligning
- **High Volume Confirmation** - Significant volume activity
- **Significant Price Moves** - Large daily percentage changes
- **Strong Weekly Performance** - Consistent momentum

## Output Format

### Bullish Stocks Table
- **Symbol** - Stock ticker symbol
- **Price** - Current price
- **Change** - Daily percentage change (green/red)
- **RSI** - Relative Strength Index
- **Volume** - Relative volume compared to 10-day average
- **Weekly** - Weekly performance percentage
- **Score** - Bullish strength score

### Bearish Stocks Table
- **Symbol** - Stock ticker symbol
- **Price** - Current price
- **Change** - Daily percentage change (green/red)
- **RSI** - Relative Strength Index
- **Volume** - Relative volume compared to 10-day average
- **Weekly** - Weekly performance percentage
- **Score** - Bearish strength score

### Consensus Stocks Table
- **Symbol** - Stock ticker symbol
- **Price** - Current price
- **Change** - Daily percentage change (green/red)
- **Signal** - 🟢 BULLISH or 🔴 BEARISH consensus
- **Volume** - Relative volume compared to 10-day average
- **Strength** - Consensus strength score

## Data Export
When using the `--save` flag, results are saved to CSV files in the `bull_bear_analysis/` directory:
- `bullish_stocks_[timestamp].csv`
- `bearish_stocks_[timestamp].csv`
- `consensus_stocks_[timestamp].csv`

## Note
This tool is for research purposes only. It does not provide trading advice or execute trades. All financial decisions should be made independently with proper research and risk management.