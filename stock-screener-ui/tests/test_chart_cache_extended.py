"""
Chart Cache TTL Tests.

Extended tests for api/paper/chart_cache.py — TTL logic, meta files,
timeframe-keyed cache, corrupt files, and _is_today helper.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import json
import time
import pickle
import pytest
import pandas as pd


@pytest.fixture
def cache_dir(tmp_path):
    return tmp_path


@pytest.fixture
def patched_cache(cache_dir, monkeypatch):
    import api.paper.chart_cache as mod
    monkeypatch.setattr(mod, "CACHE_DIR", cache_dir)
    monkeypatch.setattr(mod, "TODAY_TTL_SECONDS", 60)
    return mod, cache_dir


def _sample_df(rows=3):
    return pd.DataFrame({
        "open": [100.0 + i for i in range(rows)],
        "high": [102.0 + i for i in range(rows)],
        "low": [99.0 + i for i in range(rows)],
        "close": [101.0 + i for i in range(rows)],
        "volume": [1000 + i * 100 for i in range(rows)],
    }, index=pd.date_range("2026-04-28 09:15", periods=rows, freq="1min"))


@pytest.mark.unit
class TestIsToday:
    """_is_today() helper — compares date string to today in IST."""

    def test_is_today_returns_true_for_today(self, patched_cache):
        mod, _ = patched_cache
        from datetime import datetime
        import config
        today = datetime.now(config.IST).strftime('%Y-%m-%d')
        assert mod._is_today(today) is True

    def test_is_today_returns_false_for_yesterday(self, patched_cache):
        mod, _ = patched_cache
        from datetime import datetime, timedelta
        import config
        yesterday = (datetime.now(config.IST) - timedelta(days=1)).strftime('%Y-%m-%d')
        assert mod._is_today(yesterday) is False

    def test_is_today_returns_false_for_future_date(self, patched_cache):
        mod, _ = patched_cache
        assert mod._is_today("2099-12-31") is False

    def test_is_today_returns_false_for_past_date(self, patched_cache):
        mod, _ = patched_cache
        assert mod._is_today("2020-01-01") is False


@pytest.mark.unit
class TestMetaFileRoundtrip:
    """_write_meta / _read_meta roundtrip and edge cases."""

    def test_write_then_read_meta(self, patched_cache, tmp_path):
        mod, _ = patched_cache
        pkl_path = tmp_path / "TEST.pkl"
        pkl_path.write_bytes(b"dummy")

        mod._write_meta(pkl_path)
        meta = mod._read_meta(pkl_path)

        assert "ts" in meta
        assert isinstance(meta["ts"], float)
        assert meta["ts"] > 0

    def test_read_meta_returns_empty_dict_for_missing_file(self, patched_cache, tmp_path):
        mod, _ = patched_cache
        missing = tmp_path / "nope.pkl"
        meta = mod._read_meta(missing)
        assert meta == {}

    def test_read_meta_returns_empty_dict_for_corrupt_meta(self, patched_cache, tmp_path):
        mod, _ = patched_cache
        pkl_path = tmp_path / "TEST.pkl"
        pkl_path.write_bytes(b"dummy")
        meta_path = mod._get_meta_path(pkl_path)
        meta_path.write_text("not valid json {{{")

        meta = mod._read_meta(pkl_path)
        assert meta == {}

    def test_meta_path_has_meta_extension(self, patched_cache, tmp_path):
        mod, _ = patched_cache
        pkl_path = tmp_path / "RELIANCE.pkl"
        meta_path = mod._get_meta_path(pkl_path)
        assert meta_path.suffix == ".meta"
        assert meta_path.name == "RELIANCE.meta"


@pytest.mark.unit
class TestTTLForToday:
    """Today's cached data respects 60-second TTL."""

    def test_fresh_meta_returns_cached(self, patched_cache, monkeypatch):
        mod, cache_dir = patched_cache
        from datetime import datetime
        import config
        today = datetime.now(config.IST).strftime('%Y-%m-%d')

        df = _sample_df()
        mod.save_cached_candles("RELIANCE", today, df)

        result, is_cached = mod.get_cached_candles("RELIANCE", today)
        assert result is not None
        assert is_cached is True

    def test_expired_meta_returns_none(self, patched_cache, monkeypatch):
        mod, cache_dir = patched_cache
        from datetime import datetime
        import config
        today = datetime.now(config.IST).strftime('%Y-%m-%d')

        df = _sample_df()
        mod.save_cached_candles("RELIANCE", today, df)

        # Overwrite meta with old timestamp (120 seconds ago)
        pkl_path = cache_dir / today / "RELIANCE.pkl"
        meta_path = mod._get_meta_path(pkl_path)
        meta_path.write_text(json.dumps({"ts": time.time() - 120}))

        result, is_cached = mod.get_cached_candles("RELIANCE", today)
        assert result is None
        assert is_cached is False

    def test_no_meta_file_returns_none_for_today(self, patched_cache):
        mod, cache_dir = patched_cache
        from datetime import datetime
        import config
        today = datetime.now(config.IST).strftime('%Y-%m-%d')

        df = _sample_df()
        mod.save_cached_candles("RELIANCE", today, df)

        # Delete the meta file
        pkl_path = cache_dir / today / "RELIANCE.pkl"
        meta_path = mod._get_meta_path(pkl_path)
        meta_path.unlink()

        result, is_cached = mod.get_cached_candles("RELIANCE", today)
        assert result is None
        assert is_cached is False

    def test_meta_with_ts_zero_returns_none_for_today(self, patched_cache):
        mod, cache_dir = patched_cache
        from datetime import datetime
        import config
        today = datetime.now(config.IST).strftime('%Y-%m-%d')

        df = _sample_df()
        mod.save_cached_candles("RELIANCE", today, df)

        # Overwrite meta with ts=0 (epoch)
        pkl_path = cache_dir / today / "RELIANCE.pkl"
        meta_path = mod._get_meta_path(pkl_path)
        meta_path.write_text(json.dumps({"ts": 0}))

        result, is_cached = mod.get_cached_candles("RELIANCE", today)
        assert result is None
        assert is_cached is False


