"""
WebSocket utilities for real-time data streaming.
"""

import json
import threading
from datetime import datetime, time
from typing import Callable, Dict, List, Optional

try:
    import websocket
    WEBSOCKET_CLIENT_AVAILABLE = True
except ImportError:
    WEBSOCKET_CLIENT_AVAILABLE = False
    websocket = None

try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False


def is_market_open() -> bool:
    """Check if Indian stock market is currently open."""
    now = datetime.now().time()
    market_open = time(9, 15)
    market_close = time(15, 30)

    current_weekday = datetime.now().weekday()
    if current_weekday >= 5:
        return False

    return market_open <= now <= market_close


class MarketHoursChecker:
    """Helper class for market hours checking."""

    @staticmethod
    def is_market_open() -> bool:
        """Check if Indian stock market is currently open."""
        return is_market_open()

    @staticmethod
    def get_market_status() -> Dict[str, any]:
        """
        Get detailed market status information.

        Returns:
            Dict with market status details
        """
        now = datetime.now()
        current_weekday = now.weekday()
        current_time = now.time()

        market_open = time(9, 15)
        market_close = time(15, 30)

        is_weekday = current_weekday < 5
        is_within_hours = market_open <= current_time <= market_close
        is_open = is_weekday and is_within_hours

        return {
            'is_open': is_open,
            'is_weekday': is_weekday,
            'is_within_hours': is_within_hours,
            'current_time': current_time.strftime('%H:%M:%S'),
            'market_open': market_open.strftime('%H:%M:%S'),
            'market_close': market_close.strftime('%H:%M:%S'),
            'day_name': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][current_weekday]
        }


class WebSocketConnectionManager:
    """Manages WebSocket connections with reconnection logic."""

    def __init__(self, quiet: bool = False):
        self.quiet = quiet
        self._ws_connections: Dict = {}
        self._ws_threads: Dict[str, threading.Thread] = {}
        self._subscriptions: Dict[str, set] = {}

    def create_market_data_connection(
        self,
        ws_url: str,
        on_message: Callable[[Dict], None],
        on_open: Callable = None,
        on_error: Callable = None,
        on_close: Callable = None,
        headers: Dict[str, str] = None
    ):
        """
        Create a market data WebSocket connection.

        Args:
            ws_url: WebSocket URL
            on_message: Message handler callback
            on_open: Connection open callback
            on_error: Error handler callback
            on_close: Connection close callback
            headers: Optional headers for WebSocket

        Returns:
            Optional WebSocketApp instance or None if websocket unavailable.
            WebSocketApp instance or None
        """
        if not WEBSOCKET_CLIENT_AVAILABLE:
            self._log("❌ websocket-client library not available")
            return None

        def default_on_open(ws):
            self._log("✅ WebSocket connected")
            if hasattr(self, '_pending_subscriptions'):
                for symbols in self._pending_subscriptions:
                    self._send_subscription(ws, symbols)

        def default_on_error(ws, error):
            self._log(f"❌ WebSocket error: {error}")

        def default_on_close(ws, *args):
            self._log("ℹ️ WebSocket connection closed")

        ws = websocket.WebSocketApp(
            ws_url,
            header=headers or {},
            on_open=on_open or default_on_open,
            on_message=lambda ws, msg: self._handle_message(ws, msg, on_message),
            on_error=on_error or default_on_error,
            on_close=on_close or default_on_close
        )

        return ws

    def _handle_message(self, ws, message, user_callback: Callable):
        """Handle incoming WebSocket message."""
        try:
            data = json.loads(message)
            if user_callback:
                user_callback(data)
        except json.JSONDecodeError:
            self._log(f"❌ Failed to parse WebSocket message: {message}")
        except Exception as e:
            self._log(f"❌ Error handling WebSocket message: {e}")

    def _send_subscription(self, ws, symbols: List[str]):
        """Send subscription message to WebSocket."""
        try:
            subscription_data = {
                "action": "subscribe",
                "symbols": symbols
            }
            ws.send(json.dumps(subscription_data))
        except Exception as e:
            self._log(f"❌ Failed to send subscription: {e}")

    def start_connection(
        self,
        name: str,
        ws,
        subscription_symbols: List[str] = None
    ):
        """Start WebSocket connection in background thread."""
        if subscription_symbols:
            self._subscriptions[name] = set(subscription_symbols)

        thread = threading.Thread(
            target=ws.run_forever,
            daemon=True
        )
        thread.start()
        self._ws_threads[name] = thread
        self._ws_connections[name] = ws

    def stop_connection(self, name: str):
        """Stop a WebSocket connection."""
        if name in self._ws_connections:
            self._ws_connections[name].close()
            del self._ws_connections[name]
        if name in self._subscriptions:
            del self._subscriptions[name]
        self._log(f"✅ WebSocket connection '{name}' stopped")

    def subscribe(self, name: str, symbols: List[str]):
        """Subscribe to symbols on a connection."""
        if name not in self._ws_connections:
            return

        self._subscriptions[name].update(symbols)
        self._send_subscription(self._ws_connections[name], symbols)

    def unsubscribe(self, name: str, symbols: List[str]):
        """Unsubscribe from symbols."""
        if name not in self._ws_connections:
            return

        self._subscriptions[name].difference_update(symbols)
        unsub_data = {"action": "unsubscribe", "symbols": symbols}
        self._ws_connections[name].send(json.dumps(unsub_data))

    def stop_all(self):
        """Stop all WebSocket connections."""
        for name in list(self._ws_connections.keys()):
            self.stop_connection(name)

    def _log(self, message: str):
        """Log message if not in quiet mode."""
        if not self.quiet:
            print(message)
