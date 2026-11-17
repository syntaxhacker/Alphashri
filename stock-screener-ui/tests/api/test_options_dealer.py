"""Unit tests for the pure dealer-hedging analytics in api/options_dealer.py.

Covers the exposed contract: GEX parity with the shared level formula, DEX
side signs, closed-form vanna/charm, OI-weighted theta + DTE curve, the
cumulative-GEX zero crossing, and strict null/no-NaN behaviour on partial
chains.
"""
from __future__ import annotations

import math

import pytest

from api.options_dealer import dealer_block
from api.options_levels import compute_gex, normalize_strikes

SPOT = 23_000.0
DTE = 0.25  # ~3 months


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _leg(oi, delta, gamma, theta, vega, iv, iv_valid=True):
    return {
        "market_data": {"oi": oi, "ltp": 150.0},
        "option_greeks": {
            "delta": delta, "gamma": gamma, "theta": theta,
            "vega": vega, "iv": iv, "iv_valid": iv_valid,
        },
        "iv_valid": iv_valid,
    }


def _atm_chain():
    """Five strikes around SPOT, symmetric CE/PE deltas and OI."""
    strikes = [22_800, 22_900, 23_000, 23_100, 23_200]
    ce_delta = [0.70, 0.60, 0.50, 0.40, 0.30]
    pe_delta = [-0.30, -0.40, -0.50, -0.60, -0.70]
    rows = []
    for k, strike in enumerate(strikes):
        rows.append({
            "strike": float(strike),
            "ce": _leg(1_000_000, ce_delta[k], 0.0012, -45.0, 320.0, 18.0),
            "pe": _leg(1_000_000, pe_delta[k], 0.0012, -45.0, 320.0, 18.0),
        })
    return rows


def _gex_row(strike, g_ce, oi_ce, g_pe, oi_pe):
    return {"strike": float(strike), "ce": {"gamma": g_ce, "oi": oi_ce},
            "pe": {"gamma": g_pe, "oi": oi_pe}}


def _assert_clean(obj):
    """Every number in the payload is finite; missing values are None."""
    if isinstance(obj, dict):
        for value in obj.values():
            _assert_clean(value)
    elif isinstance(obj, (list, tuple)):
        for value in obj:
            _assert_clean(value)
    elif isinstance(obj, float):
        assert math.isfinite(obj), f"non-finite value leaked: {obj!r}"


REQUIRED_KEYS = {
    "strikes", "netGex", "netDex", "vanna", "charm", "theta",
    "zeroGamma", "gammaFlip", "thetaByDte", "warnings",
}


# ---------------------------------------------------------------------------
# Contract / synthetic ATM chain
# ---------------------------------------------------------------------------

class TestAtmChain:
    def test_contract_shape_and_clean_numbers(self):
        out = dealer_block(_atm_chain(), SPOT, DTE)
        assert set(out) == REQUIRED_KEYS
        assert len(out["strikes"]) == 5
        assert set(out["strikes"][0]) == {
            "strike", "netGex", "netDex", "vanna", "charm", "theta",
            "ceOi", "peOi", "ceIv", "peIv",
        }
        assert out["warnings"] == []
        _assert_clean(out)

    def test_aggregates_are_finite_and_directional(self):
        out = dealer_block(_atm_chain(), SPOT, DTE)
        for key in ("netGex", "netDex", "vanna", "charm", "theta"):
            assert isinstance(out[key], float), key
        # Symmetric chain: calls/puts cancel in delta.
        assert abs(out["netDex"]) < 1e-9
        # Short dated theta is negative; vanna at ATM is positive.
        assert out["theta"] < 0
        assert out["vanna"] > 0

    def test_theta_by_dte_curve_accelerates_into_expiry(self):
        out = dealer_block(_atm_chain(), SPOT, DTE)
        curve = out["thetaByDte"]
        assert [p["dteDays"] for p in curve] == [1, 3, 7, 14, 30]
        vals = [p["theta"] for p in curve]
        assert all(v is not None for v in vals)
        assert all(v < 0 for v in vals)
        assert abs(vals[0]) > abs(vals[-1])


