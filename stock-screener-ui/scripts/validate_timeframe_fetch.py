#!/usr/bin/env python3
"""Live smoke harness for the unified candle fetcher (Agent: validation).

For every timeframe id in ``chart_patterns.timeframes.TIMEFRAME_IDS`` this
fetches ``fetch_candles_for_timeframe`` for each ``--symbols`` symbol and
validates invariants:

  - non-empty,
  - tz-aware UTC index, strictly ascending, no duplicate timestamps,
  - OHLC sane: high >= max(open, close), low <= min(open, close) (tiny eps),
  - bar spacing == timeframe minutes for intraday (session gaps tolerated via
    mode + majority fraction), calendar-appropriate for 1D/1W/1M,
  - last bar date reported (1D recency visible).

Usage (from repo root ``stock-screener-ui``)::

    python scripts/validate_timeframe_fetch.py \\
        --symbols TMPV INFY RELIANCE --lookback 250 [--include-partial]

Prints a per-symbol x per-timeframe table plus a final summary. Exit 0 when
every timeframe passes, 1 when any fails, 2 on fatal setup errors. One shared
``api_client = get_api_client()`` is reused across all fetches; per-timeframe
errors are caught, reported, and never crash the run.
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path
from typing import Any, NamedTuple

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent  # stock-screener-ui
ROOT_DIR = PROJECT_DIR.parent  # repo root

for _p in (str(PROJECT_DIR), str(ROOT_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import pandas as pd  # noqa: E402

from chart_patterns.timeframes import TIMEFRAME_IDS, get_timeframe  # noqa: E402

try:
    from market_data.market_data import (  # noqa: E402
        fetch_candles_for_timeframe,
        get_api_client,
    )

    _IMPORT_ERROR: ImportError | None = None
except ImportError as _exc:  # fetcher not yet implemented: main() exits 2
    fetch_candles_for_timeframe = None  # type: ignore[assignment]
    get_api_client = None  # type: ignore[assignment]
    _IMPORT_ERROR = _exc


# Tolerances ---------------------------------------------------------------
EPS_REL = 1e-9          # OHLC float epsilon (relative to price scale)
INTRADAY_TOL_MIN = 1.0  # bar-spacing clock-skew tolerance (minutes)
INTRADAY_MIN_FRAC = 0.4  # min fraction of diffs at the modal spacing
DAILY_MIN_FRAC = 0.7
REQUIRED_COLS = ("open", "high", "low", "close", "volume")


class CheckResult(NamedTuple):
    symbol: str
    tf_id: str
    rows: int
    last: str
    age: str
    spacing: str
    status: str  # "PASS" | "FAIL"
    detail: str


# Individual checks (import-safe: usable without the fetcher present) --------

def check_tz_ascending_unique(df: pd.DataFrame) -> tuple[bool, str]:
    """UTC tz-aware, strictly ascending, duplicate-free index."""
    if df.index.tz is None:
        return False, "index is tz-naive"
    if str(df.index.tz) != "UTC":
        return False, f"index tz={df.index.tz}, want UTC"
    if not df.index.is_monotonic_increasing:
        return False, "index not ascending"
    if len(df) > 1 and not bool((df.index[1:] > df.index[:-1]).all()):
        return False, "index not strictly ascending"
    if bool(df.index.has_duplicates):
        return False, "duplicate timestamps"
    return True, "utc/asc/unique ok"


def check_ohlc(df: pd.DataFrame) -> tuple[bool, str]:
    """high >= max(open, close), low <= min(open, close) within epsilon."""
    missing = [c for c in REQUIRED_COLS if c not in df.columns]
    if missing:
        return False, f"missing columns {missing}"
    hi = df[["open", "close"]].max(axis=1)
    lo = df[["open", "close"]].min(axis=1)
    scale = hi.abs().clip(lower=1.0)
    bad = int(
        ((df["high"] < hi - EPS_REL * scale)
         | (df["low"] > lo + EPS_REL * scale)).sum()
    )
    if bad:
        return False, f"{bad} OHLC violation(s)"
    return True, "ohlc sane"


def check_spacing(df: pd.DataFrame, tf_id: str) -> tuple[bool, str]:
    """Bar spacing matches the timeframe.

    Intraday (1m..4h): the *modal* diff must equal the timeframe minutes and
    at least ``INTRADAY_MIN_FRAC`` of diffs must match it — overnight/weekend
    session gaps are the tolerated minority. 1D/1W/1M use calendar-appropriate
    day multiples.
    """
    spec = get_timeframe(tf_id)
    if len(df) < 2:
        return False, "fewer than 2 bars, spacing unverifiable"
    diffs_min = (
        df.index.to_series().diff().dropna().dt.total_seconds() / 60.0
    )
    if spec.minutes < 1440:
        expected = float(spec.minutes)
        match = (diffs_min - expected).abs() <= INTRADAY_TOL_MIN
        frac = float(match.mean())
        mode = float(diffs_min.round().mode().iloc[0])
        ok = abs(mode - expected) <= INTRADAY_TOL_MIN and frac >= INTRADAY_MIN_FRAC
        return ok, f"mode={mode:g}m match={frac:.0%}"
    days = diffs_min / 1440.0
    median_d = float(days.median())
    if tf_id == "1D":
        whole = ((days - days.round()).abs() < 0.02) & (days.round() >= 1) & (
            days.round() <= 7
        )
        frac = float(whole.mean())
        ok = 0.5 <= median_d <= 2.0 and frac >= DAILY_MIN_FRAC
        return ok, f"median={median_d:.2f}d whole-day={frac:.0%}"
    if tf_id == "1W":
        mult7 = ((days / 7.0 - (days / 7.0).round()).abs() < 0.03) & (
            days >= 6.5
        ) & (days <= 28.5)
        frac = float(mult7.mean())
        ok = 6.0 <= median_d <= 8.0 and frac >= DAILY_MIN_FRAC
        return ok, f"median={median_d:.2f}d x7={frac:.0%}"
    # 1M: month lengths vary 28..31 days.
    in_month = (days >= 27.0) & (days <= 32.5)
    frac = float(in_month.mean())
    ok = 27.0 <= median_d <= 32.5 and frac >= DAILY_MIN_FRAC
    return ok, f"median={median_d:.2f}d in-27..32d={frac:.0%}"


def check_one(df: pd.DataFrame | None, symbol: str, tf_id: str) -> CheckResult:
    """Run all invariant checks on one fetched frame."""
    if df is None or df.empty:
        return CheckResult(symbol, tf_id, 0, "-", "-", "-", "FAIL", "empty")
    try:
        last_ts = df.index[-1]
        last = last_ts.strftime("%Y-%m-%d %H:%M UTC")
        age_td = pd.Timestamp.now(tz="UTC") - last_ts
        age_days = age_td.total_seconds() / 86400.0
        age = (
            f"{age_days:.1f}d"
            if age_days >= 1
            else f"{age_td.total_seconds() / 3600.0:.1f}h"
        )
    except Exception:  # noqa: BLE001 - e.g. non-datetime index; checks below fail it
        last, age = str(df.index[-1]), "?"
    failures: list[str] = []
    ok, _ = check_tz_ascending_unique(df)
    if not ok:
        failures.append(_)
    ok, _ = check_ohlc(df)
    if not ok:
        failures.append(_)
    ok, spacing = check_spacing(df, tf_id)
    if not ok:
        failures.append(f"spacing: {spacing}")
    if failures:
        return CheckResult(
            symbol, tf_id, len(df), last, age, spacing, "FAIL",
            "; ".join(failures),
        )
    return CheckResult(
        symbol, tf_id, len(df), last, age, spacing, "PASS", "ok"
    )


# Runner --------------------------------------------------------------------

def validate_symbol_timeframe(
    symbol: str,
    tf_id: str,
    lookback: int,
    include_partial: bool,
    api_client: Any,
) -> CheckResult:
    """Fetch one (symbol, timeframe) and validate; never raises."""
    try:
        df = fetch_candles_for_timeframe(
            symbol,
            tf_id,
            lookback_bars=lookback,
            include_partial_today=include_partial,
            api_client=api_client,
        )
    except Exception as exc:  # noqa: BLE001 - report, don't crash
        return CheckResult(
            symbol, tf_id, 0, "-", "-", "-", "FAIL",
            f"error: {type(exc).__name__}: {exc}",
        )
    try:
        return check_one(df, symbol, tf_id)
    except Exception as exc:  # noqa: BLE001 - a check itself must not crash
        rows = 0 if df is None else len(df)
        return CheckResult(
            symbol, tf_id, rows, "-", "-", "-", "FAIL",
            f"check crashed: {type(exc).__name__}: {exc}\n"
            + traceback.format_exc(limit=3),
        )


def _print_table(results: list[CheckResult]) -> None:
    headers = ("Symbol", "TF", "Rows", "Last (UTC)", "Age", "Spacing", "Status")
    rows = [
        [r.symbol, r.tf_id, str(r.rows), r.last, r.age, r.spacing, r.status]
        for r in results
    ]
    widths = [
        max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)
    ]
    # Detail column printed on its own wrapped line for FAIL rows.
    print("  ".join(h.ljust(w) for h, w in zip(headers, widths)))
    print("  ".join("-" * w for w in widths))
    for r, row in zip(results, rows):
        print("  ".join(c.ljust(w) for c, w in zip(row, widths)))
        if r.status == "FAIL":
            print(f"    -> {r.detail}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Live smoke: validate fetch_candles_for_timeframe "
                    "on all timeframe ids."
    )
    parser.add_argument("--symbols", nargs="+", default=["TMPV", "INFY"])
    parser.add_argument("--lookback", type=int, default=250)
    parser.add_argument(
        "--include-partial",
        action="store_true",
        help="pass include_partial_today=True to every fetch",
    )
    args = parser.parse_args(argv)

    if _IMPORT_ERROR is not None:
        print(
            "ERROR: fetch_candles_for_timeframe is not implemented yet "
            f"(import failed: {_IMPORT_ERROR})."
        )
        return 2

    print(
        f"Validating {len(TIMEFRAME_IDS)} timeframes "
        f"{TIMEFRAME_IDS} x {len(args.symbols)} symbol(s) "
        f"{list(args.symbols)}, lookback={args.lookback}, "
        f"include_partial={args.include_partial}"
    )
    try:
        api_client = get_api_client()
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: get_api_client() raised {type(exc).__name__}: {exc}")
        return 2
    if api_client is None:
        print(
            "ERROR: get_api_client() returned None — no Upstox credentials. "
            "Set UPSTOX_API_KEY/UPSTOX_API_SECRET or connect a broker token."
        )
        return 2

    results: list[CheckResult] = []
    for symbol in args.symbols:
        for tf_id in TIMEFRAME_IDS:
            print(f"... {symbol} {tf_id}", flush=True)
            results.append(
                validate_symbol_timeframe(
                    symbol, tf_id, args.lookback, args.include_partial,
                    api_client,
                )
            )

    print()
    _print_table(results)
    print()

    failed = [r for r in results if r.status == "FAIL"]
    by_tf: dict[str, list[CheckResult]] = {}
    for r in results:
        by_tf.setdefault(r.tf_id, []).append(r)
    for tf_id in TIMEFRAME_IDS:
        tf_rows = by_tf[tf_id]
        n_pass = sum(1 for r in tf_rows if r.status == "PASS")
        print(f"{tf_id}: {n_pass}/{len(tf_rows)} symbol(s) PASS")
    print(
        f"\nTOTAL: {len(results) - len(failed)}/{len(results)} passed; "
        f"{len(failed)} failed."
    )
    if failed:
        bad_tfs = sorted({r.tf_id for r in failed})
        print(f"FAILED timeframes: {bad_tfs}")
        return 1
    print("ALL TIMEFRAMES PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
