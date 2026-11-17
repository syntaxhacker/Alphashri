"""Tests for :mod:`api.options_rv` — synthetic series only, no network/DB.

Every price series is generated in-test with a fixed seed so the expected RV is
known by construction; the rest of the cases probe the "never a 500" contract
(empty/short history, provider failure) and the pure ``iv_vs_rv`` reads.
"""

import math

import numpy as np
import pandas as pd
import pytest

import api.options_rv as rv
from api.options_rv import (
    DEFAULT_TENORS,
    TRADING_DAYS_PER_YEAR,
    clear_rv_cache,
    iv_vs_rv,
    realized_vol_cone,
    rv_cone_from_closes,
)

SIGMA = 0.25  # 25 annualized vol points — the known input of the GBM series


def _gbm_closes(n_returns=1200, sigma=SIGMA, seed=42):
    """Daily closes whose log returns are N(0, sigma/sqrt(252))."""
    rng = np.random.default_rng(seed)
    daily = rng.normal(0.0, sigma / math.sqrt(TRADING_DAYS_PER_YEAR), n_returns)
    close = 100.0 * np.exp(np.concatenate([[0.0], np.cumsum(daily)]))
    idx = pd.date_range("2020-01-01", periods=n_returns + 1, freq="B", tz="UTC")
    return pd.Series(close, index=idx, name="close")


def _no_nan(obj):
    if isinstance(obj, float):
        assert math.isfinite(obj), f"non-finite value: {obj}"
    elif isinstance(obj, dict):
        for value in obj.values():
            _no_nan(value)
    elif isinstance(obj, (list, tuple)):
        for value in obj:
            _no_nan(value)


def _bucket(cone, days):
    return next(b for b in cone["tenors"] if b["days"] == days)


@pytest.fixture(autouse=True)
def _clean_cache():
    clear_rv_cache()
    yield
    clear_rv_cache()


# ---------------------------------------------------------------------------
# rv_cone_from_closes — known vol, percentiles, finite output
# ---------------------------------------------------------------------------

class TestRvConeFromCloses:
    def test_known_vol_recovered_across_tenors(self):
        cone = rv_cone_from_closes(_gbm_closes(), DEFAULT_TENORS, symbol="reliance")

        assert cone["symbol"] == "RELIANCE"
        assert cone["as_of"] == _gbm_closes().index[-1].tz_convert("UTC").date().isoformat()
        assert cone["warnings"] == []
        for bucket in cone["tenors"]:
            # A 25% input must show up as ~25 vol points on every tenor.
            assert bucket["p50"] == pytest.approx(SIGMA * 100, abs=4.0), bucket
            # The last 7-day window is noisy, so current is checked against the
            # bucket's own distribution rather than a tight absolute band.
            assert bucket["p10"] * 0.5 <= bucket["current"] <= bucket["p90"] * 1.5

    def test_percentiles_ordered_and_rank_in_range(self):
        cone = rv_cone_from_closes(_gbm_closes(), DEFAULT_TENORS)
        for bucket in cone["tenors"]:
            assert bucket["p10"] <= bucket["p25"] <= bucket["p50"]
            assert bucket["p50"] <= bucket["p75"] <= bucket["p90"]
            assert 0.0 <= bucket["rank_pct"] <= 100.0
            assert bucket["rank_pct"] is not None

    def test_current_is_last_rolling_value_and_rank_is_high_near_it(self):
        closes = _gbm_closes()
        cone = rv_cone_from_closes(closes, (30,))
        bucket = cone["tenors"][0]

        rets = np.log(closes / closes.shift(1)).dropna()
        rolling = rets.rolling(30).std(ddof=1).dropna() * math.sqrt(252) * 100
        expected = rolling.iloc[-1]
        assert bucket["current"] == pytest.approx(expected)
        # rank_pct is where that last value sits in its own rolling distribution.
        assert bucket["rank_pct"] == pytest.approx(
            float((rolling.to_numpy() <= expected).mean() * 100.0)
        )

    def test_no_nan_or_inf_anywhere(self):
        cone = rv_cone_from_closes(_gbm_closes(), DEFAULT_TENORS)
        _no_nan(cone)

    def test_constant_series_gives_zero_vol_not_nan(self):
        closes = pd.Series([100.0] * 100)
        cone = rv_cone_from_closes(closes, (7, 30))
        for bucket in cone["tenors"]:
            for key in ("current", "p10", "p25", "p50", "p75", "p90"):
                assert bucket[key] == pytest.approx(0.0)
        _no_nan(cone)

    def test_plain_list_closes_accepted(self):
        cone = rv_cone_from_closes(list(_gbm_closes(200)), (30,))
        assert cone["tenors"][0]["p50"] is not None


# ---------------------------------------------------------------------------
# Short / empty / dirty history — warnings, never an exception
# ---------------------------------------------------------------------------

