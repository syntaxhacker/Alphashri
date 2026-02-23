"""
Paper Trading API - Endpoints for paper trading operations.

This module provides REST API endpoints for:
- Portfolio management
- Order placement
- Signal generation
- Trade history
"""

import sys
from pathlib import Path
from datetime import datetime
from typing import Optional, List

# Add project paths
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from rich.console import Console

# Import trading modules
from trading.paper_trader import PaperTrader, OrderSide, get_paper_trader, reset_paper_trader
from trading.orb_signals import ORBSignalGenerator, ORBSignal, SignalType, create_entry_signal
from trading.risk_manager import RiskManager, get_risk_manager
from trading.journal import TradeJournal, get_journal

console = Console()

# Create router
router = APIRouter(prefix="/api/paper", tags=["Paper Trading"])


# ============== Request/Response Models ==============

class OrderRequest(BaseModel):
    symbol: str
    side: str  # "BUY" or "SELL"
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
    prices: dict  # {symbol: price}


# ============== Portfolio Endpoints ==============

@router.get("/portfolio")
async def get_portfolio():
    """Get current paper trading portfolio status."""
    trader = get_paper_trader()
    return trader.get_portfolio_status()


@router.post("/reset")
async def reset_portfolio(request: ResetRequest):
    """Reset paper trading with new capital."""
    trader = reset_paper_trader(request.capital)
    return {
        "status": "success",
        "message": f"Reset with capital ₹{request.capital:,.0f}",
        "portfolio": trader.get_portfolio_status()
    }


@router.get("/positions")
async def get_positions():
    """Get all open positions."""
    trader = get_paper_trader()
    return {
        "count": len(trader.positions),
        "positions": trader.get_positions()
    }


@router.get("/trades")
async def get_trades(limit: int = 50):
    """Get trade history."""
    trader = get_paper_trader()
    return {
        "total_trades": len(trader.trades),
        "trades": trader.get_trades(limit=limit)
    }


# ============== Order Endpoints ==============

@router.post("/order")
async def place_order(request: OrderRequest):
    """Place a paper trading order."""
    trader = get_paper_trader()
    risk_manager = get_risk_manager()

    # Validate side
    try:
        side = OrderSide[request.side.upper()]
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Invalid side: {request.side}. Use BUY or SELL.")

    # Validate trade with risk manager
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

    # Place order
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
async def close_position(request: ClosePositionRequest):
    """Close a specific position."""
    trader = get_paper_trader()
    from trading.paper_trader import ExitReason

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

    # Log to journal
    journal = get_journal()
    journal.log_trade({
        'trade_id': trade.trade_id,
        'symbol': trade.symbol,
        'side': trade.side.value,
        'quantity': trade.quantity,
        'entry_price': trade.entry_price,
        'exit_price': trade.exit_price,
        'entry_time': trade.entry_time.isoformat(),
        'exit_time': trade.exit_time.isoformat(),
        'pnl': trade.pnl,
        'pnl_pct': trade.pnl_pct,
        'exit_reason': trade.exit_reason.value,
        'costs': trade.costs,
        'net_pnl': trade.net_pnl,
    })

    return {
        "trade_id": trade.trade_id,
        "symbol": trade.symbol,
        "pnl": trade.pnl,
        "pnl_pct": trade.pnl_pct,
        "net_pnl": trade.net_pnl,
        "exit_reason": trade.exit_reason.value,
    }


@router.post("/close-all")
async def close_all_positions(request: UpdatePricesRequest):
    """Close all open positions."""
    trader = get_paper_trader()
    from trading.paper_trader import ExitReason

    trader.close_all_positions(request.prices, ExitReason.MANUAL)

    return {
        "status": "success",
        "message": f"Closed {len(trader.trades)} positions",
        "portfolio": trader.get_portfolio_status()
    }


@router.post("/update-prices")
async def update_prices(request: UpdatePricesRequest):
    """Update prices and check for SL/TP triggers."""
    trader = get_paper_trader()
    trader.update_prices(request.prices)

    return {
        "status": "success",
        "portfolio": trader.get_portfolio_status(),
        "positions": trader.get_positions()
    }


# ============== Signal Endpoints ==============

@router.get("/signals")
async def get_signals():
    """Get current ORB signals from screener."""
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scanners'))
        from orb_stock_screener import ORBStockScreener

        screener = ORBStockScreener(use_relaxed=True)
        df = screener.screen(limit=100, verify_nse=True)

        signals = []
        for _, row in df.head(20).iterrows():
            signals.append({
                "symbol": row['name'],
                "price": row['close'],
                "rsi": round(row['RSI'], 1),
                "adx": round(row['ADX'], 1),
                "atr_pct": round(row.get('atr_pct', 0), 2),
                "score": round(row.get('orb_score', 0), 1),
            })

        return {
            "count": len(signals),
            "signals": signals,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/signal/create")
async def create_signal(
    symbol: str,
    price: float,
    or_high: float,
    or_low: float,
    side: str = "LONG",
    sl_pct: float = 0.4,
    tp_pct: float = 1.2,
):
    """Create a manual ORB signal."""
    signal = create_entry_signal(
        symbol=symbol.upper(),
        price=price,
        or_high=or_high,
        or_low=or_low,
        sl_pct=sl_pct,
        tp_pct=tp_pct,
        side=side.upper(),
    )

    return {
        "symbol": signal.symbol,
        "signal_type": signal.signal_type.value,
        "price": signal.price,
        "stop_loss": signal.stop_loss,
        "take_profit": signal.take_profit,
        "or_high": signal.or_high,
        "or_low": signal.or_low,
        "or_range_pct": signal.or_range_pct,
        "timestamp": signal.timestamp.isoformat(),
    }


# ============== Journal Endpoints ==============

@router.get("/journal/summary")
async def get_journal_summary():
    """Get trading performance summary."""
    journal = get_journal()
    return journal.get_performance_summary()


@router.get("/journal/symbols")
async def get_symbol_performance():
    """Get performance by symbol."""
    journal = get_journal()
    return journal.get_symbol_performance()


@router.get("/journal/daily")
async def get_daily_report(date: Optional[str] = None):
    """Get daily trading report."""
    journal = get_journal()
    return journal.get_daily_report(date)


@router.get("/journal/export")
async def export_journal():
    """Export journal to CSV."""
    journal = get_journal()
    filepath = journal.export_to_csv()
    return {"status": "success", "filepath": filepath}


# ============== Risk Management Endpoints ==============

@router.get("/risk/config")
async def get_risk_config():
    """Get risk management configuration."""
    risk_manager = get_risk_manager()
    return risk_manager.get_config()


@router.post("/risk/validate")
async def validate_trade(
    entry_price: float,
    stop_loss: float,
    take_profit: float,
    side: str = "BUY",
):
    """Validate a potential trade."""
    trader = get_paper_trader()
    risk_manager = get_risk_manager()
    portfolio = trader.get_portfolio_status()

    validation = risk_manager.validate_trade(
        capital=portfolio['total_value'],
        cash=portfolio['cash'],
        current_positions=len(trader.positions),
        current_exposure=portfolio['margin_used'],
        entry_price=entry_price,
        stop_loss=stop_loss,
        take_profit=take_profit,
        side=side.upper(),
    )

    return validation


# ============== Health Check ==============

@router.get("/health")
async def health_check():
    """Health check endpoint."""
    trader = get_paper_trader()
    return {
        "status": "healthy",
        "portfolio_value": trader.get_portfolio_status()['total_value'],
        "open_positions": len(trader.positions),
        "total_trades": len(trader.trades),
        "timestamp": datetime.now().isoformat(),
    }
