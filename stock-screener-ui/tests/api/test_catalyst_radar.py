"""Offline tests for the Home Monitor Catalyst Radar (``/api/catalysts/today``).

Every external boundary is patched: the market snapshot, the index quote query
and the Google News RSS fetch. The tests therefore prove the assembly, grading
and failure handling without touching TradingView, Upstox or the network.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta

import pytest
import requests

from api.catalyst_radar import service
from api.catalyst_radar.contract import Constituent, IndexQuote
from api.catalyst_radar.router import CATALYSTS_TODAY_PATH
from config import IST

ROW_FIELDS = {
    "symbol",
    "name",
    "sector",
    "kind",
    "headline",
    "source",
    "source_url",
    "first_seen",
    "event_at",
    "state",
    "score",
    "confidence",
    "move_pct",
    "rel_volume",
    "reasons",
    "invalidates",
}

RSS_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>NIFTY Auto - Google News</title>
    <item>
      <title>Maruti Suzuki shares jump 6% - Business Standard</title>
      <link>https://news.example/maruti-jump</link>
      <pubDate>Thu, 19 Nov 2026 10:31:00 +0530</pubDate>
      <source url="https://www.business-standard.com">Business Standard</source>
    </item>
    <item>
      <title>RBI keeps repo rate unchanged - The Hindu</title>
      <link>https://news.example/rbi</link>
      <pubDate>Thu, 19 Nov 2026 09:05:00 +0530</pubDate>
      <source url="https://www.thehindu.com">The Hindu</source>
    </item>
  </channel>
</rss>
"""




@pytest.fixture(autouse=True)
def _clear_caches():
    service._reset_cache()
    yield
    service._reset_cache()


AUTO_FIXTURE = (
    ("MARUTI", "Maruti Suzuki"),
    ("M&M", "Mahindra & Mahindra"),
    ("TMPV", "Tata Motors Passenger Vehicles"),
    ("BAJAJ-AUTO", "Bajaj Auto"),
    ("EICHERMOT", "Eicher Motors"),
    ("HEROMOTOCO", "Hero MotoCorp"),
    ("TVSMOTOR", "TVS Motor"),
    ("MOTHERSON", "Samvardhana Motherson"),
    ("BOSCHLTD", "Bosch"),
    ("BALKRISIND", "Balkrishna Industries"),
    ("MRF", "MRF"),
    ("APOLLOTYRE", "Apollo Tyres"),
    ("ASHOKLEY", "Ashok Leyland"),
    ("BHARATFORG", "Bharat Forge"),
    ("EXIDEIND", "Exide Industries"),
)


def _auto_rows(
    changes: dict[str, float] | None = None,
    *,
    rel_volume: float = 2.0,
    drop: tuple[str, ...] = (),
) -> list[dict]:
    return [
        {
            "symbol": symbol,
            "name": name,
            "sector": "Consumer Durables",
            "close": 100.0,
            "change": 1.2 if changes is None else changes.get(symbol, 0.0),
            "relative_volume": rel_volume,
            "pos_52w": 50.0,
            "market_cap_cr": 1_000_000 - index,
        }
        for index, (symbol, name) in enumerate(AUTO_FIXTURE)
        if symbol not in drop
    ]


def _item(
    title: str = "Maruti Suzuki shares jump 6%",
    source: str = "Business Standard",
    link: str = "https://news.example/maruti-jump",
    published: datetime | None = None,
) -> service.NewsItem:
    return service.NewsItem(
        title=title,
        link=link,
        source=source,
        published=published or datetime.now(IST),
    )


def _raise_news(_query: str) -> list[service.NewsItem]:
    raise requests.RequestException("feed down")


def _patch_sources(
    monkeypatch,
    *,
    rows: list[dict] | None = None,
    news=None,
    snapshot_error: Exception | None = None,
    index_error: Exception | None = None,
) -> None:
    snapshot_rows = _auto_rows() if rows is None else rows

    def snapshot(*_args, **_kwargs):
        if snapshot_error is not None:
            raise snapshot_error
        return {"rows": snapshot_rows}

    def index_quotes():
        if index_error is not None:
            raise index_error
        return {
            "nifty": IndexQuote(last=25304.2, change_pct=0.3),
            "sensex": IndexQuote(last=82300.0, change_pct=0.4),
            "vix": 16.31,
        }

    monkeypatch.setattr(service, "build_snapshot", snapshot)
    monkeypatch.setattr(service, "_index_quotes", index_quotes)
    monkeypatch.setattr(service, "_fetch_news_query", news or (lambda _query: []))


