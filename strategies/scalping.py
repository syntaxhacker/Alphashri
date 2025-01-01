from typing import Dict, Optional
import pandas as pd
import talib
from .base_strategy import BaseStrategy

class ScalpingStrategy(BaseStrategy):
    def __init__(self):
        super().__init__()
        self.last_bid = None
        self.last_ask = None
        self.price_threshold = 0.0001  # Reduced to 0.01% price movement threshold
        self.trades_count = 0
        self.min_notional = 100  # Minimum notional value in USDT
        self.position_size = 0.95  # Use 95% of available balance
        self.last_signal_time = None
        self.signal_cooldown = 10  # Seconds between signals
        
    def generate_signals(self, data: pd.DataFrame, current_bid: float = None, current_ask: float = None) -> Optional[int]:
        """
        Generate trading signals based on real-time price movements.
        Returns:
            1 for buy signal
            -1 for sell signal
            0 or None for no signal
        """
        current_time = pd.Timestamp.now()
        
        # Initialize last prices if needed
        if self.last_bid is None:
            self.last_bid = current_bid
            self.last_ask = current_ask
            return None
            
        # Check signal cooldown
        if self.last_signal_time is not None:
            time_since_last_signal = (current_time - self.last_signal_time).total_seconds()
            if time_since_last_signal < self.signal_cooldown:
                return None
            
        # Calculate price changes for both bid and ask
        bid_change = (current_bid - self.last_bid) / self.last_bid if self.last_bid else 0
        ask_change = (current_ask - self.last_ask) / self.last_ask if self.last_ask else 0
        
        # Use the larger price change
        price_change = max(abs(bid_change), abs(ask_change))
        price_change_pct = price_change * 100
        
        # Generate signals based on price movements
        signal = None
        if price_change >= self.price_threshold:
            if bid_change < 0 or ask_change < 0:  # Price dropped
                print(f"\n{'='*50}")
                print(f"PRICE DROP DETECTED")
                print(f"Change: -{price_change_pct:.3f}%")
                print(f"From Bid: ${self.last_bid:,.2f} to ${current_bid:,.2f}")
                print(f"From Ask: ${self.last_ask:,.2f} to ${current_ask:,.2f}")
                print(f"Looking for buy opportunity...")
                print(f"{'='*50}")
                signal = 1  # Buy signal (expecting reversal)
            else:  # Price increased
                print(f"\n{'='*50}")
                print(f"PRICE RISE DETECTED")
                print(f"Change: +{price_change_pct:.3f}%")
                print(f"From Bid: ${self.last_bid:,.2f} to ${current_bid:,.2f}")
                print(f"From Ask: ${self.last_ask:,.2f} to ${current_ask:,.2f}")
                print(f"Looking for sell opportunity...")
                print(f"{'='*50}")
                signal = -1  # Sell signal (take profit)
            
            if signal is not None:
                self.trades_count += 1
                self.last_signal_time = current_time
                
        # Update last prices
        self.last_bid = current_bid
        self.last_ask = current_ask
        
        return signal 