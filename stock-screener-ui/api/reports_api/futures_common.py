"""Shared machinery for the index-futures / basis recorders.

``nifty_futures`` and ``sensex_futures`` record the same thing — the
current-month index future, one complete 1-minute bar per line, joined to a
local spot tape — and only their *identity* differs: which index the contract
search names, which exchange answers it, which symbol prefix counts as "the
index future", and where the spot tape lives.

That identity is :class:`RecorderSpec`. Everything else (parsing, the day-file
merge, the basis arithmetic, the contract cache, the term snapshot, the
wall-clock loop) is identical, so it lives here once and each recorder is a
thin configuration of this module.

The recorders keep their own module-level state (``_status``,
``_contract_cache``, ``_seen_minutes``) and hooks (``_get_json``, ``_token``,
``_write_term``, ``_live_spot``) because tests and operators patch those names.
:class:`Runtime` snapshots them per call, so a patch on the module is picked up
by the very next tick.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import time
import urllib.parse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import httpx

import config
from api.reports_api.report_io import read_jsonl

logger = logging.getLogger(__name__)

UPSTOX_V2 = "https://api.upstox.com/v2"
UPSTOX_V3 = "https://api.upstox.com/v3"

#: Minute-bar cadence. Candles only change once a bar, so a 60 s loop keeps the
#: file current without ever hammering the upstream endpoint.
INTERVAL_SEC = 60.0
#: Sleep while the exchange is closed (one cheap gate check per minute).
MARKET_CLOSED_SLEEP_SEC = 60.0
#: Contract listings roll once a month; an hour of caching cannot miss the roll.
CONTRACT_TTL_SEC = 3600.0
REQUEST_TIMEOUT_SEC = 12.0
#: Upstox asks for an explicit bounded result set; 10 covers the live index
#: futures plus the sibling symbols each query also returns.
SEARCH_RECORDS = 10


@dataclass(frozen=True)
class RecorderSpec:
    """Everything that genuinely differs between the two recorders."""

    #: Index name used in status text ("no current-month {underlying} future").
    underlying: str
    #: Data subdirectory under ``DATA_ROOT``.
    dirname: str
    #: Log prefix ("nifty futures"), so log lines stay per-recorder.
    label: str
    #: Environment off-switch name, echoed in the "disabled" log line.
    env_flag: str
    #: ``/v2/instruments/search`` params (NIFTY pins ``exchanges: NSE``; the
    #: verified BSE query for SENSEX omits it).
    search_params: dict[str, Any]
    #: Symbol predicate for the index's own future (SENSEX drops ``SENSEX50``).
    is_contract: Callable[[str], bool]
    #: SENSEX's verified payload tags the contract in the symbol only, so its
    #: gate also accepts a symbol containing ``FUT``.
    symbol_futures_marker: bool
    #: Call the spot provider even when the tape already has the newest minute
    #: (cheap for the NIFTY websocket read, an upstream call for SENSEX).
    spot_always: bool
    #: Key in the module's contract cache (``"nifty"`` / ``"sensex"``).
    contract_cache_key: str
    #: Underlying passed to the option-chain endpoints for the term snapshot.
    term_source: str
    #: ``{minute: spot}`` source for the session.
    tape_path: Callable[[str], Path]


@dataclass(frozen=True)
class Runtime:
    """Module-owned state and hooks, snapshotted so monkeypatching still works."""

    spec: RecorderSpec
    logger: logging.Logger
    status: dict[str, Any]
    contract_cache: dict[str, dict]
    seen_cache: dict[str, set[str]]
    token: Callable[[], str]
    get_json: Callable[..., Awaitable[Any]]
    write_term: Callable[[datetime], Awaitable[int]]
    live_spot: Callable[[str], Any]
    record: Callable[[Optional[datetime]], Awaitable[dict]]
    tick: Callable[[], Awaitable[dict]]
    claim_task: Callable[[Any], bool]
    day_path: Callable[[str], Path]
    term_path: Callable[[str], Path]


def empty_status() -> dict[str, Any]:
    """Fresh heartbeat dict (all counters cleared)."""
    return {
        "last_tick": None,
        "last_bar": None,
        "last_error": None,
        "records": 0,
        "iterations": 0,
        "contract": None,
        "term_last_attempt": None,
        "term_last_ok": None,
        "term_last_skip": None,
    }


def reset_state(status: dict[str, Any], seen_cache: dict[str, set[str]],
                contract_cache: dict[str, dict]) -> None:
    """Drop every in-process cache/counter (tests, manual restart)."""
    seen_cache.clear()
    contract_cache.clear()
    status.update(empty_status())


def payload_data(payload: Any) -> Any:
    """Upstox envelopes wrap the body in ``data`` (or return it bare)."""
    if isinstance(payload, dict):
        return payload.get("data", payload)
    return payload


def parse_search_payload(payload: Any, spec: RecorderSpec) -> list[dict]:
    """``/v2/instruments/search`` → ``[{instrument_key, trading_symbol, expiry, lot_size}]``.

    Only futures rows for the spec's index survive. Malformed rows are skipped.
    """
    rows = payload_data(payload)
    if not isinstance(rows, list):
        return []
    out: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("instrument_key") or "")
        symbol = str(row.get("trading_symbol") or "")
        itype = str(row.get("instrument_type") or "").upper()
        seg = str(row.get("segment") or "").upper()
        is_future = "FUT" in itype or "FUT" in seg
        if not is_future and spec.symbol_futures_marker:
            is_future = "FUT" in symbol.upper()
        if not key or not is_future:
            continue
        if not spec.is_contract(symbol):
            continue
        try:
            lot = int(row.get("lot_size") or 0)
        except (TypeError, ValueError):
            lot = 0
        out.append({
            "instrument_key": key,
            "trading_symbol": symbol,
            "expiry": str(row.get("expiry") or "")[:10],
            "lot_size": lot,
        })
    return out


def pick_current_month(rows: list[dict], today: str) -> Optional[dict]:
    """Earliest expiry on/after ``today`` (both ``YYYY-MM-DD``).

    An expired contract must never be proxied as "current month": its candles
    stop mid-session and its basis is meaningless.
    """
    best: Optional[dict] = None
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        expiry = str(row.get("expiry") or "")[:10]
        try:
            datetime.strptime(expiry, "%Y-%m-%d")
        except ValueError:
            continue
        if expiry < today:
            continue
        if best is None or expiry < str(best.get("expiry") or ""):
            best = row
    return best


def parse_candles(payload: Any) -> list[dict]:
    """V3 intraday 1-minute candles → oldest-first ``[{ts, close, oi, volume}]``.

    Upstox returns ``[ts, o, h, l, c, volume, oi]`` newest-first. Rows without a
    usable close are dropped; a repeated minute keeps its last row.
    """
    data = payload_data(payload)
    candles = data.get("candles") if isinstance(data, dict) else data
    if not isinstance(candles, list):
        return []
    by_minute: dict[str, dict] = {}
    for row in candles:
        if not isinstance(row, (list, tuple)) or len(row) < 5:
            continue
        ts = str(row[0] or "")
        if len(ts) < 16:
            continue
        # Normalise to IST: the day file is joined to the spot tape on the
        # minute key, and a UTC-offset payload would put every bar 5h30m early
        # (still "same date", so the session filter would not catch it).
        try:
            stamp = datetime.fromisoformat(ts)
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=config.IST)
            ts = stamp.astimezone(config.IST).isoformat()
        except ValueError:
            pass
        try:
            close = float(row[4])
        except (TypeError, ValueError, IndexError):
            continue
        if not (close == close) or close <= 0:
            continue
        try:
            volume = int(float(row[5])) if len(row) > 5 and row[5] is not None else 0
        except (TypeError, ValueError):
            volume = 0
        try:
            oi = int(float(row[6])) if len(row) > 6 and row[6] is not None else None
        except (TypeError, ValueError):
            oi = None
        by_minute[ts[:16]] = {"ts": ts, "close": close, "oi": oi, "volume": volume}
    return [by_minute[key] for key in sorted(by_minute)]


def filter_session(candles: list[dict], date_str: str) -> list[dict]:
    """Keep only bars from ``date_str``.

    The intraday endpoint keeps answering with the *last* session's bars after
    the close; without this filter a Saturday tick would append Friday's prices
    into Saturday's file.
    """
    return [bar for bar in candles or [] if str(bar.get("ts") or "")[:10] == date_str]


def complete_bars(candles: list[dict], now: datetime) -> list[dict]:
    """Bars whose minute has already passed (the forming bar is excluded)."""
    current = now.strftime("%Y-%m-%dT%H:%M")
    return [bar for bar in candles or [] if str(bar.get("ts") or "")[:16] < current]


def build_rows(candles: list[dict], instrument_key: str, expiry: str,
               spot_by_minute: dict[str, float],
               live_spot: Optional[float] = None) -> list[dict]:
    """Candle series → recorder rows with basis and one-minute deltas.

    ``change_1m``/``oi_change_1m`` compare against the previous bar, so a
    backfilled minute carries the same numbers it would have had live. When
    ``spot_by_minute`` has no entry the newest bar may use ``live_spot``; older
    minutes stay ``spot``/``basis`` ``null`` rather than borrowing a current
    price for a past minute.
    """
    rows: list[dict] = []
    newest = str(candles[-1].get("ts") or "")[:16] if candles else ""
    prev_close: Optional[float] = None
    prev_oi: Optional[int] = None
    for bar in candles or []:
        minute = str(bar.get("ts") or "")[:16]
        close = float(bar["close"])
        oi = bar.get("oi")
        spot = spot_by_minute.get(minute)
        if spot is None and minute == newest and live_spot:
            spot = float(live_spot)
        rows.append({
            "t": bar["ts"],
            "instrument_key": instrument_key,
            "expiry": expiry,
            "close": round(close, 2),
            "oi": oi,
            "volume": int(bar.get("volume") or 0),
            "spot": round(spot, 2) if spot is not None else None,
            "basis": round(close - spot, 2) if spot is not None else None,
            "change_1m": round(close - prev_close, 2) if prev_close is not None else None,
            "oi_change_1m": (int(oi) - int(prev_oi))
                            if oi is not None and prev_oi is not None else None,
        })
        prev_close = close
        prev_oi = int(oi) if oi is not None else prev_oi
    return rows


def _read_jsonl(path: Path) -> list[dict]:
    """Every parseable object in ``path`` (empty when missing/corrupt)."""
    return read_jsonl(path)


def _write_jsonl_atomic(path: Path, rows: list[dict]) -> None:
    """Rewrite the whole (small, ≤ one session) day file atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as fh:
        for row in rows:
            fh.write(json.dumps(row, separators=(",", ":")) + "\n")
    os.replace(tmp, path)


