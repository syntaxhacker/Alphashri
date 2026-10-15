"""Tests for OpenRouter free-model news impact scoring (`api/news/news_impact.py`).

No network: `requests.post` is monkeypatched.
"""

from __future__ import annotations

import json

import pytest

from api.news import news_impact


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def _envelope(content: str) -> dict:
    return {"choices": [{"message": {"content": content}}]}


# ------------------------------------------------------------------- parsing


def test_extract_json_array_handles_plain_fenced_and_prose():
    plain = '[{"i":1,"move":true,"dir":"bullish","impact":5,"why":"x"}]'
    assert news_impact._extract_json_array(plain) == json.loads(plain)

    fenced = "```json\n" + plain + "\n```"
    assert news_impact._extract_json_array(fenced) == json.loads(plain)

    bare_fence = "```\n" + plain + "\n```"
    assert news_impact._extract_json_array(bare_fence) == json.loads(plain)

    prose = "Sure, here you go:\n" + plain + "\nHope that helps!"
    assert news_impact._extract_json_array(prose) == json.loads(plain)


def test_extract_json_array_rejects_non_arrays_and_junk():
    assert news_impact._extract_json_array("") is None
    assert news_impact._extract_json_array("no json here") is None
    assert news_impact._extract_json_array('{"i":1}') is None


# --------------------------------------------------------------------- models


def test_default_model_is_a_free_openrouter_endpoint(monkeypatch):
    assert news_impact.DEFAULT_MODEL.endswith(":free")
    assert all(m.endswith(":free") or m == "openrouter/free"
               for m in news_impact.FALLBACK_MODELS)


