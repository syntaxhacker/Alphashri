"""Index constituent membership endpoint."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.chart_patterns import router
from chart_patterns import index_members
from chart_patterns.constituents import NIFTY50, NIFTY100, NIFTY200, NIFTY500
from chart_patterns.indices import INDIAN_INDICES


@pytest.fixture(autouse=True)
def _clear_member_cache():
    index_members.clear_cache()
    yield
    index_members.clear_cache()


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_nifty_members():
    body = _client().get("/api/chart-patterns/index/NIFTY/members").json()
    assert body["index"] == "NIFTY"
    assert body["count"] == len(NIFTY50)
    assert body["symbols"] == NIFTY50
    assert "RELIANCE" in body["symbols"]


def test_broad_index_counts():
    client = _client()
    for index_id, expected in (
        ("NIFTY100", NIFTY100),
        ("NIFTY200", NIFTY200),
        ("NIFTY500", NIFTY500),
    ):
        body = client.get(f"/api/chart-patterns/index/{index_id}/members").json()
        assert body["count"] == len(expected)
        assert body["symbols"] == expected


def test_next_50_is_the_nifty100_minus_nifty50():
    body = _client().get("/api/chart-patterns/index/NIFTYNXT50/members").json()
    assert body["count"] == len(NIFTY100) - len(NIFTY50)
    assert set(body["symbols"]).isdisjoint(NIFTY50)
    assert set(body["symbols"]).issubset(NIFTY100)


def test_sector_membership_uses_official_csv(monkeypatch):
    monkeypatch.setattr(
        index_members,
        "_fetch_csv_members",
        lambda index_id: ["TCS", "INFY", "WIPRO"] if index_id == "NIFTYIT" else None,
    )
    body = _client().get("/api/chart-patterns/index/NIFTYIT/members").json()
    assert body["index"] == "NIFTYIT"
    assert body["label"] == "NIFTY IT"
    assert body["symbols"] == ["TCS", "INFY", "WIPRO"]
    assert body["count"] == 3


def test_sector_membership_falls_back_to_tradingview(monkeypatch):
    monkeypatch.setattr(index_members, "_fetch_csv_members", lambda index_id: None)
    monkeypatch.setattr(
        index_members,
        "_fetch_tv_members",
        lambda index_id: ["HDFCBANK", "ICICIBANK"] if index_id == "BANKNIFTY" else None,
    )
    body = _client().get("/api/chart-patterns/index/BANKNIFTY/members").json()
    assert body["symbols"] == ["HDFCBANK", "ICICIBANK"]


def test_volatility_index_has_no_constituents():
    body = _client().get("/api/chart-patterns/index/INDIAVIX/members").json()
    assert body["count"] == 0
    assert body["symbols"] == []
    assert "no constituent" in body["note"].lower()


def test_unknown_index_is_not_available():
    response = _client().get("/api/chart-patterns/index/NOT_AN_INDEX/members")
    assert response.status_code == 404
    assert "not available" in response.json()["detail"]


def test_every_index_has_a_membership_source():
    missing = [
        row["id"]
        for row in INDIAN_INDICES
        if row["id"] not in index_members.NO_MEMBERS_INDEX_IDS
        and row["id"] not in index_members.STATIC_MEMBERS
        and row["id"] not in index_members.INDEX_CSV_FILES
        and row["id"] not in index_members.TV_FALLBACK_INDEX_IDS
    ]
    assert missing == []


def test_parse_constituent_csv_deduplicates_and_strips():
    text = (
        "\ufeffCompany Name,Industry,Symbol,Series,ISIN Code\n"
        "Tata Consultancy Services,IT,TCS,EQ,INE467B01029\n"
        "Infosys,IT,INFY,EQ,INE009A01021\n"
        "Tata Consultancy Services,IT,TCS,EQ,INE467B01029\n"
    )
    assert index_members.parse_constituent_csv(text) == ["TCS", "INFY"]
