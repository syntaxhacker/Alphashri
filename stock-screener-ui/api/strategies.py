"""
Strategy Management API

Provides endpoints for managing strategy configurations and variations.
"""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import StrategyConfig, BotConfig, User
from api.auth import get_current_user_optional

router = APIRouter(prefix="/api/strategies", tags=["strategies"])


# Request/Response models
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


# Strategy endpoints
@router.get("")
async def list_strategies(
    include_templates: bool = False,
    strategy_type: Optional[str] = None,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """List all strategy configurations."""
    query = db.query(StrategyConfig)

    if not include_templates:
        query = query.filter(StrategyConfig.is_template == False)

    if strategy_type:
        query = query.filter(StrategyConfig.strategy_type == strategy_type)

    strategies = query.order_by(StrategyConfig.strategy_type, StrategyConfig.name).all()

    return {
        "strategies": [s.to_dict() for s in strategies],
        "count": len(strategies),
    }


@router.get("/variations")
async def list_all_variations(
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """List all strategy variations and templates for selection."""
    variations = db.query(StrategyConfig).filter(
        StrategyConfig.is_active == True,
    ).order_by(StrategyConfig.is_template.desc(), StrategyConfig.strategy_type, StrategyConfig.name).all()

    return [v.to_dict() for v in variations]


@router.get("/{strategy_id}")
async def get_strategy(
    strategy_id: int,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Get a specific strategy by ID."""
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()

    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Get variations if this is a template
    variations = []
    if strategy.is_template:
        variations = db.query(StrategyConfig).filter(
            StrategyConfig.parent_id == strategy_id,
            StrategyConfig.is_active == True,
        ).all()

    return {
        "strategy": strategy.to_dict(),
        "variations": [v.to_dict() for v in variations],
    }


@router.post("")
async def create_strategy(
    request: StrategyCreate,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Create a new strategy variation."""
    # Check if name already exists
    existing = db.query(StrategyConfig).filter(
        StrategyConfig.name == request.name
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Strategy name already exists")

    # Get parent template defaults if parent_id provided
    defaults = {}
    if request.parent_id:
        parent = db.query(StrategyConfig).filter(
            StrategyConfig.id == request.parent_id
        ).first()

        if not parent:
            raise HTTPException(status_code=400, detail="Parent strategy not found")

        # Copy parent defaults
        defaults = {
            "or_minutes": parent.or_minutes,
            "sl_pct": parent.sl_pct,
            "tp_pct": parent.tp_pct,
            "min_or_range_pct": parent.min_or_range_pct,
            "max_or_range_pct": parent.max_or_range_pct,
            "max_positions": parent.max_positions,
            "max_capital_per_trade_pct": parent.max_capital_per_trade_pct,
            "max_daily_loss_pct": parent.max_daily_loss_pct,
            "max_total_exposure_pct": parent.max_total_exposure_pct,
            "risk_per_trade_pct": parent.risk_per_trade_pct,
            "min_trade_value": parent.min_trade_value,
            "max_trade_value": parent.max_trade_value,
            "cooldown_minutes": parent.cooldown_minutes,
            "max_distance_from_or_pct": parent.max_distance_from_or_pct,
            "brokerage_pct": parent.brokerage_pct,
            "min_brokerage": parent.min_brokerage,
            "stt_pct": parent.stt_pct,
            "exchange_pct": parent.exchange_pct,
            "sebi_pct": parent.sebi_pct,
            "stamp_pct": parent.stamp_pct,
            "gst_pct": parent.gst_pct,
        }

    # Override with provided values
    strategy_data = {
        "name": request.name,
        "strategy_type": request.strategy_type,
        "parent_id": request.parent_id,
        "description": request.description,
        "is_template": False,
        "is_active": True,
    }

    # Add all parameters with request values overriding defaults
    for field in [
        "or_minutes", "sl_pct", "tp_pct", "min_or_range_pct", "max_or_range_pct",
        "max_positions", "max_capital_per_trade_pct", "max_daily_loss_pct",
        "max_total_exposure_pct", "risk_per_trade_pct", "min_trade_value",
        "max_trade_value", "cooldown_minutes", "max_distance_from_or_pct",
    ]:
        request_val = getattr(request, field, None)
        strategy_data[field] = request_val if request_val is not None else defaults.get(field)

    strategy = StrategyConfig(**strategy_data)
    db.add(strategy)
    db.commit()
    db.refresh(strategy)

    return {
        "status": "success",
        "message": f"Strategy '{request.name}' created",
        "strategy": strategy.to_dict(),
    }


@router.put("/{strategy_id}")
async def update_strategy(
    strategy_id: int,
    request: StrategyUpdate,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Update a strategy configuration."""
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()

    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Don't allow editing templates
    if strategy.is_template:
        raise HTTPException(status_code=400, detail="Cannot edit template strategies")

    # Update fields
    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None and hasattr(strategy, key):
            setattr(strategy, key, value)

    # If setting as default, unset other defaults
    if request.is_default:
        db.query(StrategyConfig).filter(
            StrategyConfig.id != strategy_id,
            StrategyConfig.is_default == True,
        ).update({"is_default": False})

    db.commit()
    db.refresh(strategy)

    return {
        "status": "success",
        "message": f"Strategy '{strategy.name}' updated",
        "strategy": strategy.to_dict(),
    }


@router.delete("/{strategy_id}")
async def delete_strategy(
    strategy_id: int,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Delete a strategy (soft delete by setting is_active=False)."""
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()

    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Don't allow deleting templates
    if strategy.is_template:
        raise HTTPException(status_code=400, detail="Cannot delete template strategies")

    # Soft delete
    strategy.is_active = False
    db.commit()

    return {
        "status": "success",
        "message": f"Strategy '{strategy.name}' deleted",
    }


@router.get("/{strategy_id}/performance")
async def get_strategy_performance(
    strategy_id: int,
    include_test: bool = True,  # Include test/seeded data by default
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Get performance statistics for a strategy."""
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()

    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Load trades from journal files and calculate performance
    user_id = user.id if user else 1
    all_trades = _load_all_trades(user_id)

    # Filter by strategy
    strategy_trades = [t for t in all_trades if t.get('strategy_id') == strategy_id]

    # Filter out test trades if requested
    if not include_test:
        strategy_trades = [t for t in strategy_trades if not t.get('is_test', False)]

    # Calculate stats
    total_trades = len(strategy_trades)
    winners = len([t for t in strategy_trades if t.get('net_pnl', 0) > 0])
    losers = len([t for t in strategy_trades if t.get('net_pnl', 0) < 0])
    win_rate = (winners / total_trades * 100) if total_trades > 0 else 0
    total_pnl = sum(t.get('pnl', 0) for t in strategy_trades)
    net_pnl = sum(t.get('net_pnl', 0) for t in strategy_trades)

    # Count test trades
    test_trades = len([t for t in strategy_trades if t.get('is_test', False)])

    return {
        "strategy_id": strategy_id,
        "strategy_name": strategy.name,
        "total_trades": total_trades,
        "winners": winners,
        "losers": losers,
        "win_rate": round(win_rate, 1),
        "total_pnl": round(total_pnl, 2),
        "net_pnl": round(net_pnl, 2),
        "test_trades": test_trades,
        "has_test_data": test_trades > 0,
    }


def _load_all_trades(user_id: int) -> list:
    """Load all trades from all journal files for a user."""
    import json
    from pathlib import Path

    journals_dir = Path(__file__).parent.parent / "journals" / str(user_id)
    if not journals_dir.exists():
        return []

    all_trades = []
    for journal_file in journals_dir.glob("journal_*.json"):
        try:
            with open(journal_file) as f:
                data = json.load(f)
            trades = data.get("trades", [])
            all_trades.extend(trades)
        except Exception:
            continue

    return all_trades


@router.get("/{strategy_id}/trades")
async def get_strategy_trades(
    strategy_id: int,
    limit: int = 50,
    include_test: bool = True,  # Include test/seeded data by default
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Get trades for a specific strategy."""
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()

    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Load trades from journal files
    user_id = user.id if user else 1
    all_trades = _load_all_trades(user_id)
    strategy_trades = [t for t in all_trades if t.get('strategy_id') == strategy_id]

    # Filter out test trades if requested
    if not include_test:
        strategy_trades = [t for t in strategy_trades if not t.get('is_test', False)]

    # Sort by exit time descending
    strategy_trades.sort(key=lambda t: t.get('exit_time', ''), reverse=True)

    return {
        "strategy_id": strategy_id,
        "strategy_name": strategy.name,
        "trades": strategy_trades[:limit],
        "total": len(strategy_trades),
    }


@router.get("/{strategy_id}/variations")
async def get_strategy_variations(
    strategy_id: int,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Get all variations of a template strategy."""
    parent = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()

    if not parent:
        raise HTTPException(status_code=404, detail="Strategy not found")

    if not parent.is_template:
        raise HTTPException(status_code=400, detail="Not a template strategy")

    variations = db.query(StrategyConfig).filter(
        StrategyConfig.parent_id == strategy_id,
        StrategyConfig.is_active == True,
    ).order_by(StrategyConfig.name).all()

    return {
        "parent": parent.to_dict(),
        "variations": [v.to_dict() for v in variations],
        "count": len(variations),
    }


# Bot configuration endpoints
@router.get("/bots")
async def list_bots(
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """List all bot configurations."""
    bots = db.query(BotConfig).order_by(BotConfig.name).all()

    return {
        "bots": [b.to_dict() for b in bots],
        "count": len(bots),
    }


@router.get("/bots/{bot_id}")
async def get_bot(
    bot_id: int,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Get a specific bot configuration."""
    bot = db.query(BotConfig).filter(BotConfig.id == bot_id).first()

    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    return {
        "bot": bot.to_dict(),
    }
