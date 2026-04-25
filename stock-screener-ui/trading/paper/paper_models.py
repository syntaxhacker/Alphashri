"""Data classes and enums for paper trading."""

from enum import Enum
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


class OrderSide(Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderStatus(Enum):
    PENDING = "PENDING"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"


class ExitReason(Enum):
    TAKE_PROFIT = "TP"
    STOP_LOSS = "SL"
    END_OF_DAY = "EOD"
    MANUAL = "MANUAL"


@dataclass
class PaperOrder:
    order_id: str
    symbol: str
    side: OrderSide
    quantity: int
    price: float
    stop_loss: float
    take_profit: float
    timestamp: datetime
    status: OrderStatus = OrderStatus.PENDING
    fill_price: Optional[float] = None
    fill_time: Optional[datetime] = None


@dataclass
class PaperPosition:
    symbol: str
    side: OrderSide
    quantity: int
    entry_price: float
    stop_loss: float
    take_profit: float
    entry_time: datetime
    current_price: float = 0.0
    unrealized_pnl: float = 0.0
    unrealized_pnl_pct: float = 0.0
    peak_price: float = 0.0
    low_price: float = float('inf')
    strategy_id: int = 0
    strategy_name: str = ""
    strategy_type: str = ""




@dataclass
class PaperTrade:
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
    exit_reason: ExitReason
    costs: float = 0.0
    net_pnl: float = 0.0
    peak_price: float = 0.0
    low_price: float = 0.0
    strategy_id: int = 0
    strategy_name: str = ""
    reason: str = ""
