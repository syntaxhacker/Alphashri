"""Disk cache for US (``market=usa``) chart candles.

Separate from the NSE ``chart_patterns.candles`` cache so a US entry can never
read or poison an India entry. Layout::

    experiments/data/us_chart_cache/{tf}/{SYMBOL}.usa.v{CACHE_VERSION}.pkl
    experiments/data/us_chart_cache/{tf}/{SYMBOL}.usa.v{CACHE_VERSION}.meta
    experiments/data/us_chart_cache/{tf}/{SYMBOL}.usa.v{CACHE_VERSION}.empty.json

The ``usa`` + version token in every filename makes the namespace explicit on
disk as well as in the directory. Pickle matches the existing candle cache and
round-trips tz-aware DataFrames without a conversion step.

Freshness: 45 s while the US session is open (Yahoo bars mutate); once closed,
an entry is pinned to the ET session it was written on and stays valid for that
whole session/weekend. Empty results get a shorter 90 s negative marker. Every
read is fail-soft: a corrupt/expired/unreadable entry is a cache miss, never an
exception. Writes are atomic (temp file in the same directory + ``os.replace``)
and the public key inputs are allowlisted before they reach a path.
"""
from __future__ import annotations

import json
import logging
import os
import pickle
import re
import tempfile
import time
from pathlib import Path
from typing import Iterable, Optional, Union

import pandas as pd

from market_data.providers.sessions import is_us_open, session_date

logger = logging.getLogger(__name__)

CACHE_ROOT = Path(__file__).resolve().parent.parent / "experiments" / "data" / "us_chart_cache"
CACHE_DIR = CACHE_ROOT

CACHE_VERSION = 1
#: TTL for intraday entries while the US session is open.
TTL_SECONDS = 45.0
#: A fetch that came back empty is remembered briefly so repeated chart clicks
#: do not re-hammer the feed. Independent of the open/closed pin.
NEGATIVE_TTL_SECONDS = 90.0

ALLOWED_TIMEFRAMES = frozenset({"1m", "5m", "15m", "30m", "1h", "4h", "1D"})
_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,19}$")

_replace = os.replace  # seam: tests assert the atomic replace without patching global os


def _safe_symbol(symbol: str) -> str:
    """Uppercase allowlisted US symbol; reject anything path-like."""
    text = str(symbol).strip().upper()
    if ".." in text or not _SYMBOL_RE.fullmatch(text):
        raise ValueError(f"invalid US chart symbol: {symbol!r}")
    return text


def _safe_tf(tf: str) -> str:
    """Normalise and allowlist the timeframe id."""
    text = str(tf).strip()
    if text.lower() == "1d":
        text = "1D"
    if text not in ALLOWED_TIMEFRAMES:
        raise ValueError(f"invalid US chart timeframe: {tf!r}")
    return text


