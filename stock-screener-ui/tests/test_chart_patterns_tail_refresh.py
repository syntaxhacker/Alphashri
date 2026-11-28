"""Tests for chart_patterns.tail_refresh (live chart tail merge/refresh)."""
from __future__ import annotations

import json
import pickle
import threading
import time
from datetime import datetime

import pandas as pd
import pytest

import market_data.market_data as md
from chart_patterns import candles
from chart_patterns import tail_refresh as tr
from trading.timezone import IST


NOW_OPEN = datetime(2026, 11, 6, 11, 0, tzinfo=IST)      # Friday, mid-session
NOW_CLOSED = datetime(2026, 11, 6, 16, 0, tzinfo=IST)    # Friday, after close
NOW_PREOPEN = datetime(2026, 11, 6, 8, 30, tzinfo=IST)
NOW_SATURDAY = datetime(2026, 11, 7, 11, 0, tzinfo=IST)


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(
        "trading.utils.is_trading_holiday", lambda *a, **k: False
    )
    monkeypatch.delenv("CHART_TAIL_REFRESH", raising=False)
    tr._reset_state()
    yield
    tr._reset_state()


def _intraday_frame(rows):
    """rows: [(iso_utc, open, high, low, close, volume), ...]."""
    index = pd.DatetimeIndex([pd.Timestamp(row[0], tz="UTC") for row in rows])
    return pd.DataFrame(
        {
            "open": [float(row[1]) for row in rows],
            "high": [float(row[2]) for row in rows],
            "low": [float(row[3]) for row in rows],
            "close": [float(row[4]) for row in rows],
            "volume": [float(row[5]) for row in rows],
        },
        index=index,
    )


def _bar(ts, close, volume=100.0):
    return (ts, close - 0.5, close + 0.5, close - 1.0, close, volume)


def _daily_bar(session: str, close: float = 100.0):
    # Daily bars carry the 18:30 UTC stamp of the previous calendar day.
    stamp = pd.Timestamp(f"{session} 18:30", tz="UTC") - pd.Timedelta(days=1)
    return pd.DataFrame(
        {
            "open": [close - 1.0],
            "high": [close + 1.0],
            "low": [close - 2.0],
            "close": [close],
            "volume": [1000.0],
        },
        index=pd.DatetimeIndex([stamp]),
    )


def _daily_frame(*sessions, start=100.0):
    return pd.concat(
        [_daily_bar(session, start + i) for i, session in enumerate(sessions)]
    )


def _cache_bytes(symbol="AAA", timeframe="15m"):
    path = candles._cache_path(timeframe, symbol)
    return path, path.read_bytes() if path.exists() else None


# ---------------------------------------------------------------------------
# merge_candle_tail
# ---------------------------------------------------------------------------

def test_merge_overlap_dedupes_and_newer_tail_wins():
    cached = _intraday_frame([
        _bar("2026-11-06 03:45", 100.0),
        _bar("2026-11-06 04:00", 101.0),
        _bar("2026-11-06 04:30", 102.0),
    ])
    tail = _intraday_frame([
        _bar("2026-11-06 04:00", 111.0),  # same timestamp, corrected close
        _bar("2026-11-06 04:15", 112.0),
    ])

    out = tr.merge_candle_tail(cached, tail)

    assert out.appended == 1
    assert out.updated == 1
    assert len(out.frame) == 4
    assert out.frame.index.is_monotonic_increasing
    assert not out.frame.index.has_duplicates
    assert out.frame.loc[pd.Timestamp("2026-11-06 04:00", tz="UTC"), "close"] == 111.0
    assert out.cache_through == cached.index[-1].to_pydatetime()
    assert out.latest_bar == out.frame.index[-1].to_pydatetime()
    assert out.provider_called is False
    assert out.error is None


