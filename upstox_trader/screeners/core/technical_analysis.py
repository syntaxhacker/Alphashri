#!/usr/bin/env python3
"""
Technical Analysis Functions
Extracted from TVScreenerUsage class
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console

console = Console()

class TechnicalAnalysis:
    """Technical analysis and momentum detection functionality"""
    
    def __init__(self, parent_instance):
        self.parent = parent_instance
    
    def _detect_volatility_level(self, symbol, current_price):
        """Detect volatility level for a stock to determine if ATR-based stops should be used"""
        try:
            if not hasattr(self.parent, 'upstox_api') or not self.parent.upstox_api:
                return 'normal'  # Default to normal volatility
            
            from datetime import datetime, timedelta
            import numpy as np
            
            # Get recent price data for volatility calculation
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=self.parent.config.data.volatility_lookback_days)).strftime('%Y-%m-%d')
            
            df = self.parent.upstox_api.fetch_historical_data_v3(
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
            high_vol_threshold = self.parent.config.risk_management.high_vol_threshold
            high_range_threshold = self.parent.config.risk_management.high_range_threshold
            
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

    def _calculate_atr_based_stop(self, symbol, current_price, atr_multiplier=None):
        """Calculate ATR-based stop loss for volatile stocks"""
        if atr_multiplier is None:
            atr_multiplier = self.parent.config.risk_management.atr_multiplier
            
        try:
            if not hasattr(self.parent, 'upstox_api') or not self.parent.upstox_api:
                # Fallback to fixed percentage for volatile stocks (from config)
                return current_price * (1 + self.parent.config.risk_management.atr_fallback_stop_pct / 100)
            
            from datetime import datetime, timedelta
            import numpy as np
            
            # Get historical data for ATR calculation
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=self.parent.config.data.atr_lookback_days)).strftime('%Y-%m-%d')
            
            df = self.parent.upstox_api.fetch_historical_data_v3(
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
            atr = df['true_range'].rolling(window=self.parent.config.data.atr_period).mean().iloc[-1]
            
            if pd.isna(atr) or atr <= 0:
                # Fallback to fixed percentage (from config)
                return current_price * (1 + self.parent.config.risk_management.atr_fallback_stop_pct / 100)
            
            # ATR-based stop: current_price - (ATR * multiplier)
            atr_stop = current_price - (atr * atr_multiplier)
            
            # Ensure stop is reasonable (not more than configured max below current price)
            min_stop = current_price * (1 + self.parent.config.risk_management.atr_max_stop_pct / 100)
            atr_stop = max(atr_stop, min_stop)
            
            console.print(f"[dim]ATR Stop for {symbol}: ₹{atr_stop:.2f} (ATR: {atr:.2f}, Current: ₹{current_price:.2f})[/dim]")
            return atr_stop
            
        except Exception as e:
            console.print(f"[dim red]⚠️ ATR calculation failed for {symbol}: {e}[/dim red]")
            # Conservative fallback (from config)
            return current_price * (1 + self.parent.config.risk_management.atr_fallback_stop_pct / 100)

    def _check_not_buying_at_top(self, symbol, row):
        """
        DISABLED: Always return True to allow all entries - no top avoidance checks
        """
        return True  # Always allow entries - no top avoidance

    def _check_momentum_divergence(self, symbol, row, previous_data=None):
        """
        DISABLED: Always return True to allow all entries - no momentum divergence checks
        """
        return True  # Always allow entries - no momentum divergence checks

    def _is_overextended_for_short(self, symbol):
        """
        DISABLED: Always return True to allow all short entries - no overextension checks
        """
        return True  # Always allow short entries - no overextension checks

    def _check_historical_upside(self, symbol, current_price):
        """Check how much upside is left based on recent historical highs"""
        try:
            if not hasattr(self.parent, 'upstox_api') or not self.parent.upstox_api:
                return True  # No historical data available, allow trade
                
            # Get previous day's data (daily timeframe) using historical data API
            from datetime import datetime, timedelta
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')
            
            df = self.parent.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date
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

    def _detect_pre_breakout_volume(self, symbol, row):
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

    def _detect_pullback_entry(self, symbol, row):
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

    def _check_momentum_cooling(self, symbol, row):
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

    def _detect_support_resistance_levels(self, symbol, lookback_days=60):
        """Detect key support and resistance levels from historical OHLC data"""
        try:
            # Only use real historical data via Upstox API
            if hasattr(self.parent, 'upstox_api') and self.parent.upstox_api:
                return self._get_real_sr_levels_from_upstox(symbol, lookback_days)
            else:
                # No simulation fallback; mark unavailable
                console.print(f"[dim yellow]⚠️ S/R unavailable for {symbol} (Upstox API not initialized)[/dim yellow]")
                return {'levels': [], 'data_quality': 'unavailable'}
        except Exception as e:
            console.print(f"[dim red]⚠️ S/R analysis failed for {symbol}: {e}[/dim red]")
            # No simulation fallback on errors
            return {'levels': [], 'data_quality': 'error'}

    def _get_real_sr_levels_from_upstox(self, symbol, lookback_days=60):
        """Get real S/R levels using historical OHLC data from Upstox"""
        try:
            from datetime import datetime, timedelta
            import numpy as np
            
            # Calculate date range
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
            
            # Fetch historical daily data (more reliable than intraday for S/R)
            df = self.parent.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit="days", 
                interval=1,
                to_date=to_date,
                from_date=from_date
            )
            
            if df is None or df.empty:
                console.print(f"[dim yellow]No historical data for {symbol}[/dim yellow]")
                return {'levels': [], 'data_quality': 'insufficient_data'}
            
            # Get current price for context
            current_price = df['close'].iloc[-1]
            
            # Detect pivot highs and lows for S/R levels
            sr_levels = []
            
            # Method 1: Local maxima/minima (pivot points)
            window = 5  # Look for peaks/troughs over 5-day windows
            
            # Find resistance levels (pivot highs)
            for i in range(window, len(df) - window):
                if df['high'].iloc[i] == df['high'].iloc[i-window:i+window+1].max():
                    resistance_level = df['high'].iloc[i]
                    # Only include levels that are significant and near current price
                    if abs(resistance_level - current_price) / current_price < 0.15:  # Within 15%
                        sr_levels.append({
                            'price': resistance_level,
                            'level': resistance_level,  # Keep both for compatibility
                            'type': 'resistance',
                            'strength': 1,
                            'date': df.index[i].strftime('%Y-%m-%d')
                        })
            
            # Find support levels (pivot lows)  
            for i in range(window, len(df) - window):
                if df['low'].iloc[i] == df['low'].iloc[i-window:i+window+1].min():
                    support_level = df['low'].iloc[i]
                    # Only include levels that are significant and near current price
                    if abs(support_level - current_price) / current_price < 0.15:  # Within 15%
                        sr_levels.append({
                            'price': support_level,
                            'level': support_level,  # Keep both for compatibility  
                            'type': 'support', 
                            'strength': 1,
                            'date': df.index[i].strftime('%Y-%m-%d')
                        })
            
            # Method 2: Add psychological levels (round numbers)
            price_digits = len(str(int(current_price)))
            if price_digits >= 3:  # For stocks > ₹100
                step = 10 ** (price_digits - 2)  # ₹10 intervals for 100-999, ₹100 for 1000+
                for level in range(int(current_price // step - 2) * step, 
                                 int(current_price // step + 3) * step, step):
                    if level > 0 and abs(level - current_price) / current_price < 0.10:
                        level_type = 'resistance' if level > current_price else 'support'
                        sr_levels.append({
                            'price': float(level),
                            'level': float(level),  # Keep both for compatibility
                            'type': level_type,
                            'strength': 0.7,  # Psychological levels are slightly weaker
                            'date': 'psychological'
                        })
            
            # Remove duplicates and sort by proximity to current price
            unique_levels = {}
            for level_info in sr_levels:
                key = f"{level_info['type']}_{level_info['price']:.1f}"
                if key not in unique_levels or level_info['strength'] > unique_levels[key]['strength']:
                    unique_levels[key] = level_info
            
            final_levels = sorted(unique_levels.values(), 
                                key=lambda x: abs(x['price'] - current_price))
            
            # Limit to top 8 most relevant levels and add distance calculations
            final_levels = final_levels[:8]
            
            # Add distance_pct and strength categorization for compatibility
            for level_info in final_levels:
                level_info['distance_pct'] = abs(level_info['price'] - current_price) / current_price * 100
                # Convert numeric strength to categorical
                if level_info['strength'] >= 1.0:
                    level_info['strength'] = 'strong'
                elif level_info['strength'] >= 0.7:
                    level_info['strength'] = 'moderate'
                else:
                    level_info['strength'] = 'weak'
            
            return {
                'levels': final_levels,
                'current_price': current_price,
                'data_quality': 'historical',
                'data_points': len(df),
                'date_range': f"{from_date} to {to_date}"
            }
            
        except Exception as e:
            console.print(f"[dim red]Historical S/R failed for {symbol}: {e}[/dim red]")
            return {'levels': [], 'data_quality': 'error'}

    def _calculate_level_strength(self, level, all_levels):
        """Calculate strength of a support/resistance level"""
        if hasattr(self.parent, 'tv_utils') and self.parent.tv_utils is None:
            return 'weak'
        return self.parent.tv_utils.calculate_level_strength(level, all_levels)

    def _calculate_trend_target_probability(self, current_price, target_price, trend_strength, gap_direction):
        """Calculate target probability based on trend strength and gap direction"""
        if hasattr(self.parent, 'tv_utils') and self.parent.tv_utils is None:
            return 50.0
        return self.parent.tv_utils.calculate_trend_target_probability(current_price, target_price, trend_strength, gap_direction)

    def _check_historical_trend(self, symbol, timeframe='daily', lookback_days=20):
        """Analyze historical trend using multiple indicators"""
        try:
            if not hasattr(self.parent, 'upstox_api') or not self.parent.upstox_api:
                return 'neutral'  # No historical data available
                
            # Get historical data with proper date range
            from datetime import datetime, timedelta
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
            
            if timeframe == 'daily':
                df = self.parent.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    to_date=to_date,
                    from_date=from_date
                )
            else:  # hourly for shorter-term trend (limited to 90 days per documentation)
                # Limit hourly lookback to 90 days max due to API constraints
                hourly_lookback = min(lookback_days, 90)
                hourly_from_date = (datetime.now() - timedelta(days=hourly_lookback)).strftime('%Y-%m-%d')
                df = self.parent.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='hours',
                    interval=1,
                    to_date=to_date,
                    from_date=hourly_from_date
                )
            
            if df is None or df.empty or len(df) < 10:
                return 'neutral'  # Insufficient data
                
            # Debug: Print available columns to understand data structure
            # console.print(f"[dim]Debug: Available columns for {symbol}: {list(df.columns)}[/dim]")
            
            # Calculate trend indicators
            # Handle different possible timestamp column names
            timestamp_col = None
            for col in ['timestamp', 'datetime', 'date', 'time']:
                if col in df.columns:
                    timestamp_col = col
                    break
            
            if timestamp_col:
                df = df.sort_values(timestamp_col).reset_index(drop=True)
            else:
                # If no timestamp column, assume data is already sorted
                df = df.reset_index(drop=True)
            
            # 1. Price trend - Compare current vs moving averages
            df['sma_5'] = df['close'].rolling(5).mean()
            df['sma_10'] = df['close'].rolling(10).mean()
            df['sma_20'] = df['close'].rolling(20).mean() if len(df) >= 20 else df['close'].rolling(len(df)//2).mean()
            
            current_price = df['close'].iloc[-1]
            sma_5 = df['sma_5'].iloc[-1]
            sma_10 = df['sma_10'].iloc[-1]
            sma_20 = df['sma_20'].iloc[-1]
            
            # 2. Trend slope - Check if moving averages are ascending/descending
            sma_5_slope = (df['sma_5'].iloc[-1] - df['sma_5'].iloc[-3]) / 3 if len(df) >= 3 else 0
            sma_10_slope = (df['sma_10'].iloc[-1] - df['sma_10'].iloc[-5]) / 5 if len(df) >= 5 else 0
            
            # 3. Volume trend
            avg_volume = df['volume'].rolling(10).mean().iloc[-1] if len(df) >= 10 else df['volume'].mean()
            recent_volume = df['volume'].iloc[-3:].mean()  # Last 3 periods
            volume_strength = recent_volume / avg_volume if avg_volume > 0 else 1
            
            # 4. Price momentum (rate of change)
            price_change_5d = (current_price - df['close'].iloc[-6]) / df['close'].iloc[-6] * 100 if len(df) >= 6 else 0
            price_change_10d = (current_price - df['close'].iloc[-11]) / df['close'].iloc[-11] * 100 if len(df) >= 11 else 0
            
            # Trend scoring system
            trend_score = 0
            
            # Price vs MA alignment (40% weight)
            if current_price > sma_5 > sma_10 > sma_20:
                trend_score += 40  # Strong uptrend
            elif current_price > sma_5 > sma_10:
                trend_score += 25  # Moderate uptrend
            elif current_price > sma_5:
                trend_score += 10  # Weak uptrend
            elif current_price < sma_5 < sma_10 < sma_20:
                trend_score -= 40  # Strong downtrend
            elif current_price < sma_5 < sma_10:
                trend_score -= 25  # Moderate downtrend
            elif current_price < sma_5:
                trend_score -= 10  # Weak downtrend
            
            # MA slope trend (20% weight)
            if sma_5_slope > 0 and sma_10_slope > 0:
                trend_score += 20
            elif sma_5_slope > 0:
                trend_score += 10
            elif sma_5_slope < 0 and sma_10_slope < 0:
                trend_score -= 20
            elif sma_5_slope < 0:
                trend_score -= 10
            
            # Momentum (20% weight)
            if price_change_5d > 2 and price_change_10d > 1:
                trend_score += 20
            elif price_change_5d > 1:
                trend_score += 10
            elif price_change_5d < -2 and price_change_10d < -1:
                trend_score -= 20
            elif price_change_5d < -1:
                trend_score -= 10
            
            # Volume confirmation (20% weight)
            if volume_strength > 1.2:
                trend_score += 20
            elif volume_strength > 1.0:
                trend_score += 10
            elif volume_strength < 0.8:
                trend_score -= 10
            
            # Determine trend category
            if trend_score >= 40:
                return 'strong_bullish'
            elif trend_score >= 20:
                return 'bullish'
            elif trend_score >= -20:
                return 'neutral'
            elif trend_score >= -40:
                return 'bearish'
            else:
                return 'strong_bearish'
                
        except Exception as e:
            # Simplified trend analysis as fallback (avoids historical data API issues)
            return 'neutral'  # Return neutral when historical analysis fails

    def _get_15min_rsi(self, symbol):
        """Get 15min RSI from Upstox for intraday confirmation"""
        try:
            import talib
            
            # Fetch 15min data for last 3 days (enough for RSI calculation)
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
            
            # Use the existing Upstox API
            if hasattr(self.parent, 'upstox_api') and self.parent.upstox_api:
                df = self.parent.upstox_api.fetch_historical_data_v3(
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


# Standalone Support/Resistance Functions from Paper Trading Bot
def identify_support_resistance_levels(candle_data, lookback_periods=50, level_threshold=0.5, min_touches=2, bounce_threshold=0.25):
    """Identify support and resistance levels from candle data"""
    if len(candle_data) < lookback_periods:
        return [], []
        
    highs = [c['high'] for c in candle_data[-lookback_periods:]]
    lows = [c['low'] for c in candle_data[-lookback_periods:]]
    
    # Find pivot highs and lows
    resistance_candidates = [h for i, h in enumerate(highs) if i > 1 and i < len(highs) - 2 and h > highs[i-1] and h > highs[i-2] and h > highs[i+1] and h > highs[i+2]]
    support_candidates = [l for i, l in enumerate(lows) if i > 1 and i < len(lows) - 2 and l < lows[i-1] and l < lows[i-2] and l < lows[i+1] and l < lows[i+2]]
    
    # Group nearby levels
    resistance_levels = group_levels(resistance_candidates, level_threshold)
    support_levels = group_levels(support_candidates, level_threshold)
    
    # Filter by minimum touches
    resistance_levels = filter_by_touches(resistance_levels, highs, level_threshold, min_touches)
    support_levels = filter_by_touches(support_levels, lows, level_threshold, min_touches)
    
    resistance_levels.sort(reverse=True)
    support_levels.sort(reverse=True)
    
    return support_levels, resistance_levels


def group_levels(levels, level_threshold=0.5):
    """Group nearby price levels together"""
    if not levels: 
        return []
    
    levels.sort()
    grouped, current_group = [], [levels[0]]
    
    for level in levels[1:]:
        if abs(level - current_group[0]) / current_group[0] * 100 < level_threshold:
            current_group.append(level)
        else:
            grouped.append(sum(current_group) / len(current_group))
            current_group = [level]
    
    grouped.append(sum(current_group) / len(current_group))
    return grouped


def filter_by_touches(levels, price_data, level_threshold=0.5, min_touches=2):
    """Filter levels by minimum number of touches"""
    return [l for l in levels if sum(1 for p in price_data if abs(p - l) / l * 100 < level_threshold) >= min_touches]


def calculate_trend_direction(candle_data, ema_period=20, current_price=None):
    """Calculate trend direction using EMA"""
    if len(candle_data) < ema_period:
        return None, None
        
    closes = [c['close'] for c in candle_data[-ema_period:]]
    ema = pd.Series(closes).ewm(span=ema_period, adjust=False).mean().iloc[-1]
    
    if not current_price:
        current_price = candle_data[-1]['close']
    
    if current_price > ema * 1.002: 
        trend_direction = "BULLISH"
    elif current_price < ema * 0.998: 
        trend_direction = "BEARISH"
    else: 
        trend_direction = "NEUTRAL"
        
    return trend_direction, ema


def find_nearest_levels(current_price, support_levels, resistance_levels):
    """Find nearest support and resistance levels"""
    nearest_support = max([l for l in support_levels if l < current_price] or [None])
    nearest_resistance = min([l for l in resistance_levels if l > current_price] or [None])
    
    return nearest_support, nearest_resistance


def check_support_resistance_signals(current_price, support_levels, resistance_levels, trend_direction="NEUTRAL", bounce_threshold=0.25):
    """Check for trading signals based on support/resistance levels"""
    signals = []
    nearest_support, nearest_resistance = find_nearest_levels(current_price, support_levels, resistance_levels)
    
    if (nearest_support and trend_direction in ["BULLISH", "NEUTRAL"] and 
        0 < (current_price - nearest_support) / nearest_support * 100 <= bounce_threshold):
        signals.append(('BUY', 'support_bounce', 0.8, nearest_support))
        
    if (nearest_resistance and trend_direction in ["BEARISH", "NEUTRAL"] and 
        0 < (nearest_resistance - current_price) / current_price * 100 <= bounce_threshold):
        signals.append(('SELL', 'resistance_rejection', 0.8, nearest_resistance))
        
    return signals


def display_support_resistance_levels(symbol, support_levels, resistance_levels, current_price, bounce_threshold=0.25):
    """Display support and resistance levels with colored output"""
    support_count = len(support_levels)
    resistance_count = len(resistance_levels)
    
    if support_count > 0 or resistance_count > 0:
        log_colored(
            f"{symbol} S&R Update: {support_count} Support, {resistance_count} Resistance levels found",
            "level"
        )
        
        # Print Support Levels
        if support_levels:
            print(f"\n{Colors.GREEN}🛡️  {symbol} SUPPORT LEVELS:{Colors.RESET}")
            for i, level in enumerate(support_levels, 1):
                if current_price > 0:
                    distance = ((current_price - level) / level) * 100
                    status = "🎯 ACTIVE" if abs(distance) <= bounce_threshold else "⏳ MONITORING"
                    print(f"  {Colors.GREEN}S{i}: {level:,.2f}{Colors.RESET} | Distance: {distance:+.2f}% | {status}")
                else:
                    print(f"  {Colors.GREEN}S{i}: {level:,.2f}{Colors.RESET} | Distance: Waiting for price data | ⏳ MONITORING")
        
        # Print Resistance Levels  
        if resistance_levels:
            print(f"\n{Colors.RED}🛡️  {symbol} RESISTANCE LEVELS:{Colors.RESET}")
            for i, level in enumerate(resistance_levels, 1):
                if current_price > 0:
                    distance = ((level - current_price) / current_price) * 100
                    status = "🎯 ACTIVE" if abs(distance) <= bounce_threshold else "⏳ MONITORING"
                    print(f"  {Colors.RED}R{i}: {level:,.2f}{Colors.RESET} | Distance: {distance:+.2f}% | {status}")
                else:
                    print(f"  {Colors.RED}R{i}: {level:,.2f}{Colors.RESET} | Distance: Waiting for price data | ⏳ MONITORING")
        
        print(f"\n{Colors.CYAN}💰 {symbol} Current Price: {current_price:,.2f}{Colors.RESET}")
        print(f"{Colors.YELLOW}📏 Bounce Threshold: ±{bounce_threshold}%{Colors.RESET}")
        print(f"{Colors.MAGENTA}════════════════════════════════════════{Colors.RESET}")
    else:
        log_colored(f"{symbol}: No valid S&R levels found - need more data or lower thresholds", "warning")