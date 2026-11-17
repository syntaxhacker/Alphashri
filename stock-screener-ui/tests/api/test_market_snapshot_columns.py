"""Tests for the opt-in ``columns-v1`` wire format of GET /api/market/snapshot.

The endpoint is exercised through ``TestClient`` on a minimal app that mounts
only this router (plus the production gzip middleware), with ``build_snapshot``
patched so no TradingView scan runs. The default JSON contract is asserted
separately: the columnar branch must be additive, never a replacement.
"""

from __future__ import annotations

import copy
from sys import path as sys_path
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.gzip import GZipMiddleware

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys_path:
    sys_path.insert(0, str(ROOT))

from api.auth import get_current_user  # noqa: E402
from api.market_screen.router import (  # noqa: E402
    _ENCODED_CACHE_MAX_ENTRIES,
    _encoded_cache,
    _reset_encoded_cache,
    router,
)
from api.market_screen.wire import (  # noqa: E402
    COLUMNS_FORMAT_VERSION,
    dumps,
    normalize_format,
    to_columnar,
)

ROWS = [
    {
        "symbol": "RELIANCE",
        "name": "Reliance Industries",
        "sector": "Energy",
        "exchange": "NSE",
        "close": 2946.0,
        "change": 0.82,
        "market_cap_cr": 199000.0,
        "rsi": 61.2,
        "pos_52w": 95.5,
        "pe_ratio": 22.1,
        "fno": True,
        "etf": False,
        "currency": "INR",
    },
    {
        "symbol": "TCS",
        "name": "Tata Consultancy Services",
        "sector": "Technology",
        "exchange": "NSE",
        "close": 4102.5,
        "change": -1.15,
        "market_cap_cr": 148000.0,
        "rsi": None,
        "pos_52w": None,
        "pe_ratio": None,
        "fno": True,
        "etf": False,
        "currency": "INR",
    },
    {
        "symbol": "NEWCO",
        "name": None,
        "sector": None,
        "exchange": "NSE",
        "close": 0.0,
        "change": None,
        "market_cap_cr": None,
        "rsi": 0.0,
        "pos_52w": 0.0,
        "pe_ratio": None,
        "fno": False,
        "etf": False,
        "currency": "INR",
    },
]

ENVELOPE = {
    "as_of": "2026-11-17T11:44:00+05:30",
    "universe": "all_equity",
    "total": len(ROWS),
    "update_mode": "streaming",
    "rows": ROWS,
    "cached": True,
    "stale": False,
    "age_sec": 1.234,
}


def _envelope(rows=None, **overrides):
    payload = copy.deepcopy(ENVELOPE)
    if rows is not None:
        payload["rows"] = copy.deepcopy(rows)
        payload["total"] = len(payload["rows"])
    payload.update(overrides)
    return payload


@pytest.fixture()
def client():
    app = FastAPI()
    # Same shape as the production registration (api_server_fastapi.py).
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=1, email="qa@test.com", uuid="00000000-0000-0000-0000-000000000001"
    )
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _clear_encoded_bodies():
    """The encoded-body cache lives for the process; never leak it across tests."""
    _reset_encoded_cache()
    yield
    _reset_encoded_cache()


def _get(client, payload, query=""):
    with patch("api.market_screen.router.build_snapshot", return_value=payload):
        return client.get("/api/market/snapshot" + query)


# --------------------------------------------------------------------------- #
# columns-v1
# --------------------------------------------------------------------------- #

def test_columns_reconstruct_the_json_rows(client):
    payload = _envelope()
    resp = _get(client, payload, "?format=columns")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()

    assert body["format"] == COLUMNS_FORMAT_VERSION
    assert list(body) == ["format", "meta", "fields", "columns"]
    assert body["fields"] == list(ROWS[0].keys())

    assert set(body["columns"]) == set(body["fields"])
    assert all(len(column) == len(ROWS) for column in body["columns"].values())

    rebuilt = [
        {field: body["columns"][field][index] for field in body["fields"]}
        for index in range(len(ROWS))
    ]
    assert rebuilt == ROWS


def test_columns_meta_is_the_envelope_without_rows(client):
    payload = _envelope()
    resp = _get(client, payload, "?format=columns")
    body = resp.json()

    assert body["meta"] == {k: v for k, v in payload.items() if k != "rows"}
    for key in ("as_of", "update_mode", "cached", "stale", "age_sec", "universe", "total"):
        assert key in body["meta"]
    assert "rows" not in body["meta"]


