"""Tests for the Upstox news client and the burst↔news matcher.

No network: `requests.get` is monkeypatched.
"""

from __future__ import annotations

import json

import pytest

from api.news import upstox_news
from api.reports_api.nifty_bursts import NEWS_WINDOW_MIN, attach_news


class _Resp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


# --------------------------------------------------------------------- fetch


def test_fetch_returns_empty_without_token(monkeypatch):
    monkeypatch.setattr(upstox_news, "resolve_upstox_token", lambda: None)
    called = {"n": 0}
    monkeypatch.setattr(upstox_news.requests, "get", lambda *a, **k: called.__setitem__("n", called["n"] + 1))
    assert upstox_news.fetch_upstox_news(["NSE_EQ|INE002A01018"]) == []
    assert called["n"] == 0  # never hits the network without a token


def test_fetch_requires_keys_for_instrument_category(monkeypatch):
    monkeypatch.setattr(upstox_news, "resolve_upstox_token", lambda: "tok")
    assert upstox_news.fetch_upstox_news([], category="instrument_keys") == []


def test_fetch_flattens_instrument_keyed_payload(monkeypatch):
    payload = {
        "status": "success",
        "data": {
            "NSE_EQ|INE040H01021": [
                {
                    "heading": "FM Sitharaman open to LTCG tax rethink",
                    "summary": "Government will keenly hear views",
                    "thumbnail": "https://x/t.webp",
                    "article_link": "https://upstox.com/news/a/article-1/",
                    "published_time": 1760346000000,
                }
            ],
            "NSE_EQ|INE002A01018": [
                {"heading": "Reliance Q2 results today", "article_link": "https://upstox.com/news/b/article-2/",
                 "published_time": 1760349000000}
            ],
        },
    }
    monkeypatch.setattr(upstox_news, "resolve_upstox_token", lambda: "tok")
    monkeypatch.setattr(upstox_news.requests, "get", lambda *a, **k: _Resp(200, payload))

    items = upstox_news.fetch_upstox_news(["NSE_EQ|INE040H01021"])
    assert len(items) == 2
    first = items[0]
    assert first["instrument_key"] == "NSE_EQ|INE040H01021"
    assert first["heading"] == "FM Sitharaman open to LTCG tax rethink"
    assert first["published_time"] == 1760346000000
    assert first["source"] == "upstox"
    assert first["article_link"].endswith("article-1/")


def test_fetch_sends_at_most_30_keys(monkeypatch):
    seen = {}

    def _get(url, params=None, headers=None, timeout=None):
        seen["params"] = params
        return _Resp(200, {"status": "success", "data": {}})

    monkeypatch.setattr(upstox_news, "resolve_upstox_token", lambda: "tok")
    monkeypatch.setattr(upstox_news.requests, "get", _get)
    keys = [f"NSE_EQ|INE{i:09d}" for i in range(40)]
    upstox_news.fetch_upstox_news(keys)
    sent = seen["params"]["instrument_keys"].split(",")
    assert len(sent) == upstox_news.MAX_INSTRUMENT_KEYS == 30


@pytest.mark.parametrize(
    "resp",
    [
        _Resp(401, {"status": "error"}),
        _Resp(500, None),
        _Resp(200, None),                      # non-JSON body
        _Resp(200, {"status": "error"}),       # error envelope
        _Resp(200, {"status": "success", "data": "nope"}),
    ],
)
def test_fetch_never_raises_and_returns_empty(monkeypatch, resp):
    monkeypatch.setattr(upstox_news, "resolve_upstox_token", lambda: "tok")
    monkeypatch.setattr(upstox_news.requests, "get", lambda *a, **k: resp)
    assert upstox_news.fetch_upstox_news(["NSE_EQ|INE002A01018"]) == []


def test_fetch_survives_request_exception(monkeypatch):
    def _boom(*a, **k):
        raise upstox_news.requests.RequestException("network down")

    monkeypatch.setattr(upstox_news, "resolve_upstox_token", lambda: "tok")
    monkeypatch.setattr(upstox_news.requests, "get", _boom)
    assert upstox_news.fetch_upstox_news(["NSE_EQ|INE002A01018"]) == []


