"""
Risk Management and Volatility Analysis Utilities for TradingView Screener
=========================================================================

This module contains utility functions for risk management, volatility detection,
ATR-based stop loss calculation, and trading charge calculations.
"""

from datetime import datetime, timedelta
from rich.console import Console

console = Console()

import pandas as pd
import numpy as np


def detect_volatility_level(upstox_api, symbol, current_price, config):
    """Detect volatility level for a stock to determine if ATR-based stops should be used"""
    try:
        if not upstox_api:
            return 'normal'  # Default to normal volatility
        
        # Get recent price data for volatility calculation
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=config.data.volatility_lookback_days)).strftime('%Y-%m-%d')
        
        df = upstox_api.fetch_historical_data_v3(
            symbol=symbol,
            unit='days',
            interval=1,
            to_date=to_date,
            from_date=from_date
        )
        
        if df is None or df.empty or len(df) < 5:
            return 'normal'  # Default if insufficient data
        
        # Calculate daily returns
        df['returns'] = df['close'].pct_change()
        
        # Calculate volatility (standard deviation of returns)
        volatility = df['returns'].std()
        
        # Calculate average daily range as % of price
        df['daily_range_pct'] = ((df['high'] - df['low']) / df['close']) * 100
        avg_daily_range = df['daily_range_pct'].mean()
        
        # Thresholds for volatility classification (from config)
        high_vol_threshold = config.risk_management.high_vol_threshold
        high_range_threshold = config.risk_management.high_range_threshold
        
        # Classify volatility
        if volatility > high_vol_threshold or avg_daily_range > high_range_threshold:
            console.print(f"[dim yellow]⚠️ {symbol} classified as HIGH volatility (Vol: {volatility:.3f}, Range: {avg_daily_range:.1f}%)[/dim yellow]")
            return 'high'
        else:
            console.print(f"[dim green]✅ {symbol} classified as NORMAL volatility (Vol: {volatility:.3f}, Range: {avg_daily_range:.1f}%)[/dim green]")
            return 'normal'
            
    except Exception as e:
        console.print(f"[dim red]⚠️ Volatility detection failed for {symbol}: {e}[/dim red]")
        return 'normal'  # Conservative default


def calculate_atr_based_stop(upstox_api, symbol, current_price, config, atr_multiplier=None):
    """Calculate ATR-based stop loss for volatile stocks"""
    if atr_multiplier is None:
        atr_multiplier = config.risk_management.atr_multiplier
        
    try:
        if not upstox_api:
            # Fallback to fixed percentage for volatile stocks (from config)
            return current_price * (1 + config.risk_management.atr_fallback_stop_pct / 100)
        
        # Get historical data for ATR calculation
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=config.data.atr_lookback_days)).strftime('%Y-%m-%d')
        
        df = upstox_api.fetch_historical_data_v3(
            symbol=symbol,
            unit='days',
            interval=1,
            to_date=to_date,
            from_date=from_date
        )
        
        if df is None or df.empty or len(df) < 14:
            # Fallback to fixed percentage
            return current_price * 0.98
        
        # Calculate True Range
        df['high_low'] = df['high'] - df['low']
        df['high_close_prev'] = np.abs(df['high'] - df['close'].shift(1))
        df['low_close_prev'] = np.abs(df['low'] - df['close'].shift(1))
        
        df['true_range'] = df[['high_low', 'high_close_prev', 'low_close_prev']].max(axis=1)
        
        # Calculate ATR (configurable period average)
        atr = df['true_range'].rolling(window=config.data.atr_period).mean().iloc[-1]
        
        if pd.isna(atr) or atr <= 0:
            # Fallback to fixed percentage (from config)
            return current_price * (1 + config.risk_management.atr_fallback_stop_pct / 100)
        
        # ATR-based stop: current_price - (ATR * multiplier)
        atr_stop = current_price - (atr * atr_multiplier)
        
        # Ensure stop is reasonable (not more than configured max below current price)
        min_stop = current_price * (1 + config.risk_management.atr_max_stop_pct / 100)
        atr_stop = max(atr_stop, min_stop)
        
        console.print(f"[dim]ATR Stop for {symbol}: ₹{atr_stop:.2f} (ATR: {atr:.2f}, Current: ₹{current_price:.2f})[/dim]")
        return atr_stop
        
    except Exception as e:
        console.print(f"[dim red]⚠️ ATR calculation failed for {symbol}: {e}[/dim red]")
        # Conservative fallback (from config)
        return current_price * (1 + config.risk_management.atr_fallback_stop_pct / 100)


