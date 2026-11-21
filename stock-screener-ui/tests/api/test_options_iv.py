"""Pure tests for :mod:`api.options_iv` — no network, DB, FastAPI or fixtures.

The fixtures are hand-built so every expected number can be checked by eye.
The sanity cases mirror the data-verification findings: a 0 IV is missing, a
117% wing print is an artefact, ``close_price`` is not a price for an option,
and a decimal ``0.14`` is a 0.14% print — the module never rescales units.
"""

import math

import pytest

from api.options_iv import (
    atm_iv,
    filter_quality,
    fit_smile,
    gamma_coverage,
    interp_iv_by_delta,
    iv_source,
    leg_points,
    otm_points,
    rr25,
    smile_metrics,
    valid_leg,
)


def _leg(ltp=150.0, iv=14.0, delta=0.5, oi=1000, **extra):
    return {"ltp": ltp, "iv": iv, "delta": delta, "oi": oi, **extra}


def _row(strike, ce=None, pe=None):
    return {"strike": strike, "ce": ce, "pe": pe}


def _point(strike, iv, delta, side, oi=1000, **extra):
    return {"strike": strike, "iv": iv, "delta": delta, "oi": oi,
            "side": side, **extra}


class TestValidLeg:
    def test_sane_leg_passes(self):
        assert valid_leg(_leg()) is True

    @pytest.mark.parametrize("ltp", [0, -1, None, float("nan"), float("inf"), "n/a"])
    def test_bad_ltp_fails(self, ltp):
        assert valid_leg(_leg(ltp=ltp)) is False

    @pytest.mark.parametrize("iv", [0, -1, 100.1, 117, 281.25,
                                    float("nan"), float("inf"), None, "n/a"])
    def test_bad_iv_fails(self, iv):
        assert valid_leg(_leg(iv=iv)) is False

    @pytest.mark.parametrize("iv", [0.1, 1, 14.2, 60.0, 80.0, 100.0])
    def test_iv_band_is_zero_exclusive_hundred_inclusive(self, iv):
        assert valid_leg(_leg(iv=iv)) is True

    @pytest.mark.parametrize("delta", [None, float("nan"), float("inf"), "n/a"])
    def test_non_finite_delta_fails(self, delta):
        assert valid_leg(_leg(delta=delta)) is False

    def test_zero_delta_is_still_a_finite_delta(self):
        assert valid_leg(_leg(delta=0.0)) is True

    def test_oi_is_optional(self):
        assert valid_leg({"ltp": 150.0, "iv": 14.0, "delta": 0.5}) is True
        assert valid_leg(_leg(oi=0)) is True
        assert valid_leg(_leg(oi=None)) is True

    def test_close_price_is_not_a_price_for_an_option(self):
        assert valid_leg({"close_price": 150.0, "iv": 14.0, "delta": 0.5}) is False

    def test_non_mapping_leg_fails(self):
        assert valid_leg(None) is False
        assert valid_leg("garbage") is False


class TestIvSource:
    def test_usable_print_is_upstox(self):
        assert iv_source(_leg()) == "upstox"
        assert iv_source(_leg(iv=60.0)) == "upstox"
        assert iv_source(_leg(iv=80.0)) == "upstox"
        assert iv_source(_leg(iv=100.0)) == "upstox"

    def test_missing_print(self):
        assert iv_source({}) == "missing"
        assert iv_source(None) == "missing"
        assert iv_source(_leg(iv=None)) == "missing"
        assert iv_source(_leg(iv=0)) == "missing"

    @pytest.mark.parametrize("iv", [-3.0, 100.1, 117.0, float("nan"),
                                    float("inf"), "n/a"])
    def test_invalid_print(self, iv):
        assert iv_source(_leg(iv=iv)) == "invalid"


