"""Lane-2 units: US session clock + namespaced US candle cache.

Both modules are pure/local: no Upstox, yfinance, DB, or API process involved.
"""
from __future__ import annotations

import json
import os
import pickle
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

from chart_patterns import us_cache
from market_data.providers import sessions


def _et(year, month, day, hour=0, minute=0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=sessions.ET)



def test_now_et_converts_utc_and_interprets_naive_as_et():
    assert sessions.now_et(datetime(2026, 11, 17, 5, 0, tzinfo=timezone.utc)) == _et(2026, 11, 17)
    assert sessions.now_et(datetime(2026, 11, 17, 5, 0, tzinfo=timezone.utc)).utcoffset() == timedelta(hours=-5)
    # EDT in July: 04:00 UTC == midnight ET.
    summer = sessions.now_et(datetime(2026, 7, 1, 4, 0, tzinfo=timezone.utc))
    assert summer == _et(2026, 7, 1) and summer.utcoffset() == timedelta(hours=-4)
    naive = sessions.now_et(datetime(2026, 11, 17, 9, 30))
    assert naive.utcoffset() == timedelta(hours=-5) and naive.hour == 9


@pytest.mark.parametrize("hour,minute,expected", [
    (9, 29, False), (9, 30, True), (12, 0, True), (15, 59, True),
    (16, 0, False), (16, 1, False),
])
def test_is_us_open_hour_boundaries(hour, minute, expected):
    assert sessions.is_us_open(_et(2026, 11, 17, hour, minute)) is expected


def test_is_us_open_weekend_and_holiday():
    assert not sessions.is_us_open(_et(2026, 11, 21, 10, 0))  # Saturday
    assert not sessions.is_us_open(_et(2026, 11, 22, 10, 0))  # Sunday
    assert not sessions.is_us_open(_et(2026, 11, 26, 10, 0))  # Thanksgiving
    assert not sessions.is_us_open(_et(2026, 7, 3, 10, 0))    # Jul 4 observed
    assert sessions.is_us_open(_et(2026, 7, 2, 10, 0))        # normal Thu


def test_dst_fall_back_repeated_hour_in_november():
    # 05:00 UTC -> 01:00 EDT (-04:00); 06:00 UTC -> 01:00 EST (-05:00).
    first = sessions.now_et(datetime(2026, 11, 1, 5, 0, tzinfo=timezone.utc))
    second = sessions.now_et(datetime(2026, 11, 1, 6, 0, tzinfo=timezone.utc))
    assert first.hour == second.hour == 1
    assert first.utcoffset() == timedelta(hours=-4)
    assert second.utcoffset() == timedelta(hours=-5)
    assert sessions.is_us_open(_et(2026, 11, 2, 14, 30))  # Monday after the switch


def test_session_date_around_midnight_utc_and_et():
    # EST: 04:59 UTC -> 23:59 ET the previous day; 05:00 UTC -> midnight.
    assert sessions.session_date(datetime(2026, 11, 17, 4, 59, tzinfo=timezone.utc)) == "2026-11-16"
    assert sessions.session_date(datetime(2026, 11, 17, 5, 0, tzinfo=timezone.utc)) == "2026-11-17"
    # EDT: the boundary is an hour earlier in UTC.
    assert sessions.session_date(datetime(2026, 7, 1, 3, 59, tzinfo=timezone.utc)) == "2026-06-30"
    assert sessions.session_date(datetime(2026, 7, 1, 4, 0, tzinfo=timezone.utc)) == "2026-07-01"


def test_session_date_pins_to_previous_session_on_weekend_and_holiday():
    assert sessions.session_date(_et(2026, 11, 21, 10, 0)) == "2026-11-20"  # Sat -> Fri
    assert sessions.session_date(_et(2026, 11, 22, 10, 0)) == "2026-11-20"  # Sun -> Fri
    assert sessions.session_date(_et(2026, 11, 26, 10, 0)) == "2026-11-25"  # Thanksgiving -> Wed
    assert sessions.session_date(_et(2026, 11, 17, 8, 0)) == "2026-11-17"   # pre-open still today