def test_merge_utc_normalizes_mixed_timezones():
    cached = _intraday_frame([_bar("2026-11-06 03:45", 100.0)])
    cached.index = cached.index.tz_convert("Asia/Kolkata")
    tail = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])

    out = tr.merge_candle_tail(cached, tail)

    assert str(out.frame.index.tz) == "UTC"
    assert len(out.frame) == 2
    assert out.appended == 1


def test_merge_only_missing_tail_has_no_overlap():
    cached = _intraday_frame([
        _bar("2026-11-06 03:45", 100.0),
        _bar("2026-11-06 04:00", 101.0),
    ])
    tail = _intraday_frame([
        _bar("2026-11-06 04:15", 102.0),
        _bar("2026-11-06 04:30", 103.0),
    ])

    out = tr.merge_candle_tail(cached, tail)

    assert out.appended == 2
    assert out.updated == 0
    assert len(out.frame) == 4


def test_merge_is_null_safe():
    tail = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])

    empty = tr.merge_candle_tail(None, None)
    assert empty.frame.empty
    assert empty.appended == 0 and empty.updated == 0
    assert empty.cache_through is None and empty.latest_bar is None

    only_tail = tr.merge_candle_tail(None, tail)
    assert only_tail.appended == 1 and only_tail.updated == 0
    assert only_tail.cache_through is None
    assert only_tail.latest_bar == tail.index[-1].to_pydatetime()

    only_cached = tr.merge_candle_tail(tail, None)
    assert only_cached.appended == 0
    assert only_cached.latest_bar == tail.index[-1].to_pydatetime()


# ---------------------------------------------------------------------------
# fetch_live_tail: happy paths
# ---------------------------------------------------------------------------

def test_fetch_only_missing_tail_and_writes_atomically(monkeypatch):
    cached = _intraday_frame([
        _bar("2026-11-06 03:45", 100.0),
        _bar("2026-11-06 04:00", 101.0),
    ])
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe, kwargs))
        return _intraday_frame([
            _bar("2026-11-06 04:15", 102.0),
            _bar("2026-11-06 04:30", 103.0),
        ])

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)

    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    assert out.provider_called is True
    assert out.error is None
    assert out.appended == 2
    assert out.updated == 0
    assert len(out.frame) == 4
    assert calls[0][0] == "AAA" and calls[0][1] == "15m"
    # One target bar of overlap requested.
    assert calls[0][2]["from_date"] == "2026-11-06"
    assert calls[0][2]["to_date"] == "2026-11-06"

    path = candles._cache_path("15m", "AAA")
    with open(path, "rb") as handle:
        written = pickle.load(handle)
    assert len(written) == 4
    assert written.index[-1] == out.frame.index[-1]
    with open(path.with_suffix(".meta")) as handle:
        meta = json.load(handle)
    assert meta["ts"] > 0
    assert meta["session"] == "2026-11-05"


def test_fetch_overlap_updates_same_timestamp_and_newer_wins(monkeypatch):
    cached = _intraday_frame([
        _bar("2026-11-06 03:45", 100.0),
        _bar("2026-11-06 04:00", 101.0),
    ])
    monkeypatch.setattr(
        md,
        "fetch_candles_for_timeframe",
        lambda *a, **k: _intraday_frame([
            _bar("2026-11-06 04:00", 121.0),
            _bar("2026-11-06 04:15", 122.0),
        ]),
    )

    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    assert out.appended == 1
    assert out.updated == 1
    assert out.frame.loc[pd.Timestamp("2026-11-06 04:00", tz="UTC"), "close"] == 121.0
    path = candles._cache_path("15m", "AAA")
    with open(path, "rb") as handle:
        written = pickle.load(handle)
    assert written.loc[pd.Timestamp("2026-11-06 04:00", tz="UTC"), "close"] == 121.0


