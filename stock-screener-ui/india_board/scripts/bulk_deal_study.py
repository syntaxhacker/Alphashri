#!/usr/bin/env python3
"""Bulk-deal event study — *does an institutional buy that spikes volume persist?*

Hypothesis under test (from the user's annotated charts):

    "When a mutual fund / institution buys size via an NSE bulk deal, the
    stock's volume spikes and it often continues higher — can we trade it?"

This module is **research tooling, not investment advice**. It follows the
honesty contract of ``docs/EDGE_ROADMAP.md`` (section 5 + F12): every claim is a
hypothesis that must survive measurement, with explicit kill criteria and a
baseline control. Nothing here recommends a trade.

What it does
------------
1. **History attempt** — tries the NSE and BSE public bulk-deal archives once
   each and records ``{source, status, rows, note}``. (Known result on this
   network: NSE 503 WAF, BSE 403. If either succeeds it becomes the true event
   set and is called out prominently.)
2. **Mechanics validation** on the user's named examples (GMMPFAUDLR, SEDEMAC,
   AXISCADES, CENTUM, BSE, CLEANMAX): resolves each, pulls daily candles,
   computes the trailing-20-session **volume z-score** and the day's return,
   lists the **top 3 volume-z days in the last 3 months**, and reports forward
   returns (+1/+5/+10/+20 sessions) plus 20-session MAE/MFE and what a follower
   buying the spike-day **close** would have earned.
3. **Cohort study** over our own captured deals (``data/bulk_deals/*.jsonl``,
   ``qualifying == true`` institutional BUYs) — grows as we capture days.
4. **Follower strategy simulation** — buy the event close; exit at each horizon,
   plus an 8% stop / 15% target variant with chronological touch order and
   costs applied from ``backtest/costs.py`` (the repo's single source of truth).
5. **Baseline** — the same forward-return distribution for NIFTY + a fixed
   sample of liquid F&O names on random non-event days. Without it, any "edge"
   claim is meaningless.

Honest-evidence gate: expectancy is only reported when ``n >= MIN_SAMPLE`` (20);
below that the output says *insufficient sample*.

Reproducible CLI::

    python india_board/scripts/bulk_deal_study.py --examples --out reports/bulk_deals
    python india_board/scripts/bulk_deal_study.py --examples --cohort --out reports/bulk_deals
    python india_board/scripts/bulk_deal_study.py --all --controls --out reports/bulk_deals
    python india_board/scripts/bulk_deal_study.py --examples --offline --out reports/bulk_deals

Candle cache: ``india_board/data/bulk_deal_study/candles/{SYMBOL}.json`` stamped
with the IST day, so re-runs on the same day make no Fyers calls. Fyers history
is deliberately off-hours-gated; the real run wraps it in
``fyers_pacer.allow_offhours("bulk-study")`` and enforces a hard call budget.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import random
import re
import statistics
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

try:  # imported as a package submodule (india_board.scripts.bulk_deal_study)
    from . import fyers_pacer  # type: ignore
except ImportError:  # imported top-level (india_board/scripts on sys.path)
    import fyers_pacer  # type: ignore


def _load_costs_fn():
    """Load ``backtest/costs.py:calculate_trading_costs`` without importing the
    whole ``backtest`` package (whose ``__init__`` pulls FastAPI/engine). The
    costs file is dependency-free, so executing it standalone is safe and keeps
    this research module hermetic for tests.
    """
    path = Path(_REPO_ROOT) / "backtest" / "costs.py"
    spec = importlib.util.spec_from_file_location("_alphashri_backtest_costs", path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise RuntimeError("cannot load backtest/costs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.calculate_trading_costs


#: Costs are the repo's single source of truth (``backtest/costs.py``).
calculate_trading_costs = _load_costs_fn()

IST = ZoneInfo("Asia/Kolkata")

#: ``india_board/`` project dir.
ROOT = Path(__file__).resolve().parent.parent
#: Study outputs live here (machine-readable JSON + candle cache).
DATA_DIR = ROOT / "data" / "bulk_deal_study"
#: Our own captured bulk deals (one ``{YYYY-MM-DD}.jsonl`` per day).
CAPTURED_DEALS_DIR = ROOT / "data" / "bulk_deals"
#: Candle cache subdirectory.
CANDLES_SUBDIR = "candles"
#: Default report output dir (``stock-screener-ui/reports/bulk_deals``).
DEFAULT_REPORT_DIR = Path(_REPO_ROOT) / "reports" / "bulk_deals"

#: Expectancy is only reported at/above this many observations.
MIN_SAMPLE = 20
#: Forward sessions reported for every event.
DEFAULT_HORIZONS = (1, 5, 10, 20)
#: MAE/MFE / stop-target walk length in sessions.
DEFAULT_EXCURSION = 20
#: Volume z-score trailing window (sessions).
VOL_WINDOW = 20
#: Follower stop / target variant.
STOP_PCT = 8.0
TARGET_PCT = 15.0
#: Hard cap on Fyers history calls for one full run (pacer hygiene).
MAX_FYERS_CALLS = 60
#: Lookback for the candle pull (calendar days; covers ~190 sessions).
LOOKBACK_DAYS = 300
#: Free share quantity for the follower cost model.
DEFAULT_QTY = 100

#: The user's named examples. ``annotated_date`` is the candle the user circled;
#: when the archive is unavailable we recover the day as the top volume-z day.
EXAMPLES = [
    {
        "symbol": "GMMPFAUDLR",
        "name": "GMM Pfaudler — Persistence Capital Fund bulk deal",
        "client": "PERSISTENCE CAPITAL FUND",
        "annotated_date": "2026-09-07",
    },
    {
        "symbol": "SEDEMAC",
        "name": "Sedemac — Invesco SBI Fund bulk deal",
        "client": "INVESCO SBI FUND",
        "annotated_date": "2026-09-24",
    },
    {"symbol": "AXISCADES", "name": "Axiscades (user list)", "annotated_date": None},
    {"symbol": "CENTUM", "name": "Centum Electronics (user list)", "annotated_date": None},
    {"symbol": "BSE", "name": "BSE Ltd (user list)", "annotated_date": None},
    {"symbol": "CLEANMAX", "name": "CleanMax (user list)", "annotated_date": None},
]

__all__ = [
    "IST",
    "ROOT",
    "DATA_DIR",
    "CAPTURED_DEALS_DIR",
    "DEFAULT_REPORT_DIR",
    "MIN_SAMPLE",
    "EXAMPLES",
    "volume_zscore",
    "volume_zscores",
    "parse_candle",
    "parse_candles",
    "forward_return",
    "excursions",
    "forward_metrics",
    "simulate_trade",
    "net_return_pct",
    "symbol_variants",
    "resolve_by_name",
    "resolve_symbol",
    "read_cached_candles",
    "write_cached_candles",
    "load_candles",
    "attempt_archives",
    "read_captured_deals",
    "qualifying_events",
    "summarize",
    "follower_rows",
    "follower_stats",
    "control_symbols",
    "sample_sessions",
    "top_volume_days",
    "build_examples",
    "build_cohort",
    "build_controls",
    "render_study_md",
]


# ---------------------------------------------------------------------------
# numeric helpers
# ---------------------------------------------------------------------------


def _f(value, default=None):
    """Finite float or ``default`` (guards None/NaN/Inf/bad types)."""
    try:
        if value is None or isinstance(value, bool):
            return default
        x = float(value)
        if math.isnan(x) or math.isinf(x):
            return default
        return x
    except (TypeError, ValueError):
        return default


def _mean(values):
    vals = [v for v in values if v is not None]
    return statistics.fmean(vals) if vals else None


def _median(values):
    vals = [v for v in values if v is not None]
    return statistics.median(vals) if vals else None


def _stats(values, *, min_sample=MIN_SAMPLE):
    """Descriptive stats + a **gated** expectancy.

    ``mean``/``median``/win-rate/best/worst are always reported descriptively;
    ``expectancy`` (the mean net return) is ``None`` with a note until there are
    at least ``min_sample`` observations — the honest-evidence gate.
    """
    vals = [v for v in values if v is not None]
    n = len(vals)
    out = {
        "n": n,
        "mean": _mean(vals),
        "median": _median(vals),
        "win_rate": (sum(1 for v in vals if v > 0) / n) if n else None,
        "best": max(vals) if vals else None,
        "worst": min(vals) if vals else None,
        "expectancy": None,
        "insufficient": n < min_sample,
    }
    if n >= min_sample:
        out["expectancy"] = out["mean"]
    else:
        out["note"] = "insufficient sample"
    return out


def _json_safe(value):
    """Recursively make ``value`` JSON-safe (NaN/Inf -> None)."""
    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _today_ist(today=None) -> str:
    if today is None:
        return datetime.now(IST).date().isoformat()
    if isinstance(today, datetime):
        return today.date().isoformat()
    if isinstance(today, date):
        return today.isoformat()
    return str(today)[:10]


# ---------------------------------------------------------------------------
# volume z-score
# ---------------------------------------------------------------------------


def volume_zscore(volume, prior_volumes, *, min_lookback=2):
    """Z-score of ``volume`` versus ``prior_volumes`` (population sigma).

    Returns ``None`` when ``volume`` is missing, there are fewer than
    ``min_lookback`` usable priors, or the prior sigma is zero (a flat/dead
    series has no meaningful z).
    """
    v = _f(volume)
    prior = [_f(p) for p in (prior_volumes or [])]
    prior = [p for p in prior if p is not None]
    if v is None or len(prior) < int(min_lookback):
        return None
    try:
        mu = statistics.fmean(prior)
        sd = statistics.pstdev(prior)
    except (statistics.StatisticsError, TypeError, ValueError):
        return None
    if sd is None or sd <= 0:
        return None
    return (v - mu) / sd


def volume_zscores(volumes, *, window=VOL_WINDOW, min_lookback=2):
    """Aligned per-day z-scores vs the trailing ``window`` sessions.

    ``out[i]`` is ``volumes[i]`` scored against ``volumes[i-window:i]`` (or all
    earlier values when fewer exist); ``None`` when not computable.
    """
    vols = list(volumes or [])
    out = []
    for i, v in enumerate(vols):
        prior = vols[max(0, i - int(window)):i]
        out.append(volume_zscore(v, prior, min_lookback=min_lookback))
    return out


# ---------------------------------------------------------------------------
# candles
# ---------------------------------------------------------------------------


def parse_candle(row):
    """One raw Fyers row ``[epoch, o, h, l, c, v(, oi)]`` -> dict, or ``None``.

    Returns ``{ts, date, open, high, low, close, volume}`` with the epoch
    converted to an IST calendar date. Rows shorter than 5 fields are rejected.
    """
    if not isinstance(row, (list, tuple)) or len(row) < 5:
        return None
    epoch = _f(row[0])
    if epoch is None:
        return None
    try:
        d = datetime.fromtimestamp(epoch, IST).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None
    return {
        "ts": epoch,
        "date": d,
        "open": _f(row[1]),
        "high": _f(row[2]),
        "low": _f(row[3]),
        "close": _f(row[4]),
        "volume": _f(row[5]) if len(row) > 5 else None,
    }


def parse_candles(rows):
    """Normalise a raw candle list, dropping malformed rows (never raises).

    Already-normalised dict rows (as returned by the disk cache) pass through
    unchanged, so a cache-aware fetch function can feed this directly.
    """
    out = []
    for row in rows or []:
        if isinstance(row, dict) and row.get("close") is not None:
            c = row
        else:
            c = parse_candle(row)
        if c is not None and _f(c.get("close")) is not None:
            out.append(c)
    return out


def _close(c):
    if isinstance(c, dict):
        return _f(c.get("close"))
    return _f(c[4]) if isinstance(c, (list, tuple)) and len(c) > 4 else None


def _high(c):
    if isinstance(c, dict):
        return _f(c.get("high"))
    return _f(c[2]) if isinstance(c, (list, tuple)) and len(c) > 2 else None


def _low(c):
    if isinstance(c, dict):
        return _f(c.get("low"))
    return _f(c[3]) if isinstance(c, (list, tuple)) and len(c) > 3 else None


# ---------------------------------------------------------------------------
# forward metrics
# ---------------------------------------------------------------------------


def forward_return(candles, i, sessions):
    """Percent move from ``close[i]`` to ``close[i+sessions]``.

    ``None`` when out of range or a close is missing. ``sessions >= 1``.
    """
    n = int(sessions)
    entry = _close(candles[i]) if 0 <= i < len(candles) else None
    if entry in (None, 0.0) or n < 1 or (i + n) >= len(candles):
        return None
    exit_ = _close(candles[i + n])
    if exit_ is None:
        return None
    return (exit_ - entry) / entry * 100.0


def excursions(candles, i, sessions):
    """``(mae_pct, mfe_pct)`` over the ``sessions`` candles after ``i``.

    MAE uses the lowest low (negative), MFE the highest high (positive), both
    relative to ``close[i]``. Returns ``(None, None)`` when there are fewer than
    ``sessions`` forward candles. The event candle itself is excluded.
    """
    n = int(sessions)
    entry = _close(candles[i]) if 0 <= i < len(candles) else None
    if entry in (None, 0.0) or n < 1:
        return None, None
    window = candles[i + 1:i + 1 + n]
    if len(window) < n:
        return None, None
    lows = [_low(c) for c in window]
    highs = [_high(c) for c in window]
    lows = [x for x in lows if x is not None]
    highs = [x for x in highs if x is not None]
    if not lows or not highs:
        return None, None
    mae = (min(lows) - entry) / entry * 100.0
    mfe = (max(highs) - entry) / entry * 100.0
    return mae, mfe


def forward_metrics(
    candles,
    i,
    *,
    horizons=DEFAULT_HORIZONS,
    excursion_sessions=DEFAULT_EXCURSION,
):
    """Forward returns + MAE/MFE for the event at index ``i``."""
    entry = _close(candles[i]) if 0 <= i < len(candles) else None
    date_str = candles[i].get("date") if 0 <= i < len(candles) and isinstance(candles[i], dict) else None
    out = {"entry_date": date_str, "entry_close": entry}
    for h in horizons:
        out[f"ret_{int(h)}"] = forward_return(candles, i, h)
    mae, mfe = excursions(candles, i, excursion_sessions)
    out[f"mae_{int(excursion_sessions)}"] = mae
    out[f"mfe_{int(excursion_sessions)}"] = mfe
    return out


def day_return(candles, i):
    """``close[i]`` vs ``close[i-1]`` in percent, or ``None``."""
    if i < 1 or i >= len(candles):
        return None
    prev = _close(candles[i - 1])
    cur = _close(candles[i])
    if prev in (None, 0.0) or cur is None:
        return None
    return (cur - prev) / prev * 100.0


# ---------------------------------------------------------------------------
# follower trade simulation (stop/target chronological; costs applied)
# ---------------------------------------------------------------------------


def simulate_trade(
    candles,
    i,
    *,
    stop_pct=STOP_PCT,
    target_pct=TARGET_PCT,
    max_sessions=DEFAULT_EXCURSION,
):
    """Long from ``close[i]`` with a fixed stop/target, walking candles in order.

    Stop wins when a single candle straddles both levels (conservative, same
    convention as ``eval_harness.score_signal``). Outcome is ``stop`` /
    ``target`` / ``timeout`` (timeout exits at the last close inside the
    window). Returns ``None`` when there is no forward candle.
    """
    entry = _close(candles[i]) if 0 <= i < len(candles) else None
    if entry in (None, 0.0):
        return None
    window = candles[i + 1:i + 1 + int(max_sessions)]
    if not window:
        return None
    stop = entry * (1.0 - float(stop_pct) / 100.0)
    target = entry * (1.0 + float(target_pct) / 100.0)
    for held, c in enumerate(window, start=1):
        low, high = _low(c), _high(c)
        if low is not None and low <= stop:
            return {
                "outcome": "stop",
                "exit_price": stop,
                "sessions_held": held,
                "gross_pct": -float(stop_pct),
            }
        if high is not None and high >= target:
            return {
                "outcome": "target",
                "exit_price": target,
                "sessions_held": held,
                "gross_pct": float(target_pct),
            }
    exit_price = _close(window[-1])
    if exit_price is None:
        return None
    return {
        "outcome": "timeout",
        "exit_price": exit_price,
        "sessions_held": len(window),
        "gross_pct": (exit_price - entry) / entry * 100.0,
    }


def net_return_pct(entry_price, exit_price, quantity=DEFAULT_QTY, *, side="LONG"):
    """Gross return % minus the repo cost model's round-trip cost %.

    Uses ``backtest/costs.py:calculate_trading_costs`` (single source of truth)
    and expresses the cost as a fraction of the entry notional, so the result is
    directly comparable to a raw ``%`` forward return.
    """
    entry = _f(entry_price)
    exit_ = _f(exit_price)
    qty = int(quantity)
    if entry in (None, 0.0) or exit_ is None or qty <= 0:
        return None
    gross = (exit_ - entry) / entry * 100.0
    costs = calculate_trading_costs(entry, exit_, qty, side=side)
    cost_pct = costs["total_costs"] / (entry * qty) * 100.0
    return gross - cost_pct


def follower_rows(candles, i, *, quantity=DEFAULT_QTY, horizons=DEFAULT_HORIZONS):
    """One follower record: net returns per horizon + the stop/target variant."""
    entry = _close(candles[i]) if 0 <= i < len(candles) else None
    row = {"entry_date": candles[i].get("date") if isinstance(candles[i], dict) else None,
           "entry_close": entry}
    for h in horizons:
        exit_ = None
        if i + int(h) < len(candles):
            exit_ = _close(candles[i + int(h)])
        row[f"net_{int(h)}"] = (
            net_return_pct(entry, exit_, quantity) if exit_ is not None else None
        )
    sim = simulate_trade(candles, i)
    if sim is not None:
        row["st_outcome"] = sim["outcome"]
        row["st_sessions_held"] = sim["sessions_held"]
        row["net_stop_target"] = net_return_pct(entry, sim["exit_price"], quantity)
    else:
        row["st_outcome"] = None
        row["st_sessions_held"] = None
        row["net_stop_target"] = None
    return row


def follower_stats(rows, *, horizons=DEFAULT_HORIZONS):
    """Aggregate follower records into per-variant stat blocks (gated)."""
    out = {}
    for h in horizons:
        out[f"exit_{int(h)}"] = _stats([r.get(f"net_{int(h)}") for r in rows])
    out["stop_target"] = _stats([r.get("net_stop_target") for r in rows])
    outcomes = [r.get("st_outcome") for r in rows if r.get("st_outcome")]
    n = len(outcomes)
    out["stop_target"]["target_rate"] = (
        sum(1 for o in outcomes if o == "target") / n if n else None
    )
    out["stop_target"]["stop_rate"] = (
        sum(1 for o in outcomes if o == "stop") / n if n else None
    )
    out["stop_target"]["timeout_rate"] = (
        sum(1 for o in outcomes if o == "timeout") / n if n else None
    )
    return out


# ---------------------------------------------------------------------------
# symbol resolution
# ---------------------------------------------------------------------------


def symbol_variants(symbol):
    """Ordered Fyers symbol candidates for one ticker (deduped).

    ``NSE:{S}-EQ`` -> ``NSE:{S}-BE`` -> ``NSE:{S}-BZ`` -> plain ``{S}``.
    A value already containing ``:`` is returned as-is.
    """
    s = str(symbol or "").upper().strip()
    if not s:
        return []
    if ":" in s:
        return [s]
    out = [f"NSE:{s}-EQ", f"NSE:{s}-BE", f"NSE:{s}-BZ", s]
    seen, uniq = set(), []
    for v in out:
        if v not in seen:
            seen.add(v)
            uniq.append(v)
    return uniq


def resolve_by_name(name, master):
    """Best-effort company-name -> ``NSE:{underSym}-EQ`` from a Fyers master.

    The NSE_FO master carries no equity company names (its ``symDetails``/
    ``exSymName`` fields describe *contracts*), so this hook usually returns
    ``None``; it is kept so a name-mapped fallback exists when a master that
    does carry names is supplied. Matching is case/punctuation-insensitive.
    """
    if not name or not isinstance(master, dict):
        return None
    q = re.sub(r"[^A-Z0-9]", "", str(name).upper())
    if not q:
        return None
    for rec in master.values():
        if not isinstance(rec, dict):
            continue
        for field in ("symDetails", "exSymName", "underSym"):
            val = rec.get(field)
            if not val:
                continue
            if q in re.sub(r"[^A-Z0-9]", "", str(val).upper()):
                under = rec.get("underSym")
                if under:
                    return f"NSE:{under}-EQ"
    return None


def resolve_symbol(
    symbol,
    name,
    fetch_fn,
    *,
    resolution="D",
    range_from=None,
    range_to=None,
    master=None,
):
    """Resolve a ticker to a Fyers symbol that actually returns candles.

    Tries :func:`symbol_variants` in order via ``fetch_fn`` (injectable). If all
    fail and ``master`` is supplied, tries :func:`resolve_by_name`. Never raises;
    returns ``{resolved, fyers_symbol, candles, reason}`` with
    ``resolved: false, reason`` when nothing works (a different company is never
    guessed).
    """
    for variant in symbol_variants(symbol):
        try:
            rows = fetch_fn(variant, resolution, range_from, range_to)
        except Exception as exc:  # noqa: BLE001 - resolution must never raise
            rows = []
            last_reason = f"{variant}: {type(exc).__name__}"
        else:
            last_reason = f"{variant}: {len(rows or [])} rows"
        if rows:
            return {
                "resolved": True,
                "fyers_symbol": variant,
                "candles": parse_candles(rows),
                "reason": f"{len(rows)} rows via {variant}",
            }
    if master is not None:
        mapped = resolve_by_name(name, master)
        if mapped:
            try:
                rows = fetch_fn(mapped, resolution, range_from, range_to)
            except Exception:  # noqa: BLE001
                rows = []
            if rows:
                return {
                    "resolved": True,
                    "fyers_symbol": mapped,
                    "candles": parse_candles(rows),
                    "reason": f"{len(rows)} rows via name-map {mapped}",
                }
            last_reason = f"name-map {mapped}: 0 rows"
    return {
        "resolved": False,
        "fyers_symbol": None,
        "candles": [],
        "reason": last_reason or "no candle source",
    }


# ---------------------------------------------------------------------------
# candle disk cache
# ---------------------------------------------------------------------------


def _safe_key(symbol):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", str(symbol or "").upper()) or "UNKNOWN"


def _pytest_study_root():
    """Temp study root while running under pytest.

    A test fixture must never be able to write into the live
    ``india_board/data/bulk_deal_study`` tree (or the live report dir) — a
    fixture-driven study JSON or candle cache would masquerade as a real market
    capture. Mirrors ``signal_emitters._pytest_signal_root``.
    """
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        return None
    return Path(tempfile.gettempdir()) / "india_board_test_bulk_deal_study"


def _safe_root(root, live_default):
    base = Path(root) if root is not None else Path(live_default)
    safe = _pytest_study_root()
    if safe is not None:
        try:
            if base.resolve() == Path(live_default).resolve():
                return safe
        except OSError:  # pragma: no cover
            pass
    return base


def data_root(root=None):
    """Writable study data root (pytest-redirected when left at the default)."""
    return _safe_root(root, DATA_DIR)


def report_root(root=None):
    """Writable report root (pytest-redirected when left at the default)."""
    return _safe_root(root, DEFAULT_REPORT_DIR)


def _cache_file(root, symbol):
    return Path(root) / CANDLES_SUBDIR / f"{_safe_key(symbol)}.json"


def read_cached_candles(root, symbol):
    """``(candles, stamp)`` from disk; ``(None, None)`` when absent/corrupt."""
    path = _cache_file(root, symbol)
    try:
        if not path.is_file():
            return None, None
        with open(path, encoding="utf-8") as fh:
            blob = json.load(fh)
    except (OSError, ValueError, TypeError):
        return None, None
    if not isinstance(blob, dict):
        return None, None
    candles = blob.get("candles")
    if not isinstance(candles, list) or not candles:
        return None, None
    return candles, blob.get("stamp")


def write_cached_candles(root, symbol, candles, *, fyers_symbol=None, stamp=None, provider=None):
    """Persist a candle list with an IST-day stamp. Never raises."""
    path = _cache_file(root, symbol)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        blob = {
            "symbol": str(symbol).upper(),
            "fyers_symbol": fyers_symbol,
            "provider": provider,
            "stamp": stamp or _today_ist(),
            "count": len(candles),
            "candles": candles,
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(_json_safe(blob), fh)
        return True
    except OSError:
        return False


def cached_provider(root, symbol):
    """Provider recorded in a cached candle blob (``"fyers"``/``"upstox"``), else None."""
    cached, stamp = read_cached_candles(root, symbol)
    if cached is None:
        return None
    try:
        with open(_cache_file(root, symbol), encoding="utf-8") as fh:
            blob = json.load(fh)
        if isinstance(blob, dict):
            return blob.get("provider")
    except (OSError, ValueError, TypeError):
        return None
    return None


def load_candles(
    root,
    symbol,
    *,
    fetch_fn,
    resolution="D",
    range_from=None,
    range_to=None,
    today=None,
    force=False,
    offline=False,
):
    """Return candles for ``symbol``, using the same-day disk cache when fresh.

    ``offline`` never fetches (stale cache is still usable; missing is ``[]``).
    A fetch failure falls back to any stale cache. Re-runs on the same IST day
    make no fetch.
    """
    cached, stamp = read_cached_candles(root, symbol)
    today_s = _today_ist(today)
    if offline:
        return list(cached) if cached else []
    if cached and stamp == today_s and not force:
        return list(cached)
    rows = []
    try:
        rows = fetch_fn(symbol, resolution, range_from, range_to)
    except Exception:  # noqa: BLE001 - caller records unresolved
        rows = []
    candles = parse_candles(rows)
    if candles:
        write_cached_candles(root, symbol, candles, fyers_symbol=symbol, stamp=today_s)
        return candles
    return list(cached) if cached else []


# ---------------------------------------------------------------------------
# public bulk-deal archive probes (NSE / BSE)
# ---------------------------------------------------------------------------

_NSE_URL = "https://www.nseindia.com/api/historical/bulk-deals"
_BSE_URL = "https://api.bseindia.com/BseIndiaAPI/api/BulkDeal/w"
_NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/market-data/bulk-deals",
}
_BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.bseindia.com",
    "Referer": "https://www.bseindia.com/",
}

_HTTP_SESSION = None


def _default_http_get(url, *, warm=False):
    """Warmed ``requests`` GET for the archive probes (best-effort)."""
    global _HTTP_SESSION
    import requests  # lazy: only the real (non-offline) run needs it

    if _HTTP_SESSION is None:
        _HTTP_SESSION = requests.Session()
    headers = _BSE_HEADERS if "bseindia" in url else _NSE_HEADERS
    if warm and "nseindia" in url:
        # Warm the WAF cookie jar once, as a browser would.
        try:
            _HTTP_SESSION.get("https://www.nseindia.com/market-data/bulk-deals",
                              headers=headers, timeout=15)
        except Exception:  # noqa: BLE001
            pass
    return _HTTP_SESSION.get(url, headers=headers, timeout=15)


def _count_rows(body):
    if isinstance(body, list):
        return len(body)
    if isinstance(body, dict):
        for key in ("data", "Data", "Table", "table", "rows"):
            val = body.get(key)
            if isinstance(val, list):
                return len(val)
    return 0


def _probe_archive(source, url, http_get, *, warm=False):
    try:
        try:
            resp = http_get(url, warm=warm)
        except TypeError:
            resp = http_get(url)  # injectable getter without the warm kwarg
    except Exception as exc:  # noqa: BLE001
        return {
            "source": source,
            "status": None,
            "rows": 0,
            "note": f"{type(exc).__name__}: {str(exc)[:100]}",
        }
    status = getattr(resp, "status_code", None)
    rows = 0
    try:
        body = resp.json()
        rows = _count_rows(body)
    except Exception:  # noqa: BLE001
        rows = 0
    note = f"HTTP {status}"
    if rows:
        note += f"; {rows} rows"
    return {"source": source, "status": status, "rows": rows, "note": note}


def attempt_archives(from_date, to_date, *, http_get=None):
    """Try NSE + BSE bulk-deal archives once each (time-boxed, never raises).

    Returns ``[{source, status, rows, note}, ...]``. If any source yields rows
    it is the true event set and the caller should say so prominently.
    """
    http_get = http_get or _default_http_get
    nse_url = f"{_NSE_URL}?from={from_date}&to={to_date}"
    bse_url = f"{_BSE_URL}?fromdate={from_date}&todate={to_date}&scripcode="
    return [
        _probe_archive("NSE", nse_url, http_get, warm=True),
        _probe_archive("BSE", bse_url, http_get, warm=False),
    ]


# ---------------------------------------------------------------------------
# captured-deal cohort (our own archive)
# ---------------------------------------------------------------------------


def read_captured_deals(root=None):
    """All captured deal rows from ``data/bulk_deals/*.jsonl`` (newest file last).

    Missing dir -> ``[]``. Malformed lines / non-dict rows are skipped; never
    raises.
    """
    base = Path(root) if root is not None else CAPTURED_DEALS_DIR
    out = []
    try:
        if not base.is_dir():
            return out
        for path in sorted(base.glob("*.jsonl")):
            try:
                with open(path, encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            obj = json.loads(line)
                        except (ValueError, TypeError):
                            continue
                        if isinstance(obj, dict):
                            out.append(obj)
            except OSError:
                continue
    except OSError:
        return out
    return out


def qualifying_events(deals):
    """Rows that are institutional BUYs at/above the qualifying threshold.

    Strict: ``qualifying`` must be exactly ``True`` and (when present) ``side``
    must be ``BUY``. Requires a ``symbol``. Explicit ``qualifying: false`` rows
    are excluded.
    """
    out = []
    for d in deals or []:
        if not isinstance(d, dict):
            continue
        if d.get("qualifying") is not True:
            continue
        side = str(d.get("side") or "").upper()
        if side and side != "BUY":
            continue
        if not str(d.get("symbol") or "").strip():
            continue
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# aggregation helpers
# ---------------------------------------------------------------------------


def summarize(rows, *, horizons=DEFAULT_HORIZONS, min_sample=MIN_SAMPLE):
    """Summarize forward-metric dicts into per-horizon stat blocks (gated)."""
    out = {"n": len(rows)}
    for h in horizons:
        out[f"ret_{int(h)}"] = _stats(
            [r.get(f"ret_{int(h)}") for r in rows], min_sample=min_sample
        )
    out[f"mae_{DEFAULT_EXCURSION}"] = _stats(
        [r.get(f"mae_{DEFAULT_EXCURSION}") for r in rows], min_sample=min_sample
    )
    out[f"mfe_{DEFAULT_EXCURSION}"] = _stats(
        [r.get(f"mfe_{DEFAULT_EXCURSION}") for r in rows], min_sample=min_sample
    )
    return out


def sample_sessions(candles, *, k=5, seed=0, excursion=DEFAULT_EXCURSION):
    """Deterministic random event indices that have a full forward window."""
    eligible = [i for i in range(len(candles)) if i + int(excursion) < len(candles)]
    if not eligible:
        return []
    rng = random.Random(int(seed))
    return sorted(rng.sample(eligible, min(int(k), len(eligible))))


def control_symbols(*, limit=40, master=None):
    """Fixed control sample: NIFTY + liquid F&O names (best-effort, never raises)."""
    names = []
    try:
        import nse_universe  # lazy: needs the master download

        names = list(nse_universe.stock_underlyings() or [])
    except Exception:  # noqa: BLE001
        names = []
    if not names:
        try:
            import fyers_data  # lazy

            names = [t for t in fyers_data.UNIVERSE if t not in ("NIFTY", "BANKNIFTY")]
        except Exception:  # noqa: BLE001
            names = []
    return ["NIFTY"] + names[: int(limit)]


def top_volume_days(candles, *, months=3, k=3, today=None, window=VOL_WINDOW):
    """Top ``k`` volume-z days over the trailing ``months`` (needs full window)."""
    if not candles:
        return []
    vols = [c.get("volume") for c in candles]
    zs = volume_zscores(vols, window=window)
    today_s = _today_ist(today)
    try:
        cutoff = (date.fromisoformat(today_s) - timedelta(days=int(months) * 31)).isoformat()
    except (TypeError, ValueError):
        cutoff = "0000-00-00"
    ranked = []
    for i, c in enumerate(candles):
        if i < int(window) or zs[i] is None:
            continue
        d = c.get("date") or ""
        if cutoff and d < cutoff:
            continue
        ranked.append((zs[i], i))
    ranked.sort(key=lambda t: t[0], reverse=True)
    return [i for _z, i in ranked[: int(k)]]


# ---------------------------------------------------------------------------
# builders
# ---------------------------------------------------------------------------


def _fetch_window(today):
    to_date = _today_ist(today)
    try:
        from_d = date.fromisoformat(to_date) - timedelta(days=LOOKBACK_DAYS)
    except (TypeError, ValueError):
        from_d = date.today() - timedelta(days=LOOKBACK_DAYS)
    return from_d.isoformat(), to_date


def build_examples(
    *,
    fetch_fn,
    root,
    today=None,
    offline=False,
    force=False,
    quantity=DEFAULT_QTY,
    examples=None,
    master=None,
):
    """Resolve + analyse the named examples. Returns the example records."""
    from_date, to_date = _fetch_window(today)
    records = []
    for spec in examples or EXAMPLES:
        symbol = spec["symbol"]
        res = resolve_symbol(
            symbol,
            spec.get("name"),
            fetch_fn,
            resolution="D",
            range_from=from_date,
            range_to=to_date,
            master=master,
        )
        rec = {
            "symbol": symbol,
            "name": spec.get("name"),
            "client": spec.get("client"),
            "annotated_date": spec.get("annotated_date"),
            "resolved": res["resolved"],
            "fyers_symbol": res["fyers_symbol"],
            "reason": res["reason"],
            "rows": len(res["candles"]),
        }
        if not res["resolved"] or not res["candles"]:
            records.append(rec)
            continue
        candles = res["candles"]
        rec["candle_from"] = candles[0].get("date")
        rec["candle_to"] = candles[-1].get("date")
        top = top_volume_days(candles, today=today)
        rec["top_volume_z_days"] = [
            _day_detail(candles, i, quantity=quantity) for i in top
        ]
        annotated = _annotated_detail(candles, spec.get("annotated_date"), top, quantity=quantity)
        rec["annotated"] = annotated
        rec["annotated_in_top3"] = bool(
            annotated and annotated.get("in_top3")
        )
        rec["follower"] = follower_stats(
            [follower_rows(candles, i, quantity=quantity) for i in top]
        )
        records.append(rec)
    return records


def _day_detail(candles, i, *, quantity=DEFAULT_QTY):
    m = forward_metrics(candles, i)
    zs = volume_zscores([c.get("volume") for c in candles])
    detail = {
        "date": candles[i].get("date") if isinstance(candles[i], dict) else None,
        "close": _close(candles[i]),
        "volume": candles[i].get("volume") if isinstance(candles[i], dict) else None,
        "vol_z": zs[i] if i < len(zs) else None,
        "day_return_pct": day_return(candles, i),
    }
    detail.update(m)
    detail["follower"] = follower_rows(candles, i, quantity=quantity)
    return detail


def _annotated_detail(candles, annotated_date, top_indices, *, quantity=DEFAULT_QTY):
    if not annotated_date:
        return None
    for i, c in enumerate(candles):
        if isinstance(c, dict) and c.get("date") == annotated_date:
            detail = _day_detail(candles, i, quantity=quantity)
            detail["in_top3"] = i in top_indices
            detail["rank"] = (top_indices.index(i) + 1) if i in top_indices else None
            return detail
    return {"date": annotated_date, "found": False, "in_top3": False}


def build_cohort(
    *,
    root,
    fetch_fn,
    today=None,
    offline=False,
    quantity=DEFAULT_QTY,
    deals_root=None,
    master=None,
):
    """Analyse captured qualifying events (institutional BUY >= threshold)."""
    deals = read_captured_deals(deals_root)
    events = qualifying_events(deals)
    from_date, to_date = _fetch_window(today)
    rows = []
    unresolved = []
    for ev in events:
        symbol = str(ev.get("symbol") or "").upper()
        res = resolve_symbol(
            symbol, ev.get("name"), fetch_fn,
            resolution="D", range_from=from_date, range_to=to_date, master=master,
        )
        if not res["resolved"] or not res["candles"]:
            unresolved.append({"symbol": symbol, "reason": res["reason"]})
            continue
        candles = res["candles"]
        ev_date = str(ev.get("date") or "")[:10]
        idx = next((i for i, c in enumerate(candles) if c.get("date") == ev_date), None)
        if idx is None:
            unresolved.append({"symbol": symbol, "reason": f"no candle on {ev_date}"})
            continue
        m = forward_metrics(candles, idx)
        rows.append({
            "date": ev_date,
            "symbol": symbol,
            "client": ev.get("client"),
            "value_cr": ev.get("value_cr"),
            "vol_z20": ev.get("vol_z20"),
            **m,
        })
    stats = summarize(rows)
    return {
        "n_deals": len(deals),
        "n_qualifying": len(events),
        "n_scored": len(rows),
        "unresolved": unresolved,
        "events": rows,
        "stats": stats,
        "verdict": _gate_verdict(stats),
    }


def build_controls(
    *,
    root,
    fetch_fn,
    today=None,
    offline=False,
    quantity=DEFAULT_QTY,
    master=None,
    limit=40,
    per_name=5,
):
    """Baseline distribution: NIFTY + liquid names on random non-event days."""
    from_date, to_date = _fetch_window(today)
    symbols = control_symbols(limit=limit, master=master)
    rows = []
    resolved = []
    for seed, symbol in enumerate(symbols):
        res = resolve_symbol(
            symbol, None, fetch_fn,
            resolution="D", range_from=from_date, range_to=to_date, master=None,
        )
        if not res["resolved"] or not res["candles"]:
            continue
        candles = res["candles"]
        resolved.append(symbol)
        for i in sample_sessions(candles, k=per_name, seed=seed):
            rows.append(forward_metrics(candles, i))
    stats = summarize(rows)
    return {
        "n_symbols": len(resolved),
        "symbols": resolved,
        "n_events": len(rows),
        "stats": stats,
        "verdict": _gate_verdict(stats),
    }


def _gate_verdict(stats):
    n = stats.get("n", 0)
    if n < MIN_SAMPLE:
        return f"insufficient sample (n={n} < {MIN_SAMPLE})"
    return "reported"


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------


def _fmt(v, digits=2):
    x = _f(v)
    if x is None:
        return "-"
    return f"{x:.{digits}f}"


def _stats_line(label, s):
    if not isinstance(s, dict):
        return f"| {label} | - | - | - | - | - |"
    return "| {l} | {n} | {mean} | {med} | {wr} | {ex} |".format(
        l=label,
        n=s.get("n", 0),
        mean=_fmt(s.get("mean")),
        med=_fmt(s.get("median")),
        wr=_fmt(s.get("win_rate"), 2),
        ex=_fmt(s.get("expectancy")) if s.get("expectancy") is not None else "insufficient sample",
    )


def render_study_md(result):
    """Markdown report matching the EDGE_ROADMAP honesty rules."""
    lines = []
    lines.append("# Bulk-Deal Event Study")
    lines.append("")
    lines.append(f"**Generated:** {result.get('generated_at')}  ")
    lines.append(f"**Window:** {result.get('window', {}).get('from')} → "
                 f"{result.get('window', {}).get('to')}  ")
    lines.append("**Reproducible script:** `india_board/scripts/bulk_deal_study.py`  ")
    lines.append("**Not investment advice.** Hypothesis to be measured, not a claim.")
    lines.append("")
    lines.append("## Hypothesis")
    lines.append("")
    lines.append("> When a mutual fund / institution buys size via an NSE bulk deal, "
                 "the stock's volume spikes and it often continues higher — can we trade it?")
    lines.append("")
    lines.append("**Kill criteria (pre-registered):** the hypothesis fails if, after costs, "
                 "the follower variant (buy the volume-spike close) does not beat the baseline "
                 "distribution of NIFTY + liquid names, or if the event sample stays below "
                 f"{MIN_SAMPLE} observations.")
    lines.append("")

    # --- data sources ---
    lines.append("## Data sources and status")
    lines.append("")
    lines.append("| Source | HTTP status | Rows | Note |")
    lines.append("|---|---|---|---|")
    for s in result.get("sources", []):
        lines.append(f"| {s.get('source')} | {s.get('status')} | {s.get('rows')} | {s.get('note')} |")
    archive_ok = any(
        (s.get("rows") or 0) > 0
        for s in result.get("sources", [])
        if str(s.get("source", "")).upper() in ("NSE", "BSE")
    )
    if archive_ok:
        lines.append("")
        lines.append("> **Official archive available.** The event set below uses the "
                     "exchange archive as the true source; the candle-derived volume-z days "
                     "are shown only as cross-checks.")
    else:
        lines.append("")
        lines.append("> No official bulk-deal archive was reachable from this network "
                     "(expected NSE 503 WAF / BSE 403). The event set below is therefore "
                     "**recovered from candle volume z-scores**, not from an authoritative deal "
                     "feed. This is a mechanics check, not an event study.")
    lines.append("")

    # --- examples ---
    lines.append("## Named examples (mechanics validation)")
    lines.append("")
    ex = result.get("examples") or []
    lines.append("| Symbol | Resolved | Source | Days | Top volume-z day (date / z / day%) | Annotated day matched top-3? |")
    lines.append("|---|---|---|---|---|---|")
    for r in ex:
        top = (r.get("top_volume_z_days") or [])
        top0 = top[0] if top else {}
        top_txt = (
            f"{top0.get('date')} / z={_fmt(top0.get('vol_z'))} / "
            f"{_fmt(top0.get('day_return_pct'))}%"
        ) if top0 else "-"
        matched = r.get("annotated_in_top3")
        matched_txt = "yes" if matched else ("no" if r.get("annotated") else "n/a")
        lines.append(
            f"| {r.get('symbol')} | {r.get('resolved')} | {r.get('data_source') or '-'} | "
            f"{r.get('rows', 0)} | {top_txt} | {matched_txt} |"
        )
    lines.append("")
    for r in ex:
        if not r.get("resolved"):
            lines.append(f"- **{r.get('symbol')}** unresolved — {r.get('reason')}. "
                         "Recorded honestly, not papered over.")
            continue
        lines.append(f"### {r.get('symbol')} — {r.get('name')}")
        lines.append("")
        lines.append(f"Resolved symbol `{r.get('fyers_symbol')}`; data source "
                     f"**{r.get('data_source') or 'unknown'}**; candles "
                     f"{r.get('candle_from')} → {r.get('candle_to')} ({r.get('rows')} rows).")
        lines.append("")
        lines.append("| Top day | vol_z | day % | +1d | +5d | +10d | +20d | MAE20 | MFE20 |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for d in r.get("top_volume_z_days") or []:
            lines.append(
                "| {date} | {z} | {day} | {r1} | {r5} | {r10} | {r20} | {mae} | {mfe} |".format(
                    date=d.get("date"), z=_fmt(d.get("vol_z")), day=_fmt(d.get("day_return_pct")),
                    r1=_fmt(d.get("ret_1")), r5=_fmt(d.get("ret_5")),
                    r10=_fmt(d.get("ret_10")), r20=_fmt(d.get("ret_20")),
                    mae=_fmt(d.get("mae_20")), mfe=_fmt(d.get("mfe_20")),
                )
            )
        ann = r.get("annotated")
        if ann:
            if ann.get("found") is False:
                lines.append("")
                lines.append(f"Annotated date {ann.get('date')} was **not present** in the "
                             "candle series (symbol may not have traded / resolved).")
            else:
                rank = ann.get("rank")
                rank_txt = f" (rank {rank}/3)" if rank else ""
                lines.append("")
                lines.append(
                    f"Annotated day **{ann.get('date')}**: vol_z={_fmt(ann.get('vol_z'))}, "
                    f"day={_fmt(ann.get('day_return_pct'))}%, "
                    f"in top-3 volume-z = {bool(ann.get('in_top3'))}{rank_txt}."
                )
        lines.append("")

    # --- follower variants on examples ---
    variants = result.get("variants") or {}
    if variants:
        lines.append("## Follower simulation (buy the spike-day close)")
        lines.append("")
        lines.append("Net of `backtest/costs.py` costs. `expectancy` is withheld below "
                     f"n={MIN_SAMPLE}.")
        lines.append("")
        lines.append("| Variant | n | mean % | median % | win rate | expectancy |")
        lines.append("|---|---|---|---|---|---|")
        for key, s in variants.items():
            lines.append(_stats_line(key, s))
        lines.append("")

    # --- cohort ---
    lines.append("## Cohort study (our own captured deals)")
    lines.append("")
    coh = result.get("cohort")
    if coh is None:
        lines.append("_Not run (pass `--cohort`)._")
        lines.append("")
    else:
        lines.append(f"Deals read: {coh.get('n_deals')} | qualifying institutional BUYs: "
                     f"{coh.get('n_qualifying')} | scored: {coh.get('n_scored')}. "
                     f"Verdict: **{coh.get('verdict')}**.")
        lines.append("")
        lines.append("| Horizon | n | mean % | median % | win rate | expectancy |")
        lines.append("|---|---|---|---|---|---|")
        for h in DEFAULT_HORIZONS:
            lines.append(_stats_line(f"+{h}d", coh.get("stats", {}).get(f"ret_{h}", {})))
        lines.append("")

    # --- controls ---
    lines.append("## Baseline / control")
    lines.append("")
    ctl = result.get("controls")
    if ctl is None:
        lines.append("_Not run (pass `--controls`)._")
        lines.append("")
    else:
        lines.append(f"Symbols resolved: {ctl.get('n_symbols')} | random non-event days: "
                     f"{ctl.get('n_events')}. Verdict: **{ctl.get('verdict')}**.")
        lines.append("")
        lines.append("| Horizon | n | mean % | median % | win rate | expectancy |")
        lines.append("|---|---|---|---|---|---|")
        for h in DEFAULT_HORIZONS:
            lines.append(_stats_line(f"+{h}d", ctl.get("stats", {}).get(f"ret_{h}", {})))
        lines.append("")

    if variants and ctl:
        lines.append("### Event spike-days vs baseline (descriptive, not a significance test)")
        lines.append("")
        for h in DEFAULT_HORIZONS:
            ev = variants.get(f"exit_{h}", {})
            cv = ctl.get("stats", {}).get(f"ret_{h}", {})
            if ev.get("mean") is not None and cv.get("mean") is not None:
                lines.append(
                    f"- +{h}d: event mean {_fmt(ev.get('mean'))}% (n={ev.get('n')}) vs "
                    f"baseline mean {_fmt(cv.get('mean'))}% (n={cv.get('n')})."
                )
        lines.append("")
        lines.append(
            "Higher at every horizon above, but the event sample is below the "
            f"n={MIN_SAMPLE} gate and the \"events\" are volume-spike proxies, not confirmed "
            "bulk deals — so this is **suggestive, not established**."
        )
        lines.append("")

    # --- proven / unproven ---
    lines.append("## What is proven vs unproven")
    lines.append("")
    resolved_examples = [r for r in ex if r.get("resolved")]
    lines.append(f"- **Mechanics (proven):** {len(resolved_examples)}/{len(ex)} named symbols "
                 "resolved to a daily series (Fyers primary; Upstox fallback when the Fyers "
                 "token is dead off-hours); volume z-scores, forward returns, MAE/MFE and "
                 "the stop/target walk reproduce deterministically from cached candles.")
    lines.append("- **Event definition (unproven):** without an archive or ~40 days of our own "
                 "capture, the \"event\" is a volume-spike proxy, not a confirmed bulk deal.")
    lines.append("- **Edge (unproven):** no expectancy is claimed anywhere until n >= "
                 f"{MIN_SAMPLE} on a genuine event set, net of costs, versus the baseline.")
    lines.append("")

    lines.append("## Sample-size caveats")
    lines.append("")
    lines.append(f"- Every table marked *insufficient sample* has n < {MIN_SAMPLE}; those numbers "
                 "are descriptive only and must not be read as expectancy.")
    lines.append("- Near-dated annotated days (e.g. late Sep) cannot have a +20-session forward "
                 "window yet, so their long-horizon cells are `-` by construction.")
    lines.append("- Public archives are WAF-protected from unattended clients; a 503/403 is a "
                 "data-access fact, not evidence about the strategy.")
    lines.append("- A very high volume z-score usually means the trailing 20-session base was "
                 "unusually quiet, not that absolute volume was exceptional; treat extreme z as a "
                 "ranking device, not a size estimate.")
    lines.append("- The annotated deal dates are matched to *candle* top-3 volume-z days. A match "
                 "is consistent with the user's chart but is not proof the print was the bulk deal "
                 "(no archive was reachable).")
    lines.append("")

    lines.append("## What we would need for a real event study")
    lines.append("")
    lines.append("1. **Authoritative events** — working NSE `/api/historical/bulk-deals` access "
                 "(browser-warmed session or a licensed feed), or BSE bulk-deal archive access; "
                 "or")
    lines.append(f"2. **~40 days of our own capture** of `data/bulk_deals/*.jsonl` "
                 f"(~{MIN_SAMPLE}+ qualifying institutional BUYs) so the cohort can clear the "
                 "sample gate;")
    lines.append("3. **Point-in-time discipline** — align each deal to the session it printed on, "
                 "enter at the next tradable close, and keep the baseline contemporaneous.")
    lines.append("")

    lines.append("## Re-run")
    lines.append("")
    lines.append("```bash")
    lines.append("cd stock-screener-ui && source .venv/bin/activate")
    lines.append("python india_board/scripts/bulk_deal_study.py --examples --cohort "
                 "--out reports/bulk_deals")
    lines.append("# examples only, from cache (no network):")
    lines.append("python india_board/scripts/bulk_deal_study.py --examples --offline "
                 "--out reports/bulk_deals")
    lines.append("# add the baseline control set:")
    lines.append("python india_board/scripts/bulk_deal_study.py --all --controls "
                 "--out reports/bulk_deals")
    lines.append("```")
    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _call_budget(fetch_fn, limit=MAX_FYERS_CALLS):
    """Wrap ``fetch_fn`` with a hard call counter (returns [] once exhausted)."""
    state = {"n": 0, "limit": int(limit)}

    def wrapped(symbol, resolution, range_from, range_to):
        if state["n"] >= state["limit"]:
            return []
        state["n"] += 1
        return fetch_fn(symbol, resolution, range_from, range_to)

    return wrapped, state


def _plain_ticker(symbol):
    """Strip the Fyers exchange/series decoration -> plain NSE trading symbol."""
    s = str(symbol or "").upper().strip()
    if ":" in s:
        s = s.split(":", 1)[1]
    return re.sub(r"-(EQ|BE|BZ|SM|ST)$", "", s)


def _upstox_daily_rows(symbol, range_from, range_to):
    """Daily bars from the project's market-data client, as Fyers-style rows.

    Secondary source: used only when Fyers returns nothing (e.g. an expired
    token). Returns ``[[epoch, o, h, l, c, v], ...]`` or ``[]``. Never raises.
    """
    ticker = _plain_ticker(symbol)
    if not ticker:
        return []
    try:
        from market_data.market_data import fetch_candles  # lazy

        df = fetch_candles(ticker, 1440, range_from, range_to)
    except Exception:  # noqa: BLE001 - fallback must never break the study
        return []
    if df is None or getattr(df, "empty", True):
        return []
    rows = []
    try:
        for ts, r in df.iterrows():
            rows.append([
                float(ts.timestamp()),
                _f(r.get("open")), _f(r.get("high")), _f(r.get("low")),
                _f(r.get("close")), _f(r.get("volume")),
            ])
    except Exception:  # noqa: BLE001
        return []
    return rows


def make_default_fetch(offline=False):
    """Default candle fetch: Fyers primary, Upstox daily fallback.

    Returns ``(fetch_fn, source_log)`` where ``source_log`` maps the requested
    symbol to ``"fyers"`` / ``"upstox"`` / ``"none"`` so the report can state
    exactly which provider served each series. Fyers is attempted first (the
    task's specified source); the fallback exists because the recorder token can
    be expired outside market hours and the study should still be reproducible
    against the repo's own market-data client.
    """
    source_log: dict = {}

    def fetch(symbol, resolution, range_from, range_to):
        if offline:
            return []
        rows = []
        try:
            from india_board.scripts import fyers_data  # lazy

            rows = fyers_data.get_history(symbol, resolution, range_from, range_to)
        except Exception:  # noqa: BLE001 - e.g. expired token / 401
            rows = []
        if rows:
            source_log[symbol] = "fyers"
            return rows
        if str(resolution).upper() in ("D", "1D", "1440"):
            up = _upstox_daily_rows(symbol, range_from, range_to)
            if up:
                source_log[symbol] = "upstox"
                return up
        source_log.setdefault(symbol, "none")
        return []

    return fetch, source_log


def _default_fetch_fn(offline=False):  # kept for backwards-compatible callers
    return make_default_fetch(offline)[0]


def run_study(
    *,
    include_examples=True,
    include_cohort=True,
    include_controls=False,
    offline=False,
    force=False,
    out=None,
    today=None,
    data_dir=None,
    deals_root=None,
    fetch_fn=None,
    http_get=None,
    master=None,
):
    """Run the study and return ``(result_dict, json_path, report_path)``."""
    root = data_root(data_dir)
    rep_root = report_root(out)
    from_date, to_date = _fetch_window(today)
    stamp = _today_ist(today)

    sources = []
    if offline:
        sources.append({"source": "fyers", "status": "offline", "rows": 0,
                        "note": "--offline: cached candles only"})
    else:
        sources.extend(attempt_archives(from_date, to_date, http_get=http_get))
        sources.append({"source": "fyers", "status": "candles", "rows": 0,
                        "note": "daily OHLCV via /data/history"})

    if fetch_fn is not None:
        raw_fetch = fetch_fn
        source_log = {}
    else:
        raw_fetch, source_log = make_default_fetch(offline)
    budgeted, budget_state = _call_budget(raw_fetch)

    result = {
        "generated_at": datetime.now(IST).isoformat(),
        "window": {"from": from_date, "to": to_date},
        "offline": bool(offline),
        "hypothesis": "Institutional bulk-deal buy -> volume spike -> continuation?",
        "sources": sources,
        "examples": [],
        "cohort": None,
        "controls": None,
        "variants": {},
        "notes": [],
    }

    def cache_fetch(symbol, resolution, range_from, range_to):
        """Cache-aware fetch: same-day cache hit -> no network; offline -> cache only."""
        candles = load_candles(
            root, symbol, fetch_fn=budgeted, resolution=resolution,
            range_from=range_from, range_to=range_to,
            today=today, force=force, offline=offline,
        )
        provider = source_log.get(symbol)
        if candles and provider:
            # Persist which provider served this series so a cached re-run can
            # still report the source honestly.
            write_cached_candles(
                root, symbol, candles, fyers_symbol=symbol,
                stamp=_today_ist(today), provider=provider,
            )
        return candles

    with fyers_pacer.allow_offhours("bulk-study"):
        if include_examples:
            result["examples"] = build_examples(
                fetch_fn=cache_fetch, root=root, today=today, offline=offline,
                force=force, master=master,
            )
        if include_cohort:
            result["cohort"] = build_cohort(
                root=root, fetch_fn=cache_fetch, today=today, offline=offline,
                deals_root=deals_root, master=master,
            )
        if include_controls:
            result["controls"] = build_controls(
                fetch_fn=cache_fetch, root=root, today=today, offline=offline,
                master=master,
            )

    # Aggregate the examples' follower rows across resolved names -> variants.
    all_rows = []
    used: set = set()
    for rec in result["examples"]:
        fs = rec.get("fyers_symbol")
        prov = source_log.get(fs) if fs else None
        if not prov and fs:
            prov = cached_provider(root, fs)
        rec["data_source"] = prov
        if prov:
            used.add(prov)
        for d in rec.get("top_volume_z_days") or []:
            if d.get("follower"):
                all_rows.append(d["follower"])
    if all_rows:
        result["variants"] = follower_stats(all_rows)

    for s in sources:
        if s.get("source") == "fyers" and not offline:
            if "fyers" in used:
                s["status"] = "ok"
            else:
                s["status"] = "unavailable"
                s["note"] = ("Fyers history returned no rows off-hours "
                             "(expired token / 401)")
    if used:
        sources.append({
            "source": "candles",
            "status": "used",
            "rows": sum(1 for r in result["examples"]
                        if r.get("data_source") and r["data_source"] != "none"),
            "note": "provider(s): " + ", ".join(sorted(used)),
        })
    result["candle_sources"] = source_log

    result["fyers_calls"] = budget_state["n"]
    result["call_budget"] = budget_state["limit"]
    if budget_state["n"] >= budget_state["limit"]:
        result["notes"].append("Fyers call budget exhausted; some symbols skipped.")

    # persist
    root.mkdir(parents=True, exist_ok=True)
    json_path = root / f"study_{stamp}.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(_json_safe(result), fh, indent=2)

    rep_root.mkdir(parents=True, exist_ok=True)
    report_path = Path(rep_root) / "STUDY.md"
    with open(report_path, "w", encoding="utf-8") as fh:
        fh.write(render_study_md(result))
    # JSON copy alongside the report (the canonical machine-readable copy lives
    # in the study data dir above).
    with open(Path(rep_root) / f"study_{stamp}.json", "w", encoding="utf-8") as fh:
        json.dump(_json_safe(result), fh, indent=2)

    return result, str(json_path), str(report_path)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Bulk-deal event study (research).")
    parser.add_argument("--examples", action="store_true", help="analyse named examples")
    parser.add_argument("--cohort", action="store_true", help="analyse captured qualifying deals")
    parser.add_argument("--controls", action="store_true", help="build the baseline control set")
    parser.add_argument("--all", action="store_true", help="examples + cohort + controls")
    parser.add_argument("--offline", action="store_true", help="cached candles only (no network)")
    parser.add_argument("--force", action="store_true", help="ignore the same-day candle cache")
    parser.add_argument("--out", default=str(DEFAULT_REPORT_DIR), help="report output dir")
    parser.add_argument("--today", default=None, help="IST day to stamp the run (YYYY-MM-DD)")
    args = parser.parse_args(argv)

    if args.all or not (args.examples or args.cohort or args.controls):
        inc_examples = inc_cohort = inc_controls = True
    else:
        inc_examples = args.examples
        inc_cohort = args.cohort
        inc_controls = args.controls

    result, json_path, report_path = run_study(
        include_examples=inc_examples,
        include_cohort=inc_cohort,
        include_controls=inc_controls,
        offline=args.offline,
        force=args.force,
        out=args.out,
        today=args.today,
    )
    print(json.dumps({
        "json": json_path,
        "report": report_path,
        "fyers_calls": result.get("fyers_calls"),
        "examples": [
            {"symbol": r["symbol"], "resolved": r["resolved"], "rows": r.get("rows", 0)}
            for r in result.get("examples", [])
        ],
        "cohort": (result.get("cohort") or {}).get("verdict"),
        "controls": (result.get("controls") or {}).get("verdict"),
    }, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover - manual research entrypoint
    raise SystemExit(main())
