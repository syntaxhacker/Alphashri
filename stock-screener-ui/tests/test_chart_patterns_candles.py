"""Tests for session-aware candle caching in chart_patterns/candles.py."""
import json
import threading
import time
from datetime import date, datetime

import numpy as np
import pandas as pd
import pytest

import market_data.market_data as md
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


def test_write_cached_honours_explicit_session_pin(cache_dir, monkeypatch):
    """A 1D frame that stops short of the last completed session is pinned to
    its own last session, so the read-side check invalidates it instead of
    serving it as fresh (regression: 1D cache stamped one session ahead)."""
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 6)
    )
    path = cache_dir / "1D" / "AAA.pkl"
    candles_mod._write_cached(path, _make_df(), is_today=True, session_pin="2026-10-05")
    with open(path.with_suffix(".meta")) as f:
        meta = json.load(f)
    assert meta["session"] == "2026-10-05"
    # Pinned behind the last completed session -> served as stale (None).
    assert candles_mod._read_cached(path, True) is None


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
# Daily session tolerance (_read_cached with is_daily)
# ---------------------------------------------------------------------------


def _closed_market(monkeypatch):
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)


def test_daily_one_session_behind_served_from_cache(cache_dir, monkeypatch):
    """A daily frame stamped one session behind the last completed session is
    served from cache (no fetch) once the 3-day tolerance is applied."""
    df = _make_df()
    path = cache_dir / "1D" / "AAA.pkl"
    _write_entry(path, df, time.time() - candles_mod.TODAY_TTL_SECONDS - 3600, "2026-10-05")
    _closed_market(monkeypatch)
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 6)
    )
    got = candles_mod._read_cached(path, True, is_daily=True)
    assert got is not None and len(got) == len(df)


def test_daily_three_days_behind_served_from_cache(cache_dir, monkeypatch):
    """The tolerance is inclusive: a frame exactly 3 days behind is still served."""
    df = _make_df()
    path = cache_dir / "1D" / "BBB.pkl"
    _write_entry(path, df, time.time(), "2026-10-03")
    _closed_market(monkeypatch)
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 6)
    )
    assert candles_mod._read_cached(path, True, is_daily=True) is not None


def test_daily_four_days_behind_rejected(cache_dir, monkeypatch):
    """Older than 3 days behind is rejected as stale even while the market is closed."""
    df = _make_df()
    path = cache_dir / "1D" / "CCC.pkl"
    _write_entry(path, df, time.time(), "2026-10-02")
    _closed_market(monkeypatch)
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 6)
    )
    assert candles_mod._read_cached(path, True, is_daily=True) is None


def test_daily_future_session_rejected(cache_dir, monkeypatch):
    """A session stamped ahead of the last completed session is never served as current."""
    df = _make_df()
    path = cache_dir / "1D" / "DDD.pkl"
    _write_entry(path, df, time.time(), "2026-10-07")
    _closed_market(monkeypatch)
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 6)
    )
    assert candles_mod._read_cached(path, True, is_daily=True) is None


# ---------------------------------------------------------------------------
# _resample_ohlcv (weekly / monthly fallback)
# ---------------------------------------------------------------------------


def test_resample_ohlcv_weekly_and_monthly():
    idx = pd.date_range("2026-10-01", "2026-10-16", freq="B", tz="UTC")
    close = np.arange(len(idx), dtype=float) + 100.0
    df = pd.DataFrame(
        {
            "open": close,
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": 1000.0,
        },
        index=idx,
    )

    weekly = candles_mod._resample_ohlcv(df, "W-FRI")
    assert len(weekly) == 3
    # Week ending Fri Oct 2: Oct 1 (100) + Oct 2 (101).
    r1 = weekly.iloc[0]
    assert r1["open"] == 100.0 and r1["high"] == 102.0 and r1["low"] == 99.0 and r1["close"] == 101.0
    assert r1["volume"] == 2000.0
    # Week ending Fri Oct 9: Oct 5..9 -> close 102..106.
    r2 = weekly.iloc[1]
    assert r2["open"] == 102.0 and r2["close"] == 106.0 and r2["high"] == 107.0 and r2["low"] == 101.0
    assert r2["volume"] == 5000.0
    # Week ending Fri Oct 16: Oct 12..16 -> close 107..111.
    r3 = weekly.iloc[2]
    assert r3["open"] == 107.0 and r3["close"] == 111.0 and r3["high"] == 112.0 and r3["low"] == 106.0
    assert candles_mod.frame_last_date(weekly) == "2026-10-16"

    monthly = candles_mod._resample_ohlcv(df, "ME")
    assert len(monthly) == 1
    m = monthly.iloc[0]
    assert m["open"] == 100.0 and m["close"] == 111.0 and m["high"] == 112.0 and m["low"] == 99.0
    assert m["volume"] == 12000.0


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