# ---------------------------------------------------------------------------
# GEX parity with the shared formula
# ---------------------------------------------------------------------------

class TestGexParity:
    def test_aggregate_and_per_strike_gex_match_shared_helper(self):
        rows = _atm_chain()
        out = dealer_block(rows, SPOT, DTE)
        shared = compute_gex(normalize_strikes(rows), SPOT)
        assert out["netGex"] == shared["net_total"]
        assert [s["netGex"] for s in out["strikes"]] == \
            [e["net_gex"] for e in shared["strikes"]]

    def test_gex_parity_holds_when_greeks_are_absent(self):
        rows = [_gex_row(22_800, 0, 1_000_000, 0, 0),
                _gex_row(23_000, 0, 0, 0, 1_000_000)]
        out = dealer_block(rows, SPOT, DTE)
        shared = compute_gex(normalize_strikes(rows), SPOT)
        assert out["netGex"] == shared["net_total"]
        assert shared["degraded"] is True
        assert "gex_degraded" in out["warnings"]


# ---------------------------------------------------------------------------
# DEX signs
# ---------------------------------------------------------------------------

class TestDexSigns:
    def test_call_only_chain_is_positive_delta_exposure(self):
        rows = []
        for k, strike in enumerate([22_800, 22_900, 23_000]):
            ce = _leg(1_000_000, 0.6, 0.001, -40.0, 300.0, 18.0)
            pe = _leg(0, -0.4, 0.001, -40.0, 300.0, 18.0)
            rows.append({"strike": float(strike), "ce": ce, "pe": pe})
        out = dealer_block(rows, SPOT, DTE)
        assert out["netDex"] > 0
        assert all(s["netDex"] > 0 for s in out["strikes"])

    def test_put_only_chain_is_negative_delta_exposure(self):
        rows = []
        for strike in [22_800, 22_900, 23_000]:
            ce = _leg(0, 0.6, 0.001, -40.0, 300.0, 18.0)
            pe = _leg(1_000_000, -0.4, 0.001, -40.0, 300.0, 18.0)
            rows.append({"strike": float(strike), "ce": ce, "pe": pe})
        out = dealer_block(rows, SPOT, DTE)
        assert out["netDex"] < 0
        assert all(s["netDex"] < 0 for s in out["strikes"])

    def test_put_delta_sign_does_not_flip_the_side_convention(self):
        """A put's negative vendor delta must still contribute negative DEX."""
        row = {"strike": 23_000.0,
               "ce": _leg(0, 0.9, 0.001, -1.0, 1.0, 18.0),
               "pe": _leg(10_000, -0.9, 0.001, -1.0, 1.0, 18.0)}
        out = dealer_block([row], SPOT, DTE)
        assert out["strikes"][0]["netDex"] < 0


# ---------------------------------------------------------------------------
# Missing greeks / IV -> null, never 0-fill
# ---------------------------------------------------------------------------

