"""Unit tests for the delta-positioning block (pure functions).

Units: Upstox reports option OI in UNITS (shares), so the crore conversion is
``oi * delta * spot / 1e7`` — the lot size is echoed in the payload but never
applied (doing so inflated every figure 65x).
"""

import pytest

from api.reports_api.nifty_positioning import (
    NIFTY_LOT_SIZE,
    class_sign,
    compute_positioning,
    delta_flip_level,
    positioning_verdict,
)

#: Cr per (unit × delta) at spot 20,000: 20000 / 1e7.
FACTOR = 20000 / 1e7


def _leg(oi, doi, delta, sentiment):
    return {"oi": oi, "oi_change": doi, "delta": delta, "sentiment": sentiment}


def _row(strike, ce, pe):
    return {"strike": strike, "ce": ce, "pe": pe}


class TestClassSign:
    def test_call_long_buildup_bullish(self):
        assert class_sign("LB", "CE") == 1

    def test_call_short_buildup_bearish(self):
        assert class_sign("SB", "CE") == -1

    def test_put_long_buildup_bearish(self):
        assert class_sign("LB", "PE") == -1

    def test_put_short_buildup_bullish(self):
        assert class_sign("SB", "PE") == 1

    def test_short_cover_sign_follows_the_side(self):
        # A call short buys the call back (+delta) -> bullish.
        # A put short buys the put back (-delta removed, so support leaves)
        # -> bearish. The two sides are NOT symmetric.
        assert class_sign("SC", "CE") == 1
        assert class_sign("SC", "PE") == -1

    def test_long_unwind_sign_follows_the_side(self):
        # A call buyer selling out removes +delta -> bearish.
        # A put buyer selling out removes -delta (pressure leaves) -> bullish.
        assert class_sign("LU", "CE") == -1
        assert class_sign("LU", "PE") == 1

    def test_unknown_is_neutral(self):
        assert class_sign("Neutral", "CE") == 0
        assert class_sign(None, "PE") == 0

    def test_dict_sentiment_uses_label(self):
        # build_leg stores the raw get_option_sentiment mapping.
        assert class_sign({"type": "Short Buildup", "label": "SB"}, "CE") == -1
        assert class_sign({"type": "Long Buildup", "label": "LB"}, "PE") == -1

    def test_full_name_without_label_maps_to_code(self):
        assert class_sign("Long Buildup", "CE") == 1
        assert class_sign("Short Covering", "PE") == -1
        assert class_sign("Long Unwinding", "CE") == -1
        assert class_sign("Long Unwinding", "PE") == 1

    def test_neutral_dict_is_zero(self):
        assert class_sign({"type": "Neutral", "label": "Neutral"}, "CE") == 0


class TestVerdict:
    """The verdict reads the CLASS-WEIGHTED aggregates only.

    ``initiated_cr`` is today's class-weighted initiation and ``flow_cr`` the
    class-weighted flow — the like-for-like companion. The signed-delta book
    is a different convention and is deliberately not a confirmation.
    """

    def test_bullish_dominance(self):
        assert positioning_verdict(100.0, flow_cr=20.0, gross_cr=110.0) == "bullish"

    def test_bearish_dominance(self):
        assert positioning_verdict(-100.0, flow_cr=-20.0, gross_cr=110.0) == "bearish"

    def test_within_25pct_is_balanced(self):
        # 110 gross with a 20 net (18%) is inside the noise floor.
        assert positioning_verdict(20.0, flow_cr=20.0, gross_cr=110.0) == "balanced"

    def test_relative_floor_scales_with_the_book(self):
        # 5% of a 10,000 Cr book is 500 Cr: a 200 Cr net is noise on it.
        assert positioning_verdict(200.0, flow_cr=200.0, gross_cr=10_000.0) == "balanced"
        assert positioning_verdict(800.0, flow_cr=800.0, gross_cr=10_000.0) == "bullish"

    def test_absolute_floor_50_cr(self):
        # Below 50 Cr nothing reads as a direction, whatever the book says.
        assert positioning_verdict(40.0, flow_cr=40.0, gross_cr=100.0) == "balanced"

    def test_flow_must_confirm_the_direction(self):
        assert positioning_verdict(100.0, flow_cr=-20.0, gross_cr=110.0) == "balanced"
        assert positioning_verdict(-100.0, flow_cr=20.0, gross_cr=110.0) == "balanced"

    def test_all_zero_is_balanced(self):
        assert positioning_verdict(0.0, 0.0) == "balanced"


