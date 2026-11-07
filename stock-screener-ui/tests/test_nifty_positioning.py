"""Unit tests for api/reports_api/nifty_positioning.py.

Pure functions only — hand-built chain rows, no network/DB. The fixtures pin
the two things that went wrong on 2026-10-21: a positive gross split printing
BULLISH over a net-negative book, and a thin-wing crossing reported as the
delta pivot while the cumulative book finished short.
"""

import pytest

from api.reports_api.nifty_positioning import (
    class_sign,
    compute_positioning,
    delta_flip_level,
    positioning_verdict,
)

SPOT = 25_000.0
LOT = 65
# OI is in units, so Cr = oi * delta * spot / 1e7 (no lot multiplier).
FACTOR = SPOT / 1e7


def leg(oi, oi_change, delta, sentiment):
    return {"oi": oi, "oi_change": oi_change, "delta": delta, "sentiment": sentiment}


def row(strike, ce, pe):
    return {"strike": strike, "ce": ce, "pe": pe}


class TestClassConvention:
    @pytest.mark.parametrize(
        "side,code,expected",
        [
            ("CE", "LB", 1),
            ("CE", "SC", 1),
            ("CE", "SB", -1),
            ("CE", "LU", -1),
            # Put side reads the delta the position represents (long put = -):
            # writers open / buyers sell out are bullish, buyers open / shorts
            # buy back are bearish.
            ("PE", "SB", 1),
            ("PE", "LU", 1),
            ("PE", "LB", -1),
            ("PE", "SC", -1),
        ],
    )
    def test_class_sign_reads_position_delta_per_side(self, side, code, expected):
        assert class_sign({"label": code}, side) == expected

    def test_unknown_class_is_neutral(self):
        assert class_sign({"label": "Neutral"}, "CE") == 0
        assert class_sign(None, "PE") == 0


class TestVerdict:
    def test_signed_delta_flow_vetoes_a_one_sided_class_read(self):
        # 2026-11-02 11:52 repro: the day-versus-prior-close read is ~100%
        # bullish (put writing + call buying) while put OI is added faster than
        # call OI, so the signed-delta flow is negative. The veto exists for
        # exactly this: the class-weighted read may not claim bullish through a
        # down-move. It is one-way — flow can veto, never add, a direction.
        rows = [
            row(
                23_000,
                leg(10_000, 10_000, 0.5, {"label": "LB"}),
                leg(100_000, 50_000, 0.5, {"label": "SB"}),
            )
        ]
        pos = compute_positioning(rows, SPOT, LOT)
        assert pos["state"] < 0
        assert pos["flow"] < 0
        assert pos["flow_class"] > 0
        assert pos["initiated"] > 0
        assert pos["bull_cr"] > pos["bear_cr"] * 1.25  # gross dominance
        assert pos["verdict"] == "balanced"

    def test_clean_bullish_agreement(self):
        rows = [
            row(
                25_000,
                leg(100_000, 50_000, 0.5, {"label": "LB"}),
                leg(10_000, 0, 0.5, {"label": "Neutral"}),
            )
        ]
        pos = compute_positioning(rows, SPOT, LOT)
        assert pos["state"] > 0
        assert pos["flow"] > 0
        assert pos["initiated"] > 0
        assert pos["verdict"] == "bullish"

    def test_clean_bearish_agreement(self):
        rows = [
            row(
                25_000,
                leg(10_000, -10_000, 0.5, {"label": "LU"}),
                leg(100_000, 50_000, 0.5, {"label": "LB"}),
            )
        ]
        pos = compute_positioning(rows, SPOT, LOT)
        assert pos["state"] < 0
        assert pos["flow"] < 0
        assert pos["initiated"] < 0
        assert pos["verdict"] == "bearish"

    def test_balanced_when_initiated_is_noise(self):
        rows = [
            row(
                25_000,
                leg(10_000, 0, 0.5, {"label": "LB"}),
                leg(10_000, 0, 0.5, {"label": "SB"}),
            )
        ]
        pos = compute_positioning(rows, SPOT, LOT)
        assert pos["verdict"] == "balanced"

    def test_verdict_requires_signed_agreement(self):
        # The class-weighted flow is the ONLY valid confirmation: the
        # signed-delta book is a different convention.
        assert positioning_verdict(100, flow_cr=20, gross_cr=110) == "bullish"
        assert positioning_verdict(-100, flow_cr=-20, gross_cr=110) == "bearish"
        assert positioning_verdict(100, flow_cr=-20, gross_cr=110) == "balanced"
        assert positioning_verdict(-100, flow_cr=20, gross_cr=110) == "balanced"
        # Below the noise floor (max(5% of gross, 50 Cr)) there is no verdict.
        assert positioning_verdict(10, flow_cr=10, gross_cr=110) == "balanced"


class TestUnits:
    def test_crore_conversion_does_not_apply_lot_twice(self):
        # 1,00,000 units at delta 1 and spot 25,000 = 250 Cr, not 16,250 Cr.
        rows = [row(25_000, leg(100_000, 0, 1.0, {"label": "Neutral"}), None)]
        pos = compute_positioning(rows, SPOT, LOT)
        assert pos["state"] == pytest.approx(100_000 * FACTOR)
        assert pos["state"] == pytest.approx(250.0)
        assert pos["lot_size"] == LOT  # still echoed for clients


class TestDeltaFlip:
    def test_sustained_negative_to_positive_cross(self):
        strikes = [
            {"strike": 20_000, "net_state": -10},
            {"strike": 20_100, "net_state": 15},
        ]
        assert delta_flip_level(strikes) == 20_100

    def test_no_cross_returns_none(self):
        strikes = [
            {"strike": 20_000, "net_state": -10},
            {"strike": 20_100, "net_state": -5},
        ]
        assert delta_flip_level(strikes) is None

    def test_wing_wobble_that_ends_short_is_not_a_pivot(self):
        # 2026-10-21 shape: an early wing tick goes positive, then the book
        # falls back negative and finishes there. The old code reported 20,500.
        strikes = [
            {"strike": 20_050, "net_state": -1_600},
            {"strike": 20_500, "net_state": 2_700},
            {"strike": 23_000, "net_state": -50_000},
        ]
        assert delta_flip_level(strikes, spot=22_930) is None

    def test_put_wall_only_is_not_a_pivot(self):
        strikes = [
            {"strike": 20_000, "net_state": 10},
            {"strike": 20_100, "net_state": -20},
        ]
        assert delta_flip_level(strikes) is None

    def test_flat_book_still_reports_the_cross(self):
        strikes = [
            {"strike": 20_000, "net_state": -10},
            {"strike": 20_100, "net_state": 10},
        ]
        assert delta_flip_level(strikes) == 20_100

    def test_closest_sustained_cross_to_spot_wins(self):
        strikes = [
            {"strike": 20_000, "net_state": -10},
            {"strike": 20_100, "net_state": 20},
            {"strike": 20_200, "net_state": -40},
            {"strike": 20_300, "net_state": 40},
        ]
        # Cumulative: -10, +10, -30, +10 → two negative→positive crosses.
        assert delta_flip_level(strikes, spot=20_290) == 20_300
        assert delta_flip_level(strikes, spot=20_110) == 20_100
