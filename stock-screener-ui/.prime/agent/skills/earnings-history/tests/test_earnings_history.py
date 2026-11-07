"""Unit tests for the earnings-history skill's pure helpers.

No network access: every frame is synthetic. Run with:

    cd stock-screener-ui
    .venv/bin/python -m pytest .prime/agent/skills/earnings-history/tests -q
"""

import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
spec = importlib.util.spec_from_file_location(
    "earnings_history",
    ROOT / ".prime/agent/skills/earnings-history/scripts/earnings_history.py",
)
eh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eh)


def _frame(closes, start="2026-01-01"):
    idx = pd.bdate_range(start, periods=len(closes))
    c = pd.Series(closes, index=idx, dtype=float)
    return pd.DataFrame(
        {
            "open": c,
            "high": c + 1,
            "low": c - 1,
            "close": c,
            "volume": 1000.0,
        },
        index=idx,
    )


def test_fiscal_quarter_mapping():
    assert eh.fiscal_quarter("2024-01-31") == "Q3 FY2024"
    assert eh.fiscal_quarter("2024-05-15") == "Q4 FY2024"
    assert eh.fiscal_quarter("2024-07-31") == "Q1 FY2025"
    assert eh.fiscal_quarter("2026-10-19") == "Q2 FY2027"


def test_event_reactions_maps_to_next_session():
    # 2026-01-07 is a Wednesday; reaction must be Thursday 2026-01-08.
    df = _frame(range(100, 140))
    earnings = pd.DataFrame(
        {"date": [pd.Timestamp("2026-01-07").date()], "surprise_pct": [5.0]}
    )
    ev = eh.event_reactions(df, earnings)
    assert len(ev) == 1
    row = ev.iloc[0]
    assert row["reaction_date"] == "2026-01-08"
    # prev close 104 -> event close 105 = +0.9615%; open == close in this frame,
    # so the whole move is the gap and the intraday leg is flat.
    assert abs(row["move_pct"] - 0.9615) < 1e-3
    assert abs(row["gap_pct"] - row["move_pct"]) < 1e-9
    assert abs(row["intraday_pct"]) < 1e-9
    assert abs(row["close_loc"] - 0.5) < 1e-9
    assert abs(row["vol_x"] - 1.0) < 1e-9


def test_event_reactions_rolls_weekend_to_monday():
    df = _frame(range(100, 140))
    earnings = pd.DataFrame(
        {"date": [pd.Timestamp("2026-01-10").date()], "surprise_pct": [1.0]}  # Saturday
    )
    ev = eh.event_reactions(df, earnings)
    assert ev.iloc[0]["reaction_date"] == "2026-01-12"


def test_summarize_events_beat_and_fade():
    # Beat, but price falls on T+1 -> fade rate 100%.
    closes = [100, 101, 102, 103, 104, 103, 103, 103]
    df = _frame(closes)
    earnings = pd.DataFrame(
        {"date": [pd.Timestamp("2026-01-07").date()], "surprise_pct": [8.0]}
    )
    s = eh.summarize_events(eh.event_reactions(df, earnings))
    assert s["n"] == 1
    assert s["beat_n"] == 1
    assert s["beat_rate_pct"] == 100.0
    assert s["beat_fade_rate_pct"] == 100.0
    assert s["avg_move_pct"] < 0


def test_expected_move_stats():
    ev = pd.DataFrame({"move_pct": [2.0, -3.0, 4.0]})
    s = eh.expected_move_stats(ev, n=3)
    assert s["n"] == 3
    assert abs(s["mean_abs_pct"] - 3.0) < 1e-9
    assert abs(s["median_abs_pct"] - 3.0) < 1e-9
    assert abs(s["max_abs_pct"] - 4.0) < 1e-9


def test_scenario_levels_math():
    df = _frame(range(100, 160))
    s = eh.scenario_levels(100.0, 3.0, df)
    assert abs(s["up_1x"] - 103.0) < 1e-9
    assert abs(s["down_1x"] - 97.0) < 1e-9
    assert abs(s["up_2x"] - 106.0) < 1e-9
    assert abs(s["down_2x"] - 94.0) < 1e-9
    assert s["support_1"] == 139.0  # last 20 closes are 140..159 -> lowest low = 139
    assert s["resistance_1"] == 160.0


def test_compute_technicals_sane():
    rng = np.random.default_rng(7)
    prices = 100 * np.cumprod(1 + rng.normal(0.0005, 0.01, 320))
    df = _frame(prices)
    t = eh.compute_technicals(df)
    assert t["close"] == df["close"].iloc[-1]
    assert 0 <= t["rsi14"] <= 100
    assert t["atr14"] > 0
    assert t["atr_pct"] > 0
    assert t["sma200"] == df["close"].rolling(200).mean().iloc[-1]
    assert t["high_52w"] >= t["close"]
    assert t["low_52w"] <= t["close"]


def test_ist_date_index_strips_timezone():
    idx = pd.date_range("2026-01-01 00:00", periods=3, freq="D", tz="Asia/Kolkata")
    df = pd.DataFrame({"close": [1, 2, 3]}, index=idx)
    out = eh._ist_date_index(df)
    assert out.tz is None
    assert list(out) == [pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-02"), pd.Timestamp("2026-01-03")]