def test_fetch_skips_items_without_heading(monkeypatch):
    payload = {"status": "success", "data": {"K": [{"summary": "no heading"}, "junk", None]}}
    monkeypatch.setattr(upstox_news, "resolve_upstox_token", lambda: "tok")
    monkeypatch.setattr(upstox_news.requests, "get", lambda *a, **k: _Resp(200, payload))
    assert upstox_news.fetch_upstox_news(["K"]) == []


def test_positions_category_omits_instrument_keys(monkeypatch):
    seen = {}

    def _get(url, params=None, headers=None, timeout=None):
        seen["params"] = params
        return _Resp(200, {"status": "success", "data": {}})

    monkeypatch.setattr(upstox_news, "resolve_upstox_token", lambda: "tok")
    monkeypatch.setattr(upstox_news.requests, "get", _get)
    upstox_news.fetch_upstox_news_for_positions()
    assert seen["params"]["category"] == "positions"
    assert "instrument_keys" not in seen["params"]


# -------------------------------------------------------------------- matches


def _burst(t: str) -> dict:
    return {"t": t, "side": "call", "delta": -16_000_000}


def test_attach_news_ranks_relevant_headline_first():
    bursts = [_burst("2026-10-13T14:20:00+05:30")]
    articles = [
        {"heading": "Unrelated sports story", "published_at": "2026-10-13T14:25:00+05:30", "url": "y"},
        {"heading": "FM Sitharaman open to LTCG tax rethink",
         "published_at": "2026-10-13T14:19:00+05:30", "url": "x"},
    ]
    out = attach_news(bursts, articles)
    news = out[0]["news"]
    assert news[0]["heading"].startswith("FM Sitharaman")
    assert news[0]["minutes_away"] == pytest.approx(-1.0)
    assert news[1]["minutes_away"] == pytest.approx(5.0)


def test_attach_news_respects_the_window():
    bursts = [_burst("2026-10-13T14:20:00+05:30")]
    articles = [{"heading": "Too early", "published_at": "2026-10-13T10:00:00+05:30"}]
    out = attach_news(bursts, articles, window_min=10)
    assert out[0]["news"] == []
    # widen the window and it qualifies
    out2 = attach_news([_burst("2026-10-13T14:20:00+05:30")], articles, window_min=300)
    assert len(out2[0]["news"]) == 1


def test_attach_news_accepts_epoch_ms_and_datetime():
    from datetime import datetime, timezone
    bursts = [_burst("2026-10-13T14:20:00+05:30")]
    # 14:20 IST == 08:50 UTC
    ms = int(datetime(2026, 10, 13, 8, 50, tzinfo=timezone.utc).timestamp() * 1000)
    out = attach_news(bursts, [{"heading": "Epoch ms headline", "published_time": ms}])
    assert out[0]["news"][0]["minutes_away"] == pytest.approx(0.0)
    out2 = attach_news([_burst("2026-10-13T14:20:00+05:30")],
                       [{"heading": "Datetime headline",
                         "published_at": datetime(2026, 10, 13, 8, 45, tzinfo=timezone.utc)}])
    assert out2[0]["news"][0]["minutes_away"] == pytest.approx(-5.0)


def test_attach_news_caps_at_three_and_handles_no_articles():
    bursts = [_burst("2026-10-13T14:20:00+05:30")]
    many = [{"heading": f"H{i}", "published_at": f"2026-10-13T14:{19 + i // 2:02d}:00+05:30"}
            for i in range(6)]
    assert len(attach_news(bursts, many)[0]["news"]) == 3
    assert attach_news([_burst("2026-10-13T14:20:00+05:30")], [])[0]["news"] == []
    # every burst gets the key even with no articles
    assert all("news" in b for b in attach_news([_burst("x"), _burst("y")], []))


def test_attach_news_is_safe_on_unparseable_burst_time():
    out = attach_news([{"t": "not-a-time"}], [{"heading": "H"}])
    assert out[0]["news"] == []


def test_news_window_default_is_ten_minutes():
    assert NEWS_WINDOW_MIN == 10.0
    assert json.dumps(attach_news([_burst("2026-10-13T14:20:00+05:30")], []))  # JSON-serialisable
