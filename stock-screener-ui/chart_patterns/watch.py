"""Breakout Watch: arm from the latest scan hits, then check live prices.

Shared by the app (``api/chart_patterns.py`` ``/watch`` endpoints) and the
``scripts/breakout_watch.py`` CLI. Two phases:

1. :func:`arm` — read the latest stored hits for a setup's ``source_pattern``
   (via :mod:`chart_patterns.store`, deduped) and keep the ones matching the
   setup's status/base/range gates. One row per symbol (highest confidence).
   A ``confirmed`` hit is armed only when the break is fresh (stored close
   at/just above the box); stale breakouts far above the box stay excluded.
   Fresh-cross rows carry ``fresh=True`` so :func:`live` can mark them
   ``triggered`` even though the last completed bar was already above the box.
2. :func:`live` — attach the latest price + time-adjusted intraday volume
   (:func:`vol_adj_map`) to each armed row and classify it as ``triggered`` /
   ``invalidated`` / ``armed``. The ``triggered`` gate uses ``vol_adj``, NOT
   TradingView's ``relative_volume_10d_calc`` (which divides today's
   cumulative volume by the *full-day* 10d average, so it reads ~0.0x all
   morning even for names trading at multiples of their normal intraday
   pace). Prices come from the OAuth LTP batch; when that fails (e.g. an
   expired token) each missing symbol falls back to the 1m tape via a
   bounded thread pool, memoised for a short TTL so repeated polls stay
   cheap.

Both functions never raise on empty stores or failed price feeds: ``arm``
returns ``[]`` when the store has no hits, and ``live`` marks rows with a
missing price as ``armed`` with ``ltp=None``.

Setups come in two kinds (``setup["kind"]``):

* ``pattern`` — the original behaviour: arm from the store's detected
  patterns for the setup's ``source_pattern``.
* ``computed`` — arm straight from daily candles (no scan needed). The
  ``near_52w`` setup screens the universe for names within ``max_gap`` pct
  of their prior 52W high (or spiking through it) with volume accumulation.
  The screen fans out over :mod:`chart_patterns.parallel` (threads by
  default; opt-in processes for CLIs) and is cached on two levels under
  ``experiments/data/pattern_cache/watch/``: per-symbol detection results
  keyed on ``(setup_id, symbol, timeframe, session, DETECTOR_VERSION)`` plus
  the whole-screen rows per ``(scope, timeframe, session)`` — so a re-run of
  the same screen on the same session is instant (no re-detection), and a
  session rollover or detector bump recomputes. Fork-safety: the FastAPI
  ``/watch`` path must never fork per request, so ``arm`` defaults to
  threads/sequential and only callers passing ``use_processes=True`` (CLIs)
  get worker processes.
"""

from __future__ import annotations

import functools
import importlib
import json
import logging
import os
import pickle
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from chart_patterns.parallel import run_symbols

log = logging.getLogger(__name__)

LTP_URL = "https://api.upstox.com/v3/market-quote/ltp"

SETUPS: dict[str, dict] = {
    "breakout": {
        "id": "breakout",
        "label": "Long-base breakout",
        "description": "Long tight base; trigger = box high, invalidate = box low",
        "kind": "pattern",
        "source_pattern": "consolidation",
        # Arm bases that have NOT already broken out — plus *fresh* breakouts.
        # ``confirmed`` means the last completed close is above the box high,
        # which is usually a stale breakout (e.g. +18% above its box), not a
        # watch candidate. But ``confirmed`` also covers a fresh same-day
        # break (close 37.15 vs trigger 36.95, only +0.54%): those rows are
        # armed with ``fresh=True`` (see ``_fresh_confirmed``) so the live
        # state machine can mark them ``triggered``. ``forming`` = within 2%
        # below the trigger; ``failed`` covers the mid-box bases (a
        # consolidation's close is normally well below the line, so
        # ``classify_status`` calls that "failed"); breakdowns among them are
        # marked ``invalidated`` by the live state machine.
        "statuses": ["forming", "failed", "marginal"],
        "min_base_days": 60,
        "max_range_pct": 20.0,
        "trigger": "breakout_level",
        "invalidate": "base_low",
        "default_min_rel_volume": 0.7,
    },
    "near_52w": {
        "id": "near_52w",
        "label": "Near 52W high + accumulation",
        "description": "Within ~5% of the prior 52W high with volume accumulation (OBV, up/down volume, rising volume/lows)",
        "kind": "computed",
        "max_gap": 5.0,
        "trigger": "prior_52w_high",
        "invalidate": "recent_low",
        "default_min_rel_volume": 0.7,
    },
}

#: Upper bound on rows pulled from the store per ``arm`` call.
_ARM_QUERY_LIMIT = 5000

#: A ``confirmed`` hit counts as a fresh same-day break (not a stale
#: breakout) while its stored close sits at/just above the box top.
#: ``range_pos`` is the base-close position on a ``0..100`` box scale, so
#: ``<= 110`` means the close is at most ~10% of the box height above the
#: trigger — a just-crossed bar, not a runaway move.
_FRESH_RANGE_POS_MAX = 110.0

#: Fallback freshness gate on the stored close's gap above ``breakout_level``
#: (percent), used alongside ``_FRESH_RANGE_POS_MAX`` and alone when the hit
#: carries no usable ``range_pos`` (via the stored ``end_price``). Stale
#: breakouts (e.g. +18% above the box) stay excluded.
_FRESH_GAP_PCT_MAX = 5.0

#: Upstox OAuth access tokens live ~a day; a DB token older than this is
#: treated as expired and the doomed LTP call is skipped (straight to the
#: tape fallback).
_UPSTOX_TOKEN_TTL_SECONDS = 24 * 3600

#: Bounded fan-out for the per-symbol tape fallback (one 1m fetch each).
_TAPE_WORKERS = 5

#: Memoised tape prices stay valid this long (seconds) so repeated polls —
#: and the endpoint + CLI polling the same names — don't refetch every bar.
_TAPE_CACHE_TTL_SECONDS = 30.0

#: ``symbol|timeframe`` -> ``(price, monotonic_ts)``. Small and self-expiring;
#: only successful fetches are stored.
_TAPE_CACHE: dict[str, tuple[float, float]] = {}

#: Disk cache for computed arms (``near_52w``), mirroring the pattern-cache
#: layout: ``experiments/data/pattern_cache/watch/{key}__{session}.pkl``.
#: Monkeypatchable in tests.
_NEAR52W_CACHE_DIR = (
    Path(__file__).resolve().parent.parent
    / "experiments"
    / "data"
    / "pattern_cache"
    / "watch"
)

