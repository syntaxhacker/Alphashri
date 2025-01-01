import os
import time
import json
import logging
from datetime import datetime, timedelta
from threading import Thread, Lock
from collections import deque
from statistics import mean

import pandas as pd
from binance.client import Client
from binance.um_futures import UMFutures
from binance.websocket.um_futures.websocket_client import UMFuturesWebsocketClient
from config import BINANCE_API_CONFIG, WEBSOCKET_CONFIG
from display import TradingDisplay, console
from rich.panel import Panel

class BinancePaperTrader:
    def __init__(self, api_key, api_secret, use_testnet=True, leverage=1):
        self.api_key = api_key
        self.api_secret = api_secret
        self.use_testnet = use_testnet
        self.leverage = leverage  # Store requested leverage
        self.trading_symbol = None  # Initialize symbol as None
        
        # Get API config based on testnet/mainnet
        self.api_config = BINANCE_API_CONFIG['testnet' if use_testnet else 'mainnet']
        
        # Initialize Futures client
        self.client = UMFutures(
            key=api_key,
            secret=api_secret,
            base_url=self.api_config['futures_api']
        )
        
        # Initialize display
        self.display = TradingDisplay()
        
        # Initialize WebSocket client
        self.ws_client = None
        self.running = False
        self.current_position = 0
        self.current_bid = None
        self.current_ask = None
        self.last_price = None
        self.balance = 0
        self.trades = []
        self.strategy = None
        self.position_entry_price = None
        self.unrealized_pnl = 0
        self.last_trade_time = None
        self.position_entry_time = None
        self.prev_price = None
        
        # Price update handling
        self.price_lock = Lock()
        self.last_update_time = None
        self.last_print_time = 0
        self.update_counter = 0
        self.messages_received = 0
        
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
            
    def get_display_data(self):
        """Get data for display"""
        current_price = self.current_bid if self.current_position > 0 else self.current_ask
        
        # Calculate position status
        position_status = "NONE"
        if self.current_position > 0:
            position_status = "LONG"
        elif self.current_position < 0:
            position_status = "SHORT"
            
        # Calculate P&L
        if self.current_position != 0 and self.position_entry_price:
            if self.current_position > 0:  # Long position
                self.unrealized_pnl = self.current_position * (self.current_bid - self.position_entry_price)
            else:  # Short position
                self.unrealized_pnl = abs(self.current_position) * (self.position_entry_price - self.current_ask)
        
        # Format hold time
        hold_time = "N/A"
        if self.position_entry_time and self.current_position != 0:
            hold_time = str(datetime.now() - self.position_entry_time).split('.')[0]
        
        return {
            self.trading_symbol: {
                'price': current_price,
                'prev_price': self.prev_price if self.prev_price else current_price,
                'position': position_status,
                'position_size': abs(self.current_position),
                'position_entry_price': self.position_entry_price,
                'pnl': self.unrealized_pnl,
                'balance': self.balance,
                'leverage': self.leverage,
                'signal': 'NONE',  # Will be updated when signals are generated
                'indicators': {
                    'Bid': self.current_bid,
                    'Ask': self.current_ask,
                    'Spread': self.current_ask - self.current_bid if self.current_ask and self.current_bid else 0,
                    'Hold Time': hold_time
                }
            }
        }
        
    def should_trade(self):
        """Check if we should trade based on timing rules"""
        current_time = datetime.now()
        
        # Don't trade if we haven't waited 10 seconds since last trade
        if self.last_trade_time and (current_time - self.last_trade_time).total_seconds() < 10:
            return False
            
        # Don't exit position if we haven't held for 15 seconds
        if self.position_entry_time and self.current_position != 0:
            if (current_time - self.position_entry_time).total_seconds() < 15:
                return False
                
        return True
        
    def message_handler(self, _, message):
        """Handle incoming WebSocket messages"""
        try:
            if isinstance(message, str):
                data = json.loads(message)
            else:
                data = message
                
            if 'e' in data:
                if data['e'] == 'bookTicker':
                    with self.price_lock:
                        self.messages_received += 1
                        self.prev_price = self.current_bid
                        self.current_bid = float(data['b'])
                        self.current_ask = float(data['a'])
                        current_time = time.time()
                        
                        # Calculate unrealized PnL if position exists
                        if self.current_position != 0:
                            current_price = self.current_bid if self.current_position > 0 else self.current_ask
                            self.unrealized_pnl = self.current_position * (current_price - self.position_entry_price)
                        
                        # Generate signals from real-time prices
                        if not self.should_trade():
                            return
                            
                        # Create minimal DataFrame for strategy
                        df = pd.DataFrame([{
                            'open': self.current_bid,
                            'high': self.current_ask,
                            'low': self.current_bid,
                            'close': self.current_ask,
                            'volume': 0,
                            'close_time': pd.Timestamp.now()
                        }])
                        
                        signal = self.strategy.generate_signals(df, self.current_bid, self.current_ask)
                        trade_size = 0.005
                        
                        if signal == 1 and self.current_position <= 0:
                            try:
                                self.execute_trade("BUY", trade_size)
                                console.print(Panel.fit(
                                    f"BUY SIGNAL EXECUTED\nPrice: ${self.current_ask:,.2f}\nSize: {trade_size}",
                                    title="Trade Signal",
                                    border_style="green"
                                ))
                            except Exception as e:
                                self.log(f"Error executing buy trade: {str(e)}", "error")
                                
                        elif signal == -1 and self.current_position >= 0:
                            try:
                                self.execute_trade("SELL", trade_size)
                                console.print(Panel.fit(
                                    f"SELL SIGNAL EXECUTED\nPrice: ${self.current_bid:,.2f}\nSize: {trade_size}",
                                    title="Trade Signal",
                                    border_style="red"
                                ))
                            except Exception as e:
                                self.log(f"Error executing sell trade: {str(e)}", "error")
                        
                        # Update display every second
                        if current_time - self.last_print_time >= 1.0:
                            self.update_counter += 1
                            display_data = self.get_display_data()
                            panel = self.display.display_live_status(display_data)
                            console.print(panel)
                            self.last_print_time = current_time
                            
                elif data['e'] == 'kline' and data['k']['x']:
                    # Skip kline processing since we're using real-time prices
                    pass
                        
        except Exception as e:
            self.log(f"Error processing message: {str(e)}", "error")
            
    def execute_trade(self, side, quantity):
        """Execute a real futures trade"""
        try:
            params = {
                'symbol': self.trading_symbol,
                'side': side,
                'type': 'MARKET',
                'quantity': quantity,
                'newOrderRespType': 'RESULT',
                'timestamp': int(time.time() * 1000)
            }
            
            order = self.client.new_order(**params)
            
            filled_qty = float(order['executedQty'])
            filled_price = float(order['avgPrice'])
            
            if side == "BUY":
                self.current_position = filled_qty
            else:  # SELL
                self.current_position = -filled_qty
                
            self.position_entry_price = filled_price
                
            # Update timing trackers
            self.last_trade_time = datetime.now()
            if self.current_position != 0:
                self.position_entry_time = datetime.now()
                
            # Calculate P&L for this trade
            trade_pnl = 0
            if len(self.trades) > 0:
                last_trade = self.trades[-1]
                if last_trade['side'] != side:  # Only calculate P&L for closing trades
                    price_diff = filled_price - last_trade['price']
                    trade_pnl = -price_diff * filled_qty if side == "BUY" else price_diff * filled_qty
                
            # Record trade
            trade_info = {
                'timestamp': datetime.now(),
                'side': side,
                'price': filled_price,
                'quantity': filled_qty,
                'notional': filled_qty * filled_price,
                'order_id': order['orderId'],
                'pnl': trade_pnl
            }
            
            self.trades.append(trade_info)
            self.display.add_trade(trade_info)  # Add to display history
                
            self.log(f"Order executed: {order}", "success")
            console.print(Panel.fit(
                f"Side: {side}\nQuantity: {filled_qty}\nPrice: ${filled_price:,.2f}\nOrder ID: {order['orderId']}",
                title="Order Filled",
                border_style="green"
            ))
            
        except Exception as e:
            self.log(f"Error executing trade: {str(e)}", "error")
            console.print(f"[red]Trade Error: {str(e)}[/red]")
            
    def initialize_websocket(self):
        """Initialize WebSocket connection"""
        try:
            # Initialize WebSocket client with minimal latency settings
            self.ws_client = UMFuturesWebsocketClient(
                stream_url=self.api_config['websocket_stream'],
                on_message=self.message_handler,
                is_combined=True
            )
            
            # Subscribe to bookTicker for fastest price updates
            self.ws_client.book_ticker(symbol=self.trading_symbol.lower())
            self.ws_client.kline(symbol=self.trading_symbol.lower(), interval='1m')
            
            # Initialize timing variables
            self.last_print_time = time.time()
            self.messages_received = 0
            
            self.log("WebSocket connection initialized", "info")
            
        except Exception as e:
            self.log(f"Error initializing WebSocket: {str(e)}", "error")
            raise
            
    def run(self, symbol, strategy, balance=1000):
        """Run live trading"""
        try:
            # Initialize basic parameters first
            self.trading_symbol = symbol.upper()  # Set symbol first
            self.strategy = strategy
            self.balance = balance
            
            print(f"\n{'='*50}")
            print(f"Starting live trading for {self.trading_symbol}")
            print(f"Strategy: {strategy.__class__.__name__}")
            print(f"Initial balance: ${balance:,.2f}")
            
            # Set leverage after symbol is initialized
            if self.leverage > 1:
                print(f"Setting leverage to {self.leverage}x...")
                response = self.set_leverage(self.leverage)
                if response:
                    print(f"Leverage set successfully to {self.leverage}x")
                else:
                    print("Failed to set leverage, continuing with 1x")
                    self.leverage = 1
                    
            print(f"{'='*50}\n")
            print("Connecting to Binance Futures...")
            
            # Initialize WebSocket after all parameters are set
            self.running = True
            self.initialize_websocket()
            
            while self.running:
                time.sleep(0.001)  # Minimal sleep to prevent CPU overuse
                
        except KeyboardInterrupt:
            print("\nStopping live trading...")
            self.running = False
            if self.ws_client:
                self.ws_client.stop()
            print("Trading stopped")
        except Exception as e:
            self.log(f"Error in run: {str(e)}", "error")
            raise
            
    def log(self, message, level="info"):
        """Simple logging method"""
        levels = {
            "info": logging.INFO,
            "warning": logging.WARNING,
            "error": logging.ERROR,
            "success": logging.INFO,
            "debug": logging.DEBUG
        }
        logging.log(levels.get(level, logging.INFO), message) 