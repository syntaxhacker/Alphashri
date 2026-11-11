"""Generic live option-chain report for ANY F&O underlying.

Endpoint:
  - ``GET /api/reports/options/{underlying}/live?expiry=YYYY-MM-DD&candles=0``
    — a live report built from the Upstox option chain for ``SENSEX``,
    ``RELIANCE`` or any other F&O underlying (index or stock). ``candles`` is
    opt-in: the 1-minute bar fetch dominates a cold report (~20 s for
    RELIANCE), so the default chain-only path never calls it and serves the
    flat-spot OHLC; ``candles=1`` fetches once and caches the bars for 120 s
    under ``(underlying, "1m")``.

Design constraints (see ``docs/options-report-symbols.md``):

- **Additive.** Nothing here imports or writes the NIFTY recorder: no
  ``_compute_live`` / ``get_cached_live`` / ``_live_cache`` / ``_live_ws_cache``,
  no NIFTY tape/snapshot/chain10s calls, no writes under ``nifty_*``
  directories, no new background task. The only tape it reads is the generic
  ``experiments/data/options_tape/{SYMBOL}/`` recorder output.
- **Own cache namespace.** ``_chain_cache[(underlying, expiry)]`` with a 30 s
  TTL — NIFTY's cache is keyed by expiry alone, so sharing it would let a stock
  frame overwrite NIFTY's.
- **Single-flight + budget.** One ``asyncio.Lock`` per underlying (10 calls in
  the TTL window = one upstream chain fetch), a global ``Semaphore(4)`` so a
  fan-out cannot open 20 chains at once, and every upstream call acquires a
  token from ``upstox_trader.rate_limiter`` under the ``api`` consumer slice
  (150/min). The distinct-symbol cache is capped at
  :data:`CACHE_MAX_SYMBOLS` (≈15) so a selector sweep cannot grow unbounded.
- **Symbol-owned analytics, not NIFTY's.** GEX / positioning / pivots / baseline
  / ATM reference / verdicts / structure are all computed from the *symbol's own*
  chain, daily candles and tape. The India VIX read is market-wide by definition
  and is explicitly labelled ``vix["source"] == "INDIA_VIX"``. Nothing is read
  from ``nifty_tape`` / ``nifty_snapshots`` / ``NIFTY_PIVOT_KEY``.

Payload shape: identical to what the frontend ``normalizeReport``
(``src/types/niftyReport.ts``) consumes — ``mode/date/expiry/spot/ohlc``,
snake_case ratios (``pcr_oi``/``pcr_vol``/``max_pain``), ``walls`` /
``walls_near``, and per-strike ``ce``/``pe`` sides. Additive analytics:
``gex`` / ``positioning`` / ``lot_size`` (chain-derived), ``pivots`` /
``baseline_range_pct`` / ``reference`` / ``structure`` / ``control`` /
``regime`` / ``vix`` / ``strength`` / ``market`` / ``timeline`` /
``intraday`` / ``emas`` (session-derived), each from the symbol's own data.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import statistics
import time
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

import config
from api.options import (
    AVAILABLE_UNDERLYINGS,
    get_expiries,
    get_option_chain,
    get_option_sentiment,
)

try:  # pragma: no cover - import guard only (pandas/upstox client availability)
    from market_data.market_data import fetch_candles_for_timeframe
except Exception:  # pragma: no cover
    fetch_candles_for_timeframe = None  # type: ignore[assignment]

router = APIRouter(prefix="/api/reports/options", tags=["options-report"])

logger = logging.getLogger(__name__)

#: Non-NIFTY symbols move slower than an index and share the 150/min ``api``
#: Upstox slice with the rest of the desk. 30 s is the audited floor.
CACHE_TTL_SEC = 30.0
#: ``(SYMBOL, expiry) -> {"ts": float, "data": dict}`` — never NIFTY's cache.
_chain_cache: dict[tuple[str, str], dict] = {}
#: Distinct symbols kept at once (the audit's ~15 ceiling).
CACHE_MAX_SYMBOLS = 15

#: 1-minute bars are the slow part of a report (Upstox historical+intraday for
#: 120 bars took ~20 s cold for RELIANCE), so they are opt-in AND cached on
#: their own key/TTL — a ``candles=1`` call must never make the chain wait,
#: and a second ``candles=1`` call inside 120 s is served from memory.
INTRADAY_TTL_SEC = 120.0
#: ``(SYMBOL, "1m") -> {"ts": float, "data": list[dict]}``.
_intraday_cache: dict[tuple[str, str], dict] = {}

#: Upstream concurrency ceiling — 20 users must not open 20 chains at once.
FETCH_CONCURRENCY = 4
#: Seconds a request waits for a rate-limiter token before answering 429.
RATE_ACQUIRE_TIMEOUT_SEC = 2.0

#: Heaviest OI strikes shown per side.
_TOP_WALLS = 3
#: ``walls_near`` band as a fraction of spot (1%): 240 pts on NIFTY, 850 on
#: SENSEX, 14 on RELIANCE — a fixed 300 pts would cover a stock's whole chain.
_NEAR_BAND_PCT = 0.01

#: Daily bars for pivots/baseline. One fetch per symbol per session — the
#: previous completed session never changes inside a day.
#: (Window: :data:`DAILY_LOOKBACK_DAYS`.)
#: Sessions used for the median daily-range baseline (the symbol's own).
BASELINE_SESSIONS = 20
#: A failed daily fetch is retried after this long rather than once per request.
DAILY_MISS_TTL_SEC = 60.0
#: Daily-candle attempts before a miss is cached. The Upstox daily leg
#: intermittently returns no rows (observed as a single blip right after the
#: close); a single-shot fetch turned that blip into ``pivots: None`` (and no
#: regime baseline) for every replay/snapshot load until the 60 s miss expired.
#: Retries only run on the failure path — a healthy fetch still costs one
#: upstream call and the result stays cached per session.
DAILY_FETCH_ATTEMPTS = 3
#: Calendar-day window for the direct daily fetch. 30 one-day bars need room
#: for weekends/holidays; the previous session and the 20-session baseline
#: are both computed from the returned frame.
DAILY_LOOKBACK_DAYS = 65
#: Seconds between daily-candle attempts. Upstox daily failures arrive in
#: multi-second waves (a burst of empties/400s, healthy again seconds later),
#: so back-to-back retries land inside the same wave and all fail. Spacing
#: attempts outlasts a short wave; the per-session cache means a healthy fetch
#: never pays this cost.
DAILY_FETCH_RETRY_SLEEP_SEC = 2.0
#: Upper bound for one daily-candle attempt. Without it a hung Upstox call
#: hangs the enclosing live/replay/snapshot request (and the recorder tick)
#: indefinitely; a timeout counts as a failed attempt and retries.
DAILY_FETCH_TIMEOUT_SEC = 20.0
#: ``(SYMBOL) -> {"date", "ts", "ctx"}`` — symbol-scoped, never NIFTY's pivot cache.
_daily_cache: dict[str, dict] = {}

#: Generic recorder tape: ``experiments/data/options_tape/{SYMBOL}/{date}.jsonl``.
#: Deliberately NOT ``nifty_tape`` — a RELIANCE frame must never read NIFTY rows.
TAPE_ROOT = Path(__file__).resolve().parent.parent.parent / "experiments" / "data" / "options_tape"
_SAFE_SYMBOL_RE = re.compile(r"[^A-Z0-9_.-]+")

#: ``trading_symbol``/``asset_symbol`` -> lot size from the NSE_FO contracts.
#: Lazy, 1h TTL (instrument files only change when the exchange rolls a lot).
_FO_LOTS: dict = {"ts": 0.0, "by_key": {}, "by_symbol": {}}


# --------------------------------------------------------------------------- #
# per-event-loop asyncio state
# --------------------------------------------------------------------------- #
class _LoopState:
    """Semaphore + per-underlying locks bound to one event loop."""

    __slots__ = ("loop", "sem", "locks")

    def __init__(self, loop: Any) -> None:
        self.loop = loop
        self.sem = asyncio.Semaphore(FETCH_CONCURRENCY)
        self.locks: dict[str, asyncio.Lock] = {}


#: ``asyncio`` primitives bind to the first loop that makes them *wait*
#: (``_LoopBoundMixin``), and this module is imported once per process while
#: uvicorn reloads / tests create fresh loops. Keying state by the running loop
#: keeps it correct instead of raising "bound to a different event loop".
_STATES: dict[int, _LoopState] = {}


def _state() -> _LoopState:
    loop = asyncio.get_running_loop()
    state = _STATES.get(id(loop))
    if state is None or state.loop is not loop:
        for key, stale in list(_STATES.items()):
            if stale.loop.is_closed():
                _STATES.pop(key, None)
        state = _LoopState(loop)
        _STATES[id(loop)] = state
    return state


def _symbol_lock(symbol: str) -> asyncio.Lock:
    state = _state()
    lock = state.locks.get(symbol)
    if lock is None:
        lock = asyncio.Lock()
        state.locks[symbol] = lock
    return lock


# --------------------------------------------------------------------------- #
# Upstox budget (consumer "api")
# --------------------------------------------------------------------------- #
_RATE_LIMITER: Any = None
_RATE_LIMITER_READY = False


def _rate_limiter() -> Any:
    """Lazy singleton ``UpstoxRateLimiter(consumer="options")`` (None if absent)."""
    global _RATE_LIMITER, _RATE_LIMITER_READY
    if not _RATE_LIMITER_READY:
        _RATE_LIMITER_READY = True
        try:
            from upstox_trader.rate_limiter import UpstoxRateLimiter

            _RATE_LIMITER = UpstoxRateLimiter(consumer="options")
        except Exception:
            _RATE_LIMITER = None
    return _RATE_LIMITER


async def _acquire_upstream() -> bool:
    """Take one token from the shared ``api`` slice.

    ``acquire`` blocks on a Redis sliding window, so it runs in a thread.
    Fail-open when the limiter (or Redis) is unavailable — the caller's
    semaphore still bounds concurrency, and a hard failure here would take the
    report down for an infrastructure reason.
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
# small coercion helpers (upstream sends None / strings / NaN)
# --------------------------------------------------------------------------- #
def _num(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or isinstance(value, bool):
            return default
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if out == out and out not in (float("inf"), float("-inf")) else default


def _opt_num(value: Any) -> Optional[float]:
    """``float`` or ``None`` — for greeks, where 0 is not "missing"."""
    try:
        if value is None or isinstance(value, bool):
            return None
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out and out not in (float("inf"), float("-inf")) else None


def _int(value: Any, default: int = 0) -> int:
    return int(round(_num(value, float(default))))


def _validate_expiry(expiry: str) -> str:
    """Canonical ``YYYY-MM-DD`` or a 400 — mirrors ``api.options``."""
    text = str(expiry or "").strip()
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"bad expiry: {expiry!r}, want YYYY-MM-DD")
    return parsed.strftime("%Y-%m-%d")


