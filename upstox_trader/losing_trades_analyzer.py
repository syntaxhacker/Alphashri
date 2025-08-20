#!/usr/bin/env python3
"""
Losing Trades Analyzer
Analyzes why trades resulted in losses and why stop losses didn't trigger at expected -0.5% level
"""

import pandas as pd
from datetime import datetime, timedelta
import sys
import os
import re
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import print as rprint
import traceback

# Add the project root to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import log parser
daily_dash_helpers_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'daily_dash', 'helpers')
if os.path.exists(daily_dash_helpers_path):
    sys.path.append(daily_dash_helpers_path)
    try:
        from log_parser import parse_log_file
        LOG_PARSER_AVAILABLE = True
    except ImportError:
        print("⚠️ Log parser not available. Using default data.")
        LOG_PARSER_AVAILABLE = False
else:
    print("⚠️ Log parser directory not found. Using default data.")
    LOG_PARSER_AVAILABLE = False

# Import Upstox API
try:
    from config_and_utils.free_indian_apis import UpstoxAPI
    from config import UPSTOX_CONFIG
    UPSTOX_AVAILABLE = True
except ImportError:
    print("⚠️ Upstox API not available. Historical analysis will be limited.")
    UPSTOX_AVAILABLE = False

console = Console()

class LosingTradesAnalyzer:
    def __init__(self, log_file_path=None):
        # Initialize Upstox API if available
        self.upstox_api = None
        if UPSTOX_AVAILABLE:
            try:
                self.upstox_api = UpstoxAPI(UPSTOX_CONFIG['api_key'], UPSTOX_CONFIG['api_secret'])
                console.print("[green]✅ Upstox API initialized for historical data analysis[/green]")
            except Exception as e:
                console.print(f"[yellow]⚠️ Failed to initialize Upstox API: {e}[/yellow]")
                self.upstox_api = None
        
        # Parse log file if provided, otherwise use default data
        if log_file_path and LOG_PARSER_AVAILABLE:
            self.losing_trades = self._parse_log_for_losing_trades(log_file_path)
        else:
            # Default hardcoded data
            self.losing_trades = [
            {
                'symbol': 'NSE:DBL',
                'side': 'BUY',
                'entry_price': 485.85,
                'exit_price': 483.35,
                'qty': 41,
                'pnl_pct': -0.51,
                'pnl_amount': -103,
                'hold_time': '30m',
                'reason': 'STOP LOSS: -0.5',
                'expected_sl': -0.5,
                'actual_sl': -0.51,
                'entry_time': '2024-08-13 10:15:00',
                'exit_time': '2024-08-13 10:45:00'
            },
            {
                'symbol': 'NSE:AGARWALEYE',
                'side': 'BUY',
                'entry_price': 456.05,
                'exit_price': 452.50,
                'qty': 43,
                'pnl_pct': -0.78,
                'pnl_amount': -153,
                'hold_time': '1m',
                'reason': 'STOP LOSS: -0.7',
                'expected_sl': -0.5,
                'actual_sl': -0.78,
                'entry_time': '2024-08-13 11:30:00',
                'exit_time': '2024-08-13 11:31:00'
            },
            {
                'symbol': 'NSE:IOLCP',
                'side': 'BUY',
                'entry_price': 100.45,
                'exit_price': 99.76,
                'qty': 199,
                'pnl_pct': -0.69,
                'pnl_amount': -137,
                'hold_time': '41m',
                'reason': 'STOP LOSS: -0.6',
                'expected_sl': -0.5,
                'actual_sl': -0.69,
                'entry_time': '2024-08-13 09:45:00',
                'exit_time': '2024-08-13 10:26:00'
            },
            {
                'symbol': 'NSE:GREAVESCOT',
                'side': 'BUY',
                'entry_price': 213.48,
                'exit_price': 211.50,
                'qty': 93,
                'pnl_pct': -0.93,
                'pnl_amount': -184,
                'hold_time': '0m',
                'reason': 'STOP LOSS: -0.9',
                'expected_sl': -0.5,
                'actual_sl': -0.93,
                'entry_time': '2024-08-13 09:15:00',
                'exit_time': '2024-08-13 09:15:00'
            },
            {
                'symbol': 'NSE:NESCO',
                'side': 'BUY',
                'entry_price': 1265.70,
                'exit_price': 1256.30,
                'qty': 15,
                'pnl_pct': -0.74,
                'pnl_amount': -141,
                'hold_time': '14m',
                'reason': 'STOP LOSS: -0.7',
                'expected_sl': -0.5,
                'actual_sl': -0.74,
                'entry_time': '2024-08-13 14:20:00',
                'exit_time': '2024-08-13 14:34:00'
            },
            {
                'symbol': 'NSE:VISHNU',
                'side': 'BUY',
                'entry_price': 578.00,
                'exit_price': 573.20,
                'qty': 34,
                'pnl_pct': -0.83,
                'pnl_amount': -163,
                'hold_time': '22m',
                'reason': 'STOP LOSS: -0.8',
                'expected_sl': -0.5,
                'actual_sl': -0.83,
                'entry_time': '2024-08-13 12:45:00',
                'exit_time': '2024-08-13 13:07:00'
            },
            {
                'symbol': 'NSE:MADRASFERT',
                'side': 'BUY',
                'entry_price': 96.30,
                'exit_price': 95.81,
                'qty': 207,
                'pnl_pct': -0.51,
                'pnl_amount': -101,
                'hold_time': '11m',
                'reason': 'STOP LOSS: -0.5',
                'expected_sl': -0.5,
                'actual_sl': -0.51,
                'entry_time': '2024-08-13 13:30:00',
                'exit_time': '2024-08-13 13:41:00'
            },
            {
                'symbol': 'NSE:GATEWAY',
                'side': 'BUY',
                'entry_price': 72.95,
                'exit_price': 72.41,
                'qty': 274,
                'pnl_pct': -0.74,
                'pnl_amount': -148,
                'hold_time': '38m',
                'reason': 'STOP LOSS: -0.7',
                'expected_sl': -0.5,
                'actual_sl': -0.74,
                'entry_time': '2024-08-13 10:30:00',
                'exit_time': '2024-08-13 11:08:00'
            }
        ]
    
    def _parse_log_for_losing_trades(self, log_file_path):
        """Parse log file and extract losing trades"""
        console.print(f"[yellow]📊 Parsing log file: {log_file_path}[/yellow]")
        
        # Parse the log file
        raw_trades = parse_log_file(log_file_path)
        
        # Group trades by symbol and match entries with exits
        symbol_trades = {}
        for trade in raw_trades:
            symbol = trade['symbol']
            if symbol not in symbol_trades:
                symbol_trades[symbol] = []
            symbol_trades[symbol].append(trade)
        
        losing_trades = []
        
        for symbol, trades in symbol_trades.items():
            # Sort by timestamp
            trades.sort(key=lambda x: x['timestamp'])
            
            # Find entry/exit pairs
            i = 0
            while i < len(trades):
                trade = trades[i]
                
                if trade['action'] == 'ENTRY_BUY':
                    # Look for corresponding exit
                    for j in range(i + 1, len(trades)):
                        exit_trade = trades[j]
                        if exit_trade['symbol'] == symbol and exit_trade['action'].startswith('EXIT'):
                            # Found a complete trade
                            if exit_trade['pl_percent'] < 0:  # Check exit trade for loss
                                hold_time = exit_trade['timestamp'] - trade['timestamp']
                                hold_minutes = int(hold_time.total_seconds() / 60)
                                
                                # Extract stop loss info
                                expected_sl = -0.5  # Default expected stop loss
                                actual_sl = abs(exit_trade['pl_percent'])
                                
                                # Parse stop loss type from alert
                                if 'STOP LOSS:' in exit_trade['alert_type']:
                                    # Extract actual stop loss percentage
                                    sl_match = re.search(r'STOP LOSS:\s*([+-]?\d+(?:\.\d+)?)%', exit_trade['alert_type'])
                                    if sl_match:
                                        actual_sl = float(sl_match.group(1))
                                elif 'TRAILING STOP:' in exit_trade['alert_type']:
                                    # Extract trailing stop percentage
                                    sl_match = re.search(r'TRAILING STOP:\s*([+-]?\d+(?:\.\d+)?)%', exit_trade['alert_type'])
                                    if sl_match:
                                        actual_sl = float(sl_match.group(1))
                                
                                losing_trade = {
                                    'symbol': symbol,
                                    'side': 'BUY',
                                    'entry_price': trade['price'],
                                    'exit_price': exit_trade['price'],
                                    'qty': trade['qty'],
                                    'pnl_pct': exit_trade['pl_percent'],
                                    'pnl_amount': exit_trade['pl_amount'],
                                    'hold_time': f"{hold_minutes}m",
                                    'reason': exit_trade['alert_type'],
                                    'expected_sl': expected_sl,
                                    'actual_sl': -actual_sl if exit_trade['pl_percent'] < 0 else actual_sl,
                                    'entry_time': trade['timestamp'].strftime('%Y-%m-%d %H:%M:%S'),
                                    'exit_time': exit_trade['timestamp'].strftime('%Y-%m-%d %H:%M:%S')
                                }
                                losing_trades.append(losing_trade)
                            
                            i = j  # Skip to exit trade
                            break
                i += 1
        
        console.print(f"[green]✅ Found {len(losing_trades)} losing trades from log file[/green]")
        return losing_trades
    
    def _get_symbol_for_upstox(self, nse_symbol):
        """Convert NSE:SYMBOL to just SYMBOL for Upstox API"""
        return nse_symbol.replace('NSE:', '')
    
    def _fetch_historical_candles(self, symbol, entry_time, exit_time):
        """Fetch historical candle data for the trade period"""
        if not self.upstox_api:
            return None
            
        try:
            # Convert string times to datetime
            entry_dt = datetime.strptime(entry_time, '%Y-%m-%d %H:%M:%S')
            exit_dt = datetime.strptime(exit_time, '%Y-%m-%d %H:%M:%S')
            
            # Get date for API calls
            trade_date = entry_dt.date()
            today = datetime.now().date()
            
            # Clean symbol for Upstox
            clean_symbol = self._get_symbol_for_upstox(symbol)
            
            # Use V3 API for better data availability
            console.print(f"[yellow]📊 Fetching V3 1minute historical data for {clean_symbol}...[/yellow]")
            
            if trade_date == today:
                console.print(f"[blue]🔍 Debug: Requesting same-day data using V3 INTRADAY API for {trade_date}[/blue]")
                # For same day, use the dedicated intraday V3 method
                data = self.upstox_api.fetch_intraday_data_v3(
                    symbol=clean_symbol,
                    unit='minutes',
                    interval=1,
                    exchange='NSE_EQ'
                )
            else:
                console.print(f"[blue]🔍 Debug: Requesting historical data using V3 API for {trade_date}[/blue]")
                # For historical data, provide both dates
                data = self.upstox_api.fetch_historical_data_v3(
                    symbol=clean_symbol,
                    unit='minutes',
                    interval=1,
                    to_date=trade_date.strftime('%Y-%m-%d'),
                    from_date=trade_date.strftime('%Y-%m-%d'),
                    exchange='NSE_EQ'
                )
            
            if data is not None and not data.empty:
                console.print(f"[blue]🔍 Debug: Raw data shape: {data.shape}[/blue]")
                console.print(f"[blue]🔍 Debug: Data index type: {type(data.index)}[/blue]")
                console.print(f"[blue]🔍 Debug: Entry time: {entry_dt}, Exit time: {exit_dt}[/blue]")
                if len(data) > 0:
                    console.print(f"[blue]🔍 Debug: First data timestamp: {data.index[0]}, Last: {data.index[-1]}[/blue]")
                
                # Handle timezone-aware DatetimeIndex (Upstox format)
                if isinstance(data.index, pd.DatetimeIndex):
                    # Convert naive datetime to timezone-aware
                    if data.index.tz is not None:
                        # Data has timezone, convert our entry times to match
                        entry_dt_tz = pd.Timestamp(entry_dt).tz_localize('Asia/Kolkata')
                        exit_dt_tz = pd.Timestamp(exit_dt).tz_localize('Asia/Kolkata')
                        console.print(f"[blue]🔍 Debug: Using timezone-aware times: {entry_dt_tz} to {exit_dt_tz}[/blue]")
                    else:
                        # Data is timezone-naive, use as is
                        entry_dt_tz = entry_dt
                        exit_dt_tz = exit_dt
                        console.print(f"[blue]🔍 Debug: Using naive times: {entry_dt_tz} to {exit_dt_tz}[/blue]")
                    
                    # Filter data for the specific trade time window
                    filter_start = entry_dt_tz - timedelta(minutes=30)
                    filter_end = exit_dt_tz + timedelta(minutes=30)
                    console.print(f"[blue]🔍 Debug: Filter range: {filter_start} to {filter_end}[/blue]")
                    
                    filtered_data = data[
                        (data.index >= filter_start) &
                        (data.index <= filter_end)
                    ]
                    console.print(f"[blue]🔍 Debug: Filtered data shape: {filtered_data.shape}[/blue]")
                    
                    # If no exact matches, expand the search window
                    if len(filtered_data) == 0:
                        console.print(f"[yellow]⚠️ No exact time matches, expanding search to ±2 hours[/yellow]")
                        filter_start = entry_dt_tz - timedelta(hours=2)
                        filter_end = exit_dt_tz + timedelta(hours=2)
                        filtered_data = data[
                            (data.index >= filter_start) &
                            (data.index <= filter_end)
                        ]
                        console.print(f"[blue]🔍 Debug: Expanded filtered data shape: {filtered_data.shape}[/blue]")
                        
                        # If still no matches, use market hours data
                        if len(filtered_data) == 0:
                            console.print(f"[yellow]⚠️ Still no matches, using market hours data[/yellow]")
                            filtered_data = data[
                                (data.index.hour >= 9) & 
                                (data.index.hour <= 15)
                            ].head(50)  # Take first 50 candles from market hours
                    
                    # Reset index to make timestamp a column
                    filtered_data = filtered_data.reset_index()
                    filtered_data = filtered_data.rename(columns={'datetime': 'timestamp'})
                    
                    return filtered_data
                
                # Handle column-based timestamp data
                else:
                    if 'timestamp' in data.columns:
                        time_col = 'timestamp'
                    elif 'datetime' in data.columns:
                        time_col = 'datetime'
                    elif 'Date' in data.columns:
                        time_col = 'Date'
                    else:
                        console.print(f"[red]❌ No timestamp column found in data for {clean_symbol}[/red]")
                        console.print(f"[dim]Available columns: {list(data.columns)}[/dim]")
                        return None
                    
                    # Filter data to the specific trade window
                    data[time_col] = pd.to_datetime(data[time_col])
                    filtered_data = data[
                        (data[time_col] >= entry_dt - timedelta(minutes=30)) &
                        (data[time_col] <= exit_dt + timedelta(minutes=30))
                    ]
                    # Rename to standard timestamp column
                    filtered_data = filtered_data.rename(columns={time_col: 'timestamp'})
                    return filtered_data
            else:
                console.print(f"[red]❌ No candle data found for {clean_symbol}[/red]")
                return None
                
        except Exception as e:
            console.print(f"[red]❌ Error fetching candles for {symbol}: {e}[/red]")
            return None
    
    def analyze_candle_patterns(self):
        """Analyze candle patterns around entry times"""
        if not self.upstox_api:
            console.print("[yellow]⚠️ Upstox API not available. Skipping candle analysis.[/yellow]")
            return
            
        console.print(Panel.fit("📊 CANDLE PATTERN ANALYSIS", style="bold cyan"))
        
        pattern_table = Table(title="Entry Candle Analysis")
        pattern_table.add_column("Symbol", style="cyan")
        pattern_table.add_column("Entry Price", justify="right")
        pattern_table.add_column("Pre-Entry Pattern", style="yellow")
        pattern_table.add_column("Entry Candle", style="red")
        pattern_table.add_column("Post-Entry Action", style="magenta")
        pattern_table.add_column("Volume Signal", style="green")
        
        for trade in self.losing_trades:
            symbol = trade['symbol']
            entry_time = trade['entry_time']
            exit_time = trade['exit_time']
            entry_price = trade['entry_price']
            
            console.print(f"\n[dim]Analyzing {symbol}...[/dim]")
            
            # Fetch candle data
            candles = self._fetch_historical_candles(symbol, entry_time, exit_time)
            
            if candles is not None and len(candles) > 0:
                console.print(f"[green]📊 Got {len(candles)} candles for {symbol}[/green]")
                console.print(f"[cyan]🕐 Entry time: {entry_time}[/cyan]")
                console.print(f"[cyan]📅 First candle: {candles.iloc[0]['timestamp']} | Last candle: {candles.iloc[-1]['timestamp']}[/cyan]")
                
                # Analyze patterns
                entry_dt = datetime.strptime(entry_time, '%Y-%m-%d %H:%M:%S')
                
                # Convert entry_dt to timezone-aware if candles timestamp is timezone-aware
                if candles['timestamp'].dtype.tz is not None:
                    entry_dt_tz = pd.Timestamp(entry_dt).tz_localize('Asia/Kolkata')
                else:
                    entry_dt_tz = entry_dt
                
                # Find candles around entry time
                console.print(f"[blue]🔍 Debug: Looking for candles around entry time {entry_dt_tz}[/blue]")
                pre_entry = candles[candles['timestamp'] <= entry_dt_tz].tail(3)
                post_entry = candles[candles['timestamp'] > entry_dt_tz].head(5)
                
                console.print(f"[blue]🔍 Debug: Pre-entry candles: {len(pre_entry)}, Post-entry candles: {len(post_entry)}[/blue]")
                
                # If no exact time matches, use proxy approach
                using_proxy_data = False
                if len(pre_entry) == 0 or len(post_entry) == 0:
                    console.print(f"[red]🚨 WARNING: No exact time matches - API data from different date![/red]")
                    console.print(f"[red]   Entry time: {entry_dt_tz.date()} | Candle data: {candles.iloc[0]['timestamp'].date()}[/red]")
                    console.print(f"[yellow]⚠️ Post-entry and volume analysis will be INVALID (different trading session)[/yellow]")
                    
                    # Use first part of available candles as "pre-entry" only for pattern analysis
                    using_proxy_data = True
                    mid_point = len(candles) // 2
                    pre_entry = candles.iloc[:mid_point].tail(3)
                    post_entry = pd.DataFrame()  # Empty - don't use proxy data for post-entry
                    console.print(f"[blue]🔍 Debug: Using only pre-entry pattern from proxy data: {len(pre_entry)} candles[/blue]")
                
                # Analyze pre-entry pattern
                pre_pattern = self._analyze_pre_entry_pattern(pre_entry, entry_price)
                
                # Analyze entry candle
                entry_candle_analysis = self._analyze_entry_candle(candles, entry_dt_tz, entry_price)
                
                # Analyze post-entry action (only if we have real data)
                if using_proxy_data:
                    post_action = "❌ INVALID DATA"
                    volume_signal = "❌ INVALID DATA"
                else:
                    post_action = self._analyze_post_entry_action(post_entry, entry_price)
                    volume_signal = self._analyze_volume_pattern(pre_entry, post_entry)
                
                pattern_table.add_row(
                    symbol.replace('NSE:', ''),
                    f"₹{entry_price:.2f}",
                    pre_pattern,
                    entry_candle_analysis,
                    post_action,
                    volume_signal
                )
            else:
                console.print(f"[red]❌ No candles data for {symbol} - candles is None or empty[/red]")
                if candles is not None:
                    console.print(f"[yellow]📊 Candles length: {len(candles)}[/yellow]")
                else:
                    console.print(f"[yellow]📊 Candles is None[/yellow]")
                pattern_table.add_row(
                    symbol.replace('NSE:', ''),
                    f"₹{entry_price:.2f}",
                    "❌ No Data",
                    "❌ No Data",
                    "❌ No Data",
                    "❌ No Data"
                )
        
        console.print(pattern_table)
    
    def _analyze_pre_entry_pattern(self, pre_candles, entry_price):
        """Analyze pattern before entry"""
        if len(pre_candles) < 2:
            return "📊 INSUFFICIENT DATA"
        
        closes = pre_candles['close'].values
        highs = pre_candles['high'].values
        lows = pre_candles['low'].values
        
        # Check if trending up before entry
        if closes[-1] > closes[0]:
            if all(closes[i] >= closes[i-1] for i in range(1, len(closes))):
                return "📈 STRONG UPTREND"
            else:
                return "📊 MIXED UPWARD"
        elif closes[-1] < closes[0]:
            return "📉 DOWNTREND"
        else:
            return "➡️ SIDEWAYS"
    
    def _analyze_entry_candle(self, candles, entry_time, entry_price):
        """Analyze the specific entry candle"""
        # Find the candle closest to entry time
        time_diff = abs(candles['timestamp'] - entry_time)
        entry_idx = time_diff.idxmin()
        entry_candle = candles.loc[entry_idx]
        
        open_price = entry_candle['open']
        close_price = entry_candle['close']
        high_price = entry_candle['high']
        low_price = entry_candle['low']
        
        # Determine candle type
        body_size = abs(close_price - open_price)
        upper_shadow = high_price - max(open_price, close_price)
        lower_shadow = min(open_price, close_price) - low_price
        
        candle_range = high_price - low_price
        body_pct = (body_size / candle_range * 100) if candle_range > 0 else 0
        
        # Check where entry price falls
        if entry_price >= high_price * 0.95:  # Near high
            position = "📍 NEAR HIGH"
        elif entry_price <= low_price * 1.05:  # Near low
            position = "📍 NEAR LOW"
        else:
            position = "📍 MID-RANGE"
        
        if close_price > open_price:
            if body_pct > 70:
                return f"🟢 STRONG BULL {position}"
            else:
                return f"🟢 WEAK BULL {position}"
        else:
            if body_pct > 70:
                return f"🔴 STRONG BEAR {position}"
            else:
                return f"🔴 WEAK BEAR {position}"
    
    def _analyze_post_entry_action(self, post_candles, entry_price):
        """Analyze price action after entry"""
        if len(post_candles) == 0:
            return "❌ NO DATA"
        
        first_candle = post_candles.iloc[0]
        immediate_low = first_candle['low']
        immediate_high = first_candle['high']
        
        # Check immediate movement
        drop_pct = ((entry_price - immediate_low) / entry_price) * 100
        rise_pct = ((immediate_high - entry_price) / entry_price) * 100
        
        if drop_pct > 0.5:  # Immediate drop > 0.5%
            return f"🚨 IMMEDIATE DROP -{drop_pct:.1f}%"
        elif rise_pct > 0.3:  # Some upward movement
            if len(post_candles) > 2:
                # Check if it sustained
                later_lows = post_candles['low'].values[1:3]
                if any(low < entry_price * 0.995 for low in later_lows):  # < -0.5%
                    return f"⚠️ PUMP THEN DUMP +{rise_pct:.1f}% then down"
                else:
                    return f"📈 SUSTAINED MOVE +{rise_pct:.1f}%"
            else:
                return f"📈 INITIAL RISE +{rise_pct:.1f}%"
        else:
            return "📊 FLAT/MIXED"
    
    def _analyze_volume_pattern(self, pre_candles, post_candles):
        """Analyze volume patterns"""
        if len(pre_candles) == 0 or len(post_candles) == 0:
            return "❌ NO DATA"
        
        try:
            avg_pre_volume = pre_candles['volume'].mean()
            first_post_volume = post_candles.iloc[0]['volume']
            
            volume_ratio = first_post_volume / avg_pre_volume if avg_pre_volume > 0 else 1
            
            if volume_ratio > 3:
                return f"📊 HIGH VOLUME {volume_ratio:.1f}x"
            elif volume_ratio > 1.5:
                return f"📊 ABOVE AVG {volume_ratio:.1f}x"
            elif volume_ratio < 0.5:
                return f"📊 LOW VOLUME {volume_ratio:.1f}x"
            else:
                return f"📊 NORMAL {volume_ratio:.1f}x"
        except:
            return "❌ CALC ERROR"
        
    def analyze_stop_loss_slippage(self):
        """Analyze why stop losses didn't trigger at expected -0.5% level"""
        console.print(Panel.fit("🔍 STOP LOSS SLIPPAGE ANALYSIS", style="bold red"))
        
        slippage_table = Table(title="Stop Loss Slippage Analysis")
        slippage_table.add_column("Symbol", style="cyan")
        slippage_table.add_column("Expected SL", justify="right", style="green")
        slippage_table.add_column("Actual SL", justify="right", style="red")
        slippage_table.add_column("Slippage", justify="right", style="yellow")
        slippage_table.add_column("Hold Time", justify="center")
        slippage_table.add_column("Likely Cause", style="dim")
        
        total_slippage = 0
        severe_slippage_count = 0
        
        if len(self.losing_trades) == 0:
            console.print("[yellow]⚠️ No losing trades to analyze for slippage[/yellow]")
            return 0, 0
        
        for trade in self.losing_trades:
            slippage = abs(trade['actual_sl']) - abs(trade['expected_sl'])
            total_slippage += slippage
            
            # Categorize likely cause based on slippage and hold time
            if slippage > 0.4:  # > 0.4% slippage
                cause = "🚨 GAP DOWN / ILLIQUID"
                severe_slippage_count += 1
            elif slippage > 0.2:  # > 0.2% slippage
                cause = "⚠️ FAST DECLINE"
            elif trade['hold_time'] == '0m' or trade['hold_time'] == '1m':
                cause = "⚡ IMMEDIATE REVERSAL"
            else:
                cause = "📉 GRADUAL DECLINE"
            
            slippage_table.add_row(
                trade['symbol'].replace('NSE:', ''),
                f"-{trade['expected_sl']:.1f}%",
                f"{trade['actual_sl']:.2f}%",
                f"+{slippage:.2f}%",
                trade['hold_time'],
                cause
            )
        
        console.print(slippage_table)
        
        avg_slippage = total_slippage / len(self.losing_trades)
        console.print(f"\n📊 [bold]Average Slippage:[/bold] +{avg_slippage:.2f}%")
        console.print(f"🚨 [bold]Severe Slippage (>0.4%):[/bold] {severe_slippage_count}/{len(self.losing_trades)} trades")
        
        return avg_slippage, severe_slippage_count
    
    def analyze_entry_timing(self):
        """Analyze if trades were entered at bad timing"""
        console.print(Panel.fit("⏰ ENTRY TIMING ANALYSIS", style="bold blue"))
        
        timing_table = Table(title="Entry Timing Issues")
        timing_table.add_column("Symbol", style="cyan")
        timing_table.add_column("Hold Time", justify="center")
        timing_table.add_column("Loss %", justify="right", style="red")
        timing_table.add_column("Timing Issue", style="yellow")
        timing_table.add_column("Recommendation", style="green")
        
        immediate_reversals = 0
        
        if len(self.losing_trades) == 0:
            console.print("[yellow]⚠️ No losing trades to analyze for timing[/yellow]")
            return 0
        
        for trade in self.losing_trades:
            hold_minutes = 0
            if 'm' in trade['hold_time']:
                hold_minutes = int(trade['hold_time'].replace('m', ''))
            
            if hold_minutes <= 1:
                timing_issue = "🚨 IMMEDIATE REVERSAL"
                recommendation = "Wait for confirmation"
                immediate_reversals += 1
            elif hold_minutes <= 15:
                timing_issue = "⚠️ QUICK REVERSAL"
                recommendation = "Better entry signals"
            else:
                timing_issue = "📉 TREND REVERSAL"
                recommendation = "Earlier exit signals"
            
            timing_table.add_row(
                trade['symbol'].replace('NSE:', ''),
                trade['hold_time'],
                f"{trade['pnl_pct']:.2f}%",
                timing_issue,
                recommendation
            )
        
        console.print(timing_table)
        console.print(f"\n⚡ [bold]Immediate Reversals (≤1min):[/bold] {immediate_reversals}/{len(self.losing_trades)} trades")
        
        return immediate_reversals
    
    def analyze_price_action_patterns(self):
        """Analyze price action patterns in losing trades"""
        console.print(Panel.fit("📈 PRICE ACTION ANALYSIS", style="bold magenta"))
        
        # Calculate price drops
        price_drops = []
        if len(self.losing_trades) == 0:
            console.print("[yellow]⚠️ No losing trades to analyze for price action[/yellow]")
            return
        
        for trade in self.losing_trades:
            drop = trade['entry_price'] - trade['exit_price']
            drop_pct = (drop / trade['entry_price']) * 100
            price_drops.append({
                'symbol': trade['symbol'],
                'drop_amount': drop,
                'drop_pct': drop_pct,
                'entry_price': trade['entry_price']
            })
        
        # Sort by drop percentage
        price_drops.sort(key=lambda x: x['drop_pct'], reverse=True)
        
        pattern_table = Table(title="Price Drop Analysis")
        pattern_table.add_column("Symbol", style="cyan")
        pattern_table.add_column("Entry Price", justify="right")
        pattern_table.add_column("Price Drop ₹", justify="right", style="red")
        pattern_table.add_column("Drop %", justify="right", style="red")
        pattern_table.add_column("Pattern Type", style="yellow")
        
        for drop in price_drops:
            if drop['drop_pct'] > 0.8:
                pattern = "🚨 HEAVY SELLING"
            elif drop['drop_pct'] > 0.6:
                pattern = "📉 STRONG DECLINE"
            else:
                pattern = "📊 NORMAL DECLINE"
            
            pattern_table.add_row(
                drop['symbol'].replace('NSE:', ''),
                f"₹{drop['entry_price']:.2f}",
                f"₹{drop['drop_amount']:.2f}",
                f"{drop['drop_pct']:.2f}%",
                pattern
            )
        
        console.print(pattern_table)
    
    def generate_recommendations(self):
        """Generate recommendations to improve stop loss system"""
        console.print(Panel.fit("💡 RECOMMENDATIONS", style="bold green"))
        
        recommendations = [
            "🎯 **Tighter Initial Stop Loss**: Consider -0.3% instead of -0.5% for faster exits",
            "⚡ **Pre-market Gap Filter**: Avoid trades that gap down immediately after entry",
            "🔄 **Dynamic Stop Loss**: Use ATR-based stops for volatile stocks",
            "⏰ **Entry Confirmation**: Wait 2-3 minutes after signal before entering",
            "📊 **Volume Confirmation**: Ensure adequate volume before entry",
            "🚨 **Quick Exit Logic**: Exit if price drops >0.3% within first 5 minutes",
            "💹 **Liquidity Filter**: Avoid stocks with wide bid-ask spreads",
            "🎲 **Position Sizing**: Reduce size for stocks with high volatility"
        ]
        
        for i, rec in enumerate(recommendations, 1):
            console.print(f"{i}. {rec}")

    def generate_detailed_trade_reports(self):
        """Generate detailed markdown reports for each losing trade"""
        console.print(Panel.fit("📝 GENERATING DETAILED TRADE REPORTS", style="bold yellow"))
        
        # Create reports directory
        reports_dir = "losing_trades_reports"
        import os
        os.makedirs(reports_dir, exist_ok=True)
        
        for i, trade in enumerate(self.losing_trades):
            console.print(f"[cyan]📝 Generating report {i+1}/{len(self.losing_trades)}: {trade['symbol']}[/cyan]")
            
            # Generate filename
            symbol = trade['symbol'].replace('NSE:', '')
            entry_time = trade['entry_time'].replace(':', '').replace(' ', '_').replace('-', '')
            exit_time = trade['exit_time'].replace(':', '').replace(' ', '_').replace('-', '')
            filename = f"{symbol}_{entry_time}_{exit_time}_analysis.md"
            filepath = os.path.join(reports_dir, filename)
            
            # Generate detailed analysis
            report_content = self._generate_trade_report(trade)
            
            # Write to file
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(report_content)
            
            console.print(f"[green]✅ Generated: {filepath}[/green]")
        
        console.print(f"\n[bold green]📁 All reports saved to: {reports_dir}/[/bold green]")

    def _generate_trade_report(self, trade):
        """Generate detailed markdown report for a single trade"""
        symbol = trade['symbol']
        clean_symbol = self._get_symbol_for_upstox(symbol)
        
        # Get candle data for this trade
        entry_dt = datetime.strptime(trade['entry_time'], '%Y-%m-%d %H:%M:%S')
        exit_dt = datetime.strptime(trade['exit_time'], '%Y-%m-%d %H:%M:%S')
        trade_date = entry_dt.date()
        today = datetime.now().date()
        
        # Fetch candle data
        candles_data = None
        try:
            if trade_date == today:
                candles_data = self.upstox_api.fetch_intraday_data_v3(
                    symbol=clean_symbol,
                    unit='minutes',
                    interval=1,
                    exchange='NSE_EQ'
                )
            else:
                candles_data = self.upstox_api.fetch_historical_data_v3(
                    symbol=clean_symbol,
                    unit='minutes',
                    interval=1,
                    to_date=trade_date.strftime('%Y-%m-%d'),
                    from_date=trade_date.strftime('%Y-%m-%d'),
                    exchange='NSE_EQ'
                )
        except Exception as e:
            console.print(f"[red]❌ Error fetching data for {symbol}: {e}[/red]")
        
        # Generate the markdown content
        return self._create_markdown_content(trade, candles_data, entry_dt, exit_dt)

    def _create_markdown_content(self, trade, candles_data, entry_dt, exit_dt):
        """Create the markdown content for a trade report"""
        symbol = trade['symbol'].replace('NSE:', '')
        
        # Start building the markdown
        md_content = []
        md_content.append(f"# Trade Analysis Report: {symbol}")
        md_content.append(f"**Generated on:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        md_content.append("")
        
        # 1. Trade Summary Section
        md_content.append("## 📊 Trade Summary")
        md_content.append("")
        md_content.append("| Field | Value |")
        md_content.append("|-------|--------|")
        md_content.append(f"| **Symbol** | {symbol} |")
        md_content.append(f"| **Entry Time** | {trade['entry_time']} |")
        md_content.append(f"| **Exit Time** | {trade['exit_time']} |")
        md_content.append(f"| **Entry Price** | ₹{trade['entry_price']:.2f} |")
        md_content.append(f"| **Exit Price** | ₹{trade['exit_price']:.2f} |")
        md_content.append(f"| **Quantity** | {trade['qty']} |")
        md_content.append(f"| **Hold Time** | {trade['hold_time']} |")
        md_content.append(f"| **P&L Percentage** | {trade['pnl_pct']:.2f}% |")
        md_content.append(f"| **P&L Amount** | ₹{trade['pnl_amount']} |")
        md_content.append(f"| **Expected Stop Loss** | -{trade['expected_sl']:.1f}% |")
        md_content.append(f"| **Actual Stop Loss** | {trade['actual_sl']:.2f}% |")
        md_content.append(f"| **Stop Loss Slippage** | +{abs(trade['actual_sl']) - abs(trade['expected_sl']):.2f}% |")
        md_content.append(f"| **Exit Reason** | {trade['reason']} |")
        md_content.append("")
        
        # 2. Minute-by-Minute Price Movement
        md_content.append("## ⏱️ Minute-by-Minute Price Movement")
        md_content.append("")
        
        if candles_data is not None and len(candles_data) > 0:
            # Filter candles for the trade window (entry - 5 min to exit + 5 min)
            start_window = entry_dt - timedelta(minutes=5)
            end_window = exit_dt + timedelta(minutes=5)
            
            # Convert to timezone-aware if needed
            if candles_data.index.tz is not None:
                start_window = pd.Timestamp(start_window).tz_localize('Asia/Kolkata')
                end_window = pd.Timestamp(end_window).tz_localize('Asia/Kolkata')
            
            # Filter candles
            trade_candles = candles_data[
                (candles_data.index >= start_window) & 
                (candles_data.index <= end_window)
            ]
            
            if len(trade_candles) > 0:
                md_content.extend(self._create_minute_table(trade_candles, trade, entry_dt, exit_dt))
            else:
                md_content.append("❌ **No candle data available for this time period**")
                md_content.append("")
        else:
            md_content.append("❌ **Could not fetch candle data for detailed analysis**")
            md_content.append("")
        
        # 3. Critical Analysis Points
        md_content.append("## 🔍 Critical Analysis Points")
        md_content.append("")
        md_content.extend(self._create_critical_analysis(trade, candles_data, entry_dt, exit_dt))
        
        # 4. Lessons Learned
        md_content.append("## 💡 Lessons Learned")
        md_content.append("")
        md_content.extend(self._create_lessons_learned(trade))
        
        return "\n".join(md_content)

    def _create_minute_table(self, trade_candles, trade, entry_dt, exit_dt):
        """Create minute-by-minute table for the trade"""
        md_content = []
        entry_price = trade['entry_price']
        
        md_content.append("| Time | Open | High | Low | Close | Volume | Change% | Notes |")
        md_content.append("|------|------|------|-----|-------|--------|---------|-------|")
        
        for idx, candle in trade_candles.iterrows():
            timestamp = idx.strftime('%H:%M:%S')
            open_price = candle['open']
            high_price = candle['high'] 
            low_price = candle['low']
            close_price = candle['close']
            volume = int(candle['volume'])
            
            # Calculate change from entry price
            change_pct = ((close_price - entry_price) / entry_price) * 100
            
            # Determine notes
            notes = []
            if idx.replace(second=0, microsecond=0) == pd.Timestamp(entry_dt).tz_localize('Asia/Kolkata' if idx.tz else None):
                notes.append("🎯 ENTRY")
            if idx.replace(second=0, microsecond=0) == pd.Timestamp(exit_dt).tz_localize('Asia/Kolkata' if idx.tz else None):
                notes.append("🚪 EXIT")
            if change_pct < -0.5:
                notes.append("🚨 DANGER")
            elif change_pct > 0.5:
                notes.append("📈 GAIN")
            if volume > trade_candles['volume'].mean() * 2:
                notes.append("📊 HIGH VOL")
                
            notes_str = " ".join(notes) if notes else "-"
            
            md_content.append(f"| {timestamp} | ₹{open_price:.2f} | ₹{high_price:.2f} | ₹{low_price:.2f} | ₹{close_price:.2f} | {volume:,} | {change_pct:+.2f}% | {notes_str} |")
        
        md_content.append("")
        return md_content

    def _create_critical_analysis(self, trade, candles_data, entry_dt, exit_dt):
        """Create critical analysis section"""
        md_content = []
        
        # Entry Context Analysis
        md_content.append("### 🎯 Entry Context")
        slippage = abs(trade['actual_sl']) - abs(trade['expected_sl'])
        if slippage > 0.4:
            md_content.append("- 🚨 **HIGH SLIPPAGE**: Stop loss slipped significantly beyond expected -0.5%")
        elif slippage > 0.1:
            md_content.append("- ⚠️ **MODERATE SLIPPAGE**: Stop loss slipped beyond expected -0.5%")
        else:
            md_content.append("- ✅ **NORMAL SLIPPAGE**: Stop loss executed close to expected level")
        
        md_content.append("")
        
        # Hold Time Analysis  
        md_content.append("### ⏰ Hold Time Analysis")
        hold_minutes = int(trade['hold_time'].replace('m', '')) if 'm' in trade['hold_time'] else 0
        if hold_minutes <= 2:
            md_content.append("- 🚨 **IMMEDIATE REVERSAL**: Trade went against us within 2 minutes")
            md_content.append("- 💡 **Implication**: Entry signal may have been premature or market conditions unfavorable")
        elif hold_minutes <= 15:
            md_content.append("- ⚠️ **QUICK REVERSAL**: Trade deteriorated within 15 minutes")
            md_content.append("- 💡 **Implication**: Short-term momentum was weak")
        else:
            md_content.append("- 📉 **GRADUAL DECLINE**: Trade held for extended period before exit")
            md_content.append("- 💡 **Implication**: Trend reversal or lack of momentum")
        
        md_content.append("")
        
        # Price Movement Analysis
        md_content.append("### 📈 Price Movement Pattern")
        if candles_data is not None and len(candles_data) > 0:
            md_content.append("- 📊 **Pattern Analysis**: Based on actual candle data")
            # Add more specific analysis based on actual price movement
        else:
            md_content.append("- ❌ **Limited Analysis**: No candle data available")
        
        md_content.append("")
        return md_content

    def _create_lessons_learned(self, trade):
        """Create lessons learned section"""
        md_content = []
        
        slippage = abs(trade['actual_sl']) - abs(trade['expected_sl'])
        hold_minutes = int(trade['hold_time'].replace('m', '')) if 'm' in trade['hold_time'] else 0
        
        # Generate specific lessons based on trade characteristics
        if slippage > 0.4:
            md_content.append("- 🎯 **Tighter Stops**: Consider using -0.3% stop loss instead of -0.5% for faster exits")
            md_content.append("- 💹 **Liquidity Check**: Verify adequate liquidity before entry to minimize slippage")
        
        if hold_minutes <= 2:
            md_content.append("- ⏰ **Entry Timing**: Wait for stronger confirmation signals before entering")
            md_content.append("- 📊 **Volume Confirmation**: Ensure adequate volume supports the move")
        
        if "STOP LOSS" in trade['reason']:
            md_content.append("- 🔄 **Dynamic Stops**: Consider ATR-based stop losses for volatile stocks")
            md_content.append("- 🚨 **Quick Exit Rules**: Exit if price drops >0.3% within first 5 minutes")
        
        # General lessons
        md_content.append("- 📈 **Risk Management**: Never risk more than planned, even if signal looks strong")
        md_content.append("- 🎲 **Position Sizing**: Consider reducing position size for highly volatile instruments")
        
        md_content.append("")
        return md_content
    
    def run_analysis(self, log_file_path=None):
        """Run complete losing trades analysis"""
        console.print(Panel.fit("🔍 LOSING TRADES ANALYSIS REPORT", style="bold white on red"))
        
        # Parse log file if provided
        if log_file_path and LOG_PARSER_AVAILABLE:
            self.losing_trades = self._parse_log_for_losing_trades(log_file_path)
        
        total_losses = sum(trade['pnl_amount'] for trade in self.losing_trades)
        console.print(f"\n📊 [bold]Total Analyzed Trades:[/bold] {len(self.losing_trades)}")
        console.print(f"💰 [bold]Total Losses:[/bold] ₹{total_losses:,.0f}")
        if len(self.losing_trades) > 0:
            console.print(f"📉 [bold]Average Loss per Trade:[/bold] ₹{total_losses/len(self.losing_trades):,.0f}")
        else:
            console.print(f"📉 [bold]Average Loss per Trade:[/bold] ₹0")
        
        print("\n" + "="*80 + "\n")
        
        # Run analyses
        avg_slippage, severe_slippage = self.analyze_stop_loss_slippage()
        print("\n" + "="*80 + "\n")
        
        immediate_reversals = self.analyze_entry_timing()
        print("\n" + "="*80 + "\n")
        
        self.analyze_price_action_patterns()
        print("\n" + "="*80 + "\n")
        
        # Add candle analysis
        self.analyze_candle_patterns()
        print("\n" + "="*80 + "\n")
        
        self.generate_recommendations()
        
        # Summary insights
        console.print(Panel.fit("🎯 KEY INSIGHTS", style="bold yellow"))
        console.print(f"• Average stop loss slippage: +{avg_slippage:.2f}%")
        console.print(f"• {severe_slippage}/{len(self.losing_trades)} trades had severe slippage (>0.4%)")
        console.print(f"• {immediate_reversals}/{len(self.losing_trades)} trades reversed immediately (<2min)")
        console.print("• Most losses due to gap downs or fast price movements")
        console.print("• Current -0.5% stop loss may be too loose for volatile conditions")
        
        print("\n" + "="*80 + "\n")
        
        # Generate detailed reports
        self.generate_detailed_trade_reports()

if __name__ == "__main__":
    # Check if log file path is provided as command line argument
    if len(sys.argv) > 1:
        log_file_path = sys.argv[1]
        console.print(f"[green]📁 Using log file: {log_file_path}[/green]")
        analyzer = LosingTradesAnalyzer(log_file_path)
        analyzer.run_analysis()
    else:
        console.print("[yellow]📁 No log file provided, using default data[/yellow]")
        analyzer = LosingTradesAnalyzer()
        analyzer.run_analysis()