class TestComputePositioning:
    def test_state_counts_calls_positive_puts_negative(self):
        # delta 0.5 each, oi 1000 units each, spot 20000 -> factor 0.002
        # state = (1000*0.5 - 1000*0.5) * 0.002 = 0.0
        rows = [_row(20000, _leg(1000, 0, 0.5, "Neutral"),
                     _leg(1000, 0, 0.5, "Neutral"))]
        out = compute_positioning(rows, spot=20000)
        assert out["state"] == 0.0

    def test_bullish_and_bearish_split(self):
        # CE long buildup 1,000,000 units of ΔOI at delta 0.5 → +1000 Cr
        # PE long buildup 2,000,000 units of ΔOI at delta 0.5 → −2000 Cr
        # (the house convention reads a put long build as bearish)
        rows = [_row(20000, _leg(0, 1_000_000, 0.5, "LB"),
                     _leg(0, 2_000_000, 0.5, "LB"))]
        out = compute_positioning(rows, spot=20000)
        assert out["bull_cr"] == 1000.0
        assert out["bear_cr"] == 2000.0
        assert out["initiated"] == -1000.0
        assert out["verdict"] == "bearish"
        # dominant side share = 2000 / 3000 = 66.7%
        assert out["split_pct"] == 66.7

    def test_unwind_sign_comes_from_class_not_doi(self):
        # CE long unwind: doi is NEGATIVE but the class is bearish -> bearish.
        rows = [_row(20000, _leg(1000, -500, 0.5, "LU"),
                     _leg(0, 0, 0.5, "Neutral"))]
        out = compute_positioning(rows, spot=20000)
        assert out["bear_cr"] > 0
        assert out["bull_cr"] == 0.0
        assert out["initiated"] < 0

    def test_doi_totals_and_lot_size(self):
        rows = [_row(20000, _leg(0, 100, 0.5, "LB"),
                     _leg(0, 200, 0.5, "SB"))]
        out = compute_positioning(rows, spot=20000)
        assert out["ce_doi"] == 100
        assert out["pe_doi"] == 200
        assert out["lot_size"] == NIFTY_LOT_SIZE

    def test_empty_rows_degrade_to_zero(self):
        out = compute_positioning([], spot=20000)
        assert out["state"] == 0.0
        assert out["initiated"] == 0.0
        assert out["strikes"] == []
        assert out["verdict"] == "balanced"

    def test_zero_spot_yields_zero_factor(self):
        rows = [_row(20000, _leg(1000, 1000, 0.5, "LB"),
                     _leg(0, 0, 0.5, "Neutral"))]
        out = compute_positioning(rows, spot=0)
        assert out["state"] == 0.0
        assert out["initiated"] == 0.0

    def test_per_strike_breakdown_shape(self):
        rows = [_row(20000, _leg(0, 100, 0.5, "LB"),
                     _leg(0, 100, 0.5, "SB"))]
        out = compute_positioning(rows, spot=20000)
        s = out["strikes"][0]
        assert s["strike"] == 20000
        assert set(s["ce"]) == {"class", "doi", "initiated"}
        assert "net_initiated" in s
        # OI × delta per strike, calls + / puts − (signed Cr) for the flip curve.
        assert "net_state" in s

    def test_dict_sentiment_produces_initiated(self):
        # The chain stores sentiment as a mapping; initiated must still compute.
        ce = {"oi": 0, "oi_change": 1_000_000, "delta": 0.5,
              "sentiment": {"type": "Long Buildup", "label": "LB"}}
        pe = {"oi": 0, "oi_change": 0, "delta": 0.5,
              "sentiment": {"type": "Neutral", "label": "Neutral"}}
        out = compute_positioning([_row(20000, ce, pe)], spot=20000)
        assert out["initiated"] == 1000.0
        assert out["bull_cr"] == 1000.0
        assert out["strikes"][0]["ce"]["class"] == "LB"

    def test_delta_flip_is_the_cumulative_zero_cross(self):
        # 20000: puts dominate -> cumulative negative. 20100: calls dominate
        # hard enough to cross zero, so the flip is 20100.
        rows = [
            _row(20000, _leg(100, 0, 0.5, "Neutral"), _leg(300, 0, 0.5, "Neutral")),
            _row(20100, _leg(300, 0, 0.5, "Neutral"), _leg(100, 0, 0.5, "Neutral")),
        ]
        out = compute_positioning(rows, spot=20000)
        assert out["strikes"][0]["net_state"] < 0
        assert out["strikes"][1]["net_state"] > 0
        assert out["delta_flip"] == 20100

    def test_empty_book_has_no_delta_flip(self):
        out = compute_positioning([], spot=20000)
        assert out["delta_flip"] is None


