#!/usr/bin/env python3
"""
TV Alerts Core - Pure TradingView Webhook Handler Core
"""

import sys
import os
import time as time_module
import threading
import atexit
import signal
from datetime import datetime, timedelta
from rich.console import Console
import requests

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import TELEGRAM_CONFIG, UPSTOX_CONFIG

try:
    from config_and_utils.free_indian_apis import UpstoxAPI
    UPSTOX_AVAILABLE = True
except ImportError:
    UPSTOX_AVAILABLE = False
    print("⚠️ Upstox API not available")

try:
    import flask
    from flask import Flask, request, jsonify
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False
    print("⚠️ Flask not available - webhook server disabled")

try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
except ImportError:
    UPSTOX_SDK_AVAILABLE = False
    print("⚠️ Install upstox-python-sdk for WebSocket: pip install upstox-python-sdk")

console = Console()


class TVAlertsOnly:
    shutdown_flag = False

    def __init__(self, port=5001, enable_trading=False, position_size=20000):
        self.port = port
        self.enable_trading = enable_trading
        self.position_size = position_size

        self.telegram_enabled = TELEGRAM_CONFIG.get('bot_token') if TELEGRAM_CONFIG else False
        if self.telegram_enabled:
            console.print("[green]✅ Telegram alerts enabled[/green]")
        else:
            console.print("[yellow]⚠️ Telegram alerts disabled - configure TELEGRAM_CONFIG[/yellow]")

        self.upstox_api = None
        self.realtime_streaming_enabled = False

        self.websocket_enabled = UPSTOX_SDK_AVAILABLE
        self.market_streamer = None
        self.instrument_keys = {}

        self._initialize_upstox()

        self.positions = {}
        self.current_prices = {}
        self.closed_trades = []
        self.trade_count = 0

        self._setup_logging()
        self._setup_signal_handlers()

        self._start_time = datetime.now()

        self._start_webhook_server()

    def _initialize_upstox(self):
        if not UPSTOX_AVAILABLE:
            console.print("[yellow]⚠️ Upstox API not available - price validation disabled[/yellow]")
            return

        try:
            console.print("[dim]🔑 Initializing Upstox API with cached token...[/dim]")
            self.upstox_api = UpstoxAPI(
                api_key=UPSTOX_CONFIG.get('api_key'),
                api_secret=UPSTOX_CONFIG.get('api_secret')
            )

            if not self.upstox_api.auth_handler.access_token:
                console.print("[yellow]🔑 No cached token - authenticating (browser will open)...[/yellow]")
                if not self.upstox_api.auth_handler.authenticate():
                    console.print("[red]❌ Upstox authentication failed[/red]")
                    console.print("[red]💡 Please check your UPSTOX_CONFIG credentials[/red]")
                    self.upstox_api = None
                    return
                else:
                    console.print("[green]✅ Upstox authentication successful[/green]")
            else:
                token_age = self._get_token_age()
                console.print(f"[green]✅ Token loaded from cache (age: {token_age:.1f}h, no browser needed!)[/green]")

            console.print("[dim]📡 Setting up real-time streaming...[/dim]")
            self.realtime_streaming_enabled = self._setup_realtime_streaming_working()

            if self.realtime_streaming_enabled:
                console.print("[green]✅ Real-time Upstox streaming enabled[/green]")
                self.start_websocket_streaming()
            else:
                console.print("[yellow]⚠️ Real-time streaming failed - will use batch API calls[/yellow]")
                console.print("[green]✅ Upstox batch price API enabled (up to 500 stocks at once)[/green]")

        except Exception as e:
            console.print(f"[red]❌ Upstox initialization failed: {e}[/red]")
            console.print("[red]💡 Check your UPSTOX_CONFIG credentials and network connection[/red]")
            self.upstox_api = None
            self.realtime_streaming_enabled = False

    def _get_token_age(self):
        try:
            import json
            from pathlib import Path
            token_file = Path(__file__).resolve().parent.parent.parent / ".upstox_token.json"
            if token_file.exists():
                with open(token_file) as f:
                    data = json.load(f)
                    ts = datetime.fromisoformat(data['timestamp'])
                    return (datetime.now() - ts).total_seconds() / 3600
        except:
            pass
        return 0.0

    def _setup_realtime_streaming(self) -> bool:
        if not self.upstox_api:
            console.print("[red]❌ Cannot setup streaming - Upstox API not initialized[/red]")
            return False

        if not self.websocket_enabled:
            console.print("[red]❌ WebSocket not available - install upstox-python-sdk[/red]")
            return False

        if not self._is_market_open():
            console.print("[yellow]⚠️ Market is closed - WebSocket streaming may not work[/yellow]")
            console.print("[dim]💡 NSE trading hours: 9:15 AM - 3:30 PM IST[/dim]")

        try:
            console.print("[dim]🔗 Setting up WebSocket streaming...[/dim]")

            access_token = self.upstox_api.auth_handler.access_token
            if not access_token:
                console.print("[red]❌ No access token available[/red]")
                return False

            configuration = upstox_client.Configuration()
            configuration.access_token = access_token

            self.instrument_keys = {}
            instrument_keys_list = []

            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"
            )

            self.market_streamer.on("message", self._on_tick_update)
            self.market_streamer.on("open", self._on_websocket_open)
            self.market_streamer.on("error", self._on_websocket_error)
            self.market_streamer.on("close", self._on_websocket_close)

            console.print("[green]✅ WebSocket streaming setup complete[/green]")
            return True

        except Exception as e:
            console.print(f"[red]❌ WebSocket setup failed: {e}[/red]")
            console.print("[red]💡 This might be due to network issues or API limits[/red]")
            return False

    def _setup_realtime_streaming_working(self) -> bool:
        if not self.upstox_api:
            console.print("[red]❌ Cannot setup streaming - Upstox API not initialized[/red]")
            return False

        if not self.websocket_enabled:
            console.print("[red]❌ WebSocket not available - install upstox-python-sdk[/red]")
            return False

        if not self._is_market_open():
            console.print("[yellow]⚠️ Market is closed - WebSocket streaming may not work[/yellow]")
            console.print("[dim]💡 NSE trading hours: 9:15 AM - 3:30 PM IST[/dim]")

        try:
            console.print("[dim]🔗 Setting up WebSocket streaming...[/dim]")

            access_token = self.upstox_api.auth_handler.access_token
            if not access_token:
                console.print("[red]❌ No access token available[/red]")
                return False

            configuration = upstox_client.Configuration()
            configuration.access_token = access_token

            self.instrument_keys = {}
            instrument_keys_list = []

            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"
            )

            self.market_streamer.on("message", self._on_tick_update_working)
            self.market_streamer.on("open", self._on_websocket_open)
            self.market_streamer.on("error", self._on_websocket_error)
            self.market_streamer.on("close", self._on_websocket_close)

            console.print("[green]✅ WebSocket streaming setup complete (ready for dynamic symbol addition)[/green]")
            return True

        except Exception as e:
            console.print(f"[red]❌ WebSocket setup failed: {e}[/red]")
            console.print("[red]💡 This might be due to network issues or API limits[/red]")
            return False

    def _on_tick_update_working(self, message):
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']

                for instrument_key, data in feeds.items():
                    symbol = None
                    for sym, key in self.instrument_keys.items():
                        if key == instrument_key:
                            symbol = sym
                            break

                    if not symbol:
                        continue

                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        new_price = float(data['ltpc']['ltp'])
                        self.current_prices[symbol] = new_price

        except Exception as e:
            console.print(f"[red]❌ Error processing tick update: {e}[/red]")

    def test_streaming_connection(self):
        if not self.upstox_api:
            console.print("[red]❌ Cannot test streaming - Upstox API not initialized[/red]")
            return False

        if not self.websocket_enabled:
            console.print("[red]❌ WebSocket not available - install upstox-python-sdk[/red]")
            return False

        if not self.realtime_streaming_enabled:
            console.print("[yellow]⚠️ Streaming not enabled - trying to enable now...[/yellow]")
            self.realtime_streaming_enabled = self._setup_realtime_streaming()
            if not self.realtime_streaming_enabled:
                return False

        try:
            test_symbol = "RELIANCE"
            console.print(f"[dim]🧪 Testing streaming with {test_symbol}...[/dim]")

            result = self.add_symbol_to_streaming(test_symbol)

            if result:
                console.print(f"[green]✅ Streaming test successful for {test_symbol}[/green]")
                if self.market_streamer:
                    streaming_started = self.start_websocket_streaming()
                    if streaming_started:
                        console.print("[dim]⏳ Waiting 3 seconds for connection...[/dim]")
                        start_wait = time_module.time()
                        while time_module.time() - start_wait < 3:
                            if TVAlertsOnly.shutdown_flag:
                                return False
                            time_module.sleep(0.1)
                        return True
                return True
            else:
                console.print(f"[yellow]⚠️ Could not add {test_symbol} to streaming[/yellow]")
                return False

        except Exception as e:
            console.print(f"[red]❌ Streaming test failed: {e}[/red]")
            return False

    def _is_market_open(self) -> bool:
        from datetime import datetime, time

        now = datetime.now().time()
        market_open = time(9, 15)
        market_close = time(15, 30)

        current_weekday = datetime.now().weekday()
        if current_weekday >= 5:
            return False

        return market_open <= now <= market_close

    def _on_tick_update(self, message):
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']

                for instrument_key, data in feeds.items():
                    symbol = None
                    for sym, key in self.instrument_keys.items():
                        if key == instrument_key:
                            symbol = sym
                            break

                    if not symbol:
                        continue

                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        new_price = float(data['ltpc']['ltp'])
                        self.current_prices[symbol] = new_price

        except Exception as e:
            console.print(f"[red]❌ Error processing tick update: {e}[/red]")

    def _on_websocket_open(self):
        console.print("[green]🔗 WebSocket connection established![/green]")
        console.print(f"[green]📡 Real-time streaming active for {len(self.instrument_keys)} symbols[/green]")

    def _on_websocket_error(self, error):
        console.print(f"[red]❌ WebSocket error: {error}[/red]")

        if hasattr(error, 'status_code') and error.status_code == 401:
            console.print("[yellow]🔑 Access token expired - attempting refresh...[/yellow]")
            self._handle_token_refresh()
        elif "401" in str(error):
            console.print("[yellow]🔑 Access token expired - attempting refresh...[/yellow]")
            self._handle_token_refresh()

    def _on_websocket_close(self, close_status_code, close_msg):
        console.print(f"[yellow]🔌 WebSocket connection closed (Code: {close_status_code})[/yellow]")

    def _handle_token_refresh(self):
        try:
            console.print("[dim]🔐 Re-authenticating with Upstox...[/dim]")

            self.upstox_api.auth_handler.access_token = None

            if self.upstox_api.auth_handler.authenticate():
                console.print("[green]✅ Re-authentication successful![/green]")
                self._retry_websocket_connection()
            else:
                console.print("[red]❌ Re-authentication failed[/red]")

        except Exception as e:
            console.print(f"[red]❌ Token refresh failed: {e}[/red]")

    def _retry_websocket_connection(self):
        try:
            console.print("[dim]🔄 Retrying WebSocket connection...[/dim]")

            access_token = self.upstox_api.auth_handler.access_token
            if not access_token:
                console.print("[red]❌ No access token after refresh[/red]")
                return False

            configuration = upstox_client.Configuration()
            configuration.access_token = access_token

            api_client = upstox_client.ApiClient(configuration)

            instrument_keys_list = list(self.instrument_keys.values())

            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"
            )

            self.market_streamer.on("message", self._on_tick_update)
            self.market_streamer.on("open", self._on_websocket_open)
            self.market_streamer.on("error", self._on_websocket_error)
            self.market_streamer.on("close", self._on_websocket_close)

            self.market_streamer.connect()
            console.print("[green]✅ WebSocket reconnected successfully![/green]")
            return True

        except Exception as e:
            console.print(f"[red]❌ WebSocket retry failed: {e}[/red]")
            return False

    def add_symbol_to_streaming(self, symbol):
        if not self.websocket_enabled or not self.market_streamer:
            return False

        try:
            instrument_key = self.upstox_api.get_instrument_key(symbol)
            if not instrument_key:
                console.print(f"[yellow]⚠️ Could not get instrument key for {symbol}[/yellow]")
                return False

            self.instrument_keys[symbol] = instrument_key

            console.print(f"[green]✅ Added {symbol} to streaming queue[/green]")
            return True

        except Exception as e:
            console.print(f"[red]❌ Error adding {symbol} to streaming: {e}[/red]")
            return False

    def start_websocket_streaming(self):
        if not self.market_streamer:
            console.print("[red]❌ Cannot start streaming - market_streamer not initialized[/red]")
            return False

        try:
            console.print("[dim]🚀 Starting WebSocket streaming...[/dim]")
            self.market_streamer.connect()
            return True
        except Exception as e:
            console.print(f"[red]❌ Error starting WebSocket streaming: {e}[/red]")
            return False

    def stop_websocket_streaming(self):
        if self.market_streamer:
            try:
                self.market_streamer.disconnect()
                console.print("[yellow]🛑 WebSocket streaming stopped[/yellow]")
            except Exception as e:
                console.print(f"[red]❌ Error stopping WebSocket streaming: {e}[/red]")

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

        except Exception as e:
            pass

    def _setup_logging(self):
        logs_dir = "logs"
        if not os.path.exists(logs_dir):
            os.makedirs(logs_dir)

        date_str = datetime.now().strftime("%Y-%m-%d")
        self.log_file = f"{logs_dir}/tv_alerts_only_{date_str}.log"

        if not os.path.exists(self.log_file):
            with open(self.log_file, 'w') as f:
                f.write(f"# TV Alerts Only Log - {date_str}\n")
                f.write(f"# Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("# Format: timestamp,symbol,action,price,status\n")

    def _start_webhook_server(self):
        if not FLASK_AVAILABLE:
            console.print("[red]❌ Flask not available - cannot start webhook server[/red]")
            return

        self.app = Flask(__name__)
        self.server = None
        self.shutdown_event = threading.Event()

        @self.app.route('/webhook', methods=['POST'])
        def webhook_handler():
            try:
                data = request.json
                from datetime import datetime

                if self.log_file:
                    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    symbol = data.get('symbol', 'UNKNOWN')
                    action = data.get('action', 'UNKNOWN')
                    price = data.get('price', '0')
                    status = 'UNKNOWN'

                    with open(self.log_file, 'a') as f:
                        f.write(f"{timestamp},{symbol},{action},{price},")

                if data and data.get('action', '').upper() in ['BUY', 'LONG']:
                    success = self._process_tv_alert(data)

                    if self.log_file:
                        with open(self.log_file, 'a') as f:
                            f.write(f"SUCCESS\n")

                    return jsonify({'status': 'success', 'message': 'BUY Alert processed'})

                elif data and data.get('action', '').upper() in ['SELL', 'SHORT']:
                    success = self._process_tv_alert(data)

                    if self.log_file:
                        with open(self.log_file, 'a') as f:
                            f.write(f"SUCCESS\n")

                    return jsonify({'status': 'success', 'message': 'SELL Alert processed as short position'})
                else:
                    if self.log_file:
                        with open(self.log_file, 'a') as f:
                            f.write(f"IGNORED\n")

                    return jsonify({'status': 'ignored', 'message': 'Not a trading signal'})

            except Exception as e:
                if self.log_file:
                    from datetime import datetime
                    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    with open(self.log_file, 'a') as f:
                        f.write(f"ERROR: {str(e)}\n")

                return jsonify({'status': 'error', 'message': str(e)}), 500

        @self.app.route('/shutdown', methods=['POST'])
        def shutdown():
            self.shutdown_event.set()
            console.print("[yellow]🛑 Shutdown requested via API[/yellow]")
            return jsonify({'status': 'shutting_down'})

        @self.app.route('/health', methods=['GET'])
        def health():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'positions': len({k: v for k, v in self.positions.items() if v}),
                'uptime': str(datetime.now() - getattr(self, '_start_time', datetime.now()))
            })

        self.server_thread = threading.Thread(
            target=self._run_server,
            daemon=True
        )
        self.server_thread.start()
        console.print(f"[green]📡 TV Alerts webhook server started on port {self.port}[/green]")
        console.print(f"[green]📡 Ready to receive TradingView alerts![/green]")

    def _run_server(self):
        try:
            self.app.run(host='localhost', port=self.port, debug=False, threaded=True)
        except Exception as e:
            if "Address already in use" in str(e):
                console.print(f"[red]❌ Port {self.port} is already in use. Try a different port with --port[/red]")
            else:
                console.print(f"[red]❌ Server error: {e}[/red]")

    def _process_tv_alert(self, alert_data):
        try:
            symbol = alert_data.get('symbol', '').strip()
            if not symbol:
                console.print("[red]❌ Alert missing symbol[/red]")
                return False

            if symbol in self.positions and self.positions[symbol]:
                console.print(f"[yellow]⚠️ Already have position in {symbol} - ignoring alert[/yellow]")
                return False

            price = float(alert_data.get('price', 0))
            if price <= 0:
                console.print(f"[red]❌ Invalid price in alert: {price}[/red]")
                return False

            action = alert_data.get('action', '').upper()
            side = 'BUY' if action in ['BUY', 'LONG'] else 'SELL' if action in ['SELL', 'SHORT'] else None

            if not side:
                console.print(f"[red]❌ Invalid action in alert: {action}[/red]")
                return False

            if self.upstox_api:
                live_price = self._get_live_price(symbol)
                if live_price:
                    price_diff_pct = abs(live_price - price) / price * 100
                    if price_diff_pct > 2.0:
                        console.print(f"[yellow]⚠️ Large price difference: Alert {price:.2f} vs Live {live_price:.2f} ({price_diff_pct:.2f}%)[/yellow]")
                        price = live_price

            quantity = max(1, int(self.position_size / price))

            self.positions[symbol] = {
                'side': side,
                'qty': quantity,
                'entry_price': round(price, 2),
                'timestamp': datetime.now(),
                'entry_time': datetime.now(),
                'source': 'TV_ALERT',
                'alert_data': alert_data
            }

            self.trade_count += 1
            self.current_prices[symbol] = round(price, 2)

            if self.realtime_streaming_enabled and self.websocket_enabled:
                try:
                    if not self.market_streamer:
                        self.start_websocket_streaming()

                    self.add_symbol_to_streaming(symbol)
                except Exception as e:
                    console.print(f"[dim yellow]⚠️ Could not add {symbol} to streaming: {e}[/dim yellow]")

            self._send_telegram_alert(symbol, side, price, quantity)

            side_emoji = "🟢" if side == 'BUY' else "🔴"
            console.print(f"[green]✅ TV Alert Position Created: {side_emoji} {symbol} {side} @ ₹{price:.2f} (Qty: {quantity})[/green]")

            return True

        except Exception as e:
            console.print(f"[red]❌ Error processing TV alert: {e}[/red]")
            return False

    def _get_live_price(self, symbol):
        if not self.upstox_api:
            return None

        try:
            if self.realtime_streaming_enabled:
                realtime_price = self.upstox_api.get_realtime_price(symbol)
                if realtime_price:
                    return realtime_price

            price = self.upstox_api.get_current_price_with_streaming(symbol)
            return float(price) if price else None

        except Exception as e:
            console.print(f"[dim red]⚠️ Error getting live price for {symbol}: {e}[/dim red]")
            return None

    def _send_telegram_alert(self, symbol, side, price, quantity):
        if not self.telegram_enabled:
            return

        try:
            bot_token = TELEGRAM_CONFIG['bot_token']
            chat_id = TELEGRAM_CONFIG['chat_id']

            side_emoji = "🟢" if side == 'BUY' else "🔴"
            message = f"📡 *TV Alert Position Created*\n\n"
            message += f"📈 *Symbol:* {symbol}\n"
            message += f"💰 *Side:* {side_emoji} {side}\n"
            message += f"💰 *Price:* ₹{price:.2f}\n"
            message += f"📊 *Quantity:* {quantity}\n"
            message += f"💵 *Value:* ₹{price * quantity:,.0f}\n"
            message += f"⏰ *Time:* {datetime.now().strftime('%H:%M:%S')}"

            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                'chat_id': chat_id,
                'text': message,
                'parse_mode': 'Markdown'
            }

            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                console.print(f"[green]✅ Telegram alert sent for {symbol}[/green]")
            else:
                console.print(f"[red]⚠️ Telegram alert failed for {symbol}: {response.text}[/red]")

        except Exception as e:
            console.print(f"[red]❌ Error sending Telegram alert: {str(e)}[/red]")

    def _setup_signal_handlers(self):
        try:
            signal.signal(signal.SIGINT, self._signal_handler)
            signal.signal(signal.SIGTERM, self._signal_handler)
            atexit.register(self._cleanup_on_exit)
        except Exception:
            pass

    def _signal_handler(self, signum=None, _frame=None):
        TVAlertsOnly.shutdown_flag = True
        console.print(f"\n[bold yellow]🛑 Shutting down...[/bold yellow]")
        
        import os
        os._exit(0)

    def _cleanup_on_exit(self):
        console.print("[yellow]👋 Shutting down TV Alerts Only...[/yellow]")

        if self.realtime_streaming_enabled and self.websocket_enabled:
            try:
                self.stop_websocket_streaming()
            except Exception as e:
                console.print(f"[red]❌ Error stopping streaming: {e}[/red]")

        if hasattr(self, 'server') and self.server:
            try:
                console.print("[dim]🛑 Stopping Flask server...[/dim]")
                self.server.shutdown()
            except Exception as e:
                console.print(f"[red]❌ Error stopping Flask server: {e}[/red]")

        self._exit_all_positions("SHUTDOWN")

        console.print("[yellow]✅ Shutdown complete[/yellow]")

    def _exit_all_positions(self, reason="SHUTDOWN"):
        active_positions = {k: v for k, v in self.positions.items() if v}

        if not active_positions:
            return

        console.print(f"\n[bold red]🚨 EXITING ALL POSITIONS - Reason: {reason}[/bold red]")

        for symbol, position in active_positions.items():
            try:
                current_price = self.current_prices.get(symbol, position['entry_price'])
                self._exit_position(symbol, position, current_price, f"{reason}: Bulk Exit")
            except Exception as e:
                console.print(f"[red]❌ Failed to exit {symbol}: {e}[/red]")
