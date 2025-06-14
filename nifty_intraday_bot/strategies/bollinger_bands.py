import pandas as pd
import numpy as np
from .strategy_base import StrategyBase
import logging

class BollingerBands(StrategyBase):
    """
    Bollinger Bands Strategy
    
    This strategy utilizes Bollinger Bands for both breakout and mean-reversion trading.
    In breakout mode, it generates buy signals when price breaks above upper band 
    and sell signals when price breaks below lower band.
    In mean-reversion mode, it generates buy signals when price touches lower band
    and sell signals when price touches upper band.
    """
    
    def __init__(self, period=20, std_dev=2.0, mode='mean_reversion', name=None):
        """
        Initialize the Bollinger Bands strategy with parameters.
        
        Args:
            period (int): Period for moving average calculation
            std_dev (float): Number of standard deviations for the bands
            mode (str): Trading mode ('mean_reversion' or 'breakout')
            name (str): Optional name for the strategy
        """
        if name is None:
            name = f"BB_{mode.capitalize()}_{period}_{std_dev}"
        super().__init__(name=name)
        
        self.period = period
        self.std_dev = std_dev
        
        if mode not in ['mean_reversion', 'breakout']:
            raise ValueError("Mode must be 'mean_reversion' or 'breakout'")
        self.mode = mode
        
        self.logger = logging.getLogger(self.__class__.__name__)
        self.logger.info(f"Initialized {self.name} with period={period}, "
                       f"std_dev={std_dev}, mode={mode}")
    
    def generate_signals(self, data):
        """
        Generate trading signals based on Bollinger Bands.
        
        Args:
            data (pd.DataFrame): DataFrame with OHLCV data
            
        Returns:
            pd.DataFrame: DataFrame with added signal column
        """
        df = data.copy()
        
        # Ensure we have the required columns
        if 'close' not in df.columns:
            self.logger.error("DataFrame must contain 'close' column")
            raise ValueError("DataFrame must contain 'close' column")
        
        # Check if Bollinger Bands are already calculated
        bb_columns = ['BB_middle', 'BB_upper', 'BB_lower']
        missing_columns = [col for col in bb_columns if col not in df.columns]
        
        # Calculate Bollinger Bands if not already present
        if missing_columns:
            self.logger.info(f"Calculating Bollinger Bands with period={self.period}, std_dev={self.std_dev}")
            df['BB_middle'] = df['close'].rolling(window=self.period).mean()
            std = df['close'].rolling(window=self.period).std()
            df['BB_upper'] = df['BB_middle'] + (std * self.std_dev)
            df['BB_lower'] = df['BB_middle'] - (std * self.std_dev)
        
        # Initialize signal column with HOLD values
        df['signal'] = 'HOLD'
        
        # Generate signals based on strategy mode
        for i in range(1, len(df)):
            if self.mode == 'mean_reversion':
                # Mean reversion strategy: Buy at lower band, sell at upper band
                # Buy signal: price crosses below lower band and then back above it
                if (df['close'].iloc[i-1] <= df['BB_lower'].iloc[i-1] and 
                    df['close'].iloc[i] > df['BB_lower'].iloc[i]):
                    df.loc[df.index[i], 'signal'] = 'BUY'
                
                # Sell signal: price crosses above upper band and then back below it
                elif (df['close'].iloc[i-1] >= df['BB_upper'].iloc[i-1] and 
                      df['close'].iloc[i] < df['BB_upper'].iloc[i]):
                    df.loc[df.index[i], 'signal'] = 'SELL'
            
            else:  # breakout mode
                # Breakout strategy: Buy on breakout above upper band, sell on breakout below lower band
                # Buy signal: price breaks above upper band
                if (df['close'].iloc[i-1] <= df['BB_upper'].iloc[i-1] and 
                    df['close'].iloc[i] > df['BB_upper'].iloc[i]):
                    df.loc[df.index[i], 'signal'] = 'BUY'
                
                # Sell signal: price breaks below lower band
                elif (df['close'].iloc[i-1] >= df['BB_lower'].iloc[i-1] and 
                      df['close'].iloc[i] < df['BB_lower'].iloc[i]):
                    df.loc[df.index[i], 'signal'] = 'SELL'
        
        # Log signal summary
        buy_signals = (df['signal'] == 'BUY').sum()
        sell_signals = (df['signal'] == 'SELL').sum()
        self.logger.info(f"Generated {buy_signals} buy signals and {sell_signals} sell signals")
        
        return df
    
    def __str__(self):
        """String representation of the strategy"""
        return f"{self.name} (period={self.period}, std_dev={self.std_dev}, mode='{self.mode}')" 