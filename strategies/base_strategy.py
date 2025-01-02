import pandas as pd
import numpy as np
from typing import Optional, Dict
import time
from collections import deque

class BaseStrategy:
    def __init__(self):
        # Historical data management
        self.historical_data = deque(maxlen=100)  # Keep last 100 price points
        self.min_data_points = 20  # Minimum data points needed for signals
        
        # Trade tracking
        self.last_trade_time = 0
        self.position_entry_time = 0
        self.entry_price = None
        
        # Default parameters (can be overridden by child classes)
        self.min_trade_interval = 5  # seconds
        self.max_trade_duration = 300  # seconds
        self.stop_loss = 0.001  # 0.1%
        self.take_profit = 0.002  # 0.2%
        self.max_spread_pct = 0.0005  # 0.05%
        
    def update_historical_data(self, new_data: Dict) -> None:
        """Update historical price data"""
        self.historical_data.append(new_data)
        
    def get_dataframe(self) -> pd.DataFrame:
        """Convert historical data to DataFrame"""
        if not self.historical_data:
            return pd.DataFrame()
        return pd.DataFrame(list(self.historical_data))
        
    def check_trade_conditions(self, current_position: str, current_bid: float, current_ask: float) -> bool:
        """Check basic trading conditions"""
        current_time = time.time()
        
        # Check spread
        if current_bid and current_ask:
            spread_pct = (current_ask - current_bid) / current_bid
            if spread_pct > self.max_spread_pct:
                return False
                
        # Check trade interval
        if current_time - self.last_trade_time < self.min_trade_interval:
            return False
            
        # Check position duration
        if current_position != 'FLAT' and current_time - self.position_entry_time > self.max_trade_duration:
            return True  # Allow exit signals
            
        return True
        
    def calculate_indicators(self, df: pd.DataFrame, gpu_data: Optional[Dict] = None) -> None:
        """Calculate technical indicators - to be implemented by child classes"""
        raise NotImplementedError
        
    def generate_signals(self, df: pd.DataFrame, current_position: str = 'FLAT',
                        current_price: float = None, current_bid: float = None,
                        current_ask: float = None) -> str:
        """Generate trading signals - to be implemented by child classes"""
        raise NotImplementedError
        
    def process_new_data(self, open_price: float, high_price: float, low_price: float,
                        close_price: float, volume: float = 0) -> None:
        """Process new price data"""
        new_data = {
            'open': open_price,
            'high': high_price,
            'low': low_price,
            'close': close_price,
            'volume': volume,
            'timestamp': pd.Timestamp.now()
        }
        self.update_historical_data(new_data) 