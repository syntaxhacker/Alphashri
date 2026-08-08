#!/usr/bin/env python3
"""
TradingView Webhook Handler - Single Clean File
================================================

A complete TradingView webhook handler with:
- Position management
- Live price monitoring (batch API - 500 stocks at once)
- Stop loss / Take profit
- Telegram notifications
- Clean, decoupled functions

Usage:
    python tv_webhook_handler.py                    # Basic mode
    python tv_webhook_handler.py --trading          # Enable position management
    python tv_webhook_handler.py --dashboard        # Live dashboard
    python tv_webhook_handler.py --status           # Show status
"""

import sys
import os
import time as time_module
import json
import threading
import signal
import atexit
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import requests

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import TELEGRAM_CONFIG, UPSTOX_CONFIG

# Try to import Upstox auth
try:
    from config_and_utils.upstox_auth import create_upstox_auth
    UPSTOX_AVAILABLE = True
except ImportError:
    UPSTOX_AVAILABLE = False

# Try to import Flask
try:
    from flask import Flask, request, jsonify
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False

console = Console()


# ============================================================================
# UPSTOX API FUNCTIONS (Batch Price Fetching)
# ============================================================================

def init_upstox_auth(api_key: str, api_secret: str) -> Optional[Any]:
    """Initialize Upstox authentication with cached token"""
    if not UPSTOX_AVAILABLE:
        return None

    try:
        console.print("[dim]🔑 Loading Upstox token from cache...[/dim]")
        auth = create_upstox_auth(api_key, api_secret, quiet=True)

        if not auth.access_token:
            console.print("[yellow]🔑 No cached token - authenticating...[/yellow]")
            auth.authenticate()

        # Get token age
        token_age = get_token_age()
        console.print(f"[green]✅ Upstox connected (token age: {token_age:.1f}h)[/green]")
        return auth

    except Exception as e:
        console.print(f"[red]❌ Upstox init failed: {e}[/red]")
        return None


def get_token_age() -> float:
    """Get token age in hours"""
    try:
        token_file = Path(__file__).parent.parent.parent / ".upstox_token.json"
        if token_file.exists():
            with open(token_file) as f:
                data = json.load(f)
                ts = datetime.fromisoformat(data['timestamp'])
                return (datetime.now() - ts).total_seconds() / 3600
    except:
        pass
    return 0.0


def get_instrument_key(symbol: str, auth: Any) -> Optional[str]:
    """Get ISIN instrument key for a symbol"""
    # Popular stocks ISIN mapping
    ISINS = {
        "HDFCBANK": "NSE_EQ|INE040A01034",
        "TCS": "NSE_EQ|INE467B01029",
        "RELIANCE": "NSE_EQ|INE669E01016",
        "INFY": "NSE_EQ|INE009A01021",
        "WIPRO": "NSE_EQ|INE075A01022",
        "SBIN": "NSE_EQ|INE062A01020",
        "ICICIBANK": "NSE_EQ|INE090A01021",
        "HINDUNILVR": "NSE_EQ|INE030A01027",
        "ITC": "NSE_EQ|INE154A01025",
        "BHARTIARTL": "NSE_EQ|INE397D01024",
    }
    return ISINS.get(symbol.upper())


def fetch_batch_prices(symbols: List[str], auth: Any) -> Dict[str, float]:
    """Fetch live prices for multiple symbols (up to 500 at once)"""
    if not auth or not symbols:
        return {}

    try:
        # Map symbols to ISINs
        symbol_to_isin = {}
        isins = []

        for symbol in symbols:
            isin = get_instrument_key(symbol, auth)
            if isin:
                isins.append(isin)
                symbol_to_isin[isin] = symbol

        if not isins:
            return {}

        # Batch API call
        symbols_str = ",".join(isins)
        url = f"https://api.upstox.com/v2/market-quote/ltp?symbol={symbols_str}"
        headers = auth.get_headers()

        response = requests.get(url, headers=headers, timeout=10)

        if response.status_code == 200:
            data = response.json()
            if data.get('status') == 'success':
                prices = {}
                for response_key, info in data['data'].items():
                    instrument_token = info.get('instrument_token', '')
                    if instrument_token in symbol_to_isin:
                        symbol = symbol_to_isin[instrument_token]
                        prices[symbol] = float(info['last_price'])
                return prices
        elif response.status_code == 401:
            # Token expired, refresh
            auth.refresh_token()
            return fetch_batch_prices(symbols, auth)  # Retry once

    except Exception as e:
        console.print(f"[red]❌ Batch price fetch error: {e}[/red]")

    return {}


