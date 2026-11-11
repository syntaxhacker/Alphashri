"""OHLC batch pre-fetch for scan partial-today bars.

Covers ``market_data.fetch_ohlc_batch`` (one /v3/market-quote/ohlc call for the
whole symbol list) and its wiring into ``scan.run_job`` so a live 1D scan appends
each symbol's in-progress session bar without a per-symbol 1-minute tape fetch.
"""
from datetime import datetime
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

import market_data.market_data as md
from chart_patterns import candles, jobs, scan, store
from chart_patterns.detectors.common import PatternHit


def _make_df(n: int = 80) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    base = np.linspace(100.0, 120.0, n)
    return pd.DataFrame(
        {
            "open": base,
            "high": base + 1.0,
            "low": base - 1.0,
            "close": base,
            "volume": np.full(n, 1000.0),
        },
        index=idx,
    )


def _hit(symbol: str) -> PatternHit:
    return PatternHit(
        pattern_id="double_bottom", pattern_name="Double Bottom",
        family="reversal", direction="bullish", status="confirmed",
        quality="strong", confidence=70.0, start_date="2026-01-01",
        end_date="2026-02-01", start_price=100.0, end_price=110.0,
        breakout_level=110.0, target=120.0, stop=95.0, rr=2.0,
        bars_ago=1, volume_confirmed=True,
        trendlines=[[{"t": "2026-01-01", "price": 100.0},
                     {"t": "2026-02-01", "price": 110.0}]],
        notes="synthetic", symbol=symbol, timeframe="1D",
    )


def _today_ist_midnight_utc() -> pd.Timestamp:
    import config
    return (
        pd.Timestamp(datetime.now(config.IST).date())
        .tz_localize(config.IST)
        .tz_convert("UTC")
    )


def _batch_bar(open_=210.0, high=212.0, low=209.0, close=211.0, volume=5000.0):
    return md._ohlc_bar_frame(open_, high, low, close, volume)


def _ist_at(hour: int = 10, minute: int = 30, day_offset: int = 0) -> datetime:
    import config
    from datetime import timedelta as _timedelta

    base = datetime.now(config.IST).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )
    return base - _timedelta(days=day_offset)


def _epoch_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _today_ts_ms(hour: int = 10, minute: int = 30) -> int:
    return _epoch_ms(_ist_at(hour, minute, 0))


def _yesterday_ts_ms(hour: int = 10, minute: int = 30) -> int:
    return _epoch_ms(_ist_at(hour, minute, 1))


@pytest.fixture
def cp_store(test_db_engine):
    from sqlalchemy.orm import sessionmaker

    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    jobs.reset()
    try:
        yield factory
    finally:
        jobs.reset()
        store.reset_session_factory()


@pytest.fixture(autouse=True)
def _clear_partial_cache():
    candles._PARTIAL_CACHE.clear()
    yield
    candles._PARTIAL_CACHE.clear()


# ---------------------------------------------------------------------------
# fetch_ohlc_batch: parsing, chunking, failure handling.
# ---------------------------------------------------------------------------


