"""
Autoresearch experiment API — start/pause/resume/cancel grid-sweep sessions.

Endpoints mirror the design of ``trading/autoresearch_engine.py``:
- A "session" is a named grid sweep persisted to ``experiments/sessions/<session>.jsonl``
  (config header first line, one result line per run).
- Engines run cooperatively as asyncio tasks, keyed by session in a module-level
  dict so pause/resume/status work across requests.
- Engines are recreated lazily if the API restarts (the loader is rebuilt from the
  persisted session header).

Data loading:
- symbol ``NEWGEN`` -> ``experiments.newgen.common.load_newgen(tf)``
- anything else -> ``market_data.market_data.fetch_candles`` (Upstox-backed),
  wrapped in try/except so a missing symbol degrades to empty data.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import config
from api.auth import get_current_user
from api.screener import _sanitize_for_json
from trading import autoresearch_engine
from trading.autoresearch_strategies import STRATEGY_SIMS, get_strategy_defaults, get_strategy_params
from backtest.chart_data import build_chart_data_for_symbol

router = APIRouter(prefix="/api/experiments", tags=["experiments"])

# Module-level engine registry: session name -> AutoresearchEngine.
# Survives across requests within one process so pause/resume/status work.
_engines: Dict[str, autoresearch_engine.AutoresearchEngine] = {}

# Default fetch window for generic symbols when no dates are supplied.
_DEFAULT_LOOKBACK_DAYS = 30


class StartExperimentRequest(BaseModel):
    session: str
    strategy: str
    symbols: List[str]
    tf: int = 5
    param_space: Dict[str, List]
    date_start: Optional[str] = ""
    date_end: Optional[str] = ""
    include_costs: bool = True
    description: str = ""


# ---------------------------------------------------------------------------
# data loader factory
# ---------------------------------------------------------------------------
def _default_date_range() -> tuple:
    now = datetime.now(config.IST)
    to_date = now.strftime("%Y-%m-%d")
    from_date = (now - timedelta(days=_DEFAULT_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    return from_date, to_date


def _make_data_loader(symbols: List[str], tf: int, date_start: str = "", date_end: str = ""):
    """Build a ``(tf) -> {symbol: df}`` loader closure for a set of symbols."""

    def data_loader(requested_tf: int) -> Dict[str, object]:
        data: Dict[str, object] = {}
        effective_tf = requested_tf or tf
        for symbol in symbols:
            try:
                if symbol == "NEWGEN":
                    from experiments.newgen.common import load_newgen
                    data[symbol] = load_newgen(effective_tf)
                else:
                    from market_data.market_data import fetch_candles
                    from_date, to_date = _default_date_range()
                    if date_start:
                        from_date = date_start
                    if date_end:
                        to_date = date_end
                    df = fetch_candles(symbol, effective_tf, from_date, to_date)
                    data[symbol] = df if df is not None and not df.empty else None
            except Exception:
                data[symbol] = None
        return data

    return data_loader


def _read_session_meta(session: str) -> Dict:
    """Read the config header line of a session's JSONL, if present."""
    path = autoresearch_engine.SESSIONS_DIR / f"{session}.jsonl"
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("type") == "config":
                    return obj
                break
    except (OSError, ValueError):
        pass
    return {}


def _get_engine(session: str) -> autoresearch_engine.AutoresearchEngine:
    """Return the engine for a session, lazily creating one if the API restarted.

    A lazily-created engine rebuilds its loader from the persisted session header
    (symbols/tf/dates) so ``rerun_for_chart`` can still re-evaluate logged runs.
    """
    engine = _engines.get(session)
    if engine is None:
        meta = _read_session_meta(session)
        engine = autoresearch_engine.AutoresearchEngine(
            _make_data_loader(
                meta.get("symbols", []),
                meta.get("tf", 5),
                meta.get("date_start", ""),
                meta.get("date_end", ""),
            )
        )
        _engines[session] = engine
    return engine


