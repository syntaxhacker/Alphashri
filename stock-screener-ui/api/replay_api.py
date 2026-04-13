"""Replay Trading Day API — SSE streaming endpoint."""
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from trading.replay_utils import DEFAULT_WATCHLIST

router = APIRouter(prefix="/api/replay", tags=["replay"])

executor = ThreadPoolExecutor(max_workers=2)


class ReplayRequest(BaseModel):
    date: str
    strategy: str = "ALL"
    symbols: Optional[str] = None
    refresh_cache: bool = False
    bot_config_id: int = 1


def _load_symbols(symbols_arg: Optional[str]) -> list[str]:
    if symbols_arg == "DEFAULT" or not symbols_arg:
        return DEFAULT_WATCHLIST
    if symbols_arg:
        return [s.strip().upper() for s in symbols_arg.split(",") if s.strip()]
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
            runner = MultiStrategyRunner.create_for_replay(
                bot_config_id=request.bot_config_id,
                user_id=request.bot_config_id,
            )
            runner.watchlist = symbols
            runner.run_replay(
                date_str=request.date,
                symbols=symbols,
                strategy_filter=request.strategy,
                on_event=on_event,
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
    """Return the default watchlist of symbols available for replay."""
    return {"symbols": DEFAULT_WATCHLIST}