def test_fetch_ohlc_batch_parses_mocked_response(monkeypatch):
    monkeypatch.setattr(
        md, "get_api_client",
        lambda: SimpleNamespace(auth_handler=SimpleNamespace(access_token="tok")),
    )
    monkeypatch.setattr(
        md, "_ohlc_instrument_keys",
        lambda syms: {"RELIANCE": "NSE_EQ|123", "TCS": "NSE_EQ|456"},
    )

    calls = {}

    def fake_ohlc(*args, **kwargs):
        calls["interval"] = kwargs.get("interval")
        calls["keys"] = kwargs.get("instrument_key")
        ts = _today_ts_ms()
        return {
            "data": {
                "NSE_EQ|123": {
                    "live_ohlc": {
                        "open": 100.0, "high": 110.0, "low": 90.0,
                        "close": 105.0, "volume": 5000.0, "ts": ts,
                    },
                },
                "NSE_EQ|456": {
                    "live_ohlc": {
                        "open": 200.0, "high": 210.0, "low": 190.0,
                        "close": 205.0, "volume": 6000.0, "ts": ts,
                    },
                },
            },
        }

    monkeypatch.setattr(
        "upstox_client.api.market_quote_v3_api.MarketQuoteV3Api.get_market_quote_ohlc",
        fake_ohlc,
    )

    out = md.fetch_ohlc_batch(["RELIANCE", "TCS"], interval="1d")

    assert set(out) == {"RELIANCE", "TCS"}
    for sym, (o, h, l, c, v) in {
        "RELIANCE": (100.0, 110.0, 90.0, 105.0, 5000.0),
        "TCS": (200.0, 210.0, 190.0, 205.0, 6000.0),
    }.items():
        row = out[sym].iloc[0]
        assert row["open"] == o and row["high"] == h
        assert row["low"] == l and row["close"] == c
        assert row["volume"] == v
    # Timestamp matches what _synthetic_today_bar would produce for today.
    for df in out.values():
        assert len(df) == 1
        assert df.index[0] == _today_ist_midnight_utc()
    assert calls["interval"] == "1d"
    assert calls["keys"] == "NSE_EQ|123,NSE_EQ|456"


def test_fetch_ohlc_batch_chunks_at_500(monkeypatch):
    monkeypatch.setattr(
        md, "get_api_client",
        lambda: SimpleNamespace(auth_handler=SimpleNamespace(access_token="tok")),
    )
    keys = {f"SYM{i}": f"NSE_EQ|{i}" for i in range(600)}
    monkeypatch.setattr(md, "_ohlc_instrument_keys", lambda syms: dict(keys))

    batches = []

    def fake_ohlc(*args, **kwargs):
        batches.append(kwargs.get("instrument_key", "").split(","))
        return {"data": {}}

    monkeypatch.setattr(
        "upstox_client.api.market_quote_v3_api.MarketQuoteV3Api.get_market_quote_ohlc",
        fake_ohlc,
    )

    assert md.fetch_ohlc_batch(list(keys), interval="1d") == {}
    assert len(batches) == 2
    assert len(batches[0]) == 500
    assert len(batches[1]) == 100


def test_fetch_ohlc_batch_returns_empty_on_failure(monkeypatch):
    monkeypatch.setattr(
        md, "get_api_client",
        lambda: SimpleNamespace(auth_handler=SimpleNamespace(access_token="tok")),
    )
    monkeypatch.setattr(md, "_ohlc_instrument_keys", lambda syms: {"RELIANCE": "NSE_EQ|123"})

    def boom(*args, **kwargs):
        raise RuntimeError("down")

    monkeypatch.setattr(
        "upstox_client.api.market_quote_v3_api.MarketQuoteV3Api.get_market_quote_ohlc",
        boom,
    )
    assert md.fetch_ohlc_batch(["RELIANCE"]) == {}

    # Empty symbol list.
    assert md.fetch_ohlc_batch([]) == {}

    # No OAuth token.
    monkeypatch.setattr(md, "get_api_client", lambda: None)
    assert md.fetch_ohlc_batch(["RELIANCE"]) == {}


# ---------------------------------------------------------------------------
# Scan wiring: batch pre-fetch threads partial_bar into each symbol.
# ---------------------------------------------------------------------------


