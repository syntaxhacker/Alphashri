"""Trade journal loading for paper trading."""

import sys
from pathlib import Path
from datetime import datetime
from typing import List, Optional, Tuple
import json

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import config as app_config

from rich.console import Console

from .paper_models import PaperTrade, OrderSide, ExitReason

console = Console()

_EXIT_REASON_MAP = {
    'SL': ExitReason.STOP_LOSS,
    'TP': ExitReason.TAKE_PROFIT,
    'EOD': ExitReason.END_OF_DAY,
    'MANUAL': ExitReason.MANUAL,
}


def load_todays_trades(user_id: Optional[int] = None) -> Tuple[List[PaperTrade], int]:
    try:
        journal_file = _get_journal_path(user_id)
        if not journal_file.exists():
            return [], 0

        with open(journal_file) as f:
            data = json.load(f)

        today_trades = data.get('trades', [])
        trades = []
        max_counter = 0

        for trade_data in today_trades:
            try:
                trade = _parse_journal_trade(trade_data)
                trades.append(trade)
                trade_num = int(trade_data['trade_id'].split('-')[1])
                max_counter = max(max_counter, trade_num)
            except Exception as e:
                console.print(f"[yellow]Warning: Could not load trade {trade_data.get('trade_id')}: {e}[/yellow]")

        if trades:
            console.print(f"[green]Loaded {len(trades)} trades from journal[/green]")

        return trades, max_counter

    except Exception as e:
        console.print(f"[yellow]Warning: Could not load journal: {e}[/yellow]")
        return [], 0


def _get_journal_path(user_id: Optional[int]) -> Path:
    today_str = datetime.now(app_config.IST).strftime('%Y%m%d')
    base = Path(__file__).parent.parent.parent / 'journals'
    if user_id:
        return base / str(user_id) / f'journal_{today_str}.json'
    return base / f'journal_{today_str}.json'


def _parse_journal_trade(trade_data: dict) -> PaperTrade:
    exit_reason_str = trade_data.get('exit_reason', 'MANUAL')
    exit_reason = _EXIT_REASON_MAP.get(exit_reason_str, ExitReason.MANUAL)

    return PaperTrade(
        trade_id=trade_data['trade_id'],
        symbol=trade_data['symbol'],
        side=OrderSide.BUY if trade_data['side'] == 'BUY' else OrderSide.SELL,
        quantity=trade_data['quantity'],
        entry_price=trade_data['entry_price'],
        exit_price=trade_data['exit_price'],
        entry_time=datetime.fromisoformat(trade_data['entry_time']),
        exit_time=datetime.fromisoformat(trade_data['exit_time']),
        pnl=trade_data['pnl'],
        pnl_pct=trade_data['pnl_pct'],
        exit_reason=exit_reason,
        costs=trade_data.get('costs', 0),
        net_pnl=trade_data.get('net_pnl', 0),
        peak_price=trade_data.get('peak_price', 0),
        low_price=trade_data.get('low_price', 0),
        strategy_id=trade_data.get('strategy_id', 0),
        strategy_name=trade_data.get('strategy_name', ''),
    )