#: Bounded fan-out for the per-symbol daily-candle fetch of a computed arm.
_NEAR52W_WORKERS = 4

#: Minimum daily bars for a symbol to be screened (prior-high window plus a
#: full ~20-session accumulation window). Shorter histories are skipped.
_NEAR52W_MIN_BARS = 21

#: Lookback for the prior 52W high (daily bars, latest bar excluded).
_NEAR52W_LOOKBACK = 252

#: Accumulation windows (daily bars): OBV slope + volume ratio denominator.
_NEAR52W_ACCUM_WINDOW = 20

#: Up/down-volume window and invalidate-level (recent low) window.
_NEAR52W_UPDOWN_WINDOW = 10
_NEAR52W_INVALIDATE_WINDOW = 10

#: Volume-ratio numerator window (mean vol last 5 vs mean vol last 20).
_NEAR52W_VOL_SHORT = 5

#: Version of the ``near_52w`` detector + row shape. Bump whenever
#: :func:`_near52w_row` changes so stale per-symbol and whole-screen cache
#: entries are ignored instead of served as fresh.
DETECTOR_VERSION = 4

#: Per-symbol detection-result cache subdirectory of ``_NEAR52W_CACHE_DIR``:
#: ``detect/{setup}__{SYM}__{tf}__{session}.v{N}.pkl``. Kept in a
#: subdirectory so the whole-screen ``*.pkl`` glob never sees these files.
#: Keyed on ``(setup_id, symbol, timeframe, session, DETECTOR_VERSION)`` so a
#: re-run of the same screen on the same session skips re-detection entirely
#: — even for a different scope (universe vs hand-picked symbols). A cached
#: skip (short history / fetch failure) is stored as a ``None`` row so it is
#: not recomputed within the session; a session rollover or version bump
#: recomputes. Sibling files (older sessions/versions) are pruned on write.
_DETECT_CACHE_SUBDIR = "detect"


def public_setups() -> list[dict]:
    """Registry entries without internals (``source_pattern``/``kind``)."""
    return [
        {
            "id": setup["id"],
            "label": setup["label"],
            "description": setup["description"],
            "default_min_rel_volume": setup["default_min_rel_volume"],
        }
        for setup in SETUPS.values()
    ]


def _base_low_from_hit(hit: dict) -> Optional[float]:
    """Base low from the hit's lower trendline, else ``None`` (caller falls back)."""
    try:
        lines = hit.get("trendlines") or []
        if len(lines) >= 2 and lines[1]:
            price = lines[1][0].get("price")
            if price is not None:
                return float(price)
    except (TypeError, ValueError, IndexError, KeyError, AttributeError):
        pass
    return None


def _fresh_confirmed(hit: dict, trigger: float, base_low: float) -> bool:
    """True when a ``confirmed`` hit is a fresh same-day break, not stale.

    Fresh = the stored close is at/just above the box top: ``range_pos``
    (the base-close position on the ``0..100`` box scale) ``<= 110``, or the
    stored close's gap above ``breakout_level`` is small. The close is
    derived from the hit as
    ``close = base_low + range_pos / 100 * (box_high - base_low)`` with
    ``box_high = breakout_level``; when the hit carries no usable
    ``range_pos`` the stored ``end_price`` stands in for the close. A stale
    breakout (e.g. +18% above its box) fails both gates. Never raises.
    """
    try:
        trigger = float(trigger)
        base_low = float(base_low)
    except (TypeError, ValueError):
        return False
    try:
        rp = hit.get("range_pos")
        if rp is not None:
            rp = float(rp)
            span = trigger - base_low
            if span > 0 and trigger > 0:
                close = base_low + rp / 100.0 * span
                gap_pct = (close - trigger) / trigger * 100.0
                return rp <= _FRESH_RANGE_POS_MAX or gap_pct <= _FRESH_GAP_PCT_MAX
            return rp <= _FRESH_RANGE_POS_MAX
    except (TypeError, ValueError, ZeroDivisionError):
        pass
    try:
        end = hit.get("end_price")
        if end is None or trigger <= 0:
            return False
        return (float(end) - trigger) / trigger * 100.0 <= _FRESH_GAP_PCT_MAX
    except (TypeError, ValueError, ZeroDivisionError):
        return False


def _near52w_session() -> str:
    """Current session key for the computed-arm cache: the last completed NSE
    session (pinned across weekends/holidays, like the candle cache), falling
    back to today's IST date. Never raises."""
    try:
        from chart_patterns.candles import _last_completed_session

        return _last_completed_session().isoformat()
    except Exception:
        pass
    try:
        import config

        return datetime.now(config.IST).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _near52w_cache_key(scope: str, timeframe: str) -> str:
    """Filesystem-safe cache stem for a computed-arm scope (no session)."""
    safe = "".join(c for c in str(scope) if c.isalnum() or c in ("-", "_")) or "all"
    return f"near_52w__{safe}__{timeframe}"


def _near52w_cache_read(key: str, session: str) -> Optional[list]:
    """Cached computed rows for ``(key, session)``; ``None`` on miss/stale.

    Staleness is the filename itself (each session gets its own file) plus
    payload checks on ``session`` and ``DETECTOR_VERSION``, so a session
    rollover or a detector bump always recomputes. Never raises.
    """
    try:
        path = _NEAR52W_CACHE_DIR / f"{key}__{session}.pkl"
        if not path.exists():
            return None
        with open(path, "rb") as f:
            payload = pickle.load(f)
        if not isinstance(payload, dict) or payload.get("session") != session:
            return None
        if payload.get("version") != DETECTOR_VERSION:
            return None
        rows = payload.get("rows")
        if not isinstance(rows, list):
            return None
        return [dict(r) for r in rows if isinstance(r, dict)]
    except Exception:
        return None


def _near52w_cache_write(key: str, session: str, rows: list) -> None:
    """Persist computed rows for ``(key, session)`` and prune older sessions
    for the same key. Never raises."""
    try:
        _NEAR52W_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{key}__{session}.pkl"
        for old in _NEAR52W_CACHE_DIR.glob(f"{key}__*.pkl"):
            try:
                if old.name != name:
                    old.unlink()
            except Exception:
                pass
        with open(_NEAR52W_CACHE_DIR / name, "wb") as f:
            pickle.dump(
                {
                    "session": session,
                    "version": DETECTOR_VERSION,
                    "rows": [dict(r) for r in rows],
                },
                f,
            )
    except Exception:
        pass