def test_fetch_no_new_bar_does_not_duplicate_and_advances_meta(monkeypatch):
    cached = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])
    path = candles._cache_path("15m", "AAA")
    candles._write_cached(path, cached, is_today=True)
    before_ts = json.loads(path.with_suffix(".meta").read_text())["ts"]

    # A provider tail that repeats only the cached bar (no net-new timestamp).
    monkeypatch.setattr(
        md, "fetch_candles_for_timeframe", lambda *a, **k: cached.copy()
    )

    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    assert out.provider_called is True
    assert out.appended == 0 and out.updated == 0
    assert out.error is None
    with open(path, "rb") as handle:
        written = pickle.load(handle)
    assert len(written) == 1
    assert written.index[-1] == cached.index[-1]
    after_ts = json.loads(path.with_suffix(".meta").read_text())["ts"]
    assert after_ts >= before_ts


def test_fetch_daily_during_session_never_returns_or_caches_partial_today(monkeypatch):
    cached = _daily_frame("2026-11-05", start=100.0)
    path = candles._cache_path("1D", "AAA")
    candles._write_cached(path, cached, is_today=True, session_pin="2026-11-05")
    seen_kwargs = {}

    # Provider restates yesterday and also carries today's in-progress bar.
    tail = pd.concat([
        _daily_bar("2026-11-05", 110.0),
        _daily_bar("2026-11-06", 120.0),
    ])

    def fake_fetch(symbol, timeframe, **kwargs):
        seen_kwargs.update(kwargs)
        return tail

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)

    out = tr.fetch_live_tail("AAA", "1D", cached, now=NOW_OPEN)

    assert "include_partial_today" not in seen_kwargs
    assert seen_kwargs.get("from_date") == "2026-11-04"
    assert seen_kwargs.get("to_date") == "2026-11-06"
    assert out.provider_called is True
    assert out.appended == 0
    assert out.updated == 1
    assert len(out.frame) == 1
    # The core/display contract keeps 1D completed-only; the display layer
    # appends today's synthetic bar itself.
    assert candles.frame_last_date(out.frame) == "2026-11-05"
    assert out.latest_bar == cached.index[-1].to_pydatetime()
    assert out.cache_through == cached.index[-1].to_pydatetime()

    with open(path, "rb") as handle:
        written = pickle.load(handle)
    assert len(written) == 1
    assert candles.frame_last_date(written) == "2026-11-05"
    assert candles.frame_last_date(written) != "2026-11-06"
    meta = json.loads(path.with_suffix(".meta").read_text())
    assert meta["session"] == "2026-11-05"


def test_after_close_returns_cached_without_provider(monkeypatch):
    cached = _daily_frame("2026-11-05", start=100.0)
    calls = []
    monkeypatch.setattr(
        md, "fetch_candles_for_timeframe", lambda *a, **k: calls.append(1)
    )

    out = tr.fetch_live_tail("AAA", "1D", cached, now=NOW_CLOSED)

    assert out.provider_called is False
    assert calls == []
    assert out.frame.equals(cached)
    assert out.error is None


# ---------------------------------------------------------------------------
# fetch_live_tail: provider failures / guards
# ---------------------------------------------------------------------------

def test_provider_failure_returns_cached_frame_with_error(monkeypatch):
    cached = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])
    path = candles._cache_path("15m", "AAA")
    candles._write_cached(path, cached, is_today=True)
    before = path.read_bytes()

    def boom(*args, **kwargs):
        raise RuntimeError("upstox down")

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", boom)

    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    assert out.provider_called is True
    assert "upstox down" in out.error
    assert out.appended == 0 and out.updated == 0
    assert out.frame.equals(cached)
    assert out.latest_bar == cached.index[-1].to_pydatetime()
    assert path.read_bytes() == before


