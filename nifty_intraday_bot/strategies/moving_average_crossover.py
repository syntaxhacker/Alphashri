import pandas as pd
import numpy as np
from .strategy_base import StrategyBase
import logging

class MovingAverageCrossover(StrategyBase):
    """
    Moving Average Crossover Strategy
    
    This strategy generates buy signals when a faster moving average crosses above a slower moving average,
    and sell signals when the faster moving average crosses below the slower moving average.
    """
    
    def __init__(self, fast_period=20, slow_period=50, name=None):
        """
        Initialize the strategy with the specified moving average periods.
        
        Args:
            fast_period (int): Period for the faster moving average
            slow_period (int): Period for the slower moving average
            name (str): Optional name for the strategy (defaults to a descriptive name)
        """
        if name is None:
            name = f"MA_Crossover_{fast_period}_{slow_period}"
        super().__init__(name=name)
        
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.logger = logging.getLogger(self.__class__.__name__)
        self.logger.info(f"Initialized {self.name} with fast_period={fast_period}, slow_period={slow_period}")
    
    def generate_signals(self, data):
        """
        Generate trading signals based on moving average crossovers.
        
        Args:
            data (pd.DataFrame): DataFrame with OHLCV data
            
        Returns:
            pd.DataFrame: DataFrame with added signal column
        """
        df = data.copy()
        
        # Ensure we have the required columns
        required_columns = ['close', f'SMA_{self.fast_period}', f'SMA_{self.slow_period}']
        missing_columns = [col for col in required_columns if col not in df.columns]
        
        # Calculate moving averages if not already in the dataframe
        if 'close' not in df.columns:
            self.logger.error("DataFrame must contain 'close' column")
            raise ValueError("DataFrame must contain 'close' column")
        
        if f'SMA_{self.fast_period}' not in df.columns:
            self.logger.info(f"Calculating SMA_{self.fast_period}")
            df[f'SMA_{self.fast_period}'] = df['close'].rolling(window=self.fast_period).mean()
            
        if f'SMA_{self.slow_period}' not in df.columns:
            self.logger.info(f"Calculating SMA_{self.slow_period}")
            df[f'SMA_{self.slow_period}'] = df['close'].rolling(window=self.slow_period).mean()
        
        # Initialize signal column with HOLD values (not 0)
        df['signal'] = 'HOLD'
        
        # Generate crossover signals
        # 'BUY' for buy (fast MA crosses above slow MA)
        # 'SELL' for sell (fast MA crosses below slow MA)
        # 'HOLD' for hold
        for i in range(1, len(df)):
            # Check if current fast MA is above slow MA and previous was below
            if (df[f'SMA_{self.fast_period}'].iloc[i] > df[f'SMA_{self.slow_period}'].iloc[i] and 
                df[f'SMA_{self.fast_period}'].iloc[i-1] <= df[f'SMA_{self.slow_period}'].iloc[i-1]):
                df.loc[df.index[i], 'signal'] = 'BUY'  # Use .loc instead of .iloc for assigning values
                
            # Check if current fast MA is below slow MA and previous was above
            elif (df[f'SMA_{self.fast_period}'].iloc[i] < df[f'SMA_{self.slow_period}'].iloc[i] and 
                  df[f'SMA_{self.fast_period}'].iloc[i-1] >= df[f'SMA_{self.slow_period}'].iloc[i-1]):
                df.loc[df.index[i], 'signal'] = 'SELL'  # Use .loc instead of .iloc for assigning values
        
        # Log signal summary
        buy_signals = (df['signal'] == 'BUY').sum()
        sell_signals = (df['signal'] == 'SELL').sum()
        self.logger.info(f"Generated {buy_signals} buy signals and {sell_signals} sell signals")
        
        return df
    
    def __str__(self):
        """String representation of the strategy"""
        return f"{self.name} (fast_period={self.fast_period}, slow_period={self.slow_period})" 