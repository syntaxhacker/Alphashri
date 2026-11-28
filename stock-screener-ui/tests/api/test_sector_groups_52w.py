"""52-week breadth fields on group aggregation (no network)."""

import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import api.tv.cache as tv_cache  # noqa: E402
from api import sector as sector_module  # noqa: E402
from api.sector import GroupPerformanceItem, _range52_stats, router  # noqa: E402


GROUP_52W_FIELDS = ('near_high_pct', 'near_low_pct', 'median_pos_52w')
GROUP_52W_COLUMNS = ('close', 'price_52_week_high', 'price_52_week_low')


def _frame() -> pd.DataFrame:
    """Three members: one near the high, one near the low, one mid-range."""
    return pd.DataFrame({
        'name': ['NEARHIGH', 'NEARLOW', 'MID'],
        'sector': ['Tech', 'Tech', 'Tech'],
        'industry': ['Software', 'Software', 'Software'],
        'change': [1.0, -1.0, 0.0],
        'market_cap_basic': [100.0, 100.0, 100.0],
        'close': [100.0, 55.0, 75.0],
        'price_52_week_high': [100.0, 100.0, 100.0],
        'price_52_week_low': [50.0, 50.0, 50.0],
    })


def test_theme_group_52w_stats():
    items = sector_module._aggregate_theme_groups(
        _frame(),
        'change',
        {'demo': {'NEARHIGH', 'NEARLOW', 'MID'}},
        {'demo': {'name': 'Demo'}},
    )
    assert len(items) == 1
    item = items[0]
    assert (item.name, item.slug) == ('Demo', 'demo')
    assert item.near_high_pct == 33.3
    assert item.near_low_pct == 33.3
    assert item.median_pos_52w == 50.0


def test_range52_stats_excludes_nulls_and_invalid_rows():
    frame = pd.DataFrame({
        'close': [100.0, None, 80.0, float('inf'), 0.0],
        'price_52_week_high': [100.0, 100.0, 50.0, 100.0, 100.0],
        'price_52_week_low': [50.0, 50.0, 100.0, 50.0, 50.0],
    })
    # Only the first row is valid: high > low, finite close, close > 0.
    assert _range52_stats(frame) == (100.0, 0.0, 100.0)


def test_range52_stats_all_null_or_missing_columns():
    nulls = pd.DataFrame({
        'close': [None, None],
        'price_52_week_high': [None, None],
        'price_52_week_low': [None, None],
    })
    assert _range52_stats(nulls) == (None, None, None)
    assert _range52_stats(pd.DataFrame({'name': ['A']})) == (None, None, None)
    assert _range52_stats(pd.DataFrame()) == (None, None, None)


def test_sector_and_industry_groups_carry_52w_fields():
    assert set(GROUP_52W_FIELDS).issubset(GroupPerformanceItem.model_fields)
    for classify, name in (('sector', 'Tech'), ('industry', 'Software')):
        items = sector_module._aggregate_groups(_frame(), classify, 'change')
        assert len(items) == 1
        item = items[0]
        assert item.name == name
        assert (item.near_high_pct, item.near_low_pct, item.median_pos_52w) == (
            33.3, 33.3, 50.0,
        )


@pytest.fixture
def groups_client():
    sector_module._group_cache.clear()
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client
    sector_module._group_cache.clear()


@pytest.mark.parametrize('classify', ['sector', 'industry'])
def test_groups_endpoint_serializes_52w_fields(groups_client, monkeypatch, classify):
    calls = []

    def fake_fetch(market, limit):
        calls.append((market, limit))
        return _frame()

    monkeypatch.setattr(sector_module, '_fetch_group_data', fake_fetch)
    resp = groups_client.get('/api/sector/groups', params={'classify': classify})
    assert resp.status_code == 200
    groups = resp.json()['groups']
    assert len(groups) == 1
    assert {field: groups[0][field] for field in GROUP_52W_FIELDS} == {
        'near_high_pct': 33.3,
        'near_low_pct': 33.3,
        'median_pos_52w': 50.0,
    }
    assert len(calls) == 1


@pytest.fixture
def clean_tv_cache():
    tv_cache.clear()
    sector_module._group_cache.clear()
    yield
    tv_cache.clear()
    sector_module._group_cache.clear()


def test_group_aggregation_adds_no_second_scan(monkeypatch, clean_tv_cache):
    scans = []

    def fake_scan(market, **kwargs):
        scans.append(kwargs)
        return _frame()

    monkeypatch.setattr(tv_cache, 'scan_frame', fake_scan)

    first = sector_module._fetch_group_data('india', 800)
    second = sector_module._fetch_group_data('india', 800)
    sector_module._aggregate_groups(first, 'sector', 'change')
    sector_module._aggregate_groups(second, 'industry', 'change')

    assert len(scans) == 1  # gateway TTL served the second fetch
    assert set(sector_module.GROUP_COLUMNS) <= set(scans[0]['columns'])
    assert set(GROUP_52W_COLUMNS) <= set(scans[0]['columns'])
