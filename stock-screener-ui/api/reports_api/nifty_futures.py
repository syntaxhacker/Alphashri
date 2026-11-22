"""NIFTY futures / basis recorder.

The NIFTY index has no volume and no tradable price, so every "is this move
real?" question ("volume expansion", "basis is widening", "OI is unwinding")
needs the **current-month futures contract**, not the spot index. Nothing was
recording it, which meant the analysis could not be done after the fact.

Writes one compact line per completed minute to::

    experiments/data/nifty_futures/{YYYY-MM-DD}.jsonl
    {"t", "instrument_key", "expiry", "close", "oi", "volume",
     "spot", "basis", "change_1m", "oi_change_1m"}

``basis`` is ``futures close - spot`` in **index points** (the futures
premium/discount for that minute), ``change_1m`` the futures close delta in
points, ``oi_change_1m`` the absolute OI delta.

``spot`` comes from the local NIFTY tape (``experiments/data/nifty_tape``) at
that same minute, falling back to the live websocket spot for the newest bar.
Both are local reads — this recorder never polls the index itself.

A term snapshot for the two nearest expiries is appended to
``term_{YYYY-MM-DD}.jsonl`` every ``TERM_SNAPSHOT_SEC`` (default 15 min)::

    {"t", "expiry", "atm_iv", "max_pain", "spot", "pcr"}

Design rules (all shared with ``sensex_futures`` via ``futures_common``):

- **One upstream call per minute** (the futures 1-minute candles). The contract
  search is cached for an hour; the option chain is read at most every 15 min.
- **Complete bars only.** Writing the forming minute's partial close would
  freeze a half-formed bar for the rest of the day; a bar is written once the
  clock has moved past it, so a missed minute is recovered on the next tick.
- **Backfill on startup.** Every tick merges the whole intraday series, so a
  late start fills the day's earlier minutes (deduped by minute, sorted).
- **Failures never kill the app**: one retry, then the tick is logged and the
  loop waits for the next minute.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from api.reports_api import futures_common as common

logger = logging.getLogger(__name__)

#: ``experiments/data`` — tests monkeypatch this to ``tmp_path``.
DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "experiments" / "data"
DIRNAME = "nifty_futures"

INTERVAL_SEC = common.INTERVAL_SEC
CONTRACT_TTL_SEC = common.CONTRACT_TTL_SEC
#: Term snapshot cadence (3 upstream calls per snapshot, well inside budget).
TERM_SNAPSHOT_SEC = float(os.getenv("NIFTY_FUTURES_TERM_SEC", "900"))

#: ``NIFTY`` prefixes that are a *different* index (or a synthetic FPI row).
#: ``"BANKNIFTY" in "NIFTY..."`` is false, so a naive substring test would pick
#: the wrong contract; the prefix list mirrors ``scripts/futures_volume.py``.
NON_NIFTY_PREFIXES = (
    "BANKNIFTY",
    "FINNIFTY",
    "MIDCPNIFTY",
    "NIFTYNXT50",
    "NIFTYFPI",
)

#: Optional off-switch (the recorder is additive; disabling must be trivial).
ENABLED = os.getenv("NIFTY_FUTURES_ENABLED", "1") != "0"

_task: Optional[asyncio.Task] = None

_status: dict[str, Any] = common.empty_status()
#: ``{path: {minute, ...}}`` — parsed once per day file, then kept in sync.
_seen_minutes: dict[str, set[str]] = {}
#: ``{"nifty": {"ts": monotonic, "row": {...}}}`` — contract roll cache.
_contract_cache: dict[str, dict] = {}


def futures_dir() -> Path:
    return DATA_ROOT / DIRNAME


def day_path(date_str: str) -> Path:
    return futures_dir() / f"{date_str}.jsonl"


def term_path(date_str: str) -> Path:
    return futures_dir() / f"term_{date_str}.jsonl"


def tape_path(date_str: str) -> Path:
    return DATA_ROOT / "nifty_tape" / f"{date_str}.jsonl"


def status() -> dict:
    """Recorder heartbeat (readable directly; the server logs it, no route)."""
    return dict(_status)


def _reset_state() -> None:
    """Drop every in-process cache/counter (tests, manual restart)."""
    common.reset_state(_status, _seen_minutes, _contract_cache)


def is_nifty_futures(symbol: str) -> bool:
    """True only for the NIFTY index future (not BANKNIFTY, NIFTYNXT50, FPI)."""
    sym = str(symbol or "").strip().upper()
    if not sym.startswith("NIFTY"):
        return False
    if any(sym.startswith(prefix) for prefix in NON_NIFTY_PREFIXES):
        return False
    return "FUT" in sym


_SPEC = common.RecorderSpec(
    underlying="NIFTY",
    dirname=DIRNAME,
    label="nifty futures",
    env_flag="NIFTY_FUTURES_ENABLED",
    # NIFTY futures live only under NSE's F&O segment.
    search_params={
        "query": "NIFTY",
        "exchanges": "NSE",
        "segments": "FO",
        "instrument_types": "FUT",
        "records": common.SEARCH_RECORDS,
    },
    is_contract=is_nifty_futures,
    symbol_futures_marker=False,
    # The websocket read is free, so the newest bar always gets a live spot.
    spot_always=True,
    contract_cache_key="nifty",
    term_source="NIFTY",
    tape_path=tape_path,
)


def parse_search_payload(payload: Any) -> list[dict]:
    """``/v2/instruments/search`` → only the NIFTY index futures rows."""
    return common.parse_search_payload(payload, _SPEC)


pick_current_month = common.pick_current_month
parse_candles = common.parse_candles
filter_session = common.filter_session
complete_bars = common.complete_bars
build_rows = common.build_rows
_expiry_dates = common._expiry_dates


_token = common.get_token
_get_json = common.get_json


async def search_contracts(token: str) -> list[dict]:
    """Current-month NIFTY futures candidates from the instrument search."""
    return await common.search_contracts(_runtime(), token)


async def resolve_contract(today: str, token: str) -> Optional[dict]:
    """Nearest-expiry NIFTY future, cached for ``CONTRACT_TTL_SEC``."""
    return await common.resolve_contract(today, token, _runtime())


async def record_term_snapshot(now: datetime) -> list[dict]:
    """ATM IV / max pain / PCR for the two nearest NIFTY expiries."""
    return await common.record_term_snapshot(now, _SPEC)


async def _write_term(now: datetime) -> int:
    """Append the term snapshot once per ``TERM_SNAPSHOT_SEC`` (never raises)."""
    return await common.write_term(now, _runtime(), TERM_SNAPSHOT_SEC)


def _live_spot() -> Optional[float]:
    """Live NIFTY spot from the shared websocket poller (never blocks)."""
    try:
        from api.reports_api.nifty_ws import latest_spot

        return (latest_spot() or {}).get("spot")
    except Exception:
        return None


async def _newest_spot(_date_str: str) -> Optional[float]:
    """Newest-bar spot; the tape already covers the earlier minutes."""
    return _live_spot()


async def record_tick(now: Optional[datetime] = None) -> dict:
    """Record every complete minute of today's session. Never raises.

    Returns ``{"t", "status", "records", "contract"}``; ``status`` is ``ok`` or
    a short reason (``no-token``, ``no-contract``, ``no-candles``, ...).
    """
    return await common.record_tick(now, _runtime())


async def _tick() -> dict:
    return await common.run_tick(_runtime())


async def _recorder_loop(interval_sec: float) -> None:
    await common.recorder_loop(interval_sec, _runtime())


async def start_nifty_futures_task(interval_sec: Optional[float] = None) -> None:
    """Start the single futures recorder (immediate tick = today's backfill).

    Started from the FastAPI lifespan. A second call is a no-op, so an extra
    caller cannot create a second writer for the same day file.
    """
    await common.start_task(float(interval_sec or INTERVAL_SEC), _runtime(),
                            ENABLED, _recorder_loop)


def _claim_task(current: Optional[asyncio.Task]) -> bool:
    """Claim the single-writer slot; False when another loop already owns it."""
    global _task
    if _task is not None and _task is not current and not _task.done():
        return False
    _task = current
    return True


def _runtime() -> common.Runtime:
    """Snapshot module state/hooks per call, so monkeypatching takes effect."""
    return common.Runtime(
        spec=_SPEC,
        logger=logger,
        status=_status,
        contract_cache=_contract_cache,
        seen_cache=_seen_minutes,
        token=_token,
        get_json=_get_json,
        write_term=_write_term,
        live_spot=_newest_spot,
        record=record_tick,
        tick=_tick,
        claim_task=_claim_task,
        day_path=day_path,
        term_path=term_path,
    )
