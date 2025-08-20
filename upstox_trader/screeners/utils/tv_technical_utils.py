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
    Enhanced logic to avoid buying at tops using TradingView data
    Returns True if it's safe to buy (not at top), False if too risky
    """
    try:
        # Get current data from the row
        current_price = row['close']
        rsi = row.get('RSI', 50)
        week_perf = row.get('Perf.W', 0)
        month3_perf = row.get('Perf.3M', 0)
        price_52w_high = row.get('price_52_week_high', current_price * 1.1)
        ema20 = row.get('EMA20', current_price)
        ema50 = row.get('EMA50', current_price)
        volume_ratio = row.get('relative_volume_10d_calc', 1.0)
        
        # Calculate distance from 52-week high
        distance_from_high = ((price_52w_high - current_price) / current_price) * 100
        
        # Check 1: Too close to 52-week high (less than 8% below - more conservative)
        if distance_from_high < 8.0:
            console.print(f"[dim yellow]⚠️ {symbol}: Too close to 52W high (only {distance_from_high:.1f}% below)[/dim yellow]")
            return False
        
        # Check 2: RSI too overbought (relaxed for FOMO mode)
        if rsi > 85:  # Much more aggressive threshold
            console.print(f"[dim yellow]⚠️ {symbol}: RSI too overbought ({rsi:.1f} > 85)[/dim yellow]")
            return False
        
        # Check 3: TODAY'S move too extreme (relaxed for FOMO mode)
        today_change = row.get('change', 0)
        if today_change > 12.0:  # Much more aggressive threshold
            console.print(f"[dim yellow]⚠️ {symbol}: Today's move too extreme (+{today_change:.1f}% > 12%)[/dim yellow]")
            return False
        
        # Check 4: Intraday momentum divergence (relaxed for FOMO mode)
        if volume_ratio > 15.0 and today_change < 0.5:  # Much more aggressive thresholds
            console.print(f"[dim yellow]⚠️ {symbol}: High volume ({volume_ratio:.1f}x) with weak price action - potential distribution[/dim yellow]")
            return False
        
        # Check 5: Weekly performance too extended (above 12% - more conservative)
        if week_perf > 12:
            console.print(f"[dim yellow]⚠️ {symbol}: Weekly move too extended (+{week_perf:.1f}% > 12%)[/dim yellow]")
            return False
        
        # Check 6: 3-month performance too extended (above 40% - more conservative)
        if month3_perf > 40:
            console.print(f"[dim yellow]⚠️ {symbol}: 3-month move too extended (+{month3_perf:.1f}% > 40%)[/dim yellow]")
            return False
        
        # Check 7: Not above key moving averages (trend weakness)
        if current_price < ema20:
            console.print(f"[dim yellow]⚠️ {symbol}: Below 20 EMA - weak trend[/dim yellow]")
            return False
        
        # Check 8: EMA alignment (20 EMA should be above 50 EMA)
        if ema20 < ema50:
            console.print(f"[dim yellow]⚠️ {symbol}: 20 EMA below 50 EMA - downtrend[/dim yellow]")
            return False
        
        # Check 9: Price extension from EMA20 (don't chase stocks too far above support)
        price_above_ema20 = ((current_price - ema20) / ema20) * 100
        if price_above_ema20 > 8.0:  # More aggressive threshold
            console.print(f"[dim yellow]⚠️ {symbol}: Too far above EMA20 ({price_above_ema20:.1f}% > 8%) - wait for pullback[/dim yellow]")
            return False
        
        # Check 10: Momentum quality check - RSI vs Price action alignment (relaxed)
        if rsi > 75 and today_change < 0.5:  # More aggressive thresholds
            console.print(f"[dim yellow]⚠️ {symbol}: RSI high ({rsi:.1f}) but weak price action - momentum fading[/dim yellow]")
            return False
        
        # If all checks pass, it's safer to enter
        console.print(f"[dim green]✅ {symbol}: Top-avoidance checks passed - safe entry zone[/dim green]")
        return True
        
    except Exception as e:
        console.print(f"[dim red]⚠️ Error checking top avoidance for {symbol}: {e}[/dim red]")
        # If error, be conservative and avoid entry
        return False


def check_momentum_divergence(symbol, row, previous_data=None):
    """
    Check for momentum divergence - price making higher highs but indicators showing weakness
    Returns True if momentum is healthy, False if divergence detected
    """
    try:
        current_price = row['close']
        rsi = row.get('RSI', 50)
        volume_ratio = row.get('relative_volume_10d_calc', 1.0)
        macd = row.get('MACD.macd', 0)
        macd_signal = row.get('MACD.signal', 0)
        
        # Check 1: Price vs RSI divergence (relaxed for FOMO mode)
        # If price is strong but RSI is weakening, that's bearish divergence
        today_change = row.get('change', 0)
        if today_change > 8.0 and rsi < 35:  # Much more aggressive thresholds
            console.print(f"[dim yellow]⚠️ {symbol}: Potential RSI divergence - strong price (+{today_change:.1f}%) but weak RSI ({rsi:.1f})[/dim yellow]")
            return False
        
        # Check 2: Volume-Price divergence (relaxed for FOMO mode)
        # Very high volume with small price move suggests institutions selling into strength
        if volume_ratio > 6.0 and today_change < 1.0:  # More relaxed thresholds
            console.print(f"[dim yellow]⚠️ {symbol}: Volume-price divergence - high volume ({volume_ratio:.1f}x) with weak move (+{today_change:.1f}%)[/dim yellow]")
            return False
        
        # Check 3: MACD momentum check
        if macd < macd_signal and today_change > 2.0:
            console.print(f"[dim yellow]⚠️ {symbol}: MACD bearish divergence - price up but MACD below signal[/dim yellow]")
            return False
        
        # Check 4: Compare with previous data if available
        if previous_data is not None and not previous_data.empty:
            prev_row = previous_data[previous_data['ticker'] == symbol]
            if not prev_row.empty:
                prev_rsi = prev_row.iloc[0].get('RSI', 50)
                prev_change = prev_row.iloc[0].get('change', 0)
                
                # Check if price momentum improving but RSI momentum declining
                if today_change > prev_change and rsi < prev_rsi - 5:
                    console.print(f"[dim yellow]⚠️ {symbol}: Momentum divergence - price accelerating but RSI declining[/dim yellow]")
                    return False
        
        return True
        
    except Exception as e:
        console.print(f"[dim red]⚠️ Error checking momentum divergence for {symbol}: {e}[/dim red]")
        return True  # If error, don't block trade but log


def is_overextended_for_short(symbol, current_data):
    """
    Check if a stock is overextended and suitable for SHORT selling
    More aggressive criteria than the top-avoidance check
    """
    try:
        if current_data.empty:
            return False
        
        # Find the symbol in current data
        symbol_row = current_data[current_data['ticker'] == symbol]
        if symbol_row.empty:
            return False
        
        row = symbol_row.iloc[0]
        current_price = row['close']
        rsi = row.get('RSI', 50)
        week_perf = row.get('Perf.W', 0)
        month3_perf = row.get('Perf.3M', 0)
        price_52w_high = row.get('price_52_week_high', current_price * 1.1)
        change_today = row.get('change', 0)
        
        # Calculate distance from 52-week high
        distance_from_high = ((price_52w_high - current_price) / current_price) * 100
        
        # SHORT criteria (more aggressive than long avoidance)
        short_signals = 0
        
        # Signal 1: Very close to 52-week high (within 3%)
        if distance_from_high < 3.0:
            short_signals += 2
            console.print(f"[dim red]🔴 {symbol}: Very close to 52W high ({distance_from_high:.1f}% below)[/dim red]")
        
        # Signal 2: RSI extremely overbought (above 80)
        if rsi > 80:
            short_signals += 2
            console.print(f"[dim red]🔴 {symbol}: Extremely overbought RSI ({rsi:.1f})[/dim red]")
        elif rsi > 75:
            short_signals += 1
            console.print(f"[dim red]📉 {symbol}: Overbought RSI ({rsi:.1f})[/dim red]")
        
        # Signal 3: Excessive weekly gain (above 20%)
        if week_perf > 20:
            short_signals += 2
            console.print(f"[dim red]🔴 {symbol}: Excessive weekly gain (+{week_perf:.1f}%)[/dim red]")
        elif week_perf > 15:
            short_signals += 1
            console.print(f"[dim red]📉 {symbol}: High weekly gain (+{week_perf:.1f}%)[/dim red]")
        
        # Signal 4: Massive daily gain (above 10% in one day)
        if change_today > 10:
            short_signals += 2
            console.print(f"[dim red]🔴 {symbol}: Massive daily gain (+{change_today:.1f}%)[/dim red]")
        elif change_today > 7:
            short_signals += 1
            console.print(f"[dim red]📉 {symbol}: Large daily gain (+{change_today:.1f}%)[/dim red]")
        
        # Signal 5: Extended 3-month performance (above 75%)
        if month3_perf > 75:
            short_signals += 1
            console.print(f"[dim red]📉 {symbol}: Extended 3M performance (+{month3_perf:.1f}%)[/dim red]")
        
        # Require at least 3 short signals for aggressive shorting
        if short_signals >= 3:
            console.print(f"[bold red]🔴 {symbol}: OVEREXTENDED - {short_signals} short signals detected[/bold red]")
            return True
        
        return False
        
    except Exception as e:
        console.print(f"[dim red]⚠️ Error checking overextension for {symbol}: {e}[/dim red]")
        return False


def check_historical_upside(upstox_api, symbol, current_price):
    """Check how much upside is left based on recent historical highs"""
    try:
        if not upstox_api:
            return True  # No historical data available, allow trade
            
        # Get previous day's data (daily timeframe)
        df = upstox_api.fetch_intraday_data_v3(
            symbol=symbol,
            unit='days',
            duration=5  # Last 5 days
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
                from_date=from_date
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