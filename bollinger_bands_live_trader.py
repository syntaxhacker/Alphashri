#!/usr/bin/env python3
"""
Live Bollinger Bands Trading Bot for Binance
Implements the same strategy tested in improved_eth_walkforward.py
"""

import os
import time
import json
import logging
from datetime import datetime, timedelta
from threading import Thread, Lock
from collections import deque
import numpy as np
import pandas as pd

from binance.client import Client
from binance.um_futures import UMFutures
from binance.websocket.um_futures.websocket_client import UMFuturesWebsocketClient
from config import BINANCE_API_CONFIG, WEBSOCKET_CONFIG
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.live import Live
from rich.layout import Layout
from rich import box

# Import data fetcher for initialization
from enhanced_data_fetcher import EnhancedDataFetcher
from enhanced_data_cache import EnhancedDataCache

class BollingerBandsLiveTrader:
    """Live trader for Bollinger Bands mean reversion strategy"""
    
    def __init__(self, api_key, api_secret, use_testnet=True, leverage=1):
        self.console = Console()
        self.api_key = api_key
        self.api_secret = api_secret
        self.use_testnet = use_testnet
        self.leverage = leverage
        
        # Binance API setup
        self.api_config = BINANCE_API_CONFIG['testnet' if use_testnet else 'mainnet']
        self.client = UMFutures(
            key=api_key,
            secret=api_secret,
            base_url=self.api_config['futures_api']
        )
        
        # WebSocket setup
        self.ws_client = None
        self.running = False
        
        # Trading state
        self.current_position = 0  # 0 = flat, positive = long, negative = short
        self.position_entry_price = 0.0
        self.position_entry_time = None
        self.unrealized_pnl = 0.0
        self.balance = 10000.0  # Starting balance
        
        # Price tracking
        self.current_price = 0.0
        self.current_bid = 0.0
        self.current_ask = 0.0
        
        # Data buffers for 4-hour analysis
        self.price_buffer = deque(maxlen=200)  # Store enough 4h bars for indicators
        self.volume_buffer = deque(maxlen=200)
        self.high_buffer = deque(maxlen=200)
        self.low_buffer = deque(maxlen=200)
        self.open_buffer = deque(maxlen=200)
        
        # Current 4-hour bar tracking
        self.current_4h_bar = {
            'open': 0.0,
            'high': 0.0,
            'low': 0.0,
            'close': 0.0,
            'volume': 0.0,
            'start_time': None
        }
        
        # Strategy parameters (from optimized walkforward results)
        self.bb_period = 20
        self.bb_std = 2.0
        self.volume_mult = 1.2
        self.trail_pct = 0.03
        self.min_squeeze_threshold = 0.02
        self.max_hold_periods = 60  # 60 4-hour bars = 10 days max hold
        
        # Trailing stop tracking
        self.highest_price_since_entry = 0.0
        self.lowest_price_since_entry = 0.0
        self.trailing_stop_price = 0.0
        
        # Thread safety
        self.data_lock = Lock()
        
        # Trading controls
        self.trading_symbol = None
        self.last_signal_time = 0
        self.min_signal_interval = 240  # 4 minutes minimum between signals (for 4h strategy)
        
        # Performance tracking
        self.total_trades = 0
        self.winning_trades = 0
        self.total_pnl = 0.0
        self.max_drawdown = 0.0
        self.peak_balance = 10000.0
        
        # Initialize data fetcher for historical data
        self.data_fetcher = EnhancedDataFetcher(
            api_key=api_key,
            api_secret=api_secret,
            cache_dir="live_trader_cache"
        )
        
    def calculate_atr(self, data, period=14):
        """Calculate Average True Range"""
        if len(data) < period:
            return pd.Series([0] * len(data), index=data.index)
            
        high_low = data['high'] - data['low']
        high_close = np.abs(data['high'] - data['close'].shift())
        low_close = np.abs(data['low'] - data['close'].shift())
        
        tr = np.maximum(high_low, np.maximum(high_close, low_close))
        return tr.rolling(window=period).mean().fillna(0)
    
    def calculate_rsi(self, data, period=14):
        """Calculate Relative Strength Index"""
        if len(data) < period:
            return pd.Series([50] * len(data), index=data.index)
            
        delta = data['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi.fillna(50)
    
    def get_current_dataframe(self):
        """Convert buffers to DataFrame for analysis, including current incomplete 4h bar"""
        if len(self.price_buffer) < 50:  # Need minimum data
            return None
            
        # Start with completed bars from buffers
        open_data = list(self.open_buffer)
        high_data = list(self.high_buffer)
        low_data = list(self.low_buffer)
        close_data = list(self.price_buffer)
        volume_data = list(self.volume_buffer)
        
        # Add current incomplete 4-hour bar if it exists
        if self.current_4h_bar['start_time'] is not None:
            open_data.append(self.current_4h_bar['open'])
            high_data.append(self.current_4h_bar['high'])
            low_data.append(self.current_4h_bar['low'])
            close_data.append(self.current_4h_bar['close'])
            volume_data.append(self.current_4h_bar['volume'])
        
        data = pd.DataFrame({
            'open': open_data,
            'high': high_data,
            'low': low_data,
            'close': close_data,
            'volume': volume_data
        })
        
        # Create synthetic timestamps (for calculation purposes)
        end_time = datetime.now()
        timestamps = [end_time - timedelta(hours=4*i) for i in range(len(data)-1, -1, -1)]
        data.index = timestamps
        
        return data
    
    def calculate_bollinger_bands_signals(self, data):
        """Calculate Bollinger Bands signals for mean reversion strategy"""
        if len(data) < self.bb_period + 10:
            return False, False, None  # long_signal, short_signal, enhanced_data
        
        df = data.copy()
        
        # Core Bollinger Bands
        df['bb_middle'] = df['close'].rolling(window=self.bb_period).mean()
        df['bb_std'] = df['close'].rolling(window=self.bb_period).std()
        df['bb_upper'] = df['bb_middle'] + (df['bb_std'] * self.bb_std)
        df['bb_lower'] = df['bb_middle'] - (df['bb_std'] * self.bb_std)
        
        # Bollinger Band metrics
        df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_middle']
        df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])
        df['bb_squeeze'] = df['bb_width'] < self.min_squeeze_threshold
        
        # Volume indicators
        df['volume_ema'] = df['volume'].ewm(span=20).mean()
        df['volume_ratio'] = df['volume'] / df['volume_ema']
        
        # Additional indicators
        df['rsi'] = self.calculate_rsi(df, 14)
        df['atr'] = self.calculate_atr(df, 14)
        
        # Trend context
        df['trend_ema'] = df['close'].ewm(span=50).mean()
        df['trend_bias'] = df['close'] > df['trend_ema']
        
        # Get latest values
        latest = df.iloc[-1]
        current_price = latest['close']
        bb_upper = latest['bb_upper']
        bb_lower = latest['bb_lower']
        bb_middle = latest['bb_middle']
        volume_ratio = latest['volume_ratio']
        rsi = latest['rsi']
        bb_position = latest['bb_position']
        
        # BOLLINGER BANDS MEAN REVERSION SIGNALS
        
        # LONG Signal: Price hits lower band (oversold)
        long_signal = (
            current_price <= bb_lower * 1.005 and  # At or near lower band
            rsi < 40 and  # RSI oversold
            volume_ratio > self.volume_mult and  # Volume confirmation
            bb_position < 0.2  # Position in lower 20% of bands
        )
        
        # SHORT Signal: Price hits upper band (overbought)  
        short_signal = (
            current_price >= bb_upper * 0.995 and  # At or near upper band
            rsi > 60 and  # RSI overbought
            volume_ratio > self.volume_mult and  # Volume confirmation
            bb_position > 0.8  # Position in upper 20% of bands
        )
        
        return long_signal, short_signal, df
    
    def check_exit_conditions(self, data):
        """Check if current position should be closed"""
        if self.current_position == 0:
            return False
            
        latest = data.iloc[-1]
        current_price = latest['close']
        bb_middle = latest['bb_middle']
        
        # Update trailing stops
        if self.current_position > 0:  # Long position
            # Update highest price
            if current_price > self.highest_price_since_entry:
                self.highest_price_since_entry = current_price
                self.trailing_stop_price = current_price * (1 - self.trail_pct)
            
            # Exit conditions for long
            trailing_stop_hit = current_price <= self.trailing_stop_price
            mean_reversion_target = current_price >= bb_middle * 0.999  # Close to middle band
            max_hold_exceeded = self.get_position_duration_hours() > (self.max_hold_periods * 4)
            
            if trailing_stop_hit:
                self.console.print(f"[yellow]📉 Long position trailing stop hit: {current_price:.2f} <= {self.trailing_stop_price:.2f}[/yellow]")
                return True
            elif mean_reversion_target:
                self.console.print(f"[green]🎯 Long position target hit: Price returned to middle band[/green]")
                return True
            elif max_hold_exceeded:
                self.console.print(f"[orange]⏰ Long position max hold exceeded[/orange]")
                return True
                
        elif self.current_position < 0:  # Short position
            # Update lowest price
            if current_price < self.lowest_price_since_entry:
                self.lowest_price_since_entry = current_price
                self.trailing_stop_price = current_price * (1 + self.trail_pct)
            
            # Exit conditions for short
            trailing_stop_hit = current_price >= self.trailing_stop_price
            mean_reversion_target = current_price <= bb_middle * 1.001  # Close to middle band
            max_hold_exceeded = self.get_position_duration_hours() > (self.max_hold_periods * 4)
            
            if trailing_stop_hit:
                self.console.print(f"[yellow]📈 Short position trailing stop hit: {current_price:.2f} >= {self.trailing_stop_price:.2f}[/yellow]")
                return True
            elif mean_reversion_target:
                self.console.print(f"[green]🎯 Short position target hit: Price returned to middle band[/green]")
                return True
            elif max_hold_exceeded:
                self.console.print(f"[orange]⏰ Short position max hold exceeded[/orange]")
                return True
        
        return False
    
    def get_position_duration_hours(self):
        """Get current position duration in hours"""
        if self.position_entry_time is None:
            return 0
        return (datetime.now() - self.position_entry_time).total_seconds() / 3600
    
    def update_4h_bar(self, price, volume):
        """Update current 4-hour bar with tick data"""
        current_time = datetime.now()
        
        # Initialize tick counter for debugging
        if not hasattr(self, 'tick_count'):
            self.tick_count = 0
        self.tick_count += 1
        
        # Check if we need to start a new 4-hour bar
        if (self.current_4h_bar['start_time'] is None or 
            (current_time - self.current_4h_bar['start_time']).total_seconds() >= 14400):  # 4 hours = 14400 seconds
            
            # Save completed bar to buffers
            if self.current_4h_bar['start_time'] is not None:
                self.price_buffer.append(self.current_4h_bar['close'])
                self.volume_buffer.append(self.current_4h_bar['volume'])
                self.high_buffer.append(self.current_4h_bar['high'])
                self.low_buffer.append(self.current_4h_bar['low'])
                self.open_buffer.append(self.current_4h_bar['open'])
                
                self.console.print(f"[cyan]📊 Completed 4h bar: O:{self.current_4h_bar['open']:.2f} H:{self.current_4h_bar['high']:.2f} L:{self.current_4h_bar['low']:.2f} C:{self.current_4h_bar['close']:.2f} V:{self.current_4h_bar['volume']:.2f}[/cyan]")
            
            # Start new bar
            self.current_4h_bar = {
                'open': price,
                'high': price,
                'low': price,
                'close': price,
                'volume': volume,
                'start_time': current_time
            }
            self.console.print(f"[green]🕐 New 4h bar started at {current_time.strftime('%H:%M:%S')}[/green]")
        else:
            # Update current bar
            self.current_4h_bar['high'] = max(self.current_4h_bar['high'], price)
            self.current_4h_bar['low'] = min(self.current_4h_bar['low'], price)
            self.current_4h_bar['close'] = price
            self.current_4h_bar['volume'] += volume
        
        # Debug output every 50 ticks to show activity
        if self.tick_count % 50 == 0:
            self.console.print(f"[yellow]📊 Tick #{self.tick_count}: Price=${price:.2f}, Vol={volume:.4f}, Current 4h Vol={self.current_4h_bar['volume']:.2f}[/yellow]")
    
    def execute_trade(self, signal_type, size_percentage=0.95):
        """Execute a trade based on signal"""
        try:
            # Calculate position size (95% of balance for leverage)
            account_info = self.client.account()
            available_balance = float(account_info['totalWalletBalance'])
            
            # Calculate position size in USD
            position_size_usd = available_balance * size_percentage * self.leverage
            position_size_crypto = position_size_usd / self.current_price
            
            # Round to appropriate decimal places for the symbol
            position_size_crypto = round(position_size_crypto, 3)
            
            if signal_type == "LONG":
                side = "BUY"
                self.console.print(f"[green]🚀 Executing LONG position: {position_size_crypto} @ ${self.current_price:.2f}[/green]")
                
            elif signal_type == "SHORT":
                side = "SELL"
                self.console.print(f"[red]📉 Executing SHORT position: {position_size_crypto} @ ${self.current_price:.2f}[/red]")
                
            elif signal_type == "CLOSE":
                # Close current position
                if self.current_position > 0:
                    side = "SELL"
                    position_size_crypto = abs(self.current_position)
                elif self.current_position < 0:
                    side = "BUY"
                    position_size_crypto = abs(self.current_position)
                else:
                    return False
                    
                self.console.print(f"[yellow]❌ Closing position: {position_size_crypto} @ ${self.current_price:.2f}[/yellow]")
            
            # Execute order
            order = self.client.new_order(
                symbol=self.trading_symbol,
                side=side,
                type='MARKET',
                quantity=position_size_crypto,
                timestamp=int(time.time() * 1000)
            )
            
            # Update position tracking
            if signal_type == "LONG":
                self.current_position = position_size_crypto
                self.position_entry_price = self.current_price
                self.position_entry_time = datetime.now()
                self.highest_price_since_entry = self.current_price
                self.trailing_stop_price = self.current_price * (1 - self.trail_pct)
                
            elif signal_type == "SHORT":
                self.current_position = -position_size_crypto
                self.position_entry_price = self.current_price
                self.position_entry_time = datetime.now()
                self.lowest_price_since_entry = self.current_price
                self.trailing_stop_price = self.current_price * (1 + self.trail_pct)
                
            elif signal_type == "CLOSE":
                # Calculate P&L
                if self.current_position > 0:  # Closing long
                    pnl = self.current_position * (self.current_price - self.position_entry_price)
                else:  # Closing short
                    pnl = abs(self.current_position) * (self.position_entry_price - self.current_price)
                
                self.total_pnl += pnl
                self.total_trades += 1
                if pnl > 0:
                    self.winning_trades += 1
                
                # Reset position
                self.current_position = 0
                self.position_entry_price = 0.0
                self.position_entry_time = None
                self.highest_price_since_entry = 0.0
                self.lowest_price_since_entry = 0.0
                self.trailing_stop_price = 0.0
                
                self.console.print(f"[{'green' if pnl > 0 else 'red'}]💰 Trade P&L: ${pnl:.2f}[/{'green' if pnl > 0 else 'red'}]")
            
            self.console.print(f"[green]✅ Order executed successfully: {order['orderId']}[/green]")
            return True
            
        except Exception as e:
            self.console.print(f"[red]❌ Error executing trade: {str(e)}[/red]")
            return False
    
    def process_signals(self):
        """Process trading signals from current data"""
        current_time = time.time()
        
        # Rate limiting for 4-hour strategy
        if current_time - self.last_signal_time < self.min_signal_interval:
            return
        
        # Get current data
        data = self.get_current_dataframe()
        if data is None:
            return
        
        # Get signal analysis for logging
        signals = self.get_signal_analysis()
        
        # Check exit conditions first
        if self.current_position != 0:
            if self.check_exit_conditions(data):
                self.execute_trade("CLOSE")
                self.last_signal_time = current_time
                return
        
        # Check entry conditions only if flat
        if self.current_position == 0:
            long_signal, short_signal, enhanced_data = self.calculate_bollinger_bands_signals(data)
            
            # Log signal strength for awareness
            if signals:
                if signals['long_strength'] >= 50:  # 50% or higher
                    self.console.print(f"[green]📈 LONG signal building: {signals['long_strength']:.0f}% strength[/green]")
                if signals['short_strength'] >= 50:  # 50% or higher
                    self.console.print(f"[red]📉 SHORT signal building: {signals['short_strength']:.0f}% strength[/red]")
                
                # Alert when very close to signal
                if signals['long_strength'] >= 75:
                    self.console.print(f"[bold green]⚡ LONG SIGNAL VERY STRONG: {signals['long_strength']:.0f}% - READY TO TRADE![/bold green]")
                if signals['short_strength'] >= 75:
                    self.console.print(f"[bold red]⚡ SHORT SIGNAL VERY STRONG: {signals['short_strength']:.0f}% - READY TO TRADE![/bold red]")
            
            if long_signal:
                self.console.print(f"[bold green]🚀 EXECUTING LONG TRADE - All conditions met![/bold green]")
                self.execute_trade("LONG")
                self.last_signal_time = current_time
            elif short_signal:
                self.console.print(f"[bold red]📉 EXECUTING SHORT TRADE - All conditions met![/bold red]")
                self.execute_trade("SHORT")
                self.last_signal_time = current_time
    
    def message_handler(self, _, message):
        """Handle WebSocket messages"""
        try:
            if isinstance(message, str):
                data = json.loads(message)
            else:
                data = message
            
            # Handle different message types
            if 'stream' in data and 'data' in data:
                # Combined stream format
                stream_data = data['data']
                stream_name = data['stream']
                
                if 'aggTrade' in stream_name or stream_data.get('e') == 'aggTrade':
                    # Aggregate trade data - most reliable for real-time updates
                    price = float(stream_data['p'])
                    quantity = float(stream_data['q'])
                    
                    self.current_price = price
                    self.current_bid = price * 0.9995  # Approximate bid
                    self.current_ask = price * 1.0005  # Approximate ask
                    
                    # Update 4-hour bar with trade data
                    self.update_4h_bar(price, quantity)
                    
                    # Process signals every update
                    self.process_signals()
                    
                elif 'bookTicker' in stream_name or stream_data.get('e') == 'bookTicker':
                    # Book ticker for bid/ask spreads
                    self.current_bid = float(stream_data['b'])
                    self.current_ask = float(stream_data['a'])
                    self.current_price = (self.current_bid + self.current_ask) / 2
                    
            elif 'e' in data:
                # Direct event format
                if data['e'] == 'aggTrade':
                    price = float(data['p'])
                    quantity = float(data['q'])
                    
                    self.current_price = price
                    self.current_bid = price * 0.9995
                    self.current_ask = price * 1.0005
                    
                    self.update_4h_bar(price, quantity)
                    self.process_signals()
                    
                elif data['e'] == 'bookTicker':
                    self.current_bid = float(data['b'])
                    self.current_ask = float(data['a'])
                    self.current_price = (self.current_bid + self.current_ask) / 2
                    
        except Exception as e:
            # Print the raw message for debugging
            self.console.print(f"[red]❌ Error processing message: {str(e)}[/red]")
            self.console.print(f"[yellow]Raw message: {str(message)[:200]}...[/yellow]")
    
    def initialize_historical_data(self):
        """Initialize with historical 4-hour data"""
        self.console.print("[cyan]📊 Fetching historical 4h data for initialization...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)  # Get 30 days of 4h data
        
        data = self.data_fetcher.fetch_data(
            symbol=self.trading_symbol,
            start_date=start_date,
            end_date=end_date,
            timeframe='4h'
        )
        
        if not data.empty:
            # Populate buffers with historical data
            for _, row in data.iterrows():
                self.open_buffer.append(row['open'])
                self.high_buffer.append(row['high'])
                self.low_buffer.append(row['low'])
                self.price_buffer.append(row['close'])
                self.volume_buffer.append(row['volume'])
            
            self.console.print(f"[green]✅ Loaded {len(data)} historical 4h bars[/green]")
        else:
            self.console.print("[red]❌ Could not load historical data[/red]")
    
    def initialize_websocket(self):
        """Initialize WebSocket connection"""
        try:
            self.ws_client = UMFuturesWebsocketClient(
                stream_url=self.api_config['websocket_stream'],
                on_message=self.message_handler,
                is_combined=True
            )
            
            # Subscribe to aggregate trade stream (most reliable for real-time data)
            self.ws_client.agg_trade(symbol=self.trading_symbol.lower())
            
            # Also subscribe to book ticker for bid/ask spreads
            self.ws_client.book_ticker(symbol=self.trading_symbol.lower())
            
            self.console.print("[green]✅ WebSocket connection initialized[/green]")
            self.console.print(f"[cyan]📡 Subscribing to {self.trading_symbol.lower()} streams...[/cyan]")
            
            # Give WebSocket a moment to connect
            import time
            time.sleep(2)
            
        except Exception as e:
            self.console.print(f"[red]❌ Error initializing WebSocket: {str(e)}[/red]")
            raise
    
    def get_signal_analysis(self):
        """Get detailed signal analysis for display"""
        data = self.get_current_dataframe()
        if data is None or len(data) < self.bb_period + 10:
            return None
        
        df = data.copy()
        
        # Calculate all indicators
        df['bb_middle'] = df['close'].rolling(window=self.bb_period).mean()
        df['bb_std'] = df['close'].rolling(window=self.bb_period).std()
        df['bb_upper'] = df['bb_middle'] + (df['bb_std'] * self.bb_std)
        df['bb_lower'] = df['bb_middle'] - (df['bb_std'] * self.bb_std)
        df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_middle']
        df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])
        df['volume_ema'] = df['volume'].ewm(span=20).mean()
        df['volume_ratio'] = df['volume'] / df['volume_ema']
        df['rsi'] = self.calculate_rsi(df, 14)
        
        # Get latest values
        latest = df.iloc[-1]
        current_price = latest['close']
        bb_upper = latest['bb_upper']
        bb_lower = latest['bb_lower']
        bb_middle = latest['bb_middle']
        bb_position = latest['bb_position']
        volume_ratio = latest['volume_ratio']
        rsi = latest['rsi']
        bb_width = latest['bb_width']
        
        # Calculate distances and signal strengths
        distance_to_upper = (bb_upper - current_price) / current_price * 100
        distance_to_lower = (current_price - bb_lower) / current_price * 100
        distance_to_middle = abs(current_price - bb_middle) / current_price * 100
        
        # Long signal analysis
        long_conditions = {
            'price_at_lower_band': current_price <= bb_lower * 1.005,
            'rsi_oversold': rsi < 40,
            'volume_confirmation': volume_ratio > self.volume_mult,
            'bb_position_low': bb_position < 0.2
        }
        
        # Short signal analysis
        short_conditions = {
            'price_at_upper_band': current_price >= bb_upper * 0.995,
            'rsi_overbought': rsi > 60,
            'volume_confirmation': volume_ratio > self.volume_mult,
            'bb_position_high': bb_position > 0.8
        }
        
        # Calculate signal strengths (0-100%)
        long_strength = sum(long_conditions.values()) / len(long_conditions) * 100
        short_strength = sum(short_conditions.values()) / len(short_conditions) * 100
        
        # Determine market state
        if bb_width < self.min_squeeze_threshold:
            market_state = "SQUEEZE"
        elif bb_position > 0.8:
            market_state = "OVERBOUGHT"
        elif bb_position < 0.2:
            market_state = "OVERSOLD"
        elif 0.4 <= bb_position <= 0.6:
            market_state = "NEUTRAL"
        else:
            market_state = "TRENDING"
        
        return {
            'bb_upper': bb_upper,
            'bb_middle': bb_middle,
            'bb_lower': bb_lower,
            'bb_position': bb_position,
            'bb_width': bb_width,
            'rsi': rsi,
            'volume_ratio': volume_ratio,
            'distance_to_upper': distance_to_upper,
            'distance_to_lower': distance_to_lower,
            'distance_to_middle': distance_to_middle,
            'long_conditions': long_conditions,
            'short_conditions': short_conditions,
            'long_strength': long_strength,
            'short_strength': short_strength,
            'market_state': market_state,
            'squeeze_active': bb_width < self.min_squeeze_threshold
        }

    def get_display_data(self):
        """Get data for display"""
        # Calculate unrealized P&L
        unrealized_pnl = 0.0
        if self.current_position != 0 and self.position_entry_price > 0:
            if self.current_position > 0:  # Long position
                unrealized_pnl = self.current_position * (self.current_price - self.position_entry_price)
            else:  # Short position
                unrealized_pnl = abs(self.current_position) * (self.position_entry_price - self.current_price)
        
        # Position status
        position_status = "FLAT"
        if self.current_position > 0:
            position_status = "LONG"
        elif self.current_position < 0:
            position_status = "SHORT"
        
        # Position duration
        position_duration = "N/A"
        if self.position_entry_time:
            duration = datetime.now() - self.position_entry_time
            hours = int(duration.total_seconds() // 3600)
            minutes = int((duration.total_seconds() % 3600) // 60)
            position_duration = f"{hours}h {minutes}m"
        
        return {
            'symbol': self.trading_symbol,
            'price': self.current_price,
            'bid': self.current_bid,
            'ask': self.current_ask,
            'position_status': position_status,
            'position_size': abs(self.current_position),
            'entry_price': self.position_entry_price,
            'unrealized_pnl': unrealized_pnl,
            'total_pnl': self.total_pnl,
            'total_trades': self.total_trades,
            'win_rate': (self.winning_trades / self.total_trades * 100) if self.total_trades > 0 else 0,
            'position_duration': position_duration,
            'trailing_stop': self.trailing_stop_price,
            'data_buffer_size': len(self.price_buffer)
        }
    
    def display_status(self):
        """Display trading status with signal analysis"""
        data = self.get_display_data()
        signals = self.get_signal_analysis()
        
        # Create main status table
        table = Table(title=f"🤖 Bollinger Bands Live Trader - {data['symbol']}")
        table.add_column("Metric", style="cyan", width=20)
        table.add_column("Value", style="green", width=15)
        
        table.add_row("Current Price", f"${data['price']:.2f}")
        table.add_row("Bid/Ask", f"${data['bid']:.2f} / ${data['ask']:.2f}")
        table.add_row("Position", f"{data['position_status']} ({data['position_size']:.3f})")
        
        if data['position_status'] != "FLAT":
            table.add_row("Entry Price", f"${data['entry_price']:.2f}")
            table.add_row("Unrealized P&L", f"${data['unrealized_pnl']:.2f}")
            table.add_row("Position Duration", data['position_duration'])
            table.add_row("Trailing Stop", f"${data['trailing_stop']:.2f}")
        
        table.add_row("Total P&L", f"${data['total_pnl']:.2f}")
        table.add_row("Total Trades", str(data['total_trades']))
        table.add_row("Win Rate", f"{data['win_rate']:.1f}%")
        table.add_row("Data Buffer", f"{data['data_buffer_size']} bars")
        
        # Create Bollinger Bands analysis table
        if signals:
            bb_table = Table(title="📊 Bollinger Bands Analysis")
            bb_table.add_column("Indicator", style="yellow", width=20)
            bb_table.add_column("Value", style="white", width=15)
            bb_table.add_column("Status", style="magenta", width=15)
            
            # Bollinger Bands levels
            bb_table.add_row("Upper Band", f"${signals['bb_upper']:.2f}", 
                           f"{signals['distance_to_upper']:.2f}% away")
            bb_table.add_row("Middle Band", f"${signals['bb_middle']:.2f}", 
                           f"{signals['distance_to_middle']:.2f}% away")
            bb_table.add_row("Lower Band", f"${signals['bb_lower']:.2f}", 
                           f"{signals['distance_to_lower']:.2f}% away")
            bb_table.add_row("BB Position", f"{signals['bb_position']:.3f}", 
                           f"{signals['bb_position']*100:.1f}% in bands")
            bb_table.add_row("BB Width", f"{signals['bb_width']:.4f}", 
                           "SQUEEZE" if signals['squeeze_active'] else "NORMAL")
            bb_table.add_row("RSI", f"{signals['rsi']:.1f}", 
                           "OVERSOLD" if signals['rsi'] < 30 else "OVERBOUGHT" if signals['rsi'] > 70 else "NEUTRAL")
            bb_table.add_row("Volume Ratio", f"{signals['volume_ratio']:.2f}", 
                           "HIGH" if signals['volume_ratio'] > 1.5 else "NORMAL")
            
            # Add debugging info for volume
            if hasattr(self, 'current_4h_bar') and self.current_4h_bar['start_time']:
                bb_table.add_row("Current 4h Volume", f"{self.current_4h_bar['volume']:.2f}", 
                               f"Ticks: {getattr(self, 'tick_count', 0)}")
                bb_table.add_row("Buffer Size", f"{len(self.volume_buffer)} bars", 
                               f"Total: {len(self.volume_buffer) + 1}")
            
            # Show last few volume values for debugging
            if len(self.volume_buffer) >= 3:
                recent_vols = list(self.volume_buffer)[-3:]  # Convert deque to list first
                bb_table.add_row("Recent Volumes", f"{recent_vols[-1]:.1f}, {recent_vols[-2]:.1f}, {recent_vols[-3]:.1f}", "Last 3 bars")
            bb_table.add_row("Market State", signals['market_state'], "")
            
            # Signal strength table
            signal_table = Table(title="🎯 Signal Strength Analysis")
            signal_table.add_column("Signal Type", style="cyan", width=15)
            signal_table.add_column("Strength", style="green", width=10)
            signal_table.add_column("Conditions Met", style="yellow", width=25)
            signal_table.add_column("Ready?", style="red", width=10)
            
            # Long signal analysis
            long_conditions_met = [k.replace('_', ' ').title() for k, v in signals['long_conditions'].items() if v]
            long_ready = "🟢 YES" if signals['long_strength'] >= 100 else f"🟡 {signals['long_strength']:.0f}%"
            signal_table.add_row("LONG", f"{signals['long_strength']:.0f}%", 
                                ", ".join(long_conditions_met) if long_conditions_met else "None", 
                                long_ready)
            
            # Short signal analysis
            short_conditions_met = [k.replace('_', ' ').title() for k, v in signals['short_conditions'].items() if v]
            short_ready = "🟢 YES" if signals['short_strength'] >= 100 else f"🟡 {signals['short_strength']:.0f}%"
            signal_table.add_row("SHORT", f"{signals['short_strength']:.0f}%", 
                                ", ".join(short_conditions_met) if short_conditions_met else "None", 
                                short_ready)
            
            # Detailed condition breakdown
            condition_table = Table(title="🔍 Detailed Condition Analysis")
            condition_table.add_column("Condition", style="cyan", width=25)
            condition_table.add_column("Current Value", style="white", width=15)
            condition_table.add_column("Required", style="yellow", width=15)
            condition_table.add_column("Status", style="green", width=10)
            
            # Long conditions
            condition_table.add_row("Price vs Lower Band", f"${data['price']:.2f}", 
                                   f"≤ ${signals['bb_lower']*1.005:.2f}", 
                                   "✅" if signals['long_conditions']['price_at_lower_band'] else "❌")
            condition_table.add_row("RSI Oversold", f"{signals['rsi']:.1f}", "< 40", 
                                   "✅" if signals['long_conditions']['rsi_oversold'] else "❌")
            condition_table.add_row("Volume Confirmation", f"{signals['volume_ratio']:.2f}x", f"> {self.volume_mult}x", 
                                   "✅" if signals['long_conditions']['volume_confirmation'] else "❌")
            condition_table.add_row("BB Position Low", f"{signals['bb_position']:.3f}", "< 0.2", 
                                   "✅" if signals['long_conditions']['bb_position_low'] else "❌")
            
            condition_table.add_row("", "", "", "")  # Separator
            
            # Short conditions
            condition_table.add_row("Price vs Upper Band", f"${data['price']:.2f}", 
                                   f"≥ ${signals['bb_upper']*0.995:.2f}", 
                                   "✅" if signals['short_conditions']['price_at_upper_band'] else "❌")
            condition_table.add_row("RSI Overbought", f"{signals['rsi']:.1f}", "> 60", 
                                   "✅" if signals['short_conditions']['rsi_overbought'] else "❌")
            condition_table.add_row("Volume Confirmation", f"{signals['volume_ratio']:.2f}x", f"> {self.volume_mult}x", 
                                   "✅" if signals['short_conditions']['volume_confirmation'] else "❌")
            condition_table.add_row("BB Position High", f"{signals['bb_position']:.3f}", "> 0.8", 
                                   "✅" if signals['short_conditions']['bb_position_high'] else "❌")
            
            self.console.clear()
            self.console.print(table)
            self.console.print()
            self.console.print(bb_table)
            self.console.print()
            self.console.print(signal_table)
            self.console.print()
            self.console.print(condition_table)
            
            # Alert for high signal strength
            if signals['long_strength'] >= 75:
                self.console.print(f"\n[bold green]🚨 LONG SIGNAL STRENGTH: {signals['long_strength']:.0f}% - WATCH CLOSELY![/bold green]")
            if signals['short_strength'] >= 75:
                self.console.print(f"\n[bold red]🚨 SHORT SIGNAL STRENGTH: {signals['short_strength']:.0f}% - WATCH CLOSELY![/bold red]")
            if signals['squeeze_active']:
                self.console.print(f"\n[bold yellow]⚡ BOLLINGER BAND SQUEEZE ACTIVE - BREAKOUT IMMINENT![/bold yellow]")
        else:
            self.console.clear()
            self.console.print(table)
            self.console.print("\n[yellow]📊 Waiting for sufficient data to calculate signals...[/yellow]")
    
    def run(self, symbol="BTCUSDT", balance=10000):
        """Run the live trading bot"""
        try:
            self.trading_symbol = symbol.upper()
            self.balance = balance
            
            self.console.print(Panel.fit(
                f"🚀 Starting Bollinger Bands Live Trader\n"
                f"Symbol: {self.trading_symbol}\n"
                f"Strategy: 4-Hour Mean Reversion\n"
                f"Initial Balance: ${balance:,.2f}\n"
                f"Leverage: {self.leverage}x\n"
                f"{'TESTNET' if self.use_testnet else 'MAINNET'}",
                title="Live Trader Initialization",
                border_style="green"
            ))
            
            # Set leverage
            if self.leverage > 1:
                self.client.change_leverage(
                    symbol=self.trading_symbol,
                    leverage=self.leverage,
                    timestamp=int(time.time() * 1000)
                )
                self.console.print(f"[green]✅ Leverage set to {self.leverage}x[/green]")
            
            # Initialize historical data
            self.initialize_historical_data()
            
            # Initialize WebSocket
            self.initialize_websocket()
            
            # Start trading loop
            self.running = True
            self.console.print("[green]🎯 Trading bot is now running... Press Ctrl+C to stop[/green]")
            
            while self.running:
                self.display_status()
                time.sleep(5)  # Update display every 5 seconds
                
        except KeyboardInterrupt:
            self.console.print("\n[yellow]🛑 Stopping live trader...[/yellow]")
            self.running = False
            if self.ws_client:
                self.ws_client.stop()
            self.console.print("[green]✅ Live trader stopped[/green]")
            
        except Exception as e:
            self.console.print(f"[red]❌ Error in live trader: {str(e)}[/red]")
            self.running = False
            if self.ws_client:
                self.ws_client.stop()


def main():
    """Main function to run the live trader"""
    console = Console()
    
    # Load API credentials
    api_key = "c5079bf884cc676c7d3e799e080df1463b6de7cecf2c9d4b34c376c60a99c491"  # From config
    api_secret = "c9c4822f5944527b9ddd79f97fff3d0c33da5814c202020b938150acc4211a44"  # From config
    
    if not api_key or not api_secret:
        console.print("[red]❌ API credentials not found in config[/red]")
        return
    
    # Initialize trader
    trader = BollingerBandsLiveTrader(
        api_key=api_key,
        api_secret=api_secret,
        use_testnet=True,  # Start with testnet for safety
        leverage=1  # Start with 1x leverage for safety
    )
    
    # Run trader
    trader.run(symbol="BTCUSDT", balance=10000)


if __name__ == "__main__":
    main() 