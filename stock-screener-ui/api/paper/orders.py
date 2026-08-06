"""
Order endpoints for Paper Trading API.
"""

from datetime import datetime
from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field

class PositionNotesUpdate(BaseModel):
    notes: str | None = Field(None, max_length=500)
    reason: str | None = Field(None, max_length=500)

from trading.paper_trader import get_paper_trader, OrderSide, ExitReason
from trading.risk_manager import get_risk_manager
from api.auth import get_current_user
from db.models import User

from .paper_api import router, _get_user_id
from .requests import OrderRequest, ClosePositionRequest, UpdatePricesRequest
from .helpers import build_trade_log_entry
from api.utils import _BUY_SIDES, _get_market_price


def _calc_costs(entry_price: float, exit_price: float, quantity: int, side: str) -> float:
    from backtest.costs import calculate_trading_costs
    return calculate_trading_costs(entry_price, exit_price, quantity, side)['total_costs']


@router.post("/order")
async def place_order(request: OrderRequest, user: "User" = Depends(get_current_user)):
    """Place a paper trading order."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)
    risk_manager = get_risk_manager()

    try:
        side = OrderSide[request.side.upper()]
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Invalid side: {request.side}. Use BUY or SELL.")

    portfolio = trader.get_portfolio_status()
    validation = risk_manager.validate_trade(
        capital=portfolio['total_value'],
        cash=portfolio['cash'],
        current_positions=len(trader.positions),
        current_exposure=portfolio['margin_used'],
        entry_price=request.price,
        stop_loss=request.stop_loss,
        take_profit=request.take_profit,
        side=request.side.upper(),
    )

    if not validation['valid']:
        raise HTTPException(status_code=400, detail=validation['reason'])

    order = trader.place_order(
        symbol=request.symbol.upper(),
        side=side,
        quantity=request.quantity,
        price=request.price,
        stop_loss=request.stop_loss,
        take_profit=request.take_profit,
    )

    return {
        "order_id": order.order_id,
        "status": order.status.value,
        "symbol": order.symbol,
        "side": order.side.value,
        "quantity": order.quantity,
        "price": order.price,
        "stop_loss": order.stop_loss,
        "take_profit": order.take_profit,
        "timestamp": order.timestamp.isoformat(),
    }


@router.post("/close")
async def close_position(request: ClosePositionRequest, user: "User" = Depends(get_current_user)):
    """Close a specific position.

    First tries PaperTrader in-memory close. Falls back to DB-based close
    (for positions managed by a bot subprocess).
    """
    user_id = _get_user_id(user)
    symbol = request.symbol.upper()
    exit_price = request.exit_price

    trader = get_paper_trader(user_id)

    try:
        exit_reason = ExitReason(request.reason.upper())
    except ValueError:
        exit_reason = ExitReason.MANUAL

    trade = trader.close_position(
        symbol=symbol,
        exit_price=exit_price,
        exit_reason=exit_reason,
    )

    if trade is not None:
        return {
            "trade_id": trade.trade_id,
            "symbol": trade.symbol,
            "pnl": trade.pnl,
            "pnl_pct": trade.pnl_pct,
            "net_pnl": trade.net_pnl,
            "exit_reason": trade.exit_reason.value,
        }

    # Fallback: close from DB (bot-managed positions)
    try:
        from db.database import SessionLocal
        from db.models import Position as _Pos, Trade as _Trade
        from config import IST

        db = SessionLocal()
        try:
            pos = db.query(_Pos).filter(
                _Pos.user_id == user_id,
                _Pos.symbol == symbol,
            ).first()
            if pos is None:
                raise HTTPException(status_code=404, detail=f"No position found for {symbol}")

            market_price = _get_market_price(symbol)
            if market_price is not None:
                exit_price = market_price

            side = pos.side.upper()
            if side in _BUY_SIDES:
                pnl = (exit_price - pos.entry_price) * pos.quantity
                pnl_pct = ((exit_price - pos.entry_price) / pos.entry_price) * 100
            else:
                pnl = (pos.entry_price - exit_price) * pos.quantity
                pnl_pct = ((pos.entry_price - exit_price) / pos.entry_price) * 100

            costs = _calc_costs(pos.entry_price, exit_price, pos.quantity, side)

            db_trade = _Trade(
                user_id=user_id,
                bot_id=pos.bot_id,
                strategy_id=pos.strategy_id,
                strategy_name=pos.strategy_name or "",
                symbol=symbol,
                side=side,
                quantity=pos.quantity,
                entry_price=pos.entry_price,
                exit_price=exit_price,
                entry_time=pos.entry_time,
                exit_time=datetime.now(IST),
                stop_loss=pos.stop_loss or 0.0,
                take_profit=pos.take_profit or 0.0,
                pnl=round(pnl, 2),
                pnl_pct=round(pnl_pct, 2),
                costs=round(costs, 2),
                net_pnl=round(pnl - costs, 2),
                exit_reason="MANUAL_CLOSE",
                reason=f"Closed manually at ₹{exit_price:.2f}",
                peak_price=pos.peak_price or pos.entry_price,
                low_price=pos.low_price or pos.entry_price,
                source="live",
            )
            db.add(db_trade)
            bot_id = pos.bot_id
            db.delete(pos)
            db.commit()

            try:
                import json
                from pathlib import Path
                cmd_path = Path(f"/tmp/bot-cmd-{bot_id}.json")
                cmd_path.write_text(json.dumps({
                    "action": "close_position",
                    "symbol": symbol,
                    "strategy_id": pos.strategy_id,
                    "exit_price": exit_price,
                }))
            except Exception:
                pass

            return {
                "trade_id": db_trade.uuid,
                "symbol": symbol,
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl_pct, 2),
                "net_pnl": round(pnl - costs, 2),
                "exit_reason": "MANUAL_CLOSE",
            }
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=404, detail=f"No position found for {symbol}")
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail=f"No position found for {symbol}")


@router.post("/close-all")
async def close_all_positions(request: UpdatePricesRequest, user: "User" = Depends(get_current_user)):
    """Close all open positions."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)

    trader.close_all_positions(request.prices, ExitReason.MANUAL)

    return {
        "status": "success",
        "message": f"Closed {len(trader.trades)} positions",
        "portfolio": trader.get_portfolio_status()
    }


@router.patch("/positions/{position_id}")
async def update_position_notes(
    position_id: str,
    request: PositionNotesUpdate,
    user: "User" = Depends(get_current_user),
):
    """Update notes and/or entry_reason for an open position.

    Merges updates into the existing metadata_json on the Position DB model.
    """
    from db.models.trade import Position
    from db.database import SessionLocal
    import json

    db = SessionLocal()
    try:
        position = db.query(Position).filter(Position.uuid == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found")

        metadata = {}
        if position.metadata_json:
            try:
                metadata = json.loads(position.metadata_json)
            except (json.JSONDecodeError, TypeError):
                metadata = {}

        if request.notes is not None:
            metadata["notes"] = request.notes
        if request.reason is not None:
            metadata["entry_reason"] = request.reason

        position.metadata_json = json.dumps(metadata)
        db.commit()
        db.refresh(position)
        return position.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
