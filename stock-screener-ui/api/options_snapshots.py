"""Write option-chain snapshots for later IV/history analytics.

Persistence lane: no routes, no network. This module flattens the dict returned
by ``GET /api/options/chain`` into
:class:`db.models.option_snapshot.OptionChainSnapshot`, and exposes the pure
``should_capture`` / ``mark_captured`` throttle helpers the chain route uses to
decide when a write is worth scheduling. Scheduling itself stays in the route.

Idempotency is a pre-check in one query (portable across SQLite/Postgres) plus
a single bulk insert per call. The caller may pass a session (e.g. a test's
transaction-scoped fixture); otherwise a short-lived session is opened from the
app's factory. Either way one call is one commit.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Any, Optional

import config
from db.database import SessionLocal
from db.models.option_snapshot import OptionChainSnapshot

_IST = config.IST

_GREEK_KEYS = ("delta", "gamma", "theta", "vega", "iv")
_MARKET_KEYS = ("ltp", "oi", "volume")


def _finite(value: Any) -> Optional[float]:
    """Coerce a quote value to a finite float, or ``None``.

    Upstox occasionally returns ``None``, ``"NaN"`` or ``float("inf")`` for an
    illiquid leg. Missing is a real observation and must reach the column as
    NULL — never as 0, which would read as a genuine zero IV/LTP downstream.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _normalise_ts(value: Any) -> datetime:
    """Resolve a snapshot timestamp and truncate it to the IST minute."""
    if value is None:
        stamp = datetime.now(_IST)
    elif isinstance(value, datetime):
        stamp = value
    elif isinstance(value, str):
        stamp = datetime.fromisoformat(value)
    else:
        raise TypeError(f"unsupported timestamp: {value!r}")
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=_IST)
    else:
        stamp = stamp.astimezone(_IST)
    return stamp.replace(second=0, microsecond=0)


def _leg_values(leg: dict) -> dict:
    """Extract quote fields from one transformed CE/PE contract."""
    market = leg.get("market_data") or {}
    greeks = leg.get("option_greeks") or {}
    if not isinstance(market, dict):
        market = {}
    if not isinstance(greeks, dict):
        greeks = {}
    values = {key: _finite(market.get(key)) for key in _MARKET_KEYS}
    values.update({key: _finite(greeks.get(key)) for key in _GREEK_KEYS})
    return values


def _flatten(payload: dict, ts: datetime) -> list[dict]:
    """Flatten the chain rows into one mapping per finite CE/PE leg."""
    underlying = str(payload.get("underlying") or "").strip().upper()
    expiry_raw = payload.get("expiry")
    if isinstance(expiry_raw, datetime):
        expiry = expiry_raw.date().isoformat()
    elif isinstance(expiry_raw, date):
        expiry = expiry_raw.isoformat()
    else:
        expiry = str(expiry_raw or "")
    spot = _finite(payload.get("spot"))
    quotes_live = bool(payload.get("quotes_live", False))
    session_date = ts.strftime("%Y-%m-%d")

    rows: list[dict] = []
    seen: set[tuple] = set()
    for row in payload.get("chain") or []:
        if not isinstance(row, dict):
            continue
        strike = _finite(row.get("strike"))
        if strike is None:
            continue
        for side in ("CE", "PE"):
            leg = row.get(side.lower())
            if not isinstance(leg, dict):
                continue
            values = _leg_values(leg)
            ltp = values["ltp"]
            if ltp is None:
                continue
            key = (strike, side)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "ts": ts,
                "underlying": underlying,
                "expiry": expiry,
                "strike": strike,
                "side": side,
                "ltp": ltp,
                "iv": values["iv"],
                "delta": values["delta"],
                "gamma": values["gamma"],
                "theta": values["theta"],
                "vega": values["vega"],
                "oi": values["oi"],
                "volume": values["volume"],
                "spot": spot,
                "session_date": session_date,
                "quotes_live": quotes_live,
                "iv_source": str(payload.get("iv_source") or "upstox"),
            })
    return rows


def _existing_keys(session, underlying: str, expiry: str, ts: datetime) -> set[tuple]:
    """Existing (strike, side) pairs for one snapshot key, in one query."""
    return {
        (row.strike, row.side)
        for row in session.query(OptionChainSnapshot.strike, OptionChainSnapshot.side)
        .filter(
            OptionChainSnapshot.underlying == underlying,
            OptionChainSnapshot.expiry == expiry,
            OptionChainSnapshot.ts == ts,
        )
    }