def _detect_cache_file(setup_id: str, symbol: str, timeframe: str, session: str) -> Path:
    """Detection-cache file for one symbol (version-pinned name)."""
    def _safe(part: object) -> str:
        return "".join(c for c in str(part) if c.isalnum() or c in ("-", "_")) or "x"

    name = (
        f"{_safe(setup_id)}__{str(symbol).upper()}__{_safe(timeframe)}"
        f"__{_safe(session)}.v{DETECTOR_VERSION}.pkl"
    )
    return _NEAR52W_CACHE_DIR / _DETECT_CACHE_SUBDIR / name


def _detect_cache_read(
    setup_id: str, symbol: str, timeframe: str, session: str
) -> tuple[bool, Optional[dict]]:
    """``(hit, row)`` for one symbol's cached detection result.

    ``hit`` is ``False`` on miss/stale/version-mismatch; a ``(True, None)``
    hit is a cached skip (short history or fetch failure — not recomputed
    within the session). Never raises.
    """
    try:
        path = _detect_cache_file(setup_id, symbol, timeframe, session)
        if not path.exists():
            return (False, None)
        with open(path, "rb") as f:
            payload = pickle.load(f)
        if not isinstance(payload, dict):
            return (False, None)
        if payload.get("session") != session:
            return (False, None)
        if payload.get("version") != DETECTOR_VERSION:
            return (False, None)
        row = payload.get("row")
        if row is None:
            return (True, None)
        if not isinstance(row, dict):
            return (False, None)
        return (True, dict(row))
    except Exception:
        return (False, None)


def _detect_cache_write(
    setup_id: str, symbol: str, timeframe: str, session: str, row: Optional[dict]
) -> None:
    """Persist one symbol's detection result (``None`` = cached skip) and
    prune older sessions/versions for the same symbol. Never raises."""
    try:
        path = _detect_cache_file(setup_id, symbol, timeframe, session)
        path.parent.mkdir(parents=True, exist_ok=True)
        prefix = "__".join(path.name.split("__")[:3])
        for old in path.parent.glob(f"{prefix}__*.pkl"):
            try:
                if old.name != path.name:
                    old.unlink()
            except Exception:
                pass
        with open(path, "wb") as f:
            pickle.dump(
                {
                    "session": session,
                    "version": DETECTOR_VERSION,
                    "row": dict(row) if isinstance(row, dict) else None,
                },
                f,
            )
    except Exception:
        pass


def _near52w_row(symbol: str, df) -> Optional[dict]:
    """Screen one daily frame; a watch row or ``None`` (skip). Never raises.

    * ``prior_high`` = ``max(high)`` over the last 252 bars **excluding**
      the latest bar; ``touched`` = latest high ``>=`` prior high.
    * ``high_gap``/``close_gap`` = ``(prior_high - last_high/close) /
      prior_high * 100`` (negative = exceeded intraday / closed above).
    * Accumulation over the last ~20 sessions: ``obv_slope`` (linreg slope
      of OBV / mean volume), ``updown`` (up-day volume / down-day volume,
      last 10; all-up with no down volume yields the up volume itself,
      all-flat yields the neutral 1.0), ``vol_ratio`` (mean vol last 5 /
      mean vol last 20; 1.0 when the denominator is 0), ``rising_lows``
      (``min(low,5) > min(low,10) > min(low,20)``).
    * ``invalidate_level`` = min low of the last 10 bars.
    """
    try:
        if df is None or getattr(df, "empty", True) or len(df) < _NEAR52W_MIN_BARS:
            return None
        for col in ("high", "low", "close", "volume"):
            if col not in df.columns:
                return None
        highs = df["high"].astype(float)
        lows = df["low"].astype(float)
        closes = df["close"].astype(float)
        vols = df["volume"].astype(float).fillna(0.0)

        hist = df.iloc[:-1]
        last = df.iloc[-1]
        prior_high = float(hist["high"].astype(float).tail(_NEAR52W_LOOKBACK).max())
        last_high = float(last["high"])
        close = float(last["close"])
        if not prior_high > 0:
            return None
        touched = bool(last_high >= prior_high)
        high_gap = (prior_high - last_high) / prior_high * 100.0
        close_gap = (prior_high - close) / prior_high * 100.0

        n = min(len(df), _NEAR52W_ACCUM_WINDOW)
        wclose = [float(v) for v in closes.tail(n).tolist()]
        wvol = [float(v) for v in vols.tail(n).tolist()]
        prev = float(closes.iloc[len(df) - n - 1]) if len(df) > n else wclose[0]
        obv = 0.0
        obvs: list[float] = []
        for c, v in zip(wclose, wvol):
            if c > prev:
                obv += v
            elif c < prev:
                obv -= v
            obvs.append(obv)
            prev = c
        mean_vol = sum(wvol) / n if n else 0.0
        sx = n * (n - 1) / 2.0
        sxx = (n - 1) * n * (2 * n - 1) / 6.0
        sy = sum(obvs)
        sxy = sum(i * y for i, y in enumerate(obvs))
        den = n * sxx - sx * sx
        slope = (n * sxy - sx * sy) / den if den else 0.0
        obv_slope = slope / mean_vol if mean_vol > 0 else 0.0

        up_vol = 0.0
        down_vol = 0.0
        start = len(df) - min(len(df), _NEAR52W_UPDOWN_WINDOW)
        for i in range(start, len(df)):
            c = float(closes.iloc[i])
            p = float(closes.iloc[i - 1]) if i > 0 else c
            v = float(vols.iloc[i])
            if c > p:
                up_vol += v
            elif c < p:
                down_vol += v
        updown = up_vol / down_vol if down_vol > 0 else (up_vol if up_vol > 0 else 1.0)

        vlong = float(vols.tail(_NEAR52W_ACCUM_WINDOW).mean())
        vshort = float(vols.tail(_NEAR52W_VOL_SHORT).mean())
        vol_ratio = vshort / vlong if vlong > 0 else 1.0

        m5 = float(lows.tail(5).min())
        m10 = float(lows.tail(_NEAR52W_UPDOWN_WINDOW).min())
        m20 = float(lows.tail(_NEAR52W_ACCUM_WINDOW).min())
        rising_lows = bool(m5 > m10 > m20)

        return {
            "symbol": str(symbol).upper(),
            "setup_id": "near_52w",
            "trigger_level": prior_high,
            "invalidate_level": float(lows.tail(_NEAR52W_INVALIDATE_WINDOW).min()),
            "close": close,
            "last_high": last_high,
            "touched": touched,
            "high_gap": high_gap,
            "close_gap": close_gap,
            "obv_slope": obv_slope,
            "updown": updown,
            "vol_ratio": vol_ratio,
            "rising_lows": rising_lows,
            "base_days": 0,
            "range_pct": 0,
            "status": "",
            "confidence": 0,
        }
    except Exception:
        return None


