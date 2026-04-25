"""Data classes and constants for the trade journal."""

from dataclasses import dataclass


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
    peak_price: float = 0.0
    low_price: float = 0.0
    notes: str = ""
    strategy_id: int = 0
    strategy_name: str = ""
    bot_id: int = 0
    bot_name: str = ""
    source: str = "live"
    is_test: bool = False
