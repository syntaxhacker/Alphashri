"""Per-underlying option-chain recorder (SENSEX, RELIANCE, ...).

The NIFTY recorder (``nifty.py``) writes three artefacts that the heatmap /
radar / bursts / flow / replay views are built from. This module records the
**same three artefacts for any F&O underlying** so those views can be rebuilt
for SENSEX and stocks without touching the NIFTY paths.

Frozen on-disk contract (the history agent reads these)::

    experiments/data/options_chain10s/{SYMBOL}/{YYYY-MM-DD}.jsonl
        {"t": ISO, "spot": float, "expiry": "YYYY-MM-DD",
         "rows": [[strike, ceLtp, ceOi, ceVol, peLtp, peOi, peVol], ...]}

    experiments/data/options_tape/{SYMBOL}/{YYYY-MM-DD}.jsonl
        ONE raw tape row per minute with the NIFTY tape's field set plus
        ``underlying`` (see :func:`_build_tape_row`).

    experiments/data/options_snapshots/{SYMBOL}/{YYYY-MM-DD}.jsonl
        {"t": ISO, "fetched_at": ISO, "report": <full report>, "sensex": null}

    experiments/data/options_snapshots/{SYMBOL}/{YYYY-MM-DD}.json
        Last snapshot report, written atomically (tmp + ``os.replace``).

    experiments/data/options_tape/{SYMBOL}/{YYYY-MM-DD}.gaps.jsonl
        Optional skip journal: ``{"t", "symbol", "reason", "detail"?}``.

Design rules (mirrors the NIFTY recorder, which is the reference):

- **Additive.** No ``_compute_live`` / ``_live_cache``, no ``nifty_*`` writes,
  no DB, no changes to the NIFTY snapshot/tape/chain10s writers.
- **One chain fetch per 10 s per symbol**, reused for the chain10s line, the
  per-minute tape row AND the per-minute replay frame (no second fetch).
- **Rate budget.** Every expiry/chain/candle call takes a token from
  ``upstox_trader.rate_limiter`` under the ``options`` consumer slice
  (20/min). 2 symbols × 6 chain calls/min = 12/min, plus at most 1 candle
  call/min. Fail-open only when the limiter (Redis) is unavailable.
- **Failures never kill the loop**: logged, journalled once per symbol-minute,
  retried on the next tick.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from api.reports_api._numeric import safe_float, safe_int
from api.reports_api._time import today_str as _today_str
from fastapi import APIRouter

import config

logger = logging.getLogger(__name__)

#: Status endpoint for the desk / the history agent. Mounted by the server.
router = APIRouter(prefix="/api/reports/options", tags=["options-recorder"])

#: ``experiments/data`` — tests monkeypatch this to ``tmp_path``.
DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "experiments" / "data"
CHAIN10S_DIRNAME = "options_chain10s"
TAPE_DIRNAME = "options_tape"
SNAPSHOT_DIRNAME = "options_snapshots"

#: Wall-clock cadence of the recorder.
INTERVAL_SEC = float(os.getenv("OPTIONS_RECORDER_INTERVAL_SEC", "10"))
#: Sleep while the exchange is closed (one cheap gate check per minute).
MARKET_CLOSED_SLEEP_SEC = 60.0
#: 1-minute bars only change once a bar; never refetch them on the 10 s loop.
INTRADAY_TTL_SEC = 120.0
INTRADAY_LOOKBACK_BARS = 120
#: A cold 1-minute bar fetch takes ~20 s for a stock; cap it so the minute's
#: tape row is never lost to the chart overlay.
CANDLE_TIMEOUT_SEC = 15.0
#: A single symbol must not stall the other symbols indefinitely.
SYMBOL_TIMEOUT_SEC = float(os.getenv("OPTIONS_RECORDER_SYMBOL_TIMEOUT_SEC", "25"))
#: Expiry listings only change when the exchange rolls an expiry.
EXPIRY_TTL_SEC = 3600.0
#: Hard ceiling on the configured symbol list (rate-budget guard).
MAX_SYMBOLS = 3
DEFAULT_SYMBOLS = "SENSEX,RELIANCE"
#: ``walls_near`` band as a share of spot (1%). NIFTY uses a fixed ±300 pts,
#: which is meaningless for SENSEX (~84k) and enormous for a stock (~1.3k).
NEAR_BAND_PCT = 0.01
#: Optional off-switch (the recorder is additive; disabling must be trivial).
ENABLED = os.getenv("OPTIONS_RECORDER_ENABLED", "1") != "0"
#: Seconds a chain/expiry/candle call waits for a limiter token.
RATE_ACQUIRE_TIMEOUT_SEC = 5.0

# Consumer slice for the shared Upstox budget (20/min — see rate_limiter).
RATE_CONSUMER = "options"


# --------------------------------------------------------------------------- #
# paths (always resolved through DATA_ROOT so tests can redirect them)
# --------------------------------------------------------------------------- #
def chain10s_dir() -> Path:
    return DATA_ROOT / CHAIN10S_DIRNAME


def tape_dir() -> Path:
    return DATA_ROOT / TAPE_DIRNAME


def snapshot_dir() -> Path:
    return DATA_ROOT / SNAPSHOT_DIRNAME


def chain10s_path(symbol: str, date_str: str) -> Path:
    return chain10s_dir() / symbol / f"{date_str}.jsonl"


def tape_path(symbol: str, date_str: str) -> Path:
    return tape_dir() / symbol / f"{date_str}.jsonl"


def gap_log_path(symbol: str, date_str: str) -> Path:
    return tape_dir() / symbol / f"{date_str}.gaps.jsonl"


def snapshot_log_path(symbol: str, date_str: str) -> Path:
    return snapshot_dir() / symbol / f"{date_str}.jsonl"


def snapshot_path(symbol: str, date_str: str) -> Path:
    return snapshot_dir() / symbol / f"{date_str}.json"


# --------------------------------------------------------------------------- #
# state
# --------------------------------------------------------------------------- #
#: Latest full report per symbol (10 s cadence) — the history agent may read
#: this instead of parsing the day file.
LAST: dict[str, dict] = {}

_expiry_cache: dict[str, dict] = {}
_intraday_cache: dict[str, dict] = {}
_lot_maps: Optional[dict] = None
_gap_minutes: dict[str, set[str]] = {}

_status: dict[str, Any] = {
    "last_tick": None,
    "last_error": None,
    "iterations": 0,
    "interval_sec": INTERVAL_SEC,
    "records": 0,
}
_per_symbol: dict[str, dict] = {}
_task: Optional[asyncio.Task] = None
_loop: Optional[asyncio.AbstractEventLoop] = None
_failure_streak = 0

_RATE_LIMITER: Any = None
_RATE_LIMITER_READY = False


def symbols() -> list[str]:
    """Configured symbols (``OPTIONS_RECORDER_SYMBOLS``), de-duped and capped."""
    raw = os.getenv("OPTIONS_RECORDER_SYMBOLS", DEFAULT_SYMBOLS)
    out: list[str] = []
    for part in str(raw or "").split(","):
        name = part.strip().upper()
        if name and name not in out:
            out.append(name)
    return out[:MAX_SYMBOLS]


def _sym_state(symbol: str) -> dict:
    state = _per_symbol.get(symbol)
    if state is None:
        state = {"chain10s": 0, "tape": 0, "snapshots": 0,
                 "last_tick": None, "last_error": None, "last_skip": None}
        _per_symbol[symbol] = state
    return state


def _reset_state() -> None:
    """Drop every in-process cache/counter (tests, manual restart)."""
    global _lot_maps, _RATE_LIMITER, _RATE_LIMITER_READY, _failure_streak
    LAST.clear()
    _expiry_cache.clear()
    _intraday_cache.clear()
    _gap_minutes.clear()
    _per_symbol.clear()
    _LAST_MINUTE.clear()
    _lot_maps = None
    _RATE_LIMITER = None
    _RATE_LIMITER_READY = False
    _failure_streak = 0
    _status.update({"last_tick": None, "last_error": None, "iterations": 0,
                    "interval_sec": INTERVAL_SEC, "records": 0})


def status() -> dict:
    """Recorder heartbeat — the contract the history agent polls.

    ``{symbols, last_tick, last_error, iterations, interval_sec, records}``
    plus an additive ``per_symbol`` breakdown (chain10s / tape / snapshots).
    """
    return {
        "symbols": symbols(),
        "last_tick": _status.get("last_tick"),
        "last_error": _status.get("last_error"),
        "iterations": int(_status.get("iterations") or 0),
        "interval_sec": float(_status.get("interval_sec") or INTERVAL_SEC),
        "records": int(_status.get("records") or 0),
        "per_symbol": {
            name: dict(state) for name, state in _per_symbol.items()
        },
    }


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def _tick_stamp(now: Optional[datetime] = None) -> tuple[str, str]:
    """ISO stamp + ``YYYY-MM-DD`` for a tick (IST, tz-aware)."""
    ts = now or datetime.now(config.IST)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=config.IST)
    t_iso = ts.isoformat()
    return t_iso, t_iso[:10]


def _market_open() -> bool:
    """Is the exchange open? Hour-window fallback on import failure.

    Options/F&O trading runs until 15:40 IST (DERIVATIVES_CLOSE), five minutes
    past the cash CAS — so the recorder stays open past cash-market close.
    """
    try:
        from trading.utils import is_derivatives_open

        return bool(is_derivatives_open())
    except Exception:
        return 8 <= datetime.now(config.IST).hour <= 16


def _advance_next_tick(next_tick: float, interval_sec: float,
                       now: float) -> float:
    """Next wall-clock tick, never re-running ticks we missed.

    Keeps the 10 s cadence when on time, but if the loop fell behind (market
    was closed for the night, or a tick ran long) it re-anchors to
    ``now + interval`` instead of firing a catch-up burst of chain fetches.
    """
    candidate = next_tick + interval_sec
    return candidate if candidate > now else now + interval_sec


def _err_detail(exc: BaseException) -> str:
    try:
        return f"{type(exc).__name__}: {str(exc)[:180]}"
    except Exception:  # pragma: no cover - defensive
        return type(exc).__name__


def _window_for(spot: float) -> float:
    """±window (points) for :func:`chain10s.slim_rows`.

    ``slim_rows`` defaults to ±750, which is ~half the SENSEX chain and ~3
    strikes of a 1.3k stock. 5% of spot (floored at 750) keeps a comparable
    strike count across underlyings.
    """
    try:
        spot = float(spot or 0)
    except (TypeError, ValueError):
        spot = 0.0
    return max(750.0, spot * 0.05) if spot > 0 else 750.0


def _append_jsonl(path: Path, obj: dict) -> None:
    """Append one compact JSON line (blocking; call via a thread)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as fh:
        fh.write(json.dumps(obj, separators=(",", ":")) + "\n")


