"""
Live price streaming via SSE (Server-Sent Events).

Connects to Upstox MarketDataStreamerV3 WebSocket and streams live
LTP updates for open positions to the frontend.
"""

import sys
import os
import json
import asyncio
import threading
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse

from api.auth import get_current_user
from db.models import User
import config

router = APIRouter(prefix="/api/paper/live", tags=["Paper Trading Live"])


def _get_upstox_token() -> Optional[str]:
    """Get Upstox access token.

    Checks DB first (OAuth token), then .upstox_token.json file.
    Environment variable is NOT checked to avoid using expired manual tokens
    after disconnect.
    """
    try:
        from db.models import get_shared_broker_token
        token_data = get_shared_broker_token("upstox")
        if token_data and token_data.get("access_token"):
            return token_data["access_token"]
    except Exception:
        pass

    token_file = Path(config.BASE_DIR) / ".upstox_token.json"
    if token_file.exists():
        try:
            with open(token_file) as f:
                data = json.load(f)
            if data.get("access_token"):
                return data["access_token"]
        except (json.JSONDecodeError, KeyError):
            pass

    return None


def _get_instrument_keys(user_id: int) -> tuple[list[str], dict[str, str]]:
    """Get instrument keys and a symbol→key mapping for open positions."""
    trading_symbols: set[str] = set()

    try:
        from db.database import SessionLocal
        from db.models import Position

        db = SessionLocal()
        try:
            for p in db.query(Position).filter(Position.user_id == user_id).all():
                if p.symbol:
                    trading_symbols.add(p.symbol)
        finally:
            db.close()
    except Exception:
        pass

    if not trading_symbols:
        try:
            from trading.paper_trader import get_paper_trader
            trader = get_paper_trader(user_id)
            for pos in trader.get_positions():
                sym = pos.get("symbol")
                if sym:
                    trading_symbols.add(sym)
        except Exception:
            pass

    sym_to_key: dict[str, str] = {}
    if trading_symbols:
        try:
            from db.database import SessionLocal
            from sqlalchemy import text as sa_text
            db = SessionLocal()
            try:
                placeholders = ",".join(f"'{s}'" for s in trading_symbols)
                rows = db.execute(
                    sa_text(f"SELECT trading_symbol, instrument_key FROM instruments WHERE trading_symbol IN ({placeholders})")
                ).fetchall()
                for sym, key in rows:
                    sym_to_key[sym] = key
            finally:
                db.close()
        except Exception:
            pass

        unresolved = [s for s in trading_symbols if s not in sym_to_key]
        if unresolved:
            try:
                import json
                from pathlib import Path
                import config as app_config
                base_dir = Path(app_config.BASE_DIR)
                inst_file = base_dir.parent / "upstox_trader" / "config_and_utils" / "nse_instruments.json"
                if inst_file.exists():
                    with open(inst_file) as f:
                        all_inst = json.load(f)
                    for item in all_inst:
                        if item.get("trading_symbol") in unresolved:
                            sym_to_key[item["trading_symbol"]] = item["instrument_key"]
            except Exception:
                pass

    instrument_keys = [v for v in sym_to_key.values() if v]
    return instrument_keys, sym_to_key


@router.get("/stream")
async def live_price_stream(user: User = Depends(get_current_user)):
    """
    SSE endpoint that streams live LTP updates for all open positions.
    Uses Upstox MarketDataStreamerV3 (WebSocket V3, mode=ltpc).
    """
    token = _get_upstox_token()
    if not token:
        raise HTTPException(
            status_code=401,
            detail="No Upstox access token. Connect broker via Settings.",
        )

    instrument_keys, sym_to_key = _get_instrument_keys(user.id)
    if not instrument_keys:
        return StreamingResponse(
            iter([f"event: nosymbols\ndata: {json.dumps({'message': 'No open positions'})}\n\n"]),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    key_to_sym = {v: k for k, v in sym_to_key.items()}

    import queue as thr_queue
    q: thr_queue.Queue = thr_queue.Queue()
    closed = threading.Event()

    def _run_streamer():
        nonlocal closed
        streamer_instance = None
        try:
            import upstox_client
            from upstox_client import MarketDataStreamerV3

            cfg = upstox_client.Configuration()
            cfg.access_token = token
            client = upstox_client.ApiClient(cfg)

            streamer = MarketDataStreamerV3(client, [], mode="ltpc")
            streamer_instance = streamer

            def on_message(data):
                if closed.is_set():
                    return
                feeds = data.get("feeds", {}) if isinstance(data, dict) else {}
                current_ts = data.get("currentTs", "")
                for instrument_key, feed in feeds.items():
                    if not isinstance(feed, dict):
                        continue
                    ltpc = feed.get("ltpc", {})
                    ltp = ltpc.get("ltp")
                    if ltp is not None:
                        sym = key_to_sym.get(instrument_key) or (
                            instrument_key.split("|")[-1]
                            if "|" in instrument_key
                            else instrument_key
                        )
                        event = {
                            "type": "price",
                            "instrument_key": instrument_key,
                            "symbol": sym,
                            "ltp": ltp,
                            "ltq": ltpc.get("ltq"),
                            "ts": ltpc.get("ltt", current_ts),
                        }
                        q.put_nowait(event)

            def on_error(err):
                if closed.is_set():
                    return
                q.put_nowait({"type": "error", "message": str(err)})

            def on_open():
                streamer.subscribe(instrument_keys, "ltpc")

            streamer.on("message", on_message)
            streamer.on("error", on_error)
            streamer.on("open", on_open)
            streamer.connect()

            while not closed.is_set():
                closed.wait(timeout=1)

        except Exception as e:
            if not closed.is_set():
                q.put_nowait({"type": "error", "message": str(e)})
        finally:
            if streamer_instance:
                try:
                    streamer_instance.disconnect()
                except Exception:
                    pass

    thread = threading.Thread(target=_run_streamer, daemon=True)
    thread.start()

    async def event_generator():
        loop = asyncio.get_running_loop()
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    event = await loop.run_in_executor(
                        None, lambda: q.get(timeout=30)
                    )
                except thr_queue.Empty:
                    yield "event: heartbeat\ndata: {}\n\n"
                    continue

                if event.get("type") == "error":
                    yield f"event: error\ndata: {json.dumps(event)}\n\n"
                    break

                if event.get("type") == "price":
                    yield f"event: price\ndata: {json.dumps(event)}\n\n"
        finally:
            closed.set()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