def get_progressive_trailing_buffer(profit_pct, volatility_adjustment=0.0):
    """Calculate progressive trailing buffer based on profit percentage"""
    base_buffer = 0.5  # 0.5% base buffer
    
    if profit_pct < 1.0:
        buffer = base_buffer + volatility_adjustment
    elif profit_pct < 2.0:
        buffer = base_buffer * 0.8 + volatility_adjustment  # Tighten to 0.4%
    elif profit_pct < 3.0:
        buffer = base_buffer * 0.6 + volatility_adjustment  # Tighten to 0.3%
    else:
        buffer = base_buffer * 0.4 + volatility_adjustment  # Very tight 0.2%
    
    return max(buffer, 0.1)  # Minimum 0.1% buffer


def get_tighter_trailing_buffer(profit_pct, is_ultra_quick=False):
    """MUCH TIGHTER trailing buffer for aggressive profit locking"""
    if is_ultra_quick:
        if profit_pct < 0.5:
            return 0.3  # 0.3% for small profits
        elif profit_pct < 1.0:
            return 0.2  # 0.2% for medium profits  
        else:
            return 0.15  # 0.15% for good profits
    else:
        if profit_pct < 1.0:
            return 0.4  # 0.4% for small profits
        elif profit_pct < 2.0:
            return 0.3  # 0.3% for medium profits
        else:
            return 0.2  # 0.2% for good profits


def get_acceleration_based_buffer(current_profit, highest_profit, time_since_entry_minutes):
    """Get acceleration-based buffer for trailing stops"""
    # Start with base buffer
    base_buffer = 0.5
    
    # Acceleration factor - tighten buffer as momentum builds
    if current_profit > 0 and highest_profit > 0:
        momentum_ratio = current_profit / highest_profit
        if momentum_ratio > 0.8:  # Still building momentum
            buffer = base_buffer * 0.6  # Tighter buffer
        else:  # Momentum slowing
            buffer = base_buffer * 1.2  # Looser buffer
    else:
        buffer = base_buffer
    
    # Time factor - tighten buffer for longer positions
    if time_since_entry_minutes > 30:
        buffer *= 0.8  # Tighten after 30 minutes
    
    return max(buffer, 0.1)  # Minimum buffer


def calculate_trading_charges(trade_value, trade_type='intraday'):
    """Calculate trading charges for different trade types"""
    try:
        # Upstox charges (approximate)
        brokerage_rate = 0.0003 if trade_type == 'intraday' else 0.0025  # 0.03% intraday, 0.25% delivery
        
        # Basic calculations (simplified)
        brokerage = min(trade_value * brokerage_rate, 20.0)  # Max ₹20 for intraday
        stt = trade_value * 0.00025  # 0.025% on sell side
        transaction_charges = trade_value * 0.0000345  # NSE charges
        gst = (brokerage + transaction_charges) * 0.18
        sebi_charges = trade_value * 0.000001  # ₹1 per crore
        stamp_duty = trade_value * 0.00003  # 0.003%
        
        total_charges = brokerage + stt + transaction_charges + gst + sebi_charges + stamp_duty
        return round(total_charges, 2)
        
    except Exception as e:
        console.print(f"[dim red]Error calculating charges: {e}[/dim red]")
        return trade_value * 0.001  # Rough 0.1% fallback