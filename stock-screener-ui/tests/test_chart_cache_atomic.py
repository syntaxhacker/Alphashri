"""Atomic cache-write tests for chart_patterns.candles / tail_refresh."""
from __future__ import annotations

import pickle
from datetime import datetime

import pandas as pd
import pytest

import market_data.market_data as md
from chart_patterns import candles
from chart_patterns import tail_refresh as tr
from trading.timezone import IST


NOW_OPEN = datetime(2026, 11, 6, 11, 0, tzinfo=IST)


def _frame(last="2026-11-06 04:00", close=101.0):
    index = pd.DatetimeIndex([pd.Timestamp(last, tz="UTC")])
    return pd.DataFrame(
        {
            "open": [close - 0.5],
            "high": [close + 0.5],
            "low": [close - 1.0],
            "close": [close],
            "volume": [100.0],
        },
        index=index,
    )


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(
        "trading.utils.is_trading_holiday", lambda *a, **k: False
    )
    tr._reset_state()
    yield
    tr._reset_state()


def test_atomic_write_roundtrip_and_no_temp_left(tmp_path):
    path = tmp_path / "nested" / "AAA.v1.pkl"
    frame = _frame()

    tr.atomic_write_pickle(path, frame)

    with open(path, "rb") as handle:
        assert pickle.load(handle).equals(frame)
    assert not list(path.parent.glob("*.tmp"))


def test_atomic_write_failure_keeps_old_file_and_cleans_temp(tmp_path, monkeypatch):
    path = tmp_path / "AAA.pkl"
    old = _frame(close=100.0)
    tr.atomic_write_pickle(path, old)
    old_bytes = path.read_bytes()

    def fail_replace(src, dst):
        raise OSError("disk gone")

    monkeypatch.setattr(tr.os, "replace", fail_replace)

    with pytest.raises(OSError):
        tr.atomic_write_pickle(path, _frame(close=200.0))

    assert path.read_bytes() == old_bytes
    assert not list(tmp_path.glob("*.tmp"))


def test_pickle_dump_failure_keeps_old_file_and_cleans_temp(tmp_path, monkeypatch):
    path = tmp_path / "AAA.pkl"
    old = _frame(close=100.0)
    tr.atomic_write_pickle(path, old)
    old_bytes = path.read_bytes()

    def fail_dump(*args, **kwargs):
        raise RuntimeError("cannot pickle")

    monkeypatch.setattr(candles.pickle, "dump", fail_dump)

    with pytest.raises(RuntimeError):
        tr.atomic_write_pickle(path, _frame(close=200.0))

    assert path.read_bytes() == old_bytes
    assert not list(tmp_path.glob("*.tmp"))


def test_write_cached_is_atomic_and_keeps_meta(tmp_path):
    path = candles._cache_path("15m", "AAA")
    frame = _frame()

    candles._write_cached(path, frame, is_today=True)

    with open(path, "rb") as handle:
        assert pickle.load(handle).equals(frame)
    assert path.with_suffix(".meta").exists()
    assert not list(path.parent.glob("*.tmp"))


def test_variant_tail_write_is_atomic_and_leaves_no_temp(monkeypatch):
    path = candles._cache_path("15m", "AAA", variant="lb500")
    cached = _frame()
    candles._write_cached(path, cached, is_today=True)

    new_bar = _frame(last="2026-11-06 04:15", close=110.0)
    tail = pd.concat([cached, new_bar])
    monkeypatch.setattr(
        md, "fetch_candles_for_timeframe", lambda *a, **k: tail
    )

    out = tr.fetch_live_tail(
        "AAA", "15m", cached, now=NOW_OPEN, cache_path=path
    )

    assert out.provider_called is True and out.appended == 1
    with open(path, "rb") as handle:
        assert len(pickle.load(handle)) == 2
    assert path.with_suffix(".meta").exists()
    assert not list(path.parent.glob("*.tmp"))


def test_fetch_live_tail_write_failure_keeps_old_cache(monkeypatch):
    path = candles._cache_path("15m", "AAA")
    old = _frame(close=100.0)
    candles._write_cached(path, old, is_today=True)
    old_bytes = path.read_bytes()

    monkeypatch.setattr(
        md,
        "fetch_candles_for_timeframe",
        lambda *a, **k: _frame(last="2026-11-06 04:15", close=110.0),
    )

    def fail_write(*args, **kwargs):
        raise OSError("no space left")

    monkeypatch.setattr(tr, "atomic_write_pickle", fail_write)

    out = tr.fetch_live_tail("AAA", "15m", old, now=NOW_OPEN)

    assert out.provider_called is True
    assert out.appended == 1
    assert "cache write failed" in out.error
    assert path.read_bytes() == old_bytes
    with open(path, "rb") as handle:
        assert len(pickle.load(handle)) == 1
