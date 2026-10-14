"""Unit tests for the delta-positioning block (pure functions)."""

from api.reports_api.nifty_positioning import (
    NIFTY_LOT_SIZE,
    class_sign,
    compute_positioning,
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