@pytest.fixture
def sources(monkeypatch):
    _patch_sources(monkeypatch)
    return monkeypatch




def test_requires_auth(client):
    response = client.get(CATALYSTS_TODAY_PATH)
    assert response.status_code in (401, 403)


def test_unknown_market_is_400(auth_client, sources):
    response = auth_client.get(CATALYSTS_TODAY_PATH, params={"market": "usa"})
    assert response.status_code == 400
    assert "usa" in response.json()["detail"]


def test_unknown_sector_falls_back_to_market_with_warning(auth_client, sources):
    response = auth_client.get(CATALYSTS_TODAY_PATH, params={"sector": "nope"})
    assert response.status_code == 200
    body = response.json()
    assert body["sector"]["id"] == "all"
    assert body["sector"]["label"] == "MARKET"
    assert "unknown_sector:nope" in body["warnings"]


def test_generic_sector_uses_snapshot_rows(auth_client, sources):
    rows = [
        {
            "symbol": "TCS",
            "name": "Tata Consultancy Services Limited",
            "sector": "Technology Services",
            "market_cap_cr": 1_200_000,
            "close": 3288.0,
            "change": 2.1,
            "relative_volume": 2.4,
            "pos_52w": 61.0,
        },
        {
            "symbol": "INFY",
            "name": "Infosys Limited",
            "sector": "Technology Services",
            "market_cap_cr": 780_000,
            "close": 1534.0,
            "change": 1.1,
            "relative_volume": 1.7,
            "pos_52w": 55.0,
        },
    ]
    _patch_sources(
        sources,
        rows=rows,
        news=lambda query: (
            [_item("TCS shares jump on large deal win", source="Mint")]
            if "TECHNOLOGY SERVICES" in query
            else []
        ),
    )

    response = auth_client.get(
        CATALYSTS_TODAY_PATH, params={"sector": "technology-services"}
    )
    assert response.status_code == 200
    body = response.json()

    assert body["sector"]["id"] == "technology-services"
    assert body["sector"]["label"] == "TECHNOLOGY SERVICES"
    assert body["sector"]["breadth"] == {"advancing": 2, "declining": 0, "total": 2}
    assert {option["id"] for option in body["available_sectors"]} == {
        "all",
        "technology-services",
    }
    assert next(row for row in body["rows"] if row["symbol"] == "TCS")["score"] == "high"


def test_response_shape_and_high_confirmed_row(auth_client, sources):
    sources.setattr(
        service,
        "_fetch_news_query",
        lambda query: [_item()] if "NIFTY 50" in query else [],
    )

    response = auth_client.get(CATALYSTS_TODAY_PATH, params={"market": "india"})
    assert response.status_code == 200
    body = response.json()

    assert set(body) == {
        "as_of",
        "market",
        "sector",
        "available_sectors",
        "rows",
        "counts",
        "warnings",
    }
    assert body["available_sectors"][0] == {
        "id": "all",
        "label": "MARKET",
        "count": 15,
    }
    assert body["available_sectors"][1]["id"] == "consumer-durables"
    assert body["market"]["nifty"] == {"last": 25304.2, "change_pct": 0.3}
    assert body["market"]["sensex"]["last"] == 82300.0
    assert body["market"]["vix"] == 16.31
    assert body["sector"]["id"] == "all"
    assert body["sector"]["label"] == "MARKET"
    assert body["sector"]["change_pct"] == pytest.approx(1.2)
    assert body["sector"]["relative_strength_pct"] == pytest.approx(0.9)
    assert body["sector"]["breadth"] == {
        "advancing": 15,
        "declining": 0,
        "total": 15,
    }

    maruti = next(row for row in body["rows"] if row["symbol"] == "MARUTI")
    assert set(maruti) == ROW_FIELDS
    assert maruti["kind"] in ("news", "event")
    assert maruti["headline"] == "Maruti Suzuki shares jump 6%"
    assert maruti["source"] == "Business Standard"
    assert maruti["source_url"] == "https://news.example/maruti-jump"
    assert maruti["score"] == "high"
    assert maruti["state"] == "confirmed"
    assert maruti["move_pct"] == pytest.approx(1.2)
    assert maruti["rel_volume"] == pytest.approx(2.0)
    assert maruti["reasons"]
    assert maruti["invalidates"]
    assert maruti["first_seen"]

    assert body["counts"]["total"] == len(body["rows"])
    assert body["counts"]["high"] == sum(
        1 for row in body["rows"] if row["score"] == "high"
    )
    assert body["warnings"] == []