class TestUnits:
    """Upstox reports option OI in UNITS (shares), not contracts."""

    def test_lot_size_must_not_scale_the_crore_conversion(self):
        # 1,000,000 units at delta 0.5 and spot 20,000 is 1000 Cr — NOT
        # 1000 × 65 Cr. Applying the lot again inflated every figure 65x.
        rows = [_row(20000, _leg(1_000_000, 0, 0.5, "Neutral"), None)]
        out = compute_positioning(rows, spot=20000)
        assert out["state"] == pytest.approx(1_000_000 * 0.5 * FACTOR)
        assert out["state"] == pytest.approx(1000.0)
        # The lot is echoed for clients but never applied.
        assert out["lot_size"] == NIFTY_LOT_SIZE
        # Any lot size gives the same numbers.
        assert compute_positioning(rows, spot=20000, lot_size=1)["state"] == \
            out["state"]
        assert compute_positioning(rows, spot=20000, lot_size=999)["state"] == \
            out["state"]

    def test_initiated_uses_the_same_units(self):
        rows = [_row(20000, _leg(0, 1_000_000, 0.5, "LB"), None)]
        out = compute_positioning(rows, spot=20000)
        assert out["initiated"] == pytest.approx(1_000_000 * 0.5 * FACTOR)
        assert out["initiated"] == pytest.approx(1000.0)


