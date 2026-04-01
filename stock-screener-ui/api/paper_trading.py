"""
Paper Trading API - Endpoints for paper trading operations.

This module provides REST API endpoints for:
- Portfolio management
- Order placement
- Signal generation
- Trade history
"""

import sys
import subprocess
import json
import os
import time
import asyncio
from pathlib import Path
from datetime import datetime
from typing import Optional, List
from dataclasses import asdict

# Add project paths
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from rich.console import Console

# Import trading modules
from trading.paper_trader import PaperTrader, OrderSide, get_paper_trader, reset_paper_trader
from trading.orb_signals import ORBSignalGenerator, ORBSignal, SignalType, create_entry_signal
from trading.risk_manager import RiskManager, get_risk_manager
from trading.journal import TradeJournal, get_journal

from api.auth import get_current_user
from db.models import User
import config

console = Console()

# Create router
router = APIRouter(prefix="/api/paper", tags=["Paper Trading"])

# Background runner process state (global for single-user mode)
_paper_bot_process: Optional[subprocess.Popen] = None
_paper_bot_log_file = Path("/tmp/alphashri-runner.log")
_paper_bot_log_handle = None
_paper_bot_snapshot_file = Path("/tmp/alphashri-snapshot.json")
_paper_bot_pid_file = Path("/tmp/alphashri-runner.pid")

# User-scoped file paths
_user_snapshot_files: dict = {}
_user_pid_files: dict = {}


def _get_snapshot_file(user_id: Optional[int] = None) -> Path:
    """Get snapshot file path for a user."""
    if user_id is None:
        return _paper_bot_snapshot_file
    if user_id not in _user_snapshot_files:
        _user_snapshot_files[user_id] = Path(f"/tmp/alphashri-{user_id}-snapshot.json")
    return _user_snapshot_files[user_id]


def _get_pid_file(user_id: Optional[int] = None) -> Path:
    """Get PID file path for a user."""
    if user_id is None:
        return _paper_bot_pid_file
    if user_id not in _user_pid_files:
        _user_pid_files[user_id] = Path(f"/tmp/alphashri-{user_id}-runner.pid")
    return _user_pid_files[user_id]


def _load_fresh_bot_snapshot(max_age_seconds: int = 300, user_id: Optional[int] = None) -> Optional[dict]:
    """Load bot snapshot only when it is recent enough to represent live state."""
    snapshot_file = _get_snapshot_file(user_id)
    if not snapshot_file.exists():
        return None

    try:
        data = json.loads(snapshot_file.read_text())
        ts = data.get("timestamp")
        if ts:
            try:
                age = (datetime.now() - datetime.fromisoformat(ts)).total_seconds()
                if age > max_age_seconds:
                    return None
            except Exception:
                # If timestamp parsing fails, still allow using snapshot payload.
                pass
        return data
    except Exception:
        return None


def _read_runner_pid_file(user_id: Optional[int] = None) -> Optional[int]:
    """Read persisted runner PID from disk."""
    pid_file = _get_pid_file(user_id)
    try:
        if not pid_file.exists():
            return None
        return int(pid_file.read_text().strip())
    except Exception:
        return None


def _write_runner_pid_file(pid: int, user_id: Optional[int] = None) -> None:
    """Persist runner PID so API reloads can still track the process."""
    pid_file = _get_pid_file(user_id)
    try:
        pid_file.write_text(str(pid))
    except Exception:
        pass


def _clear_runner_pid_file(user_id: Optional[int] = None) -> None:
    """Remove persisted runner PID file."""
    pid_file = _get_pid_file(user_id)
    try:
        if pid_file.exists():
            pid_file.unlink()
    except Exception:
        pass


def _is_pid_alive(pid: int) -> bool:
    """Check if a PID exists."""
    try:
        return subprocess.run(["kill", "-0", str(pid)], check=False).returncode == 0
    except Exception:
        return False


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

# Default user ID for unauthenticated access (admin user created during migration)
DEFAULT_USER_ID = 1


def _get_user_id(user: "User") -> int:
    return user.id


