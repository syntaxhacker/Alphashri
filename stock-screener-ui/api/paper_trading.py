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
from dataclasses import asdict

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
async def get_trades(
    limit: int = 50,
    date: Optional[str] = None,
    symbol: Optional[str] = None,
    strategy: Optional[str] = None,
):
    """Get trade history from journal with filters."""
    from trading.journal import TradeJournal

    today = datetime.now().strftime('%Y-%m-%d')
    journal_dir = Path(__file__).parent.parent / "journals"

    all_trades = []

    if date:
        # Load specific date's journal
        date_str = date.replace('-', '')
        journal_file = journal_dir / f"journal_{date_str}.json"
        if journal_file.exists():
            temp_journal = TradeJournal()
            try:
                temp_journal.load_journal(str(journal_file))
                all_trades = [asdict(t) for t in temp_journal.trades]
            except Exception as e:
                console.print(f"[yellow]Could not load journal for {date}: {e}[/yellow]")
    else:
        # No date filter - load today + all available journals
        # First, load today's journal (may include live trades)
        journal = get_journal()
        all_trades = [asdict(t) for t in journal.trades]

        # Also load recent journal files (last 7 days)
        for i in range(1, 8):
            past_date = (datetime.now() - __import__('datetime').timedelta(days=i)).strftime('%Y%m%d')
            past_file = journal_dir / f"journal_{past_date}.json"
            if past_file.exists():
                try:
                    temp_journal = TradeJournal()
                    temp_journal.load_journal(str(past_file))
                    all_trades.extend([asdict(t) for t in temp_journal.trades])
                except Exception:
                    pass

    # Apply filters
    filtered_trades = all_trades

    if symbol:
        filtered_trades = [t for t in filtered_trades if t.get('symbol', '').upper() == symbol.upper()]

    if strategy:
        # Filter by strategy if stored in notes
        filtered_trades = [t for t in filtered_trades if strategy.lower() in (t.get('notes') or '').lower()]

    # Sort by exit time descending
    filtered_trades.sort(key=lambda x: x.get('exit_time', ''), reverse=True)

    # Apply limit
    filtered_trades = filtered_trades[:limit]

    return {
        "total_trades": len(all_trades),
        "filtered_trades": len(filtered_trades),
        "trades": filtered_trades
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


# ============== Chart Data Endpoint ==============

@router.get("/chart/{symbol}")
async def get_paper_chart(symbol: str, date: Optional[str] = None):
    """
    Get intraday chart data with paper trade markers.

    Returns:
    - candles: 5-min OHLCV data for the day
    - trades: List of trades for this symbol on this date
    - orb_levels: OR High, OR Low for the day
    - current_position: If there's an open position
    """
    try:
        # Import required modules
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage

        # Get date to fetch
        today = datetime.now().strftime('%Y-%m-%d')
        if date is None:
            date = today

        screener = TVScreenerUsage(enable_paper_trading=False)

        # Use historical API for past dates, intraday for today
        if date == today:
            # Fetch today's intraday data
            df = screener.upstox_api.fetch_intraday_data_v3(
                symbol=symbol.upper(),
                interval='5'
            )
        else:
            # Fetch historical minute data for past dates
            # Use a range since same-day from/to doesn't work reliably
            from datetime import timedelta
            from_date = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=2)).strftime('%Y-%m-%d')
            df_full = screener.upstox_api.fetch_historical_data_v3(
                symbol=symbol.upper(),
                unit='minutes',
                interval=5,
                to_date=date,
                from_date=from_date,
            )
            # Filter to only the requested date
            if df_full is not None and not df_full.empty:
                date_start = f"{date}T00:00:00"
                date_end = f"{date}T23:59:59"
                df = df_full[df_full.index >= date_start]
                df = df[df.index <= date_end]
            else:
                df = None

        if df is None or df.empty:
            return {"error": f"No data for {symbol} on {date}", "symbol": symbol, "date": date}

        # Build candle data
        candles = []
        for idx, row in df.iterrows():
            time_str = idx.isoformat() if hasattr(idx, 'isoformat') else str(idx)
            candles.append({
                "time": time_str,
                "open": float(row['open']),
                "high": float(row['high']),
                "low": float(row['low']),
                "close": float(row['close']),
                "volume": int(row.get('volume', 0)),
            })

        # Calculate ORB levels (first 45 mins = 9 candles)
        or_candles = candles[:9] if len(candles) >= 9 else candles
        orb_levels = None
        if or_candles:
            or_high = max(c['high'] for c in or_candles)
            or_low = min(c['low'] for c in or_candles)
            or_open = or_candles[0]['open'] if or_candles else 0
            orb_levels = {
                "or_high": or_high,
                "or_low": or_low,
                "or_open": or_open,
                "or_range": or_high - or_low,
                "or_range_pct": ((or_high - or_low) / or_open * 100) if or_open > 0 else 0,
            }

        # Get trades from journal for this symbol and date
        # Load the journal file for the specific date
        from trading.journal import TradeJournal
        journal_dir = Path(__file__).parent.parent / "journals"
        date_str = date.replace('-', '')  # 2026-02-23 -> 20260223
        journal_file = journal_dir / f"journal_{date_str}.json"

        symbol_trades = []
        if journal_file.exists():
            temp_journal = TradeJournal()
            try:
                temp_journal.load_journal(str(journal_file))
                symbol_trades = [
                    t for t in temp_journal.trades
                    if t.symbol == symbol.upper()
                ]
            except Exception as e:
                console.print(f"[yellow]Could not load journal for {date}: {e}[/yellow]")
        else:
            # Fallback to global journal for today
            journal = get_journal()
            symbol_trades = [
                t for t in journal.trades
                if t.symbol == symbol.upper() and t.exit_time.startswith(date)
            ]

        # Convert trades to dict format
        trades_data = [{
            "trade_id": t.trade_id,
            "symbol": t.symbol,
            "side": t.side,
            "quantity": t.quantity,
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "entry_time": t.entry_time,
            "exit_time": t.exit_time,
            "pnl": t.pnl,
            "pnl_pct": t.pnl_pct,
            "exit_reason": t.exit_reason,
            "costs": t.costs,
            "net_pnl": t.net_pnl,
            "sl_price": t.sl_price,
            "tp_price": t.tp_price,
        } for t in symbol_trades]

        # Check for current position
        trader = get_paper_trader()
        current_position = None
        if symbol.upper() in trader.positions:
            pos = trader.positions[symbol.upper()]
            current_position = {
                "symbol": pos.symbol,
                "side": pos.side.value,
                "quantity": pos.quantity,
                "entry_price": pos.entry_price,
                "current_price": pos.current_price,
                "entry_time": pos.entry_time.isoformat(),
                "stop_loss": pos.stop_loss,
                "take_profit": pos.take_profit,
                "pnl": pos.pnl,
                "pnl_pct": pos.pnl_pct,
                "margin_used": pos.margin_used,
                "order_id": pos.order_id,
            }

        return {
            "symbol": symbol.upper(),
            "date": date,
            "candles": candles,
            "trades": trades_data,
            "orb_levels": orb_levels,
            "current_position": current_position,
        }

    except Exception as e:
        console.print(f"[red]Error fetching chart data: {e}[/red]")
        return {"error": str(e), "symbol": symbol, "date": date}
