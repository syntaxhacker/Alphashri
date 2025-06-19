#!/usr/bin/env python3
"""
Ultra Aggressive Scalping Trader
Makes trades on the smallest market movements
"""

import time
from trading.enhanced_live_trader import EnhancedBinanceTrader
from strategies.breakout_strategy import BreakoutStrategy
from config import BINANCE_API_CONFIG

class UltraAggressiveScalper(EnhancedBinanceTrader):
    """Ultra aggressive version that trades on tiny signals"""
    
    def get_enhanced_market_signal(self):
        """Generate ULTRA SENSITIVE trading signals"""
        signals = []
        
        # 1. ULTRA SENSITIVE Order Flow (ANY movement = signal)
        ofi = self.market_indicators['order_flow_imbalance']
        if ofi > 0.01:  # Just 1% imbalance = BUY
            signals.append(('BUY', 'order_flow', min(abs(ofi) * 10, 1.0)))  # 10x amplification
        elif ofi < -0.01:  # Just 1% imbalance = SELL
            signals.append(('SELL', 'order_flow', min(abs(ofi) * 10, 1.0)))
        
        # 2. ULTRA SENSITIVE Volume (ANY buying/selling = signal)
        vol_imbalance = self.trade_data['volume_imbalance'] 
        if vol_imbalance > 0.01:  # Just 1% volume imbalance = BUY
            signals.append(('BUY', 'volume', min(vol_imbalance * 5, 1.0)))  # 5x amplification
        elif vol_imbalance < -0.01:  # Just 1% volume imbalance = SELL
            signals.append(('SELL', 'volume', min(abs(vol_imbalance) * 5, 1.0)))
        
        # 3. MOMENTUM SCALPING (tiny price changes)
        if hasattr(self, 'price_history') and len(self.price_history) >= 3:
            recent_prices = self.price_history[-3:]
            if recent_prices[-1] > recent_prices[-2] > recent_prices[-3]:  # 3 ticks up = BUY
                momentum_strength = (recent_prices[-1] - recent_prices[-3]) / recent_prices[-3]
                signals.append(('BUY', 'momentum', min(momentum_strength * 1000, 1.0)))  # 1000x amplification
            elif recent_prices[-1] < recent_prices[-2] < recent_prices[-3]:  # 3 ticks down = SELL
                momentum_strength = (recent_prices[-3] - recent_prices[-1]) / recent_prices[-3]
                signals.append(('SELL', 'momentum', min(momentum_strength * 1000, 1.0)))
        else:
            # Initialize price history
            if not hasattr(self, 'price_history'):
                self.price_history = []
            if len(self.price_history) > 10:  # Keep only last 10 prices
                self.price_history = self.price_history[-10:]
            self.price_history.append(self.current_ask)
        
        # 4. SPREAD SCALPING (tight spreads = opportunity)
        spread_pct = self.market_indicators['spread_percentage']
        if spread_pct < 0.001:  # Very tight spread = trade opportunity
            # Favor the direction of recent volume
            vol_imb = self.trade_data['volume_imbalance']
            if vol_imb != 0:
                direction = 'BUY' if vol_imb > 0 else 'SELL'
                signals.append((direction, 'spread', 0.8))  # High confidence on tight spreads
        
        # 5. ALWAYS GENERATE A SIGNAL (based on any market movement)
        if not signals:
            # If no other signals, use tiny volume movements
            vol_imb = self.trade_data['volume_imbalance']
            if vol_imb >= 0:
                signals.append(('BUY', 'fallback', 0.35))  # Always 35% confidence
            else:
                signals.append(('SELL', 'fallback', 0.35))
        
        return signals
    
    def calculate_combined_signal(self, strategy_signal, market_signals):
        """ULTRA AGGRESSIVE signal combination"""
        signal_weights = {
            'strategy': 0.2,      # Reduced importance
            'order_flow': 0.25,   # High importance  
            'volume': 0.25,       # High importance
            'momentum': 0.15,     # NEW: momentum scalping
            'spread': 0.10,       # NEW: spread scalping
            'fallback': 0.05      # Always have some signal
        }
        
        combined_score = {'BUY': 0.0, 'SELL': 0.0}
        
        # Process strategy signal
        if strategy_signal:
            action = strategy_signal.get('action', 'HOLD')
            confidence = strategy_signal.get('confidence', 0)
            if action in ['BUY', 'SELL']:
                combined_score[action] += confidence * signal_weights['strategy']
        
        # Process market signals with ULTRA AGGRESSIVE weighting
        for action, signal_type, confidence in market_signals:
            weight = signal_weights.get(signal_type, 0.1)
            # BOOST ALL SIGNALS BY 2x
            boosted_confidence = min(confidence * 2.0, 1.0)
            combined_score[action] += boosted_confidence * weight
        
        # Determine final action
        if combined_score['BUY'] > combined_score['SELL']:
            return {
                'action': 'BUY',
                'confidence': combined_score['BUY'],
                'BUY': combined_score['BUY'],
                'SELL': combined_score['SELL']
            }
        elif combined_score['SELL'] > combined_score['BUY']:
            return {
                'action': 'SELL', 
                'confidence': combined_score['SELL'],
                'BUY': combined_score['BUY'],
                'SELL': combined_score['SELL']
            }
        else:
            return {'action': None, 'confidence': 0}
    
    def process_enhanced_signals(self):
        """ULTRA AGGRESSIVE signal processing"""
        if not self.should_trade():
            return
            
        market_signals = self.get_enhanced_market_signal()
        strategy_signal = None  # No traditional strategy - pure scalping
        
        signal_score = self.calculate_combined_signal(strategy_signal, market_signals)
        
        # ULTRA LOW THRESHOLD - Trade on 15% confidence!
        if signal_score['action'] and signal_score['confidence'] > 0.15:  # Just 15%!
            self.execute_enhanced_trade(signal_score)

def run_ultra_aggressive_scalper():
    """Run the ultra aggressive scalping trader"""
    
    print("🔥 ULTRA AGGRESSIVE SCALPING TRADER")
    print("=" * 50)
    print("⚡ Trades on ANY market movement")
    print("📈 15% confidence threshold")
    print("🎯 Amplified signal sensitivity")
    print("💨 1-second trade delays")
    print("🌐 REAL BINANCE TESTNET")
    print()
    
    # Get real testnet credentials
    testnet_config = BINANCE_API_CONFIG['testnet']
    
    # Create scalper instance with REAL TESTNET KEYS
    scalper = UltraAggressiveScalper(
        api_key=testnet_config['api_key'],
        api_secret=testnet_config['api_secret'], 
        use_testnet=True,
        leverage=5
    )
    
    # Override trade delay for ultra fast scalping
    original_should_trade = scalper.should_trade
    def ultra_fast_should_trade():
        current_time = time.time()
        # Always allow closing positions
        if scalper.current_position != 0:
            return True
        # 1 second delay only!
        return current_time - scalper.last_trade_time > 1.0
    
    scalper.should_trade = ultra_fast_should_trade
    
    try:
        scalper.run(
            symbol="BTCUSDT",
            strategy=None,  # No traditional strategy - pure market microstructure
            balance=100000,
            interval='1m'
        )
    except KeyboardInterrupt:
        print("\n🛑 Ultra aggressive scalping stopped by user")
    except Exception as e:
        print(f"\n❌ Error: {e}")

if __name__ == "__main__":
    run_ultra_aggressive_scalper() 