def _near52w_fetch_detect(symbol: str, timeframe: str = "1D") -> Optional[dict]:
    """Fetch one symbol's daily frame and screen it (near_52w row or ``None``).

    Top-level and picklable so :func:`run_symbols` can run it in worker
    processes — ``functools.partial`` binding ``timeframe`` stays picklable,
    while lambdas/closures do not. The candle import is lazy so a
    forked/spawned child resolves it fresh. Never raises.
    """
    try:
        from chart_patterns import candles

        try:
            df = candles.fetch_for_timeframe(symbol, timeframe)
        except Exception:
            return None
        return _near52w_row(symbol, df)
    except Exception:
        return None


def _arm_computed(
    setup_id: str,
    setup: dict,
    *,
    universe: Optional[str] = None,
    timeframe: str = "1D",
    symbol: Optional[str] = None,
    max_gap: Optional[float] = None,
    use_processes: bool = False,
) -> list[dict]:
    """Armed rows for a computed setup (currently ``near_52w``).

    Screens the universe's 1D candles via :func:`run_symbols` — threads by
    default, worker processes only when ``use_processes=True`` (CLIs; the
    FastAPI ``/watch`` path must never fork per request, so ``arm`` defaults
    this to ``False``). Keeps rows with ``close_gap <= max_gap`` **or**
    ``touched``. Rows are ordered by ``close_gap`` ascending, so names already
    through the level (negative gap) rank first, then the nearest laggards;
    accumulation fields are carried for display/live, not the rank.

    Two cache levels under ``experiments/data/pattern_cache/watch/``: the
    full computed set per ``(scope, timeframe, session)`` (plus
    ``DETECTOR_VERSION``), and per-symbol detection results per
    ``(setup_id, symbol, timeframe, session, DETECTOR_VERSION)`` — so a
    re-run of the same screen on the same session is instant even for a new
    scope, and a session rollover or detector bump recomputes. The arm
    filter itself is applied after the cache read so gap overrides stay
    live. Never raises — returns ``[]`` on failure.
    """
    gap_max = float(max_gap) if max_gap is not None else float(setup.get("max_gap", 5.0))
    if symbol:
        symbols = (
            [symbol.upper()]
            if isinstance(symbol, str)
            else [str(s).upper() for s in symbol]
        )
        scope = "sym_" + "_".join(sorted(symbols))
    elif universe:
        try:
            from chart_patterns import universes

            symbols = [str(s).upper() for s in universes.get_universe(universe)]
        except Exception as exc:
            log.warning("breakout watch: unknown universe %r (%s)", universe, exc)
            return []
        if not symbols:
            return []
        scope = str(universe)
    else:
        return []

    session = _near52w_session()
    key = _near52w_cache_key(scope, timeframe)
    cached = _near52w_cache_read(key, session)
    if cached is None:
        from chart_patterns.parallel import max_workers as _max_workers

        rows_all: list[dict] = []
        detected: dict[str, Optional[dict]] = {}
        todo: list[str] = []
        for sym in symbols:
            hit, row = _detect_cache_read(setup_id, sym, timeframe, session)
            if hit:
                detected[sym] = row
            else:
                todo.append(sym)
        if todo:
            worker = functools.partial(_near52w_fetch_detect, timeframe=timeframe)
            if use_processes:
                pool_workers: int = _max_workers()
            else:
                pool_workers = min(_NEAR52W_WORKERS, len(todo))
            results = run_symbols(
                worker, todo, workers=pool_workers, use_processes=bool(use_processes)
            )
            for sym, row in zip(todo, results or []):
                detected[sym] = dict(row) if isinstance(row, dict) else None
                _detect_cache_write(setup_id, sym, timeframe, session, detected[sym])
        rows_all = [detected[s] for s in symbols if detected.get(s) is not None]
        _near52w_cache_write(key, session, rows_all)
        cached = rows_all
    return sorted(
        (r for r in cached if r.get("close_gap") is not None
         and (r["close_gap"] <= gap_max or bool(r.get("touched")))),
        key=lambda r: r["close_gap"],
    )


def _fetch_1d(candles, symbol: str):
    """One symbol's 1D frame for a computed arm; ``None`` on any failure."""
    try:
        return candles.fetch_for_timeframe(symbol, "1D")
    except Exception:
        return None


def arm(
    setup_id: str,
    *,
    universe: Optional[str] = None,
    timeframe: str = "1D",
    min_base_days: Optional[int] = None,
    max_range_pct: Optional[float] = None,
    symbol: Optional[str] = None,
    max_gap: Optional[float] = None,
    use_processes: bool = False,
) -> list[dict]:
    """Armed rows for ``setup_id``.

    ``pattern`` setups read the latest stored hits (see below); ``computed``
    setups (``near_52w``) screen daily candles directly via
    :func:`_arm_computed` — for those, the endpoint's ``max_range_pct``
    doubles as a ``max_gap`` override when no explicit ``max_gap`` is given
    (``min_base_days`` is ignored). ``use_processes`` enables worker
    processes for the computed screen (CLIs only): it defaults to ``False``
    (threads/sequential) so the FastAPI server never forks per request.
    Returns ``[]`` on any failure; raises ``ValueError`` only for an unknown
    setup.

    ``pattern`` setups read the latest store hits for the setup's
    ``source_pattern`` (via ``store.query_results`` with a ``pattern_id`` +
    ``timeframe`` filter, deduped), keep rows whose ``status`` is in the
    that pass the base/range gates, and returns one row per symbol (highest
    confidence). A ``confirmed`` hit is additionally armed when its break is
    fresh (stored close at/just above the box — see ``_fresh_confirmed``);
    stale ``confirmed`` breakouts far above the box stay excluded. Fresh-cross
    rows carry ``fresh=True`` (all other rows ``fresh=False``) so the live
    state machine can mark them ``triggered`` even though the last completed
    bar was already above the box. Returns ``[]`` when the store has no hits
    (never raises).
    """
    from chart_patterns import store

    setup = SETUPS.get(setup_id)
    if setup is None:
        raise ValueError(f"unknown setup {setup_id!r}")
    if setup.get("kind", "pattern") == "computed":
        try:
            return _arm_computed(
                setup_id,
                setup,
                universe=universe,
                timeframe=timeframe,
                symbol=symbol,
                max_gap=max_gap if max_gap is not None else max_range_pct,
                use_processes=use_processes,
            )
        except Exception as exc:
            log.warning("breakout watch: computed arm failed (%s)", exc)
            return []
    floor_days = int(min_base_days) if min_base_days is not None else int(setup["min_base_days"])
    ceiling_pct = float(max_range_pct) if max_range_pct is not None else float(setup["max_range_pct"])

    filters: dict = {"pattern_id": setup["source_pattern"], "timeframe": timeframe}
    if universe:
        filters["universe"] = universe
    if symbol:
        filters["symbol"] = [symbol.upper()] if isinstance(symbol, str) else [str(s).upper() for s in symbol]
    try:
        items, _total, _summary = store.query_results(filters, limit=_ARM_QUERY_LIMIT)
    except Exception as exc:
        log.warning("breakout watch: store query failed (%s)", exc)
        return []

    best: dict[str, dict] = {}
    for hit in items or []:
        try:
            base_days = hit.get("base_days")
            range_pct = hit.get("range_pct")
            if base_days is None or int(base_days) < floor_days:
                continue
            if range_pct is None or float(range_pct) > ceiling_pct:
                continue
            trigger = hit.get("breakout_level")
            if trigger is None:
                continue
            trigger = float(trigger)
            base_low = _base_low_from_hit(hit)
            if base_low is None:
                base_low = trigger * (1.0 - float(range_pct) / 100.0)
            status = hit.get("status") or ""
            if status in setup["statuses"]:
                fresh = False
            elif status == "confirmed" and _fresh_confirmed(hit, trigger, base_low):
                fresh = True
            else:
                continue
            row = {
                "symbol": str(hit.get("symbol") or "").upper(),
                "setup_id": setup_id,
                "trigger_level": trigger,
                "invalidate_level": float(base_low),
                "base_days": int(base_days),
                "range_pct": float(range_pct),
                "confidence": hit.get("confidence"),
                "status": hit.get("status"),
                "end_date": hit.get("end_date"),
                # Fresh-cross contract: True only for an armed ``confirmed``
                # hit whose stored close sits at/just above the box. ``live``
                # marks such a row ``triggered`` when the price holds above
                # the trigger, even though the last completed bar already
                # crossed it.
                "fresh": fresh,
            }
        except (TypeError, ValueError):
            continue
        if not row["symbol"]:
            continue
        prev = best.get(row["symbol"])
        if prev is None or (row["confidence"] or 0.0) > (prev["confidence"] or 0.0):
            best[row["symbol"]] = row
    return sorted(best.values(), key=lambda r: -(r["confidence"] or 0.0))


