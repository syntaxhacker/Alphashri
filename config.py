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

# Binance API Constants
BINANCE_API_CONFIG = {
    'testnet': {
        'futures_api': 'https://testnet.binancefuture.com',
        'websocket_base': 'wss://stream.binancefuture.com',
        'websocket_stream': 'wss://stream.binancefuture.com/ws'
    },
    'mainnet': {
        'futures_api': 'https://fapi.binance.com',
        'websocket_base': 'wss://fstream.binance.com',
        'websocket_stream': 'wss://fstream.binance.com/ws'
    }
}

# WebSocket Configuration
WEBSOCKET_CONFIG = {
    'ping_interval': 60,  # Reduced to 1 minute for more stable connection
    'pong_timeout': 30,  # Reduced timeout for faster reconnection
    'display_update_ms': 10,  # Increased display frequency to 10ms
    'reconnect_delay': 1,  # Reduced reconnect delay to 1 second
    'max_reconnect_attempts': 5,
    'update_interval': 1  # New setting: Update interval in seconds
} 