"""Hand-computed geometry checks for the ICT Concepts imbalance port."""

from __future__ import annotations

import pandas as pd
import pytest

from scripts.research.ict_pine.imbalance import (
    bpr,
    fvg,
    fvg_breaks,
    opening_gaps,
    volume_imbalance,
)


def frame(rows: list[tuple[float, float, float, float]], index=None) -> pd.DataFrame:
    return pd.DataFrame(
        rows,
        columns=("open", "high", "low", "close"),
        index=index,
    )


BULL = [
    (100.0, 101.0, 99.0, 100.0),
    (101.0, 102.0, 100.5, 102.0),
    (103.0, 106.0, 102.0, 105.0),
]

BEAR = [
    (100.0, 101.0, 99.0, 100.0),
    (98.0, 99.0, 97.0, 97.5),
    (96.0, 98.5, 96.5, 97.0),
]

QUIET = [(100.0, 100.5, 99.5, 100.0)] * 4

# Bar 4 is a 1.8-point body against a 0.76 five-bar mean with 0.1/0.3 wicks.
STRICT_BULL = QUIET + [
    (100.2, 102.1, 99.9, 102.0),
    (102.2, 105.0, 101.0, 104.0),
]
STRICT_BEAR = QUIET + [
    (99.8, 99.9, 97.7, 98.0),
    (97.8, 99.0, 96.0, 96.5),
]


def test_strict_bull_fvg_requires_expansion_body_on_middle_bar() -> None:
    assert fvg(frame(STRICT_BULL)) == [
        {
            "idx": 5,
            "dir": "bull",
            "top": 101.0,
            "bottom": 100.5,
            "start_idx": 3,
            "active": True,
        }
    ]


def test_strict_bear_fvg_keeps_pine_top_and_bottom() -> None:
    assert fvg(frame(STRICT_BEAR)) == [
        {
            "idx": 5,
            "dir": "bear",
            "top": 99.5,
            "bottom": 99.0,
            "start_idx": 3,
            "active": True,
        }
    ]


def test_gap_with_wide_wick_middle_bar_is_rejected_only_when_strict() -> None:
    df = frame(
        QUIET
        + [
            (100.0, 105.0, 99.5, 102.0),  # body 2 > mean 0.8, but 3-point upper wick
            (102.5, 105.0, 101.0, 104.0),
        ]
    )

    assert fvg(df) == []
    assert fvg(df, strict=False) == [
        {
            "idx": 5,
            "dir": "bull",
            "top": 101.0,
            "bottom": 100.5,
            "start_idx": 3,
            "active": True,
        }
    ]


def test_gap_with_body_not_above_five_bar_mean_is_rejected_only_when_strict() -> None:
    df = frame(
        [(100.0, 101.2, 100.8, 101.0)] * 5  # body 1 == mean body 1
        + [(103.0, 105.0, 102.0, 104.0)]
    )

    assert fvg(df) == []
    assert fvg(df, strict=False) == [
        {
            "idx": 5,
            "dir": "bull",
            "top": 102.0,
            "bottom": 101.2,
            "start_idx": 3,
            "active": True,
        }
    ]


def test_bull_fvg_uses_third_bar_low_and_two_bar_old_high() -> None:
    zones = fvg(frame(BULL), strict=False)

    assert zones == [
        {
            "idx": 2,
            "dir": "bull",
            "top": 102.0,
            "bottom": 101.0,
            "start_idx": 0,
            "active": True,
        }
    ]


def test_bear_fvg_uses_two_bar_old_low_and_third_bar_high() -> None:
    zones = fvg(frame(BEAR), strict=False)

    assert zones == [
        {
            "idx": 2,
            "dir": "bear",
            "top": 99.0,
            "bottom": 98.5,
            "start_idx": 0,
            "active": True,
        }
    ]


def test_overlapping_bars_produce_no_fvg() -> None:
    overlapping = [
        (100.0, 101.0, 99.0, 100.0),
        (100.0, 100.5, 99.5, 100.2),
        (100.0, 100.8, 99.8, 100.5),
    ]

    assert fvg(frame(overlapping), strict=False) == []


def test_bullish_volume_imbalance_returns_prior_body_top_to_current_body_bottom() -> None:
    gap_up = [
        (100.0, 101.5, 99.5, 101.0),
        (101.0, 102.5, 100.5, 102.0),
        (103.0, 105.0, 102.4, 104.0),
    ]

    assert volume_imbalance(frame(gap_up)) == [
        {"idx": 2, "dir": "bull", "top": 103.0, "bottom": 102.0, "start_idx": 1}
    ]


