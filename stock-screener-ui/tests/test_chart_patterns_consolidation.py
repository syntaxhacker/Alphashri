"""Consolidation detector + store/API filter tests.

Synthetic OHLCV only (no mocks/network). Covers:

* a tight long base is detected as ``consolidation`` with ``base_days >= 90``,
  a small ``range_pct`` and flat box lines that bound every candle;
* strong / moderate monotonic trends are rejected;
* long geometry (neutral): target above, stop below ``breakout_level``;
* the 3 new fields round-trip through the store and ``min_base_days`` /
  ``max_range_pct`` filters narrow results.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from sqlalchemy.orm import sessionmaker

from chart_patterns import features as F
from chart_patterns import store
from chart_patterns.detectors.consolidation import detect_consolidation

_INDEX = pd.date_range("2024-01-01", periods=400, freq="D", tz="UTC")


def frame(closes, spread: float = 0.5) -> pd.DataFrame:
    close = np.asarray(closes, dtype=float)
    n = len(close)
    return pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": close + spread,
            "low": close - spread,
            "close": close,
            "volume": np.full(n, 1000.0),
        },
        index=_INDEX[:n],
    )


def base_frame(n: int = 140, level: float = 100.0, half: float = 2.0) -> pd.DataFrame:
    """A long tight base: ``n`` bars oscillating in a ``2*half`` box at ``level``."""
    i = np.arange(n)
    close = level + half * np.sin(i * 2.0 * np.pi / 20.0)
    return frame(close)


def _detect(df):
    return detect_consolidation(F.normalize_ohlcv(df), {})


# ---------------------------------------------------------------------------
# Detection on a genuine base
# ---------------------------------------------------------------------------


def test_tight_long_base_is_detected():
    hits = _detect(base_frame())
    assert hits, "a tight 120+ bar base must be detected"
    hit = hits[0]
    assert hit.pattern_id == "consolidation"
    assert hit.family == "continuation"
    assert hit.direction == "neutral"
    assert hit.base_days >= 90, f"expected a long base, got {hit.base_days}"
    assert 0 < hit.range_pct <= 20.0
    assert 15.0 <= hit.range_pos <= 85.0
    assert hit.notes.startswith("consolidation ")


def test_box_lines_bound_price_and_match_levels():
    df = F.normalize_ohlcv(base_frame())
    hit = _detect(df)[0]
    upper, lower = hit.trendlines[0], hit.trendlines[1]
    hi = float(df["high"].max())
    lo = float(df["low"].min())
    assert upper[0]["price"] == pytest.approx(hi, abs=1e-3)
    assert upper[1]["price"] == pytest.approx(hi, abs=1e-3)
    assert lower[0]["price"] == pytest.approx(lo, abs=1e-3)
    assert hit.breakout_level == pytest.approx(hi, abs=1e-3)
    # box lines are flat and bound every candle over the base
    assert len(hit.trendlines) == 2
    for _, row in df.iterrows():
        assert row["high"] <= upper[0]["price"] + 1e-6
        assert row["low"] >= lower[0]["price"] - 1e-6


def test_neutral_long_geometry_sides():
    hit = _detect(base_frame())[0]
    assert hit.direction == "neutral"
    assert hit.target > hit.breakout_level, "measured-move target must be above the box"
    assert hit.stop < hit.breakout_level, "stop must sit below the breakout"
    assert (hit.breakout_level - hit.stop) > 0
    assert hit.rr > 0


def test_emits_at_most_one_hit_per_symbol():
    hits = _detect(base_frame())
    assert len(hits) == 1


# ---------------------------------------------------------------------------
# Trend rejection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "closes",
    [
        np.linspace(100, 220, 260),  # strong uptrend
        np.linspace(220, 100, 260),  # strong downtrend
        np.linspace(100, 118, 180),  # moderate uptrend (~16% drift)
        np.full(160, 100.0),         # dead-flat line (not a genuine base)
    ],
)
def test_trends_and_flat_lines_are_rejected(closes):
    assert _detect(frame(closes)) == []


# ---------------------------------------------------------------------------
# Store round-trip + filters
# ---------------------------------------------------------------------------


def _hit(symbol: str, base_days: int, range_pct: float, range_pos: float) -> dict:
    return {
        "symbol": symbol,
        "name": symbol,
        "timeframe": "1D",
        "pattern_id": "consolidation",
        "pattern_name": "Consolidation",
        "family": "continuation",
        "direction": "neutral",
        "status": "forming",
        "quality": "fair",
        "confidence": 60.0,
        "start_date": "2026-01-01",
        "end_date": "2026-06-01",
        "start_price": 100.0,
        "end_price": 102.0,
        "breakout_level": 105.0,
        "target": 110.0,
        "stop": 98.0,
        "rr": 2.0,
        "bars_ago": 0,
        "volume_confirmed": False,
        "base_days": base_days,
        "range_pct": range_pct,
        "range_pos": range_pos,
        "trendlines": [[{"t": "2026-01-01", "price": 105.0}, {"t": "2026-06-01", "price": 105.0}]],
        "notes": "synthetic",
    }


@pytest.fixture
def cp_store(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    try:
        yield factory
    finally:
        store.reset_session_factory()


def test_store_round_trips_consolidation_fields(cp_store):
    store.save_job({"job_id": "cpj_cons", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_cons", [_hit("LONG", 180, 12.5, 42.0)])

    items, total, _ = store.query_results({"job_id": "cpj_cons"})
    assert total == 1
    item = items[0]
    assert item["base_days"] == 180
    assert item["range_pct"] == pytest.approx(12.5)
    assert item["range_pos"] == pytest.approx(42.0)


def test_store_min_base_days_filter(cp_store):
    store.save_job({"job_id": "cpj_cons2", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits(
        "cpj_cons2",
        [_hit("SHORTY", 30, 5.0, 50.0), _hit("LONGY", 150, 5.0, 50.0)],
    )

    items, total, _ = store.query_results({"job_id": "cpj_cons2", "min_base_days": 90})
    assert total == 1
    assert items[0]["symbol"] == "LONGY"


def test_store_max_range_pct_filter(cp_store):
    store.save_job({"job_id": "cpj_cons3", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits(
        "cpj_cons3",
        [_hit("TIGHT", 120, 6.0, 50.0), _hit("WIDE", 120, 18.0, 50.0)],
    )

    items, total, summary = store.query_results({"job_id": "cpj_cons3", "max_range_pct": 10.0})
    assert total == 1
    assert items[0]["symbol"] == "TIGHT"
    assert summary["patterns"] == 1


def test_missing_consolidation_metrics_persist_as_null(cp_store):
    store.save_job({"job_id": "cpj_cons4", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    bare = _hit("PLAIN", 0, 0.0, 0.0)
    bare["base_days"] = None
    bare["range_pct"] = None
    bare["range_pos"] = None
    store.save_hits("cpj_cons4", [bare])

    items, _total, _ = store.query_results({"job_id": "cpj_cons4"})
    assert items[0]["base_days"] is None


def test_api_build_filters_includes_consolidation_params():
    from api.chart_patterns import _build_filters

    filters = _build_filters(
        symbol="JSWSTEEL",
        pattern_id="consolidation",
        min_base_days=90,
        max_range_pct=10.0,
    )
    assert filters["symbol"] == "JSWSTEEL"
    assert filters["pattern_id"] == "consolidation"
    assert filters["min_base_days"] == 90
    assert filters["max_range_pct"] == 10.0
