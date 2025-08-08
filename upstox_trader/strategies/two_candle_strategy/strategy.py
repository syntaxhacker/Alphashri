#!/usr/bin/env python3
"""
FIXED Two-Candle Strategy
Properly implements both LONG and SHORT trading based on candle comparison
REAL trading logic with proper exits
"""

import pandas as pd
import numpy as np
from datetime import time
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '../'))
from ema_strategy import BaseStrategy


class FixedTwoCandleStrategy(BaseStrategy):
    """
    ENHANCED Two-Candle Strategy - REAL Implementation
    - If 2nd candle > 1st candle by 0.05%+ → GO LONG
    - If 2nd candle < 1st candle by 0.05%+ → GO SHORT  
    - Enhanced exit logic with higher profit targets (3.0%) and trailing stops
    - Handles both directions correctly with advanced risk management
    """
    
    def __init__(self, profit_target=5.0, stop_loss=2.0, min_signal_strength=0.05, 
                 trailing_stop_enabled=True, trailing_stop_distance=1.0, 
                 initial_capital=100000, position_size_pct=10, use_sentiment_filter=True):
        super().__init__(
            name="SHORTS-ONLY 2-Candle Strategy",
            description="SHORT-only strategy with trailing stops and higher profit targets"
        )
        
        self.parameters = {
            'profit_target': profit_target,          # 5.0% profit target (increased)
            'stop_loss': stop_loss,                 # 2.0% stop loss (increased)
            'min_signal_strength': min_signal_strength,  # 0.05% minimum signal strength
            'trailing_stop_enabled': trailing_stop_enabled,  # Enable trailing stop
            'trailing_stop_distance': trailing_stop_distance,  # 1.0% trailing distance (increased)
            'initial_capital': initial_capital,      # Starting capital
            'position_size_pct': position_size_pct,  # Position size percentage
            'use_sentiment_filter': use_sentiment_filter  # Use stock sentiment filtering
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
        initial_capital = self.parameters['initial_capital']
        current_capital = initial_capital
        
        for date, group in daily_groups:
            if len(group) >= 2:
                day_result = self._analyze_single_day(date, group, current_capital, trading_data)
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
    
    def _calculate_stock_sentiment(self, data: pd.DataFrame, current_date) -> dict:
        """Calculate stock sentiment based on recent price action"""
        
        # Get data up to current date
        current_idx = data.index.get_loc(data[data.index.date == current_date].index[0])
        
        # Look back 5 days for sentiment calculation
        lookback_days = 5
        start_idx = max(0, current_idx - (lookback_days * 25))  # ~25 candles per day
        sentiment_data = data.iloc[start_idx:current_idx]
        
        if len(sentiment_data) < 10:  # Need minimum data
            return {
                'trend_direction': 'NEUTRAL',
                'trend_strength': 0.0,
                'recent_volatility': 0.0,
                'sentiment_score': 0.0
            }
        
        # Calculate trend metrics
        first_price = sentiment_data['close'].iloc[0]
        last_price = sentiment_data['close'].iloc[-1]
        trend_return = ((last_price - first_price) / first_price) * 100
        
        # Calculate volatility (standard deviation of returns)
        returns = sentiment_data['close'].pct_change().dropna()
        volatility = returns.std() * 100
        
        # Determine trend direction and strength
        if trend_return > 0.5:
            trend_direction = 'BULLISH'
        elif trend_return < -0.5:
            trend_direction = 'BEARISH'
        else:
            trend_direction = 'NEUTRAL'
        
        trend_strength = abs(trend_return)
        
        # Calculate sentiment score (-1 to +1)
        # Positive = bullish, Negative = bearish
        sentiment_score = max(-1, min(1, trend_return / 5))  # Normalize to -1 to +1
        
        return {
            'trend_direction': trend_direction,
            'trend_strength': trend_strength,
            'recent_volatility': volatility,
            'sentiment_score': sentiment_score,
            'lookback_return': trend_return
        }
    
    def _analyze_single_day(self, date, group, capital, full_data):
        """Analyze a single trading day with sentiment consideration"""
        
        # Get first and second candles
        first_candle = group.iloc[0]
        second_candle = group.iloc[1] 
        
        first_close = first_candle['close']
        second_close = second_candle['close']
        
        # Calculate signal strength
        price_diff_pct = ((second_close - first_close) / first_close) * 100
        
        # Calculate stock sentiment
        stock_sentiment = self._calculate_stock_sentiment(full_data, date)
        
        # Adjust signal strength based on sentiment alignment
        use_sentiment = self.parameters['use_sentiment_filter']
        adjusted_signal_strength = price_diff_pct
        
        if use_sentiment:
            sentiment_score = stock_sentiment['sentiment_score']
            
            # Amplify signals aligned with sentiment, dampen opposing signals
            if price_diff_pct < 0 and sentiment_score < 0:  # SHORT signal + bearish sentiment
                adjusted_signal_strength = price_diff_pct * (1 + abs(sentiment_score) * 0.5)
            elif price_diff_pct > 0 and sentiment_score > 0:  # LONG signal + bullish sentiment  
                adjusted_signal_strength = price_diff_pct * (1 + sentiment_score * 0.5)
            elif price_diff_pct < 0 and sentiment_score > 0:  # SHORT signal + bullish sentiment
                adjusted_signal_strength = price_diff_pct * (1 - sentiment_score * 0.3)
            elif price_diff_pct > 0 and sentiment_score < 0:  # LONG signal + bearish sentiment
                adjusted_signal_strength = price_diff_pct * (1 - abs(sentiment_score) * 0.3)
        
        # Determine if we have a valid signal
        min_strength = self.parameters['min_signal_strength']
        
        trade_direction = None
        trade_executed = False
        entry_price = None
        exit_price = None
        exit_reason = None
        pnl = 0
        
        # SHORTS ONLY - Ignore LONG signals, use adjusted signal strength
        if adjusted_signal_strength > min_strength:
            trade_direction = "LONG"
            trade_executed = False  # IGNORE LONG TRADES
            entry_price = None
            
        elif adjusted_signal_strength < -min_strength:
            trade_direction = "SHORT" 
            trade_executed = True   # ONLY TAKE SHORT TRADES
            entry_price = second_close
        
        # If trade executed, simulate the trade
        if trade_executed:
            exit_result = self._simulate_trade_exit(
                group, entry_price, trade_direction, start_idx=1
            )
            exit_price = exit_result['exit_price']
            exit_reason = exit_result['exit_reason']
            
            # Calculate P&L with configurable position size
            position_size_pct = self.parameters['position_size_pct'] / 100
            position_value = capital * position_size_pct
            
            if trade_direction == "LONG":
                pnl = (exit_price - entry_price) / entry_price * position_value
            else:  # SHORT
                pnl = (entry_price - exit_price) / entry_price * position_value
            
            # Subtract realistic brokerage costs
            brokerage_cost = min(position_value * 0.0006, 40)  # 0.06% total or ₹40 max
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
            'adjusted_signal_strength': adjusted_signal_strength,
            'stock_sentiment': stock_sentiment,
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
        """Simulate trade execution with trailing stop and find exit point"""
        
        profit_target_pct = self.parameters['profit_target'] / 100
        stop_loss_pct = self.parameters['stop_loss'] / 100
        trailing_enabled = self.parameters['trailing_stop_enabled']
        trailing_distance_pct = self.parameters['trailing_stop_distance'] / 100
        
        if direction == "LONG":
            target_price = entry_price * (1 + profit_target_pct)
            initial_stop_price = entry_price * (1 - stop_loss_pct)
            current_stop_price = initial_stop_price
            highest_price = entry_price
        else:  # SHORT
            target_price = entry_price * (1 - profit_target_pct)
            initial_stop_price = entry_price * (1 + stop_loss_pct)
            current_stop_price = initial_stop_price
            lowest_price = entry_price
        
        # Check each subsequent candle for exit conditions
        for i in range(start_idx + 1, len(group)):
            candle = group.iloc[i]
            high = candle['high']
            low = candle['low']
            close = candle['close']
            
            if direction == "LONG":
                # Update highest price seen
                if high > highest_price:
                    highest_price = high
                    
                    # Update trailing stop if enabled and we've hit profit target
                    if trailing_enabled and highest_price >= target_price:
                        new_trailing_stop = highest_price * (1 - trailing_distance_pct)
                        current_stop_price = max(current_stop_price, new_trailing_stop)
                
                # Check profit target hit
                if high >= target_price:
                    return {'exit_price': target_price, 'exit_reason': 'PROFIT_TARGET'}
                    
                # Check stop loss hit (initial or trailing)
                if low <= current_stop_price:
                    exit_reason = 'TRAILING_STOP' if current_stop_price > initial_stop_price else 'STOP_LOSS'
                    return {'exit_price': current_stop_price, 'exit_reason': exit_reason}
            
            else:  # SHORT
                # Update lowest price seen
                if low < lowest_price:
                    lowest_price = low
                    
                    # Update trailing stop if enabled and we've hit profit target
                    if trailing_enabled and lowest_price <= target_price:
                        new_trailing_stop = lowest_price * (1 + trailing_distance_pct)
                        current_stop_price = min(current_stop_price, new_trailing_stop)
                
                # Check profit target hit (price goes down)
                if low <= target_price:
                    return {'exit_price': target_price, 'exit_reason': 'PROFIT_TARGET'}
                    
                # Check stop loss hit (initial or trailing)
                if high >= current_stop_price:
                    exit_reason = 'TRAILING_STOP' if current_stop_price < initial_stop_price else 'STOP_LOSS'
                    return {'exit_price': current_stop_price, 'exit_reason': exit_reason}
        
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