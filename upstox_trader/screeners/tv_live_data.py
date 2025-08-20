#!/usr/bin/env python3
"""
Live Market Data & Monitoring Functions
Extracted from TVScreenerUsage class
"""

import time
import threading
import pandas as pd
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

console = Console()

class LiveDataMonitor:
    """Live market data fetching and position monitoring functionality"""
    
    def __init__(self, parent_instance):
        self.parent = parent_instance
        self.monitoring_active = False
        self.monitor_thread = None
        self.price_cache = {}
        self.cache_timestamp = {}
        self.cache_duration = 10  # seconds
    
    def _get_live_price_from_upstox(self, symbol, force_refresh=False):
        """Get live price from Upstox API with caching"""
        try:
            current_time = time.time()
            
            # Check cache first
            if not force_refresh and symbol in self.price_cache:
                if current_time - self.cache_timestamp.get(symbol, 0) < self.cache_duration:
                    return self.price_cache[symbol]
            
            if hasattr(self.parent, 'upstox_client') and self.parent.upstox_client:
                # Clean symbol for API call
                clean_symbol = symbol.replace('NSE:', '').replace('BSE:', '')
                
                # Try to get live quote using fetch_intraday_data_v3
                try:
                    df = self.parent.upstox_client.fetch_intraday_data_v3(
                        symbol=clean_symbol,
                        unit='minutes',
                        interval=1
                    )
                    if df is not None and not df.empty:
                        live_price = float(df['close'].iloc[-1])
                        
                        if live_price > 0:
                            # Update cache
                            self.price_cache[symbol] = live_price
                            self.cache_timestamp[symbol] = current_time
                            return live_price
                except Exception as api_error:
                    console.print(f"⚠️ API error for {symbol}: {api_error}", style="yellow")
                
                # Fallback to historical data (latest close)
                try:
                    to_date = datetime.now().strftime('%Y-%m-%d')
                    from_date = (datetime.now() - timedelta(days=2)).strftime('%Y-%m-%d')
                    historical_data = self.parent.upstox_client.fetch_historical_data_v3(
                        symbol=clean_symbol,
                        unit='days',
                        interval=1,
                        to_date=to_date,
                        from_date=from_date
                    )
                    
                    if historical_data:
                        # Get latest close price
                        latest_candle = historical_data[-1]
                        fallback_price = latest_candle[4]  # close price
                        
                        self.price_cache[symbol] = fallback_price
                        self.cache_timestamp[symbol] = current_time
                        return fallback_price
                        
                except Exception as hist_error:
                    console.print(f"⚠️ Historical data error for {symbol}: {hist_error}", style="yellow")
            
        except Exception as e:
            console.print(f"⚠️ Error getting live price for {symbol}: {e}", style="yellow")
        
        return None
    
    def _fetch_live_prices_parallel(self, symbols):
        """Fetch live prices for multiple symbols in parallel"""
        prices = {}
        
        def fetch_single_price(symbol):
            try:
                price = self._get_live_price_from_upstox(symbol)
                return symbol, price
            except Exception as e:
                console.print(f"⚠️ Error fetching {symbol}: {e}", style="yellow")
                return symbol, None
        
        # Use ThreadPoolExecutor for parallel fetching
        with ThreadPoolExecutor(max_workers=10) as executor:
            future_to_symbol = {executor.submit(fetch_single_price, symbol): symbol for symbol in symbols}
            
            for future in as_completed(future_to_symbol):
                symbol, price = future.result()
                if price:
                    prices[symbol] = price
        
        return prices
    
    def _fetch_price_from_exchange(self, symbol, exchange):
        """Fetch price from specific exchange"""
        try:
            clean_symbol = symbol.replace('NSE:', '').replace('BSE:', '')
            instrument_key = f"{exchange}_EQ|{clean_symbol}"
            
            if hasattr(self.parent, 'upstox_client') and self.parent.upstox_client:
                # Use fetch_intraday_data_v3 to get current price
                df = self.parent.upstox_client.fetch_intraday_data_v3(
                    symbol=clean_symbol,
                    unit='minutes',
                    interval=1
                )
                if df is not None and not df.empty:
                    return float(df['close'].iloc[-1])
                    
        except Exception as e:
            console.print(f"⚠️ Error fetching from {exchange}: {e}", style="yellow")
        
        return None
    
    def _display_active_positions(self):
        """Display active trading positions"""
        if not hasattr(self.parent, 'paper_trading_bot') or not self.parent.paper_trading_bot:
            console.print("📊 No paper trading bot available", style="yellow")
            return
        
        positions = self.parent.paper_trading_bot.get_positions()
        
        if not positions:
            console.print("📊 No active positions", style="dim")
            return
        
        table = Table(title="🎯 Active Positions")
        table.add_column("Symbol", style="cyan")
        table.add_column("Side", justify="center")
        table.add_column("Entry", justify="right")
        table.add_column("Current", justify="right")
        table.add_column("P&L %", justify="right")
        table.add_column("P&L ₹", justify="right")
        table.add_column("Qty", justify="right")
        table.add_column("Duration", justify="center")
        table.add_column("Status", justify="center")
        
        symbols_to_fetch = list(positions.keys())
        live_prices = self._fetch_live_prices_parallel(symbols_to_fetch)
        
        for symbol, position in positions.items():
            current_price = live_prices.get(symbol, position['entry_price'])
            
            # Calculate P&L
            if position['side'] == 'BUY':
                pnl_pct = ((current_price - position['entry_price']) / position['entry_price']) * 100
            else:
                pnl_pct = ((position['entry_price'] - current_price) / position['entry_price']) * 100
            
            pnl_amount = pnl_pct * position['amount'] / 100
            
            # Duration
            entry_time = datetime.fromisoformat(position['timestamp'].replace('Z', '+00:00'))
            duration = datetime.now() - entry_time.replace(tzinfo=None)
            duration_str = f"{int(duration.total_seconds() // 3600)}h {int((duration.total_seconds() % 3600) // 60)}m"
            
            # Status and colors
            pnl_color = "green" if pnl_pct > 0 else "red" if pnl_pct < -2 else "yellow"
            status = "🟢" if pnl_pct > 2 else "🔴" if pnl_pct < -3 else "🟡"
            
            side_color = "green" if position['side'] == 'BUY' else "red"
            
            table.add_row(
                symbol.replace('NSE:', ''),
                f"[{side_color}]{position['side']}[/]",
                f"₹{position['entry_price']:.1f}",
                f"₹{current_price:.1f}",
                f"[{pnl_color}]{pnl_pct:+.1f}%[/]",
                f"[{pnl_color}]{pnl_amount:+.0f}[/]",
                str(position['quantity']),
                duration_str,
                status
            )
        
        console.print(table)
        
        # Display summary
        total_positions = len(positions)
        profitable = sum(1 for p in positions.values() if self._calculate_position_pnl(p, live_prices) > 0)
        
        summary = f"📊 {total_positions} positions • {profitable} profitable • {total_positions - profitable} losing"
        console.print(Panel(summary, style="dim"))
    
    def _calculate_position_pnl(self, position, live_prices):
        """Calculate P&L for a position"""
        symbol = position.get('symbol', '')
        current_price = live_prices.get(symbol, position['entry_price'])
        
        if position['side'] == 'BUY':
            return ((current_price - position['entry_price']) / position['entry_price']) * 100
        else:
            return ((position['entry_price'] - current_price) / position['entry_price']) * 100
    
    def start_background_monitoring(self):
        """Start background position monitoring"""
        if self.monitoring_active:
            console.print("⚠️ Background monitoring already active", style="yellow")
            return
        
        self.monitoring_active = True
        self.monitor_thread = threading.Thread(target=self._background_monitor_loop, daemon=True)
        self.monitor_thread.start()
        console.print("🚀 Background position monitoring started", style="green")
    
    def stop_background_monitoring(self):
        """Stop background position monitoring"""
        if not self.monitoring_active:
            console.print("⚠️ Background monitoring not active", style="yellow")
            return
        
        self.monitoring_active = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=5)
        console.print("🛑 Background position monitoring stopped", style="red")
    
    def _background_monitor_loop(self):
        """Main background monitoring loop"""
        console.print("🎯 Starting background position monitoring...", style="dim")
        
        while self.monitoring_active:
            try:
                if hasattr(self.parent, 'paper_trading_bot') and self.parent.paper_trading_bot:
                    positions = self.parent.paper_trading_bot.get_positions()
                    
                    if positions:
                        symbols = list(positions.keys())
                        live_prices = self._fetch_live_prices_parallel(symbols)
                        
                        for symbol, position in positions.items():
                            if symbol in live_prices:
                                self._monitor_position_risk(symbol, position, live_prices[symbol])
                
                # Sleep for monitoring interval
                time.sleep(30)  # Check every 30 seconds
                
            except Exception as e:
                console.print(f"⚠️ Error in background monitoring: {e}", style="yellow")
                time.sleep(60)  # Wait longer on error
    
    def _monitor_position_risk(self, symbol, position, current_price=None):
        """Monitor individual position for risk management"""
        if current_price is None:
            current_price = self._get_live_price_from_upstox(symbol)
            
        if not current_price:
            return
        
        try:
            entry_price = position['entry_price']
            side = position['side']
            timestamp = position['timestamp']
            
            # Calculate current P&L
            if side == 'BUY':
                pnl_pct = ((current_price - entry_price) / entry_price) * 100
            else:
                pnl_pct = ((entry_price - current_price) / entry_price) * 100
            
            # Time-based checks
            entry_time = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            time_in_position = datetime.now() - entry_time.replace(tzinfo=None)
            minutes_in_position = time_in_position.total_seconds() / 60
            
            # Risk management rules
            should_exit = False
            exit_reason = ""
            
            # Stop loss check
            if pnl_pct < -5:  # 5% stop loss
                should_exit = True
                exit_reason = "STOP_LOSS"
            
            # Profit taking
            elif pnl_pct > 8:  # Take profit at 8%
                should_exit = True
                exit_reason = "PROFIT_TARGET"
            
            # Time-based exit (end of day)
            elif self.parent.trading_core._is_market_closed():
                should_exit = True
                exit_reason = "MARKET_CLOSE"
            
            # Trailing stop for profitable positions
            elif pnl_pct > 3:
                # Implement trailing stop logic
                trailing_stop = self._calculate_trailing_stop(position, current_price, pnl_pct)
                if trailing_stop['should_exit']:
                    should_exit = True
                    exit_reason = "TRAILING_STOP"
            
            # Execute exit if needed
            if should_exit:
                self._execute_exit_trade(symbol, position, current_price, exit_reason)
                
        except Exception as e:
            console.print(f"⚠️ Error monitoring position {symbol}: {e}", style="yellow")
    
    def _calculate_trailing_stop(self, position, current_price, pnl_pct):
        """Calculate trailing stop for profitable positions"""
        try:
            # Get or initialize trailing data
            if not hasattr(position, 'highest_profit'):
                position['highest_profit'] = pnl_pct
                position['trailing_stop_pct'] = max(1.0, pnl_pct * 0.3)  # 30% retracement
            
            # Update highest profit
            if pnl_pct > position['highest_profit']:
                position['highest_profit'] = pnl_pct
                # Adjust trailing stop - tighter as profits increase
                if pnl_pct > 10:
                    position['trailing_stop_pct'] = pnl_pct - 2.0  # 2% trail
                elif pnl_pct > 5:
                    position['trailing_stop_pct'] = pnl_pct - 1.5  # 1.5% trail
                else:
                    position['trailing_stop_pct'] = pnl_pct - 1.0  # 1% trail
            
            # Check if current profit is below trailing stop
            should_exit = pnl_pct < position['trailing_stop_pct']
            
            return {
                'should_exit': should_exit,
                'trailing_stop_pct': position['trailing_stop_pct'],
                'highest_profit': position['highest_profit'],
                'current_profit': pnl_pct
            }
            
        except Exception as e:
            console.print(f"⚠️ Error calculating trailing stop: {e}", style="yellow")
            return {'should_exit': False}
    
    def _execute_exit_trade(self, symbol, position, exit_price, reason):
        """Execute exit trade for a position"""
        try:
            if not hasattr(self.parent, 'paper_trading_bot') or not self.parent.paper_trading_bot:
                return
            
            # Calculate final P&L
            entry_price = position['entry_price']
            side = position['side']
            quantity = position['quantity']
            amount = position['amount']
            
            if side == 'BUY':
                pnl_pct = ((exit_price - entry_price) / entry_price) * 100
                exit_side = 'SELL'
            else:
                pnl_pct = ((entry_price - exit_price) / entry_price) * 100
                exit_side = 'BUY'
            
            pnl_amount = pnl_pct * amount / 100
            
            # Execute the exit trade
            exit_result = self.parent.paper_trading_bot.place_paper_trade(
                symbol=symbol,
                side=exit_side,
                quantity=quantity,
                price=exit_price,
                trade_type='MARKET',
                product='MIS'
            )
            
            if exit_result.get('success'):
                # Log the trade
                self.parent.trading_core.log_trade(
                    action='EXIT',
                    symbol=symbol,
                    price=exit_price,
                    qty=quantity,
                    amount=amount,
                    alert_type=reason,
                    pnl_pct=pnl_pct,
                    pnl_amount=pnl_amount,
                    side=exit_side
                )
                
                # Display exit notification
                pnl_color = "green" if pnl_pct > 0 else "red"
                console.print(
                    f"🚪 EXITED {symbol.replace('NSE:', '')} | "
                    f"Reason: {reason} | "
                    f"[{pnl_color}]P&L: {pnl_pct:+.1f}% (₹{pnl_amount:+.0f})[/]",
                    style="bold"
                )
                
                # Add cooldown if loss
                if pnl_pct < -2:
                    cooldown_until = datetime.now() + timedelta(hours=2)
                    if not hasattr(self.parent, 'loss_cooldowns'):
                        self.parent.loss_cooldowns = {}
                    self.parent.loss_cooldowns[symbol] = cooldown_until
                
            else:
                console.print(f"❌ Failed to exit {symbol}: {exit_result.get('message', 'Unknown error')}", style="red")
                
        except Exception as e:
            console.print(f"❌ Error executing exit trade for {symbol}: {e}", style="red")
    
    def _display_live_trades(self):
        """Display live trading activity"""
        if not hasattr(self.parent, 'paper_trading_bot') or not self.parent.paper_trading_bot:
            console.print("📊 No trading activity to display", style="dim")
            return
        
        # Get recent trades (last 10)
        trades = self.parent.paper_trading_bot.get_trade_history()
        if not trades:
            console.print("📊 No recent trades", style="dim")
            return
        
        table = Table(title="🔥 Recent Trades")
        table.add_column("Time", style="dim")
        table.add_column("Symbol", style="cyan")
        table.add_column("Side", justify="center")
        table.add_column("Price", justify="right")
        table.add_column("Qty", justify="right")
        table.add_column("Status", justify="center")
        
        for trade in trades[-10:]:  # Last 10 trades
            timestamp = datetime.fromisoformat(trade['timestamp'].replace('Z', '+00:00'))
            time_str = timestamp.strftime("%H:%M")
            
            side_color = "green" if trade['side'] == 'BUY' else "red"
            status = "✅" if trade['status'] == 'COMPLETED' else "⏳"
            
            table.add_row(
                time_str,
                trade['symbol'].replace('NSE:', ''),
                f"[{side_color}]{trade['side']}[/]",
                f"₹{trade['price']:.1f}",
                str(trade['quantity']),
                status
            )
        
        console.print(table)
    
    def _display_closed_trades(self):
        """Display summary of closed trades for the day"""
        if not hasattr(self.parent, 'paper_trading_bot') or not self.parent.paper_trading_bot:
            return
        
        trades = self.parent.paper_trading_bot.get_trade_history()
        if not trades:
            return
        
        # Filter today's completed trades
        today = datetime.now().date()
        today_trades = []
        
        for trade in trades:
            trade_date = datetime.fromisoformat(trade['timestamp'].replace('Z', '+00:00')).date()
            if trade_date == today and trade['status'] == 'COMPLETED':
                today_trades.append(trade)
        
        if not today_trades:
            console.print("📊 No completed trades today", style="dim")
            return
        
        # Calculate summary
        total_trades = len(today_trades)
        winning_trades = sum(1 for t in today_trades if t.get('pnl_pct', 0) > 0)
        total_pnl = sum(t.get('pnl_amount', 0) for t in today_trades)
        
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        
        summary = (
            f"📊 Today's Summary: {total_trades} trades • "
            f"{win_rate:.0f}% win rate • "
            f"P&L: ₹{total_pnl:+.0f}"
        )
        
        color = "green" if total_pnl > 0 else "red" if total_pnl < 0 else "yellow"
        console.print(Panel(summary, style=color))