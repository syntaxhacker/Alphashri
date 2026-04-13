"""Replay Trading Day API — SSE streaming endpoint."""
import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/replay", tags=["replay"])

executor = ThreadPoolExecutor(max_workers=2)


class ReplayRequest(BaseModel):
    date: str
    strategy: str = "ALL"
    symbols: Optional[str] = None
    refresh_cache: bool = False


@router.post("/run")
async def run_replay(request: ReplayRequest):
    """Run replay and stream events via SSE."""
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

            from experiments.replay_trading_day import run_replay as _run_replay, _load_symbols

            symbols = _load_symbols(request.symbols)
            _run_replay(
                date_str=request.date,
                symbols=symbols,
                strategy_filter=request.strategy,
                verbose=False,
                refresh_cache=request.refresh_cache,
                on_event=on_event,
            )
        except Exception as e:
            on_event({"type": "error", "message": str(e)})
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
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from experiments.replay_trading_day import DEFAULT_WATCHLIST
    return {"symbols": DEFAULT_WATCHLIST}
