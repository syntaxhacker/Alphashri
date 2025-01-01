import time
import logging
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd
import torch

from strategies.strategy_factory import StrategyFactory
from utils.gpu_utils import to_gpu, to_cpu

# Global variable from main file
USE_GPU = torch.cuda.is_available()

def run_backtest(df: pd.DataFrame, strategy_name: str, sl: float, tp: float, ps: float, 
                initial_balance: float) -> Tuple[float, Dict, Optional[pd.DataFrame]]:
    """Run a single backtest with given parameters"""
    try:
        # Create strategy instance
        strategy = StrategyFactory.create_strategy(
            strategy_name,
            stop_loss=sl,
            take_profit=tp,
            position_size=ps
        )
        
        # Calculate indicators (with GPU acceleration if available)
        df_indicators = df.copy()
        if USE_GPU:
            # Move price data to GPU for calculations
            gpu_data = {
                'high': to_gpu(df_indicators['high'].values),
                'low': to_gpu(df_indicators['low'].values),
                'close': to_gpu(df_indicators['close'].values),
                'volume': to_gpu(df_indicators['volume'].values)
            }
            
            # Calculate indicators on GPU
            strategy.calculate_indicators(df_indicators, gpu_data=gpu_data)
            
            # Move results back to CPU
            for col in df_indicators.columns:
                if torch.is_tensor(df_indicators[col].values):
                    df_indicators[col] = pd.Series(to_cpu(df_indicators[col].values), index=df_indicators.index)
        else:
            strategy.calculate_indicators(df_indicators)
        
        # Generate signals
        signals = strategy.generate_signals(df_indicators)
        del df_indicators  # Free memory
        
        # Initialize tracking variables
        trades = []
        balance = initial_balance
        position = False
        entry_price = 0
        position_size_units = 0
        
        # Run backtest with optimized loop
        for i in range(len(df)):
            current_price = float(df['close'].iloc[i])
            signal = signals.iloc[i]
            
            if not position and signal == 'BUY':
                position = True
                entry_price = current_price
                position_value = balance * ps
                position_size_units = position_value / current_price  # Calculate position size based on current balance
                
                trades.append({
                    'timestamp': df.index[i],
                    'action': 'BUY',
                    'price': current_price,
                    'size': position_size_units,
                    'balance': balance
                })
                
            elif position:
                # Check exit conditions
                exit_price = None
                exit_reason = None
                
                # Check stop loss
                if current_price <= entry_price * (1 - sl):
                    exit_price = current_price
                    exit_reason = 'Stop Loss'
                # Check take profit
                elif current_price >= entry_price * (1 + tp):
                    exit_price = current_price
                    exit_reason = 'Take Profit'
                # Check signal exit
                elif signal == 'SELL':
                    exit_price = current_price
                    exit_reason = 'Signal'
                
                if exit_price is not None:
                    pnl = (exit_price - entry_price) * position_size_units
                    balance += pnl
                    
                    trades.append({
                        'timestamp': df.index[i],
                        'action': 'SELL',
                        'price': exit_price,
                        'size': position_size_units,
                        'balance': balance,
                        'pnl': pnl,
                        'return': (pnl / initial_balance) * 100,
                        'reason': exit_reason
                    })
                    
                    position = False
                    entry_price = 0
                    position_size_units = 0
        
        if trades:
            # Convert trades to DataFrame efficiently
            trades_df = pd.DataFrame(trades)
            trades_df['cumulative_return'] = trades_df['return'].fillna(0).cumsum()
            total_return = trades_df['cumulative_return'].iloc[-1]
            
            params = {
                'strategy': strategy_name,
                'stop_loss': sl,
                'take_profit': tp,
                'position_size': ps
            }
            
            return total_return, params, trades_df
            
        return -float('inf'), None, None
        
    except Exception as e:
        logging.error(f"Error in backtest: {str(e)}")
        return -float('inf'), None, None

def run_backtest_benchmark(df: pd.DataFrame, strategy_name: str, sl: float, tp: float, ps: float, 
                initial_balance: float, use_gpu: bool = False) -> Tuple[float, Dict, Optional[pd.DataFrame], float]:
    """Run a single backtest with given parameters and return execution time"""
    start_time = time.time()
    try:
        # Create strategy instance
        strategy = StrategyFactory.create_strategy(
            strategy_name,
            stop_loss=sl,
            take_profit=tp,
            position_size=ps
        )
        
        # Calculate indicators
        df_indicators = df.copy()
        if use_gpu:
            # Move price data to GPU for calculations
            gpu_data = {
                'high': to_gpu(df_indicators['high'].values),
                'low': to_gpu(df_indicators['low'].values),
                'close': to_gpu(df_indicators['close'].values),
                'volume': to_gpu(df_indicators['volume'].values)
            }
            strategy.calculate_indicators(df_indicators, gpu_data=gpu_data)
        else:
            strategy.calculate_indicators(df_indicators)
            
        # Generate signals
        signals = strategy.generate_signals(df_indicators)
        
        # Run backtest
        trades = []
        balance = initial_balance
        position = False
        entry_price = 0
        position_size_units = 0
        
        for i in range(len(df)):
            current_price = float(df['close'].iloc[i])
            signal = signals.iloc[i]
            
            if not position and signal == 'BUY':
                position = True
                entry_price = current_price
                position_value = balance * ps
                position_size_units = position_value / current_price  # Calculate position size based on current balance
                
                trades.append({
                    'timestamp': df.index[i],
                    'action': 'BUY',
                    'price': current_price,
                    'size': position_size_units,
                    'balance': balance
                })
                
            elif position:
                # Check exit conditions
                exit_price = None
                exit_reason = None
                
                # Check stop loss
                if current_price <= entry_price * (1 - sl):
                    exit_price = current_price
                    exit_reason = 'Stop Loss'
                # Check take profit
                elif current_price >= entry_price * (1 + tp):
                    exit_price = current_price
                    exit_reason = 'Take Profit'
                # Check signal exit
                elif signal == 'SELL':
                    exit_price = current_price
                    exit_reason = 'Signal'
                
                if exit_price is not None:
                    pnl = (exit_price - entry_price) * position_size_units
                    balance += pnl
                    
                    trades.append({
                        'timestamp': df.index[i],
                        'action': 'SELL',
                        'price': exit_price,
                        'size': position_size_units,
                        'balance': balance,
                        'pnl': pnl,
                        'return': (pnl / initial_balance) * 100,
                        'reason': exit_reason
                    })
                    
                    position = False
                    entry_price = 0
                    position_size_units = 0
        
        execution_time = time.time() - start_time
        
        if trades:
            trades_df = pd.DataFrame(trades)
            trades_df['cumulative_return'] = trades_df['return'].fillna(0).cumsum()
            total_return = trades_df['cumulative_return'].iloc[-1]
            
            params = {
                'stop_loss': sl,
                'take_profit': tp,
                'position_size': ps
            }
            
            return total_return, params, trades_df, execution_time
            
        return -float('inf'), None, None, execution_time
        
    except Exception as e:
        logging.error(f"Error in backtest: {str(e)}")
        return -float('inf'), None, None, time.time() - start_time 