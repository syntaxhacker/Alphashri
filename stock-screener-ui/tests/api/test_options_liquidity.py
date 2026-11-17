"""Pure tests for :mod:`api.options_liquidity` — no network, DB or FastAPI.

Fixtures are hand-built so every number can be checked by eye. They pin the
contract that matters for the heatmap: spread percentages use the quote
midpoint, missing/zero/crossed quotes and missing OI stay ``None`` (never a
0-fill), corrupt values never leak a NaN, and partial chains render cleanly.
"""

import math

import pytest

from api.options_liquidity import ILLIQUID_SPREAD_PCT, liquidity_block

_BLOCK_KEYS = {
    "strikes", "ceSpreadPct", "peSpreadPct", "ceSpreadAbs", "peSpreadAbs",
    "ceVolOi", "peVolOi", "medianSpreadPct", "illiquidCount", "warnings",
}


def _md(bid=100.0, ask=101.0, volume=1000, oi=500, ltp=100.5, **overrides):
    """Market-data mapping. ``None`` values are omitted to model a missing key."""
    md = {}
    for key, value in (
        ("bid_price", bid), ("ask_price", ask), ("volume", volume),
        ("oi", oi), ("ltp", ltp),
    ):
        if value is not None:
            md[key] = value
    md.update(overrides)
    return md


def _leg(md=None, **kwargs):
    return {"market_data": md if md is not None else _md(**kwargs)}


def _row(strike, ce=None, pe=None):
    return {"strike": strike, "ce": ce, "pe": pe}


class TestBlockShape:
    def test_empty_chain_has_full_shape_and_null_summary(self):
        block = liquidity_block([])

        assert set(block) == _BLOCK_KEYS
        for key in ("strikes", "ceSpreadPct", "peSpreadPct", "ceSpreadAbs",
                    "peSpreadAbs", "ceVolOi", "peVolOi", "warnings"):
            assert block[key] == []
        assert block["medianSpreadPct"] is None
        assert block["illiquidCount"] == 0

    def test_none_and_junk_inputs_are_empty(self):
        for rows in (None, [], "junk"):
            assert liquidity_block(rows)["strikes"] == []


class TestNormalSpread:
    def test_spread_pct_and_abs_use_quote_midpoint(self):
        rows = [
            _row(100, ce=_leg(bid=100.0, ask=101.0, volume=1000, oi=500),
                      pe=_leg(bid=99.0, ask=99.5, volume=600, oi=400)),
        ]
        block = liquidity_block(rows)

        assert block["strikes"] == [100.0]
        assert block["ceSpreadAbs"][0] == pytest.approx(1.0)
        assert block["ceSpreadPct"][0] == pytest.approx(1.0 / 100.5 * 100.0)
        assert block["peSpreadAbs"][0] == pytest.approx(0.5)
        assert block["peSpreadPct"][0] == pytest.approx(0.5 / 99.25 * 100.0)
        assert block["warnings"] == []

    def test_median_is_across_both_sides_and_illiquid_counts_wide_legs(self):
        rows = [
            _row(100, ce=_leg(bid=100.0, ask=101.0), pe=_leg(bid=99.0, ask=99.5)),
            _row(110, ce=_leg(bid=200.0, ask=202.0), pe=_leg(bid=199.0, ask=201.0)),
        ]
        block = liquidity_block(rows)
        spreads = sorted(block["ceSpreadPct"] + block["peSpreadPct"])

        assert block["medianSpreadPct"] == pytest.approx(
            (spreads[1] + spreads[2]) / 2.0
        )
        # All four spreads are under 1% and both strikes have two live legs.
        assert block["illiquidCount"] == 0

    def test_wide_spread_is_illiquid(self):
        rows = [_row(100, ce=_leg(bid=100.0, ask=110.0, volume=10, oi=5))]
        block = liquidity_block(rows)

        assert block["ceSpreadPct"][0] > ILLIQUID_SPREAD_PCT
        # The wide CE leg plus the absent PE leg are both illiquid.
        assert block["illiquidCount"] == 2


class TestZeroBidAsk:
    def test_zero_or_missing_quotes_are_null_not_zero_filled(self):
        rows = [
            _row(100, ce=_leg(bid=0.0, ask=101.0, volume=10, oi=5),
                      pe=_leg(bid=99.0, ask=0.0, volume=10, oi=5)),
            _row(110, ce=_leg(bid=0.0, ask=0.0, volume=10, oi=5),
                      pe=_leg(bid=None, ask=100.0, volume=10, oi=5)),
        ]
        block = liquidity_block(rows)

        assert block["ceSpreadPct"] == [None, None]
        assert block["peSpreadPct"] == [None, None]
        assert block["ceSpreadAbs"] == [None, None]
        assert block["peSpreadAbs"] == [None, None]
        assert block["medianSpreadPct"] is None
        # Absent/zero quotes on dead strikes are not a data error.
        assert block["warnings"] == []
        assert block["illiquidCount"] == 4


