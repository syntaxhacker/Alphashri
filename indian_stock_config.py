#!/usr/bin/env python3
"""
🇮🇳 Indian Stock Market Configuration
Configuration module for NSE/BSE trading parameters and settings
"""

from datetime import time
from typing import Dict, List, Tuple

# Market Sessions
NSE_TRADING_HOURS = {
    'pre_open': time(9, 0),      # 9:00 AM IST
    'open': time(9, 15),         # 9:15 AM IST  
    'close': time(15, 30),       # 3:30 PM IST
    'post_close': time(16, 0),   # 4:00 PM IST
}

BSE_TRADING_HOURS = {
    'pre_open': time(9, 0),      # 9:00 AM IST
    'open': time(9, 15),         # 9:15 AM IST
    'close': time(15, 30),       # 3:30 PM IST
    'post_close': time(16, 0),   # 4:00 PM IST
}

# Trading Costs (in percentage)
INDIAN_TRADING_COSTS = {
    # Brokerage fees (varies by broker)
    'brokerage_equity': 0.03,           # 0.03% typical for equity delivery
    'brokerage_intraday': 0.025,        # 0.025% for intraday
    
    # STT (Securities Transaction Tax)
    'stt_delivery': 0.1,                # 0.1% on delivery
    'stt_intraday': 0.025,              # 0.025% on intraday
    
    # Transaction charges (NSE/BSE)
    'transaction_charge': 0.00325,       # 0.00325% 
    
    # GST on brokerage
    'gst_rate': 18,                     # 18% GST
    
    # SEBI charges
    'sebi_charges': 0.0001,             # 0.0001%
    
    # Stamp duty
    'stamp_duty': 0.003,                # 0.003% on buy side
    
    # Total estimated cost (conservative)
    'total_delivery': 0.05,             # ~0.05% for delivery trades
    'total_intraday': 0.04,             # ~0.04% for intraday trades
}

# Popular Indian Stocks with NSE/BSE symbols
INDIAN_STOCKS = {
    # Large Cap - Auto
    'TATAMOTORS': {'NSE': 'TATAMOTORS.NS', 'BSE': 'TATAMOTORS.BO', 'sector': 'Automobile'},
    'MARUTI': {'NSE': 'MARUTI.NS', 'BSE': 'MARUTI.BO', 'sector': 'Automobile'},
    'M&M': {'NSE': 'M&M.NS', 'BSE': 'M&M.BO', 'sector': 'Automobile'},
    'BAJAJ-AUTO': {'NSE': 'BAJAJ-AUTO.NS', 'BSE': 'BAJAJ-AUTO.BO', 'sector': 'Automobile'},
    
    # Large Cap - IT
    'TCS': {'NSE': 'TCS.NS', 'BSE': 'TCS.BO', 'sector': 'IT'},
    'INFY': {'NSE': 'INFY.NS', 'BSE': 'INFY.BO', 'sector': 'IT'},
    'WIPRO': {'NSE': 'WIPRO.NS', 'BSE': 'WIPRO.BO', 'sector': 'IT'},
    'HCLTECH': {'NSE': 'HCLTECH.NS', 'BSE': 'HCLTECH.BO', 'sector': 'IT'},
    
    # Large Cap - Banking/Finance
    'RELIANCE': {'NSE': 'RELIANCE.NS', 'BSE': 'RELIANCE.BO', 'sector': 'Oil & Gas'},
    'HDFC': {'NSE': 'HDFCBANK.NS', 'BSE': 'HDFCBANK.BO', 'sector': 'Banking'},
    'ICICIBANK': {'NSE': 'ICICIBANK.NS', 'BSE': 'ICICIBANK.BO', 'sector': 'Banking'},
    'SBIN': {'NSE': 'SBIN.NS', 'BSE': 'SBIN.BO', 'sector': 'Banking'},
    
    # Large Cap - FMCG
    'HINDUNILVR': {'NSE': 'HINDUNILVR.NS', 'BSE': 'HINDUNILVR.BO', 'sector': 'FMCG'},
    'NESTLEIND': {'NSE': 'NESTLEIND.NS', 'BSE': 'NESTLEIND.BO', 'sector': 'FMCG'},
    'ITC': {'NSE': 'ITC.NS', 'BSE': 'ITC.BO', 'sector': 'FMCG'},
    
    # Large Cap - Pharma
    'SUNPHARMA': {'NSE': 'SUNPHARMA.NS', 'BSE': 'SUNPHARMA.BO', 'sector': 'Pharma'},
    'DRREDDY': {'NSE': 'DRREDDY.NS', 'BSE': 'DRREDDY.BO', 'sector': 'Pharma'},
}

