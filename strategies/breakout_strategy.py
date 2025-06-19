#!/usr/bin/env python3
"""
Breakout Strategy Implementation
Momentum-based breakout strategy optimized for crypto markets
"""

import pandas as pd
import numpy as np
from .base_strategy import BaseStrategy
from typing import Dict
try:
    from skopt.space import Real, Integer
except ImportError:
    print("Warning: scikit-optimize not installed. Install with: pip install scikit-optimize")
    Real = Integer = None


class BreakoutStrategy(BaseStrategy):
    """Momentum-based breakout strategy"""
    
    def __init__(self, **kwargs):
        # Default parameters - AGGRESSIVE SETTINGS FOR TESTING
        defaults = {
            'lookback_periods': 3,           # EXTREMELY short lookback for instant signals
            'volume_multiplier': 0.5,        # Very low volume requirement 
            'min_breakout_percent': 0.005,   # Tiny 0.005% breakout (~$0.50 move)
            'sl_percent': 0.8,               # Very tight stop loss
            'tp_percent': 1.2,               # Quick profit taking
            'trailing_stop_percent': 0.3,    # Ultra tight trailing
            'position_size_percent': 5.0,    # Smaller size for testing
            'min_hold_minutes': 5,           # Reduced from 15 for quicker exits
            
            # Advanced Exit Mechanisms - MORE AGGRESSIVE
            'quick_exit_percent': 0.5,       # Reduced from 0.8 for quicker exits
            'momentum_periods': 3,           # Reduced from 5 for faster momentum
            'volume_exit_threshold': 0.5,    # Reduced from 0.7 for easier exits
            'rsi_oversold': 35,             # Increased from 25 for easier exits
            'rsi_overbought': 65,           # Reduced from 75 for easier exits
            'breakout_failure_threshold': 0.3  # Reduced from 0.5 for quicker failure detection
        }
        defaults.update(kwargs)
        super().__init__("Crypto Breakout", **defaults)
        
        # Add attributes expected by the live trader
        self.stop_loss = self.parameters['sl_percent']
        self.take_profit = self.parameters['tp_percent']
        self.position_size = self.parameters['position_size_percent'] / 100.0  # Convert to decimal
        self.min_data_points = 3   # Ultra low minimum for instant testing
        
        # Position tracking for trailing stops
        self.current_position = None  # 'LONG', 'SHORT', or None
        self.entry_price = 0.0
        self.highest_price_since_entry = 0.0  # For LONG positions
        self.lowest_price_since_entry = float('inf')  # For SHORT positions
        self.trailing_stop_price = 0.0
        self.entry_time = None
    
        # Live trading data storage
        self.historical_data = pd.DataFrame()
        self.max_history_size = 1000
        self.last_trade_time = 0
        self.latest_volume = 0
    
    def process_new_data(self, open_price: float, high_price: float, low_price: float, 
                        close_price: float, volume: float) -> None:
        """Process new real-time data for live trading"""
        import time
        from datetime import datetime
        
        # Create new data row
        current_time = datetime.now()
        # Use latest volume from kline data if available, otherwise use provided volume
        actual_volume = self.latest_volume if self.latest_volume > 0 else volume
        new_row = pd.DataFrame({
            'open': [open_price],
            'high': [high_price],
            'low': [low_price],
            'close': [close_price],
            'volume': [actual_volume]
        }, index=[current_time])
        
        # Add to historical data
        if self.historical_data.empty:
            self.historical_data = new_row
        else:
            self.historical_data = pd.concat([self.historical_data, new_row])
            
        # Keep only recent data to manage memory
        if len(self.historical_data) > self.max_history_size:
            self.historical_data = self.historical_data.tail(self.max_history_size)
    
    def get_dataframe(self) -> pd.DataFrame:
        """Get the historical data DataFrame for live trading"""
        return self.historical_data.copy()
    
    def update_volume(self, volume: float) -> None:
        """Update the latest volume data from kline"""
        self.latest_volume = volume

    def calculate_indicators(self, df: pd.DataFrame, gpu_data=None) -> None:
        """Calculate technical indicators for breakout strategy"""
        if len(df) < self.min_data_points:
            return
        
        # Extract parameters
        lookback = self.parameters['lookback_periods']
        vol_mult = self.parameters['volume_multiplier']
        
        # Calculate indicators - ultra short periods for instant signals
        df['volume_ma'] = df['volume'].rolling(window=3).mean()
        df['high_max'] = df['high'].rolling(window=lookback).max().shift(1)
        df['low_min'] = df['low'].rolling(window=lookback).min().shift(1)
        
        # Add RSI for exit conditions - using shorter period for faster response
        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=7).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=7).mean()
        rs = gain / loss
        df['rsi'] = 100 - (100 / (1 + rs))
        
        # Add momentum calculation for exit conditions
        momentum_periods = self.parameters['momentum_periods']
        df['price_momentum'] = df['close'].pct_change(momentum_periods)
        
        # Store range data for breakout failure detection
        df['range_high'] = df['high_max']
        df['range_low'] = df['low_min']
        
        # Determine candle direction (bullish/bearish)
        df['candle_direction'] = 'neutral'
        df.loc[df['close'] > df['open'], 'candle_direction'] = 'bullish'
        df.loc[df['close'] < df['open'], 'candle_direction'] = 'bearish'
        
        # Identify direction changes (opposite candles)
        df['prev_direction'] = df['candle_direction'].shift(1)
        df['direction_change'] = (
            ((df['prev_direction'] == 'bearish') & (df['candle_direction'] == 'bullish')) |
            ((df['prev_direction'] == 'bullish') & (df['candle_direction'] == 'bearish'))
        )
        
        # Track consecutive high volume candles in same direction
        df['high_volume'] = df['volume'] > df['volume_ma'] * vol_mult
        df['consecutive_hv_candles'] = 0
        
        # Calculate consecutive high volume candles
        for i in range(1, len(df)):
            if df.iloc[i]['high_volume'] and df.iloc[i]['candle_direction'] == df.iloc[i-1]['candle_direction']:
                if df.iloc[i-1]['high_volume']:
                    df.iloc[i, df.columns.get_loc('consecutive_hv_candles')] = df.iloc[i-1]['consecutive_hv_candles'] + 1
                else:
                    df.iloc[i, df.columns.get_loc('consecutive_hv_candles')] = 1
            else:
                df.iloc[i, df.columns.get_loc('consecutive_hv_candles')] = 0
        
    def generate_signals(self, df: pd.DataFrame, current_position: str = None, 
                        current_price: float = None, current_bid: float = None, 
                        current_ask: float = None):
        """Generate momentum breakout signals - handles both backtesting and live trading"""
        
        # If live trading parameters are provided, return single signal
        if current_position is not None:
            return self._generate_live_signal(df, current_position, current_price, current_bid, current_ask)
        
        # Otherwise, return full series for backtesting
        return self._generate_backtest_signals(df)
    
    def _generate_live_signal(self, df: pd.DataFrame, current_position: str, 
                             current_price: float, current_bid: float, current_ask: float) -> str:
        """Generate single signal for live trading"""
        if len(df) < self.min_data_points:
            return 'HOLD'
        
        # Calculate indicators for live data
        self.calculate_indicators(df)
        
        # Get the latest data point
        latest = df.iloc[-1]
        
        # Extract parameters
        lookback = self.parameters['lookback_periods']
        vol_mult = self.parameters['volume_multiplier']
        min_breakout = self.parameters['min_breakout_percent']
        
        # Check if we have required indicators
        if pd.isna(latest.get('high_max')) or pd.isna(latest.get('low_min')) or pd.isna(latest.get('volume_ma')):
            return 'HOLD'
        
        # Store proximity data for UI display
        self.last_proximity_data = self._calculate_signal_proximity(latest, current_price)
            
            # Basic breakout conditions
        price_breakout_up = latest['close'] > latest['high_max'] * (1 + min_breakout/100)
        price_breakout_down = latest['close'] < latest['low_min'] * (1 - min_breakout/100)
        volume_confirmation = latest['volume'] > latest['volume_ma'] * vol_mult
            

        
        # Generate signals based on current position
        if current_position == 'FLAT':
            if price_breakout_up and volume_confirmation:
                return 'BUY'
            elif price_breakout_down and volume_confirmation:
                return 'SELL'
        elif current_position == 'LONG':
            # Exit conditions for long positions
            if current_price and self.entry_price:
                price_change = (current_price - self.entry_price) / self.entry_price
                if price_change <= -(self.parameters['sl_percent']/100) or \
                   price_change >= (self.parameters['tp_percent']/100):
                    return 'CLOSE'
        elif current_position == 'SHORT':
            # Exit conditions for short positions
            if current_price and self.entry_price:
                price_change = (self.entry_price - current_price) / self.entry_price
                if price_change <= -(self.parameters['sl_percent']/100) or \
                   price_change >= (self.parameters['tp_percent']/100):
                    return 'CLOSE'
        
        return 'HOLD'
    
    def _calculate_signal_proximity(self, latest_data, current_price: float) -> dict:
        """Calculate how close we are to generating trading signals"""
        vol_mult = self.parameters['volume_multiplier']
        min_breakout = self.parameters['min_breakout_percent']
        
        # Calculate breakout thresholds
        long_breakout_price = latest_data['high_max'] * (1 + min_breakout/100)
        short_breakout_price = latest_data['low_min'] * (1 - min_breakout/100)
        volume_threshold = latest_data['volume_ma'] * vol_mult
        
        # Calculate distances to signals (protect against division by zero)
        long_price_distance = ((long_breakout_price - current_price) / current_price) * 100 if current_price > 0 else 0
        short_price_distance = ((current_price - short_breakout_price) / current_price) * 100 if current_price > 0 else 0
        volume_ratio = latest_data['volume'] / volume_threshold if volume_threshold > 0 else 0
        
        # Calculate proximity percentages (0-100%, where 100% = signal triggered)
        long_proximity = max(0, min(100, 100 - (long_price_distance / min_breakout * 100))) if min_breakout > 0 else 0
        short_proximity = max(0, min(100, 100 - (short_price_distance / min_breakout * 100))) if min_breakout > 0 else 0
        volume_proximity = min(100, volume_ratio * 100)
        
        return {
            'long_breakout_price': long_breakout_price,
            'short_breakout_price': short_breakout_price,
            'long_proximity': long_proximity,
            'short_proximity': short_proximity,
            'volume_proximity': volume_proximity,
            'volume_ratio': volume_ratio,
            'long_distance': long_price_distance,
            'short_distance': short_price_distance
        }
    
    def get_proximity_info(self) -> dict:
        """Get the latest proximity information for UI display"""
        return getattr(self, 'last_proximity_data', {})
    
    def _generate_backtest_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate signals series for backtesting"""
        # Create signals series with same index as input df FIRST
        signals = pd.Series(index=df.index, data='HOLD', dtype=object)
                
        if len(df) < self.min_data_points:
            return signals
        
        # Work with a copy for preprocessing but keep original index
        df_work = self.preprocess_data(df.copy())
        
        # Extract parameters
        lookback = self.parameters['lookback_periods']
        vol_mult = self.parameters['volume_multiplier']
        min_breakout = self.parameters['min_breakout_percent']
        
        # Calculate indicators (they should already be calculated by calculate_indicators)
        if 'volume_ma' not in df_work.columns:
            # Calculate if not already done
            df_work['volume_ma'] = df_work['volume'].rolling(window=20).mean()
            df_work['high_max'] = df_work['high'].rolling(window=lookback).max().shift(1)
            df_work['low_min'] = df_work['low'].rolling(window=lookback).min().shift(1)
        
        # Basic breakout conditions using boolean indexing
        valid_data = ~(pd.isna(df_work['high_max']) | pd.isna(df_work['low_min']) | pd.isna(df_work['volume_ma']))
        
        breakout_up = (df_work['close'] > df_work['high_max'] * (1 + min_breakout/100)) & \
                     (df_work['volume'] > df_work['volume_ma'] * vol_mult) & valid_data
        
        breakout_down = (df_work['close'] < df_work['low_min'] * (1 - min_breakout/100)) & \
                       (df_work['volume'] > df_work['volume_ma'] * vol_mult) & valid_data
        
        # Set signals using the original index (only for indices that exist in both)
        common_indices = signals.index.intersection(df_work.index)
        signals.loc[common_indices[breakout_up.reindex(common_indices, fill_value=False)]] = 'BUY'
        signals.loc[common_indices[breakout_down.reindex(common_indices, fill_value=False)]] = 'SELL'
        
        return signals
    
    def _enter_position(self, position_type: str, entry_price: float, entry_index: int):
        """Enter a new position and initialize trailing stop"""
        self.current_position = position_type
        self.entry_price = entry_price
        self.entry_time = entry_index
        
        trailing_stop_distance = self.parameters['trailing_stop_percent'] / 100
        
        if position_type == 'LONG':
            self.highest_price_since_entry = entry_price
            self.trailing_stop_price = entry_price * (1 - trailing_stop_distance)
        else:  # SHORT
            self.lowest_price_since_entry = entry_price
            self.trailing_stop_price = entry_price * (1 + trailing_stop_distance)
    
    def _update_trailing_stop(self, high: float, low: float, close: float):
        """Update trailing stop based on price movement"""
        if self.current_position is None:
            return
            
        trailing_stop_distance = self.parameters['trailing_stop_percent'] / 100
        
        if self.current_position == 'LONG':
            # Update highest price since entry
            if high > self.highest_price_since_entry:
                self.highest_price_since_entry = high
                # Move trailing stop up
                new_trailing_stop = self.highest_price_since_entry * (1 - trailing_stop_distance)
                self.trailing_stop_price = max(self.trailing_stop_price, new_trailing_stop)
                
        else:  # SHORT position
            # Update lowest price since entry
            if low < self.lowest_price_since_entry:
                self.lowest_price_since_entry = low
                # Move trailing stop down
                new_trailing_stop = self.lowest_price_since_entry * (1 + trailing_stop_distance)
                self.trailing_stop_price = min(self.trailing_stop_price, new_trailing_stop)
    
    def _check_exit_conditions(self, current_row, current_index: int) -> bool:
        """Check all exit conditions including trailing stop"""
        if self.current_position is None:
            return False
        
        current_price = current_row['close']
        low_price = current_row['low']
        high_price = current_row['high']
        
        # Minimum hold time check
        min_hold = self.parameters['min_hold_minutes']
        if current_index - self.entry_time < min_hold:
            # Only allow trailing stop exits during minimum hold period
            if self.current_position == 'LONG' and low_price <= self.trailing_stop_price:
                return True
            elif self.current_position == 'SHORT' and high_price >= self.trailing_stop_price:
                return True
            return False
        
        # Trailing stop exit (primary exit mechanism)
        if self.current_position == 'LONG' and low_price <= self.trailing_stop_price:
            return True
        elif self.current_position == 'SHORT' and high_price >= self.trailing_stop_price:
            return True
        
        # Traditional stop loss (fallback)
        sl_percent = self.parameters['sl_percent'] / 100
        if self.current_position == 'LONG':
            stop_loss_price = self.entry_price * (1 - sl_percent)
            if current_price <= stop_loss_price:
                return True
        else:  # SHORT
            stop_loss_price = self.entry_price * (1 + sl_percent)
            if current_price >= stop_loss_price:
                return True
        
        # Take profit (if not using trailing stop)
        tp_percent = self.parameters['tp_percent'] / 100
        if self.current_position == 'LONG':
            take_profit_price = self.entry_price * (1 + tp_percent)
            if current_price >= take_profit_price:
                return True
        else:  # SHORT
            take_profit_price = self.entry_price * (1 - tp_percent)
            if current_price <= take_profit_price:
                return True
        
        # Quick exit for small losses
        quick_exit_percent = self.parameters['quick_exit_percent'] / 100
        if self.current_position == 'LONG':
            quick_exit_price = self.entry_price * (1 - quick_exit_percent)
            if current_price <= quick_exit_price and current_row['rsi'] <= self.parameters['rsi_oversold']:
                return True
        else:  # SHORT
            quick_exit_price = self.entry_price * (1 + quick_exit_percent)
            if current_price >= quick_exit_price and current_row['rsi'] >= self.parameters['rsi_overbought']:
                return True
        
        # Volume-based exit
        volume_threshold = self.parameters['volume_exit_threshold']
        volume_ma = current_row['volume_ma']
        if current_row['volume'] < volume_ma * volume_threshold:
            return True
        
        # Breakout failure exit
        breakout_failure_threshold = self.parameters['breakout_failure_threshold'] / 100
        if self.current_position == 'LONG':
            failure_price = current_row['range_high'] * (1 - breakout_failure_threshold)
            if current_price <= failure_price:
                return True
        else:  # SHORT
            failure_price = current_row['range_low'] * (1 + breakout_failure_threshold)
            if current_price >= failure_price:
                return True
        
        return False
    
    def _exit_position(self):
        """Exit current position and reset tracking variables"""
        self.current_position = None
        self.entry_price = 0.0
        self.highest_price_since_entry = 0.0
        self.lowest_price_since_entry = float('inf')
        self.trailing_stop_price = 0.0
        self.entry_time = None
    
    def get_parameter_space(self) -> Dict:
        """Return parameter space for Bayesian optimization"""
        return {
            'lookback_periods': Integer(10, 30, name='lookback_periods'),
            'volume_multiplier': Real(1.1, 2.5, name='volume_multiplier'),
            'min_breakout_percent': Real(0.05, 0.8, name='min_breakout_percent'),
            'sl_percent': Real(1.0, 4.5, name='sl_percent'),
            'tp_percent': Real(2.0, 7.0, name='tp_percent'),
            'trailing_stop_percent': Real(0.5, 3.0, name='trailing_stop_percent'),
            'position_size_percent': Real(5.0, 20.0, name='position_size_percent'),
            'min_hold_minutes': Integer(5, 60, name='min_hold_minutes'),
            'quick_exit_percent': Real(0.5, 1.0, name='quick_exit_percent'),
            'momentum_periods': Integer(1, 10, name='momentum_periods'),
            'volume_exit_threshold': Real(0.5, 1.0, name='volume_exit_threshold'),
            'rsi_oversold': Integer(0, 50, name='rsi_oversold'),
            'rsi_overbought': Integer(50, 100, name='rsi_overbought'),
            'breakout_failure_threshold': Real(0.1, 1.0, name='breakout_failure_threshold')
        }
    
    def get_display_name(self) -> str:
        return f"Breakout (L:{self.parameters['lookback_periods']}, V:{self.parameters['volume_multiplier']:.1f}x, T:{self.parameters['trailing_stop_percent']:.1f}%)"