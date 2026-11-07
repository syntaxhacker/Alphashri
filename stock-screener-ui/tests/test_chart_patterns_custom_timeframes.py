"""Tests for admin-defined custom chart-pattern timeframes."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.admin_routes import router as admin_router
from api.auth import get_current_user
from api.chart_patterns import router as cp_router
from chart_patterns import timeframe_config
from chart_patterns.candles import _resample_rule
from chart_patterns.timeframes import (
    BUILTIN_TIMEFRAME_IDS,
    TIMEFRAME_IDS,
    get_timeframe,
    unregister_timeframe,
)
from db.database import get_db


class _AdminUser:
    id = 1
    email = "admin@test.com"
    is_admin = True


class _RegularUser:
    id = 2
    email = "qa@test.com"
    is_admin = False


@pytest.fixture(autouse=True)
def _clean_registry():
    yield
    for tf_id in list(TIMEFRAME_IDS):
        if tf_id not in BUILTIN_TIMEFRAME_IDS:
            unregister_timeframe(tf_id)
    timeframe_config._invalidate_caches()


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


def _add(tf_id, minutes, **extra):
    payload = {"id": tf_id, "minutes": minutes}
    payload.update(extra)
    return timeframe_config.add_timeframe(payload)


def test_add_45m_auto_sources_from_15m(tf_config):
    row = _add("45m", 45)

    assert row["id"] == "45m"
    assert row["minutes"] == 45
    assert row["native"] is False
    assert row["source_tf"] == "15m"
    assert row["custom"] is True
    assert row["enabled"] is True
    assert row["sort_order"] == len(BUILTIN_TIMEFRAME_IDS)

    assert "45m" in timeframe_config.enabled_timeframe_ids()
    spec = get_timeframe("45m")
    assert spec.minutes == 45
    assert spec.source_tf == "15m"

    ids = [item["id"] for item in timeframe_config.get_configs()]
    assert ids == list(BUILTIN_TIMEFRAME_IDS) + ["45m"]


def test_auto_source_picks_largest_enabled_native_divisor(tf_config):
    six_hour = _add("6h", 360)
    two_day = _add("2D", 2880)
    three_month = _add("3M", 129600)

    assert six_hour["source_tf"] == "1h"
    assert two_day["source_tf"] == "1D"
    assert three_month["source_tf"] == "1M"
    assert all(not row["native"] for row in (six_hour, two_day, three_month))

    assert six_hour["max_lookback_days"] == 730
    assert six_hour["min_bars"] == 60
    assert two_day["max_lookback_days"] == 1825
    assert two_day["min_bars"] == 52
    assert three_month["max_lookback_days"] == 3650
    assert three_month["min_bars"] == 24


def test_add_native_minutes_width(tf_config):
    row = _add("240m", 240)

    assert row["native"] is True
    assert row["source_tf"] is None
    assert get_timeframe("240m").native is True


def test_add_rejects_duplicate_and_bad_ids(tf_config):
    _add("45m", 45)

    with pytest.raises(ValueError):
        _add("45m", 45)
    with pytest.raises(ValueError):
        _add("5m", 5)
    with pytest.raises(ValueError):
        _add("45min", 45)
    with pytest.raises(ValueError):
        _add("abc", 45)
    with pytest.raises(ValueError):
        _add("0m", 0)


def test_add_rejects_bad_sources(tf_config):
    with pytest.raises(ValueError):
        _add("45m", 45, source_tf="2h")
    with pytest.raises(ValueError):
        _add("45m", 45, source_tf="nope")
    with pytest.raises(ValueError):
        _add("6h", 360, source_tf="4h")


def test_add_without_native_divisor_rejected(tf_config):
    timeframe_config.set_enabled("1m", False)

    with pytest.raises(ValueError):
        _add("7m", 7)


def test_explicit_source_is_respected(tf_config):
    row = _add("45m", 45, source_tf="5m")

    assert row["source_tf"] == "5m"
    assert row["native"] is False
    assert get_timeframe("45m").source_tf == "5m"


def test_delete_custom_timeframe(tf_config):
    _add("45m", 45)

    assert timeframe_config.delete_timeframe("45m") == "45m"
    assert "45m" not in [row["id"] for row in timeframe_config.get_configs()]
    assert "45m" not in TIMEFRAME_IDS
    with pytest.raises(ValueError):
        get_timeframe("45m")


def test_delete_builtin_timeframe_rejected(tf_config):
    with pytest.raises(ValueError):
        timeframe_config.delete_timeframe("1D")
    with pytest.raises(ValueError):
        timeframe_config.delete_timeframe("nope")


def test_custom_timeframe_flows_to_public_api(tf_config, admin_client):
    _add("45m", 45)

    resp = admin_client.get("/api/chart-patterns/timeframes")
    assert resp.status_code == 200
    rows = resp.json()["timeframes"]
    by_id = {row["id"]: row for row in rows}
    assert "45m" in by_id
    assert by_id["45m"]["minutes"] == 45
    assert by_id["45m"]["source_tf"] == "15m"

    assert "45m" in cp_api._valid_timeframe_ids()
    assert cp_api._matrix_timeframes(None)[-1] == "45m"


def test_custom_timeframe_toggle_and_order(tf_config):
    _add("45m", 45)

    assert timeframe_config.set_enabled("45m", False)["enabled"] is False
    assert "45m" not in timeframe_config.enabled_timeframe_ids()
    assert timeframe_config.set_enabled("45m", True)["enabled"] is True

    rows = timeframe_config.set_order(["45m"])
    assert rows[0]["id"] == "45m"


def test_resample_rule_covers_custom_widths():
    assert _resample_rule(3) == "3min"
    assert _resample_rule(45) == "45min"
    assert _resample_rule(360) == "6h"
    assert _resample_rule(2880) == "2D"
    assert _resample_rule(129600) == "3ME"
    assert _resample_rule(10080) == "1W"


def test_admin_create_and_delete_timeframe(admin_client):
    resp = admin_client.post(
        "/api/admin/pattern-timeframes",
        json={
            "id": "45m",
            "label": "45m",
            "minutes": 45,
            "source_tf": None,
            "max_lookback_days": 90,
            "min_bars": 60,
        },
    )
    assert resp.status_code == 200
    row = resp.json()["timeframe"]
    assert row["id"] == "45m"
    assert row["custom"] is True
    assert row["enabled"] is True
    assert row["source_tf"] == "15m"
    assert row["max_lookback_days"] == 90

    rows = admin_client.get("/api/admin/pattern-timeframes").json()["timeframes"]
    assert {item["id"] for item in rows if item["custom"]} == {"45m"}
    assert all(item["custom"] is False for item in rows if item["id"] in BUILTIN_TIMEFRAME_IDS)

    resp = admin_client.post(
        "/api/admin/pattern-timeframes", json={"id": "45m", "minutes": 45}
    )
    assert resp.status_code == 409

    resp = admin_client.post(
        "/api/admin/pattern-timeframes", json={"id": "bad", "minutes": 45}
    )
    assert resp.status_code == 400

    resp = admin_client.delete("/api/admin/pattern-timeframes/45m")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": "45m"}
    assert "45m" not in [item["id"] for item in timeframe_config.get_configs()]

    resp = admin_client.delete("/api/admin/pattern-timeframes/1D")
    assert resp.status_code == 400


def test_admin_custom_endpoints_require_admin(user_client):
    assert user_client.post(
        "/api/admin/pattern-timeframes", json={"id": "45m", "minutes": 45}
    ).status_code == 403
    assert user_client.delete(
        "/api/admin/pattern-timeframes/45m"
    ).status_code == 403