def test_provider_last_bar_older_than_cache_is_ignored(monkeypatch):
    cached = _intraday_frame([
        _bar("2026-11-06 04:00", 101.0),
        _bar("2026-11-06 04:30", 105.0),
    ])
    path = candles._cache_path("15m", "AAA")
    candles._write_cached(path, cached, is_today=True)
    before = path.read_bytes()

    monkeypatch.setattr(
        md,
        "fetch_candles_for_timeframe",
        lambda *a, **k: _intraday_frame([
            _bar("2026-11-06 04:00", 201.0),
            _bar("2026-11-06 04:15", 202.0),
        ]),
    )

    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    assert out.provider_called is True
    assert out.appended == 0 and out.updated == 0
    assert out.error and "older" in out.error
    assert out.frame.equals(cached)
    assert path.read_bytes() == before


def test_kill_switch_returns_cached_without_provider(monkeypatch):
    cached = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])
    calls = []
    monkeypatch.setenv("CHART_TAIL_REFRESH", "0")
    monkeypatch.setattr(
        md, "fetch_candles_for_timeframe", lambda *a, **k: calls.append(1)
    )

    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    assert out.provider_called is False
    assert calls == []
    assert out.frame.equals(cached)
    assert out.error is None


def test_weekend_and_preopen_do_not_call_provider(monkeypatch):
    cached = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])
    calls = []
    monkeypatch.setattr(
        md, "fetch_candles_for_timeframe", lambda *a, **k: calls.append(1)
    )

    weekend = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_SATURDAY)
    preopen = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_PREOPEN)

    assert weekend.provider_called is False
    assert preopen.provider_called is False
    assert calls == []


def test_failure_cooldown_suppresses_repeat_provider_calls(monkeypatch):
    cached = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])
    calls = []

    def boom(*args, **kwargs):
        calls.append(1)
        raise RuntimeError("provider storm")

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", boom)

    first = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)
    second = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    assert first.provider_called is True
    assert second.provider_called is False
    assert len(calls) == 1
    assert second.frame.equals(cached)
    key = ("AAA", "15m")
    with tr._COOLDOWN_LOCK:
        state = tr._COOLDOWNS[key]
    assert state.failures == 1
    assert 0 < state.until - time.monotonic() <= tr.FAILURE_COOLDOWNS_SEC[0]


def test_failure_cooldown_escalates_and_resets_on_success(monkeypatch):
    cached = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])
    calls = []
    should_fail = {"value": True}

    def fetch(*args, **kwargs):
        calls.append(1)
        if should_fail["value"]:
            raise RuntimeError("still down")
        return _intraday_frame([_bar("2026-11-06 04:15", 102.0)])

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fetch)
    key = ("AAA", "15m")

    assert len(tr.FAILURE_COOLDOWNS_SEC) >= 4
    for expected_failures, expected_delay in zip((1, 2, 3, 4), tr.FAILURE_COOLDOWNS_SEC[:4]):
        if not tr._cooldown_active(key):
            tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)
        with tr._COOLDOWN_LOCK:
            state = tr._COOLDOWNS[key]
            remaining = state.until - time.monotonic()
        assert state.failures == expected_failures
        assert expected_delay - 1 <= remaining <= expected_delay
        with tr._COOLDOWN_LOCK:
            state.until = time.monotonic() - 1.0

    should_fail["value"] = False
    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)
    assert out.provider_called is True and out.appended == 1
    assert not tr._cooldown_active(key)
    assert key not in tr._COOLDOWNS
    assert len(calls) == 5


def test_concurrent_opens_share_one_provider_call(monkeypatch):
    cached = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])
    entered = threading.Event()
    release = threading.Event()
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe))
        entered.set()
        assert release.wait(5)
        return _intraday_frame([_bar("2026-11-06 04:15", 102.0)])

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)
    results = {}

    def run(name):
        results[name] = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    first = threading.Thread(target=run, args=("first",))
    second = threading.Thread(target=run, args=("second",))
    first.start()
    assert entered.wait(5)
    second.start()
    time.sleep(0.1)
    release.set()
    first.join(5)
    second.join(5)

    assert len(calls) == 1
    assert results["first"].provider_called is True
    assert results["second"].provider_called is True
    assert results["first"].latest_bar == results["second"].latest_bar