def seen_minutes(path: Path, cache: dict[str, set[str]]) -> set[str]:
    """Minutes already recorded in ``path`` (parsed once, then cached)."""
    key = str(path)
    cached = cache.get(key)
    if cached is not None:
        return cached
    seen = {str(row.get("t") or "")[:16] for row in _read_jsonl(path)}
    seen.discard("")
    cache[key] = seen
    return seen


def merge_rows(path: Path, rows: list[dict], cache: dict[str, set[str]]) -> int:
    """Merge ``rows`` into the day file: dedupe by minute, keep it sorted.

    Returns the number of added rows. A minute already on disk is never
    rewritten — its close was observed when the bar was complete, and a later
    partial read must not shadow it.
    """
    if not rows:
        return 0
    existing = _read_jsonl(path)
    by_minute: dict[str, dict] = {str(r.get("t") or "")[:16]: r for r in existing}
    added = 0
    for row in rows:
        minute = str(row.get("t") or "")[:16]
        if not minute or minute in by_minute:
            continue
        by_minute[minute] = row
        added += 1
    if not added:
        return 0
    ordered = [by_minute[key] for key in sorted(by_minute)]
    _write_jsonl_atomic(path, ordered)
    cache[str(path)] = set(by_minute)
    return added


def load_spot_by_minute(path: Path) -> dict[str, float]:
    """``{minute: spot}`` from the local option/spot tape (never raises)."""
    out: dict[str, float] = {}
    for row in _read_jsonl(path):
        minute = str(row.get("t") or "")[:16]
        if not minute:
            continue
        try:
            spot = float(row.get("spot"))
        except (TypeError, ValueError):
            continue
        if spot > 0:
            out[minute] = spot
    return out


