#!/usr/bin/env python3
"""
Technical Analysis Functions
Extracted from TVScreenerUsage class
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console
from .tv_display_utils import Colors
from .utils.tv_logging_utils import log_colored

console = Console()

class TechnicalAnalysis:
    """Technical analysis and momentum detection functionality"""
    
    def __init__(self, parent_instance):
        self.parent = parent_instance
    
    def _detect_volatility_level(self, symbol, current_price):
        """Detect current volatility level for the symbol"""
        try:
            if hasattr(self.parent, 'upstox_client') and self.parent.upstox_client:
                # Get 20 days of data for ATR calculation
                end_date = datetime.now()
                start_date = end_date - timedelta(days=30)
                
                historical_data = self.parent.upstox_client.fetch_historical_data_v3(
                    symbol=symbol.replace('NSE:', ''),
                    unit='days',
                    interval=1,
                    from_date=start_date.strftime('%Y-%m-%d'),
                    to_date=end_date.strftime('%Y-%m-%d'),
                    exchange='NSE_EQ',
                    instrument_type='EQ'
                )
                
                if historical_data and len(historical_data) >= 20:
                    df = pd.DataFrame(historical_data)
                    df.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
                    
                    # Calculate ATR
                    df['tr1'] = df['high'] - df['low']
                    df['tr2'] = abs(df['high'] - df['close'].shift(1))
                    df['tr3'] = abs(df['low'] - df['close'].shift(1))
                    df['tr'] = df[['tr1', 'tr2', 'tr3']].max(axis=1)
                    
                    atr = df['tr'].rolling(window=14).mean().iloc[-1]
                    atr_pct = (atr / current_price) * 100
                    
                    if atr_pct > 3.0:
                        return 'HIGH', atr_pct
                    elif atr_pct > 1.5:
                        return 'MEDIUM', atr_pct
                    else:
                        return 'LOW', atr_pct
                        
        except Exception as e:
            console.print(f"⚠️ Error detecting volatility for {symbol}: {e}", style="yellow")
        
        return 'MEDIUM', 2.0  # Default
    
    def _calculate_atr_based_stop(self, symbol, current_price, atr_multiplier=None):
        """Calculate ATR-based stop loss"""
        try:
            volatility_level, atr_pct = self._detect_volatility_level(symbol, current_price)
            
            # Dynamic multiplier based on volatility
            if atr_multiplier is None:
                if volatility_level == 'HIGH':
                    atr_multiplier = 1.5  # Wider stops for volatile stocks
                elif volatility_level == 'LOW':
                    atr_multiplier = 2.0   # Tighter stops for stable stocks
                else:
                    atr_multiplier = 1.8   # Medium volatility
            
            # Calculate stop distance
            stop_distance = atr_pct * atr_multiplier
            
            return {
                'stop_distance_pct': stop_distance,
                'volatility_level': volatility_level,
                'atr_pct': atr_pct,
                'multiplier_used': atr_multiplier
            }
            
        except Exception as e:
            console.print(f"⚠️ Error calculating ATR stop for {symbol}: {e}", style="yellow")
            return {
                'stop_distance_pct': 2.5,
                'volatility_level': 'UNKNOWN',
                'atr_pct': 2.5,
                'multiplier_used': 1.0
            }
    
    def _check_not_buying_at_top(self, symbol, row):
        """Check if we're not buying at recent highs"""
        try:
            current_price = row.get('close', 0)
            
            # Get recent price data
            if hasattr(self.parent, 'upstox_client') and self.parent.upstox_client:
                end_date = datetime.now()
                start_date = end_date - timedelta(days=20)
                
                historical_data = self.parent.upstox_client.fetch_historical_data_v3(
                    symbol=symbol.replace('NSE:', ''),
                    unit='days',
                    interval=1,
                    from_date=start_date.strftime('%Y-%m-%d'),
                    to_date=end_date.strftime('%Y-%m-%d'),
                    exchange='NSE_EQ',
                    instrument_type='EQ'
                )
                
                if historical_data and len(historical_data) >= 10:
                    df = pd.DataFrame(historical_data)
                    df.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
                    
                    # Check if current price is within 5% of 20-day high
                    recent_high = df['high'].max()
                    distance_from_high = ((recent_high - current_price) / current_price) * 100
                    
                    return distance_from_high > 2.0, {
                        'distance_from_high_pct': distance_from_high,
                        'recent_high': recent_high,
                        'current_price': current_price
                    }
            
        except Exception as e:
            console.print(f"⚠️ Error checking top buying for {symbol}: {e}", style="yellow")
        
        return True, {'distance_from_high_pct': 10.0, 'note': 'Default safe assumption'}
    
    def _check_momentum_divergence(self, symbol, row, previous_data=None):
        """Check for momentum divergence patterns"""
        try:
            current_rsi = row.get('RSI', None)
            current_change = row.get('change', 0)
            
            if current_rsi is None:
                return False, "NO_RSI_DATA"
            
            # Basic momentum checks
            momentum_signals = {
                'rsi_oversold_bounce': current_rsi < 35 and current_change > 0,
                'rsi_overbought_fade': current_rsi > 70 and current_change < 0,
                'momentum_building': 35 <= current_rsi <= 65 and current_change > 2,
                'divergence_detected': False
            }
            
            # If we have previous data, check for divergence
            if previous_data is not None and 'RSI' in previous_data:
                prev_rsi = previous_data['RSI']
                prev_change = previous_data.get('change', 0)
                
                # Bullish divergence: Price making lower lows, RSI making higher lows
                if current_change < prev_change < 0 and current_rsi > prev_rsi:
                    momentum_signals['divergence_detected'] = True
                    momentum_signals['divergence_type'] = 'BULLISH'
                
                # Bearish divergence: Price making higher highs, RSI making lower highs
                elif current_change > prev_change > 0 and current_rsi < prev_rsi:
                    momentum_signals['divergence_detected'] = True
                    momentum_signals['divergence_type'] = 'BEARISH'
            
            has_momentum = any([
                momentum_signals['rsi_oversold_bounce'],
                momentum_signals['momentum_building'],
                momentum_signals['divergence_detected']
            ])
            
            return has_momentum, momentum_signals
            
        except Exception as e:
            console.print(f"⚠️ Error checking momentum divergence for {symbol}: {e}", style="yellow")
            return False, "ERROR"
    
    def _is_overextended_for_short(self, symbol):
        """Check if stock is overextended for short opportunities"""
        try:
            from tradingview_screener import Query, col
            
            # Get current data for the symbol
            query = (Query()
                .select('name', 'close', 'change', 'RSI', 'Stoch.K', 'CCI20',
                       'high_5d', 'high_10d', 'high_20d')
                .where(col('name') == symbol))
            
            result = query.get_scanner_data()[1]
            
            if result.empty:
                return False, {}
            
            row = result.iloc[0]
            current_price = row.get('close', 0)
            rsi = row.get('RSI', 50)
            stoch_k = row.get('Stoch.K', 50)
            cci = row.get('CCI20', 0)
            
            # Overextended criteria
            overextended_signals = {
                'rsi_overbought': rsi > 70,
                'stoch_overbought': stoch_k > 80,
                'cci_extreme': cci > 100,
                'near_recent_high': False
            }
            
            # Check distance from recent highs
            for period in ['high_5d', 'high_10d', 'high_20d']:
                if period in row and row[period] > 0:
                    distance = ((row[period] - current_price) / current_price) * 100
                    if distance < 3:  # Within 3% of recent high
                        overextended_signals['near_recent_high'] = True
                        break
            
            overextended_score = sum(overextended_signals.values())
            is_overextended = overextended_score >= 2
            
            return is_overextended, {
                'signals': overextended_signals,
                'score': overextended_score,
                'rsi': rsi,
                'stoch_k': stoch_k,
                'cci': cci
            }
            
        except Exception as e:
            console.print(f"⚠️ Error checking overextension for {symbol}: {e}", style="yellow")
            return False, {}
    
    def _check_historical_upside(self, symbol, current_price):
        """Check historical upside potential"""
        try:
            if hasattr(self.parent, 'upstox_client') and self.parent.upstox_client:
                # Get 3 months of data
                end_date = datetime.now()
                start_date = end_date - timedelta(days=90)
                
                historical_data = self.parent.upstox_client.fetch_historical_data_v3(
                    symbol=symbol.replace('NSE:', ''),
                    unit='days',
                    interval=1,
                    from_date=start_date.strftime('%Y-%m-%d'),
                    to_date=end_date.strftime('%Y-%m-%d'),
                    exchange='NSE_EQ',
                    instrument_type='EQ'
                )
                
                if historical_data and len(historical_data) >= 30:
                    df = pd.DataFrame(historical_data)
                    df.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
                    
                    # Calculate potential upside to recent highs
                    recent_high = df['high'].max()
                    potential_upside = ((recent_high - current_price) / current_price) * 100
                    
                    # Calculate support levels
                    recent_low = df['low'].min()
                    potential_downside = ((current_price - recent_low) / current_price) * 100
                    
                    # Risk-reward ratio
                    risk_reward = potential_upside / max(potential_downside, 1.0)
                    
                    return {
                        'potential_upside_pct': potential_upside,
                        'potential_downside_pct': potential_downside,
                        'risk_reward_ratio': risk_reward,
                        'recent_high': recent_high,
                        'recent_low': recent_low,
                        'attractive': potential_upside > 8 and risk_reward > 1.5
                    }
            
        except Exception as e:
            console.print(f"⚠️ Error checking historical upside for {symbol}: {e}", style="yellow")
        
        return {
            'potential_upside_pct': 5.0,
            'potential_downside_pct': 5.0,
            'risk_reward_ratio': 1.0,
            'attractive': False,
            'note': 'Default values due to data unavailability'
        }
    
    def _detect_pre_breakout_volume(self, symbol, row):
        """Detect pre-breakout volume patterns"""
        volume_ratio = row.get('relative_volume_10d_calc', 1.0)
        volume = row.get('volume', 0)
        change = row.get('change', 0)
        
        # Volume criteria for pre-breakout
        volume_signals = {
            'high_volume': volume_ratio > 1.5,
            'massive_volume': volume_ratio > 2.5,
            'volume_with_price': volume_ratio > 1.3 and abs(change) > 1,
            'accumulation_volume': volume_ratio > 1.2 and -1 < change < 1
        }
        
        pre_breakout_score = 0
        if volume_signals['massive_volume']:
            pre_breakout_score += 3
        elif volume_signals['high_volume']:
            pre_breakout_score += 2
        
        if volume_signals['volume_with_price']:
            pre_breakout_score += 2
        elif volume_signals['accumulation_volume']:
            pre_breakout_score += 1
        
        return pre_breakout_score >= 3, {
            'signals': volume_signals,
            'score': pre_breakout_score,
            'volume_ratio': volume_ratio
        }
    
    def _detect_pullback_entry(self, symbol, row):
        """Detect pullback entry opportunities"""
        try:
            rsi = row.get('RSI', 50)
            change = row.get('change', 0)
            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            
            # Pullback criteria
            pullback_signals = {
                'mild_pullback': -3 < change < -0.5,
                'rsi_not_oversold': 35 < rsi < 65,
                'volume_drying_up': volume_ratio < 0.8,
                'healthy_correction': -2 < change < -0.2 and 40 < rsi < 60
            }
            
            # Check trend context if available
            trend_strength = self._check_historical_trend(symbol)
            pullback_signals['in_uptrend'] = trend_strength.get('trend', 'neutral') == 'bullish'
            
            pullback_score = sum(pullback_signals.values())
            is_pullback_entry = pullback_score >= 3
            
            return is_pullback_entry, {
                'signals': pullback_signals,
                'score': pullback_score,
                'trend_context': trend_strength
            }
            
        except Exception as e:
            console.print(f"⚠️ Error detecting pullback entry for {symbol}: {e}", style="yellow")
            return False, {}
    
    def _check_momentum_cooling(self, symbol, row):
        """Check if momentum is cooling for potential reversal"""
        try:
            rsi = row.get('RSI', 50)
            change = row.get('change', 0)
            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            
            # Get recent momentum data if available
            momentum_15min = self._get_recent_momentum_data(symbol)
            
            cooling_signals = {
                'rsi_from_extreme': (rsi < 65 and rsi > 35),  # RSI coming back from extremes
                'decreasing_volume': volume_ratio < 1.2,
                'smaller_moves': abs(change) < 2,
                'momentum_slowing': momentum_15min.get('momentum_slowing', False)
            }
            
            cooling_score = sum(cooling_signals.values())
            is_cooling = cooling_score >= 2
            
            return is_cooling, {
                'signals': cooling_signals,
                'score': cooling_score,
                'momentum_data': momentum_15min
            }
            
        except Exception as e:
            console.print(f"⚠️ Error checking momentum cooling for {symbol}: {e}", style="yellow")
            return False, {}
    
    def _get_recent_momentum_data(self, symbol):
        """Get recent momentum data for trend analysis"""
        try:
            # This would ideally fetch 15min or hourly data
            # For now, return basic analysis
            return {
                'momentum_slowing': False,
                'trend_strength': 'medium',
                'note': 'Basic analysis - integrate with real-time data'
            }
        except Exception as e:
            return {'error': str(e)}
    
    def _detect_support_resistance_levels(self, symbol, lookback_days=60):
        """Detect support and resistance levels"""
        try:
            if hasattr(self.parent, 'upstox_client') and self.parent.upstox_client:
                return self._get_real_sr_levels_from_upstox(symbol, lookback_days)
            else:
                # Fallback to basic analysis
                return self._original_detect_support_resistance_levels(symbol, lookback_days)
                
        except Exception as e:
            console.print(f"⚠️ Error detecting S/R levels for {symbol}: {e}", style="yellow")
            return []
    
    def _get_real_sr_levels_from_upstox(self, symbol, lookback_days=60):
        """Get real support/resistance levels from Upstox data"""
        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=lookback_days)
            
            historical_data = self.parent.upstox_client.get_historical_candle_data(
                symbol.replace('NSE:', ''),
                'day',
                start_date.strftime('%Y-%m-%d'),
                end_date.strftime('%Y-%m-%d')
            )
            
            if not historical_data or len(historical_data) < 20:
                return []
            
            df = pd.DataFrame(historical_data)
            df.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
            df = df.sort_values('timestamp')
            
            # Find pivot points
            pivot_window = 5
            df['pivot_high'] = df['high'].rolling(window=pivot_window*2+1, center=True).max() == df['high']
            df['pivot_low'] = df['low'].rolling(window=pivot_window*2+1, center=True).min() == df['low']
            
            # Extract significant levels
            resistance_levels = []
            support_levels = []
            
            # Get pivot highs for resistance
            pivot_highs = df[df['pivot_high']]['high'].tolist()
            for high in pivot_highs:
                strength = self._calculate_level_strength(high, pivot_highs)
                if strength > 1:  # Appears multiple times
                    resistance_levels.append({
                        'price': high,
                        'type': 'resistance',
                        'strength': strength,
                        'touches': strength
                    })
            
            # Get pivot lows for support
            pivot_lows = df[df['pivot_low']]['low'].tolist()
            for low in pivot_lows:
                strength = self._calculate_level_strength(low, pivot_lows)
                if strength > 1:  # Appears multiple times
                    support_levels.append({
                        'price': low,
                        'type': 'support',
                        'strength': strength,
                        'touches': strength
                    })
            
            # Combine and sort by strength
            all_levels = resistance_levels + support_levels
            all_levels.sort(key=lambda x: x['strength'], reverse=True)
            
            return all_levels[:10]  # Return top 10 levels
            
        except Exception as e:
            console.print(f"⚠️ Error getting real S/R levels: {e}", style="yellow")
            return []
    
    def _original_detect_support_resistance_levels(self, symbol, lookback_days=60):
        """Original method for detecting support/resistance using TradingView data"""
        try:
            from tradingview_screener import Query, col
            
            # Get recent price data
            query = (Query()
                .select('name', 'close', 'high_1d', 'low_1d', 'high_5d', 'low_5d',
                       'high_10d', 'low_10d', 'high_20d', 'low_20d', 'high_52w', 'low_52w')
                .where(col('name') == symbol))
            
            result = query.get_scanner_data()[1]
            
            if result.empty:
                return []
            
            row = result.iloc[0]
            current_price = row.get('close', 0)
            
            levels = []
            
            # Collect potential levels
            level_candidates = []
            for period, level_type in [
                ('high_5d', 'resistance'), ('low_5d', 'support'),
                ('high_10d', 'resistance'), ('low_10d', 'support'),
                ('high_20d', 'resistance'), ('low_20d', 'support'),
                ('high_52w', 'resistance'), ('low_52w', 'support')
            ]:
                if period in row and row[period] > 0:
                    level_candidates.append({
                        'price': row[period],
                        'type': level_type,
                        'period': period,
                        'distance_pct': abs(row[period] - current_price) / current_price * 100
                    })
            
            # Cluster nearby levels
            def cluster_levels(levels, tolerance=0.01):
                if not levels:
                    return []
                
                levels.sort(key=lambda x: x['price'])
                clusters = []
                current_cluster = [levels[0]]
                
                for level in levels[1:]:
                    if abs(level['price'] - current_cluster[-1]['price']) / current_cluster[-1]['price'] <= tolerance:
                        current_cluster.append(level)
                    else:
                        clusters.append(current_cluster)
                        current_cluster = [level]
                
                clusters.append(current_cluster)
                return clusters
            
            # Group by type and cluster
            resistance_levels = [l for l in level_candidates if l['type'] == 'resistance']
            support_levels = [l for l in level_candidates if l['type'] == 'support']
            
            resistance_clusters = cluster_levels(resistance_levels)
            support_clusters = cluster_levels(support_levels)
            
            # Create final levels
            for cluster in resistance_clusters + support_clusters:
                if len(cluster) > 1:  # Multiple confirmations
                    avg_price = sum(l['price'] for l in cluster) / len(cluster)
                    strength = len(cluster)
                    level_type = cluster[0]['type']
                    
                    levels.append({
                        'price': avg_price,
                        'type': level_type,
                        'strength': strength,
                        'touches': len(cluster),
                        'distance_pct': abs(avg_price - current_price) / current_price * 100
                    })
            
            # Sort by strength and proximity
            levels.sort(key=lambda x: (x['strength'], -x['distance_pct']), reverse=True)
            
            return levels[:8]  # Return top 8 levels
            
        except Exception as e:
            console.print(f"⚠️ Error detecting S/R levels: {e}", style="yellow")
            return []
    
    def _calculate_level_strength(self, level, all_levels):
        """Calculate strength of a support/resistance level"""
        tolerance = 0.02  # 2% tolerance
        count = 0
        
        for other_level in all_levels:
            if abs(other_level - level) / level <= tolerance:
                count += 1
        
        return count
    
    def _check_historical_trend(self, symbol, timeframe='daily', lookback_days=20):
        """Check historical trend for context"""
        try:
            if hasattr(self.parent, 'upstox_client') and self.parent.upstox_client:
                end_date = datetime.now()
                start_date = end_date - timedelta(days=lookback_days * 2)
                
                historical_data = self.parent.upstox_client.fetch_historical_data_v3(
                    symbol=symbol.replace('NSE:', ''),
                    unit='days',
                    interval=1,
                    from_date=start_date.strftime('%Y-%m-%d'),
                    to_date=end_date.strftime('%Y-%m-%d'),
                    exchange='NSE_EQ',
                    instrument_type='EQ'
                )
                
                if historical_data and len(historical_data) >= lookback_days:
                    df = pd.DataFrame(historical_data)
                    df.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
                    df = df.sort_values('timestamp').tail(lookback_days)
                    
                    # Calculate trend metrics
                    start_price = df.iloc[0]['close']
                    end_price = df.iloc[-1]['close']
                    trend_change = ((end_price - start_price) / start_price) * 100
                    
                    # Calculate moving averages
                    df['sma_5'] = df['close'].rolling(5).mean()
                    df['sma_10'] = df['close'].rolling(10).mean()
                    
                    current_sma5 = df['sma_5'].iloc[-1]
                    current_sma10 = df['sma_10'].iloc[-1]
                    current_price = df['close'].iloc[-1]
                    
                    # Determine trend
                    if trend_change > 5 and current_price > current_sma5 > current_sma10:
                        trend = 'bullish'
                        strength = 'strong' if trend_change > 15 else 'moderate'
                    elif trend_change < -5 and current_price < current_sma5 < current_sma10:
                        trend = 'bearish'
                        strength = 'strong' if trend_change < -15 else 'moderate'
                    else:
                        trend = 'neutral'
                        strength = 'weak'
                    
                    return {
                        'trend': trend,
                        'strength': strength,
                        'change_pct': trend_change,
                        'price_vs_sma5': ((current_price - current_sma5) / current_sma5) * 100,
                        'sma5_vs_sma10': ((current_sma5 - current_sma10) / current_sma10) * 100
                    }
            
        except Exception as e:
            console.print(f"⚠️ Error checking historical trend: {e}", style="yellow")
        
        return {
            'trend': 'neutral',
            'strength': 'unknown',
            'change_pct': 0,
            'note': 'Trend analysis unavailable'
        }
    
    def _get_15min_rsi(self, symbol):
        """Get 15-minute RSI for the symbol"""
        try:
            # This would require intraday data access
            # For now, return basic analysis
            from tradingview_screener import Query, col
            
            query = (Query()
                .select('name', 'RSI')
                .where(col('name') == symbol))
            
            result = query.get_scanner_data()[1]
            
            if not result.empty:
                return result.iloc[0].get('RSI', None)
            
        except Exception as e:
            console.print(f"⚠️ Error getting 15min RSI for {symbol}: {e}", style="yellow")
        
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