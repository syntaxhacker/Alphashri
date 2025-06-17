#!/usr/bin/env python3
"""
Unified Backtest Engine
Works with any strategy that inherits from BaseStrategy
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from strategies.base_strategy import BaseStrategy, TradeResult, StrategyResult
from dataclasses import dataclass


@dataclass
class Position:
    """Represents an open trading position"""
    side: str  # 'LONG' or 'SHORT'
    entry_time: datetime
    entry_price: float
    quantity: float
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    trailing_stop: Optional[float] = None
    entry_volume: Optional[float] = None  # Store entry volume for volume-based exits


class BacktestEngine:
    """Unified backtesting engine for all strategies"""
    
    def __init__(self, initial_capital: float = 10000.0):
        self.initial_capital = initial_capital
    
    def run_backtest(self, strategy: BaseStrategy, df: pd.DataFrame, symbol: str) -> StrategyResult:
        """Run backtest for any strategy"""
        
        # Generate signals using the strategy
        df_signals = strategy.generate_signals(df)
        
        # Initialize tracking variables
        capital = self.initial_capital
        position = None
        trades = []
        equity_curve = []
        
        # Daily loss tracking
        daily_start_capital = capital
        current_date = None
        max_capital = capital
        max_drawdown = 0.0
        
        # Get strategy parameters
        params = strategy.get_parameters()
        sl_percent = params.get('sl_percent', 2.0)
        tp_percent = params.get('tp_percent', None)
        trailing_stop_percent = params.get('trailing_stop_percent', None)
        position_size_percent = params.get('position_size_percent', 10.0)
        max_intraday_loss_percent = params.get('max_intraday_loss_percent', 2.0)
        min_hold_minutes = params.get('min_hold_minutes', 60)
        
        # Main backtest loop
        for i, (timestamp, row) in enumerate(df_signals.iterrows()):
            # Ensure price data integrity  
            if pd.isna(row['close']) or row['close'] <= 0:
                continue
            
            # Handle existing position
            if position:
                # Check advanced exit conditions first (for strategies that support them)
                advanced_exit = self._check_advanced_exit_conditions(position, row, timestamp, strategy)
                if advanced_exit:
                    trades.append(advanced_exit)
                    capital += advanced_exit.pnl
                    equity_curve.append({
                        'timestamp': timestamp,
                        'equity': capital,
                        'unrealized_pnl': 0
                    })
                    position = None
                    continue
                
                # Check regular exit conditions
                exit_trade = self._check_exit_conditions(
                    position, row, timestamp, sl_percent, tp_percent, 
                    trailing_stop_percent, min_hold_minutes
                )
                if exit_trade:
                    trades.append(exit_trade)
                    capital += exit_trade.pnl
                    equity_curve.append({
                        'timestamp': timestamp,
                        'equity': capital,
                        'unrealized_pnl': 0
                    })
                    position = None
                else:
                    # Update equity curve with unrealized P&L
                    unrealized_pnl = self._calculate_unrealized_pnl(position, row)
                    equity_curve.append({
                        'timestamp': timestamp,
                        'equity': capital + unrealized_pnl,
                        'unrealized_pnl': unrealized_pnl
                    })
            
            # Handle new position entries
            elif row['signal'] in ['LONG', 'SHORT']:
                position = self._open_position(
                    row, timestamp, capital, sl_percent, tp_percent, position_size_percent
                )
                equity_curve.append({
                    'timestamp': timestamp,
                    'equity': capital,
                    'unrealized_pnl': 0
                })
            else:
                # No position, no signal
                equity_curve.append({
                    'timestamp': timestamp,
                    'equity': capital,
                    'unrealized_pnl': 0
                })
            
            # Track max drawdown
            current_equity = equity_curve[-1]['equity']
            if current_equity > max_capital:
                max_capital = current_equity
            drawdown = (max_capital - current_equity) / max_capital * 100
            max_drawdown = max(max_drawdown, drawdown)
        
        # Close final position
        if position:
            final_row = df_signals.iloc[-1]
            final_timestamp = df_signals.index[-1]
            exit_trade = self._close_position(position, final_row, final_timestamp, "END_OF_DATA")
            trades.append(exit_trade)
            capital += exit_trade.pnl
        
        # Create results
        return self._create_strategy_result(
            strategy, symbol, df_signals.index[0], df_signals.index[-1],
            capital, trades, equity_curve, max_drawdown, df
        )
    
    def _open_position(self, row: pd.Series, timestamp: datetime, capital: float,
                      sl_percent: float, tp_percent: Optional[float], 
                      position_size_percent: float) -> Position:
        """Open a new position"""
        side = row['signal']
        entry_price = row['close']
        
        # Calculate position size
        position_value = capital * (position_size_percent / 100)
        quantity = position_value / entry_price
        
        # Calculate stop loss and take profit
        if side == 'LONG':
            stop_loss = entry_price * (1 - sl_percent / 100)
            take_profit = entry_price * (1 + tp_percent / 100) if tp_percent else None
        else:  # SHORT
            stop_loss = entry_price * (1 + sl_percent / 100)
            take_profit = entry_price * (1 - tp_percent / 100) if tp_percent else None
        
        # Store entry volume for volume-based exits
        entry_volume = row.get('entry_volume', row.get('volume', 0))
        
        return Position(
            side=side,
            entry_time=timestamp,
            entry_price=entry_price,
            quantity=quantity,
            stop_loss=stop_loss,
            take_profit=take_profit,
            entry_volume=entry_volume
        )
    
    def _check_exit_conditions(self, position: Position, row: pd.Series, timestamp: datetime,
                              sl_percent: float, tp_percent: Optional[float], 
                              trailing_stop_percent: Optional[float], min_hold_minutes: int) -> Optional[TradeResult]:
        """Check if position should be exited"""
        current_price = row['close']
        
        # Check minimum hold time for non-critical exits
        hold_time = timestamp - position.entry_time
        min_hold_respected = hold_time.total_seconds() >= (min_hold_minutes * 60)
        
        # Check stop loss (always respected)
        if position.side == 'LONG':
            if current_price <= position.stop_loss:
                return self._close_position(position, row, timestamp, "STOP_LOSS")
        else:  # SHORT
            if current_price >= position.stop_loss:
                return self._close_position(position, row, timestamp, "STOP_LOSS")
        
        # Check take profit (only if min hold time respected)
        if min_hold_respected and position.take_profit:
            if position.side == 'LONG' and current_price >= position.take_profit:
                return self._close_position(position, row, timestamp, "TAKE_PROFIT")
            elif position.side == 'SHORT' and current_price <= position.take_profit:
                return self._close_position(position, row, timestamp, "TAKE_PROFIT")
        
        # Update trailing stop (activated when profit reaches half of take profit)
        if trailing_stop_percent and min_hold_respected and position.take_profit:
            if position.side == 'LONG':
                # Calculate half take profit level
                half_tp_level = position.entry_price + (position.take_profit - position.entry_price) * 0.5
                
                if position.trailing_stop is None and current_price >= half_tp_level:
                    # Activate trailing stop when reaching half take profit
                    position.trailing_stop = current_price * (1 - trailing_stop_percent / 100)
                elif position.trailing_stop:
                    new_trailing = current_price * (1 - trailing_stop_percent / 100)
                    if new_trailing > position.trailing_stop:
                        position.trailing_stop = new_trailing
                    if current_price <= position.trailing_stop:
                        return self._close_position(position, row, timestamp, "TRAILING_STOP")
            else:  # SHORT
                # Calculate half take profit level for short
                half_tp_level = position.entry_price - (position.entry_price - position.take_profit) * 0.5
                
                if position.trailing_stop is None and current_price <= half_tp_level:
                    # Activate trailing stop when reaching half take profit
                    position.trailing_stop = current_price * (1 + trailing_stop_percent / 100)
                elif position.trailing_stop:
                    new_trailing = current_price * (1 + trailing_stop_percent / 100)
                    if new_trailing < position.trailing_stop:
                        position.trailing_stop = new_trailing
                    if current_price >= position.trailing_stop:
                        return self._close_position(position, row, timestamp, "TRAILING_STOP")
        
        return None
    
    def _check_advanced_exit_conditions(self, position: Position, row: pd.Series, timestamp: datetime,
                                      strategy: BaseStrategy) -> Optional[TradeResult]:
        """Check advanced exit conditions for strategies like Breakout"""
        if not hasattr(strategy, 'parameters') or 'quick_exit_percent' not in strategy.parameters:
            return None
            
        current_price = row['close']
        params = strategy.parameters
        
        # 1. Quick Exit Mechanism - small losses before full stop loss
        quick_exit_pct = params.get('quick_exit_percent', 0.8)
        if position.side == 'LONG':
            quick_exit_price = position.entry_price * (1 - quick_exit_pct / 100)
            if current_price <= quick_exit_price:
                return self._close_position(position, row, timestamp, "QUICK_EXIT")
        else:  # SHORT
            quick_exit_price = position.entry_price * (1 + quick_exit_pct / 100)
            if current_price >= quick_exit_price:
                return self._close_position(position, row, timestamp, "QUICK_EXIT")
        
        # 2. Momentum-Based Exit
        if 'price_momentum' in row:
            momentum = row['price_momentum']
            if not pd.isna(momentum):
                if position.side == 'LONG' and momentum < -0.01:  # Negative momentum for longs
                    return self._close_position(position, row, timestamp, "MOMENTUM_EXIT")
                elif position.side == 'SHORT' and momentum > 0.01:  # Positive momentum for shorts
                    return self._close_position(position, row, timestamp, "MOMENTUM_EXIT")
        
        # 3. Volume Confirmation Exit
        volume_threshold = params.get('volume_exit_threshold', 0.7)
        if hasattr(position, 'entry_volume') and position.entry_volume > 0:
            if row['volume'] < position.entry_volume * volume_threshold:
                # Only exit on volume drop if position is at a loss
                # Let profitable positions run with trailing stops
                current_pnl = 0
                if position.side == 'LONG':
                    current_pnl = (current_price - position.entry_price) * position.quantity
                else:  # SHORT
                    current_pnl = (position.entry_price - current_price) * position.quantity
                
                # Only volume exit if we're losing money
                if current_pnl <= 0:
                    return self._close_position(position, row, timestamp, "VOLUME_EXIT")
        
        # 4. Breakout Failure Detection
        failure_threshold = params.get('breakout_failure_threshold', 0.5)
        if 'range_high' in row and 'range_low' in row:
            range_high = row['range_high']
            range_low = row['range_low']
            if not pd.isna(range_high) and not pd.isna(range_low):
                range_size = range_high - range_low
                if position.side == 'LONG':
                    # Check if price returned to upper portion of previous range
                    failure_level = range_high - (range_size * failure_threshold)
                    if current_price <= failure_level:
                        return self._close_position(position, row, timestamp, "BREAKOUT_FAILURE")
                else:  # SHORT
                    # Check if price returned to lower portion of previous range
                    failure_level = range_low + (range_size * failure_threshold)
                    if current_price >= failure_level:
                        return self._close_position(position, row, timestamp, "BREAKOUT_FAILURE")
        
        # 5. RSI-Based Exit
        if 'rsi' in row:
            rsi = row['rsi']
            rsi_oversold = params.get('rsi_oversold', 25)
            rsi_overbought = params.get('rsi_overbought', 75)
            
            if not pd.isna(rsi):
                if position.side == 'LONG' and rsi <= rsi_oversold:
                    return self._close_position(position, row, timestamp, "RSI_OVERSOLD")
                elif position.side == 'SHORT' and rsi >= rsi_overbought:
                    return self._close_position(position, row, timestamp, "RSI_OVERBOUGHT")
        
        return None
    
    def _close_position(self, position: Position, row: pd.Series, timestamp: datetime, reason: str) -> TradeResult:
        """Close position and calculate PnL"""
        exit_price = row['close']
        
        if position.side == 'LONG':
            pnl = (exit_price - position.entry_price) * position.quantity
        else:  # SHORT
            pnl = (position.entry_price - exit_price) * position.quantity
        
        pnl_percent = (pnl / (position.entry_price * position.quantity)) * 100
        
        return TradeResult(
            entry_time=position.entry_time,
            exit_time=timestamp,
            entry_price=position.entry_price,
            exit_price=exit_price,
            side=position.side,
            quantity=position.quantity,
            pnl=pnl,
            pnl_percent=pnl_percent,
            exit_reason=reason,
            stop_loss=position.stop_loss,
            take_profit=position.take_profit
        )
    
    def _calculate_unrealized_pnl(self, position: Position, row: pd.Series) -> float:
        """Calculate unrealized PnL"""
        current_price = row['close']
        
        if position.side == 'LONG':
            return (current_price - position.entry_price) * position.quantity
        else:  # SHORT
            return (position.entry_price - current_price) * position.quantity
    
    def _create_strategy_result(self, strategy: BaseStrategy, symbol: str, start_date: datetime,
                               end_date: datetime, final_capital: float, trades: List[TradeResult],
                               equity_curve: List[Dict], max_drawdown: float, raw_data: pd.DataFrame) -> StrategyResult:
        """Create comprehensive strategy results"""
        
        # Basic metrics
        total_return = final_capital - self.initial_capital
        total_return_percent = (total_return / self.initial_capital) * 100
        
        # Trade statistics
        total_trades = len(trades)
        winning_trades = len([t for t in trades if t.pnl > 0])
        losing_trades = len([t for t in trades if t.pnl < 0])
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        
        # Average win/loss
        wins = [t.pnl for t in trades if t.pnl > 0]
        losses = [t.pnl for t in trades if t.pnl < 0]
        avg_win = np.mean(wins) if wins else 0
        avg_loss = np.mean(losses) if losses else 0
        
        # Profit factor
        total_wins = sum(wins) if wins else 0
        total_losses = abs(sum(losses)) if losses else 0
        profit_factor = total_wins / total_losses if total_losses > 0 else 0
        
        # Equity curve DataFrame
        equity_df = pd.DataFrame(equity_curve)
        if not equity_df.empty:
            equity_df.set_index('timestamp', inplace=True)
        
        # Daily returns for Sharpe ratio
        if not equity_df.empty:
            daily_equity = equity_df['equity'].resample('D').last()
            daily_returns = daily_equity.pct_change().dropna()
            sharpe_ratio = (daily_returns.mean() / daily_returns.std()) * np.sqrt(252) if len(daily_returns) > 1 else 0
        else:
            daily_returns = pd.Series()
            sharpe_ratio = 0
        
        return StrategyResult(
            strategy_name=strategy.get_display_name(),
            symbol=symbol,
            timeframe="15m",
            start_date=start_date,
            end_date=end_date,
            initial_capital=self.initial_capital,
            final_capital=final_capital,
            total_return=total_return,
            total_return_percent=total_return_percent,
            total_trades=total_trades,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate=win_rate,
            avg_win=avg_win,
            avg_loss=avg_loss,
            max_drawdown=max_drawdown,
            max_drawdown_percent=max_drawdown,
            sharpe_ratio=sharpe_ratio,
            profit_factor=profit_factor,
            trades=trades,
            equity_curve=equity_df,
            daily_returns=daily_returns,
            parameters=strategy.get_parameters(),
            raw_data=raw_data
        ) 