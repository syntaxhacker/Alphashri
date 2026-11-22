"""Scored-frame cache for the Deep Value tab.

Caches the SCORED frame (peer medians + per-row score applied) in redis.
The cache key contains only the market — user filters are applied per
request in memory by the router.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from cache.redis_client import (
    cache_get,
    cache_set,
    cache_ttl,
    get_redis_client,
    is_cache_available,
    make_cache_key,
    _release_lock,
    _try_acquire_lock,
)

from .tv_source import TvSourceError, fetch_frame, frame_summary

logger = logging.getLogger("value_scan.cache")

#: fresh TTL per market (seconds); stale window is 2x fresh
FRAME_TTL: dict[str, int] = {"india": 900, "usa": 3600, "global": 3600}

CACHE_PREFIX = "value_frame"

_LOCK_TTL = 60
_LOSER_POLL_INTERVAL = 0.2

# A cold market scan can take ~40s. The old 5s loser bound expired long before
# the winner wrote its frame, so every concurrent loser recomputed the *same*
# market (a stampede). Wait for the winner for the full life of its lock plus a
# margin instead. Detection is adaptive: polling stops as soon as the frame
# appears or the lock is released, so the bound is only an outer safety cap.
_LOCK_WAIT_SECONDS = float(_LOCK_TTL) + 15.0  # 75s
# In-process followers wait on a shared promise (set by the leader in a
# finally block). This larger bound is only a safety net for a leader that
# dies without ever signalling; normal followers wake when it finishes.
_FLIGHT_WAIT_SECONDS = _LOCK_WAIT_SECONDS + 15.0  # 90s


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _age_seconds(as_of: Optional[str]) -> Optional[int]:
    if not as_of:
        return None
    try:
        ts = datetime.fromisoformat(as_of)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - ts).total_seconds()))
    except Exception:
        return None


def _cache_keys(market: str) -> tuple[str, str, str]:
    base = make_cache_key(CACHE_PREFIX, market)
    return base, f"{base}:fresh", f"{base}:lock"


def _fallback_score_row(row: dict[str, Any]) -> dict[str, Any]:
    """Absolute-value ranking used when scoring.py is unavailable.

    Simple average of earnings yield, FCF yield and ROE signals,
    scaled to 0-100.
    """
    pe = row.get("price_earnings_ttm")
    ey = (1.0 / pe * 100.0) if pe else 0.0
    mcap = row.get("market_cap_basic") or 0.0
    fcf = row.get("free_cash_flow_ttm")
    fcf_yield = (fcf / mcap * 100.0) if (fcf is not None and mcap) else 0.0
    roe = row.get("return_on_equity_fq") or 0.0

    def _clip(value: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, value))

    value = (_clip(ey, 0.0, 25.0) / 25.0) * 100.0
    cash = (_clip(fcf_yield, 0.0, 15.0) / 15.0) * 100.0
    quality = (_clip(float(roe), 0.0, 30.0) / 30.0) * 100.0
    score = round((value + cash + quality) / 3.0, 2)
    out = dict(row)
    out["score"] = score
    out["subscores"] = {
        "value": round(value, 2),
        "quality": round(quality, 2),
        "growth": 50.0,
        "health": 50.0,
    }
    out.setdefault("peer", {})
    out.setdefault("flags", [])
    out.setdefault("derived", {})
    return out


def _score_frame(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Apply peer-relative scoring; fall back gracefully.

    Returns (scored_rows, warnings). Never raises for scoring problems —
    falls back to the absolute-value ranking with a warning so the
    endpoint keeps working when scoring.py/filters.py are missing.
    """
    try:
        from .scoring import ScoreConfig, peer_medians, score_row
    except Exception as exc:
        logger.warning("scoring engine unavailable, using fallback: %s", exc)
        return [_fallback_score_row(r) for r in rows], ["scoring_engine_unavailable"]
    try:
        config = ScoreConfig()
        medians = peer_medians(rows)
        scored = [score_row(row, medians, config) for row in rows]
        return scored, []
    except Exception as exc:
        logger.warning("scoring failed, using fallback: %s", exc)
        return [_fallback_score_row(r) for r in rows], ["scoring_engine_unavailable"]


