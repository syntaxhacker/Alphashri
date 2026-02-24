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

# Background runner process state
_paper_bot_process: Optional[subprocess.Popen] = None
_paper_bot_log_file = Path("/tmp/paper-trading-runner.log")
_paper_bot_log_handle = None
_paper_bot_snapshot_file = Path("/tmp/paper-trading-snapshot.json")
_paper_bot_pid_file = Path("/tmp/paper-trading-runner.pid")


def _load_fresh_bot_snapshot(max_age_seconds: int = 300) -> Optional[dict]:
    """Load bot snapshot only when it is recent enough to represent live state."""
    if not _paper_bot_snapshot_file.exists():
        return None

    try:
        data = json.loads(_paper_bot_snapshot_file.read_text())
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


def _read_runner_pid_file() -> Optional[int]:
    """Read persisted runner PID from disk."""
    try:
        if not _paper_bot_pid_file.exists():
            return None
        return int(_paper_bot_pid_file.read_text().strip())
    except Exception:
        return None


def _write_runner_pid_file(pid: int) -> None:
    """Persist runner PID so API reloads can still track the process."""
    try:
        _paper_bot_pid_file.write_text(str(pid))
    except Exception:
        pass


def _clear_runner_pid_file() -> None:
    """Remove persisted runner PID file."""
    try:
        if _paper_bot_pid_file.exists():
            _paper_bot_pid_file.unlink()
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

@router.get("/portfolio")
async def get_portfolio():
    """Get current paper trading portfolio status."""
    trader = get_paper_trader()
    status = trader.get_portfolio_status()

    # If bot runs in a separate process, in-memory portfolio here may be stale.
    # Recompute key live fields from snapshot open positions when available.
    snap = _load_fresh_bot_snapshot()
    if snap:
        snap_positions = snap.get("open_positions_data") or []
        if isinstance(snap_positions, list) and len(snap_positions) > 0:
            margin_used = sum(float(p.get("entry_price", 0)) * int(p.get("quantity", 0)) for p in snap_positions)
            position_value = sum(float(p.get("current_price", 0)) * int(p.get("quantity", 0)) for p in snap_positions)
            unrealized_pnl = sum(float(p.get("pnl", 0)) for p in snap_positions)

            cash = status.get("initial_capital", 0) - margin_used
            total_value = cash + position_value
            total_pnl = total_value - status.get("initial_capital", 0)
            total_pnl_pct = (total_pnl / status.get("initial_capital", 1) * 100) if status.get("initial_capital", 0) else 0

            status.update({
                "cash": round(cash, 2),
                "margin_used": round(margin_used, 2),
                "position_value": round(position_value, 2),
                "unrealized_pnl": round(unrealized_pnl, 2),
                "total_value": round(total_value, 2),
                "total_pnl": round(total_pnl, 2),
                "total_pnl_pct": round(total_pnl_pct, 2),
                "positions": len(snap_positions),
                "open_positions": len(snap_positions),
            })
    if "daily_pnl_pct" not in status:
        base = status.get("initial_capital", 0) or 0
        daily_pnl = status.get("daily_pnl", 0) or 0
        status["daily_pnl_pct"] = (daily_pnl / base * 100) if base else 0.0

    return status


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
    positions = trader.get_positions()

    # If bot runs in a separate process, in-memory positions in API process can be stale.
    # Prefer fresh snapshot positions when available so live table and summary stay in sync.
    snap = _load_fresh_bot_snapshot()
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
    symbol: Optional[str] = None,
    strategy: Optional[str] = None,
):
    """Get trade history from journal with filters."""
    from trading.journal import TradeJournal

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
        # No date filter - merge in-memory journal + journal files (including today)
        # In-memory journal can be stale when runner writes from another process,
        # so we always load today's file as source of truth and dedupe.
        journal = get_journal()
        all_trades = [asdict(t) for t in journal.trades]

        # Load recent journal files (today + previous 7 days)
        for i in range(0, 8):
            day_str = (datetime.now() - __import__('datetime').timedelta(days=i)).strftime('%Y%m%d')
            journal_file = journal_dir / f"journal_{day_str}.json"
            if not journal_file.exists():
                continue
            try:
                temp_journal = TradeJournal()
                temp_journal.load_journal(str(journal_file))
                all_trades.extend([asdict(t) for t in temp_journal.trades])
            except Exception:
                pass

        # Deduplicate merged trades across memory/file sources.
        # trade_id can repeat across runner restarts, so include times/symbol/qty.
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
async def start_paper_bot():
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
    _paper_bot_process = subprocess.Popen(
        cmd,
        cwd=str(Path(__file__).parent.parent),
        stdout=_paper_bot_log_handle,
        stderr=_paper_bot_log_handle,
        start_new_session=True,
    )
    _write_runner_pid_file(_paper_bot_process.pid)

    new_status = _get_bot_status()
    return {
        "status": "started",
        "message": "Paper trading runner started",
        **new_status,
    }


@router.post("/bot/stop")
async def stop_paper_bot():
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
            subprocess.run(["kill", str(pid)], check=False)
            for _ in range(10):
                probe = subprocess.run(["kill", "-0", str(pid)], check=False)
                if probe.returncode != 0:
                    break
                time.sleep(0.2)
            probe = subprocess.run(["kill", "-0", str(pid)], check=False)
            if probe.returncode == 0:
                subprocess.run(["kill", "-9", str(pid)], check=False)
                time.sleep(0.1)
                probe = subprocess.run(["kill", "-0", str(pid)], check=False)
            if probe.returncode != 0:
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
        import pandas as pd
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage

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
            # Fallback: if 5-min data is unavailable, fetch 1-min and resample
            if df is None or df.empty:
                df_1m = screener.upstox_api.fetch_intraday_data_v3(
                    symbol=symbol.upper(),
                    interval='1'
                )
                df = _resample_to_5m(df_1m)
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

            # Fallback: if 5-min historical data is unavailable, fetch 1-min and resample
            if df is None or df.empty:
                df_1m_full = screener.upstox_api.fetch_historical_data_v3(
                    symbol=symbol.upper(),
                    unit='minutes',
                    interval=1,
                    to_date=date,
                    from_date=from_date,
                )
                # Upstox can return empty minute candles for multi-day ranges on some symbols.
                # Retry with same-day window before failing.
                if (df_1m_full is None or df_1m_full.empty) and from_date != date:
                    df_1m_full = screener.upstox_api.fetch_historical_data_v3(
                        symbol=symbol.upper(),
                        unit='minutes',
                        interval=1,
                        to_date=date,
                        from_date=date,
                    )
                # Additional fallback for symbols where narrow windows miss latest minutes.
                # Query a broader range, then filter the requested date.
                if df_1m_full is None or df_1m_full.empty:
                    broad_from_date = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=30)).strftime('%Y-%m-%d')
                    df_1m_full = screener.upstox_api.fetch_historical_data_v3(
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
                else:
                    df_1m = None
                df = _resample_to_5m(df_1m)

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
