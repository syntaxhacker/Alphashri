#!/usr/bin/env python3
"""
Live Data Monitoring Functions
Extracted from TVScreenerUsage class
"""

import time
import threading
from datetime import datetime
from rich.console import Console

console = Console()

class LiveDataMonitor:
    """Live data monitoring and price tracking functionality"""
    
    def __init__(self, parent_instance):
        self.parent = parent_instance
    
    def _get_live_price_from_upstox(self, symbol, force_refresh=False):
        """Get live price from Upstox API for a symbol with BSE fallback"""
        try:
            if not (hasattr(self.parent, 'upstox_api') and self.parent.upstox_api):
                return None
                
            # Check cache freshness (avoid excessive API calls)
            current_time = time.time()
            cache_duration = 10  # Cache for 10 seconds
            
            if not force_refresh and symbol in self.parent.price_cache_timestamps:
                if current_time - self.parent.price_cache_timestamps[symbol] < cache_duration:
                    return self.parent.current_prices.get(symbol)
            
            # Check if symbol is in blacklist of non-existent symbols to avoid repeated API calls
            if not hasattr(self.parent, '_symbol_blacklist'):
                self.parent._symbol_blacklist = set()
            if symbol in self.parent._symbol_blacklist:
                return None
            
            # Use symbol validator for comprehensive checking
            try:
                from upstox_trader.screeners.symbol_validator import is_symbol_blacklisted, get_valid_symbol
                if is_symbol_blacklisted(symbol):
                    return None
                    
                validated_symbol = get_valid_symbol(symbol)
                if not validated_symbol:
                    return None
                    
            except Exception as e:
                console.print(f"[yellow]⚠️ Symbol validation error for {symbol}: {e}[/yellow]")
            
            # Validate and clean the symbol
            clean_symbol = symbol.strip().upper()
            
            # Extract exchange and symbol first
            if ':' in clean_symbol:
                exchange, clean_symbol = clean_symbol.split(':', 1)
            else:
                exchange = 'NSE'
            
            # Remove common suffixes that might cause instrument key not found errors
            suffixes_to_remove = ['.EQ', '-EQ', 'EQ', '.NS', '.BO', '-NS', '-BO']
            for suffix in suffixes_to_remove:
                if clean_symbol.endswith(suffix):
                    clean_symbol = clean_symbol[:-len(suffix)]
                    break
            
            # Validate symbol format AFTER cleaning (should be 3-15 characters for Indian stocks)
            if not (3 <= len(clean_symbol) <= 15):
                console.print(f"[yellow]⚠️ Invalid symbol format for {symbol}: {clean_symbol} (length: {len(clean_symbol)})[/yellow]")
                return None
            
            # First attempt: Try original exchange
            price = self._fetch_price_from_exchange(clean_symbol, exchange)
            
            # Fallback: If NSE fails, try BSE (and vice versa)
            if price is None:
                fallback_exchange = 'BSE' if exchange == 'NSE' else 'NSE'
                price = self._fetch_price_from_exchange(clean_symbol, fallback_exchange)
                
                if price is not None:
                    console.print(f"[green]✅ Found {clean_symbol} on {fallback_exchange} (fallback from {exchange})[/green]")
                    # Track fallback usage
                else:
                    # Add to blacklist if not found on any exchange
                    self.parent._symbol_blacklist.add(symbol)
                    console.print(f"[red]❌ Symbol {clean_symbol} not found on NSE or BSE - blacklisting[/red]")
                    self.parent.exchange_fallbacks[symbol] = fallback_exchange
            
            if price is not None:
                # Update cache
                self.parent.current_prices[symbol] = round(price, 2)
                self.parent.price_cache_timestamps[symbol] = current_time
                return round(price, 2)
                
        except Exception as e:
            # Only show error once per minute to avoid spam
            if not hasattr(self.parent, '_last_error_time'):
                self.parent._last_error_time = {}
            
            current_time = time.time()
            if symbol not in self.parent._last_error_time or current_time - self.parent._last_error_time[symbol] > 60:
                console.print(f"[yellow]⚠️ Failed to get live price for {symbol}: {e}[/yellow]")
                self.parent._last_error_time[symbol] = current_time
                
        return None

    def _fetch_live_prices_parallel(self, symbols):
        """Fetch live prices for multiple symbols in parallel using threading"""
        import concurrent.futures
        
        live_prices = {}
        
        def fetch_single_price(symbol):
            price = self._get_live_price_from_upstox(symbol)
            return symbol, price
        
        # Use ThreadPoolExecutor for parallel execution
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(symbols), 10)) as executor:
            # Submit all price fetch tasks
            future_to_symbol = {executor.submit(fetch_single_price, symbol): symbol for symbol in symbols}
            
            # Collect results as they complete
            for future in concurrent.futures.as_completed(future_to_symbol):
                try:
                    symbol, price = future.result(timeout=5)  # 5 second timeout per request
                    if price is not None:
                        live_prices[symbol] = price
                except Exception as e:
                    symbol = future_to_symbol[future]
                    console.print(f"[dim red]⚠️ Parallel fetch failed for {symbol}: {str(e)[:30]}...[/dim red]")
        
        return live_prices

    def _fetch_price_from_exchange(self, symbol, exchange):
        """Fetch price from specific exchange with proper error handling"""
        try:
            # Check if market is open (9:15 AM - 3:30 PM) - different from trading hours
            from datetime import datetime, time
            now = datetime.now().time()
            market_open = time(9, 15)  # 9:15 AM
            market_close = time(15, 30)  # 3:30 PM
            
            if not (market_open <= now <= market_close):
                # Outside market hours - use last known price from cache
                return self.parent.current_prices.get(symbol)
            
            # Map exchange to Upstox format
            exchange_map = {
                'NSE': 'NSE_EQ',
                'BSE': 'BSE_EQ'
            }
            
            upstox_exchange = exchange_map.get(exchange, 'NSE_EQ')
            
            # Get latest intraday data (1-minute) to get current price
            # Remove exchange parameter as it causes "instrument key not found" errors
            df = self.parent.upstox_api.fetch_intraday_data_v3(
                symbol=symbol, 
                unit='minutes', 
                interval=1
            )
            
            if df is not None and not df.empty:
                # Get the latest close price (most recent data point)
                return float(df['close'].iloc[-1])
                
        except Exception as e:
            # Check for specific "instrument key not found" error
            if "instrument key" in str(e).lower() or "not found" in str(e).lower():
                return None  # Silent fallback for missing instruments
            else:
                # Log other errors
                console.print(f"[dim red]⚠️ {exchange} error for {symbol}: {str(e)[:50]}...[/dim red]")
                
        return None

    def start_background_monitoring(self):
        """Start background thread for continuous live price monitoring and risk management"""
        if not self.parent.paper_trading_enabled or not self.parent.upstox_api:
            return
        
        if self.parent.background_monitor_active:
            console.print("[yellow]⚠️ Background monitoring already active[/yellow]")
            return
        
        self.parent.background_monitor_active = True
        self.parent.stop_monitoring.clear()
        self.parent.monitor_thread = threading.Thread(target=self._background_monitor_loop, daemon=True)
        self.parent.monitor_thread.start()
        console.print("[green]🔄 Started background live price monitoring[/green]")

    def stop_background_monitoring(self):
        """Stop background monitoring thread"""
        if self.parent.background_monitor_active:
            self.parent.stop_monitoring.set()
            self.parent.background_monitor_active = False
            if self.parent.monitor_thread:
                self.parent.monitor_thread.join(timeout=2.0)
            console.print("[yellow]⏹️ Stopped background monitoring[/yellow]")

    def _background_monitor_loop(self):
        """Background loop for continuous position monitoring and risk management"""
        console.print("[dim]🔍 Background monitor started - checking positions every 2 seconds[/dim]")
        
        while not self.parent.stop_monitoring.wait(2.0):  # Check every 2 seconds
            try:
                if not self.parent.positions:
                    continue
                
                active_positions = {k: v for k, v in self.parent.positions.items() if v}
                if not active_positions:
                    continue
                
                for symbol, position in active_positions.items():
                    self._monitor_position_risk(symbol, position)
                    
            except Exception as e:
                console.print(f"[red]❌ Error in background monitor: {e}[/red]")
                continue

    def _monitor_position_risk(self, symbol, position):
        """Monitor individual position for risk management with trailing stop"""
        try:
            # Get live price (force refresh for accuracy in risk management)
            live_price = self._get_live_price_from_upstox(symbol, force_refresh=True)
            if not live_price:
                return
            
            # Update current price
            self.parent.current_prices[symbol] = live_price
            
            # Calculate current P&L including charges
            entry_price = position['entry_price']
            entry_charges = position.get('entry_charges', 0)
            
            # Estimate exit charges for current P&L calculation
            current_value = live_price * position['qty']
            estimated_exit_charges = self.parent._calculate_trading_charges(current_value, 'intraday')
            
            # Calculate gross and net P&L
            gross_pnl = (live_price - entry_price) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1
                
            net_pnl = gross_pnl - entry_charges - estimated_exit_charges
            entry_value = entry_price * position['qty']
            pnl_pct = (net_pnl / entry_value) * 100
            
            # Risk Management Rules with ATR-based stops for volatile stocks
            volatility = position.get('volatility', 'normal')  # Track volatility level
            
            if volatility == 'high':
                # Use ATR-based stops for volatile stocks
                atr_stop_price = self.parent._calculate_atr_based_stop(symbol, live_price)
                atr_stop_pct = ((atr_stop_price - entry_price) / entry_price) * 100
                if position['side'] == 'SELL':
                    atr_stop_pct *= -1
                stop_loss_pct = atr_stop_pct
                console.print(f"[dim]Using ATR-based stop for volatile {symbol}: {stop_loss_pct:.2f}%[/dim]")
            else:
                stop_loss_pct = self.parent.config.risk_management.regular_stop_loss_pct
            
            take_profit_pct = self.parent.config.risk_management.take_profit_pct
            quick_exit_pct = self.parent.config.risk_management.quick_exit_pct
            
            # Calculate trade duration for ultra-quick trailing determination
            trade_duration_minutes = (datetime.now() - position['timestamp']).total_seconds() / 60
            ultra_quick_trailing = self.parent.config.is_ultra_quick_trigger(trade_duration_minutes, pnl_pct)
            
            # MUCH TIGHTER trailing stop buffer (aggressive profit locking)
            trailing_stop_buffer = self.parent._get_tighter_trailing_buffer(abs(pnl_pct), is_ultra_quick=ultra_quick_trailing)
            
            # Update highest profit and price tracking
            if pnl_pct > position['highest_profit_pct']:
                position['highest_profit_pct'] = pnl_pct
                position['highest_price'] = live_price
            
            # Check for exit conditions
            should_exit = False
            exit_reason = ""
            
            # 0. Ultra-quick tight trailing for very fast profits (NO HARD EXITS)
            if ultra_quick_trailing and not position.get('trailing_stop_active', False):
                position['trailing_stop_active'] = True
                position['best_profit_pct'] = pnl_pct
                
                # Determine trigger type for logging
                if trade_duration_minutes <= 3:
                    trigger_type = "ULTRA-QUICK"
                elif trade_duration_minutes <= 5:
                    trigger_type = "QUICK"
                else:
                    trigger_type = "FAST"
                    
                console.print(f"[green]🚀 {symbol}: {trigger_type} trailing activated at {pnl_pct:.2f}% in {trade_duration_minutes:.1f}m[/green]")
            
            # 1. Regular stop loss (if not in trailing mode)
            elif not position['trailing_stop_active'] and pnl_pct <= stop_loss_pct:
                should_exit = True
                exit_reason = f"STOP LOSS: {pnl_pct:.2f}%"
            
            # 2. Activate trailing stop when take profit is reached
            elif pnl_pct >= take_profit_pct and not position['trailing_stop_active']:
                position['trailing_stop_active'] = True
                position['trailing_stop_pct'] = pnl_pct - trailing_stop_buffer
                console.print(f"[bold green]🎯 PROGRESSIVE TRAILING STOP ACTIVATED for {symbol} at {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}% | Buffer: {trailing_stop_buffer:.1f}%)[/bold green]")
                # Telegram notification removed - only send alerts for actual trades
            
            # 3. Update trailing stop as profit increases (progressive tightening)
            elif position['trailing_stop_active']:
                new_trailing_stop = pnl_pct - trailing_stop_buffer
                old_trailing_stop = position['trailing_stop_pct']
                
                # Only move trailing stop up (lock in more profit)
                if new_trailing_stop > position['trailing_stop_pct']:
                    position['trailing_stop_pct'] = new_trailing_stop
                    
                    # Show buffer tightening for significant moves
                    if abs(new_trailing_stop - old_trailing_stop) >= 0.2:  # 0.2% or more change
                        console.print(f"[dim green]📈 {symbol} trailing stop tightened: {old_trailing_stop:.2f}% → {new_trailing_stop:.2f}% (Buffer: {trailing_stop_buffer:.1f}%)[/dim green]")
                
                # Check if trailing stop is hit
                if pnl_pct <= position['trailing_stop_pct']:
                    should_exit = True
                    exit_reason = f"TRAILING STOP: {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}% | Buffer: {trailing_stop_buffer:.1f}%)"
            
            # Execute exit if needed
            if should_exit:
                self.parent._execute_exit_trade(symbol, position, live_price, exit_reason)
                
        except Exception as e:
            console.print(f"[red]❌ Error monitoring {symbol}: {e}[/red]")

    def _execute_exit_trade(self, symbol, position, exit_price, reason):
        """Execute exit trade for risk management"""
        try:
            # Calculate exit charges
            exit_amount = exit_price * position['qty']
            exit_charges = self.parent._calculate_trading_charges(exit_amount, 'intraday')
            
            # Calculate P&L with trading charges
            gross_pnl = (exit_price - position['entry_price']) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1
            
            # Net P&L after all charges
            total_charges = position.get('entry_charges', 0) + exit_charges
            net_pnl = gross_pnl - total_charges
            pnl_amount = net_pnl
            
            # Calculate P&L percentage based on net amount
            entry_value = position['entry_price'] * position['qty']
            pnl_pct = (net_pnl / entry_value) * 100
            
            exit_log = (f"🔥 AUTO EXIT: {symbol} | "
                       f"{reason} | "
                       f"Entry: ₹{position['entry_price']:.0f} | "
                       f"Exit: ₹{exit_price:.0f} | "
                       f"P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | "
                       f"Charges: ₹{total_charges:.0f}")
            
            console.print(f"[bold red]{exit_log}[/bold red]")
            
            # Log to journal
            amount = exit_price * position['qty']
            exit_side = 'SELL' if position['side'] == 'BUY' else 'BUY'
            self.parent.log_trade("EXIT", symbol, exit_price, position['qty'], amount, reason, pnl_pct, pnl_amount, side=exit_side)
            
            # Add to stop loss cooldown if this was a stop loss exit
            if "STOP LOSS" in reason:
                self.parent.stop_loss_cooldown[symbol] = datetime.now()
                console.print(f"[dim red]🚫 Added {symbol} to 30-minute stop loss cooldown[/dim red]")
            
            # Add to loss cooldown for ANY loss (30+ minutes after loss)
            if pnl_amount < 0:  # Any loss
                self.parent.loss_cooldown[symbol] = datetime.now()
                console.print(f"[dim red]🚫 Added {symbol} to 30-minute loss cooldown (₹{pnl_amount:+,.0f})[/dim red]")
            
            # Add to live trades log
            self.parent.live_trades.append({
                'timestamp': datetime.now(),
                'symbol': symbol,
                'side': 'SELL' if position['side'] == 'BUY' else 'BUY',
                'price': exit_price,
                'quantity': position['qty'],
                'amount': exit_price * position['qty'],
                'alert_type': 'AUTO_EXIT',
                'confidence': 1.0,
                'reason': reason,
                'pnl_pct': pnl_pct,
                'pnl_amount': pnl_amount
            })
            
            # Send Telegram alert if enabled
            if self.parent.telegram_enabled:
                exit_alert = {
                    'type': 'TRADE_EXIT',
                    'ticker': symbol,
                    'name': symbol,
                    'price': exit_price,  # Required by telegram function
                    'side': 'SELL' if position['side'] == 'BUY' else 'BUY',
                    'entry_price': position['entry_price'],
                    'exit_price': exit_price,
                    'quantity': position['qty'],
                    'amount': exit_price * position['qty'],
                    'reason': reason,
                    'pnl_pct': pnl_pct,
                    'pnl_amount': pnl_amount,
                    'hold_time_minutes': int((datetime.now() - position['timestamp']).total_seconds() / 60)
                }
                self.parent.send_telegram_alert(exit_alert)
            
            # Add to closed trades list
            self.parent.closed_trades.append({
                'symbol': symbol,
                'side': position['side'],
                'entry_time': position.get('timestamp', datetime.now()),
                'exit_time': datetime.now(),
                'entry_price': position['entry_price'],
                'exit_price': exit_price,
                'quantity': position['qty'],
                'pnl_pct': pnl_pct,
                'pnl_amount': pnl_amount,
                'exit_reason': reason
            })
            
            # Close the position
            del self.parent.positions[symbol]
            
        except Exception as e:
            console.print(f"[red]❌ Error executing exit for {symbol}: {e}[/red]")