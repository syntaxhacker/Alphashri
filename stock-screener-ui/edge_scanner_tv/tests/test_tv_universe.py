"""Tests for edge_scanner_tv/tv_universe.py (no network)."""
import sys

import pandas as pd
import pytest

sys.path.insert(0, ".")

from edge_scanner_tv import markets as M
from edge_scanner_tv import tv_universe


def test_module_uses_shared_tv_transport():
    """The scanner transport lives in api.tv; no api.tv_auth dependency remains."""
    import api.tv

    assert tv_universe.get_scanner_data is api.tv.get_scanner_data
    assert not hasattr(tv_universe, "tv_scanner_data")


class _FakeQuery:
    instances: list = []

    def __init__(self, *args, **kwargs):
        self.calls = {}
        _FakeQuery.instances.append(self)

    def select(self, *columns):
        self.calls["columns"] = columns
        return self

    def set_markets(self, *markets):
        self.calls["markets"] = markets
        return self

    def where(self, *filters):
        self.calls["filters"] = filters
        return self

    def order_by(self, *args, **kwargs):
        self.calls["order_by"] = (args, kwargs)
        return self

    def limit(self, n):
        self.calls["limit"] = n
        return self

    def set_tickers(self, *tickers):
        self.calls["tickers"] = tickers
        return self


class _FakeCol:
    def __init__(self, name):
        self.name = name

    def __gt__(self, other):
        return (self.name, ">", other)

    def __eq__(self, other):
        return (self.name, "==", other)

    __hash__ = None


@pytest.fixture
def fake_tv(monkeypatch):
    import tradingview_screener

    _FakeQuery.instances = []
    monkeypatch.setattr(tradingview_screener, "Query", _FakeQuery)
    monkeypatch.setattr(tradingview_screener, "col", _FakeCol, raising=False)
    return _FakeQuery


def _universe_df():
    return pd.DataFrame([
        {"name": "NSE:RELIANCE", "ticker": "NSE:RELIANCE", "close": 2500.0},
        {"name": "NSE:BAJAJ-AUTO", "ticker": "NSE:BAJAJ-AUTO", "close": 9000.0},
        # Same company via a second listing: dropped by the dedupe guard.
        {"name": "BSE:RELIANCE", "ticker": "BSE:RELIANCE", "close": 2499.0},
    ])


def test_fetch_universe_parses_shared_frame(fake_tv, monkeypatch):
    calls = []
    monkeypatch.setattr(
        tv_universe, "get_scanner_data",
        lambda q: (calls.append(q) or (0, _universe_df())),
    )

    out = tv_universe.fetch_universe(M.INDIA, limit=10)

    assert [r["symbol"] for r in out] == ["RELIANCE", "BAJAJ_AUTO"]
    assert out[0]["tv_ticker"] == "NSE:RELIANCE"
    assert len(calls) == 1
    query = fake_tv.instances[0]
    assert query.calls["markets"] == ("india",)
    assert query.calls["limit"] == 10
    # India is NSE-only, otherwise every name appears twice.
    assert ("exchange", "==", "NSE") in query.calls["filters"]


def test_fetch_universe_empty_frame(fake_tv, monkeypatch):
    monkeypatch.setattr(tv_universe, "get_scanner_data", lambda q: (0, pd.DataFrame()))
    assert tv_universe.fetch_universe(M.INDIA) == []


def test_fetch_snapshots_uses_exact_tickers(fake_tv, monkeypatch):
    seen = []

    def _scan(q):
        seen.append(q.calls["tickers"])
        return 0, pd.DataFrame([
            {"ticker": "NASDAQ:AAPL", "name": "AAPL", "close": 200.0},
        ])

    monkeypatch.setattr(tv_universe, "get_scanner_data", _scan)

    out = tv_universe.fetch_snapshots(
        ["AAPL"], M.AMERICA, tv_tickers={"AAPL": "NASDAQ:AAPL"},
    )

    assert seen == [("NASDAQ:AAPL",)]
    assert set(out) == {"AAPL"}
    assert out["AAPL"]["close"] == 200.0


def test_fetch_snapshots_falls_back_to_market_prefix(fake_tv, monkeypatch):
    seen = []

    def _scan(q):
        seen.append(q.calls["tickers"])
        return 0, pd.DataFrame([{"ticker": "NSE:IDEA", "close": 12.0}])

    monkeypatch.setattr(tv_universe, "get_scanner_data", _scan)

    out = tv_universe.fetch_snapshots(["idea"], M.INDIA)

    assert seen == [("NSE:IDEA",)]
    assert set(out) == {"IDEA"}


def test_fetch_snapshots_batches(fake_tv, monkeypatch):
    calls = []
    monkeypatch.setattr(
        tv_universe, "get_scanner_data",
        lambda q: (calls.append(list(q.calls["tickers"])) or (0, pd.DataFrame())),
    )

    tv_universe.fetch_snapshots([f"S{i}" for i in range(81)], M.INDIA)

    assert [len(c) for c in calls] == [tv_universe.TICKER_BATCH_SIZE, 1]