@router.get("/portfolio")
async def get_portfolio(user: "User" = Depends(get_current_user)):
    """Get current paper trading portfolio status."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)
    status = trader.get_portfolio_status()

    # Get today's date for filtering closed trades
    today_str = datetime.now(config.IST).strftime('%Y-%m-%d')
    today_str_compact = datetime.now(config.IST).strftime('%Y%m%d')

    # Calculate realized P&L from today's closed trades
    realized_pnl_today = 0.0
    daily_trades = 0

    # Try to load today's journal file
    if user_id:
        journal_dir = Path(__file__).parent.parent / "journals" / str(user_id)
    else:
        journal_dir = Path(__file__).parent.parent / "journals"
    journal_file = journal_dir / f"journal_{today_str_compact}.json"
    if journal_file.exists():
        try:
            from trading.journal import TradeJournal
            temp_journal = TradeJournal(user_id=user_id)
            temp_journal.load_journal(str(journal_file))
            for t in temp_journal.trades:
                realized_pnl_today += float(t.net_pnl or 0)
                daily_trades += 1
        except Exception:
            pass

    # If bot runs in a separate process, in-memory portfolio here may be stale.
    # Recompute key live fields from snapshot open positions when available.
    snap = _load_fresh_bot_snapshot(user_id=user_id)
    if snap:
        snap_positions = snap.get("open_positions_data") or []
        if isinstance(snap_positions, list):
            margin_used = sum(float(p.get("entry_price", 0)) * int(p.get("quantity", 0)) for p in snap_positions)
            position_value = sum(float(p.get("current_price", 0)) * int(p.get("quantity", 0)) for p in snap_positions)
            unrealized_pnl = sum(float(p.get("pnl", 0)) for p in snap_positions)

            cash = status.get("initial_capital", 0) - margin_used
            total_value = cash + position_value
            total_pnl = total_value - status.get("initial_capital", 0)
            total_pnl_pct = (total_pnl / status.get("initial_capital", 1) * 100) if status.get("initial_capital", 0) else 0

            # Daily P&L = Unrealized + Realized today
            daily_pnl = unrealized_pnl + realized_pnl_today
            daily_pnl_pct = (daily_pnl / status.get("initial_capital", 1) * 100) if status.get("initial_capital", 0) else 0

            status.update({
                "cash": round(cash, 2),
                "margin_used": round(margin_used, 2),
                "position_value": round(position_value, 2),
                "unrealized_pnl": round(unrealized_pnl, 2),
                "realized_pnl_today": round(realized_pnl_today, 2),
                "total_value": round(total_value, 2),
                "total_pnl": round(total_pnl, 2),
                "total_pnl_pct": round(total_pnl_pct, 2),
                "daily_pnl": round(daily_pnl, 2),
                "daily_pnl_pct": round(daily_pnl_pct, 2),
                "daily_trades": daily_trades,
                "positions": len(snap_positions),
                "open_positions": len(snap_positions),
            })
    if "daily_pnl_pct" not in status:
        base = status.get("initial_capital", 0) or 0
        daily_pnl = status.get("daily_pnl", 0) or 0
        status["daily_pnl_pct"] = (daily_pnl / base * 100) if base else 0.0

    # Ensure realized_pnl_today is always present
    if "realized_pnl_today" not in status:
        status["realized_pnl_today"] = round(realized_pnl_today, 2)
    if "daily_trades" not in status:
        status["daily_trades"] = daily_trades

    return status


@router.post("/reset")
async def reset_portfolio(request: ResetRequest, user: "User" = Depends(get_current_user)):
    """Reset paper trading with new capital."""
    user_id = _get_user_id(user)
    trader = reset_paper_trader(user_id, request.capital)
    return {
        "status": "success",
        "message": f"Reset with capital ₹{request.capital:,.0f}",
        "portfolio": trader.get_portfolio_status()
    }


@router.get("/positions")
async def get_positions(user: "User" = Depends(get_current_user)):
    """Get all open positions."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)
    positions = trader.get_positions()

    # If bot runs in a separate process, in-memory positions in API process can be stale.
    # Prefer fresh snapshot positions when available so live table and summary stay in sync.
    snap = _load_fresh_bot_snapshot(user_id=user_id)
    if snap:
        snap_positions = snap.get("open_positions_data") or []
        if isinstance(snap_positions, list) and len(snap_positions) > 0:
            positions = snap_positions

    return {
        "count": len(positions),
        "positions": positions
    }


