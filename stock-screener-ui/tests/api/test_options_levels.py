"""Unit tests for the pure api/options_levels.py module.

The GEX cases are ported verbatim from ``tests/test_reports_nifty.py`` and run
against BOTH the shared function and the Nifty wrapper — divergence in the
constants, gates or formula fails the anti-drift assertion.
"""

import time

import pytest

import api.options_levels as levels
import api.reports_api.nifty as nifty
from api.options_levels import (
    build_levels,
    compute_gex,
    compute_max_pain,
    infer_step,
    is_thin,
    near_walls,
    normalize_strikes,
    top_walls,
)


def _gex_row(strike, g_ce, oi_ce, g_pe, oi_pe):
    return {"strike": float(strike), "ce": {"gamma": g_ce, "oi": oi_ce},
            "pe": {"gamma": g_pe, "oi": oi_pe}}


def _terse(strike, ce_oi=1_000_000, pe_oi=1_000_000, gamma=0.001):
    return {"strike": float(strike), "ce_oi": ce_oi, "pe_oi": pe_oi,
            "ce_gamma": gamma, "pe_gamma": gamma}



class TestNormalizeStrikes:
    def test_all_three_shapes_are_identical(self):
        strike = 23000.0
        nested = {"strike": strike,
                  "ce": {"market_data": {"oi": 1000, "ltp": 100.0},
                         "option_greeks": {"gamma": 0.001, "delta": 0.4}},
                  "pe": {"market_data": {"oi": 2000},
                         "option_greeks": {"gamma": 0.002}}}
        flat = {"strike": strike, "ce": {"oi": 1000, "gamma": 0.001},
                "pe": {"oi": 2000, "gamma": 0.002}}
        terse = {"strike": strike, "ce_oi": 1000, "pe_oi": 2000,
                 "ce_gamma": 0.001, "pe_gamma": 0.002}
        expected = [{"strike": strike, "ce_oi": 1000, "pe_oi": 2000,
                     "ce_gamma": 0.001, "pe_gamma": 0.002}]
        for row in (nested, flat, terse):
            assert normalize_strikes([row]) == expected

    def test_sorted_and_tolerant_of_bad_rows(self):
        rows = [{"strike": 23100.0, "ce_oi": 5, "pe_oi": 7},
                None, "junk",
                {"strike": 22900.0, "ce": None, "pe": None},
                {"strike": "bad", "ce_oi": 1}]
        out = normalize_strikes(rows)
        assert [r["strike"] for r in out] == [0.0, 22900.0, 23100.0]
        assert out[1]["ce_oi"] == 0 and out[1]["pe_gamma"] == 0.0

    def test_empty_input(self):
        assert normalize_strikes([]) == []
        assert normalize_strikes(None) == []



class TestMaxPain:
    def test_brute_force_fixture(self):
        rows = [{"strike": 100.0, "ce_oi": 10, "pe_oi": 0},
                {"strike": 110.0, "ce_oi": 0, "pe_oi": 0},
                {"strike": 120.0, "ce_oi": 0, "pe_oi": 1}]
        # loss(100) = 20 * 1 = 20; loss(110) = 100 + 10 = 110; loss(120) = 200
        assert compute_max_pain(normalize_strikes(rows)) == 100.0

    def test_tie_resolves_to_lowest_strike(self):
        rows = [{"strike": 100.0, "ce_oi": 10, "pe_oi": 0},
                {"strike": 200.0, "ce_oi": 0, "pe_oi": 10}]
        # Both candidates pay out exactly 1000; the lower strike wins.
        assert compute_max_pain(normalize_strikes(rows)) == 100.0

    def test_no_oi_is_none_not_zero(self):
        rows = [{"strike": 100.0, "ce_oi": 0, "pe_oi": 0},
                {"strike": 200.0, "ce_oi": 0, "pe_oi": 0}]
        assert compute_max_pain(normalize_strikes(rows)) is None
        assert compute_max_pain([]) is None

    @pytest.mark.parametrize("rows", [
        [{"strike": 100.0, "ce_oi": 10, "pe_oi": 0},
         {"strike": 110.0, "ce_oi": 0, "pe_oi": 0},
         {"strike": 120.0, "ce_oi": 0, "pe_oi": 1}],
        [{"strike": 100.0, "ce_oi": 10, "pe_oi": 0},
         {"strike": 200.0, "ce_oi": 0, "pe_oi": 10}],
        [_terse(22000), _terse(22500), _terse(23000), _terse(23500)],
    ])
    def test_agrees_with_nifty_wrapper(self, rows):
        # nifty.compute_max_pain reads the same ce_oi/pe_oi keys we normalize to.
        ours = compute_max_pain(normalize_strikes(rows))
        assert ours == nifty.compute_max_pain(rows)



