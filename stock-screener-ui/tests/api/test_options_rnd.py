"""Pure tests for :mod:`api.options_rnd` — no network, DB, FastAPI or fixtures.

The sanity cases are built from Black-Scholes prices/IVs so every expected
property (positive density, CDF -> 1, mean near the forward) can be checked
without trusting the engine's own arithmetic.
"""

import math

import pytest

from api.options_rnd import _extract_records, _leg_price, pdf_from_smile, risk_neutral_density

REQUIRED_KEYS = {
    "strikes", "density", "cdf", "mean", "forward", "warnings",
    "negative_density_pct",
}


def _ndtr(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _bs(S, K, T, r, sig):
    """Black-Scholes (call, put) with q=0, ``sig`` a decimal fraction."""
    if T <= 0.0:
        return max(S - K, 0.0), max(K - S, 0.0)
    v = sig * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sig * sig) * T) / v
    d2 = d1 - v
    disc = math.exp(-r * T)
    call = S * _ndtr(d1) - K * disc * _ndtr(d2)
    put = K * disc * _ndtr(-d2) - S * _ndtr(-d1)
    return call, put


def _lognormal_zs(n=41, lo=-0.35, hi=0.35):
    step = (hi - lo) / (n - 1)
    return [lo + i * step for i in range(n)]


def _chain(S=100.0, T=30 / 365.0, r=0.0, sig=0.20, zs=None):
    """Chain rows carrying both a traded price and an IV at every strike."""
    zs = _lognormal_zs() if zs is None else zs
    rows = []
    for z in zs:
        K = S * math.exp(z)
        call, put = _bs(S, K, T, r, sig)
        rows.append({
            "strike": K,
            "ce": {"ltp": call, "iv": sig * 100.0, "delta": 0.5},
            "pe": {"ltp": put, "iv": sig * 100.0, "delta": -0.5},
        })
    return rows


def _flat_iv_points(S=100.0, sig=20.0, zs=None):
    """Flat IvPoint records with IV but no price at all."""
    zs = _lognormal_zs() if zs is None else zs
    pts = []
    for z in zs:
        K = S * math.exp(z)
        pts.append({"strike": K, "side": "CE" if z >= 0 else "PE", "iv": sig})
    return pts


def _assert_well_formed(out):
    assert REQUIRED_KEYS <= set(out)
    assert len(out["strikes"]) == len(out["density"]) == len(out["cdf"])
    assert all(math.isfinite(x) for x in out["density"]), "non-finite density"
    assert all(math.isfinite(x) for x in out["cdf"]), "non-finite CDF"
    assert all(math.isfinite(x) for x in out["strikes"]), "non-finite strikes"
    assert all(v >= 0.0 for v in out["density"]), "negative density leaked"
    assert 0.0 <= out["negative_density_pct"] <= 1.0


class TestLegPriceGuard:
    """A nested ``market_data.ltp`` of zero is no more tradable than a flat one."""

    @pytest.mark.parametrize("ltp", [0, 0.0, -1.0, None, float("nan"), float("inf")])
    def test_nested_non_positive_ltp_is_rejected(self, ltp):
        assert _leg_price({"market_data": {"ltp": ltp}}) is None

    def test_nested_positive_ltp_is_accepted(self):
        assert _leg_price({"market_data": {"ltp": 12.5}}) == pytest.approx(12.5)

    @pytest.mark.parametrize("key", ["ltp", "price", "last_price"])
    def test_flat_branch_guard_is_unchanged(self, key):
        assert _leg_price({key: 0.0}) is None
        assert _leg_price({key: 7.0}) == pytest.approx(7.0)

    def test_nested_zero_ltp_does_not_become_a_priced_record(self):
        rows = [{"strike": 100.0, "ce": {"market_data": {"ltp": 0.0}}, "pe": None}]
        rec = _extract_records(rows, 100.0, 0.1, 0.0)[0]
        assert rec["call_price"] is None


class TestContract:
    def test_keys_and_well_formed_on_clean_chain(self):
        out = risk_neutral_density(_chain(), spot=100.0, expiry_dte=30)
        _assert_well_formed(out)

    def test_invalid_spot_and_expiry_return_empty_with_warning(self):
        for spot, dte in [(0.0, 30), (None, 30), (100.0, -1), (100.0, None)]:
            out = risk_neutral_density(_chain(), spot=spot, expiry_dte=dte)
            _assert_well_formed(out)
            assert out["strikes"] == []
            assert out["warnings"]