# --------------------------------------------------------------------------- #
# pure shaping (unit-tested without HTTP)
# --------------------------------------------------------------------------- #
def build_side(contract: Optional[dict]) -> dict:
    """Flatten one chain leg into the frontend ``NiftyOptionSide`` shape.

    ``get_option_chain`` already hands back ``market_data`` + ``option_greeks``
    (``api.options.transform_option_contract``); missing legs become zeros so
    the table keeps its row alignment instead of dropping a strike.
    """
    contract = contract or {}
    md = contract.get("market_data") or {}
    greeks = contract.get("option_greeks") or {}

    ltp = _num(md.get("ltp"))
    close = _num(md.get("close_price"), ltp)
    oi = _int(md.get("oi"))
    prev_oi = _int(md.get("prev_oi"))
    oi_change = oi - prev_oi
    price_change = round(ltp - close, 2)

    return {
        "ltp": ltp,
        "close": close,
        "oi": oi,
        "prevOi": prev_oi,
        "oiChange": oi_change,
        # Snake-case aliases consumed by the shared analytics blocks
        # (``nifty_verdicts.compute_control`` / ``nifty_positioning``), which
        # were written against the NIFTY chain shape. Kept additive so the
        # frontend contract (camelCase) is unchanged.
        "prev_oi": prev_oi,
        "oi_change": oi_change,
        "priceChange": price_change,
        # Human label ("Long Buildup", "Neutral", ...) — ``NiftyOptionSide``
        # types this as a string; the Nifty live payload ships the raw dict.
        "sentiment": get_option_sentiment(price_change, oi_change).get("type", "Neutral"),
        "volume": _int(md.get("volume")),
        "delta": _opt_num(greeks.get("delta")),
        "gamma": _opt_num(greeks.get("gamma")),
        "theta": _opt_num(greeks.get("theta")),
        "vega": _opt_num(greeks.get("vega")),
        "iv": _opt_num(greeks.get("iv")),
    }


