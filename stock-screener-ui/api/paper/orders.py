"""
Order endpoints for Paper Trading API.
"""

from fastapi import HTTPException, Depends

from trading.paper_trader import get_paper_trader, OrderSide, ExitReason
from trading.risk_manager import get_risk_manager
from trading.journal import get_journal
from api.auth import get_current_user
from db.models import User

from .paper_api import router, _get_user_id
from .requests import OrderRequest, ClosePositionRequest, UpdatePricesRequest
from .helpers import build_trade_log_entry


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
    """Close a specific position."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)

    try:
        exit_reason = ExitReason[request.reason.upper()]
    except KeyError:
        exit_reason = ExitReason.MANUAL

    trade = trader.close_position(
        symbol=request.symbol.upper(),
        exit_price=request.exit_price,
        exit_reason=exit_reason,
    )

    if trade is None:
        raise HTTPException(status_code=404, detail=f"No position found for {request.symbol}")

    journal = get_journal(user_id)
    journal.log_trade(build_trade_log_entry(trade))
    journal.save_journal()

    return {
        "trade_id": trade.trade_id,
        "symbol": trade.symbol,
        "pnl": trade.pnl,
        "pnl_pct": trade.pnl_pct,
        "net_pnl": trade.net_pnl,
        "exit_reason": trade.exit_reason.value,
    }


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
