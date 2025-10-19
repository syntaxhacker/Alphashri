"""
Actual API configuration file.
This file contains sensitive data and should NOT be committed to version control.
"""

TRADING_CONFIG = {
    'cache_timeout': 60,
    'max_workers': 3,
    'retry_attempts': 3,
    'alert_email': 'your-email@example.com',
    'smtp_settings': {
        'server': 'smtp.gmail.com',
        'port': 587,
        'username': 'your-email@example.com',
        'password': 'your-app-password'
    },
    'tradingview_chart_id': 'kTSPFbxt',
    'indicators': {
        'rsi': {
            'period': 14,
            'overbought': 70,
            'oversold': 30
        }
    },
    'refresh_interval': 60,
    'browser': {
        'width': 1920,
        'height': 1080
    }
}

# WebSocket Configuration
WEBSOCKET_CONFIG = {
    'ping_interval': 20,  # Reduced for more stable connection
    'pong_timeout': 10,  # Reduced timeout for faster reconnection
    'display_update_ms': 100,  # More reasonable display frequency
    'reconnect_delay': 0.1,  # Ultra-fast reconnect for minimal downtime
    'max_reconnect_attempts': 10,  # More attempts for reliability
    'update_interval': 0.01  # Ultra-fast update interval (100 FPS)
}

# Telegram Configuration
TELEGRAM_CONFIG = {
    'bot_token': '7347706687:AAGEqHcY5g-6mDD4w_8WEasetvuwr0UlIYw',
    'chat_id': '575679366'
}

UPSTOX_CONFIG = {
    'api_key': '93b32fc7-a2f4-4efc-9fe8-c28a9f6b4181',
    'api_secret': '2ean3hfhba'
}