class TestSyntheticLognormal:
    def test_density_positive_cdf_one_mean_near_forward_from_prices(self):
        rows = _chain()
        out = risk_neutral_density(rows, spot=100.0, expiry_dte=30, rate=0.0)

        _assert_well_formed(out)
        assert out["strikes"], "expected a density from a clean BS chain"
        assert out["density"] and all(v >= 0.0 for v in out["density"])
        assert sum(out["density"]) == pytest.approx(1.0, abs=1e-9)
        assert out["cdf"][-1] == pytest.approx(1.0, abs=1e-9)
        assert out["cdf"] == sorted(out["cdf"]), "CDF must be non-decreasing"
        assert out["forward"] == pytest.approx(100.0)
        assert out["mean"] == pytest.approx(out["forward"], rel=0.05)
        assert "no_option_points" not in out["warnings"]
        assert "insufficient_data" not in out["warnings"]
        assert "used_smile_fallback" not in out["warnings"]

    def test_nonzero_rate_shifts_forward_and_mean(self):
        rate = 0.08
        out = risk_neutral_density(_chain(r=rate), spot=100.0,
                                   expiry_dte=30, rate=rate)
        _assert_well_formed(out)
        expected_fwd = 100.0 * math.exp(rate * 30 / 365.0)
        assert out["forward"] == pytest.approx(expected_fwd)
        assert out["mean"] == pytest.approx(expected_fwd, rel=0.05)


class TestSmileFallback:
    def test_iv_only_chain_uses_smile_fallback(self):
        pts = _flat_iv_points(sig=20.0)
        out = risk_neutral_density(pts, spot=100.0, expiry_dte=30)
        _assert_well_formed(out)
        assert "used_smile_fallback" in out["warnings"]
        assert sum(out["density"]) == pytest.approx(1.0, abs=1e-9)
        assert out["cdf"][-1] == pytest.approx(1.0, abs=1e-9)
        assert out["mean"] == pytest.approx(out["forward"], rel=0.06)

    def test_pdf_from_smile_public_helper(self):
        pts = _flat_iv_points(sig=25.0)
        out = pdf_from_smile(pts, spot=100.0, expiry_dte=30)
        _assert_well_formed(out)
        assert "used_smile_fallback" in out["warnings"]
        assert out["density"] and all(v > 0.0 for v in out["density"])
        assert out["mean"] == pytest.approx(out["forward"], rel=0.06)

    def test_smoky_smile_wider_vol_gives_wider_density(self):
        narrow = pdf_from_smile(_flat_iv_points(sig=12.0), 100.0, 30)
        wide = pdf_from_smile(_flat_iv_points(sig=40.0), 100.0, 30)
        assert _spread(narrow) < _spread(wide)


def _spread(out):
    ks, ds = out["strikes"], out["density"]
    mean = sum(k * d for k, d in zip(ks, ds))
    var = sum(d * (k - mean) ** 2 for k, d in zip(ks, ds))
    return math.sqrt(var)


class TestMissingAndIlliquid:
    def test_missing_wings_warning_for_narrow_chain(self):
        zs = [-0.04 + i * 0.01 for i in range(9)]  # K ~ 96..104, inside 5% band
        out = risk_neutral_density(_chain(zs=zs), spot=100.0, expiry_dte=30)
        _assert_well_formed(out)
        assert "missing_wings" in out["warnings"]

    def test_too_few_points_warning_but_no_exception(self):
        rows = _chain(zs=[-0.1, 0.0, 0.1])
        out = risk_neutral_density(rows, spot=100.0, expiry_dte=30)
        _assert_well_formed(out)
        assert "too_few_points" in out["warnings"]
        assert "insufficient_data" not in out["warnings"]
        assert sum(out["density"]) == pytest.approx(1.0, abs=1e-9)

    def test_dead_strikes_are_not_zero_filled(self):
        good = _chain(zs=_lognormal_zs(n=15, lo=-0.3, hi=0.3))
        dead = [
            {"strike": 100.0 * math.exp(-0.15), "ce": {"iv": 20.0}, "pe": {"iv": 20.0}},
            {"strike": 100.0 * math.exp(0.15), "ce": {"iv": 20.0}, "pe": {"iv": 20.0}},
        ]
        rows = dead + good
        out = risk_neutral_density(rows, spot=100.0, expiry_dte=30)

        _assert_well_formed(out)
        priced = sorted(r["strike"] for r in good)
        assert len(out["strikes"]) == len(priced), "dead strikes must be dropped"
        assert out["strikes"] == pytest.approx(priced, rel=1e-9)
        assert all(v > 0.0 for v in out["density"]), "no zero-filled density"
        assert "used_smile_fallback" not in out["warnings"]

    def test_garbage_and_nan_inputs_never_propagate_nan(self):
        rows = _chain(zs=_lognormal_zs(n=15, lo=-0.3, hi=0.3))
        noisy = [
            None, "garbage", {"strike": float("nan")},
            {"strike": 100.0, "ce": {"ltp": float("inf")}, "pe": {"ltp": float("nan")}},
            {"strike": 97.0, "ce": {"ltp": "n/a"}, "pe": {"ltp": None}},
            {"strike": 103.0, "ce": {"ltp": None}, "pe": {"ltp": -5.0}},
        ]
        out = risk_neutral_density(noisy + rows, spot=100.0, expiry_dte=30)
        _assert_well_formed(out)
        assert sum(out["density"]) == pytest.approx(1.0, abs=1e-9)

    def test_negative_density_is_clamped_and_reported(self):
        # A mostly-convex curve with a strong concave ripple forces some raw
        # second derivatives negative; they must be clamped and counted.
        strikes = [80.0 + 2.0 * i for i in range(31)]
        rows = []
        for k in strikes:
            c = 0.01 * (k - 80.0) ** 2 + 5.0 * math.sin(0.8 * (k - 80.0))
            rows.append({"strike": k, "ce": {"ltp": c, "iv": 20.0},
                         "pe": {"ltp": 0.5, "iv": 20.0}})
        out = risk_neutral_density(rows, spot=100.0, expiry_dte=30)
        _assert_well_formed(out)
        if out["density"]:
            assert out["negative_density_pct"] > 0.0
            assert "negative_density_clamped" in out["warnings"]