def _broker_token_data() -> Optional[dict]:
    """Shared Upstox broker token row (DB), else ``None``. Never raises."""
    try:
        from db.models import get_shared_broker_token

        return get_shared_broker_token("upstox")
    except Exception:
        return None


def _token() -> Optional[str]:
    """Upstox OAuth token: DB → ``.upstox_token.json`` → env. Never raises."""
    try:
        data = _broker_token_data()
        if data and data.get("access_token"):
            return data["access_token"]
    except Exception:
        pass
    try:
        token_file = Path(__file__).resolve().parent.parent / ".upstox_token.json"
        if token_file.exists():
            token = json.loads(token_file.read_text()).get("access_token")
            if token:
                return token
    except Exception:
        pass
    return os.getenv("UPSTOX_ACCESS_TOKEN")


def _upstox_token_expired() -> bool:
    """True when the DB OAuth token is older than its TTL (expired).

    Only the DB row carries a ``token_timestamp``; file/env tokens have no
    age signal and are treated as usable (``False``). Unknown/unparseable
    timestamps also yield ``False`` — the LTP call itself is the fallback
    detector via HTTP 401. Never raises.
    """
    try:
        data = _broker_token_data()
        ts = (data or {}).get("token_timestamp")
        if not ts:
            return False
        if isinstance(ts, datetime):
            when = ts
        else:
            text = str(ts).strip()
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            when = datetime.fromisoformat(text)
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - when).total_seconds()
        return age > _UPSTOX_TOKEN_TTL_SECONDS
    except Exception:
        return False


#: Optional OAuth refresh helpers, ``(module, fn names)``. Neither module
#: ships in this repo today (there is no ``upstox_auth.py`` /
#: ``upstox_auth_refresh.py`` and the broker row stores no refresh token),
#: so the lookup below is a seam: when such a helper exists it is reused,
#: otherwise the 401 path degrades to the tape fallback.
_REFRESH_HELPERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("upstox_auth_refresh", ("refresh_access_token", "refresh_token", "refresh")),
    ("upstox_auth", ("refresh_access_token", "refresh_token", "refresh")),
)


def _try_refresh_upstox_token() -> Optional[str]:
    """Best-effort Upstox OAuth refresh; new access token or ``None``.

    Reuses the first importable helper in ``_REFRESH_HELPERS``, passing the
    broker row's ``refresh_token`` when one is stored (else calling it
    bare). Accepts a plain token string or a ``{"access_token": ...}`` dict
    back. There is currently no refresh path in this repo, so this usually
    returns ``None`` and callers fall back to the tape. Never raises.
    """
    try:
        data = _broker_token_data() or {}
    except Exception:
        data = {}
    refresh_token = data.get("refresh_token")
    for mod_name, fn_names in _REFRESH_HELPERS:
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            continue
        for fn_name in fn_names:
            helper = getattr(mod, fn_name, None)
            if not callable(helper):
                continue
            try:
                if refresh_token:
                    try:
                        result = helper(refresh_token)
                    except TypeError:
                        result = helper()
                else:
                    result = helper()
            except Exception as exc:
                log.warning("breakout watch: token refresh helper failed (%s)", exc)
                continue
            try:
                if isinstance(result, dict):
                    result = result.get("access_token")
                if result:
                    return str(result)
            except Exception:
                continue
    return None


def _instrument_keys(symbols: list[str]) -> dict[str, str]:
    """Map trading symbols to Upstox instrument keys. Never raises."""
    try:
        from api.symbols import _load_instruments

        want = {str(s).upper() for s in symbols}
        out: dict[str, str] = {}
        for inst in _load_instruments():
            sym = inst.get("trading_symbol")
            if sym in want and inst.get("instrument_key"):
                out[sym] = inst["instrument_key"]
        return out
    except Exception:
        return {}


def _ltp_batch(instrument_keys: list[str], token: str):
    """One LTP request; the response or ``None`` on transport failure."""
    try:
        import requests
    except Exception:
        return None
    try:
        return requests.get(
            LTP_URL,
            params={"instrument_key": ",".join(instrument_keys)},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=15,
        )
    except Exception as exc:
        log.warning("breakout watch: LTP batch failed (%s)", exc)
        return None


