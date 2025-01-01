from typing import Dict, Optional

import pandas as pd

class BaseStrategy:
    def __init__(self, stop_loss: float = 0.02, take_profit: float = 0.04, position_size: float = 0.1):
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.position_size = position_size
        
    def calculate_indicators(self, df: pd.DataFrame, gpu_data: Optional[Dict] = None) -> None:
        """Calculate technical indicators for the strategy"""
        raise NotImplementedError("Subclass must implement calculate_indicators")
        
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals based on indicators"""
        raise NotImplementedError("Subclass must implement generate_signals") 