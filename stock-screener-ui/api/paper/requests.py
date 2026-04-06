"""
Pydantic request/response models for Paper Trading API.
"""

from pydantic import BaseModel
from typing import Optional


class OrderRequest(BaseModel):
    symbol: str
    side: str
    quantity: int
    price: float
    stop_loss: float
    take_profit: float


class ClosePositionRequest(BaseModel):
    symbol: str
    exit_price: float
    reason: str = "MANUAL"


class ResetRequest(BaseModel):
    capital: float = 1000000


class UpdatePricesRequest(BaseModel):
    prices: dict


class StrategyConfigUpdate(BaseModel):
    or_minutes: Optional[int] = None
    sl_pct: Optional[float] = None
    tp_pct: Optional[float] = None
    min_or_range_pct: Optional[float] = None
    max_or_range_pct: Optional[float] = None
    max_positions: Optional[int] = None
    max_capital_per_trade_pct: Optional[float] = None
    max_daily_loss_pct: Optional[float] = None
    max_total_exposure_pct: Optional[float] = None
    risk_per_trade_pct: Optional[float] = None
    min_trade_value: Optional[float] = None
    max_trade_value: Optional[float] = None
    cooldown_minutes: Optional[int] = None
    max_distance_from_or_pct: Optional[float] = None
    brokerage_pct: Optional[float] = None
    min_brokerage: Optional[float] = None
    stt_pct: Optional[float] = None
    exchange_pct: Optional[float] = None
    sebi_pct: Optional[float] = None
    stamp_pct: Optional[float] = None
    gst_pct: Optional[float] = None
