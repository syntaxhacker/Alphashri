"""Nifty report WebSocket push (replaces HTTP polling + SSE).

Endpoints (no prefix, paths are exact):
  - ``/ws/nifty/report`` — full live report on connect, then a re-push every
    1s tick only when the report's ``fetched_at`` changes (the computation is
    5s-cached upstream); otherwise a ``heartbeat`` every 10s. An ``aux``
    frame (``{"type": "aux", "tape": ..., "sensex": ...}``) carries the OI
    tape (same shape as ``GET /api/reports/nifty/tape``) and the live
    Sensex block: once on connect, then on change (plus a resend ≥ every
    10s so late joiners converge). A ``tick`` frame
    (``{"type": "tick", "spot": ..., "ts": ..., "change_pct": ...}``)
    carries the live Nifty SPOT price: at most once per second, and only
    when the spot actually changed since the last tick sent to that
    client. The spot is polled via REST (``api.options.get_spot_price``)
    by the ``nifty_spot_tick_task`` background task — never a second
    Upstox WebSocket (Upstox allows only ~2 WS connections, already used
    by the paper live stream + orderflow).
  - ``/ws/nifty/bursts`` — snapshot of recent burst events on connect, then
    each live event forwarded; a ``heartbeat`` after 25s of quiet.

Auth mirrors ``/ws/news``: unauthenticated by default. An optional ``token``
query param is best-effort validated with the app JWT logic
(:func:`api.auth.decode_token`); an invalid token closes the socket with
code 1008.

Everything is best-effort: per-tick failures send an ``error`` frame and the
loop survives; ``WebSocketDisconnect`` returns cleanly.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import config
from api.reports_api import nifty as nifty_report
from api.reports_api import nifty_stream

logger = logging.getLogger(__name__)

router = APIRouter()

#: Recompute cadence for /ws/nifty/report (upstream _compute_live is cached).
REPORT_INTERVAL_SEC = 1.0
#: Send a heartbeat when no fresh report was pushed for this long.
REPORT_HEARTBEAT_SEC = 10.0
#: Resend the aux frame at least this often even when unchanged.
AUX_RESEND_SEC = 10.0
#: Quiet period before a heartbeat on /ws/nifty/bursts.
BURST_QUIET_SEC = 25.0
#: Minimum gap between two ``tick`` frames to the same client.
TICK_MIN_INTERVAL_SEC = 1.0
#: REST poll cadence for the shared Nifty SPOT price.
SPOT_POLL_INTERVAL_SEC = 1.0
#: Sleep between market-open checks when the market is closed.
SPOT_CLOSED_SLEEP_SEC = 60.0


# ---------------------------------------------------------------------------
# Shared live SPOT state (REST-polled, read by every /ws/nifty/report client).
# ---------------------------------------------------------------------------

_spot_lock = threading.Lock()

#: Last known Nifty SPOT: ``{"spot": float|None, "ts": iso|None,
#: "change_pct": float|None}``. ``change_pct`` is measured vs the first spot
#: seen by the poller (day-open proxy).
_last_spot: dict = {"spot": None, "ts": None, "change_pct": None}

#: First spot observed by the poller; baseline for ``change_pct``.
_day_open: Optional[float] = None

#: Handle of the running poller (for idempotent startup); never awaited here.
_spot_tick_task: Optional[asyncio.Task] = None


def latest_spot() -> dict:
    """Return a copy of the last known SPOT (never raises)."""
    try:
        with _spot_lock:
            return dict(_last_spot)
    except Exception:
        return {"spot": None, "ts": None, "change_pct": None}


def _set_spot(spot: float, ts: Optional[str], change_pct: Optional[float]) -> None:
    """Store a fresh SPOT reading (never raises)."""
    try:
        with _spot_lock:
            _last_spot["spot"] = spot
            _last_spot["ts"] = ts
            _last_spot["change_pct"] = change_pct
    except Exception:
        pass


def _reset_spot_state_for_tests() -> None:
    """Reset shared SPOT state (tests only)."""
    global _day_open
    try:
        with _spot_lock:
            _last_spot["spot"] = None
            _last_spot["ts"] = None
            _last_spot["change_pct"] = None
    except Exception:
        pass
    _day_open = None


async def nifty_spot_tick_task(interval_sec: float = SPOT_POLL_INTERVAL_SEC) -> None:
    """Poll Nifty SPOT via REST and publish it to :data:`_last_spot`.

    Market-hours gated (sleeps 60s when closed). Never raises: every
    failure keeps the previous value. ``CancelledError`` is re-raised so
    the lifespan shutdown can cancel the task.
    """
    try:
        interval = float(interval_sec)
    except Exception:
        interval = SPOT_POLL_INTERVAL_SEC
    if interval <= 0:
        interval = SPOT_POLL_INTERVAL_SEC
    while True:
        try:
            try:
                from trading.utils import is_market_open

                market_open = bool(is_market_open())
            except asyncio.CancelledError:
                raise
            except Exception:
                market_open = True
            if not market_open:
                await asyncio.sleep(SPOT_CLOSED_SLEEP_SEC)
                continue
            try:
                from api.options import get_spot_price

                data = await get_spot_price("NIFTY")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.debug("nifty spot tick: poll failed: %s", e)
                data = None
            try:
                if isinstance(data, dict):
                    spot = float(data.get("spot") or 0)
                    if spot > 0:
                        global _day_open
                        if _day_open is None:
                            _day_open = spot
                        try:
                            change_pct = (
                                ((spot - _day_open) / _day_open * 100.0)
                                if _day_open
                                else None
                            )
                        except Exception:
                            change_pct = None
                        _set_spot(spot, _ist_now_iso(), change_pct)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.debug("nifty spot tick: store failed: %s", e)
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug("nifty spot tick loop error: %s", e)
            try:
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                raise


def start_nifty_spot_tick_task(
    interval_sec: float = SPOT_POLL_INTERVAL_SEC,
) -> asyncio.Task:
    """Start :func:`nifty_spot_tick_task` unless already running (idempotent)."""
    global _spot_tick_task
    try:
        if _spot_tick_task is not None and not _spot_tick_task.done():
            return _spot_tick_task
    except Exception:
        pass
    _spot_tick_task = asyncio.create_task(
        nifty_spot_tick_task(interval_sec=interval_sec)
    )
    return _spot_tick_task


async def _reject_bad_token(websocket: WebSocket, token: Optional[str]) -> bool:
    """Close with 1008 and return True when an invalid token was supplied."""
    if not token:
        return False
    try:
        from api.auth import decode_token

        payload = decode_token(token)
    except Exception:
        payload = None
    if not payload:
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
        return True
    return False


def _ist_now_iso() -> str:
    try:
        return datetime.now(config.IST).isoformat()
    except Exception:
        return datetime.now().isoformat()


def _build_tape_payload() -> Optional[dict]:
    """Build the aux ``tape`` object (same shape as GET /nifty/tape).

    Returns ``None`` when there is no tape; never raises.
    """
    try:
        date_str = nifty_report._today_str()
    except Exception:
        return None
    try:
        raw = nifty_report.read_tape(date_str)
    except Exception:
        return None
    if not raw:
        return None
    try:
        rows = nifty_report.derive_tape_rows(raw)
    except Exception:
        return None
    try:
        baseline_t = rows[0].get("t") if rows else None
    except Exception:
        baseline_t = None
    try:
        interval_sec = int(nifty_report.TAPE_INTERVAL_SEC)
    except Exception:
        interval_sec = 60
    return {
        "date": date_str,
        "interval_sec": interval_sec,
        "baseline_t": baseline_t,
        "rows": rows,
    }


async def _get_sensex_cached() -> Optional[dict]:
    """Return the live Sensex block, honouring the 5s upstream cache.

    Returns ``None`` on failure; never raises.
    """
    try:
        cache = nifty_report._sensex_cache
        ttl = float(nifty_report._LIVE_TTL)
    except Exception:
        cache, ttl = {}, 30.0
    try:
        now = time.time()
        hit = cache.get("default") if isinstance(cache, dict) else None
        if isinstance(hit, dict) and (now - float(hit.get("ts", 0))) < ttl:
            data = hit.get("data")
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    try:
        data = await nifty_report._compute_sensex_live()
    except Exception:
        return None
    try:
        if isinstance(cache, dict):
            cache["default"] = {"ts": time.time(), "data": data}
    except Exception:
        pass
    return data if isinstance(data, dict) else None


def _aux_signature(tape: Optional[dict], sensex: Optional[dict]) -> tuple:
    """Shallow change signature: tape's last row ``t`` + (spot, expiry)."""
    try:
        if isinstance(tape, dict):
            rows = tape.get("rows") or []
            last_t = None
            try:
                if rows:
                    last = rows[-1]
                    last_t = last.get("t") if isinstance(last, dict) else None
            except Exception:
                last_t = None
            tape_sig = (tape.get("date"), last_t, len(rows))
        else:
            tape_sig = (None, None, 0)
    except Exception:
        tape_sig = (None, None, 0)
    try:
        if isinstance(sensex, dict):
            sensex_sig = (sensex.get("spot"), sensex.get("expiry"))
        else:
            sensex_sig = (None, None)
    except Exception:
        sensex_sig = (None, None)
    return (tape_sig, sensex_sig)