def _case_support_resistance_fuel():
    rows = [_gex_row(22500, 0, 0, 0.002, 1_000_000),
            _gex_row(22900, 0.0005, 500_000, 0, 0),
            _gex_row(23000, 0, 0, 0.001, 300_000),
            _gex_row(23200, 0.001, 1_000_000, 0, 0)]

    def check(out):
        lv = out["levels"]
        assert (lv["support"]["strike"], lv["support"]["side"]) == (22900.0, "below")
        assert (lv["resistance"]["strike"], lv["resistance"]["side"]) == (23200.0, "above")
        assert (lv["fuel_down"]["strike"], lv["fuel_down"]["side"]) == (22500.0, "below")
        assert (lv["fuel_up"]["strike"], lv["fuel_up"]["side"]) == (23000.0, "above")

    return rows, 22950.0, check


def _case_fuel_never_a_level():
    rows = [_gex_row(22700, 0, 0, 0.0007, 7_642_505),
            _gex_row(22900, 0.0009, 5_281_900, 0.0009, 7_035_535),
            _gex_row(23200, 0.0008, 10_091_705, 0.0008, 2_929_225)]

    def check(out):
        lv = out["levels"]
        assert lv["support"] is None
        assert lv["fuel_down"]["strike"] == 22700.0
        assert lv["resistance"]["strike"] == 23200.0

    return rows, 22950.0, check


def _case_below_min_share_is_null():
    rows = [_gex_row(22500, 0.0003, 101_600, 0, 0),
            _gex_row(23200, 0.001, 6_597_700, 0, 0),
            _gex_row(23500, 0.001, 5_221_600, 0, 0),
            _gex_row(24700, 0, 0, 0.0002, 87_100)]

    def check(out):
        assert out["levels"]["support"] is None
        assert out["levels"]["fuel_up"] is None
        assert out["levels"]["resistance"]["strike"] == 23200.0

    return rows, 22962.6, check


def _case_beyond_five_pct_is_null():
    rows = [_gex_row(21000, 0.001, 2_177_400, 0, 0),
            _gex_row(23200, 0.001, 6_597_700, 0, 0)]

    def check(out):
        assert out["levels"]["support"] is None
        near = rows + [_gex_row(22700, 0.001, 870_960, 0, 0)]
        assert compute_gex(normalize_strikes(near), 22962.6)["levels"]["support"]["strike"] == 22700.0

    return rows, 22962.6, check


def _case_flip_null_far_wing():
    rows = [_gex_row(20000, 0, 0, 0.002, 1_000_000),
            _gex_row(21500, 0.002, 1_000_000, 0, 0),
            _gex_row(23000, 0.001, 1_000_000, 0, 0)]

    def check(out):
        assert out["net_total"] > 0
        assert out["zero_cross"] is None

    return rows, 22950.0, check


def _case_regime_follows_cumulative_at_spot():
    rows = [_gex_row(22800, 0, 0, 0.001, 4_000_000),
            _gex_row(23000, 0, 0, 0.001, 2_000_000),
            _gex_row(23400, 0.001, 10_000_000, 0, 0)]

    def check(out):
        assert out["net_total"] > 0
        assert out["zero_cross"] == 23400.0
        assert out["regime"] == "short"
        above = compute_gex(normalize_strikes(rows), 23_500.0)
        assert above["zero_cross"] == 23400.0
        assert above["regime"] == "long"
        assert nifty.compute_gex(rows, 23_500.0) == above

    return rows, 22962.6, check


GEX_CASES = [
    pytest.param(*_case_support_resistance_fuel(), id="support-resistance-fuel"),
    pytest.param(*_case_fuel_never_a_level(), id="fuel-never-a-level"),
    pytest.param(*_case_below_min_share_is_null(), id="below-10pct-null"),
    pytest.param(*_case_beyond_five_pct_is_null(), id="beyond-5pct-null"),
    pytest.param(*_case_flip_null_far_wing(), id="flip-null-far-wing"),
    pytest.param(*_case_regime_follows_cumulative_at_spot(), id="regime"),
]


