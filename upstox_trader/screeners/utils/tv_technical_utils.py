"""
Technical Analysis Utilities for TradingView Screener
===================================================

This module contains utility functions for technical analysis including
momentum analysis, trend detection, and entry/exit signal generation.
"""

import pandas as pd
from rich.console import Console

console = Console()


def check_not_buying_at_top(symbol, row):
    """
    DISABLED: Always return True to allow all entries - no top avoidance checks
    """
    return True  # Always allow entries - no top avoidance


def check_momentum_divergence(symbol, row, previous_data=None):
    """
    DISABLED: Always return True to allow all entries - no momentum divergence checks
    """
    return True  # Always allow entries - no momentum divergence checks


def is_overextended_for_short(symbol, current_data):
    """
    DISABLED: Always return True to allow all short entries - no overextension checks
    """
    return True  # Always allow short entries - no overextension checks


def check_historical_upside(upstox_api, symbol, current_price):
    """Check how much upside is left based on recent historical highs"""
    try:
        if not upstox_api:
            return True  # No historical data available, allow trade
            
        # Get previous day's data (daily timeframe) using historical data API
        from datetime import datetime, timedelta
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')
        
        df = upstox_api.fetch_historical_data_v3(
            symbol=symbol,
            unit='days',
            interval=1,
            to_date=to_date,
            from_date=from_date,
            exchange='NSE_EQ',
            instrument_type='EQ'
        )
        
        if df is None or df.empty:
            return True  # No data, allow trade
        
        # Calculate recent high and average high
        recent_high = df['high'].max()
        avg_high = df['high'].rolling(window=3).mean().iloc[-1]
        
        # Calculate potential upside
        upside_to_recent_high = ((recent_high - current_price) / current_price) * 100
        upside_to_avg_high = ((avg_high - current_price) / current_price) * 100
        
        # Only enter if there's at least 2% upside to recent highs
        min_upside = 2.0
        has_upside = upside_to_recent_high >= min_upside
        
        if not has_upside:
            console.print(f"[dim yellow]⚠️ {symbol}: Only {upside_to_recent_high:.1f}% upside left (need >{min_upside}%)[/dim yellow]")
        
        return has_upside
        
    except Exception as e:
        # If historical check fails, allow trade (failsafe)
        return True


def detect_pre_breakout_volume(symbol, row):
    """
    Detect early volume building before main FOMO spike (PREDICTIVE)
    Returns True if volume is building but not yet spiked (better entry timing)
    """
    try:
        current_volume_ratio = row.get('relative_volume_10d_calc', 1.0)
        today_change = row.get('change', 0)
        rsi = row.get('RSI', 50)
        
        # PRE-BREAKOUT criteria (early detection)
        volume_building = 1.3 <= current_volume_ratio <= 2.5  # Building but not spiked yet
        controlled_move = 0.1 <= today_change <= 2.0         # Small controlled move
        rsi_healthy = 45 <= rsi <= 68                         # Healthy RSI range
        
        # Additional quality filters
        ema20 = row.get('EMA20', row['close'])
        price_near_support = row['close'] >= ema20 * 0.98     # Within 2% of EMA20
        
        is_pre_breakout = (volume_building and controlled_move and 
                         rsi_healthy and price_near_support)
        
        if is_pre_breakout:
            console.print(f"[green]🟢 {symbol}: PRE-BREAKOUT detected - Vol:{current_volume_ratio:.1f}x, "
                        f"Change:+{today_change:.1f}%, RSI:{rsi:.1f}[/green]")
        
        return is_pre_breakout
        
    except Exception as e:
        console.print(f"[red]❌ Pre-breakout detection error for {symbol}: {e}[/red]")
        return False


def detect_pullback_entry(symbol, row):
    """
    Detect pullback entry opportunities after initial momentum
    Returns True if stock is pulling back to good entry level
    """
    try:
        today_change = row.get('change', 0)
        rsi = row.get('RSI', 50)
        volume_ratio = row.get('relative_volume_10d_calc', 1.0)
        
        # PULLBACK criteria
        small_pullback = -0.8 <= today_change <= 0.5         # Minor pullback or flat
        rsi_cooling = 50 <= rsi <= 70                         # RSI cooling from overbought
        volume_normalizing = 1.2 <= volume_ratio <= 2.0      # Volume normalizing
        
        # Check if we're near support (EMA20)
        ema20 = row.get('EMA20', row['close'])
        near_ema20 = row['close'] >= ema20 * 0.99             # Very close to EMA20
        
        # Check recent strength (weekly performance should be positive)
        week_perf = row.get('Perf.W', 0)
        has_recent_strength = week_perf > 2                   # At least 2% weekly gain
        
        is_pullback_entry = (small_pullback and rsi_cooling and 
                           volume_normalizing and near_ema20 and has_recent_strength)
        
        if is_pullback_entry:
            console.print(f"[cyan]🔵 {symbol}: PULLBACK ENTRY detected - Change:{today_change:+.1f}%, "
                        f"RSI:{rsi:.1f}, near EMA20[/cyan]")
        
        return is_pullback_entry
        
    except Exception as e:
        console.print(f"[red]❌ Pullback detection error for {symbol}: {e}[/red]")
        return False


