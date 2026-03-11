#!/usr/bin/env python3
"""
TV ALERTS ONLY - Pure TradingView Webhook Handler
===============================================

This script handles ONLY TradingView webhook alerts and manages positions.
- No continuous scanning/refreshing
- Receives alerts via webhook and creates positions
- Live bulk price updates for existing positions
- Clean and focused on alert processing only
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

# Add parent directory to path to import config
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import TELEGRAM_CONFIG, UPSTOX_CONFIG

# Import required modules
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

# Try to import Upstox SDK for WebSocket (required for working streaming)
try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
except ImportError:
    UPSTOX_SDK_AVAILABLE = False
    print("⚠️ Install upstox-python-sdk for WebSocket: pip install upstox-python-sdk")

console = Console()

class TVAlertsOnly:
    """Pure TV alerts handler - no scanning, only webhook processing"""

    # Class variable for shutdown coordination
    shutdown_flag = False

    def __init__(self, port=5001, enable_trading=False, position_size=20000):
        self.port = port
        self.enable_trading = enable_trading
        self.position_size = position_size

        # Telegram integration
        self.telegram_enabled = TELEGRAM_CONFIG.get('bot_token') if TELEGRAM_CONFIG else False
        if self.telegram_enabled:
            console.print("[green]✅ Telegram alerts enabled[/green]")
        else:
            console.print("[yellow]⚠️ Telegram alerts disabled - configure TELEGRAM_CONFIG[/yellow]")

        # Upstox API for live prices
        self.upstox_api = None
        self.realtime_streaming_enabled = False

        # WebSocket components (using working approach from tick_by_tick_streamer.py)
        self.websocket_enabled = UPSTOX_SDK_AVAILABLE
        self.market_streamer = None
        self.instrument_keys = {}

        # Always try to initialize Upstox for live price validation
        self._initialize_upstox()

        # Position tracking
        self.positions = {}  # Active positions from TV alerts
        self.current_prices = {}  # Live prices for positions
        self.closed_trades = []  # Completed trades
        self.trade_count = 0

        # Setup logging
        self._setup_logging()

        # Setup signal handlers
        self._setup_signal_handlers()

        # Track start time
        self._start_time = datetime.now()

        # Start webhook server
        self._start_webhook_server()

    def _initialize_upstox(self):
        """Initialize Upstox API for live price validation using new auth system"""
        if not UPSTOX_AVAILABLE:
            console.print("[yellow]⚠️ Upstox API not available - price validation disabled[/yellow]")
            return

        try:
            console.print("[dim]🔑 Initializing Upstox API with cached token...[/dim]")
            self.upstox_api = UpstoxAPI(
                api_key=UPSTOX_CONFIG.get('api_key'),
                api_secret=UPSTOX_CONFIG.get('api_secret')
            )

            # Check authentication - new system loads from cache automatically
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
                # Token loaded from cache - no browser needed!
                token_age = self._get_token_age()
                console.print(f"[green]✅ Token loaded from cache (age: {token_age:.1f}h, no browser needed!)[/green]")

            # Setup real-time streaming using working approach from tick_by_tick_streamer.py
            console.print("[dim]📡 Setting up real-time streaming...[/dim]")
            self.realtime_streaming_enabled = self._setup_realtime_streaming_working()

            if self.realtime_streaming_enabled:
                console.print("[green]✅ Real-time Upstox streaming enabled[/green]")
                # Start the WebSocket streaming
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
        """Get token age in hours"""
        try:
            import json
            from pathlib import Path
            token_file = Path(__file__).resolve().parent.parent.parent / ".upstox_token.json"
            if token_file.exists():
                with open(token_file) as f:
                    data = json.load(f)
                    from datetime import datetime
                    ts = datetime.fromisoformat(data['timestamp'])
                    return (datetime.now() - ts).total_seconds() / 3600
        except:
            pass
        return 0.0

    def _setup_realtime_streaming(self) -> bool:
        """Setup real-time streaming using working WebSocket approach from tick_by_tick_streamer.py"""
        if not self.upstox_api:
            console.print("[red]❌ Cannot setup streaming - Upstox API not initialized[/red]")
            return False

        if not self.websocket_enabled:
            console.print("[red]❌ WebSocket not available - install upstox-python-sdk[/red]")
            return False

        # Check if market is open (9:15 AM - 3:30 PM IST)
        if not self._is_market_open():
            console.print("[yellow]⚠️ Market is closed - WebSocket streaming may not work[/yellow]")
            console.print("[dim]💡 NSE trading hours: 9:15 AM - 3:30 PM IST[/dim]")
            # Continue anyway, as some data might still be available

        try:
            console.print("[dim]🔗 Setting up WebSocket streaming...[/dim]")

            # Get access token from existing API client
            access_token = self.upstox_api.auth_handler.access_token
            if not access_token:
                console.print("[red]❌ No access token available[/red]")
                return False

            # Setup SDK configuration
            configuration = upstox_client.Configuration()
            configuration.access_token = access_token

            # Get instrument keys for symbols (empty initially, will add as positions are created)
            self.instrument_keys = {}
            instrument_keys_list = []

            # Initialize Market Data Streamer
            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"  # Last Traded Price mode for fastest updates
            )

            # Setup event handlers (using working approach)
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
        """Setup real-time streaming using working approach from tick_by_tick_streamer.py"""
        if not self.upstox_api:
            console.print("[red]❌ Cannot setup streaming - Upstox API not initialized[/red]")
            return False

        if not self.websocket_enabled:
            console.print("[red]❌ WebSocket not available - install upstox-python-sdk[/red]")
            return False

        # Check if market is open (9:15 AM - 3:30 PM IST)
        if not self._is_market_open():
            console.print("[yellow]⚠️ Market is closed - WebSocket streaming may not work[/yellow]")
            console.print("[dim]💡 NSE trading hours: 9:15 AM - 3:30 PM IST[/dim]")
            # Continue anyway, as some data might still be available

        try:
            console.print("[dim]🔗 Setting up WebSocket streaming...[/dim]")

            # Get access token from existing API client
            access_token = self.upstox_api.auth_handler.access_token
            if not access_token:
                console.print("[red]❌ No access token available[/red]")
                return False

            # Setup SDK configuration
            configuration = upstox_client.Configuration()
            configuration.access_token = access_token

            # Start with empty instrument keys list (will add symbols as positions are created)
            self.instrument_keys = {}
            instrument_keys_list = []  # Empty initially, will add symbols dynamically

            # Initialize Market Data Streamer
            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"  # Last Traded Price mode for fastest updates
            )

            # Setup event handlers (using working approach from tick streamer)
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
        """Handle incoming tick data using working approach from tick streamer."""
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']

                for instrument_key, data in feeds.items():
                    # Find which symbol this instrument key belongs to
                    symbol = None
                    for sym, key in self.instrument_keys.items():
                        if key == instrument_key:
                            symbol = sym
                            break

                    if not symbol:
                        continue

                    # Extract price from message
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        new_price = float(data['ltpc']['ltp'])

                        # Update current prices
                        self.current_prices[symbol] = new_price

        except Exception as e:
            console.print(f"[red]❌ Error processing tick update: {e}[/red]")

    def test_streaming_connection(self):
        """Test if streaming connection is working using WebSocket approach"""
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
            # Try to add a test symbol to streaming
            test_symbol = "RELIANCE"
            console.print(f"[dim]🧪 Testing streaming with {test_symbol}...[/dim]")

            # Use the working WebSocket approach
            result = self.add_symbol_to_streaming(test_symbol)

            if result:
                console.print(f"[green]✅ Streaming test successful for {test_symbol}[/green]")
                # Try to start streaming if not already started
                if self.market_streamer:
                    streaming_started = self.start_websocket_streaming()
                    if streaming_started:
                        console.print("[dim]⏳ Waiting 3 seconds for connection...[/dim]")
                        # Wait for connection with timeout
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
        """Check if Indian stock market is currently open."""
        from datetime import datetime, time

        now = datetime.now().time()
        market_open = time(9, 15)   # 9:15 AM
        market_close = time(15, 30) # 3:30 PM

        # Check if it's a weekday (Monday-Friday)
        current_weekday = datetime.now().weekday()
        if current_weekday >= 5:  # Saturday or Sunday
            return False

        return market_open <= now <= market_close

    def _on_tick_update(self, message):
        """Handle incoming tick data using working approach."""
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']

                for instrument_key, data in feeds.items():
                    # Find which symbol this instrument key belongs to
                    symbol = None
                    for sym, key in self.instrument_keys.items():
                        if key == instrument_key:
                            symbol = sym
                            break

                    if not symbol:
                        continue

                    # Extract price from message
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        new_price = float(data['ltpc']['ltp'])

                        # Update current prices
                        self.current_prices[symbol] = new_price

        except Exception as e:
            console.print(f"[red]❌ Error processing tick update: {e}[/red]")

    def _on_websocket_open(self):
        """Called when WebSocket connection opens."""
        console.print("[green]🔗 WebSocket connection established![/green]")
        console.print(f"[green]📡 Real-time streaming active for {len(self.instrument_keys)} symbols[/green]")

    def _on_websocket_error(self, error):
        """Called when WebSocket encounters an error."""
        console.print(f"[red]❌ WebSocket error: {error}[/red]")

        # Handle authentication errors (401)
        if hasattr(error, 'status_code') and error.status_code == 401:
            console.print("[yellow]🔑 Access token expired - attempting refresh...[/yellow]")
            self._handle_token_refresh()
        elif "401" in str(error):
            console.print("[yellow]🔑 Access token expired - attempting refresh...[/yellow]")
            self._handle_token_refresh()

    def _on_websocket_close(self, close_status_code, close_msg):
        """Called when WebSocket connection closes."""
        console.print(f"[yellow]🔌 WebSocket connection closed (Code: {close_status_code})[/yellow]")

    def _handle_token_refresh(self):
        """Handle token refresh when WebSocket authentication fails."""
        try:
            console.print("[dim]🔐 Re-authenticating with Upstox...[/dim]")

            # Clear the current token
            self.upstox_api.auth_handler.access_token = None

            # Re-authenticate
            if self.upstox_api.auth_handler.authenticate():
                console.print("[green]✅ Re-authentication successful![/green]")
                # Retry WebSocket connection with new token
                self._retry_websocket_connection()
            else:
                console.print("[red]❌ Re-authentication failed[/red]")

        except Exception as e:
            console.print(f"[red]❌ Token refresh failed: {e}[/red]")

    def _retry_websocket_connection(self):
        """Retry WebSocket connection with fresh token."""
        try:
            console.print("[dim]🔄 Retrying WebSocket connection...[/dim]")

            # Get fresh access token
            access_token = self.upstox_api.auth_handler.access_token
            if not access_token:
                console.print("[red]❌ No access token after refresh[/red]")
                return False

            # Update SDK configuration with new token
            configuration = upstox_client.Configuration()
            configuration.access_token = access_token

            # Recreate API client and streamer with new token
            api_client = upstox_client.ApiClient(configuration)

            # Get current instrument keys
            instrument_keys_list = list(self.instrument_keys.values())

            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"
            )

            # Setup event handlers again
            self.market_streamer.on("message", self._on_tick_update)
            self.market_streamer.on("open", self._on_websocket_open)
            self.market_streamer.on("error", self._on_websocket_error)
            self.market_streamer.on("close", self._on_websocket_close)

            # Start streaming again
            self.market_streamer.connect()
            console.print("[green]✅ WebSocket reconnected successfully![/green]")
            return True

        except Exception as e:
            console.print(f"[red]❌ WebSocket retry failed: {e}[/red]")
            return False

    def add_symbol_to_streaming(self, symbol):
        """Add a symbol to real-time streaming"""
        if not self.websocket_enabled or not self.market_streamer:
            return False

        try:
            # Get instrument key for the symbol
            instrument_key = self.upstox_api.get_instrument_key(symbol)
            if not instrument_key:
                console.print(f"[yellow]⚠️ Could not get instrument key for {symbol}[/yellow]")
                return False

            # Add to our tracking
            self.instrument_keys[symbol] = instrument_key

            # If streamer is already connected, we need to reconnect with new symbol
            # For now, we'll store it and reconnect when needed
            console.print(f"[green]✅ Added {symbol} to streaming queue[/green]")
            return True

        except Exception as e:
            console.print(f"[red]❌ Error adding {symbol} to streaming: {e}[/red]")
            return False

    def start_websocket_streaming(self):
        """Start the WebSocket streaming connection"""
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
        """Stop the WebSocket streaming connection"""
        if self.market_streamer:
            try:
                self.market_streamer.disconnect()
                console.print("[yellow]🛑 WebSocket streaming stopped[/yellow]")
            except Exception as e:
                console.print(f"[red]❌ Error stopping WebSocket streaming: {e}[/red]")

    def _handle_realtime_tick(self, message):
        """Handle real-time tick data"""
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']

                for instrument_key, data in feeds.items():
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        price = float(data['ltpc']['ltp'])

                        # Update our current prices
                        if hasattr(self, 'current_prices'):
                            symbol = self.upstox_api.instrument_to_symbol_map.get(instrument_key)
                            if symbol:
                                self.current_prices[symbol] = price

        except Exception as e:
            pass  # Silent fail for tick processing

    def _setup_logging(self):
        """Setup logging for TV alerts"""
        # Create logs directory if it doesn't exist
        logs_dir = "logs"
        if not os.path.exists(logs_dir):
            os.makedirs(logs_dir)

        # Create log filename with date
        date_str = datetime.now().strftime("%Y-%m-%d")
        self.log_file = f"{logs_dir}/tv_alerts_only_{date_str}.log"

        # Write header if new file
        if not os.path.exists(self.log_file):
            with open(self.log_file, 'w') as f:
                f.write(f"# TV Alerts Only Log - {date_str}\n")
                f.write(f"# Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("# Format: timestamp,symbol,action,price,status\n")

    def _start_webhook_server(self):
        """Start the webhook server for TV alerts"""
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

                # Log every webhook call
                if self.log_file:
                    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    symbol = data.get('symbol', 'UNKNOWN')
                    action = data.get('action', 'UNKNOWN')
                    price = data.get('price', '0')
                    status = 'UNKNOWN'

                    with open(self.log_file, 'a') as f:
                        f.write(f"{timestamp},{symbol},{action},{price},")

                if data and data.get('action', '').upper() in ['BUY', 'LONG']:
                    # Process immediately
                    success = self._process_tv_alert(data)

                    # Log success
                    if self.log_file:
                        with open(self.log_file, 'a') as f:
                            f.write(f"SUCCESS\n")

                    return jsonify({'status': 'success', 'message': 'BUY Alert processed'})

                elif data and data.get('action', '').upper() in ['SELL', 'SHORT']:
                    # Process SELL as short position
                    success = self._process_tv_alert(data)

                    # Log success
                    if self.log_file:
                        with open(self.log_file, 'a') as f:
                            f.write(f"SUCCESS\n")

                    return jsonify({'status': 'success', 'message': 'SELL Alert processed as short position'})
                else:
                    # Log ignored
                    if self.log_file:
                        with open(self.log_file, 'a') as f:
                            f.write(f"IGNORED\n")

                    return jsonify({'status': 'ignored', 'message': 'Not a trading signal'})

            except Exception as e:
                # Log error
                if self.log_file:
                    from datetime import datetime
                    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    with open(self.log_file, 'a') as f:
                        f.write(f"ERROR: {str(e)}\n")

                return jsonify({'status': 'error', 'message': str(e)}), 500

        @self.app.route('/shutdown', methods=['POST'])
        def shutdown():
            """Shutdown endpoint for graceful server stop"""
            self.shutdown_event.set()
            console.print("[yellow]🛑 Shutdown requested via API[/yellow]")
            return jsonify({'status': 'shutting_down'})

        @self.app.route('/health', methods=['GET'])
        def health():
            """Health check endpoint"""
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'positions': len({k: v for k, v in self.positions.items() if v}),
                'uptime': str(datetime.now() - getattr(self, '_start_time', datetime.now()))
            })

        # Start server in background thread with proper shutdown handling
        self.server_thread = threading.Thread(
            target=self._run_server,
            daemon=True
        )
        self.server_thread.start()
        console.print(f"[green]📡 TV Alerts webhook server started on port {self.port}[/green]")
        console.print(f"[green]📡 Ready to receive TradingView alerts![/green]")

    def _run_server(self):
        """Run the Flask server"""
        try:
            self.app.run(host='localhost', port=self.port, debug=False, threaded=True)
        except Exception as e:
            if "Address already in use" in str(e):
                console.print(f"[red]❌ Port {self.port} is already in use. Try a different port with --port[/red]")
            else:
                console.print(f"[red]❌ Server error: {e}[/red]")

    def _process_tv_alert(self, alert_data):
        """Process a single TV alert and create position"""
        try:
            symbol = alert_data.get('symbol', '').strip()
            if not symbol:
                console.print("[red]❌ Alert missing symbol[/red]")
                return False

            # Check if already have position in this symbol
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

            # Validate price against live market price if Upstox available
            if self.upstox_api:
                live_price = self._get_live_price(symbol)
                if live_price:
                    price_diff_pct = abs(live_price - price) / price * 100
                    if price_diff_pct > 2.0:  # More than 2% difference
                        console.print(f"[yellow]⚠️ Large price difference: Alert {price:.2f} vs Live {live_price:.2f} ({price_diff_pct:.2f}%)[/yellow]")
                        # Still use live price for better accuracy
                        price = live_price

            # Calculate quantity
            quantity = max(1, int(self.position_size / price))

            # Create position
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

            # Add to real-time streaming if enabled
            if self.realtime_streaming_enabled and self.websocket_enabled:
                try:
                    # Use the working WebSocket approach
                    if not self.market_streamer:
                        # Start streaming if not already started
                        self.start_websocket_streaming()

                    # Add symbol to streaming
                    self.add_symbol_to_streaming(symbol)
                except Exception as e:
                    console.print(f"[dim yellow]⚠️ Could not add {symbol} to streaming: {e}[/dim yellow]")

            # Send Telegram alert
            self._send_telegram_alert(symbol, side, price, quantity)

            # Log position creation
            side_emoji = "🟢" if side == 'BUY' else "🔴"
            console.print(f"[green]✅ TV Alert Position Created: {side_emoji} {symbol} {side} @ ₹{price:.2f} (Qty: {quantity})[/green]")

            return True

        except Exception as e:
            console.print(f"[red]❌ Error processing TV alert: {e}[/red]")
            return False

    def _get_live_price(self, symbol):
        """Get live price for a symbol"""
        if not self.upstox_api:
            return None

        try:
            # Try real-time price first
            if self.realtime_streaming_enabled:
                realtime_price = self.upstox_api.get_realtime_price(symbol)
                if realtime_price:
                    return realtime_price

            # Fallback to API call
            price = self.upstox_api.get_current_price_with_streaming(symbol)
            return float(price) if price else None

        except Exception as e:
            console.print(f"[dim red]⚠️ Error getting live price for {symbol}: {e}[/dim red]")
            return None

    def _send_telegram_alert(self, symbol, side, price, quantity):
        """Send Telegram alert for new position"""
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

    def start_live_price_monitoring(self):
        """Start live price monitoring for existing positions"""
        if not self.enable_trading:
            console.print("[yellow]⚠️ Trading disabled - live monitoring only[/yellow]")
            return

        console.print("[green]🔄 Starting live price monitoring for positions[/green]")

        # Start background monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitor_positions_loop, daemon=True)
        self.monitor_thread.start()

    def start_live_dashboard(self, refresh_interval=10):
        """Start a live dashboard that refreshes periodically"""
        console.print("[green]📊 Starting live dashboard (refresh every {refresh_interval}s)[/green]")

        # Start dashboard thread
        self.dashboard_thread = threading.Thread(
            target=self._dashboard_loop,
            args=(refresh_interval,),
            daemon=True
        )
        self.dashboard_thread.start()

    def _dashboard_loop(self, refresh_interval):
        """Background loop for refreshing dashboard"""
        console.print("[dim]📊 Live dashboard started - press Ctrl+C to stop auto-refresh[/dim]")

        while not TVAlertsOnly.shutdown_flag:
            try:
                # Clear screen and show updated status
                import os
                os.system('clear' if os.name == 'posix' else 'cls')

                self.display_status()

                # Wait for refresh interval
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

                # Get active positions
                active_positions = {k: v for k, v in self.positions.items() if v}
                if not active_positions:
                    time_module.sleep(5)
                    continue

                # Batch fetch prices for all positions
                symbols = list(active_positions.keys())
                batch_prices = self._get_batch_live_prices(symbols)

                # Update current prices and check for exits
                for symbol, position in active_positions.items():
                    current_price = batch_prices.get(symbol) or self._get_live_price(symbol)
                    if current_price:
                        self.current_prices[symbol] = current_price
                        self._check_position_exit(symbol, position, current_price)

                time_module.sleep(5)  # Check every 5 seconds

            except Exception as e:
                console.print(f"[red]❌ Error in position monitoring: {e}[/red]")
                time_module.sleep(5)

    def _get_batch_live_prices(self, symbols):
        """Get live prices for multiple symbols using batch API (up to 500 at once)"""
        if not self.upstox_api or not symbols:
            return {}

        try:
            # Try real-time streaming first if enabled
            if self.realtime_streaming_enabled:
                batch_prices = self.upstox_api.get_batch_current_prices_with_streaming(symbols)
                if batch_prices:
                    return batch_prices

            # Use batch API with ISIN format (working approach from fetch_live_prices.py)
            console.print(f"[dim]📊 Fetching batch prices for {len(symbols)} symbols...[/dim]")

            # Map symbols to ISINs
            symbol_to_isin = {}
            isins = []

            for symbol in symbols:
                try:
                    # Get instrument key (ISIN format)
                    instrument_key = self.upstox_api.get_instrument_key(symbol)
                    if instrument_key:
                        isins.append(instrument_key)
                        symbol_to_isin[instrument_key] = symbol
                except Exception as e:
                    console.print(f"[dim yellow]⚠️ Could not get ISIN for {symbol}: {e}[/dim yellow]")

            if not isins:
                console.print("[yellow]⚠️ No valid ISINs found for batch fetch[/yellow]")
                return {}

            # Make batch API call (supports up to 500 symbols)
            symbols_str = ",".join(isins)
            url = f"https://api.upstox.com/v2/market-quote/ltp?symbol={symbols_str}"
            headers = self.upstox_api.auth_handler.get_headers()

            response = requests.get(url, headers=headers, timeout=15)

            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success':
                    # Parse response and map back to symbols
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
                # Retry once
                return self._get_batch_live_prices(symbols)
            else:
                console.print(f"[yellow]⚠️ Batch API returned {response.status_code}[/yellow]")

            # Fallback to individual calls if batch failed
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

            # Calculate P&L percentage
            if side == 'BUY':
                pnl_pct = (current_price - entry_price) / entry_price * 100
            else:  # SELL
                pnl_pct = (entry_price - current_price) / entry_price * 100

            # Simple exit strategy: 1% stop loss, 2% take profit
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
            # Calculate P&L
            entry_price = position['entry_price']
            quantity = position['qty']
            side = position['side']

            if side == 'BUY':
                pnl_amount = (exit_price - entry_price) * quantity
            else:  # SELL
                pnl_amount = (entry_price - exit_price) * quantity

            pnl_pct = pnl_amount / (entry_price * quantity) * 100

            # Log exit
            side_emoji = "🟢" if side == 'BUY' else "🔴"
            console.print(f"[bold red]🔥 POSITION EXIT: {symbol} | {reason} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})[/bold red]")

            # Add to closed trades
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

            # Remove from active positions
            self.positions[symbol] = None

            # Send Telegram alert
            self._send_exit_telegram_alert(symbol, side, entry_price, exit_price, pnl_pct, pnl_amount, reason)

        except Exception as e:
            console.print(f"[red]❌ Error exiting position {symbol}: {e}[/red]")

    def _send_exit_telegram_alert(self, symbol, side, entry_price, exit_price, pnl_pct, pnl_amount, reason):
        """Send Telegram alert for position exit"""
        if not self.telegram_enabled:
            return

        try:
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

    def display_status(self):
        """Display current status of positions and server with rich tables"""
        from rich.table import Table
        from rich.panel import Panel
        from rich.layout import Layout
        from rich.columns import Columns

        console.print(f"\n[bold blue]📡 TV Alerts Only - Live Trading Dashboard[/bold blue]")

        # Server Status Panel
        server_alive = self.server_thread.is_alive() if hasattr(self, 'server_thread') else False
        status_text = f"""
