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
from rich.table import Table
from rich import box
from rich.console import Console
from backtester.backtest_engine import run_backtest

class BinancePaperTrader:
    def __init__(self, api_key, api_secret, use_testnet=True, leverage=1):
        """Initialize paper trader"""
        self.api_key = api_key
        self.api_secret = api_secret
        self.use_testnet = use_testnet
        self.leverage = leverage
        
        # Get API config based on testnet/mainnet
        self.api_config = BINANCE_API_CONFIG['testnet' if use_testnet else 'mainnet']
        
        # Initialize Futures client
        self.client = UMFutures(
            key=api_key,
            secret=api_secret,
            base_url=self.api_config['futures_api']  # This already points to testnet URL from config
        )
        
        # Log the API URL being used
        self.log(f"Using Futures API URL: {self.api_config['futures_api']}", "info")
        
        # Initialize display
        self.display = TradingDisplay()
        
        # Initialize WebSocket client
        self.ws_client = None
        self.running = False
        
        # Trading state
        self.current_position = 0
        self.position_entry_price = 0.0
        self.position_entry_time = None
        self.unrealized_pnl = 0.0
        self.balance = 0.0
        
        # Price tracking
        self.current_bid = 0.0
        self.current_ask = 0.0
        self.prev_price = 0.0
        self.session_start_price = None
        self.price_samples = []  # Store last few prices for better change calculation
        self.max_price_samples = 60  # Keep 60 samples (about 1 minute of data)
        
        # Time tracking
        self.last_trade_time = time.time()
        self.last_print_time = time.time()
        self.update_counter = 0
        self.messages_received = 0
        
        # Thread safety
        self.price_lock = Lock()
        
        # Trading parameters
        self.trading_symbol = None
        self.interval = '1m'  # Default interval
        self.strategy = None
        
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
        # Initialize with safe defaults
        if not hasattr(self, 'current_bid'):
            self.current_bid = 0.0
        if not hasattr(self, 'current_ask'):
            self.current_ask = 0.0
        if not hasattr(self, 'current_position'):
            self.current_position = 0
        if not hasattr(self, 'position_entry_price'):
            self.position_entry_price = 0.0
        if not hasattr(self, 'unrealized_pnl'):
            self.unrealized_pnl = 0.0
        if not hasattr(self, 'prev_price'):
            self.prev_price = 0.0
            
        # Get current price safely
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
            hold_time = str(datetime.now() - self.position_entry_time).split('.')[0]
        
        # Calculate spread safely
        spread = 0.0
        if self.current_ask is not None and self.current_bid is not None:
            spread = self.current_ask - self.current_bid
        
        # Get proximity information from strategy if available
        proximity_info = {}
        if hasattr(self.strategy, 'get_proximity_info'):
            proximity_info = self.strategy.get_proximity_info()
        
        # Build indicators dict with proximity data
        indicators_dict = {
            'Bid': self.current_bid if self.current_bid else 0,
            'Ask': self.current_ask if self.current_ask else 0,
            'Spread': spread,
            'Hold Time': hold_time
        }
        
        # Add proximity indicators if available
        if proximity_info:
            indicators_dict.update({
                'Long Signal': f"{proximity_info.get('long_proximity', 0):.0f}%",
                'Short Signal': f"{proximity_info.get('short_proximity', 0):.0f}%",
                'Volume': f"{proximity_info.get('volume_proximity', 0):.0f}%",
                'L-Price': f"${proximity_info.get('long_breakout_price', 0):.2f}",
                'S-Price': f"${proximity_info.get('short_breakout_price', 0):.2f}"
            })
        
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
                'signal': 'NONE',  # Will be updated when signals are generated
                'indicators': indicators_dict
            }
        }
        
    def should_trade(self) -> bool:
        """Check if trading should occur - optimized for speed"""
        current_time = time.time()
        
        # Always allow closing positions
        if self.current_position != 0:
            return True
            
        # Reduced delay between trades for faster execution
        if current_time - self.last_trade_time < 0.1:  # 100ms minimum between trades
            return False
            
        return True  # Allow trading by default
        
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
                        
                        # Update price tracking
                        new_ask = float(data['a'])
                        new_bid = float(data['b'])
                        current_price = new_ask  # Use ask price as current price for consistency
                        
                        # Initialize session start price
                        if self.session_start_price is None:
                            self.session_start_price = current_price
                            self.prev_price = current_price
                        else:
                            # Use price from 30 samples ago (about 30 seconds) for meaningful change calculation
                            if len(self.price_samples) >= 30:
                                self.prev_price = self.price_samples[-30]
                            else:
                                self.prev_price = self.session_start_price
                        
                        # Add current price to samples and maintain size limit
                        self.price_samples.append(current_price)
                        if len(self.price_samples) > self.max_price_samples:
                            self.price_samples.pop(0)  # Remove oldest sample
                        
                        self.current_bid = new_bid
                        self.current_ask = new_ask
                        current_time = time.time()
                        
                        # Calculate unrealized PnL if position exists
                        if self.current_position != 0 and self.position_entry_price:
                            current_price = self.current_bid if self.current_position > 0 else self.current_ask
                            # P&L = position_size_btc * price_difference * leverage (Binance futures P&L includes leverage)
                            self.unrealized_pnl = self.current_position * (current_price - self.position_entry_price) * self.leverage
                        else:
                            self.unrealized_pnl = 0.0
                        
                        # Only process signals periodically to reduce CPU load
                        if current_time - getattr(self, 'last_signal_time', 0) < 0.1:  # Process signals max 10x per second
                            return
                        self.last_signal_time = current_time
                        
                        # Generate signals from real-time prices
                        if not self.should_trade():
                            return
                            
                        # Update strategy's historical data
                        self.strategy.process_new_data(
                            open_price=self.current_bid,
                            high_price=self.current_ask,
                            low_price=self.current_bid,
                            close_price=self.current_ask,
                            volume=0
                        )
                        
                        # Get DataFrame with historical data
                        df = self.strategy.get_dataframe()
                        
                        # Skip if not enough data points
                        if len(df) < self.strategy.min_data_points:
                            return
                        
                        # Calculate indicators
                        self.strategy.calculate_indicators(df)
                        
                        # Get current position status
                        current_position = 'LONG' if self.current_position > 0 else 'SHORT' if self.current_position < 0 else 'FLAT'
                        
                        # Generate signal
                        signal = self.strategy.generate_signals(
                            df, 
                            current_position=current_position,
                            current_price=self.current_ask,
                            current_bid=self.current_bid,
                            current_ask=self.current_ask
                        )
                        
                        # Calculate position size based on balance and leverage
                        account_value = self.balance + (self.unrealized_pnl if self.unrealized_pnl else 0)
                        
                        # Get position size percentage from strategy (5% = 0.05)
                        position_size_percent = self.strategy.position_size if hasattr(self.strategy, 'position_size') else 0.05
                        
                        # Calculate position value in USD (this is what we want to control)
                        position_value_usd = account_value * position_size_percent  # 5% of balance = $50 
                        
                        # Convert to BTC quantity (no leverage multiplication here - leverage is handled by exchange)
                        trade_size = position_value_usd / self.current_ask  # $50 / $104,895 = 0.000477 BTC
                        
                        # Safety check: ensure we don't exceed available margin
                        max_position_value = account_value * self.leverage * 0.95  # Total buying power
                        max_btc_size = max_position_value / self.current_ask
                        
                        # Take the smaller of the two and round to 3 decimals
                        trade_size = round(min(trade_size, max_btc_size), 3)
                        
                        # Ensure minimum trade size
                        if trade_size < 0.001:  # Minimum trade size for BTC
                            trade_size = 0.001
                        
                        if signal == 'BUY' and self.current_position <= 0:
                            if self.execute_trade("BUY", trade_size):
                                self.strategy.last_trade_time = current_time
                                position_value = trade_size * self.current_ask
                                console.print(Panel.fit(
                                    f"BUY SIGNAL EXECUTED\nPrice: ${self.current_ask:,.2f}\nSize: {trade_size:.3f} BTC\nPosition Value: ${position_value:,.2f}\nLeverage: {self.leverage}x\nBalance: ${account_value:,.2f}",
                                    title="Trade Signal",
                                    border_style="green"
                                ))
                                
                        elif signal == 'SELL' and self.current_position >= 0:
                            if self.execute_trade("SELL", trade_size):
                                self.strategy.last_trade_time = current_time
                                position_value = trade_size * self.current_bid
                                console.print(Panel.fit(
                                    f"SELL SIGNAL EXECUTED\nPrice: ${self.current_bid:,.2f}\nSize: {trade_size:.3f} BTC\nPosition Value: ${position_value:,.2f}\nLeverage: {self.leverage}x\nBalance: ${account_value:,.2f}",
                                    title="Trade Signal",
                                    border_style="red"
                                ))
                        
                        elif signal == 'CLOSE' and self.current_position != 0:
                            close_price = self.current_bid if self.current_position > 0 else self.current_ask
                            if self.execute_trade("CLOSE", abs(self.current_position)):
                                self.strategy.last_trade_time = current_time
                                pnl = self.unrealized_pnl if self.unrealized_pnl else 0
                                roi = (pnl / account_value) * 100 if account_value > 0 else 0
                                console.print(Panel.fit(
                                    f"POSITION CLOSED\nPrice: ${close_price:,.2f}\nSize: {abs(self.current_position):.3f} BTC\nP&L: ${pnl:,.2f} ({roi:+.2f}%)",
                                    title="Trade Signal",
                                    border_style="yellow"
                                ))
                        
                        # Update display more frequently for real-time feel
                        if current_time - self.last_print_time >= 0.1:  # 10 FPS for smooth updates
                            self.update_counter += 1
                            display_data = self.get_display_data()
                            panel = self.display.display_live_status(display_data)
                            console.print(panel)
                            self.last_print_time = current_time
                            
                elif data['e'] == 'kline' and data['k']['x']:
                    # Process completed klines for volume data
                    kline = data['k']
                    volume = float(kline['v'])
                    
                    # Update strategy with volume data
                    if hasattr(self.strategy, 'update_volume'):
                        self.strategy.update_volume(volume)
                        
        except Exception as e:
            self.log(f"Error processing message: {str(e)}", "error")
            
    def execute_trade(self, side: str, size: float) -> bool:
        """Execute a trade"""
        try:
            # Round size to 3 decimal places for BTC
            size = round(size, 3)
            
            # Prepare order parameters
            params = {
                'symbol': self.trading_symbol,
                'side': side,
                'type': 'MARKET',
                'quantity': size,
                'newOrderRespType': 'RESULT',
                'timestamp': int(time.time() * 1000)
            }
            
            # Execute the order
            order = self.client.new_order(**params)
            
            # Update position tracking
            filled_qty = float(order['executedQty'])
            filled_price = float(order['avgPrice'])
            
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
                
            # Log the trade
            self.log(f"Order executed: {order}", "success")
            console.print(Panel.fit(
                f"Side: {side}\nQuantity: {filled_qty:.3f}\nPrice: ${filled_price:,.2f}\nOrder ID: {order['orderId']}",
                title="Order Filled",
                border_style="green"
            ))
            
            return True
                
        except Exception as e:
            self.log(f"Trade Error: {str(e)}", "error")
            return False
            
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
            self.ws_client.kline(symbol=self.trading_symbol.lower(), interval=self.interval)
            
            # Initialize timing variables
            self.last_print_time = time.time()
            self.messages_received = 0
            
            self.log("WebSocket connection initialized", "info")
            
        except Exception as e:
            self.log(f"Error initializing WebSocket: {str(e)}", "error")
            raise
            
    def run(self, symbol, strategy, balance=1000, interval='1m'):
        """Run live trading"""
        try:
            # Initialize basic parameters first
            self.trading_symbol = symbol.upper()  # Set symbol first
            self.strategy = strategy
            self.balance = balance
            self.interval = interval  # Store interval
            
            print(f"\n{'='*50}")
            print(f"Starting live trading for {self.trading_symbol}")
            print(f"Strategy: {strategy.__class__.__name__}")
            print(f"Initial balance: ${balance:,.2f}")
            print(f"Interval: {interval}")
            
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
                time.sleep(0.0001)  # Ultra-minimal sleep for maximum responsiveness
                
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

    def display_status(self):
        """Display current trading status"""
        # Get latest data
        latest_data = self.historical_data.iloc[-1] if not self.historical_data.empty else None
        
        # Format indicators
        indicators = []
        if latest_data is not None:
            indicators.extend([
                f"BB: {latest_data.get('bb_middle', 'N/A'):.2f}",
                f"Upper: {latest_data.get('bb_upper', 'N/A'):.2f}",
                f"Lower: {latest_data.get('bb_lower', 'N/A'):.2f}",
                f"RSI: {latest_data.get('rsi', 'N/A'):.1f}",
                f"CCI: {latest_data.get('cci', 'N/A'):.1f}",
                f"Vol: {latest_data.get('volume', 'N/A'):.1f}"
            ])
        
        # Create status table
        table = Table(title="Live Trading Status", box=box.DOUBLE_EDGE)
        
        # Add columns
        table.add_column("Symbol", style="cyan")
        table.add_column("Price", style="green")
        table.add_column("Change", style="yellow")
        table.add_column("Position", style="magenta")
        table.add_column("P&L", style="red")
        table.add_column("Signal", style="blue")
        table.add_column("Indicators", style="white")
        
        # Add row
        position_color = "green" if self.position == "LONG" else "red" if self.position == "SHORT" else "white"
        pnl_color = "green" if self.unrealized_pnl > 0 else "red" if self.unrealized_pnl < 0 else "white"
        
        table.add_row(
            self.symbol,
            f"${self.current_price:,.2f}",
            f"{self.price_change:+.2f}%",
            f"[{position_color}]{self.position}[/]",
            f"[{pnl_color}]${self.unrealized_pnl:,.2f}[/]",
            str(self.last_signal),
            " | ".join(indicators) if indicators else "N/A"
        )
        
        # Create panel and display
        panel = Panel(table)
        console = Console()
        console.print(panel) 

    def backtest(self, symbol: str, strategy, balance: float = 1000, interval: str = '1m'):
        """Run backtest"""
        try:
            # Initialize basic parameters
            self.trading_symbol = symbol.upper()
            self.strategy = strategy
            self.balance = balance
            self.interval = interval
            
            print(f"\n{'='*50}")
            print(f"Starting backtest for {self.trading_symbol}")
            print(f"Strategy: {strategy.__class__.__name__}")
            print(f"Initial balance: ${balance:,.2f}")
            print(f"Interval: {interval}")
            
            # Get historical data
            end_time = int(time.time() * 1000)
            start_time = end_time - (1000 * 60 * 60 * 24 * 7)  # 7 days of data
            
            klines = self.client.klines(
                symbol=self.trading_symbol,
                interval=interval,
                startTime=start_time,
                endTime=end_time,
                limit=1000
            )
            
            # Convert to DataFrame
            df = pd.DataFrame(klines, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume',
                'close_time', 'quote_asset_volume', 'number_of_trades',
                'taker_buy_base_asset_volume', 'taker_buy_quote_asset_volume', 'ignore'
            ])
            
            # Convert timestamp to datetime
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df.set_index('timestamp', inplace=True)
            
            # Convert price columns to float
            numeric_columns = ['open', 'high', 'low', 'close', 'volume']
            df[numeric_columns] = df[numeric_columns].astype(float)
            
            # Run backtest
            total_return, params, trades_df = run_backtest(
                df=df,
                strategy_name=strategy.__class__.__name__.lower(),
                sl=strategy.stop_loss,
                tp=strategy.take_profit,
                ps=strategy.position_size,
                initial_balance=balance,
                interval=interval
            )
            
            if trades_df is not None:
                self.display.display_backtest_results(trades_df, self.trading_symbol)
            else:
                print("No trades executed during backtest")
                
        except Exception as e:
            self.log(f"Error in backtest: {str(e)}", "error")
            raise 