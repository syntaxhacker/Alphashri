from pydantic import BaseModel, Field
from typing import Optional, List, Dict


class StrategyAllocation(BaseModel):
    strategy_id: str
    max_positions: int = Field(default=3, ge=1, le=10)
    capital_allocation_pct: float = Field(default=0.20, ge=0.05, le=1.0)


class BotCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    is_active: bool = True
    max_total_positions: int = Field(default=10, ge=1, le=20)
    max_total_capital_pct: float = Field(default=0.80, ge=0.1, le=1.0)
    max_daily_loss_pct: float = Field(default=0.03, ge=0.01, le=0.20)
    strategies: List[StrategyAllocation] = Field(default_factory=list)


class BotUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None
    max_total_positions: Optional[int] = Field(None, ge=1, le=20)
    max_total_capital_pct: Optional[float] = Field(None, ge=0.1, le=1.0)
    max_daily_loss_pct: Optional[float] = Field(None, ge=0.01, le=0.20)
    strategies: Optional[List[StrategyAllocation]] = None


class BotResponse(BaseModel):
    id: str
    uuid: str
    name: str
    is_active: bool
    max_total_positions: int
    max_total_capital_pct: float
    max_daily_loss_pct: float = 0.03
    strategies: List[dict]
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    status: Optional[str] = None
    process_id: Optional[int] = None
    running: bool = False
    pid: Optional[int] = None
    error: Optional[str] = None
    watchlist: List[str] = []


class BotStatusResponse(BaseModel):
    bot_id: str
    bot_name: str
    running: bool
    pid: Optional[int] = None
    status_unknown: bool = False
    portfolio: Optional[dict] = None
    strategies: Optional[Dict[str, dict]] = None
    positions: Optional[List[dict]] = None
    last_update: Optional[str] = None


class StrategyStatusResponse(BaseModel):
    strategy_id: str
    strategy_name: str
    status: str
    positions_count: int
    max_positions: int
    capital_used: float
    allocated_capital: float
    pnl: float
    trades_count: int


class BotSummaryStrategy(BaseModel):
    id: str
    name: str
    strategy_type: str


class BotSummaryResponse(BaseModel):
    id: str
    name: str
    is_active: bool
    running: bool
    pid: Optional[int] = None
    status: str = "STOPPED"
    position_count: int = 0
    strategies: List[BotSummaryStrategy] = []