class TestGexAntiDrift:
    @pytest.mark.parametrize("rows,spot,check", GEX_CASES)
    def test_shared_matches_nifty_wrapper(self, rows, spot, check):
        ours = compute_gex(normalize_strikes(rows), spot)
        theirs = nifty.compute_gex(rows, spot)
        assert ours == theirs
        check(ours)

    def test_degraded_gamma_matches_nifty_and_is_flagged(self):
        rows = [{"strike": 100.0, "ce": {"oi": 10_000_000, "gamma": 0},
                 "pe": {"oi": 4_000_000, "gamma": 0}},
                {"strike": 200.0, "ce": {"oi": 2_000_000, "gamma": 0},
                 "pe": {"oi": 9_000_000, "gamma": 0}}]
        ours = compute_gex(normalize_strikes(rows), 10_000.0)
        assert ours == nifty.compute_gex(rows, 10_000.0)
        assert ours["degraded"] is True
        assert ours["regime"] == "short"
        assert ours["zero_cross"] is None

    def test_missing_spot_uses_median_strike_scale(self):
        rows = [_gex_row(100, 0.01, 10_000_000, 0, 0),
                _gex_row(200, 0.01, 10_000_000, 0, 0)]
        ours = compute_gex(normalize_strikes(rows), 0.0)
        assert ours == nifty.compute_gex(rows, 0.0)
        assert ours["net_total"] == 4.0
        assert ours["regime"] == "long"



class TestNullRules:
    def test_empty_chain(self):
        out = build_levels([], 22962.6)
        assert out["thin"] is True
        assert out["step"] is None
        assert out["call_wall"] is None and out["put_wall"] is None
        assert out["call_walls"] == [] and out["put_walls"] == []
        assert out["max_pain"] is None
        assert out["gex"] == {
            "support": None, "resistance": None, "fuel_down": None,
            "fuel_up": None, "flip": None, "regime": "flat", "degraded": True,
        }

    def test_zero_oi_chain(self):
        rows = [{"strike": s, "ce_oi": 0, "pe_oi": 0}
                for s in (22900, 22950, 23000, 23050, 23100)]
        out = build_levels(rows, 22962.6)
        assert out["thin"] is True
        assert out["max_pain"] is None
        assert out["call_wall"] is None and out["put_wall"] is None
        assert out["gex"]["degraded"] is True
        assert out["gex"]["regime"] == "flat"
        assert all(out["gex"][k] is None for k in
                   ("support", "resistance", "fuel_down", "fuel_up", "flip"))

    def test_thin_chain(self):
        strikes = list(range(22000, 22250, 50))  # 5 rows
        # Total OI < 50k is thin even with 5 rows.
        assert is_thin(normalize_strikes([_terse(s, 4_000, 4_000)
                                          for s in strikes])) is True
        assert is_thin(normalize_strikes([_terse(s, 100_000, 100_000)
                                          for s in strikes])) is False
        # One leg at a single strike dominating >40% of total OI is thin.
        rows = [_terse(strikes[0], 1_000_000, 1_000)] + \
               [_terse(s, 1_000, 1_000) for s in strikes[1:]]
        assert is_thin(normalize_strikes(rows)) is True

    def test_degraded_gamma_nulls_gex_only(self):
        rows = [_terse(s, 1_000_000, 1_000_000, gamma=0)
                for s in range(22000, 22250, 50)]
        out = build_levels(rows, 22020.0)
        assert out["gex"]["degraded"] is True
        assert all(out["gex"][k] is None for k in
                   ("support", "resistance", "fuel_down", "fuel_up", "flip"))
        assert out["call_wall"] is not None
        assert out["max_pain"] is not None

    def test_one_sided_oi_nulls_only_the_empty_leg(self):
        rows = [_terse(s, 1_000_000, 0) for s in range(22000, 22250, 50)]
        out = build_levels(rows, 22020.0)
        assert out["call_wall"] is not None
        assert out["put_wall"] is None
        assert out["put_walls"] == []
        assert out["call_walls"]

    def test_invalid_spot_does_not_crash_and_sides_are_null(self):
        rows = [_terse(s) for s in range(22000, 22250, 50)]
        out = build_levels(rows, 0.0)
        assert out["spot"] == 0.0
        for wall in (out["call_wall"], out["put_wall"], out["max_pain"]):
            if wall is not None:
                assert wall["side"] is None
        for key in ("support", "resistance", "fuel_down", "fuel_up"):
            lvl = out["gex"][key]
            if lvl is not None:
                assert lvl["side"] is None



