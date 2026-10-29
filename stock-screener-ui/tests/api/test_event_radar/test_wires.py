"""Yahoo RSS wire adapter tests — recorded feed, no network."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from api.event_radar.sources import wires
from api.event_radar.sources.wires import (
    WireItem,
    fetch_events,
    fetch_feed,
    to_events,
)

FIXTURES = Path(__file__).parent / "fixtures"
TODAY = dt.date(2026, 10, 29)


class FakeResponse:
    def __init__(self, text: str = "", status_code: int = 200):
        self.text = text
        self.status_code = status_code


class FakeClient:
    def __init__(self, responder):
        self.responder = responder
        self.calls: list[dict] = []

    def get(self, url, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        result = self.responder(url) if callable(self.responder) else self.responder
        if isinstance(result, Exception):
            raise result
        return result


def _rss() -> str:
    return (FIXTURES / "yahoo_rss_orcl.xml").read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(wires, "WIRE_SPACING_SECONDS", 0.0)


class TestFetchFeed:
    def test_recorded_feed(self):
        client = FakeClient(FakeResponse(_rss()))
        items = fetch_feed(client, "ORCL")
        assert len(client.calls) == 1
        assert client.calls[0]["url"] == (
            "https://feeds.finance.yahoo.com/rss/2.0/headline"
            "?s=ORCL&region=US&lang=en-US"
        )
        assert client.calls[0]["timeout"] == wires.REQUEST_TIMEOUT
        assert len(items) == 5
        first = items[0]
        assert first.symbol == "ORCL"
        assert first.title == "Oracle to Host Investor Day on October 28, 2026"
        assert first.link.endswith("oracle-host-investor-day-130500123.html")
        assert first.published == "Mon, 26 Oct 2026 13:05:00 GMT"
        assert "investor day" in first.summary.lower()

    def test_atom_feed_namespaces_and_href_link(self):
        atom = """<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>Acme Capital Markets Day set for March 3, 2027</title>
            <link href="https://example.com/news/acme-cmd"/>
            <published>2027-02-01T10:00:00Z</published>
            <summary>Acme will host its capital markets day.</summary>
          </entry>
        </feed>"""
        items = fetch_feed(FakeClient(FakeResponse(atom)), "ACME")
        assert len(items) == 1
        assert items[0].link == "https://example.com/news/acme-cmd"
        assert items[0].published == "2027-02-01T10:00:00Z"
        events = to_events(items, today=TODAY)
        assert events[0].event_type == "capital_markets_day"
        assert events[0].event_date == "2027-03-03"
        assert events[0].announced_at == "2027-02-01"

    def test_empty_body(self):
        assert fetch_feed(FakeClient(FakeResponse("")), "ORCL") == []

    def test_malformed_xml_is_empty_not_fatal(self):
        assert fetch_feed(FakeClient(FakeResponse("<rss><channel>")), "ORCL") == []

    def test_non_200_raises_with_status(self):
        with pytest.raises(RuntimeError, match="503"):
            fetch_feed(FakeClient(FakeResponse("", status_code=503)), "ORCL")

    def test_items_without_title_are_dropped(self):
        xml = "<rss><channel><item><link>https://x</link></item></channel></rss>"
        assert fetch_feed(FakeClient(FakeResponse(xml)), "ORCL") == []

    def test_item_without_link_has_empty_link(self):
        xml = (
            "<rss><channel><item><title>Acme Investor Day on May 5, 2027</title>"
            "<pubDate>Mon, 05 Apr 2027 10:00:00 GMT</pubDate></item></channel></rss>"
        )
        items = fetch_feed(FakeClient(FakeResponse(xml)), "ACME")
        assert items[0].link == ""
        assert items[0].summary == ""


class TestToEvents:
    def test_keeps_only_dated_classified_titles(self):
        items = fetch_feed(FakeClient(FakeResponse(_rss())), "ORCL")
        events = to_events(items, today=TODAY)
        assert len(events) == 3

        investor = events[0]
        assert investor.event_type == "investor_day"
        assert investor.event_date == "2026-10-28"
        assert investor.announced_at == "2026-10-26"
        assert investor.source == "wire"
        assert investor.confidence == 0.7
        assert investor.source_url.endswith(".html")
        assert investor.symbol == "ORCL"

        analyst = events[2]
        assert analyst.event_type == "analyst_day"
        assert analyst.event_date == "2026-11-12"

    def test_undated_title_is_skipped(self):
        item = WireItem(
            symbol="ORCL",
            title="Oracle to Webcast Investor Day",
            link="https://example.com/a",
            published="Tue, 27 Oct 2026 20:15:00 GMT",
            summary="",
        )
        assert to_events([item], today=TODAY) == []

    def test_today_uses_published_date(self):
        item = WireItem(
            symbol="ORCL",
            title="Oracle hosting Investor Day today",
            link="https://example.com/b",
            published="Wed, 28 Oct 2026 08:15:00 -0400",
            summary="",
        )
        events = to_events([item], today=TODAY)
        assert events[0].event_date == "2026-10-28"

    def test_today_falls_back_to_caller_clock(self):
        item = WireItem(
            symbol="MSFT",
            title="Microsoft investor day is today",
            link="",
            published="",
            summary="",
        )
        events = to_events([item], today=TODAY)
        assert events[0].event_date == "2026-10-29"
        assert events[0].announced_at is None
        assert events[0].source_url is None

    def test_junk_symbol_is_dropped(self):
        item = WireItem(
            symbol="N/A",
            title="Acme Investor Day on May 5, 2027",
            link="",
            published="",
            summary="",
        )
        assert to_events([item], today=TODAY) == []

    def test_noise_title_is_dropped(self):
        item = WireItem(
            symbol="ORCL",
            title="Oracle shares rally as day trading surges on October 28, 2026",
            link="",
            published="",
            summary="",
        )
        assert to_events([item], today=TODAY) == []


class TestFetchEvents:
    def test_dedupe_within_one_feed(self):
        client = FakeClient(FakeResponse(_rss()))
        events = fetch_events(client, ["ORCL"], today=TODAY)

        # Both ORCL "investor day on Oct 28" items collapse to the longer title.
        same_day = [ev for ev in events if ev.event_date == "2026-10-28"]
        assert len(same_day) == 1
        assert same_day[0].title == "Oracle to Host Investor Day on October 28, 2026"
        assert {ev.event_type for ev in events} == {"investor_day", "analyst_day"}

    def test_two_symbols_spacing(self, monkeypatch):
        slept: list[float] = []
        monkeypatch.setattr(wires, "WIRE_SPACING_SECONDS", 0.1)
        monkeypatch.setattr(wires.time, "sleep", slept.append)

        client = FakeClient(FakeResponse(_rss()))
        fetch_events(client, ["ORCL", "MSFT"], today=TODAY)
        assert len(client.calls) == 2
        assert slept == [0.1]

    def test_failing_feed_is_skipped(self):
        def responder(url: str):
            if "s=MSFT" in url:
                raise RuntimeError("wire: HTTP 500 for MSFT")
            return FakeResponse(_rss())

        events = fetch_events(FakeClient(responder), ["ORCL", "MSFT"], today=TODAY)
        assert len(events) == 2

    def test_empty_symbol_list(self):
        assert fetch_events(FakeClient(FakeResponse(_rss())), [], today=TODAY) == []
