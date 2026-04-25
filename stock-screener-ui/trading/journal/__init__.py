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

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from rich.console import Console

console = Console()

from .journal_models import TradeRecord
from .trade_journal import (
    TradeJournal,
    get_journal,
    clear_journal,
    _journals,
    _default_journal,
)

__all__ = [
    'TradeRecord',
    'TradeJournal',
    'get_journal',
    'clear_journal',
    '_journals',
    '_default_journal',
    'console',
]