def _ltp_prices(symbols: list[str]) -> dict[str, float]:
    """Batch LTP via Upstox V3 (OAuth). Returns ``{}`` on any failure.

    An expired DB token skips the doomed call outright; on HTTP 401 the
    access token is refreshed once (when a refresh path exists) and the
    failed batch is retried before giving up. Never raises.
    """
    if _upstox_token_expired():
        log.warning("breakout watch: OAuth token expired, skipping LTP (tape fallback)")
        return {}
    token = _token()
    if not token:
        return {}
    keys = _instrument_keys([str(s).upper() for s in symbols])
    if not keys:
        return {}
    reverse = {v: k for k, v in keys.items()}
    out: dict[str, float] = {}
    key_list = list(keys.values())
    refreshed = False
    try:
        i = 0
        while i < len(key_list):
            part = key_list[i : i + 400]
            resp = _ltp_batch(part, token)
            if resp is None:
                i += len(part)
                continue
            if resp.status_code == 401 and not refreshed:
                refreshed = True
                log.warning("breakout watch: LTP token expired (401), attempting refresh")
                new_token = _try_refresh_upstox_token()
                if new_token:
                    token = new_token
                    continue  # retry the same batch with the fresh token
                return out
            if resp.status_code == 401:
                log.warning("breakout watch: LTP token expired (401)")
                return out
            i += len(part)
            if resp.status_code != 200:
                continue
            try:
                data = (resp.json().get("data") or {})
            except Exception:
                continue
            for key, quote in data.items():
                try:
                    px = quote.get("last_price")
                    if px is not None and key in reverse:
                        out[reverse[key]] = float(px)
                except (TypeError, ValueError, AttributeError):
                    continue
    except Exception:
        pass
    return out


def _tape_price(symbol: str, timeframe: str = "1m") -> Optional[float]:
    """Latest close from the market-data tape (API-key auth). Never raises.

    Successful fetches are memoised per ``symbol|timeframe`` for
    ``_TAPE_CACHE_TTL_SECONDS`` so repeated polls (endpoint + CLI watching
    the same names) don't refetch every bar.
    """
    key = f"{str(symbol).upper()}|{timeframe}"
    try:
        now = time.monotonic()
        cached = _TAPE_CACHE.get(key)
        if cached is not None and now - cached[1] < _TAPE_CACHE_TTL_SECONDS:
            return cached[0]
    except Exception:
        now = time.monotonic()
    try:
        from chart_patterns import candles

        df = candles.fetch_for_timeframe(symbol, timeframe)
        if df is not None and not getattr(df, "empty", True):
            price = float(df["close"].iloc[-1])
            try:
                _TAPE_CACHE[key] = (price, now)
            except Exception:
                pass
            return price
    except Exception:
        pass
    return None


#: NSE session open in minutes since midnight IST (09:15) and session length
#: in minutes (09:15–15:30 = 375).
_SESSION_OPEN_MIN = 9 * 60 + 15
_SESSION_LEN_MIN = 375.0

#: Lower clamp on the session fraction: before 09:15 (or with an unreadable
#: clock) the expected-volume denominator uses 5% of the daily average so a
#: pre-open tape never divides by ~zero.
_VOL_ADJ_MIN_FRAC = 0.05

#: Memoised per-symbol ``vol_adj`` stays valid this long (seconds) so
#: repeated polls — endpoint + CLI watching the same names — don't refetch
#: the 1m tape and daily frame every bar. Both are disk-cached per session
#: underneath, so the fan-out is cheap even on a miss.
_VOL_ADJ_CACHE_TTL_SECONDS = 30.0

#: ``SYMBOL`` -> ``(vol_adj_or_None, monotonic_ts)``. Failures are cached
#: too (as ``None``) so a down tape doesn't hammer the fetcher each poll.
_VOL_ADJ_CACHE: dict[str, tuple[Optional[float], float]] = {}


def _vol_adj_session_fraction(now=None) -> float:
    """Elapsed NSE session as a fraction of the 09:15–15:30 day.

    ``(minutes_since_09:15_IST) / 375``, clamped to ``[0.05, 1.0]`` — 0.05
    pre-open, 1.0 at/after the close. Never raises.
    """
    try:
        if now is None:
            try:
                import config

                now = datetime.now(config.IST)
            except Exception:
                now = datetime.now(timezone.utc)
        mins = now.hour * 60 + now.minute + now.second / 60.0
        frac = (mins - _SESSION_OPEN_MIN) / _SESSION_LEN_MIN
    except Exception:
        return _VOL_ADJ_MIN_FRAC
    return min(1.0, max(_VOL_ADJ_MIN_FRAC, frac))


def _vol_adj_today(now=None):
    """IST calendar date the tape's "today" volume belongs to. Never raises."""
    try:
        if now is None:
            try:
                import config

                now = datetime.now(config.IST)
            except Exception:
                now = datetime.now(timezone.utc)
        return now.date()
    except Exception:
        try:
            import config

            return datetime.now(config.IST).date()
        except Exception:
            return datetime.now(timezone.utc).date()


def _vol_adj_one(symbol: str, now=None) -> Optional[float]:
    """One symbol's time-adjusted intraday relative volume, else ``None``.

    ``vol_adj = today_cum_volume / (avg_daily_volume_10d * session_fraction)``
    where ``today_cum_volume`` sums the 1m tape's volume for today's IST
    session, ``avg_daily_volume_10d`` is ``mean(volume.tail(10))`` of the 1D
    frame, and ``session_fraction`` is :func:`_vol_adj_session_fraction`.
    Never raises; ``None`` on any missing/empty/zero-denominator input.
    """
    try:
        from chart_patterns import candles

        try:
            df_1m = candles.fetch_for_timeframe(symbol, "1m")
        except Exception:
            return None
        try:
            df_1d = candles.fetch_for_timeframe(symbol, "1D")
        except Exception:
            return None
        if df_1m is None or getattr(df_1m, "empty", True):
            return None
        if df_1d is None or getattr(df_1d, "empty", True):
            return None
        if "volume" not in df_1m.columns or "volume" not in df_1d.columns:
            return None
        try:
            idx = df_1m.index
            try:
                if idx.tz is None:
                    idx_ist = idx.tz_localize("UTC").tz_convert("Asia/Kolkata")
                else:
                    idx_ist = idx.tz_convert("Asia/Kolkata")
            except Exception:
                idx_ist = idx
            today = _vol_adj_today(now)
            mask = [d == today for d in idx_ist.date]
            today_vol = float(df_1m["volume"][mask].fillna(0.0).sum())
        except Exception:
            return None
        try:
            avg10 = float(df_1d["volume"].tail(10).fillna(0.0).mean())
        except Exception:
            return None
        if not avg10 > 0:
            return None
        denom = avg10 * _vol_adj_session_fraction(now)
        if not denom > 0:
            return None
        return today_vol / denom
    except Exception:
        return None


