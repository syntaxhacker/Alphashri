"""
Stub for removed journal module.

Kept so existing test files that import or patch trading.journal
can still be collected and run. All real journal functionality has
been migrated to the database-backed trade storage in api/paper/.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class TradeRecord:
    trade_id: str = ""
    symbol: str = ""
    side: str = ""
    quantity: int = 0
    entry_price: float = 0.0
    exit_price: float = 0.0
    entry_time: str = ""
    exit_time: str = ""
    pnl: float = 0.0
    pnl_pct: float = 0.0
    exit_reason: str = ""
    costs: float = 0.0
    net_pnl: float = 0.0
    peak_price: float = 0.0
    low_price: float = 0.0
    notes: str = ""
    strategy_id: int = 0
    strategy_name: str = ""
    source: str = ""
    is_test: bool = False


_journals: Dict[str, Any] = {}


class TradeJournal:
    def __init__(self, journal_dir: str = "", user_id: int = 0):
        self.journal_dir = journal_dir
        self.user_id = user_id
        self.trades: List[TradeRecord] = []

    def log_trade(self, trade_data: dict, **kwargs) -> TradeRecord:
        record = TradeRecord(**{k: v for k, v in trade_data.items() if k in TradeRecord.__dataclass_fields__})
        self.trades.append(record)
        return record

    def save_journal(self) -> None:
        pass

    def get_strategy_performance(self, *args, **kwargs) -> dict:
        return {}

    def get_performance_summary(self, *args, **kwargs) -> dict:
        return {}

    def get_daily_report(self, *args, **kwargs) -> dict:
        return {}

    def export_to_csv(self, *args, **kwargs) -> str:
        return ""

    def load_all_journals(self, *args, **kwargs) -> None:
        pass


def get_journal(*args, **kwargs) -> TradeJournal:
    return TradeJournal()