# ============================================================================
# TELEGRAM NOTIFICATION FUNCTIONS
# ============================================================================

def send_telegram_message(message: str, config: Dict[str, str]) -> bool:
    """Send Telegram message"""
    if not config or not config.get('bot_token'):
        return False

    try:
        url = f"https://api.telegram.org/bot{config['bot_token']}/sendMessage"
        payload = {
            'chat_id': config['chat_id'],
            'text': message,
            'parse_mode': 'Markdown'
        }
        response = requests.post(url, json=payload, timeout=10)
        return response.status_code == 200
    except:
        return False


def send_position_alert(symbol: str, side: str, price: float, qty: int, config: Dict[str, str]):
    """Send alert for new position"""
    side_emoji = "🟢" if side == 'BUY' else "🔴"
    message = f"📡 *TV Alert Position*\\n\\n"
    message += f"📈 *Symbol:* {symbol}\\n"
    message += f"💰 *Side:* {side_emoji} {side}\\n"
    message += f"💰 *Price:* ₹{price:.2f}\\n"
    message += f"📊 *Quantity:* {qty}\\n"
    message += f"💵 *Value:* ₹{price * qty:,.0f}\\n"
    message += f"⏰ *Time:* {datetime.now().strftime('%H:%M:%S')}"
    send_telegram_message(message, config)


def send_exit_alert(symbol: str, side: str, entry: float, exit: float,
                    pnl_pct: float, pnl_amount: float, reason: str, config: Dict[str, str]):
    """Send alert for position exit"""
    pnl_emoji = "🟢" if pnl_pct > 0 else "🔴"
    side_emoji = "🟢" if side == 'BUY' else "🔴"
    message = f"🔥 *Position Closed*\\n\\n"
    message += f"📈 *Symbol:* {symbol}\\n"
    message += f"💰 *Side:* {side_emoji} {side}\\n"
    message += f"💰 *Entry:* ₹{entry:.2f}\\n"
    message += f"💰 *Exit:* ₹{exit:.2f}\\n"
    message += f"📊 *P&L:* {pnl_emoji} {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})\\n"
    message += f"📝 *Reason:* {reason}\\n"
    message += f"⏰ *Time:* {datetime.now().strftime('%H:%M:%S')}"
    send_telegram_message(message, config)


# ============================================================================
# POSITION MANAGEMENT FUNCTIONS
# ============================================================================

def create_position(symbol: str, action: str, price: float, position_size: float) -> Dict[str, Any]:
    """Create a new position from TV alert"""
    side = 'BUY' if action.upper() in ['BUY', 'LONG'] else 'SELL'
    quantity = max(1, int(position_size / price))

    return {
        'side': side,
        'qty': quantity,
        'entry_price': round(price, 2),
        'entry_time': datetime.now(),
        'timestamp': datetime.now(),
        'source': 'TV_ALERT'
    }


def calculate_pnl(position: Dict[str, Any], current_price: float) -> tuple:
    """Calculate P&L for a position"""
    entry_price = position['entry_price']
    quantity = position['qty']
    side = position['side']

    if side == 'BUY':
        pnl_pct = (current_price - entry_price) / entry_price * 100
        pnl_amount = (current_price - entry_price) * quantity
    else:  # SELL
        pnl_pct = (entry_price - current_price) / entry_price * 100
        pnl_amount = (entry_price - current_price) * quantity

    return pnl_pct, pnl_amount


def should_exit_position(position: Dict[str, Any], current_price: float,
                         stop_loss_pct: float = -1.0, take_profit_pct: float = 2.0) -> tuple:
    """Check if position should be exited"""
    pnl_pct, _ = calculate_pnl(position, current_price)

    if pnl_pct <= stop_loss_pct:
        return True, f"STOP LOSS: {pnl_pct:.2f}%"
    elif pnl_pct >= take_profit_pct:
        return True, f"TAKE PROFIT: {pnl_pct:.2f}%"

    return False, ""


# ============================================================================
# MARKET STATUS FUNCTIONS
# ============================================================================

def is_market_open() -> bool:
    """Check if Indian market is open"""
    from datetime import time
    now = datetime.now().time()
    market_open = time(9, 15)
    market_close = time(15, 30)

    # Check weekday
    if datetime.now().weekday() >= 5:
        return False

    return market_open <= now <= market_close