@pytest.mark.parametrize("value,expected", [
    ("2026-11-17", True),
    ("2026-11-21", False),
    ("2026-11-26", False),
    ("17-11-2026", False),
    ("2026-11-17T10:00", False),
    ("garbage", False),
    (None, False),
    (123, False),
])
def test_is_us_session_date_validation(value, expected):
    assert sessions.is_us_session_date(value) is expected
    if isinstance(value, date):
        assert sessions.is_us_session_date(value) is expected


def test_previous_us_session_walks_weekends_and_holidays():
    assert sessions.previous_us_session("2026-11-16") == date(2026, 11, 13)  # Mon -> Fri
    assert sessions.previous_us_session("2026-11-27") == date(2026, 11, 25)  # skip Thanksgiving
    with pytest.raises(ValueError):
        sessions.previous_us_session("bad-date")



@pytest.fixture
def cache_dir(tmp_path, monkeypatch):
    path = tmp_path / "us_chart_cache"
    monkeypatch.setattr(us_cache, "CACHE_DIR", path)
    return path


@pytest.fixture
def clock(monkeypatch):
    state = {"open": False, "session": "2026-11-17"}
    monkeypatch.setattr(us_cache, "is_us_open", lambda: state["open"])
    monkeypatch.setattr(us_cache, "session_date", lambda: state["session"])
    return state


def _frame(n=3) -> pd.DataFrame:
    idx = pd.date_range("2026-11-17 14:00", periods=n, freq="min", tz="UTC")
    return pd.DataFrame(
        {
            "open": [100.0 + i for i in range(n)],
            "high": [101.0 + i for i in range(n)],
            "low": [99.0 + i for i in range(n)],
            "close": [100.5 + i for i in range(n)],
            "volume": [1000.0] * n,
        },
        index=idx,
    )


def _rewrite_meta(path: Path, **updates) -> None:
    data = json.loads(path.read_text())
    data.update(updates)
    path.write_text(json.dumps(data))


def test_round_trip_and_key_namespacing(cache_dir, clock):
    frame = _frame()
    us_cache.put_us_candles("AAPL", "1m", frame)

    pkl = cache_dir / "1m" / "AAPL.usa.v1.pkl"
    meta = cache_dir / "1m" / "AAPL.usa.v1.meta"
    assert pkl.is_file() and meta.is_file()
    stored = json.loads(meta.read_text())
    assert stored["market"] == "usa"
    assert stored["version"] == us_cache.CACHE_VERSION
    assert stored["session"] == "2026-11-17"

    pd.testing.assert_frame_equal(us_cache.get_us_candles("AAPL", "1m"), frame)


def test_symbol_and_timeframe_are_normalised(cache_dir, clock):
    us_cache.put_us_candles("aapl", "1d", _frame())
    assert (cache_dir / "1D" / "AAPL.usa.v1.pkl").is_file()
    assert us_cache.get_us_candles("AAPL", "1D") is not None


def test_ttl_open_vs_closed_session_pin(cache_dir, clock):
    us_cache.put_us_candles("MSFT", "5m", _frame())
    pkl = cache_dir / "5m" / "MSFT.usa.v1.pkl"
    meta = pkl.with_suffix(".meta")

    clock["open"] = True
    _rewrite_meta(meta, ts=time.time() - 10)
    assert us_cache.get_us_candles("MSFT", "5m") is not None
    _rewrite_meta(meta, ts=time.time() - (us_cache.TTL_SECONDS + 15))
    assert us_cache.get_us_candles("MSFT", "5m") is None  # expired while open

    clock["open"] = False
    _rewrite_meta(meta, ts=time.time() - 7200)  # age is irrelevant once closed
    assert us_cache.get_us_candles("MSFT", "5m") is not None
    clock["session"] = "2026-11-18"
    assert us_cache.get_us_candles("MSFT", "5m") is None  # pinned to prior session


def test_corrupt_pickle_or_meta_is_miss(cache_dir, clock):
    us_cache.put_us_candles("NVDA", "1h", _frame())
    pkl = cache_dir / "1h" / "NVDA.usa.v1.pkl"
    pkl.write_bytes(b"not a pickle")
    assert us_cache.get_us_candles("NVDA", "1h") is None

    us_cache.put_us_candles("NVDA", "1h", _frame())
    pkl.with_suffix(".meta").write_text("not json")
    assert us_cache.get_us_candles("NVDA", "1h") is None


