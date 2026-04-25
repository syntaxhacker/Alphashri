import argparse
import time as time_module
import threading
import os
import atexit
import signal

from rich.console import Console
from datetime import datetime

from tradingview_screener import Query

from ..tv_webhook_server import TVWebhookServer
from ..tv_cookies import get_tradingview_cookies

from .tv_screen_display import DisplayMixin
from .tv_screen_trading import TradingMixin
from .tv_screen_telegram import TelegramMixin
from .tv_screen_scanners import ScannersMixin
from .tv_screen_analysis import AnalysisMixin

console = Console()

TELEGRAM_AVAILABLE = False
PAPER_TRADING_AVAILABLE = False
try:
    import requests
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import TELEGRAM_CONFIG, UPSTOX_CONFIG
    sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'trading_bots'))
    from upstox_paper_trading_bot import UpstoxPaperTradingBot
    TELEGRAM_AVAILABLE = True
    PAPER_TRADING_AVAILABLE = True
except ImportError:
    pass


class TVScreenerUsage(DisplayMixin, TradingMixin, TelegramMixin, ScannersMixin, AnalysisMixin):
    def __init__(self, market='in', enable_paper_trading=False, consider_tv_alerts=False):
        self.cookies = get_tradingview_cookies()
        self.query = Query()

        if market.lower() == 'us':
            self.market = 'america'
        elif market.lower() == 'in':
            self.market = 'india'
        else:
            self.market = 'india'

        console.print(f"[blue]📊 Market: {self.market.upper()}[/blue]")

        self.consider_tv_alerts = consider_tv_alerts
        self.webhook_server = None

        self.journal_file = None
        self.setup_trade_journal()

        self.telegram_enabled = TELEGRAM_AVAILABLE and TELEGRAM_CONFIG.get('bot_token') if TELEGRAM_AVAILABLE else False
        if self.telegram_enabled:
            console.print("[green]✅ Telegram alerts enabled[/green]")
        else:
            console.print("[yellow]⚠️ Telegram alerts disabled - configure TELEGRAM_CONFIG[/yellow]")

        self.trading_start_time = "09:15"
        self.trading_end_time = "14:00"

        self.paper_trading_enabled = enable_paper_trading
        self.live_trades = []
        self.closed_trades = []
        self.positions = {}
        self.current_prices = {}
        self.exchange_fallbacks = {}
        self.trade_count = 0

        self.sent_alerts = set()
        self.last_alert_time = {}
        self.alert_cooldown = 300

        self.stop_loss_cooldown = {}
        self.stop_loss_cooldown_duration = 1800

        self.loss_cooldown = {}
        self.loss_cooldown_duration = 1800

        self.daily_entry_count = {}
        self.max_daily_entries_per_stock = 10

        self._setup_signal_handlers()

        self.upstox_api = None
        self.background_monitor_active = False
        self.monitor_thread = None
        self.stop_monitoring = threading.Event()

        if self.paper_trading_enabled or self.consider_tv_alerts:
            try:
                from config_and_utils.free_indian_apis import UpstoxAPI

                self.upstox_api = UpstoxAPI(
                    api_key=UPSTOX_CONFIG.get('api_key'),
                    api_secret=UPSTOX_CONFIG.get('api_secret')
                )

                if not self.upstox_api.auth_handler.access_token:
                    console.print("[yellow]🔑 No cached token found - starting authentication...[/yellow]")
                    if not self.upstox_api.auth_handler.authenticate():
                        console.print("[red]❌ Upstox authentication failed - cannot proceed[/red]")
                        if self.consider_tv_alerts:
                            console.print("[red]❌ TV alerts require valid Upstox authentication for price validation[/red]")
                            console.print("[red]❌ Please check your UPSTOX_CONFIG credentials and restart[/red]")
                        self.upstox_api = None
                        if self.consider_tv_alerts:
                            sys.exit(1)
                    else:
                        console.print("[green]✅ Upstox authentication successful[/green]")
                else:
                    console.print("[green]✅ Upstox authentication loaded from cache[/green]")

                self.realtime_streaming_enabled = self._setup_realtime_streaming()
                if self.realtime_streaming_enabled:
                    if self.paper_trading_enabled:
                        console.print("[green]✅ Paper Trading enabled (₹20,000 per trade) with REAL-TIME Upstox streaming[/green]")
                    if self.consider_tv_alerts:
                        console.print("[green]✅ TV Alerts enabled with REAL-TIME Upstox price validation[/green]")
                else:
                    if self.paper_trading_enabled:
                        console.print("[green]✅ Paper Trading enabled (₹20,000 per trade) with live Upstox prices[/green]")
                    if self.consider_tv_alerts:
                        console.print("[green]✅ TV Alerts enabled with Upstox price validation[/green]")

            except Exception as e:
                console.print(f"[red]❌ Upstox API initialization failed: {e}[/red]")
                if self.consider_tv_alerts:
                    console.print("[red]❌ TV alerts require working Upstox API - cannot proceed[/red]")
                    sys.exit(1)
                self.upstox_api = None
                self.realtime_streaming_enabled = False
        else:
            console.print("[yellow]⚠️ Paper Trading and TV Alerts disabled - Upstox API not required[/yellow]")
            self.realtime_streaming_enabled = False

        if self.paper_trading_enabled:
            console.print(f"[cyan]⏰ Trading Hours: {self.trading_start_time} - {self.trading_end_time} IST[/cyan]")

        self.webhook_server = None

        self.tv_alerts_log = None
        if self.consider_tv_alerts:
            self._setup_tv_alerts_log()

        if self.consider_tv_alerts:
            self.webhook_server = TVWebhookServer(self._process_tv_alerts, self.tv_alerts_log)
            self.webhook_server.start()
            console.print("[green]✅ TV Alert monitoring enabled (Direct Webhook on port 5001)[/green]")
        else:
            console.print("[yellow]⚠️ TV Alert monitoring disabled[/yellow]")

    def setup_trade_journal(self):
        logs_dir = "logs"
        if not os.path.exists(logs_dir):
            os.makedirs(logs_dir)

        date_str = datetime.now().strftime("%d%b").lower()
        mode = getattr(self, 'watch_mode', 'old_screener').lower()
        self.journal_file = f"{logs_dir}/old_tv_screener_{mode}_{date_str}.log"

        if not os.path.exists(self.journal_file):
            with open(self.journal_file, 'w') as f:
                f.write(f"# Old TV Screener Trade Journal - {mode.upper()} Mode\n")
                f.write(f"# Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("# Format: TIMESTAMP | ACTION_SIDE | SYMBOL | PRICE | QTY | AMOUNT | ALERT_TYPE | P&L\n")
                f.write("-" * 80 + "\n")

    def log_trade(self, action, symbol, price, qty, amount, alert_type, pnl_pct=None, pnl_amount=None, side=None):
        if not self.journal_file:
            return

        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        pnl_info = ""
        if pnl_pct is not None:
            pnl_info = f" | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})"

        action_with_side = action
        if side:
            action_with_side = f"{action}_{side}"

        log_entry = f"{timestamp} | {action_with_side} | {symbol} | ₹{price:.2f} | {qty} | ₹{amount:,.0f} | {alert_type}{pnl_info}\n"

        try:
            with open(self.journal_file, 'a') as f:
                f.write(log_entry)
        except Exception as e:
            console.print(f"[dim red]⚠️ Journal write failed: {e}[/dim red]")

    def _setup_tv_alerts_log(self):
        logs_dir = "logs"
        if not os.path.exists(logs_dir):
            os.makedirs(logs_dir)

        date_str = datetime.now().strftime("%Y-%m-%d")
        self.tv_alerts_log = f"{logs_dir}/tv_alerts_{date_str}.log"

        if not os.path.exists(self.tv_alerts_log):
            with open(self.tv_alerts_log, 'w') as f:
                f.write(f"# TV Alerts Log - {date_str}\n")
                f.write(f"# Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("# Format: timestamp,symbol,action,price,status\n")

    def _setup_signal_handlers(self):
        try:
            signal.signal(signal.SIGINT, self._signal_handler)
            signal.signal(signal.SIGTERM, self._signal_handler)
            atexit.register(self._cleanup_on_exit)
        except Exception:
            pass

    def _signal_handler(self, signum=None, _frame=None):
        console.print(f"\n[bold yellow]🛑 Signal received: {signal.Signals(signum).name if signum else 'EXIT'}[/bold yellow]")
        try:
            if hasattr(self, 'webhook_server') and self.webhook_server:
                self.webhook_server.stop()

            if (hasattr(self, 'upstox_api') and self.upstox_api and
                hasattr(self.upstox_api, 'stop_realtime_streaming')):
                self.upstox_api.stop_realtime_streaming()

            self._exit_all_positions("SCRIPT_STOPPED")
        except Exception as e:
            console.print(f"[red]Error during cleanup: {e}[/red]")
        finally:
            console.print("[yellow]👋 Exiting script...[/yellow]")
            os._exit(0)

    def _cleanup_on_exit(self):
        if hasattr(self, 'webhook_server') and self.webhook_server:
            self.webhook_server.stop()

        if (hasattr(self, 'upstox_api') and self.upstox_api and
            hasattr(self.upstox_api, 'stop_realtime_streaming')):
            self.upstox_api.stop_realtime_streaming()

        if hasattr(self, 'positions') and self.positions:
            self._exit_all_positions("SCRIPT_EXIT")

    def _exit_all_positions(self, reason="MANUAL_EXIT"):
        if not hasattr(self, 'positions') or not self.positions:
            console.print("[dim]No active positions to exit.[/dim]")
            return

        console.print(f"\n[bold red]🚨 EXITING ALL POSITIONS - Reason: {reason}[/bold red]")

        if (hasattr(self, 'upstox_api') and self.upstox_api and
            hasattr(self.upstox_api, 'stop_realtime_streaming')):
            self.upstox_api.stop_realtime_streaming()

        positions_to_exit = dict(self.positions)

        symbols = list(positions_to_exit.keys())
        batch_prices = self._get_live_prices_batch(symbols)

        for symbol, position in positions_to_exit.items():
            try:
                current_price = (batch_prices.get(symbol) or
                               self._get_live_price_from_upstox(symbol) or
                               self.current_prices.get(symbol, position['entry_price']))
                self._execute_exit_trade(symbol, position, current_price, f"{reason}: Bulk Exit")
                if symbol in self.positions:
                    del self.positions[symbol]
            except Exception as e:
                console.print(f"[red]❌ Failed to exit {symbol}: {e}[/red]")
                if hasattr(self, 'positions') and symbol in self.positions:
                    del self.positions[symbol]
                    console.print(f"[yellow]⚠️ Removed {symbol} from positions due to exit failure[/yellow]")

    def save_results(self, df, filename):
        if not df.empty:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{filename}_{timestamp}.csv"
            df.to_csv(filename, index=False)
            console.print(f"[green]Results saved to: {filename}[/green]")

    def run_example(self, example_name, **kwargs):
        examples = {
            'intraday_breakouts': self.intraday_high_volume_breakouts,
            'intraday_gap_up': self.intraday_gap_up_stocks,
            'intraday_oversold': self.intraday_oversold_bounce,
            'intraday_news': self.intraday_news_momentum,
            'intraday_watch': lambda: self.intraday_watch_mode(**kwargs),
            'intraday_early_setup': self.intraday_early_breakout_setup,
            'intraday_accumulation': self.intraday_volume_accumulation,
            'intraday_compression': self.intraday_compression_coiling,

            'swing_reversal': self.swing_bullish_reversal,
            'swing_breakout': self.swing_breakout_consolidation,
            'swing_sector': self.swing_sector_rotation,

            'invest_growth': self.invest_quality_growth,
            'invest_dividend': self.invest_dividend_aristocrats,
            'invest_value': self.invest_undervalued_gems,

            'research_leaders': self.research_sector_leaders,
            'research_sentiment': self.research_market_sentiment,
            'research_earnings': self.research_earnings_calendar,
            'research_sectors': self.research_sector_performance,
            'research_sector_stocks': lambda: self.research_sector_stocks(**kwargs),
        }

        if example_name in examples:
            console.print(f"\n[bold blue]Running: {example_name}[/bold blue]")
            examples[example_name]()
        else:
            console.print(f"[red]Example '{example_name}' not found[/red]")
            self.show_available_examples()

    def show_available_examples(self):
        console.print("\n[bold yellow]Available Examples:[/bold yellow]")

        categories = [
            ("🚀 Intraday Trading", [
                "intraday_breakouts - High volume breakouts",
                "intraday_gap_up - Gap-up momentum",
                "intraday_oversold - Oversold bounce plays",
                "intraday_news - News-driven momentum",
                "intraday_watch - Live watch mode (continuous monitoring)"
            ]),
            ("🎯 Early Detection (Pre-Breakout)", [
                "intraday_early_setup - Early breakout setups (BEFORE breakout)",
                "intraday_accumulation - Volume accumulation (smart money)",
                "intraday_compression - Compression/coiling stocks (pre-explosion)"
            ]),
            ("📊 Swing Trading", [
                "swing_reversal - Bullish reversal patterns",
                "swing_breakout - Consolidation breakouts",
                "swing_sector - Sector rotation plays"
            ]),
            ("💰 Long-term Investing", [
                "invest_growth - Quality growth stocks",
                "invest_dividend - Dividend aristocrats",
                "invest_value - Undervalued gems"
            ]),
            ("🔍 Research & Analysis", [
                "research_leaders - Sector leaders",
                "research_sentiment - Market sentiment",
                "research_earnings - Earnings focus",
                "research_sectors - Sector performance analysis",
                "research_sector_stocks - Stocks in specific sector"
            ])
        ]

        for category, examples in categories:
            console.print(f"\n[bold]{category}:[/bold]")
            for example in examples:
                console.print(f"  • {example}")

    def run_all_examples(self):
        examples = [
            'intraday_breakouts', 'intraday_gap_up', 'intraday_oversold', 'intraday_news',
            'swing_reversal', 'swing_breakout', 'swing_sector',
            'invest_growth', 'invest_dividend', 'invest_value',
            'research_leaders', 'research_sentiment', 'research_earnings', 'research_sectors'
        ]

        for example in examples:
            self.run_example(example)
            time_module.sleep(1)
            console.print("\n" + "="*80 + "\n")


def main():
    parser = argparse.ArgumentParser(description='TradingView Screener Usage Examples')
    parser.add_argument('--example', type=str, help='Run specific example')
    parser.add_argument('--list-examples', action='store_true', help='List all available examples')
    parser.add_argument('--run-all', action='store_true', help='Run all examples')
    parser.add_argument('--market', type=str, default='in', choices=['us', 'in'], help='Market to screen (us/in, default: in)')
    parser.add_argument('--sector', type=str, help='Sector name for sector-specific analysis')

    parser.add_argument('--watch', action='store_true', help='Start intraday watch mode')
    parser.add_argument('--refresh', type=int, default=30, help='Refresh interval in seconds (default: 30)')
    parser.add_argument('--volume-threshold', type=float, default=2.0, help='Volume threshold for alerts (default: 2.0x)')
    parser.add_argument('--price-threshold', type=float, default=3.0, help='Price change threshold for alerts (default: 3.0 percent)')

    parser.add_argument('--enable-trading', action='store_true', help='Enable paper trading bot integration (₹20,000 per trade)')

    parser.add_argument('--consider-tv-alerts', action='store_true', help='Consider TradingView alerts from webhook for active positions')

    args = parser.parse_args()

    screener = TVScreenerUsage(market=args.market, enable_paper_trading=args.enable_trading, consider_tv_alerts=args.consider_tv_alerts)

    if args.list_examples:
        screener.show_available_examples()
    elif args.watch:
        screener.intraday_watch_mode(
            refresh_interval=args.refresh,
            volume_threshold=args.volume_threshold,
            price_threshold=args.price_threshold
        )
    elif args.example:
        if args.example == 'intraday_watch':
            screener.run_example(args.example,
                               refresh_interval=args.refresh,
                               volume_threshold=args.volume_threshold,
                               price_threshold=args.price_threshold)
        elif args.example == 'research_sector_stocks':
            screener.run_example(args.example, sector_name=args.sector)
        else:
            screener.run_example(args.example)
    elif args.run_all:
        screener.run_all_examples()
    else:
        console.print("[bold blue]TradingView Screener Usage Guide[/bold blue]")
        console.print("\nUse --list-examples to see all available examples")
        console.print("Use --example <name> to run a specific example")
        console.print("Use --run-all to run all examples")
        console.print("Use --watch to start intraday watch mode")
        console.print("Use --market <us|in> to select market (default: in)")
        console.print("Use --sector <name> for sector-specific analysis")
        console.print("\nExample usage:")
        console.print("  python old_tv_screen.py --example intraday_breakouts")
        console.print("  python old_tv_screen.py --market us --example intraday_breakouts")
        console.print("  python old_tv_screen.py --example research_sectors")
        console.print("  python old_tv_screen.py --example research_sector_stocks --sector 'Technology'")
        console.print("  python old_tv_screen.py --watch --refresh 15 --volume-threshold 2.5")
        console.print("  python old_tv_screen.py --watch --enable-trading --volume-threshold 1.5 --price-threshold 1.5")
        console.print("  python old_tv_screen.py --market us --example intraday_watch --refresh 10")


if __name__ == "__main__":
    main()
