"""Main orchestration for daily ORB trading runner."""

import sys
import time
import argparse
import json
import signal
from pathlib import Path
from datetime import datetime
from typing import Dict, List

from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from trading.paper_trader import PaperTrader, OrderSide, get_paper_trader
from trading.orb_signals import ORBSignalGenerator, SignalType, create_entry_signal
from trading.risk_manager import RiskManager, get_risk_manager
from trading.journal import TradeJournal, get_journal

from .daily_scanner import (
    refresh_watchlist as _refresh_watchlist,
    fetch_or_data as _fetch_or_data,
    fetch_live_price_for_exit as _fetch_live_price_for_exit,
    scan_for_signals as _scan_for_signals,
)
from .daily_execution import (
    execute_signal as _execute_signal,
    monitor_positions as _monitor_positions,
)

try:
    from trading.config_loader import get_strategy_config
    _config_available = True
except ImportError:
    _config_available = False

console = Console()


class DailyTradingRunner:

    PRE_MARKET = (9, 0)
    MARKET_OPEN = (9, 15)
    OR_END = (10, 0)
    FORCE_EXIT = (14, 45)
    MARKET_CLOSE = (15, 30)

    def __init__(
        self,
        capital: float = 1_000_000,
        max_positions: int = 5,
        test_mode: bool = False,
        force_signals: bool = False,
        config_name: str = None,
    ):
        self.config = get_strategy_config(config_name) if _config_available else None

        self.capital = capital
        self.max_positions = max_positions if max_positions is not None else (
            self.config.max_positions if self.config else 5
        )
        self.test_mode = test_mode
        self.force_signals = force_signals

        self.COOLDOWN_MINUTES = self.config.cooldown_minutes if self.config else 30

        self.trader = get_paper_trader()
        self.signal_generator = ORBSignalGenerator(config_name=config_name)
        self.risk_manager = get_risk_manager(config_name=config_name)
        self.journal = get_journal()

        self.running = True
        self.or_levels = {}
        self.watchlist = []
        self.signals_generated = []
        self.cooldown_stocks = {}
        self.snapshot_file = Path("/tmp/paper-trading-snapshot.json")

        self._screener = None
        self._data_fetcher = None

        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def _signal_handler(self, signum, frame):
        console.print("\n[yellow]Shutdown signal received. Closing positions...[/yellow]")
        self.running = False

    def _write_scan_snapshot(self, scan_items: List[dict], signals: List = None):
        try:
            open_positions_data = []
            for symbol, pos in self.trader.positions.items():
                open_positions_data.append({
                    "symbol": symbol,
                    "side": pos.side.value,
                    "quantity": pos.quantity,
                    "entry_price": round(float(pos.entry_price), 2),
                    "current_price": round(float(pos.current_price), 2),
                    "entry_time": pos.entry_time.isoformat() if hasattr(pos.entry_time, "isoformat") else str(pos.entry_time),
                    "stop_loss": round(float(pos.stop_loss), 2),
                    "take_profit": round(float(pos.take_profit), 2),
                    "pnl": round(float(pos.unrealized_pnl), 2),
                    "pnl_pct": round(float(pos.unrealized_pnl_pct), 2),
                    "margin_used": round(float(pos.entry_price * pos.quantity), 2),
                    "order_id": f"LIVE-{symbol}",
                })

            payload = {
                "timestamp": datetime.now().isoformat(),
                "watchlist": self.watchlist,
                "open_positions": list(self.trader.positions.keys()),
                "open_positions_data": open_positions_data,
                "scan_items": scan_items,
                "signals": [
                    {
                        "symbol": s.symbol,
                        "side": "LONG" if s.signal_type == SignalType.LONG_ENTRY else "SHORT",
                        "price": round(float(s.price), 2),
                        "notes": s.notes,
                    }
                    for s in (signals or [])
                ],
            }
            self.snapshot_file.write_text(json.dumps(payload))
        except Exception as e:
            console.print(f"[dim red]Failed to write scan snapshot: {e}[/dim red]")

    def _get_screener(self):
        if self._screener is None:
            from orb_stock_screener import ORBStockScreener
            self._screener = ORBStockScreener(use_relaxed=True)
        return self._screener

    def _get_data_fetcher(self):
        if self._data_fetcher is None:
            from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
            self._data_fetcher = TVScreenerUsage(enable_paper_trading=False)
        return self._data_fetcher

    def is_market_open(self) -> bool:
        from trading.utils import is_market_open as _is_market_open
        return _is_market_open()

    def is_trading_hours(self) -> bool:
        from trading.utils import is_trading_hours as _is_trading_hours
        return _is_trading_hours()

    def is_force_exit_time(self) -> bool:
        from trading.utils import is_force_exit_time as _is_force_exit_time
        return _is_force_exit_time()

    def refresh_watchlist(self):
        _refresh_watchlist(self)

    def fetch_or_data(self, symbol: str) -> dict:
        return _fetch_or_data(self, symbol)

    def fetch_live_price_for_exit(self, symbol: str) -> dict:
        return _fetch_live_price_for_exit(self, symbol)

    def scan_for_signals(self):
        return _scan_for_signals(self)

    def execute_signal(self, signal):
        return _execute_signal(self, signal)

    def monitor_positions(self):
        return _monitor_positions(self)

    def display_status(self):
        portfolio = self.trader.get_portfolio_status()

        status_table = Table.grid()
        status_table.add_column("Metric", style="cyan")
        status_table.add_column("Value", justify="right")

        status_table.add_row("Time", datetime.now().strftime("%H:%M:%S"))
        status_table.add_row("Market Status", "OPEN" if self.is_market_open() else "CLOSED")
        status_table.add_row("Trading Hours", "YES" if self.is_trading_hours() else "NO")
        status_table.add_row("Capital", f"\u20b9{portfolio['total_value']:,.0f}")
        status_table.add_row("Cash", f"\u20b9{portfolio['cash']:,.0f}")
        status_table.add_row("Positions", f"{portfolio['positions']}/{self.max_positions}")
        status_table.add_row("Daily P&L", f"\u20b9{portfolio['daily_pnl']:,.0f}")
        status_table.add_row("Trades Today", str(portfolio['daily_trades']))

        console.print(Panel(status_table, title="Trading Status", border_style="cyan"))

        if self.trader.positions:
            pos_table = Table(title="Open Positions")
            pos_table.add_column("Symbol")
            pos_table.add_column("Side")
            pos_table.add_column("Qty", justify="right")
            pos_table.add_column("Entry", justify="right")
            pos_table.add_column("Current", justify="right")
            pos_table.add_column("P&L", justify="right")
            pos_table.add_column("SL/TP", justify="right")

            for symbol, pos in self.trader.positions.items():
                pnl_color = "green" if pos.unrealized_pnl >= 0 else "red"
                pos_table.add_row(
                    symbol,
                    pos.side.value,
                    str(pos.quantity),
                    f"\u20b9{pos.entry_price:.2f}",
                    f"\u20b9{pos.current_price:.2f}",
                    f"[{pnl_color}]\u20b9{pos.unrealized_pnl:,.0f}[/{pnl_color}]",
                    f"\u20b9{pos.stop_loss:.2f}/\u20b9{pos.take_profit:.2f}",
                )

            console.print(pos_table)

    def run(self, interval: int = 60):
        console.print(Panel.fit(
            "[bold cyan]ORB Daily Trading Runner[/bold cyan]\n"
            f"Mode: {'TEST' if self.test_mode else 'LIVE'}\n"
            f"Capital: \u20b9{self.capital:,.0f}\n"
            f"Max Positions: {self.max_positions}",
            border_style="green"
        ))

        self.refresh_watchlist()

        cycle = 0
        while self.running:
            cycle += 1

            try:
                console.print(f"\n[dim]--- Cycle {cycle} @ {datetime.now().strftime('%H:%M:%S')} ---[/dim]")

                if not self.is_market_open():
                    console.print("[yellow]Market closed. Waiting...[/yellow]")
                    time.sleep(interval)
                    continue

                if cycle % 10 == 0:
                    self.refresh_watchlist()

                signals = self.scan_for_signals()
                if signals:
                    console.print(f"\n[green]Found {len(signals)} new signals![/green]")
                    for sig in signals:
                        console.print(f"  {sig.signal_type.value} {sig.symbol} @ \u20b9{sig.price:.2f}")
                        console.print(f"    SL: \u20b9{sig.stop_loss:.2f} | TP: \u20b9{sig.take_profit:.2f}")

                        self.execute_signal(sig)

                self.monitor_positions()

                self.display_status()

                if self.running and not self.is_force_exit_time():
                    console.print(f"\n[dim]Waiting {interval}s until next scan...[/dim]")
                    time.sleep(interval)

            except Exception as e:
                console.print(f"[red]Error in cycle {cycle}: {e}[/red]")
                time.sleep(5)

        console.print("\n[bold]Trading stopped. Final status:[/bold]")
        self.trader.display_status()
        self.journal.display_summary()

        self.journal.save_journal()


def main():
    parser = argparse.ArgumentParser(description='Daily ORB Trading Runner')
    parser.add_argument('--test', action='store_true', help='Test mode (no real trades)')
    parser.add_argument('--force-signals', action='store_true', help='Force generate test signals')
    parser.add_argument('--status', action='store_true', help='Just show current status')
    parser.add_argument('--capital', type=float, default=1_000_000, help='Initial capital')
    parser.add_argument('--positions', type=int, default=5, help='Max positions')
    parser.add_argument('--interval', type=int, default=60, help='Scan interval in seconds')

    args = parser.parse_args()

    runner = DailyTradingRunner(
        capital=args.capital,
        max_positions=args.positions,
        test_mode=args.test,
        force_signals=args.force_signals,
    )

    if args.status:
        runner.display_status()
        return

    runner.run(interval=args.interval)