class TestDegenerateHistory:
    def test_empty_series_warns_and_returns_none_fields(self):
        cone = rv_cone_from_closes([], DEFAULT_TENORS, symbol="X")
        assert "empty_series" in cone["warnings"]
        assert cone["symbol"] == "X"
        for bucket in cone["tenors"]:
            assert bucket["current"] is None
            assert all(bucket[f"p{p}"] is None for p in (10, 25, 50, 75, 90))
            assert bucket["rank_pct"] is None
        _no_nan(cone)

    def test_one_close_has_no_returns(self):
        cone = rv_cone_from_closes([100.0], (7,))
        assert "no_returns" in cone["warnings"]
        assert cone["tenors"][0]["p50"] is None

    def test_short_history_warns_per_tenor_but_keeps_fittable_tenor(self):
        closes = _gbm_closes(20)  # 20 returns
        cone = rv_cone_from_closes(closes, (7, 30))
        assert _bucket(cone, 7)["p50"] is not None
        assert "short_history_for_tenor_30" in cone["warnings"]
        assert _bucket(cone, 30)["p50"] is None
        assert _bucket(cone, 30)["current"] is None
        _no_nan(cone)

    def test_non_finite_and_non_positive_closes_are_dropped(self):
        closes = pd.Series([100.0, float("nan"), 101.0, float("inf"), -5.0, 102.0, 103.0])
        cone = rv_cone_from_closes(closes, (7,))
        assert "empty_series" not in cone["warnings"]
        _no_nan(cone)

    def test_as_of_uses_ist_session_date_of_daily_bar(self):
        # Upstox daily bars are stamped 18:30 UTC of the prior day; in IST that
        # is the next session's date.
        idx = pd.DatetimeIndex([pd.Timestamp("2026-11-16 18:30:00", tz="UTC")] * 40)
        closes = pd.Series(_gbm_closes(39).to_numpy(), index=idx)
        assert rv_cone_from_closes(closes, (7,))["as_of"] == "2026-11-17"


class TestAsOfFromIndex:
    """Only a datetime-like index yields an ``as_of``; int labels are not 1970."""

    @pytest.mark.parametrize("index", [None, [], pd.RangeIndex(5), [1, 2, 3]])
    def test_non_datetime_index_returns_none(self, index):
        assert rv._as_of_from_index(index) is None

    def test_plain_list_closes_have_no_as_of(self):
        cone = rv_cone_from_closes(list(_gbm_closes(200)), (30,))
        assert cone["as_of"] is None
        assert cone["tenors"][0]["p50"] is not None

    def test_integer_indexed_series_has_no_as_of(self):
        closes = pd.Series(_gbm_closes(200).to_numpy())  # RangeIndex
        assert rv_cone_from_closes(closes, (30,))["as_of"] is None

    def test_datetime_index_still_converts_to_ist_session_date(self):
        idx = pd.DatetimeIndex([pd.Timestamp("2026-11-16 18:30:00", tz="UTC")] * 40)
        assert rv._as_of_from_index(idx) == "2026-11-17"


# ---------------------------------------------------------------------------
# realized_vol_cone — fetch boundary, cache, provider failure
# ---------------------------------------------------------------------------

class TestRealizedVolCone:
    def test_injected_closes_never_touch_provider(self, monkeypatch):
        def _boom(*args, **kwargs):
            raise AssertionError("provider must not be called when closes are injected")

        monkeypatch.setattr(rv, "_fetch_daily_closes", _boom)
        cone = realized_vol_cone("sbin", closes=_gbm_closes(200), tenors=(30,))
        assert cone["symbol"] == "SBIN"
        assert cone["tenors"][0]["p50"] is not None

    def test_fetcher_called_once_with_symbol_and_lookback(self):
        calls = []

        def _fetch(sym, lookback):
            calls.append((sym, lookback))
            return _gbm_closes(200), "2026-11-17"

        cone = realized_vol_cone(" Reliance ", tenors=(30,), lookback_days=500,
                                 fetcher=_fetch)
        assert calls == [("RELIANCE", 500)]
        assert cone["as_of"] == "2026-11-17"
        assert cone["tenors"][0]["p50"] is not None

    def test_cache_reuses_fetched_series(self):
        calls = []

        def _fetch(sym, lookback):
            calls.append(sym)
            return _gbm_closes(200), "2026-11-17"

        realized_vol_cone("TCS", tenors=(30,), fetcher=_fetch)
        realized_vol_cone("TCS", tenors=(60,), fetcher=_fetch)
        assert calls == ["TCS"]  # second read hit the cache; no 2nd provider call

    def test_cache_can_be_bypassed(self):
        calls = []

        def _fetch(sym, lookback):
            calls.append(sym)
            return _gbm_closes(200), "2026-11-17"

        realized_vol_cone("TCS", tenors=(30,), fetcher=_fetch, use_cache=False)
        realized_vol_cone("TCS", tenors=(30,), fetcher=_fetch, use_cache=False)
        assert calls == ["TCS", "TCS"]

    def test_provider_failure_degrades_to_warning(self):
        def _boom(sym, lookback):
            raise ConnectionError("upstream down")

        cone = realized_vol_cone("INFY", tenors=(30,), fetcher=_boom)
        assert any(w.startswith("provider_unavailable") for w in cone["warnings"])
        assert all(b["p50"] is None for b in cone["tenors"])

    def test_empty_provider_series_does_not_raise(self):
        cone = realized_vol_cone("INFY", tenors=(30,), fetcher=lambda s, d: ([], None))
        assert "empty_series" in cone["warnings"]
        _no_nan(cone)


