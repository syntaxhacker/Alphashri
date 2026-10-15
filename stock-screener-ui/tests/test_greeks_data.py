"""Offline tests for india_board/scripts/greeks_data.py (wave W1b).

Every test builds a synthetic chain dict — no network, no fyers_data import at
module load. The BS fallback is exercised through a stubbed ``fyers_data``
module injected into ``sys.modules`` so the real (concurrently edited) file is
never touched.
"""
from __future__ import annotations

import json
import math
import sys
import types
from datetime import datetime, timedelta

import pytest

from india_board.scripts import greeks_data
from india_board.scripts.greeks_data import IST


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _row(
    strike,
    *,
    ce_iv=None,
    pe_iv=None,
    ce_delta=None,
    pe_delta=None,
    ce_gamma=None,
    pe_gamma=None,
    ce_oi=0.0,
    pe_oi=0.0,
):
    return {
        "strike": strike,
        "ce_oi": ce_oi,
        "pe_oi": pe_oi,
        "ce_iv": ce_iv,
        "pe_iv": pe_iv,
        "ce_delta": ce_delta,
        "pe_delta": pe_delta,
        "ce_gamma": ce_gamma,
        "pe_gamma": pe_gamma,
    }


def _chain(rows, spot=100.0, **extra):
    base = {"ticker": "NIFTY", "spot": spot, "as_of": "2026-09-28", "strikes": rows}
    base.update(extra)
    return base


#: realistic delta ladder around spot 100 (call delta, put delta)
_CD = {90: 0.80, 95: 0.65, 100: 0.50, 105: 0.32, 110: 0.18}
_PD = {90: -0.20, 95: -0.35, 100: -0.50, 105: -0.68, 110: -0.82}
_STRIKES = (90, 95, 100, 105, 110)


def _symmetric_chain(iv=0.20):
    return _chain(
        [
            _row(k, ce_iv=iv, pe_iv=iv, ce_delta=_CD[k], pe_delta=_PD[k])
            for k in _STRIKES
        ]
    )


def _put_skew_chain():
    pe = {90: 0.30, 95: 0.26, 100: 0.22, 105: 0.20, 110: 0.18}
    return _chain(
        [
            _row(k, ce_iv=0.18, pe_iv=pe[k], ce_delta=_CD[k], pe_delta=_PD[k])
            for k in _STRIKES
        ]
    )


def _no_greek_chain():
    """IV present, but no deltas / gammas anywhere."""
    return _chain(
        [_row(k, ce_iv=0.20, pe_iv=0.22) for k in (92, 96, 100, 104, 108, 112)],
        spot=102.0,
    )


def _flat_chain(iv, spot=100.0):
    return _chain(
        [
            _row(k, ce_iv=iv, pe_iv=iv, ce_delta=_CD[k], pe_delta=_PD[k])
            for k in _STRIKES
        ],
        spot=spot,
    )


def _stub_fyers(monkeypatch, compute_gex):
    stub = types.ModuleType("fyers_data")
    stub.compute_gex = compute_gex
    monkeypatch.setitem(sys.modules, "fyers_data", stub)
    return stub