class TestMissingData:
    def test_missing_delta_nulls_only_that_strikes_dex(self):
        rows = _atm_chain()
        bad = rows[2]["pe"]["option_greeks"]
        bad["delta"] = None
        out = dealer_block(rows, SPOT, DTE)
        assert out["strikes"][2]["netDex"] is None
        assert out["strikes"][0]["netDex"] is not None
        assert out["netDex"] is not None
        assert "missing_delta" in out["warnings"]

    @pytest.mark.parametrize("bad_iv", [None, 0, float("nan"), float("inf"), 117.0])
    def test_bad_iv_nulls_vanna_and_charm(self, bad_iv):
        rows = _atm_chain()
        rows[1]["ce"]["option_greeks"]["iv"] = bad_iv
        out = dealer_block(rows, SPOT, DTE)
        assert out["strikes"][1]["vanna"] is None
        assert out["strikes"][1]["charm"] is None
        assert out["strikes"][0]["vanna"] is not None
        assert "missing_iv" in out["warnings"]
        _assert_clean(out)

    def test_missing_theta_nulls_only_that_strikes_theta(self):
        rows = _atm_chain()
        rows[3]["ce"]["option_greeks"]["theta"] = "n/a"
        out = dealer_block(rows, SPOT, DTE)
        assert out["strikes"][3]["theta"] is None
        assert out["theta"] is not None
        assert "missing_theta" in out["warnings"]

    def test_no_greeks_anywhere_gives_null_exposures_but_clean_shape(self):
        rows = [{"strike": float(s), "ce": {"oi": 1_000_000},
                 "pe": {"oi": 1_000_000}} for s in (22_800, 22_900, 23_000, 23_100, 23_200)]
        out = dealer_block(rows, SPOT, DTE)
        for key in ("netDex", "vanna", "charm", "theta"):
            assert out[key] is None, key
        assert out["netGex"] is not None  # shared OI-only proxy
        assert {"missing_delta", "missing_iv", "missing_theta",
                "gex_degraded", "partial_chain"} <= set(out["warnings"])
        assert all(p["theta"] is None for p in out["thetaByDte"])
        _assert_clean(out)

    def test_empty_chain_warns_and_never_raises(self):
        out = dealer_block([], SPOT, DTE)
        assert "empty_chain" in out["warnings"]
        assert out["strikes"] == []
        assert all(out[k] is None for k in
                   ("netGex", "netDex", "vanna", "charm", "theta", "zeroGamma"))
        assert out["gammaFlip"] == {"level": None, "regime": "flat", "flipped": False}
        assert all(p["theta"] is None for p in out["thetaByDte"])
        _assert_clean(out)

    def test_invalid_dte_and_spot_are_non_fatal(self):
        out = dealer_block(_atm_chain(), 0.0, 0.0)
        assert "invalid_dte" in out["warnings"]
        assert "invalid_spot" in out["warnings"]
        assert out["vanna"] is None and out["charm"] is None
        assert out["netDex"] is None
        assert out["netGex"] is not None
        _assert_clean(out)


# ---------------------------------------------------------------------------
# Zero gamma / gamma flip crossing
# ---------------------------------------------------------------------------

class TestZeroGamma:
    def test_crossing_from_cumulative_gex_series(self):
        rows = [_gex_row(22_800, 0, 0, 0.001, 4_000_000),
                _gex_row(23_000, 0, 0, 0.001, 2_000_000),
                _gex_row(23_400, 0.001, 10_000_000, 0, 0)]
        out = dealer_block(rows, 22_962.6, DTE)
        assert out["zeroGamma"] == 23_400.0
        assert out["gammaFlip"] == {
            "level": 23_400.0, "regime": "short", "flipped": True,
        }

    def test_no_crossing_gives_null_level_and_no_flip(self):
        rows = _atm_chain()
        out = dealer_block(rows, SPOT, DTE)
        shared = compute_gex(normalize_strikes(rows), SPOT)
        assert out["zeroGamma"] == shared["zero_cross"]
        assert out["gammaFlip"]["level"] == shared["zero_cross"]
        if out["zeroGamma"] is None:
            assert out["gammaFlip"]["flipped"] is False


# ---------------------------------------------------------------------------
# No NaN / Inf leaks from malformed input
# ---------------------------------------------------------------------------