class TestDeltaFlipLevel:
    def test_crossing_returns_the_first_sign_change(self):
        strikes = [
            {"strike": 20000, "net_state": -10},
            {"strike": 20050, "net_state": -5},
            {"strike": 20100, "net_state": 25},
            {"strike": 20150, "net_state": 4},
        ]
        assert delta_flip_level(strikes) == 20100

    def test_exact_zero_counts_as_the_flip(self):
        strikes = [
            {"strike": 20000, "net_state": -10},
            {"strike": 20050, "net_state": 10},
        ]
        assert delta_flip_level(strikes) == 20050

    def test_leading_dead_strikes_do_not_fake_a_level(self):
        strikes = [
            {"strike": 19500, "net_state": 0},
            {"strike": 19600, "net_state": 0},
            {"strike": 20000, "net_state": -3},
            {"strike": 20100, "net_state": 3},
        ]
        assert delta_flip_level(strikes) == 20100

    def test_spot_prefers_the_cross_nearest_the_money(self):
        # A thin wing can wobble through zero far from spot; the level that
        # matters is the long-delta pivot nearest the traded price.
        strikes = [
            {"strike": 20000, "net_state": -10},
            {"strike": 20100, "net_state": 20},   # - -> + (flip)
            {"strike": 21000, "net_state": 50},
            {"strike": 21100, "net_state": -100},  # + -> - (put wall, ignored)
            {"strike": 21200, "net_state": 80},   # - -> + (flip)
        ]
        assert delta_flip_level(strikes, spot=21120) == 21200
        assert delta_flip_level(strikes, spot=20050) == 20100
        # No spot keeps the deterministic first-cross fallback.
        assert delta_flip_level(strikes) == 20100

    def test_put_wall_crossing_is_not_a_flip(self):
        strikes = [
            {"strike": 20000, "net_state": 10},
            {"strike": 20100, "net_state": -50},
        ]
        assert delta_flip_level(strikes, spot=20100) is None

    def test_no_crossing_returns_none(self):
        assert delta_flip_level([{"strike": 20000, "net_state": -5}]) is None
        assert delta_flip_level([]) is None
        assert delta_flip_level([
            {"strike": 20000, "net_state": 0},
            {"strike": 20050, "net_state": 0},
        ]) is None

    def test_input_order_does_not_matter(self):
        strikes = [
            {"strike": 20100, "net_state": 20},
            {"strike": 20000, "net_state": -10},
        ]
        assert delta_flip_level(strikes) == 20100


