#!/usr/bin/env python3
"""
TICK-BY-TICK DATA STREAMER
=========================

Real-time tick data streaming using Upstox WebSocket API with existing abstraction layer.
This demonstrates how to get live price updates using the UpstoxAPI class that's already
implemented in the codebase.

Features:
- Uses existing UpstoxAPI authentication abstraction
- Real-time WebSocket streaming for tick data
- Displays live price updates with timestamps
- Handles multiple symbols simultaneously
- Automatic reconnection and error handling
"""

import time
import threading
from datetime import datetime
from typing import Dict, List, Optional
import argparse
import os
import sys

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from config_and_utils.free_indian_apis import UpstoxAPI
    from config import UPSTOX_CONFIG
    UPSTOX_AVAILABLE = True
except ImportError as e:
    print(f"❌ Import error: {e}")
    print("💡 Make sure config.py exists with UPSTOX_CONFIG")
    UPSTOX_AVAILABLE = False

# Try to import Upstox SDK for WebSocket
try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
except ImportError:
    UPSTOX_SDK_AVAILABLE = False
    print("⚠️  Install upstox-python-sdk for WebSocket: pip install upstox-python-sdk")

class TickByTickStreamer:
    """
    Real-time tick data streamer using existing UpstoxAPI abstraction.

    This class demonstrates how to use the existing authentication and
    API abstraction to get live tick-by-tick market data.
    """

    def __init__(self, symbols: List[str], api_key: str, api_secret: str):
        """
        Initialize the tick streamer.

        Args:
            symbols: List of stock symbols to stream (e.g., ['RELIANCE', 'TCS'])
            api_key: Upstox API key
            api_secret: Upstox API secret
        """
        self.symbols = symbols
        self.api_key = api_key
        self.api_secret = api_secret

        # Initialize Upstox API (uses existing abstraction)
        self.upstox_api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=False)

        # WebSocket components
        self.websocket_enabled = UPSTOX_SDK_AVAILABLE
        self.market_streamer = None
        self.instrument_keys = {}

        # Real-time data storage
        self.current_prices = {}
        self.price_history = {}  # Store price history for analysis
        self.update_count = {}
        self.last_update_time = {}

        # Initialize data structures
        for symbol in self.symbols:
            self.current_prices[symbol] = 0.0
            self.price_history[symbol] = []
            self.update_count[symbol] = 0
            self.last_update_time[symbol] = None

        # Control flags
        self.running = False
        self.connected = False

    def authenticate(self) -> bool:
        """Authenticate using existing UpstoxAPI abstraction."""
        try:
            if not self.upstox_api.auth_handler.access_token:
                print("🔑 Authenticating with Upstox...")
                if not self.upstox_api.auth_handler.authenticate():
                    print("❌ Authentication failed")
                    return False

            print("✅ Authentication successful")
            return True
        except Exception as e:
            print(f"❌ Authentication error: {e}")
            return False

    def get_instrument_keys(self) -> Dict[str, str]:
        """Get instrument keys for all symbols using existing API."""
        instrument_keys = {}

        for symbol in self.symbols:
            try:
                instrument_key = self.upstox_api.get_instrument_key(symbol)
                if instrument_key:
                    instrument_keys[symbol] = instrument_key
                    print(f"✅ {symbol}: {instrument_key}")
                else:
                    print(f"❌ Could not get instrument key for {symbol}")
            except Exception as e:
                print(f"⚠️ Error getting instrument key for {symbol}: {e}")

        return instrument_keys

    def setup_websocket(self) -> bool:
        """Setup WebSocket streaming using existing abstraction."""
        if not self.websocket_enabled:
            print("❌ WebSocket not available - install upstox-python-sdk")
            return False

        # Check if market is open (9:15 AM - 3:30 PM IST)
        if not self._is_market_open():
            print("⚠️ Market is closed - WebSocket streaming may not work")
            print("💡 NSE trading hours: 9:15 AM - 3:30 PM IST")
            # Continue anyway, as some data might still be available

        try:
            # Get access token from existing API client
            access_token = self.upstox_api.auth_handler.access_token
            if not access_token:
                print("❌ No access token available")
                return False

            # Setup SDK configuration
            configuration = upstox_client.Configuration()
            configuration.access_token = access_token

            # Get instrument keys for all symbols
            self.instrument_keys = self.get_instrument_keys()
            if not self.instrument_keys:
                print("❌ No valid instrument keys found")
                return False

            instrument_keys_list = list(self.instrument_keys.values())

            # Initialize Market Data Streamer
            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"  # Last Traded Price mode for fastest updates
            )

            # Setup event handlers
            self.market_streamer.on("message", self.on_tick_update)
            self.market_streamer.on("open", self.on_websocket_open)
            self.market_streamer.on("error", self.on_websocket_error)
            self.market_streamer.on("close", self.on_websocket_close)

            print(f"✅ WebSocket setup complete for {len(instrument_keys_list)} symbols")
            return True

        except Exception as e:
            print(f"❌ WebSocket setup failed: {e}")
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

    def on_tick_update(self, message):
        """Handle incoming tick data."""
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
                        old_price = self.current_prices.get(symbol, 0)

                        # Only process if price changed
                        if abs(new_price - old_price) >= 0.01:  # At least 1 paisa change
                            self.current_prices[symbol] = new_price
                            self.update_count[symbol] += 1
                            self.last_update_time[symbol] = datetime.now()

                            # Store in history (keep last 1000 updates per symbol)
                            self.price_history[symbol].append({
                                'timestamp': self.last_update_time[symbol],
                                'price': new_price,
                                'change': new_price - old_price,
                                'change_pct': ((new_price - old_price) / old_price * 100) if old_price > 0 else 0
                            })

                            # Keep only recent history
                            if len(self.price_history[symbol]) > 1000:
                                self.price_history[symbol] = self.price_history[symbol][-1000:]

                            # Display update
                            self.display_tick_update(symbol, new_price, old_price)

        except Exception as e:
            print(f"❌ Error processing tick update: {e}")

    def display_tick_update(self, symbol: str, new_price: float, old_price: float):
        """Display tick update in a clean format."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        change = new_price - old_price
        change_pct = (change / old_price * 100) if old_price > 0 else 0

        # Color coding would be nice but keeping it simple for console output
        print(f"[{timestamp}] 📈 {symbol:<12} ₹{new_price:>8.2f} {change:+.2f} ({change_pct:+.2f}%)")

    def on_websocket_open(self):
        """Called when WebSocket connection opens."""
        self.connected = True
        print("🔗 WebSocket connection established!")
        symbols_str = ", ".join(self.symbols)
        print(f"📡 Streaming live ticks for: {symbols_str}")
        print("=" * 60)

    def on_websocket_error(self, error):
        """Called when WebSocket encounters an error."""
        print(f"❌ WebSocket error: {error}")
        self.connected = False

        # Handle authentication errors (401)
        if hasattr(error, 'status_code') and error.status_code == 401:
            print("🔑 Access token expired or invalid - attempting refresh...")
            self._handle_token_refresh()
        elif "401" in str(error):
            print("🔑 Access token expired or invalid - attempting refresh...")
            self._handle_token_refresh()

    def _handle_token_refresh(self):
        """Handle token refresh when WebSocket authentication fails."""
        try:
            print("🔐 Re-authenticating with Upstox...")

            # Use the enhanced API's token refresh logic
            if hasattr(self.upstox_api, 'retry_websocket_connection'):
                # The API will handle token refresh and retry connection
                if self.upstox_api.retry_websocket_connection(self.symbols):
                    print("✅ WebSocket reconnected successfully!")
                    # Start streaming again
                    self.upstox_api.start_realtime_streaming()
                else:
                    print("❌ WebSocket reconnection failed")
            else:
                # Fallback to manual token refresh
                self._manual_token_refresh()

        except Exception as e:
            print(f"❌ Token refresh failed: {e}")

    def _manual_token_refresh(self):
        """Manual token refresh as fallback."""
        try:
            # Clear the current token
            self.upstox_api.auth_handler.access_token = None

            # Remove the cached token file to force fresh authentication
            token_file = Path.home() / ".upstox_token.json"
            if token_file.exists():
                token_file.unlink()

            # Re-authenticate
            if self.upstox_api.auth_handler.authenticate():
                print("✅ Re-authentication successful!")

                # Retry WebSocket connection with new token
                print("🔄 Retrying WebSocket connection...")
                self._retry_websocket_connection()
            else:
                print("❌ Re-authentication failed")

        except Exception as e:
            print(f"❌ Manual token refresh failed: {e}")

    def _retry_websocket_connection(self):
        """Retry WebSocket connection with fresh token."""
        try:
            # Use the enhanced API's retry method
            if self.upstox_api.retry_websocket_connection(self.symbols):
                print("✅ WebSocket reconnected successfully!")
                # Start streaming again
                self.upstox_api.start_realtime_streaming()
            else:
                print("❌ WebSocket reconnection failed")

        except Exception as e:
            print(f"❌ WebSocket retry failed: {e}")

    def on_websocket_close(self, close_status_code, close_msg):
        """Called when WebSocket connection closes."""
        print(f"🔌 WebSocket connection closed (Code: {close_status_code})")
        self.connected = False

    def display_summary_stats(self):
        """Display summary statistics for all symbols."""
        print("\n" + "=" * 60)
        print("📊 STREAMING SUMMARY")
        print("=" * 60)

        for symbol in self.symbols:
            updates = self.update_count.get(symbol, 0)
            current_price = self.current_prices.get(symbol, 0)
            last_update = self.last_update_time.get(symbol)

            if updates > 0:
                status = "🟢 ACTIVE" if self.connected else "🔴 DISCONNECTED"
                last_update_str = last_update.strftime("%H:%M:%S") if last_update else "Never"

                print(f"{symbol:<12} | {status:<12} | Updates: {updates:>4} | "
                      f"Price: ₹{current_price:>8.2f} | Last: {last_update_str}")
            else:
                print(f"{symbol:<12} | 🔴 NO DATA   | Updates: {updates:>4} | "
                      f"Price: ₹{current_price:>8.2f} | Last: Never")

        print("=" * 60)

    def run(self, duration_seconds: Optional[int] = None):
        """
        Run the tick streamer.

        Args:
            duration_seconds: How long to run (None = run indefinitely)
        """
        if not UPSTOX_AVAILABLE:
            print("❌ Upstox API not available")
            return

        # Authenticate
        if not self.authenticate():
            return

        # Setup WebSocket
        if not self.setup_websocket():
            print("❌ Could not setup WebSocket streaming")
            return

        # Start streaming
        print(f"🚀 Starting tick-by-tick streaming for {len(self.symbols)} symbols...")
        print("📝 Press Ctrl+C to stop")
        print()

        self.running = True
        start_time = time.time()

        try:
            # Connect and start streaming
            self.market_streamer.connect()

            # Monitor and display stats periodically
            last_stats_time = 0
            while self.running:
                current_time = time.time()

                # Display summary stats every 30 seconds
                if current_time - last_stats_time > 30:
                    self.display_summary_stats()
                    last_stats_time = current_time

                # Check duration limit
                if duration_seconds and (current_time - start_time) >= duration_seconds:
                    print(f"\n⏰ Duration limit reached ({duration_seconds}s)")
                    break

                time.sleep(1)

        except KeyboardInterrupt:
            print("\n🛑 Stopped by user")
        except Exception as e:
            print(f"\n❌ Error during streaming: {e}")
        finally:
            self.running = False
            if self.market_streamer:
                try:
                    self.market_streamer.disconnect()
                    print("🔌 WebSocket connection closed")
                except:
                    pass

            # Final summary
            self.display_summary_stats()

            # Show some interesting stats
            total_updates = sum(self.update_count.values())
            elapsed_time = time.time() - start_time

            if total_updates > 0:
                updates_per_second = total_updates / elapsed_time
                print(f"\n📈 SESSION STATS:")
                print(f"   Total Updates: {total_updates}")
                print(f"   Duration: {elapsed_time:.1f} seconds")
                print(f"   Updates/sec: {updates_per_second:.2f}")

                # Show most active symbol
                most_active = max(self.symbols, key=lambda s: self.update_count.get(s, 0))
                print(f"   Most Active: {most_active} ({self.update_count[most_active]} updates)")

def main():
    parser = argparse.ArgumentParser(description="Tick-by-Tick Data Streamer")
    parser.add_argument("--symbols", type=str, nargs="+", default=["RELIANCE"],
                       help="Stock symbols to stream (e.g., RELIANCE TCS INFY)")
    parser.add_argument("--duration", type=int, help="Duration to run in seconds (default: run indefinitely)")
    parser.add_argument("--api-key", type=str, help="Upstox API key (if not in config)")
    parser.add_argument("--api-secret", type=str, help="Upstox API secret (if not in config)")

    args = parser.parse_args()

    # Get API credentials
    api_key = args.api_key or UPSTOX_CONFIG.get('api_key')
    api_secret = args.api_secret or UPSTOX_CONFIG.get('api_secret')

    if not api_key or not api_secret:
        print("❌ API credentials not found")
        print("💡 Provide them as arguments or set UPSTOX_CONFIG in config.py")
        return

    # Create and run streamer
    streamer = TickByTickStreamer(args.symbols, api_key, api_secret)
    streamer.run(args.duration)

if __name__ == "__main__":
    main()