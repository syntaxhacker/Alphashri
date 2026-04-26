"""File/DB storage logic for TradeJournal."""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import config

from .journal_models import TradeRecord


class StorageMixin:

    def save_journal(self):
        """Save journal to JSON file."""
        from dataclasses import asdict
        import json
        from trading.journal import console

        filepath = self.journal_dir / f"journal_{datetime.now(config.IST).strftime('%Y%m%d')}.json"

        data = {
            'trades': [asdict(t) for t in self.trades],
            'daily_summaries': {
                k: {**v, 'symbols': list(v['symbols'])}
                for k, v in self.daily_summaries.items()
            },
            'last_updated': datetime.now(config.IST).isoformat(),
        }

        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)

        console.print(f"[green]Saved journal to {filepath}[/green]")

    def load_journal(self, filepath: str):
        """Load journal from JSON file."""
        import json
        from trading.journal import console

        with open(filepath, 'r') as f:
            data = json.load(f)

        self.trades = [TradeRecord(**t) for t in data.get('trades', [])]

        for date, summary in data.get('daily_summaries', {}).items():
            summary['symbols'] = set(summary.get('symbols', []))
            self.daily_summaries[date] = summary

        console.print(f"[green]Loaded {len(self.trades)} trades from {filepath}[/green]")

    def load_all_journals(self, days: int = 30) -> int:
        """
        Load all journal files from the past N days.

        Args:
            days: Number of days to look back

        Returns:
            Number of trades loaded
        """
        import json
        from trading.journal import console

        loaded_trades = 0
        for i in range(days):
            date = (datetime.now(config.IST) - timedelta(days=i)).strftime('%Y%m%d')
            journal_file = self.journal_dir / f"journal_{date}.json"
            if journal_file.exists():
                try:
                    with open(journal_file, 'r') as f:
                        data = json.load(f)

                    for trade_data in data.get('trades', []):
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

    def export_to_csv(self, filepath: Optional[str] = None) -> str:
        """Export trades to CSV."""
        from dataclasses import asdict
        import csv
        from trading.journal import console

        if filepath is None:
            filepath = self.journal_dir / f"trades_{datetime.now(config.IST).strftime('%Y%m%d_%H%M%S')}.csv"
        else:
            filepath = Path(filepath)

        with open(filepath, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'trade_id', 'symbol', 'side', 'quantity',
                'entry_price', 'exit_price', 'entry_time', 'exit_time',
                'pnl', 'pnl_pct', 'exit_reason', 'costs', 'net_pnl',
                'sl_price', 'tp_price', 'peak_price', 'low_price', 'notes',
                'strategy_id', 'strategy_name', 'bot_id', 'bot_name', 'source', 'is_test'
            ])
            writer.writeheader()
            for trade in self.trades:
                writer.writerow(asdict(trade))

        console.print(f"[green]Exported {len(self.trades)} trades to {filepath}[/green]")
        return str(filepath)