class TestOtmPoints:
    def test_ce_above_pe_below_sorted_no_atm(self):
        rows = [
            _row(110, ce=_leg(iv=12.0, delta=0.25), pe=_leg(iv=17.0, delta=-0.75)),
            _row(90, ce=_leg(iv=17.0, delta=0.75), pe=_leg(iv=16.0, delta=-0.25)),
            _row(100, ce=_leg(iv=14.0, delta=0.5), pe=_leg(iv=15.0, delta=-0.5)),
        ]
        points = otm_points(rows, spot=100.0)

        assert [(p["strike"], p["side"]) for p in points] == [
            (90.0, "PE"), (110.0, "CE")
        ]
        assert [p["iv"] for p in points] == [16.0, 12.0]
        assert all(set(p) == {"strike", "iv", "delta", "oi", "side"} for p in points)
        assert all(p["side"] == "PE" for p in points if p["strike"] < 100.0)
        assert all(p["side"] == "CE" for p in points if p["strike"] > 100.0)

    def test_dead_legs_are_skipped_never_zero_filled(self):
        rows = [
            _row(90, pe=_leg(iv=0, delta=-0.25)),           # Upstox "missing"
            _row(95, pe=_leg(iv=None, delta=-0.35)),        # no greek yet
            _row(105, ce=_leg(iv=117.0, delta=0.35)),       # artefact wing
            _row(110, ce=_leg(iv=12.0, delta=0.25)),        # the only survivor
        ]
        points = otm_points(rows, spot=100.0)

        assert points == [_point(110.0, 12.0, 0.25, "CE")]

    def test_missing_oi_is_kept_as_none(self):
        rows = [_row(110, ce={"ltp": 10.0, "iv": 12.0, "delta": 0.25})]
        points = otm_points(rows, spot=100.0)

        assert len(points) == 1
        assert points[0]["oi"] is None

    def test_zero_oi_leg_is_kept(self):
        points = otm_points([_row(110, ce=_leg(oi=0))], spot=100.0)
        assert len(points) == 1

    def test_bad_spot_and_junk_rows(self):
        rows = [_row(110, ce=_leg())]
        assert otm_points(rows, spot=None) == []
        assert otm_points(rows, spot=float("nan")) == []
        assert otm_points(None, spot=100.0) == []
        assert otm_points([None, "junk", {"strike": None}], 100.0) == []


class TestLegPoints:
    """ATM IV needs the ATM strike's own quotes, which otm_points drops."""

    def test_keeps_both_sides_and_the_atm_strike(self):
        rows = [
            _row(100, ce=_leg(iv=16.0, delta=0.50), pe=_leg(iv=16.4, delta=-0.50)),
            _row(90, ce=_leg(iv=17.0, delta=0.75), pe=_leg(iv=16.0, delta=-0.25)),
        ]
        points = leg_points(rows)

        assert [(p["strike"], p["side"]) for p in points] == [
            (90.0, "CE"), (90.0, "PE"), (100.0, "CE"), (100.0, "PE")
        ]
        assert all(set(p) == {"strike", "iv", "delta", "oi", "side"} for p in points)

    def test_dead_legs_are_skipped(self):
        rows = [
            _row(100, ce=_leg(iv=0), pe=_leg(iv=16.4, delta=-0.50)),
            None, "junk", {"strike": None},
        ]
        assert leg_points(rows) == [_point(100.0, 16.4, -0.50, "PE")]

    def test_empty_and_none(self):
        assert leg_points(None) == []
        assert leg_points([]) == []


