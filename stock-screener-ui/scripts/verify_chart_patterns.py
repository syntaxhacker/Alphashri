#!/usr/bin/env python3
"""
Chart Patterns verification harness (Agent 5).

Proves that every pattern in the frozen catalog either fires or legitimately
never fires, on every timeframe, using **real** Upstox V3 candles. No canned
data is used: candles are fetched through the existing transport
(`market_data.market_data.fetch_candles` / `get_api_client`) or, when available,
`chart_patterns.candles.fetch_for_timeframe`.

Usage (from repo root):

    .venv/bin/python scripts/verify_chart_patterns.py \\
        --symbols "RELIANCE,TCS,INFY" \\
        --timeframes all \\
        --limit 3 \\
        --out reports/chart_patterns_verification

Outputs (inside --out):
    report.json   raw per-(symbol, tf) results incl. every PatternHit dict
    report.csv    one row per hit: symbol,tf,pattern_id,status,quality,confidence,rr,bars_ago
    SUMMARY.md    pattern_id x timeframe matrix + zero-hit flags + fetch report

The harness never crashes on a missing token / V3 error / missing engine module:
it records the failure and still writes all three artifacts. `--strict` upgrades
"engine missing" or "no candle ever fetched" to a non-zero exit code.

Contract reference: chart_patterns/CONTRACT.md sections 1, 2, 5, 7.
"""

from __future__ import annotations

import argparse
import csv
import inspect
import json
import os
import statistics
import sys
import traceback
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

# --------------------------------------------------------------------------- #
# Paths / env
# --------------------------------------------------------------------------- #

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent          # stock-screener-ui
ROOT_DIR = PROJECT_DIR.parent            # repo root