# ============================================================================
# DISPLAY FUNCTIONS
# ============================================================================

def display_status(state: Dict[str, Any]):
    """Display current system status"""
    console.print("\n[bold blue]📡 TradingView Webhook Handler[/bold blue]")

    # System status
    status_text = f"""
🌐 Server: {'🟢 RUNNING' if state['server_running'] else '🔴 STOPPED'}
📡 Port: {state['port']}
💰 Trading: {'🟢 ENABLED' if state['trading_enabled'] else '🔴 DISABLED'}
📈 Upstox: {'🟢 CONNECTED' if state['upstox_auth'] else '🔴 DISCONNECTED'}
📱 Telegram: {'🟢 ENABLED' if state['telegram_enabled'] else '🔴 DISABLED'}
📊 Total Trades: {state['trade_count']}
⏰ Uptime: {datetime.now() - state['start_time']}
    """
    console.print(Panel(status_text.strip(), title="🖥️ System Status", border_style="blue"))

    # Active positions
    active_positions = {k: v for k, v in state['positions'].items() if v}

    if active_positions:
        table = Table(title=f"📊 Active Positions ({len(active_positions)})",
                     show_header=True, header_style="bold magenta")
        table.add_column("Symbol", style="cyan", width=12)
        table.add_column("Side", style="bold", justify="center", width=6)
        table.add_column("Entry", justify="right", style="yellow", width=10)
        table.add_column("Current", justify="right", style="green", width=10)
        table.add_column("Qty", justify="right", style="blue", width=6)
        table.add_column("P&L %", justify="right", width=8)
        table.add_column("P&L ₹", justify="right", width=10)
        table.add_column("Time", justify="center", style="dim", width=8)

        for symbol, position in active_positions.items():
            current_price = state['current_prices'].get(symbol, position['entry_price'])
            entry_price = position['entry_price']
            quantity = position['qty']
            side = position['side']

            pnl_pct, pnl_amount = calculate_pnl(position, current_price)

            side_emoji = "🟢" if side == 'BUY' else "🔴"
            pnl_color = "green" if pnl_pct >= 0 else "red"
            current_color = "green" if current_price >= entry_price else "red"

            table.add_row(
                symbol,
                f"{side_emoji} {side}",
                f"₹{entry_price:.2f}",
                f"[{current_color}]₹{current_price:.2f}[/{current_color}]",
                f"{quantity:,}",
                f"[{pnl_color}]{pnl_pct:+.2f}%[/{pnl_color}]",
                f"[{pnl_color}]₹{pnl_amount:+,.0f}[/{pnl_color}]",
                position['entry_time'].strftime('%H:%M:%S')
            )

        console.print(table)

        # Portfolio summary
        total_invested = sum(pos['entry_price'] * pos['qty'] for pos in active_positions.values())
        total_current = sum(state['current_prices'].get(sym, pos['entry_price']) * pos['qty']
                          for sym, pos in active_positions.items())
        total_pnl = total_current - total_invested
        total_pnl_pct = (total_pnl / total_invested * 100) if total_invested > 0 else 0

        summary_color = "green" if total_pnl >= 0 else "red"
        summary = f"""
💰 Total Invested: ₹{total_invested:,.0f}
📈 Current Value: ₹{total_current:,.0f}
📊 Total P&L: [{summary_color}]₹{total_pnl:+,.0f} ({total_pnl_pct:+.2f}%)[/{summary_color}]
        """
        console.print(Panel(summary.strip(), title="📈 Portfolio Summary", border_style=summary_color))
    else:
        console.print(Panel("📊 No active positions\n\n[dim]Waiting for TradingView alerts...[/dim]",
                          title="📊 Active Positions", border_style="yellow"))

    # Market status
    market_status = "🟢 MARKET OPEN" if is_market_open() else "🔴 MARKET CLOSED"
    console.print(f"\n[dim]Market Status: {market_status} | Last Updated: {datetime.now().strftime('%H:%M:%S')}[/dim]")


# ============================================================================
# WEBHOOK HANDLER CLASS
# ============================================================================