def build_strikes(chain: list[dict]) -> list[dict]:
    """Map ``get_option_chain`` rows to ``[{strike, ce, pe}]``, sorted."""
    rows = []
    for row in chain or []:
        strike = _num((row or {}).get("strike"))
        if strike <= 0:
            continue
        rows.append({
            "strike": strike,
            "ce": build_side(row.get("ce")),
            "pe": build_side(row.get("pe")),
        })
    rows.sort(key=lambda r: r["strike"])
    return rows


def top_walls(strikes: list[dict], side: str, spot: float, n: int = _TOP_WALLS) -> list[dict]:
    """Top-``n`` strikes by OI for ``'ce'``/``'pe'``, each with its distance."""
    ranked = sorted(strikes, key=lambda r: r[side]["oi"], reverse=True)
    out = []
    for row in ranked[:n]:
        entry = {"strike": row["strike"], "oi": row[side]["oi"]}
        if spot:
            entry["distance"] = round(row["strike"] - spot, 2)
        out.append(entry)
    return out


def near_walls(strikes: list[dict], side: str, spot: float, n: int = _TOP_WALLS) -> list[dict]:
    """Heaviest OI inside a spot-relative band; falls back to the full chain."""
    if not spot:
        return top_walls(strikes, side, spot, n)
    band = max(abs(spot) * _NEAR_BAND_PCT, 1e-9)
    pool = [r for r in strikes if abs(r["strike"] - spot) <= band]
    near = top_walls(pool, side, spot, n)
    return near or top_walls(strikes, side, spot, n)


def compute_pcr_vol(strikes: list[dict]) -> float:
    """PE volume / CE volume — 0 when there is no call volume."""
    ce_vol = sum(r["ce"]["volume"] for r in strikes)
    pe_vol = sum(r["pe"]["volume"] for r in strikes)
    if ce_vol <= 0:
        return 0.0
    return round(pe_vol / ce_vol, 2)


def compute_max_pain(strikes: list[dict]) -> float:
    """Max-pain strike (total writer payout minimised) over the chain."""
    if not strikes:
        return 0.0
    best_strike = strikes[0]["strike"]
    best_loss: Optional[float] = None
    for cand in strikes:
        cand_strike = cand["strike"]
        loss = 0.0
        for row in strikes:
            strike = row["strike"]
            if cand_strike > strike:
                loss += (cand_strike - strike) * row["ce"]["oi"]
            elif cand_strike < strike:
                loss += (strike - cand_strike) * row["pe"]["oi"]
        if best_loss is None or loss < best_loss:
            best_loss = loss
            best_strike = cand_strike
    return float(best_strike)


def candles_to_intraday(df: Any) -> list[dict]:
    """DataFrame (UTC index, ohlcv) -> ``[{time, open, high, low, close, volume}]``.

    Keys are the ones ``normalizeIntraday`` reads; ``volume`` is additive.
    Rows that cannot be parsed are skipped, never fatal.
    """
    out: list[dict] = []
    if df is None or getattr(df, "empty", True):
        return out
    for ts, row in df.iterrows():
        try:
            o = float(row["open"])
            h = float(row["high"])
            lo = float(row["low"])
            c = float(row["close"])
        except (KeyError, TypeError, ValueError):
            continue
        if not all(v == v for v in (o, h, lo, c)):  # NaN guard
            continue
        stamp = ts
        try:
            if getattr(stamp, "tzinfo", None) is not None:
                stamp = stamp.tz_convert(config.IST)
        except Exception:
            pass
        try:
            time_str = stamp.isoformat()
        except Exception:
            time_str = str(stamp)
        out.append({
            "time": time_str,
            "open": round(o, 2),
            "high": round(h, 2),
            "low": round(lo, 2),
            "close": round(c, 2),
            "volume": _int(row.get("volume", 0)),
        })
    return out


def ohlc_from_intraday(intraday: list[dict], spot: float) -> dict:
    """Session OHLC from the bars; spot flat-line when there are none."""
    if not intraday:
        return {"open": spot, "high": spot, "low": spot, "close": spot}
    return {
        "open": intraday[0]["open"],
        "high": max(c["high"] for c in intraday),
        "low": min(c["low"] for c in intraday),
        "close": intraday[-1]["close"],
    }


