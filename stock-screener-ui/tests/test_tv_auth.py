"""Tests for the authenticated TradingView scanner provider."""

import json

import pytest

from api.tv import auth as tv_auth
from api.tv import client as tv_client


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    tv_auth.clear_tv_cookie_cache()
    for key in ("TRADINGVIEW_COOKIES", "TV_COOKIES"):
        monkeypatch.delenv(key, raising=False)
    yield
    tv_auth.clear_tv_cookie_cache()


def test_parse_env_json_dict():
    assert tv_auth._parse_env_cookies('{"sessionid": "abc", "sessionid_sign": "def"}') == {
        "sessionid": "abc",
        "sessionid_sign": "def",
    }


def test_parse_env_json_list():
    raw = json.dumps([{"name": "sessionid", "value": "abc"}, {"name": "sp", "value": "1"}])
    assert tv_auth._parse_env_cookies(raw) == {"sessionid": "abc", "sp": "1"}


def test_parse_env_cookie_header():
    assert tv_auth._parse_env_cookies("sessionid=abc; sessionid_sign=def; path=/") == {
        "sessionid": "abc",
        "sessionid_sign": "def",
        "path": "/",
    }


def test_get_tv_cookies_prefers_env(monkeypatch):
    monkeypatch.setenv("TV_COOKIES", '{"sessionid": "abc"}')

    jar = tv_auth.get_tv_cookies()

    assert jar == {"sessionid": "abc"}
    assert tv_auth.tv_auth_status()["source"] == "env"
    assert tv_auth.tv_auth_status()["cookie_count"] == 1


def test_get_tv_cookies_negative_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(tv_auth, "_from_browser", lambda: calls.append(1) or None)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    assert tv_auth.get_tv_cookies() is None
    assert tv_auth.get_tv_cookies() is None
    assert calls == [1]  # second call is served by the negative cache


def test_get_tv_cookies_refresh_forces_retry(monkeypatch):
    calls = []
    monkeypatch.setattr(tv_auth, "_from_browser", lambda: calls.append(1) or {"sessionid": "x"})
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    first = tv_auth.get_tv_cookies()
    second = tv_auth.get_tv_cookies()
    forced = tv_auth.refresh_tv_cookies()

    assert first == second == forced == {"sessionid": "x"}
    assert len(calls) == 2  # cached hit does not re-read the browser


def test_tv_scanner_data_passes_cookies(monkeypatch):
    monkeypatch.setattr(tv_client, "get_tv_cookies", lambda **kw: {"sessionid": "abc"})

    class Query:
        kwargs = None

        def get_scanner_data(self, **kwargs):
            Query.kwargs = kwargs
            return 3, "frame"

    result = tv_client.get_scanner_data(Query())

    assert result == (3, "frame")
    assert Query.kwargs == {"cookies": {"sessionid": "abc"}}


def test_tv_scanner_data_without_cookies(monkeypatch):
    monkeypatch.setattr(tv_client, "get_tv_cookies", lambda **kw: None)

    class Query:
        kwargs = None

        def get_scanner_data(self, **kwargs):
            Query.kwargs = kwargs
            return 0, "frame"

    assert tv_client.get_scanner_data(Query()) == (0, "frame")
    assert Query.kwargs == {}


def test_tv_auth_status_unauthenticated():
    status = tv_auth.tv_auth_status()

    assert status == {
        "authenticated": False,
        "source": "none",
        "cookie_count": 0,
        "cache_age_sec": None,
    }


def test_clear_cache_resets_status(monkeypatch):
    monkeypatch.setenv("TV_COOKIES", "sessionid=abc")
    assert tv_auth.get_tv_cookies() == {"sessionid": "abc"}

    tv_auth.clear_tv_cookie_cache()

    assert tv_auth.tv_auth_status()["authenticated"] is False