def test_no_api_key_short_circuits(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", None)
    called = {"n": 0}
    monkeypatch.setattr(news_impact.requests, "post",
                        lambda *a, **k: called.__setitem__("n", called["n"] + 1))
    assert news_impact.score_headlines(["a headline"]) == []
    assert called["n"] == 0


def test_empty_headlines_short_circuit(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")
    called = {"n": 0}
    monkeypatch.setattr(news_impact.requests, "post",
                        lambda *a, **k: called.__setitem__("n", called["n"] + 1))
    assert news_impact.score_headlines([]) == []
    assert news_impact.score_headlines(["", "   "]) == []
    assert called["n"] == 0


# --------------------------------------------------------------------- calls


def test_batches_all_headlines_into_one_request(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")
    seen = {}

    def _post(url, headers=None, data=None, timeout=None):
        seen["url"] = url
        seen["headers"] = headers
        seen["body"] = json.loads(data)
        return _Resp(200, _envelope('[{"i":1,"move":true,"dir":"bullish","impact":4,"why":"w"}]'))

    monkeypatch.setattr(news_impact.requests, "post", _post)
    out = news_impact.score_headlines(["headline one", "headline two"])

    assert seen["url"] == news_impact.OPENROUTER_URL
    assert seen["headers"]["Authorization"] == "Bearer k"
    body = seen["body"]
    assert body["model"] == news_impact.DEFAULT_MODEL
    assert body["temperature"] == 0
    user = body["messages"][1]["content"]
    assert "1. headline one" in user and "2. headline two" in user

    assert out[0]["index"] == 0
    assert out[0]["move"] is True
    assert out[0]["dir"] == "bullish"
    assert out[0]["impact"] == 4
    assert out[0]["model"] == news_impact.DEFAULT_MODEL


def test_caps_headline_count(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")
    seen = {}

    def _post(url, headers=None, data=None, timeout=None):
        seen["body"] = json.loads(data)
        return _Resp(200, _envelope("[]"))

    monkeypatch.setattr(news_impact.requests, "post", _post)
    heads = [f"h{i}" for i in range(50)]
    news_impact.score_headlines(heads)
    user = seen["body"]["messages"][1]["content"]
    assert user.count("\n") == news_impact.MAX_HEADLINES  # one line per headline
    assert f"{news_impact.MAX_HEADLINES}." in user
    assert f"{news_impact.MAX_HEADLINES + 1}." not in user


def test_falls_back_to_the_next_model_on_failure(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")
    tried = []

    def _post(url, headers=None, data=None, timeout=None):
        model = json.loads(data)["model"]
        tried.append(model)
        if model == news_impact.DEFAULT_MODEL:
            return _Resp(429, None)          # rate limited
        return _Resp(200, _envelope('[{"i":1,"move":false,"dir":"neutral","impact":2,"why":"w"}]'))

    monkeypatch.setattr(news_impact.requests, "post", _post)
    out = news_impact.score_headlines(["a headline"])

    assert tried[0] == news_impact.DEFAULT_MODEL
    assert tried[1] == news_impact.FALLBACK_MODELS[0]
    assert out[0]["model"] == news_impact.FALLBACK_MODELS[0]


def test_returns_empty_when_every_model_fails(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")
    monkeypatch.setattr(news_impact.requests, "post", lambda *a, **k: _Resp(500, None))
    assert news_impact.score_headlines(["a headline"]) == []


def test_request_exception_is_swallowed(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")

    def _boom(*a, **k):
        raise news_impact.requests.RequestException("down")

    monkeypatch.setattr(news_impact.requests, "post", _boom)
    assert news_impact.score_headlines(["a headline"]) == []


def test_non_json_envelope_is_swallowed(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")
    monkeypatch.setattr(news_impact.requests, "post", lambda *a, **k: _Resp(200, None))
    assert news_impact.score_headlines(["a headline"]) == []


# ---------------------------------------------------------------- validation


def test_verdicts_are_validated_and_bad_rows_dropped(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")
    content = json.dumps([
        {"i": 1, "move": True, "dir": "BULLISH", "impact": 99, "why": "clamped"},
        {"i": 2, "move": False, "dir": "sideways", "impact": "x", "why": "bad dir"},
        {"i": 99, "move": True, "dir": "bullish", "impact": 5, "why": "out of range"},
        {"i": "nope", "move": True, "dir": "bullish", "impact": 5, "why": "bad index"},
        "junk",
    ])
    monkeypatch.setattr(news_impact.requests, "post", lambda *a, **k: _Resp(200, _envelope(content)))

    out = news_impact.score_headlines(["one", "two"])
    assert [v["index"] for v in out] == [0, 1]
    assert out[0]["impact"] == 5          # clamped from 99
    assert out[0]["dir"] == "bullish"     # lower-cased
    assert out[1]["dir"] == "neutral"     # unknown dir -> neutral
    assert out[1]["impact"] == 3          # unparseable impact -> default


def test_returns_empty_when_model_gives_no_valid_rows(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")
    monkeypatch.setattr(news_impact.requests, "post",
                        lambda *a, **k: _Resp(200, _envelope("[1, 2, 3]")))
    assert news_impact.score_headlines(["one"]) == []


def test_unknown_directory_symbol_is_truncated(monkeypatch):
    monkeypatch.setattr(news_impact.config, "OPENROUTER_API_KEY", "k")
    long_symbol = "X" * 100
    content = json.dumps([{"i": 1, "move": True, "dir": "bullish",
                           "impact": 5, "symbol": long_symbol, "why": "w"}])
    monkeypatch.setattr(news_impact.requests, "post", lambda *a, **k: _Resp(200, _envelope(content)))
    out = news_impact.score_headlines(["one"])
    assert len(out[0]["symbol"]) <= 24


# ----------------------------------------------------------------- throttle

class TestFreeTierThrottle:
    """Free tier is 20 req/min and 50 req/day per account — a 60s poller would
    exhaust it in under an hour, so scoring must be rate-limited."""

    def setup_method(self):
        news_impact._last_call_ts = 0.0
        news_impact._calls_today = 0
        news_impact._calls_day = ""

    def test_first_call_is_allowed_then_blocked_until_the_interval(self):
        assert news_impact._throttled() is False
        news_impact._record_call()
        assert news_impact._throttled() is True
        news_impact._last_call_ts -= news_impact.MIN_INTERVAL_SEC + 1
        assert news_impact._throttled() is False

    def test_daily_cap_blocks_regardless_of_interval(self):
        import time
        news_impact._calls_day = time.strftime("%Y-%m-%d")  # same day, so no reset
        news_impact._last_call_ts = time.time() - 100_000
        news_impact._calls_today = news_impact.MAX_CALLS_PER_DAY
        assert news_impact._throttled() is True

    def test_counter_resets_on_a_new_day(self):
        news_impact._calls_today = news_impact.MAX_CALLS_PER_DAY
        news_impact._calls_day = "1970-01-01"
        # a new calendar day resets the counter, so the call is allowed
        news_impact._last_call_ts = 0.0
        assert news_impact._throttled() is False
        assert news_impact._calls_today == 0

    def test_budget_fits_a_session(self):
        # 6.5h session at one call per interval must stay under the daily cap
        assert (6.5 * 3600 / news_impact.MIN_INTERVAL_SEC) < news_impact.MAX_CALLS_PER_DAY

    def test_score_recent_articles_is_a_noop_when_throttled(self, monkeypatch):
        called = {"post": 0}
        monkeypatch.setattr(news_impact.requests, "post",
                            lambda *a, **k: called.__setitem__("post", 1))
        news_impact._record_call()  # now throttled

        out = news_impact.score_recent_articles()
        assert out["throttled"] == 1
        assert out["scored"] == 0
        assert called["post"] == 0


# --------------------------------------------------- score_recent_articles

class _Row:
    def __init__(self, headline):
        self.headline = headline
        self.impact_score = None
        self.sentiment = None
        self.analysis_json = None


class _ChainableQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def all(self):
        return self._rows


class _Session:
    def __init__(self, rows):
        self._rows = rows
        self.committed = 0
        self.closed = False

    def query(self, *a, **k):
        return _ChainableQuery(self._rows)

    def commit(self):
        self.committed += 1

    def close(self):
        self.closed = True


class _Col:
    """Stub SQLAlchemy column: supports the expressions the query builds."""
    def is_(self, other):
        return self

    def desc(self):
        return self

    def nullslast(self):
        return self


class _FakeModel:
    impact_score = _Col()
    published_at = _Col()


def _patch_db(monkeypatch, rows):
    """Point score_recent_articles at a fake session holding `rows`."""
    import db.database as database
    import db.models.news as news_models
    session = _Session(rows)
    monkeypatch.setattr(database, "SessionLocal", lambda: session)
    monkeypatch.setattr(news_models, "NewsArticle", _FakeModel)
    return session


class TestScoreRecentArticles:
    def setup_method(self):
        news_impact._last_call_ts = 0.0
        news_impact._calls_today = 0
        news_impact._calls_day = ""

    def test_blank_headline_rows_are_marked_terminal_without_a_model_call(self, monkeypatch):
        """Regression: blank headlines stayed impact_score=NULL, so every cycle
        re-selected them and burnt a free-tier call for zero work."""
        rows = [_Row("   "), _Row("")]
        session = _patch_db(monkeypatch, rows)
        called = {"n": 0}
        monkeypatch.setattr(news_impact, "score_headlines",
                            lambda *a, **k: called.__setitem__("n", called["n"] + 1) or [])

        stats = news_impact.score_recent_articles()

        assert stats["skipped"] == 2
        assert stats["scored"] == 0
        assert called["n"] == 0                      # no quota burnt
        assert news_impact._calls_today == 0
        assert all(r.impact_score == 0 for r in rows)  # now terminal
        assert session.committed == 1

    def test_verdict_indexes_map_into_the_scorable_list_not_the_raw_rows(self, monkeypatch):
        """The filter shifts indices; using the raw row list would mis-assign."""
        rows = [_Row("   "), _Row("Real headline one is long enough"), _Row("Real headline two is long enough")]
        session = _patch_db(monkeypatch, rows)
        # model returns index 0 -> must hit the FIRST SCORABLE row (index 1 overall)
        monkeypatch.setattr(news_impact, "score_headlines", lambda *a, **k: [
            {"index": 0, "move": True, "symbol": "NIFTY", "dir": "bullish",
             "impact": 5, "why": "w", "model": "m"},
        ])

        stats = news_impact.score_recent_articles()

        assert stats["skipped"] == 1
        assert stats["scored"] == 1
        assert stats["moved"] == 1
        assert rows[0].impact_score == 0            # blank -> terminal 0
        assert rows[1].impact_score == 5            # verdict landed here
        assert rows[2].impact_score is None         # untouched
        assert news_impact._calls_today == 1
        assert session.committed == 1

    def test_quota_is_only_consumed_when_there_is_real_work(self, monkeypatch):
        rows = [_Row("A perfectly good headline that is long enough")]
        _patch_db(monkeypatch, rows)
        monkeypatch.setattr(news_impact, "score_headlines", lambda *a, **k: [])
        news_impact.score_recent_articles()
        assert news_impact._calls_today == 1  # a real call was attempted
