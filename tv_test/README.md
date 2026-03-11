# TradingView Webhook Receiver

A simple Python Flask server to receive TradingView alerts via ngrok tunnel.

## Files

- `tradingview_webhook.py` - Flask webhook server
- `ngrok_setup.sh` - Ngrok tunnel management script
- `alerts.log` - Alert log file (created automatically)

## Quick Start

1. **Start the services:**
   ```bash
   ./ngrok_setup.sh start
   ```

2. **Get your webhook URL:**
   The script will display a public URL like:
   ```
   Webhook URL: https://random-string.ngrok.io/webhook
   ```

3. **Configure TradingView:**
   - Add this URL to your TradingView alert webhook settings
   - Use the `/webhook` endpoint

## Script Commands

```bash
./ngrok_setup.sh start    # Start webhook server and ngrok tunnel
./ngrok_setup.sh stop     # Stop all services
./ngrok_setup.sh status   # Check service status
```

## Manual Setup

If you prefer to run components separately:

### 1. Create and activate virtual environment
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install dependencies
```bash
pip install flask
```

### 3. Start webhook server
```bash
python tradingview_webhook.py
```

### 4. Start ngrok tunnel
```bash
ngrok http 5000
```

## TradingView Configuration

### Step 1: Set Up Your First Alert

1. **Open TradingView** and go to any chart
2. **Create an alert:**
   - Click the "Alert" icon (bell) on the toolbar
   - Or right-click on the chart → "Add Alert"

3. **Configure alert conditions:**
   - **Condition:** Choose your trigger (e.g., "Close crosses above")
   - **Parameters:** Set your price/value levels
   - **Timeframe:** Choose chart timeframe

4. **Set up webhook:**
   - In the "Actions" tab, click "Webhook URL"
   - Enter your ngrok URL: `https://your-ngrok-url/webhook`
   - Click "Confirm"

5. **Add custom message (optional but recommended):**
   - In the "Message" box, add JSON data:
   ```json
   {
     "symbol": "{{ticker}}",
     "action": "buy",
     "price": "{{close}}",
     "timeframe": "{{interval}}",
     "timestamp": "{{timenow}}"
   }
   ```

6. **Click "Create"** to save the alert

### Step 2: Test Your Alert

1. **Start your webhook server:**
   ```bash
   ./ngrok_setup.sh start
   ```

2. **Copy the webhook URL** shown in the terminal

3. **Create a test alert** with simple conditions (easy to trigger)

4. **Check the output:**
   - Terminal shows received alerts
   - `alerts.log` file stores all alerts
   - Ngrok dashboard at `http://localhost:4040`

### Available TradingView Variables

Use these in your alert message:
- `{{ticker}}` - Symbol (AAPL, BTCUSD, etc.)
- `{{close}}` - Close price
- `{{open}}` - Open price  
- `{{high}}` - High price
- `{{low}}` - Low price
- `{{volume}}` - Volume
- `{{interval}}` - Timeframe
- `{{timenow}}` - Current timestamp
- `{{time}}` - Bar timestamp

### Example Alert Messages

**Simple buy signal:**
```json
{
  "symbol": "{{ticker}}",
  "action": "buy",
  "price": {{close}}
}
```

**Detailed alert:**
```json
{
  "symbol": "{{ticker}}",
  "action": "sell",
  "price": {{close}},
  "volume": {{volume}},
  "timeframe": "{{interval}}",
  "strategy": "RSI_overbought",
  "timestamp": "{{timenow}}"
}
```

**Text message (JSON not required):**
```
Buy signal for {{ticker}} at {{close}}
```

### Troubleshooting

1. **Alert not firing?**
   - Check alert conditions are met
   - Verify webhook URL is correct
   - Ensure your server is running

2. **No data received?**
   - Check ngrok dashboard for requests
   - Verify JSON syntax in message
   - Look for errors in terminal

3. **Ngrok URL changed?**
   - Free ngrok URLs change on restart
   - Update TradingView with new URL
   - Consider paid ngrok for static URL

## Testing

Test your webhook:
```bash
curl -X POST https://your-ngrok-url/webhook \
  -H "Content-Type: application/json" \
  -d '{"symbol": "TEST", "action": "buy", "price": 100.00}'
```

## Features

- Receives POST requests at `/webhook`
- Logs all alerts to console and `alerts.log`
- Returns success confirmation
- Ngrok provides public HTTPS URL
- Automatic ngrok installation and setup

## Requirements

- Python 3.6+
- Flask (auto-installed in venv)
- Ngrok account (free tier available)
- Virtual environment (auto-created)

## Ports

- Local server: `localhost:5000`
- Ngrok dashboard: `localhost:4040`
- Public URL: Dynamic HTTPS endpoint