def _compute_frame(market: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fetch + score a frame. Raises TvSourceError on upstream failure."""
    rows = fetch_frame(market)
    summary = frame_summary(rows)
    scored, warnings = _score_frame(rows)
    as_of = _utcnow_iso()
    envelope = {
        "as_of": as_of,
        "rows": scored,
        "scanned": summary["count"],
        "fields_complete": summary["fields_complete"],
        "warnings": warnings,
    }
    return scored, envelope


def _store_frame(base_key: str, fresh_key: str, envelope: dict[str, Any],
                 fresh_ttl: int) -> None:
    cache_set(base_key, envelope, ttl=fresh_ttl * 2)
    cache_set(fresh_key, "1", ttl=fresh_ttl)


def _meta_from_envelope(envelope: dict[str, Any], cached: bool,
                        extra_warnings: Optional[list[str]] = None) -> dict[str, Any]:
    warnings = list(envelope.get("warnings") or [])
    if extra_warnings:
        warnings.extend(extra_warnings)
    return {
        "as_of": envelope.get("as_of"),
        "cached": cached,
        "age_seconds": _age_seconds(envelope.get("as_of")),
        "scanned": envelope.get("scanned", len(envelope.get("rows") or [])),
        "fields_complete": bool(envelope.get("fields_complete", False)),
        "warnings": warnings,
    }


class _Flight:
    """One in-process compute/share operation for a single market.

    The leader publishes the frame it produced (or the error it hit) and sets
    ``done`` in a ``finally`` block; followers wait on ``done`` instead of
    starting their own scan. This makes concurrent cold requests in *this*
    process collapse onto one fetch, even when a scan takes far longer than a
    redis lock's typical waiter budget.
    """

    __slots__ = ("done", "rows", "envelope", "error")

    def __init__(self) -> None:
        self.done = threading.Event()
        self.rows: Optional[list[dict[str, Any]]] = None
        self.envelope: Optional[dict[str, Any]] = None
        self.error: Optional[BaseException] = None


_inflight_guard = threading.Lock()
_inflight: dict[str, _Flight] = {}


def _join_or_lead(market: str) -> tuple[_Flight, bool]:
    """Register a flight for ``market``; only the first caller leads."""
    with _inflight_guard:
        flight = _inflight.get(market)
        if flight is not None:
            return flight, False
        flight = _Flight()
        _inflight[market] = flight
        return flight, True


def _finish_flight(market: str, flight: _Flight) -> None:
    """Signal followers, then retire the flight (always paired with a join)."""
    flight.done.set()
    with _inflight_guard:
        if _inflight.get(market) is flight:
            del _inflight[market]


def _start_background_refresh(market: str, base_key: str, fresh_key: str,
                              lock_key: str, fresh_ttl: int) -> None:
    """Serve a stale frame now and refresh it once in a background thread."""
    token_holder: list[Optional[str]] = [None]

    def _refresh() -> None:
        token_holder[0] = _try_acquire_lock(lock_key, _LOCK_TTL)
        if not token_holder[0]:
            return
        try:
            _, fresh_envelope = _compute_frame(market)
            _store_frame(base_key, fresh_key, fresh_envelope, fresh_ttl)
        except Exception as exc:
            logger.warning("background refresh failed for %s: %s", market, exc)
        finally:
            _release_lock(lock_key, token_holder[0] or "")

    thread = threading.Thread(target=_refresh, daemon=True)
    thread.start()


def _wait_for_winner(base_key: str, lock_key: str) -> Optional[dict[str, Any]]:
    """Wait for another (cross-process) winner's cache write.

    Adaptive: return as soon as the frame appears, or as soon as the leader's
    lock is gone (which means it finished — successfully or not). Only the
    outer ``_LOCK_WAIT_SECONDS`` cap bounds the wait.
    """
    client = get_redis_client()
    deadline = time.monotonic() + _LOCK_WAIT_SECONDS
    while time.monotonic() < deadline:
        time.sleep(_LOSER_POLL_INTERVAL)
        late = cache_get(base_key)
        if late is not None:
            return late
        try:
            if client is not None and client.exists(lock_key) == 0:
                # Lock released without a frame: the holder crashed or its
                # compute failed, so the caller may safely take over.
                return None
        except Exception:
            pass
    return None


def _follow(flight: _Flight, market: str, base_key: str
            ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Coalesced caller: wait for the leader's frame instead of computing."""
    flight.done.wait(timeout=_FLIGHT_WAIT_SECONDS)
    if flight.envelope is not None:
        # The frame came from the shared in-flight compute, not from a local
        # scan — this is the same ``cached=True`` a cache-hitting loser saw
        # before, so response shape and semantics are unchanged.
        return (flight.rows or [],
                _meta_from_envelope(flight.envelope, cached=True))
    # Leader failed (or vanished without publishing): try the cache once more,
    # then fall back to a direct compute like the old loser path did.
    late = cache_get(base_key)
    if late is not None:
        return (late.get("rows") or [],
                _meta_from_envelope(late, cached=True))
    scored, envelope = _compute_frame(market)
    return scored, _meta_from_envelope(envelope, cached=False)


def _lead_cold(market: str, flight: _Flight, base_key: str, fresh_key: str,
               lock_key: str, fresh_ttl: int
               ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """The single in-process leader for a cold market."""
    try:
        # The cache is checked before joining the flight; another process (or
        # a just-finished leader) may have filled it in the meantime.
        raced = cache_get(base_key)
        if raced is not None:
            rows = raced.get("rows") or []
            flight.rows, flight.envelope = rows, raced
            return rows, _meta_from_envelope(raced, cached=True)

        token = _try_acquire_lock(lock_key, _LOCK_TTL)
        if token:
            try:
                scored, fresh_envelope = _compute_frame(market)
                _store_frame(base_key, fresh_key, fresh_envelope, fresh_ttl)
                flight.rows, flight.envelope = scored, fresh_envelope
                return scored, _meta_from_envelope(fresh_envelope, cached=False)
            finally:
                _release_lock(lock_key, token)

        # Another process owns the compute: wait for it rather than scanning
        # the same market a second time.
        late = _wait_for_winner(base_key, lock_key)
        if late is not None:
            rows = late.get("rows") or []
            flight.rows, flight.envelope = rows, late
            return rows, _meta_from_envelope(late, cached=True)

        # Holder released without writing a frame: safe to take over.
        scored, fresh_envelope = _compute_frame(market)
        _store_frame(base_key, fresh_key, fresh_envelope, fresh_ttl)
        flight.rows, flight.envelope = scored, fresh_envelope
        return scored, _meta_from_envelope(fresh_envelope, cached=False)
    except BaseException as exc:
        flight.error = exc
        raise
    finally:
        _finish_flight(market, flight)


def _compute_uncached(market: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Redis-down path: compute once per market, share with concurrent callers."""
    flight, is_leader = _join_or_lead(market)
    if not is_leader:
        flight.done.wait(timeout=_FLIGHT_WAIT_SECONDS)
        if flight.envelope is not None:
            return (flight.rows or [],
                    _meta_from_envelope(flight.envelope, cached=False,
                                        extra_warnings=["cache_unavailable"]))
        scored, envelope = _compute_frame(market)
        return scored, _meta_from_envelope(
            envelope, cached=False, extra_warnings=["cache_unavailable"])
    try:
        scored, envelope = _compute_frame(market)
        flight.rows, flight.envelope = scored, envelope
        return scored, _meta_from_envelope(
            envelope, cached=False, extra_warnings=["cache_unavailable"])
    except BaseException as exc:
        flight.error = exc
        raise
    finally:
        _finish_flight(market, flight)


def get_scored_frame(market: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return (scored_rows, meta) for ``market``.

    Stale-while-revalidate: a stale entry is served immediately while a
    background thread refreshes it. Cold-cache stampede protection uses a
    redis lock *plus* a shared in-process promise: one leader per market
    computes while all concurrent callers wait and coalesce onto its result.
    A cross-process loser waits adaptively for the winner's cache write (up to
    the lock lifetime) instead of the old, too-short 5s bound.
    Falls back to a live compute (with a ``cache_unavailable`` warning) when
    redis is down.
    """
    fresh_ttl = FRAME_TTL.get(market, 900)
    base_key, fresh_key, lock_key = _cache_keys(market)

    if not is_cache_available() or get_redis_client() is None:
        return _compute_uncached(market)

    envelope = cache_get(base_key)
    if envelope is not None:
        if cache_ttl(fresh_key) is not None:
            return (envelope.get("rows") or [],
                    _meta_from_envelope(envelope, cached=True))
        # Stale: serve now, refresh in background.
        _start_background_refresh(market, base_key, fresh_key,
                                  lock_key, fresh_ttl)
        return (envelope.get("rows") or [],
                _meta_from_envelope(envelope, cached=True))

    # Cold cache: exactly one in-process leader; everyone else coalesces.
    flight, is_leader = _join_or_lead(market)
    if not is_leader:
        return _follow(flight, market, base_key)
    return _lead_cold(market, flight, base_key, fresh_key,
                      lock_key, fresh_ttl)