def test_no_fabricated_rows_when_sources_are_empty(auth_client, sources):
    _patch_sources(
        sources,
        rows=_auto_rows(changes={}, rel_volume=0.9),
        news=lambda _query: [_item("RBI keeps repo rate unchanged")],
    )

    response = auth_client.get(CATALYSTS_TODAY_PATH)
    assert response.status_code == 200
    body = response.json()

    assert body["rows"] == []
    assert body["counts"] == {"high": 0, "medium": 0, "low": 0, "total": 0}


def test_positioning_row_says_sector_move_only(auth_client, sources):
    _patch_sources(
        sources,
        rows=_auto_rows(changes={"MARUTI": 3.0}, rel_volume=0.9),
    )

    response = auth_client.get(CATALYSTS_TODAY_PATH)
    assert response.status_code == 200
    rows = response.json()["rows"]

    assert len(rows) == 1
    row = rows[0]
    assert row["symbol"] == "MARUTI"
    assert row["kind"] == "positioning"
    assert row["headline"] is None
    assert row["source"] is None
    assert row["source_url"] is None
    assert row["state"] == "confirmed"
    assert row["score"] == "medium"
    assert row["reasons"][0] == "No qualifying headline; sector move only"
    assert any("sector move" in reason.lower() for reason in row["reasons"])
    assert "no_recent_news" in response.json()["warnings"]


def test_dead_news_source_is_a_warning_not_a_failure(auth_client, sources):
    _patch_sources(
        sources,
        rows=_auto_rows(changes={"MARUTI": 3.0}, rel_volume=0.9),
        news=_raise_news,
    )

    response = auth_client.get(CATALYSTS_TODAY_PATH)
    assert response.status_code == 200
    body = response.json()

    assert "news_source_unavailable" in body["warnings"]
    assert "no_recent_news" not in body["warnings"]
    assert [row["symbol"] for row in body["rows"]] == ["MARUTI"]


def test_dead_index_source_warns_and_leaves_gaps(auth_client, sources):
    _patch_sources(sources, index_error=RuntimeError("index feed down"))

    response = auth_client.get(CATALYSTS_TODAY_PATH)
    assert response.status_code == 200
    body = response.json()

    assert "index_source_unavailable" in body["warnings"]
    assert body["market"] == {"nifty": None, "sensex": None, "vix": None}
    assert body["sector"]["change_pct"] == pytest.approx(1.2)
    assert body["sector"]["relative_strength_pct"] is None


def test_dead_snapshot_returns_market_empty_with_warning(auth_client, sources):
    _patch_sources(
        sources,
        news=lambda _query: [_item()],
        snapshot_error=RuntimeError("TradingView down"),
    )

    response = auth_client.get(CATALYSTS_TODAY_PATH)
    assert response.status_code == 200
    body = response.json()

    assert "market_source_unavailable" in body["warnings"]
    assert body["sector"]["id"] == "all"
    assert body["sector"]["change_pct"] is None
    assert body["sector"]["relative_strength_pct"] is None
    assert body["sector"]["breadth"] == {"advancing": 0, "declining": 0, "total": 0}
    assert body["rows"] == []
    assert body["available_sectors"] == [
        {"id": "all", "label": "MARKET", "count": 0}
    ]


def test_missing_snapshot_symbol_is_omitted(auth_client, sources):
    _patch_sources(sources, rows=_auto_rows(drop=("MRF",)))

    response = auth_client.get(CATALYSTS_TODAY_PATH)
    assert response.status_code == 200
    body = response.json()

    assert body["sector"]["breadth"]["total"] == 14
    assert all(row["symbol"] != "MRF" for row in body["rows"])




