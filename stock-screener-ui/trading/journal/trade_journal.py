"""Core TradeJournal class with logging and instance management."""

import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import config

from .journal_models import TradeRecord
from .journal_queries import QueryMixin
from .journal_storage import StorageMixin


class TradeJournal(QueryMixin, StorageMixin):
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
            self.journal_dir = Path(__file__).parent.parent.parent / "journals" / str(user_id)
        else:
            self.journal_dir = Path(__file__).parent.parent.parent / "journals"

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
        date = trade.exit_time[:10]

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
            from trading.journal import console
            console.print(f"[green]Logged {count} backtest trades for {symbol}[/green]")

        return count


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
        if _default_journal is None:
            _default_journal = TradeJournal()
            today = datetime.now(config.IST).strftime('%Y%m%d')
            journal_file = _default_journal.journal_dir / f"journal_{today}.json"
            if journal_file.exists():
                try:
                    _default_journal.load_journal(str(journal_file))
                except Exception as e:
                    from trading.journal import console
                    console.print(f"[yellow]Could not load journal: {e}[/yellow]")
        return _default_journal

    if user_id not in _journals:
        _journals[user_id] = TradeJournal(user_id=user_id)
        today = datetime.now(config.IST).strftime('%Y%m%d')
        journal_file = _journals[user_id].journal_dir / f"journal_{today}.json"
        if journal_file.exists():
            try:
                _journals[user_id].load_journal(str(journal_file))
            except Exception as e:
                from trading.journal import console
                console.print(f"[yellow]Could not load journal for user {user_id}: {e}[/yellow]")

    return _journals[user_id]


def clear_journal(user_id: int):
    """Clear a user's journal instance (e.g., on logout)."""
    if user_id in _journals:
        del _journals[user_id]


if __name__ == '__main__':
    journal = TradeJournal()

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
