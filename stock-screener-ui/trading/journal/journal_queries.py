"""Query and display methods for TradeJournal."""

import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import config

from rich.table import Table

from .journal_models import TradeRecord


class QueryMixin:

    def get_daily_report(self, date: Optional[str] = None) -> dict:
        """
        Get daily report.

        Args:
            date: Date string (YYYY-MM-DD), defaults to today

        Returns:
            Daily summary dict
        """
        if date is None:
            date = datetime.now(config.IST).strftime('%Y-%m-%d')

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
                'sharpe_ratio': 0,
                'max_drawdown': 0,
                'max_drawdown_pct': 0,
            }

        import math
        import statistics

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

        returns_pct = [t.pnl_pct for t in self.trades]
        if len(returns_pct) > 1:
            mean_return = statistics.mean(returns_pct)
            stdev_return = statistics.stdev(returns_pct)
            sharpe_ratio = (mean_return / stdev_return) * math.sqrt(252) if stdev_return > 0 else 0
        else:
            sharpe_ratio = 0

        cumulative_pnl = 0
        peak = 0
        max_drawdown = 0

        initial_capital = 1000000
        current_equity = initial_capital
        peak_equity = initial_capital
        max_drawdown_pct = 0

        for t in self.trades:
            cumulative_pnl += t.net_pnl
            current_equity = initial_capital + cumulative_pnl

            if current_equity > peak_equity:
                peak_equity = current_equity

            drawdown = peak_equity - current_equity
            if drawdown > max_drawdown:
                max_drawdown = drawdown

            if peak_equity > 0:
                drawdown_pct = (drawdown / peak_equity) * 100
                if drawdown_pct > max_drawdown_pct:
                    max_drawdown_pct = drawdown_pct

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
            'sharpe_ratio': round(sharpe_ratio, 2),
            'max_drawdown': round(max_drawdown, 2),
            'max_drawdown_pct': round(max_drawdown_pct, 2),
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

            if getattr(trade, 'is_test', False):
                stats['test_trades'] += 1

            if trade.net_pnl > 0:
                stats['winners'] += 1
            else:
                stats['losers'] += 1

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
        from trading.journal import console
        strategy_stats = self.get_strategy_performance()

        if not strategy_stats:
            console.print("[yellow]No strategy data available[/yellow]")
            return

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
        from trading.journal import console
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
        table.add_row("Sharpe Ratio", f"{summary['sharpe_ratio']:.2f}")
        table.add_row("Max Drawdown", f"₹{summary['max_drawdown']:,.0f} ({summary['max_drawdown_pct']:.2f}%)")

        console.print(table)

    def display_symbol_performance(self, top_n: int = 10):
        """Display performance by symbol."""
        from trading.journal import console
        symbol_stats = self.get_symbol_performance()

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
