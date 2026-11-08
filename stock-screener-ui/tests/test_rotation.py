"""Rotation overview scoring and API contract."""

from __future__ import annotations

import json

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import rotation
from api.rotation import (
    RotationMover,
    _build_overview,
    _percentile,
    _quadrant,
    _status,
)
from api.tv import PERFORMANCE_FIELDS


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "name": "AAA",
                "sector": "Tech",
                "industry": "Software",
                "change": 2.0,
                "Perf.W": 4.0,
                "Perf.1M": 8.0,
                "Perf.3M": 12.0,
                "Perf.6M": 20.0,
                "Perf.YTD": 24.0,
                "Perf.Y": 30.0,
                "market_cap_basic": 100.0,
                "relative_volume": 1.5,
            },
            {
                "name": "BBB",
                "sector": "Tech",
                "industry": "Software",
                "change": 1.0,
                "Perf.W": 2.0,
                "Perf.1M": 4.0,
                "Perf.3M": 6.0,
                "Perf.6M": 10.0,
                "Perf.YTD": 12.0,
                "Perf.Y": 15.0,
                "market_cap_basic": 300.0,
                "relative_volume": 0.5,
            },
            {
                "name": "CCC",
                "sector": "Energy",
                "industry": "Oil",
                "change": -2.0,
                "Perf.W": -4.0,
                "Perf.1M": -8.0,
                "Perf.3M": -12.0,
                "Perf.6M": -20.0,
                "Perf.YTD": -24.0,
                "Perf.Y": -30.0,
                "market_cap_basic": 200.0,
                "relative_volume": 0.8,
            },
            {
                "name": "DDD",
                "sector": "Energy",
                "industry": "Oil",
                "change": -1.0,
                "Perf.W": -2.0,
                "Perf.1M": -4.0,
                "Perf.3M": -6.0,
                "Perf.6M": -10.0,
                "Perf.YTD": -12.0,
                "Perf.Y": -15.0,
                "market_cap_basic": 100.0,
                "relative_volume": 1.2,
            },
        ]
    )


def _benchmark() -> dict:
    return {
        "benchmark": "NIFTY 50",
        "returns": {period: 0.0 for period in PERFORMANCE_FIELDS},
        "vix": 12.5,
        "vix_change": -2.1,
    }


@pytest.fixture(autouse=True)
def _clear_rotation_cache():
    rotation.clear_cache()
    yield
    rotation.clear_cache()


def test_percentile_is_relative_and_handles_single_value():
    assert _percentile([10, 20, 30]) == [33.33333333333333, 66.66666666666666, 100.0]
    assert _percentile([10]) == [50.0]


def test_quadrant_and_status_rules():
    assert _quadrant(80, 80) == "leading"
    assert _quadrant(80, 20) == "weakening"
    assert _quadrant(20, 80) == "improving"
    assert _quadrant(20, 20) == "lagging"
    assert _status(80, 80, 70, 2.0) == "booming"
    assert _status(20, 20, 20, -2.0) == "dumping"
    assert _status(40, 70, 50, 1.0) == "heating"
    assert _status(60, 30, 50, -1.0) == "cooling"


def test_sector_overview_aggregates_and_scores(monkeypatch):
    monkeypatch.setattr(rotation, "_get_frame", lambda market: _frame())
    monkeypatch.setattr(rotation, "_fetch_benchmark", lambda market: _benchmark())

    result = _build_overview("india", "sector", "1M", 1, 48)
    rows = {row["name"]: row for row in result["rows"]}

    assert set(rows) == {"Tech", "Energy"}
    assert rows["Tech"]["returns"]["1M"] == pytest.approx(5.0)
    assert rows["Tech"]["returns"]["1W"] == pytest.approx(2.5)
    assert rows["Tech"]["breadth"] == 100.0
    assert rows["Tech"]["rel_volume"] == 1.0
    assert rows["Energy"]["breadth"] == 0.0
    assert rows["Tech"]["rs_1m"] == pytest.approx(5.0)
    assert rows["Energy"]["rs_1m"] == pytest.approx(-6.67)
    assert rows["Tech"]["rank"] == 1
    assert rows["Tech"]["quadrant"] == "leading"
    assert rows["Energy"]["quadrant"] == "lagging"
    assert result["counts"]["booming"] + result["counts"]["heating"] >= 1
    assert [mover["symbol"] for mover in rows["Tech"]["top_movers"]] == ["AAA", "BBB"]


def test_min_members_filters_groups(monkeypatch):
    monkeypatch.setattr(rotation, "_get_frame", lambda market: _frame())
    monkeypatch.setattr(rotation, "_fetch_benchmark", lambda market: _benchmark())

    result = _build_overview("india", "sector", "1M", 3, 48)
    assert result["rows"] == []


