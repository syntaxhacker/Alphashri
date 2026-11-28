"""Zone conversions for the LuxAlgo ICT Concepts Pine indicator.

Fixtures pin the exact bar that confirms a swing, an order block or a liquidity
band; a scan truncated before that bar must not see it. Order blocks use the
``swings(length)`` state machine with the 10-bar order-block lookback
(ict.pine:47,859); liquidity uses the 5-bar ``draw(len)`` pivots (ict.pine:25,527).
"""

from __future__ import annotations

import pytest

from scripts.research.ict_pine.fibonacci import fib_from_swings, fib_levels
from scripts.research.ict_pine.liquidity import liquidity_zones
from scripts.research.ict_pine.orderblocks import detect_swings, order_blocks


def _bars(rows: list[tuple[float, float, float, float]]) -> list[dict[str, float]]:
    return [{"open": o, "high": h, "low": low, "close": c} for o, h, low, c in rows]


OB_BARS = _bars([
    (60, 61, 50, 60),       # 0   low pivot, confirmed at bar 10
    (98, 99, 97, 98),       # 1
    (100, 110, 99, 105),    # 2   high pivot 110, confirmed at bar 12
    (105, 106, 103, 104),   # 3
    (104, 105, 102, 103),   # 4
    (103, 104, 101, 102),   # 5
    (102, 103, 100.5, 101), # 6   chosen OB candle (body 101..102)
    (101, 102, 101, 101.5), # 7
    (104, 105, 100, 104),   # 8
    (104, 105, 102, 103),   # 9
    (105, 106, 103, 104),   # 10
    (104, 105, 102, 103),   # 11
    (105, 106, 104, 105),   # 12
    (112, 121, 111, 120),   # 13  bullish displacement -> OB published
    (99, 100, 97, 98),      # 14  trades through the OB -> breaker
])

