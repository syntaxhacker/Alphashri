#!/usr/bin/env python3
"""
EMA Strategy Module
Implements Exponential Moving Average based trading strategies
Supports 8,13,21,50 EMA configurations for intraday trading
"""

import pandas as pd
import numpy as np
import vectorbt as vbt
from abc import ABC, abstractmethod


class BaseStrategy(ABC):
    """Base class for all trading strategies"""
    
    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
        self.parameters = {}
    
    @abstractmethod
    def calculate_indicators(self, data: pd.DataFrame) -> dict:
        """Calculate technical indicators for the strategy"""
        pass
    
    @abstractmethod
    def generate_signals(self, indicators: dict) -> tuple:
        """Generate buy/sell signals based on indicators"""
        pass
    
    def get_info(self) -> dict:
        """Get strategy information"""
        return {
            'name': self.name,
            'description': self.description,
            'parameters': self.parameters
        }


class EMAStrategy(BaseStrategy):
    """
    EMA (Exponential Moving Average) Strategy
    Uses 8, 13, 21, 50 EMAs with RSI for intraday trading
    Based on proven 2024-2025 market strategies
    """
    
    def __init__(self, rsi_period=14, rsi_buy=50, rsi_sell=60, 
                 volume_multiplier=1.1, ema_periods=None):
        super().__init__(
            name="EMA Crossover Strategy",
            description="RSI + EMA Trend Analysis (8,13,21,50) for 15-min intraday"
        )
        
        # Default EMA periods (8, 13, 21, 50)
        self.ema_periods = ema_periods or [8, 13, 21, 50]
        
        # Strategy parameters
        self.parameters = {
            'rsi_period': rsi_period,
            'rsi_buy_threshold': rsi_buy,
            'rsi_sell_threshold': rsi_sell,
            'volume_multiplier': volume_multiplier,
            'ema_periods': self.ema_periods
        }
    
    def calculate_indicators(self, data: pd.DataFrame) -> dict:
        """Calculate EMA and RSI indicators"""
        close = data['close']
        volume = data['volume']
        
        # RSI for momentum
        rsi = vbt.RSI.run(close, window=self.parameters['rsi_period']).rsi
        
        # Calculate EMAs
        emas = {}
        for period in self.ema_periods:
            emas[f'ema_{period}'] = close.ewm(span=period).mean()
        
        # Volume EMA
        volume_ema = volume.ewm(span=20).mean()
        
        # Trend analysis
        ema_8 = emas['ema_8']
        ema_13 = emas['ema_13']
        ema_21 = emas['ema_21']
        ema_50 = emas['ema_50']
        
        # Trend strength indicators
        bullish_alignment = (ema_8 > ema_13) & (ema_13 > ema_21) & (ema_21 > ema_50)
        bearish_alignment = (ema_8 < ema_13) & (ema_13 < ema_21) & (ema_21 < ema_50)
        
        return {
            'rsi': rsi,
            'volume_ema': volume_ema,
            'bullish_alignment': bullish_alignment,
            'bearish_alignment': bearish_alignment,
            'close': close,
            'volume': volume,
            **emas  # Include all EMAs
        }
    
    def generate_signals(self, indicators: dict) -> tuple:
        """Generate EMA-based buy/sell signals"""
        rsi = indicators['rsi']
        ema_8 = indicators['ema_8']
        ema_13 = indicators['ema_13']
        close = indicators['close']
        volume = indicators['volume']
        volume_ema = indicators['volume_ema']
        
        # Handle NaN values
        rsi_filled = rsi.fillna(50)
        ema_8_filled = ema_8.fillna(method='bfill').fillna(method='ffill')
        ema_13_filled = ema_13.fillna(method='bfill').fillna(method='ffill')
        volume_ema_filled = volume_ema.fillna(method='bfill').fillna(method='ffill')
        
        # Align all series to common index
        common_index = close.index
        rsi_aligned = rsi_filled.reindex(common_index, fill_value=50)
        ema_8_aligned = ema_8_filled.reindex(common_index, fill_value=float(close.iloc[0]))
        ema_13_aligned = ema_13_filled.reindex(common_index, fill_value=float(close.iloc[0]))
        volume_mean_val = float(volume.mean())
        volume_ema_aligned = volume_ema_filled.reindex(common_index, fill_value=volume_mean_val)
        
        # Generate trading signals
        buy_signals = (
            (rsi_aligned < self.parameters['rsi_buy_threshold']) &  # RSI condition
            (close > ema_8_aligned) &  # Price above fastest EMA
            (ema_8_aligned > ema_13_aligned) &  # EMA crossover bullish
            (volume > volume_ema_aligned * self.parameters['volume_multiplier'])  # Volume confirmation
        )
        
        sell_signals = (
            (rsi_aligned > self.parameters['rsi_sell_threshold']) |  # RSI overbought
            (close < ema_8_aligned) |  # Price below fastest EMA
            (ema_8_aligned < ema_13_aligned)  # EMA crossover bearish
        )
        
        return buy_signals, sell_signals
    
    def update_parameters(self, **kwargs):
        """Update strategy parameters"""
        for key, value in kwargs.items():
            if key in self.parameters:
                self.parameters[key] = value


