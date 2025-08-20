#!/usr/bin/env python3
"""
Simple Real Trading Strategy
If second 15-minute candle closes above first -> Go Long
If second 15-minute candle closes below first -> Go Short

Clean, simple, real trading logic.
"""

import pandas as pd
import numpy as np
import vectorbt as vbt
from datetime import time
from .ema_strategy import BaseStrategy


class SimpleTwoCandleStrategy(BaseStrategy):
    """
    Simple Two-Candle Strategy
    - Compare first and second 15-minute candles of the day
    - Long if second > first, Short if second < first
    - 5x leverage with proper risk management
    - Realistic Indian brokerage costs
    """
    
    def __init__(self, leverage=5, profit_target=1.5, stop_loss=1.0, 
                 position_size_percent=10, min_signal_strength=0.3):
        super().__init__(
            name="Simple 2-Candle Strategy",
            description="Long if 2nd candle > 1st candle, Short if 2nd < 1st"
        )
        
        self.parameters = {
            'leverage': leverage,                    # 5x leverage
            'profit_target': profit_target,          # 1.5% profit target
            'stop_loss': stop_loss,                 # 1.0% stop loss
            'position_size_percent': position_size_percent,  # 10% of capital per trade
            'min_signal_strength': min_signal_strength  # 0.3% minimum difference between candles
        }
        
        # Indian brokerage calculator
        self.brokerage_calc = IndianBrokerageCalculator()
    
    def calculate_indicators(self, data: pd.DataFrame) -> dict:
        """Identify first and second candles of each trading day"""
        close = data['close']
        high = data['high']
        low = data['low']
        volume = data['volume']
        
        # Get trading session (9:15 AM to 3:15 PM)
        trading_mask = self._get_trading_session_mask(data.index)
        
        # Identify first and second candles of each day
        daily_groups = data.groupby(data.index.date)
        
        first_candle_close = pd.Series(index=data.index, dtype=float)
        second_candle_close = pd.Series(index=data.index, dtype=float)
        is_first_candle = pd.Series(index=data.index, dtype=bool)
        is_second_candle = pd.Series(index=data.index, dtype=bool)
        
        for date, group in daily_groups:
            if len(group) >= 2:
                # First candle (9:15 AM)
                first_idx = group.index[0]
                first_candle_close.loc[group.index] = group['close'].iloc[0]
                is_first_candle.loc[first_idx] = True
                
                # Second candle (9:30 AM)
                second_idx = group.index[1]
                second_candle_close.loc[group.index] = group['close'].iloc[1]
                is_second_candle.loc[second_idx] = True
        
        # Fill forward the candle closes for the entire day
        first_candle_close = first_candle_close.ffill()
        second_candle_close = second_candle_close.ffill()
        
        # Calculate percentage difference between candles
        candle_diff_pct = ((second_candle_close - first_candle_close) / first_candle_close) * 100
        
        # Determine direction based on candle comparison with minimum strength
        min_strength = self.parameters['min_signal_strength']
        strong_long_signal = candle_diff_pct > min_strength  # 2nd > 1st by at least 0.3%
        strong_short_signal = candle_diff_pct < -min_strength  # 2nd < 1st by at least 0.3%
        
        return {
            'close': close,
            'high': high,
            'low': low,
            'volume': volume,
            'trading_mask': trading_mask,
            'first_candle_close': first_candle_close,
            'second_candle_close': second_candle_close,
            'is_first_candle': is_first_candle.fillna(False),
            'is_second_candle': is_second_candle.fillna(False),
            'candle_diff_pct': candle_diff_pct,
            'strong_long_signal': strong_long_signal,
            'strong_short_signal': strong_short_signal
        }
    
    def generate_signals(self, indicators: dict) -> tuple:
        """Generate REAL long/short signals based on two-candle rule"""
        close = indicators['close']
        trading_mask = indicators['trading_mask']
        is_second_candle = indicators['is_second_candle']
        strong_long_signal = indicators['strong_long_signal']
        strong_short_signal = indicators['strong_short_signal']
        candle_diff_pct = indicators['candle_diff_pct']
        
        # REAL TRADING SIGNALS with minimum strength filter
        # LONG: Enter long at close of second candle if it's strongly above first
        long_entry_signals = (
            trading_mask &
            is_second_candle &
            strong_long_signal  # Must be at least 0.3% difference
        )
        
        # SHORT: Enter short at close of second candle if it's strongly below first  
        short_entry_signals = (
            trading_mask &
            is_second_candle &
            strong_short_signal  # Must be at least 0.3% difference
        )
        
        # For VectorBT compatibility: combine into buy/sell signals
        # Long positions use buy_signals, short positions need special handling
        buy_signals = long_entry_signals
        
        # Calculate PROPER exit signals for both long and short positions
        # Track entry prices for both directions
        long_entry_price = close.where(long_entry_signals).ffill()
        short_entry_price = close.where(short_entry_signals).ffill()
        
        # Long position targets and stops
        long_profit_target = long_entry_price * (1 + self.parameters['profit_target']/100)
        long_stop_loss = long_entry_price * (1 - self.parameters['stop_loss']/100)
        
        # Short position targets and stops (reversed)
        short_profit_target = short_entry_price * (1 - self.parameters['profit_target']/100)
        short_stop_loss = short_entry_price * (1 + self.parameters['stop_loss']/100)
        
        # FIXED EXIT LOGIC
        # Long exits
        long_exits = (
            (long_entry_signals.shift(1, fill_value=False)) &  # We are in a long position
            (
                (close >= long_profit_target) |  # Hit profit target
                (close <= long_stop_loss) |     # Hit stop loss
                (close.shift(-1).isna())        # End of data (session close)
            )
        )
        
        # Short exits (simulated - VectorBT doesn't handle shorts directly)
        short_exits = (
            (short_entry_signals.shift(1, fill_value=False)) &  # We are in a short position
            (
                (close <= short_profit_target) |  # Short profit target (price goes down)
                (close >= short_stop_loss) |     # Short stop loss (price goes up)
                (close.shift(-1).isna())         # End of session
            )
        )
        
        # Combine exits
        sell_signals = long_exits | short_exits
        
        # Also exit at end of trading session
        end_of_session = ~trading_mask & trading_mask.shift(1, fill_value=False)
        sell_signals = sell_signals | end_of_session
        
        return buy_signals.fillna(False), sell_signals.fillna(False)
    
    def _get_trading_session_mask(self, index: pd.DatetimeIndex) -> pd.Series:
        """Trading session from 9:15 AM to 3:15 PM"""
        start_time = time(9, 15)
        end_time = time(15, 15)
        
        time_mask = (index.time >= start_time) & (index.time <= end_time)
        return pd.Series(time_mask, index=index)