# ---------------------------------------------------------------------------
# helpers for chart data
# ---------------------------------------------------------------------------
def _normalize_trade(trade: Dict) -> Dict:
    """Convert an engine-format trade dict to the chart_data/backtest format.

    The engine sims emit ``{side, entry_price, exit_price, gross_pnl, costs, ...}``
    while ``backtest.chart_data.format_trade_markers`` expects ``quantity``,
    ``trading_costs``, ``net_pnl_pct``, ``hold_duration_minutes``.
    """
    entry = float(trade.get("entry_price") or 0)
    exit_p = float(trade.get("exit_price") or 0)
    gross = float(trade.get("gross_pnl") or 0)
    net = float(trade.get("net_pnl") or 0)
    # Engine sims use DEFAULT_CAPITAL = 100_000 with qty = int(capital / entry).
    qty = int(100000 / entry) if entry > 0 else 0
    net_pct = round(net / (entry * qty) * 100, 2) if entry > 0 and qty > 0 else 0.0
    return {
        "symbol": trade.get("symbol"),
        "side": trade.get("side"),
        "entry_price": entry,
        "exit_price": exit_p,
        "gross_pnl": gross,
        "trading_costs": float(trade.get("costs") or 0),
        "net_pnl": net,
        "net_pnl_pct": net_pct,
        "exit_reason": trade.get("exit_reason"),
        "entry_time": str(trade.get("entry_time") or ""),
        "exit_time": str(trade.get("exit_time") or ""),
        "date": str(trade.get("date") or ""),
        "quantity": qty,
        "hold_duration_minutes": int(trade.get("hold_duration_minutes") or 0),
    }


def _load_candles(symbol: str, tf: int, date_start: str = "", date_end: str = ""):
    """Fetch candles for a symbol (NEWGEN special-cased). Returns None on failure."""
    try:
        if symbol == "NEWGEN":
            from experiments.newgen.common import load_newgen
            df = load_newgen(tf)
        else:
            from market_data.market_data import fetch_candles
            from_date, to_date = _default_date_range()
            if date_start:
                from_date = date_start
            if date_end:
                to_date = date_end
            df = fetch_candles(symbol, tf, from_date, to_date)
        return df if df is not None and not df.empty else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------
@router.post("/start")
async def start_experiment(
    request: StartExperimentRequest,
    current_user=Depends(get_current_user),
):
    session = request.session.strip()
    if not session:
        raise HTTPException(status_code=400, detail="session must be non-empty")

    if request.strategy not in STRATEGY_SIMS:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {request.strategy}")

    if not request.symbols:
        raise HTTPException(status_code=400, detail="symbols must be non-empty")

    if not request.param_space:
        raise HTTPException(status_code=400, detail="param_space must be non-empty")

    grid_size = math.prod(len(v) for v in request.param_space.values())
    if grid_size > autoresearch_engine.MAX_CANDIDATES:
        raise HTTPException(
            status_code=400,
            detail=f"Grid too large: {grid_size} candidates (max {autoresearch_engine.MAX_CANDIDATES})",
        )

    existing = _engines.get(session)
    if existing is not None and existing.is_running(session):
        raise HTTPException(status_code=409, detail=f"Session '{session}' already running")

    engine = autoresearch_engine.AutoresearchEngine(
        _make_data_loader(
            request.symbols,
            request.tf,
            request.date_start or "",
            request.date_end or "",
        )
    )
    _engines[session] = engine

    result = engine.start(
        session,
        current_user.id,
        request.strategy,
        request.symbols,
        request.tf,
        request.param_space,
        date_start=request.date_start or "",
        date_end=request.date_end or "",
        include_costs=request.include_costs,
        description=request.description or "",
    )
    if isinstance(result, dict) and result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return _sanitize_for_json(result)


