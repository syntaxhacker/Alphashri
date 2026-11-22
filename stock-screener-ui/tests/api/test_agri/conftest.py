"""Deterministic agri fixtures — in-memory/temp SQLite only, never db/alphashri.db."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.agri import aggregate, store
from api.agri.router import router as agri_router

_FIRST_DAY = date(2026, 5, 18)
_DAYS = 14
_SPEC = (
    ("Onion", 2000, 10), ("Potato", 1500, 8), ("Tomato", 1200, 15),
    ("Rice", 3500, 5), ("Wheat", 2400, 6),
)
_MARKETS = (
    ("Maharashtra", "Pune", "Pune APMC", 0),
    ("Karnataka", "Bengaluru", "Bengaluru APMC", 50),
)


def _generated_raw() -> list[dict[str, str]]:
    # Mirrors tests/fixtures/agri_prices_sample.csv so CI does not depend on a
    # gitignored .csv artifact.
    raw: list[dict[str, str]] = []
    for day_index in range(_DAYS):
        day = (_FIRST_DAY + timedelta(days=day_index)).isoformat()
        for name, base, step in _SPEC:
            for state, district, market, offset in _MARKETS:
                modal = base + day_index * step + offset
                raw.append({
                    "date": day, "state_name": state, "district_name": district,
                    "market_center_name": market, "commodity_name": name,
                    "variety": "Common" if name == "Rice" else "No 1",
                    "grade": "FAQ", "arrival_quantity": "10",
                    "arrival_units": "Metric Tonnes",
                    "min_price": str(modal - 100), "max_price": str(modal + 150),
                    "modal_price": str(modal), "price_unit": "Rs./Quintal",
                })
    return raw


@pytest.fixture
def sample_rows() -> list[dict[str, Any]]:
    rows = [aggregate.normalize_source_row(row, source="fixture") for row in _generated_raw()]
    return [row for row in rows if row is not None]


@pytest.fixture
def temp_db(tmp_path: Path, sample_rows: list[dict[str, Any]]) -> Path:
    path = tmp_path / "agri_prices.db"
    conn = store.open_writer(path)
    try:
        store.upsert_rows(conn, sample_rows)
    finally:
        conn.close()
    return path


@pytest.fixture
def db_conn(tmp_path: Path):
    conn = store.open_writer(tmp_path / "store.db")
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture
def agri_client(temp_db: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    from api.agri import router as router_module

    monkeypatch.setattr(router_module, "DB_PATH", temp_db)
    app = FastAPI()
    app.include_router(agri_router)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def empty_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    from api.agri import router as router_module

    monkeypatch.setattr(router_module, "DB_PATH", tmp_path / "missing.db")
    app = FastAPI()
    app.include_router(agri_router)
    with TestClient(app) as client:
        yield client