class TestAtmIv:
    def test_linear_smile_interpolates_between_two_nearest_strikes(self):
        points = [_point(k, 0.2 * k - 10.0, 0.5, "CE") for k in (100, 110, 120, 130)]

        assert atm_iv(points, 115.0) == pytest.approx(13.0)
        assert atm_iv(points, 100.0) == pytest.approx(10.0)
        assert atm_iv(points, 125.0) == pytest.approx(15.0)

    def test_single_point_and_empty(self):
        single = [_point(110.0, 12.0, 0.5, "CE")]
        assert atm_iv(single, 108.0) == pytest.approx(12.0)
        assert atm_iv(single, 999.0) == pytest.approx(12.0)
        assert atm_iv([], 100.0) is None

    def test_step_snaps_spot_to_strike_grid(self):
        points = [_point(k, 0.2 * k - 10.0, 0.5, "CE") for k in (100, 110, 120)]

        assert atm_iv(points, 114.0) == pytest.approx(12.8)
        assert atm_iv(points, 114.0, step=10) == pytest.approx(12.0)

    def test_bad_spot(self):
        points = [_point(110.0, 12.0, 0.5, "CE")]
        assert atm_iv(points, 0.0) is None
        assert atm_iv(points, None) is None

    def test_invalid_iv_points_are_not_used(self):
        points = [_point(100.0, 0.0, 0.5, "CE"), _point(120.0, 117.0, 0.4, "CE")]
        assert atm_iv(points, 110.0) is None

    def test_atm_strike_ce_and_pe_are_averaged_not_wing_interpolated(self):
        # The ATM strike 10000 prints CE 16.0 / PE 16.4 -> 16.2, not the 16.0
        # the strict OTM wings would interpolate at spot.
        points = [
            _point(9900, 17.0, 0.55, "CE"),
            _point(10000, 16.0, 0.50, "CE"),
            _point(10000, 16.4, -0.50, "PE"),
            _point(10100, 15.0, 0.45, "CE"),
        ]
        assert atm_iv(points, 10000.0) == pytest.approx(16.2)

    def test_one_sided_atm_uses_the_available_side(self):
        points = [
            _point(10000, 16.0, 0.50, "CE"),   # ATM CE only
            _point(10100, 16.5, 0.45, "CE"),
        ]
        assert atm_iv(points, 10000.0) == pytest.approx(16.0)

    def test_no_atm_quote_falls_back_to_bracketing_interpolation(self):
        points = [_point(9900, 17.0, 0.55, "CE"), _point(10100, 15.0, 0.45, "CE")]
        assert atm_iv(points, 10000.0) == pytest.approx(16.0)

    def test_step_snap_reads_the_snapped_atm_strike(self):
        points = [
            _point(10000, 16.0, 0.50, "CE"),
            _point(10000, 16.4, -0.50, "PE"),
            _point(10100, 15.0, 0.45, "CE"),
            _point(10100, 15.4, -0.45, "PE"),
        ]
        # Spot 10090 with a 50-point grid snaps to 10100.
        assert atm_iv(points, 10090.0, step=50) == pytest.approx(15.2)

    def test_leg_points_feed_atm_but_otm_points_lose_it(self):
        rows = [
            _row(9900, pe=_leg(iv=17.0, delta=-0.55)),
            _row(10000, ce=_leg(iv=16.0, delta=0.50), pe=_leg(iv=16.4, delta=-0.50)),
            _row(10100, ce=_leg(iv=15.0, delta=0.45)),
        ]
        strict = atm_iv(otm_points(rows, 10000.0), 10000.0)
        legs = atm_iv(leg_points(rows), 10000.0)

        assert legs == pytest.approx(16.2)
        assert strict == pytest.approx(16.0)  # the old wing-interpolated value


class TestDeltaInterpolation:
    @pytest.fixture
    def wings(self):
        return [
            _point(105, 14.0, 0.50, "CE"),
            _point(110, 12.0, 0.25, "CE"),
            _point(115, 11.0, 0.15, "CE"),
            _point(95, 16.0, -0.50, "PE"),
            _point(90, 17.0, -0.25, "PE"),
            _point(85, 19.0, -0.15, "PE"),
        ]

    def test_exact_delta_returns_its_iv(self, wings):
        assert interp_iv_by_delta(wings, 0.25, "CE") == pytest.approx(12.0)
        assert interp_iv_by_delta(wings, -0.25, "PE") == pytest.approx(17.0)
        assert interp_iv_by_delta(wings, 0.25, "PE") == pytest.approx(17.0)

    def test_between_deltas(self, wings):
        assert interp_iv_by_delta(wings, 0.20, "CE") == pytest.approx(11.5)
        assert interp_iv_by_delta(wings, -0.20, "PE") == pytest.approx(18.0)

    @pytest.mark.parametrize("target,side", [(0.05, "CE"), (0.9, "CE"),
                                             (-0.05, "PE"), (-0.9, "PE")])
    def test_no_extrapolation_outside_observed_delta(self, wings, target, side):
        assert interp_iv_by_delta(wings, target, side) is None

    def test_requires_two_points_and_a_known_side(self):
        one = [_point(110, 12.0, 0.25, "CE")]
        assert interp_iv_by_delta(one, 0.25, "CE") is None
        assert interp_iv_by_delta(one, 0.25, "XX") is None
        assert interp_iv_by_delta(one, 0.0, "CE") is None