# --------------------------------------------------------------------------- #
# lot size (index table first, then the symbol's own NSE_FO contract)
# --------------------------------------------------------------------------- #
def _fo_lots() -> dict:
    """``NSE_FO`` instrument-key / asset-symbol -> lot size (lazy, 1h TTL).

    A stock's lot comes from its own futures/options contract, never from
    NIFTY's 65. ``SET`` is read with a TTL so a process that outlives an
    exchange lot roll picks the new size up.
    """
    now = time.monotonic()
    if _FO_LOTS["by_symbol"] and now - _FO_LOTS["ts"] < 3600:
        return _FO_LOTS
    by_key: dict[str, int] = {}
    by_symbol: dict[str, int] = {}
    path = Path(__file__).resolve().parents[3] / "upstox_trader" / "config_and_utils" / "nse_instruments.json"
    try:
        if path.exists():
            with open(path) as fh:
                data = json.load(fh)
            for item in data:
                if item.get("segment") != "NSE_FO":
                    continue
                try:
                    lot = int(item.get("lot_size") or 0)
                except (TypeError, ValueError):
                    continue
                if lot <= 0:
                    continue
                key = item.get("instrument_key")
                if key:
                    by_key[str(key)] = lot
                for name in (item.get("asset_symbol"), item.get("underlying_symbol")):
                    if name:
                        by_symbol.setdefault(str(name).upper(), lot)
    except (OSError, json.JSONDecodeError, ValueError):
        pass
    _FO_LOTS.update(ts=now, by_key=by_key, by_symbol=by_symbol)
    return _FO_LOTS


def resolve_lot_size(symbol: str, chain: Optional[list[dict]] = None) -> int:
    """Contract lot size for ``symbol``; ``1`` when it cannot be resolved.

    Order: the ``AVAILABLE_UNDERLYINGS`` table (SENSEX 20, NIFTY 65, ...) →
    a chain contract's own ``instrument_key`` in the NSE_FO instrument file →
    the symbol's NSE_FO ``asset_symbol`` → ``1``. Never raises.
    """
    up = str(symbol or "").strip().upper()
    for entry in AVAILABLE_UNDERLYINGS:
        if str(entry.get("symbol", "")).upper() == up:
            try:
                return int(entry.get("lot_size") or 1)
            except (TypeError, ValueError):
                break
    try:
        lots = _fo_lots()
        for row in chain or []:
            for side in ("ce", "pe"):
                key = (row.get(side) or {}).get("instrument_key")
                if key and key in lots["by_key"]:
                    return int(lots["by_key"][key])
        return int(lots["by_symbol"].get(up) or 1)
    except Exception:
        return 1


# --------------------------------------------------------------------------- #
# daily candles -> pivots + baseline (symbol's own, never NIFTY's)
# --------------------------------------------------------------------------- #
def daily_rows_from_df(df: Any) -> list[list]:
    """Daily DataFrame -> raw Upstox candle rows ``[date, o, h, l, c, v, oi]``."""
    out: list[list] = []
    if df is None or getattr(df, "empty", True):
        return out
    for ts, row in df.iterrows():
        try:
            o = float(row["open"])
            h = float(row["high"])
            lo = float(row["low"])
            c = float(row["close"])
        except (KeyError, TypeError, ValueError):
            continue
        if not all(v == v for v in (o, h, lo, c)):  # NaN guard
            continue
        stamp = ts
        try:
            if getattr(stamp, "tzinfo", None) is not None:
                stamp = stamp.tz_convert(config.IST)
        except Exception:
            pass
        try:
            date_str = stamp.strftime("%Y-%m-%d")
        except Exception:
            date_str = str(stamp)[:10]
        out.append([date_str, o, h, lo, c, _num(row.get("volume", 0)), 0.0])
    out.sort(key=lambda r: r[0])
    return out


def compute_baseline_pct(candles: Optional[list], today: str,
                         sessions: int = BASELINE_SESSIONS) -> Optional[float]:
    """Median daily range as a % of close over the last ``sessions`` sessions.

    The symbol's OWN history — a RELIANCE report must not be judged against
    NIFTY's range. Rows for ``today`` are ignored (an incomplete session).
    """
    try:
        rows = [r for r in (candles or [])
                if isinstance(r, (list, tuple)) and len(r) >= 5
                and str(r[0])[:10] < today]
        rows = rows[-int(sessions):] if sessions else rows
        pcts: list[float] = []
        for r in rows:
            high, low, close = float(r[2]), float(r[3]), float(r[4])
            if close > 0 and high >= low > 0:
                pcts.append((high - low) / close * 100.0)
        if not pcts:
            return None
        return round(float(statistics.median(pcts)), 3)
    except (TypeError, ValueError, IndexError):
        return None


def compute_pivots(candles: Optional[list], today: str) -> Optional[dict]:
    """Previous-session classic pivots via the shared pure helper; never raises."""
    try:
        from api.reports_api.nifty import compute_pivots_from_candles

        return compute_pivots_from_candles(candles, today)
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# generic recorder tape (per symbol — never the NIFTY tape)
# --------------------------------------------------------------------------- #
def tape_path(symbol: str, date_str: str) -> Path:
    """``experiments/data/options_tape/{SYMBOL}/{date}.jsonl``."""
    safe = _SAFE_SYMBOL_RE.sub("", str(symbol or "").upper()) or "UNKNOWN"
    return TAPE_ROOT / safe / f"{date_str}.jsonl"


def read_tape(symbol: str, date_str: str) -> list[dict]:
    """Raw recorder rows for this symbol/day; ``[]`` when the file is absent.

    The recorder appends one JSON object per line. Blank/corrupt lines are
    skipped. This never falls back to ``nifty_tape``.
    """
    path = tape_path(symbol, date_str)
    if not path.exists():
        return []
    rows: list[dict] = []
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if isinstance(row, dict):
                    rows.append(row)
    except OSError:
        return []
    return rows


