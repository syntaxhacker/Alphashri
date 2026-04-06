from rich.console import Console
from rich.table import Table
from datetime import datetime, timedelta
import time as time_module
import threading
import os

console = Console()


class TradingMixin:

    def _setup_realtime_streaming(self) -> bool:
        if not self.upstox_api:
            return False

        try:
            symbols_to_monitor = []

            if self.paper_trading_enabled and hasattr(self, 'live_trades'):
                symbols_to_monitor.extend([trade['symbol'] for trade in self.live_trades])

            if hasattr(self, 'positions'):
                symbols_to_monitor.extend([symbol for symbol in self.positions.keys() if self.positions[symbol]])

            symbols_to_monitor = list(set(symbols_to_monitor))[:20]

            if not symbols_to_monitor:
                symbols_to_monitor = ['RELIANCE', 'TCS', 'INFY']

            success = self.upstox_api.setup_realtime_streaming(
                symbols_to_monitor,
                callback=self._handle_realtime_tick
            )

            if success:
                self.upstox_api.start_realtime_streaming()
                console.print(f"[green]🔗 Real-time streaming active for {len(symbols_to_monitor)} symbols[/green]")
                return True
            else:
                console.print("[yellow]⚠️ Real-time streaming setup failed - using individual API calls[/yellow]")
                return False

        except Exception as e:
            console.print(f"[red]❌ Real-time streaming error: {e}[/red]")
            return False

    def _handle_realtime_tick(self, message):
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']

                for instrument_key, data in feeds.items():
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        price = float(data['ltpc']['ltp'])

                        if hasattr(self, 'current_prices'):
                            symbol = self.upstox_api.instrument_to_symbol_map.get(instrument_key)
                            if symbol:
                                self.current_prices[symbol] = price

        except Exception:
            pass

    def _is_trading_hours(self):
        try:
            now = datetime.now().time()

            start_time = datetime.strptime(self.trading_start_time, "%H:%M").time()
            end_time = datetime.strptime(self.trading_end_time, "%H:%M").time()

            return start_time <= now <= end_time
        except Exception as e:
            console.print(f"[yellow]⚠️ Error checking trading hours: {e}. Allowing trade.[/yellow]")
            return True

    def _get_base_symbol(self, ticker):
        if ':' in ticker:
            return ticker.split(':')[1]
        return ticker

    def _has_existing_position(self, ticker):
        base_symbol = self._get_base_symbol(ticker)

        for existing_ticker in self.positions:
            if self.positions[existing_ticker]:
                existing_base = self._get_base_symbol(existing_ticker)
                if base_symbol == existing_base:
                    return True, existing_ticker
        return False, None

    def _process_paper_trading_alert(self, alert):
        if not self.paper_trading_enabled:
            return

        try:
            ticker = alert.get('ticker', '')
            has_position, existing_ticker = self._has_existing_position(ticker)

            if has_position:
                console.print(f"[yellow]⚠️ Already have position in {self._get_base_symbol(ticker)} ({existing_ticker}) - skipping {ticker}[/yellow]")
                return

            symbol = alert['ticker']
            price = alert['price']

            confidence = self._calculate_alert_confidence(alert)

            if confidence < 0.7:
                console.print(f"   [yellow]⚠️ Alert confidence too low ({confidence:.0%}) - skipping trade[/yellow]")
                return

            trend = self._check_historical_trend(symbol, timeframe='daily', lookback_days=15)

            trade_side = None

            if trend in ['strong_bearish', 'bearish']:
                console.print(f"   [red]📉 {symbol} in {trend} trend - prioritizing SELL signals[/red]")
                if alert['type'] in ['VOLUME_SPIKE', 'PRICE_MOVE']:
                    trade_side = 'SELL'
            else:
                if alert['type'] == 'VOLUME_SPIKE':
                    if alert.get('change', 0) > 0 and trend in ['strong_bullish', 'bullish', 'neutral']:
                        trade_side = 'BUY'
                    elif alert.get('change', 0) < -2:
                        trade_side = 'SELL'

                elif alert['type'] == 'PRICE_MOVE':
                    if alert.get('current_change', 0) > 2:
                        if trend in ['strong_bullish', 'bullish']:
                            trade_side = 'BUY'
                        elif trend == 'neutral':
                            trade_side = 'BUY'
                    elif alert.get('current_change', 0) < -2:
                        trade_side = 'SELL'

            if trade_side:
                if trade_side == 'SELL':
                    mock_row = {
                        'close': price,
                        'change': alert.get('change', alert.get('current_change', 0)),
                        'relative_volume_10d_calc': alert.get('volume_ratio', 1.0),
                        'VWAP': alert.get('VWAP', price),
                        'EMA20': alert.get('EMA20', price),
                        'EMA50': alert.get('EMA50', price)
                    }
                    confirmed_downtrend = self._check_confirmed_downtrend_for_short(symbol, mock_row)
                    rsi = alert.get('rsi', 50)
                    if not confirmed_downtrend and rsi < 85:
                        console.print(f"[yellow]⚠️ {symbol}: SHORT signal but no confirmed downtrend - skipping[/yellow]")
                        return

                if symbol in self.positions and self.positions[symbol]:
                    console.print(f"   [yellow]⚠️ Already have position in {symbol} - skipping[/yellow]")
                    return

                quantity = max(1, int(20000 / price))

                success = self._execute_screener_trade(symbol, trade_side, alert, price, quantity, confidence, trend)

                if success:
                    trade_info = {
                        'timestamp': datetime.now(),
                        'symbol': symbol,
                        'side': trade_side,
                        'price': price,
                        'quantity': quantity,
                        'amount': quantity * price,
                        'alert_type': alert['type'],
                        'confidence': confidence
                    }

                    self.live_trades.append(trade_info)

                    if len(self.live_trades) > 10:
                        self.live_trades.pop(0)

                    self.log_trade("ENTRY", symbol, price, quantity, quantity * price, f"{alert['type']}|trend:{trend}", side=trade_side)

                    trend_emoji = "📈" if trend in ['strong_bullish', 'bullish'] else "📉" if trend in ['strong_bearish', 'bearish'] else "➡️"
                    strategy_reason = f"bearish trend short" if trend in ['strong_bearish', 'bearish'] and trade_side == 'SELL' else f"signal-based {trade_side.lower()}"
                    console.print(f"   [green]✅ Paper trade executed: {trade_side} {quantity} {symbol} @ ₹{price:.2f} {trend_emoji} ({strategy_reason})[/green]")
                else:
                    console.print(f"   [red]❌ Paper trade failed for {symbol}[/red]")
            else:
                console.print(f"   [dim]No clear trading signal for {symbol}[/dim]")

        except Exception as e:
            console.print(f"   [red]❌ Paper trading error: {e}[/red]")

    def _calculate_alert_confidence(self, alert):
        confidence = 0.5

        if alert['type'] == 'VOLUME_SPIKE':
            vol_ratio = alert.get('current_volume_ratio', 1)
            if vol_ratio > 5:
                confidence += 0.3
            elif vol_ratio > 3:
                confidence += 0.2
            elif vol_ratio > 2:
                confidence += 0.1

            change = abs(alert.get('change', 0))
            if change > 5:
                confidence += 0.2
            elif change > 3:
                confidence += 0.1

        elif alert['type'] == 'PRICE_MOVE':
            change = abs(alert.get('current_change', 0))
            if change > 8:
                confidence += 0.3
            elif change > 5:
                confidence += 0.2
            elif change > 3:
                confidence += 0.1

            vol_ratio = alert.get('volume_ratio', 1)
            if vol_ratio > 2:
                confidence += 0.1

        return min(confidence, 0.95)

    def _check_daily_entry_limit(self, symbol):
        from datetime import date
        today = date.today().isoformat()

        if symbol not in self.daily_entry_count:
            return False, 0

        if today not in self.daily_entry_count[symbol]:
            return False, 0

        entries_today = self.daily_entry_count[symbol][today]
        if entries_today >= self.max_daily_entries_per_stock:
            return True, entries_today

        return False, entries_today

    def _increment_daily_entry_count(self, symbol):
        from datetime import date
        today = date.today().isoformat()

        if symbol not in self.daily_entry_count:
            self.daily_entry_count[symbol] = {}

        if today not in self.daily_entry_count[symbol]:
            self.daily_entry_count[symbol][today] = 0

        self.daily_entry_count[symbol][today] += 1

    def _check_loss_cooldown(self, symbol):
        if symbol not in self.loss_cooldown:
            return False, 0

        current_time = datetime.now()
        loss_time_diff = (current_time - self.loss_cooldown[symbol]).total_seconds()

        if loss_time_diff < self.loss_cooldown_duration:
            cooldown_left = self.loss_cooldown_duration - loss_time_diff
            return True, cooldown_left

        return False, 0

    def _execute_screener_trade(self, symbol, side, alert, price, quantity, confidence, trend='neutral'):
        try:
            if not self._is_trading_hours():
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Outside trading hours ({self.trading_start_time}-{self.trading_end_time})[/yellow]")
                return False

            at_limit, entries_today = self._check_daily_entry_limit(symbol)
            if at_limit:
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Daily entry limit reached ({entries_today}/{self.max_daily_entries_per_stock})[/yellow]")
                return False

            in_cooldown, cooldown_left = self._check_loss_cooldown(symbol)
            if in_cooldown:
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Loss cooldown active ({cooldown_left/60:.1f}m left)[/yellow]")
                return False

            live_price = self._get_live_price_from_upstox(symbol)
            if live_price:
                price_diff_pct = abs(live_price - price) / price * 100
                if price_diff_pct > 0.5:
                    console.print(f"[yellow]⚠️ TRADE SKIPPED: {symbol} - Price difference too high: {price_diff_pct:.2f}% (Signal: ₹{price:.2f} vs Live: ₹{live_price:.2f})[/yellow]")
                    return False

                price = live_price

            trade_log_msg = f"SCREENER_ALERT_TRADE: Side={side}, Qty={quantity}, Symbol={symbol}, Price={price:.2f}, Alert={alert['type']}, Confidence={confidence:.2f}"

            print(trade_log_msg)

            volatility_level = self._detect_volatility_level(symbol, price)

            self.positions[symbol] = {
                'side': side,
                'qty': quantity,
                'entry_price': round(price, 2),
                'timestamp': datetime.now(),
                'entry_time': datetime.now(),
                'highest_profit_pct': 0.0,
                'highest_price': round(price, 2),
                'trailing_stop_active': False,
                'volatility': volatility_level,
                'trailing_stop_pct': 0.0,
                'trade_id': self.trade_count + 1,
                'source': 'TV_SCREENER',
                'alert_type': alert['type'],
                'confidence': confidence
            }

            self.trade_count += 1
            self.current_prices[symbol] = round(price, 2)

            self._increment_daily_entry_count(symbol)

            try:
                entry_amount = price * quantity
                entry_charges = self._calculate_trading_charges(entry_amount, 'intraday')
            except Exception:
                entry_charges = 0.0

            pos = self.positions.get(symbol, {})
            pos['entry_charges'] = entry_charges
            pos.setdefault('trailing_stop_active', False)
            pos.setdefault('trailing_stop_pct', 0.0)
            pos.setdefault('highest_profit_pct', 0.0)
            pos.setdefault('highest_price', round(price, 2))
            self.positions[symbol] = pos

            return True

        except Exception as e:
            console.print(f"Trade execution error: {e}")
            return False

    def _get_trading_action(self, alert):
        if alert['type'] == 'VOLUME_SPIKE':
            if alert.get('change', 0) > 0:
                return f"🟢 BUY {alert['ticker']} (Volume Spike + Positive Move)"
            elif alert.get('change', 0) < -2:
                return f"🔴 SELL {alert['ticker']} (Volume Spike + Strong Drop)"
            else:
                return f"⏳ MONITOR {alert['ticker']} (Volume Spike - Unclear Direction)"

        elif alert['type'] == 'PRICE_MOVE':
            if alert.get('current_change', 0) > 2:
                return f"🟢 BUY {alert['ticker']} (Strong Upward Move)"
            elif alert.get('current_change', 0) < -2:
                return f"🔴 SELL {alert['ticker']} (Strong Downward Move)"
            else:
                return f"⏳ MONITOR {alert['ticker']} (Price Move - Moderate)"

        return f"⏳ MONITOR {alert['ticker']}"

    def _get_live_price_from_upstox(self, symbol, force_refresh=False):
        try:
            if (hasattr(self, 'realtime_streaming_enabled') and
                self.realtime_streaming_enabled and
                self.upstox_api):

                realtime_price = self.upstox_api.get_realtime_price(symbol)
                if realtime_price:
                    return realtime_price

            if not (hasattr(self, 'upstox_api') and self.upstox_api):
                console.print(f"[dim]ℹ️ No Upstox API available for {symbol}, using fallback price[/dim]")
                return None

            if not hasattr(self, '_symbol_blacklist'):
                self._symbol_blacklist = set()
            if symbol in self._symbol_blacklist:
                return None

            clean_symbol = symbol.strip().upper()

            if ':' in clean_symbol:
                exchange, clean_symbol = clean_symbol.split(':', 1)

            suffixes_to_remove = ['.EQ', '-EQ', 'EQ', '.NS', '.BO', '-NS', '-BO']
            for suffix in suffixes_to_remove:
                if clean_symbol.endswith(suffix):
                    clean_symbol = clean_symbol[:-len(suffix)]
                    break

            if ':' not in symbol.strip().upper():
                exchange = 'NSE'

            price = self._fetch_price_from_exchange(clean_symbol, exchange)

            if price is None:
                fallback_exchange = 'BSE' if exchange == 'NSE' else 'NSE'
                price = self._fetch_price_from_exchange(clean_symbol, fallback_exchange)

                if price is not None:
                    console.print(f"[green]✅ Found {clean_symbol} on {fallback_exchange} (fallback from {exchange})[/green]")
                    self.exchange_fallbacks[symbol] = fallback_exchange
                else:
                    self._symbol_blacklist.add(symbol)
                    console.print(f"[red]❌ Symbol {clean_symbol} not found on NSE or BSE - blacklisting[/red]")

            if price is not None:
                self.current_prices[symbol] = round(price, 2)
                return round(price, 2)

        except Exception as e:
            if not hasattr(self, '_last_error_time'):
                self._last_error_time = {}

            current_time = time_module.time()
            if symbol not in self._last_error_time or current_time - self._last_error_time[symbol] > 60:
                console.print(f"[yellow]⚠️ Failed to get live price for {symbol}: {e}[/yellow]")
                self._last_error_time[symbol] = current_time

        return None

    def _fetch_price_from_exchange(self, symbol, exchange):
        try:
            from datetime import time as dt_time

            now = datetime.now().time()
            market_open = dt_time(9, 15)
            market_close = dt_time(15, 30)

            if not (market_open <= now <= market_close):
                return None

            if not (hasattr(self, 'upstox_api') and self.upstox_api):
                console.print(f"[red]❌ Upstox API unavailable for {symbol} on {exchange} - TSL monitoring affected[/red]")
                return None

            exchange_map = {
                'NSE': 'NSE_EQ',
                'BSE': 'BSE_EQ'
            }

            upstox_exchange = exchange_map.get(exchange, 'NSE_EQ')

            price = self.upstox_api.get_current_price_with_streaming(symbol)

            if price is not None:
                return float(price)

        except Exception as e:
            if "instrument key" in str(e).lower() or "not found" in str(e).lower():
                return None
            else:
                console.print(f"[dim red]⚠️ {exchange} error for {symbol}: {str(e)[:50]}...[/dim red]")

        return None

    def _get_live_prices_batch(self, symbols):
        if not symbols:
            return {}

        if not (hasattr(self, 'upstox_api') and self.upstox_api):
            console.print("[yellow]⚠️ Upstox API unavailable - price fetching disabled[/yellow]")
            return {}

        import concurrent.futures
        from datetime import time

        now = datetime.now().time()
        market_open = time(9, 15)
        market_close = time(15, 30)
        is_market_hours = market_open <= now <= market_close

        if not is_market_hours:
            console.print("[dim]Market closed - price fetching disabled[/dim]")
            return {}

        batch_realtime_prices = self.upstox_api.get_batch_current_prices_with_streaming(symbols)

        if batch_realtime_prices and len(batch_realtime_prices) > 0:
            console.print(f"[green]📡 Real-time streaming: {len(batch_realtime_prices)}/{len(symbols)} symbols[/green]")
            return batch_realtime_prices

        symbols_to_fetch = symbols

        start_time = time_module.time()
        console.print(f"[dim]🔄 Batch fetching {len(symbols_to_fetch)} symbols with {min(5, len(symbols_to_fetch))} threads...[/dim]")

        fetch_params = []
        for symbol in symbols_to_fetch:
            exchange = self.exchange_fallbacks.get(symbol, 'NSE')
            fetch_params.append((symbol, exchange))

        results = {}
        success_count = 0
        error_count = 0

        optimal_threads = min(5, len(symbols_to_fetch))
        with concurrent.futures.ThreadPoolExecutor(max_workers=optimal_threads) as executor:
            future_to_symbol = {
                executor.submit(self._fetch_price_from_exchange, symbol, exchange): (symbol, exchange)
                for symbol, exchange in fetch_params
            }

            for future in concurrent.futures.as_completed(future_to_symbol):
                symbol, exchange = future_to_symbol[future]
                try:
                    price = future.result()
                    if price is not None:
                        results[symbol] = round(price, 2)
                        self.current_prices[symbol] = round(price, 2)
                        success_count += 1

                        if exchange != self.exchange_fallbacks.get(symbol, 'NSE'):
                            self.exchange_fallbacks[symbol] = exchange
                    else:
                        error_count += 1

                except Exception as e:
                    error_count += 1
                    if not hasattr(self, '_batch_error_stats'):
                        self._batch_error_stats = {}

                    error_type = type(e).__name__
                    if error_type not in self._batch_error_stats:
                        self._batch_error_stats[error_type] = 0
                    self._batch_error_stats[error_type] += 1

        end_time = time_module.time()
        duration = end_time - start_time
        throughput = success_count / duration if duration > 0 else 0

        if success_count > 0:
            console.print(f"[dim]✅ Batch complete: {success_count}/{len(symbols_to_fetch)} symbols ({throughput:.1f} symbols/sec)[/dim]")
        if error_count > 0:
            console.print(f"[dim]⚠️ {error_count} symbols had errors[/dim]")
            if hasattr(self, '_batch_error_stats') and error_count > 2:
                error_summary = ", ".join([f"{err}: {count}" for err, count in self._batch_error_stats.items()])
                console.print(f"[dim]🔍 Error types: {error_summary}[/dim]")

        if not hasattr(self, '_batch_performance_stats'):
            self._batch_performance_stats = []

        self._batch_performance_stats.append({
            'timestamp': end_time,
            'symbols_requested': len(symbols_to_fetch),
            'symbols_success': success_count,
            'duration': duration,
            'throughput': throughput
        })

        return results

    def _get_batch_performance_summary(self):
        if not hasattr(self, '_batch_performance_stats') or not self._batch_performance_stats:
            return None

        stats = self._batch_performance_stats
        if len(stats) < 2:
            return None

        total_requests = sum(s['symbols_requested'] for s in stats)
        total_success = sum(s['symbols_success'] for s in stats)
        total_duration = sum(s['duration'] for s in stats)
        avg_throughput = sum(s['throughput'] for s in stats) / len(stats)

        success_rate = (total_success / total_requests * 100) if total_requests > 0 else 0

        avg_time_per_symbol = total_duration / total_success if total_success > 0 else 0

        return {
            'total_batches': len(stats),
            'total_symbols': total_requests,
            'success_rate': success_rate,
            'avg_throughput': avg_throughput,
            'avg_time_per_symbol': avg_time_per_symbol,
            'total_duration': total_duration
        }

    def _process_tv_alerts(self, alerts=None):
        if not self.consider_tv_alerts:
            return

        if alerts is None:
            return
        else:
            alerts_to_process = alerts

        for alert in alerts_to_process:
            symbol = alert.get('symbol', '').strip()
            if not symbol:
                continue

            if (symbol in self.positions and self.positions[symbol]):
                console.print(f"[yellow]⚠️ TV Alert blocked: {symbol} - Already in positions[/yellow]")
                continue
            if symbol in self.sent_alerts:
                console.print(f"[yellow]⚠️ TV Alert blocked: {symbol} - Already in sent alerts[/yellow]")
                continue

            try:
                price = float(alert.get('price', 0))
                if price <= 0:
                    continue

                action = alert.get('action', '').upper()
                side = 'BUY' if action in ['BUY', 'LONG'] else 'SELL'

                position_size = 20000
                quantity = int(position_size / price)

                self.positions[symbol] = {
                    'side': side,
                    'qty': quantity,
                    'entry_price': round(price, 2),
                    'timestamp': datetime.now(),
                    'entry_time': datetime.now(),
                    'highest_profit_pct': 0.0,
                    'highest_price': round(price, 2),
                    'trailing_stop_active': False,
                    'volatility': 'LOW',
                    'trailing_stop_pct': 0.0,
                    'trade_id': self.trade_count + 1,
                    'source': 'TV_ALERT',
                    'alert_type': 'TV_WEBHOOK',
                    'confidence': 1.0
                }

                self.trade_count += 1
                self.current_prices[symbol] = round(price, 2)
                self.sent_alerts.add(symbol)
                self.last_alert_time[symbol] = time_module.time()

                side_emoji = "🟢" if side == 'BUY' else "🔴"
                console.print(f"[green]✅ TV Alert Position: {side_emoji} {symbol} {side} @ {price} (Qty: {quantity})[/green]")

                if self.journal_file:
                    with open(self.journal_file, 'a') as f:
                        f.write(f"TV_ALERT_ENTRY: {symbol} @ {price} Qty:{quantity} Time:{datetime.now()}\n")

            except Exception as e:
                console.print(f"[red]Error processing TV alert for {symbol}: {e}[/red]")

    def start_background_monitoring(self):
        if not self.paper_trading_enabled:
            return

        if self.background_monitor_active:
            console.print("[yellow]⚠️ Background monitoring already active[/yellow]")
            return

        self.background_monitor_active = True
        self.stop_monitoring.clear()
        self.monitor_thread = threading.Thread(target=self._background_monitor_loop, daemon=True)
        self.monitor_thread.start()
        console.print("[green]🔄 Started background live price monitoring[/green]")

    def stop_background_monitoring(self):
        if self.background_monitor_active:
            self.stop_monitoring.set()
            self.background_monitor_active = False
            if self.monitor_thread:
                self.monitor_thread.join(timeout=2.0)

            if (hasattr(self, 'upstox_api') and self.upstox_api and
                hasattr(self.upstox_api, 'stop_realtime_streaming')):
                self.upstox_api.stop_realtime_streaming()

            console.print("[yellow]⏹️ Stopped background monitoring[/yellow]")

    def _background_monitor_loop(self):
        console.print("[dim]🔍 Background monitor started - checking positions every 2 seconds[/dim]")

        while not self.stop_monitoring.wait(2.0):
            try:
                if not self.positions:
                    continue

                active_positions = {k: v for k, v in self.positions.items() if v}
                if not active_positions:
                    continue

                symbols = list(active_positions.keys())
                batch_prices = self._get_live_prices_batch(symbols)

                for symbol, position in active_positions.items():
                    self._monitor_position_risk(symbol, position, batch_prices.get(symbol))

            except Exception as e:
                console.print(f"[red]❌ Error in background monitor: {e}[/red]")
                continue

    def _monitor_position_risk(self, symbol, position, pre_fetched_price=None):
        try:
            live_price = pre_fetched_price or self._get_live_price_from_upstox(symbol, force_refresh=True)
            if not live_price:
                return

            self.current_prices[symbol] = live_price

            entry_price = position['entry_price']
            entry_charges = position.get('entry_charges', 0.0)

            current_value = live_price * position['qty']
            estimated_exit_charges = self._calculate_trading_charges(current_value, 'intraday')

            gross_pnl = (live_price - entry_price) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1

            net_pnl = gross_pnl - entry_charges - estimated_exit_charges
            entry_value = entry_price * position['qty']
            pnl_pct = (net_pnl / entry_value) * 100 if entry_value else 0.0

            is_tv_alert = position.get('source') == 'TV_ALERT'

            if is_tv_alert:
                stop_loss_pct = -0.5
                take_profit_pct = 0.5
            else:
                stop_loss_pct = -0.5
                take_profit_pct = 1.5
            quick_exit_pct = 0.3 if is_tv_alert else 1.0

            trade_duration_minutes = (datetime.now() - position.get('timestamp', datetime.now())).total_seconds() / 60

            ultra_quick_trailing = False
            if trade_duration_minutes <= 3 and pnl_pct >= 0.8:
                ultra_quick_trailing = True
            elif trade_duration_minutes <= 5 and pnl_pct >= 1.0:
                ultra_quick_trailing = True
            elif trade_duration_minutes <= 10 and pnl_pct >= 1.5:
                ultra_quick_trailing = True

            trailing_stop_buffer = self._get_tighter_trailing_buffer(abs(pnl_pct), is_ultra_quick=ultra_quick_trailing, is_tv_alert=is_tv_alert)

            if pnl_pct > position.get('highest_profit_pct', 0.0):
                position['highest_profit_pct'] = pnl_pct
                position['highest_price'] = live_price

            should_exit = False
            exit_reason = ""

            if ultra_quick_trailing and not position.get('trailing_stop_active', False):
                position['trailing_stop_active'] = True
                position['best_profit_pct'] = pnl_pct

                if trade_duration_minutes <= 3:
                    trigger_type = "ULTRA-QUICK"
                elif trade_duration_minutes <= 5:
                    trigger_type = "QUICK"
                else:
                    trigger_type = "FAST"

                console.print(f"[green]🚀 {symbol}: {trigger_type} trailing activated at {pnl_pct:.2f}% in {trade_duration_minutes:.1f}m[/green]")

            elif not position.get('trailing_stop_active', False) and pnl_pct <= stop_loss_pct:
                should_exit = True
                exit_reason = f"STOP LOSS: {pnl_pct:.2f}%"

            elif pnl_pct >= take_profit_pct and not position.get('trailing_stop_active', False):
                position['trailing_stop_active'] = True
                position['trailing_stop_pct'] = pnl_pct - trailing_stop_buffer
                console.print(f"[bold green]🎯 PROGRESSIVE TRAILING STOP ACTIVATED for {symbol} at {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}% | Buffer: {trailing_stop_buffer:.1f}%)[/bold green]")

            elif position.get('trailing_stop_active', False):
                new_trailing_stop = pnl_pct - trailing_stop_buffer
                old_trailing_stop = position.get('trailing_stop_pct', 0.0)

                if new_trailing_stop > old_trailing_stop:
                    position['trailing_stop_pct'] = new_trailing_stop
                    if abs(new_trailing_stop - old_trailing_stop) >= 0.2:
                        console.print(f"[dim green]📈 {symbol} trailing stop tightened: {old_trailing_stop:.2f}% → {new_trailing_stop:.2f}% (Buffer: {trailing_stop_buffer:.1f}%)[/dim green]")

                if pnl_pct <= position['trailing_stop_pct']:
                    should_exit = True
                    exit_reason = f"TRAILING STOP: {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}% | Buffer: {trailing_stop_buffer:.1f}%)"

            elif pnl_pct >= quick_exit_pct and not position.get('trailing_stop_active', False):
                should_exit = True
                exit_reason = f"QUICK EXIT: {pnl_pct:.2f}% (1.0% target)"

            if should_exit:
                self._execute_exit_trade(symbol, position, live_price, exit_reason)

        except Exception as e:
            console.print(f"[red]❌ Error monitoring {symbol}: {e}[/red]")

    def _execute_exit_trade(self, symbol, position, exit_price, reason):
        try:
            exit_amount = exit_price * position['qty']
            exit_charges = self._calculate_trading_charges(exit_amount, 'intraday')

            gross_pnl = (exit_price - position['entry_price']) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1

            total_charges = position.get('entry_charges', 0.0) + exit_charges
            net_pnl = gross_pnl - total_charges
            pnl_amount = net_pnl

            entry_value = position['entry_price'] * position['qty']
            pnl_pct = (net_pnl / entry_value) * 100 if entry_value else 0.0

            exit_log = (f"🔥 AUTO EXIT: {symbol} | "
                        f"{reason} | "
                        f"Entry: ₹{position['entry_price']:.0f} | "
                        f"Exit: ₹{exit_price:.0f} | "
                        f"P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | "
                        f"Charges: ₹{total_charges:.0f}")

            console.print(f"[bold red]{exit_log}[/bold red]")

            exit_side = 'SELL' if position['side'] == 'BUY' else 'BUY'
            self.log_trade("EXIT", symbol, exit_price, position['qty'], exit_amount, reason, pnl_pct, pnl_amount, side=exit_side)

            if "STOP LOSS" in reason:
                self.stop_loss_cooldown[symbol] = datetime.now()
                console.print(f"[dim red]🚫 Added {symbol} to 30-minute stop loss cooldown[/dim red]")

            if pnl_amount < 0:
                self.loss_cooldown[symbol] = datetime.now()
                console.print(f"[dim red]🚫 Added {symbol} to 30-minute loss cooldown (₹{pnl_amount:+,.0f})[/dim red]")

            self.live_trades.append({
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

            self.closed_trades.append({
                'symbol': symbol,
                'entry_side': position['side'],
                'entry_price': position['entry_price'],
                'exit_price': exit_price,
                'quantity': position['qty'],
                'entry_amount': position['entry_price'] * position['qty'],
                'exit_amount': exit_price * position['qty'],
                'pnl_pct': pnl_pct,
                'pnl_amount': pnl_amount,
                'reason': reason,
                'hold_time': datetime.now() - position.get('entry_time', datetime.now())
            })

            self.positions[symbol] = None

        except Exception as e:
            console.print(f"[red]❌ Error executing exit for {symbol}: {e}[/red]")
