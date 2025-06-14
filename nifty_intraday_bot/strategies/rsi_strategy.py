import pandas as pd
import numpy as np
from .strategy_base import StrategyBase
import logging

class RSIMeanReversion(StrategyBase):
    """
    RSI Mean Reversion Strategy
    
    This strategy generates buy signals when RSI moves below the oversold threshold
    and sell signals when RSI moves above the overbought threshold.
    
    It is based on the idea that extreme RSI values tend to revert to the mean.
    """
    
    def __init__(self, period=14, oversold=30, overbought=70, exit_middle=True, name=None):
        """
        Initialize the RSI strategy with parameters.
        
        Args:
            period (int): RSI calculation period
            oversold (int): RSI threshold below which to generate buy signals
            overbought (int): RSI threshold above which to generate sell signals
            exit_middle (bool): If True, exit positions when RSI crosses the middle (50)
            name (str): Optional name for the strategy
        """
        if name is None:
            name = f"RSI_MeanReversion_{period}_{oversold}_{overbought}"
        super().__init__(name=name)
        
        self.period = period
        self.oversold = oversold
        self.overbought = overbought
        self.exit_middle = exit_middle
        self.logger = logging.getLogger(self.__class__.__name__)
        self.logger.info(f"Initialized {self.name} with period={period}, "
                        f"oversold={oversold}, overbought={overbought}")
    
    def generate_signals(self, data):
        """
        Generate trading signals based on RSI values.
        
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
        
        # Calculate RSI if not already in the dataframe
        if 'RSI' not in df.columns:
            self.logger.info(f"Calculating RSI_{self.period}")
            # Calculate price changes
            delta = df['close'].diff()
            
            # Separate gains and losses
            gain = delta.where(delta > 0, 0)
            loss = -delta.where(delta < 0, 0)
            
            # Calculate average gain and loss over the specified period
            avg_gain = gain.rolling(window=self.period).mean()
            avg_loss = loss.rolling(window=self.period).mean()
            
            # Calculate relative strength
            rs = avg_gain / avg_loss.where(avg_loss != 0, 1)
            
            # Calculate RSI
            df['RSI'] = 100 - (100 / (1 + rs))
        
        # Initialize signal column with HOLD values
        df['signal'] = 'HOLD'
        
        # Generate signals based on RSI thresholds
        for i in range(1, len(df)):
            # Buy signal: RSI crosses below oversold threshold
            if df['RSI'].iloc[i-1] >= self.oversold and df['RSI'].iloc[i] < self.oversold:
                df.loc[df.index[i], 'signal'] = 'BUY'
            
            # Sell signal: RSI crosses above overbought threshold
            elif df['RSI'].iloc[i-1] <= self.overbought and df['RSI'].iloc[i] > self.overbought:
                df.loc[df.index[i], 'signal'] = 'SELL'
            
            # Optional: Exit long positions when RSI crosses above 50 (middle)
            elif (self.exit_middle and df['RSI'].iloc[i-1] < 50 and df['RSI'].iloc[i] >= 50):
                df.loc[df.index[i], 'signal'] = 'SELL'  # Exit long position
            
            # Optional: Exit short positions when RSI crosses below 50 (middle)
            elif (self.exit_middle and df['RSI'].iloc[i-1] > 50 and df['RSI'].iloc[i] <= 50):
                df.loc[df.index[i], 'signal'] = 'BUY'  # Exit short position (or enter long)
        
        # Log signal summary
        buy_signals = (df['signal'] == 'BUY').sum()
        sell_signals = (df['signal'] == 'SELL').sum()
        self.logger.info(f"Generated {buy_signals} buy signals and {sell_signals} sell signals")
        
        return df
    
    def __str__(self):
        """String representation of the strategy"""
        exit_str = ", exit_at_middle=True" if self.exit_middle else ""
        return f"{self.name} (period={self.period}, oversold={self.oversold}, overbought={self.overbought}{exit_str})" 