"""Strategy Runner API — SSE with real-time progress via threading."""
import json as _json
import queue, threading
from typing import Optional

import numpy as np

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel

from trading.runner_core import MultiStrategyRunner
from db.database import SessionLocal
from db.models.bot import BotConfig

def _clean(obj):
    """Convert numpy types to native Python for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.bool_):
        return bool(obj)
    return obj

router = APIRouter(prefix="/api/strategy-runner", tags=["strategy-runner"])


class StrategyRunnerRequest(BaseModel):
    bot_uuids: list[str]
    date: str
    end_date: Optional[str] = None
    symbols: list[str]


@router.post("/run")
def run_strategy_runner(request: Request, body: StrategyRunnerRequest):
    """Run multiple bots. SSE stream with real-time events via threading."""

    def event_stream():
        total_bots = len(body.bot_uuids)

        for idx, bot_uuid in enumerate(body.bot_uuids):
            # Load bot config (keep session open for eager-load)
            db = SessionLocal()
            try:
                bot_config = db.query(BotConfig).filter(BotConfig.uuid == bot_uuid).first()
                if not bot_config:
                    yield {"event": "error", "data": _json.dumps({"message": f"Bot {bot_uuid} not found"})}
                    continue
                _ = bot_config.strategies  # eager-load
            finally:
                db.close()

            s = bot_config.strategies[0] if bot_config.strategies else None
            yield {"event": "bot_start", "data": _json.dumps({
                "bot_index": idx, "total_bots": total_bots,
                "bot_name": bot_config.name,
                "strategy_name": s.name if s else "",
                "strategy_type": s.strategy_type if s else "",
            })}

            # Run replay in a thread, pipe events via queue
            q = queue.Queue()
            SENTINEL = object()

            def on_event(e):
                q.put(e)

            def target():
                try:
                    db2 = SessionLocal()
                    try:
                        bc = db2.query(BotConfig).filter(BotConfig.uuid == bot_uuid).first()
                        _ = bc.strategies
                        runner = MultiStrategyRunner.create_for_replay(bot_config=bc)
                        runner.run_replay(
                            date_str=body.date, symbols=body.symbols,
                            strategy_filter="ALL", on_event=on_event,
                            end_date_str=body.end_date,
                        )
                    finally:
                        db2.close()
                except Exception as ex:
                    q.put({"type": "error", "message": str(ex)})
                finally:
                    q.put(SENTINEL)

            thread = threading.Thread(target=target, daemon=True)
            thread.start()

            bot_trades = []
            while True:
                ev = q.get()
                if ev is SENTINEL:
                    break
                # Only forward trade_close and error events to SSE
                # (loaded, progress, candles, ema_series etc. are consumed silently)
                if ev["type"] == "trade_close":
                    ev["bot_name"] = bot_config.name
                    ev["bot_uuid"] = bot_uuid
                    bot_trades.append(ev)
                    yield {"event": "trade", "data": _json.dumps(_clean(ev))}
                elif ev["type"] == "error":
                    yield {"event": "error", "data": _json.dumps({"message": str(ev.get("message", ""))})}

            thread.join()

            yield {"event": "bot_done", "data": _json.dumps({
                "bot_index": idx, "bot_name": bot_config.name, "trades": len(bot_trades),
            })}

        # ── Combined summary ──
        yield {"event": "done", "data": _json.dumps({"status": "complete"})}

    return EventSourceResponse(event_stream())

