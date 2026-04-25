#!/usr/bin/env python3
"""
TV Alerts Scanner - Position monitoring and batch price fetching
"""

import time as time_module
import threading
from datetime import datetime
from rich.console import Console
import requests

console = Console()


def start_live_price_monitoring(self):
    """Start live price monitoring for existing positions"""
    if not self.enable_trading:
        console.print("[yellow]⚠️ Trading disabled - live monitoring only[/yellow]")
        return

    console.print("[green]🔄 Starting live price monitoring for positions[/green]")

    self.monitor_thread = threading.Thread(target=self._monitor_positions_loop, daemon=True)
    self.monitor_thread.start()


def start_live_dashboard(self, refresh_interval=10):
    """Start a live dashboard that refreshes periodically"""
    console.print(f"[green]📊 Starting live dashboard (refresh every {refresh_interval}s)[/green]")

    self.dashboard_thread = threading.Thread(
        target=_dashboard_loop,
        args=(self, refresh_interval),
        daemon=True
    )
    self.dashboard_thread.start()


def _dashboard_loop(self, refresh_interval):
    """Background loop for refreshing dashboard"""
    console.print("[dim]📊 Live dashboard started - press Ctrl+C to stop auto-refresh[/dim]")

    while not TVAlertsOnly.shutdown_flag:
        try:
            import os
            os.system('clear' if os.name == 'posix' else 'cls')

            self.display_status()

            for _ in range(refresh_interval):
                if TVAlertsOnly.shutdown_flag:
                    break
                time_module.sleep(1)

        except KeyboardInterrupt:
            break
        except Exception as e:
            console.print(f"[red]❌ Dashboard refresh error: {e}[/red]")
            time_module.sleep(5)


def _monitor_positions_loop(self):
    """Background loop for monitoring positions"""
    console.print("[dim]🔍 Position monitoring started - checking every 5 seconds[/dim]")

    while not TVAlertsOnly.shutdown_flag:
        try:
            if not self.positions:
                time_module.sleep(5)
                continue

            active_positions = {k: v for k, v in self.positions.items() if v}
            if not active_positions:
                time_module.sleep(5)
                continue

            symbols = list(active_positions.keys())
            batch_prices = self._get_batch_live_prices(symbols)

            for symbol, position in active_positions.items():
                current_price = batch_prices.get(symbol) or self._get_live_price(symbol)
                if current_price:
                    self.current_prices[symbol] = current_price
                    self._check_position_exit(symbol, position, current_price)

            time_module.sleep(5)

        except Exception as e:
            console.print(f"[red]❌ Error in position monitoring: {e}[/red]")
            time_module.sleep(5)


def _get_batch_live_prices(self, symbols):
    """Get live prices for multiple symbols using batch API (up to 500 at once)"""
    if not self.upstox_api or not symbols:
        return {}

    try:
        if self.realtime_streaming_enabled:
            batch_prices = self.upstox_api.get_batch_current_prices_with_streaming(symbols)
            if batch_prices:
                return batch_prices

        console.print(f"[dim]📊 Fetching batch prices for {len(symbols)} symbols...[/dim]")

        symbol_to_isin = {}
        isins = []

        for symbol in symbols:
            try:
                instrument_key = self.upstox_api.get_instrument_key(symbol)
                if instrument_key:
                    isins.append(instrument_key)
                    symbol_to_isin[instrument_key] = symbol
            except Exception as e:
                console.print(f"[dim yellow]⚠️ Could not get ISIN for {symbol}: {e}[/dim yellow]")

        if not isins:
            console.print("[yellow]⚠️ No valid ISINs found for batch fetch[/yellow]")
            return {}

        symbols_str = ",".join(isins)
        url = f"https://api.upstox.com/v2/market-quote/ltp?symbol={symbols_str}"
        headers = self.upstox_api.auth_handler.get_headers()

        response = requests.get(url, headers=headers, timeout=15)

        if response.status_code == 200:
            data = response.json()
            if data.get('status') == 'success':
                prices = {}
                for response_key, info in data['data'].items():
                    instrument_token = info.get('instrument_token', '')
                    if instrument_token in symbol_to_isin:
                        symbol = symbol_to_isin[instrument_token]
                        prices[symbol] = float(info['last_price'])

                console.print(f"[dim green]✅ Fetched {len(prices)} prices in batch[/dim green]")
                return prices
            else:
                console.print(f"[yellow]⚠️ Batch API error: {data.get('message', 'Unknown')}[/yellow]")
        elif response.status_code == 401:
            console.print("[yellow]🔑 Token expired, refreshing...[/yellow]")
            self.upstox_api.auth_handler.refresh_token()
            return self._get_batch_live_prices(symbols)
        else:
            console.print(f"[yellow]⚠️ Batch API returned {response.status_code}[/yellow]")

        console.print("[dim]📊 Falling back to individual price fetches...[/dim]")
        prices = {}
        for symbol in symbols:
            price = self._get_live_price(symbol)
            if price:
                prices[symbol] = price

        return prices

    except Exception as e:
        console.print(f"[red]❌ Error in batch price fetch: {e}[/red]")
        return {}