def _paths(symbol: str, tf: str) -> tuple[Path, Path, Path]:
    sym = _safe_symbol(symbol)
    frame = _safe_tf(tf)
    base = f"{sym}.usa.v{CACHE_VERSION}"
    pkl = CACHE_DIR / frame / f"{base}.pkl"
    root = CACHE_DIR.resolve()
    for path in (pkl,):
        if not path.resolve().is_relative_to(root):
            raise ValueError(f"cache path escapes cache dir: {symbol!r}/{tf!r}")
    return pkl, pkl.with_suffix(".meta"), pkl.with_suffix(".empty.json")


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` via a temp file in the same directory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=".tmp-", suffix=".part"
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        _replace(str(tmp), str(path))
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _read_meta(meta_path: Path) -> Optional[dict]:
    try:
        with open(meta_path, "r") as handle:
            meta = json.load(handle)
        return meta if isinstance(meta, dict) else None
    except Exception:
        return None


def _fresh(meta: dict, symbol: str, tf: str, now: float) -> bool:
    if (meta.get("version") != CACHE_VERSION or meta.get("market") != "usa"
            or meta.get("symbol") != symbol or meta.get("tf") != tf):
        return False
    try:
        stamp = float(meta.get("ts", 0))
    except (TypeError, ValueError):
        return False
    if is_us_open():
        return now - stamp <= TTL_SECONDS
    return meta.get("session") == session_date()


def get_us_candles(symbol: str, tf: str) -> Optional[pd.DataFrame]:
    """Return cached candles, or ``None`` on miss/expiry/corruption.

    Raises ``ValueError`` only for an invalid symbol/timeframe key — the key is a
    programming error, not an upstream failure. Cache I/O is fail-soft.
    """
    pkl_path, meta_path, neg_path = _paths(symbol, tf)
    sym, frame = _safe_symbol(symbol), _safe_tf(tf)
    try:
        now = time.time()
        if pkl_path.exists():
            meta = _read_meta(meta_path)
            if meta is not None and _fresh(meta, sym, frame, now):
                with open(pkl_path, "rb") as handle:
                    df = pickle.load(handle)
                if isinstance(df, pd.DataFrame) and not df.empty:
                    return df
        if neg_path.exists():
            neg = _read_meta(neg_path)
            if neg is not None:
                try:
                    fresh = now - float(neg.get("ts", 0)) <= NEGATIVE_TTL_SECONDS
                except (TypeError, ValueError):
                    fresh = False
                if fresh:
                    return None
                try:
                    neg_path.unlink(missing_ok=True)
                except OSError:
                    pass
    except Exception as exc:
        logger.debug("us cache read failed symbol=%s tf=%s: %s", sym, frame, exc)
    return None


def put_us_candles(symbol: str, tf: str, df: Optional[pd.DataFrame]) -> None:
    """Store candles (or a short negative marker for a no-data result)."""
    pkl_path, meta_path, neg_path = _paths(symbol, tf)
    sym, frame = _safe_symbol(symbol), _safe_tf(tf)
    try:
        if df is None or getattr(df, "empty", True):
            marker = {
                "ts": time.time(), "market": "usa", "symbol": sym,
                "tf": frame, "version": CACHE_VERSION, "empty": True,
            }
            _atomic_write_bytes(neg_path, json.dumps(marker).encode())
            for stale in (pkl_path, meta_path):
                try:
                    stale.unlink(missing_ok=True)
                except OSError:
                    pass
            return

        _atomic_write_bytes(pkl_path, pickle.dumps(df, protocol=pickle.HIGHEST_PROTOCOL))
        meta = {
            "ts": time.time(), "session": session_date(), "market": "usa",
            "symbol": sym, "tf": frame, "version": CACHE_VERSION,
        }
        _atomic_write_bytes(meta_path, json.dumps(meta).encode())
        try:
            neg_path.unlink(missing_ok=True)
        except OSError:
            pass
    except Exception as exc:
        logger.debug("us cache write failed symbol=%s tf=%s: %s", sym, frame, exc)


def clear_us_cache(
    symbols: Optional[Union[str, Iterable[str]]] = None,
    timeframe: Optional[Union[str, Iterable[str]]] = None,
) -> int:
    """Delete cached US entries, optionally filtered by symbol/timeframe.

    Returns the number of files removed. Safe (returns 0) when the cache dir is
    absent or a filter matches nothing.
    """
    try:
        if not CACHE_DIR.exists():
            return 0
    except OSError:
        return 0

    def normalise(value, converter) -> Optional[set]:
        if value is None:
            return None
        items = [value] if isinstance(value, str) else list(value)
        out = set()
        for item in items:
            try:
                out.add(converter(item))
            except ValueError:
                continue
        return out or None

    sym_filter = normalise(symbols, _safe_symbol)
    tf_filter = normalise(timeframe, _safe_tf)
    removed = 0
    try:
        patterns = ("*.pkl", "*.meta", "*.empty.json")
        for pattern in patterns:
            paths = ((p for tf in tf_filter for p in (CACHE_DIR / tf).glob(pattern))
                     if tf_filter else CACHE_DIR.glob(f"*/{pattern}"))
            for path in paths:
                try:
                    if not path.is_file():
                        continue
                    head = path.name.split(".")[0]
                    if sym_filter is not None and head not in sym_filter:
                        continue
                    path.unlink()
                    removed += 1
                except OSError:
                    continue
    except Exception:
        return removed
    return removed


__all__ = [
    "CACHE_ROOT",
    "CACHE_DIR",
    "CACHE_VERSION",
    "TTL_SECONDS",
    "NEGATIVE_TTL_SECONDS",
    "ALLOWED_TIMEFRAMES",
    "get_us_candles",
    "put_us_candles",
    "clear_us_cache",
]