BEAR_OB_BARS = _bars([
    (100, 110, 109, 105),   # 0
    (105, 106, 104, 105),   # 1
    (60, 61, 50, 60),       # 2   low pivot, confirmed at bar 12
] + [
    (95 - i // 4, 96 - i // 4, 90 - i // 4, 94 - i // 4) for i in range(3, 13)
] + [
    (45, 46, 39, 40),       # 13  bearish displacement -> OB published
    (105, 106, 104, 106),   # 14  trades through the OB -> breaker
])
BEAR_OB_BARS[8] = {"open": 99, "high": 100, "low": 98, "close": 99}

FIVE_BAR_FLIP = _bars([
    (60, 61, 50, 60),       # 0   low pivot, confirmed at 5 (or 10)
    (98, 99, 97, 98),       # 1-4
    (98, 99, 97, 98),
    (98, 99, 97, 98),
    (98, 99, 97, 98),
    (104, 105, 103, 104),   # 5   local high, confirmed at 10 only with length=5
    (103, 104, 102, 103),   # 6
    (102, 103, 101, 102),   # 7
    (101, 102, 100, 101),   # 8
    (100, 101, 99, 100),    # 9
    (99, 100, 98, 99),      # 10
    (110, 115, 109, 114),   # 11  closes through the 5-bar flip
    (108, 109, 107, 108),   # 12
])

THREE_RISING_HIGHS = _bars([(60, 61, 59, 60) for _ in range(24)])
THREE_RISING_HIGHS[0] = {"open": 60, "high": 61, "low": 50, "close": 60}
for _idx, _high in ((4, 100), (8, 101), (12, 102)):
    THREE_RISING_HIGHS[_idx] = {
        "open": _high - 1, "high": _high, "low": _high - 2, "close": _high - 1,
    }
for _idx in (6, 10):
    THREE_RISING_HIGHS[_idx] = {
        "open": 95, "high": 96, "low": 90 + _idx // 2, "close": 95,
    }

ROLLING_HIGH_NO_FLIP = _bars([
    (60, 61, 50, 60),       # 0   low pivot -> os = 1
    (99, 100, 98, 99),      # 1   high pivot -> os = 0, one flip
    (98, 99, 97, 98),       # 2   rolling high, os stays 0
    (97, 98, 96, 97),       # 3   rolling high, os stays 0
] + [
    (96 - i // 2, 97 - i // 2, 95 - i // 2, 96 - i // 2) for i in range(4, 14)
] + [
    (110, 115, 109, 114),   # 14  displacement
])


def test_bullish_ob_uses_opposing_candle_and_records_breaker() -> None:
    result = order_blocks(OB_BARS, length=10)
    assert result["bullish"] == [{
        "idx": 6, "top": 102.0, "bottom": 101.0, "breaker": True, "break_idx": 14,
    }]


def test_order_block_is_not_published_before_confirmation() -> None:
    assert order_blocks(OB_BARS[:13], length=10)["bullish"] == []
    early = order_blocks(OB_BARS[:14], length=10)["bullish"]
    assert len(early) == 1
    assert early[0]["breaker"] is False
    assert early[0]["break_idx"] is None


def test_bearish_ob_mirrors_the_bullish_rule() -> None:
    result = order_blocks(BEAR_OB_BARS, length=10)
    assert result["bearish"] == [{
        "idx": 8, "top": 99.0, "bottom": 99.0, "breaker": True, "break_idx": 14,
    }]


def test_three_rising_highs_record_one_swing_high() -> None:
    highs = [p for p in detect_swings(THREE_RISING_HIGHS, length=10) if p["kind"] == "high"]
    assert highs == [{"idx": 12, "price": 102.0, "kind": "high"}]


def test_rolling_high_without_os_flip_creates_no_new_swing_or_block() -> None:
    highs = [p for p in detect_swings(ROLLING_HIGH_NO_FLIP, length=10) if p["kind"] == "high"]
    assert highs == [{"idx": 1, "price": 100.0, "kind": "high"}]
    assert len(order_blocks(ROLLING_HIGH_NO_FLIP, length=10)["bullish"]) == 1


def test_five_bar_flip_does_not_emit_an_order_block() -> None:
    assert detect_swings(FIVE_BAR_FLIP, length=5) == [
        {"idx": 0, "price": 50.0, "kind": "low"},
        {"idx": 5, "price": 105.0, "kind": "high"},
    ]
    assert order_blocks(FIVE_BAR_FLIP, length=5)["bullish"] == [{
        "idx": 10, "top": 99.0, "bottom": 99.0, "breaker": False, "break_idx": None,
    }]
    assert detect_swings(FIVE_BAR_FLIP, length=10) == [
        {"idx": 0, "price": 50.0, "kind": "low"},
    ]
    assert order_blocks(FIVE_BAR_FLIP, length=10)["bullish"] == []


def test_three_equal_highs_form_one_liquidity_band() -> None:
    pivots = [
        {"idx": 8, "price": 100.0, "direction": 1},
        {"idx": 9, "price": 90.0, "direction": -1},
        {"idx": 5, "price": 100.0, "direction": 1},
        {"idx": 6, "price": 90.0, "direction": -1},
        {"idx": 2, "price": 100.0, "direction": 1},
    ]
    result = liquidity_zones(OB_BARS, pivots, margin=4.0, atr=1.0)
    assert result["buyside"] == [{
        "start_idx": 2, "price": 100.0, "top": 100.4, "bottom": 99.6, "count": 3,
    }]
    assert result["sellside"] == []


def test_liquidity_bands_derive_from_confirmed_five_bar_zigzag() -> None:
    bars = []
    for i in range(24):
        if i in (5, 11, 17):
            bars.append({"open": 99, "high": 100 + 0.05 * (i // 6), "low": 98, "close": 99.5})
        elif i in (8, 14):
            bars.append({"open": 95, "high": 96, "low": 90 - i // 6, "close": 95.5})
        else:
            bars.append({"open": 95, "high": 96, "low": 94, "close": 95.5})
    result = liquidity_zones(bars, left=5, atr=1.0)
    assert result["buyside"] == [{
        "start_idx": 5, "price": 100.0, "top": 100.45, "bottom": 99.65, "count": 3,
    }]


def test_two_touches_do_not_form_a_liquidity_band() -> None:
    pivots = [
        {"idx": 5, "price": 100.0, "direction": 1},
        {"idx": 2, "price": 100.0, "direction": 1},
    ]
    assert liquidity_zones(OB_BARS, pivots, margin=4.0, atr=1.0) == {
        "buyside": [], "sellside": [],
    }


def test_liquidity_margin_sets_band_width_and_sellside_mirrors() -> None:
    pivots = [(8, 90.0, -1), (5, 90.0, -1), (2, 90.0, -1)]
    result = liquidity_zones(OB_BARS, pivots, margin=2.0, atr=1.0)
    assert result["sellside"] == [{
        "start_idx": 2, "price": 90.0, "top": 90.2, "bottom": 89.8, "count": 3,
    }]


def test_fibonacci_levels_match_pine_ratios() -> None:
    levels = fib_levels(100.0, 200.0)
    assert list(levels) == ["0", "0.236", "0.382", "0.5", "0.618", "0.786", "1"]
    assert list(levels.values()) == pytest.approx(
        [100.0, 123.6, 138.2, 150.0, 161.8, 178.6, 200.0]
    )


def test_fib_from_swings_pairs_low_to_high_regardless_of_input_order() -> None:
    pivots = [
        {"idx": 9, "price": 200.0, "direction": 1},
        {"idx": 2, "price": 100.0, "direction": -1},
    ]
    pairs = fib_from_swings(pivots)
    assert len(pairs) == 1
    assert pairs[0]["swing_low_idx"] == 2
    assert pairs[0]["swing_high_idx"] == 9
    assert pairs[0]["levels"]["0.618"] == pytest.approx(161.8)