def _setup_scan(monkeypatch, symbols, partial_bars):
    monkeypatch.setattr(candles, "_today_is_session", lambda: True)
    monkeypatch.setattr(
        candles, "_resolve_timeframe",
        lambda tf_id: {"minutes": 1440, "source_tf": None, "max_lookback_days": 730},
    )
    monkeypatch.setattr(md, "fetch_ohlc_batch",
                        lambda syms, interval="1d": partial_bars(syms))
    monkeypatch.setattr(
        md, "fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: _make_df(80).copy(),
    )
    tape_calls: list = []
    monkeypatch.setattr(md, "_synthetic_today_bar",
                        lambda api, symbol: tape_calls.append(symbol) or None)
    detect_calls: list = []
    monkeypatch.setattr(
        scan.engine_mod, "detect_patterns",
        lambda df, tf, s: (detect_calls.append(s) or [_hit(s)]),
    )
    monkeypatch.setattr(scan.universes_mod, "get_universe", lambda uid: list(symbols))
    monkeypatch.setattr(scan, "SYMBOL_WORKERS", 1)
    return tape_calls, detect_calls


def test_scan_batch_partial_bar_zero_tape_calls(cp_store, monkeypatch, tmp_path):
    """Mocked batch: one fetch for all symbols, zero _synthetic_today_bar calls,
    same hits as if every symbol had its own bar."""
    monkeypatch.setattr(candles, "CACHE_DIR", tmp_path)
    symbols = [f"SYM{i}" for i in range(5)]
    bar = _batch_bar()
    tape_calls, detect_calls = _setup_scan(
        monkeypatch, symbols, lambda syms: {s: bar for s in syms}
    )

    store.save_job({"job_id": "cpj_batch", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_batch")

    row = store.get_job("cpj_batch")
    assert row["status"] == "completed"
    items, total, _ = store.query_results({"job_id": "cpj_batch"})
    assert total == len(symbols)
    assert {i["symbol"] for i in items} == set(symbols)
    assert detect_calls == sorted(symbols)
    # One batched quote for the whole list, no per-symbol tape fetch.
    assert tape_calls == []


def test_scan_batch_empty_falls_back_to_tape(cp_store, monkeypatch, tmp_path):
    """Empty batch: each symbol falls back to its own _synthetic_today_bar call."""
    monkeypatch.setattr(candles, "CACHE_DIR", tmp_path)
    symbols = ["AAA", "BBB"]
    tape_calls, _ = _setup_scan(
        monkeypatch, symbols, lambda syms: {}
    )
    monkeypatch.setattr(md, "_synthetic_today_bar",
                        lambda api, symbol: tape_calls.append(symbol) or _batch_bar())

    store.save_job({"job_id": "cpj_fallback", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_fallback")

    row = store.get_job("cpj_fallback")
    assert row["status"] == "completed"
    items, total, _ = store.query_results({"job_id": "cpj_fallback"})
    assert total == len(symbols)
    assert sorted(tape_calls) == sorted(symbols)


def test_scan_non_trading_day_skips_batch(cp_store, monkeypatch, tmp_path):
    """Off-session: no batch fetch, no per-symbol tape, hits still produced."""
    monkeypatch.setattr(candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(candles, "_today_is_session", lambda: False)
    monkeypatch.setattr(
        candles, "_resolve_timeframe",
        lambda tf_id: {"minutes": 1440, "source_tf": None, "max_lookback_days": 730},
    )
    symbols = ["AAA"]
    batch_calls: list = []
    monkeypatch.setattr(md, "fetch_ohlc_batch",
                        lambda syms, interval="1d": (batch_calls.append(list(syms)) or {}))
    tape_calls: list = []
    monkeypatch.setattr(md, "_synthetic_today_bar",
                        lambda api, symbol: tape_calls.append(symbol) or None)
    monkeypatch.setattr(
        md, "fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: _make_df(80).copy(),
    )
    monkeypatch.setattr(scan.engine_mod, "detect_patterns",
                        lambda df, tf, s: [_hit(s)])
    monkeypatch.setattr(scan.universes_mod, "get_universe", lambda uid: list(symbols))
    monkeypatch.setattr(scan, "SYMBOL_WORKERS", 1)

    store.save_job({"job_id": "cpj_nonsession", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_nonsession")

    row = store.get_job("cpj_nonsession")
    assert row["status"] == "completed"
    assert batch_calls == []
    assert tape_calls == []
    items, total, _ = store.query_results({"job_id": "cpj_nonsession"})
    assert total == 1


# ---------------------------------------------------------------------------
# Freshness: stale quotes (yesterday / pre-market) yield no bar.
# ---------------------------------------------------------------------------


def _mock_batch(monkeypatch, key_map, data):
    monkeypatch.setattr(
        md, "get_api_client",
        lambda: SimpleNamespace(auth_handler=SimpleNamespace(access_token="tok")),
    )
    monkeypatch.setattr(md, "_ohlc_instrument_keys", lambda syms: dict(key_map))
    monkeypatch.setattr(
        "upstox_client.api.market_quote_v3_api.MarketQuoteV3Api.get_market_quote_ohlc",
        lambda *args, **kwargs: {"data": data},
    )


def test_fetch_ohlc_batch_rejects_stale_timestamp(monkeypatch):
    """Yesterday's session close is not stamped as today's bar."""
    _mock_batch(
        monkeypatch,
        {"FRESH": "NSE_EQ|111", "STALE": "NSE_EQ|222"},
        {
            "NSE_EQ|111": {
                "live_ohlc": {
                    "open": 100.0, "high": 110.0, "low": 90.0,
                    "close": 105.0, "volume": 1000.0, "ts": _today_ts_ms(),
                },
            },
            "NSE_EQ|222": {
                "live_ohlc": {
                    "open": 100.0, "high": 110.0, "low": 90.0,
                    "close": 105.0, "volume": 1000.0, "ts": _yesterday_ts_ms(),
                },
            },
        },
    )
    out = md.fetch_ohlc_batch(["FRESH", "STALE"])
    assert set(out) == {"FRESH"}


def test_fetch_ohlc_batch_rejects_stale_iso_timestamp(monkeypatch):
    """ISO-string timestamps are checked in IST the same way."""
    stale_iso = _ist_at(10, 30, day_offset=1).isoformat()
    _mock_batch(
        monkeypatch,
        {"STALE": "NSE_EQ|222"},
        {
            "NSE_EQ|222": {
                "live_ohlc": {
                    "open": 100.0, "high": 110.0, "low": 90.0,
                    "close": 105.0, "volume": 1000.0, "ts": stale_iso,
                },
            },
        },
    )
    assert md.fetch_ohlc_batch(["STALE"]) == {}


def test_fetch_ohlc_batch_accepts_after_close_timestamp(monkeypatch):
    """After-hours quote with today's timestamp still yields the bar."""
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    _mock_batch(
        monkeypatch,
        {"RELIANCE": "NSE_EQ|123"},
        {
            "NSE_EQ|123": {
                "live_ohlc": {
                    "open": 100.0, "high": 110.0, "low": 90.0,
                    "close": 105.0, "volume": 5000.0, "ts": _today_ts_ms(16, 0),
                },
            },
        },
    )
    out = md.fetch_ohlc_batch(["RELIANCE"])
    assert set(out) == {"RELIANCE"}


def test_fetch_ohlc_batch_pre_market_guard_rejects_without_timestamp(monkeypatch):
    """No timestamp pre-market: no bar (scan's tape path returns nothing)."""
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    monkeypatch.setattr("trading.utils.is_trading_holiday", lambda *a, **k: False)
    # Pin wall clock to pre-market so the after-close clause cannot accept.
    real_datetime = datetime

    class _FakeDateTime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            fixed = real_datetime(2026, 11, 6, 8, 0, tzinfo=md._IST)
            return fixed if tz is not None else fixed.replace(tzinfo=None)

    monkeypatch.setattr(md, "datetime", _FakeDateTime)
    _mock_batch(
        monkeypatch,
        {"RELIANCE": "NSE_EQ|123"},
        {
            "NSE_EQ|123": {
                "live_ohlc": {
                    "open": 100.0, "high": 110.0, "low": 90.0,
                    "close": 105.0, "volume": 5000.0,
                },
            },
        },
    )
    assert md.fetch_ohlc_batch(["RELIANCE"]) == {}


def test_fetch_ohlc_batch_in_session_guard_accepts_without_timestamp(monkeypatch):
    """No timestamp in-session: the guard accepts the quote."""
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)
    _mock_batch(
        monkeypatch,
        {"RELIANCE": "NSE_EQ|123"},
        {
            "NSE_EQ|123": {
                "live_ohlc": {
                    "open": 100.0, "high": 110.0, "low": 90.0,
                    "close": 105.0, "volume": 5000.0,
                },
            },
        },
    )
    out = md.fetch_ohlc_batch(["RELIANCE"])
    assert set(out) == {"RELIANCE"}


def test_fetch_ohlc_batch_duplicate_keys_emit_both_symbols(monkeypatch):
    """Two symbols sharing one instrument key both get the bar."""
    monkeypatch.setattr(
        md, "get_api_client",
        lambda: SimpleNamespace(auth_handler=SimpleNamespace(access_token="tok")),
    )
    monkeypatch.setattr(
        md, "_ohlc_instrument_keys",
        lambda syms: {"AAA": "NSE_EQ|999", "BBB": "NSE_EQ|999"},
    )
    calls = {}

    def fake_ohlc(*args, **kwargs):
        calls["keys"] = kwargs.get("instrument_key")
        return {
            "data": {
                "NSE_EQ|999": {
                    "live_ohlc": {
                        "open": 300.0, "high": 310.0, "low": 290.0,
                        "close": 305.0, "volume": 7000.0, "ts": _today_ts_ms(),
                    },
                },
            },
        }

    monkeypatch.setattr(
        "upstox_client.api.market_quote_v3_api.MarketQuoteV3Api.get_market_quote_ohlc",
        fake_ohlc,
    )
    out = md.fetch_ohlc_batch(["AAA", "BBB"])
    assert set(out) == {"AAA", "BBB"}
    for df in out.values():
        assert df.iloc[0]["close"] == 305.0
    assert calls["keys"] == "NSE_EQ|999"


def test_fetch_ohlc_batch_missing_symbol_yields_no_bar(monkeypatch):
    """A symbol absent from the response gets no bar (scan tape fallback)."""
    _mock_batch(
        monkeypatch,
        {"AAA": "NSE_EQ|111", "BBB": "NSE_EQ|222"},
        {
            "NSE_EQ|111": {
                "live_ohlc": {
                    "open": 100.0, "high": 110.0, "low": 90.0,
                    "close": 105.0, "volume": 1000.0, "ts": _today_ts_ms(),
                },
            },
        },
    )
    out = md.fetch_ohlc_batch(["AAA", "BBB"])
    assert set(out) == {"AAA"}


def test_batch_bar_session_allowed_truth_table(monkeypatch):
    import config

    friday = datetime(2026, 11, 6, tzinfo=config.IST)
    monkeypatch.setattr("trading.utils.is_trading_holiday", lambda *a, **k: False)
    # Pre-market weekday: rejected.
    assert md._batch_bar_session_allowed(
        friday.replace(hour=8, minute=0)
    ) is False
    # In-session weekday: accepted via is_market_open.
    assert md._batch_bar_session_allowed(
        friday.replace(hour=10, minute=30)
    ) is True
    # After-close weekday: accepted via the after-close clause.
    assert md._batch_bar_session_allowed(
        friday.replace(hour=16, minute=0)
    ) is True
    # Weekend after-close: still rejected (not a session).
    saturday = datetime(2026, 11, 7, tzinfo=config.IST)
    assert md._batch_bar_session_allowed(
        saturday.replace(hour=16, minute=0)
    ) is False
    # Holiday after-close: rejected.
    monkeypatch.setattr("trading.utils.is_trading_holiday", lambda *a, **k: True)
    assert md._batch_bar_session_allowed(
        friday.replace(hour=16, minute=0)
    ) is False
