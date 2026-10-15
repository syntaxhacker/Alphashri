"""
Tests for GET /api/sector/groups (market-cap-weighted group performance).
"""

import sys
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api import sector as sector_module
from api.sector import (
    PERIOD_COLUMN_MAP,
    GroupPerformanceResponse,
    router,
)


def _sample_df() -> pd.DataFrame:
    return pd.DataFrame({
        'name': ['A', 'B', 'C', 'D', 'E'],
        'sector': ['Tech', 'Tech', 'Bank', 'Bank', 'Bank'],
        'industry': ['Software', 'Software', 'Banks', 'Banks', 'Insurance'],
        'change': [2.0, -1.0, 4.0, 1.0, -2.0],
        'Perf.W': [1.0, 1.0, 1.0, 1.0, 1.0],
        'Perf.1M': [10.0, 20.0, 5.0, 5.0, 5.0],
        'Perf.3M': [0.0, 0.0, 0.0, 0.0, 0.0],
        'Perf.6M': [0.0, 0.0, 0.0, 0.0, 0.0],
        'Perf.YTD': [0.0, 0.0, 0.0, 0.0, 0.0],
        'Perf.Y': [0.0, 0.0, 0.0, 0.0, 0.0],
        'market_cap_basic': [300.0, 100.0, 200.0, 200.0, 100.0],
    })


@pytest.fixture
def groups_client():
    sector_module._group_cache.clear()
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as c:
        yield c
    sector_module._group_cache.clear()


def _get(client, fetch_df, **params):
    with patch.object(sector_module, "_fetch_group_data", return_value=fetch_df):
        return client.get("/api/sector/groups", params=params)


def test_period_column_map():
    assert PERIOD_COLUMN_MAP == {
        "1D": "change", "1W": "Perf.W", "1M": "Perf.1M",
        "3M": "Perf.3M", "6M": "Perf.6M", "YTD": "Perf.YTD",
        "1Y": "Perf.Y",
    }


def test_weighting_is_market_cap_weighted_and_rounded(groups_client):
    # Tech: (2.0*300 + -1.0*100) / 400 = 1.25
    resp = _get(groups_client, _sample_df(), classify="sector", period="1D")
    assert resp.status_code == 200
    data = resp.json()
    tech = next(g for g in data["groups"] if g["name"] == "Tech")
    assert tech["change"] == 1.25
    assert tech["stock_count"] == 2


def test_grouping_sector_vs_industry(groups_client):
    by_sector = _get(groups_client, _sample_df(), classify="sector", period="1D").json()
    assert {g["name"] for g in by_sector["groups"]} == {"Tech", "Bank"}

    sector_module._group_cache.clear()
    by_industry = _get(groups_client, _sample_df(), classify="industry", period="1D").json()
    assert {g["name"] for g in by_industry["groups"]} == {"Software", "Banks", "Insurance"}


def test_period_column_mapping_uses_perf_1m(groups_client):
    # Perf.1M: Software = (10*300 + 20*100)/400 = 12.5, distinct from `change` (1.25)
    resp = _get(groups_client, _sample_df(), classify="sector", period="1M")
    assert resp.status_code == 200
    tech = next(g for g in resp.json()["groups"] if g["name"] == "Tech")
    assert tech["change"] == 12.5


def test_advances_declines_and_sort_desc(groups_client):
    resp = _get(groups_client, _sample_df(), classify="sector", period="1D")
    groups = resp.json()["groups"]
    # Bank: (4*200 + 1*200 + -2*100)/500 = 1.6 > Tech 1.25 → Bank first
    assert [g["name"] for g in groups] == ["Bank", "Tech"]
    bank = groups[0]
    assert bank["advances"] == 2
    assert bank["declines"] == 1
    tech = groups[1]
    assert (tech["advances"], tech["declines"]) == (1, 1)


def test_empty_frame_returns_empty_groups(groups_client):
    resp = _get(groups_client, pd.DataFrame(), classify="sector", period="1D")
    assert resp.status_code == 200
    assert resp.json()["groups"] == []


def test_none_frame_returns_empty_groups(groups_client):
    resp = _get(groups_client, None, classify="sector", period="1D")
    assert resp.status_code == 200
    assert resp.json()["groups"] == []


def test_exception_returns_empty_groups_never_500(groups_client):
    with patch.object(sector_module, "_fetch_group_data", side_effect=RuntimeError("tv down")):
        resp = groups_client.get("/api/sector/groups", params={"classify": "sector", "period": "1D"})
    assert resp.status_code == 200
    assert resp.json()["groups"] == []


def test_response_shape(groups_client):
    resp = _get(groups_client, _sample_df(), classify="industry", period="1M", market="india")
    data = GroupPerformanceResponse(**resp.json()).model_dump()
    assert data["classify"] == "industry"
    assert data["period"] == "1M"
    assert data["market"] == "india"
    assert "last_updated" in data
    for g in data["groups"]:
        assert set(g) == {"name", "change", "stock_count", "advances", "declines", "slug"}


def test_dedupes_duplicate_names(groups_client):
    df = pd.concat([_sample_df(), _sample_df().iloc[[0]]], ignore_index=True)
    resp = _get(groups_client, df, classify="sector", period="1D")
    tech = next(g for g in resp.json()["groups"] if g["name"] == "Tech")
    assert tech["stock_count"] == 2