@router.get("/trades")
async def get_trades(
    limit: int = 50,
    date: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    days_back: int = 7,
    symbol: Optional[str] = None,
    strategy: Optional[str] = None,
    bot_id: Optional[str] = None,
    user: "User" = Depends(get_current_user),
):
    """Get trade history from journal with filters."""
    from trading.journal import TradeJournal
    from datetime import timedelta

    user_id = _get_user_id(user)
    if user_id:
        journal_dir = Path(__file__).parent.parent / "journals" / str(user_id)
    else:
        journal_dir = Path(__file__).parent.parent / "journals"

    all_trades = []

    if date:
        # Load specific date's journal
        date_str = date.replace('-', '')
        journal_file = journal_dir / f"journal_{date_str}.json"
        if journal_file.exists():
            temp_journal = TradeJournal(user_id=user_id)
            try:
                temp_journal.load_journal(str(journal_file))
                all_trades = [asdict(t) for t in temp_journal.trades]
            except Exception as e:
                console.print(f"[yellow]Could not load journal for {date}: {e}[/yellow]")
    elif from_date:
        start_dt = datetime.strptime(from_date, '%Y-%m-%d')
        if to_date:
            end_dt = datetime.strptime(to_date, '%Y-%m-%d')
        else:
            end_dt = min(datetime.now(config.IST), start_dt + timedelta(days=90))
        
        current_dt = start_dt
        while current_dt <= end_dt:
            date_str = current_dt.strftime('%Y%m%d')
            journal_file = journal_dir / f"journal_{date_str}.json"
            if journal_file.exists():
                temp_journal = TradeJournal(user_id=user_id)
                try:
                    temp_journal.load_journal(str(journal_file))
                    all_trades.extend([asdict(t) for t in temp_journal.trades])
                except Exception:
                    pass
            current_dt += timedelta(days=1)
    else:
        # No specific date or from_date - use days_back
        today = datetime.now(config.IST).strftime('%Y%m%d')
        journal = TradeJournal(user_id=user_id)
        journal_file = journal_dir / f"journal_{today}.json"
        if journal_file.exists():
            try:
                journal.load_journal(str(journal_file))
            except Exception as e:
                console.print(f"[yellow]Could not reload journal: {e}[/yellow]")
        all_trades = [asdict(t) for t in journal.trades]

        # Load recent journal files
        for i in range(0, days_back + 1):
            day_str = (datetime.now(config.IST) - timedelta(days=i)).strftime('%Y%m%d')
            journal_file = journal_dir / f"journal_{day_str}.json"
            if not journal_file.exists():
                continue
            try:
                temp_journal = TradeJournal(user_id=user_id)
                temp_journal.load_journal(str(journal_file))
                all_trades.extend([asdict(t) for t in temp_journal.trades])
            except Exception:
                pass

    # Deduplicate trades
    deduped = {}
    for t in all_trades:
        key = (
            t.get('symbol'),
            t.get('side'),
            t.get('quantity'),
            t.get('entry_time'),
            t.get('exit_time'),
        )
        deduped[key] = t
    all_trades = list(deduped.values())

    # Apply filters
    filtered_trades = all_trades

    if symbol:
        filtered_trades = [t for t in filtered_trades if t.get('symbol', '').upper() == symbol.upper()]

    if strategy:
        # Filter by strategy if stored in notes
        filtered_trades = [t for t in filtered_trades if strategy.lower() in (t.get('notes') or '').lower()]

    if bot_id:
        # Filter by bot_id - handle 'default' string and convert bot_id from query to same type as trade data
        if bot_id == "default":
            # For default bot, we might want trades where bot_id is 0 or None
            filtered_trades = [t for t in filtered_trades if t.get('bot_id') in (0, None, "0")]
        else:
            # Try numeric comparison first, then string
            try:
                numeric_bot_id = int(bot_id)
                filtered_trades = [t for t in filtered_trades if t.get('bot_id') == numeric_bot_id]
            except ValueError:
                filtered_trades = [t for t in filtered_trades if str(t.get('bot_id')) == str(bot_id)]

    # Sort by exit time descending
    filtered_trades.sort(key=lambda x: x.get('exit_time', ''), reverse=True)

    # Apply limit
    filtered_trades = filtered_trades[:limit]

    return {
        "total_trades": len(all_trades),
        "filtered_trades": len(filtered_trades),
        "trades": filtered_trades
    }