class TestRr25:
    @pytest.fixture
    def wings(self):
        return [
            _point(105, 14.0, 0.50, "CE"),
            _point(110, 12.0, 0.25, "CE"),
            _point(115, 11.0, 0.15, "CE"),
            _point(95, 16.0, -0.50, "PE"),
            _point(90, 17.0, -0.25, "PE"),
            _point(85, 19.0, -0.15, "PE"),
        ]

    def test_known_call_put_rr_and_fly(self, wings):
        result = rr25(wings)

        assert result["call"] == pytest.approx(12.0)
        assert result["put"] == pytest.approx(17.0)
        # RR = call - put (positive means calls rich); here puts are richer.
        assert result["rr"] == pytest.approx(-5.0)
        # ATM proxy = mean of the two 50-delta reads = (14 + 16)/2 = 15.
        assert result["fly"] == pytest.approx(14.5 - 15.0)

    def test_atm_override_feeds_fly(self, wings):
        assert rr25(wings, atm=14.5)["fly"] == pytest.approx(0.0)

    def test_one_sided_coverage_is_null(self, wings):
        assert rr25([p for p in wings if p["side"] == "CE"]) is None
        assert rr25([p for p in wings if p["side"] == "PE"]) is None

    def test_no_25_delta_coverage_is_null(self):
        far = [_point(105, 14.0, 0.45, "CE"), _point(110, 13.0, 0.40, "CE"),
               _point(95, 16.0, -0.45, "PE"), _point(90, 17.0, -0.40, "PE")]
        assert rr25(far) is None

    def test_empty_is_null(self):
        assert rr25([]) is None


class TestFitSmile:
    @staticmethod
    def _quadratic(strikes, spot, c0=14.0, c1=3.0, c2=2.0):
        return [_point(k, c0 + c1 * math.log(k / spot) + c2 * math.log(k / spot) ** 2,
                       None, "CE", oi=1000) for k in strikes]

    def test_recovers_known_quadratic(self):
        spot = 100.0
        strikes = [80, 85, 90, 95, 100, 105, 110, 115, 120, 125]
        points = self._quadratic(strikes, spot)

        fit = fit_smile(points, spot)

        assert fit is not None
        assert fit["coef"] == pytest.approx([14.0, 3.0, 2.0], abs=1e-6)
        assert fit["r2"] > 0.99
        assert fit["n"] == len(strikes)
        assert fit["domain"]["strike_min"] == 80.0
        assert fit["domain"]["strike_max"] == 125.0
        assert fit["domain"]["x_min"] == pytest.approx(math.log(0.8))
        assert fit["domain"]["x_max"] == pytest.approx(math.log(1.25))

    def test_fewer_than_five_points_is_none(self):
        spots = [90, 95, 100, 105]
        assert fit_smile(self._quadratic(spots, 100.0), 100.0) is None
        assert fit_smile([], 100.0) is None

    def test_oi_weighting_pulls_fit_to_liquid_strikes(self):
        spot = 100.0
        xs = [-0.2, -0.1, 0.0, 0.1, 0.2]
        base = [14.0 + 3.0 * x + 2.0 * x * x for x in xs]
        # The 0.2 leg is a 6-vol artefact on 1 lot of OI; the rest are 10k lots.
        ivs = [v + 6.0 if i == len(xs) - 1 else v for i, v in enumerate(base)]
        points = [_point(spot * math.exp(x), iv, None, "CE",
                         oi=1 if i == len(xs) - 1 else 10_000)
                  for i, (x, iv) in enumerate(zip(xs, ivs))]
        truth = [14.0, 3.0, 2.0]

        weighted = fit_smile(points, spot, weighted=True)
        unweighted = fit_smile(points, spot, weighted=False)

        weighted_error = sum(abs(a - b) for a, b in zip(weighted["coef"], truth))
        unweighted_error = sum(abs(a - b) for a, b in zip(unweighted["coef"], truth))
        # The low-OI artefact still has edge leverage, but OI weighting cuts
        # its distortion by two orders of magnitude versus an equal-weight fit.
        assert weighted_error < 0.2
        assert weighted_error < 0.01 * unweighted_error
        assert unweighted["coef"][2] > 50.0

    def test_missing_oi_falls_back_to_equal_weights(self):
        spot = 100.0
        points = self._quadratic([80, 90, 100, 110, 120], spot)
        for point in points:
            point["oi"] = None

        fit = fit_smile(points, spot, weighted=True)
        assert fit["coef"] == pytest.approx([14.0, 3.0, 2.0], abs=1e-6)

    def test_bad_spot_and_sub_five_valid_points(self):
        points = self._quadratic([80, 90, 100, 110, 120], 100.0)
        points[0]["iv"] = 0.0
        points[1]["iv"] = 117.0

        assert fit_smile(points, 100.0) is None
        assert fit_smile(points, 0.0) is None