def _vol_adj_cached(symbol: str, now=None) -> Optional[float]:
    """Memoised :func:`_vol_adj_one` per symbol (TTL ``30s``). Never raises."""
    key = str(symbol).upper()
    try:
        stamp = time.monotonic()
        hit = _VOL_ADJ_CACHE.get(key)
        if hit is not None and stamp - hit[1] < _VOL_ADJ_CACHE_TTL_SECONDS:
            return hit[0]
    except Exception:
        stamp = time.monotonic()
    val = _vol_adj_one(symbol, now)
    try:
        _VOL_ADJ_CACHE[key] = (val, stamp)
    except Exception:
        pass
    return val


def vol_adj_map(symbols: list[str], now=None) -> dict[str, float]:
    """Time-adjusted intraday relative volume per symbol (``vol_adj``).

    Fans out over the existing bounded tape pool (``_TAPE_WORKERS``); each
    leg is TTL-memoised via :func:`_vol_adj_cached`, so repeated polls are
    cheap. Symbols whose tape/daily fetch fails are simply absent (callers
    treat a missing entry as ``vol_adj=None``). Never raises.
    """
    syms = [str(s).upper() for s in (symbols or []) if str(s or "").strip()]
    out: dict[str, float] = {}
    if not syms:
        return out
    try:
        import functools as _functools

        worker = _functools.partial(_vol_adj_cached, now=now)
        workers = min(_TAPE_WORKERS, len(syms))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for sym, val in zip(syms, pool.map(worker, syms)):
                try:
                    if val is not None:
                        out[sym] = float(val)
                except (TypeError, ValueError):
                    continue
    except Exception as exc:
        log.warning("breakout watch: vol_adj fan-out failed (%s)", exc)
    return out


def _fetch_tv_metrics(symbols: list[str]) -> dict:
    """TradingView volume metrics keyed by symbol; ``{}`` on any failure.

    Module-level (not nested) so :func:`live` can run it concurrently with
    the tape fallback and ``vol_adj``. Never raises.
    """
    try:
        from chart_patterns.tv_prefilter import fetch_tv_volume_metrics

        return fetch_tv_volume_metrics(symbols) if symbols else {}
    except Exception as exc:
        log.warning("breakout watch: TV metrics failed (%s)", exc)
        return {}


def _fetch_vol_adj(symbols: list[str]) -> dict:
    """Time-adjusted intraday volume per symbol; ``{}`` on any failure.

    Module-level (not nested) so :func:`live` can run it concurrently with
    the tape fallback and the TV call. Never raises.
    """
    try:
        return vol_adj_map(symbols) if symbols else {}
    except Exception as exc:
        log.warning("breakout watch: vol_adj failed (%s)", exc)
        return {}


def _fetch_tape_missing(symbols: list[str]) -> dict[str, float]:
    """1m-tape prices for ``symbols`` via the bounded pool; ``{}`` on failure.

    Module-level (not nested) so :func:`live` can run it concurrently with
    the TV and ``vol_adj`` fetches. Never raises.
    """
    out: dict[str, float] = {}
    if not symbols:
        return out
    try:
        workers = min(_TAPE_WORKERS, len(symbols))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for sym, px in zip(symbols, pool.map(_tape_price, symbols)):
                if px is not None:
                    out[sym] = px
    except Exception as exc:
        log.warning("breakout watch: tape fallback failed (%s)", exc)
    return out


def live(rows: list[dict], *, min_rel_volume: float = 0.7) -> list[dict]:
    """Attach live price + time-adjusted volume to armed rows and classify each.

    ``state`` is ``"triggered"`` when ``ltp > trigger_level`` AND
    ``vol_adj >= min_rel_volume``, where ``vol_adj`` is today's cumulative
    1m-tape volume divided by the 10-day average daily volume scaled to the
    elapsed session (see :func:`_vol_adj_one`). ``min_rel_volume`` keeps its
    name for API compatibility but now gates ``vol_adj``, NOT TradingView's
    ``relative_volume_10d_calc`` — that field divides today's cumulative
    volume by the *full-day* average, so it reads ~0.0x all morning even for
    names trading at multiples of their normal intraday pace. The TV
    ``rel_volume`` is still attached as daily context. A ``fresh``-cross row
    (armed from a fresh ``confirmed`` break) holding above the trigger with
    unknown volume (``vol_adj is None``) is also ``"triggered"`` — the
    EOD-confirmed break plus price holding above the line is the signal when
    no volume measurement arrived. Otherwise ``"invalidated"`` when
    ``ltp < invalidate_level``; else ``"armed"``. Missing LTP symbols fall
    back to the 1m tape via a bounded thread pool (memoised, so repeated
    polls stay cheap). Never raises; a missing price yields ``ltp=None``
    and ``state="armed"``.
    """
    rows = [dict(r) for r in rows or []]
    symbols = [str(r.get("symbol") or "").upper() for r in rows if r.get("symbol")]
    try:
        prices = _ltp_prices(symbols)
    except Exception:
        prices = {}
    missing = [s for s in symbols if s not in prices]
    # The three legs are independent (tape prices, TV context, vol_adj gate)
    # so they run concurrently: at market hours each fans out over pooled
    # fetches and the serial sum (~50s for 20 rows) collapses to the slowest
    # leg. Each helper never raises (``{}`` on failure).
    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            fut_tape = pool.submit(_fetch_tape_missing, missing)
            fut_tv = pool.submit(_fetch_tv_metrics, symbols)
            fut_vol = pool.submit(_fetch_vol_adj, symbols)
            tape_prices = fut_tape.result()
            metrics = fut_tv.result()
            vols = fut_vol.result()
    except Exception as exc:
        log.warning("breakout watch: live fan-out failed (%s)", exc)
        tape_prices, metrics, vols = {}, {}, {}
    prices.update(tape_prices)

    out: list[dict] = []
    for row in rows:
        try:
            sym = str(row.get("symbol") or "").upper()
            ltp = prices.get(sym)
            rel = (metrics.get(sym) or {}).get("rel_volume")
            try:
                rel = float(rel) if rel is not None else None
            except (TypeError, ValueError):
                rel = None
            va = vols.get(sym)
            try:
                va = float(va) if va is not None else None
            except (TypeError, ValueError):
                va = None
            trigger = row.get("trigger_level")
            invalidate = row.get("invalidate_level")
            try:
                pct = (float(ltp) - float(trigger)) / float(trigger) * 100.0 if ltp is not None and trigger else None
            except (TypeError, ValueError, ZeroDivisionError):
                pct = None
            row["ltp"] = float(ltp) if ltp is not None else None
            row["rel_volume"] = rel
            row["vol_adj"] = va
            row["pct_to_trigger"] = round(pct, 2) if pct is not None else None
            above = (
                ltp is not None
                and trigger is not None
                and float(ltp) > float(trigger)
            )
            if above and va is not None and va >= float(min_rel_volume):
                row["state"] = "triggered"
            elif above and va is None and bool(row.get("fresh")):
                # Fresh EOD-confirmed cross holding above the trigger but no
                # volume measurement arrived: the break itself is the signal.
                row["state"] = "triggered"
            elif ltp is not None and invalidate is not None and float(ltp) < float(invalidate):
                row["state"] = "invalidated"
            else:
                row["state"] = "armed"
        except Exception:
            row.setdefault("ltp", None)
            row.setdefault("rel_volume", None)
            row.setdefault("vol_adj", None)
            row.setdefault("pct_to_trigger", None)
            row["state"] = "armed"
        out.append(row)
    return out


