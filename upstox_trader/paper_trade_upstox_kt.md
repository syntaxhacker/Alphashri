# Upstox Paper Trading Bot - Knowledge Transfer

## Overview
A sophisticated paper trading bot for Indian stock markets using Upstox API. The bot implements support/resistance-based trading strategies with real-time WebSocket data streaming and comprehensive P&L tracking.

## Core Features

### 1. Multi-Symbol Trading
- **Custom Stocks**: Trade specific symbols via `--symbols`
- **Nifty 50**: Trade all Nifty 50 stocks via `--nifty50` flag
- **Dynamic Fetching**: Automatically fetches current Nifty 50 composition from NSE API
- **Fallback**: Uses static list if API fails

### 2. Real-Time Data Integration
- **WebSocket Streaming**: Real-time price updates via Upstox SDK
- **Price Filtering**: Only processes meaningful price changes (1 paisa minimum)
- **Smart Logging**: Logs every 100th update or significant moves (₹5+)
- **Fallback Mode**: Uses historical data if WebSocket unavailable

### 3. Trading Strategy
- **Support/Resistance Levels**: Dynamic calculation using price pivots
- **Signal Detection**: 
  - Support bounce (70%+ confidence)
  - Resistance rejection (70%+ confidence)
- **Observation Period**: 60-second wait before trading
- **Single Position**: One position per symbol at a time

### 4. Risk Management
- **Paper Trading Only**: No real orders placed
- **Position Limits**: 1 share per trade (configurable)
- **Automatic Stop Loss**: Based on support/resistance breaks
- **P&L Tracking**: Real-time profit/loss monitoring

## Usage Examples

### Basic Usage (Custom Stocks)
```bash
# Single stock
python upstox_paper_trading_bot.py --symbols RELIANCE --timeframe 15min

# Multiple stocks
python upstox_paper_trading_bot.py --symbols RELIANCE TATAMOTORS INFY --timeframe 5min
```

### Nifty 50 Trading
```bash
# Trade all Nifty 50 stocks
python upstox_paper_trading_bot.py --nifty50 --timeframe 15min
```

### Available Timeframes
- `1min`, `5min`, `15min`, `30min`, `1H`, `1D`

## Configuration Files

### config.py
```python
UPSTOX_CONFIG = {
    'api_key': 'your_api_key',
    'api_secret': 'your_api_secret',
    'redirect_uri': 'your_redirect_uri'
}
```

### Access Token
- Stored in `access_token.txt`
- Auto-loaded on startup
- Must be valid Upstox access token

## Key Classes and Functions

### UpstoxPaperTradingBot Class
Main bot class handling all trading operations.

#### Key Methods:
- `__init__()`: Initialize bot with symbols and timeframe
- `setup_websocket_streaming()`: Configure real-time data
- `calculate_support_resistance()`: Find S&R levels
- `check_support_resistance_signals()`: Detect trading signals
- `execute_trade()`: Execute paper trades
- `check_position_pnl_realtime()`: Monitor P&L

#### Key Attributes:
- `self.trading_symbols`: List of symbols to trade
- `self.positions`: Active positions dict
- `self.real_time_prices`: Live price data
- `self.current_prices`: Current price for each symbol
- `self.total_pnl`: Cumulative P&L

### Dynamic Stock Fetching
- `fetch_nifty50_stocks()`: Fetch current Nifty 50 from NSE API
- `get_static_nifty50()`: Fallback static list

## File Structure

```
upstox_trader/
├── upstox_paper_trading_bot.py    # Main bot script
├── config.py                      # Configuration
├── access_token.txt              # Upstox access token
├── paper_trade_upstox_kt.md      # This knowledge transfer doc
└── logs/
    ├── upstox_paper_trades_*.log # Trade logs
    └── console_output.log        # Console logs
```

## Signal Logic

### Support Bounce Signal
```python
# Conditions:
1. Price near support level (within bounce_threshold ±0.25%)
2. Price above EMA (bullish trend)
3. Recent price movement confirms bounce
4. Confidence >= 70%

# Action: BUY
```

### Resistance Rejection Signal
```python
# Conditions:
1. Price near resistance level (within bounce_threshold ±0.25%)
2. Price below EMA (bearish trend) OR strong rejection
3. Recent price movement confirms rejection
4. Confidence >= 70%

# Action: SELL
```

