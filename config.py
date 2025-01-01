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
        'websocket_api': 'wss://testnet.binance.vision/ws',
        'websocket_stream': 'wss://stream.binancefuture.com/ws'
    },
    'mainnet': {
        'futures_api': 'https://fapi.binance.com',
        'websocket_api': 'wss://stream.binance.com:9443/ws',
        'websocket_stream': 'wss://fstream.binance.com/ws'
    }
}

# WebSocket Configuration
WEBSOCKET_CONFIG = {
    'ping_interval': 3 * 60,  # 3 minutes in seconds
    'pong_timeout': 10 * 60,  # 10 minutes in seconds
    'display_update_ms': 100,  # Display update frequency in milliseconds
    'reconnect_delay': 5,  # Delay between reconnection attempts in seconds
    'max_reconnect_attempts': 5
} 