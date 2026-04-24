from typing import Optional, List
from pydantic import BaseModel


class StrategyCreate(BaseModel):
    """Model for creating a new strategy variation."""
    name: str
    strategy_type: str
    parent_id: Optional[int] = None
    description: Optional[str] = None
    # ORB parameters
    or_minutes: Optional[int] = None
    sl_pct: Optional[float] = None
    tp_pct: Optional[float] = None
    min_or_range_pct: Optional[float] = None
    max_or_range_pct: Optional[float] = None
    # Risk parameters
    max_positions: Optional[int] = None
    max_capital_per_trade_pct: Optional[float] = None
    max_daily_loss_pct: Optional[float] = None
    max_total_exposure_pct: Optional[float] = None
    risk_per_trade_pct: Optional[float] = None
    min_trade_value: Optional[float] = None
    max_trade_value: Optional[float] = None
    # Runner parameters
    cooldown_minutes: Optional[int] = None
    max_distance_from_or_pct: Optional[float] = None
    enable_shorts: Optional[bool] = None
    eod_exit_hour: Optional[int] = None
    eod_exit_minute: Optional[int] = None
    min_rr_ratio: Optional[float] = None
    # Screener Profiles (multi-select)
    screener_profiles: Optional[List[str]] = None


class StrategyUpdate(BaseModel):
    """Model for updating a strategy."""
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    # All other optional fields same as create
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
    enable_shorts: Optional[bool] = None
    eod_exit_hour: Optional[int] = None
    eod_exit_minute: Optional[int] = None
    min_rr_ratio: Optional[float] = None
    # Screener Profiles (multi-select)
    screener_profiles: Optional[List[str]] = None
