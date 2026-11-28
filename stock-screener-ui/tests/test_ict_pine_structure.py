"""Tests for the ict.pine displacement / zigzag / MSS-BOS port.

The synthetic frame below is built so ``core.pivots`` produces an exact, known
zigzag: a high at 3, low at 6, higher highs at 9 and 12 (the second must update
node 0), then a low at 18 and a high at 21.
"""

from __future__ import annotations

import pandas as pd
import pytest

from scripts.research.ict_pine.structure import (
    displacement,
    market_structure,
    zigzag,
)

HIGHS = [10, 11, 12, 15, 13, 12, 11, 12, 14, 18, 16, 17, 20, 18,
         19, 21, 19, 18, 17, 16, 19, 24, 22, 25]
LOWS = [9, 9.5, 10, 11, 10.5, 9, 7, 8, 9, 11, 12, 13, 14, 15,
        16, 17, 18, 15, 13, 14, 15, 17, 19, 20]
CLOSES = [9.5, 10, 11, 14, 12, 10, 8, 9, 10, 15, 13, 14, 15, 16,
          17, 18, 17, 16, 14, 15, 17, 20, 19, 23]


def _frame(highs, lows, closes):
    opens = [closes[0], *closes[:-1]]
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes}
    )


def _mirror(frame):
    """Flip price around 1000 so highs become lows and vice versa."""
    return pd.DataFrame(
        {
            "open": 1000 - frame["open"],
            "high": 1000 - frame["low"],
            "low": 1000 - frame["high"],
            "close": 1000 - frame["close"],
        }
    )


BULL = _frame(HIGHS, LOWS, CLOSES)
BEAR = _mirror(BULL)


def test_zigzag_updates_on_consecutive_higher_highs():
    nodes = zigzag(BULL.iloc[:14], left=3)

    assert [(p.d, p.x, p.y) for p in nodes] == [
        (1, 12, 20.0),  # updated from the 18.0 pivot at bar 9
        (-1, 6, 7.0),
        (1, 3, 15.0),
    ]


def test_mss_breaks_previous_high_not_just_formed_pivot():
    result = market_structure(BULL, swing_length=3)

    # Bar 13 closes at 16: above the aZZ index-2 high (15, bar 3) but below
    # the just-formed index-0 high (20, bar 12). iH must select index 2.
    assert result["mss"] == [
        {"idx": 13, "dir": 1, "level": 15.0, "swing_idx": 3}
    ]


def test_bos_follows_on_a_new_same_direction_level():
    result = market_structure(BULL, swing_length=3)

    assert result["bos"] == [
        {"idx": 23, "dir": 1, "level": 21.0, "swing_idx": 15}
    ]


def test_bearish_mirror_mss_and_bos():
    nodes = zigzag(BEAR.iloc[:14], left=3)
    assert [(p.d, p.x, p.y) for p in nodes[:2]] == [
        (-1, 12, 980.0),
        (1, 6, 993.0),
    ]

    result = market_structure(BEAR, swing_length=3)

    assert result["mss"] == [
        {"idx": 13, "dir": -1, "level": 985.0, "swing_idx": 3}
    ]
    assert result["bos"] == [
        {"idx": 23, "dir": -1, "level": 979.0, "swing_idx": 15}
    ]


def test_same_bar_high_and_low_are_applied_in_pine_order():
    # Bar 3 is simultaneously a pivot high (20) and a pivot low (10); both
    # confirm on bar 4. Pine's `if ph` precedes `if pl`, so the low ends up at
    # node 0 and the high at node 1. Processing lows first instead would swap
    # those nodes and make the later MSS read the bar-3 level 10.0 instead of
    # the bar-7 level 8.0.
    frame = pd.DataFrame(
        {
            "open": [12, 11.5, 11, 15, 13, 12, 13, 12, 9.5, 8.5,
                     10, 15, 13, 14, 13, 10, 7],
            "high": [12, 13, 14, 20, 13, 14, 15, 14, 13, 10,
                     13, 22, 18, 17, 16, 15, 13],
            "low": [11, 10.5, 10.2, 10, 12, 11, 10.5, 8, 9, 8.5,
                    8, 9, 10, 11, 12, 6, 7],
            "close": [12, 11.5, 11, 15, 13, 12, 13, 12, 9.5, 8.5,
                      10, 15, 13, 14, 13, 10, 7],
        }
    )

    assert [(p.d, p.x, p.y) for p in zigzag(frame.iloc[:5], left=3)] == [
        (-1, 3, 10.0),
        (1, 3, 20.0),
    ]

    result = market_structure(frame, swing_length=3)

    assert result["mss"] == [
        {"idx": 16, "dir": -1, "level": 8.0, "swing_idx": 7}
    ]
    assert result["bos"] == []


