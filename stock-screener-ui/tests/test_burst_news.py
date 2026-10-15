"""Tests for the pure burst↔news matcher (`attach_news`).

The matcher is source-agnostic: whatever produces headlines (RSS, an LLM
scorer, a wire) they flow through here to be attached to bursts.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from api.reports_api.nifty_bursts import NEWS_WINDOW_MIN, attach_news


def _burst(t: str) -> dict:
    return {"t": t, "side": "call", "delta": -16_000_000}


def test_ranks_relevant_headline_first():
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


def test_respects_the_window():
    bursts = [_burst("2026-10-13T14:20:00+05:30")]
    articles = [{"heading": "Too early", "published_at": "2026-10-13T10:00:00+05:30"}]
    assert attach_news(bursts, articles, window_min=10)[0]["news"] == []
    out = attach_news([_burst("2026-10-13T14:20:00+05:30")], articles, window_min=300)
    assert len(out[0]["news"]) == 1


def test_accepts_epoch_ms_and_datetime():
    bursts = [_burst("2026-10-13T14:20:00+05:30")]
    # 14:20 IST == 08:50 UTC
    ms = int(datetime(2026, 10, 13, 8, 50, tzinfo=timezone.utc).timestamp() * 1000)
    out = attach_news(bursts, [{"heading": "Epoch ms headline", "published_time": ms}])
    assert out[0]["news"][0]["minutes_away"] == pytest.approx(0.0)

    out2 = attach_news(
        [_burst("2026-10-13T14:20:00+05:30")],
        [{"heading": "Datetime headline",
          "published_at": datetime(2026, 10, 13, 8, 45, tzinfo=timezone.utc)}],
    )
    assert out2[0]["news"][0]["minutes_away"] == pytest.approx(-5.0)


def test_caps_at_three_and_handles_no_articles():
    bursts = [_burst("2026-10-13T14:20:00+05:30")]
    many = [{"heading": f"H{i}", "published_at": f"2026-10-13T14:{19 + i // 2:02d}:00+05:30"}
            for i in range(6)]
    assert len(attach_news(bursts, many)[0]["news"]) == 3
    assert attach_news([_burst("2026-10-13T14:20:00+05:30")], [])[0]["news"] == []
    # every burst gets the key even with no articles
    assert all("news" in b for b in attach_news([_burst("x"), _burst("y")], []))


def test_safe_on_unparseable_burst_time():
    assert attach_news([{"t": "not-a-time"}], [{"heading": "H"}])[0]["news"] == []


def test_window_default_is_ten_minutes_and_output_is_json_safe():
    assert NEWS_WINDOW_MIN == 10.0
    assert json.dumps(attach_news([_burst("2026-10-13T14:20:00+05:30")], []))


def test_headline_aliases_are_accepted():
    """Producers may emit heading/headline/title and url/article_link/link."""
    out = attach_news(
        [_burst("2026-10-13T14:20:00+05:30")],
        [{"title": "Alias title", "link": "u", "published_time":
          int(datetime(2026, 10, 13, 8, 50, tzinfo=timezone.utc).timestamp() * 1000)}],
    )
    assert out[0]["news"][0]["heading"] == "Alias title"
    assert out[0]["news"][0]["link"] == "u"
