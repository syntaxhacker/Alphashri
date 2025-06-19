import os
import time
import json
import logging
from datetime import datetime, timedelta
from threading import Thread, Lock
from collections import deque, defaultdict
from statistics import mean
import numpy as np

import pandas as pd
from binance.client import Client
from binance.um_futures import UMFutures
from binance.websocket.um_futures.websocket_client import UMFuturesWebsocketClient
from config import BINANCE_API_CONFIG, WEBSOCKET_CONFIG
from display import TradingDisplay, console
from rich.panel import Panel
from rich.table import Table
from rich import box
from rich.console import Console

class EnhancedBinanceTrader:
    def __init__(self, api_key, api_secret, use_testnet=True, leverage=1):
        """Initialize enhanced trader with multi-stream data"""
        self.api_key = api_key
        self.api_secret = api_secret
        self.use_testnet = use_testnet
        self.leverage = leverage
        
        # Get API config
        self.api_config = BINANCE_API_CONFIG['testnet' if use_testnet else 'mainnet']
        
        # Initialize Futures client
        self.client = UMFutures(
            key=api_key,
            secret=api_secret,
            base_url=self.api_config['futures_api']
        )
        
        # Initialize display
        self.display = TradingDisplay()
        
        # WebSocket clients
        self.ws_client = None
        self.running = False
        
        # Trading state
        self.current_position = 0
        self.position_entry_price = 0.0
        self.position_entry_time = None
        self.unrealized_pnl = 0.0
        self.balance = 0.0
        
        # Enhanced price tracking
        self.current_bid = 0.0
        self.current_ask = 0.0
        self.prev_price = 0.0
        self.session_start_price = None
        
        # ORDER BOOK DEPTH DATA
        self.order_book = {
            'bids': {},  # price -> quantity
            'asks': {},  # price -> quantity
            'last_update_id': 0,
            'bid_levels': [],  # sorted list of bid prices (descending)
            'ask_levels': []   # sorted list of ask prices (ascending)
        }
        
        # TRADE STREAM DATA
        self.trade_data = {
            'recent_trades': deque(maxlen=100),  # Last 100 trades
            'trade_volume': deque(maxlen=60),    # Volume per second
            'buy_volume': 0.0,
            'sell_volume': 0.0,
            'volume_imbalance': 0.0
        }
        
        # AGGREGATE TRADE DATA
        self.agg_trade_data = {
            'price_momentum': deque(maxlen=20),
            'large_trades': deque(maxlen=50),  # Trades above size threshold
            'market_maker_ratio': 0.0,
            'aggressive_buy_ratio': 0.0
        }
        
        # MARKET MICROSTRUCTURE INDICATORS
        self.market_indicators = {
            'bid_ask_spread': 0.0,
            'spread_percentage': 0.0,
            'order_flow_imbalance': 0.0,  # (bid_volume - ask_volume) / (bid_volume + ask_volume)
            'price_impact': 0.0,          # Price impact of last large trade
            'liquidity_score': 0.0,       # Total liquidity within spread
            'depth_imbalance': 0.0,       # Imbalance in order book depth
            'volume_weighted_spread': 0.0,
            'price_change_24h': 0.0,
            'volume_24h': 0.0
        }
        
        # Time tracking
        self.last_trade_time = time.time()
        self.last_print_time = time.time()
        self.last_signal_time = 0
        self.update_counter = 0
        self.messages_received = 0
        
        # Thread safety
        self.data_lock = Lock()
        
        # Trading parameters
        self.trading_symbol = None
        self.interval = '1m'
        self.strategy = None
        
        # Large trade threshold (configurable)
        self.large_trade_threshold = 10000  # $10,000 USD
        
    def set_leverage(self, leverage: int):
        """Set leverage for trading"""
        if not self.trading_symbol:
            self.log("Cannot set leverage: trading symbol not initialized", "error")
            return None
            
        try:
            response = self.client.change_leverage(
                symbol=self.trading_symbol,
                leverage=leverage,
                timestamp=int(time.time() * 1000)
            )
            self.leverage = leverage
            self.log(f"Leverage set to {leverage}x for {self.trading_symbol}", "success")
            return response
        except Exception as e:
            self.log(f"Error setting leverage for {self.trading_symbol}: {str(e)}", "error")
            return None
        
    def update_order_book(self, data):
        """Update order book with depth data"""
        with self.data_lock:
            try:
                if 'u' in data:  # Diff depth update
                    # Validate update sequence
                    if data['U'] <= self.order_book['last_update_id'] <= data['u']:
                        # Update bids
                        for bid in data['b']:
                            price, quantity = float(bid[0]), float(bid[1])
                            if quantity == 0:
                                self.order_book['bids'].pop(price, None)
                            else:
                                self.order_book['bids'][price] = quantity
                        
                        # Update asks
                        for ask in data['a']:
                            price, quantity = float(ask[0]), float(ask[1])
                            if quantity == 0:
                                self.order_book['asks'].pop(price, None)
                            else:
                                self.order_book['asks'][price] = quantity
                        
                        # Update sorted levels
                        self.order_book['bid_levels'] = sorted(self.order_book['bids'].keys(), reverse=True)[:20]
                        self.order_book['ask_levels'] = sorted(self.order_book['asks'].keys())[:20]
                        
                        # Update last update ID
                        self.order_book['last_update_id'] = data['u']
                        
                        # Calculate market indicators
                        self.calculate_market_indicators()
                        
            except Exception as e:
                self.log(f"Error updating order book: {str(e)}", "error")
    
    def update_aggregate_trade(self, data):
        """Update with aggregate trade data and handle all trade volume tracking"""
        with self.data_lock:
            try:
                agg_trade = {
                    'price': float(data['p']),
                    'quantity': float(data['q']),
                    'first_trade_id': data['f'],
                    'last_trade_id': data['l'],
                    'time': data['T'],
                    'is_buyer_maker': data['m'],
                    'trade_count': data['l'] - data['f'] + 1
                }
                
                # Calculate trade value
                trade_value = agg_trade['price'] * agg_trade['quantity']
                
                # Track large trades
                if trade_value > self.large_trade_threshold:
                    self.agg_trade_data['large_trades'].append(agg_trade)
                
                # Update volume tracking (now handled here instead of individual trades)
                if agg_trade['is_buyer_maker']:
                    self.trade_data['sell_volume'] += agg_trade['quantity']
                else:
                    self.trade_data['buy_volume'] += agg_trade['quantity']
                
                # Calculate volume imbalance
                total_volume = self.trade_data['buy_volume'] + self.trade_data['sell_volume']
                if total_volume > 0:
                    self.trade_data['volume_imbalance'] = (
                        (self.trade_data['buy_volume'] - self.trade_data['sell_volume']) / total_volume
                    )
                
                # Add to recent trades for analysis
                self.trade_data['recent_trades'].append({
                    'price': agg_trade['price'],
                    'quantity': agg_trade['quantity'],
                    'time': agg_trade['time'],
                    'is_buyer_maker': agg_trade['is_buyer_maker'],
                    'trade_id': agg_trade['last_trade_id']
                })
                
                # Update price momentum
                self.agg_trade_data['price_momentum'].append(agg_trade['price'])
                
                # Calculate market maker ratio (last 50 trades)
                recent_trades = list(self.agg_trade_data['large_trades'])[-50:]
                if recent_trades:
                    maker_count = sum(1 for trade in recent_trades if trade['is_buyer_maker'])
                    self.agg_trade_data['market_maker_ratio'] = maker_count / len(recent_trades)
                    self.agg_trade_data['aggressive_buy_ratio'] = 1 - self.agg_trade_data['market_maker_ratio']
                
                # Reset volume tracking every 60 seconds
                current_minute = time.time() // 60
                if not hasattr(self, 'last_volume_reset') or current_minute > self.last_volume_reset:
                    self.trade_data['buy_volume'] = 0.0
                    self.trade_data['sell_volume'] = 0.0
                    self.last_volume_reset = current_minute
                    
            except Exception as e:
                self.log(f"Error updating aggregate trade: {str(e)}", "error")
    
    def calculate_market_indicators(self):
        """Calculate advanced market microstructure indicators"""
        try:
            # Get best bid/ask
            if self.order_book['bid_levels'] and self.order_book['ask_levels']:
                best_bid = self.order_book['bid_levels'][0]
                best_ask = self.order_book['ask_levels'][0]
                
                # Update current bid/ask
                self.current_bid = best_bid
                self.current_ask = best_ask
                
                # Calculate spread
                self.market_indicators['bid_ask_spread'] = best_ask - best_bid
                mid_price = (best_bid + best_ask) / 2
                
                # Calculate spread percentage safely
                if mid_price > 0:
                    self.market_indicators['spread_percentage'] = (
                        self.market_indicators['bid_ask_spread'] / mid_price * 100
                    )
                else:
                    self.market_indicators['spread_percentage'] = 0.0
                
                # Calculate order flow imbalance (top 5 levels)
                bid_volume = sum(
                    self.order_book['bids'].get(price, 0) 
                    for price in self.order_book['bid_levels'][:5]
                )
                ask_volume = sum(
                    self.order_book['asks'].get(price, 0) 
                    for price in self.order_book['ask_levels'][:5]
                )
                
                total_volume = bid_volume + ask_volume
                if total_volume > 0:
                    self.market_indicators['order_flow_imbalance'] = (
                        (bid_volume - ask_volume) / total_volume
                    )
                
                # Calculate liquidity score (volume within 0.1% of mid price)
                if mid_price > 0:
                    price_threshold = mid_price * 0.001  # 0.1%
                    liquidity_bids = sum(
                        self.order_book['bids'].get(price, 0) 
                        for price in self.order_book['bid_levels'] 
                        if price >= mid_price - price_threshold
                    )
                    liquidity_asks = sum(
                        self.order_book['asks'].get(price, 0) 
                        for price in self.order_book['ask_levels'] 
                        if price <= mid_price + price_threshold
                    )
                    self.market_indicators['liquidity_score'] = liquidity_bids + liquidity_asks
                
                # Calculate depth imbalance (all visible levels)
                total_bid_volume = sum(self.order_book['bids'].values())
                total_ask_volume = sum(self.order_book['asks'].values())
                total_depth = total_bid_volume + total_ask_volume
                
                if total_depth > 0:
                    self.market_indicators['depth_imbalance'] = (
                        (total_bid_volume - total_ask_volume) / total_depth
                    )
                
        except Exception as e:
            self.log(f"Error calculating market indicators: {str(e)}", "error")
    
    def get_enhanced_market_signal(self):
        """Generate enhanced trading signals using multi-stream data"""
        signals = []
        
        # 1. Order Flow Imbalance Signal (MORE SENSITIVE)
        ofi = self.market_indicators['order_flow_imbalance']
        if ofi > 0.1:  # Lowered from 0.3 - Any bid pressure
            signals.append(('BUY', 'order_flow', min(ofi * 3, 1.0)))  # Amplify signal
        elif ofi < -0.1:  # Lowered from -0.3 - Any ask pressure
            signals.append(('SELL', 'order_flow', min(abs(ofi) * 3, 1.0)))
        
        # 2. Volume Imbalance Signal (MORE SENSITIVE)
        vol_imbalance = self.trade_data['volume_imbalance']
        if vol_imbalance > 0.05:  # Lowered from 0.2 - Slight buying volume
            signals.append(('BUY', 'volume', min(vol_imbalance * 2, 1.0)))
        elif vol_imbalance < -0.05:  # Lowered from -0.2 - Slight selling volume
            signals.append(('SELL', 'volume', min(abs(vol_imbalance) * 2, 1.0)))
        
        # 3. Large Trade Direction Signal (MORE SENSITIVE)
        if self.agg_trade_data['large_trades']:
            recent_large = list(self.agg_trade_data['large_trades'])[-5:]  # Last 5 large trades
            aggressive_buys = sum(1 for trade in recent_large if not trade['is_buyer_maker'])
            if aggressive_buys >= 2:  # Lowered from 3 - 2+ aggressive buys
                signals.append(('BUY', 'large_trades', aggressive_buys / 5))
            elif aggressive_buys <= 2:  # More aggressive sells
                signals.append(('SELL', 'large_trades', (5 - aggressive_buys) / 5))
        
        # 4. Spread Compression Signal (indicates incoming volatility)
        spread_pct = self.market_indicators['spread_percentage']
        if spread_pct < 0.05:  # Increased threshold - more signals
            signals.append(('VOLATILITY', 'spread_compression', 1 - spread_pct))
        
        # 5. Depth Imbalance Signal (MORE SENSITIVE)
        depth_imbalance = self.market_indicators['depth_imbalance']
        if depth_imbalance > 0.1:  # Lowered from 0.4 - Any bid side bias
            signals.append(('BUY', 'depth', min(depth_imbalance * 2, 1.0)))
        elif depth_imbalance < -0.1:  # Lowered from -0.4 - Any ask side bias
            signals.append(('SELL', 'depth', min(abs(depth_imbalance) * 2, 1.0)))
        
        # 6. NEW: Price Movement Signal (momentum-based)
        if hasattr(self, 'prev_price') and self.prev_price and self.current_ask:
            price_change = (self.current_ask - self.prev_price) / self.prev_price
            if price_change > 0.0001:  # 0.01% price increase
                signals.append(('BUY', 'momentum', min(price_change * 1000, 1.0)))
            elif price_change < -0.0001:  # 0.01% price decrease
                signals.append(('SELL', 'momentum', min(abs(price_change) * 1000, 1.0)))
        
        return signals
    
    def get_display_data(self):
        """Get enhanced data for display"""
        # Initialize with safe defaults
        current_price = self.current_bid if self.current_position > 0 else self.current_ask
        if not current_price:
            current_price = self.current_bid or self.current_ask or 0.0
        
        # Calculate position status
        position_status = "FLAT"
        if self.current_position > 0:
            position_status = "LONG"
        elif self.current_position < 0:
            position_status = "SHORT"
            
        # Calculate P&L safely
        if self.current_position != 0 and self.position_entry_price and self.position_entry_price > 0:
            if self.current_position > 0 and self.current_bid:  # Long position
                self.unrealized_pnl = self.current_position * (self.current_bid - self.position_entry_price)
            elif self.current_position < 0 and self.current_ask:  # Short position
                self.unrealized_pnl = abs(self.current_position) * (self.position_entry_price - self.current_ask)
        else:
            self.unrealized_pnl = 0.0
        
        # Format hold time
        hold_time = "N/A"
        if hasattr(self, 'position_entry_time') and self.position_entry_time and self.current_position != 0:
            try:
                # Fix: Use time.time() for consistent timestamp calculation
                current_time = time.time()
                hold_seconds = int(current_time - self.position_entry_time)
                
                # Format as MM:SS
                minutes = hold_seconds // 60
                seconds = hold_seconds % 60
                hold_time = f"{minutes}:{seconds:02d}"
            except Exception as e:
                hold_time = "N/A"
        
        # Calculate spread safely
        spread = 0.0
        if self.current_ask is not None and self.current_bid is not None:
            spread = self.current_ask - self.current_bid
        
        # Build enhanced indicators dict
        indicators_dict = {
            'Bid': self.current_bid if self.current_bid else 0,
            'Ask': self.current_ask if self.current_ask else 0,
            'Spread': spread,
            'Hold Time': hold_time,
            'OFI': f"{self.market_indicators['order_flow_imbalance']:+.2f}",
            'Vol Imb': f"{self.trade_data['volume_imbalance']:+.2f}",
            'Liq Score': f"{self.market_indicators['liquidity_score']:.0f}",
            'Depth Imb': f"{self.market_indicators['depth_imbalance']:+.2f}",
            'Spread %': f"{self.market_indicators['spread_percentage']:.3f}%",
            'Large Trades': f"{len(self.agg_trade_data['large_trades'])}"
        }
        
        return {
            self.trading_symbol: {
                'price': current_price,
                'prev_price': self.prev_price if self.prev_price else current_price,
                'position': position_status,
                'position_size': abs(self.current_position) if self.current_position else 0,
                'position_entry_price': self.position_entry_price if self.position_entry_price else 0,
                'pnl': self.unrealized_pnl if self.unrealized_pnl else 0,
                'balance': self.balance if hasattr(self, 'balance') else 0,
                'leverage': self.leverage if hasattr(self, 'leverage') else 1,
                'signal': 'ENHANCED',
                'indicators': indicators_dict
            }
        }
    
    def message_handler(self, _, message):
        """Enhanced message handler for multiple streams"""
        try:
            if isinstance(message, str):
                data = json.loads(message)
            else:
                data = message
            
            self.messages_received += 1
            
            # Handle different stream types
            if 'e' in data:
                event_type = data['e']
                if event_type == 'depthUpdate':
                    self.update_order_book(data)
                elif event_type == 'aggTrade':
                    self.update_aggregate_trade(data)
                elif event_type == 'bookTicker':
                    with self.data_lock:
                        self.current_bid = float(data['b'])
                        self.current_ask = float(data['a'])
                        
                        # Initialize session start price
                        if self.session_start_price is None:
                            self.session_start_price = self.current_ask
                            self.prev_price = self.current_ask
                elif event_type == '24hrTicker':
                    # Handle 24hr ticker statistics
                    with self.data_lock:
                        self.market_indicators['price_change_24h'] = float(data.get('P', 0))
                        self.market_indicators['volume_24h'] = float(data.get('v', 0))
                elif event_type == '24hrMiniTicker':
                    # Handle mini ticker
                    with self.data_lock:
                        if 'c' in data:  # Close price
                            self.current_ask = float(data['c'])
                            self.current_bid = float(data['c'])  # Use close as both bid/ask for mini ticker
            
            # Generate enhanced signals periodically
            current_time = time.time()
            if current_time - self.last_signal_time >= 2.0:  # Every 2 seconds
                self.process_enhanced_signals()
                self.last_signal_time = current_time
            
            # Update display
            if current_time - self.last_print_time >= 3.0:  # Every 3 seconds
                self.update_display()
                self.last_print_time = current_time
                
        except Exception as e:
            self.log(f"Error processing message: {str(e)}", "error")
    
    def process_enhanced_signals(self):
        """Process enhanced signals and execute trades"""
        if not self.should_trade():
            return
        
        # Get enhanced market signals
        market_signals = self.get_enhanced_market_signal()
        
        # Get traditional strategy signal if available
        strategy_signal = 'NONE'
        if self.strategy:
            try:
                # Update strategy with current data
                self.strategy.process_new_data(
                    open_price=self.current_bid,
                    high_price=self.current_ask,
                    low_price=self.current_bid,
                    close_price=self.current_ask,
                    volume=self.market_indicators['liquidity_score']
                )
                
                df = self.strategy.get_dataframe()
                if len(df) >= getattr(self.strategy, 'min_data_points', 20):
                    self.strategy.calculate_indicators(df)
                    current_position = 'LONG' if self.current_position > 0 else 'SHORT' if self.current_position < 0 else 'FLAT'
                    strategy_signal = self.strategy.generate_signals(
                        df, 
                        current_position=current_position,
                        current_price=self.current_ask,
                        current_bid=self.current_bid,
                        current_ask=self.current_ask
                    )
            except Exception as e:
                self.log(f"Error getting strategy signal: {str(e)}", "error")
        
        # Combine signals
        signal_score = self.calculate_combined_signal(strategy_signal, market_signals)
        
        if signal_score['action'] and signal_score['confidence'] > 0.3:
            self.execute_enhanced_trade(signal_score)
    
    def calculate_combined_signal(self, strategy_signal, market_signals):
        """Combine strategy and market microstructure signals"""
        signal_weights = {
            'strategy': 0.3,      # Reduced from 0.4
            'order_flow': 0.2,    # Reduced from 0.25
            'volume': 0.15,       # Same
            'large_trades': 0.1,  # Same
            'depth': 0.1,         # Same
            'momentum': 0.15      # NEW: Price momentum signal
        }
        
        combined_score = {'BUY': 0, 'SELL': 0, 'action': None, 'confidence': 0}
        
        # Add strategy signal
        if strategy_signal == 'BUY':
            combined_score['BUY'] += signal_weights['strategy']
        elif strategy_signal == 'SELL':
            combined_score['SELL'] += signal_weights['strategy']
        
        # Add market signals
        for signal, signal_type, strength in market_signals:
            if signal in ['BUY', 'SELL'] and signal_type in signal_weights:
                combined_score[signal] += signal_weights[signal_type] * strength
        
        # Determine final action and confidence
        if combined_score['BUY'] > combined_score['SELL']:
            combined_score['action'] = 'BUY'
            combined_score['confidence'] = combined_score['BUY']
        elif combined_score['SELL'] > combined_score['BUY']:
            combined_score['action'] = 'SELL'
            combined_score['confidence'] = combined_score['SELL']
        
        return combined_score
    
    def execute_enhanced_trade(self, signal_score):
        """Execute trade with enhanced position sizing based on market conditions"""
        # Adjust position size based on liquidity and market impact
        base_size = 0.001  # Base position size in BTC
        
        # Liquidity adjustment (FIXED: minimum 0.5x multiplier)
        liquidity_multiplier = max(0.5, min(2.0, self.market_indicators['liquidity_score'] / 100))
        
        # Spread adjustment (FIXED: minimum 0.8x multiplier)
        spread_adjustment = max(0.8, 2.0 - self.market_indicators['spread_percentage'] * 100)
        
        # Confidence adjustment
        confidence_multiplier = signal_score['confidence']
        
        # Calculate final size
        trade_size = base_size * liquidity_multiplier * spread_adjustment * confidence_multiplier
        trade_size = round(min(trade_size, 0.01), 3)  # Cap at 0.01 BTC
        
        # ENSURE MINIMUM TRADE SIZE
        if trade_size < 0.001:
            trade_size = 0.001  # Minimum 0.001 BTC trade
        
        action = signal_score['action']
        
        if action == 'BUY' and self.current_position <= 0:
            if self.execute_trade("BUY", trade_size):
                self.log_enhanced_trade("BUY", trade_size, signal_score)
        elif action == 'SELL' and self.current_position >= 0:
            if self.execute_trade("SELL", trade_size):
                self.log_enhanced_trade("SELL", trade_size, signal_score)
    
    def execute_trade(self, side: str, size: float) -> bool:
        """Execute a trade"""
        try:
            # Round size to 3 decimal places for BTC
            size = round(size, 3)
            
            if self.use_testnet:
                # REAL BINANCE TESTNET API CALLS
                try:
                    if side == "BUY":
                        order = self.client.new_order(
                            symbol=self.trading_symbol,
                            side='BUY',
                            type='MARKET',
                            quantity=size
                        )
                    elif side == "SELL":
                        order = self.client.new_order(
                            symbol=self.trading_symbol,
                            side='SELL', 
                            type='MARKET',
                            quantity=size
                        )
                    elif side == "CLOSE":
                        # Close position by getting current position and reversing it
                        position_info = self.client.account()
                        # Implementation for closing position
                        pass
                    
                    # Update position tracking with real order data
                    if 'orderId' in order:
                        filled_qty = float(order.get('executedQty', size))
                        filled_price = float(order.get('avgPrice', self.current_ask if side == "BUY" else self.current_bid))
                        
                        if side == "BUY":
                            self.current_position = filled_qty
                            self.position_entry_price = filled_price
                            self.position_entry_time = datetime.now()
                        elif side == "SELL":
                            self.current_position = -filled_qty
                            self.position_entry_price = filled_price
                            self.position_entry_time = datetime.now()
                        
                        self.last_trade_time = time.time()
                        self.log(f"✅ REAL TESTNET ORDER: {side} {filled_qty} BTC @ ${filled_price:,.2f} (Order ID: {order['orderId']})", "info")
                        return True
                        
                except Exception as api_error:
                    self.log(f"❌ Testnet API Error: {api_error}", "error")
                    # Fallback to simulation if API fails
                    self.log("🔄 Falling back to simulation mode", "warning")
                    
                # Fallback simulation if API call fails
                filled_qty = size
                filled_price = self.current_ask if side == "BUY" else self.current_bid
                
                if side == "BUY":
                    self.current_position = filled_qty
                    self.position_entry_price = filled_price
                    self.position_entry_time = datetime.now()
                elif side == "SELL":
                    self.current_position = -filled_qty
                    self.position_entry_price = filled_price
                    self.position_entry_time = datetime.now()
                elif side == "CLOSE":
                    self.current_position = 0
                    self.position_entry_price = 0
                    self.position_entry_time = None
                
                self.last_trade_time = time.time()
                self.log(f"📝 SIMULATED: {side} {filled_qty} BTC @ ${filled_price:,.2f}", "info")
                return True
            else:
                # Real mainnet trading code would go here
                self.log("⚠️ Real mainnet trading not implemented", "warning")
                return False
                
        except Exception as e:
            self.log(f"Trade Error: {str(e)}", "error")
            return False
    
    def log_enhanced_trade(self, side, size, signal_score):
        """Log trade with enhanced signal information"""
        console.print(Panel.fit(
            f"🚀 ENHANCED {side} SIGNAL\n"
            f"Price: ${self.current_ask if side == 'BUY' else self.current_bid:,.2f}\n"
            f"Size: {size:.3f} BTC\n"
            f"Confidence: {signal_score['confidence']:.1%}\n"
            f"Spread: {self.market_indicators['spread_percentage']:.3f}%\n"
            f"Order Flow: {self.market_indicators['order_flow_imbalance']:+.2f}\n"
            f"Volume Imbalance: {self.trade_data['volume_imbalance']:+.2f}\n"
            f"Liquidity Score: {self.market_indicators['liquidity_score']:.1f}",
            title="Enhanced Trade Execution",
            border_style="green" if side == "BUY" else "red"
        ))
    
    def should_trade(self) -> bool:
        """Check if trading should occur"""
        current_time = time.time()
        
        # Always allow closing positions
        if self.current_position != 0:
            return True
            
        # Minimum delay between trades (REDUCED FOR MORE ACTIVITY)
        if current_time - self.last_trade_time < 5.0:  # Reduced from 10 to 5 seconds
            return False
            
        return True
    
    def initialize_order_book_snapshot(self):
        """Initialize order book with snapshot from REST API"""
        try:
            depth = self.client.depth(symbol=self.trading_symbol, limit=1000)
            
            # Initialize order book
            self.order_book['bids'] = {float(bid[0]): float(bid[1]) for bid in depth['bids']}
            self.order_book['asks'] = {float(ask[0]): float(ask[1]) for ask in depth['asks']}
            self.order_book['last_update_id'] = depth['lastUpdateId']
            
            # Sort levels
            self.order_book['bid_levels'] = sorted(self.order_book['bids'].keys(), reverse=True)
            self.order_book['ask_levels'] = sorted(self.order_book['asks'].keys())
            
            # Initialize current bid/ask
            if self.order_book['bid_levels'] and self.order_book['ask_levels']:
                self.current_bid = self.order_book['bid_levels'][0]
                self.current_ask = self.order_book['ask_levels'][0]
            
            self.log(f"Order book snapshot initialized with {len(self.order_book['bids'])} bids, {len(self.order_book['asks'])} asks", "info")
            
        except Exception as e:
            self.log(f"Error initializing order book snapshot: {str(e)}", "error")
    
    def initialize_enhanced_websocket(self):
        """Initialize WebSocket with multiple streams"""
        try:
            # Initialize WebSocket client
            self.ws_client = UMFuturesWebsocketClient(
                stream_url=self.api_config['websocket_stream'],
                on_message=self.message_handler,
                is_combined=True
            )
            
            # Subscribe to multiple streams
            symbol_lower = self.trading_symbol.lower()
            
            # Order book depth updates (100ms)
            self.ws_client.diff_book_depth(symbol=symbol_lower, speed=100)
            
            # Aggregate trades (includes individual trade info)
            self.ws_client.agg_trade(symbol=symbol_lower)
            
            # Best bid/ask updates
            self.ws_client.book_ticker(symbol=symbol_lower)
            
            # Additional market data streams
            self.ws_client.ticker(symbol=symbol_lower)  # 24hr ticker statistics
            self.ws_client.mini_ticker(symbol=symbol_lower)  # Mini ticker
            
            # Initialize order book with snapshot
            self.initialize_order_book_snapshot()
            
            self.log("Enhanced WebSocket with multiple streams initialized", "info")
            
        except Exception as e:
            self.log(f"Error initializing enhanced WebSocket: {str(e)}", "error")
            raise
    
    def update_display(self):
        """Update display with enhanced market data"""
        try:
            display_data = self.get_display_data()
            panel = self.display.display_live_status(display_data)
            console.print(panel)
            
            # Show additional market info
            self.show_market_analysis()
            
        except Exception as e:
            self.log(f"Error updating display: {str(e)}", "error")
    
    def show_market_analysis(self):
        """Show enhanced market analysis"""
        try:
            # Create market analysis table
            table = Table(title="🔍 Live Market Analysis", box=box.ROUNDED)
            table.add_column("Metric", style="cyan")
            table.add_column("Value", style="yellow")
            table.add_column("Signal", style="green")
            
            # Order Flow Analysis
            ofi = self.market_indicators['order_flow_imbalance']
            ofi_signal = "🟢 BULLISH" if ofi > 0.2 else "🔴 BEARISH" if ofi < -0.2 else "⚪ NEUTRAL"
            table.add_row("Order Flow Imbalance", f"{ofi:+.3f}", ofi_signal)
            
            # Volume Analysis
            vol_imb = self.trade_data['volume_imbalance']
            vol_signal = "🟢 BUY PRESSURE" if vol_imb > 0.1 else "🔴 SELL PRESSURE" if vol_imb < -0.1 else "⚪ BALANCED"
            table.add_row("Volume Imbalance", f"{vol_imb:+.3f}", vol_signal)
            
            # Liquidity Analysis
            liq_score = self.market_indicators['liquidity_score']
            liq_signal = "🟢 HIGH" if liq_score > 500 else "🟡 MEDIUM" if liq_score > 100 else "🔴 LOW"
            table.add_row("Liquidity Score", f"{liq_score:.1f}", liq_signal)
            
            # Spread Analysis
            spread_pct = self.market_indicators['spread_percentage']
            spread_signal = "🟢 TIGHT" if spread_pct < 0.01 else "🟡 NORMAL" if spread_pct < 0.05 else "🔴 WIDE"
            table.add_row("Spread %", f"{spread_pct:.4f}%", spread_signal)
            
            # Large Trades
            large_trades = len(self.agg_trade_data['large_trades'])
            large_signal = "🐋 ACTIVE" if large_trades > 10 else "⚪ QUIET"
            table.add_row("Large Trades (1h)", str(large_trades), large_signal)
            
            # Message stats
            table.add_row("Messages/sec", f"{self.messages_received:.0f}", "📊 DATA FLOW")
            
            console.print(table)
            console.print()
            
        except Exception as e:
            self.log(f"Error showing market analysis: {str(e)}", "error")
    
    def run(self, symbol, strategy=None, balance=1000, interval='1m'):
        """Run enhanced live trading"""
        try:
            self.trading_symbol = symbol.upper()
            self.strategy = strategy
            self.balance = balance
            self.interval = interval
            
            print(f"\n{'='*70}")
            print(f"🚀 ENHANCED LIVE TRADER - Multi-Stream Analysis")
            print(f"Symbol: {self.trading_symbol}")
            print(f"Strategy: {strategy.__class__.__name__ if strategy else 'Market Microstructure Only'}")
            print(f"Initial balance: ${balance:,.2f}")
            print(f"Data Streams: Trade + AggTrade + OrderBook + BookTicker")
            print(f"Mode: {'TESTNET (Paper Trading)' if self.use_testnet else 'LIVE TRADING'}")
            print(f"{'='*70}\n")
            
            if self.leverage > 1:
                print(f"Setting leverage to {self.leverage}x...")
                self.set_leverage(self.leverage)
            
            self.running = True
            self.initialize_enhanced_websocket()
            
            console.print("[bold green]🎯 Enhanced trader started! Monitoring multiple data streams...[/bold green]\n")
            
            while self.running:
                time.sleep(0.1)  # Minimal sleep for responsiveness
                
        except KeyboardInterrupt:
            print("\n🛑 Stopping enhanced trading...")
            self.running = False
            if self.ws_client:
                self.ws_client.stop()
            print("✅ Enhanced trading stopped")
        except Exception as e:
            self.log(f"Error in enhanced run: {str(e)}", "error")
            raise
    
    def log(self, message, level="info"):
        """Log message with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        color = "green" if level == "success" else "red" if level == "error" else "blue"
        console.print(f"[{color}][{timestamp}] {level.upper()}: {message}[/{color}]") 