# Parameter grids optimized for Indian equity characteristics
EQUITY_PARAMETER_GRIDS = {
    # Daily timeframe parameters (most common for Indian stocks)
    '1d': {
        'lookback_periods': [5, 10, 15, 20, 25],        # Days for breakout detection
        'volume_multipliers': [1.2, 1.5, 2.0, 2.5],    # Volume confirmation
        'breakout_thresholds': [0.02, 0.03, 0.04, 0.05], # 2-5% breakouts
        'stop_loss_pct': [0.03, 0.04, 0.05],           # 3-5% stop loss
        'take_profit_pct': [0.06, 0.08, 0.10],         # 6-10% take profit
        'max_hold_days': [5, 10, 15],                   # Maximum holding period
    },
    
    # Hourly timeframe parameters (for intraday)
    '1h': {
        'lookback_periods': [10, 15, 20, 25, 30],       # Hours for breakout detection
        'volume_multipliers': [1.5, 2.0, 2.5, 3.0],    # Higher volume needed intraday
        'breakout_thresholds': [0.015, 0.02, 0.025],   # 1.5-2.5% breakouts
        'stop_loss_pct': [0.02, 0.025, 0.03],          # 2-3% stop loss
        'take_profit_pct': [0.04, 0.05, 0.06],         # 4-6% take profit
        'max_hold_hours': [4, 6, 8],                    # Maximum holding period
    },
    
    # Weekly timeframe parameters (for swing trading)
    '1wk': {
        'lookback_periods': [4, 6, 8, 10],              # Weeks for breakout detection
        'volume_multipliers': [1.0, 1.2, 1.5],         # Lower volume threshold
        'breakout_thresholds': [0.05, 0.07, 0.10],     # 5-10% breakouts
        'stop_loss_pct': [0.08, 0.10, 0.12],           # 8-12% stop loss
        'take_profit_pct': [0.15, 0.20, 0.25],         # 15-25% take profit
        'max_hold_weeks': [4, 6, 8],                    # Maximum holding period
    }
}

# Market holidays (sample - should be updated annually)
NSE_HOLIDAYS_2024 = [
    '2024-01-26',  # Republic Day
    '2024-03-08',  # Holi
    '2024-03-29',  # Good Friday  
    '2024-04-11',  # Ramzan Id
    '2024-04-17',  # Ram Navami
    '2024-05-01',  # Labour Day
    '2024-06-17',  # Bakri Id
    '2024-08-15',  # Independence Day
    '2024-08-26',  # Janmashtami
    '2024-10-02',  # Gandhi Jayanti
    '2024-11-01',  # Diwali Laxmi Pujan
    '2024-11-15',  # Guru Nanak Jayanti
]

# Default configurations for different analysis types
DEFAULT_CONFIGS = {
    'TATAMOTORS_DAILY': {
        'symbol': 'TATAMOTORS.NS',
        'timeframe': '1d',
        'train_days': 90,
        'test_days': 30,
        'step_days': 15,
        'fees': INDIAN_TRADING_COSTS['total_delivery'],
        'direction': 'longonly',  # Retail investors typically can't short
        'initial_cash': 100000,   # 1 Lakh INR
    },
    
    'TATAMOTORS_HOURLY': {
        'symbol': 'TATAMOTORS.NS',
        'timeframe': '1h',
        'train_hours': 240,       # 10 trading days
        'test_hours': 80,         # ~3 trading days
        'step_hours': 40,         # ~2 trading days
        'fees': INDIAN_TRADING_COSTS['total_intraday'],
        'direction': 'longonly',
        'initial_cash': 100000,
    },
    
    'MULTI_STOCK_DAILY': {
        'symbols': ['TATAMOTORS.NS', 'MARUTI.NS', 'M&M.NS'],
        'timeframe': '1d',
        'train_days': 90,
        'test_days': 30,
        'step_days': 15,
        'fees': INDIAN_TRADING_COSTS['total_delivery'],
        'direction': 'longonly',
        'initial_cash': 300000,   # 3 Lakh INR (1L per stock)
    }
}

# Helper functions
def get_stock_symbol(stock_name: str, exchange: str = 'NSE') -> str:
    """Get properly formatted stock symbol for yfinance"""
    if stock_name.upper() in INDIAN_STOCKS:
        return INDIAN_STOCKS[stock_name.upper()][exchange.upper()]
    else:
        # Assume user provided correct format
        if exchange.upper() == 'NSE' and not stock_name.endswith('.NS'):
            return f"{stock_name}.NS"
        elif exchange.upper() == 'BSE' and not stock_name.endswith('.BO'):
            return f"{stock_name}.BO"
        return stock_name

def calculate_total_trading_cost(trade_type: str = 'delivery') -> float:
    """Calculate total trading cost for Indian markets"""
    if trade_type.lower() == 'delivery':
        return INDIAN_TRADING_COSTS['total_delivery']
    elif trade_type.lower() == 'intraday':
        return INDIAN_TRADING_COSTS['total_intraday']
    else:
        return INDIAN_TRADING_COSTS['total_delivery']

def get_parameter_grid(timeframe: str) -> Dict:
    """Get parameter grid for given timeframe"""
    if timeframe in EQUITY_PARAMETER_GRIDS:
        return EQUITY_PARAMETER_GRIDS[timeframe]
    else:
        # Default to daily parameters
        return EQUITY_PARAMETER_GRIDS['1d']

def is_trading_time(current_time: time, exchange: str = 'NSE') -> bool:
    """Check if current time is within trading hours"""
    trading_hours = NSE_TRADING_HOURS if exchange.upper() == 'NSE' else BSE_TRADING_HOURS
    return trading_hours['open'] <= current_time <= trading_hours['close']

def get_market_info(symbol: str) -> Dict:
    """Get market information for a stock symbol"""
    for stock_name, info in INDIAN_STOCKS.items():
        if symbol in [info['NSE'], info['BSE']]:
            return {
                'stock_name': stock_name,
                'sector': info['sector'],
                'exchange': 'NSE' if symbol.endswith('.NS') else 'BSE'
            }
    return {'stock_name': symbol, 'sector': 'Unknown', 'exchange': 'Unknown'}

# Export key configurations
__all__ = [
    'NSE_TRADING_HOURS', 'BSE_TRADING_HOURS', 'INDIAN_TRADING_COSTS',
    'INDIAN_STOCKS', 'EQUITY_PARAMETER_GRIDS', 'DEFAULT_CONFIGS',
    'get_stock_symbol', 'calculate_total_trading_cost', 'get_parameter_grid',
    'is_trading_time', 'get_market_info'
] 