def _append_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as fh:
        for row in rows:
            fh.write(json.dumps(row, separators=(",", ":")) + "\n")


def get_token() -> str:
    """Shared Upstox token (DB → file). Empty string when unavailable."""
    try:
        from api.options import get_upstox_token

        return str(get_upstox_token() or "")
    except Exception:
        return ""


async def get_json(url: str, params: Optional[dict], token: str) -> Any:
    """One bounded GET; tests monkeypatch this instead of the network."""
    timeout = httpx.Timeout(REQUEST_TIMEOUT_SEC, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(
            url, params=params or {}, headers={"Authorization": f"Bearer {token}"}
        )
    if response.status_code >= 400:
        raise RuntimeError(f"upstox {response.status_code}: {response.text[:160]}")
    return response.json()


async def with_retry(factory: Callable[[], Awaitable[Any]], *,
                     logger: logging.Logger, label: str) -> Any:
    """Run ``factory`` once more after a failure (a single lost minute is cheap)."""
    try:
        return await factory()
    except asyncio.CancelledError:
        raise
    except Exception as first:
        logger.debug("%s: upstream failed (%s) — retrying once", label, first)
    return await factory()


async def search_contracts(rt: Runtime, token: str) -> list[dict]:
    """Futures candidates for the spec's index from the instrument search."""
    payload = await rt.get_json(
        f"{UPSTOX_V2}/instruments/search", dict(rt.spec.search_params), token
    )
    return parse_search_payload(payload, rt.spec)


async def resolve_contract(today: str, token: str, rt: Runtime) -> Optional[dict]:
    """Nearest-expiry future for the spec's index, cached for ``CONTRACT_TTL_SEC``."""
    key = rt.spec.contract_cache_key
    hit = rt.contract_cache.get(key)
    if hit and (time.monotonic() - hit["ts"] < CONTRACT_TTL_SEC
                and str(hit["row"].get("expiry") or "") >= today):
        return hit["row"]
    try:
        rows = await with_retry(lambda: search_contracts(rt, token),
                                logger=rt.logger, label=rt.spec.label)
    except Exception:
        # A cached contract is still the right one until it expires; a flaky
        # search must not blank the day's recording.
        if hit and str(hit["row"].get("expiry") or "") >= today:
            return hit["row"]
        raise
    row = pick_current_month(rows, today)
    if row is None:
        return None
    rt.contract_cache[key] = {"ts": time.monotonic(), "row": row}
    return row


async def fetch_candles(rt: Runtime, instrument_key: str, token: str) -> list[dict]:
    """The contract's intraday 1-minute bars, oldest-first."""
    quoted = urllib.parse.quote(instrument_key, safe="")
    payload = await rt.get_json(
        f"{UPSTOX_V3}/historical-candle/intraday/{quoted}/minutes/1", None, token
    )
    return parse_candles(payload)


def _expiry_dates(listing: Any) -> list[str]:
    """Normalised expiry dates from ``api.options.get_expiries`` (sorted)."""
    raw = (listing or {}).get("expiries") if isinstance(listing, dict) else listing
    dates: list[str] = []
    for item in raw or []:
        value = item.get("date") if isinstance(item, dict) else item
        value = str(value or "")[:10]
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            continue
        if value not in dates:
            dates.append(value)
    return sorted(dates)


async def record_term_snapshot(now: datetime, spec: RecorderSpec) -> list[dict]:
    """ATM IV / max pain / PCR for the two nearest expiries.

    Raises on upstream failure so the caller can record *why* the snapshot was
    skipped; the loop turns that into a status field and a single log line.
    """
    from api.options import get_expiries, get_option_chain

    today = now.strftime("%Y-%m-%d")
    expiries = [d for d in _expiry_dates(await get_expiries(spec.term_source))
                if d >= today][:2]
    if not expiries:
        raise RuntimeError(f"no listed {spec.underlying} expiry")
    t_iso = now.isoformat()
    rows: list[dict] = []
    for expiry in expiries:
        payload = await get_option_chain(spec.term_source, expiry) or {}
        summary = payload.get("summary") or {}
        rows.append({
            "t": t_iso,
            "expiry": expiry,
            "atm_iv": summary.get("atm_iv"),
            "max_pain": summary.get("max_pain"),
            "spot": payload.get("spot"),
            "pcr": summary.get("pcr"),
        })
    return rows


async def write_term(now: datetime, rt: Runtime, ttl_sec: float) -> int:
    """Append the term snapshot once per ``ttl_sec``.

    Deduped on ``(expiry, minute)`` so a restart inside the same window cannot
    double-write. Never raises.
    """
    last = rt.status.get("term_last_attempt")
    if last:
        try:
            if (now - datetime.fromisoformat(str(last))).total_seconds() < ttl_sec:
                return 0
        except (TypeError, ValueError):
            pass
    try:
        rows = await record_term_snapshot(now, rt.spec)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # Anchoring the attempt (not only the success) is what keeps a dead
        # endpoint from being retried every minute for the whole session.
        rt.status["term_last_attempt"] = now.isoformat()
        reason = f"{type(exc).__name__}: {str(exc)[:140]}"
        if rt.status.get("term_last_skip") != reason:
            rt.status["term_last_skip"] = reason
            rt.logger.info("%s: term snapshot skipped (%s)", rt.spec.label, reason)
        return 0
    path = rt.term_path(now.strftime("%Y-%m-%d"))
    existing = {(str(r.get("expiry")), str(r.get("t") or "")[:16])
                for r in await asyncio.to_thread(_read_jsonl, path)}
    fresh = [r for r in rows
             if (str(r.get("expiry")), str(r.get("t") or "")[:16]) not in existing]
    rt.status["term_last_attempt"] = now.isoformat()
    if fresh:
        await asyncio.to_thread(_append_jsonl, path, fresh)
        rt.status["term_last_ok"] = now.isoformat()
        rt.status["term_last_skip"] = None
    return len(fresh)


async def _maybe_await(value: Any) -> Any:
    """Await ``value`` when it is awaitable (a spot hook may be sync or async)."""
    if inspect.isawaitable(value):
        return await value
    return value


async def record_tick(now: Optional[datetime], rt: Runtime) -> dict:
    """Record every complete minute of today's session. Never raises.

    Returns ``{"t", "status", "records", "contract"}``; ``status`` is ``ok`` or
    a short reason (``no-token``, ``no-contract``, ``no-candles``, ...).
    """
    spec, status = rt.spec, rt.status
    ts = now or datetime.now(config.IST)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=config.IST)
    t_iso = ts.isoformat()
    date_str = t_iso[:10]
    status["last_tick"] = t_iso
    status["iterations"] = int(status.get("iterations") or 0) + 1
    outcome = {"t": t_iso, "status": "ok", "records": 0, "contract": None}

    try:
        token = await asyncio.to_thread(rt.token)
    except Exception:
        token = ""
    if not token:
        status["last_error"] = "no Upstox token"
        outcome["status"] = "no-token"
        return outcome

    try:
        contract = await resolve_contract(date_str, token, rt)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        contract = None
        status["last_error"] = f"contract: {type(exc).__name__}: {str(exc)[:140]}"
    if not contract:
        outcome["status"] = "no-contract"
        status["last_error"] = (status.get("last_error")
                                or f"no current-month {spec.underlying} future")
        return outcome

    key = str(contract.get("instrument_key") or "")
    expiry = str(contract.get("expiry") or "")
    outcome["contract"] = {"instrument_key": key, "expiry": expiry}
    try:
        candles = await with_retry(lambda: fetch_candles(rt, key, token),
                                   logger=rt.logger, label=spec.label)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        status["last_error"] = f"candles: {type(exc).__name__}: {str(exc)[:140]}"
        outcome["status"] = "candles-failed"
        return outcome

    bars = complete_bars(filter_session(candles, date_str), ts)
    if not bars:
        outcome["status"] = "no-candles"
        return outcome

    spot_map = await asyncio.to_thread(load_spot_by_minute, spec.tape_path(date_str))
    # The tape usually covers every minute; only the newest bar can be ahead of
    # it. NIFTY's spot is an in-process websocket read, SENSEX's is an upstream
    # call, hence ``spot_always``.
    live_spot = None
    if spec.spot_always or str(bars[-1].get("ts") or "")[:16] not in spot_map:
        live_spot = await _maybe_await(rt.live_spot(date_str))

    rows = build_rows(bars, key, expiry, spot_map, live_spot)
    path = rt.day_path(date_str)
    seen = await asyncio.to_thread(seen_minutes, path, rt.seen_cache)
    pending = [r for r in rows if str(r.get("t") or "")[:16] not in seen]
    if pending:
        added = await asyncio.to_thread(merge_rows, path, pending, rt.seen_cache)
        status["records"] = int(status.get("records") or 0) + added
        outcome["records"] = added
        if added:
            status["last_bar"] = rows[-1]["t"]
            rt.logger.info(
                "%s: +%d bar(s) %s %s (last %s)",
                spec.label, added, key, expiry, str(rows[-1]["t"])[:16],
            )

    status["contract"] = {"instrument_key": key, "expiry": expiry}
    status["last_error"] = None
    await rt.write_term(ts)
    return outcome


