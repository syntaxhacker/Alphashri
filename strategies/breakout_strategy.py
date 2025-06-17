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
    
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate momentum breakout signals"""
        df = self.preprocess_data(df)
        df['signal'] = 'HOLD'
        
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
        
        # Basic breakout conditions
        price_breakout_up = df['close'] > df['high_max'] * (1 + min_breakout/100)
        price_breakout_down = df['close'] < df['low_min'] * (1 - min_breakout/100)
        volume_confirmation = df['volume'] > df['volume_ma'] * vol_mult
        
        # Enhanced entry conditions: Only first volume candle after opposite direction
        # For LONG entries: bullish breakout + high volume + (direction change OR first consecutive HV candle)
        long_entry_condition = (
            price_breakout_up & 
            volume_confirmation & 
            (df['candle_direction'] == 'bullish') &
            (df['direction_change'] | (df['consecutive_hv_candles'] == 0))  # First HV candle in this direction
        )
        
        # For SHORT entries: bearish breakout + high volume + (direction change OR first consecutive HV candle)  
        short_entry_condition = (
            price_breakout_down & 
            volume_confirmation & 
            (df['candle_direction'] == 'bearish') &
            (df['direction_change'] | (df['consecutive_hv_candles'] == 0))  # First HV candle in this direction
        )
        
        # Generate signals
        df.loc[long_entry_condition, 'signal'] = 'LONG'
        df.loc[short_entry_condition, 'signal'] = 'SHORT'
        
        # Store entry volume for volume-based exits
        df['entry_volume'] = 0.0
        df.loc[long_entry_condition | short_entry_condition, 'entry_volume'] = df.loc[long_entry_condition | short_entry_condition, 'volume']
        
        return df
    
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