import asyncio
import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from api.auth import get_current_user
from db.database import get_db
from db.models import StrategyConfig, User
from api.strat_api.strat_models import StrategyCreate, StrategyUpdate


def _load_all_trades(user_id: int) -> list:
    """Load all trades from all journal files for a user."""
    import json
    from pathlib import Path

    journals_dir = Path(__file__).parent.parent.parent / "journals" / str(user_id)
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


def _sync_create_strategy(db, request):
    existing = db.query(StrategyConfig).filter(
        StrategyConfig.name == request.name
    ).first()
    if existing:
        return None, "name_exists"

    defaults = {}
    if request.parent_id:
        parent = db.query(StrategyConfig).filter(
            StrategyConfig.id == request.parent_id
        ).first()
        if not parent:
            return None, "parent_not_found"
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
            "enable_shorts": parent.enable_shorts,
            "eod_exit_hour": parent.eod_exit_hour,
            "eod_exit_minute": parent.eod_exit_minute,
            "screener_profiles": json.dumps(parent.screener_profiles) if parent.screener_profiles else None,
            "brokerage_pct": parent.brokerage_pct,
            "min_brokerage": parent.min_brokerage,
            "stt_pct": parent.stt_pct,
            "exchange_pct": parent.exchange_pct,
            "sebi_pct": parent.sebi_pct,
            "stamp_pct": parent.stamp_pct,
            "gst_pct": parent.gst_pct,
        }

    strategy_data = {
        "name": request.name,
        "strategy_type": request.strategy_type,
        "parent_id": request.parent_id,
        "description": request.description,
        "is_template": False,
        "is_active": True,
        "screener_profiles": json.dumps(request.screener_profiles) if request.screener_profiles else None,
    }

    for field in [
        "or_minutes", "sl_pct", "tp_pct", "min_or_range_pct", "max_or_range_pct",
        "max_positions", "max_capital_per_trade_pct", "max_daily_loss_pct",
        "max_total_exposure_pct", "risk_per_trade_pct", "min_trade_value",
        "max_trade_value", "cooldown_minutes", "max_distance_from_or_pct",
        "enable_shorts", "eod_exit_hour", "eod_exit_minute",
        "screener_profiles",
    ]:
        request_val = getattr(request, field, None)
        strategy_data[field] = request_val if request_val is not None else defaults.get(field)

    strategy = StrategyConfig(**strategy_data)
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy, None


def _sync_update_strategy(db, strategy_id, request):
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()
    if not strategy:
        return None, "not_found"
    if strategy.is_template:
        return None, "template"
    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None and hasattr(strategy, key):
            if key == "screener_profiles" and value:
                setattr(strategy, key, json.dumps(value))
            else:
                setattr(strategy, key, value)

    if request.is_default:
        db.query(StrategyConfig).filter(
            StrategyConfig.id != strategy_id,
            StrategyConfig.is_default == True,
        ).update({"is_default": False})

    db.commit()
    db.refresh(strategy)
    return strategy, None


def _sync_delete_strategy(db, strategy_id):
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()
    if not strategy:
        return None, "not_found"
    if strategy.is_template:
        return None, "template"

    strategy.is_active = False
    db.commit()
    return strategy, None


def _sync_update_child_variations(db, template_id: int) -> int:
    """Overwrite all child variation params with template values."""
    from db.models.bot import StrategyConfig as StratModel
    template = db.query(StratModel).filter(
        StratModel.id == template_id,
        StratModel.is_template == True
    ).first()
    if not template:
        return 0

    skip_fields = {
        'id', 'uuid', 'internal_id', 'name', 'description', 'is_template',
        'is_active', 'is_default', 'parent_id', 'user_id',
        'created_at', 'updated_at', 'screener_profiles',
    }

    template_dict = template.to_dict()
    sync_params = {k: v for k, v in template_dict.items() if k not in skip_fields and v is not None}

    variations = db.query(StratModel).filter(
        StratModel.parent_id == template_id
    ).all()

    for var in variations:
        for key, value in sync_params.items():
            if hasattr(var, key):
                setattr(var, key, value)

    db.commit()
    return len(variations)


async def sync_variations(
    strategy_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Sync template params to all child variations."""
    count = await asyncio.to_thread(_sync_update_child_variations, db, strategy_id)

    if count == 0:
        raise HTTPException(status_code=404, detail="Template not found or has no variations")

    return {
        "status": "success",
        "message": f"Synced {count} variation(s) from template",
        "count": count,
    }


async def create_strategy(
    request: StrategyCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new strategy variation."""
    strategy, error = await asyncio.to_thread(_sync_create_strategy, db, request)

    if error == "name_exists":
        raise HTTPException(status_code=400, detail="Strategy name already exists")
    if error == "parent_not_found":
        raise HTTPException(status_code=400, detail="Parent strategy not found")

    return {
        "status": "success",
        "message": f"Strategy '{request.name}' created",
        "strategy": strategy.to_dict(),
    }


async def update_strategy(
    strategy_id: int,
    request: StrategyUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a strategy configuration."""
    strategy, error = await asyncio.to_thread(_sync_update_strategy, db, strategy_id, request)

    if error == "not_found":
        raise HTTPException(status_code=404, detail="Strategy not found")
    if error == "template":
        raise HTTPException(status_code=400, detail="Cannot update template strategies")
    return {
        "status": "success",
        "message": f"Strategy '{strategy.name}' updated",
        "strategy": strategy.to_dict(),
    }


async def delete_strategy(
    strategy_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a strategy (soft delete by setting is_active=False)."""
    strategy, error = await asyncio.to_thread(_sync_delete_strategy, db, strategy_id)

    if error == "not_found":
        raise HTTPException(status_code=404, detail="Strategy not found")
    if error == "template":
        raise HTTPException(status_code=400, detail="Cannot delete template strategies")

    return {
        "status": "success",
        "message": f"Strategy '{strategy.name}' deleted",
    }