@router.post("/{session}/pause")
async def pause_experiment(session: str, current_user=Depends(get_current_user)):
    engine = _get_engine(session)
    if not engine.is_running(session):
        # Avoid corrupting a finished/absent session's status to "paused".
        return {"status": "not_running", "session": session}
    return _sanitize_for_json(engine.pause(session, current_user.id))


@router.post("/{session}/resume")
async def resume_experiment(session: str, current_user=Depends(get_current_user)):
    engine = _get_engine(session)
    if not engine.is_paused(session):
        return {"status": "not_paused", "session": session}
    return _sanitize_for_json(engine.resume(session, current_user.id))


@router.post("/{session}/cancel")
async def cancel_experiment(session: str, current_user=Depends(get_current_user)):
    return _sanitize_for_json(_get_engine(session).cancel(session, current_user.id))


@router.get("/list")
async def list_sessions(current_user=Depends(get_current_user)):
    sessions = []
    sessions_dir = autoresearch_engine.SESSIONS_DIR
    if sessions_dir.exists():
        for path in sorted(sessions_dir.glob("*.jsonl")):
            session = path.stem
            meta = _read_session_meta(session)
            runs = len(autoresearch_engine.ExperimentSession(session, current_user.id).load_runs())
            engine = _get_engine(session)
            status = "running" if engine.is_running(session) else "completed"
            sessions.append({
                "session": session,
                "strategy": meta.get("strategy"),
                "tf": meta.get("tf"),
                "symbols": meta.get("symbols", []),
                "runs": runs,
                "status": status,
            })
    return _sanitize_for_json(sessions)


@router.get("/{session}/state")
async def get_session_state(session: str, current_user=Depends(get_current_user)):
    return _sanitize_for_json(_get_engine(session).get_status(session, current_user.id))


@router.get("/{session}/results")
async def get_session_results(session: str, current_user=Depends(get_current_user)):
    runs = autoresearch_engine.ExperimentSession(session, current_user.id).load_runs()
    return _sanitize_for_json(runs)


@router.get("/strategies")
async def get_strategies():
    strategies = [{"key": k, "params": get_strategy_params(k)} for k in STRATEGY_SIMS]
    defaults = {k: get_strategy_defaults(k) for k in STRATEGY_SIMS}
    return {"strategies": strategies, "defaults": defaults}


@router.get("/{session}/chart/{run_id}")
async def get_session_chart(
    session: str,
    run_id: int,
    symbol: str = Query("NEWGEN", description="Symbol to chart; NEWGEN uses the shared cache"),
    current_user=Depends(get_current_user),
):
    engine = _get_engine(session)
    meta = _read_session_meta(session)
    tf = meta.get("tf", 5)
    strategy = meta.get("strategy", "")
    or_minutes = 15 if strategy == "orb" else 45

    try:
        result = engine.rerun_for_chart(session, current_user.id, run_id, symbol)
        if isinstance(result, dict) and result.get("error"):
            return _sanitize_for_json({
                "run": run_id,
                "config": result.get("config", {}),
                "trades": result.get("trades", []),
                "error": result["error"],
            })

        trades = result.get("trades", [])
        candles_df = _load_candles(symbol, tf, meta.get("date_start", ""), meta.get("date_end", ""))
        if candles_df is None or len(candles_df) == 0:
            return _sanitize_for_json({
                "run": run_id,
                "config": result.get("config", {}),
                "trades": trades,
                "error": f"No candle data available for {symbol}",
            })

        chart_data = build_chart_data_for_symbol(
            symbol,
            candles_df,
            [_normalize_trade(t) for t in trades],
            or_minutes,
        )
        return _sanitize_for_json({
            **chart_data,
            "run": run_id,
            "config": result.get("config", {}),
            "metrics": result.get("metrics", {}),
            "combined": result.get("combined", {}),
        })
    except Exception as e:
        return _sanitize_for_json({
            "run": run_id,
            "config": {},
            "trades": [],
            "error": str(e),
        })