def test_columns_empty_rows(client):
    resp = _get(client, _envelope(rows=[]), "?format=columns")

    assert resp.status_code == 200
    body = resp.json()
    assert body["format"] == COLUMNS_FORMAT_VERSION
    assert body["fields"] == []
    assert body["columns"] == {}
    assert body["meta"]["total"] == 0
    assert body["meta"]["universe"] == "all_equity"


def test_columns_follow_the_symbol_filter(client):
    resp = _get(client, _envelope(), "?format=columns&symbols=TCS")

    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["total"] == 1
    assert body["columns"]["symbol"] == ["TCS"]
    assert body["columns"]["close"] == [4102.5]


def test_columns_gzip_compresses_the_response(client):
    rows = [
        {**row, "symbol": f"{row['symbol']}{index}"}
        for index in range(20)
        for row in ROWS
    ]
    expected = _envelope(rows=rows)
    resp = _get(client, expected, "?format=columns")

    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") == "gzip"
    # httpx transparently decompresses .content; the declared length is the
    # compressed one, so it must be smaller than what the client parsed.
    assert int(resp.headers["content-length"]) < len(resp.content)
    assert resp.json()["columns"]["symbol"] == [row["symbol"] for row in rows]


def test_format_param_is_exposed_as_format(client):
    params = client.app.openapi()["paths"]["/api/market/snapshot"]["get"]["parameters"]
    by_name = {param["name"]: param for param in params}
    assert "format" in by_name  # alias, not the internal `response_format`
    assert by_name["format"]["schema"]["default"] == "json"


# --------------------------------------------------------------------------- #
# default JSON is unchanged
# --------------------------------------------------------------------------- #

def test_default_json_is_unchanged(client):
    payload = _envelope()
    resp = _get(client, payload)

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == payload
    assert "format" not in resp.json()


def test_explicit_json_matches_default(client):
    payload = _envelope()
    resp = _get(client, payload, "?format=json")

    assert resp.status_code == 200
    assert resp.json() == payload
    assert "format" not in resp.json()


# --------------------------------------------------------------------------- #
# invalid format
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("bad", ["xml", "columnar", "columns-v2", "json,columns"])
def test_unknown_format_is_400(client, bad):
    payload = _envelope()
    with patch("api.market_screen.router.build_snapshot", return_value=payload) as build:
        resp = client.get(f"/api/market/snapshot?format={bad}")

    assert resp.status_code == 400
    assert "unknown format" in resp.json()["detail"]
    assert bad in resp.json()["detail"]
    # Validated before the scan: a typo must not burn a TradingView call.
    build.assert_not_called()


# --------------------------------------------------------------------------- #
# encoded-body cache
# --------------------------------------------------------------------------- #

def _counted_encode():
    return patch("api.market_screen.router.dumps", wraps=dumps)


def test_same_frame_is_encoded_once_and_served_from_the_cache(client):
    payload = _envelope()
    with patch("api.market_screen.router.build_snapshot", return_value=payload), _counted_encode() as encode:
        first = client.get("/api/market/snapshot")
        second = client.get("/api/market/snapshot")

    assert first.status_code == second.status_code == 200
    assert first.content == second.content
    assert encode.call_count == 1
    # The JSON contract is untouched by the cache.
    assert second.json() == payload


def test_each_format_is_cached_separately_and_reused(client):
    payload = _envelope()
    with patch("api.market_screen.router.build_snapshot", return_value=payload), _counted_encode() as encode:
        json_first = client.get("/api/market/snapshot?format=json")
        columns_first = client.get("/api/market/snapshot?format=columns")
        json_second = client.get("/api/market/snapshot?format=json")
        columns_second = client.get("/api/market/snapshot?format=columns")

    assert encode.call_count == 2
    assert json_first.content == json_second.content
    assert columns_first.content == columns_second.content
    assert json_second.json()["rows"] == payload["rows"]
    assert "format" not in json_second.json()
    assert columns_second.json()["format"] == COLUMNS_FORMAT_VERSION


def test_changed_rows_produce_a_new_body(client):
    first_payload = _envelope()
    second_rows = [{**row} for row in ROWS]
    second_rows[0]["close"] = 3000.0
    second_payload = _envelope(rows=second_rows)
    with patch(
        "api.market_screen.router.build_snapshot",
        side_effect=[first_payload, second_payload],
    ), _counted_encode() as encode:
        first = client.get("/api/market/snapshot?format=columns")
        second = client.get("/api/market/snapshot?format=columns")

    # Same length and envelope; only the row identity differs, which must miss.
    assert encode.call_count == 2
    assert first.content != second.content
    assert first.json()["columns"]["close"] == [2946.0, 4102.5, 0.0]
    assert second.json()["columns"]["close"] == [3000.0, 4102.5, 0.0]