class WebhookHandler:
    """Main webhook handler with all functionality"""

    shutdown_flag = False

    def __init__(self, port: int = 5001, trading_enabled: bool = False,
                 position_size: float = 20000):
        self.port = port
        self.trading_enabled = trading_enabled
        self.position_size = position_size

        # Initialize state
        self.state = {
            'port': port,
            'trading_enabled': trading_enabled,
            'server_running': False,
            'upstox_auth': None,
            'telegram_enabled': bool(TELEGRAM_CONFIG and TELEGRAM_CONFIG.get('bot_token')),
            'positions': {},
            'current_prices': {},
            'closed_trades': [],
            'trade_count': 0,
            'start_time': datetime.now()
        }

        # Setup logging
        self._setup_logging()

        # Initialize Upstox
        if UPSTOX_AVAILABLE and UPSTOX_CONFIG:
            self.state['upstox_auth'] = init_upstox_auth(
                UPSTOX_CONFIG['api_key'],
                UPSTOX_CONFIG['api_secret']
            )

        # Setup signal handlers
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        atexit.register(self._cleanup)

        # Start webhook server
        self._start_webhook_server()

    def _setup_logging(self):
        """Setup logging"""
        logs_dir = "logs"
        if not os.path.exists(logs_dir):
            os.makedirs(logs_dir)

        date_str = datetime.now().strftime("%Y-%m-%d")
        self.log_file = f"{logs_dir}/tv_webhook_{date_str}.log"

        if not os.path.exists(self.log_file):
            with open(self.log_file, 'w') as f:
                f.write(f"# TV Webhook Log - {date_str}\n")
                f.write(f"# Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    def _start_webhook_server(self):
        """Start Flask webhook server"""
        if not FLASK_AVAILABLE:
            console.print("[red]❌ Flask not available[/red]")
            return

        self.app = Flask(__name__)

        @self.app.route('/webhook', methods=['POST'])
        def webhook():
            try:
                data = request.json
                action = data.get('action', '').upper()

                if action in ['BUY', 'LONG', 'SELL', 'SHORT']:
                    success = self._process_alert(data)
                    return jsonify({'status': 'success' if success else 'failed'})

                return jsonify({'status': 'ignored'})

            except Exception as e:
                console.print(f"[red]❌ Webhook error: {e}[/red]")
                return jsonify({'status': 'error', 'message': str(e)}), 500

        @self.app.route('/health', methods=['GET'])
        def health():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'positions': len({k: v for k, v in self.state['positions'].items() if v}),
                'uptime': str(datetime.now() - self.state['start_time'])
            })

        # Start server in background
        self.server_thread = threading.Thread(target=self._run_server, daemon=True)
        self.server_thread.start()
        self.state['server_running'] = True

        console.print(f"[green]📡 Webhook server started on port {self.port}[/green]")

    def _run_server(self):
        """Run Flask server"""
        try:
            self.app.run(host='localhost', port=self.port, debug=False, threaded=True)
        except Exception as e:
            console.print(f"[red]❌ Server error: {e}[/red]")

    def _process_alert(self, data: Dict[str, Any]) -> bool:
        """Process TV alert"""
        try:
            symbol = data.get('symbol', '').strip().upper()
            if not symbol:
                return False

            # Check if already have position
            if symbol in self.state['positions'] and self.state['positions'][symbol]:
                console.print(f"[yellow]⚠️ Already have position in {symbol}[/yellow]")
                return False

            price = float(data.get('price', 0))
            if price <= 0:
                return False

            action = data.get('action', '').upper()

            # Validate with live price if available
            if self.state['upstox_auth']:
                live_prices = fetch_batch_prices([symbol], self.state['upstox_auth'])
                if live_prices.get(symbol):
                    live_price = live_prices[symbol]
                    price_diff_pct = abs(live_price - price) / price * 100
                    if price_diff_pct > 2.0:
                        console.print(f"[yellow]⚠️ Price difference: Alert {price:.2f} vs Live {live_price:.2f}[/yellow]")
                    price = live_price

            # Create position
            position = create_position(symbol, action, price, self.position_size)
            self.state['positions'][symbol] = position
            self.state['current_prices'][symbol] = price
            self.state['trade_count'] += 1

            # Send notifications
            if self.state['telegram_enabled']:
                send_position_alert(symbol, position['side'], price, position['qty'], TELEGRAM_CONFIG)

            side_emoji = "🟢" if position['side'] == 'BUY' else "🔴"
            console.print(f"[green]✅ Position created: {side_emoji} {symbol} @ ₹{price:.2f}[/green]")

            return True

        except Exception as e:
            console.print(f"[red]❌ Alert processing error: {e}[/red]")
            return False

    def start_monitoring(self):
        """Start position monitoring loop"""
        if not self.trading_enabled:
            console.print("[yellow]⚠️ Trading disabled - no monitoring[/yellow]")
            return

        console.print("[green]🔄 Starting position monitoring...[/green]")
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()

    def _monitor_loop(self):
        """Background monitoring loop"""
        while not WebhookHandler.shutdown_flag:
            try:
                active_positions = {k: v for k, v in self.state['positions'].items() if v}

                if not active_positions:
                    time_module.sleep(5)
                    continue

                # Batch fetch prices
                symbols = list(active_positions.keys())
                if self.state['upstox_auth']:
                    prices = fetch_batch_prices(symbols, self.state['upstox_auth'])
                    self.state['current_prices'].update(prices)

                # Check exits
                for symbol, position in active_positions.items():
                    current_price = self.state['current_prices'].get(symbol)
                    if current_price:
                        should_exit, reason = should_exit_position(position, current_price)
                        if should_exit:
                            self._exit_position(symbol, position, current_price, reason)

                time_module.sleep(5)

            except Exception as e:
                console.print(f"[red]❌ Monitor error: {e}[/red]")
                time_module.sleep(5)

    def _exit_position(self, symbol: str, position: Dict[str, Any],
                      exit_price: float, reason: str):
        """Exit a position"""
        try:
            entry_price = position['entry_price']
            quantity = position['qty']
            side = position['side']

            pnl_pct, pnl_amount = calculate_pnl(position, exit_price)

            # Log exit
            console.print(f"[bold red]🔥 EXIT: {symbol} | {reason} | P&L: {pnl_pct:+.2f}%[/bold red]")

            # Save to closed trades
            self.state['closed_trades'].append({
                'symbol': symbol,
                'entry_side': side,
                'entry_price': entry_price,
                'exit_price': exit_price,
                'quantity': quantity,
                'pnl_pct': pnl_pct,
                'pnl_amount': pnl_amount,
                'reason': reason,
                'exit_time': datetime.now()
            })

            # Remove position
            self.state['positions'][symbol] = None

            # Send notification
            if self.state['telegram_enabled']:
                send_exit_alert(symbol, side, entry_price, exit_price,
                              pnl_pct, pnl_amount, reason, TELEGRAM_CONFIG)

        except Exception as e:
            console.print(f"[red]❌ Exit error for {symbol}: {e}[/red]")

    def _signal_handler(self, signum, frame):
        """Handle shutdown signal"""
        WebhookHandler.shutdown_flag = True
        console.print("\n[yellow]🛑 Shutting down...[/yellow]")
        import os
        os._exit(0)

    def _cleanup(self):
        """Cleanup on exit"""
        console.print("[yellow]👋 Cleanup...[/yellow]")


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    """Main function"""
    import argparse

    parser = argparse.ArgumentParser(description='TradingView Webhook Handler')
    parser.add_argument('--port', type=int, default=5001, help='Server port')
    parser.add_argument('--trading', action='store_true', help='Enable trading')
    parser.add_argument('--position-size', type=float, default=20000, help='Position size (₹)')
    parser.add_argument('--status', action='store_true', help='Show status and exit')
    parser.add_argument('--dashboard', action='store_true', help='Live dashboard')
    parser.add_argument('--refresh', type=int, default=10, help='Dashboard refresh (s)')

    args = parser.parse_args()

    console.print("[bold green]🚀 TradingView Webhook Handler[/bold green]")

    # Create handler
    handler = WebhookHandler(
        port=args.port,
        trading_enabled=args.trading,
        position_size=args.position_size
    )

    # Show status and exit
    if args.status:
        display_status(handler.state)
        sys.exit(0)

    # Start monitoring if trading enabled
    if args.trading:
        handler.start_monitoring()

    # Display initial status
    display_status(handler.state)

    # Keep alive
    try:
        while not WebhookHandler.shutdown_flag:
            if args.dashboard:
                time_module.sleep(args.refresh)
                os.system('clear' if os.name == 'posix' else 'cls')
                display_status(handler.state)
            else:
                time_module.sleep(1)
    except KeyboardInterrupt:
        console.print("\n[yellow]👋 Goodbye![/yellow]")

    os._exit(0)


if __name__ == "__main__":
    main()
