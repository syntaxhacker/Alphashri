# 📊 INTRADAY WATCH MODE - Complete Guide

## 🎯 Overview
The new **Intraday Watch Mode** provides real-time monitoring of market movements, perfect for morning trading sessions. It continuously scans for volume spikes and price changes, alerting you to potential trading opportunities.

## 🚀 Key Features

### 1. **Real-Time Monitoring**
- Continuous market scanning every 5-60 seconds
- Live price and volume updates
- Auto-refresh with configurable intervals

### 2. **Smart Alerts**
- 🔥 **Volume Spike Alerts**: Detects unusual volume activity
- 📈 **Price Movement Alerts**: Identifies significant price changes
- 🚨 **Visual Indicators**: Color-coded alerts in the display

### 3. **Customizable Settings**
- **Refresh Interval**: 5-60 seconds (default: 30s)
- **Volume Threshold**: 1.5x - 5x normal volume (default: 2x)
- **Price Threshold**: 1% - 10% change (default: 3%)

## 📋 Command Line Usage

### Basic Usage
```bash
# Start with default settings (30s refresh, 2x volume, 3% price)
python tv_screen_usage.py --watch

# Quick settings for active trading
python tv_screen_usage.py --watch --refresh 15 --volume-threshold 1.5 --price-threshold 2.0

# Conservative settings for monitoring
python tv_screen_usage.py --watch --refresh 60 --volume-threshold 3.0 --price-threshold 5.0
```

### Advanced Usage
```bash
# Ultra-fast monitoring (use with caution - may hit rate limits)
python tv_screen_usage.py --watch --refresh 5 --volume-threshold 1.2 --price-threshold 1.5

# Morning session monitoring
python tv_screen_usage.py --watch --refresh 20 --volume-threshold 2.5 --price-threshold 2.5

# Alternative syntax using examples
python tv_screen_usage.py --example intraday_watch --refresh 10
```

## 🎨 Display Features

### Live Market Table
- **Ticker**: Stock symbol with alert highlighting
- **Name**: Company name (truncated)
- **Price**: Current price in ₹
- **Change %**: Price change with color coding (green/red)
- **Volume**: Current trading volume
- **Vol Ratio**: Volume vs 10-day average with color coding:
  - White: Normal volume
  - Red: 2x+ volume
  - Bold Red: 3x+ volume
- **RSI**: Relative Strength Index with color coding:
  - Green: RSI < 30 (oversold)
  - Red: RSI > 70 (overbought)
  - White: Normal range
- **Alert**: 🚨 symbol for stocks with active alerts

### Alert Types
1. **🔥 VOLUME SPIKE**: When volume exceeds threshold and increases significantly
2. **🚀 PRICE MOVE**: When price change exceeds threshold and accelerates

## 📊 Trading Applications

### 1. **Morning Pre-Market Setup (9:00-9:15 AM)**
```bash
python tv_screen_usage.py --watch --refresh 10 --volume-threshold 2.0 --price-threshold 2.0
```
- Monitor for gap-up/gap-down stocks
- Identify pre-market movers
- Track volume buildup before market open

### 2. **Market Open Monitoring (9:15-10:00 AM)**
```bash
python tv_screen_usage.py --watch --refresh 15 --volume-threshold 1.5 --price-threshold 1.5
```
- Catch opening range breakouts
- Monitor volume spikes on news
- Track momentum continuation

### 3. **Mid-Day Consolidation (11:00-2:00 PM)**
```bash
python tv_screen_usage.py --watch --refresh 30 --volume-threshold 2.5 --price-threshold 3.0
```
- Look for breakout setups
- Monitor for news-driven moves
- Track accumulation patterns

### 4. **Power Hour (2:00-3:30 PM)**
```bash
python tv_screen_usage.py --watch --refresh 15 --volume-threshold 2.0 --price-threshold 2.0
```
- Monitor end-of-day moves
- Track institutional activity
- Identify closing strength/weakness