def check_momentum_cooling(symbol, row):
    """
    Check if momentum is cooling down from excessive levels (safer entry)
    Returns True if momentum has cooled to safer levels
    """
    try:
        rsi = row.get('RSI', 50)
        today_change = row.get('change', 0)
        volume_ratio = row.get('relative_volume_10d_calc', 1.0)
        
        # Get distance from 52w high
        price_52w_high = row.get('price_52_week_high', row['close'] * 1.1)
        current_price = row['close']
        distance_from_high = ((price_52w_high - current_price) / current_price) * 100
        
        # COOLING criteria (momentum has settled)
        rsi_cooled = 55 <= rsi <= 75                          # RSI in middle range
        moderate_move = -1.0 <= today_change <= 3.0           # Not extreme moves
        reasonable_distance = distance_from_high >= 5.0       # Not too close to highs
        volume_reasonable = volume_ratio <= 3.0               # Volume not extreme
        
        momentum_cooled = (rsi_cooled and moderate_move and 
                         reasonable_distance and volume_reasonable)
        
        if momentum_cooled:
            console.print(f"[blue]🔷 {symbol}: MOMENTUM COOLED - Safe entry window "
                        f"(RSI:{rsi:.1f}, {distance_from_high:.1f}% from high)[/blue]")
        
        return momentum_cooled
        
    except Exception as e:
        console.print(f"[red]❌ Momentum cooling check error for {symbol}: {e}[/red]")
        return False


def check_confirmed_downtrend_for_short(symbol, row, config):
    """Check if confirmed downtrend exists before allowing short (price < VWAP + bearish volume)"""
    try:
        current_price = row['close']
        
        # Get VWAP if available, otherwise estimate using volume-weighted price
        vwap = row.get('VWAP', current_price)  # Fallback to current price if no VWAP
        
        # Check if price is below VWAP (bearish condition)
        price_below_vwap = current_price < vwap
        
        # Check for bearish volume (volume above average with negative price action)
        volume_ratio = row.get('relative_volume_10d_calc', 1.0)
        change = row.get('change', 0)
        
        # Bearish volume: elevated volume with negative or weak positive move (from config)
        bearish_volume = (volume_ratio > config.downtrend.min_volume_ratio_bearish and 
                         change < config.downtrend.max_change_bearish)
        
        # Additional trend confirmation
        ema20 = row.get('EMA20', current_price)
        ema50 = row.get('EMA50', current_price)
        
        # Stronger confirmation: price below moving averages
        below_ema20 = current_price < ema20
        ema_bearish = ema20 < ema50  # 20 EMA below 50 EMA
        
        # Relaxed downtrend confirmation for FOMO mode
        confirmed_downtrend = price_below_vwap or bearish_volume or (below_ema20 and ema_bearish)  # OR instead of AND
        
        if confirmed_downtrend:
            console.print(f"[dim green]✅ {symbol}: Confirmed downtrend for short - Price<VWAP: {price_below_vwap}, Bearish Vol: {bearish_volume}[/dim green]")
        else:
            console.print(f"[dim yellow]⚠️ {symbol}: No confirmed downtrend - Price<VWAP: {price_below_vwap}, Bearish Vol: {bearish_volume}[/dim yellow]")
        
        return confirmed_downtrend
        
    except Exception as e:
        console.print(f"[dim red]⚠️ Error checking downtrend for {symbol}: {e}[/dim red]")
        return False  # Conservative approach - don't short if can't confirm


def get_15min_rsi(upstox_api, symbol):
    """Get 15min RSI from Upstox for intraday confirmation"""
    try:
        import talib
        from datetime import datetime, timedelta
        
        # Fetch 15min data for last 3 days (enough for RSI calculation)
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
        
        # Use the existing Upstox API
        if upstox_api:
            df = upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='minutes',
                interval=15,
                to_date=to_date,
                from_date=from_date,
                exchange='NSE_EQ',
                instrument_type='EQ'
            )
            
            if df is not None and len(df) >= 14:  # Need at least 14 periods for RSI
                # Calculate 15min RSI
                rsi = talib.RSI(df['close'], timeperiod=14)
                current_15min_rsi = rsi.iloc[-1]  # Latest RSI value
                
                return current_15min_rsi
        
        return None  # Return None if data unavailable
        
    except Exception as e:
        # Fallback silently - don't break the main flow
        return None