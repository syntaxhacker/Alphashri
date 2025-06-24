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
        'websocket_stream': 'wss://stream.binancefuture.com/ws',
        'api_key': 'c5079bf884cc676c7d3e799e080df1463b6de7cecf2c9d4b34c376c60a99c491',
        'api_secret': 'c9c4822f5944527b9ddd79f97fff3d0c33da5814c202020b938150acc4211a44'
    },
    'mainnet': {
        'futures_api': 'https://fapi.binance.com',
        'websocket_base': 'wss://fstream.binance.com',
        'websocket_stream': 'wss://fstream.binance.com/ws'
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