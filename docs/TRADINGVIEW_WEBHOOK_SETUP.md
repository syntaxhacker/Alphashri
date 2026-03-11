# TradingView Webhook Setup

## 🚀 Quick Start

### 1. Start Server
```bash
python upstox_trader/screeners/tv_alerts_only.py --trading
```

### 2. Webhook URL
```
https://76ebf0aad834.ngrok-free.app/webhook
```

### 3. TradingView Configuration
- **Webhook URL**: `https://76ebf0aad834.ngrok-free.app/webhook`
- **Message Format**:
  ```json
  {
    "symbol": "{{ticker}}",
    "action": "BUY",
    "price": {{close}}
  }
  ```

## ✅ Current Status
- **🟢 Server**: Running on port 5001
- **🟢 Trading**: Enabled (1% SL / 2% TP)
- **🟢 Streaming**: WebSocket active
- **🟢 Telegram**: Notifications enabled
- **🟢 Market**: Open

## 🧪 Test Webhook
```bash
# Quick test
python quick_webhook_test.py --public

# Manual test
curl -X POST https://76ebf0aad834.ngrok-free.app/webhook \
  -H "Content-Type: application/json" \
  -d '{"symbol": "RELIANCE", "action": "BUY", "price": 1500}'
```

## 📊 Monitor
```bash
# Check status
python upstox_trader/screeners/tv_alerts_only.py --status

# Live dashboard
python upstox_trader/screeners/tv_alerts_only.py --trading --dashboard --refresh 5
```

## 🎯 Features
- ✅ Receives TradingView alerts via webhook
- ✅ Auto-creates positions (BUY/SELL)
- ✅ Live price updates via WebSocket
- ✅ Auto-exit at 1% stop loss / 2% take profit
- ✅ Telegram notifications for entries/exits
- ✅ Rich dashboard with real-time P&L
- ✅ Comprehensive test suite

## 📁 Test Files
- `quick_webhook_test.py` - Basic webhook testing
- `webhook_test_suite.py` - Comprehensive testing
- `dashboard_viewer.py` - Status monitoring

**Ready for live TradingView alerts!** 🚀