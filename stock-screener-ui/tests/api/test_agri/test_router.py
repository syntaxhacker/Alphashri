from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.agri import registry, store
from api.agri.router import router as agri_router


@pytest.fixture
def make_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from api.agri import router as router_module

    counter = {"n": 0}
    clients: list[TestClient] = []

    def _make(rows: list[dict[str, Any]]) -> tuple[TestClient, Path]:
        counter["n"] += 1
        path = tmp_path / f"agri_{counter['n']}.db"
        conn = store.open_writer(path)
        try:
            store.upsert_rows(conn, rows)
        finally:
            conn.close()
        monkeypatch.setattr(router_module, "DB_PATH", path)
        app = FastAPI()
        app.include_router(agri_router)
        client = TestClient(app)
        clients.append(client)
        return client, path

    yield _make
    for client in clients:
        client.close()


def _row(
    day: str,
    *,
    key: str,
    commodity: str | None = None,
    market: str = "Pune APMC",
    state: str = "Maharashtra",
    district: str = "Pune",
    variety: str = "No 1",
    grade: str = "FAQ",
    modal: float = 100.0,
    price_unit: str = "Rs./Quintal",
    source: str = "agmarknet_ckan",
    arrivals: float | None = 100.0,
) -> dict[str, Any]:
    return {
        "date": day,
        "state": state,
        "district": district,
        "market": market,
        "commodity": commodity or key.title(),
        "commodity_key": key,
        "variety": variety,
        "grade": grade,
        "min_price": modal - 10,
        "max_price": modal + 10,
        "modal_price": modal,
        "arrivals_qtl": arrivals,
        "price_unit": price_unit,
        "source": source,
    }


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
    assert payload["state_districts"] == {
        "Karnataka": ["Bengaluru"], "Maharashtra": ["Pune"],
    }
    assert payload["district_markets"] == {
        "Karnataka||Bengaluru": ["Bengaluru APMC"],
        "Maharashtra||Pune": ["Pune APMC"],
    }


def test_default_prices_return_full_snapshot_but_empty_series(agri_client: TestClient):
    payload = agri_client.get("/api/agri/prices").json()
    assert payload["ok"] is True
    # Fixture rows carry source="fixture"; the API mirrors the row source
    # instead of claiming CKAN.
    assert payload["data_source"] == "fixture"
    assert payload["as_of"] == "2026-05-31"
    assert len(payload["snapshot"]) == 22
    assert payload["series"] == []
    assert payload["quotes"] == []
    assert payload["quotes_total"] == 0
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
    assert payload["quotes_total"] == 2
    assert all(quote["date"] == "2026-05-31" for quote in payload["quotes"])
    assert payload["quotes"][0]["price_unit"] == "Rs./Quintal"
    assert payload["quotes"][0]["price_source"] == "fixture"
    assert payload["quotes"][0]["commodity_key"] == "onion"
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
    assert payload["quotes_total"] == 2
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
    assert filters["state_districts"] == {}
    assert filters["district_markets"] == {}
    payload = empty_client.get("/api/agri/prices?commodity=onion").json()
    assert payload["data_source"] == "empty"
    assert payload["as_of"] is None
    assert payload["snapshot"] == []
    assert payload["quotes_total"] == 0
    assert any("cache is missing" in warning for warning in payload["warnings"])


def test_commodities_route_keeps_compatibility(agri_client: TestClient):
    payload = agri_client.get("/api/agri/commodities").json()
    assert payload["ok"] is True
    assert len(payload["commodities"]) == 22
    assert payload["commodities"][0]["unit"] == "INR/quintal"


def test_alias_spelling_is_visible_when_filtering_by_commodity_key(make_client):
    rows = [
        _row(
            "2026-05-31", key="chilli", commodity="Dry Chillies",
            market="Pune APMC", variety="No 1", source="agmarknet_ckan",
        ),
        _row(
            "2026-05-31", key="chilli", commodity="Chilly Capsicum",
            state="Karnataka", district="Bengaluru", market="Bengaluru APMC",
            variety="Green Chilli", source="agmarknet_daily",
        ),
    ]
    client, path = make_client(rows)

    conn = store.open_reader(path)
    try:
        names = registry.source_names_for("chilli")
        placeholders = ", ".join("?" for _ in names)
        raw_count = conn.execute(
            f"SELECT COUNT(*) FROM {store.TABLE} WHERE commodity IN ({placeholders})",
            names,
        ).fetchone()[0]
    finally:
        conn.close()

    payload = client.get("/api/agri/prices?commodity=chilli").json()
    # The old raw-commodity filter saw only the source-name row; the key filter
    # also returns the alias spelling.
    assert raw_count == 1
    assert payload["quotes_total"] == 2
    assert [quote["market"] for quote in payload["quotes"]] == [
        "Bengaluru APMC", "Pune APMC",
    ]
    assert all(quote["commodity_key"] == "chilli" for quote in payload["quotes"])
    forms = {quote["market"]: quote["product_form"] for quote in payload["quotes"]}
    assert forms["Bengaluru APMC"] == "green"
    assert {quote["price_source"] for quote in payload["quotes"]} == {
        "agmarknet_ckan", "agmarknet_daily",
    }
    assert payload["data_source"] == "mixed"


def test_latest_date_is_per_commodity_key(make_client):
    rows = [
        _row("2026-05-30", key="onion", market="Pune APMC", modal=2000.0),
        _row("2026-05-31", key="onion", market="Pune APMC", modal=2100.0),
        _row("2026-05-20", key="potato", market="Pune APMC", modal=1500.0),
        _row("2026-06-04", key="tomato", market="Pune APMC", modal=1200.0),
    ]
    client, _ = make_client(rows)

    payload = client.get("/api/agri/prices?group=vegetables").json()
    assert payload["as_of"] == "2026-06-04"
    by_key = {row["key"]: row for row in payload["snapshot"]}
    assert by_key["onion"]["date"] == "2026-05-31"
    assert by_key["potato"]["date"] == "2026-05-20"
    assert by_key["tomato"]["date"] == "2026-06-04"
    assert by_key["potato"]["freshness_days"] > by_key["tomato"]["freshness_days"]
    assert any("Potato is 15 days behind" in warning for warning in payload["warnings"])

    potato = client.get("/api/agri/prices?commodity=potato").json()
    assert potato["as_of"] == "2026-05-20"
    assert potato["kpis"]["modal"] == 1500.0
    potato_snapshot = {row["key"]: row for row in potato["snapshot"]}["potato"]
    assert potato_snapshot["date"] == "2026-05-20"


def test_data_source_is_derived_from_returned_rows(make_client):
    client, _ = make_client([
        _row("2026-05-29", key="onion", source="agmarknet_ckan"),
        _row("2026-05-30", key="onion", source="agmarknet_ckan"),
        _row("2026-05-31", key="onion", source="agmarknet_daily"),
    ])
    payload = client.get("/api/agri/prices?commodity=onion").json()
    assert payload["data_source"] == "mixed"

    daily_client, _ = make_client([
        _row("2026-05-31", key="onion", source="agmarknet_daily"),
    ])
    daily = daily_client.get("/api/agri/prices?commodity=onion").json()
    assert daily["data_source"] == "agmarknet_daily"

    ckan_client, _ = make_client([
        _row("2026-05-31", key="onion", source="agmarknet_ckan"),
    ])
    ckan = ckan_client.get("/api/agri/prices?commodity=onion").json()
    assert ckan["data_source"] == "agmarknet_ckan"
