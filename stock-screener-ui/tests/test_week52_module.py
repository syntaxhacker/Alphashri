"""Tests for the canonical trading.week52 package (config, keys, math).

Config owns every 52W env reader; math owns the pure helpers. These tests assert
that contract directly rather than comparing against the legacy flat modules.
"""
import subprocess
import sys
from pathlib import Path

import pytest

import trading.week52 as week52
from trading.week52 import config, defaults, keys, upsert
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


class TestToFloatIdentity:
    """The DB-free leaf uses the shared stdlib helper, not a local copy."""

    def test_leaf_to_float_is_common_numbers_to_float(self):
        import common.numbers as numbers
        from trading.week52.math import _to_float

        assert _to_float is numbers.to_float

    @pytest.mark.parametrize(
        "value",
        [None, "", "x", "1.5", "nan", "inf", -2.5, True, 3.25],
    )
    def test_leaf_behavior_matches_common_numbers(self, value):
        from common.numbers import to_float
        from trading.week52.math import _to_float

        assert _to_float(value) == to_float(value)
        assert _to_float(value, default=0.25) == to_float(value, default=0.25)

    def test_has_live_data_keeps_default_zero_semantics(self):
        from common.numbers import to_float
        from trading.week52.math import _to_float

        assert _to_float(None) == to_float(None) == 0.0
        assert _to_float("nan") == to_float("nan") == 0.0
        assert has_live_data({"volume_m": "2.5"}) is True
        assert has_live_data({"volume_m": "nan"}) is False
        assert has_live_data({"volume_m": -1}) is False
        assert has_live_data({"adx": True}) is True


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


