# TradingView Webhook Setup Guide

## ✅ Server Status

**Status:** 🟢 RUNNING
**Port:** 5001
**PID:** 89292
**Mode:** Trading + Auto-refresh Dashboard

**Endpoints:**
- 📡 Webhook: `http://localhost:5001/webhook`
- 🏥 Health: `http://localhost:5001/health`

## 📋 TradingView Alert Setup

### Step 1: Create Alert in TradingView

1. Click on **Alert** button (⏰ icon)
2. Set your conditions (price, indicator, etc.)
3. Scroll down to **Alert Actions**

### Step 2: Configure Webhook

**Webhook URL:**
```
http://localhost:5001/webhook
```

**Message Format:**
```json
{
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": {{close}}
}
```

### Step 3: Alert Message Examples

#### For Manual Alerts (Price Cross, etc.)
```json
{
  "symbol": "HDFCBANK",
  "action": "BUY",
  "price": {{close}}
}
```

#### For Strategy Alerts
```json
{
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": {{close}}
}
```

**Supported Actions:**
- `BUY` or `LONG` → Create long position
- `SELL` or `SHORT` → Create short position

## 🧪 Test Your Setup

### Method 1: Using curl (from terminal)
```bash
curl -X POST http://localhost:5001/webhook \
  -H "Content-Type: application/json" \
  -d '{"symbol":"HDFCBANK","action":"BUY","price":986.50}'
```

**Expected Response:**
```json
{"status":"success"}
```

### Method 2: Check Health
```bash
curl http://localhost:5001/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-10T15:16:05",
  "positions": 0,
  "uptime": "0:00:30"
}
```

## 📊 What Happens When Alert Fires

1. **TradingView sends webhook** → `http://localhost:5001/webhook`
2. **Handler receives alert** → Validates symbol & price
3. **Fetches live price** → From Upstox API (using cached token!)
4. **Creates position** → With calculated quantity based on position size
5. **Sends Telegram alert** → Notification with position details
6. **Starts monitoring** → Checks stop loss/take profit every 5s
7. **Auto-exits** → When SL (-1%) or TP (+2%) is hit
8. **Sends exit alert** → Telegram notification with P&L

## 🎯 Position Management

**Position Size:** ₹20,000 per trade
**Stop Loss:** -1% (automatic)
**Take Profit:** +2% (automatic)
**Monitoring:** Every 5 seconds (batch price fetch)

**Example:**
```
Alert: BUY HDFCBANK @ ₹986.50
  ↓
Live Price: ₹984.20 (fetched from Upstox)
  ↓
Position: BUY 20 shares @ ₹984.20
  ↓
Stop Loss: ₹974.36 (-1%)
Take Profit: ₹1004.28 (+2%)
  ↓
Auto-monitors and exits when triggered
```

## 📱 Telegram Notifications

**Entry Alert:**
```
📡 TV Alert Position

📈 Symbol: HDFCBANK
💰 Side: 🟢 BUY
💰 Price: ₹984.20
📊 Quantity: 20
💵 Value: ₹19,684
⏰ Time: 15:16:30
```

**Exit Alert:**
```
🔥 Position Closed

📈 Symbol: HDFCBANK
💰 Side: 🟢 BUY
💰 Entry: ₹984.20
💰 Exit: ₹1004.28
📊 P&L: 🟢 +2.04% (₹402)
📝 Reason: TAKE PROFIT: +2.04%
⏰ Time: 15:21:45
```

## 🛠️ Management Commands

### Check Server Status
```bash
ps aux | grep tv_webhook_handler
```

### View Live Logs
```bash
tail -f webhook_handler.log
```

### Stop Server
```bash
kill $(cat webhook_handler.pid)
```

### Restart Server
```bash
# Stop
kill $(cat webhook_handler.pid)

# Start
cd /Users/developer/Documents/algos/personal/earner
nohup python upstox_trader/screeners/tv_webhook_handler.py --trading --dashboard > webhook_handler.log 2>&1 &
echo $! > webhook_handler.pid
```

## 🔍 Monitoring

### Check Current Positions
```bash
curl -s http://localhost:5001/health | python -m json.tool
```

### Watch Logs in Real-Time
```bash
tail -f webhook_handler.log
```

### Check System Status
```bash
python upstox_trader/screeners/tv_webhook_handler.py --status
```

## ⚠️ Troubleshooting

### Problem: Webhook not receiving alerts

**Solution 1: Check if server is running**
```bash
curl http://localhost:5001/health
```

**Solution 2: Check logs**
```bash
tail -50 webhook_handler.log
```

**Solution 3: Test with curl**
```bash
curl -X POST http://localhost:5001/webhook \
  -H "Content-Type: application/json" \
  -d '{"symbol":"HDFCBANK","action":"BUY","price":986.50}'
```

### Problem: Position not created

**Check these:**
1. Symbol is in supported list (HDFCBANK, TCS, RELIANCE, etc.)
2. Action is BUY, LONG, SELL, or SHORT
3. Price is valid (> 0)
4. No existing position in same symbol

**View supported symbols:**
```python
# In tv_webhook_handler.py, line ~85
ISINS = {
    "HDFCBANK": "NSE_EQ|INE040A01034",
    "TCS": "NSE_EQ|INE467B01029",
    "RELIANCE": "NSE_EQ|INE669E01016",
    # ... add more here
}
```

### Problem: Price difference warning

**What it means:**
```
⚠️ Price difference: Alert 986.50 vs Live 984.20
```

This is normal! The handler:
1. Receives your alert price (986.50)
2. Fetches live price from Upstox (984.20)
3. Uses live price if difference > 2%

This ensures you get accurate pricing!

### Problem: Token expired

**Solution:**
The handler automatically refreshes the token. If you see:
```
🔑 Token expired, refreshing...
```

Just wait ~10 seconds, it will re-authenticate automatically using the cached token.

## 📊 Supported Stocks

Currently configured for these 10 popular NSE stocks:
- HDFCBANK
- TCS
- RELIANCE
- INFY
- WIPRO
- SBIN
- ICICIBANK
- HINDUNILVR
- ITC
- BHARTIARTL

**To add more stocks:**
1. Find the ISIN code (12-character code)
2. Add to `ISINS` dictionary in `tv_webhook_handler.py`
3. Restart the server

## 🎯 Quick Reference

| What | URL/Command |
|------|-------------|
| **Webhook** | `http://localhost:5001/webhook` |
| **Health** | `http://localhost:5001/health` |
| **Logs** | `tail -f webhook_handler.log` |
| **PID File** | `webhook_handler.pid` |
| **Stop** | `kill $(cat webhook_handler.pid)` |
| **Test Alert** | `curl -X POST http://localhost:5001/webhook -H "Content-Type: application/json" -d '{"symbol":"HDFCBANK","action":"BUY","price":986.50}'` |

## ✅ Current Configuration

- ✅ **Server:** Running on port 5001
- ✅ **Trading:** Enabled
- ✅ **Dashboard:** Auto-refresh every 10s
- ✅ **Token:** Cached (0.7h old, valid for 23h more)
- ✅ **Upstox:** Connected
- ✅ **Telegram:** Enabled
- ✅ **Stop Loss:** -1%
- ✅ **Take Profit:** +2%
- ✅ **Position Size:** ₹20,000
- ✅ **Monitoring:** Every 5 seconds

**Everything is ready! Just set up your TradingView alerts and they'll be processed automatically.** 🚀