#: Precomputed watch payloads: ``(setup, universe, timeframe)`` ->
#: ``(payload, monotonic_ts)``. A background refresher (see
#: ``api_server_fastapi.watch_snapshot_task``) rebuilds these every minute
#: during market hours so ``GET /watch`` can serve a fresh snapshot instead
#: of fanning out ~50s of tape/TV/vol_adj fetches inside the request.
#: ``arm`` is disk-cached per session underneath, so rebuilds are cheap.
_SNAPSHOT: dict[tuple, tuple[dict, float]] = {}

#: Snapshot scopes: every setup × these universes × ``"1D"``.
_SNAPSHOT_UNIVERSES: tuple[str, ...] = ("nifty500", "nifty50")
#: Cap the armed rows per snapshot combo — ``live()`` is ~2s/symbol under
#: market-hours contention, so an unbounded 200-row combo would take minutes.
_SNAPSHOT_MAX_ROWS = 40
_SNAPSHOT_TIMEFRAME = "1D"

#: Redis mirror TTL (seconds) so a reload/restart keeps the last snapshot.
_SNAPSHOT_REDIS_TTL = 300


def _snapshot_key(setup: str, universe: Optional[str], timeframe: str) -> str:
    """Redis key for one snapshot combo (mirrors :mod:`chart_patterns.jobs`)."""
    return f"watch_snapshot:{setup}:{universe}:{timeframe}"


def _snapshot_now_iso() -> str:
    """Now as an ISO string (IST when available). Never raises."""
    try:
        import config

        return datetime.now(config.IST).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def _mirror_snapshot(key: str, payload: dict, ts: float) -> None:
    """Best-effort Redis mirror of one snapshot (restart survival)."""
    try:
        from cache.redis_client import cache_set

        cache_set(key, {"payload": payload, "ts": ts}, ttl=_SNAPSHOT_REDIS_TTL)
    except Exception:
        pass


def _read_mirrored_snapshot(key: str) -> tuple[Optional[dict], Optional[float]]:
    """Mirrored ``(payload, ts)`` from Redis; ``(None, None)`` on miss."""
    try:
        from cache.redis_client import cache_get

        cached = cache_get(key)
        if isinstance(cached, dict):
            payload = cached.get("payload")
            ts = cached.get("ts")
            if isinstance(payload, dict) and isinstance(ts, (int, float)):
                return payload, float(ts)
    except Exception:
        pass
    return None, None


def refresh_snapshot() -> int:
    """Rebuild every snapshot combo and return how many were stored.

    For each setup in :data:`SETUPS` × :data:`_SNAPSHOT_UNIVERSES` ×
    ``"1D"``: :func:`arm` (already disk-cached) then :func:`live` with the
    setup's default ``min_rel_volume``. Each payload is
    ``{"setup", "min_rel_volume", "updated_at", "items"}`` and is stored in
    :data:`_SNAPSHOT` plus mirrored to Redis (best-effort). A failing combo
    is logged and skipped — never raises the whole refresh. Never raises.
    """
    built = 0
    try:
        combos = [
            (setup_id, universe, _SNAPSHOT_TIMEFRAME)
            for setup_id in SETUPS
            for universe in _SNAPSHOT_UNIVERSES
        ]
    except Exception:
        return 0
    for setup_id, universe, timeframe in combos:
        try:
            setup = SETUPS.get(setup_id) or {}
            try:
                min_rel_volume = float(setup.get("default_min_rel_volume", 0.7))
            except (TypeError, ValueError):
                min_rel_volume = 0.7
            rows = arm(setup_id, universe=universe, timeframe=timeframe)
            # Cap the snapshot size: live() is ~2s/symbol under market-hours
            # contention, so a 200-row combo would take minutes and starve the
            # single-worker server. The watch UI only ever shows the nearest
            # names anyway.
            if len(rows) > _SNAPSHOT_MAX_ROWS:
                rows = rows[:_SNAPSHOT_MAX_ROWS]
            items = live(rows, min_rel_volume=min_rel_volume)
            payload = {
                "setup": setup_id,
                "min_rel_volume": min_rel_volume,
                "updated_at": _snapshot_now_iso(),
                "items": items,
            }
        except Exception as exc:
            log.warning("breakout watch: snapshot combo %r/%r failed (%s)", setup_id, universe, exc)
            continue
        try:
            ts = time.monotonic()
            _SNAPSHOT[(setup_id, universe, timeframe)] = (payload, ts)
            _mirror_snapshot(_snapshot_key(setup_id, universe, timeframe), payload, ts)
            built += 1
        except Exception as exc:
            log.warning("breakout watch: snapshot store failed (%s)", exc)
    return built


def get_snapshot(
    setup: str,
    universe: Optional[str] = None,
    timeframe: str = "1D",
    max_age_seconds: float = 90,
) -> Optional[dict]:
    """Cached snapshot payload, or ``None`` when missing/stale.

    Returns the payload only when its age is under ``max_age_seconds``;
    otherwise ``None`` (caller falls through to a live ``arm`` + ``live``).
    On an in-memory miss the Redis mirror is consulted (restart survival).
    Never raises.
    """
    try:
        max_age = float(max_age_seconds)
    except (TypeError, ValueError):
        max_age = 90.0
    try:
        hit = _SNAPSHOT.get((setup, universe, timeframe))
        if hit is not None:
            payload, ts = hit
            if isinstance(payload, dict) and time.monotonic() - float(ts) < max_age:
                return payload
    except Exception:
        pass
    # Missing or stale in memory: consult the Redis mirror (restart survival).
    try:
        payload, ts = _read_mirrored_snapshot(_snapshot_key(setup, universe, timeframe))
        if payload is not None and ts is not None and time.monotonic() - ts < max_age:
            try:
                _SNAPSHOT[(setup, universe, timeframe)] = (payload, ts)
            except Exception:
                pass
            return payload
    except Exception:
        pass
    return None