class TestCrossedMarket:
    def test_ask_below_bid_is_null_and_warned(self):
        rows = [_row(100, ce=_leg(bid=105.0, ask=100.0, volume=10, oi=5),
                          pe=_leg(bid=99.0, ask=99.5, volume=10, oi=5))]
        block = liquidity_block(rows)

        assert block["ceSpreadPct"] == [None]
        assert block["ceSpreadAbs"] == [None]
        assert block["peSpreadPct"][0] is not None
        assert block["warnings"] == ["crossed_market"]

    def test_equal_bid_ask_is_a_valid_zero_spread(self):
        rows = [_row(100, ce=_leg(bid=100.0, ask=100.0, volume=10, oi=5))]
        block = liquidity_block(rows)

        assert block["ceSpreadPct"][0] == pytest.approx(0.0)
        assert block["ceSpreadAbs"][0] == pytest.approx(0.0)
        assert "crossed_market" not in block["warnings"]


class TestVolOi:
    def test_zero_oi_is_null_but_zero_volume_is_a_real_zero(self):
        rows = [
            _row(100, ce=_leg(bid=100, ask=101, volume=500, oi=0),
                      pe=_leg(bid=99, ask=100, volume=0, oi=10)),
        ]
        block = liquidity_block(rows)

        assert block["ceVolOi"][0] is None
        assert block["peVolOi"][0] == pytest.approx(0.0)

    def test_missing_volume_is_null_and_does_not_kill_the_spread(self):
        md = _md(bid=100.0, ask=101.0, oi=500)
        md.pop("volume")
        block = liquidity_block([_row(100, ce=_leg(md=md))])

        assert block["ceVolOi"][0] is None
        assert block["ceSpreadPct"][0] is not None
        assert block["warnings"] == []

    def test_ratio_is_volume_over_oi(self):
        block = liquidity_block([
            _row(100, ce=_leg(bid=100, ask=101, volume=250, oi=50))
        ])
        assert block["ceVolOi"][0] == pytest.approx(5.0)


class TestPartialChains:
    def test_junk_rows_one_sided_legs_and_unsorted_strikes(self):
        rows = [
            None,
            "junk",
            {"strike": None, "ce": _leg(bid=100, ask=101, oi=10, volume=20)},
            _row(110, pe=_leg(bid=109, ask=110, oi=10, volume=40)),
            _row(100, ce=_leg(bid=100, ask=101, oi=10, volume=20)),
            {"strike": "105.5", "ce": {"market_data": {}}},
        ]
        block = liquidity_block(rows)

        assert block["strikes"] == [100.0, 105.5, 110.0]
        assert len(block["ceSpreadPct"]) == len(block["peSpreadPct"]) == 3
        assert len(block["ceVolOi"]) == len(block["peVolOi"]) == 3
        # 100: CE only. 105.5: empty market_data. 110: PE only.
        assert block["ceSpreadPct"][0] is not None
        assert block["peSpreadPct"][0] is None
        assert block["ceSpreadPct"][1] is None
        assert block["ceSpreadPct"][2] is None
        assert block["peSpreadPct"][2] is not None

    def test_flat_leg_mapping_is_accepted(self):
        block = liquidity_block([
            {"strike": 100.0, "ce": _md(bid=100, ask=101, oi=10, volume=20)}
        ])
        assert block["ceSpreadPct"][0] is not None
        assert block["ceVolOi"][0] == pytest.approx(2.0)


class TestNoNaN:
    def test_corrupt_values_are_null_and_warned_never_nan(self):
        rows = [
            _row(100, ce=_leg(bid=float("nan"), ask=101, volume=10, oi=5),
                      pe=_leg(bid=100, ask=float("inf"), volume=10, oi=5)),
            _row(110, ce=_leg(bid=100, ask=101, volume=float("nan"), oi=5),
                      pe=_leg(bid=99, ask=100, volume=10, oi=-1)),
        ]
        block = liquidity_block(rows)

        for key in ("ceSpreadPct", "peSpreadPct", "ceSpreadAbs", "peSpreadAbs",
                    "ceVolOi", "peVolOi"):
            assert all(v is None or math.isfinite(v) for v in block[key]), key
        assert block["ceSpreadPct"][0] is None
        assert block["peSpreadPct"][0] is None
        assert block["ceVolOi"][1] is None
        assert block["peVolOi"][1] is None
        assert math.isfinite(block["medianSpreadPct"])
        assert block["warnings"] == ["invalid_quotes", "invalid_volume_oi"]
