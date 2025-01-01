from typing import Dict, Optional
import pandas as pd
import talib
from .base_strategy import BaseStrategy

class ScalpingStrategy(BaseStrategy):
    def __init__(self):
        super().__init__()
        self.last_price = None
        self.price_threshold = 0.001  # 0.1% price movement threshold
        self.trades_count = 0
        self.min_notional = 100  # Minimum notional value in USDT
        self.position_size = 0.95  # Use 95% of available balance
        
    def generate_signals(self, data: pd.DataFrame) -> Optional[int]:
        """
        Generate trading signals based on price movements.
        Returns:
            1 for buy signal
            -1 for sell signal
            0 or None for no signal
        """
        if len(data) == 0:
            return None
            
        current_price = data['close'].iloc[-1]
        
        if self.last_price is None:
            self.last_price = current_price
            return None
            
        # Calculate price change percentage
        price_change = (current_price - self.last_price) / self.last_price
        price_change_pct = price_change * 100
        
        # Generate signals based on price movements
        signal = None
        if abs(price_change) >= self.price_threshold:
            if price_change < 0:  # Price dropped
                print(f"\n{'='*50}")
                print(f"PRICE DROP DETECTED")
                print(f"Change: -{abs(price_change_pct):.3f}%")
                print(f"From: ${self.last_price:,.2f}")
                print(f"To: ${current_price:,.2f}")
                print(f"Looking for buy opportunity...")
                print(f"{'='*50}")
                signal = 1  # Buy signal (expecting reversal)
            else:  # Price increased
                print(f"\n{'='*50}")
                print(f"PRICE RISE DETECTED")
                print(f"Change: +{price_change_pct:.3f}%")
                print(f"From: ${self.last_price:,.2f}")
                print(f"To: ${current_price:,.2f}")
                print(f"Looking for sell opportunity...")
                print(f"{'='*50}")
                signal = -1  # Sell signal (take profit)
            
            if signal is not None:
                self.trades_count += 1
                
        # Update last price
        self.last_price = current_price
        
        return signal 