# --------------------------------------------------------------------------- #
# session block + timeline
# --------------------------------------------------------------------------- #
def market_block() -> dict:
    """``{is_open, session_date, as_of}`` in IST (same contract as NIFTY).

    Uses derivatives-open (09:15‑15:40) so the options report stays live
    through F&O close instead of stopping at cash-market close.
    """
    from trading.utils import is_derivatives_open

    now = datetime.now(config.IST)
    try:
        is_open = bool(is_derivatives_open())
    except Exception:
        is_open = False
    return {
        "is_open": is_open,
        "session_date": now.strftime("%Y-%m-%d"),
        "as_of": now.isoformat(),
    }


def build_timeline(report: dict, symbol: str) -> list[dict]:
    """NIFTY's timeline skeleton with the symbol substituted for "Nifty"."""
    try:
        from api.reports_api.nifty import build_timeline_skeleton

        events = build_timeline_skeleton(report)
    except Exception:
        return []
    out: list[dict] = []
    for event in events or []:
        if not isinstance(event, dict):
            continue
        row = dict(event)
        row["detail"] = str(row.get("detail", "")).replace("Nifty", symbol)
        out.append(row)
    return out


def build_emas(intraday: Optional[list[dict]]) -> list[dict]:
    """EMA9/EMA20 series aligned to the bar index, or ``[]`` without bars."""
    if not intraday:
        return []
    from api.reports_api.nifty_verdicts import ema_series

    closes: list = []
    for candle in intraday:
        value = (candle or {}).get("close")
        if value is None:
            closes.append(None)
            continue
        try:
            closes.append(float(value))
        except (TypeError, ValueError):
            closes.append(None)
    return [
        {"period": 9, "data": ema_series(closes, 9)},
        {"period": 20, "data": ema_series(closes, 20)},
    ]


# --------------------------------------------------------------------------- #
# cache (own namespace, 30 s, LRU-capped by symbol)
# --------------------------------------------------------------------------- #
def _cache_get(symbol: str, expiry: str, allow_stale: bool = False) -> Optional[dict]:
    entry = _chain_cache.get((symbol, expiry))
    if not entry:
        return None
    if not allow_stale and time.time() - entry["ts"] >= CACHE_TTL_SEC:
        return None
    return entry["data"]


def _cache_put(symbol: str, expiry: str, data: dict) -> None:
    _chain_cache[(symbol, expiry)] = {"ts": time.time(), "data": data}
    symbols = {key[0] for key in _chain_cache}
    if len(symbols) <= CACHE_MAX_SYMBOLS:
        return
    # Evict the least recently refreshed symbol (never the one just stored).
    victims = symbols - {symbol}
    if not victims:
        return
    oldest = min(
        victims,
        key=lambda s: max(v["ts"] for k, v in _chain_cache.items() if k[0] == s),
    )
    for key in [k for k in _chain_cache if k[0] == oldest]:
        _chain_cache.pop(key, None)


def clear_cache() -> None:
    """Drop every cached frame (tests / manual refresh)."""
    _chain_cache.clear()
    _intraday_cache.clear()
    _daily_cache.clear()


def _intraday_get(symbol: str, allow_stale: bool = False) -> Optional[list[dict]]:
    """Cached 1-minute bars for ``(symbol, "1m")``, or ``None`` when absent."""
    entry = _intraday_cache.get((symbol, "1m"))
    if not entry:
        return None
    if not allow_stale and time.time() - entry["ts"] >= INTRADAY_TTL_SEC:
        return None
    return entry["data"]


def _intraday_put(symbol: str, bars: list[dict]) -> None:
    # Never cache an empty result: a failed candle fetch should retry on the
    # next explicit ``candles=1`` request instead of pinning ``[]`` for 120 s.
    if not bars:
        return
    _intraday_cache[(symbol, "1m")] = {"ts": time.time(), "data": bars}
    symbols = {key[0] for key in _intraday_cache}
    if len(symbols) <= CACHE_MAX_SYMBOLS:
        return
    victims = symbols - {symbol}
    if not victims:
        return
    oldest = min(
        victims,
        key=lambda s: max(v["ts"] for k, v in _intraday_cache.items() if k[0] == s),
    )
    for key in [k for k in _intraday_cache if k[0] == oldest]:
        _intraday_cache.pop(key, None)


# --------------------------------------------------------------------------- #
# upstream fetches (semaphore + rate limiter gated)
# --------------------------------------------------------------------------- #
async def _fetch_intraday(symbol: str) -> list[dict]:
    """Fetch 1-minute bars (no cache read) — ``[]`` on any failure.

    ``fetch_candles_for_timeframe`` is blocking (pandas + REST), so it runs in
    a worker thread while holding one of the fetch slots. A failure here must
    never fail the report — SENSEX/BSE candles are the expected miss.
    """
    if fetch_candles_for_timeframe is None:
        return []
    try:
        async with _state().sem:
            if not await _acquire_upstream():
                return []
            df = await asyncio.to_thread(
                fetch_candles_for_timeframe, symbol, "1m", lookback_bars=120
            )
        return candles_to_intraday(df)
    except Exception:
        return []


async def get_intraday(symbol: str) -> list[dict]:
    """Opt-in 1-minute bars: cached 120 s, single-flighted per symbol.

    Uses its own lock key (``SYMBOL:1m``) so a cold candle fetch does not hold
    the chain lock — chain-only requests for the same symbol stay fast.
    """
    cached = _intraday_get(symbol)
    if cached is not None:
        return cached
    async with _symbol_lock(f"{symbol}:1m"):
        cached = _intraday_get(symbol)
        if cached is not None:
            return cached
        bars = await _fetch_intraday(symbol)
        _intraday_put(symbol, bars)
        return bars