@router.delete("/trades/{trade_id}")
async def delete_trade(
    trade_id: str,
    user: "User" = Depends(get_current_user)
):
    """Delete a single trade from the journal."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)

    # Find and remove the trade
    original_count = len(journal.trades)
    journal.trades = [t for t in journal.trades if t.trade_id != trade_id]

    if len(journal.trades) == original_count:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

    # Save the updated journal
    journal.save_journal()

    return {"success": True, "message": f"Trade {trade_id} deleted"}


# ============== Order Endpoints ==============

@router.post("/order")
async def place_order(request: OrderRequest, user: "User" = Depends(get_current_user)):
    """Place a paper trading order."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)
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
async def close_position(request: ClosePositionRequest, user: "User" = Depends(get_current_user)):
    """Close a specific position."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)
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
    journal = get_journal(user_id)
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
        'peak_price': trade.peak_price,
        'low_price': trade.low_price,
    })
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
    from trading.paper_trader import ExitReason

    trader.close_all_positions(request.prices, ExitReason.MANUAL)

    return {
        "status": "success",
        "message": f"Closed {len(trader.trades)} positions",
        "portfolio": trader.get_portfolio_status()
    }


@router.post("/update-prices")
async def update_prices(request: UpdatePricesRequest, user: "User" = Depends(get_current_user)):
    """Update prices and check for SL/TP triggers."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)

    # Track trades before update
    trades_before = len(trader.trades)

    trader.update_prices(request.prices)

    # Check if any new trades were closed
    trades_after = len(trader.trades)
    new_trades_count = trades_after - trades_before

    # Log new trades to journal
    if new_trades_count > 0:
        journal = get_journal(user_id)
        new_trades = trader.trades[-new_trades_count:]
        for trade in new_trades:
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
                'peak_price': trade.peak_price,
                'low_price': trade.low_price,
            })
        # Save journal to file
        journal.save_journal()

    return {
        "status": "success",
        "portfolio": trader.get_portfolio_status(),
        "positions": trader.get_positions(),
        "trades_closed": new_trades_count
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
    user: "User" = Depends(get_current_user),
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
async def get_journal_summary(user: "User" = Depends(get_current_user)):
    """Get trading performance summary."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)
    return journal.get_performance_summary()


@router.get("/journal/symbols")
async def get_symbol_performance(user: "User" = Depends(get_current_user)):
    """Get performance by symbol."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)
    return journal.get_symbol_performance()


@router.get("/journal/daily")
async def get_daily_report(date: Optional[str] = None, user: "User" = Depends(get_current_user)):
    """Get daily trading report."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)
    return journal.get_daily_report(date)


@router.get("/journal/export")
async def export_journal(user: "User" = Depends(get_current_user)):
    """Export journal to CSV."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)
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


def _get_bot_status() -> dict:
    """Get current paper trading runner process status."""
    global _paper_bot_process

    def _runner_script_path() -> Path:
        return Path(__file__).parent.parent / "run_daily_trading.py"

    def _list_runner_pids() -> List[int]:
        script_name = _runner_script_path().name
        try:
            out = subprocess.check_output(["pgrep", "-f", script_name], text=True)
        except Exception:
            return []
        pids: List[int] = []
        for line in out.splitlines():
            try:
                pid = int(line.strip())
            except Exception:
                continue
            if pid != os.getpid():
                pids.append(pid)
        return sorted(set(pids))

    running = False
    pid = None
    return_code = None

    if _paper_bot_process is not None:
        return_code = _paper_bot_process.poll()
        if return_code is None:
            running = True
            pid = _paper_bot_process.pid
        else:
            # Process exited; clear handle so next start works cleanly
            _paper_bot_process = None

    runner_pids = _list_runner_pids()
    pid_from_file = _read_runner_pid_file()
    if pid_from_file is not None:
        if _is_pid_alive(pid_from_file):
            if pid_from_file not in runner_pids:
                runner_pids.append(pid_from_file)
                runner_pids = sorted(set(runner_pids))
        else:
            _clear_runner_pid_file()

    if not running and runner_pids:
        # API process may have restarted and lost local handle; recover status from OS.
        running = True
        if pid_from_file in runner_pids:
            pid = pid_from_file
        else:
            pid = runner_pids[0]
        return_code = None
        if pid is not None:
            _write_runner_pid_file(pid)

    return {
        "running": running,
        "pid": pid,
        "runner_pids": runner_pids,
        "return_code": return_code,
        "log_file": str(_paper_bot_log_file),
        "pid_file": str(_paper_bot_pid_file),
    }


@router.get("/bot/status")
async def get_paper_bot_status():
    """Get background paper trading runner status."""
    return _get_bot_status()


@router.get("/bot/snapshot")
async def get_paper_bot_snapshot():
    """Get latest scan/watchlist snapshot produced by runner."""
    if not _paper_bot_snapshot_file.exists():
        return {
            "timestamp": None,
            "watchlist": [],
            "open_positions": [],
            "scan_items": [],
            "signals": [],
        }
    try:
        import json
        return json.loads(_paper_bot_snapshot_file.read_text())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read snapshot: {e}")


@router.post("/bot/start")
async def start_paper_bot(user: "User" = Depends(get_current_user)):
    """Start background paper trading runner process."""
    global _paper_bot_process

    status = _get_bot_status()
    if status["running"]:
        return {
            "status": "already_running",
            "message": f"Paper trading runner is already running (pids={status.get('runner_pids', [])})",
            **status,
        }

    script_path = Path(__file__).parent.parent / "run_daily_trading.py"
    if not script_path.exists():
        raise HTTPException(status_code=500, detail=f"Runner script not found: {script_path}")

    # Keep logs for debugging runner behavior
    _paper_bot_log_file.parent.mkdir(parents=True, exist_ok=True)
    global _paper_bot_log_handle
    _paper_bot_log_handle = open(_paper_bot_log_file, "a", buffering=1)

    cmd = [sys.executable, "-u", str(script_path)]

    def _launch_process():
        global _paper_bot_process
        _paper_bot_process = subprocess.Popen(
            cmd,
            cwd=str(Path(__file__).parent.parent),
            stdout=_paper_bot_log_handle,
            stderr=_paper_bot_log_handle,
            start_new_session=True,
        )
        _write_runner_pid_file(_paper_bot_process.pid)

    await asyncio.to_thread(_launch_process)

    new_status = _get_bot_status()
    return {
        "status": "started",
        "message": "Paper trading runner started",
        **new_status,
    }


@router.post("/bot/stop")
async def stop_paper_bot(user: "User" = Depends(get_current_user)):
    """Stop background paper trading runner process."""
    global _paper_bot_process, _paper_bot_log_handle

    status = _get_bot_status()
    pids_to_stop = set(status.get("runner_pids") or [])
    if _paper_bot_process is not None and _paper_bot_process.poll() is None:
        pids_to_stop.add(_paper_bot_process.pid)

    if not pids_to_stop:
        return {
            "status": "not_running",
            "message": "Paper trading runner is not running",
            **status,
        }

    stopped = []
    still_running = []
    for pid in sorted(pids_to_stop):
        try:
            def _kill_and_wait(pid=pid):
                subprocess.run(["kill", str(pid)], check=False)
                for _ in range(10):
                    probe = subprocess.run(["kill", "-0", str(pid)], check=False)
                    if probe.returncode != 0:
                        return True
                    time.sleep(0.2)
                probe = subprocess.run(["kill", "-0", str(pid)], check=False)
                if probe.returncode == 0:
                    subprocess.run(["kill", "-9", str(pid)], check=False)
                    time.sleep(0.1)
                    probe = subprocess.run(["kill", "-0", str(pid)], check=False)
                return probe.returncode != 0

            killed = await asyncio.to_thread(_kill_and_wait)
            if killed:
                stopped.append(pid)
            else:
                still_running.append(pid)
        except Exception:
            still_running.append(pid)

    _paper_bot_process = None
    _clear_runner_pid_file()
    if _paper_bot_log_handle:
        try:
            _paper_bot_log_handle.close()
        except Exception:
            pass
        _paper_bot_log_handle = None
    new_status = _get_bot_status()
    return {
        "status": "stopped",
        "message": f"Stopped runner(s): {stopped}" + (f"; still running: {still_running}" if still_running else ""),
        "stopped_pids": stopped,
        "still_running_pids": still_running,
        **new_status,
    }


# ============== Chart Data Endpoint ==============

@router.get("/chart/{symbol}")
async def get_paper_chart(
    symbol: str,
    date: Optional[str] = None,
    timeframe: str = "5min",
    user: "User" = Depends(get_current_user),
):
    """
    Get intraday chart data with paper trade markers.

    Args:
        symbol: Stock symbol
        date: Date in YYYY-MM-DD format (default: today)
        timeframe: Candle timeframe - 1min, 5min, 15min, 1hour (default: 5min)

    Returns:
    - candles: OHLCV data for the day at requested timeframe
    - trades: List of trades for this symbol on this date
    - orb_levels: OR High, OR Low for the day
    - current_position: If there's an open position
    """
    try:
        # Import required modules
        import sys
        import pandas as pd
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
        upstox_api = UpstoxAPI(
            api_key=config.UPSTOX_API_KEY or "",
            api_secret=config.UPSTOX_API_SECRET or "",
            quiet=True,
        )

        def _resample_to_5m(df_1m):
            """Resample 1-minute OHLCV to 5-minute OHLCV."""
            if df_1m is None or df_1m.empty:
                return None

            df_work = df_1m.copy()

            if not isinstance(df_work.index, pd.DatetimeIndex):
                df_work.index = pd.to_datetime(df_work.index)

            df_work = df_work.sort_index()

            # Keep only columns needed by the chart response
            agg_map = {
                'open': 'first',
                'high': 'max',
                'low': 'min',
                'close': 'last',
                'volume': 'sum',
            }
            available_agg = {k: v for k, v in agg_map.items() if k in df_work.columns}
            if {'open', 'high', 'low', 'close'} - set(available_agg.keys()):
                return None

            resampled = (
                df_work
                .resample('5min', label='left', closed='left')
                .agg(available_agg)
                .dropna(subset=['open', 'high', 'low', 'close'])
            )

            return resampled if not resampled.empty else None

        def _resample_to_timeframe(df_1m, tf: str):
            """Resample 1-minute OHLCV to specified timeframe."""
            if df_1m is None or df_1m.empty:
                return None

            # Map timeframe string to pandas resample string
            tf_map = {
                '1min': '1min',
                '5min': '5min',
                '15min': '15min',
                '1hour': '1h',
            }
            resample_str = tf_map.get(tf, '5min')

            df_work = df_1m.copy()

            if not isinstance(df_work.index, pd.DatetimeIndex):
                df_work.index = pd.to_datetime(df_work.index)

            df_work = df_work.sort_index()

            # Keep only columns needed by the chart response
            agg_map = {
                'open': 'first',
                'high': 'max',
                'low': 'min',
                'close': 'last',
                'volume': 'sum',
            }
            available_agg = {k: v for k, v in agg_map.items() if k in df_work.columns}
            if {'open', 'high', 'low', 'close'} - set(available_agg.keys()):
                return None

            resampled = (
                df_work
                .resample(resample_str, label='left', closed='left')
                .agg(available_agg)
                .dropna(subset=['open', 'high', 'low', 'close'])
            )

            return resampled if not resampled.empty else None

        # Get date to fetch
        today = datetime.now(config.IST).strftime('%Y-%m-%d')
        if date is None:
            date = today

        # Always fetch 1-min data and resample to requested timeframe
        # This ensures all timeframes work consistently

        def _fetch_chart_data():
            df_1m = None

            # Use historical API for past dates, intraday for today
            if date == today:
                # Fetch today's intraday 1-min data
                df_1m = upstox_api.fetch_intraday_data_v3(
                    symbol=symbol.upper(),
                    interval='1'
                )
            else:
                # Fetch historical 1-min data for past dates
                from datetime import timedelta
                from_date = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=2)).strftime('%Y-%m-%d')
                df_1m_full = upstox_api.fetch_historical_data_v3(
                    symbol=symbol.upper(),
                    unit='minutes',
                    interval=1,
                    to_date=date,
                    from_date=from_date,
                )
                # Filter to only the requested date
                if df_1m_full is not None and not df_1m_full.empty:
                    date_start = f"{date}T00:00:00"
                    date_end = f"{date}T23:59:59"
                    df_1m = df_1m_full[df_1m_full.index >= date_start]
                    df_1m = df_1m[df_1m.index <= date_end]

                # Fallback: try broader range if no data
                if df_1m is None or df_1m.empty:
                    broad_from_date = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=30)).strftime('%Y-%m-%d')
                    df_1m_full = upstox_api.fetch_historical_data_v3(
                        symbol=symbol.upper(),
                        unit='minutes',
                        interval=1,
                        to_date=date,
                        from_date=broad_from_date,
                    )
                    if df_1m_full is not None and not df_1m_full.empty:
                        date_start = f"{date}T00:00:00"
                        date_end = f"{date}T23:59:59"
                        df_1m = df_1m_full[df_1m_full.index >= date_start]
                        df_1m = df_1m[df_1m.index <= date_end]

            return df_1m

        df_1m = await asyncio.to_thread(_fetch_chart_data)

        # Resample to requested timeframe
        df = _resample_to_timeframe(df_1m, timeframe)

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

        # Get 52-week levels from historical data
        week52_levels = None
        try:
            from datetime import timedelta as td
            to_date = datetime.now(config.IST).strftime('%Y-%m-%d')
            from_date = (datetime.now(config.IST) - td(days=400)).strftime('%Y-%m-%d')
            df_52w = upstox_api.fetch_historical_data_v3(
                symbol=symbol.upper(),
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
            )
            if df_52w is not None and not df_52w.empty:
                highs = df_52w['high'].tolist()
                lows = df_52w['low'].tolist()
                window = highs[-252:] if len(highs) >= 252 else highs
                high_52w = max(window) if window else 0
                low_window = lows[-252:] if len(lows) >= 252 else lows
                low_52w = min(low_window) if low_window else 0
                if high_52w > 0:
                    current_price = candles[-1]['close'] if candles else 0
                    week52_levels = {
                        "high_52w": float(high_52w),
                        "low_52w": float(low_52w) if low_52w > 0 else 0,
                        "distance_to_high_pct": ((high_52w - current_price) / high_52w * 100) if high_52w > 0 and current_price > 0 else 0,
                        "distance_to_low_pct": ((current_price - low_52w) / low_52w * 100) if low_52w > 0 and current_price > 0 else 0,
                        "near_high": ((high_52w - current_price) / high_52w * 100) <= 3.0 if high_52w > 0 and current_price > 0 else False,
                    }
        except Exception as e:
            console.print(f"[yellow]Could not fetch 52W levels for {symbol}: {e}[/yellow]")

        # Get trades from journal for this symbol and date
        # Load the journal file for the specific date
        from trading.journal import TradeJournal
        uid = _get_user_id(user)
        journal_dir = Path(__file__).parent.parent / "journals" / str(uid)
        date_str = date.replace('-', '')  # 2026-02-23 -> 20260223
        journal_file = journal_dir / f"journal_{date_str}.json"

        symbol_trades = []
        if journal_file.exists():
            temp_journal = TradeJournal(user_id=uid)
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
            journal = get_journal(uid)
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

        # Check for current position - prefer bot snapshot (for cross-process sync)
        current_position = None
        snap = _load_fresh_bot_snapshot()
        if snap:
            snap_positions = snap.get("open_positions_data") or []
            for pos in snap_positions:
                if pos.get("symbol", "").upper() == symbol.upper():
                    current_position = pos
                    break

        # Fallback to in-memory trader positions if no snapshot
        if not current_position:
            trader = get_paper_trader()
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
            "timeframe": timeframe,
            "candles": candles,
            "trades": trades_data,
            "orb_levels": orb_levels,
            "week52_levels": week52_levels,
            "current_position": current_position,
        }

    except Exception as e:
        console.print(f"[red]Error fetching chart data: {e}[/red]")
        return {"error": str(e), "symbol": symbol, "date": date}