@pytest.mark.unit
class TestHistoricalNoTTL:
    """Historical (non-today) dates always return cached data — no TTL."""

    def test_historical_date_always_returns_cached(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"

        df = _sample_df()
        mod.save_cached_candles("RELIANCE", date, df)

        result, is_cached = mod.get_cached_candles("RELIANCE", date)
        assert result is not None
        assert is_cached is True
        pd.testing.assert_frame_equal(result, df)

    def test_historical_date_no_meta_still_returns_cached(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"

        df = _sample_df()
        mod.save_cached_candles("RELIANCE", date, df)

        # Delete meta — historical dates don't check meta
        pkl_path = cache_dir / date / "RELIANCE.pkl"
        meta_path = mod._get_meta_path(pkl_path)
        if meta_path.exists():
            meta_path.unlink()

        result, is_cached = mod.get_cached_candles("RELIANCE", date)
        assert result is not None
        assert is_cached is True

    def test_historical_date_old_meta_still_returns_cached(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"

        df = _sample_df()
        mod.save_cached_candles("RELIANCE", date, df)

        # Write an old meta — historical dates skip TTL check
        pkl_path = cache_dir / date / "RELIANCE.pkl"
        meta_path = mod._get_meta_path(pkl_path)
        meta_path.write_text(json.dumps({"ts": time.time() - 999999}))

        result, is_cached = mod.get_cached_candles("RELIANCE", date)
        assert result is not None
        assert is_cached is True


@pytest.mark.unit
class TestTimeframeInCacheKey:
    """Cache keys include timeframe suffix to separate different TFs."""

    def test_save_with_timeframe_creates_tf_keyed_file(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"
        df = _sample_df()

        mod.save_cached_candles("RELIANCE", date, df, timeframe="5min")

        expected = cache_dir / date / "RELIANCE_5min.pkl"
        assert expected.exists()

    def test_save_without_timeframe_creates_plain_file(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"
        df = _sample_df()

        mod.save_cached_candles("RELIANCE", date, df)

        expected = cache_dir / date / "RELIANCE.pkl"
        assert expected.exists()

    def test_different_timeframes_coexist(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"

        df_1m = _sample_df(rows=5)
        df_5m = _sample_df(rows=3)

        mod.save_cached_candles("RELIANCE", date, df_1m)
        mod.save_cached_candles("RELIANCE", date, df_5m, timeframe="5min")

        r1, c1 = mod.get_cached_candles("RELIANCE", date)
        r5, c5 = mod.get_cached_candles("RELIANCE", date, timeframe="5min")

        assert c1 is True
        assert c5 is True
        assert len(r1) == 5
        assert len(r5) == 3

    def test_get_with_wrong_timeframe_returns_none(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"
        df = _sample_df()

        mod.save_cached_candles("RELIANCE", date, df, timeframe="5min")

        result, is_cached = mod.get_cached_candles("RELIANCE", date, timeframe="15min")
        assert result is None
        assert is_cached is False

    def test_timeframe_key_is_case_sensitive_on_symbol(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"
        df = _sample_df()

        mod.save_cached_candles("reliance", date, df, timeframe="5min")

        # Symbol is uppercased internally
        result, is_cached = mod.get_cached_candles("RELIANCE", date, timeframe="5min")
        assert result is not None
        assert is_cached is True


@pytest.mark.unit
class TestCorruptEdgeCases:
    """Corrupt pickle, empty DataFrame, and other edge cases."""

    def test_corrupt_pickle_returns_none(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"
        pkl_path = cache_dir / date / "RELIANCE.pkl"
        pkl_path.parent.mkdir(parents=True, exist_ok=True)
        pkl_path.write_bytes(b"this is not a pickle")

        result, is_cached = mod.get_cached_candles("RELIANCE", date)
        assert result is None
        assert is_cached is False

    def test_pickle_with_non_dataframe_returns_none(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"
        pkl_path = cache_dir / date / "RELIANCE.pkl"
        pkl_path.parent.mkdir(parents=True, exist_ok=True)
        with open(pkl_path, "wb") as f:
            pickle.dump({"not": "a dataframe"}, f)

        result, is_cached = mod.get_cached_candles("RELIANCE", date)
        assert result is None
        assert is_cached is False

    def test_empty_dataframe_not_saved(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"

        mod.save_cached_candles("RELIANCE", date, pd.DataFrame())

        pkl_path = cache_dir / date / "RELIANCE.pkl"
        assert not pkl_path.exists()

    def test_none_dataframe_not_saved(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"

        mod.save_cached_candles("RELIANCE", date, None)

        pkl_path = cache_dir / date / "RELIANCE.pkl"
        assert not pkl_path.exists()

    def test_save_creates_parent_directory(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-28"
        df = _sample_df()

        mod.save_cached_candles("TCS", date, df)

        assert (cache_dir / date / "TCS.pkl").exists()

    def test_today_meta_file_written_on_save(self, patched_cache):
        mod, cache_dir = patched_cache
        from datetime import datetime
        import config
        today = datetime.now(config.IST).strftime('%Y-%m-%d')

        df = _sample_df()
        mod.save_cached_candles("INFY", today, df)

        pkl_path = cache_dir / today / "INFY.pkl"
        meta_path = mod._get_meta_path(pkl_path)
        assert meta_path.exists()

        meta = json.loads(meta_path.read_text())
        assert "ts" in meta
        assert meta["ts"] > time.time() - 5  # written within last 5 seconds

    def test_historical_meta_not_written_on_save(self, patched_cache):
        mod, cache_dir = patched_cache
        date = "2026-04-15"

        df = _sample_df()
        mod.save_cached_candles("INFY", date, df)

        pkl_path = cache_dir / date / "INFY.pkl"
        meta_path = mod._get_meta_path(pkl_path)
        assert not meta_path.exists()