class TestLevelsHelpers:
    @pytest.mark.parametrize("step", [2.5, 50.0])
    def test_infer_step(self, step):
        rows = [{"strike": 22000.0 + i * step} for i in range(8)]
        assert infer_step(normalize_strikes(rows)) == step

    def test_infer_step_median_fallback(self):
        rows = [{"strike": 100.0}, {"strike": 110.0}, {"strike": 130.0}]
        assert infer_step(normalize_strikes(rows)) == 15.0
        assert infer_step([]) is None

    def test_side_uses_unrounded_float_spot(self):
        strikes = normalize_strikes([
            {"strike": 22950.0, "ce_oi": 1000},
            {"strike": 23000.0, "ce_oi": 2000},
        ])
        walls = top_walls(strikes, "ce", 22962.6)
        assert walls[0]["strike"] == 23000.0 and walls[0]["side"] == "above"
        assert walls[1]["strike"] == 22950.0 and walls[1]["side"] == "below"

    def test_near_walls_uses_one_pct_band_with_global_fallback(self):
        strikes = normalize_strikes([
            {"strike": 22000.0, "ce_oi": 9000},
            {"strike": 22950.0, "ce_oi": 2000},
        ])
        # 22000 is >1% from 22962.6, so only 22950 is in band.
        assert [w["strike"] for w in near_walls(strikes, "ce", 22962.6)] == [22950.0]
        # No strike inside the band -> global top-1 fallback.
        far = normalize_strikes([{"strike": 20000.0, "ce_oi": 9000}])
        assert [w["strike"] for w in near_walls(far, "ce", 22962.6)] == [20000.0]

    def test_strengths_are_within_unit_interval(self):
        rows = [_terse(s, 1_000_000 + i * 1000, 900_000 + i * 500)
                for i, s in enumerate(range(22000, 22250, 50))]
        out = build_levels(rows, 22020.0)
        vals = []
        for obj in (out["call_wall"], out["put_wall"], out["max_pain"]):
            if obj is not None:
                vals.append(obj["strength"])
        for key in ("support", "resistance", "fuel_down", "fuel_up"):
            obj = out["gex"][key]
            if obj is not None:
                vals.append(obj["strength"])
        assert vals
        assert all(v is not None and 0.0 <= v <= 1.0 for v in vals)

    def test_build_levels_shape_and_keys(self):
        rows = [_terse(s) for s in range(22000, 22250, 50)]
        out = build_levels(rows, 22020.0)
        assert set(out) == {"spot", "step", "thin", "call_wall", "put_wall",
                            "call_walls", "put_walls", "max_pain", "gex"}
        assert set(out["gex"]) == {"support", "resistance", "fuel_down",
                                   "fuel_up", "flip", "regime", "degraded"}
        for wall in (out["call_wall"], out["put_wall"]):
            if wall is not None:
                assert set(wall) == {"strike", "side", "strength", "oi"}
        if out["max_pain"] is not None:
            assert set(out["max_pain"]) == {"strike", "side", "strength", "payout"}
        for key in ("support", "resistance", "fuel_down", "fuel_up"):
            lvl = out["gex"][key]
            if lvl is not None:
                assert set(lvl) == {"strike", "side", "strength", "net_gex"}
        assert len(out["call_walls"]) <= 3 and len(out["put_walls"]) <= 3

    def test_build_levels_perf_smoke(self):
        rows = [_terse(22000 + i * 50, 100_000 + i * 100, 90_000 + i * 50)
                for i in range(100)]
        start = time.perf_counter()
        out = build_levels(rows, 22962.6)
        elapsed = time.perf_counter() - start
        assert out["spot"] == 22962.6
        assert elapsed < 0.05, f"build_levels took {elapsed:.3f}s for 100 rows"