def test_symbol_filter_subsets_never_share_an_encoded_body(client):
    frame = [ROWS[0], ROWS[1], ROWS[2], {**ROWS[2], "symbol": "FOURTH", "close": 10.0}]
    payload = _envelope(rows=frame)
    # Both filters return three of the four rows in frame order: same first row,
    # same last row, same length and total -- only the requested symbols differ.
    first_query = "/api/market/snapshot?format=columns&symbols=RELIANCE,NEWCO,FOURTH"
    second_query = "/api/market/snapshot?format=columns&symbols=RELIANCE,TCS,FOURTH"
    with patch("api.market_screen.router.build_snapshot", return_value=payload), _counted_encode() as encode:
        first = client.get(first_query)
        second = client.get(second_query)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert encode.call_count == 2
    assert first.json()["columns"]["symbol"] == ["RELIANCE", "NEWCO", "FOURTH"]
    assert second.json()["columns"]["symbol"] == ["RELIANCE", "TCS", "FOURTH"]


def test_empty_frame_is_encoded_once_and_cached(client):
    payload = _envelope(rows=[])
    with patch("api.market_screen.router.build_snapshot", return_value=payload), _counted_encode() as encode:
        first = client.get("/api/market/snapshot?format=columns")
        second = client.get("/api/market/snapshot?format=columns")

    assert encode.call_count == 1
    assert first.content == second.content
    assert second.json()["fields"] == []
    assert second.json()["columns"] == {}


def test_cache_evicts_the_oldest_entry_and_keeps_the_newest(client):
    payloads = [_envelope(as_of=f"2026-11-17T11:44:0{i}+05:30") for i in range(5)]
    with _counted_encode() as encode:
        for payload in payloads:
            with patch("api.market_screen.router.build_snapshot", return_value=payload):
                client.get("/api/market/snapshot")
        assert len(_encoded_cache) == _ENCODED_CACHE_MAX_ENTRIES
        assert encode.call_count == 5

        with patch("api.market_screen.router.build_snapshot", return_value=payloads[-1]):
            client.get("/api/market/snapshot")

    # The newest entry survived; the first one was evicted.
    assert encode.call_count == 5


def test_sliced_frame_with_a_new_age_sec_still_hits(client):
    payload = _envelope()
    # ``build_snapshot`` slices the cached frame per request, so both the rows
    # list and ``age_sec`` are new on every call while the row dicts are shared.
    first_payload = {**payload, "rows": payload["rows"][:3], "age_sec": 0.4}
    second_payload = {**payload, "rows": payload["rows"][:3], "age_sec": 4.9}
    with patch(
        "api.market_screen.router.build_snapshot",
        side_effect=[first_payload, second_payload],
    ), _counted_encode() as encode:
        first = client.get("/api/market/snapshot")
        second = client.get("/api/market/snapshot")

    assert encode.call_count == 1
    assert first.content == second.content
    # The age from the first encode is what a hit serves (documented tradeoff).
    assert second.json()["age_sec"] == 0.4


def test_filter_order_and_case_share_one_encoded_body(client):
    payload = _envelope()
    with patch("api.market_screen.router.build_snapshot", return_value=payload), _counted_encode() as encode:
        first = client.get("/api/market/snapshot?symbols=tcs,reliance")
        second = client.get("/api/market/snapshot?symbols=RELIANCE,TCS")

    assert encode.call_count == 1
    assert first.content == second.content
    assert second.json()["total"] == 2


# --------------------------------------------------------------------------- #
# pure helpers
# --------------------------------------------------------------------------- #

def test_normalize_format_is_tolerant_but_strict_about_unknown():
    assert normalize_format(None) == "json"
    assert normalize_format("") == "json"
    assert normalize_format(" Columns ") == "columns"
    with pytest.raises(ValueError, match="expected one of json, columns"):
        normalize_format("parquet")


def test_to_columnar_keeps_later_only_keys_and_keeps_columns_square():
    payload = {
        "universe": "all_equity",
        "rows": [{"symbol": "A"}, {"symbol": "B", "note": "late"}],
    }
    body = to_columnar(payload)

    assert body["fields"] == ["symbol", "note"]
    assert body["columns"] == {"symbol": ["A", "B"], "note": [None, "late"]}
    assert all(len(column) == 2 for column in body["columns"].values())


def test_dumps_returns_bytes_without_whitespace():
    raw = dumps({"a": 1, "b": [None, 2.5]})
    assert isinstance(raw, bytes)
    assert raw == b'{"a":1,"b":[null,2.5]}'