def _write_json_atomic(path: Path, obj: dict) -> None:
    """Write a whole JSON file atomically (tmp + ``os.replace``)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"))
    os.replace(tmp, path)


def _tail_last_json_line(path: Path, chunk: int = 65536) -> Optional[dict]:
    """Last complete JSON object in a growing JSONL file, reading the tail.

    Same O(1) trick as ``nifty._tail_last_json_line``: these logs reach tens of
    MB by the close and the minute-dedupe only needs the final line. Never
    raises.
    """
    try:
        if not path.exists():
            return None
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            if size <= 0:
                return None
            window = min(chunk, size)
            lines: list[bytes] = []
            while True:
                fh.seek(size - window)
                data = fh.read(window)
                lines = [ln for ln in data.split(b"\n") if ln.strip()]
                if len(lines) >= (1 if window == size else 2) or window == size:
                    break
                window = min(window * 2, size)
        if not lines:
            return None
        value = json.loads(lines[-1])
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def _gap_minutes_for(path: Path) -> set[str]:
    """``{symbol|minute}`` already journalled for this gap file (loaded once)."""
    key = str(path)
    cached = _gap_minutes.get(key)
    if cached is not None:
        return cached
    seen: set[str] = set()
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    value = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                t = value.get("t") if isinstance(value, dict) else None
                if isinstance(t, str) and t:
                    seen.add(t[:16])
    except OSError:
        pass
    _gap_minutes[key] = seen
    return seen


def _append_gap(symbol: str, date_str: str, t_iso: str, reason: str,
                detail: str = "") -> None:
    """Best-effort append of one skipped minute to the symbol's journal.

    Deduped by MINUTE (a failure repeating every 10 s is one missing minute,
    not six), so the counts answer "which minutes are missing and why".
    Never raises.
    """
    try:
        minute = str(t_iso)[:16]
        seen = _gap_minutes_for(gap_log_path(symbol, date_str))
        if minute in seen:
            return
        entry: dict[str, Any] = {"t": t_iso, "symbol": symbol, "reason": reason}
        if detail:
            entry["detail"] = str(detail)[:200]
        path = gap_log_path(symbol, date_str)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as fh:
            fh.write(json.dumps(entry) + "\n")
        seen.add(minute)
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# rate limiter (upstox_trader, "options" consumer)
# --------------------------------------------------------------------------- #
def _rate_limiter() -> Any:
    """Lazy singleton ``UpstoxRateLimiter(consumer="options")`` (None if absent)."""
    global _RATE_LIMITER, _RATE_LIMITER_READY
    if not _RATE_LIMITER_READY:
        _RATE_LIMITER_READY = True
        try:
            from upstox_trader.rate_limiter import UpstoxRateLimiter

            _RATE_LIMITER = UpstoxRateLimiter(consumer=RATE_CONSUMER)
        except Exception:
            _RATE_LIMITER = None
    return _RATE_LIMITER


async def _acquire_upstream() -> bool:
    """Take one token from the shared ``options`` slice.

    ``acquire`` blocks on a Redis sliding window, so it runs in a thread.
    Fail-open when the limiter (or Redis) is unavailable — a hard failure here
    would take the recorder down for an infrastructure reason.
    """
    limiter = _rate_limiter()
    if limiter is None:
        return True
    try:
        return await asyncio.to_thread(
            limiter.acquire, 1, RATE_ACQUIRE_TIMEOUT_SEC
        )
    except Exception:
        return True


# --------------------------------------------------------------------------- #
# upstream fetches
# --------------------------------------------------------------------------- #
async def _fetch_expiries(symbol: str) -> dict:
    """``api.options.get_expiries`` (imported lazily, monkeypatch-friendly)."""
    fn = globals().get("get_expiries")
    if fn is None:
        from api.options import get_expiries as fn
    return await fn(symbol)


async def _fetch_chain(symbol: str, expiry: str) -> dict:
    """``api.options.get_option_chain`` (imported lazily, monkeypatch-friendly)."""
    fn = globals().get("get_option_chain")
    if fn is None:
        from api.options import get_option_chain as fn
    return await fn(symbol, expiry)


async def _nearest_expiry(symbol: str) -> Optional[str]:
    """Nearest listed expiry for ``symbol`` (cached 1 h); ``None`` when absent."""
    now = time.monotonic()
    hit = _expiry_cache.get(symbol)
    if hit and now - hit["ts"] < EXPIRY_TTL_SEC:
        return hit["expiry"]
    if not await _acquire_upstream():
        return hit["expiry"] if hit else None
    listing = await _fetch_expiries(symbol)
    expiries = (listing or {}).get("expiries") or []
    expiry = ""
    for item in expiries:
        if isinstance(item, dict) and item.get("date"):
            expiry = str(item["date"])
            break
        if isinstance(item, str) and item:
            expiry = item
            break
    if not expiry:
        return hit["expiry"] if hit else None
    _expiry_cache[symbol] = {"ts": now, "expiry": expiry}
    return expiry


# --------------------------------------------------------------------------- #
# lot size (SENSEX 20 from AVAILABLE_UNDERLYINGS, stocks from NSE_FO contracts)
# --------------------------------------------------------------------------- #
def _instruments_path() -> Path:
    # api/reports_api/options_recorder.py -> parents[3] == repo root
    return (Path(__file__).resolve().parents[3]
            / "upstox_trader" / "config_and_utils" / "nse_instruments.json")


def _fo_lot_maps() -> dict:
    """``{"by_key", "by_symbol"}`` lot maps for ``NSE_FO`` contracts (lazy, once).

    ``by_key`` resolves the chain contract's ``instrument_key`` (the primary
    path). ``by_symbol`` is the fallback for flattened strike rows that keep no
    ``instrument_key`` (the replay report's ``strikes``), keyed on
    ``underlying_symbol`` / ``asset_symbol`` (e.g. ``RELIANCE`` -> 500).
    """
    global _lot_maps
    if _lot_maps is not None:
        return _lot_maps
    by_key: dict[str, int] = {}
    by_symbol: dict[str, int] = {}
    try:
        path = _instruments_path()
        if path.exists():
            with open(path) as fh:
                data = json.load(fh)
            for item in data or []:
                if not isinstance(item, dict):
                    continue
                if item.get("segment") != "NSE_FO":
                    continue
                lot = item.get("lot_size")
                if not lot:
                    continue
                try:
                    lot = int(lot)
                except (TypeError, ValueError):
                    continue
                if lot <= 0:
                    continue
                key = item.get("instrument_key")
                if key:
                    by_key[str(key)] = lot
                for field in ("underlying_symbol", "asset_symbol"):
                    name = str(item.get(field) or "").upper()
                    if name:
                        by_symbol.setdefault(name, lot)
    except Exception:
        by_key, by_symbol = {}, {}
    _lot_maps = {"by_key": by_key, "by_symbol": by_symbol}
    return _lot_maps


def lot_size(symbol: str, chain: Optional[list[dict]] = None) -> int:
    """Contract lot size: index from ``AVAILABLE_UNDERLYINGS``, stock from the chain.

    A stock's chain legs carry the ``NSE_FO|<id>`` ``instrument_key``; the
    instruments file maps that key to ``lot_size`` (e.g. RELIANCE 500). A
    flattened strike row (no ``instrument_key``) falls back to the contract's
    ``underlying_symbol``. Returns 1 when nothing resolves.
    """
    up = str(symbol or "").upper()
    try:
        from api.options import AVAILABLE_UNDERLYINGS

        for entry in AVAILABLE_UNDERLYINGS:
            if str(entry.get("symbol") or "").upper() == up:
                try:
                    return int(entry.get("lot_size") or 1)
                except (TypeError, ValueError):
                    return 1
    except Exception:
        pass
    maps = _fo_lot_maps()
    by_key = maps.get("by_key") or {}
    if by_key:
        for row in chain or []:
            if not isinstance(row, dict):
                continue
            for leg in ("ce", "pe"):
                key = str((row.get(leg) or {}).get("instrument_key") or "")
                lot = by_key.get(key)
                if lot:
                    return int(lot)
    by_symbol = maps.get("by_symbol") or {}
    return int(by_symbol.get(up) or 1)


# --------------------------------------------------------------------------- #
# intraday bars (replay chart) — at most one fetch per 120 s per symbol
# --------------------------------------------------------------------------- #
try:  # embedded for monkeypatching; the lazy import below is the fallback
    from market_data.market_data import fetch_candles_for_timeframe
except Exception:  # pragma: no cover - import guard only
    fetch_candles_for_timeframe = None  # type: ignore[assignment]

try:
    from api.reports_api.nifty_verdicts import atm_ivs, ema_series
except Exception:  # pragma: no cover - import guard only
    atm_ivs = None  # type: ignore[assignment]
    ema_series = None  # type: ignore[assignment]


def _bars_to_intraday(df: Any) -> list[dict]:
    """DataFrame -> ``[{time, open, high, low, close, volume}]``."""
    try:
        from api.reports_api.options_report import candles_to_intraday

        return candles_to_intraday(df)
    except Exception:
        pass
    out: list[dict] = []
    if df is None or getattr(df, "empty", True):
        return out
    try:
        for ts, row in df.iterrows():
            try:
                o = float(row["open"])
                h = float(row["high"])
                lo = float(row["low"])
                c = float(row["close"])
            except (KeyError, TypeError, ValueError):
                continue
            if not all(v == v for v in (o, h, lo, c)):
                continue
            try:
                stamp = ts.tz_convert(config.IST) if getattr(ts, "tzinfo", None) else ts
            except Exception:
                stamp = ts
            try:
                time_str = stamp.isoformat()
            except Exception:
                time_str = str(stamp)
            try:
                volume = int(row.get("volume", 0) or 0)
            except (TypeError, ValueError):
                volume = 0
            out.append({"time": time_str, "open": round(o, 2), "high": round(h, 2),
                        "low": round(lo, 2), "close": round(c, 2), "volume": volume})
    except Exception:
        return []
    return out


def _ema_block(bars: list[dict]) -> list[dict]:
    """EMA9 / EMA20 aligned to ``bars`` (empty when the helper is unavailable)."""
    fn = ema_series
    if fn is None or not bars:
        return []
    vals: list[Optional[float]] = []
    for bar in bars:
        try:
            vals.append(float((bar or {}).get("close")))
        except (TypeError, ValueError):
            vals.append(None)
    try:
        return [
            {"period": 9, "data": fn(vals, 9)},
            {"period": 20, "data": fn(vals, 20)},
        ]
    except Exception:
        return []


def _ohlc_from_bars(bars: list[dict], spot: float) -> dict:
    """Session OHLC from the bars; a flat spot line when there are none."""
    if not bars:
        return {"open": spot, "high": spot, "low": spot, "close": spot}
    try:
        return {
            "open": bars[0]["open"],
            "high": max(b["high"] for b in bars),
            "low": min(b["low"] for b in bars),
            "close": bars[-1]["close"],
        }
    except Exception:
        return {"open": spot, "high": spot, "low": spot, "close": spot}


async def _fetch_bars(symbol: str) -> list[dict]:
    """1-minute bars for ``symbol`` (rate-limited, blocking call in a thread).

    Time-boxed: the candle fetch is the slow part (~20 s cold for a stock), and
    a slow fetch must not cost the minute's tape row. On timeout/failure the
    bars degrade to ``[]`` (flat spot OHLC) and the cache retries 120 s later.
    """
    fn = fetch_candles_for_timeframe
    if fn is None:
        try:  # pragma: no cover - import guard path
            from market_data.market_data import fetch_candles_for_timeframe as fn
        except Exception:
            return []
    if not await _acquire_upstream():
        return []
    try:
        df = await asyncio.wait_for(
            asyncio.to_thread(fn, symbol, "1m",
                              lookback_bars=INTRADAY_LOOKBACK_BARS),
            timeout=CANDLE_TIMEOUT_SEC,
        )
    except TypeError:
        # A test double / older signature without keyword-only lookback.
        try:
            df = await asyncio.wait_for(
                asyncio.to_thread(fn, symbol, "1m", INTRADAY_LOOKBACK_BARS),
                timeout=CANDLE_TIMEOUT_SEC,
            )
        except Exception:
            return []
    except asyncio.CancelledError:
        raise
    except Exception:
        return []
    return _bars_to_intraday(df)


async def _intraday_block(symbol: str, spot: float) -> dict:
    """``{bars, emas, ohlc}`` cached for ``INTRADAY_TTL_SEC`` (120 s).

    A failed fetch is cached too (with ``[]``) so the 10 s loop cannot hammer
    the candle endpoint; the next window retries.
    """
    now = time.monotonic()
    entry = _intraday_cache.get(symbol)
    if entry is None or now - entry["ts"] >= INTRADAY_TTL_SEC:
        bars = await _fetch_bars(symbol)
        entry = {"ts": now, "bars": bars, "emas": _ema_block(bars)}
        _intraday_cache[symbol] = entry
    bars = entry.get("bars") or []
    return {
        "bars": bars,
        "emas": entry.get("emas") or [],
        "ohlc": _ohlc_from_bars(bars, spot),
    }


# --------------------------------------------------------------------------- #
# report assembly
# --------------------------------------------------------------------------- #
def _nifty():
    """The NIFTY module — pure helpers are reused verbatim (lazy, cycle-free)."""
    from api.reports_api import nifty

    return nifty


def _build_strikes(chain: list[dict]) -> list[dict]:
    """``api.reports_api.options_report.build_strikes`` with a local fallback."""
    try:
        from api.reports_api.options_report import build_strikes

        return build_strikes(chain)
    except Exception:
        pass
    rows: list[dict] = []
    for row in chain or []:
        try:
            strike = float((row or {}).get("strike") or 0)
        except (TypeError, ValueError):
            continue
        if strike <= 0:
            continue
        rows.append({"strike": strike, "ce": _side(row.get("ce")),
                     "pe": _side(row.get("pe"))})
    rows.sort(key=lambda r: r["strike"])
    return rows


def _side(contract: Optional[dict]) -> dict:
    """Minimal ``{ltp, oi, volume}`` leg when options_report is unavailable."""
    md = (contract or {}).get("market_data") or {}
    greeks = (contract or {}).get("option_greeks") or {}

    return {
        "ltp": safe_float(md.get("ltp")),
        "close": safe_float(md.get("close_price")),
        "oi": safe_int(md.get("oi")),
        "prevOi": safe_int(md.get("prev_oi")),
        "oiChange": 0,
        "priceChange": 0.0,
        "sentiment": "Neutral",
        "volume": safe_int(md.get("volume")),
        "delta": greeks.get("delta"),
        "gamma": greeks.get("gamma"),
        "theta": greeks.get("theta"),
        "vega": greeks.get("vega"),
        "iv": greeks.get("iv"),
    }


def build_base_report(symbol: str, expiry: str, spot: float,
                      strikes: list[dict], lot: int) -> dict:
    """The ``/live`` report envelope for a generic underlying.

    ``nifty.build_report`` gives the shared shape (PCR / max pain / walls /
    strikes); GEX and positioning are then recomputed with **this contract's**
    lot, ``walls_near`` uses a ±1% spot band instead of NIFTY's fixed ±300,
    and ``underlying`` / ``date`` are stamped on the report.
    """
    nifty = _nifty()
    base = nifty.build_report(expiry, spot, strikes, "live")
    base["gex"] = nifty.compute_gex(strikes, spot, lot)
    try:
        from api.reports_api.nifty_positioning import compute_positioning

        base["positioning"] = compute_positioning(strikes, spot, lot)
    except Exception:
        try:
            base["positioning"] = nifty.compute_positioning(strikes, spot, lot)
        except Exception:
            base["positioning"] = None
    band = max(abs(float(spot or 0)) * NEAR_BAND_PCT, 1.0)
    base["walls_near"] = {
        "calls": nifty.near_walls(strikes, "ce", spot=spot, max_dist=band),
        "puts": nifty.near_walls(strikes, "pe", spot=spot, max_dist=band),
    }
    base["underlying"] = symbol
    base["date"] = _today_str()
    # The history agent sizes a burst plan on the real contract lot; without
    # this it can only fall back to NIFTY's 65 ("lot_size_verified: false").
    base["lot_size"] = int(lot)
    base["source"] = "upstox-option-chain"
    base["intraday"] = []
    base["emas"] = []
    base["ohlc"] = {"open": spot, "high": spot, "low": spot, "close": spot}
    return base


# --------------------------------------------------------------------------- #
# tape row (copied from nifty._write_tape_row, generic paths, no NIFTY writes)
# --------------------------------------------------------------------------- #
def _build_tape_row(symbol: str, report: dict, spot: float, t_iso: str) -> dict:
    """One tape row — the NIFTY field set plus ``underlying``.

    ``spot`` is the already-reconciled value (see :func:`_write_minute`), so the
    ATM/wall/chain snapshots all derive from one trustworthy print.
    """
    nifty = _nifty()
    safe_int = nifty._safe_int
    safe_float = nifty._safe_float
    strikes = report.get("strikes") or []
    gex = report.get("gex") or {}

    ce_oi = sum(safe_int((r.get("ce") or {}).get("oi")) for r in strikes)
    pe_oi = sum(safe_int((r.get("pe") or {}).get("oi")) for r in strikes)
    ce_vol = sum(safe_int((r.get("ce") or {}).get("volume")) for r in strikes)
    pe_vol = sum(safe_int((r.get("pe") or {}).get("volume")) for r in strikes)

    atm_strike, atm_ce_ltp, atm_pe_ltp = nifty._atm_premium_snapshot(strikes, spot)
    try:
        fn = atm_ivs
        if fn is None:
            from api.reports_api.nifty_verdicts import atm_ivs as fn
        atm_ce_iv, atm_pe_iv = fn(strikes, spot)
    except Exception:
        atm_ce_iv, atm_pe_iv = None, None

    row = {
        "t": t_iso,
        "spot": spot,
        "ce_oi": ce_oi,
        "pe_oi": pe_oi,
        "ce_vol": ce_vol,
        "pe_vol": pe_vol,
        "pcr_oi": safe_float(report.get("pcr_oi")),
        "pcr_vol": safe_float(report.get("pcr_vol")),
        "max_pain": safe_float(report.get("max_pain")),
        # The live report prefers Upstox's OFFICIAL max pain; store the
        # computed value beside it so "did price pin to max pain" studies never
        # mix two definitions (mirrors the NIFTY tape).
        "max_pain_computed": nifty.compute_max_pain([
            {"strike": safe_float(r.get("strike")) or 0.0,
             "ce_oi": safe_int((r.get("ce") or {}).get("oi")),
             "pe_oi": safe_int((r.get("pe") or {}).get("oi"))}
            for r in strikes
        ]) if strikes else None,
        # A degraded GEX block is an OI proxy, not a gamma profile: its flip /
        # net_gex are artefacts and are not written into the day's log.
        "flip": None if gex.get("degraded") else gex.get("zero_cross"),
        "net_gex": None if gex.get("degraded") else gex.get("net_total"),
        "gex_degraded": bool(gex.get("degraded")),
        # NEAR walls: the wall-migration/squeeze detectors compare the wall
        # strike minute-to-minute, so an unrestricted ranking would "migrate"
        # whenever a far mega-wall outranks the near one.
        "walls": report.get("walls_near") or report.get("walls")
                 or {"calls": [], "puts": []},
        "expiry": report.get("expiry", ""),
        "atm_strike": atm_strike,
        "atm_ce_ltp": atm_ce_ltp,
        "atm_pe_ltp": atm_pe_ltp,
        "atm_ce_iv": atm_ce_iv,
        "atm_pe_iv": atm_pe_iv,
        "strikes_top": nifty._strike_oi_snapshot(strikes, spot),
        "chain": nifty._premium_chain_snapshot(strikes, spot),
        "underlying": symbol,
    }
    return row


def _peek_last_tape(path: Path, minute: str) -> tuple[Optional[float], bool]:
    """``(last row's spot, last row shares this minute)`` — never raises."""
    last = _tail_last_json_line(path)
    if not last:
        return None, False
    try:
        last_spot = float(last.get("spot") or 0) or None
    except (TypeError, ValueError):
        last_spot = None
    return last_spot, str(last.get("t", ""))[:16] == minute


async def _write_minute(symbol: str, report: dict, date_str: str,
                        t_iso: str) -> Optional[dict]:
    """Write the tape row + replay frame for one IST minute, once.

    The 10 s chain fetch is reused: no second upstream call. Returns the tape
    row on success, ``None`` when the minute was already recorded (or the spot
    was rejected). Never raises past the caller's journal.
    """
    nifty = _nifty()
    path = tape_path(symbol, date_str)
    minute = str(t_iso)[:16]
    last_spot, same_minute = await asyncio.to_thread(_peek_last_tape, path, minute)
    if same_minute:
        _sym_state(symbol)["last_skip"] = "same-minute"
        return None

    spot_chain = nifty._safe_float(report.get("spot"))
    index_spot: Optional[float] = None
    # Cross-check the chain spot only when it is worth confirming (a normal
    # tick, or the day's first row, costs no extra network call).
    if last_spot and (spot_chain <= 0
                      or abs(spot_chain - last_spot) / last_spot > nifty.SPOT_CHAIN_DEV_MAX):
        try:
            from api.options import get_spot_price

            if await _acquire_upstream():
                index_spot = (await get_spot_price(symbol)).get("spot")
        except Exception:
            index_spot = None
    spot = nifty.reconcile_spot(spot_chain, index_spot, last_spot)
    if spot is None:
        _sym_state(symbol)["last_skip"] = "spot-rejected"
        _append_gap(symbol, date_str, t_iso, "spot-rejected")
        return None

    strikes = report.get("strikes") or []
    if not nifty.has_usable_chain(strikes):
        _sym_state(symbol)["last_skip"] = "empty-chain"
        _append_gap(symbol, date_str, t_iso, "empty-chain")
        return None

    row = _build_tape_row(symbol, report, spot, t_iso)
    await asyncio.to_thread(_append_jsonl, path, row)

    frame = {
        "t": t_iso,
        "fetched_at": report.get("fetched_at"),
        "report": report,
        "sensex": None,
    }
    await asyncio.to_thread(_append_jsonl, snapshot_log_path(symbol, date_str), frame)
    await asyncio.to_thread(
        _write_json_atomic,
        snapshot_path(symbol, date_str),
        {**report, "mode": "snapshot", "date": date_str,
         "snapshot_at": t_iso, "source": "upstox-option-chain"},
    )

    state = _sym_state(symbol)
    state["tape"] += 1
    state["snapshots"] += 1
    return row


# --------------------------------------------------------------------------- #
# one tick
# --------------------------------------------------------------------------- #
async def _record_symbol(symbol: str, ts: datetime) -> Optional[dict]:
    """Record one symbol at ``ts`` (chain10s always; tape/frame per minute).

    Raises only on programming errors — upstream failures are journalled and
    return ``None`` so the other symbols still record.
    """
    nifty = _nifty()
    t_iso = ts.isoformat()
    date_str = t_iso[:10]
    state = _sym_state(symbol)
    state["last_tick"] = t_iso

    expiry = await _nearest_expiry(symbol)
    if not expiry:
        state["last_skip"] = "no-expiry"
        state["last_error"] = "no expiry listed"
        _append_gap(symbol, date_str, t_iso, "no-expiry")
        return None

    if not await _acquire_upstream():
        state["last_skip"] = "rate-limited"
        state["last_error"] = "rate budget exhausted"
        _append_gap(symbol, date_str, t_iso, "rate-limited")
        return None

    resp = await _fetch_chain(symbol, expiry)
    chain = (resp or {}).get("chain") or []
    strikes = _build_strikes(chain)
    if not strikes:
        state["last_skip"] = "empty-chain"
        state["last_error"] = "empty option chain"
        _append_gap(symbol, date_str, t_iso, "empty-chain")
        return None

    try:
        spot = float((resp or {}).get("spot") or 0)
    except (TypeError, ValueError):
        spot = 0.0

    lot = await asyncio.to_thread(lot_size, symbol, chain)
    base = build_base_report(symbol, expiry, spot, strikes, lot)

    # 1. chain10s — every 10 s, slim rows (same shape as the NIFTY chain10s).
    try:
        from api.reports_api.chain10s import slim_rows

        slim = slim_rows(strikes, spot, _window_for(spot))
    except Exception:
        slim = []
    if slim:
        line = {"t": t_iso, "spot": round(float(spot), 2),
                "expiry": expiry, "rows": slim}
        await asyncio.to_thread(
            _append_jsonl, chain10s_path(symbol, date_str), line)
        state["chain10s"] += 1
        _status["records"] = int(_status.get("records") or 0) + 1

    LAST[symbol] = base
    state["last_skip"] = None
    state["last_error"] = None

    # 2. per-minute tape row + replay frame derived from the SAME report.
    minute = t_iso[:16]
    if _minute_for(symbol) != minute:
        if not nifty.has_usable_chain(strikes):
            _append_gap(symbol, date_str, t_iso, "empty-chain")
            return None
        intraday = await _intraday_block(symbol, spot)
        base["intraday"] = intraday["bars"]
        base["emas"] = intraday["emas"]
        base["ohlc"] = intraday["ohlc"]
        # EOD analytics: the replay report must carry the same session blocks
        # the live report serves (vix/control/regime/strength/pivots/
        # reference/structure/market/timeline). _attach_analytics is
        # once-per-minute here; its daily + VIX inputs are cached and the tape
        # read is local, so this stays inside the options rate budget.
        try:
            from api.reports_api.options_report import (
                _attach_analytics as _enrich_report,
            )

            await _enrich_report(symbol, base, intraday["bars"] or [])
        except Exception:
            pass
        row = await _write_minute(symbol, base, date_str, t_iso)
        if row is not None:
            _set_minute(symbol, minute)
            return row
    return None


#: Last minute already considered per symbol (in-process minute gate).
_LAST_MINUTE: dict[str, str] = {}


def _minute_for(symbol: str) -> Optional[str]:
    return _LAST_MINUTE.get(symbol)


def _set_minute(symbol: str, minute: str) -> None:
    _LAST_MINUTE[symbol] = minute


async def record_tick(now: Optional[datetime] = None) -> dict:
    """One recorder tick over every configured symbol. Never raises.

    Returns ``{"t", "symbols": {SYM: "ok"|reason}, "records": int}`` — the
    per-symbol reason is useful for the status endpoint and for tests.
    """
    ts = now or datetime.now(config.IST)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=config.IST)
    outcome: dict[str, str] = {}
    for symbol in symbols():
        try:
            row = await asyncio.wait_for(
                _record_symbol(symbol, ts), timeout=SYMBOL_TIMEOUT_SEC)
            outcome[symbol] = "ok" if row is not None or LAST.get(symbol) else "skipped"
        except asyncio.TimeoutError:
            outcome[symbol] = "timeout"
            _sym_state(symbol)["last_error"] = (
                f"tick timed out after {SYMBOL_TIMEOUT_SEC:.0f}s")
            _append_gap(symbol, ts.isoformat()[:10], ts.isoformat(), "timeout")
            logger.warning("options recorder: %s tick timed out after %.0fs",
                           symbol, SYMBOL_TIMEOUT_SEC)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            outcome[symbol] = type(exc).__name__
            _sym_state(symbol)["last_error"] = _err_detail(exc)
            _append_gap(symbol, ts.isoformat()[:10], ts.isoformat(),
                        "tick-failed", _err_detail(exc))
            logger.warning("options recorder: %s tick failed (%s): %s",
                           symbol, type(exc).__name__, exc)
    _status["iterations"] = int(_status.get("iterations") or 0) + 1
    _status["last_tick"] = ts.isoformat()
    errors = [s.get("last_error") for s in _per_symbol.values() if s.get("last_error")]
    _status["last_error"] = errors[0] if errors else None
    return {"t": ts.isoformat(), "symbols": outcome,
            "records": int(_status.get("records") or 0)}


# --------------------------------------------------------------------------- #
# background loop
# --------------------------------------------------------------------------- #
async def _tick(interval_sec: float) -> dict:
    """One tick with timeout/error handling; a failure is a missing minute."""
    try:
        return await asyncio.wait_for(
            record_tick(),
            timeout=max(5.0, min(float(interval_sec) * 3.0, 30.0)),
        )
    except asyncio.TimeoutError:
        stamp, gdate = _tick_stamp()
        _status["last_error"] = "tick timed out"
        for symbol in symbols():
            _append_gap(symbol, gdate, stamp, "timeout")
        logger.warning("options recorder: tick timed out")
        return {}
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        _status["last_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        logger.warning("options recorder: tick raised %s: %s",
                       type(exc).__name__, exc)
        return {}


async def _recorder_loop(interval_sec: float) -> None:
    """Wall-clock ``interval_sec`` loop; sleeps 60 s while the market is closed."""
    global _task, _loop, _failure_streak
    current = asyncio.current_task()
    if _task is not None and _task is not current and not _task.done():
        # Another recorder already owns the files — this is a duplicate.
        return
    _task = current
    _loop = asyncio.get_running_loop()
    loop = _loop
    _status["interval_sec"] = float(interval_sec)
    next_tick = loop.time()  # initial tick immediately
    while True:
        try:
            if _market_open():
                await _tick(interval_sec)
                if _status.get("last_error"):
                    _failure_streak += 1
                    if _failure_streak == 1 or _failure_streak % 5 == 0:
                        logger.warning(
                            "options recorder: %d consecutive failed ticks (last: %s)",
                            _failure_streak, _status.get("last_error"))
                else:
                    if _failure_streak:
                        logger.warning(
                            "options recorder: recovered after %d failed ticks",
                            _failure_streak)
                    _failure_streak = 0
                next_tick = _advance_next_tick(next_tick, interval_sec,
                                               loop.time())
                await asyncio.sleep(max(0.0, next_tick - loop.time()))
            else:
                # Never burst-catch-up on the first open tick.
                next_tick = loop.time() + interval_sec
                await asyncio.sleep(MARKET_CLOSED_SLEEP_SEC)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("options recorder: loop error (%s) — retrying",
                             type(exc).__name__)
            if not _status.get("last_error"):
                _status["last_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            next_tick = loop.time() + interval_sec
            await asyncio.sleep(interval_sec)


async def start_options_recorder_task(interval_sec: Optional[float] = None) -> None:
    """Start the single recorder loop (initial tick immediately, then wall clock).

    Started from the FastAPI lifespan. Only ONE instance owns the files; a
    second call returns immediately. A fatal error is loud and re-arms after a
    short delay so the recorder cannot stay blind.
    """
    if not ENABLED:
        logger.info("options recorder: disabled (OPTIONS_RECORDER_ENABLED=0)")
        return
    try:
        await _recorder_loop(float(interval_sec or INTERVAL_SEC))
    except asyncio.CancelledError:
        logger.info("options recorder: cancelled — stopping")
        raise
    except BaseException:
        logger.exception("options recorder: died — restarting in 5s")
        loop = _loop
        if loop is not None and not loop.is_closed():
            try:
                loop.call_later(
                    5.0,
                    lambda: asyncio.ensure_future(
                        start_options_recorder_task(interval_sec)),
                )
            except RuntimeError:
                pass
        raise


# --------------------------------------------------------------------------- #
# status endpoint (the history agent may also read ``status()`` directly)
# --------------------------------------------------------------------------- #
@router.get("/recorder/status")
async def get_recorder_status() -> dict:
    """Recorder heartbeat: symbols, last tick, records written, per-symbol counts."""
    return status()
