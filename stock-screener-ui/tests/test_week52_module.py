"""Tests for trading.week52 — the single-home 52W module (config, keys, math).

Verifies the consolidated module exposes the same behavior as the legacy
screener_models helpers, and that the env/constant table is the single source.
"""
import pytest

from trading.week52 import config, keys
from trading.week52 import (
    classify_approach,
    gap_pct_to_52w_high,
    has_live_data,
    is_likely_etf,
    is_plausible_52w_gap,
    is_within_52w_touch_gap,
)


class TestGapPct:
    def test_basic_gap_below_high(self):
        assert gap_pct_to_52w_high(100, 95) == 5.0

    def test_price_above_high_is_negative(self):
        assert gap_pct_to_52w_high(100, 110) == -10.0

    def test_price_at_high_is_zero(self):
        assert gap_pct_to_52w_high(100, 100) == 0.0

    @pytest.mark.parametrize("high,price", [(0, 100), (100, 0), (-1, 5), (5, -1)])
    def test_invalid_inputs_return_none(self, high, price):
        assert gap_pct_to_52w_high(high, price) is None

    def test_rounds_to_two_decimals(self):
        assert gap_pct_to_52w_high(3, 1) == 66.67


class TestTouchGap:
    def test_within_threshold_true(self):
        assert is_within_52w_touch_gap(0.5, threshold_pct=1.0) is True

    def test_at_threshold_is_false(self):
        # strict less-than: gap == threshold is NOT touched
        assert is_within_52w_touch_gap(1.0, threshold_pct=1.0) is False

    def test_negative_breakout_gap_is_touched(self):
        assert is_within_52w_touch_gap(-3.0, threshold_pct=1.0) is True

    def test_default_threshold_is_one_pct(self):
        assert is_within_52w_touch_gap(0.9) is True
        assert is_within_52w_touch_gap(1.5) is False


class TestPlausibleGap:
    def test_normal_gap_plausible(self):
        assert is_plausible_52w_gap(3.5) is True

    def test_small_negative_breakout_plausible(self):
        assert is_plausible_52w_gap(-4.9) is True

    def test_gap_at_stale_edge_is_plausible(self):
        assert is_plausible_52w_gap(-5.0) is True

    def test_far_negative_gap_is_stale(self):
        assert is_plausible_52w_gap(-20.0) is False

    @pytest.mark.parametrize("val", [None, "abc", float("nan"), float("inf")])
    def test_invalid_returns_false(self, val):
        assert is_plausible_52w_gap(val) is False


class TestClassifyApproach:
    def test_touched_now(self):
        assert classify_approach(True, None) == "touched"

    def test_retest_within_window(self):
        assert classify_approach(False, 3, window_days=5) == "retest"

    def test_retest_at_window_edge(self):
        assert classify_approach(False, 5, window_days=5) == "retest"

    def test_fresh_outside_window(self):
        assert classify_approach(False, 6, window_days=5) == "fresh"

    def test_fresh_when_no_touch_found(self):
        assert classify_approach(False, None) == "fresh"


class TestIsLikelyEtf:
    @pytest.mark.parametrize(
        "sym",
        ["NIFTYBEES", "AONELIQUID", "GROWWLIQID", "LIQUIDCASE", "SOMEETF", "LIQUIDSHRI"],
    )
    def test_detects_etfs(self, sym):
        assert is_likely_etf(sym) is True

    @pytest.mark.parametrize("sym", ["RELIANCE", "TCS", "INFY", "HDFCBANK", None, ""])
    def test_normal_symbols_are_not_etf(self, sym):
        assert is_likely_etf(sym) is False

    def test_normalizes_case_and_punctuation(self):
        assert is_likely_etf("nifty-bees") is True


class TestHasLiveData:
    def test_volume_alone_counts(self):
        assert has_live_data({"volume_m": 2.0}) is True

    def test_rsi_alone_counts(self):
        assert has_live_data({"rsi": 55}) is True

    def test_adx_alone_counts(self):
        assert has_live_data({"adx": 30}) is True

    def test_all_zero_is_dead(self):
        assert has_live_data({"volume_m": 0, "rsi": 0, "adx": 0}) is False

    def test_missing_fields_is_dead(self):
        assert has_live_data({}) is False


