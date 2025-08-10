#!/usr/bin/env python3
"""
FIXED Two-Candle Strategy
Properly implements both LONG and SHORT trading based on candle comparison
REAL trading logic with proper exits
"""

import pandas as pd
import numpy as np
from datetime import time
from .ema_strategy import BaseStrategy


class FixedTwoCandleStrategy(BaseStrategy):
    """
    FIXED Two-Candle Strategy - REAL Implementation
    - If 2nd candle > 1st candle by 0.3%+ → GO LONG
    - If 2nd candle < 1st candle by 0.3%+ → GO SHORT  
    - Proper exit logic with profit targets and stop losses
    - Handles both directions correctly
    """
    
    def __init__(self, profit_target=1.5, stop_loss=1.0, min_signal_strength=0.3):
        super().__init__(
            name="FIXED 2-Candle Strategy",
            description="REAL Long/Short based on first two candles with proper exits"
        )
        
        self.parameters = {
            'profit_target': profit_target,          # 1.5% profit target
            'stop_loss': stop_loss,                 # 1.0% stop loss  
            'min_signal_strength': min_signal_strength  # 0.3% minimum signal strength
        }
    
    def analyze_complete_strategy(self, data: pd.DataFrame) -> dict:
        """
        Complete strategy analysis with proper long/short handling
        Returns detailed trade-by-trade results
        """
        
        # Get trading session data
        trading_mask = self._get_trading_session_mask(data.index)
        trading_data = data[trading_mask].copy()
        
        # Group by trading days
        daily_groups = trading_data.groupby(trading_data.index.date)
        
        trades = []
        daily_analysis = []
        total_pnl = 0
        initial_capital = 10000
        current_capital = initial_capital
        
        for date, group in daily_groups:
            if len(group) >= 2:
                day_result = self._analyze_single_day(date, group, current_capital)
                daily_analysis.append(day_result)
                
                if day_result['trade_executed']:
                    trades.append(day_result)
                    total_pnl += day_result['pnl']
                    current_capital += day_result['pnl']
        
        # Calculate summary statistics
        total_trades = len(trades)
        winning_trades = len([t for t in trades if t['pnl'] > 0])
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        
        return {
            'trades': trades,
            'daily_analysis': daily_analysis,
            'summary': {
                'total_trades': total_trades,
                'winning_trades': winning_trades,
                'losing_trades': total_trades - winning_trades,
                'win_rate': win_rate,
                'total_pnl': total_pnl,
                'total_return': (total_pnl / initial_capital) * 100,
                'final_capital': current_capital
            }
        }
    
    def _analyze_single_day(self, date, group, capital):
        """Analyze a single trading day"""
        
        # Get first and second candles
        first_candle = group.iloc[0]
        second_candle = group.iloc[1] 
        
        first_close = first_candle['close']
        second_close = second_candle['close']
        
        # Calculate signal strength
        price_diff_pct = ((second_close - first_close) / first_close) * 100
        
        # Determine if we have a valid signal
        min_strength = self.parameters['min_signal_strength']
        
        trade_direction = None
        trade_executed = False
        entry_price = None
        exit_price = None
        exit_reason = None
        pnl = 0
        
        if price_diff_pct > min_strength:
            trade_direction = "LONG"
            trade_executed = True
            entry_price = second_close
            
        elif price_diff_pct < -min_strength:
            trade_direction = "SHORT" 
            trade_executed = True
            entry_price = second_close
        
        # If trade executed, simulate the trade
        if trade_executed:
            exit_result = self._simulate_trade_exit(
                group, entry_price, trade_direction, start_idx=1
            )
            exit_price = exit_result['exit_price']
            exit_reason = exit_result['exit_reason']
            
            # Calculate P&L
            if trade_direction == "LONG":
                pnl = (exit_price - entry_price) / entry_price * capital * 0.1  # 10% position size
            else:  # SHORT
                pnl = (entry_price - exit_price) / entry_price * capital * 0.1  # 10% position size
            
            # Subtract realistic brokerage costs
            trade_value = capital * 0.1
            brokerage_cost = min(trade_value * 0.0006, 40)  # 0.06% total or ₹40 max
            pnl -= brokerage_cost
        
        # Calculate actual day performance for comparison
        day_open = group['open'].iloc[0] 
        day_close = group['close'].iloc[-1]
        actual_day_return = ((day_close - day_open) / day_open) * 100
        
        return {
            'date': date,
            'first_close': first_close,
            'second_close': second_close,
            'signal_strength': price_diff_pct,
            'trade_direction': trade_direction,
            'trade_executed': trade_executed,
            'entry_price': entry_price,
            'exit_price': exit_price,
            'exit_reason': exit_reason,
            'pnl': pnl,
            'actual_day_return': actual_day_return,
            'prediction_correct': self._was_prediction_correct(
                trade_direction, actual_day_return
            ) if trade_executed else None
        }
    
    def _simulate_trade_exit(self, group, entry_price, direction, start_idx):
        """Simulate trade execution and find exit point"""
        
        profit_target_pct = self.parameters['profit_target'] / 100
        stop_loss_pct = self.parameters['stop_loss'] / 100
        
        if direction == "LONG":
            target_price = entry_price * (1 + profit_target_pct)
            stop_price = entry_price * (1 - stop_loss_pct)
        else:  # SHORT
            target_price = entry_price * (1 - profit_target_pct)
            stop_price = entry_price * (1 + stop_loss_pct)
        
        # Check each subsequent candle for exit conditions
        for i in range(start_idx + 1, len(group)):
            candle = group.iloc[i]
            high = candle['high']
            low = candle['low']
            close = candle['close']
            
            if direction == "LONG":
                # Check profit target hit
                if high >= target_price:
                    return {'exit_price': target_price, 'exit_reason': 'PROFIT_TARGET'}
                # Check stop loss hit  
                if low <= stop_price:
                    return {'exit_price': stop_price, 'exit_reason': 'STOP_LOSS'}
            
            else:  # SHORT
                # Check profit target hit (price goes down)
                if low <= target_price:
                    return {'exit_price': target_price, 'exit_reason': 'PROFIT_TARGET'}
                # Check stop loss hit (price goes up)
                if high >= stop_price:
                    return {'exit_price': stop_price, 'exit_reason': 'STOP_LOSS'}
        
        # If no exit triggered, exit at session close
        final_close = group['close'].iloc[-1]
        return {'exit_price': final_close, 'exit_reason': 'SESSION_CLOSE'}
    
    def _was_prediction_correct(self, trade_direction, actual_day_return):
        """Check if our direction prediction was correct"""
        if trade_direction == "LONG":
            return actual_day_return > 0
        elif trade_direction == "SHORT":
            return actual_day_return < 0
        return None
    
    def _get_trading_session_mask(self, index: pd.DatetimeIndex) -> pd.Series:
        """Trading session from 9:15 AM to 3:15 PM"""
        start_time = time(9, 15)
        end_time = time(15, 15)
        
        time_mask = (index.time >= start_time) & (index.time <= end_time)
        return pd.Series(time_mask, index=index)
    
    def calculate_indicators(self, data: pd.DataFrame) -> dict:
        """Legacy method for compatibility - use analyze_complete_strategy instead"""
        return {}
    
    def generate_signals(self, indicators: dict) -> tuple:
        """Legacy method for compatibility - use analyze_complete_strategy instead"""
        # Return dummy signals
        dummy_signals = pd.Series(False, index=pd.RangeIndex(len(indicators.get('close', [0]))))
        return dummy_signals, dummy_signals