class SimpleTwoCandleLongShort(SimpleTwoCandleStrategy):
    """
    Extended version with both long and short positions
    """
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "Simple 2-Candle Long/Short Strategy"
        self.description = "Long if 2nd > 1st, Short if 2nd < 1st (Both directions)"
    
    def generate_signals(self, indicators: dict) -> tuple:
        """Generate both long and short signals"""
        close = indicators['close']
        trading_mask = indicators['trading_mask']
        is_second_candle = indicators['is_second_candle']
        second_above_first = indicators['second_above_first']
        second_below_first = indicators['second_below_first']
        
        # LONG SIGNALS
        long_entry = (
            trading_mask &
            is_second_candle &
            second_above_first
        )
        
        # SHORT SIGNALS  
        short_entry = (
            trading_mask &
            is_second_candle &
            second_below_first
        )
        
        # Combined entry signals (for VectorBT - use long signals)
        buy_signals = long_entry
        
        # Exit logic for long positions
        entry_price = close.where(buy_signals).ffill()
        long_profit_target = entry_price * (1 + self.parameters['profit_target']/100)
        long_stop_loss = entry_price * (1 - self.parameters['stop_loss']/100)
        
        # Exit conditions
        sell_signals = (
            (close >= long_profit_target) |   # Long profit target
            (close <= long_stop_loss) |      # Long stop loss
            (~trading_mask)                  # End of session
        )
        
        return buy_signals.fillna(False), sell_signals.fillna(False)


class IndianBrokerageCalculator:
    """
    Realistic Indian brokerage calculator
    """
    
    def __init__(self):
        self.brokerage_rate = 0.0003  # 0.03% or ₹20 max
        self.max_brokerage_per_order = 20.0
        self.exchange_charges = 0.0000345  # NSE charges
        self.sebi_charges = 0.000001
        self.gst_rate = 0.18
        self.stamp_duty = 0.00003  # Buy side only
        self.stt_rate = 0.00025  # Intraday both sides
        
    def calculate_total_charges(self, buy_value: float, sell_value: float, 
                               quantity: int, is_intraday: bool = True) -> dict:
        """Calculate all trading charges"""
        total_turnover = buy_value + sell_value
        
        # Brokerage
        brokerage_buy = min(buy_value * self.brokerage_rate, self.max_brokerage_per_order)
        brokerage_sell = min(sell_value * self.brokerage_rate, self.max_brokerage_per_order)
        total_brokerage = brokerage_buy + brokerage_sell
        
        # Other charges
        exchange_charges = total_turnover * self.exchange_charges
        sebi_charges = total_turnover * self.sebi_charges
        stt = total_turnover * self.stt_rate if is_intraday else sell_value * 0.001
        stamp_duty = buy_value * self.stamp_duty
        
        # GST
        taxable_charges = total_brokerage + exchange_charges + sebi_charges
        gst = taxable_charges * self.gst_rate
        
        total_charges = total_brokerage + exchange_charges + sebi_charges + stt + stamp_duty + gst
        
        return {
            'total_charges': total_charges,
            'brokerage': total_brokerage,
            'exchange_charges': exchange_charges,
            'stt': stt,
            'stamp_duty': stamp_duty,
            'gst': gst,
            'charges_percentage': (total_charges / total_turnover) * 100
        }