class TestPutSideMapping:
    """Regression for the swapped put-side ``SC``/``LU`` cells.

    The class must be read through the delta exposure it represents (long call
    ``+``, long put ``-``), not through the option's own price tone:

    * put ``LB`` buyers open  -> ``-`` (bearish)
    * put ``SC`` shorts close -> ``-`` (writers buy the puts back; the long-delta
      support they provided leaves the book)
    * put ``SB`` writers open -> ``+`` (bullish)
    * put ``LU`` buyers close -> ``+`` (put buyers sell out; short-delta
      pressure leaves the book)

    The old map credited put ``SC`` as bullish and put ``LU`` as bearish. On a
    falling tape those are the two cells that fire, so the split read ~99%
    bullish — the 2026-11-02 11:52 frame printed 171,106 Cr bull vs 387 Cr
    bear while the index broke 23,300.
    """

    @staticmethod
    def _falling_tape() -> list[dict]:
        """Falling tape (spot 23,250, broke 23,300) with mixed put activity.

        Premiums are measured against the prior close: calls down, puts up.
        Put OI is mostly unwinding (writers covering after the slide) plus one
        genuine put-buying build at 23,500.
        """
        return [
            # strike, calls, puts
            _row(23100, _leg(2_000_000, 0, 0.70, "Neutral"),
                 _leg(9_000_000, -4_000_000, 0.40, "SC")),
            _row(23200, _leg(5_000_000, 20_000, 0.62, "SB"),
                 _leg(12_000_000, -7_500_000, 0.55, "SC")),
            _row(23300, _leg(4_000_000, -10_000, 0.45, "LU"),
                 _leg(10_000_000, -6_000_000, 0.63, "SC")),
            _row(23400, _leg(3_000_000, 10_000, 0.28, "SB"),
                 _leg(4_000_000, -2_500_000, 0.38, "SC")),
            _row(23500, _leg(1_000_000, 0, 0.16, "Neutral"),
                 _leg(2_000_000, 100_000, 0.20, "LB")),
        ]

    def test_falling_tape_put_short_covering_is_bearish(self):
        out = compute_positioning(self._falling_tape(), spot=23250)
        # Old map: bull 24,307.9 Cr / bear 92.3 Cr (99.6% bullish).
        assert out["bull_cr"] == 0.0
        assert out["bear_cr"] == pytest.approx(24_400.2, rel=1e-3)
        assert out["initiated"] < 0
        assert out["split_pct"] == 100.0
        # Exit legs: |dOI| signs ``initiated`` while the same-class flow keeps
        # dOI's sign, so the like-for-like confirmation disagrees -> balanced.
        # The point of the fix is that the split no longer claims bullish.
        assert out["verdict"] != "bullish"

    def test_put_buyers_are_bearish_evidence(self):
        # Falling tape where the put build is buyers paying up, not writers.
        rows = [
            _row(23200, _leg(5_000_000, 20_000, 0.62, "SB"),
                 _leg(12_000_000, 6_000_000, 0.55, "LB")),
            _row(23300, _leg(4_000_000, -10_000, 0.45, "LU"),
                 _leg(10_000_000, 3_000_000, 0.63, "LB")),
            _row(23400, _leg(3_000_000, 10_000, 0.28, "SB"),
                 _leg(4_000_000, 500_000, 0.38, "LB")),
        ]
        out = compute_positioning(rows, spot=23250)
        assert out["bull_cr"] == 0.0
        assert out["bear_cr"] > 10_000
        assert out["initiated"] < 0
        assert out["verdict"] == "bearish"
        # Put buyers are the largest single leg evidence.
        pe_legs = [s["pe"] for s in out["strikes"] if s["pe"]["class"] == "LB"]
        assert pe_legs and all(leg["initiated"] < 0 for leg in pe_legs)

    def test_up_tape_put_long_unwinding_is_bullish(self):
        # Mirror case: calls bought, put longs sell out. Under the old map the
        # put LU legs were subtracted as bearish; now they confirm the rise.
        rows = [
            _row(23200, _leg(6_000_000, 5_000_000, 0.55, "LB"),
                 _leg(8_000_000, -4_000_000, 0.40, "LU")),
            _row(23300, _leg(4_000_000, 1_000_000, 0.63, "LB"),
                 _leg(6_000_000, -900_000, 0.30, "LU")),
        ]
        out = compute_positioning(rows, spot=23250)
        assert out["bear_cr"] == 0.0
        assert out["bull_cr"] > 10_000
        assert out["initiated"] > 0
        assert out["verdict"] == "bullish"
        pe_legs = [s["pe"] for s in out["strikes"] if s["pe"]["class"] == "LU"]
        assert pe_legs and all(leg["initiated"] > 0 for leg in pe_legs)

    def test_mixed_tape_keeps_both_sides_represented(self):
        # Genuine two-way initiation: call buyers + put buyers. Neither side
        # may be zeroed out by the mapping.
        rows = [
            _row(23200, _leg(5_000_000, 2_000_000, 0.50, "LB"),
                 _leg(6_000_000, 2_000_000, 0.50, "LB")),
        ]
        out = compute_positioning(rows, spot=23250)
        assert out["bull_cr"] == pytest.approx(out["bear_cr"], rel=1e-6)
        assert out["bull_cr"] > 0
        assert out["split_pct"] == pytest.approx(50.0)

    def test_one_sided_up_day_split_is_vetoed_by_raw_flow(self):
        """The 2026-11-02 11:52 shape, scaled down.

        Day-over-day the tape is UP (calls bought, puts written), so the class
        read is ~100% bullish, but put OI is added faster than call OI and the
        raw signed-delta flow is negative. The split may stay one-sided; the
        verdict must not print "bullish" on it.
        """
        rows = [
            _row(23200, _leg(6_000_000, 2_000_000, 0.50, "LB"),
                 _leg(9_000_000, 4_000_000, 0.50, "SB")),
            _row(23300, _leg(5_000_000, 0, 0.40, "Neutral"),
                 _leg(4_000_000, -50_000, 0.30, "LU")),
        ]
        out = compute_positioning(rows, spot=23250)
        assert out["bull_cr"] > out["bear_cr"] * 100
        assert out["initiated"] > 0
        assert out["flow"] < 0
        assert out["verdict"] == "balanced"