# --- vectorized local-quadratic density (parity with the old polyfit loop) ---
import numpy as np

from api.options_rnd import LOCAL_WINDOW, MIN_POINTS, _bl_density, _local_quad_second


def _smile_prices(strikes, spot, t_years, r=0.0):
    """Call prices from a quadratic-in-log-moneyness volatility smile."""
    prices = []
    for k in strikes:
        z = math.log(k / spot)
        sig = 0.20 + 0.04 * z + 0.03 * z * z
        v = sig * math.sqrt(t_years)
        d1 = (math.log(spot / k) + (r + 0.5 * sig * sig) * t_years) / v
        d2 = d1 - v
        prices.append(spot * _ndtr(d1) - k * math.exp(-r * t_years) * _ndtr(d2))
    return prices


def _reference_bl(strikes, call_prices, t_years, rate):
    """The pre-vectorization per-strike polyfit density, kept as an oracle."""
    idx = [i for i, p in enumerate(call_prices)
           if p is not None and math.isfinite(p)]
    if len(idx) < MIN_POINTS:
        return [], np.array([], dtype=float), 0.0
    ks = np.asarray([strikes[i] for i in idx], dtype=float)
    cs = np.asarray([call_prices[i] for i in idx], dtype=float)
    n = len(ks)
    center = float(np.mean(ks))
    scale = abs(float(np.std(ks)))
    if scale == 0.0:
        scale = abs(center) or 1.0
    x = (ks - center) / scale
    disc = math.exp(rate * t_years)
    raw = np.zeros(n, dtype=float)
    for i in range(n):
        lo, hi = max(0, i - LOCAL_WINDOW), min(n, i + LOCAL_WINDOW + 1)
        if hi - lo < 3:  # edges: widen to the nearest three points
            if lo == 0:
                hi = min(n, lo + 3)
            else:
                lo = max(0, hi - 3)
        if hi - lo < 3:
            continue
        try:
            coef = np.polyfit(x[lo:hi], cs[lo:hi], 2)
        except (np.linalg.LinAlgError, ValueError, TypeError):
            continue
        raw[i] = disc * 2.0 * coef[0] / (scale * scale)
    raw = np.where(np.isfinite(raw), raw, 0.0)
    neg = float(np.sum(raw < 0.0)) / n if n else 0.0
    return list(ks), np.clip(raw, 0.0, None), neg


class TestLocalQuadraticParity:
    @pytest.mark.parametrize("strikes", [
        [24000.0 + 50.0 * i for i in range(142)],            # uniform chain
        [100.0 * math.exp(-0.35 + i * 0.0175) for i in range(41)],  # non-uniform
    ])
    def test_matches_per_strike_polyfit_on_smile(self, strikes):
        t = 30 / 365.0
        prices = _smile_prices(strikes, float(np.median(strikes)), t)
        g_old, d_old, neg_old = _reference_bl(strikes, prices, t, 0.0)
        g_new, d_new, neg_new = _bl_density(strikes, prices, t, 0.0)
        assert g_new == g_old
        assert neg_new == pytest.approx(neg_old, abs=1e-12)
        assert d_new == pytest.approx(d_old, rel=1e-7, abs=1e-12)

    def test_edge_windows_match_widened_three_point_polyfit(self):
        strikes = np.asarray([95.0 + i for i in range(12)], dtype=float)
        cs = np.asarray(_smile_prices(strikes, 100.0, 30 / 365.0), dtype=float)
        x = (strikes - strikes.mean()) / strikes.std()
        got = _local_quad_second(x, cs)

        n = len(x)
        exp = np.zeros(n)
        for i in range(n):
            lo, hi = max(0, i - LOCAL_WINDOW), min(n, i + LOCAL_WINDOW + 1)
            if hi - lo < 3:
                if lo == 0:
                    hi = min(n, lo + 3)
                else:
                    lo = max(0, hi - 3)
            exp[i] = 2.0 * np.polyfit(x[lo:hi], cs[lo:hi], 2)[0]

        assert got == pytest.approx(exp, rel=1e-7, abs=1e-12)
        # The edges genuinely are 3-point fits, not the 5-point interior window.
        assert np.polyfit(x[0:3], cs[0:3], 2)[0] != pytest.approx(
            np.polyfit(x[0:5], cs[0:5], 2)[0], rel=1e-6)

    def test_too_few_points_returns_empty(self):
        grid, raw, neg = _bl_density([99.0, 100.0], [1.0, 0.5], 30 / 365.0, 0.0)
        assert grid == [] and raw.size == 0 and neg == 0.0