## P&L Calculation Fix

### Issue Fixed:
- Bot was using stale `current_prices` for trade entries
- Created artificial gaps between entry and actual market price

### Solution:
```python
# Before (incorrect):
current_price = self.current_prices.get(symbol, 0)

# After (correct):
current_price = self.real_time_prices.get(symbol, 0) or self.current_prices.get(symbol, 0)
```

### Applied to:
- `execute_trade()`: Trade entry prices
- `close_position()`: Trade exit prices
- All P&L calculations

## Position Management Fix

### Issue Fixed:
- Closed positions showing P&L updates
- Positions set to `None` instead of removed

### Solution:
```python
# Before (incorrect):
self.positions[symbol] = None

# After (correct):
del self.positions[symbol]  # Remove completely
```

## Logging and Output

### Trade Logs
- **Location**: `upstox_paper_trades_<symbols>_<timeframe>.log`
- **Format**: Timestamped entries for all trades
- **Content**: Entry/exit prices, P&L, signals, reasons

### Console Output
- **Real-time updates**: Price changes, P&L, signals
- **Color coding**: Green (profit), Red (loss), Blue (info)
- **Throttled logging**: Prevents spam with smart update frequency

### Large Symbol Lists
- **Filename**: `upstox_paper_trades_NIFTY50_50stocks_15min.log`
- **Display**: "Nifty 50 (50 stocks)" instead of listing all
- **Performance**: Optimized for handling 50+ symbols

## Dependencies

### Required Packages
```bash
pip install upstox-python-sdk
pip install requests
pip install pandas
pip install numpy
pip install free-indian-apis
```

### Optional (for real-time data)
- `upstox-python-sdk`: Required for WebSocket streaming
- Without it: Falls back to historical data only

## Performance Optimizations

### Real-time Updates
- **Price filtering**: Only process 1 paisa+ changes
- **Update throttling**: Smart logging frequency
- **Memory efficiency**: Cleanup closed positions

### Large Symbol Sets
- **Batch processing**: Handle 50+ symbols efficiently
- **Reduced logging**: Prevent console spam
- **Smart displays**: Shortened file names and headers

## Troubleshooting

### Common Issues
1. **No real-time updates**: Install `upstox-python-sdk`
2. **API errors**: Check access token validity
3. **No signals**: Verify timeframe and market hours
4. **High CPU**: Reduce symbol count or increase timeframes

### Debug Features
- **Verbose logging**: Shows all price updates and calculations
- **Signal confidence**: Displays confidence percentages
- **WebSocket status**: Real-time connection monitoring

## Future Enhancements

### Potential Improvements
1. **Strategy variants**: Add more signal types
2. **Risk management**: Position sizing, portfolio limits
3. **Backtesting**: Historical strategy validation
4. **Performance metrics**: Sharpe ratio, max drawdown
5. **Alerts**: Telegram/email notifications
6. **Database**: Store trades in database

### Configuration Options
1. **Confidence thresholds**: Adjustable signal sensitivity
2. **Position limits**: Configurable trade sizes
3. **Timeouts**: Customizable observation periods
4. **Risk parameters**: Stop loss, take profit levels

## Security Notes

### Access Token
- **Storage**: Plain text file (development only)
- **Production**: Use environment variables or secure storage
- **Rotation**: Regularly refresh tokens

### API Limits
- **Rate limiting**: Respect Upstox API limits
- **Concurrent requests**: Manage for large symbol sets
- **Error handling**: Graceful degradation on failures

## Development Guidelines

### Code Structure
- **Modular design**: Separate concerns clearly
- **Error handling**: Comprehensive try/catch blocks
- **Logging**: Detailed but not excessive
- **Comments**: Document complex logic

### Testing
- **Paper trading**: Always test before live trading
- **Small symbol sets**: Start with 1-3 stocks
- **Short timeframes**: Use 1-5 minute intervals for testing
- **Monitor logs**: Check for errors and unexpected behavior

---

**Last Updated**: July 15, 2025
**Version**: 2.0 (with P&L fixes and Nifty 50 support)
**Maintainer**: Paper Trading Bot Development Team