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
        # Default parameters
        defaults = {
            'lookback_periods': 20,
            'volume_multiplier': 1.3,
            'min_breakout_percent': 0.2,
            'sl_percent': 2.5,
            'tp_percent': 4.0,
            'trailing_stop_percent': 1.5,  # Added trailing stop
            'position_size_percent': 10.0,
            'min_hold_minutes': 15,  # Added minimum hold time
            
            # Advanced Exit Mechanisms
            'quick_exit_percent': 0.8,      # Quick exit at small losses
            'momentum_periods': 5,          # Periods for momentum calculation
            'volume_exit_threshold': 0.7,   # Exit if volume drops below 70% of entry
            'rsi_oversold': 25,            # RSI level for oversold exit (longs)
            'rsi_overbought': 75,          # RSI level for overbought exit (shorts)
            'breakout_failure_threshold': 0.5  # Return to range threshold
        }
        defaults.update(kwargs)
        super().__init__("Crypto Breakout", **defaults)
        
        # Position tracking for trailing stops
        self.current_position = None  # 'LONG', 'SHORT', or None
        self.entry_price = 0.0
        self.highest_price_since_entry = 0.0  # For LONG positions
        self.lowest_price_since_entry = float('inf')  # For SHORT positions
        self.trailing_stop_price = 0.0
        self.entry_time = None
    
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate momentum breakout signals with trailing stop exits"""
        df = self.preprocess_data(df)
        df['signal'] = 'HOLD'
        
        # Reset position tracking for fresh signal generation
        self.current_position = None
        self.entry_price = 0.0
        self.highest_price_since_entry = 0.0
        self.lowest_price_since_entry = float('inf')
        self.trailing_stop_price = 0.0
        self.entry_time = None
        
        # Extract parameters
        lookback = self.parameters['lookback_periods']
        vol_mult = self.parameters['volume_multiplier']
        min_breakout = self.parameters['min_breakout_percent']
        
        # Calculate indicators
        df['volume_ma'] = df['volume'].rolling(window=20).mean()
        df['high_max'] = df['high'].rolling(window=lookback).max().shift(1)
        df['low_min'] = df['low'].rolling(window=lookback).min().shift(1)
        
        # Add RSI for exit conditions
        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
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
        
        # Add columns for tracking position state
        df['entry_price'] = 0.0
        df['trailing_stop_price'] = 0.0
        df['position_type'] = None
        
        # Generate signals with trailing stop logic
        for i in range(len(df)):
            current_row = df.iloc[i]
            
            # Basic breakout conditions
            price_breakout_up = current_row['close'] > current_row['high_max'] * (1 + min_breakout/100)
            price_breakout_down = current_row['close'] < current_row['low_min'] * (1 - min_breakout/100)
            volume_confirmation = current_row['volume'] > current_row['volume_ma'] * vol_mult
            
            # Entry conditions
            long_entry_condition = (
                price_breakout_up and
                volume_confirmation and
                (current_row['candle_direction'] == 'bullish') and
                (current_row['direction_change'] or (current_row['consecutive_hv_candles'] == 0)) and
                self.current_position is None
            )
            
            short_entry_condition = (
                price_breakout_down and
                volume_confirmation and
                (current_row['candle_direction'] == 'bearish') and
                (current_row['direction_change'] or (current_row['consecutive_hv_candles'] == 0)) and
                self.current_position is None
            )
            
            # Handle new entries
            if long_entry_condition:
                df.iloc[i, df.columns.get_loc('signal')] = 'LONG'
                self._enter_position('LONG', current_row['close'], i)
                df.iloc[i, df.columns.get_loc('entry_price')] = self.entry_price
                df.iloc[i, df.columns.get_loc('trailing_stop_price')] = self.trailing_stop_price
                df.iloc[i, df.columns.get_loc('position_type')] = 'LONG'
                
            elif short_entry_condition:
                df.iloc[i, df.columns.get_loc('signal')] = 'SHORT'
                self._enter_position('SHORT', current_row['close'], i)
                df.iloc[i, df.columns.get_loc('entry_price')] = self.entry_price
                df.iloc[i, df.columns.get_loc('trailing_stop_price')] = self.trailing_stop_price
                df.iloc[i, df.columns.get_loc('position_type')] = 'SHORT'
                
            # Handle position management and exits
            elif self.current_position is not None:
                exit_signal = self._check_exit_conditions(current_row, i)
                
                if exit_signal:
                    df.iloc[i, df.columns.get_loc('signal')] = 'EXIT'
                    self._exit_position()
                else:
                    # Update trailing stop
                    self._update_trailing_stop(current_row['high'], current_row['low'], current_row['close'])
                    df.iloc[i, df.columns.get_loc('entry_price')] = self.entry_price
                    df.iloc[i, df.columns.get_loc('trailing_stop_price')] = self.trailing_stop_price
                    df.iloc[i, df.columns.get_loc('position_type')] = self.current_position
        
        # Store entry volume for volume-based exits
        df['entry_volume'] = 0.0
        entry_signals = (df['signal'] == 'LONG') | (df['signal'] == 'SHORT')
        df.loc[entry_signals, 'entry_volume'] = df.loc[entry_signals, 'volume']
        
        return df
    
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