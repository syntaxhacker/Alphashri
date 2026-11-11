"""Tests for DB-backed pattern timeframe visibility and ordering."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.admin_routes import router as admin_router
from api.auth import get_current_user
from api.chart_patterns import router as cp_router
from chart_patterns import timeframe_config
from chart_patterns.timeframes import TIMEFRAME_IDS
from db.database import get_db


class _AdminUser:
    id = 1
    email = "admin@test.com"
    is_admin = True


class _RegularUser:
    id = 2
    email = "qa@test.com"
    is_admin = False


@pytest.fixture
def tf_config(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    timeframe_config.set_session_factory(factory)
    try:
        yield factory
    finally:
        timeframe_config.reset_session_factory()


def _build_client(tf_config, user):
    app = FastAPI()
    app.include_router(cp_router)
    app.include_router(admin_router)

    factory = tf_config

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: user
    return app


@pytest.fixture
def admin_client(tf_config):
    app = _build_client(tf_config, _AdminUser())
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def user_client(tf_config):
    app = _build_client(tf_config, _RegularUser())
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def test_default_config_disables_3m_and_2h(tf_config):
    rows = timeframe_config.get_configs()

    assert [row["id"] for row in rows] == TIMEFRAME_IDS
    enabled = {row["id"] for row in rows if row["enabled"]}
    assert enabled == set(TIMEFRAME_IDS) - {"3m", "2h"}
    assert [row["sort_order"] for row in rows] == list(range(len(TIMEFRAME_IDS)))


def test_set_enabled_toggles_visibility(tf_config):
    timeframe_config.set_enabled("3m", True)
    assert "3m" in timeframe_config.enabled_timeframe_ids()

    timeframe_config.set_enabled("3m", False)
    assert "3m" not in timeframe_config.enabled_timeframe_ids()


def test_set_enabled_unknown_id_raises(tf_config):
    with pytest.raises(ValueError):
        timeframe_config.set_enabled("9z", True)


def test_disabling_last_enabled_raises(tf_config):
    for tf_id in TIMEFRAME_IDS:
        if tf_id != "1D":
            timeframe_config.set_enabled(tf_id, False)

    assert timeframe_config.enabled_timeframe_ids() == ["1D"]
    with pytest.raises(ValueError):
        timeframe_config.set_enabled("1D", False)


def test_set_order_reorders_first(tf_config):
    rows = timeframe_config.set_order(["1D", "5m"])

    assert [row["id"] for row in rows][:2] == ["1D", "5m"]
    assert "3m" in [row["id"] for row in rows]


def test_set_order_rejects_unknown_and_duplicates(tf_config):
    with pytest.raises(ValueError):
        timeframe_config.set_order(["9z"])
    with pytest.raises(ValueError):
        timeframe_config.set_order(["5m", "5m"])


def test_public_timeframes_exclude_disabled(admin_client):
    resp = admin_client.get("/api/chart-patterns/timeframes")

    assert resp.status_code == 200
    ids = [row["id"] for row in resp.json()["timeframes"]]
    assert ids == [tf for tf in TIMEFRAME_IDS if tf not in {"3m", "2h"}]


def test_valid_timeframe_ids_rejects_disabled(tf_config):
    assert "3m" not in cp_api._valid_timeframe_ids()

    timeframe_config.set_enabled("3m", True)
    assert "3m" in cp_api._valid_timeframe_ids()


def test_admin_endpoints_shape(admin_client):
    resp = admin_client.get("/api/admin/pattern-timeframes")
    assert resp.status_code == 200
    rows = resp.json()["timeframes"]
    assert len(rows) == len(TIMEFRAME_IDS)
    assert {"id", "enabled", "sort_order", "label", "minutes"} <= set(rows[0])
    disabled = {row["id"] for row in rows if not row["enabled"]}
    assert disabled == {"3m", "2h"}

    resp = admin_client.patch(
        "/api/admin/pattern-timeframes/3m", json={"enabled": True}
    )
    assert resp.status_code == 200
    assert resp.json()["timeframe"]["id"] == "3m"
    assert resp.json()["timeframe"]["enabled"] is True

    resp = admin_client.put(
        "/api/admin/pattern-timeframes/order", json={"ids": ["1D", "5m"]}
    )
    assert resp.status_code == 200
    assert [row["id"] for row in resp.json()["timeframes"]][:2] == ["1D", "5m"]


def test_admin_patch_unknown_timeframe_404(admin_client):
    resp = admin_client.patch(
        "/api/admin/pattern-timeframes/9z", json={"enabled": True}
    )
    assert resp.status_code == 404


def test_admin_patch_last_enabled_400(admin_client):
    for tf_id in TIMEFRAME_IDS:
        if tf_id != "1D":
            admin_client.patch(
                f"/api/admin/pattern-timeframes/{tf_id}", json={"enabled": False}
            )

    resp = admin_client.patch(
        "/api/admin/pattern-timeframes/1D", json={"enabled": False}
    )
    assert resp.status_code == 400


def test_admin_endpoints_require_admin(user_client):
    assert user_client.get("/api/admin/pattern-timeframes").status_code == 403
    assert user_client.patch(
        "/api/admin/pattern-timeframes/3m", json={"enabled": True}
    ).status_code == 403
    assert user_client.put(
        "/api/admin/pattern-timeframes/order", json={"ids": ["1D"]}
    ).status_code == 403