## 🛠️ Configuration Tips

### For Active Day Trading
- **Refresh**: 10-15 seconds
- **Volume Threshold**: 1.5-2.0x
- **Price Threshold**: 1.5-2.5%

### For Swing Trading Setup
- **Refresh**: 30-60 seconds
- **Volume Threshold**: 2.0-3.0x
- **Price Threshold**: 3.0-5.0%

### For Conservative Monitoring
- **Refresh**: 60+ seconds
- **Volume Threshold**: 3.0-5.0x
- **Price Threshold**: 5.0-10.0%

## 🔄 Operational Tips

### Best Practices
1. **Start Early**: Begin monitoring 30 minutes before market open
2. **Monitor News**: Check for corporate announcements when alerts trigger
3. **Use Multiple Screens**: Run watch mode on dedicated monitor
4. **Track Patterns**: Note recurring volume patterns for specific stocks
5. **Stay Disciplined**: Don't chase every alert - wait for setup confirmation

### Alert Response Strategy
1. **Volume Spike**: Check news, verify breakout pattern, analyze support/resistance
2. **Price Move**: Confirm trend direction, check RSI for overbought/oversold
3. **Combined Alert**: High-priority signal - investigate immediately

### Performance Optimization
- **Stable Internet**: Ensure reliable connection for real-time data
- **Browser Login**: Keep TradingView logged in for live data
- **Resource Management**: Don't run too many processes simultaneously

## 🚨 Important Notes

### Rate Limiting
- TradingView may throttle requests with very low refresh intervals
- Recommended minimum: 10 seconds for active trading
- Use 30+ seconds for extended monitoring

### Data Accuracy
- Real-time data requires TradingView login
- Delayed data (15-20 minutes) used without login
- Always verify critical moves with your broker

### Market Hours
- Most effective during market hours (9:15 AM - 3:30 PM IST)
- Pre-market and after-hours data may be limited
- Weekend/holiday monitoring will show stale data

## 📈 Example Trading Workflow

### Morning Routine
1. **9:00 AM**: Start watch mode with 15-second refresh
2. **9:15 AM**: Note gap-up/gap-down stocks from overnight
3. **9:30 AM**: Monitor volume confirmation on gappers
4. **9:45 AM**: Switch to 30-second refresh for sustained monitoring
5. **Throughout day**: Respond to alerts based on setup quality

### Alert Response
1. **Alert Triggered**: Note ticker and alert type
2. **Quick Analysis**: Check chart, news, volume pattern
3. **Entry Decision**: Confirm setup meets trading criteria
4. **Position Management**: Set stops, targets based on pattern
5. **Monitor**: Keep watching for continuation or reversal

## 💡 Pro Tips

1. **Custom Watchlists**: Focus on specific sectors or market cap ranges
2. **Multiple Timeframes**: Use different refresh rates for different strategies
3. **News Integration**: Keep news feed open for alert context
4. **Pattern Recognition**: Learn to identify recurring volume patterns
5. **Risk Management**: Never risk more than planned based on alerts alone

## 🎓 Learning Resources

### Understanding Volume
- Volume ratio >2x = Significant interest
- Volume ratio >3x = Unusual activity (investigate news)
- Volume ratio >5x = Major event (earnings, news, etc.)

### RSI Interpretation
- RSI < 30: Potentially oversold (bounce candidate)
- RSI > 70: Potentially overbought (reversal candidate)
- RSI 40-60: Neutral momentum

### Price Change Significance
- 2-3%: Normal daily movement
- 3-5%: Significant move (investigate)
- 5-10%: Major move (news-driven)
- 10%+: Exceptional move (major catalyst)

---

**Remember**: The watch mode is a tool to identify opportunities, not a trading system. Always combine alerts with proper technical analysis, risk management, and market context before making trading decisions.

**Happy Trading! 🚀**