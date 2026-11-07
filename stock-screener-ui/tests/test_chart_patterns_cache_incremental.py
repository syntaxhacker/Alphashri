"""Cache behaviour: session-fresh daily frames, incremental top-ups, partial cache."""
from datetime import date

import pandas as pd
import pytest

import market_data.market_data as md
from chart_patterns import candles


def _bar(session: str, close: float = 100.0) -> pd.DataFrame:
    # Daily bars carry the 18:30 UTC stamp of the previous calendar day.
    ts = pd.Timestamp(f"{session} 18:30", tz="UTC") - pd.Timedelta(days=1)
    return pd.DataFrame(
        {"open": [close], "high": [close + 1], "low": [close - 1],
         "close": [close], "volume": [1000]},
        index=pd.DatetimeIndex([ts]),
    )


def _frame(*sessions, start=100.0):
    return pd.concat([_bar(s, start + i) for i, s in enumerate(sessions)])


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(candles, "CACHE_DIR", tmp_path)
    candles._PARTIAL_CACHE.clear()
    yield
    candles._PARTIAL_CACHE.clear()


def test_daily_cache_is_fresh_for_the_whole_session(monkeypatch):
    monkeypatch.setattr(candles, "_last_completed_session", lambda *a, **k: date(2026, 11, 6))
    df = _frame("2026-11-05", "2026-11-06")
    path = candles._cache_path("1D", "AAA")
    candles._write_cached(path, df, True, session_pin="2026-11-06")

    # Market open normally expires the entry after 5 minutes; the pinned
    # completed session must stay valid all session.
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)
    assert candles._read_cached(path, True, is_daily=True) is not None

    # Intraday frames still use the short TTL.
    import json
    import time as _time

    meta = path.with_suffix(".meta")
    meta.write_text(json.dumps({"ts": _time.time() - 10_000, "session": "2026-11-06"}))
    assert candles._read_cached(path, True, is_daily=False) is None


def test_stale_daily_cache_fetches_only_the_missing_tail(monkeypatch):
    monkeypatch.setattr(candles, "_last_completed_session", lambda *a, **k: date(2026, 11, 6))
    base = _frame("2026-11-04", "2026-11-05")
    path = candles._cache_path("1D", "AAA")
    candles._write_cached(path, base, True, session_pin="2026-11-05")

    seen: dict = {}

    def fake_fetch(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _frame("2026-11-05", "2026-11-06")

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", fake_fetch)

    out = candles.fetch_for_timeframe("AAA", "1D", include_partial_today=False)

    assert seen["from_date"] == "2026-11-05"
    assert len(out) == 3
    assert len({str(t)[:10] for t in out.index}) == 3
    # The merged frame is written back and is fresh for the session.
    assert candles._read_cached(path, True, is_daily=True) is not None


def test_partial_bar_is_cached_for_30s(monkeypatch):
    monkeypatch.setattr(candles, "_today_is_session", lambda: True)
    calls: list[str] = []
    synth = _bar("2026-11-07", 110.0)

    monkeypatch.setattr(md, "_synthetic_today_bar", lambda api, symbol: calls.append(symbol) or synth)

    base = _frame("2026-11-06")
    first = candles._with_partial_today(base, "AAA")
    second = candles._with_partial_today(base, "AAA")

    assert calls == ["AAA"]
    assert len(first) == 2
    assert len(second) == 2