@router.websocket("/ws/nifty/report")
async def ws_nifty_report(
    websocket: WebSocket,
    expiry: Optional[str] = None,
    token: Optional[str] = None,
):
    await websocket.accept()
    try:
        if await _reject_bad_token(websocket, token):
            return

        last_fetched: Optional[str] = None
        try:
            report = await nifty_report.get_live_report(expiry)
            last_fetched = report.get("fetched_at") if isinstance(report, dict) else None
            await websocket.send_json({"type": "report", "data": report})
        except WebSocketDisconnect:
            return
        except Exception as e:
            logger.debug("nifty ws report: initial compute failed: %s", e)
            try:
                await websocket.send_json({"type": "error", "message": str(e)[:200]})
            except WebSocketDisconnect:
                return
            except Exception:
                pass

        # Aux frame (OI tape + Sensex): once immediately on connect.
        last_aux_sig: Optional[tuple] = None
        last_aux_send = time.monotonic()
        try:
            tape = _build_tape_payload()
            try:
                sensex = await _get_sensex_cached()
            except Exception:
                sensex = None
            last_aux_sig = _aux_signature(tape, sensex)
            last_aux_send = time.monotonic()
            await websocket.send_json({"type": "aux", "tape": tape, "sensex": sensex})
        except WebSocketDisconnect:
            return
        except Exception as e:
            logger.debug("nifty ws report: initial aux failed: %s", e)

        last_heartbeat = time.monotonic()
        last_tick_spot: Optional[float] = None
        last_tick_send = 0.0
        while True:
            try:
                await asyncio.sleep(REPORT_INTERVAL_SEC)
                try:
                    report = await nifty_report.get_live_report(expiry)
                except Exception as e:
                    logger.debug("nifty ws report: recompute failed: %s", e)
                    try:
                        await websocket.send_json({"type": "error", "message": str(e)[:200]})
                    except WebSocketDisconnect:
                        return
                    except Exception:
                        pass
                    continue
                fetched = report.get("fetched_at") if isinstance(report, dict) else None
                if fetched != last_fetched:
                    last_fetched = fetched
                    last_heartbeat = time.monotonic()
                    await websocket.send_json({"type": "report", "data": report})
                elif time.monotonic() - last_heartbeat >= REPORT_HEARTBEAT_SEC:
                    last_heartbeat = time.monotonic()
                    await websocket.send_json({"type": "heartbeat", "ts": _ist_now_iso()})
                # Aux refresh on the same tick: resend only on change,
                # plus a periodic resend so late joiners converge.
                try:
                    tape = _build_tape_payload()
                    try:
                        sensex = await _get_sensex_cached()
                    except Exception:
                        sensex = None
                    sig = _aux_signature(tape, sensex)
                    now_m = time.monotonic()
                    if sig != last_aux_sig or (now_m - last_aux_send) >= AUX_RESEND_SEC:
                        last_aux_sig = sig
                        last_aux_send = now_m
                        await websocket.send_json(
                            {"type": "aux", "tape": tape, "sensex": sensex}
                        )
                except WebSocketDisconnect:
                    return
                except Exception as e:
                    logger.debug("nifty ws report: aux refresh failed: %s", e)
                # Live SPOT tick: at most once per second, only on change.
                # Never breaks the report/aux/heartbeat flow above.
                try:
                    snap = latest_spot()
                    spot = snap.get("spot") if isinstance(snap, dict) else None
                    # Prefer the WS snapshot's spot when nifty_md is live
                    # (guarded: a missing/empty module keeps the REST value).
                    try:
                        md = nifty_report._nifty_md()
                        if md is not None and bool(md.is_live()):
                            ws_spot = (md.snapshot() or {}).get("spot")
                            ws_spot = float(ws_spot) if ws_spot is not None else 0.0
                            if ws_spot > 0:
                                spot = ws_spot
                    except Exception:
                        pass
                    now_m = time.monotonic()
                    if (
                        spot is not None
                        and spot != last_tick_spot
                        and (now_m - last_tick_send) >= TICK_MIN_INTERVAL_SEC
                    ):
                        last_tick_spot = spot
                        last_tick_send = now_m
                        await websocket.send_json(
                            {
                                "type": "tick",
                                "spot": spot,
                                "ts": snap.get("ts"),
                                "change_pct": snap.get("change_pct"),
                            }
                        )
                except WebSocketDisconnect:
                    return
                except Exception as e:
                    logger.debug("nifty ws report: tick push failed: %s", e)
            except WebSocketDisconnect:
                return
            except Exception as e:
                logger.debug("nifty ws report loop error: %s", e)
    except WebSocketDisconnect:
        return
    except Exception as e:
        logger.debug("nifty ws report fatal: %s", e)
        return


@router.websocket("/ws/nifty/bursts")
async def ws_nifty_bursts(
    websocket: WebSocket,
    token: Optional[str] = None,
):
    await websocket.accept()
    try:
        if await _reject_bad_token(websocket, token):
            return
        queue = nifty_stream.subscribe()
        try:
            await websocket.send_json(
                {"type": "snapshot", "data": nifty_stream.recent_events(limit=20)}
            )
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=BURST_QUIET_SEC)
                    await websocket.send_json({"type": "burst", "data": event})
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "heartbeat"})
        except WebSocketDisconnect:
            return
        except Exception as e:
            logger.debug("nifty ws bursts loop error: %s", e)
            return
        finally:
            try:
                nifty_stream.unsubscribe(queue)
            except Exception:
                pass
    except WebSocketDisconnect:
        return
    except Exception as e:
        logger.debug("nifty ws bursts fatal: %s", e)
        return
