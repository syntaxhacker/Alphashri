"""Contract tests for the signal-sections HTTP surface (``/api/sections/scan``).

The scanning service is monkeypatched at the router boundary: these tests prove
the request parsing, auth, response envelope and error behaviour without
touching TradingView or the app's cache.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from api.auth import get_current_user
from api.sections.router import SECTION_SCAN_PATH
from api_server_fastapi import app

pytestmark = pytest.mark.unit

VALID_DEFS = [
    {
        "id": "momentum_5m",
        "name": "Momentum 5m",
        "description": "5-minute momentum with volume",
        "concept": "momentum_5m",
        "side": "long",
        "conditions": [
            {"metric": "change|5", "op": "gte", "value": 1.5},
            {"metric": "relative_volume_10d_calc", "op": "gte", "value": 1.5},
        ],
        "render": {"type": "table", "columns": ["close", "change|5"]},
        "refreshSec": 60,
        "enabled": True,
        "pinned": False,
    }
]


def _payload(
    *,
    rows=None,
    note=None,
    delayed_rows=0,
    market="india",
    row_count=None,
):
    rows = [] if rows is None else rows
    return {
        "market": market,
        "generated_at": "2026-11-25T10:00:00+00:00",
        "rows": rows,
        "row_count": len(rows) if row_count is None else row_count,
        "delayed_rows": delayed_rows,
        "note": note,
    }


def _row(symbol="RELIANCE", name="Reliance Industries"):
    return {
        "symbol": symbol,
        "name": name,
        "fields": {"close": 1500.5, "change|5": 1.8, "update_mode": "streaming"},
        "signals": {"momentum_5m": True},
    }


def _query(defs=VALID_DEFS, **overrides):
    params = {
        "market": "india",
        "sections": json.dumps(VALID_DEFS if defs is None else defs),
    }
    params.update(overrides)
    return params


@pytest.fixture
def scan_stub(monkeypatch):
    """Replace the service at the router boundary and record its call."""
    calls: list[dict] = []

    def fake_scan(market, defs, *, allow_delayed=False, **kwargs):
        calls.append(
            {
                "market": market,
                "defs": defs,
                "allow_delayed": allow_delayed,
                "kwargs": kwargs,
            }
        )
        return _payload(rows=[_row()], note="streaming ok")

    import api.sections.router as router_module

    monkeypatch.setattr(router_module, "scan_sections", fake_scan)
    return calls


class TestShape:
    def test_scan_returns_declared_envelope(self, auth_client, scan_stub):
        response = auth_client.get(SECTION_SCAN_PATH, params=_query())

        assert response.status_code == 200
        body = response.json()
        assert set(body) == {
            "market",
            "generated_at",
            "rows",
            "row_count",
            "delayed_rows",
            "note",
        }
        assert body["market"] == "india"
        assert body["generated_at"] == "2026-11-25T10:00:00+00:00"
        assert body["row_count"] == 1
        assert body["delayed_rows"] == 0
        assert body["note"] == "streaming ok"
        assert len(body["rows"]) == 1
        row = body["rows"][0]
        assert set(row) == {"symbol", "name", "fields", "signals"}
        assert row["symbol"] == "RELIANCE"
        assert row["name"] == "Reliance Industries"
        assert isinstance(row["fields"], dict)
        assert isinstance(row["signals"], dict)
        assert row["signals"]["momentum_5m"] is True

    def test_service_receives_parsed_definitions(self, auth_client, scan_stub):
        auth_client.get(SECTION_SCAN_PATH, params=_query())

        assert len(scan_stub) == 1
        assert scan_stub[0]["market"] == "india"
        assert scan_stub[0]["defs"] == VALID_DEFS
        assert scan_stub[0]["allow_delayed"] is False

    def test_america_is_accepted(self, auth_client, scan_stub):
        response = auth_client.get(SECTION_SCAN_PATH, params=_query(market="america"))

        assert response.status_code == 200
        assert scan_stub[0]["market"] == "america"

    def test_unknown_market_is_rejected(self, auth_client, scan_stub):
        response = auth_client.get(SECTION_SCAN_PATH, params=_query(market="pakistan"))

        assert response.status_code == 422
        assert not scan_stub


class TestAuth:
    def test_requires_bearer_token(self, client, scan_stub):
        response = client.get(SECTION_SCAN_PATH, params=_query())

        assert response.status_code == 401
        assert not scan_stub


class TestInvalidDefinitions:
    def test_invalid_and_unknown_definitions_dropped_with_note(
        self, auth_client, monkeypatch
    ):
        calls: list[dict] = []

        def fake_scan(market, defs, *, allow_delayed=False, **kwargs):
            calls.append({"market": market, "defs": defs})
            return _payload(note="Excluded 1 delayed row(s).")

        import api.sections.router as router_module

        monkeypatch.setattr(router_module, "scan_sections", fake_scan)
        defs = [
            VALID_DEFS[0],
            None,
            "not-a-definition",
            {"name": "no id", "concept": "momentum_5m"},
            {"id": "no-concept", "conditions": VALID_DEFS[0]["conditions"]},
            {
                "id": "unknown_metric",
                "concept": "mystery",
                "conditions": [{"metric": "not_a_tv_field", "op": "gt", "value": 1}],
            },
        ]

        response = auth_client.get(SECTION_SCAN_PATH, params=_query(defs=defs))

        assert response.status_code == 200
        assert calls[0]["defs"] == VALID_DEFS
        note = response.json()["note"]
        assert "Dropped 5 invalid section definition(s)" in note
        assert "Excluded 1 delayed row(s)." in note

    def test_empty_sections_list_is_valid(self, auth_client, scan_stub):
        response = auth_client.get(SECTION_SCAN_PATH, params=_query(defs=[]))

        assert response.status_code == 200
        assert scan_stub[0]["defs"] == []

    def test_malformed_sections_json_is_400_not_500(self, auth_client, scan_stub):
        response = auth_client.get(
            SECTION_SCAN_PATH, params={"market": "india", "sections": "{not json"}
        )

        assert response.status_code == 400
        assert "sections" in response.json()["detail"].lower()
        assert not scan_stub

    def test_non_list_sections_json_is_dropped_with_note(
        self, auth_client, scan_stub
    ):
        response = auth_client.get(
            SECTION_SCAN_PATH, params={"market": "india", "sections": '{"id": "x"}'}
        )

        assert response.status_code == 200
        assert scan_stub[0]["defs"] == []
        assert "Dropped 1 invalid section definition(s)" in response.json()["note"]


class TestDelayedRows:
    def test_delayed_note_surfaces_unchanged(self, auth_client, monkeypatch):
        import api.sections.router as router_module

        calls: list[bool] = []
        note = "Including 3 delayed row(s); data may be up to 15 minutes old."

        def fake_scan(market, defs, *, allow_delayed=False, **kwargs):
            calls.append(allow_delayed)
            return _payload(rows=[_row()], delayed_rows=3, note=note)

        monkeypatch.setattr(router_module, "scan_sections", fake_scan)

        response = auth_client.get(SECTION_SCAN_PATH, params=_query())

        assert response.status_code == 200
        assert response.json()["delayed_rows"] == 3
        assert response.json()["note"] == note
        assert calls == [False]

    def test_allow_delayed_is_forwarded(self, auth_client, scan_stub):
        response = auth_client.get(
            SECTION_SCAN_PATH, params=_query(allow_delayed=True)
        )

        assert response.status_code == 200
        assert scan_stub[0]["allow_delayed"] is True


class TestOpenApiSurface:
    def test_endpoint_is_documented_with_tag_summary_and_security(self):
        schema = app.openapi()
        operation = schema["paths"][SECTION_SCAN_PATH]["get"]

        assert operation["tags"] == ["sections"]
        assert operation["summary"]
        assert operation["description"]
        assert operation["security"] == [{"bearerAuth": []}]
        assert "SectionScanResponse" in str(operation["responses"]["200"])

    def test_auth_dependency_is_the_shared_one(self):
        from api.sections.router import router as sections_router

        route = next(
            route
            for route in sections_router.routes
            if getattr(route, "path", None) == SECTION_SCAN_PATH
        )
        dependencies = [dependency.call for dependency in route.dependant.dependencies]
        assert get_current_user in dependencies