def record_chain_snapshot(
    payload: dict,
    *,
    ts: Optional[Any] = None,
    session=None,
) -> int:
    """Append one chain observation; return the number of rows inserted.

    ``ts`` may be a ``datetime`` or an ISO string; it defaults to the payload's
    ``timestamp`` and finally to now (IST). It is truncated to the minute so a
    re-poll in the same minute resolves to the same natural key. Pass an open
    ``session`` to join an existing transaction, or omit it for a self-managed
    one. Missing IV/LTP stay NULL; legs without a finite strike/LTP are dropped.
    """
    if not isinstance(payload, dict):
        raise TypeError("payload must be a chain dict")

    raw_ts = ts if ts is not None else payload.get("timestamp")
    stamp = _normalise_ts(raw_ts)
    rows = _flatten(payload, stamp)
    if not rows:
        return 0

    owns_session = session is None
    session = session or SessionLocal()
    try:
        existing = _existing_keys(session, rows[0]["underlying"], rows[0]["expiry"], stamp)
        fresh = [r for r in rows if (r["strike"], r["side"]) not in existing]
        if fresh:
            session.bulk_insert_mappings(OptionChainSnapshot, fresh)
        session.commit()
        return len(fresh)
    except Exception:
        session.rollback()
        raise
    finally:
        if owns_session:
            session.close()


def purge_old_snapshots(
    days: int = 90,
    *,
    ts: Optional[Any] = None,
    session=None,
) -> int:
    """Delete rows older than ``days`` relative to ``ts`` (default now IST).

    Not scheduled yet — the poller lane owns retention cadence. Returns the
    number of rows removed.
    """
    if days < 0:
        raise ValueError("days must be non-negative")
    cutoff = _normalise_ts(ts) - timedelta(days=days)

    owns_session = session is None
    session = session or SessionLocal()
    try:
        deleted = (
            session.query(OptionChainSnapshot)
            .filter(OptionChainSnapshot.ts < cutoff)
            .delete(synchronize_session=False)
        )
        session.commit()
        return int(deleted or 0)
    except Exception:
        session.rollback()
        raise
    finally:
        if owns_session:
            session.close()


#: A capture-key map lives for the process lifetime. Bound it so a long-running
#: API cannot grow one entry per minute per symbol forever; evicting the oldest
#: half may cost a duplicate write, which the DB's natural key absorbs anyway.
_MAX_CAPTURE_KEYS = 4096


def _capture_key(payload: Any) -> Optional[tuple]:
    """Dedupe key for a real chain observation, or ``None`` if not capturable.

    Live chains bucket on the IST minute of the fetch timestamp; closed/pre-open
    chains carry the last session's prints and bucket on that session date so a
    whole non-trading session produces one snapshot per (underlying, expiry).
    """
    if not isinstance(payload, dict):
        return None
    if str(payload.get("status", "ok") or "ok").lower() not in ("ok", "success"):
        return None
    chain = payload.get("chain")
    if not isinstance(chain, list) or not chain:
        return None
    # A replay/as-of frame is a read of history, never a fresh observation.
    # ``data_as_of`` is the live chain's freshness label and must NOT trip this.
    if (
        payload.get("replay")
        or payload.get("is_replay")
        or payload.get("as_of")
        or payload.get("as_of_date")
        or payload.get("replay_date")
        or str(payload.get("mode", "")).lower() == "replay"
    ):
        return None
    underlying = str(payload.get("underlying") or "").strip().upper()
    expiry = str(payload.get("expiry") or "").strip()
    if not underlying or not expiry:
        return None

    quotes_live = bool(payload.get("quotes_live", False)) or (
        str(payload.get("market_state", "")).lower() == "open"
    )
    session_date = str(payload.get("session_date") or "").strip()
    if not quotes_live and session_date:
        return ("session", underlying, expiry, session_date)

    try:
        stamp = _normalise_ts(payload.get("timestamp"))
    except (TypeError, ValueError):
        return None
    minute = stamp.strftime("%Y-%m-%dT%H:%M")
    if quotes_live:
        return ("minute", underlying, expiry, minute)
    return ("session", underlying, expiry, session_date or minute[:10])


def should_capture(payload: Any, last: dict) -> bool:
    """True when ``payload`` is a new observation absent from ``last``."""
    key = _capture_key(payload)
    return key is not None and key not in last


def mark_captured(payload: Any, last: dict) -> bool:
    """Record a capture in ``last``; False means the payload is not capturable."""
    key = _capture_key(payload)
    if key is None:
        return False
    if len(last) >= _MAX_CAPTURE_KEYS:
        for stale in list(last)[: _MAX_CAPTURE_KEYS // 2]:
            last.pop(stale, None)
    last[key] = True
    return True


__all__ = [
    "record_chain_snapshot",
    "purge_old_snapshots",
    "should_capture",
    "mark_captured",
]