def _walk(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _walk(v)
    else:
        yield obj


@pytest.fixture(autouse=True)
def _hermetic_fyers(monkeypatch):
    """Keep the BS fallback offline by default — never import the real file."""
    stub = types.ModuleType("fyers_data")
    stub.compute_gex = lambda chain: {"rows": [], "net_gex": None}
    monkeypatch.setitem(sys.modules, "fyers_data", stub)
    return stub


# ---------------------------------------------------------------------------
# (a) symmetric smile -> RR/butterfly ~ 0
# ---------------------------------------------------------------------------
class TestSymmetricSmile:
    def test_atm_and_25d(self):
        out = greeks_data.iv_metrics(_symmetric_chain())
        assert out["atm_iv"] == pytest.approx(0.20)
        assert out["call_25d_iv"] == pytest.approx(0.20)
        assert out["put_25d_iv"] == pytest.approx(0.20)
        assert out["risk_reversal"] == pytest.approx(0.0, abs=1e-12)
        assert out["butterfly"] == pytest.approx(0.0, abs=1e-12)
        assert out["skew_slope"] == pytest.approx(0.0, abs=1e-12)
        assert out["n_legs_with_iv"] == 10
        assert out["reason"] is None

    def test_max_min_iv(self):
        out = greeks_data.iv_metrics(_put_skew_chain())
        assert out["max_iv"]["iv"] == pytest.approx(0.30)
        assert out["max_iv"]["strike"] == 90
        assert out["min_iv"]["iv"] == pytest.approx(0.18)


# ---------------------------------------------------------------------------
# (b) put skew -> risk reversal > 0
# ---------------------------------------------------------------------------
class TestPutSkew:
    def test_put_skew_positive_rr(self):
        out = greeks_data.iv_metrics(_put_skew_chain())
        assert out["risk_reversal"] is not None and out["risk_reversal"] > 0
        assert out["put_25d_iv"] > out["call_25d_iv"]
        assert out["butterfly"] > 0
        assert out["skew_slope"] < 0

    def test_rr_definition_is_put_minus_call(self):
        out = greeks_data.iv_metrics(_put_skew_chain())
        assert out["risk_reversal"] == pytest.approx(
            out["put_25d_iv"] - out["call_25d_iv"]
        )


# ---------------------------------------------------------------------------
# (c) missing greeks -> None + reason, GEX falls back to bs_backsolved
# ---------------------------------------------------------------------------
class TestMissingGreeks:
    def test_iv_metrics_no_delta(self):
        out = greeks_data.iv_metrics(_no_greek_chain())
        assert out["call_25d_iv"] is None
        assert out["put_25d_iv"] is None
        assert out["risk_reversal"] is None
        assert out["reason"] == "no_delta_greeks"
        assert out["atm_iv"] is not None  # ATM needs no greeks

    def test_insufficient_iv_legs(self):
        chain = _chain([_row(k, ce_iv=0.2) for k in (100, 105, 110)])
        out = greeks_data.iv_metrics(chain)
        assert out["reason"].startswith("insufficient_iv_legs")
        assert out["atm_iv"] is None and out["risk_reversal"] is None

    def test_gex_falls_back(self, monkeypatch):
        _stub_fyers(
            monkeypatch,
            lambda chain: {
                "rows": [{"strike": 100.0, "call_gex": -1.0, "put_gex": 2.0, "net": 1.0}],
                "net_gex": 1.0,
                "gamma_flip": 99.0,
                "call_wall": 110.0,
                "put_wall": 90.0,
                "magnet": 100.0,
            },
        )
        out = greeks_data.gex_from_greeks(_no_greek_chain())
        assert out["iv_source"] == "bs_backsolved"
        assert out["rows"][0]["net_gex"] == 1.0  # "net" normalised to net_gex
        assert out["rows"][0]["call_gex"] == -1.0
        assert out["gamma_flip"] == 99.0

    def test_gex_fallback_unavailable_is_safe(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "fyers_data", None)
        monkeypatch.setitem(sys.modules, "india_board.scripts.fyers_data", None)
        out = greeks_data.gex_from_greeks(_no_greek_chain())
        assert out["iv_source"] == "bs_backsolved"
        assert out["rows"] == []


# ---------------------------------------------------------------------------
# (d) 25-delta interpolation across uneven strike spacing
# ---------------------------------------------------------------------------
class TestDeltaInterpolation:
    def test_uneven_spacing(self):
        # call deltas deliberately non-uniform; target 0.25 sits between
        # delta .20 (iv .24) and .40 (iv .28) -> 0.25 exactly at iv 0.25
        rows = [
            _row(100, ce_iv=0.30, pe_iv=0.32, ce_delta=0.60, pe_delta=-0.40),
            _row(103, ce_iv=0.28, pe_iv=0.30, ce_delta=0.40, pe_delta=-0.42),
            _row(107, ce_iv=0.24, pe_iv=0.26, ce_delta=0.20, pe_delta=-0.60),
            _row(112, ce_iv=0.22, pe_iv=0.24, ce_delta=0.10, pe_delta=-0.70),
        ]
        out = greeks_data.iv_metrics(_chain(rows, spot=104.0))
        assert out["call_25d_iv"] == pytest.approx(0.25)
        # ATM at 104 interpolates 103 -> 107 (pe .30 / ce .24)
        assert out["atm_iv"] == pytest.approx(0.285)
        assert out["atm_strike"] == 103

    def test_delta_target_out_of_range(self):
        rows = [
            _row(k, ce_iv=0.2, pe_iv=0.2, ce_delta=0.9 - i * 0.02, pe_delta=-0.1 - i * 0.02)
            for i, k in enumerate((100, 105, 110, 115, 120))
        ]
        out = greeks_data.iv_metrics(_chain(rows, spot=110.0))
        assert out["call_25d_iv"] is None
        assert out["reason"] == "delta_out_of_range"


# ---------------------------------------------------------------------------
# (e) true-gamma GEX + interpolated gamma flip
# ---------------------------------------------------------------------------
class TestTrueGammaGex:
    def _chain(self):
        # spot 105; net GEX: +, +, -, - -> single crossing between 100 and 110
        rows = [
            _row(90, ce_gamma=0.5, pe_gamma=0.5, ce_oi=0, pe_oi=2000),
            _row(100, ce_gamma=0.5, pe_gamma=0.5, ce_oi=0, pe_oi=1000),
            _row(110, ce_gamma=0.5, pe_gamma=0.5, ce_oi=2000, pe_oi=0),
            _row(120, ce_gamma=0.5, pe_gamma=0.5, ce_oi=4000, pe_oi=0),
        ]
        return _chain(rows, spot=105.0)

    def test_source_and_rows(self):
        out = greeks_data.gex_from_greeks(self._chain())
        assert out["iv_source"] == "fyers_greeks"
        assert [r["strike"] for r in out["rows"]] == [90, 100, 110, 120]
        assert out["rows"][0]["put_gex"] > 0
        assert out["rows"][3]["call_gex"] < 0
        assert out["rows"][3]["net_gex"] == pytest.approx(
            out["rows"][3]["call_gex"] + out["rows"][3]["put_gex"]
        )

    def test_gamma_flip_interpolated(self):
        out = greeks_data.gex_from_greeks(self._chain())
        # crossing 100 (+0.0055125) -> 110 (-0.011025)
        assert out["gamma_flip"] == pytest.approx(103.3333, abs=1e-3)

    def test_walls_and_magnet(self):
        out = greeks_data.gex_from_greeks(self._chain())
        assert out["call_wall"] == 120  # largest CE OI above spot
        assert out["put_wall"] == 90   # largest PE OI below spot
        assert out["magnet"] == 120    # max |net gex|

    def test_partial_gamma_is_none_not_zero(self):
        rows = [
            _row(90, ce_gamma=0.5, pe_gamma=None, ce_oi=100, pe_oi=100),
            _row(100, ce_gamma=0.5, pe_gamma=0.5, ce_oi=100, pe_oi=100),
        ]
        out = greeks_data.gex_from_greeks(_chain(rows, spot=95.0))
        assert out["rows"][0]["put_gex"] is None
        assert out["rows"][0]["net_gex"] == pytest.approx(out["rows"][0]["call_gex"])

    def test_negative_net_gex_short_gamma(self):
        rows = [_row(100, ce_gamma=1.0, pe_gamma=None, ce_oi=10000, pe_oi=0)]
        out = greeks_data.gex_from_greeks(_chain(rows, spot=100.0))
        assert out["net_gex"] < 0


# ---------------------------------------------------------------------------
# (f) iv_rank / percentile on a known series
# ---------------------------------------------------------------------------
class TestIvRank:
    def test_exact_values(self):
        series = list(range(10, 20))  # 10..19, n=10
        out = greeks_data.iv_rank(14, series)
        assert out["n"] == 10
        assert out["min"] == 10 and out["max"] == 19
        assert out["median"] == pytest.approx(14.5)
        assert out["iv_rank"] == pytest.approx((14 - 10) / (19 - 10) * 100.0)
        assert out["iv_percentile"] == pytest.approx(50.0)
        assert out["reason"] is None

    def test_high_and_low(self):
        series = list(range(10, 20))
        assert greeks_data.iv_rank(19, series)["iv_rank"] == pytest.approx(100.0)
        assert greeks_data.iv_rank(10, series)["iv_rank"] == pytest.approx(0.0)

    def test_short_series(self):
        out = greeks_data.iv_rank(0.2, [0.15, 0.18, 0.22])
        assert out["iv_rank"] is None and out["iv_percentile"] is None
        assert out["reason"].startswith("insufficient_series")

    def test_date_value_pairs_and_missing_now(self):
        series = [(f"2026-09-{i:02d}", v) for i, v in enumerate(range(10, 22), start=1)]
        out = greeks_data.iv_rank(15, series)
        assert out["n"] == 12 and out["iv_rank"] is not None
        assert greeks_data.iv_rank(None, series)["reason"] == "iv_now_missing"


# ---------------------------------------------------------------------------
# (g) VRP bands
# ---------------------------------------------------------------------------
class TestVrp:
    def test_expensive(self):
        out = greeks_data.vrp(0.20, 0.15)
        assert out["vrp"] == pytest.approx(0.05)
        assert out["ratio"] == pytest.approx(0.20 / 0.15)
        assert out["verdict"] == "EXPENSIVE"

    def test_cheap(self):
        out = greeks_data.vrp(0.12, 0.15)
        assert out["verdict"] == "CHEAP"

    def test_fair(self):
        out = greeks_data.vrp(0.15, 0.15)
        assert out["verdict"] == "FAIR"

    def test_percent_inputs_normalised(self):
        out = greeks_data.vrp(20.0, 15.0)
        assert out["ratio"] == pytest.approx(20.0 / 15.0)
        assert out["verdict"] == "EXPENSIVE"
        assert out["vrp"] == pytest.approx(0.05)

    def test_unknown_when_hv_missing(self):
        assert greeks_data.vrp(0.20, None)["verdict"] == "UNKNOWN"
        assert greeks_data.vrp(None, 0.15)["verdict"] == "UNKNOWN"
        assert greeks_data.vrp(0.2, 0.0)["verdict"] == "UNKNOWN"


# ---------------------------------------------------------------------------
# term structure
# ---------------------------------------------------------------------------
class TestTermStructure:
    def test_contango_and_dte(self):
        today = datetime.now(IST).date()
        front = today + timedelta(days=2)
        nxt = today + timedelta(days=9)
        chains = {
            front.isoformat(): _flat_chain(0.15),
            nxt.isoformat(): _flat_chain(0.18),
        }
        out = greeks_data.term_structure(chains)
        assert out["structure"] == "contango"
        assert out["front_next_spread"] == pytest.approx(0.03)
        assert out["front"]["dte"] == 2 and out["next"]["dte"] == 9
        assert out["expiries"][0]["expiry"] == front.isoformat()

    def test_backwardation(self):
        today = datetime.now(IST).date()
        chains = {
            (today + timedelta(days=2)).isoformat(): _flat_chain(0.20),
            (today + timedelta(days=9)).isoformat(): _flat_chain(0.16),
        }
        out = greeks_data.term_structure(chains)
        assert out["structure"] == "backwardation"
        assert out["front_next_spread"] < 0

    def test_single_expiry_reason(self):
        today = datetime.now(IST).date()
        out = greeks_data.term_structure({(today + timedelta(days=3)).isoformat(): _flat_chain(0.2)})
        assert out["structure"] is None
        assert out["reason"] == "need_two_expiries_with_iv"

    def test_dd_mm_yyyy_key(self):
        out = greeks_data.term_structure({"28-09-2026": _flat_chain(0.2)})
        assert out["expiries"][0]["expiry"] == "2026-09-28"


# ---------------------------------------------------------------------------
# (h) summarize is JSON-safe, (i) empty/partial chains never raise
# ---------------------------------------------------------------------------
class TestSummarize:
    def test_bundle_keys_and_json_round_trip(self):
        today = datetime.now(IST).date()
        chains = {
            (today + timedelta(days=2)).isoformat(): _flat_chain(0.15),
            (today + timedelta(days=9)).isoformat(): _flat_chain(0.18),
        }
        series = [(f"2026-08-{i:02d}", 0.10 + i / 100.0) for i in range(1, 15)]
        chain = _flat_chain(0.20)
        chain["indiavix"] = 14.5
        chain["expiry_flag"] = "W"
        out = greeks_data.summarize(
            "nifty",
            chain,
            hv20=0.15,
            iv_series=series,
            chains_by_expiry=chains,
        )
        assert set(out) == {
            "ticker",
            "as_of",
            "spot",
            "expiry",
            "expiry_flag",
            "indiavix",
            "iv",
            "smile",
            "gex",
            "vrp",
            "iv_rank",
            "term_structure",
        }
        assert out["ticker"] == "NIFTY"
        assert out["vrp"]["verdict"] in {"CHEAP", "FAIR", "EXPENSIVE"}
        # json.dumps must not choke, and no NaN/Inf may survive anywhere
        json.dumps(out)
        for v in _walk(out):
            if isinstance(v, float):
                assert math.isfinite(v), f"non-finite leaked: {v}"

    def test_optional_sections_absent_by_default(self):
        out = greeks_data.summarize("NIFTY", _symmetric_chain())
        assert out["vrp"] is None
        assert out["iv_rank"] is None
        assert out["term_structure"] is None
        json.dumps(out)

    def test_empty_chain_does_not_raise(self, monkeypatch):
        # no greeks -> gex fallback; keep it hermetic
        _stub_fyers(monkeypatch, lambda chain: {"rows": [], "net_gex": None})
        assert greeks_data.iv_metrics({})["reason"] == "empty_chain"
        assert greeks_data.gex_from_greeks({})["iv_source"] == "none"
        out = greeks_data.summarize("NIFTY", {})
        json.dumps(out)

    def test_spot_none_does_not_raise(self, monkeypatch):
        _stub_fyers(monkeypatch, lambda chain: {"rows": []})
        chain = _chain([row for row in _symmetric_chain()["strikes"]], spot=None)
        out = greeks_data.summarize("NIFTY", chain, hv20=0.15)
        json.dumps(out)

    def test_garbage_chain_does_not_raise(self, monkeypatch):
        _stub_fyers(monkeypatch, lambda chain: {"rows": []})
        for bad in (None, [], "nonsense", {"strikes": "x", "spot": "y"}):
            out = greeks_data.summarize("NIFTY", bad)
            json.dumps(out)