🌐 Server: {'🟢 RUNNING' if server_alive else '🔴 STOPPED'}
📡 Port: {self.port}
🔗 Health: http://localhost:{self.port}/health
💰 Trading: {'🟢 ENABLED' if self.enable_trading else '🔴 DISABLED'}
📈 Upstox: {'🟢 CONNECTED' if self.upstox_api else '🔴 DISCONNECTED'}
📡 Streaming: {'🟢 ACTIVE' if self.realtime_streaming_enabled else '🔴 INACTIVE'}
📱 Telegram: {'🟢 ENABLED' if self.telegram_enabled else '🔴 DISABLED'}
📊 Total Trades: {self.trade_count}
⏰ Uptime: {datetime.now() - self._start_time}
        """
        console.print(Panel(status_text.strip(), title="🖥️ System Status", border_style="blue"))

        # Show streaming diagnostics if Upstox is connected but streaming is inactive
        if self.upstox_api and not self.realtime_streaming_enabled:
            console.print(f"\n[dim yellow]💡 Streaming Tips:[/dim yellow]")
            console.print(f"[dim]• Check your UPSTOX_CONFIG credentials[/dim]")
            console.print(f"[dim]• Ensure stable internet connection[/dim]")
            console.print(f"[dim]• Verify API permissions and limits[/dim]")
            console.print(f"[dim]• Try restarting if issue persists[/dim]")

        # Show active positions in a rich table
        active_positions = {k: v for k, v in self.positions.items() if v}
        if active_positions:
            # Create positions table
            positions_table = Table(title=f"📊 Active Positions ({len(active_positions)})", show_header=True, header_style="bold magenta")
            positions_table.add_column("Symbol", style="cyan", no_wrap=True, width=12)
            positions_table.add_column("Side", style="bold", justify="center", width=6)
            positions_table.add_column("Entry Price", justify="right", style="yellow", width=12)
            positions_table.add_column("Current Price", justify="right", style="green", width=12)
            positions_table.add_column("Quantity", justify="right", style="blue", width=8)
            positions_table.add_column("P&L %", justify="right", width=8)
            positions_table.add_column("P&L Amount", justify="right", width=12)
            positions_table.add_column("Value", justify="right", style="white", width=12)
            positions_table.add_column("Time", justify="center", style="dim", width=8)

            for symbol, position in active_positions.items():
                current_price = self.current_prices.get(symbol, position['entry_price'])
                entry_price = position['entry_price']
                quantity = position['qty']
                side = position['side']

                # Calculate P&L
                if side == 'BUY':
                    pnl_pct = (current_price - entry_price) / entry_price * 100
                    pnl_amount = (current_price - entry_price) * quantity
                else:  # SELL
                    pnl_pct = (entry_price - current_price) / entry_price * 100
                    pnl_amount = (entry_price - current_price) * quantity

                # Format values
                side_emoji = "🟢" if side == 'BUY' else "🔴"
                side_display = f"{side_emoji} {side}"

                # Color coding for P&L
                pnl_color = "green" if pnl_pct >= 0 else "red"
                pnl_display = f"[{pnl_color}]{pnl_pct:+.2f}%[/{pnl_color}]"
                pnl_amount_display = f"[{pnl_color}]₹{pnl_amount:+,.0f}[/{pnl_color}]"

                # Entry time
                entry_time = position['entry_time'].strftime('%H:%M:%S')

                # Current price with color
                current_color = "green" if current_price >= entry_price else "red"
                current_display = f"[{current_color}]₹{current_price:.2f}[/{current_color}]"

                # Position value
                position_value = current_price * quantity
                value_display = f"₹{position_value:,.0f}"

                positions_table.add_row(
                    symbol,
                    side_display,
                    f"₹{entry_price:.2f}",
                    current_display,
                    f"{quantity:,}",
                    pnl_display,
                    pnl_amount_display,
                    value_display,
                    entry_time
                )

            console.print(positions_table)

            # Summary stats
            total_invested = sum(pos['entry_price'] * pos['qty'] for pos in active_positions.values())
            total_current = sum(self.current_prices.get(sym, pos['entry_price']) * pos['qty']
                              for sym, pos in active_positions.items())
            total_pnl = total_current - total_invested
            total_pnl_pct = (total_pnl / total_invested * 100) if total_invested > 0 else 0

            summary_color = "green" if total_pnl >= 0 else "red"
            summary_text = f"""
