import pandas as pd
import numpy as np
from abc import ABC, abstractmethod
import logging

class StrategyBase(ABC):
    """
    Base class for all trading strategies.
    This abstract class defines the interface that all strategies must implement.
    """
    
    def __init__(self, name="BaseStrategy"):
        """
        Initialize the strategy with a name and empty positions.
        
        Args:
            name (str): Name of the strategy
        """
        self.name = name
        self.positions = []
        self.trades = []
        self.logger = logging.getLogger(self.__class__.__name__)
        
    @abstractmethod
    def generate_signals(self, data):
        """
        Generate trading signals based on the strategy logic.
        Must be implemented by all strategy subclasses.
        
        Args:
            data (pd.DataFrame): DataFrame with OHLCV data and indicators
            
        Returns:
            pd.DataFrame: DataFrame with added signal column
        """
        pass
    
    def backtest(self, data, initial_capital=100000.0, position_size=0.1, commission=0.0):
        """
        Run backtest for the strategy on the given data.
        
        Args:
            data (pd.DataFrame): DataFrame with OHLCV data
            initial_capital (float): Initial capital for the backtest
            position_size (float): Fraction of capital to use per trade (0.0-1.0)
            commission (float): Commission per trade as a fraction
            
        Returns:
            pd.DataFrame: DataFrame with backtest results
        """
        # Make a copy of the data to avoid modifying the original
        df = data.copy()
        
        # Generate signals
        df = self.generate_signals(df)
        
        # Initialize backtest variables
        df['position'] = 0
        df['capital'] = initial_capital
        df['holdings'] = 0
        df['cash'] = initial_capital
        df['total_value'] = initial_capital
        df['returns'] = 0.0
        
        # Track active positions
        self.positions = []
        self.trades = []
        
        # Process each day in the backtest
        for i in range(1, len(df)):
            # Default values (no change from previous day)
            df.loc[df.index[i], 'position'] = df.loc[df.index[i-1], 'position']
            df.loc[df.index[i], 'cash'] = df.loc[df.index[i-1], 'cash']
            df.loc[df.index[i], 'holdings'] = df.loc[df.index[i-1], 'holdings']
            
            # Check buy signal: only buy if not already in a position
            if df.loc[df.index[i], 'signal'] == 'BUY' and df.loc[df.index[i-1], 'position'] == 0:
                # Calculate position size
                price = df.loc[df.index[i], 'close']
                cash_to_use = df.loc[df.index[i-1], 'cash'] * position_size
                shares_to_buy = int(cash_to_use / price)  # Integer number of shares
                
                # Update positions
                if shares_to_buy > 0:
                    cost = shares_to_buy * price * (1 + commission)
                    df.loc[df.index[i], 'cash'] = df.loc[df.index[i-1], 'cash'] - cost
                    df.loc[df.index[i], 'holdings'] = shares_to_buy * price
                    df.loc[df.index[i], 'position'] = 1
                    
                    # Record the trade
                    trade = {
                        'entry_time': df.index[i],
                        'entry_price': price,
                        'shares': shares_to_buy,
                        'direction': 'LONG',
                        'exit_time': None,
                        'exit_price': None,
                        'pnl': 0,
                        'pnl_pct': 0
                    }
                    self.trades.append(trade)
            
            # Check sell signal: only sell if in a long position
            elif df.loc[df.index[i], 'signal'] == 'SELL' and df.loc[df.index[i-1], 'position'] == 1:
                # Calculate position value
                price = df.loc[df.index[i], 'close']
                shares_to_sell = df.loc[df.index[i-1], 'holdings'] / df.loc[df.index[i-1], 'close']
                proceeds = shares_to_sell * price * (1 - commission)
                
                # Update positions
                df.loc[df.index[i], 'cash'] = df.loc[df.index[i-1], 'cash'] + proceeds
                df.loc[df.index[i], 'holdings'] = 0
                df.loc[df.index[i], 'position'] = 0
                
                # Update the last trade record with exit details
                if self.trades:
                    last_trade = self.trades[-1]
                    if last_trade['exit_time'] is None:
                        last_trade['exit_time'] = df.index[i]
                        last_trade['exit_price'] = price
                        last_trade['pnl'] = (price - last_trade['entry_price']) * last_trade['shares'] - \
                                           (commission * last_trade['entry_price'] * last_trade['shares']) - \
                                           (commission * price * last_trade['shares'])
                        last_trade['pnl_pct'] = (price / last_trade['entry_price'] - 1) * 100
            
            # Update holdings value based on current price (mark-to-market)
            if df.loc[df.index[i], 'position'] == 1:
                current_price = df.loc[df.index[i], 'close']
                shares = df.loc[df.index[i], 'holdings'] / df.loc[df.index[i-1], 'close']
                df.loc[df.index[i], 'holdings'] = shares * current_price
            
            # Calculate total value and returns
            df.loc[df.index[i], 'total_value'] = df.loc[df.index[i], 'cash'] + df.loc[df.index[i], 'holdings']
            df.loc[df.index[i], 'returns'] = (df.loc[df.index[i], 'total_value'] / df.loc[df.index[i-1], 'total_value']) - 1
        
        # Calculate cumulative returns
        df['cumulative_returns'] = (1 + df['returns']).cumprod() - 1
        
        # Calculate performance metrics
        self.calculate_performance_metrics(df)
        
        return df
    
    def calculate_performance_metrics(self, df):
        """
        Calculate performance metrics for the backtest.
        
        Args:
            df (pd.DataFrame): DataFrame with backtest results
            
        Returns:
            dict: Dictionary with performance metrics
        """
        # Calculate basic performance metrics
        start_value = df['total_value'].iloc[0]
        end_value = df['total_value'].iloc[-1]
        total_return = (end_value / start_value - 1) * 100
        
        # Calculate annualized return
        days = (df.index[-1] - df.index[0]).days
        annualized_return = ((1 + total_return / 100) ** (365 / max(days, 1)) - 1) * 100
        
        # Calculate Sharpe ratio (assuming 0% risk-free rate)
        daily_returns = df['returns']
        sharpe_ratio = np.sqrt(252) * daily_returns.mean() / daily_returns.std() if daily_returns.std() != 0 else 0
        
        # Calculate drawdown
        df['drawdown'] = 1 - df['total_value'] / df['total_value'].cummax()
        max_drawdown = df['drawdown'].max() * 100
        
        # Calculate win rate and profit factor
        wins = sum(1 for trade in self.trades if trade['pnl'] > 0)
        losses = sum(1 for trade in self.trades if trade['pnl'] <= 0)
        win_rate = (wins / max(wins + losses, 1)) * 100
        
        gross_profits = sum(trade['pnl'] for trade in self.trades if trade['pnl'] > 0)
        gross_losses = abs(sum(trade['pnl'] for trade in self.trades if trade['pnl'] <= 0))
        profit_factor = gross_profits / max(gross_losses, 1)
        
        # Store metrics in a dictionary
        self.metrics = {
            'start_value': start_value,
            'end_value': end_value,
            'total_return': total_return,
            'annualized_return': annualized_return,
            'sharpe_ratio': sharpe_ratio,
            'max_drawdown': max_drawdown,
            'win_rate': win_rate,
            'profit_factor': profit_factor,
            'num_trades': len(self.trades),
            'win_trades': wins,
            'loss_trades': losses
        }
        
        # Log the performance metrics
        self.logger.info(f"Strategy: {self.name}")
        self.logger.info(f"Total Return: {total_return:.2f}%")
        self.logger.info(f"Annualized Return: {annualized_return:.2f}%")
        self.logger.info(f"Sharpe Ratio: {sharpe_ratio:.2f}")
        self.logger.info(f"Max Drawdown: {max_drawdown:.2f}%")
        self.logger.info(f"Win Rate: {win_rate:.2f}%")
        self.logger.info(f"Profit Factor: {profit_factor:.2f}")
        self.logger.info(f"Total Trades: {len(self.trades)}")
        
        return self.metrics
    
    def get_trades_summary(self):
        """
        Create a summary DataFrame of all trades.
        
        Returns:
            pd.DataFrame: Summary of all trades
        """
        if not self.trades:
            return pd.DataFrame()
        
        trades_df = pd.DataFrame(self.trades)
        
        # Calculate additional metrics
        if not trades_df.empty and 'pnl' in trades_df.columns:
            trades_df['cumulative_pnl'] = trades_df['pnl'].cumsum()
            
            # Calculate trade duration if entry_time and exit_time are datetime
            if ('entry_time' in trades_df.columns and 'exit_time' in trades_df.columns and 
                pd.api.types.is_datetime64_dtype(trades_df['entry_time']) and
                pd.api.types.is_datetime64_dtype(trades_df['exit_time'])):
                # Calculate duration for completed trades
                completed_mask = ~trades_df['exit_time'].isna()
                trades_df.loc[completed_mask, 'duration'] = (
                    trades_df.loc[completed_mask, 'exit_time'] - 
                    trades_df.loc[completed_mask, 'entry_time']
                )
        
        return trades_df 