def test_non_finite_inputs_are_sanitised(monkeypatch):
    nan = float("nan")
    inf = float("inf")
    frame = pd.DataFrame(
        [
            {
                "name": "AAA", "sector": "Tech", "industry": "Software",
                "change": 1.0, "Perf.W": inf, "Perf.1M": inf, "Perf.3M": nan,
                "Perf.6M": 1.0, "Perf.YTD": 2.0, "Perf.Y": 3.0,
                "market_cap_basic": 100.0, "relative_volume": inf,
            },
            {
                "name": "BBB", "sector": "Tech", "industry": "Software",
                "change": -1.0, "Perf.W": 2.0, "Perf.1M": 5.0, "Perf.3M": 1.0,
                "Perf.6M": 1.0, "Perf.YTD": 2.0, "Perf.Y": 3.0,
                "market_cap_basic": nan, "relative_volume": nan,
            },
            {
                "name": "CCC", "sector": "Energy", "industry": "Oil",
                "change": 1.0, "Perf.W": -1.0, "Perf.1M": -5.0, "Perf.3M": -1.0,
                "Perf.6M": -1.0, "Perf.YTD": -2.0, "Perf.Y": -3.0,
                "market_cap_basic": 50.0, "relative_volume": 0.5,
            },
        ]
    )
    monkeypatch.setattr(rotation, "_get_frame", lambda market: frame)
    monkeypatch.setattr(rotation, "_fetch_benchmark", lambda market: _benchmark())

    result = _build_overview("india", "sector", "1M", 1, 48)
    rows = {row["name"]: row for row in result["rows"]}
    # Infinity prints and NaN weights are excluded: Tech has no usable 1M value.
    assert rows["Tech"]["returns"]["1M"] == pytest.approx(0.0)
    assert rows["Tech"]["rel_volume"] == 0.0
    assert rows["Energy"]["returns"]["1M"] == pytest.approx(-5.0)

    # NaN/Infinity would make Starlette's json.dumps(allow_nan=False) raise.
    json.dumps(result, allow_nan=False)


def test_theme_overview_returns_empty_without_db(monkeypatch):
    monkeypatch.setattr(rotation, "_get_frame", lambda market: _frame())
    monkeypatch.setattr(rotation, "_fetch_benchmark", lambda market: _benchmark())
    monkeypatch.setattr(rotation, "_load_theme_membership", lambda: ({}, {}))

    assert _build_overview("india", "theme", "1M", 1, 48)["rows"] == []

    def _boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(rotation, "_load_theme_membership", _boom)
    assert _build_overview("india", "theme", "1M", 1, 48)["rows"] == []


def test_theme_overview_uses_membership(monkeypatch):
    monkeypatch.setattr(rotation, "_get_frame", lambda market: _frame())
    monkeypatch.setattr(rotation, "_fetch_benchmark", lambda market: _benchmark())
    monkeypatch.setattr(
        rotation,
        "_load_theme_membership",
        lambda: (
            {"tech-theme": {"name": "Tech Theme", "category": "Technology"}},
            {"tech-theme": {"AAA", "BBB"}},
        ),
    )

    result = _build_overview("india", "theme", "1M", 2, 48)
    row = result["rows"][0]
    assert row["name"] == "Tech Theme"
    assert row["slug"] == "tech-theme"
    assert row["category"] == "Technology"
    assert row["members"] == 2
    assert row["covered"] == 2


def test_rotation_endpoint_returns_payload(monkeypatch):
    payload = {
        "market": "india",
        "kind": "sector",
        "period": "1M",
        "benchmark": "NIFTY 50",
        "last_updated": "2026-10-26T10:00:00+05:30",
        "regime": {
            "benchmark": "NIFTY 50",
            "benchmark_change": 0.2,
            "benchmark_1m": 1.1,
            "vix": 12.5,
            "vix_change": -2.1,
            "breadth": 60.0,
            "label": "RISK-ON",
        },
        "counts": {"booming": 1, "heating": 0, "cooling": 0, "dumping": 0, "neutral": 1},
        "rows": [
            {
                "id": "sector:tech",
                "name": "Tech",
                "kind": "sector",
                "members": 2,
                "covered": 2,
                "returns": {period: 1.0 for period in PERFORMANCE_FIELDS},
                "rs_1m": 1.0,
                "rs_1w": 1.0,
                "rs_pct": 80.0,
                "mom_pct": 70.0,
                "rank": 1,
                "rank_delta": 1,
                "breadth": 100.0,
                "rel_volume": 1.2,
                "quadrant": "leading",
                "status": "booming",
                "top_movers": [RotationMover(symbol="AAA", change=2.0).model_dump()],
            }
        ],
    }
    monkeypatch.setattr(rotation, "_build_overview", lambda *args: payload)

    app = FastAPI()
    app.include_router(rotation.router)
    client = TestClient(app)
    body = client.get("/api/rotation/overview?market=india&kind=sector&period=1M").json()
    assert body["benchmark"] == "NIFTY 50"
    assert body["rows"][0]["status"] == "booming"
    assert body["rows"][0]["members"] == 2


def test_rotation_endpoint_rejects_unknown_enum_values(monkeypatch):
    # Guard against silently falling through to a 502 from the frame groupby.
    monkeypatch.setattr(rotation, "_build_overview", lambda *args: pytest.fail("must not build"))

    app = FastAPI()
    app.include_router(rotation.router)
    client = TestClient(app)

    assert client.get("/api/rotation/overview?kind=bogus").status_code == 422
    assert client.get("/api/rotation/overview?period=bogus").status_code == 422
    assert client.get("/api/rotation/overview?market=bogus").status_code == 422
    assert client.get("/api/rotation/overview?min_members=0").status_code == 422
    assert client.get("/api/rotation/overview?limit=4").status_code == 422
