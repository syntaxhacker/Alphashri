"""Tests for the single TradingView source of truth (`api.tv`)."""

import logging
import threading

import pandas as pd
import pytest
import requests

from api import tv
from api.tv import client, status


class _Response:
    """Minimal requests.Response stand-in for transport tests."""

    def __init__(self, code=200, payload=None):
        self.status_code = code
        self._payload = payload or {"data": []}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(
                f"HTTP {self.status_code}", response=self
            )

    def json(self):
        return self._payload


class _Session:
    """Scripted stand-in for the thread-local requests.Session."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _use_session(monkeypatch, responses):
    session = _Session(responses)
    monkeypatch.setattr(client, "_get_session", lambda: session)
    monkeypatch.setattr(client, "get_tv_cookies", lambda: None)
    return session


def test_symbols_round_trip():
    assert tv.normalize_tv_symbol("NSE:BAJAJ_AUTO") == "BAJAJ-AUTO"
    assert tv.normalize_tv_symbol("BAJAJ_AUTO") == "BAJAJ-AUTO"
    assert tv.normalize_tv_symbol("NSE:IDEA") == "IDEA"
    assert tv.normalize_tv_symbol("M&M") == "M&M"
    assert tv.normalize_tv_symbol("SIEMENS") == "SIEMENS"
    assert tv.normalize_tv_symbol("20MICRONS") == "20MICRONS"
    assert tv.normalize_tv_symbol("CONS") == "CONS"
    assert tv.normalize_tv_symbol("TEMBO") == "TEMBO"
    assert tv.to_tv_ticker("BAJAJ-AUTO") == "NSE:BAJAJ_AUTO"
    assert tv.to_tv_ticker("TEMBO") == "NSE:TEMBO"
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


# --------------------------------------------------------------------------- #
# Shared transport policy: thread-local session, bounded retry/backoff
# --------------------------------------------------------------------------- #

def test_get_session_is_reused_per_thread(monkeypatch):
    monkeypatch.setattr(client._tls, "session", None, raising=False)
    main = client._get_session()
    assert isinstance(main, requests.Session)
    assert client._get_session() is main

    other = []
    thread = threading.Thread(target=lambda: other.append(client._get_session()))
    thread.start()
    thread.join(5)
    assert other and other[0] is not main


def test_scan_raw_posts_through_session_with_40s_timeout(monkeypatch):
    session = _use_session(monkeypatch, [_Response()])
    client.scan_raw("india", {"markets": ["india"]})
    assert len(session.calls) == 1
    assert session.calls[0][1]["timeout"] == 40


def test_scan_raw_401_refreshes_cookies_and_retries_once(monkeypatch):
    session = _use_session(monkeypatch, [_Response(401), _Response()])
    cookies_seen = []

    def cookies():
        cookies_seen.append("fresh" if len(cookies_seen) else "stale")
        return {"sessionid": cookies_seen[-1]}

    refreshes = []
    monkeypatch.setattr(client, "get_tv_cookies", cookies)
    monkeypatch.setattr(client, "refresh_tv_cookies", lambda: refreshes.append(True))

    client.scan_raw("india", {})

    assert len(session.calls) == 2
    assert refreshes == [True]
    assert cookies_seen == ["stale", "fresh"]
    assert session.calls[0][1]["cookies"] == {"sessionid": "stale"}
    assert session.calls[1][1]["cookies"] == {"sessionid": "fresh"}


def test_scan_raw_403_refreshes_once_then_surfaces_second_403(monkeypatch):
    session = _use_session(monkeypatch, [_Response(403), _Response(403)])
    refreshes = []
    monkeypatch.setattr(client, "refresh_tv_cookies", lambda: refreshes.append(True))

    with pytest.raises(requests.HTTPError) as exc:
        client.scan_raw("india", {})
    assert exc.value.response.status_code == 403
    assert len(session.calls) == 2
    assert refreshes == [True]


def test_scan_raw_429_uses_jittered_exponential_backoff(monkeypatch):
    session = _use_session(monkeypatch, [_Response(429), _Response(429), _Response()])
    delays = []
    monkeypatch.setattr(client, "_sleep", delays.append)
    monkeypatch.setattr(client, "_jitter", lambda low, high: high / 2)

    client.scan_raw("india", {})

    assert len(session.calls) == 3
    assert delays == [0.25, 0.5]  # full jitter over 0.5s, then 1.0s ceilings


def test_scan_raw_exhausted_5xx_retries_raise_last_error(monkeypatch):
    session = _use_session(
        monkeypatch, [_Response(500), _Response(503), _Response(500)]
    )
    delays = []
    monkeypatch.setattr(client, "_sleep", delays.append)
    monkeypatch.setattr(client, "_jitter", lambda low, high: high)

    with pytest.raises(requests.HTTPError) as exc:
        client.scan_raw("india", {})
    assert exc.value.response.status_code == 500
    assert len(session.calls) == 3
    assert len(delays) == 2


def test_scan_raw_does_not_retry_validation_errors(monkeypatch):
    session = _use_session(monkeypatch, [_Response(422)])
    delays = []
    monkeypatch.setattr(client, "_sleep", delays.append)

    with pytest.raises(requests.HTTPError):
        client.scan_raw("india", {})
    assert len(session.calls) == 1
    assert not delays


def test_scan_raw_never_logs_cookies(monkeypatch, caplog):
    session = _use_session(monkeypatch, [_Response(401), _Response()])
    monkeypatch.setattr(client, "get_tv_cookies", lambda: {"sessionid": "SECRET_VALUE"})
    monkeypatch.setattr(client, "refresh_tv_cookies", lambda: None)

    with caplog.at_level(logging.DEBUG):
        client.scan_raw("india", {})

    assert len(session.calls) == 2
    assert "SECRET_VALUE" not in caplog.text
