"""Unit tests for the delta-positioning block (pure functions)."""

from api.reports_api.nifty_positioning import (
    NIFTY_LOT_SIZE,
    class_sign,
    compute_positioning,
    delta_flip_level,
    positioning_verdict,
)


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

    def test_short_cover_bullish_both_sides(self):
        assert class_sign("SC", "CE") == 1
        assert class_sign("SC", "PE") == 1

    def test_unknown_is_neutral(self):
        assert class_sign("Neutral", "CE") == 0
        assert class_sign(None, "PE") == 0

    def test_dict_sentiment_uses_label(self):
        # build_leg stores the raw get_option_sentiment mapping.
        assert class_sign({"type": "Short Buildup", "label": "SB"}, "CE") == -1
        assert class_sign({"type": "Long Buildup", "label": "LB"}, "PE") == -1

    def test_full_name_without_label_maps_to_code(self):
        assert class_sign("Long Buildup", "CE") == 1
        assert class_sign("Short Covering", "PE") == 1
        assert class_sign("Long Unwinding", "CE") == -1

    def test_neutral_dict_is_zero(self):
        assert class_sign({"type": "Neutral", "label": "Neutral"}, "CE") == 0


class TestVerdict:
    def test_bullish_dominance(self):
        assert positioning_verdict(bull_cr=100.0, bear_cr=10.0) == "bullish"

    def test_bearish_dominance(self):
        assert positioning_verdict(bull_cr=10.0, bear_cr=100.0) == "bearish"

    def test_within_25pct_is_balanced(self):
        assert positioning_verdict(bull_cr=100.0, bear_cr=90.0) == "balanced"

    def test_all_zero_is_balanced(self):
        assert positioning_verdict(0.0, 0.0) == "balanced"


class TestComputePositioning:
    def test_state_counts_calls_positive_puts_negative(self):
        # delta 0.5 each, oi 1000 each, spot 20000, lot 65 -> factor 0.13
        # state = (1000*0.5 - 1000*0.5) * 0.13 = 0.0
        rows = [_row(20000, _leg(1000, 0, 0.5, "Neutral"),
                     _leg(1000, 0, 0.5, "Neutral"))]
        out = compute_positioning(rows, spot=20000)
        assert out["state"] == 0.0

    def test_bullish_and_bearish_split(self):
        # CE long buildup 1000 doi, delta 0.5 -> +1000*0.5*0.13 = +65 Cr
        # PE long buildup 2000 doi, delta 0.5 -> -2000*0.5*0.13 = -130 Cr
        rows = [_row(20000, _leg(0, 1000, 0.5, "LB"),
                     _leg(0, 2000, 0.5, "LB"))]
        out = compute_positioning(rows, spot=20000)
        assert out["bull_cr"] == 65.0
        assert out["bear_cr"] == 130.0
        assert out["initiated"] == -65.0
        assert out["verdict"] == "bearish"
        # dominant side share = 130 / 195 = 66.7%
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
        ce = {"oi": 0, "oi_change": 1000, "delta": 0.5,
              "sentiment": {"type": "Long Buildup", "label": "LB"}}
        pe = {"oi": 0, "oi_change": 0, "delta": 0.5,
              "sentiment": {"type": "Neutral", "label": "Neutral"}}
        out = compute_positioning([_row(20000, ce, pe)], spot=20000)
        assert out["initiated"] == 65.0
        assert out["bull_cr"] == 65.0
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