class TestSmileMetrics:
    def test_full_fixture(self):
        points = [
            _point(85, 19.0, -0.15, "PE"), _point(90, 17.0, -0.25, "PE"),
            _point(95, 16.0, -0.50, "PE"), _point(105, 14.0, 0.50, "CE"),
            _point(110, 12.0, 0.25, "CE"), _point(115, 11.0, 0.15, "CE"),
        ]
        metrics = smile_metrics(points, spot=100.0)

        assert set(metrics) == {"atm_iv", "rr25", "fly25", "slope_atm", "r2", "n"}
        assert metrics["atm_iv"] == pytest.approx(15.0)   # 16 at 95, 14 at 105
        # Convention: rr25 = call IV - put IV (positive = calls rich); here puts
        # are richer at the 25Δ wings (17 vs 12), so the RR is negative.
        assert metrics["rr25"] == pytest.approx(-5.0)
        assert metrics["fly25"] == pytest.approx(-0.5)
        assert metrics["n"] == 6
        assert metrics["r2"] > 0.0
        assert math.isfinite(metrics["slope_atm"])

    def test_partial_chain_has_null_wings_and_no_fit(self):
        points = [_point(95, 16.0, -0.4, "PE"), _point(105, 14.0, 0.4, "CE")]
        metrics = smile_metrics(points, spot=100.0)

        assert metrics["atm_iv"] == pytest.approx(15.0)
        assert metrics["rr25"] is None
        assert metrics["fly25"] is None
        assert metrics["slope_atm"] is None
        assert metrics["r2"] is None
        assert metrics["n"] == 2

    def test_one_sided_chain_has_no_atm_slope(self):
        points = [_point(110 + 5 * i, 12.0 - i, 0.4 - 0.05 * i, "CE")
                  for i in range(6)]
        metrics = smile_metrics(points, spot=100.0)

        assert metrics["slope_atm"] is None  # x=0 is outside the fitted domain

    def test_no_usable_points_is_none(self):
        assert smile_metrics([], 100.0) is None
        assert smile_metrics([_point(100, 0.0, 0.5, "CE")], 100.0) is None

    def test_atm_override_feeds_fly_but_not_wings(self):
        points = [
            _point(9700, 18.5, -0.20, "PE"),
            _point(9800, 18.0, -0.30, "PE"),
            _point(9900, 17.0, 0.55, "CE"),
            _point(10000, 16.0, 0.50, "CE"),
            _point(10000, 16.4, -0.50, "PE"),
            _point(10100, 15.0, 0.45, "CE"),
            _point(10200, 16.0, 0.30, "CE"),
            _point(10300, 16.5, 0.20, "CE"),
        ]
        base = smile_metrics(points, 10000.0)
        override = smile_metrics(points, 10000.0, atm=18.0)

        assert base["atm_iv"] == pytest.approx(16.2)  # ATM CE/PE average
        assert override["atm_iv"] == pytest.approx(18.0)
        assert override["rr25"] == base["rr25"]  # wings untouched
        assert override["fly25"] == pytest.approx(base["fly25"] - 1.8)


