#!/usr/bin/env python3
"""
Railway Deployment Entry Point for Trading Bot

This script provides a web interface and health monitoring for the trading bot
when deployed on Railway. It includes:
- Health check endpoint
- Basic web dashboard
- Trading bot management
"""

import os
import sys
import threading
import time
from datetime import datetime
from flask import Flask, render_template_string, jsonify, request
import logging

# Add the project root to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Global variables for bot management
trading_bot = None
bot_thread = None
bot_status = {"running": False, "last_update": None, "error": None}

def get_env_config():
    """Get configuration from environment variables"""
    return {
        'paper_trading': os.getenv('PAPER_TRADING_ENABLED', 'true').lower() == 'true',
        'market': os.getenv('MARKET', 'in'),
        'trading_mode': os.getenv('TRADING_MODE', 'volume_spike_monitor'),
        'trading_start': os.getenv('TRADING_START_TIME', '09:20'),
        'trading_end': os.getenv('TRADING_END_TIME', '15:30'),
        'log_level': os.getenv('LOG_LEVEL', 'INFO'),
        'environment': os.getenv('ENVIRONMENT', 'production'),
        'port': int(os.getenv('PORT', 8080))
    }

def start_trading_bot():
    """Start the trading bot in a separate thread"""
    global trading_bot, bot_status
    
    try:
        # Import trading modules
        from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
        from upstox_trader.screeners.tv_configs import get_config
        
        config = get_env_config()
        
        # Initialize trading bot
        trading_bot = TVScreenerUsage(
            market=config['market'],
            enable_paper_trading=config['paper_trading']
        )
        
        bot_status["running"] = True
        bot_status["last_update"] = datetime.now().isoformat()
        bot_status["error"] = None
        
        logger.info(f"Trading bot started in {config['trading_mode']} mode")
        
        # Run the selected trading mode
        if config['trading_mode'] == 'volume_spike_monitor':
            trading_bot.volume_spike_monitor()
        elif config['trading_mode'] == 'price_move_alerts':
            trading_bot.price_move_alerts()
        elif config['trading_mode'] == 'smart_fomo_detector':
            trading_bot.smart_fomo_detector()
        elif config['trading_mode'] == 'overbought_short_signals':
            trading_bot.overbought_short_signals()
        elif config['trading_mode'] == 'heavy_breakout':
            trading_bot.heavy_breakout()
        else:
            trading_bot.intraday_high_volume_breakouts()
            
    except Exception as e:
        logger.error(f"Trading bot error: {e}")
        bot_status["running"] = False
        bot_status["error"] = str(e)
        bot_status["last_update"] = datetime.now().isoformat()

@app.route('/')
def dashboard():
    """Simple web dashboard"""
    config = get_env_config()
    
    dashboard_html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Trading Bot Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background-color: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; color: #333; margin-bottom: 30px; }
            .status { padding: 15px; border-radius: 5px; margin: 15px 0; }
            .status.running { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
            .status.stopped { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
            .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0; }
            .config-item { padding: 10px; background-color: #f8f9fa; border-radius: 5px; }
            .config-label { font-weight: bold; color: #495057; }
            .config-value { color: #007bff; }
            .button { display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 5px; }
            .button:hover { background-color: #0056b3; }
            .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 0.9em; }
        </style>
        <script>
            function refreshStatus() {
                fetch('/api/status')
                    .then(response => response.json())
                    .then(data => {
                        const statusDiv = document.getElementById('status');
                        const statusClass = data.running ? 'running' : 'stopped';
                        const statusText = data.running ? 'Running' : 'Stopped';
                        const errorText = data.error ? ` (Error: ${data.error})` : '';
                        
                        statusDiv.className = `status ${statusClass}`;
                        statusDiv.innerHTML = `
                            <strong>Status:</strong> ${statusText}${errorText}<br>
                            <strong>Last Update:</strong> ${data.last_update || 'Never'}
                        `;
                    })
                    .catch(error => console.error('Error fetching status:', error));
            }
            
            // Refresh status every 30 seconds
            setInterval(refreshStatus, 30000);
            
            // Initial load
            window.onload = refreshStatus;
        </script>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🚀 Trading Bot Dashboard</h1>
                <p>Deployed on Railway</p>
            </div>
            
            <div id="status" class="status">
                Loading status...
            </div>
            
            <div class="config-grid">
                <div class="config-item">
                    <div class="config-label">Trading Mode:</div>
                    <div class="config-value">{{ config.trading_mode }}</div>
                </div>
                <div class="config-item">
                    <div class="config-label">Market:</div>
                    <div class="config-value">{{ config.market.upper() }}</div>
                </div>
                <div class="config-item">
                    <div class="config-label">Paper Trading:</div>
                    <div class="config-value">{{ 'Yes' if config.paper_trading else 'No' }}</div>
                </div>
                <div class="config-item">
                    <div class="config-label">Trading Hours:</div>
                    <div class="config-value">{{ config.trading_start }} - {{ config.trading_end }}</div>
                </div>
                <div class="config-item">
                    <div class="config-label">Environment:</div>
                    <div class="config-value">{{ config.environment.upper() }}</div>
                </div>
                <div class="config-item">
                    <div class="config-label">Log Level:</div>
                    <div class="config-value">{{ config.log_level }}</div>
                </div>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="/api/status" class="button">Check Status API</a>
                <a href="/api/health" class="button">Health Check</a>
            </div>
            
            <div class="footer">
                <p>Centralized Trading Configuration System | Ultra-Tight Trailing Stops Active</p>
                <p>Built with tv_configs.py for flexible parameter management</p>
            </div>
        </div>
    </body>
    </html>
    """
    
    return render_template_string(dashboard_html, config=config)

@app.route('/api/health')
def health_check():
    """Health check endpoint for Railway"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "trading-bot",
        "version": "1.0.0"
    })

@app.route('/api/status')
def bot_status_api():
    """Get bot status"""
    return jsonify(bot_status)

@app.route('/api/start', methods=['POST'])
def start_bot():
    """Start the trading bot"""
    global bot_thread
    
    if bot_status["running"]:
        return jsonify({"error": "Bot is already running"}), 400
    
    bot_thread = threading.Thread(target=start_trading_bot, daemon=True)
    bot_thread.start()
    
    return jsonify({"message": "Bot starting..."})

@app.route('/api/stop', methods=['POST'])
def stop_bot():
    """Stop the trading bot"""
    global trading_bot, bot_status
    
    if trading_bot:
        # Graceful shutdown logic here
        bot_status["running"] = False
        bot_status["last_update"] = datetime.now().isoformat()
        trading_bot = None
    
    return jsonify({"message": "Bot stopped"})

if __name__ == '__main__':
    config = get_env_config()
    
    logger.info(f"Starting Trading Bot Dashboard on port {config['port']}")
    logger.info(f"Configuration: {config}")
    
    # Auto-start the trading bot in production
    if config['environment'] == 'production':
        logger.info("Auto-starting trading bot in production mode")
        bot_thread = threading.Thread(target=start_trading_bot, daemon=True)
        bot_thread.start()
    
    # Start Flask app
    app.run(
        host='0.0.0.0',
        port=config['port'],
        debug=(config['environment'] == 'development')
    )