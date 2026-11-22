from __future__ import annotations

from fastapi.testclient import TestClient


def test_filters_expose_registry_and_cache_geography(agri_client: TestClient):
    payload = agri_client.get("/api/agri/filters").json()
    assert payload["ok"] is True
    assert payload["as_of"] == "2026-05-31"
    assert payload["freshness_days"] > 0
    assert len(payload["commodities"]) == 22
    assert {group["key"] for group in payload["groups"]} == {
        "cereals", "pulses", "vegetables", "oilseeds", "spices",
    }
    assert payload["states"] == ["Karnataka", "Maharashtra"]
    assert payload["districts"] == ["Bengaluru", "Pune"]
    assert payload["markets"] == ["Bengaluru APMC", "Pune APMC"]


def test_default_prices_return_full_snapshot_but_empty_series(agri_client: TestClient):
    payload = agri_client.get("/api/agri/prices").json()
    assert payload["ok"] is True
    assert payload["data_source"] == "agmarknet_ckan"
    assert payload["as_of"] == "2026-05-31"
    assert len(payload["snapshot"]) == 22
    assert payload["series"] == []
    assert payload["quotes"] == []
    assert payload["comparison"] == []
    assert payload["kpis"]["modal"] is None
    assert payload["filters"]["range"] == "6m"


def test_commodity_and_range_produce_series_quotes_and_kpis(agri_client: TestClient):
    payload = agri_client.get("/api/agri/prices?commodity=onion&range=6m").json()
    assert payload["kpis"]["modal"] == 2155.0
    assert payload["kpis"]["unit"] == "INR/quintal"
    assert payload["kpis"]["market_count"] == 2
    assert payload["kpis"]["arrivals_qtl"] == 200.0
    assert payload["kpis"]["msp"] is None
    assert len(payload["series"]) == 14
    assert payload["series"][0]["date"] == "2026-05-18"
    assert payload["series"][-1]["modal"] == 2155.0
    assert len(payload["quotes"]) == 2
    assert all(quote["date"] == "2026-05-31" for quote in payload["quotes"])
    assert any("MSP not verified" in warning for warning in payload["warnings"])


def test_state_and_market_filters_narrow_quotes_and_kpis(agri_client: TestClient):
    payload = agri_client.get(
        "/api/agri/prices?commodity=onion&state=Maharashtra&market=Pune%20APMC"
    ).json()
    assert payload["kpis"]["modal"] == 2130.0
    assert payload["kpis"]["market_count"] == 1
    assert len(payload["quotes"]) == 1
    assert payload["quotes"][0]["market"] == "Pune APMC"
    assert len(payload["series"]) == 14


def test_group_filters_snapshot(agri_client: TestClient):
    payload = agri_client.get("/api/agri/prices?group=pulses").json()
    assert len(payload["snapshot"]) == 5
    assert {row["group"] for row in payload["snapshot"]} == {"pulses"}


def test_explicit_date_bounds_and_limit(agri_client: TestClient):
    payload = agri_client.get(
        "/api/agri/prices?commodity=onion&from=2026-05-25&to=2026-05-31&limit=1"
    ).json()
    assert [point["date"] for point in payload["series"]] == [
        "2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28",
        "2026-05-29", "2026-05-30", "2026-05-31",
    ]
    assert len(payload["quotes"]) == 1
    assert payload["filters"]["date_from"] == "2026-05-25"


def test_comparison_returns_up_to_five_series(agri_client: TestClient):
    payload = agri_client.get(
        "/api/agri/prices?commodity=onion&compare=onion,potato,tomato&from=2026-05-25"
    ).json()
    assert [series["key"] for series in payload["comparison"]] == ["onion", "potato", "tomato"]
    assert all(len(series["points"]) == 7 for series in payload["comparison"])
    assert payload["comparison"][0]["label"] == "Onion"


def test_invalid_parameters_return_400_with_clear_detail(agri_client: TestClient):
    cases = {
        "commodity=absinthe": "unknown commodity",
        "group=grains": "unknown group",
        "range=2w": "unknown range",
        "from=25-05-2026": "must be an ISO date",
        "from=2026-05-31&to=2026-05-01": "on or before",
        "compare=onion,potato,tomato,rice,wheat,maize": "at most 5",
        "compare=absinthe": "unknown comparison commodity",
        "commodity=onion&group=pulses": "not in group",
    }
    for query, expected in cases.items():
        response = agri_client.get(f"/api/agri/prices?{query}")
        assert response.status_code == 400, query
        assert expected in response.json()["detail"], query


def test_missing_cache_is_explicit(empty_client: TestClient):
    filters = empty_client.get("/api/agri/filters").json()
    assert filters["as_of"] is None
    assert filters["states"] == []
    payload = empty_client.get("/api/agri/prices?commodity=onion").json()
    assert payload["data_source"] == "empty"
    assert payload["as_of"] is None
    assert payload["snapshot"] == []
    assert any("cache is missing" in warning for warning in payload["warnings"])


def test_commodities_route_keeps_compatibility(agri_client: TestClient):
    payload = agri_client.get("/api/agri/commodities").json()
    assert payload["ok"] is True
    assert len(payload["commodities"]) == 22
    assert payload["commodities"][0]["unit"] == "INR/quintal"
