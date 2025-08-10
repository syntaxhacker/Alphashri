# Comprehensive Trade Analyzer - Usage Guide

## Overview
This script analyzes your trading log files to identify exact reasons why trades failed, using comprehensive technical analysis and market conditions.

## Features
- **Technical Indicators**: RSI, MACD, Bollinger Bands, Moving Averages, ATR
- **Trend Analysis**: Short, medium, and long-term trends
- **Market Structure**: Support/Resistance levels, Pivot points
- **Volume Analysis**: Volume ratios and OBV
- **Failure Categorization**: Exact reasons for losses
- **Actionable Recommendations**: Specific improvements for future trades

## Requirements
```bash
pip install pandas numpy requests talib rich
```

## Usage

### Basic Analysis (All Trades)
```bash
# Using config.py credentials (recommended)
python comprehensive_trade_analyzer.py \
    --log-file "screeners/logs/old_tv_screener_old_screener_05aug.log"

# Or provide credentials directly
python comprehensive_trade_analyzer.py \
    --log-file "screeners/logs/old_tv_screener_old_screener_05aug.log" \
    --api-key "YOUR_API_KEY" \
    --api-secret "YOUR_API_SECRET"
```

### Analyze Only Losing Trades
```bash
python comprehensive_trade_analyzer.py \
    --log-file "screeners/logs/old_tv_screener_old_screener_05aug.log" \
    --losing-only
```

## Sample Output

### Summary Statistics
```
📊 Trade Analysis Summary
┌─────────────────┬─────────┐
│ Metric          │ Value   │
├─────────────────┼─────────┤
│ Total Trades    │ 6       │
│ Winning Trades  │ 4       │
│ Losing Trades   │ 2       │
│ Win Rate        │ 66.7%   │
└─────────────────┴─────────┘
```

### Failure Reasons Analysis
```
❌ Common Failure Reasons
┌────────────────────────────────┬───────┬─────────────┐
│ Failure Reason                 │ Count │ % of Losses │
├────────────────────────────────┼───────┼─────────────┤
│ RESISTANCE_ENTRY               │ 2     │ 100.0%      │
│ OVERBOUGHT_ENTRY - RSI > 80    │ 1     │ 50.0%       │
│ POOR_ENTRY_TIMING              │ 1     │ 50.0%       │
└────────────────────────────────┴───────┴─────────────┘
```

### Detailed Trade Analysis
```
🔍 Trade #1: NEWGEN
Entry: ₹958.25 → Exit: ₹953.60
P&L: -0.53% (₹-102)
RSI at Entry: 82.3
Trends: Short=bullish, Medium=neutral

Failure Reasons:
  • OVERBOUGHT_ENTRY - RSI > 80 at entry
  • RESISTANCE_ENTRY - Entered near resistance level
  • POOR_ENTRY_TIMING - Suboptimal entry conditions

Recommendations:
  → Wait for RSI to drop below 70 before entering long positions
  → Avoid entries near resistance levels, wait for breakout confirmation
  → Improve entry timing using confluence of multiple indicators
```

## Failure Categories

### Entry-Related Failures
- **OVERBOUGHT_ENTRY**: RSI > 80 at entry
- **OVERSOLD_ENTRY**: RSI < 20 at entry  
- **RESISTANCE_ENTRY**: Entered near resistance level
- **BB_OVEREXTENDED**: Entry above/below Bollinger Bands
- **LOW_VOLUME**: Poor volume support at entry
- **COUNTER_TREND**: Trading against multiple trend directions
- **POOR_ENTRY_TIMING**: Suboptimal confluence of indicators

### Exit-Related Failures
- **STOP_LOSS_HIT**: Trade hit stop loss
- **TRAILING_STOP**: Profit given back to trailing stop
- **LARGE_LOSS**: Loss > 2%
- **MODERATE_LOSS**: Loss 0.5-2%

## Configuration

### Setup Upstox Credentials

#### Option 1: Using config.py (Recommended)
1. Create `config.py` from `config_template.py`
2. Add your Upstox API credentials:
```python
UPSTOX_CONFIG = {
    'api_key': 'your_api_key_here',
    'api_secret': 'your_api_secret_here'
}
```
3. The script will automatically handle authentication

#### Option 2: Command Line Arguments
Provide credentials directly:
```bash
--api-key "your_api_key" --api-secret "your_api_secret"
```

### Log File Format
The script expects log files in this format:
```
TIMESTAMP | ACTION | SYMBOL | PRICE | QTY | AMOUNT | ALERT_TYPE | P&L
2025-08-05 15:19:25 | ENTRY | NSE:NEWGEN | ₹958.25 | 20 | ₹19,165 | PRICE_MOVE|trend:neutral
2025-08-05 15:21:33 | EXIT | NSE:NEWGEN | ₹953.60 | 20 | ₹19,072 | STOP LOSS: -0.53% | P&L: -0.53% (₹-102)
```

## Technical Analysis Details

### Indicators Calculated
- **Moving Averages**: SMA(5,20,50), EMA(9,21)
- **Bollinger Bands**: Upper, Middle, Lower
- **Momentum**: RSI(14), MACD, Stochastic
- **Volatility**: ATR(14)
- **Volume**: Volume SMA, Volume Ratio, OBV
- **Support/Resistance**: Pivot points, R1, S1

### Trend Classification
- **Strong Bullish**: Fast MA > Slow MA and rising
- **Bullish**: Fast MA > Slow MA but flat/falling
- **Strong Bearish**: Fast MA < Slow MA and falling  
- **Bearish**: Fast MA < Slow MA but flat/rising
- **Neutral**: Sideways/unclear trend

### Entry Quality Assessment
Scored based on:
- RSI in reasonable range (30-70)
- Volume above average (>1.2x)
- Price not overextended (BB middle bands)
- Trend alignment across timeframes

## API Limitations

### Upstox V3 Historical Data
- **1H Data**: Limited to 90 days maximum
- **15min Data**: Recommended for detailed analysis
- **Daily Data**: Best for long-term trend analysis
- **Rate Limits**: Respect API rate limits

### Recommendations
- Use 15min timeframe for most analysis
- Implement caching for repeated symbols
- Handle API errors gracefully
- Consider data chunking for large periods

## Troubleshooting

### Common Issues
1. **No data available**: Check symbol format and instrument key mapping
2. **API rate limits**: Add delays between requests
3. **Invalid timestamps**: Ensure log timestamps are parseable
4. **Missing indicators**: Requires minimum 20 candles for calculation

### Debug Mode
Add debug prints by modifying the script:
```python
console.print(f"[dim]Debug: Fetching {symbol} from {start_date} to {end_date}[/dim]")
```

## Integration

### With Existing Trading System
```python
from comprehensive_trade_analyzer import TradeAnalyzer

analyzer = TradeAnalyzer(access_token="your_token")
analysis = analyzer.analyze_trade(trade_dict)
failure_reasons = analysis['failure_reasons']
recommendations = analysis['recommendations']
```

### Automated Analysis
Set up cron job to analyze daily logs:
```bash
#!/bin/bash
cd /path/to/upstox_trader
python comprehensive_trade_analyzer.py \
    --log-file "screeners/logs/old_tv_screener_old_screener_$(date +%d%b).log" \
    --access-token "$UPSTOX_TOKEN" \
    --losing-only > analysis_$(date +%Y%m%d).txt
```