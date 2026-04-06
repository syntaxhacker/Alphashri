from typing import Optional, List, Dict, Tuple
from tradingview_screener import Query, col
import pandas as pd
import numpy as np

from .constants import MarketConstants, QueryConfig


def apply_market_cap_filter(query, market_cap_filter):
    """Apply market cap filtering based on the specified filter type"""
    if market_cap_filter == 'large':
        query = query.where(col('market_cap_basic') > 200e9)
    elif market_cap_filter == 'mid':
        query = query.where(col('market_cap_basic').between(50e9, 200e9))
    elif market_cap_filter == 'small':
        query = query.where(
            col('market_cap_basic') < 50e9,
            col('market_cap_basic') > 10e9
        )
    return query


def apply_price_filter(query, max_price=None, min_price=None):
    """Apply price filtering based on specified min and max prices"""
    conditions = []
    if max_price is not None:
        conditions.append(col('close') < max_price)
    if min_price is not None:
        conditions.append(col('close') > min_price)
    
    if conditions:
        query = query.where(*conditions)
    
    return query


def get_market_config(market: str) -> dict:
    """Get market-specific configuration"""
    return MarketConstants.US if market == 'america' else MarketConstants.INDIA


def build_market_aware_query(base_query: Query, market: str, mode_type: str = 'fomo', custom_min_price=None, custom_max_price=None) -> Query:
    """Build market-aware query with appropriate filters"""
    config = get_market_config(market)
    
    effective_min_price = custom_min_price if custom_min_price is not None else config['min_price']
    
    if mode_type == 'fomo':
        conditions = [
            col('close') > effective_min_price,
            col('volume') > config['min_volume'],
            col('market_cap_basic') > config['min_market_cap'],
            col('relative_volume_10d_calc') > config['fomo_volume_ratio']
        ]
        
        if custom_max_price is not None:
            conditions.append(col('close') < custom_max_price)
            
        query = base_query.where(*conditions)
    elif mode_type == 'fomo_momentum':
        momentum_pos = config['momentum_range']['positive']
        momentum_neg = config['momentum_range']['negative'] 
        rsi_range = QueryConfig.MOMENTUM_RSI_RANGE
        
        momentum_min_price = custom_min_price if custom_min_price is not None else (config['min_price'] * 0.8)
        
        conditions = [
            col('close') > momentum_min_price,
            col('volume') > (config['min_volume'] * 0.6),
            col('market_cap_basic') > (config['min_market_cap'] * 0.5),
            col('relative_volume_10d_calc') > config['momentum_volume_ratio'],
            col('RSI').between(rsi_range[0], rsi_range[1]),
            (col('change').between(momentum_pos[0], momentum_pos[1])) | 
            (col('change').between(momentum_neg[0], momentum_neg[1])),
            col('Volatility.D') > config['fomo_momentum_volatility']
        ]
        
        if custom_max_price is not None:
            conditions.append(col('close') < custom_max_price)
            
        query = base_query.where(*conditions)
    elif mode_type == 'realtime_momentum':
        conditions = [
            col('close') > effective_min_price,
            col('volume') > (config['min_volume'] * 0.8),
            col('market_cap_basic') > (config['min_market_cap'] * 0.3),
            col('relative_volume_10d_calc') > 1.2,
            col('RSI').between(25, 85),
            col('Volatility.D') > config['min_volatility'],
            (col('change') > 0.5) | (col('change') < -0.5)
        ]
        
        if custom_max_price is not None:
            conditions.append(col('close') < custom_max_price)
            
        query = base_query.where(*conditions)
    else:
        query = base_query
    
    if market != 'america' and 'exchange_filter' in config:
        query = query.where(col('exchange') == config['exchange_filter'])
    
    return query


def create_base_query(fields: list, market: str) -> Query:
    """Create base query with specified fields and market"""
    return Query().select(*fields).set_markets(market)