def test_fill_provenance_session_stale(cache_dir, monkeypatch):
    df = _make_df()
    path = cache_dir / "1D" / "EEE.pkl"
    _write_entry(path, df, time.time(), "2026-10-05")
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 6)
    )
    prov: dict = {}
    candles_mod._fill_provenance(prov, path, True)
    assert prov["from_cache"] is True
    assert prov["session_pin"] == "2026-10-05"
    assert prov["cache_session"] == "2026-10-05"
    assert prov["session_stale"] is True
    assert isinstance(prov["cache_age_sec"], int) and prov["cache_age_sec"] >= 0

    prov_miss: dict = {}
    candles_mod._fill_provenance(prov_miss, path, False)
    assert prov_miss["session_stale"] is False
    assert prov_miss["session_pin"] is None


def test_fetch_for_timeframe_daily_serves_stale_cache_no_fetch(cache_dir, monkeypatch):
    """fetch_for_timeframe("1D") serves a one-session-behind daily cache in ms
    without calling the underlying fetcher (the KARURVYSYA root-cause fix)."""
    df = _make_df()
    path = candles_mod._cache_path("1D", "AAA")
    _write_entry(path, df, time.time(), "2026-10-05")
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 6)
    )
    calls: list = []

    def _fetch(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe))
        raise AssertionError("stale daily cache must not trigger a fetch")

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", _fetch)
    out = candles_mod.fetch_for_timeframe("AAA", "1D")
    assert out is not None and len(out) == len(df)
    assert calls == []


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


def test_cache_path_is_versioned():
    """A cache-version bump must invalidate pre-existing on-disk entries.

    The session pin only tracks *which* session a frame ends on, not its
    content; a content change (e.g. the daily completed-session backfill) needs
    a version in the path so stale entries are missed rather than served.
    """
    assert candles_mod.CACHE_VERSION >= 2
    assert candles_mod._cache_path("1D", "RELIANCE").name == (
        f"RELIANCE.v{candles_mod.CACHE_VERSION}.pkl"
    )
    assert candles_mod._cache_path("1D", "RELIANCE", variant="lb500").name == (
        f"RELIANCE.lb500.v{candles_mod.CACHE_VERSION}.pkl"
    )
    assert candles_mod._cache_path("1D", "RELIANCE", as_of_date="2026-10-05").name == (
        f"RELIANCE.2026-10-05.v{candles_mod.CACHE_VERSION}.pkl"
    )


# ---------------------------------------------------------------------------
# Singleflight (in-flight coalescing) + negative (empty-result) cache
# ---------------------------------------------------------------------------


@pytest.fixture
def clean_singleflight():
    candles_mod.clear_empty_cache()
    with candles_mod._INFLIGHT_LOCK:
        candles_mod._INFLIGHT.clear()
    yield
    candles_mod.clear_empty_cache()
    with candles_mod._INFLIGHT_LOCK:
        candles_mod._INFLIGHT.clear()


def _fast_df(n: int = 10) -> pd.DataFrame:
    idx = pd.date_range("2026-10-01", periods=n, freq="15min", tz="UTC")
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


def test_concurrent_calls_share_one_fetch(clean_singleflight, cache_dir, monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe))
        entered.set()
        assert release.wait(5)
        return _fast_df()

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)
    results: dict[str, object] = {}

    def run(name):
        try:
            results[name] = candles_mod.fetch_for_timeframe("AAA", "15m")
        except Exception as exc:  # noqa: BLE001
            results[name] = exc

    t1 = threading.Thread(target=run, args=("a",))
    t2 = threading.Thread(target=run, args=("b",))
    t1.start()
    assert entered.wait(5)
    t2.start()
    # Give the waiter time to join the in-flight slot.
    time.sleep(0.1)
    release.set()
    t1.join(5)
    t2.join(5)

    assert calls == [("AAA", "15m")]
    assert results["a"] is results["b"] or (
        isinstance(results["a"], pd.DataFrame) and isinstance(results["b"], pd.DataFrame)
        and len(results["a"]) == len(results["b"]) == 10
    )
    # Singleflight does not leak slots.
    with candles_mod._INFLIGHT_LOCK:
        assert candles_mod._INFLIGHT == {}