# ---------------------------------------------------------------------------
# iv_vs_rv — pure ladder reads
# ---------------------------------------------------------------------------

def _cone():
    """A cone with a single 30-day bucket, RV percentiles 10..90."""
    return {
        "symbol": "NIFTY",
        "as_of": "2026-11-17",
        "tenors": [{
            "days": 30, "current": 14.0,
            "p10": 10.0, "p25": 12.0, "p50": 15.0, "p75": 18.0, "p90": 22.0,
            "rank_pct": 45.0,
        }],
        "warnings": [],
    }


class TestIvVsRv:
    def test_nearest_tenor_snapped_and_difference_computed(self):
        cone = _cone()
        cone["tenors"].append({
            "days": 90, "current": 16.0,
            "p10": 12.0, "p25": 14.0, "p50": 17.0, "p75": 20.0, "p90": 24.0,
            "rank_pct": 50.0,
        })
        out = iv_vs_rv(
            [{"date": "2026-12-17", "dteDays": 30, "atmIv": 18.0},
             {"date": "2027-02-15", "dte_days": 90, "atm_iv": 16.0}],
            cone,
        )
        first, second = out["rows"]
        assert (first["tenor_days"], first["rv_p50"]) == (30, 15.0)
        assert first["iv_minus_rv"] == pytest.approx(3.0)
        assert (second["tenor_days"], second["rv_p50"]) == (90, 17.0)
        assert second["iv_minus_rv"] == pytest.approx(-1.0)
        assert out["warnings"] == []

    def test_iv_rank_interpolated_and_clamped_to_grid(self):
        cone = _cone()

        def rank(iv):
            return iv_vs_rv([{"dte": 30, "atmIv": iv}], cone)["rows"][0]["iv_rank_in_cone"]

        assert rank(10.0) == pytest.approx(10.0)   # at/below p10
        assert rank(15.0) == pytest.approx(50.0)   # at p50
        assert rank(16.5) == pytest.approx(62.5)   # halfway p50->p75
        assert rank(22.0) == pytest.approx(90.0)   # at/above p90
        assert rank(1.0) == pytest.approx(10.0)    # clamped, no extrapolation

    def test_date_without_dte_uses_cone_as_of(self):
        out = iv_vs_rv([{"date": "2026-12-17", "atmIv": 20.0}], _cone())
        assert out["rows"][0]["dte"] == 30  # 2026-12-17 minus 2026-11-17
        assert out["rows"][0]["iv_minus_rv"] == pytest.approx(5.0)

    def test_object_expiry_supported(self):
        class Expiry:
            date = "2026-12-17"
            dteDays = 30
            atmIv = 18.0

        out = iv_vs_rv([Expiry()], _cone())
        assert out["rows"][0]["iv_minus_rv"] == pytest.approx(3.0)

    def test_missing_iv_and_missing_dte_warn_with_none_fields(self):
        out = iv_vs_rv([{}, {"atmIv": 18.0}], _cone())
        assert "missing_atm_iv" in out["warnings"]
        assert "missing_dte" in out["warnings"]
        assert all(r["iv_minus_rv"] is None for r in out["rows"])
        assert out["rows"][1]["atm_iv"] == 18.0

    def test_missing_cone_warns_but_returns_rows(self):
        out = iv_vs_rv([{"dte": 30, "atmIv": 18.0}], None)
        assert "cone_unavailable" in out["warnings"]
        row = out["rows"][0]
        assert row["atm_iv"] == 18.0
        assert row["iv_minus_rv"] is None

    def test_no_expiries_warns(self):
        out = iv_vs_rv([], _cone())
        assert out["rows"] == []
        assert "no_expiries" in out["warnings"]

    def test_short_history_bucket_is_not_chosen_as_nearest(self):
        cone = _cone()
        cone["tenors"][0].update(p50=None, p25=None, p75=None)  # RV unavailable
        out = iv_vs_rv([{"dte": 25, "atmIv": 18.0}], cone)
        assert "cone_no_rv" in out["warnings"]
        assert out["rows"][0]["tenor_days"] == 30  # bucket still reported
        assert out["rows"][0]["iv_minus_rv"] is None

    def test_zero_dte_warns_and_no_nan(self):
        out = iv_vs_rv([{"dte": 0, "atmIv": 18.0}], _cone())
        assert "dte_below_floor" in out["warnings"]
        assert out["rows"][0]["tenor_days"] == 30
        _no_nan(out)
