"""SENSEX futures / basis recorder.

SENSEX is BSE's index: the option chain is recorded (``options_tape/SENSEX``)
but the **current-month futures contract** was not, so "is the premium real?",
"is basis widening?" and "is OI unwinding?" had no data. This recorder mirrors
``nifty_futures.py`` for the BSE contract — a separate module because the
exchange, the search payload and the spot tape all differ. Everything that does
not depend on the index lives in ``futures_common``.

Writes one compact line per completed minute to::

    experiments/data/sensex_futures/{YYYY-MM-DD}.jsonl
    {"t", "instrument_key", "expiry", "close", "oi", "volume",
     "spot", "basis", "change_1m", "oi_change_1m"}

``basis`` is ``futures close - spot`` in **index points**, ``change_1m`` the
futures close delta in points, ``oi_change_1m`` the absolute OI delta.

``spot`` comes from the local SENSEX option tape at that same minute, then the
latest SENSEX report (in-process, then the on-disk snapshot), and only as a
last resort the live quote. The tape is a local read, so the recorder never
polls the index for historical minutes.

A term snapshot for the two nearest option expiries is appended to
``term_{YYYY-MM-DD}.jsonl`` every ``TERM_SNAPSHOT_SEC`` (default 15 min)::

    {"t", "expiry", "atm_iv", "max_pain", "spot", "pcr"}

Design rules (all shared with ``nifty_futures`` via ``futures_common``):

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
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from api.reports_api import futures_common as common

logger = logging.getLogger(__name__)

#: ``experiments/data`` — tests monkeypatch this to ``tmp_path``.
DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "experiments" / "data"
DIRNAME = "sensex_futures"
#: The option tape/report directory is owned by ``options_recorder``; the names
#: are repeated here only as a fallback when it cannot be imported.
TAPE_DIRNAME = "options_tape"
SNAPSHOT_DIRNAME = "options_snapshots"
UNDERLYING = "SENSEX"

INTERVAL_SEC = common.INTERVAL_SEC
CONTRACT_TTL_SEC = common.CONTRACT_TTL_SEC
#: Term snapshot cadence (3 upstream calls per snapshot, well inside budget).
TERM_SNAPSHOT_SEC = float(os.getenv("SENSEX_FUTURES_TERM_SEC", "900"))

#: ``SENSEX`` prefixes that are a *different* index. ``SENSEX50`` starts with
#: ``SENSEX``, so a naive prefix test would record the wrong contract.
NON_SENSEX_PREFIXES = ("SENSEX50",)

#: Optional off-switch (the recorder is additive; disabling must be trivial).
ENABLED = os.getenv("SENSEX_FUTURES_ENABLED", "1") != "0"

_task: Optional[asyncio.Task] = None

_status: dict[str, Any] = common.empty_status()
#: ``{path: {minute, ...}}`` — parsed once per day file, then kept in sync.
_seen_minutes: dict[str, set[str]] = {}
#: ``{"sensex": {"ts": monotonic, "row": {...}}}`` — contract roll cache.
_contract_cache: dict[str, dict] = {}


def futures_dir() -> Path:
    return DATA_ROOT / DIRNAME


def day_path(date_str: str) -> Path:
    return futures_dir() / f"{date_str}.jsonl"


def term_path(date_str: str) -> Path:
    return futures_dir() / f"term_{date_str}.jsonl"


def tape_path(date_str: str) -> Path:
    return DATA_ROOT / TAPE_DIRNAME / UNDERLYING / f"{date_str}.jsonl"


def report_path(date_str: str) -> Path:
    return DATA_ROOT / SNAPSHOT_DIRNAME / UNDERLYING / f"{date_str}.json"


def status() -> dict:
    """Recorder heartbeat (readable directly; the server logs it, no route)."""
    return dict(_status)


def _reset_state() -> None:
    """Drop every in-process cache/counter (tests, manual restart)."""
    common.reset_state(_status, _seen_minutes, _contract_cache)


def is_sensex_futures(symbol: str) -> bool:
    """True only for the SENSEX index future (not SENSEX50)."""
    sym = str(symbol or "").strip().upper()
    if not sym.startswith("SENSEX"):
        return False
    if any(sym.startswith(prefix) for prefix in NON_SENSEX_PREFIXES):
        return False
    return "FUT" in sym


_SPEC = common.RecorderSpec(
    underlying=UNDERLYING,
    dirname=DIRNAME,
    label="sensex futures",
    env_flag="SENSEX_FUTURES_ENABLED",
    # The verified query omits ``exchanges``: SENSEX is BSE-only, and the
    # payload also carries the SENSEX50 siblings that ``is_sensex_futures``
    # drops.
    search_params={
        "query": UNDERLYING,
        "segments": "FO",
        "instrument_types": "FUT",
        "records": common.SEARCH_RECORDS,
    },
    is_contract=is_sensex_futures,
    # Some payload rows tag the contract in the symbol only.
    symbol_futures_marker=True,
    # A live spot for SENSEX is an upstream call, so only ask when the tape
    # cannot cover the newest minute.
    spot_always=False,
    contract_cache_key="sensex",
    term_source=UNDERLYING,
    tape_path=tape_path,
)


def parse_search_payload(payload: Any) -> list[dict]:
    """``/v2/instruments/search`` → only the SENSEX index futures rows."""
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
    """SENSEX futures candidates from the instrument search (BSE ``FO`` segment)."""
    return await common.search_contracts(_runtime(), token)


async def resolve_contract(today: str, token: str) -> Optional[dict]:
    """Nearest-expiry SENSEX future, cached for ``CONTRACT_TTL_SEC``."""
    return await common.resolve_contract(today, token, _runtime())


async def record_term_snapshot(now: datetime) -> list[dict]:
    """ATM IV / max pain / PCR for the two nearest SENSEX option expiries."""
    return await common.record_term_snapshot(now, _SPEC)


async def _write_term(now: datetime) -> int:
    """Append the term snapshot once per ``TERM_SNAPSHOT_SEC`` (never raises)."""
    return await common.write_term(now, _runtime(), TERM_SNAPSHOT_SEC)


def _local_spot(date_str: str) -> Optional[float]:
    """Latest SENSEX spot from the recorder's memory, then the on-disk report."""
    try:
        from api.reports_api.options_recorder import LAST

        spot = (LAST.get(UNDERLYING) or {}).get("spot")
        if spot:
            return float(spot)
    except Exception:
        pass
    try:
        with open(report_path(date_str)) as fh:
            spot = json.load(fh).get("spot")
        return float(spot) if spot else None
    except (OSError, ValueError, TypeError):
        return None


async def _live_spot(date_str: str) -> Optional[float]:
    """Newest-bar spot: local report first, latest quote only as a fallback."""
    spot = _local_spot(date_str)
    if spot:
        return spot
    try:
        from api.options import get_spot_price

        payload = await get_spot_price(UNDERLYING)
        value = (payload or {}).get("spot")
        return float(value) if value else None
    except Exception:
        return None


async def _newest_spot(date_str: str) -> Optional[float]:
    """Newest-bar spot (the tape already covers the earlier minutes)."""
    return await _live_spot(date_str)


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


async def start_sensex_futures_task(interval_sec: Optional[float] = None) -> None:
    """Start the single SENSEX futures recorder (immediate tick = backfill).

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
