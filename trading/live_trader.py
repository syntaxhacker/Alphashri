import os
import time
import json
import logging
from datetime import datetime
from threading import Thread, Timer

import pandas as pd
import websocket
from binance.client import Client
from binance.um_futures import UMFutures
from config import BINANCE_API_CONFIG, WEBSOCKET_CONFIG

class BinancePaperTrader:
    def __init__(self, api_key, api_secret, use_testnet=True):
        self.api_key = api_key
        self.api_secret = api_secret
        self.use_testnet = use_testnet
        
        # Get API config based on testnet/mainnet
        self.api_config = BINANCE_API_CONFIG['testnet' if use_testnet else 'mainnet']
        
        # Initialize Futures client
        self.client = UMFutures(
            key=api_key,
            secret=api_secret,
            base_url=self.api_config['futures_api']
        )
        
        # Initialize WebSocket
        self.ws = None
        self.ws_thread = None
        self.running = False
        self.ping_timer = None
        self.last_pong = time.time()
        self.reconnect_attempts = 0
        
        self.trading_symbol = None
        self.strategy = None
        self.current_position = 0
        self.current_price = None
        self.balance = 0
        self.trades = []
        
    def test_trade(self):
        """Test market buy and sell to verify API connectivity"""
        try:
            # Get symbol info for minimum quantity and step size
            print("Getting symbol info...")
            symbol_info = self.client.exchange_info()
            symbol_filters = next(s for s in symbol_info['symbols'] if s['symbol'] == self.trading_symbol)
            
            # Get LOT_SIZE filter
            lot_size_filter = next(f for f in symbol_filters['filters'] if f['filterType'] == 'LOT_SIZE')
            min_qty = float(lot_size_filter['minQty'])
            step_size = float(lot_size_filter['stepSize'])
            print(f"Min quantity: {min_qty}, Step size: {step_size}")
            
            # Get current price
            print("Getting current price...")
            ticker = self.client.mark_price(symbol=self.trading_symbol)
            current_price = float(ticker['markPrice'])
            print(f"Current price: {current_price}")
            
            # Calculate position size to meet minimum notional value (100 USDT)
            min_notional = 100  # Minimum notional value in USDT
            position_size = min_notional / current_price
            print(f"Initial position size: {position_size}")
            
            # Ensure position size meets minimum quantity
            position_size = max(position_size, min_qty)
            
            # Round position size to valid step size
            position_size = round(position_size / step_size) * step_size
            print(f"Adjusted position size: {position_size}")
            
            # Verify final notional value
            notional_value = position_size * current_price
            print(f"Notional value: {notional_value} USDT")
            
            if notional_value < min_notional:
                print(f"Notional value {notional_value} is less than minimum {min_notional}")
                position_size = (min_notional / current_price)
                position_size = round(position_size / step_size) * step_size + step_size
                notional_value = position_size * current_price
                print(f"Updated position size: {position_size}, New notional value: {notional_value} USDT")
            
            print(f"\nTesting market buy order for {position_size} {self.trading_symbol}")
            order = self.client.new_order(
                symbol=self.trading_symbol,
                side="BUY",
                type="MARKET",
                quantity=position_size
            )
            print(f"Market buy order placed: {order}")
            
            time.sleep(2)  # Wait for order to fill
            
            print(f"\nTesting market sell order for {position_size} {self.trading_symbol}")
            order = self.client.new_order(
                symbol=self.trading_symbol,
                side="SELL",
                type="MARKET", 
                quantity=position_size
            )
            print(f"Market sell order placed: {order}")
            
            return True
            
        except Exception as e:
            print(f"Error executing test trade: {str(e)}")
            return False
            
    def on_message(self, ws, message):
        """Handle incoming WebSocket messages"""
        try:
            data = json.loads(message)
            
            if 'e' in data:
                if data['e'] == 'aggTrade':
                    self.current_price = float(data['p'])
                    # Use carriage return for smoother updates
                    print(f"\r{datetime.now().strftime('%H:%M:%S.%f')[:-3]} | {self.trading_symbol}: ${self.current_price:,.2f} | Pos: {self.current_position:.3f} | P&L: ${self.current_position * self.current_price:,.2f} | Trades: {len(self.trades)}", end="", flush=True)
                elif data['e'] == 'kline' and data['k']['x']:  # Only process completed candles
                    kline = data['k']
                    # Create DataFrame with single row of latest data
                    df = pd.DataFrame([{
                        'open': float(kline['o']),
                        'high': float(kline['h']), 
                        'low': float(kline['l']),
                        'close': float(kline['c']),
                        'volume': float(kline['v']),
                        'close_time': pd.to_datetime(kline['T'], unit='ms')
                    }])
                    
                    # Generate trading signals
                    signal = self.strategy.generate_signals(df)
                    
                    # Execute trades based on signal
                    if signal == 1 and self.current_position <= 0:
                        print(f"\n\n{'='*50}")
                        print(f"BUY SIGNAL DETECTED @ ${float(kline['c']):,.2f}")
                        print(f"Time: {datetime.now().strftime('%H:%M:%S.%f')[:-3]}")
                        print(f"{'='*50}\n")
                        self.execute_trade("BUY")
                    elif signal == -1 and self.current_position >= 0:
                        print(f"\n\n{'='*50}")
                        print(f"SELL SIGNAL DETECTED @ ${float(kline['c']):,.2f}")
                        print(f"Time: {datetime.now().strftime('%H:%M:%S.%f')[:-3]}")
                        print(f"{'='*50}\n")
                        self.execute_trade("SELL")
                        
        except Exception as e:
            print(f"\nError processing message: {str(e)}")
            print(f"Message: {message}")
            
    def on_error(self, ws, error):
        """Handle WebSocket errors"""
        print(f"WebSocket error: {error}")
        self.reconnect()
        
    def on_close(self, ws, close_status_code, close_msg):
        """Handle WebSocket connection close"""
        print(f"WebSocket connection closed: {close_status_code} - {close_msg}")
        if self.running:
            self.reconnect()
        
    def on_open(self, ws):
        """Handle WebSocket connection open"""
        print("\nWebSocket connection opened")
        # Subscribe to streams
        subscribe_message = {
            "method": "SUBSCRIBE",
            "params": [
                f"{self.trading_symbol.lower()}@aggTrade",
                f"{self.trading_symbol.lower()}@kline_1m"
            ],
            "id": 1
        }
        ws.send(json.dumps(subscribe_message))
        print("Subscribed to real-time data streams")
        print("\nMonitoring market data...")
        print("\nPress Ctrl+C to stop trading\n")
        
        # Start ping timer
        self.start_ping_timer()
        
    def on_ping(self, ws, message):
        """Handle ping from server"""
        ws.send(message)  # Echo back the ping payload
        self.last_pong = time.time()
        
    def on_pong(self, ws, message):
        """Handle pong from server"""
        self.last_pong = time.time()
        
    def start_ping_timer(self):
        """Start timer to send periodic pings"""
        if self.ping_timer:
            self.ping_timer.cancel()
            
        def send_ping():
            if self.ws and self.ws.sock and self.ws.sock.connected:
                self.ws.send(json.dumps({"ping": int(time.time() * 1000)}))
                
                # Check if we've received a pong within timeout
                if time.time() - self.last_pong > WEBSOCKET_CONFIG['pong_timeout']:
                    print("WebSocket ping timeout - reconnecting...")
                    self.reconnect()
                else:
                    # Schedule next ping
                    self.ping_timer = Timer(WEBSOCKET_CONFIG['ping_interval'], send_ping)
                    self.ping_timer.daemon = True
                    self.ping_timer.start()
                    
        # Start first ping timer
        self.ping_timer = Timer(WEBSOCKET_CONFIG['ping_interval'], send_ping)
        self.ping_timer.daemon = True
        self.ping_timer.start()
        
    def reconnect(self):
        """Attempt to reconnect WebSocket"""
        if self.reconnect_attempts < WEBSOCKET_CONFIG['max_reconnect_attempts']:
            print(f"Attempting to reconnect... (Attempt {self.reconnect_attempts + 1})")
            time.sleep(WEBSOCKET_CONFIG['reconnect_delay'])
            self.reconnect_attempts += 1
            
            # Close existing connection if any
            if self.ws:
                self.ws.close()
                
            # Initialize new connection
            self.initialize_websocket()
        else:
            print("Max reconnection attempts reached. Please restart the trader.")
            self.running = False
            
    def initialize_websocket(self):
        """Initialize WebSocket connection"""
        websocket.enableTrace(False)
        self.ws = websocket.WebSocketApp(
            self.api_config['websocket_stream'],
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
            on_open=self.on_open,
            on_ping=self.on_ping,
            on_pong=self.on_pong
        )
        
        # Start WebSocket connection in a separate thread
        self.ws_thread = Thread(target=self.ws.run_forever)
        self.ws_thread.daemon = True
        self.ws_thread.start()
            
    def run(self, symbol, strategy, balance=1000):
        """Run live trading"""
        self.trading_symbol = symbol.upper()
        self.strategy = strategy
        self.balance = balance
        
        print(f"\n{'='*50}")
        print(f"Starting live trading for {self.trading_symbol}")
        print(f"Strategy: {strategy.__class__.__name__}")
        print(f"Initial balance: ${balance:,.2f}")
        print(f"{'='*50}\n")
        print("Connecting to Binance Futures...")
        
        # Initialize WebSocket
        self.running = True
        self.initialize_websocket()
        
        try:
            while self.running:
                time.sleep(0.1)  # Small sleep to prevent CPU overuse
        except KeyboardInterrupt:
            print("\nStopping live trading...")
            self.running = False
            if self.ping_timer:
                self.ping_timer.cancel()
            if self.ws:
                self.ws.close()
            if self.ws_thread:
                self.ws_thread.join()
            print("Trading stopped")
            
    def process_trade(self, message):
        """Process incoming trade message"""
        try:
            if message['e'] == 'aggTrade':
                self.current_price = float(message['p'])
                print(f"\r{datetime.now().strftime('%H:%M:%S')} | {self.trading_symbol}: ${self.current_price:,.2f} | Pos: {self.current_position:.3f} | P&L: ${self.current_position * self.current_price:,.2f} | Trades: {len(self.trades)}", end="", flush=True)
        except Exception as e:
            print(f"\nError processing trade: {str(e)}")
            print(f"Message: {message}")
        
    def process_kline(self, message):
        """Process incoming kline message"""
        try:
            if message['e'] != 'kline':
                return
                
            kline = message['k']
            if not kline['x']:  # Only process completed candles
                return
                
            # Create DataFrame with single row of latest data
            df = pd.DataFrame([{
                'open': float(kline['o']),
                'high': float(kline['h']), 
                'low': float(kline['l']),
                'close': float(kline['c']),
                'volume': float(kline['v']),
                'close_time': pd.to_datetime(kline['T'], unit='ms')
            }])
            
            # Generate trading signals
            signal = self.strategy.generate_signals(df)
            
            # Execute trades based on signal
            if signal == 1 and self.current_position <= 0:
                print(f"\n\n{'='*50}")
                print(f"BUY SIGNAL DETECTED @ ${float(kline['c']):,.2f}")
                print(f"Time: {datetime.now().strftime('%H:%M:%S')}")
                print(f"{'='*50}\n")
                self.execute_trade("BUY")
            elif signal == -1 and self.current_position >= 0:
                print(f"\n\n{'='*50}")
                print(f"SELL SIGNAL DETECTED @ ${float(kline['c']):,.2f}")
                print(f"Time: {datetime.now().strftime('%H:%M:%S')}")
                print(f"{'='*50}\n")
                self.execute_trade("SELL")
                
        except Exception as e:
            print(f"\nError processing kline: {str(e)}")
            print(f"Message: {message}")
            
    def execute_trade(self, side):
        """Execute trade based on signal"""
        try:
            # Get symbol info
            symbol_info = self.client.exchange_info()
            symbol_filters = next(s for s in symbol_info['symbols'] if s['symbol'] == self.trading_symbol)
            
            # Get LOT_SIZE filter
            lot_size_filter = next(f for f in symbol_filters['filters'] if f['filterType'] == 'LOT_SIZE')
            min_qty = float(lot_size_filter['minQty'])
            step_size = float(lot_size_filter['stepSize'])
            
            # Calculate position size based on current price and balance
            position_size = (self.balance * self.strategy.position_size) / self.current_price
            
            # Ensure minimum notional value is met
            min_position_size = self.strategy.min_notional / self.current_price
            position_size = max(position_size, min_position_size)
            
            # Round position size to valid step size
            position_size = round(position_size / step_size) * step_size
            position_size = max(position_size, min_qty)
            
            # Calculate notional value
            notional_value = position_size * self.current_price
            
            # Verify final notional value
            if notional_value < self.strategy.min_notional:
                position_size = (self.strategy.min_notional / self.current_price)
                position_size = round(position_size / step_size) * step_size + step_size
                notional_value = position_size * self.current_price
            
            print(f"\n{'='*50}")
            print(f"EXECUTING {side} ORDER")
            print(f"Time: {datetime.now().strftime('%H:%M:%S.%f')[:-3]}")
            print(f"Price: ${self.current_price:,.2f}")
            print(f"Size: {position_size:.8f} {self.trading_symbol}")
            print(f"Notional: ${notional_value:,.2f}")
            print(f"{'='*50}\n")
            
            order = self.client.new_order(
                symbol=self.trading_symbol,
                side=side,
                type="MARKET",
                quantity=position_size
            )
            
            # Update position
            self.current_position = position_size if side == "BUY" else -position_size
            
            # Record trade
            self.trades.append({
                'timestamp': datetime.now(),
                'side': side,
                'price': self.current_price,
                'quantity': position_size,
                'notional': notional_value
            })
            
            # Update balance
            if side == "SELL":
                self.balance += notional_value
            else:
                self.balance -= notional_value
            
            # Print updated position
            print(f"New position: {self.current_position:.8f} {self.trading_symbol}")
            print(f"Updated balance: ${self.balance:,.2f}")
            print(f"Total trades: {len(self.trades)}")
            print(f"{'='*50}\n")
            
        except Exception as e:
            print(f"\nError executing trade: {str(e)}")
            if hasattr(e, 'response'):
                print(f"Response: {e.response.text}") 