"""Tests for session-aware candle caching in chart_patterns/candles.py."""
import json
import time
from datetime import date, datetime

import pandas as pd
import pytest

from chart_patterns import candles as candles_mod

IST = pytest.importorskip("trading.timezone").IST


def _make_df(n: int = 10) -> pd.DataFrame:
    idx = pd.date_range("2026-09-01", periods=n, freq="D", tz="UTC")
    base = [100.0 + i for i in range(n)]
    return pd.DataFrame(
        {
            "open": base,
            "high": [b + 1.0 for b in base],
            "low": [b - 1.0 for b in base],
            "close": base,
            "volume": [1000.0] * n,
        },
        index=idx,
    )


def _write_entry(path, df, ts: float, session: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    import pickle

    with open(path, "wb") as f:
        pickle.dump(df, f)
    with open(path.with_suffix(".meta"), "w") as f:
        json.dump({"ts": ts, "session": session}, f)


@pytest.fixture
def cache_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    return tmp_path


# ---------------------------------------------------------------------------
# _last_completed_session
# ---------------------------------------------------------------------------


def test_session_after_close_returns_today(monkeypatch):
    monkeypatch.setattr("trading.utils.is_trading_holiday", lambda d: False)
    # 2026-10-02 is a Friday.
    now = datetime(2026, 10, 2, 16, 0, tzinfo=IST)
    assert candles_mod._last_completed_session(now) == date(2026, 10, 2)


def test_session_before_close_returns_previous_day(monkeypatch):
    monkeypatch.setattr("trading.utils.is_trading_holiday", lambda d: False)
    now = datetime(2026, 10, 2, 10, 0, tzinfo=IST)
    assert candles_mod._last_completed_session(now) == date(2026, 10, 1)


def test_session_weekend_walks_back_to_friday(monkeypatch):
    monkeypatch.setattr("trading.utils.is_trading_holiday", lambda d: False)
    saturday = datetime(2026, 10, 3, 12, 0, tzinfo=IST)
    sunday = datetime(2026, 10, 4, 12, 0, tzinfo=IST)
    assert saturday.weekday() == 5 and sunday.weekday() == 6
    assert candles_mod._last_completed_session(saturday) == date(2026, 10, 2)
    assert candles_mod._last_completed_session(sunday) == date(2026, 10, 2)


def test_session_holiday_walks_back(monkeypatch):
    # Monday 2026-10-05 is a trading holiday -> previous Friday.
    monkeypatch.setattr(
        "trading.utils.is_trading_holiday",
        lambda d: (d.date() if isinstance(d, datetime) else d) == date(2026, 10, 5),
    )
    monday_close = datetime(2026, 10, 5, 16, 0, tzinfo=IST)
    assert candles_mod._last_completed_session(monday_close) == date(2026, 10, 2)


# ---------------------------------------------------------------------------
# _read_cached session behaviour (market closed)
# ---------------------------------------------------------------------------


def test_closed_market_reuses_session_stamped_entry_past_ttl(cache_dir, monkeypatch):
    df = _make_df()
    path = cache_dir / "1D" / "AAA.pkl"
    session = "2026-10-02"
    _write_entry(path, df, time.time() - candles_mod.TODAY_TTL_SECONDS - 3600, session)
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 2)
    )
    got = candles_mod._read_cached(path, True)
    assert got is not None and len(got) == len(df)


def test_closed_market_new_session_is_stale(cache_dir, monkeypatch):
    df = _make_df()
    path = cache_dir / "1D" / "AAA.pkl"
    _write_entry(path, df, time.time(), "2026-10-02")
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 6)
    )
    assert candles_mod._read_cached(path, True) is None


def test_write_cached_stamps_session(cache_dir, monkeypatch):
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 2)
    )
    path = cache_dir / "1D" / "AAA.pkl"
    candles_mod._write_cached(path, _make_df(), is_today=True)
    with open(path.with_suffix(".meta")) as f:
        meta = json.load(f)
    assert meta["session"] == "2026-10-02"
    assert meta["ts"] > 0


# ---------------------------------------------------------------------------
# TTL still applies while the market is open
# ---------------------------------------------------------------------------


def test_open_market_ttl_applies(cache_dir, monkeypatch):
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)
    path = cache_dir / "1D" / "AAA.pkl"
    df = _make_df()

    _write_entry(path, df, time.time(), "2026-10-02")
    assert candles_mod._read_cached(path, True) is not None

    _write_entry(path, df, time.time() - candles_mod.TODAY_TTL_SECONDS - 1, "2026-10-02")
    assert candles_mod._read_cached(path, True) is None


def test_historical_path_unchanged(cache_dir, monkeypatch):
    # Historical entries ignore the meta entirely (old ts, no session key).
    df = _make_df()
    path = cache_dir / "1D" / "AAA.2020-01-05.pkl"
    _write_entry(path, df, 0.0, "1900-01-01")
    assert candles_mod._read_cached(path, False) is not None


# ---------------------------------------------------------------------------
# clear_cache
# ---------------------------------------------------------------------------


def _seed(cache_dir):
    df = _make_df()
    for tf in ("1D", "1h"):
        for sym in ("AAA", "BBB"):
            _write_entry(cache_dir / tf / f"{sym}.pkl", df, time.time(), "2026-10-02")
    # Lookback variant + dated file for AAA/1D.
    _write_entry(cache_dir / "1D" / "AAA.lb250.pkl", df, time.time(), "2026-10-02")
    _write_entry(cache_dir / "1D" / "AAA.2020-01-05.pkl", df, time.time(), "2020-01-05")


def _names(cache_dir):
    return sorted(
        p.relative_to(cache_dir).as_posix() for p in cache_dir.rglob("*") if p.is_file()
    )


def test_clear_cache_timeframe_only(cache_dir):
    _seed(cache_dir)
    removed = candles_mod.clear_cache(timeframe="1D")
    # 1D: AAA.pkl/.meta, BBB.pkl/.meta, AAA.lb250.pkl/.meta,
    # AAA.2020-01-05.pkl/.meta = 8 files.
    assert removed == 8
    remaining = _names(cache_dir)
    assert remaining == ["1h/AAA.meta", "1h/AAA.pkl", "1h/BBB.meta", "1h/BBB.pkl"]


def test_clear_cache_symbol_only(cache_dir):
    _seed(cache_dir)
    removed = candles_mod.clear_cache(symbols="AAA")
    # AAA in 1D (3 pkl + 3 meta) + AAA in 1h (1 pkl + 1 meta) = 8.
    assert removed == 8
    remaining = _names(cache_dir)
    assert all("AAA" not in n for n in remaining)
    assert len(remaining) == 4  # BBB files in both timeframes


def test_clear_cache_timeframe_and_symbol(cache_dir):
    _seed(cache_dir)
    removed = candles_mod.clear_cache(symbols=["AAA"], timeframe="1D")
    assert removed == 6
    remaining = _names(cache_dir)
    assert "1D/BBB.pkl" in remaining
    assert not any(n.startswith("1D/AAA") for n in remaining)


def test_clear_cache_no_match_is_safe(cache_dir):
    _seed(cache_dir)
    before = _names(cache_dir)
    assert candles_mod.clear_cache(symbols="ZZZ", timeframe="1D") == 0
    assert candles_mod.clear_cache(timeframe="9X") == 0
    assert _names(cache_dir) == before


def test_clear_cache_missing_dir_returns_zero(monkeypatch, tmp_path):
    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path / "does-not-exist")
    assert candles_mod.clear_cache() == 0