# ============== Strategy Configuration Endpoints ==============

class StrategyConfigUpdate(BaseModel):
    """Model for updating strategy config."""
    # ORB Strategy Parameters
    or_minutes: Optional[int] = None
    sl_pct: Optional[float] = None
    tp_pct: Optional[float] = None
    min_or_range_pct: Optional[float] = None
    max_or_range_pct: Optional[float] = None

    # Risk Management Parameters
    max_positions: Optional[int] = None
    max_capital_per_trade_pct: Optional[float] = None
    max_daily_loss_pct: Optional[float] = None
    max_total_exposure_pct: Optional[float] = None
    risk_per_trade_pct: Optional[float] = None
    min_trade_value: Optional[float] = None
    max_trade_value: Optional[float] = None

    # Trading Runner Parameters
    cooldown_minutes: Optional[int] = None
    max_distance_from_or_pct: Optional[float] = None

    # Cost Parameters
    brokerage_pct: Optional[float] = None
    min_brokerage: Optional[float] = None
    stt_pct: Optional[float] = None
    exchange_pct: Optional[float] = None
    sebi_pct: Optional[float] = None
    stamp_pct: Optional[float] = None
    gst_pct: Optional[float] = None


@router.get("/config")
async def get_strategy_config_endpoint(
    name: Optional[str] = None,
    strategy_id: Optional[int] = None,
):
    """Get strategy configuration from database.

    Args:
        name: Config name (e.g., 'orb_default')
        strategy_id: Strategy ID (takes precedence over name)
    """
    try:
        from trading.config_loader import get_strategy_config, get_strategy_by_id, StrategyConfigData

        # If strategy_id is provided, use it
        if strategy_id:
            config = get_strategy_by_id(strategy_id)
            if not config:
                raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")
        else:
            config = get_strategy_config(name)

        return {
            "status": "success",
            "config": config.to_dict(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {e}")


@router.put("/config")
async def update_strategy_config_endpoint(
    request: StrategyConfigUpdate,
    name: str = "orb_default",
    user: "User" = Depends(get_current_user),
):
    """Update strategy configuration in database."""
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            config = db.query(StrategyConfig).filter(
                StrategyConfig.name == name
            ).first()

            if not config:
                # Create new config if doesn't exist
                config = StrategyConfig(name=name, strategy_type="ORB", is_default=(name == "orb_default"))
                db.add(config)

            # Update only provided fields
            update_data = request.model_dump(exclude_unset=True)
            for key, value in update_data.items():
                if value is not None and hasattr(config, key):
                    setattr(config, key, value)

            db.commit()
            db.refresh(config)

            return {
                "status": "success",
                "message": f"Config '{name}' updated",
                "config": config.to_dict(),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update config: {e}")


@router.post("/config/reset")
async def reset_strategy_config_endpoint(name: str = "orb_default", user: "User" = Depends(get_current_user)):
    """Reset strategy configuration to defaults."""
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            config = db.query(StrategyConfig).filter(
                StrategyConfig.name == name
            ).first()

            if not config:
                raise HTTPException(status_code=404, detail=f"Config '{name}' not found")

            # Reset to default values
            config.or_minutes = 45
            config.sl_pct = 0.4
            config.tp_pct = 1.2
            config.min_or_range_pct = 0.5
            config.max_or_range_pct = 3.0
            config.max_positions = 5
            config.max_capital_per_trade_pct = 0.10
            config.max_daily_loss_pct = 0.02
            config.max_total_exposure_pct = 0.50
            config.risk_per_trade_pct = 0.01
            config.min_trade_value = 5000
            config.max_trade_value = 100000
            config.cooldown_minutes = 30
            config.max_distance_from_or_pct = 1.5
            config.brokerage_pct = 0.0003
            config.min_brokerage = 20
            config.stt_pct = 0.00025
            config.exchange_pct = 0.0000297
            config.sebi_pct = 0.000001
            config.stamp_pct = 0.00003
            config.gst_pct = 0.18

            db.commit()
            db.refresh(config)

            return {
                "status": "success",
                "message": f"Config '{name}' reset to defaults",
                "config": config.to_dict(),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset config: {e}")
