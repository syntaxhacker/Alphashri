"""TradingView scanner tests — earnings/ex-dividend rows from a recorded payload."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from api.event_radar.sources import tradingview
from api.event_radar.sources.tradingview import (
    COLUMNS,
    DIVIDEND_CONFIDENCE,
    EARNINGS_CONFIDENCE,
    fetch_events,
)

FIXTURES = Path(__file__).parent / "fixtures"
NOW = dt.datetime(2026, 10, 29, 12, 0, tzinfo=dt.timezone.utc)


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, payload=None, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code

    def json(self):
        return self.payload


def _install_scan(monkeypatch, response=None, exc=None):
    calls: list[dict] = []

    def fake_scan_raw(market, body, *, timeout=None, headers=None):
        calls.append({"market": market, "json": body, "timeout": timeout})
        if exc is not None:
            raise exc
        return response

    monkeypatch.setattr(tradingview, "scan_raw", fake_scan_raw)
    return calls


class TestRequest:
    def test_body_and_url(self, monkeypatch):
        calls = _install_scan(
            monkeypatch, FakeResponse(_load("tv_scanner_america.json"))
        )
        fetch_events(market="america", days_ahead=120, limit=1500, now=NOW)

        assert len(calls) == 1
        call = calls[0]
        assert call["market"] == "america"
        assert call["timeout"] == 30
        body = call["json"]
        assert body["columns"] == list(COLUMNS)
        assert body["range"] == [0, 1500]
        assert body["markets"] == ["america"]

        filters = body["filter"]
        assert len(filters) == 1
        assert filters[0]["left"] == "earnings_release_next_date"
        assert filters[0]["operation"] == "greater"
        assert filters[0]["right"] == int(NOW.timestamp())

    def test_market_is_in_the_url(self, monkeypatch):
        calls = _install_scan(monkeypatch, FakeResponse({"data": []}))
        fetch_events(market="india", now=NOW)
        assert calls[0]["market"] == "india"
        assert calls[0]["json"]["markets"] == ["india"]

    def test_non_200_raises_with_status(self, monkeypatch):
        _install_scan(monkeypatch, FakeResponse({}, status_code=500))
        with pytest.raises(RuntimeError, match="500"):
            fetch_events(now=NOW)

    def test_transport_error_is_wrapped(self, monkeypatch):
        _install_scan(monkeypatch, exc=OSError("connection reset"))
        with pytest.raises(RuntimeError, match="tv_source_unavailable"):
            fetch_events(now=NOW)


class TestParsing:
    def test_recorded_payload(self, monkeypatch):
        _install_scan(monkeypatch, FakeResponse(_load("tv_scanner_america.json")))
        events = fetch_events(days_ahead=120, now=NOW)

        assert len(events) == 3  # ORCL earnings, MSFT earnings + dividend

        earnings = [ev for ev in events if ev.event_type == "earnings"]
        dividends = [ev for ev in events if ev.event_type == "dividend"]

        assert [ev.event_date for ev in earnings] == ["2026-11-12", "2026-12-10"]
        assert [ev.event_date for ev in dividends] == ["2027-01-15"]

        orcl = earnings[0]
        assert orcl.symbol == "ORCL"  # "NASDAQ:ORCL" cleaned
        assert orcl.title == "ORCL earnings"
        assert orcl.source == "tv"
        assert orcl.exchange == "NASDAQ"
        assert orcl.name == "Oracle Corporation"
        assert orcl.confidence == EARNINGS_CONFIDENCE

        assert dividends[0].title == "MSFT ex-dividend"
        assert dividends[0].confidence == DIVIDEND_CONFIDENCE

    def test_epoch_is_seconds_not_milliseconds(self, monkeypatch):
        _install_scan(monkeypatch, FakeResponse(_load("tv_scanner_america.json")))
        events = fetch_events(now=NOW)
        assert events[0].event_date == "2026-11-12"

    def test_null_zero_and_out_of_window_rows_are_skipped(self, monkeypatch):
        _install_scan(monkeypatch, FakeResponse(_load("tv_scanner_america.json")))
        symbols = {ev.symbol for ev in fetch_events(now=NOW)}
        assert symbols == {"ORCL", "MSFT"}  # NVDA null, XYZ 0, FAR too far, PAST past

    def test_days_ahead_limits_the_horizon(self, monkeypatch):
        _install_scan(monkeypatch, FakeResponse(_load("tv_scanner_america.json")))
        events = fetch_events(days_ahead=30, now=NOW)
        assert [ev.event_date for ev in events] == ["2026-11-12"]

    def test_duplicate_rows_are_deduped(self, monkeypatch):
        row = {"s": "NASDAQ:ORCL", "d": ["NASDAQ:ORCL", "Oracle", "NASDAQ", 1794441600, None]}
        payload = {"data": [row, dict(row)]}
        _install_scan(monkeypatch, FakeResponse(payload))
        events = fetch_events(now=NOW)
        assert len(events) == 1

    @pytest.mark.parametrize(
        "entry",
        [
            {"s": "X", "d": ["X"]},  # too few columns
            {"s": "X"},  # no data list
            "not-a-row",
            None,
            {"s": "X", "d": ["N/A", "junk", "NASDAQ", 1794441600, None]},
        ],
    )
    def test_malformed_rows_are_skipped(self, monkeypatch, entry):
        _install_scan(monkeypatch, FakeResponse({"data": [entry]}))
        assert fetch_events(now=NOW) == []

    def test_bare_list_row_is_accepted(self, monkeypatch):
        payload = {"data": [["NASDAQ:ORCL", "Oracle", "NASDAQ", 1794441600, None]]}
        _install_scan(monkeypatch, FakeResponse(payload))
        events = fetch_events(now=NOW)
        assert events[0].symbol == "ORCL"

    def test_missing_text_columns_are_none(self, monkeypatch):
        payload = {"data": [["NASDAQ:ORCL", None, "NASDAQ", 1794441600, None]]}
        _install_scan(monkeypatch, FakeResponse(payload))
        events = fetch_events(now=NOW)
        assert events[0].name is None
        assert events[0].exchange == "NASDAQ"

    def test_unknown_exchange_is_dropped(self, monkeypatch):
        # `america` carries OTC/foreign listings with no exchange label; a US
        # calendar must never show them.
        payload = {"data": [["NASDAQ:ORCL", "Oracle", None, 1794441600, None]]}
        _install_scan(monkeypatch, FakeResponse(payload))
        assert fetch_events(now=NOW) == []

    def test_overflowing_epoch_is_skipped(self, monkeypatch):
        payload = {"data": [["NASDAQ:ORCL", "Oracle", "NASDAQ", 1e30, None]]}
        _install_scan(monkeypatch, FakeResponse(payload))
        assert fetch_events(now=NOW) == []

    def test_unparseable_payload_returns_empty(self, monkeypatch):
        class BadJson(FakeResponse):
            def json(self):
                raise ValueError("not json")

        _install_scan(monkeypatch, BadJson(None))
        assert fetch_events(now=NOW) == []

    def test_junk_epochs_are_skipped(self, monkeypatch):
        rows = [
            {"s": "A", "d": ["A", "A Corp", "NYSE", "abc", None]},
            {"s": "B", "d": ["B", "B Corp", "NYSE", float("nan"), float("inf")]},
            {"s": "C", "d": ["C", "C Corp", "NYSE", -5, None]},
        ]
        _install_scan(monkeypatch, FakeResponse({"data": rows}))
        assert fetch_events(now=NOW) == []

    @pytest.mark.parametrize("payload", [{}, {"data": None}, [1, 2], None])
    def test_bad_payload_returns_empty(self, monkeypatch, payload):
        _install_scan(monkeypatch, FakeResponse(payload))
        assert fetch_events(now=NOW) == []

    def test_naive_now_is_treated_as_utc(self, monkeypatch):
        naive = dt.datetime(2026, 10, 29, 12, 0)
        _install_scan(monkeypatch, FakeResponse(_load("tv_scanner_america.json")))
        events = fetch_events(now=naive)
        assert events[0].event_date == "2026-11-12"

    def test_now_defaults_to_real_clock(self, monkeypatch):
        # Only asserts it runs and returns events without raising on tz handling.
        _install_scan(monkeypatch, FakeResponse(_load("tv_scanner_america.json")))
        events = fetch_events()
        assert isinstance(events, list)