def test_provider_concurrency_is_bounded(monkeypatch):
    active = 0
    peak = 0
    lock = threading.Lock()
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            calls.append(symbol)
        time.sleep(0.02)
        with lock:
            active -= 1
        return _intraday_frame([_bar("2026-11-06 04:15", 102.0)])

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)
    cached = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])

    threads = [
        threading.Thread(
            target=tr.fetch_live_tail,
            args=(f"SYM{i}", "15m", cached),
            kwargs={"now": NOW_OPEN},
        )
        for i in range(8)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(5)

    assert len(calls) == 8
    assert 1 <= peak <= 5


def test_unsupported_period_timeframe_returns_cached_without_fetch(monkeypatch):
    cached = _daily_frame("2026-11-05")
    calls = []
    monkeypatch.setattr(
        md, "fetch_candles_for_timeframe", lambda *a, **k: calls.append(1)
    )

    out = tr.fetch_live_tail("AAA", "1W", cached, now=NOW_OPEN)

    assert out.provider_called is False
    assert calls == []
    assert out.frame.equals(cached)


# ---------------------------------------------------------------------------
# Adversarial regressions: exact cache entry + same-timestamp lost update
# ---------------------------------------------------------------------------

def test_variant_cache_path_roundtrip_appends_only_genuinely_new_bars(monkeypatch):
    """The API serves an ``lb{N}`` entry, so the tail must refresh that file.

    Two chart opens against a stale default cache used to each report six
    appended bars because the tail kept writing the default entry. The second
    open must re-read the variant and find no new bars.
    """
    variant = "lb500"
    path = candles._cache_path("15m", "AAA", variant=variant)
    default_path = candles._cache_path("15m", "AAA")
    cached = _intraday_frame([
        _bar("2026-11-06 04:00", 100.0),
        _bar("2026-11-06 04:15", 101.0),
        _bar("2026-11-06 04:30", 102.0),
        _bar("2026-11-06 04:44", 103.0),
    ])
    candles._write_cached(path, cached, is_today=True)
    stale_default = _intraday_frame([_bar("2026-11-06 03:45", 99.0)])
    candles._write_cached(default_path, stale_default, is_today=True)

    tail = _intraday_frame([
        _bar("2026-11-06 04:30", 102.0),   # overlap
        *[_bar(f"2026-11-06 04:{minute:02d}", 110.0 + i)
          for i, minute in enumerate((45, 50))],
    ])
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        calls.append(kwargs)
        return tail

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)

    first = tr.fetch_live_tail(
        "AAA", "15m", cached, now=NOW_OPEN, cache_path=path
    )
    assert first.provider_called is True
    assert first.appended == 2 and first.updated == 0

    with open(path, "rb") as handle:
        after_first = pickle.load(handle)
    assert len(after_first) == len(cached) + 2
    assert after_first.index[-1] == tail.index[-1]
    assert path.with_suffix(".meta").exists()
    # The exact supplied entry is written; the default is not silently changed.
    with open(default_path, "rb") as handle:
        assert len(pickle.load(handle)) == len(stale_default)

    # A second chart open re-reads the variant it was served from.
    second = tr.fetch_live_tail(
        "AAA", "15m", after_first, now=NOW_OPEN, cache_path=path
    )
    assert second.provider_called is True
    assert second.appended == 0 and second.updated == 0
    assert second.latest_bar == tail.index[-1].to_pydatetime()
    with open(path, "rb") as handle:
        after_second = pickle.load(handle)
    assert len(after_second) == len(after_first)
    assert after_second.index.equals(after_first.index)