def market_open() -> bool:
    """Derivatives session gate; hour-window fallback on import failure."""
    try:
        from trading.utils import is_derivatives_open

        return bool(is_derivatives_open())
    except Exception:
        return 8 <= datetime.now(config.IST).hour <= 16


def advance(next_tick: float, interval_sec: float, now: float) -> float:
    """Next wall-clock tick, never firing a catch-up burst after a long gap."""
    candidate = next_tick + interval_sec
    return candidate if candidate > now else now + interval_sec


async def run_tick(rt: Runtime) -> dict:
    try:
        return await asyncio.wait_for(rt.record(), timeout=max(20.0, INTERVAL_SEC))
    except asyncio.TimeoutError:
        rt.status["last_error"] = "tick timed out"
        rt.logger.warning("%s: tick timed out", rt.spec.label)
        return {}
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        rt.status["last_error"] = f"{type(exc).__name__}: {str(exc)[:180]}"
        rt.logger.warning("%s: tick raised %s: %s", rt.spec.label,
                          type(exc).__name__, exc)
        return {}


async def recorder_loop(interval_sec: float, rt: Runtime) -> None:
    """Wall-clock loop: 60 s cadence while open, 60 s idle sleeps while closed."""
    current = asyncio.current_task()
    if not rt.claim_task(current):
        # Another loop already owns the file — never write the day twice.
        return
    loop = asyncio.get_running_loop()
    # One shot before the gate: a start after the close must still fill the
    # session the file is missing, otherwise the day is lost for good.
    await rt.tick()
    next_tick = loop.time() + interval_sec
    while True:
        try:
            if market_open():
                await rt.tick()
                next_tick = advance(next_tick, interval_sec, loop.time())
                await asyncio.sleep(max(0.0, next_tick - loop.time()))
            else:
                next_tick = loop.time() + interval_sec
                await asyncio.sleep(MARKET_CLOSED_SLEEP_SEC)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - defensive
            rt.logger.exception("%s: loop error (%s) — retrying",
                                rt.spec.label, type(exc).__name__)
            next_tick = loop.time() + interval_sec
            await asyncio.sleep(interval_sec)


async def start_task(interval_sec: float, rt: Runtime, enabled: bool,
                     run_loop: Callable[[float], Awaitable[None]]) -> None:
    """Start the recorder unless the module's env flag disabled it.

    A second call is a no-op (the loop's single-writer guard), so an extra
    caller cannot create a second writer for the same day file.
    """
    if not enabled:
        rt.logger.info("%s: disabled (%s=0)", rt.spec.label, rt.spec.env_flag)
        return
    try:
        await run_loop(interval_sec)
    except asyncio.CancelledError:
        rt.logger.info("%s: cancelled — stopping", rt.spec.label)
        raise
    except BaseException:
        rt.logger.exception("%s: recorder died", rt.spec.label)
        raise