def _resolve_daily_key(symbol: str) -> Optional[str]:
    """Instrument key for the direct daily fetch (local lookup only, no HTTP).

    Uses the shared client's resolver (static ``INDEX_KEYS`` + the local
    instrument file). Never raises — ``None`` when unresolvable. Kept separate
    so tests can assert the SENSEX/RELIANCE mapping without any network.
    """
    try:
        from market_data.market_data import get_api_client

        client = get_api_client()
        if client is None:
            return None
        return client.get_instrument_key(symbol)
    except Exception:
        return None


async def _fetch_daily_rows(symbol: str, today: str) -> list[list]:
    """Daily candle rows for ``symbol`` (no cache read) — ``[]`` on any failure.

    Same source NIFTY pivots use: the Upstox daily-candle endpoint called
    directly via async ``fetch_upstox`` (own whole-call bound, no shared
    worker pool, no Redis budget slice). Deliberately NOT
    ``market_data.fetch_candles_for_timeframe``: in the API process that path
    hung past 20 s and came back empty for SENSEX/RELIANCE while NIFTY's
    direct fetch stayed healthy.

    Rows are raw ``[timestamp, o, h, l, c, v, oi]`` lists (order irrelevant —
    ``compute_pivots_from_candles`` and ``compute_baseline_pct`` both select
    by date). An empty/exploding fetch is retried up to
    :data:`DAILY_FETCH_ATTEMPTS` times, spaced
    :data:`DAILY_FETCH_RETRY_SLEEP_SEC` apart, each attempt time-boxed by
    :data:`DAILY_FETCH_TIMEOUT_SEC`.
    """
    try:
        ref = datetime.strptime(today, "%Y-%m-%d")
    except (TypeError, ValueError):
        return []
    try:
        from api.options import fetch_upstox
    except Exception:
        return []
    key = _resolve_daily_key(symbol)
    if not key:
        # TEMPORARY [daily-probe]: is key resolution the SENSEX problem?
        logger.warning("options_report: [daily-probe] %s no instrument key", symbol)
        return []
    try:
        enc = urllib.parse.quote(key, safe="")
    except Exception:
        return []
    to_date = today
    from_date = (ref - timedelta(days=DAILY_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    attempts = max(1, DAILY_FETCH_ATTEMPTS)
    for attempt in range(1, attempts + 1):
        for interval in ("day", "days/1", "day/1"):
            try:
                payload = await asyncio.wait_for(
                    fetch_upstox(
                        f"/historical-candle/{enc}/{interval}/{to_date}/{from_date}"
                    ),
                    timeout=DAILY_FETCH_TIMEOUT_SEC,
                )
            except Exception as exc:
                # TEMPORARY [daily-probe]: per-attempt outcome for the incident.
                logger.warning(
                    "options_report: [daily-probe] %s attempt %d/%d interval %s "
                    "raised %s: %s",
                    symbol, attempt, attempts, interval,
                    type(exc).__name__, str(exc)[:200])
                continue
            data = payload.get("data") if isinstance(payload, dict) else None
            candles = (data or {}).get("candles") if isinstance(data, dict) else None
            rows = [r for r in (candles or []) if isinstance(r, (list, tuple))]
            if rows:
                # The v2 endpoint returns newest-first; downstream (baseline's
                # trailing-20, parity with the old ascending frame) reads
                # chronological order.
                rows.reverse()
                return rows
            # TEMPORARY [daily-probe]: empty (not error) from Upstox.
            logger.warning(
                "options_report: [daily-probe] %s attempt %d/%d interval %s "
                "returned no candles",
                symbol, attempt, attempts, interval)
            # First usable spelling decides (a 404 raises and tries the next
            # spelling above); an empty frame falls through to the retry.
            break
        if attempt < attempts:
            await asyncio.sleep(DAILY_FETCH_RETRY_SLEEP_SEC)
    logger.warning("options_report: daily candles unavailable for %s "
                   "(%d attempts) — pivots/baseline degraded",
                   symbol, attempts)
    return []


async def get_daily_context(symbol: str, today: str) -> dict:
    """Pivots + baseline for ``symbol`` from its own daily candles.

    Cached per symbol per session (the previous completed session and the
    20-session baseline never change inside a day). A failed/empty fetch is
    retried after :data:`DAILY_MISS_TTL_SEC` instead of being pinned all day.
    """
    entry = _daily_cache.get(symbol)
    now = time.time()
    if entry and entry.get("date") == today:
        if entry.get("pivots") is not None or now - entry["ts"] < DAILY_MISS_TTL_SEC:
            return entry["ctx"]
    async with _symbol_lock(f"{symbol}:1d"):
        entry = _daily_cache.get(symbol)
        now = time.time()
        if entry and entry.get("date") == today:
            if entry.get("pivots") is not None or now - entry["ts"] < DAILY_MISS_TTL_SEC:
                return entry["ctx"]
        rows = await _fetch_daily_rows(symbol, today)
        ctx = {
            "rows": rows,
            "pivots": compute_pivots(rows, today) if rows else None,
            "baseline_pct": compute_baseline_pct(rows, today) if rows else None,
        }
        _daily_cache[symbol] = {
            "date": today,
            "ts": time.time(),
            "pivots": ctx["pivots"],
            "ctx": ctx,
        }
        symbols = set(_daily_cache)
        if len(symbols) > CACHE_MAX_SYMBOLS:
            victims = symbols - {symbol}
            if victims:
                oldest = min(victims, key=lambda s: _daily_cache[s]["ts"])
                _daily_cache.pop(oldest, None)
        return ctx


def _baseline_points(pct: Optional[float], spot: float) -> Optional[float]:
    """Median daily range % -> points at ``spot`` (the unit ``compute_regime`` expects)."""
    if pct is None:
        return None
    if spot and spot > 0:
        return round(float(pct) / 100.0 * spot, 2)
    return round(float(pct), 2)


async def _nearest_expiry(symbol: str) -> str:
    """First (nearest) listed expiry, or a 404 for an unknown underlying."""
    try:
        async with _state().sem:
            if not await _acquire_upstream():
                raise HTTPException(
                    status_code=429,
                    detail="Upstox api rate budget exhausted — retry shortly",
                )
            listing = await get_expiries(symbol)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"expiries fetch failed for {symbol}: {e}",
        )
    expiries = (listing or {}).get("expiries") or []
    if not expiries:
        raise HTTPException(
            status_code=404,
            detail=f"no option expiries for {symbol!r} — unknown underlying or no live listing",
        )
    return str(expiries[0].get("date") or "")


async def _build_core(symbol: str, expiry: str) -> dict:
    """Build the chain-derived payload (no candles) for ``(symbol, expiry)``.

    Deliberately excludes ``intraday``/``ohlc``: the candle fetch is the slow,
    opt-in part, so it is attached by :func:`_assemble` after the cached core
    is returned. This is what makes a default request ~1-2 s instead of ~20 s.
    """
    try:
        async with _state().sem:
            if not await _acquire_upstream():
                raise HTTPException(
                    status_code=429,
                    detail="Upstox api rate budget exhausted — retry shortly",
                )
            payload = await get_option_chain(symbol, expiry)
    except HTTPException as e:
        # api.options wraps upstream errors as 500; surface them as 502 so the
        # UI can tell "upstream unavailable" from a server bug. 429/400 pass
        # through untouched (the handler serves a stale frame for 429).
        if e.status_code in (400, 429):
            raise
        raise HTTPException(status_code=502, detail=f"option chain fetch failed for {symbol}: {e.detail}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"option chain fetch failed for {symbol}: {e}")

    chain = (payload or {}).get("chain") or []
    strikes = build_strikes(chain)
    if not strikes:
        raise HTTPException(
            status_code=502,
            detail=f"empty option chain for {symbol} expiry {expiry}",
        )

    spot = _num((payload or {}).get("spot"))
    summary = (payload or {}).get("summary") or {}

    max_pain = _num(summary.get("max_pain"))
    if max_pain <= 0:
        max_pain = compute_max_pain(strikes)

    pcr_oi = _num(summary.get("pcr"))
    if pcr_oi <= 0:
        ce_oi = sum(r["ce"]["oi"] for r in strikes)
        pe_oi = sum(r["pe"]["oi"] for r in strikes)
        pcr_oi = round(pe_oi / ce_oi, 2) if ce_oi > 0 else 0.0

    lot_size = resolve_lot_size(symbol, chain)
    try:
        from api.reports_api.nifty import compute_gex
        from api.reports_api.nifty_positioning import compute_positioning

        gex = compute_gex(strikes, spot, lot_size)
        positioning = compute_positioning(strikes, spot, lot_size)
    except Exception:
        gex = None
        positioning = None

    return {
        "mode": "live",
        "underlying": symbol,
        "date": datetime.now(config.IST).strftime("%Y-%m-%d"),
        "expiry": expiry,
        "spot": spot,
        "pcr_oi": round(pcr_oi, 2),
        "pcr_vol": compute_pcr_vol(strikes),
        "max_pain": max_pain,
        # Chain-wide distance covered by the strikes (the timeline quotes it).
        "max_pain_scope_pts": round(
            max((abs(r["strike"] - spot) for r in strikes), default=0.0), 2
        ),
        "walls": {
            "calls": top_walls(strikes, "ce", spot),
            "puts": top_walls(strikes, "pe", spot),
        },
        "walls_near": {
            "calls": near_walls(strikes, "ce", spot),
            "puts": near_walls(strikes, "pe", spot),
        },
        "strikes": strikes,
        # Chain-derived analytics for THIS symbol's own chain. The session
        # blocks that need daily candles / tape are attached by the handler.
        "gex": gex,
        "positioning": positioning,
        "lot_size": lot_size,
        "control": None,
        "regime": None,
        "vix": None,
        "strength": None,
        "market": None,
        "reference": None,
        "structure": [],
        "fetched_at": datetime.now(config.IST).isoformat(),
    }


def _assemble(core: dict, intraday: list[dict]) -> dict:
    """Attach candles + OHLC to a cached chain core (never mutates the cache).

    Without candles the OHLC is the flat spot fallback the contract expects;
    with them it is the session's real open/high/low/close.
    """
    report = dict(core)
    spot = _num(core.get("spot"))
    report["ohlc"] = ohlc_from_intraday(intraday, spot)
    report["intraday"] = intraday
    if intraday:
        report["date"] = str(intraday[-1]["time"])[:10] or report.get("date")
    return report


async def _attach_analytics(symbol: str, report: dict, intraday: list[dict]) -> dict:
    """Attach the session blocks computed from THIS symbol's own data.

    Every block is independently guarded: a missing daily fetch, tape or VIX
    leaves that block empty instead of turning a live report into a 500. The
    inputs are always symbol-scoped — daily candles for pivots/baseline, the
    ``options_tape/{SYMBOL}`` rows for reference/structure/verdicts. India VIX
    is the one market-wide input, labelled ``source: INDIA_VIX``.
    """
    spot = _num(report.get("spot"))
    date_str = str(report.get("date") or datetime.now(config.IST).strftime("%Y-%m-%d"))

    try:
        daily = await get_daily_context(symbol, date_str)
    except Exception:
        daily = {}
    report["pivots"] = daily.get("pivots")
    baseline_pct = daily.get("baseline_pct")
    report["baseline_range_pct"] = baseline_pct
    baseline = _baseline_points(baseline_pct, spot)

    try:
        tape = await asyncio.to_thread(read_tape, symbol, date_str)
    except Exception:
        tape = []

    try:
        from api.reports_api.nifty import compute_reference

        report["reference"] = compute_reference(tape, report.get("strikes") or [])
    except Exception:
        report["reference"] = None

    try:
        from api.reports_api.nifty_structure import detect_structure_shifts

        report["structure"] = detect_structure_shifts(tape)[-12:]
    except Exception:
        report["structure"] = []

    try:
        from api.reports_api import nifty_verdicts as nv

        vix = await nv.get_vix_block()
        if isinstance(vix, dict):
            vix = {**vix, "source": "INDIA_VIX"}
        positioning = report.get("positioning")
        flow_bias = (positioning.get("initiated")
                     if isinstance(positioning, dict) else None)
        pivots = report.get("pivots")
        prev = (pivots or {}).get("prev") if isinstance(pivots, dict) else None
        prev_close = _opt_num((prev or {}).get("close")) if isinstance(prev, dict) else None
        report.update(nv.build_verdicts(
            rows=report.get("strikes") or [], spot=spot, gex=report.get("gex"),
            candles=intraday or None, tape_rows=tape, baseline=baseline,
            vix=vix, reference=report.get("reference"),
            prev_close=prev_close, flow_bias=flow_bias,
        ))
    except Exception:
        pass
    # India VIX is market-wide, not a synthetic symbol VIX — always label it.
    if not isinstance(report.get("vix"), dict):
        report["vix"] = {"source": "INDIA_VIX"}
    else:
        report["vix"]["source"] = "INDIA_VIX"

    try:
        report["market"] = market_block()
    except Exception:
        report["market"] = None

    try:
        report["emas"] = build_emas(intraday)
    except Exception:
        report["emas"] = []

    try:
        report["timeline"] = build_timeline(report, symbol)
    except Exception:
        report["timeline"] = []

    return report


# --------------------------------------------------------------------------- #
# route
# --------------------------------------------------------------------------- #
@router.get("/{underlying}/live")
async def get_live_option_report(
    underlying: str,
    expiry: Optional[str] = Query(default=None, description="Expiry YYYY-MM-DD (default: nearest)"),
    candles: bool = Query(
        default=False,
        description="Include 1-minute intraday bars (slower on a cold fetch; cached 120s)",
    ),
):
    """Live option-chain report for any F&O underlying (SENSEX, RELIANCE, ...).

    The chain core is cached per ``(underlying, expiry)`` for
    :data:`CACHE_TTL_SEC` seconds (own namespace — never NIFTY's) and
    single-flighted per underlying, so 10 calls inside the TTL window make
    exactly one upstream chain fetch.

    ``candles`` is **opt-in**: a default request never fetches 1-minute bars
    (that call dominates a cold report — ~20 s for RELIANCE) and returns
    ``intraday: []`` with the flat-spot OHLC. ``candles=1`` fetches them once
    and caches them under ``(underlying, "1m")`` for
    :data:`INTRADAY_TTL_SEC` seconds; if a fresh candle cache already exists it
    is attached even on a default request, at no upstream cost.

    The session blocks (pivots, baseline, reference, structure, verdicts,
    timeline, EMAs) are computed from this symbol's own daily candles and
    ``options_tape/{SYMBOL}`` rows. Daily candles are fetched once per symbol
    per session and cached; the India VIX input is market-wide and labelled.

    Errors: 400 bad expiry · 404 unknown underlying / no listing · 429 Upstox
    api budget exhausted (serves the last good frame when one exists) · 502
    upstream failure or empty chain. Never an unhandled 500.
    """
    symbol = str(underlying or "").strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="underlying is required")

    stale_served = False
    async with _symbol_lock(symbol):
        resolved = _validate_expiry(expiry) if expiry else await _nearest_expiry(symbol)

        core = _cache_get(symbol, resolved)
        if core is None:
            try:
                core = await _build_core(symbol, resolved)
            except HTTPException as e:
                if e.status_code == 429:
                    core = _cache_get(symbol, resolved, allow_stale=True)
                    if core is not None:
                        # Last good frame beats a 429 storm; flag it for the UI.
                        core = {**core, "stale": True}
                        stale_served = True
                    else:
                        raise
                else:
                    raise
            else:
                _cache_put(symbol, resolved, core)

    # Candles are attached OUTSIDE the chain lock: a cold 1-minute fetch must
    # never block another client's chain-only request for the same symbol.
    if candles:
        intraday = await get_intraday(symbol)
    else:
        intraday = _intraday_get(symbol) or []

    # Verdicts (strength/regime/control) are candle-derived. On the fast
    # chain-only path the response omits the bars and may have no cached
    # intraday yet; it must NOT block on a cold candle fetch (that turned a
    # 1 s chain read into a 20 s request). The frontend's background
    # `candles=1` call returns the candle-derived verdicts, which it merges
    # into the report — so the correct blocks arrive without stalling the chain.
    report = _assemble(core, intraday)
    report = await _attach_analytics(symbol, report, intraday)
    if stale_served:
        report["stale"] = True
    return report


__all__ = [
    "router",
    "build_side",
    "build_strikes",
    "top_walls",
    "near_walls",
    "compute_pcr_vol",
    "compute_max_pain",
    "candles_to_intraday",
    "ohlc_from_intraday",
    "get_intraday",
    "get_daily_context",
    "resolve_lot_size",
    "daily_rows_from_df",
    "compute_baseline_pct",
    "compute_pivots",
    "tape_path",
    "read_tape",
    "market_block",
    "build_timeline",
    "build_emas",
    "clear_cache",
]