@pytest.mark.parametrize("symbol", [
    "../../etc/passwd", "AAPL/../../x", "..", "A B", "", "A" * 25, "AAPL\\evil",
])
def test_symbol_key_rejects_path_traversal(cache_dir, symbol):
    with pytest.raises(ValueError):
        us_cache.get_us_candles(symbol, "1m")
    with pytest.raises(ValueError):
        us_cache.put_us_candles(symbol, "1m", _frame())


@pytest.mark.parametrize("tf", ["../secret", "1W", "", "1m/../../x"])
def test_timeframe_key_rejects_path_traversal(cache_dir, tf):
    with pytest.raises(ValueError):
        us_cache.get_us_candles("AAPL", tf)
    with pytest.raises(ValueError):
        us_cache.put_us_candles("AAPL", tf, _frame())


def test_no_file_escapes_cache_dir(cache_dir, tmp_path):
    us_cache.put_us_candles("AAPL", "1m", _frame())
    files = list(tmp_path.rglob("*"))
    assert not any(f.name == "passwd" for f in files)
    assert all(cache_dir in f.parents for f in files if f.is_file())


def test_writes_are_atomic_and_leave_no_temp_files(cache_dir, clock, monkeypatch):
    original = os.replace
    calls = []

    def tracking_replace(src, dst):
        calls.append((Path(src), Path(dst)))
        return original(src, dst)

    monkeypatch.setattr(us_cache, "_replace", tracking_replace)
    us_cache.put_us_candles("AAPL", "1m", _frame())
    us_cache.put_us_candles("TSLA", "15m", _frame())

    assert len(calls) == 4  # pkl + meta for each symbol
    assert all(src.name.startswith(".tmp-") and src.suffix == ".part" for src, _ in calls)
    assert {dst.name for _, dst in calls} == {
        "AAPL.usa.v1.pkl", "AAPL.usa.v1.meta",
        "TSLA.usa.v1.pkl", "TSLA.usa.v1.meta",
    }
    assert not list(cache_dir.rglob(".tmp-*.part"))


def test_negative_cache_and_invalidation(cache_dir, clock):
    us_cache.put_us_candles("NOPE", "1m", None)
    neg = cache_dir / "1m" / "NOPE.usa.v1.empty.json"
    assert neg.is_file()
    assert us_cache.get_us_candles("NOPE", "1m") is None

    # An empty frame is treated the same as no data.
    us_cache.put_us_candles("EMPTY", "1m", pd.DataFrame())
    assert (cache_dir / "1m" / "EMPTY.usa.v1.empty.json").is_file()

    # A later successful fetch clears the negative marker and is served.
    us_cache.put_us_candles("NOPE", "1m", _frame())
    assert not neg.exists()
    assert us_cache.get_us_candles("NOPE", "1m") is not None


def test_expired_or_corrupt_negative_marker_is_ignored(cache_dir, clock):
    us_cache.put_us_candles("NOPE", "1m", None)
    neg = cache_dir / "1m" / "NOPE.usa.v1.empty.json"
    _rewrite_meta(neg, ts=time.time() - (us_cache.NEGATIVE_TTL_SECONDS + 15))
    assert us_cache.get_us_candles("NOPE", "1m") is None
    assert not neg.exists()  # stale marker is pruned on read

    us_cache.put_us_candles("BAD", "1m", None)
    (cache_dir / "1m" / "BAD.usa.v1.empty.json").write_text("garbage")
    assert us_cache.get_us_candles("BAD", "1m") is None


def test_clear_us_cache_filters(cache_dir, clock):
    us_cache.put_us_candles("AAPL", "1m", _frame())
    us_cache.put_us_candles("AAPL", "5m", _frame())
    us_cache.put_us_candles("TSLA", "1m", _frame())
    us_cache.put_us_candles("NOPE", "1m", None)

    assert us_cache.clear_us_cache(symbols="TSLA") == 2  # pkl + meta
    assert us_cache.get_us_candles("AAPL", "1m") is not None
    assert us_cache.clear_us_cache(timeframe="5m") == 2
    assert us_cache.clear_us_cache() > 0
    assert not any(p.is_file() for p in cache_dir.rglob("*"))