def test_grade_row_matrix():
    now = datetime.now(IST)

    both = service.grade_row(
        has_headline=True,
        move_pct=2.0,
        rel_volume=2.0,
        advancing=12,
        declining=3,
        total=15,
        direction=1,
        published=now,
        now=now,
    )
    assert (both.score, both.state, both.confirmed) == ("high", "confirmed", True)

    headline_only = service.grade_row(
        has_headline=True,
        move_pct=0.1,
        rel_volume=0.8,
        advancing=6,
        declining=6,
        total=15,
        direction=1,
        published=now,
        now=now,
    )
    assert (headline_only.score, headline_only.state) == ("medium", "breaking")

    tape_only = service.grade_row(
        has_headline=False,
        move_pct=2.0,
        rel_volume=0.8,
        advancing=6,
        declining=6,
        total=15,
        direction=1,
        published=None,
        now=now,
    )
    assert (tape_only.score, tape_only.state, tape_only.confirmed) == (
        "medium",
        "confirmed",
        True,
    )

    neither = service.grade_row(
        has_headline=False,
        move_pct=0.1,
        rel_volume=0.8,
        advancing=6,
        declining=6,
        total=15,
        direction=1,
        published=None,
        now=now,
    )
    assert (neither.score, neither.state) == ("low", "scheduled")

    stale = service.grade_row(
        has_headline=True,
        move_pct=0.1,
        rel_volume=0.8,
        advancing=6,
        declining=6,
        total=15,
        direction=1,
        published=now - timedelta(hours=8),
        now=now,
    )
    assert (stale.score, stale.state) == ("medium", "fading")


def test_volume_and_breadth_can_confirm_without_a_move():
    now = datetime.now(IST)
    volume = service.grade_row(
        has_headline=False,
        move_pct=0.2,
        rel_volume=2.5,
        advancing=6,
        declining=6,
        total=15,
        direction=1,
        published=None,
        now=now,
    )
    assert volume.confirmed is True

    breadth = service.grade_row(
        has_headline=False,
        move_pct=0.2,
        rel_volume=0.8,
        advancing=12,
        declining=3,
        total=15,
        direction=1,
        published=None,
        now=now,
    )
    assert breadth.confirmed is True




def test_parse_rss_reads_source_date_and_strips_suffix():
    items = service.parse_rss(RSS_SAMPLE)

    assert len(items) == 2
    first = items[0]
    assert first.title == "Maruti Suzuki shares jump 6%"
    assert first.source == "Business Standard"
    assert first.link == "https://news.example/maruti-jump"
    assert first.published is not None
    assert first.published.hour == 10
    assert first.published.minute == 31


def test_parse_rss_treats_malformed_body_as_empty():
    assert service.parse_rss("<rss><channel><item>") == []


def test_short_ticker_does_not_match_inside_a_word():
    from api.catalyst_radar.service import _alias_in_text

    assert _alias_in_text("HAL", "HAL wins a defence order")
    assert not _alias_in_text("HAL", "BMW faces a challenging launch")
    assert _alias_in_text("BEL", "BEL receives an order")
    assert not _alias_in_text("BEL", "Opening Bell: Sensex rises")


def test_headline_filter_keeps_business_news_and_drops_product_posts():
    assert service._is_qualifying_headline(
        "Maruti Suzuki shares gain nearly 7% for best day in 15 months"
    )
    assert service._is_qualifying_headline(
        "Hero MotoCorp dispatches 15,000 flex-fuel motorcycles"
    )
    assert not service._is_qualifying_headline(
        "Indian cricketer takes delivery of a brand new Mahindra XEV 9S"
    )
    assert not service._is_qualifying_headline(
        "RBI keeps repo rate unchanged"
    )


def test_news_queries_are_capped_and_start_with_the_sector():
    available = [
        (
            Constituent(symbol, name, (symbol.upper(), name.upper()), "Consumer Durables"),
            {"change": float(index)},
        )
        for index, (symbol, name) in enumerate(AUTO_FIXTURE)
    ]
    queries = service._news_queries(available, "CONSUMER DURABLES")

    assert queries[0] == "CONSUMER DURABLES when:1d"
    assert len(queries) <= 3
    assert len(queries) == 1 + 2




@pytest.mark.asyncio
async def test_cached_response_and_single_flight(monkeypatch):
    calls: list[int] = []

    def snapshot(*_args, **_kwargs):
        calls.append(1)
        time.sleep(0.05)
        return {"rows": _auto_rows()}

    monkeypatch.setattr(service, "build_snapshot", snapshot)
    monkeypatch.setattr(
        service,
        "_index_quotes",
        lambda: {
            "nifty": IndexQuote(last=25304.2, change_pct=0.3),
            "sensex": IndexQuote(last=82300.0, change_pct=0.4),
            "vix": 16.31,
        },
    )
    monkeypatch.setattr(service, "_fetch_news_query", lambda _query: [])

    first, second = await asyncio.gather(
        service.build_catalysts("india"),
        service.build_catalysts("india"),
    )

    assert len(calls) == 1
    assert first is second

    third = await service.build_catalysts("india")
    assert third is first
    assert len(calls) == 1
