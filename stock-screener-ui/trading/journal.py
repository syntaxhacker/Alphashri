"""
Trade Journal - Logging and analysis of trading activity.

Features:
- Trade logging with all details
- Daily/weekly reports
- Performance analysis
- Export to CSV/JSON
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
import json
import csv

# Add project paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from rich.console import Console
from rich.table import Table

console = Console()


@dataclass
class TradeRecord:
    """Complete trade record."""
    trade_id: str
    symbol: str
    side: str
    quantity: int
    entry_price: float
    exit_price: float
    entry_time: str
    exit_time: str
    pnl: float
    pnl_pct: float
    exit_reason: str
    costs: float
    net_pnl: float
    sl_price: float = 0.0
    tp_price: float = 0.0
    peak_price: float = 0.0  # Highest price during trade
    low_price: float = 0.0   # Lowest price during trade
    notes: str = ""
    # Strategy tracking
    strategy_id: int = 0           # ID of the strategy used
    strategy_name: str = ""        # Name for quick reference
    # Bot tracking
    bot_id: int = 0                # ID of the bot that executed this trade
    bot_name: str = ""             # Bot name for quick reference
    # Source tracking
    source: str = "live"           # "live", "backtest", "seed_test" - identifies trade origin
    is_test: bool = False          # Quick flag for test/seeded data


class TradeJournal:
    """
    Trade logging and analysis.

    Features:
    - Log trades with all details
    - Generate daily reports
    - Analyze performance by symbol/strategy
    - Export data
    """

    def __init__(self, journal_dir: Optional[str] = None, user_id: Optional[int] = None):
        """
        Initialize trade journal.

        Args:
            journal_dir: Directory to store journal files
            user_id: User ID for multi-user support (journals stored in journals/{user_id}/)
        """
        if journal_dir:
            self.journal_dir = Path(journal_dir)
        elif user_id:
            self.journal_dir = Path(__file__).parent.parent / "journals" / str(user_id)
        else:
            self.journal_dir = Path(__file__).parent.parent / "journals"

        self.journal_dir.mkdir(parents=True, exist_ok=True)
        self.user_id = user_id

        self.trades: List[TradeRecord] = []
        self.daily_summaries: Dict[str, dict] = {}

    def log_trade(self, trade: dict, notes: str = "", strategy_id: int = 0, strategy_name: str = "", bot_id: int = 0, bot_name: str = "") -> TradeRecord:
        """
        Log a completed trade.

        Args:
            trade: Trade dict from PaperTrader or backtest
            notes: Optional notes
            strategy_id: ID of the strategy used
            strategy_name: Name of the strategy for quick reference
            bot_id: ID of the bot that executed this trade
            bot_name: Name of the bot for quick reference

        Returns:
            TradeRecord
        """
        record = TradeRecord(
            trade_id=trade.get('trade_id', ''),
            symbol=trade['symbol'],
            side=trade['side'],
            quantity=trade['quantity'],
            entry_price=trade['entry_price'],
            exit_price=trade['exit_price'],
            entry_time=trade['entry_time'],
            exit_time=trade['exit_time'],
            pnl=trade['pnl'],
            pnl_pct=trade['pnl_pct'],
            exit_reason=trade['exit_reason'],
            costs=trade['costs'],
            net_pnl=trade['net_pnl'],
            sl_price=trade.get('sl_price', 0),
            tp_price=trade.get('tp_price', 0),
            peak_price=trade.get('peak_price', 0),
            low_price=trade.get('low_price', 0),
            notes=notes,
            strategy_id=trade.get('strategy_id', strategy_id),
            strategy_name=trade.get('strategy_name', strategy_name),
            bot_id=trade.get('bot_id', bot_id),
            bot_name=trade.get('bot_name', bot_name),
            source=trade.get('source', 'live'),
            is_test=trade.get('is_test', False),
        )

        self.trades.append(record)
        self._update_daily_summary(record)

        return record

    def _update_daily_summary(self, trade: TradeRecord):
        """Update daily summary with new trade."""
        date = trade.exit_time[:10]  # YYYY-MM-DD

        if date not in self.daily_summaries:
            self.daily_summaries[date] = {
                'date': date,
                'trades': 0,
                'winners': 0,
                'losers': 0,
                'total_pnl': 0,
                'net_pnl': 0,
                'total_costs': 0,
                'symbols': set(),
            }

        summary = self.daily_summaries[date]
        summary['trades'] += 1
        summary['total_pnl'] += trade.pnl
        summary['net_pnl'] += trade.net_pnl
        summary['total_costs'] += trade.costs
        summary['symbols'].add(trade.symbol)

        if trade.net_pnl >= 0:
            summary['winners'] += 1
        else:
            summary['losers'] += 1

    def get_daily_report(self, date: Optional[str] = None) -> dict:
        """
        Get daily report.

        Args:
            date: Date string (YYYY-MM-DD), defaults to today

        Returns:
            Daily summary dict
        """
        if date is None:
            date = datetime.now().strftime('%Y-%m-%d')

        return self.daily_summaries.get(date, {
            'date': date,
            'trades': 0,
            'winners': 0,
            'losers': 0,
            'total_pnl': 0,
            'net_pnl': 0,
            'total_costs': 0,
            'symbols': set(),
        })

    def get_performance_summary(self) -> dict:
        """Get overall performance summary."""
        if not self.trades:
            return {
                'total_trades': 0,
                'winners': 0,
                'losers': 0,
                'win_rate': 0,
                'total_pnl': 0,
                'net_pnl': 0,
                'total_costs': 0,
                'avg_win': 0,
                'avg_loss': 0,
                'profit_factor': 0,
            }

        winners = [t for t in self.trades if t.net_pnl > 0]
        losers = [t for t in self.trades if t.net_pnl <= 0]

        total_pnl = sum(t.pnl for t in self.trades)
        net_pnl = sum(t.net_pnl for t in self.trades)
        total_costs = sum(t.costs for t in self.trades)

        total_wins = sum(t.net_pnl for t in winners)
        total_losses = abs(sum(t.net_pnl for t in losers))

        avg_win = total_wins / len(winners) if winners else 0
        avg_loss = total_losses / len(losers) if losers else 0

        profit_factor = total_wins / total_losses if total_losses > 0 else float('inf')

        return {
            'total_trades': len(self.trades),
            'winners': len(winners),
            'losers': len(losers),
            'win_rate': len(winners) / len(self.trades) * 100,
            'total_pnl': round(total_pnl, 2),
            'net_pnl': round(net_pnl, 2),
            'total_costs': round(total_costs, 2),
            'avg_win': round(avg_win, 2),
            'avg_loss': round(avg_loss, 2),
            'profit_factor': round(profit_factor, 2),
        }

    def get_symbol_performance(self) -> Dict[str, dict]:
        """Get performance breakdown by symbol."""
        symbol_stats = {}

        for trade in self.trades:
            if trade.symbol not in symbol_stats:
                symbol_stats[trade.symbol] = {
                    'symbol': trade.symbol,
                    'trades': 0,
                    'winners': 0,
                    'losers': 0,
                    'net_pnl': 0,
                    'total_costs': 0,
                }

            stats = symbol_stats[trade.symbol]
            stats['trades'] += 1
            stats['net_pnl'] += trade.net_pnl
            stats['total_costs'] += trade.costs

            if trade.net_pnl > 0:
                stats['winners'] += 1
            else:
                stats['losers'] += 1

        # Calculate win rates
        for symbol, stats in symbol_stats.items():
            stats['win_rate'] = (
                stats['winners'] / stats['trades'] * 100
                if stats['trades'] > 0 else 0
            )
            stats['net_pnl'] = round(stats['net_pnl'], 2)
            stats['total_costs'] = round(stats['total_costs'], 2)
            stats['win_rate'] = round(stats['win_rate'], 1)

        return symbol_stats

    def get_strategy_performance(self, include_test: bool = True) -> Dict[int, dict]:
        """Get performance breakdown by strategy for multi-strategy tracking.

        Args:
            include_test: If False, exclude trades marked as test/seeded data
        """
        strategy_stats = {}

        for trade in self.trades:
            # Skip test trades if requested
            if not include_test and getattr(trade, 'is_test', False):
                continue

            strategy_id = trade.strategy_id or 0
            if strategy_id not in strategy_stats:
                strategy_stats[strategy_id] = {
                    'strategy_id': strategy_id,
                    'strategy_name': trade.strategy_name or 'Unknown',
                    'trades': 0,
                    'winners': 0,
                    'losers': 0,
                    'total_pnl': 0,
                    'net_pnl': 0,
                    'total_costs': 0,
                    'test_trades': 0,
                    'symbols': set(),
                }

            stats = strategy_stats[strategy_id]
            stats['trades'] += 1
            stats['total_pnl'] += trade.pnl
            stats['net_pnl'] += trade.net_pnl
            stats['total_costs'] += trade.costs
            stats['symbols'].add(trade.symbol)

            # Track test trades separately
            if getattr(trade, 'is_test', False):
                stats['test_trades'] += 1

            if trade.net_pnl > 0:
                stats['winners'] += 1
            else:
                stats['losers'] += 1

        # Calculate win rates and convert sets to lists
        for strategy_id, stats in strategy_stats.items():
            stats['win_rate'] = (
                stats['winners'] / stats['trades'] * 100
                if stats['trades'] > 0 else 0
            )
            stats['total_pnl'] = round(stats['total_pnl'], 2)
            stats['net_pnl'] = round(stats['net_pnl'], 2)
            stats['total_costs'] = round(stats['total_costs'], 2)
            stats['win_rate'] = round(stats['win_rate'], 1)
            stats['symbols'] = list(stats['symbols'])
            stats['symbol_count'] = len(stats['symbols'])
            stats['has_test_data'] = stats['test_trades'] > 0

        return strategy_stats

    def display_strategy_performance(self):
        """Display performance by strategy (for multi-strategy bots)."""
        strategy_stats = self.get_strategy_performance()

        if not strategy_stats:
            console.print("[yellow]No strategy data available[/yellow]")
            return

        # Sort by net P&L
        sorted_stats = sorted(
            strategy_stats.values(),
            key=lambda x: x['net_pnl'],
            reverse=True
        )

        console.print("\n[bold cyan]═══ Strategy Performance ═══[/bold cyan]")

        table = Table()
        table.add_column("Strategy", style="cyan")
        table.add_column("Trades", justify="right")
        table.add_column("Win Rate", justify="right")
        table.add_column("Net P&L", justify="right")
        table.add_column("Symbols", justify="right")

        for stats in sorted_stats:
            pnl_color = "green" if stats['net_pnl'] >= 0 else "red"
            table.add_row(
                stats['strategy_name'],
                str(stats['trades']),
                f"{stats['win_rate']:.1f}%",
                f"[{pnl_color}]₹{stats['net_pnl']:,.0f}[/{pnl_color}]",
                str(stats['symbol_count']),
            )

        console.print(table)

    def display_summary(self):
        """Display performance summary."""
        summary = self.get_performance_summary()

        console.print("\n[bold cyan]═══ Trading Performance Summary ═══[/bold cyan]")

        table = Table()
        table.add_column("Metric", style="cyan")
        table.add_column("Value", justify="right")

        table.add_row("Total Trades", str(summary['total_trades']))
        table.add_row("Winners", str(summary['winners']))
        table.add_row("Losers", str(summary['losers']))
        table.add_row("Win Rate", f"{summary['win_rate']:.1f}%")
        table.add_row("Total P&L (gross)", f"₹{summary['total_pnl']:,.0f}")
        table.add_row("Total P&L (net)", f"₹{summary['net_pnl']:,.0f}")
        table.add_row("Total Costs", f"₹{summary['total_costs']:,.0f}")
        table.add_row("Avg Win", f"₹{summary['avg_win']:,.0f}")
        table.add_row("Avg Loss", f"₹{summary['avg_loss']:,.0f}")
        table.add_row("Profit Factor", f"{summary['profit_factor']:.2f}")

        console.print(table)

    def load_all_journals(self, days: int = 30) -> int:
        """
        Load all journal files from the past N days.

        Args:
            days: Number of days to look back

        Returns:
            Number of trades loaded
        """
        from datetime import datetime, timedelta

        loaded_trades = 0
        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')
            journal_file = self.journal_dir / f"journal_{date}.json"
            if journal_file.exists():
                try:
                    with open(journal_file, 'r') as f:
                        data = json.load(f)

                    for trade_data in data.get('trades', []):
                        # Check if trade already exists (by trade_id)
                        existing_ids = [t.trade_id for t in self.trades]
                        if trade_data.get('trade_id') not in existing_ids:
                            trade = TradeRecord(
                                trade_id=trade_data.get('trade_id', ''),
                                symbol=trade_data['symbol'],
                                side=trade_data['side'],
                                quantity=trade_data['quantity'],
                                entry_price=trade_data['entry_price'],
                                exit_price=trade_data['exit_price'],
                                entry_time=trade_data['entry_time'],
                                exit_time=trade_data['exit_time'],
                                pnl=trade_data['pnl'],
                                pnl_pct=trade_data['pnl_pct'],
                                exit_reason=trade_data['exit_reason'],
                                costs=trade_data.get('costs', 0),
                                net_pnl=trade_data.get('net_pnl', trade_data['pnl']),
                                sl_price=trade_data.get('sl_price', 0),
                                tp_price=trade_data.get('tp_price', 0),
                                peak_price=trade_data.get('peak_price', 0),
                                low_price=trade_data.get('low_price', 0),
                                notes=trade_data.get('notes', ''),
                                strategy_id=trade_data.get('strategy_id', 0),
                                strategy_name=trade_data.get('strategy_name', ''),
                            )
                            self.trades.append(trade)
                            self._update_daily_summary(trade)
                            loaded_trades += 1

                except Exception as e:
                    console.print(f"[yellow]Could not load journal {date}: {e}[/yellow]")

        if loaded_trades > 0:
            console.print(f"[green]Loaded {loaded_trades} historical trades[/green]")

        return loaded_trades

    def display_symbol_performance(self, top_n: int = 10):
        """Display performance by symbol."""
        symbol_stats = self.get_symbol_performance()

        # Sort by net P&L
        sorted_stats = sorted(
            symbol_stats.values(),
            key=lambda x: x['net_pnl'],
            reverse=True
        )

        console.print(f"\n[bold cyan]═══ Top {top_n} Symbols by P&L ═══[/bold cyan]")

        table = Table()
        table.add_column("#", width=3)
        table.add_column("Symbol", style="cyan")
        table.add_column("Trades", justify="right")
        table.add_column("Win Rate", justify="right")
        table.add_column("Net P&L", justify="right")

        for i, stats in enumerate(sorted_stats[:top_n], 1):
            pnl_color = "green" if stats['net_pnl'] >= 0 else "red"
            table.add_row(
                str(i),
                stats['symbol'],
                str(stats['trades']),
                f"{stats['win_rate']:.1f}%",
                f"₹{stats['net_pnl']:,.0f}",
            )

        console.print(table)

    def export_to_csv(self, filepath: Optional[str] = None) -> str:
        """Export trades to CSV."""
        if filepath is None:
            filepath = self.journal_dir / f"trades_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        else:
            filepath = Path(filepath)

        with open(filepath, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'trade_id', 'symbol', 'side', 'quantity',
                'entry_price', 'exit_price', 'entry_time', 'exit_time',
                'pnl', 'pnl_pct', 'exit_reason', 'costs', 'net_pnl',
                'sl_price', 'tp_price', 'peak_price', 'low_price', 'notes',
                'strategy_id', 'strategy_name'
            ])
            writer.writeheader()
            for trade in self.trades:
                writer.writerow(asdict(trade))

        console.print(f"[green]Exported {len(self.trades)} trades to {filepath}[/green]")
        return str(filepath)

    def save_journal(self):
        """Save journal to JSON file."""
        filepath = self.journal_dir / f"journal_{datetime.now().strftime('%Y%m%d')}.json"

        data = {
            'trades': [asdict(t) for t in self.trades],
            'daily_summaries': {
                k: {**v, 'symbols': list(v['symbols'])}
                for k, v in self.daily_summaries.items()
            },
            'last_updated': datetime.now().isoformat(),
        }

        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)

        console.print(f"[green]Saved journal to {filepath}[/green]")

    def load_journal(self, filepath: str):
        """Load journal from JSON file."""
        with open(filepath, 'r') as f:
            data = json.load(f)

        self.trades = [TradeRecord(**t) for t in data.get('trades', [])]

        for date, summary in data.get('daily_summaries', {}).items():
            summary['symbols'] = set(summary.get('symbols', []))
            self.daily_summaries[date] = summary

        console.print(f"[green]Loaded {len(self.trades)} trades from {filepath}[/green]")

    def log_backtest_trades(self, symbol: str, trades: List[dict], strategy_name: str = "backtest"):
        """
        Log trades from a backtest run.

        Args:
            symbol: Stock symbol
            trades: List of trade dicts from backtest
            strategy_name: Name of the strategy used

        Returns:
            Number of trades logged
        """
        count = 0
        for i, trade in enumerate(trades):
            # Convert backtest trade format to journal format
            journal_trade = {
                'trade_id': f"BT-{symbol}-{strategy_name}-{i+1:04d}",
                'symbol': symbol,
                'side': trade.get('side', 'LONG'),
                'quantity': trade.get('quantity', 0),
                'entry_price': trade.get('entry_price', 0),
                'exit_price': trade.get('exit_price', 0),
                'entry_time': trade.get('entry_time', ''),
                'exit_time': trade.get('exit_time', ''),
                'pnl': trade.get('gross_pnl', 0),
                'pnl_pct': trade.get('gross_pnl_pct', 0),
                'exit_reason': trade.get('exit_reason', 'UNKNOWN'),
                'costs': trade.get('trading_costs', 0),
                'net_pnl': trade.get('net_pnl', 0),
                'sl_price': 0,
                'tp_price': 0,
                'peak_price': trade.get('peak_price', 0),
                'low_price': trade.get('low_price', 0),
            }
            self.log_trade(journal_trade, notes=f"Backtest: {strategy_name}")
            count += 1

        if count > 0:
            self.save_journal()
            console.print(f"[green]Logged {count} backtest trades for {symbol}[/green]")

        return count


# User-scoped instances for multi-user API
_journals: Dict[int, TradeJournal] = {}
_default_journal: Optional[TradeJournal] = None


def get_journal(user_id: Optional[int] = None) -> TradeJournal:
    """
    Get journal instance for a specific user.

    Args:
        user_id: User ID. If None, returns the default (legacy) instance.

    Returns:
        TradeJournal instance for the user.
    """
    global _default_journal

    if user_id is None:
        # Legacy single-user mode
        if _default_journal is None:
            _default_journal = TradeJournal()
            # Try to load today's journal file
            today = datetime.now().strftime('%Y%m%d')
            journal_file = _default_journal.journal_dir / f"journal_{today}.json"
            if journal_file.exists():
                try:
                    _default_journal.load_journal(str(journal_file))
                except Exception as e:
                    console.print(f"[yellow]Could not load journal: {e}[/yellow]")
        return _default_journal

    if user_id not in _journals:
        _journals[user_id] = TradeJournal(user_id=user_id)
        # Try to load today's journal file
        today = datetime.now().strftime('%Y%m%d')
        journal_file = _journals[user_id].journal_dir / f"journal_{today}.json"
        if journal_file.exists():
            try:
                _journals[user_id].load_journal(str(journal_file))
            except Exception as e:
                console.print(f"[yellow]Could not load journal for user {user_id}: {e}[/yellow]")

    return _journals[user_id]


def clear_journal(user_id: int):
    """Clear a user's journal instance (e.g., on logout)."""
    if user_id in _journals:
        del _journals[user_id]


if __name__ == '__main__':
    # Demo
    journal = TradeJournal()

    # Log some sample trades
    sample_trades = [
        {
            'trade_id': 'TRADE-001',
            'symbol': 'NETWEB',
            'side': 'BUY',
            'quantity': 100,
            'entry_price': 3500,
            'exit_price': 3920,
            'entry_time': '2024-01-15T10:15:00',
            'exit_time': '2024-01-15T12:30:00',
            'pnl': 42000,
            'pnl_pct': 12,
            'exit_reason': 'TP',
            'costs': 250,
            'net_pnl': 41750,
        },
        {
            'trade_id': 'TRADE-002',
            'symbol': 'APEX',
            'side': 'BUY',
            'quantity': 200,
            'entry_price': 440,
            'exit_price': 425,
            'entry_time': '2024-01-15T11:00:00',
            'exit_time': '2024-01-15T14:00:00',
            'pnl': -3000,
            'pnl_pct': -3.4,
            'exit_reason': 'SL',
            'costs': 180,
            'net_pnl': -3180,
        },
    ]

    for trade in sample_trades:
        journal.log_trade(trade)

    journal.display_summary()
    journal.display_symbol_performance()