class SimpleMAStrategy(BaseStrategy):
    """
    Simple Moving Average Strategy
    Traditional MA crossover with RSI
    """
    
    def __init__(self, ma_fast=9, ma_slow=21, rsi_period=14, 
                 rsi_buy=40, rsi_sell=60, volume_multiplier=1.1):
        super().__init__(
            name="Simple MA Strategy",
            description="RSI + Simple Moving Average crossover"
        )
        
        self.parameters = {
            'ma_fast': ma_fast,
            'ma_slow': ma_slow,
            'rsi_period': rsi_period,
            'rsi_buy_threshold': rsi_buy,
            'rsi_sell_threshold': rsi_sell,
            'volume_multiplier': volume_multiplier
        }
    
    def calculate_indicators(self, data: pd.DataFrame) -> dict:
        """Calculate Simple MA and RSI indicators"""
        close = data['close']
        volume = data['volume']
        
        # RSI
        rsi = vbt.RSI.run(close, window=self.parameters['rsi_period']).rsi
        
        # Simple Moving Averages
        ma_fast = close.rolling(window=self.parameters['ma_fast']).mean()
        ma_slow = close.rolling(window=self.parameters['ma_slow']).mean()
        
        # Volume MA
        volume_ma = volume.rolling(window=20).mean()
        
        return {
            'rsi': rsi,
            'ma_fast': ma_fast,
            'ma_slow': ma_slow,
            'volume_ma': volume_ma,
            'close': close,
            'volume': volume
        }
    
    def generate_signals(self, indicators: dict) -> tuple:
        """Generate Simple MA based signals"""
        rsi = indicators['rsi']
        ma_fast = indicators['ma_fast']
        ma_slow = indicators['ma_slow']
        close = indicators['close']
        volume = indicators['volume']
        volume_ma = indicators['volume_ma']
        
        # Handle NaN values
        rsi_filled = rsi.fillna(50)
        ma_fast_filled = ma_fast.fillna(method='bfill').fillna(method='ffill')
        ma_slow_filled = ma_slow.fillna(method='bfill').fillna(method='ffill')
        volume_ma_filled = volume_ma.fillna(method='bfill').fillna(method='ffill')
        
        # Align series
        common_index = close.index
        rsi_aligned = rsi_filled.reindex(common_index, fill_value=50)
        ma_fast_aligned = ma_fast_filled.reindex(common_index, fill_value=float(close.iloc[0]))
        ma_slow_aligned = ma_slow_filled.reindex(common_index, fill_value=float(close.iloc[0]))
        volume_ma_aligned = volume_ma_filled.reindex(common_index, fill_value=float(volume.mean()))
        
        # Generate signals
        buy_signals = (
            (rsi_aligned < self.parameters['rsi_buy_threshold']) &
            (close > ma_fast_aligned) &
            (ma_fast_aligned > ma_slow_aligned) &
            (volume > volume_ma_aligned * self.parameters['volume_multiplier'])
        )
        
        sell_signals = (
            (rsi_aligned > self.parameters['rsi_sell_threshold']) |
            (close < ma_fast_aligned) |
            (ma_fast_aligned < ma_slow_aligned)
        )
        
        return buy_signals, sell_signals


class StrategyFactory:
    """Factory class to create different strategies"""
    
    @staticmethod
    def create_strategy(strategy_type: str, **kwargs) -> BaseStrategy:
        """Create a strategy instance"""
        # Import simple real strategy
        from .simple_real_strategy import (
            SimpleTwoCandleStrategy, SimpleTwoCandleLongShort
        )
        
        strategies = {
            'ema': EMAStrategy,
            'simple_ma': SimpleMAStrategy,
            'simple_two_candle': SimpleTwoCandleStrategy,
            'simple_long_short': SimpleTwoCandleLongShort
        }
        
        if strategy_type not in strategies:
            raise ValueError(f"Unknown strategy type: {strategy_type}")
        
        return strategies[strategy_type](**kwargs)
    
    @staticmethod
    def list_strategies() -> list:
        """List available strategies"""
        return [
            {
                'type': 'ema',
                'name': 'EMA Crossover Strategy',
                'description': 'RSI + EMA Trend Analysis (8,13,21,50)',
                'category': 'trend_following'
            },
            {
                'type': 'simple_ma',
                'name': 'Simple MA Strategy', 
                'description': 'RSI + Simple Moving Average crossover',
                'category': 'trend_following'
            },
            {
                'type': 'simple_two_candle',
                'name': 'Simple 2-Candle Strategy',
                'description': 'Long if 2nd candle > 1st candle, else short (REAL TRADING)',
                'category': 'simple_real'
            },
            {
                'type': 'simple_long_short',
                'name': 'Simple 2-Candle Long/Short',
                'description': 'Both long and short based on 2-candle comparison (REAL TRADING)',
                'category': 'simple_real'
            }
        ]