def test_truncating_tail_does_not_change_earlier_events():
    full = market_structure(BULL, swing_length=3)
    shortened = market_structure(BULL.iloc[:18], swing_length=3)
    before = lambda events: [e for e in events if e["idx"] < 18]

    assert before(full["mss"]) == shortened["mss"]
    assert before(full["bos"]) == shortened["bos"]


def test_mutating_future_bars_does_not_change_earlier_events():
    clean = market_structure(BULL, swing_length=3)
    noisy = BULL.copy()
    noisy.iloc[19:, noisy.columns.get_loc("close")] = [900, 1, 777, 0, 500]
    before = lambda events: [e for e in events if e["idx"] < 19]

    assert before(market_structure(noisy, swing_length=3)["mss"]) == before(
        clean["mss"]
    )
    assert before(market_structure(noisy, swing_length=3)["bos"]) == before(
        clean["bos"]
    )


def test_displacement_exposes_pine_inputs_and_direction_split():
    rows = [
        (100, 100.1, 100.2, 99.95),
        (100, 100.1, 100.2, 99.95),
        (100, 100.1, 100.2, 99.95),
        (100, 100.1, 100.2, 99.95),
        (100, 100.3, 100.35, 100.0),   # strong bullish body, tiny wicks
        (100, 99.7, 100.0, 99.65),     # strong bearish body, tiny wicks
        (100, 110.0, 118.0, 99.0),     # big body but a long upper wick
    ]
    frame = pd.DataFrame(rows, columns=["open", "close", "high", "low"])

    out = displacement(frame)

    assert list(out.columns) == [
        "body", "mean_body", "l_body", "disp_up", "disp_dn"
    ]
    assert out["body"].iloc[4] == pytest.approx(0.3)
    assert out["mean_body"].iloc[4] == pytest.approx(0.14)
    assert out["l_body"].tolist() == [False, False, False, False, True, True, False]
    assert out["disp_up"].tolist() == [False, False, False, False, True, False, False]
    assert out["disp_dn"].tolist() == [False, False, False, False, False, True, False]


def test_displacement_small_body_above_mean_counts_big_body_with_wicks_does_not():
    frame = pd.DataFrame(
        [
            (100, 100.1, 100.2, 99.95),
            (100, 100.1, 100.2, 99.95),
            (100, 100.1, 100.2, 99.95),
            (100, 100.1, 100.2, 99.95),
            (100, 100.3, 100.35, 100.0),
            (100, 110.0, 118.0, 99.0),
        ],
        columns=["open", "close", "high", "low"],
    )

    out = displacement(frame)

    assert bool(out["disp_up"].iloc[4]) is True
    assert bool(out["l_body"].iloc[5]) is False
    assert bool(out["disp_up"].iloc[5]) is False
    assert bool(out["disp_dn"].iloc[5]) is False


def test_displacement_strict_opt_out_is_inclusive():
    frame = pd.DataFrame(
        [
            (100, 101.0, 101.0, 100.0),
            (100, 101.0, 101.0, 100.0),
            (100, 101.0, 101.5, 100.0),  # body == mean, wick == body * 0.5
        ],
        columns=["open", "close", "high", "low"],
    )

    strict = displacement(frame, body_pct=0.5, mean_length=3)
    relaxed = displacement(frame, body_pct=0.5, mean_length=3, strict=False)

    assert bool(strict["l_body"].iloc[2]) is False
    assert bool(strict["disp_up"].iloc[2]) is False
    assert bool(relaxed["l_body"].iloc[2]) is True
    assert bool(relaxed["disp_up"].iloc[2]) is True


def test_displacement_rejects_invalid_mean_length():
    with pytest.raises(ValueError):
        displacement(BULL, mean_length=0)