class TestBatchAndCacheConfig:
    def test_cache_ttl_default_is_24h(self, monkeypatch):
        monkeypatch.delenv("SCREENER_52W_CACHE_TTL", raising=False)
        assert config.cache_ttl_sec() == 86400

    def test_cache_ttl_env_override(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_CACHE_TTL", "120")
        assert config.cache_ttl_sec() == 120

    def test_cache_ttl_bad_value_falls_back(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_CACHE_TTL", "not-a-number")
        assert config.cache_ttl_sec() == 86400

    def test_cache_ttl_negative_falls_back(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_CACHE_TTL", "-5")
        assert config.cache_ttl_sec() == 86400

    def test_batch_workers_default(self, monkeypatch):
        monkeypatch.delenv("SCREENER_52W_WORKERS", raising=False)
        assert config.batch_workers() == 3

    def test_batch_workers_env_override(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_WORKERS", "5")
        assert config.batch_workers() == 5

    def test_batch_workers_bad_value_falls_back(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_WORKERS", "many")
        assert config.batch_workers() == 3

    def test_batch_workers_negative_falls_back(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_WORKERS", "-2")
        assert config.batch_workers() == 3

    def test_batch_delay_default(self, monkeypatch):
        monkeypatch.delenv("SCREENER_52W_DELAY_SEC", raising=False)
        assert config.batch_delay_sec() == 0.35

    def test_batch_delay_env_override(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_DELAY_SEC", "1.0")
        assert config.batch_delay_sec() == 1.0

    def test_batch_delay_bad_value_falls_back(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_DELAY_SEC", "slow")
        assert config.batch_delay_sec() == 0.35

    def test_batch_delay_negative_falls_back(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_DELAY_SEC", "-0.5")
        assert config.batch_delay_sec() == 0.35

    @pytest.mark.parametrize(
        "env_name,reader,default",
        [
            ("SCREENER_52W_TOUCHED_GAP_PCT", config.touched_52w_gap_threshold_pct, 1.0),
            ("SCREENER_52W_TOUCH_EPS_PCT", config.touch_eps_pct, 0.5),
            ("SCREENER_RETEST_WINDOW_DAYS", config.retest_window_days, 5),
            ("SCREENER_52W_MIN_VOLUME_M", config.min_52w_volume_m, 0.0),
            ("SCREENER_52W_MIN_TURNOVER_CR", config.min_52w_turnover_cr, 0.5),
            ("SCREENER_52W_ENRICH_TOP", config.enrich_top_n, 80),
            ("SCREENER_TOUCH_BAND_GAP_PCT", config.touch_band_gap_pct, 5.0),
            ("SCREENER_TOUCH_LOOKBACK_TOP", config.touch_lookback_top, 120),
            ("SCREENER_52W_INTERVAL_SEC", config.batch_interval_sec, 3600),
            ("SCREENER_52W_STALE_SEC", config.job_stale_sec, 1800),
            ("SCREENER_52W_CACHE_TTL", config.cache_ttl_sec, 86400),
            ("SCREENER_52W_WORKERS", config.batch_workers, 3),
            ("SCREENER_52W_DELAY_SEC", config.batch_delay_sec, 0.35),
        ],
    )
    @pytest.mark.parametrize("bad", ["not-a-number", "-1", "-0.5"])
    def test_all_numeric_readers_fall_back(self, monkeypatch, env_name, reader, default, bad):
        monkeypatch.setenv(env_name, bad)
        assert reader() == default

    def test_zero_min_volume_is_honored(self, monkeypatch):
        monkeypatch.setenv("SCREENER_52W_MIN_VOLUME_M", "0")
        assert config.min_52w_volume_m() == 0.0

    @pytest.mark.parametrize(
        "env_name,reader,default",
        [
            ("SCREENER_52W_ENRICH_TOP", config.enrich_top_n, 80),
            ("SCREENER_52W_CACHE_TTL", config.cache_ttl_sec, 86400),
            ("SCREENER_RETEST_WINDOW_DAYS", config.retest_window_days, 5),
        ],
    )
    def test_fractional_int_env_value_falls_back(self, monkeypatch, env_name, reader, default):
        # Integer knobs accept whole-number strings only; "120.5" must not become 120.
        monkeypatch.setenv(env_name, "120.5")
        assert reader() == default

    def test_profiles_with_52w_buckets_owned_by_config(self):
        assert isinstance(config.PROFILES_WITH_52W_BUCKETS, set)
        assert config.PROFILES_WITH_52W_BUCKETS == {
            "trending",
            "near_52w_breakout",
            "touched_52w_high",
            "52w_high",
        }


class TestKeys:
    def test_per_symbol_format(self):
        assert keys.per_symbol("RELIANCE") == "52w_range:RELIANCE"

    def test_bulk_and_job_keys(self):
        assert keys.BULK == "52w_range:all"
        assert keys.JOB_STATUS == "52w_range:job_status"

    def test_range_ttl_is_daily(self):
        assert keys.RANGE_TTL == 24 * 60 * 60 == 86400

    def test_job_ttl_and_paper_cache_dir(self):
        assert keys.JOB_TTL == 86400 * 7
        assert keys.PAPER_52W_CACHE_DIR == "experiments/data/52w_cache"

    def test_prefix_matches_key_family(self):
        assert keys.BULK.startswith(keys.PREFIX)
        assert keys.JOB_STATUS.startswith(keys.PREFIX)
        assert keys.per_symbol("X").startswith(keys.PREFIX)


class TestPackageExports:
    def test_defaults_and_upsert_reexported_by_identity(self):
        assert week52.ChaserDefaults is defaults.ChaserDefaults
        assert week52.TargetDefaults is defaults.TargetDefaults
        assert week52.upsert_52w_ranges is upsert.upsert_52w_ranges
        for name in ("ChaserDefaults", "TargetDefaults", "upsert_52w_ranges"):
            assert name in week52.__all__

    def test_db_backed_exports_resolve_lazily_in_fresh_interpreter(self):
        code = """
import sys
import trading.week52 as pkg
assert "common.numbers" in sys.modules
assert not any(name == "api" or name.startswith("api.") for name in sys.modules)
assert pkg.ChaserDefaults.__name__ == "ChaserDefaults"
assert pkg.TargetDefaults.__name__ == "TargetDefaults"
for name in ("trading.week52.ranges", "trading.week52.upsert",
             "db.database", "db.models", "db.models.stock_52w_touch"):
    assert name not in sys.modules, name
resolved = pkg.get_52w_range
from trading.week52 import ranges
assert resolved is ranges.get_52w_range
assert "db.database" in sys.modules
assert "db.models" in sys.modules
assert "db.models.stock_52w_touch" in sys.modules
assert pkg.upsert_52w_ranges is sys.modules["trading.week52.upsert"].upsert_52w_ranges
"""
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr

    def test_dead_batch_max_wait_is_not_exported(self):
        assert not hasattr(config, "batch_max_wait_sec")
        assert not hasattr(week52, "batch_max_wait_sec")
        assert "batch_max_wait_sec" not in config.__all__
        assert "batch_max_wait_sec" not in week52.__all__

    def test_stale_default_sec_aliases_the_canonical_default(self):
        from trading.week52 import job

        assert job.STALE_DEFAULT_SEC == config.JOB_STALE_DEFAULT_SEC == 1800
        assert week52.STALE_DEFAULT_SEC is job.STALE_DEFAULT_SEC
