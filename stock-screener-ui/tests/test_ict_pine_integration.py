"""End-to-end assembly tests for the Pine -> Python ``ict.pine`` port."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from scripts.research.ict_pine import RESULT_KEYS, compute_ict

pytestmark = pytest.mark.unit

_REAL_DATA = (
    Path(__file__).resolve().parents[1]
    / "experiments"
    / "data"
    / "duka_cache"
    / "usatechidxusd_1m.parquet"
)

_BAR_KEYS = (
    "idx",
    "confirmed_idx",
    "break_idx",
    "fvg_idx",
    "start_idx",
    "swing_idx",
    "swing_low_idx",
    "swing_high_idx",
    "bull_idx",
    "bear_idx",
)


def _synthetic_frame(rows: int = 120) -> pd.DataFrame:
    """Oscillating prices, one expansion gap, then a quiet tail.

    The gap at bars 59-61 creates a strict FVG and a displacement candle; the
    later close above an earlier swing produces an MSS and crosses confirmed
    swings for order blocks. The last 30 bars are deliberately event-free so
    truncation checks compare the same population of events.
    """
    rng = np.random.default_rng(7)
    closes: list[float] = []
    price = 100.0
    for bar in range(rows):
        drift = 0.3 * np.sin(bar / 7.0) if bar < 60 else 0.0
        price += drift + rng.normal(0, 0.4)
        closes.append(price)

    data: list[dict[str, float]] = []
    for bar, close in enumerate(closes):
        open_ = closes[bar - 1] if bar else close - 0.5
        if bar == 59:
            open_, close, high, low = 121.0, 131.0, 131.2, 120.8
        elif bar == 60:
            open_, close, high, low = 132.0, 135.0, 135.2, 131.6
        else:
            high = max(open_, close) + 0.2 + abs(rng.normal(0, 0.05))
            low = min(open_, close) - 0.2 - abs(rng.normal(0, 0.05))
        data.append(
            {"Open": open_, "High": high, "Low": low, "Close": close}
        )

    frame = pd.DataFrame(
        data,
        index=pd.date_range("2026-01-05", periods=rows, freq="h", tz="UTC"),
    )
    for bar in range(rows - 30, rows):
        base = 140.0 + 0.05 * (bar - (rows - 30))
        frame.iloc[bar] = [base - 0.2, base + 0.3, base - 0.3, base + 0.2]
    return frame


def _event_lists(result: dict) -> dict[str, list[dict]]:
    """Flatten the nested result into its bar-indexed event streams."""
    streams = {
        "swings": result["swings"],
        "fvg": result["fvg"],
        "fvg_breaks": result["fvg_breaks"],
        "volume_imbalance": result["volume_imbalance"],
        "opening_gaps": result["opening_gaps"],
        "bpr": result["bpr"],
        "fibonacci": result["fibonacci"],
    }
    for key, events in result["structure"].items():
        streams[f"structure.{key}"] = events
    for key, events in result["order_blocks"].items():
        streams[f"order_blocks.{key}"] = events
    for key, events in result["liquidity"].items():
        streams[f"liquidity.{key}"] = events
    return streams


def _settled(event: dict, cut: int) -> bool:
    """True only when every bar stamp of an event precedes ``cut``."""
    return all(event[key] < cut for key in _BAR_KEYS if key in event)


def test_synthetic_frame_has_all_event_families() -> None:
    frame = _synthetic_frame()
    result = compute_ict(frame)

    assert tuple(result) == RESULT_KEYS
    assert set(result) == set(RESULT_KEYS)
    assert result["meta"]["rows"] == len(frame)
    assert result["meta"]["params"] == {
        "swing_length": 5,
        "ob_length": 10,
        "strict_fvg": True,
    }

    assert result["swings"]
    assert result["structure"]["mss"]
    assert result["order_blocks"]["bullish"] or result["order_blocks"]["bearish"]
    assert result["displacement"]["counts"]["disp_up"] > 0
    assert result["fvg"]
    assert result["fvg_breaks"]
    assert result["fibonacci"]
    assert all(zone["top"] > zone["bottom"] for zone in result["fvg"])

    for name, events in _event_lists(result).items():
        bars = [event.get("idx", event.get("break_idx")) for event in events]
        assert bars == sorted(bars), f"{name} is not ordered by bar index"


def test_compute_ict_is_deterministic() -> None:
    frame = _synthetic_frame()
    assert compute_ict(frame) == compute_ict(frame)


def test_compute_ict_does_not_mutate_input() -> None:
    frame = _synthetic_frame()
    before = frame.copy(deep=True)
    compute_ict(frame)

    assert frame.equals(before)
    pd.testing.assert_frame_equal(frame, before)


def test_truncation_keeps_earlier_events_identical() -> None:
    frame = _synthetic_frame()
    cut = len(frame) - 30
    full = compute_ict(frame)
    short = compute_ict(frame.iloc[:cut])

    assert short["meta"]["rows"] == cut
    for name, events in _event_lists(full).items():
        earlier = [event for event in events if _settled(event, cut)]
        truncated = [
            event for event in _event_lists(short)[name] if _settled(event, cut)
        ]
        assert earlier == truncated, f"{name} changed when future bars were removed"
        assert all(
            event.get("idx", event.get("break_idx", 0)) < cut
            for event in _event_lists(short)[name]
        ), f"{name} leaked a bar at or after the truncation point"

    for name in full["displacement"]["per_bar"]:
        assert (
            full["displacement"]["per_bar"][name][:cut]
            == short["displacement"]["per_bar"][name]
        ), f"displacement.{name} changed before the truncation point"


def test_real_data_smoke_is_deterministic() -> None:
    if not _REAL_DATA.exists():
        pytest.skip(f"real-data fixture absent: {_REAL_DATA}")

    raw = pd.read_parquet(_REAL_DATA)
    frame = (
        raw.tail(20_000)
        .rename(columns={"o": "Open", "h": "High", "l": "Low", "c": "Close"})
        .copy()
    )
    result = compute_ict(frame)

    assert result["meta"]["rows"] == len(frame)
    assert len(result["swings"]) > 0
    assert len(result["fvg"]) > 0
    assert len(result["order_blocks"]["bullish"]) + len(
        result["order_blocks"]["bearish"]
    ) > 0
    assert result == compute_ict(frame)
