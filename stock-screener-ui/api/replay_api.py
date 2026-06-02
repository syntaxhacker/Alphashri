"""Replay Trading Day API — SSE streaming endpoint."""
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.auth import get_current_user
from trading.replay_utils import DEFAULT_WATCHLIST

router = APIRouter(prefix="/api/replay", tags=["replay"])

executor = ThreadPoolExecutor(max_workers=2)


class ReplayRequest(BaseModel):
    date: str
    end_date: Optional[str] = None
    strategy: str = "ALL"
    symbols: Optional[list[str]] = None
    refresh_cache: bool = False
    bot_uuid: Optional[str] = None


def _load_symbols(symbols_arg: Optional[list[str]]) -> list[str]:
    if not symbols_arg:
        return _get_dynamic_watchlist()
    return [s.strip().upper() for s in symbols_arg if s.strip()]


def _get_dynamic_watchlist() -> list[str]:
    """Get watchlist from TV screener, fallback to DEFAULT_WATCHLIST."""
    try:
        from orb_stock_screener import ORBStockScreener
        screener = ORBStockScreener(use_relaxed=True)
        df = screener.screen(limit=50, verify_nse=True)
        if df is not None and not df.empty:
            symbols = df['name'].tolist()[:50]
            return [s.upper() for s in symbols]
    except Exception:
        pass
    return DEFAULT_WATCHLIST


@router.post("/run")
async def run_replay(request: ReplayRequest):
    """Run replay using MultiStrategyRunner and stream events via SSE."""
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def on_event(event: dict):
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    def run_in_thread():
        try:
            import sys
            from pathlib import Path
            sys.path.insert(0, str(Path(__file__).parent.parent))
            sys.path.insert(0, str(Path(__file__).parent.parent.parent))

            from trading.runner_core import MultiStrategyRunner

            symbols = _load_symbols(request.symbols)
            if request.bot_uuid:
                bot_config = MultiStrategyRunner._load_bot_config_by_uuid(request.bot_uuid)
            else:
                bot_config = MultiStrategyRunner._load_bot_config(1)
                from trading.replay_utils import STRATEGY_FILTER_MAP
                allowed = STRATEGY_FILTER_MAP.get(request.strategy, ())
                if allowed:
                    from db.database import SessionLocal
                    from sqlalchemy import text as _sql_text
                    with SessionLocal() as db:
                        placeholders = ','.join(':t' + str(i) for i in range(len(allowed)))
                        params = {f't{i}': v for i, v in enumerate(allowed)}
                        rows = db.execute(
                            _sql_text(
                                f"""SELECT DISTINCT bs.bot_id FROM bot_strategies bs
                                    JOIN strategy_configs sc ON sc.id = bs.strategy_id
                                    WHERE sc.strategy_type IN ({placeholders})"""
                            ),
                            params,
                        ).fetchall()
                        bot_ids = [r[0] for r in rows]
                        if bot_ids and bot_ids[0] != 1:
                            bot_config = MultiStrategyRunner._load_bot_config(bot_ids[0])
            runner = MultiStrategyRunner.create_for_replay(bot_config=bot_config)
            runner.watchlist = symbols
            runner.run_replay(
                date_str=request.date,
                symbols=symbols,
                strategy_filter=request.strategy,
                on_event=on_event,
                end_date_str=request.end_date,
            )
        except Exception as e:
            import traceback as tb
            on_event({"type": "error", "message": f"{e}\n{tb.format_exc()}"})
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)

    future = executor.submit(run_in_thread)

    async def event_stream():
        try:
            while True:
                event = await asyncio.wait_for(queue.get(), timeout=300)
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Replay timed out'})}\n\n"
        finally:
            future.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/symbols")
async def get_available_symbols():
    """Return the watchlist of symbols available for replay."""
    return {"symbols": _get_dynamic_watchlist()}


class ReplayConfigSaveRequest(BaseModel):
    name: str
    description: str | None = None
    config: dict


@router.get("/configs")
async def list_saved_configs(user=Depends(get_current_user)):
    """List all saved replay configs for the current user."""
    from db.database import SessionLocal
    from db.models import ReplaySavedConfig

    db = SessionLocal()
    try:
        configs = (
            db.query(ReplaySavedConfig)
            .filter(ReplaySavedConfig.user_id == user.id)
            .order_by(ReplaySavedConfig.updated_at.desc())
            .all()
        )
        return {"configs": [c.to_dict() for c in configs]}
    finally:
        db.close()


@router.post("/configs")
async def save_config(data: ReplayConfigSaveRequest, user=Depends(get_current_user)):
    """Save a new replay config."""
    from db.database import SessionLocal
    from db.models import ReplaySavedConfig

    db = SessionLocal()
    try:
        existing = (
            db.query(ReplaySavedConfig)
            .filter(
                ReplaySavedConfig.user_id == user.id,
                ReplaySavedConfig.name == data.name,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="A config with this name already exists")
        config = ReplaySavedConfig(
            user_id=user.id,
            name=data.name,
            description=data.description,
            config=data.config,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
        return config.to_dict()
    finally:
        db.close()


@router.delete("/configs/{config_id}")
async def delete_config(config_id: int, user=Depends(get_current_user)):
    """Delete a saved replay config."""
    from db.database import SessionLocal
    from db.models import ReplaySavedConfig

    db = SessionLocal()
    try:
        config = (
            db.query(ReplaySavedConfig)
            .filter(
                ReplaySavedConfig.id == config_id,
                ReplaySavedConfig.user_id == user.id,
            )
            .first()
        )
        if not config:
            raise HTTPException(status_code=404, detail="Config not found")
        db.delete(config)
        db.commit()
        return {"ok": True}
    finally:
        db.close()