def _check_position_exit(self, symbol, position, current_price):
    """Check if position should be exited based on simple strategy"""
    try:
        entry_price = position['entry_price']
        side = position['side']

        if side == 'BUY':
            pnl_pct = (current_price - entry_price) / entry_price * 100
        else:
            pnl_pct = (entry_price - current_price) / entry_price * 100

        stop_loss_pct = -1.0
        take_profit_pct = 2.0

        should_exit = False
        reason = ""

        if pnl_pct <= stop_loss_pct:
            should_exit = True
            reason = f"STOP LOSS: {pnl_pct:.2f}%"
        elif pnl_pct >= take_profit_pct:
            should_exit = True
            reason = f"TAKE PROFIT: {pnl_pct:.2f}%"

        if should_exit:
            self._exit_position(symbol, position, current_price, reason)

    except Exception as e:
        console.print(f"[red]❌ Error checking position exit for {symbol}: {e}[/red]")


def _exit_position(self, symbol, position, exit_price, reason):
    """Exit a position"""
    try:
        entry_price = position['entry_price']
        quantity = position['qty']
        side = position['side']

        if side == 'BUY':
            pnl_amount = (exit_price - entry_price) * quantity
        else:
            pnl_amount = (entry_price - exit_price) * quantity

        pnl_pct = pnl_amount / (entry_price * quantity) * 100

        side_emoji = "🟢" if side == 'BUY' else "🔴"
        console.print(f"[bold red]🔥 POSITION EXIT: {symbol} | {reason} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})[/bold red]")

        self.closed_trades.append({
            'symbol': symbol,
            'entry_side': side,
            'entry_price': entry_price,
            'exit_price': exit_price,
            'quantity': quantity,
            'pnl_pct': pnl_pct,
            'pnl_amount': pnl_amount,
            'reason': reason,
            'hold_time': datetime.now() - position['entry_time']
        })

        self.positions[symbol] = None

        self._send_exit_telegram_alert(symbol, side, entry_price, exit_price, pnl_pct, pnl_amount, reason)

    except Exception as e:
        console.print(f"[red]❌ Error exiting position {symbol}: {e}[/red]")


def _send_exit_telegram_alert(self, symbol, side, entry_price, exit_price, pnl_pct, pnl_amount, reason):
    """Send Telegram alert for position exit"""
    if not self.telegram_enabled:
        return

    try:
        from config import TELEGRAM_CONFIG
        bot_token = TELEGRAM_CONFIG['bot_token']
        chat_id = TELEGRAM_CONFIG['chat_id']

        pnl_emoji = "🟢" if pnl_pct > 0 else "🔴"
        side_emoji = "🟢" if side == 'BUY' else "🔴"

        message = f"🔥 *Position Exited*\n\n"
        message += f"📈 *Symbol:* {symbol}\n"
        message += f"💰 *Side:* {side_emoji} {side}\n"
        message += f"💰 *Entry:* ₹{entry_price:.2f}\n"
        message += f"💰 *Exit:* ₹{exit_price:.2f}\n"
        message += f"📊 *P&L:* {pnl_emoji} {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})\n"
        message += f"📝 *Reason:* {reason}\n"
        message += f"⏰ *Time:* {datetime.now().strftime('%H:%M:%S')}"

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'Markdown'
        }

        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            console.print(f"[green]✅ Exit Telegram alert sent for {symbol}[/green]")
        else:
            console.print(f"[red]⚠️ Exit Telegram alert failed for {symbol}: {response.text}[/red]")

    except Exception as e:
        console.print(f"[red]❌ Error sending exit Telegram alert: {str(e)}[/red]")