def test_waiter_gets_none_when_leader_raises(clean_singleflight, cache_dir, monkeypatch):
    entered = threading.Event()
    release = threading.Event()

    def fake_fetch(symbol, timeframe, **kwargs):
        entered.set()
        assert release.wait(5)
        raise RuntimeError("upstox down")

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)
    results: dict[str, object] = {}

    def run(name):
        try:
            results[name] = candles_mod.fetch_for_timeframe("AAA", "15m")
        except Exception as exc:  # noqa: BLE001
            results[name] = exc

    t1 = threading.Thread(target=run, args=("a",))
    t2 = threading.Thread(target=run, args=("b",))
    t1.start()
    assert entered.wait(5)
    t2.start()
    time.sleep(0.1)
    release.set()
    t1.join(5)
    t2.join(5)

    # One caller (the leader) sees the exception, the other (the waiter)
    # fails soft with None — exactly one raise, never two network calls.
    outcomes = list(results.values())
    assert sum(isinstance(o, RuntimeError) for o in outcomes) == 1
    assert outcomes.count(None) == 1
    # The error is NOT negative-cached: a follow-up call reaches the feed again.
    calls = []

    def fake_fetch2(symbol, timeframe, **kwargs):
        calls.append(symbol)
        raise RuntimeError("upstox down")

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch2)
    with pytest.raises(RuntimeError):
        candles_mod.fetch_for_timeframe("AAA", "15m")
    assert calls == ["AAA"]


def test_empty_result_is_cached(clean_singleflight, cache_dir, monkeypatch):
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe))
        return None

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)
    assert candles_mod.fetch_for_timeframe("AAA", "15m") is None
    assert candles_mod.fetch_for_timeframe("AAA", "15m") is None
    assert calls == [("AAA", "15m")]


def test_empty_dataframe_result_is_cached(clean_singleflight, cache_dir, monkeypatch):
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        calls.append(symbol)
        return pd.DataFrame()

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)
    assert candles_mod.fetch_for_timeframe("AAA", "15m") is None
    assert candles_mod.fetch_for_timeframe("AAA", "15m") is None
    assert calls == ["AAA"]


def test_error_is_not_cached(clean_singleflight, cache_dir, monkeypatch):
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        calls.append(symbol)
        raise RuntimeError("boom")

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)
    for _ in range(2):
        with pytest.raises(RuntimeError):
            candles_mod.fetch_for_timeframe("AAA", "15m")
    assert calls == ["AAA", "AAA"]
    assert candles_mod._EMPTY_CACHE == {}


def test_empty_cache_is_scoped_per_symbol_and_timeframe(
    clean_singleflight, cache_dir, monkeypatch
):
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe))
        return None

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)
    assert candles_mod.fetch_for_timeframe("AAA", "15m") is None
    # Same symbol, different timeframe -> independent entry.
    monkeypatch.setattr(md, "fetch_candles_for_timeframe",
                        lambda s, tf, **k: (calls.append((s, tf)), _fast_df())[1])
    assert candles_mod.fetch_for_timeframe("AAA", "1h") is not None
    # Different symbol, same timeframe -> independent entry.
    assert candles_mod.fetch_for_timeframe("BBB", "15m") is not None
    # Original symbol/tf pair is still negative-cached.
    assert candles_mod.fetch_for_timeframe("AAA", "15m") is None
    assert calls == [("AAA", "15m"), ("AAA", "1h"), ("BBB", "15m")]


def test_force_refresh_bypasses_empty_cache(clean_singleflight, cache_dir, monkeypatch):
    monkeypatch.setattr(md, "fetch_candles_for_timeframe", lambda s, tf, **k: None)
    assert candles_mod.fetch_for_timeframe("AAA", "15m") is None
    monkeypatch.setattr(md, "fetch_candles_for_timeframe",
                        lambda s, tf, **k: _fast_df())
    out = candles_mod.fetch_for_timeframe("AAA", "15m", force_refresh=True)
    assert out is not None and len(out) == 10


def test_empty_cache_entry_expires(clean_singleflight, cache_dir, monkeypatch):
    monkeypatch.setattr(candles_mod, "EMPTY_RESULT_TTL_SECONDS", 0.0)
    calls = []

    def fake_fetch(symbol, timeframe, **kwargs):
        calls.append(symbol)
        return None

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)
    assert candles_mod.fetch_for_timeframe("AAA", "15m") is None
    assert candles_mod.fetch_for_timeframe("AAA", "15m") is None
    assert calls == ["AAA", "AAA"]


def test_non_empty_result_is_not_negative_cached(
    clean_singleflight, cache_dir, monkeypatch
):
    monkeypatch.setattr(md, "fetch_candles_for_timeframe",
                        lambda s, tf, **k: _fast_df())
    out = candles_mod.fetch_for_timeframe("AAA", "15m")
    assert out is not None
    assert candles_mod._EMPTY_CACHE == {}