class TestGammaCoverage:
    @staticmethod
    def _gleg(gamma):
        return {"gamma": gamma}

    @pytest.mark.parametrize("with_gamma,expected", [(37, 0.37), (47, 0.47), (98, 0.98)])
    def test_fraction_of_near_atm_legs(self, with_gamma, expected):
        rows = []
        for i in range(50):
            strike = 9800.0 + 8.0 * i  # 9800..10192, all within ±5% of 10000
            ce = self._gleg(0.01) if 2 * i < with_gamma else self._gleg(0.0)
            pe = self._gleg(0.01) if 2 * i + 1 < with_gamma else self._gleg(0.0)
            rows.append(_row(strike, ce=ce, pe=pe))
        assert gamma_coverage(rows, 10000.0) == pytest.approx(expected)

    def test_zero_gamma_is_degraded(self):
        rows = [_row(10000.0, ce=self._gleg(0.0), pe=self._gleg(0.0))]
        assert gamma_coverage(rows, 10000.0) == 0.0

    def test_no_near_atm_legs_is_none(self):
        rows = [_row(5000.0, ce=self._gleg(0.01), pe=self._gleg(0.01))]
        assert gamma_coverage(rows, 10000.0) is None

    def test_invalid_gamma_does_not_count(self):
        rows = [
            _row(10000.0, ce=self._gleg(float("nan")), pe=self._gleg(-0.01)),
            _row(10100.0, ce=self._gleg(None), pe=self._gleg(0.01)),
        ]
        assert gamma_coverage(rows, 10000.0) == pytest.approx(1 / 4)

    def test_band_pct_limits_near_atm(self):
        rows = [
            _row(10000.0, ce=self._gleg(0.01), pe=self._gleg(0.01)),
            _row(10400.0, ce=self._gleg(0.0), pe=self._gleg(0.0)),  # +4%
        ]
        assert gamma_coverage(rows, 10000.0, band_pct=0.02) == pytest.approx(1.0)
        assert gamma_coverage(rows, 10000.0, band_pct=0.05) == pytest.approx(0.5)

    def test_bad_spot_is_none(self):
        assert gamma_coverage([_row(10000.0, ce=self._gleg(0.01))], 0.0) is None


class TestFilterQuality:
    def test_counts_used_dropped_and_max(self):
        points = [
            _point(100, 14.0, 0.5, "CE"),
            _point(105, 60.0, 0.4, "CE"),
            _point(110, 0.0, 0.3, "CE"),      # dropped_iv
            _point(115, 117.0, 0.2, "CE"),    # dropped_iv (wing artefact)
            _point(120, 13.0, float("nan"), "CE"),  # dropped_delta
            _point(125, 12.0, None, "CE"),    # dropped_delta
        ]
        assert filter_quality(points) == {
            "used": 2,
            "dropped_iv": 2,
            "dropped_delta": 2,
            "max_iv": 60.0,
        }

    def test_empty_and_bad_iv_takes_precedence(self):
        assert filter_quality([]) == {
            "used": 0, "dropped_iv": 0, "dropped_delta": 0, "max_iv": None
        }
        assert filter_quality([_point(100, None, None, "CE")])["dropped_iv"] == 1


class TestUnits:
    def test_percent_input_is_never_rescaled(self):
        points = [_point(100, 0.14, 0.5, "CE"), _point(110, 0.12, 0.4, "CE")]

        assert atm_iv(points, 105.0) == pytest.approx(0.13)  # not 13.0
        assert valid_leg(_leg(iv=0.14)) is True              # a 0.14% print
        assert _iv_value(points[0]) == pytest.approx(0.14)

    def test_wing_artefact_is_rejected_but_small_print_survives(self):
        assert valid_leg(_leg(iv=117.0)) is False
        assert valid_leg(_leg(iv=1.17)) is True
        assert iv_source(_leg(iv=117.0)) == "invalid"
        assert iv_source(_leg(iv=1.17)) == "upstox"


def _iv_value(point):
    """Small local accessor so the unit test reads a stored IV verbatim."""
    return point["iv"]