💰 Total Invested: ₹{total_invested:,.0f}
📈 Current Value: ₹{total_current:,.0f}
📊 Total P&L: [{summary_color}]₹{total_pnl:+,.0f} ({total_pnl_pct:+.2f}%)[/{summary_color}]
            """
            console.print(Panel(summary_text.strip(), title="📈 Portfolio Summary", border_style=summary_color))
        else:
            console.print(Panel("📊 No active positions\n\n[dim]Waiting for TradingView alerts...[/dim]",
                              title="📊 Active Positions", border_style="yellow"))

        # Show recent closed trades in a table
        if self.closed_trades:
            recent_trades = self.closed_trades[-10:]  # Last 10 trades

            trades_table = Table(title=f"📈 Recent Trades ({len(recent_trades)})", show_header=True, header_style="bold yellow")
            trades_table.add_column("Symbol", style="cyan", no_wrap=True, width=10)
            trades_table.add_column("Side", style="bold", justify="center", width=6)
            trades_table.add_column("Entry", justify="right", style="yellow", width=10)
            trades_table.add_column("Exit", justify="right", style="green", width=10)
            trades_table.add_column("P&L %", justify="right", width=8)
            trades_table.add_column("P&L Amount", justify="right", width=10)
            trades_table.add_column("Reason", style="dim", width=15)
            trades_table.add_column("Hold Time", justify="center", width=10)

            for trade in recent_trades:
                pnl_emoji = "🟢" if trade['pnl_pct'] > 0 else "🔴"
                side_emoji = "🟢" if trade['entry_side'] == 'BUY' else "🔴"

                pnl_color = "green" if trade['pnl_pct'] > 0 else "red"
                pnl_display = f"[{pnl_color}]{trade['pnl_pct']:+.2f}%[/{pnl_color}]"
                pnl_amount_display = f"[{pnl_color}]₹{trade['pnl_amount']:+,.0f}[/{pnl_color}]"

                # Format hold time
                hold_time = trade['hold_time']
                if hold_time.total_seconds() < 3600:  # Less than 1 hour
                    hold_display = f"{hold_time.total_seconds()/60:.0f}m"
                else:
                    hold_display = f"{hold_time.total_seconds()/3600:.1f}h"

                trades_table.add_row(
                    trade['symbol'],
                    f"{side_emoji} {trade['entry_side']}",
                    f"₹{trade['entry_price']:.2f}",
                    f"₹{trade['exit_price']:.2f}",
                    pnl_display,
                    pnl_amount_display,
                    trade['reason'],
                    hold_display
                )

            console.print(trades_table)

        # Show live market status
        market_status = "🟢 MARKET OPEN" if self._is_market_open() else "🔴 MARKET CLOSED"
        console.print(f"\n[dim]Market Status: {market_status} | Last Updated: {datetime.now().strftime('%H:%M:%S')}[/dim]")

    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown"""
        try:
            signal.signal(signal.SIGINT, self._signal_handler)
            signal.signal(signal.SIGTERM, self._signal_handler)
            atexit.register(self._cleanup_on_exit)
        except Exception:
            pass

    def _signal_handler(self, signum=None, _frame=None):
        """Handle shutdown signals"""
        TVAlertsOnly.shutdown_flag = True
        console.print(f"\n[bold yellow]🛑 Shutting down...[/bold yellow]")
        
        # Force exit immediately
        import os
        os._exit(0)

    def _cleanup_on_exit(self):
        """Cleanup function called on exit"""
        console.print("[yellow]👋 Shutting down TV Alerts Only...[/yellow]")

        # Stop real-time streaming if active
        if self.realtime_streaming_enabled and self.websocket_enabled:
            try:
                self.stop_websocket_streaming()
            except Exception as e:
                console.print(f"[red]❌ Error stopping streaming: {e}[/red]")

        # Stop Flask server
        if hasattr(self, 'server') and self.server:
            try:
                console.print("[dim]🛑 Stopping Flask server...[/dim]")
                self.server.shutdown()
            except Exception as e:
                console.print(f"[red]❌ Error stopping Flask server: {e}[/red]")

        # Exit all positions
        self._exit_all_positions("SHUTDOWN")

        console.print("[yellow]✅ Shutdown complete[/yellow]")

    def _exit_all_positions(self, reason="SHUTDOWN"):
        """Exit all positions on shutdown"""
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