def test_same_last_timestamp_tail_cannot_clobber_disk_correction(monkeypatch):
    """An equal last bar cannot prove recency; the on-disk OHLC wins.

    A slower tail still carrying close=100 at 05:44 must not overwrite a newer
    on-disk correction of close=200 at that same last timestamp — neither on
    disk nor in the frame handed back to the API for its label.
    """
    stamp = "2026-11-06 04:44"
    cached = _intraday_frame([
        _bar("2026-11-06 04:30", 100.0),
        _bar(stamp, 100.0),
    ])
    path = candles._cache_path("15m", "AAA")
    disk = _intraday_frame([
        _bar("2026-11-06 04:30", 100.0),
        _bar(stamp, 200.0),
    ])
    candles._write_cached(path, disk, is_today=True)

    monkeypatch.setattr(
        md,
        "fetch_candles_for_timeframe",
        lambda *a, **k: _intraday_frame([_bar(stamp, 100.0)]),
    )

    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    bar = pd.Timestamp(stamp, tz="UTC")
    assert out.provider_called is True
    assert out.appended == 0
    assert out.frame.loc[bar, "close"] == 200.0
    assert out.latest_bar == bar.to_pydatetime()
    with open(path, "rb") as handle:
        written = pickle.load(handle)
    assert written.loc[bar, "close"] == 200.0
    assert len(written) == 2


def test_same_last_timestamp_correction_lands_when_disk_matches_snapshot(monkeypatch):
    """The recency marker must not freeze legitimate provider corrections."""
    stamp = "2026-11-06 04:44"
    cached = _intraday_frame([
        _bar("2026-11-06 04:30", 100.0),
        _bar(stamp, 100.0),
    ])
    path = candles._cache_path("15m", "AAA")
    candles._write_cached(path, cached, is_today=True)
    monkeypatch.setattr(
        md,
        "fetch_candles_for_timeframe",
        lambda *a, **k: _intraday_frame([_bar(stamp, 150.0)]),
    )

    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    bar = pd.Timestamp(stamp, tz="UTC")
    assert out.appended == 0 and out.updated == 1
    assert out.frame.loc[bar, "close"] == 150.0
    with open(path, "rb") as handle:
        assert pickle.load(handle).loc[bar, "close"] == 150.0


def test_strictly_newer_disk_frame_is_returned_and_left_untouched(monkeypatch):
    """A stale tail whose last bar predates the disk entry is never written."""
    cached = _intraday_frame([_bar("2026-11-06 04:00", 100.0)])
    path = candles._cache_path("15m", "AAA")
    disk = _intraday_frame([
        _bar("2026-11-06 04:00", 100.0),
        _bar("2026-11-06 04:30", 200.0),
    ])
    candles._write_cached(path, disk, is_today=True)
    before = path.read_bytes()

    monkeypatch.setattr(
        md,
        "fetch_candles_for_timeframe",
        lambda *a, **k: _intraday_frame([_bar("2026-11-06 04:15", 120.0)]),
    )

    out = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    assert out.provider_called is True
    assert out.frame.equals(disk)
    assert out.latest_bar == disk.index[-1].to_pydatetime()
    assert path.read_bytes() == before


def test_provider_called_false_on_kill_closed_and_cooldown(monkeypatch):
    """Labels are driven by ``provider_called``: guards must report no call."""
    cached = _intraday_frame([_bar("2026-11-06 04:00", 101.0)])
    calls = []

    def boom(*args, **kwargs):
        calls.append(1)
        raise RuntimeError("feed down")

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", boom)

    monkeypatch.setenv("CHART_TAIL_REFRESH", "0")
    killed = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)
    monkeypatch.delenv("CHART_TAIL_REFRESH")
    closed = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_CLOSED)
    first = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)
    cooled = tr.fetch_live_tail("AAA", "15m", cached, now=NOW_OPEN)

    assert killed.provider_called is False
    assert closed.provider_called is False
    assert first.provider_called is True
    assert cooled.provider_called is False
    assert len(calls) == 1
    for result in (killed, closed, cooled):
        assert result.appended == 0 and result.updated == 0
        assert result.frame.equals(cached)
