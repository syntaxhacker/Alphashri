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