def main():
    """Main function"""
    console.print("[bold green]🚀 TV ALERTS ONLY - Starting...[/bold green]")
    console.print("[dim]Pure TradingView webhook handler - no scanning, only alerts[/dim]")

    # Parse command line arguments
    import argparse
    parser = argparse.ArgumentParser(description='TV Alerts Only - Pure webhook handler')
    parser.add_argument('--port', type=int, default=5001, help='Webhook server port (default: 5001)')
    parser.add_argument('--trading', action='store_true', help='Enable position management and exits')
    parser.add_argument('--position-size', type=float, default=20000, help='Position size in rupees (default: 20000)')
    parser.add_argument('--test-streaming', action='store_true', help='Test Upstox streaming connection and exit')
    parser.add_argument('--dashboard', action='store_true', help='Start live dashboard with auto-refresh')
    parser.add_argument('--refresh', type=int, default=10, help='Dashboard refresh interval in seconds (default: 10)')
    parser.add_argument('--status', action='store_true', help='Show current status and exit')

    args = parser.parse_args()

    # Test streaming connection if requested
    if args.test_streaming:
        console.print("[bold blue]🧪 Testing Upstox Streaming Connection...[/bold blue]")
        tv_handler = TVAlertsOnly(port=args.port, enable_trading=args.trading, position_size=args.position_size)
        success = tv_handler.test_streaming_connection()
        if success:
            console.print("[green]✅ Streaming test passed![/green]")
            console.print("[dim]Streaming is working correctly![/dim]")
        else:
            console.print("[red]❌ Streaming test failed![/red]")
            console.print("[red]💡 Check credentials and network connection[/red]")

        # Set shutdown flag and cleanup
        TVAlertsOnly.shutdown_flag = True

        console.print("[yellow]👋 Test complete - shutting down...[/yellow]")
        # Cleanup before exit
        try:
            tv_handler._cleanup_on_exit()
        except:
            pass

        # Exit cleanly
        import sys
        sys.exit(0)

    # Create and start the TV alerts handler
    tv_handler = TVAlertsOnly(
        port=args.port,
        enable_trading=args.trading,
        position_size=args.position_size
    )

    # Show status only and exit
    if args.status:
        tv_handler.display_status()
        import sys
        sys.exit(0)

    # Start live monitoring if trading is enabled
    if args.trading:
        tv_handler.start_live_price_monitoring()

    # Start live dashboard if requested
    if args.dashboard:
        tv_handler.start_live_dashboard(refresh_interval=args.refresh)
    else:
        # Display initial status
        tv_handler.display_status()

    # Keep the main thread alive
    try:
        while not TVAlertsOnly.shutdown_flag:
            time_module.sleep(1)
    except KeyboardInterrupt:
        console.print("\n[yellow]👋 Goodbye![/yellow]")
    
    # Exit
    import os
    os._exit(0)

if __name__ == "__main__":
    main()