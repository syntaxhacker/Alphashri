#!/usr/bin/env python3
"""
Simple TradingView Webhook Receiver
Receives alerts from TradingView and logs them
"""

from flask import Flask, request, jsonify
import json
from datetime import datetime
import os

app = Flask(__name__)

# Log file setup
LOG_FILE = "alerts.log"

def log_alert(data):
    """Log alert to file"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"[{timestamp}] {json.dumps(data)}\n"

    with open(LOG_FILE, 'a') as f:
        f.write(log_entry)

    print(f"📡 Alert received: {json.dumps(data, indent=2)}")
    return True

@app.route('/webhook', methods=['POST'])
def webhook():
    """Main webhook endpoint"""
    try:
        # Get JSON data from TradingView
        data = request.get_json()

        if not data:
            print("❌ No data received")
            return jsonify({'status': 'error', 'message': 'No data received'}), 400

        # Log the alert
        log_alert(data)

        # Return success response
        response = {
            'status': 'success',
            'message': 'Alert received successfully',
            'timestamp': datetime.now().isoformat(),
            'received_data': data
        }

        return jsonify(response), 200

    except Exception as e:
        error_msg = f"Error processing webhook: {str(e)}"
        print(f"❌ {error_msg}")
        return jsonify({'status': 'error', 'message': error_msg}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'service': 'TradingView Webhook Receiver'
    })

@app.route('/test', methods=['POST'])
def test_webhook():
    """Test endpoint for manual testing"""
    test_data = {
        'symbol': 'TEST',
        'action': 'buy',
        'price': 100.00,
        'timestamp': datetime.now().isoformat()
    }

    log_alert(test_data)
    return jsonify({
        'status': 'success',
        'message': 'Test alert sent',
        'test_data': test_data
    })

if __name__ == '__main__':
    print("🚀 Starting TradingView Webhook Receiver...")
    print(f"📁 Logs will be saved to: {LOG_FILE}")
    print("📡 Webhook endpoint: http://localhost:5000/webhook")
    print("🔍 Health check: http://localhost:5000/health")
    print("🧪 Test endpoint: http://localhost:5000/test")
    print("-" * 50)

    # Create log file if it doesn't exist
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'w') as f:
            f.write(f"# TradingView Alerts Log - Started {datetime.now()}\n")
            f.write("# Format: [timestamp] JSON_data\n")

    app.run(host='0.0.0.0', port=5000, debug=True)