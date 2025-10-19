# TV Alerts Only - Pure TradingView Webhook Handler

## Overview
This script handles **ONLY** TradingView webhook alerts and manages positions. Unlike the original `old_tv_screen.py`, it doesn't perform continuous market scanning or refreshing.

## Features
- ✅ **Pure Alert Processing**: Only processes TradingView webhook alerts
- ✅ **No Continuous Scanning**: No market scanning or refreshing
- ✅ **Live Price Updates**: Real-time price monitoring for positions
- ✅ **Position Management**: Creates and manages positions from alerts
- ✅ **Simple Exit Strategy**: 1% stop loss, 2% take profit
- ✅ **Telegram Integration**: Alerts for position creation and exits
- ✅ **Working WebSocket Streaming**: Uses proven approach from `tick_by_tick_streamer.py`
- ✅ **Upstox Integration**: Live price validation and streaming

## Installation & Setup

### 1. Install Dependencies
```bash
pip install flask rich requests upstox-python-sdk
```

**Note:** `upstox-python-sdk` is required for working real-time streaming (same as used in `tick_by_tick_streamer.py`).

### 2. Configure APIs
- **Upstox**: Configure `UPSTOX_CONFIG` in your `config.py`
- **Telegram**: Configure `TELEGRAM_CONFIG` in your `config.py` (optional)

### 3. TradingView Webhook Setup
In TradingView, create alerts with webhook URL:
```
http://localhost:5001/webhook
```

Alert message format:
```javascript
{
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": {{close}}
}
```

## Usage

### Basic Usage (Alert Receiving Only)
```bash
python tv_alerts_only.py
```

### With Position Management
```bash
python tv_alerts_only.py --trading
```

### Custom Configuration
```bash
python tv_alerts_only.py --port 5001 --trading --position-size 15000
```

### Test Streaming Connection
```bash
python tv_alerts_only.py --test-streaming
```

## Command Line Options
- `--port PORT`: Webhook server port (default: 5001)
- `--trading`: Enable position management and automatic exits
- `--position-size AMOUNT`: Position size in rupees (default: 20000)
- `--test-streaming`: Test Upstox streaming connection and exit (diagnostic tool)

## How It Works

### 1. Webhook Server
- Runs on specified port (default: 5001)
- Receives POST requests from TradingView alerts
- Validates and processes alert data

### 2. Position Creation
- Validates alert data (symbol, action, price)
- Checks for duplicate positions
- Creates position with specified size
- Updates real-time streaming if enabled

### 3. Live Price Monitoring
- Fetches live prices from Upstox API
- Updates position current prices
- Monitors for exit conditions

### 4. Position Exit
- **Stop Loss**: -1% from entry price
- **Take Profit**: +2% from entry price
- Automatic exit on conditions met
- Telegram notifications for exits

## Example Workflow

1. **TradingView sends alert**:
   ```json
   {
     "symbol": "RELIANCE",
     "action": "BUY",
     "price": 2450.50
   }
   ```

2. **Script processes alert**:
   - Validates symbol and price
   - Creates BUY position (₹20,000 value)
   - Adds to real-time monitoring
   - Sends Telegram alert

3. **Position monitoring**:
   - Updates live price every 5 seconds
   - Checks exit conditions
   - Exits on 1% loss or 2% profit

4. **Position exit**:
   - Calculates P&L
   - Sends exit notification
   - Removes from active positions

## Key Differences from Original Script

| Feature | Original Script | TV Alerts Only |
|---------|----------------|----------------|
| Market Scanning | ✅ Continuous | ❌ None |
| Refresh Interval | ✅ Configurable | ❌ Not applicable |
| Position Management | ✅ Complex | ✅ Simple |
| Exit Strategy | ✅ Advanced | ✅ Basic (1%/2%) |
| Webhook Server | ✅ Integrated | ✅ Standalone |
| Real-time Streaming | ✅ Yes | ✅ Yes |
| Telegram Alerts | ✅ Yes | ✅ Yes |

## File Structure
```
upstox_trader/screeners/
├── tv_alerts_only.py          # Main script
├── TV_ALERTS_ONLY_README.md   # This file
└── logs/
    └── tv_alerts_only_YYYY-MM-DD.log  # Daily logs
```

## Logs
- **Webhook logs**: `logs/tv_alerts_only_YYYY-MM-DD.log`
- **Format**: `timestamp,symbol,action,price,status`
- **Statuses**: SUCCESS, IGNORED, ERROR

## Monitoring
The script displays real-time status including:
- Server status (running/stopped)
- Active positions count
- Recent trades
- Connection status (Upstox, Telegram)

## Troubleshooting

### Common Issues

#### 1. **Flask not installed**
```bash
pip install flask rich requests
```

#### 2. **Port already in use**
Use `--port` to specify different port:
```bash
python tv_alerts_only.py --port 5002
```

#### 3. **Upstox authentication failed**
- Check your `UPSTOX_CONFIG` credentials in `config.py`
- Ensure API key and secret are correct
- Verify account has necessary permissions

#### 4. **TradingView webhook format**
Ensure correct URL format in TradingView:
```
http://localhost:5001/webhook
```

#### 5. **Streaming shows as INACTIVE 🔴**
**Why this happens:**
- ❌ Upstox API not available or not installed
- ❌ Authentication failed (check credentials)
- ❌ Network connectivity issues
- ❌ API rate limits or permissions
- ❌ Missing WebSocket SDK (`upstox-python-sdk`)

**How to diagnose:**
```bash
# Test streaming connection (now uses working WebSocket approach)
python tv_alerts_only.py --test-streaming

# Run with trading enabled for detailed logs
python tv_alerts_only.py --trading
```

**Common solutions:**
- ✅ **Install WebSocket SDK**: `pip install upstox-python-sdk`
- ✅ Check `UPSTOX_CONFIG` credentials
- ✅ Verify stable internet connection
- ✅ Ensure Upstox account has API access
- ✅ Try restarting the script
- ✅ Check if market is open (streaming works during market hours)

**Note:** The script now uses the same working WebSocket approach as `tick_by_tick_streamer.py` for reliable streaming.

### Debug Mode
Run with verbose output:
```bash
python tv_alerts_only.py --trading
```

### Test Streaming Connection
If streaming shows as inactive, test the connection:
```bash
python tv_alerts_only.py --test-streaming
```

## Integration with Existing Setup
This script is designed to work alongside your existing `old_tv_screen.py`:
- Use original script for market scanning
- Use this script for pure alert processing
- Both can run simultaneously on different ports

## Performance
- **Memory efficient**: Only processes alerts, no continuous data fetching
- **Fast response**: Webhook responses in <100ms
- **Lightweight**: Minimal system resource usage
- **Scalable**: Can handle multiple simultaneous alerts