def test_bearish_volume_imbalance_returns_current_body_top_to_prior_body_bottom() -> None:
    gap_down = [
        (100.0, 100.5, 98.5, 99.0),
        (98.0, 98.5, 96.5, 97.0),
        (96.0, 97.0, 94.4, 95.0),
    ]

    assert volume_imbalance(frame(gap_down)) == [
        {"idx": 2, "dir": "bear", "top": 97.0, "bottom": 96.0, "start_idx": 1}
    ]


def test_bpr_is_bear_top_down_to_bull_bottom_when_zones_overlap() -> None:
    overlap = [
        (100.0, 101.0, 99.0, 100.5),
        (101.0, 102.0, 101.5, 101.8),
        (103.0, 105.0, 102.0, 104.0),
        (101.0, 100.8, 100.0, 100.2),
    ]

    assert bpr(fvg(frame(overlap), strict=False)) == [
        {
            "idx": 3,
            "dir": "bull",
            "top": 101.5,
            "bottom": 101.0,
            "bull_idx": 2,
            "bear_idx": 3,
        }
    ]


def test_bpr_without_opposite_zones_is_empty() -> None:
    assert bpr(fvg(frame(BULL), strict=False)) == []


def test_bull_fvg_break_and_active_flag() -> None:
    df = frame(BULL + [(101.0, 102.0, 100.5, 101.5)])
    zones = fvg(df, strict=False)

    assert zones[0]["active"] is False
    assert fvg_breaks(df, zones) == [{"fvg_idx": 2, "break_idx": 3, "dir": "bull"}]


def test_bear_fvg_break_on_high_through_zone_top() -> None:
    df = frame(BEAR + [(99.0, 99.2, 98.7, 99.0)])
    zones = fvg(df, strict=False)

    assert zones[0]["active"] is False
    assert fvg_breaks(df, zones) == [{"fvg_idx": 2, "break_idx": 3, "dir": "bear"}]


def test_strict_fvg_break_uses_the_wick_not_the_close() -> None:
    df = frame(STRICT_BULL + [(100.0, 101.0, 100.0, 100.9)])
    zones = fvg(df)

    assert zones[0]["active"] is False
    assert fvg_breaks(df, zones) == [{"fvg_idx": 5, "break_idx": 6, "dir": "bull"}]


def test_earlier_zones_do_not_change_when_later_bars_arrive() -> None:
    prefix = fvg(frame(BULL), strict=False)[0]

    assert fvg(frame(BULL + [(101.0, 102.0, 100.5, 101.5)]), strict=False)[0] == {
        **prefix,
        "active": False,
    }


def test_weekend_gap_uses_friday_close_and_monday_open() -> None:
    stamps = pd.to_datetime(
        ["2024-01-05 15:30", "2024-01-08 09:15", "2024-01-09 09:15"]
    ).tz_localize("Asia/Kolkata")
    df = frame(
        [
            (100.0, 101.0, 99.5, 100.0),
            (103.0, 104.0, 102.5, 103.5),
            (104.2, 105.0, 104.0, 104.5),
        ],
        index=stamps,
    )

    assert opening_gaps(df) == [
        {
            "kind": "NWOG",
            "idx": 1,
            "start_idx": 0,
            "top": 103.0,
            "bottom": 100.0,
            "mid": 101.5,
        }
    ]
    assert opening_gaps(df, include_ndog=True) == [
        {
            "kind": "NWOG",
            "idx": 1,
            "start_idx": 0,
            "top": 103.0,
            "bottom": 100.0,
            "mid": 101.5,
        },
        {
            "kind": "NDOG",
            "idx": 1,
            "start_idx": 0,
            "top": 103.0,
            "bottom": 100.0,
            "mid": 101.5,
        },
        {
            "kind": "NDOG",
            "idx": 2,
            "start_idx": 1,
            "top": 104.2,
            "bottom": 103.5,
            "mid": 103.85,
        },
    ]


def test_opening_gaps_ignores_same_weekday_sessions() -> None:
    stamps = pd.to_datetime(["2024-01-08 09:15", "2024-01-15 09:15"])
    df = frame(
        [(100.0, 101.0, 99.5, 100.0), (110.0, 111.0, 109.5, 110.0)], index=stamps
    )

    assert opening_gaps(df, include_ndog=True) == []


def test_opening_gaps_requires_datetime_index() -> None:
    with pytest.raises(ValueError, match="DatetimeIndex"):
        opening_gaps(frame(BULL))


def test_missing_ohlc_column_is_reported() -> None:
    with pytest.raises(ValueError, match="missing columns: close"):
        fvg(pd.DataFrame({"open": [1.0], "high": [2.0], "low": [0.5]}))
