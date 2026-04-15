from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum


class OrderSide(Enum):
    BUY = "BUY"
    SELL = "SELL"


@dataclass
class StrategyAllocation:
    strategy_id: int
    strategy_name: str
    allocation_pct: float
    max_positions: int
    capital_used: float = 0.0
    positions_count: int = 0
    realized_pnl: float = 0.0


@dataclass
class SharedPosition:
    symbol: str
    side: OrderSide
    quantity: int
    entry_price: float
    stop_loss: float
    take_profit: float
    entry_time: datetime
    strategy_id: int
    strategy_name: str
    strategy_type: str = ""
    current_price: float = 0.0
    unrealized_pnl: float = 0.0
    unrealized_pnl_pct: float = 0.0
    peak_price: float = 0.0
    low_price: float = float('inf')
    metadata: dict = field(default_factory=dict)


@dataclass
class CompletedTrade:
    trade_id: str
    symbol: str
    side: OrderSide
    quantity: int
    entry_price: float
    exit_price: float
    entry_time: datetime
    exit_time: datetime
    pnl: float
    pnl_pct: float
    exit_reason: str
    costs: float = 0.0
    net_pnl: float = 0.0
    strategy_id: int = 0
    strategy_name: str = ""
    sl_price: float = 0.0
    tp_price: float = 0.0