for _p in (str(PROJECT_DIR), str(ROOT_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:  # optional — config auto-loads .env anyway
    from dotenv import load_dotenv

    for _env in (PROJECT_DIR / ".env", PROJECT_DIR / ".env.dev", ROOT_DIR / ".env"):
        if _env.exists():
            load_dotenv(_env)
except Exception:  # pragma: no cover - dotenv is optional
    pass

try:
    import config as _cfg

    IST = getattr(_cfg, "IST", None)
except Exception:  # pragma: no cover
    IST = None

INSTRUMENTS_FILE = ROOT_DIR / "upstox_trader" / "config_and_utils" / "nse_instruments.json"

# Stable liquid NSE_EQ sample used only when --symbols is omitted. Intersected
# with the real instruments file, so nothing is fabricated and stale symbols are
# dropped automatically.
DEFAULT_LIQUID_SYMBOLS = [
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN",
    "BHARTIARTL", "ITC", "LT", "AXISBANK", "KOTAKBANK", "WIPRO",
    "HINDUNILVR", "MARUTI", "TITAN",
]

# Fallback catalog mirroring CONTRACT.md §2 (frozen). It lets SUMMARY.md render a
# complete matrix even before chart_patterns.engine is importable. Any catalog
# discovered from the real modules is merged on top of this list.
CONTRACT_PATTERNS: List[Dict[str, str]] = [
    {"pattern_id": "falling_wedge", "name": "Falling Wedge", "family": "reversal", "direction": "bullish"},
    {"pattern_id": "rising_wedge", "name": "Rising Wedge", "family": "reversal", "direction": "bearish"},
    {"pattern_id": "diamond_bottom", "name": "Diamond Bottom", "family": "reversal", "direction": "bullish"},
    {"pattern_id": "triple_bottom", "name": "Triple Bottom", "family": "reversal", "direction": "bullish"},
    {"pattern_id": "double_bottom", "name": "Double Bottom", "family": "reversal", "direction": "bullish"},
    {"pattern_id": "head_shoulders", "name": "Head & Shoulders", "family": "reversal", "direction": "bearish"},
    {"pattern_id": "inverse_head_shoulders", "name": "Inverse H&S", "family": "reversal", "direction": "bullish"},
    {"pattern_id": "rounding_bottom", "name": "Rounding Bottom", "family": "reversal", "direction": "bullish"},
    {"pattern_id": "ascending_channel", "name": "Ascending Channel", "family": "continuation", "direction": "bullish"},
    {"pattern_id": "descending_channel", "name": "Descending Channel", "family": "continuation", "direction": "bearish"},
    {"pattern_id": "bull_flag", "name": "Bull Flag", "family": "continuation", "direction": "bullish"},
    {"pattern_id": "bear_flag", "name": "Bear Flag", "family": "continuation", "direction": "bearish"},
    {"pattern_id": "pennant", "name": "Pennant", "family": "continuation", "direction": "bullish"},
    {"pattern_id": "rectangle", "name": "Rectangle (unresolved range)", "family": "continuation", "direction": "neutral"},
    {"pattern_id": "ascending_triangle", "name": "Ascending Triangle", "family": "continuation", "direction": "bullish"},
    {"pattern_id": "descending_triangle", "name": "Descending Triangle", "family": "continuation", "direction": "bearish"},
    {"pattern_id": "curve_bearish", "name": "Curve Pattern (Bearish)", "family": "curve_cup", "direction": "bearish"},
    {"pattern_id": "cup_handle", "name": "Cup & Handle", "family": "curve_cup", "direction": "bullish"},
]

# Fallback timeframe ladder mirroring CONTRACT.md §1. `native` is the Upstox
# unit/interval string; `source_tf` documents which TF is resampled to produce it.
FALLBACK_TFSPECS: List[Dict[str, Any]] = [
    {"id": "1m",  "label": "1m",  "minutes": 1,     "native": "minutes/1", "source_tf": None, "max_lookback_days": 30,   "min_bars": 60},
    {"id": "3m",  "label": "3m",  "minutes": 3,     "native": None,        "source_tf": "1m", "max_lookback_days": 30,   "min_bars": 60},
    {"id": "5m",  "label": "5m",  "minutes": 5,     "native": "minutes/5", "source_tf": None, "max_lookback_days": 90,   "min_bars": 60},
    {"id": "10m", "label": "10m", "minutes": 10,    "native": "minutes/10", "source_tf": None, "max_lookback_days": 90,  "min_bars": 60},
    {"id": "15m", "label": "15m", "minutes": 15,    "native": "minutes/15", "source_tf": None, "max_lookback_days": 90,  "min_bars": 60},
    {"id": "30m", "label": "30m", "minutes": 30,    "native": "minutes/30", "source_tf": None, "max_lookback_days": 180, "min_bars": 60},
    {"id": "1h",  "label": "1h",  "minutes": 60,    "native": "hours/1",   "source_tf": None, "max_lookback_days": 365,  "min_bars": 60},
    {"id": "2h",  "label": "2h",  "minutes": 120,   "native": None,        "source_tf": "1h", "max_lookback_days": 365,  "min_bars": 60},
    {"id": "3h",  "label": "3h",  "minutes": 180,   "native": None,        "source_tf": "1h", "max_lookback_days": 365,  "min_bars": 60},
    {"id": "4h",  "label": "4h",  "minutes": 240,   "native": "hours/4",   "source_tf": None, "max_lookback_days": 365,  "min_bars": 60},
    {"id": "1D",  "label": "1D",  "minutes": 1440,  "native": "days/1",    "source_tf": None, "max_lookback_days": 730,  "min_bars": 60},
    {"id": "1W",  "label": "1W",  "minutes": 10080, "native": "weeks/1",   "source_tf": None, "max_lookback_days": 1825, "min_bars": 52},
    {"id": "1M",  "label": "1M",  "minutes": 43200, "native": "months/1",  "source_tf": None, "max_lookback_days": 3650, "min_bars": 24},
]

HIT_FIELDS = [
    "pattern_id", "pattern_name", "family", "direction", "status", "quality",
    "confidence", "start_date", "end_date", "start_price", "end_price",
    "breakout_level", "target", "stop", "rr", "bars_ago", "volume_confirmed",
    "trendlines", "notes",
]

STATUS_SHORT = {
    "confirmed": "c",
    "forming": "f",
    "failed": "x",
    "marginal": "m",
}


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #

def _log(msg: str) -> None:
    print(msg, flush=True)


def _today() -> datetime:
    if IST is not None:
        try:
            return datetime.now(IST)
        except Exception:  # pragma: no cover
            pass
    return datetime.now()


def _try_import(module_name: str):
    try:
        return __import__(module_name, fromlist=["*"])
    except Exception:
        return None


def _spec_get(spec: Any, key: str, default: Any = None) -> Any:
    if spec is None:
        return default
    if isinstance(spec, dict):
        return spec.get(key, default)
    return getattr(spec, key, default)


def _get_arg(obj: Any, *names: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        for n in names:
            if n in obj and obj[n] is not None:
                return obj[n]
        return default
    for n in names:
        if hasattr(obj, n):
            v = getattr(obj, n)
            if v is not None:
                return v
    return default


def _hit_to_dict(hit: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for f in HIT_FIELDS:
        out[f] = _get_arg(hit, f, default=None)
    # Normalise numeric fields.
    for f in ("confidence", "start_price", "end_price", "breakout_level", "target", "stop", "rr"):
        try:
            out[f] = float(out[f]) if out[f] is not None else None
        except (TypeError, ValueError):
            out[f] = None
    try:
        out["bars_ago"] = int(out["bars_ago"]) if out["bars_ago"] is not None else None
    except (TypeError, ValueError):
        out["bars_ago"] = None
    out["volume_confirmed"] = bool(out["volume_confirmed"]) if out["volume_confirmed"] is not None else False
    try:
        json.dumps(out["trendlines"])
    except Exception:
        out["trendlines"] = []
    return out


# --------------------------------------------------------------------------- #
# Symbol + timeframe resolution
# --------------------------------------------------------------------------- #

def load_instruments() -> Optional[List[Dict[str, Any]]]:
    if not INSTRUMENTS_FILE.exists():
        return None
    try:
        with open(INSTRUMENTS_FILE) as fh:
            return json.load(fh)
    except Exception as exc:  # pragma: no cover
        _log(f"  ! could not parse instruments file: {exc}")
        return None


def resolve_symbols(raw: Optional[str], limit: int) -> Tuple[List[str], Optional[str]]:
    """Return (symbols, note). --symbols always wins; else instruments sample.

    ``limit <= 0`` means "no cap" (scan every provided/default symbol).
    """
    if raw:
        syms = [s.strip().upper() for s in raw.split(",") if s.strip()]
        return (syms[:limit] if limit and limit > 0 else syms), None

    data = load_instruments()
    if not data:
        picks = DEFAULT_LIQUID_SYMBOLS
        return (picks[:limit] if limit and limit > 0 else picks), "instruments file unavailable — using built-in liquid sample"

    available = {
        item.get("trading_symbol")
        for item in data
        if item.get("segment") == "NSE_EQ" and item.get("instrument_type") == "EQ"
    }
    picks = [s for s in DEFAULT_LIQUID_SYMBOLS if s in available]
    if limit and limit > 0 and len(picks) < limit:
        # Top up deterministically (sorted) from the EQ universe.
        extra = sorted(available - set(picks))
        picks.extend(extra)
    return (picks[:limit] if limit and limit > 0 else picks), None


def resolve_timeframes(raw: str) -> Tuple[List[Any], Optional[str]]:
    tf_mod = _try_import("chart_patterns.timeframes")
    real = None
    if tf_mod is not None:
        real = getattr(tf_mod, "TIMEFRAMES", None)

    if raw.strip().lower() == "all":
        if real:
            return list(real), None
        return [SimpleNamespace(**s) for s in FALLBACK_TFSPECS], "chart_patterns.timeframes missing — using CONTRACT fallback ladder"

    ids = [t.strip() for t in raw.split(",") if t.strip()]
    resolved: List[Any] = []
    for tf_id in ids:
        spec = None
        if tf_mod is not None and hasattr(tf_mod, "get_timeframe"):
            try:
                spec = tf_mod.get_timeframe(tf_id)
            except Exception:
                spec = None
        if spec is None:
            match = next((s for s in FALLBACK_TFSPECS if s["id"] == tf_id), None)
            if match is None:
                _log(f"  ! unknown timeframe id '{tf_id}' — skipped")
                continue
            spec = SimpleNamespace(**match)
        resolved.append(spec)
    note = None if tf_mod is not None else "chart_patterns.timeframes missing — using CONTRACT fallback ladder"
    return resolved, note


def resolve_catalog() -> Tuple[List[Dict[str, str]], Optional[str]]:
    """Merge catalog discovered in chart_patterns with the CONTRACT fallback."""
    discovered: Dict[str, Dict[str, str]] = {}
    for mod_name, attrs in (
        ("chart_patterns.patterns", ("PATTERN_CATALOG", "PATTERNS", "CATALOG")),
        ("chart_patterns.engine", ("PATTERN_CATALOG", "CATALOG", "PATTERNS")),
        ("chart_patterns.detectors", ("PATTERN_CATALOG", "CATALOG")),
        ("chart_patterns.detectors.common", ("PATTERN_CATALOG", "CATALOG", "PATTERNS")),
    ):
        mod = _try_import(mod_name)
        if mod is None:
            continue
        for attr in attrs:
            catalog = getattr(mod, attr, None)
            if catalog is None:
                continue
            try:
                iterable = catalog.values() if isinstance(catalog, dict) else catalog
                for item in iterable:
                    pid = _get_arg(item, "pattern_id", "id", default=None)
                    if not pid:
                        continue
                    discovered[str(pid)] = {
                        "pattern_id": str(pid),
                        "name": str(_get_arg(item, "name", "pattern_name", "label", default=pid)),
                        "family": str(_get_arg(item, "family", default="unknown")),
                        "direction": str(_get_arg(item, "direction", default="neutral")),
                    }
            except Exception:
                continue
            break

    merged: Dict[str, Dict[str, str]] = {p["pattern_id"]: p for p in CONTRACT_PATTERNS}
    merged.update(discovered)  # real catalog authority over fallback
    return list(merged.values()), (None if discovered else "pattern catalog not importable — using CONTRACT fallback catalog")


# --------------------------------------------------------------------------- #
# Candle fetch (real V3 transport only)
# --------------------------------------------------------------------------- #

def _local_resample(df, minutes: int):
    import pandas as pd  # local import; pandas is an existing dep

    if minutes % 1440 == 0:
        rule = f"{minutes // 1440}D"
    elif minutes % 60 == 0:
        rule = f"{minutes // 60}h"
    else:
        rule = f"{minutes}min"

    agg = {}
    for col in df.columns:
        c = col.lower()
        if c == "open":
            agg[col] = "first"
        elif c == "high":
            agg[col] = "max"
        elif c == "low":
            agg[col] = "min"
        elif c == "close":
            agg[col] = "last"
        elif c in ("volume",):
            agg[col] = "sum"
        else:
            agg[col] = "last"
    return (
        df.resample(rule, label="left", closed="left")
        .agg(agg)
        .dropna(subset=["close"])
    )


def _call_fetch_for_timeframe(fn, symbol: str, spec: Any, api_client):
    """Best-effort call of chart_patterns.candles.fetch_for_timeframe with an
    unknown-but-contract-aligned signature."""
    tf_id = _spec_get(spec, "id")
    try:
        named = set(inspect.signature(fn).parameters)
    except (TypeError, ValueError):
        return fn(symbol, tf_id)

    tf_key = next((k for k in ("tf", "timeframe", "tf_id") if k in named), None)
    if "symbol" in named and tf_key:
        kwargs: Dict[str, Any] = {"symbol": symbol, tf_key: tf_id}
        if "api_client" in named:
            kwargs["api_client"] = api_client
        try:
            return fn(**kwargs)
        except TypeError:
            return fn(symbol, tf_id)
    # Positional-only signature.
    return fn(symbol, tf_id)


def fetch_for_spec(symbol: str, spec: Any, api_client, from_date: str, to_date: str):
    """Return (df, error). Uses chart_patterns.candles first, market_data second."""
    candles_mod = _try_import("chart_patterns.candles")
    if candles_mod is not None and hasattr(candles_mod, "fetch_for_timeframe"):
        try:
            df = _call_fetch_for_timeframe(candles_mod.fetch_for_timeframe, symbol, spec, api_client)
            if df is not None and not getattr(df, "empty", True):
                return df, None
        except Exception as exc:
            # Fall through to the market_data adapter, but remember the reason.
            fallback_reason = str(exc)
        else:
            fallback_reason = "fetch_for_timeframe returned empty"
    else:
        fallback_reason = None

    md = _try_import("market_data.market_data")
    if md is None or not hasattr(md, "fetch_candles"):
        return None, f"market_data.fetch_candles unavailable (reason: {fallback_reason or 'n/a'})"

    minutes = int(_spec_get(spec, "minutes") or 0)
    source_tf = _spec_get(spec, "source_tf")
    source_minutes = minutes
    if source_tf:
        tf_mod = _try_import("chart_patterns.timeframes")
        src_spec = None
        if tf_mod is not None and hasattr(tf_mod, "get_timeframe"):
            try:
                src_spec = tf_mod.get_timeframe(source_tf)
            except Exception:
                src_spec = None
        if src_spec is None:
            src_spec = next((s for s in FALLBACK_TFSPECS if s["id"] == source_tf), None)
        source_minutes = int(_spec_get(src_spec, "minutes") or minutes)

    try:
        df = md.fetch_candles(
            symbol,
            tf=source_minutes,
            from_date=from_date,
            to_date=to_date,
            resample_to=None,
            api_client=api_client,
        )
    except Exception as exc:
        return None, f"market_data.fetch_candles raised: {exc}"

    if df is None or getattr(df, "empty", True):
        return None, fallback_reason or "no candles returned"

    if minutes and minutes != source_minutes:
        try:
            df = _local_resample(df, minutes)
        except Exception as exc:  # pragma: no cover
            return df, f"resample to {minutes}min failed: {exc}"
    return df, None


# --------------------------------------------------------------------------- #
# Core scan
# --------------------------------------------------------------------------- #

def run_scan(
    symbols: List[str],
    specs: List[Any],
    api_client,
    sleep_sec: float,
    min_bars_override: Optional[int],
    progress: bool = True,
) -> List[Dict[str, Any]]:
    import time as _time

    engine = _try_import("chart_patterns.engine")
    detect = getattr(engine, "detect_patterns", None) if engine is not None else None

    today_str = _today().strftime("%Y-%m-%d")

    def scan_one(spec, symbol) -> Dict[str, Any]:
        tf_id = _spec_get(spec, "id")
        max_lookback = int(_spec_get(spec, "max_lookback_days") or 90)
        min_bars = min_bars_override or int(_spec_get(spec, "min_bars") or 60)
        from_date = (_today() - timedelta(days=max_lookback)).strftime("%Y-%m-%d")
        entry: Dict[str, Any] = {
            "symbol": symbol,
            "timeframe": tf_id,
            "from_date": from_date,
            "to_date": today_str,
            "bars": 0,
            "min_bars": min_bars,
            "fetch_status": "ok",
            "fetch_error": None,
            "skip_reason": None,
            "detect_error": None,
            "hits": [],
        }
        try:
            df, err = fetch_for_spec(symbol, spec, api_client, from_date, today_str)
        except Exception as exc:  # defensive: fetch should not raise
            df, err = None, f"{type(exc).__name__}: {exc}"
            entry["fetch_error_trace"] = traceback.format_exc(limit=3)

        if df is None or getattr(df, "empty", True):
            entry["fetch_status"] = "failed"
            entry["fetch_error"] = err or "no candles"
            return entry

        bars = int(len(df))
        entry["bars"] = bars
        if bars < min_bars:
            entry["skip_reason"] = f"history needed ({bars} < {min_bars} bars)"
            return entry

        if detect is None:
            entry["detect_error"] = "chart_patterns.engine.detect_patterns unavailable"
        else:
            try:
                raw_hits = detect(df, tf_id, symbol) or []
                entry["hits"] = [_hit_to_dict(h) for h in raw_hits]
            except Exception as exc:
                entry["detect_error"] = f"{type(exc).__name__}: {exc}"
                entry["detect_error_trace"] = traceback.format_exc(limit=3)
        if sleep_sec:
            import time as _time
            _time.sleep(sleep_sec)
        return entry

    pairs = [(spec, symbol) for spec in specs for symbol in symbols]
    workers = max(1, int(os.environ.get("PATTERN_SCAN_SYMBOL_WORKERS", "8")))
    results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(scan_one, spec, symbol) for spec, symbol in pairs]
        for future in as_completed(futures):
            entry = future.result()
            results.append(entry)
            if progress:
                tf_id = entry["timeframe"]
                symbol = entry["symbol"]
                if entry["fetch_status"] == "failed":
                    _log(f"  [{tf_id:>4}] {symbol:<12} FETCH FAILED: {(entry['fetch_error'] or '')[:80]}")
                elif entry["skip_reason"]:
                    _log(f"  [{tf_id:>4}] {symbol:<12} SKIP  {entry['skip_reason']}")
                elif entry["detect_error"]:
                    _log(f"  [{tf_id:>4}] {symbol:<12} bars={entry['bars']:<5} DETECT ERROR: {entry['detect_error'][:70]}")
                else:
                    _log(f"  [{tf_id:>4}] {symbol:<12} bars={entry['bars']:<5} hits={len(entry['hits'])}")

    # deterministic order for the report
    results.sort(key=lambda r: (r["timeframe"], r["symbol"]))
    return results


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #

def write_csv(path: Path, results: List[Dict[str, Any]]) -> int:
    n = 0
    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["symbol", "tf", "pattern_id", "status", "quality", "confidence", "rr", "bars_ago"])
        for r in results:
            for h in r.get("hits", []):
                writer.writerow([
                    r["symbol"],
                    r["timeframe"],
                    h.get("pattern_id", ""),
                    h.get("status", ""),
                    h.get("quality", ""),
                    "" if h.get("confidence") is None else f"{h['confidence']:.2f}",
                    "" if h.get("rr") is None else f"{h['rr']:.2f}",
                    "" if h.get("bars_ago") is None else h["bars_ago"],
                ])
                n += 1
    return n


def build_summary_md(
    results: List[Dict[str, Any]],
    specs: List[Any],
    symbols: List[str],
    catalog: List[Dict[str, str]],
    catalog_note: Optional[str],
    tf_note: Optional[str],
    engine_available: bool,
    out_dir: Path,
) -> str:
    tf_ids = [_spec_get(s, "id") for s in specs]
    pattern_ids = [p["pattern_id"] for p in catalog]
    catalog_by_id = {p["pattern_id"]: p for p in catalog}

    # hits[pattern_id][tf] = list of statuses
    hits: Dict[str, Dict[str, List[str]]] = {pid: defaultdict(list) for pid in pattern_ids}
    for r in results:
        for h in r.get("hits", []):
            pid = h.get("pattern_id") or "unknown"
            hits.setdefault(pid, defaultdict(list))
            hits[pid][r["timeframe"]].append(h.get("status") or "?")
            if pid not in catalog_by_id:
                catalog_by_id[pid] = {"pattern_id": pid, "name": pid, "family": "unknown", "direction": "unknown"}
                if pid not in pattern_ids:
                    pattern_ids.append(pid)

    lines: List[str] = []
    lines.append("# Chart Patterns — Real-Candle Verification")
    lines.append("")
    lines.append(f"- Generated: `{_today().isoformat(timespec='seconds')}`")
    lines.append(f"- Output dir: `{out_dir}`")
    lines.append(f"- Symbols ({len(symbols)}): {', '.join(symbols)}")
    lines.append(f"- Timeframes ({len(tf_ids)}): {', '.join(tf_ids)}")
    lines.append(f"- Engine available: `{engine_available}`")
    if catalog_note:
        lines.append(f"- ⚠️ Catalog note: {catalog_note}")
    if tf_note:
        lines.append(f"- ⚠️ Timeframe note: {tf_note}")
    lines.append("")

    # -------- zero hits ---------------------------------------------------- #
    zero_hits = [pid for pid in pattern_ids if not any(hits.get(pid, {}).get(tf) for tf in tf_ids)]
    lines.append("## Patterns with ZERO hits (possible detector gap)")
    lines.append("")
    if not engine_available:
        lines.append("> Engine not importable — every pattern is reported as zero-hit by definition. "
                     "Re-run after `chart_patterns/engine.py` lands.")
    elif zero_hits:
        for pid in zero_hits:
            meta = catalog_by_id.get(pid, {})
            lines.append(f"- `{pid}` — {meta.get('name', pid)} ({meta.get('family', '?')}/{meta.get('direction', '?')})")
    else:
        lines.append("- None — every catalogued pattern fired at least once. 🎉")
    lines.append("")

    # -------- matrix ------------------------------------------------------- #
    lines.append("## Matrix: pattern_id × timeframe (hit count + statuses)")
    lines.append("")
    lines.append("Status legend: `c`=confirmed, `f`=forming, `x`=failed, `m`=marginal. "
                 "A cell shows the hit count; bracketed letters show the statuses observed.")
    lines.append("")
    header = "| pattern_id | family | dir | " + " | ".join(tf_ids) + " | total |"
    sep = "|" + "---|" * (3 + len(tf_ids) + 1)
    lines.append(header)
    lines.append(sep)
    for pid in pattern_ids:
        meta = catalog_by_id.get(pid, {})
        cells = []
        total = 0
        for tf in tf_ids:
            statuses = hits.get(pid, {}).get(tf, [])
            total += len(statuses)
            if not statuses:
                cells.append("·")
            else:
                shorts = "".join(sorted({STATUS_SHORT.get(s, "?") for s in statuses}))
                cells.append(f"{len(statuses)} [{shorts}]")
        lines.append(
            f"| `{pid}` | {meta.get('family', '?')} | {meta.get('direction', '?')} | "
            + " | ".join(cells)
            + f" | {total} |"
        )
    lines.append("")

    # -------- per-TF fetch report ----------------------------------------- #
    lines.append("## Fetch / coverage report per timeframe")
    lines.append("")
    lines.append("| timeframe | symbols | fetched ok | skipped (history) | fetch failed | detect errors | median bars |")
    lines.append("|---|---|---|---|---|---|---|")
    for tf in tf_ids:
        rows = [r for r in results if r["timeframe"] == tf]
        ok = [r for r in rows if r["fetch_status"] == "ok" and not r.get("skip_reason")]
        skipped = [r for r in rows if r.get("skip_reason")]
        failed = [r for r in rows if r["fetch_status"] == "failed"]
        detect_err = [r for r in rows if r.get("detect_error")]
        bars = [r["bars"] for r in rows if r.get("bars")]
        med = f"{statistics.median(bars):.0f}" if bars else "—"
        lines.append(f"| {tf} | {len(rows)} | {len(ok)} | {len(skipped)} | {len(failed)} | {len(detect_err)} | {med} |")
    lines.append("")

    # -------- failures detail --------------------------------------------- #
    failures = [r for r in results if r["fetch_status"] == "failed"]
    lines.append("## Fetch failures (raw)")
    lines.append("")
    if not failures:
        lines.append("- None.")
    else:
        for r in failures:
            lines.append(f"- `{r['timeframe']}` {r['symbol']}: {r.get('fetch_error')}")
    lines.append("")

    detect_errors = [r for r in results if r.get("detect_error")]
    lines.append("## Detector errors")
    lines.append("")
    if not detect_errors:
        lines.append("- None.")
    else:
        for r in detect_errors:
            lines.append(f"- `{r['timeframe']}` {r['symbol']}: {r['detect_error']}")
    lines.append("")

    lines.append("## How to read this")
    lines.append("")
    lines.append("- Run only proves the detector returned hits for the sampled liquid symbols; "
                 "a pattern with zero hits across **all** symbols/TFs is the signal to inspect — "
                 "it may be genuinely rare on these names or a detector gap.")
    lines.append("- `report.json` holds every hit with trendlines/prices for manual charting.")
    lines.append("- `report.csv` is the flat table for pivoting in a spreadsheet.")
    lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify chart patterns on real Upstox V3 candles.")
    parser.add_argument("--symbols", default=None,
                        help="Comma-separated NSE symbols. Default: small liquid NSE_EQ sample from instruments file.")
    parser.add_argument("--timeframes", default="all",
                        help="'all' or comma-separated TF ids (e.g. '1D,1h,15m'). Default: all.")
    parser.add_argument("--limit", type=int, default=0, help="Max symbols to scan. Default: 0 (all).")
    parser.add_argument("--out", default="reports/chart_patterns_verification",
                        help="Output directory. Default: reports/chart_patterns_verification.")
    parser.add_argument("--sleep", type=float, default=0.2,
                        help="Seconds to sleep between fetches (be polite to the API). Default: 0.2.")
    parser.add_argument("--min-bars", type=int, default=None,
                        help="Override min bars required for detection.")
    parser.add_argument("--quiet", action="store_true", help="Suppress per-symbol progress lines.")
    parser.add_argument("--strict", action="store_true",
                        help="Exit non-zero if the engine is missing or no candle was ever fetched.")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = PROJECT_DIR / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    _log("=== Chart Patterns verification harness ===")

    symbols, sym_note = resolve_symbols(args.symbols, max(0, args.limit))
    specs, tf_note = resolve_timeframes(args.timeframes)
    catalog, catalog_note = resolve_catalog()

    _log(f"  symbols ({len(symbols)}): {', '.join(symbols)}")
    if sym_note:
        _log(f"  ! {sym_note}")
    _log(f"  timeframes ({len(specs)}): {', '.join(str(_spec_get(s, 'id')) for s in specs)}")
    if tf_note:
        _log(f"  ! {tf_note}")
    if catalog_note:
        _log(f"  ! {catalog_note}")

    engine = _try_import("chart_patterns.engine")
    detect = getattr(engine, "detect_patterns", None) if engine is not None else None
    engine_available = detect is not None
    if not engine_available:
        _log("  ! chart_patterns.engine.detect_patterns is not importable yet — "
             "will record fetch coverage and mark all detectors as gap.")

    # API client — tolerant of missing token.
    api_client = None
    client_error = None
    md = _try_import("market_data.market_data")
    if md is not None and hasattr(md, "get_api_client"):
        try:
            api_client = md.get_api_client()
        except Exception as exc:
            client_error = str(exc)
    if api_client is None:
        client_error = client_error or "no Upstox client/token resolved"
        _log(f"  ! Upstox client unavailable: {client_error}")
    else:
        _log("  Upstox client resolved.")

    _log("")
    results = run_scan(
        symbols=symbols,
        specs=specs,
        api_client=api_client,
        sleep_sec=args.sleep,
        min_bars_override=args.min_bars,
        progress=not args.quiet,
    )

    # Artifacts -------------------------------------------------------------
    report = {
        "meta": {
            "generated_at": _today().isoformat(timespec="seconds"),
            "symbols": symbols,
            "timeframes": [_spec_get(s, "id") for s in specs],
            "engine_available": engine_available,
            "api_client_available": api_client is not None,
            "client_error": client_error,
            "catalog_note": catalog_note,
            "symbol_note": sym_note,
        },
        "catalog": catalog,
        "results": results,
    }
    json_path = out_dir / "report.json"
    with open(json_path, "w") as fh:
        json.dump(report, fh, indent=2, default=str)

    csv_path = out_dir / "report.csv"
    hit_rows = write_csv(csv_path, results)

    summary = build_summary_md(
        results=results,
        specs=specs,
        symbols=symbols,
        catalog=catalog,
        catalog_note=catalog_note,
        tf_note=tf_note,
        engine_available=engine_available,
        out_dir=out_dir,
    )
    summary_path = out_dir / "SUMMARY.md"
    summary_path.write_text(summary)

    total_fetched = sum(1 for r in results if r.get("bars"))
    total_failed = sum(1 for r in results if r["fetch_status"] == "failed")
    _log("")
    _log("--- summary ---")
    _log(f"  (symbol,tf) pairs : {len(results)}")
    _log(f"  candles fetched   : {total_fetched}")
    _log(f"  fetch failures    : {total_failed}")
    _log(f"  hit rows          : {hit_rows}")
    _log(f"  report.json       : {json_path}")
    _log(f"  report.csv        : {csv_path}")
    _log(f"  SUMMARY.md        : {summary_path}")

    if total_failed == len(results) and results:
        _log("  ! every fetch failed — likely missing/expired Upstox token or V3 error.")

    if args.strict and (not engine_available or total_fetched == 0):
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
