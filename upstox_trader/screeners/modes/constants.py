from typing import Optional, List, Dict, Tuple
from tradingview_screener import Query, col
import pandas as pd
import numpy as np


class MarketConstants:
    """Market-specific constants for different trading modes"""
    
    US = {
        'market_name': 'america',
        'currency_symbol': '$',
        'min_price': 30,
        'min_volume': 100000,
        'min_market_cap': 1e8,
        'fomo_volume_ratio': 1.5,
        'momentum_volume_ratio': 1.3,
        'min_volatility': 0.01,
        'fomo_momentum_volatility': 0.01,
        'momentum_range': {
            'positive': (0.8, 6.0),
            'negative': (-6.0, -0.8)
        },
        'realtime_momentum': {
            'min_consecutive_moves': 3,
            'interval_seconds': 60,
            'min_move_threshold': 0.15,
            'acceleration_factor': 1.5
        }
    }
    
    INDIA = {
        'market_name': 'india',
        'currency_symbol': '₹',
        'min_price': 50,
        'min_volume': 500000,
        'min_market_cap': 1e9,
        'fomo_volume_ratio': 1.5,
        'momentum_volume_ratio': 1.3,
        'min_volatility': 0.02,
        'fomo_momentum_volatility': 0.02,
        'exchange_filter': 'NSE',
        'momentum_range': {
            'positive': (0.8, 6.0),
            'negative': (-6.0, -0.8)
        },
        'realtime_momentum': {
            'min_consecutive_moves': 3,
            'interval_seconds': 180,
            'min_move_threshold': 0.2,
            'acceleration_factor': 1.5
        }
    }


class QueryConfig:
    """Common query configurations"""
    
    BASIC_FIELDS = ['name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 'update_mode']
    
    FOMO_FIELDS = BASIC_FIELDS + ['RSI', 'Volatility.D', 'market_cap_basic']
    
    MOMENTUM_FIELDS = BASIC_FIELDS + ['RSI', 'MACD.macd', 'MACD.signal', 'EMA20', 'Volatility.D', 'market_cap_basic']
    
    REALTIME_MOMENTUM_FIELDS = BASIC_FIELDS + ['RSI', 'Volatility.D', 'market_cap_basic', 'price_52_week_high', 'MACD.macd']
    
    DEFAULT_LIMIT = 25
    FOCUSED_LIMIT = 15
    REALTIME_LIMIT = 20
    
    MOMENTUM_RSI_RANGE = (35, 75)
    CONSERVATIVE_RSI_RANGE = (45, 65)
