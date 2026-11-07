"""TradingView scanner tests — earnings/ex-dividend rows from a recorded payload."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

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


class FakeClient:
    def __init__(self, response):
        self.response = response
        self.calls: list[dict] = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append(
            {"url": url, "json": json, "headers": headers, "timeout": timeout}
        )
        return self.response


class TestRequest:
    def test_body_and_url(self):
        client = FakeClient(FakeResponse(_load("tv_scanner_america.json")))
        fetch_events(client, market="america", days_ahead=120, limit=1500, now=NOW)

        assert len(client.calls) == 1
        call = client.calls[0]
        assert call["url"] == "https://scanner.tradingview.com/america/scan"
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

    def test_market_is_in_the_url(self):
        client = FakeClient(FakeResponse({"data": []}))
        fetch_events(client, market="india", now=NOW)
        assert client.calls[0]["url"] == (
            "https://scanner.tradingview.com/india/scan"
        )
        assert client.calls[0]["json"]["markets"] == ["india"]

    def test_non_200_raises_with_status(self):
        client = FakeClient(FakeResponse({}, status_code=500))
        with pytest.raises(RuntimeError, match="500"):
            fetch_events(client, now=NOW)

    def test_transport_error_is_wrapped(self):
        class Broken:
            def post(self, *args, **kwargs):
                raise OSError("connection reset")

        with pytest.raises(RuntimeError, match="tv_source_unavailable"):
            fetch_events(Broken(), now=NOW)


class TestParsing:
    def test_recorded_payload(self):
        client = FakeClient(FakeResponse(_load("tv_scanner_america.json")))
        events = fetch_events(client, days_ahead=120, now=NOW)

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

    def test_epoch_is_seconds_not_milliseconds(self):
        events = fetch_events(
            FakeClient(FakeResponse(_load("tv_scanner_america.json"))), now=NOW
        )
        assert events[0].event_date == "2026-11-12"

    def test_null_zero_and_out_of_window_rows_are_skipped(self):
        symbols = {ev.symbol for ev in fetch_events(
            FakeClient(FakeResponse(_load("tv_scanner_america.json"))), now=NOW
        )}
        assert symbols == {"ORCL", "MSFT"}  # NVDA null, XYZ 0, FAR too far, PAST past

    def test_days_ahead_limits_the_horizon(self):
        events = fetch_events(
            FakeClient(FakeResponse(_load("tv_scanner_america.json"))),
            days_ahead=30,
            now=NOW,
        )
        assert [ev.event_date for ev in events] == ["2026-11-12"]

    def test_duplicate_rows_are_deduped(self):
        row = {"s": "NASDAQ:ORCL", "d": ["NASDAQ:ORCL", "Oracle", "NASDAQ", 1794441600, None]}
        payload = {"data": [row, dict(row)]}
        events = fetch_events(FakeClient(FakeResponse(payload)), now=NOW)
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
    def test_malformed_rows_are_skipped(self, entry):
        assert fetch_events(FakeClient(FakeResponse({"data": [entry]})), now=NOW) == []

    def test_bare_list_row_is_accepted(self):
        payload = {"data": [["NASDAQ:ORCL", "Oracle", "NASDAQ", 1794441600, None]]}
        events = fetch_events(FakeClient(FakeResponse(payload)), now=NOW)
        assert events[0].symbol == "ORCL"

    def test_missing_text_columns_are_none(self):
        payload = {"data": [["NASDAQ:ORCL", None, "NASDAQ", 1794441600, None]]}
        events = fetch_events(FakeClient(FakeResponse(payload)), now=NOW)
        assert events[0].name is None
        assert events[0].exchange == "NASDAQ"

    def test_unknown_exchange_is_dropped(self):
        # `america` carries OTC/foreign listings with no exchange label; a US
        # calendar must never show them.
        payload = {"data": [["NASDAQ:ORCL", "Oracle", None, 1794441600, None]]}
        assert fetch_events(FakeClient(FakeResponse(payload)), now=NOW) == []

    def test_overflowing_epoch_is_skipped(self):
        payload = {"data": [["NASDAQ:ORCL", "Oracle", "NASDAQ", 1e30, None]]}
        assert fetch_events(FakeClient(FakeResponse(payload)), now=NOW) == []

    def test_unparseable_payload_returns_empty(self):
        class BadJson(FakeResponse):
            def json(self):
                raise ValueError("not json")

        client = FakeClient(BadJson(None))
        assert fetch_events(client, now=NOW) == []

    def test_junk_epochs_are_skipped(self):
        rows = [
            {"s": "A", "d": ["A", "A Corp", "NYSE", "abc", None]},
            {"s": "B", "d": ["B", "B Corp", "NYSE", float("nan"), float("inf")]},
            {"s": "C", "d": ["C", "C Corp", "NYSE", -5, None]},
        ]
        assert fetch_events(FakeClient(FakeResponse({"data": rows})), now=NOW) == []

    @pytest.mark.parametrize("payload", [{}, {"data": None}, [1, 2], None])
    def test_bad_payload_returns_empty(self, payload):
        assert fetch_events(FakeClient(FakeResponse(payload)), now=NOW) == []

    def test_naive_now_is_treated_as_utc(self):
        naive = dt.datetime(2026, 10, 29, 12, 0)
        events = fetch_events(
            FakeClient(FakeResponse(_load("tv_scanner_america.json"))), now=naive
        )
        assert events[0].event_date == "2026-11-12"

    def test_now_defaults_to_real_clock(self):
        # Only asserts it runs and returns events without raising on tz handling.
        events = fetch_events(
            FakeClient(FakeResponse(_load("tv_scanner_america.json")))
        )
        assert isinstance(events, list)
