# Bullish & Bearish Stock Screener - Summary

## What Was Created

I've created a comprehensive stock screener specifically designed to identify bullish and bearish stocks for potential upcoming moves:

### Main Script
- **`bull_bear_screener.py`** - A 600+ line advanced stock screener with technical analysis

### Documentation
- **`README_BULL_BEAR.md`** - Detailed documentation on installation and usage

## Key Features

### 1. **Advanced Technical Analysis**
- **RSI Analysis** - Identifies healthy momentum ranges (45-70 for bullish, <35 or >80 for bearish)
- **MACD Crossover Detection** - Bullish/bearish signal crossovers
- **Moving Average Analysis** - EMA/SMA alignment and trend detection
- **Bollinger Band Signals** - Overbought/oversold conditions and potential reversals
- **Volume Confirmation** - Relative volume analysis for signal validation

### 2. **Multi-Dimensional Screening**
- **Bullish Stock Identification** - Stocks showing positive technical signals
- **Bearish Stock Identification** - Stocks showing negative technical signals
- **Consensus Stock Detection** - Stocks with very strong directional signals from multiple indicators
- **Momentum Analysis** - Volume, price action, and performance metrics
- **Risk Assessment** - Technical score calculations for signal strength

### 3. **Beautiful Visualization**
- **Color-Coded Tables** - Green for bullish, red for bearish signals
- **Rich Terminal Interface** - Professional-looking output with emojis and formatting
- **Progress Tracking** - Visual indicators during analysis
- **Sorted Results** - Ranked by signal strength and confidence

### 4. **Flexible Usage Options**
```bash
# Complete analysis
python bull_bear_screener.py

# Individual screens
python bull_bear_screener.py --bullish
python bull_bear_screener.py --bearish  
python bull_bear_screener.py --consensus

# Customized parameters
python bull_bear_screener.py --bullish --limit 50 --save
python bull_bear_screener.py --market india --save
```

### 5. **Data Export Capabilities**
- **CSV Export** - Save results to CSV files for further analysis
- **Timestamped Files** - Organized file naming for historical tracking
- **Separate Datasets** - Bullish, bearish, and consensus stocks in separate files

## Technical Implementation

### Algorithm Approach
1. **Data Collection** - Fetch stock data with fundamental and technical metrics
2. **Indicator Analysis** - Calculate RSI, MACD, Moving Averages, Bollinger Bands
3. **Signal Scoring** - Assign scores based on bullish/bearish technical conditions
4. **Pattern Recognition** - Identify convergence of multiple bullish/bearish signals
5. **Ranking System** - Sort stocks by signal strength and confidence
6. **Result Presentation** - Display in beautiful formatted tables

### Signal Detection Logic

#### Bullish Signals:
- RSI between 50-65 (strong bullish) or 45-70 (moderate bullish)
- MACD above signal line with positive momentum
- Price above key moving averages with upward trend
- Above-average volume confirmation
- Positive price action with strong momentum
- Near lower Bollinger Band (potential bounce)

#### Bearish Signals:
- RSI < 30 (extremely oversold) or > 75 (overbought failure)
- MACD below signal line with negative momentum
- Price below key moving averages with downward trend
- Above-average volume confirmation
- Negative price action with strong momentum
- Near upper Bollinger Band (potential breakdown)

#### Consensus Signals:
- Very high technical scores (>4) from multiple indicators
- High relative volume (>2.0x average)
- Significant daily moves (>2%)
- Strong weekly performance (>5%)
- Multiple technical factors aligning

## Output Format

### Bullish Stocks Table 🐂
- **Symbol** - Stock ticker
- **Price** - Current price
- **Change** - Daily % change (color-coded)
- **RSI** - Momentum indicator
- **Volume** - Relative volume (x average)
- **Weekly** - Weekly performance
- **Score** - Bullish strength score

### Bearish Stocks Table 🐻
- **Symbol** - Stock ticker
- **Price** - Current price
- **Change** - Daily % change (color-coded)
- **RSI** - Momentum indicator
- **Volume** - Relative volume (x average)
- **Weekly** - Weekly performance
- **Score** - Bearish strength score

### Consensus Stocks Table 🎯
- **Symbol** - Stock ticker
- **Price** - Current price
- **Change** - Daily % change (color-coded)
- **Signal** - 🟢 BULLISH or 🔴 BEARISH
- **Volume** - Relative volume (x average)
- **Strength** - Consensus strength score

## Files Created

1. `/bull_bear_screener.py` - Main analysis script (600+ lines)
2. `/README_BULL_BEAR.md` - Comprehensive documentation
3. `/bull_bear_analysis/` - Directory for saved CSV exports (created automatically)

## Requirements

- Python 3.7+
- tradingview-screener
- rich
- pandas
- numpy
- talib (optional)

## Installation

```bash
pip install tradingview-screener rich pandas numpy

# Optional for advanced technical analysis
# pip install TA-Lib
```

## Note

This tool is exclusively for research purposes. It does not:
- Execute trades
- Provide trading advice
- Connect to brokers
- Send trading alerts
- Guarantee future performance

All identified stocks should be researched further before making any investment decisions.