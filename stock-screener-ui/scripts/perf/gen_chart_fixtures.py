#!/usr/bin/env python3
"""Generate real POWERGRID.NS fixtures for the interactive chart perf harness.

The harness must measure the real UI and the real indicator/S-R math, not
synthetic candles. This script fetches OHLCV once with yfinance, resamples with
the backend's own ``chart_patterns.candles._resample_ohlcv``, then runs the real
``compute_indicators`` + ``compute_sr_zones`` for each of the 11 enabled
timeframes. It also records backend timings (1 warm-up + N measured runs).

Usage:
    source .venv/bin/activate
    python scripts/perf/gen_chart_fixtures.py \
        --out /workspaces/test-rag/.agent-artifacts/chart-perf/fixtures \
        --symbol POWERGRID.NS --bars 500 --as-of 2026-11-24

    # No network: re-time the candles already in fixtures.json and refresh
    # only manifest.json (5 warm-ups + 30 measured runs by default).
    python scripts/perf/gen_chart_fixtures.py --from-fixtures \
        --out /workspaces/test-rag/.agent-artifacts/chart-perf/fixtures

Artifacts (under --out):
    fixtures.json   per-timeframe {candles, indicators, sr_zones}
    manifest.json   sources, actual bar counts, hardware, indicator timings

Network: yfinance only. No DB, no broker auth, no server.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import platform
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

UI_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(UI_ROOT))

from chart_patterns.candles import _resample_ohlcv  # noqa: E402
from chart_patterns.indicators import compute_indicators  # noqa: E402
from chart_patterns.levels import compute_sr_zones  # noqa: E402
from chart_patterns.timeframes import TIMEFRAMES  # noqa: E402
from market_data.market_data import _resample_rule  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
DEFAULT_SYMBOL = "POWERGRID.NS"
DISABLED_TIMEFRAMES = {"3m", "2h"}
DEFAULT_BARS = 500
DEFAULT_RUNS = 3

# target TF -> (yfinance interval, calendar days of history). Daily source is
# used for 1D/1W/1M so weekly/monthly frames keep a usable history; intraday
# frames come from the coarsest interval that still has enough bars.
SOURCE_PLAN: dict[str, tuple[str, int]] = {
    "1m": ("1m", 7),
    "5m": ("5m", 59),
    "10m": ("5m", 59),
    "15m": ("15m", 59),
    "30m": ("30m", 59),
    "1h": ("60m", 729),
    "3h": ("60m", 729),
    "4h": ("60m", 729),
    "1D": ("1d", 7300),
    "1W": ("1d", 7300),
    "1M": ("1d", 7300),
}


def _artifact_root() -> Path:
    """Durable default: workspace artifacts in Codespaces, /tmp otherwise."""
    override = os.environ.get("CHART_PERF_ARTIFACT_DIR")
    if override:
        return Path(override).expanduser()
    if os.environ.get("CODESPACES"):
        return Path("/workspaces/test-rag/.agent-artifacts/chart-perf")
    return Path("/tmp/opencode/chart-perf")


def _parse_date(value: str) -> date:
    try:
        return datetime.fromisoformat(value.strip()).date()
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError(
            f"invalid --as-of {value!r}; expected YYYY-MM-DD"
        ) from exc


def _default_as_of() -> date:
    """Previous weekday (a completed session), so a default run is repeatable."""
    candidate = datetime.now(IST).date() - timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate -= timedelta(days=1)
    return candidate


def _enabled_timeframes() -> list:
    return [tf for tf in TIMEFRAMES if tf.id not in DISABLED_TIMEFRAMES]


def _import_yfinance():
    try:
        import yfinance as yf
    except ImportError as exc:  # pragma: no cover - environment guard
        raise SystemExit(
            "yfinance is required for fixtures. Activate the project venv "
            "(`source .venv/bin/activate`) or install requirements."
        ) from exc
    return yf


def _normalise_frame(frame: pd.DataFrame, interval: str, end_ts: pd.Timestamp) -> pd.DataFrame:
    if frame is None or getattr(frame, "empty", True):
        return pd.DataFrame()
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)
    frame = frame.rename(columns={str(col): str(col).lower() for col in frame.columns})
    needed = ["open", "high", "low", "close", "volume"]
    missing = [col for col in needed if col not in frame.columns]
    if missing:
        raise RuntimeError(f"yfinance frame missing columns: {missing}")
    frame = frame[needed].apply(pd.to_numeric, errors="coerce")
    frame = frame.dropna(subset=["close"])
    frame.index = pd.to_datetime(frame.index)
    if frame.index.tz is None:
        if interval.endswith("d"):
            # Backend daily bars are stamped at IST midnight.
            frame.index = frame.index.tz_localize(IST).normalize()
        else:
            frame.index = frame.index.tz_localize("UTC").tz_convert(IST)
    else:
        frame.index = frame.index.tz_convert(IST)
        if interval.endswith("d"):
            frame.index = frame.index.normalize()
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    frame = frame[frame.index <= end_ts]
    return frame


def _fetch_frame(symbol: str, interval: str, days: int, end_ts: pd.Timestamp) -> pd.DataFrame:
    yf = _import_yfinance()
    start = (end_ts - pd.Timedelta(days=days)).date().isoformat()
    end = (end_ts.date() + timedelta(days=1)).isoformat()
    try:
        frame = yf.download(
            symbol,
            start=start,
            end=end,
            interval=interval,
            auto_adjust=False,
            progress=False,
            threads=False,
        )
    except Exception as exc:
        raise RuntimeError(
            f"yfinance failed for {symbol} interval={interval}: {exc}"
        ) from exc
    normalised = _normalise_frame(frame, interval, end_ts)
    if normalised.empty:
        raise RuntimeError(
            f"yfinance returned no usable bars for {symbol} interval={interval} "
            f"({start} -> {end})"
        )
    return normalised


def _resample_to(frame: pd.DataFrame, tf_id: str) -> pd.DataFrame:
    if tf_id == "1W":
        return _resample_ohlcv(frame, "W-FRI", label="right", closed="right").dropna(
            subset=["close"]
        )
    if tf_id == "1M":
        return _resample_ohlcv(frame, "ME", label="right", closed="right").dropna(
            subset=["close"]
        )
    spec = next((tf for tf in TIMEFRAMES if tf.id == tf_id), None)
    if spec is None:
        raise RuntimeError(f"unknown timeframe {tf_id!r}")
    rule = _resample_rule(int(spec.minutes))
    return _resample_ohlcv(frame, rule, label="left", closed="left").dropna(
        subset=["close"]
    )


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def _candles_json(frame: pd.DataFrame, limit: int) -> list[dict]:
    out: list[dict] = []
    for idx, row in frame.tail(limit).iterrows():
        out.append(
            {
                "t": idx.isoformat() if hasattr(idx, "isoformat") else str(idx),
                "o": _finite(row.get("open")),
                "h": _finite(row.get("high")),
                "l": _finite(row.get("low")),
                "c": _finite(row.get("close")),
                "v": _finite(row.get("volume")),
            }
        )
    return out


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _jsonable(entry) for key, entry in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(entry) for entry in value]
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    return value


def _percentile(samples: list[float], fraction: float) -> float:
    ordered = sorted(samples)
    if not ordered:
        return 0.0
    index = max(0, math.ceil(fraction * len(ordered)) - 1)
    return ordered[index]


def _compute_raw(candles: list[dict], tf_id: str) -> tuple[dict, list]:
    indicators = compute_indicators(
        candles, tf_id, "Asia/Kolkata", partial_last=False
    )
    zones = compute_sr_zones(
        candles, session="Asia/Kolkata", timeframe=tf_id
    )
    return indicators, zones


def _measure_extras(
    candles: list[dict], tf_id: str, runs: int, warmups: int = 1
) -> tuple[dict, dict]:
    # Warm-up: imports, numpy plans and pandas paths are not part of the gate.
    for _ in range(max(0, warmups)):
        _compute_raw(candles, tf_id)
    samples: list[float] = []
    indicators: dict = {}
    zones: list = []
    for _ in range(max(1, runs)):
        started = time.perf_counter()
        indicators, zones = _compute_raw(candles, tf_id)
        samples.append((time.perf_counter() - started) * 1000.0)
    return _jsonable({"indicators": indicators, "sr_zones": zones}), {
        "samples_ms": [round(value, 3) for value in samples],
        "median_ms": round(float(np.median(samples)), 3),
        "p95_ms": round(_percentile(samples, 0.95), 3),
    }


def _payload_sizes(candles: list[dict], extras: dict, symbol: str) -> dict:
    indicator_raw = json.dumps(
        extras, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    chart_raw = json.dumps(
        {
            "symbol": symbol,
            "candles": candles,
            "overlays": [],
            "hits": [],
            **extras,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return {
        "indicator_raw_bytes": len(indicator_raw),
        "indicator_gzip_bytes": len(gzip.compress(indicator_raw, mtime=0)),
        "chart_raw_bytes": len(chart_raw),
        "chart_gzip_bytes": len(gzip.compress(chart_raw, mtime=0)),
    }


def _hardware() -> dict:
    return {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "cpu": platform.processor() or platform.machine(),
        "pandas": pd.__version__,
        "numpy": np.__version__,
    }


def measure_existing_fixtures(out_dir: Path, runs: int, warmups: int) -> int:
    """Re-time real candles already on disk; rewrite only manifest.json."""
    fixtures_path = out_dir / "fixtures.json"
    if not fixtures_path.exists():
        raise SystemExit(f"missing {fixtures_path}; generate fixtures first")
    fixture_payload = json.loads(fixtures_path.read_text(encoding="utf-8"))
    timeframes = fixture_payload.get("timeframes") or {}
    expected = [tf.id for tf in _enabled_timeframes()]
    if sorted(timeframes) != sorted(expected):
        raise SystemExit(
            f"expected timeframes {expected} in {fixtures_path}, got {sorted(timeframes)}"
        )

    print(
        f"re-timing existing fixtures: {fixture_payload.get('symbol')} "
        f"tfs={expected} warmups={warmups} runs={runs}"
    )
    manifest_rows: dict[str, dict] = {}
    for tf_id in expected:
        fixture = timeframes[tf_id]
        candles = fixture["candles"]
        _, timings = _measure_extras(candles, tf_id, runs, warmups)
        extras = {
            "indicators": fixture.get("indicators"),
            "sr_zones": fixture.get("sr_zones", []),
        }
        manifest_rows[tf_id] = {
            "bars": len(candles),
            "first_bar": candles[0]["t"],
            "last_bar": candles[-1]["t"],
            "indicator_ms": timings,
            "payload": _payload_sizes(candles, extras, fixture_payload.get("symbol", "")),
        }
        print(
            f"  {tf_id:<3} {len(candles):>4} bars  "
            f"indicator p95 {timings['p95_ms']:.1f} ms  "
            f"median {timings['median_ms']:.1f} ms"
        )

    manifest = {
        "schema_version": 1,
        "symbol": fixture_payload.get("symbol"),
        "as_of": fixture_payload.get("as_of"),
        "generated_at": datetime.now(IST).isoformat(timespec="seconds"),
        "bars_requested": fixture_payload.get("bars_requested"),
        "runs": runs,
        "warmup_runs": warmups,
        "timeframe_ids": expected,
        "hardware": _hardware(),
        "source": "existing fixtures.json candles + real compute_indicators/compute_sr_zones (no yfinance download)",
        "timeframes": manifest_rows,
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {manifest_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=None, help="output directory (fixtures.json + manifest.json)")
    parser.add_argument("--from-fixtures", action="store_true",
                        help="reuse fixtures.json candles and rewrite only manifest.json (no network)")
    parser.add_argument("--symbol", default=DEFAULT_SYMBOL, help="yfinance symbol")
    parser.add_argument("--bars", type=int, default=DEFAULT_BARS, help="max bars per timeframe")
    parser.add_argument("--as-of", type=_parse_date, default=None, help="last session (YYYY-MM-DD)")
    parser.add_argument("--runs", type=int, default=None,
                        help="measured backend runs (default 3 fresh / 30 --from-fixtures)")
    parser.add_argument("--warmups", type=int, default=5,
                        help="warm-up runs for --from-fixtures (default 5)")
    args = parser.parse_args(argv)

    if args.bars <= 0:
        parser.error("--bars must be > 0")
    runs = args.runs if args.runs is not None else (30 if args.from_fixtures else DEFAULT_RUNS)
    if runs <= 0:
        parser.error("--runs must be > 0")
    if args.warmups < 0:
        parser.error("--warmups must be >= 0")

    out_dir = Path(args.out).expanduser() if args.out else _artifact_root() / "fixtures"
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.from_fixtures:
        return measure_existing_fixtures(out_dir, runs, args.warmups)

    as_of = args.as_of or _default_as_of()
    end_ts = pd.Timestamp(as_of, tz=IST) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)

    timeframes = _enabled_timeframes()
    unexpected = [tf.id for tf in timeframes if tf.id not in SOURCE_PLAN]
    if unexpected:
        raise SystemExit(
            f"timeframes without a yfinance source plan: {unexpected}. "
            "Update SOURCE_PLAN in scripts/perf/gen_chart_fixtures.py."
        )

    sources: dict[str, pd.DataFrame] = {}
    fixtures: dict[str, dict] = {}
    manifest_rows: dict[str, dict] = {}
    failures: list[str] = []

    print(
        f"fixtures: {args.symbol} as-of {as_of} bars<={args.bars} "
        f"tfs={[tf.id for tf in timeframes]} runs={runs}"
    )
    for tf in timeframes:
        interval, days = SOURCE_PLAN[tf.id]
        source_key = f"{interval}:{days}"
        try:
            if source_key not in sources:
                sources[source_key] = _fetch_frame(args.symbol, interval, days, end_ts)
            source_frame = sources[source_key]
            frame = _resample_to(source_frame, tf.id)
            if frame.empty:
                raise RuntimeError("resample produced no bars")
            candles = _candles_json(frame, args.bars)
            if not candles:
                raise RuntimeError("candle serialization produced no bars")
            extras, timings = _measure_extras(candles, tf.id, runs)
            sizes = _payload_sizes(candles, extras, args.symbol)
            fixtures[tf.id] = {
                "bars": len(candles),
                "candles": candles,
                "indicators": extras["indicators"],
                "sr_zones": extras["sr_zones"],
            }
            manifest_rows[tf.id] = {
                "source_interval": interval,
                "source_days": days,
                "source_bars": int(len(source_frame)),
                "bars": len(candles),
                "first_bar": candles[0]["t"],
                "last_bar": candles[-1]["t"],
                "indicator_ms": timings,
                "payload": sizes,
            }
            print(
                f"  {tf.id:<3} {len(candles):>4} bars  "
                f"indicator p95 {timings['p95_ms']:.1f} ms  "
                f"payload {sizes['indicator_raw_bytes']} B raw / "
                f"{sizes['indicator_gzip_bytes']} B gzip"
            )
        except Exception as exc:  # noqa: BLE001 - report every TF, then fail
            failures.append(f"{tf.id}: {exc}")
            print(f"  {tf.id:<3} FAILED: {exc}", file=sys.stderr)

    if failures:
        print(
            "fixtures NOT written: fix the failed timeframes above "
            "(yfinance window/network) and rerun.",
            file=sys.stderr,
        )
        return 1

    generated_at = datetime.now(IST).isoformat(timespec="seconds")
    fixture_payload = {
        "schema_version": 1,
        "symbol": args.symbol,
        "as_of": as_of.isoformat(),
        "generated_at": generated_at,
        "bars_requested": args.bars,
        "timeframes": fixtures,
    }
    manifest = {
        "schema_version": 1,
        "symbol": args.symbol,
        "as_of": as_of.isoformat(),
        "generated_at": generated_at,
        "bars_requested": args.bars,
        "runs": runs,
        "warmup_runs": 1,
        "timeframe_ids": [tf.id for tf in timeframes],
        "hardware": _hardware(),
        "source": "yfinance OHLCV + chart_patterns resampler + real compute_indicators/compute_sr_zones",
        "timeframes": manifest_rows,
    }

    (out_dir / "fixtures.json").write_text(
        json.dumps(fixture_payload, separators=(",", ":")), encoding="utf-8"
    )
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {out_dir/'fixtures.json'} and {out_dir/'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