class TestConfigTable:
    def test_touched_gap_default(self, monkeypatch):
        monkeypatch.delenv("SCREENER_52W_TOUCHED_GAP_PCT", raising=False)
        assert config.touched_52w_gap_threshold_pct() == 1.0

    def test_touch_eps_default(self, monkeypatch):
        monkeypatch.delenv("SCREENER_52W_TOUCH_EPS_PCT", raising=False)
        assert config.touch_eps_pct() == 0.5

    def test_retest_window_default(self, monkeypatch):
        monkeypatch.delenv("SCREENER_RETEST_WINDOW_DAYS", raising=False)
        assert config.retest_window_days() == 5

    def test_exclude_etfs_default_true(self, monkeypatch):
        monkeypatch.delenv("SCREENER_EXCLUDE_ETFS", raising=False)
        assert config.exclude_etfs_from_screener() is True

    @pytest.mark.parametrize("val", ["0", "false", "no", "FALSE"])
    def test_exclude_etfs_false_variants(self, monkeypatch, val):
        monkeypatch.setenv("SCREENER_EXCLUDE_ETFS", val)
        assert config.exclude_etfs_from_screener() is False

    def test_turnover_default(self, monkeypatch):
        monkeypatch.delenv("SCREENER_52W_MIN_TURNOVER_CR", raising=False)
        assert config.min_52w_turnover_cr() == 0.5

    def test_enrich_top_default(self, monkeypatch):
        monkeypatch.delenv("SCREENER_52W_ENRICH_TOP", raising=False)
        assert config.enrich_top_n() == 80

    def test_batch_interval_default(self, monkeypatch):
        monkeypatch.delenv("SCREENER_52W_INTERVAL_SEC", raising=False)
        assert config.batch_interval_sec() == 3600

    def test_job_stale_default(self, monkeypatch):
        monkeypatch.delenv("SCREENER_52W_STALE_SEC", raising=False)
        assert config.job_stale_sec() == 1800

    def test_job_stale_bad_value_falls_back(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_STALE_SEC", "not-a-number")
        assert config.job_stale_sec() == 1800

    def test_env_override_wins(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_TOUCHED_GAP_PCT", "2.5")
        assert config.touched_52w_gap_threshold_pct() == 2.5

    def test_constants(self):
        assert config.STALE_52W_BREAKOUT_PCT == 5.0
        assert config.PRICE_CAP == 7000
        assert config.TV_BATCH_SIZE == 80


class TestKeys:
    def test_per_symbol_format(self):
        assert keys.per_symbol("RELIANCE") == "52w_range:RELIANCE"

    def test_bulk_and_job_keys(self):
        assert keys.BULK == "52w_range:all"
        assert keys.JOB_STATUS == "52w_range:job_status"

    def test_ttls_positive(self):
        assert keys.RANGE_TTL > 0
        assert keys.JOB_TTL > 0

    def test_prefix_matches_key_family(self):
        assert keys.BULK.startswith(keys.PREFIX)
        assert keys.JOB_STATUS.startswith(keys.PREFIX)
        assert keys.per_symbol("X").startswith(keys.PREFIX)


class TestParityWithLegacy:
    """The consolidated module must not drift from screener_models helpers."""

    def test_gap_parity(self):
        from api.screener_api import screener_models as sm

        for high, price in [(100, 95), (500, 480), (10, 12), (100, 100)]:
            assert sm.gap_pct_to_52w_high(high, price) == gap_pct_to_52w_high(high, price)

    def test_threshold_parity(self, monkeypatch):
        from api.screener_api import screener_models as sm

        monkeypatch.setenv("SCREENER_52W_TOUCHED_GAP_PCT", "1.7")
        assert sm.touched_52w_gap_threshold_pct() == config.touched_52w_gap_threshold_pct() == 1.7

    def test_classify_parity(self):
        from api.screener_api import screener_models as sm

        for args in [(True, None), (False, 2), (False, 9)]:
            assert sm.classify_approach(*args) == classify_approach(*args)

    def test_etf_parity(self):
        from api.screener_api import screener_models as sm

        for sym in ["RELIANCE", "NIFTYBEES", "AONELIQUID", ""]:
            assert sm.is_likely_etf(sym) == is_likely_etf(sym)
