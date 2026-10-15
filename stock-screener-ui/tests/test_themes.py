"""
Tests for the DB-backed themes taxonomy.

Covers (all against in-memory SQLite — never touches db/alphashri.db):
- seed upsert idempotency + unknown-symbol drop (+ prune + dry-run)
- classify=theme aggregation: market-cap weighting, counts, sort desc
- GET /api/sector/themes list + GET /api/sector/themes/{slug} detail (+404)
- migration revision chain (validate_migrations.py covers the file)
"""

import importlib.util
import sys
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api import sector as sector_module  # noqa: E402
from api.sector import router  # noqa: E402
from db.models.taxonomy import Theme, ThemeConstituent  # noqa: E402


def _load_seed_module():
    path = ROOT / "scripts" / "seed_themes.py"
    spec = importlib.util.spec_from_file_location("seed_themes_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


seed_mod = _load_seed_module()

SEED_ITEMS = [
    {
        "slug": "defence",
        "name": "Defence",
        "category": "Industrials",
        "description": "Defence makers",
        "source": "curated",
        "symbols": ["HAL", "BEL", "BOGUS1"],
    },
    {
        "slug": "railways",
        "name": "Railways",
        "category": "Industrials",
        "description": "",
        "source": "curated",
        "symbols": ["RVNL", "IRFC", "HAL"],  # HAL in two themes (many-to-many)
    },
]

VALID = {"HAL", "BEL", "RVNL", "IRFC"}


# ---------- seed upsert ----------

def test_seed_upsert_creates_themes_and_drops_unknown(test_db):
    summary = seed_mod.upsert_themes(test_db, SEED_ITEMS, valid_symbols=VALID)
    assert summary["themes_upserted"] == 2
    assert summary["themes_created"] == 2
    assert summary["themes_updated"] == 0
    # BOGUS1 dropped: 2 + 3 constituents
    assert summary["constituents_inserted"] == 5
    assert summary["unknown_symbols"] == ["BOGUS1"]

    assert test_db.query(Theme).count() == 2
    assert test_db.query(ThemeConstituent).count() == 5
    defence = test_db.query(Theme).filter(Theme.slug == "defence").one()
    assert defence.version == 1
    assert defence.is_active is True
    syms = sorted(
        r.symbol for r in test_db.query(ThemeConstituent)
        .filter(ThemeConstituent.theme_id == defence.id).all()
    )
    assert syms == ["BEL", "HAL"]


def test_seed_upsert_is_idempotent_and_bumps_version(test_db):
    seed_mod.upsert_themes(test_db, SEED_ITEMS, valid_symbols=VALID)
    summary = seed_mod.upsert_themes(test_db, SEED_ITEMS, valid_symbols=VALID)
    assert summary["themes_created"] == 0
    assert summary["themes_updated"] == 2
    assert test_db.query(Theme).count() == 2
    assert test_db.query(ThemeConstituent).count() == 5
    versions = sorted(t.version for t in test_db.query(Theme).all())
    assert versions == [2, 2]


def test_seed_replaces_constituents_on_reseed(test_db):
    seed_mod.upsert_themes(test_db, SEED_ITEMS, valid_symbols=VALID)
    changed = [dict(SEED_ITEMS[0], symbols=["BEL"])]
    summary = seed_mod.upsert_themes(test_db, changed, valid_symbols=VALID)
    assert summary["constituents_inserted"] == 1
    defence = test_db.query(Theme).filter(Theme.slug == "defence").one()
    syms = [
        r.symbol for r in test_db.query(ThemeConstituent)
        .filter(ThemeConstituent.theme_id == defence.id).all()
    ]
    assert syms == ["BEL"]
    # untouched theme keeps its members
    assert test_db.query(ThemeConstituent).count() == 1 + 3


def test_seed_prune_deactivates_missing_themes(test_db):
    seed_mod.upsert_themes(test_db, SEED_ITEMS, valid_symbols=VALID)
    summary = seed_mod.upsert_themes(
        test_db, SEED_ITEMS[:1], valid_symbols=VALID, prune=True
    )
    assert summary["pruned"] == ["railways"]
    railways = test_db.query(Theme).filter(Theme.slug == "railways").one()
    assert railways.is_active is False


def test_seed_dry_run_writes_nothing(test_db):
    summary = seed_mod.upsert_themes(
        test_db, SEED_ITEMS, valid_symbols=VALID, dry_run=True
    )
    assert summary["dry_run"] is True
    assert summary["themes_upserted"] == 2
    assert test_db.query(Theme).count() == 0
    assert test_db.query(ThemeConstituent).count() == 0


# ---------- pure aggregation ----------

def _theme_df() -> pd.DataFrame:
    return pd.DataFrame({
        'name': ['HAL', 'BEL', 'RVNL', 'IRFC', 'TCS'],
        'sector': ['Ind', 'Ind', 'Ind', 'Ind', 'Tech'],
        'industry': ['Def', 'Def', 'Rail', 'Rail', 'IT'],
        'change': [4.0, 2.0, -1.0, 1.0, 10.0],
        'Perf.W': [0.0, 0.0, 0.0, 0.0, 0.0],
        'Perf.1M': [0.0, 0.0, 0.0, 0.0, 0.0],
        'Perf.3M': [0.0, 0.0, 0.0, 0.0, 0.0],
        'Perf.6M': [0.0, 0.0, 0.0, 0.0, 0.0],
        'Perf.YTD': [0.0, 0.0, 0.0, 0.0, 0.0],
        'Perf.Y': [0.0, 0.0, 0.0, 0.0, 0.0],
        'market_cap_basic': [300.0, 100.0, 200.0, 200.0, 9999.0],
    })


def test_aggregate_theme_groups_weighting_counts_sort():
    mapping = {
        "defence": {"HAL", "BEL"},
        "railways": {"RVNL", "IRFC", "HAL"},  # HAL shared across themes
    }
    items = sector_module._aggregate_theme_groups(_theme_df(), "change", mapping)
    by_name = {g.name: g for g in items}
    # defence: (4*300 + 2*100)/400 = 3.5 ; railways: (-1*200 + 1*200 + 4*300)/700 = 1.71
    assert by_name["defence"].change == 3.5
    assert by_name["defence"].stock_count == 2
    assert (by_name["defence"].advances, by_name["defence"].declines) == (2, 0)
    assert by_name["railways"].change == round(1200 / 700, 2)
    assert by_name["railways"].stock_count == 3
    assert (by_name["railways"].advances, by_name["railways"].declines) == (2, 1)
    # TCS (not in any theme) contributes nowhere; sorted desc
    assert [g.name for g in items] == ["defence", "railways"]


def test_aggregate_theme_groups_skips_uncovered_and_empty():
    mapping = {"ghost": {"NOPE"}, "empty": set()}
    assert sector_module._aggregate_theme_groups(_theme_df(), "change", mapping) == []
    assert sector_module._aggregate_theme_groups(pd.DataFrame(), "change", {"a": {"HAL"}}) == []
    assert sector_module._aggregate_theme_groups(_theme_df(), "change", {}) == []


# ---------- endpoints (DB-backed, in-memory) ----------

@pytest.fixture
def theme_client(test_db_engine, test_db):
    """TestClient with sector router + SessionLocal bound to the in-memory engine."""
    seed_mod.upsert_themes(test_db, SEED_ITEMS, valid_symbols=VALID)
    sector_module._group_cache.clear()
    TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    with patch.object(sector_module, "SessionLocal", TestSession):
        app = FastAPI()
        app.include_router(router)
        with TestClient(app) as c:
            yield c
    sector_module._group_cache.clear()


def test_groups_classify_theme_end_to_end(theme_client):
    with patch.object(sector_module, "_fetch_group_data", return_value=_theme_df()):
        resp = theme_client.get("/api/sector/groups", params={"classify": "theme", "period": "1D"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["classify"] == "theme"
    by_name = {g["name"]: g for g in data["groups"]}
    assert set(by_name) == {"Defence", "Railways"}
    assert by_name["Defence"]["change"] == 3.5
    assert by_name["Defence"]["slug"] == "defence"
    assert by_name["Railways"]["stock_count"] == 3
    changes = [g["change"] for g in data["groups"]]
    assert changes == sorted(changes, reverse=True)


def test_groups_classify_theme_uses_wide_fetch_limit(theme_client):
    seen = {}

    def fake_fetch(market, limit):
        seen["limit"] = limit
        return _theme_df()

    with patch.object(sector_module, "_fetch_group_data", side_effect=fake_fetch):
        resp = theme_client.get("/api/sector/groups", params={"classify": "theme"})
    assert resp.status_code == 200
    assert seen["limit"] == sector_module.THEME_FETCH_LIMIT >= 3000


def test_groups_classify_theme_empty_when_no_themes(test_db_engine):
    # fresh engine, no theme rows seeded
    sector_module._group_cache.clear()
    TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    with patch.object(sector_module, "SessionLocal", TestSession):
        app = FastAPI()
        app.include_router(router)
        with TestClient(app) as c:
            with patch.object(sector_module, "_fetch_group_data", return_value=_theme_df()):
                resp = c.get("/api/sector/groups", params={"classify": "theme"})
    sector_module._group_cache.clear()
    assert resp.status_code == 200
    assert resp.json()["groups"] == []


def test_themes_list(theme_client):
    resp = theme_client.get("/api/sector/themes")
    assert resp.status_code == 200
    themes = resp.json()["themes"]
    assert [t["slug"] for t in themes] == ["defence", "railways"]  # sorted by name
    by_slug = {t["slug"]: t for t in themes}
    assert by_slug["defence"]["member_count"] == 2
    assert by_slug["railways"]["member_count"] == 3
    assert by_slug["defence"]["category"] == "Industrials"
    assert by_slug["defence"]["description"] == "Defence makers"


def test_theme_detail_and_404(theme_client):
    resp = theme_client.get("/api/sector/themes/defence")
    assert resp.status_code == 200
    data = resp.json()
    assert data["theme"]["slug"] == "defence"
    assert data["theme"]["name"] == "Defence"
    assert data["constituents"] == ["BEL", "HAL"]  # sorted

    resp = theme_client.get("/api/sector/themes/no-such-theme")
    assert resp.status_code == 404


# ---------- migration chain ----------

def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_revision_chain():
    versions_dir = ROOT / "db" / "migrations" / "versions"
    mig = _load_module(
        "mig_add_themes",
        versions_dir / "2026_10_07_1200-th1a2b3c4d5e_add_themes.py",
    )
    assert mig.revision == "th1a2b3c4d5e"
    assert mig.down_revision == "pi1a2b3c4d5e"  # current head
    assert callable(mig.upgrade) and callable(mig.downgrade)

    vm = _load_module("validate_migrations", ROOT / "scripts" / "validate_migrations.py")
    assert vm.validate_migrations(versions_dir) is True
