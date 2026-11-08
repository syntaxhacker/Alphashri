"""Tests for the single TradingView source of truth (`api.tv`)."""

import pandas as pd
import pytest

from api import tv
from api.tv import client, status


def test_symbols_round_trip():
    assert tv.normalize_tv_symbol("NSE:BAJAJ_AUTO") == "BAJAJ-AUTO"
    assert tv.normalize_tv_symbol("BAJAJ_AUTO") == "BAJAJ-AUTO"
    assert tv.normalize_tv_symbol("NSE:IDEA") == "IDEA"
    assert tv.normalize_tv_symbol("M&M") == "M&M"
    assert tv.normalize_tv_symbol("SIEMENS") == "SIEMENS"
    assert tv.normalize_tv_symbol("20MICRONS") == "20MICRONS"
    assert tv.normalize_tv_symbol("CONS") == "CONS"
    assert tv.to_tv_ticker("BAJAJ-AUTO") == "NSE:BAJAJ_AUTO"
    assert tv.to_tv_ticker("M&M") == "NSE:M&M"
    assert tv.to_tv_ticker("SIEMENS") == "NSE:SIEMENS"
    assert tv.to_tv_ticker("BOSCH-HCIL") == "NSE:BOSCH_HCIL"
    assert tv.to_tv_ticker("", "NSE") == ""


def test_strip_prefix():
    assert tv.strip_tv_prefix("NSE:IDEA") == "IDEA"
    assert tv.strip_tv_prefix("NSE_EQ:IDEA") == "IDEA"
    assert tv.strip_tv_prefix("NYSE:IBM") == "IBM"
    assert tv.strip_tv_prefix("IDEA") == "IDEA"


def test_resolve_market():
    assert tv.resolve_market("india") == "india"
    assert tv.resolve_market("usa") == "america"
    assert tv.resolve_market("america") == "america"
    assert tv.resolve_market("global") == "global"
    with pytest.raises(ValueError):
        tv.resolve_market("nowhere")


def test_scan_raw_passes_cookies(monkeypatch):
    seen = {}

    def fake_post(url, **kwargs):
        seen.update(url=url, kwargs=kwargs)
        return object()

    monkeypatch.setattr(client.requests, "post", fake_post)
    monkeypatch.setattr(client, "get_tv_cookies", lambda: {"sessionid": "abc"})

    client.scan_raw("india", {"markets": ["india"]})

    assert seen["url"] == "https://scanner.tradingview.com/india/scan"
    assert seen["kwargs"]["cookies"] == {"sessionid": "abc"}
    assert seen["kwargs"]["json"] == {"markets": ["india"]}


def test_scan_raw_without_cookies(monkeypatch):
    seen = {}

    def fake_post(url, **kwargs):
        seen.update(kwargs=kwargs)
        return object()

    monkeypatch.setattr(client.requests, "post", fake_post)
    monkeypatch.setattr(client, "get_tv_cookies", lambda: None)

    client.scan_raw("india", {})

    assert "cookies" not in seen["kwargs"]


def test_scan_frame_builds_body_and_notes_mode(monkeypatch):
    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "data": [
                    {"d": ["RELIANCE", 2946.0, "streaming"]},
                    {"d": ["TCS", 4000.0, "streaming"]},
                ]
            }

    seen = {}

    def fake_scan_raw(market, body, **kwargs):
        seen.update(market=market, body=body)
        return Response()

    monkeypatch.setattr(client, "scan_raw", fake_scan_raw)
    monkeypatch.setattr(client, "note_update_mode", status.note_update_mode)

    df = client.scan_frame(
        "usa",
        columns=["name", "close", "update_mode"],
        filters=[{"left": "type", "operation": "equal", "right": "stock"}],
        sort="market_cap_basic",
        limit=10,
        markets=["america"],
    )

    assert seen["market"] == "usa"
    assert seen["body"]["markets"] == ["america"]
    assert seen["body"]["range"] == [0, 10]
    assert seen["body"]["sort"] == {"sortBy": "market_cap_basic", "sortOrder": "desc"}
    assert list(df.columns) == ["name", "close", "update_mode"]
    assert df["close"].tolist() == [2946.0, 4000.0]
    assert tv.tv_feed_status()["mode"] == "streaming"
    assert tv.tv_feed_status()["live"] is True


def test_get_scanner_data_passes_cookies(monkeypatch):
    class Query:
        kwargs = None

        def get_scanner_data(self, **kwargs):
            Query.kwargs = kwargs
            return 2, pd.DataFrame({"update_mode": ["delayed_streaming_900"]})

    monkeypatch.setattr(client, "get_tv_cookies", lambda: {"sessionid": "abc"})
    status._last.update(mode=None, at=None, rows=0)

    total, df = client.get_scanner_data(Query())

    assert total == 2
    assert Query.kwargs == {"cookies": {"sessionid": "abc"}}
    assert tv.tv_feed_status()["mode"] == "delayed_streaming_900"
    assert tv.tv_feed_status()["delayed"] is True


def test_feed_status_empty():
    status._last.update(mode=None, at=None, rows=0)
    assert tv.tv_feed_status() == {
        "mode": None,
        "live": None,
        "delayed": None,
        "rows": 0,
        "age_sec": None,
    }