class TestNoNanInf:
    def test_junk_rows_and_values_are_sanitised(self):
        rows = [
            None,
            "junk",
            {"strike": float("nan"),
             "ce": _leg(float("inf"), "bad", float("nan"), None, 0, "n/a"),
             "pe": None},
            {"strike": 23_000.0,
             "ce": _leg(1_000_000, float("nan"), float("inf"), "x", 0, float("inf")),
             "pe": _leg(900_000, -0.5, 0.001, -40.0, 300.0, 18.0)},
        ]
        out = dealer_block(rows, SPOT, DTE)
        assert len(out["strikes"]) == 2
        _assert_clean(out)
        assert out["strikes"][0]["netDex"] is None
        assert out["strikes"][0]["vanna"] is None
        assert out["strikes"][0]["theta"] is None

    def test_terse_shape_is_accepted(self):
        rows = [
            {"strike": s, "ce_oi": 100_000, "pe_oi": 90_000,
             "ce_delta": d, "pe_delta": -d, "ce_gamma": 0.001,
             "pe_gamma": 0.001, "ce_theta": -40.0, "pe_theta": -40.0,
             "ce_iv": 18.0, "pe_iv": 18.0}
            for s, d in zip([22_800, 23_000, 23_200], [0.6, 0.5, 0.4])
        ]
        out = dealer_block(rows, SPOT, DTE)
        assert len(out["strikes"]) == 3
        assert all(s["netDex"] is not None for s in out["strikes"])
        assert all(s["vanna"] is not None for s in out["strikes"])
        _assert_clean(out)

    @pytest.mark.parametrize("dte", [float("nan"), float("inf"), -1.0, None])
    def test_bad_dte_never_leaks_nan(self, dte):
        out = dealer_block(_atm_chain(), SPOT, dte)
        assert "invalid_dte" in out["warnings"]
        _assert_clean(out)


# ---------------------------------------------------------------------------
# Vanna/charm units — real chains carry IV in vol points
# ---------------------------------------------------------------------------

class TestVolPointIvUnits:
    def test_vol_point_iv_yields_material_vanna_and_charm(self):
        """A normal chain (IV in vol points) must not collapse vanna/charm to ~0.

        Upstox prints IV as 18.0 for 18%; the closed-form BS greeks need 0.18.
        Feeding 18.0 directly pushed d1/d2 into the tails and flattened the
        curve to <=1e-6, which renders as an empty chart.
        """
        out = dealer_block(_atm_chain(), SPOT, DTE)
        assert isinstance(out["vanna"], float) and math.isfinite(out["vanna"])
        assert isinstance(out["charm"], float) and math.isfinite(out["charm"])

        vanna = [s["vanna"] for s in out["strikes"]]
        charm = [s["charm"] for s in out["strikes"]]
        assert all(v is not None for v in vanna)
        assert all(c is not None for c in charm)
        assert max(abs(v) for v in vanna) > 1e-2
        assert max(abs(c) for c in charm) > 1e-5
        assert abs(out["vanna"]) > 1e-2
        _assert_clean(out)

    def test_zero_dte_uses_positive_time_floor(self):
        """0-DTE (dte_years=None) still produces a non-empty profile."""
        out = dealer_block(_atm_chain(), SPOT, 0.0)
        assert "invalid_dte" in out["warnings"]
        assert isinstance(out["vanna"], float) and math.isfinite(out["vanna"])
        assert isinstance(out["charm"], float) and math.isfinite(out["charm"])
        assert all(s["vanna"] is not None for s in out["strikes"])
        assert all(s["charm"] is not None for s in out["strikes"])
        _assert_clean(out)

    def test_theta_by_dte_uses_vol_point_iv_units(self):
        """The re-priced curve needs decimal IV too, not raw vol points."""
        out = dealer_block(_atm_chain(), SPOT, DTE)
        curve = out["thetaByDte"]
        vals = [p["theta"] for p in curve]
        assert all(v is not None and math.isfinite(v) for v in vals)
        assert all(v < 0 for v in vals)
        # Raw vol-point sigma flattened every point to ~0.
        assert max(abs(v) for v in vals) > 1.0
        assert abs(vals[0]) > abs(vals[-1])
        _assert_clean(out)

    def test_theta_by_dte_zero_dte_still_yields_values(self):
        """The fixed DTE grid produces a curve even for a 0-DTE chain."""
        out = dealer_block(_atm_chain(), SPOT, 0.0)
        curve = out["thetaByDte"]
        assert [p["dteDays"] for p in curve] == [1, 3, 7, 14, 30]
        assert all(p["theta"] is not None and math.isfinite(p["theta"]) for p in curve)
        assert max(abs(p["theta"]) for p in curve) > 1.0
        _assert_clean(out)
