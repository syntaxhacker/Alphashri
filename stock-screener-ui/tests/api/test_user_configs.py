"""Contract tests for ``/api/user-configs/{scope}`` (saved user configs, P1).

The behavioural rules under test, in the order they bite:

* an unreadable stored payload must degrade to defaults with a ``warning`` —
  never a 5xx and never a deleted row;
* writes are strict (unknown keys 422, at both nesting levels) while reads are
  tolerant (unknown keys dropped);
* ``DELETE`` is idempotent because the desired end state is "no row";
* ``If-Match`` is advisory — enforced only when the client sends it.
"""

import sys
from pathlib import Path

import pytest
from fastapi import Header
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from api.auth import get_current_user, hash_password  # noqa: E402
from api_server_fastapi import app  # noqa: E402
from db.database import get_db  # noqa: E402
from db.models import User, UserSavedConfig  # noqa: E402

SCOPE = "market.filters"
URL = f"/api/user-configs/{SCOPE}"

DEFAULTS = {
    "universe": "all_equity",
    "capTiers": [],
    "priceMin": None,
    "priceMax": None,
    "dayChangeMin": None,
    "dayChangeMax": None,
    "mcapMinCr": None,
    "mcapMaxCr": None,
    "rsiMin": None,
    "rsiMax": None,
    "relVolMin": None,
    "relVolMax": None,
    "aboveSma20": False,
    "aboveSma50": False,
    "aboveSma200": False,
    "fnoOnly": False,
    "etfOnly": False,
    "sectors": [],
    "sort": "mcap_desc",
    "view": "table",
}

SAMPLE = {
    "universe": "nifty500",
    "capTiers": ["mid"],
    "priceMin": 100.0,
    "priceMax": 5000.0,
    "dayChangeMin": -2.5,
    "dayChangeMax": 8.0,
    "mcapMinCr": 1000.0,
    "mcapMaxCr": 200000.0,
    "rsiMin": 50.0,
    "rsiMax": 75.0,
    "relVolMin": 1.5,
    "relVolMax": 10.0,
    "aboveSma20": True,
    "aboveSma50": True,
    "aboveSma200": False,
    "fnoOnly": True,
    "etfOnly": False,
    "sectors": ["IT", "Banking"],
    "sort": "relvol_desc",
    "view": "map",
}


def _with(**overrides) -> dict:
    """A full valid payload with selected fields overridden."""
    return {**DEFAULTS, **overrides}


def _make_user(db, user_id: int, email: str) -> User:
    user = User(
        id=user_id,
        email=email,
        hashed_password=hash_password("TestPassword123!"),
        display_name=email.split("@")[0],
        is_active=True,
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def as_user(db):
    """Client factory: ``as_user(2)`` returns a TestClient acting as user 2.

    The override resolves the acting user from a header rather than a closure,
    so two clients in one test can be two different users without the second
    ``dependency_overrides`` write stealing the first client's identity.
    """

    def override_db():
        yield db

    def override_user(x_test_user: int = Header(...)) -> User:
        user = db.query(User).filter(User.id == x_test_user).first()
        assert user is not None, f"no test user {x_test_user}"
        return user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    created: list[TestClient] = []

    def _factory(user_id: int, email: str | None = None) -> TestClient:
        _make_user(db, user_id, email or f"user{user_id}@example.com")
        client = TestClient(app, headers={"X-Test-User": str(user_id)})
        created.append(client)
        return client

    yield _factory

    for client in created:
        client.close()
    app.dependency_overrides.clear()


@pytest.fixture
def user_client(auth_client):
    """The shared conftest client, acting as user id 1."""
    return auth_client


class TestAuth:
    def test_get_requires_token(self, client):
        assert client.get(URL).status_code == 401

    def test_put_requires_token(self, client):
        assert client.put(URL, json={"config": DEFAULTS}).status_code == 401

    def test_delete_requires_token(self, client):
        assert client.delete(URL).status_code == 401


class TestGet:
    def test_unsaved_scope_returns_defaults(self, user_client, db):
        response = user_client.get(URL)
        assert response.status_code == 200
        body = response.json()
        assert body["scope"] == SCOPE
        assert body["version"] == 1
        assert body["saved"] is False
        assert body["updated_at"] is None
        assert body["config"] == DEFAULTS
        assert "warning" not in body
        assert db.query(UserSavedConfig).count() == 0

    def test_unknown_scope_is_404(self, user_client, db):
        for method in ("get", "put", "delete"):
            kwargs = {"json": {"config": DEFAULTS}} if method == "put" else {}
            response = getattr(user_client, method)("/api/user-configs/nope.nope", **kwargs)
            assert response.status_code == 404, method
            assert response.json()["detail"] == "unknown_scope"
        assert db.query(UserSavedConfig).count() == 0


class TestRoundTrip:
    def test_put_then_get_returns_same_payload(self, user_client):
        put = user_client.put(URL, json={"config": SAMPLE, "version": 1})
        assert put.status_code == 200
        body = put.json()
        assert body["saved"] is True
        assert body["config"] == SAMPLE
        assert body["updated_at"]

        got = user_client.get(URL)
        assert got.status_code == 200
        assert got.json()["saved"] is True
        assert got.json()["config"] == SAMPLE
        assert got.json()["updated_at"] == body["updated_at"]

    def test_put_twice_upserts_one_row(self, user_client, db):
        assert user_client.put(URL, json={"config": SAMPLE}).status_code == 200
        changed = _with(sort="rsi_desc")
        assert user_client.put(URL, json={"config": changed}).status_code == 200

        rows = db.query(UserSavedConfig).all()
        assert len(rows) == 1
        assert rows[0].name == ""
        assert rows[0].config["sort"] == "rsi_desc"

    def test_dedupe_cap_tiers_and_sectors(self, user_client, db):
        payload = _with(capTiers=["large", "large"], sectors=["IT", "IT"])
        assert user_client.put(URL, json={"config": payload}).status_code == 200

        stored = db.query(UserSavedConfig).one().config
        assert stored["capTiers"] == ["large"]
        assert stored["sectors"] == ["IT"]

    def test_version_omitted_is_accepted(self, user_client):
        response = user_client.put(URL, json={"config": SAMPLE})
        assert response.status_code == 200
        assert response.json()["version"] == 1

    def test_search_is_never_stored(self, user_client, db):
        # `search` is not in the schema, so an adapter that tries to persist it
        # gets a 422 rather than a silently stored lookup string.
        response = user_client.put(URL, json={"config": _with(search="REL")})
        assert response.status_code == 422
        assert response.json()["detail"] == "unknown_key"
        assert db.query(UserSavedConfig).count() == 0


class TestValidation:
    @pytest.mark.parametrize(
        "config",
        [
            _with(sort="nope_desc"),
            _with(capTiers=["huge"]),
            _with(rsiMin=500),
            _with(rsiMax=-1),
            {**DEFAULTS, "universe": "nasdaq"},
            {**DEFAULTS, "view": "grid"},
            _with(priceMin=900, priceMax=100),
            _with(sectors=["x" * 65]),
            _with(sectors=["s%d" % i for i in range(201)]),
            {**DEFAULTS, "sort": {"not": "a string"}},
        ],
    )
    def test_out_of_range_or_unknown_values_are_422(self, user_client, db, config):
        response = user_client.put(URL, json={"config": config})
        assert response.status_code == 422
        assert response.json()["detail"] == "invalid_config"
        assert db.query(UserSavedConfig).count() == 0

    @pytest.mark.parametrize("key", ["nope", "search", "filters_bad"])
    def test_unknown_top_level_key_is_422(self, user_client, db, key):
        response = user_client.put(URL, json={"config": {**DEFAULTS, key: "x"}})
        assert response.status_code == 422
        assert response.json()["detail"] == "unknown_key"
        assert key in response.json()["keys"]
        assert db.query(UserSavedConfig).count() == 0

    def test_unknown_key_inside_a_nested_filters_object_is_422(self, user_client, db):
        """A nested writer is tolerated, but only its *known* keys: the strict
        write rule applies at both nesting levels."""
        nested = {k: v for k, v in SAMPLE.items() if k not in ("universe", "view")}
        response = user_client.put(
            URL,
            json={"config": {"universe": "nifty500", "filters": {**nested, "notAField": 1}}},
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "unknown_key"
        assert response.json()["keys"] == ["notAField"]
        assert db.query(UserSavedConfig).count() == 0

    def test_nested_payload_is_stored_flat(self, user_client, db):
        nested = {k: v for k, v in SAMPLE.items() if k not in ("universe", "view")}
        response = user_client.put(
            URL,
            json={"config": {"universe": "nifty500", "view": "map", "filters": nested}},
        )
        assert response.status_code == 200
        assert "filters" not in response.json()["config"]
        assert response.json()["config"] == SAMPLE
        db.expire_all()
        stored = db.query(UserSavedConfig).one().config
        assert "filters" not in stored
        assert stored["universe"] == "nifty500"
        assert stored["sort"] == SAMPLE["sort"]

    def test_version_mismatch_is_422(self, user_client, db):
        response = user_client.put(URL, json={"config": DEFAULTS, "version": 2})
        assert response.status_code == 422
        body = response.json()
        assert body["detail"] == "version_mismatch"
        assert body["expected"] == 1
        assert body["got"] == 2
        assert db.query(UserSavedConfig).count() == 0

    def test_oversized_payload_is_422(self, user_client, db):
        # Valid per-field (200 sectors, 64 chars each) but 4-byte code points push
        # the encoded payload past 16 KiB: the gate must fire on raw byte size.
        payload = _with(sectors=["\U0001f525" * 64] * 200)
        response = user_client.put(URL, json={"config": payload})
        assert response.status_code == 422
        body = response.json()
        assert body["detail"] == "config_too_large"
        assert body["max_bytes"] == 16384
        assert db.query(UserSavedConfig).count() == 0


class TestHostileStoredRow:
    def test_invalid_stored_payload_falls_back_to_defaults(self, user_client, db):
        db.add(
            UserSavedConfig(
                user_id=1,
                scope=SCOPE,
                name="",
                config={"universe": "nope", "rsiMin": "abc"},
                version=1,
            )
        )
        db.commit()

        response = user_client.get(URL)
        assert response.status_code == 200
        body = response.json()
        assert body["saved"] is False
        assert body["warning"] == "invalid_saved_config"
        assert body["config"] == DEFAULTS
        # The row is the server's data: kept for a build that can still read it.
        assert db.query(UserSavedConfig).count() == 1

    def test_version_mismatched_row_falls_back_to_defaults(self, user_client, db):
        db.add(UserSavedConfig(user_id=1, scope=SCOPE, name="", config=SAMPLE, version=99))
        db.commit()

        body = user_client.get(URL).json()
        assert body["saved"] is False
        assert body["warning"] == "invalid_saved_config"
        assert body["config"] == DEFAULTS
        assert db.query(UserSavedConfig).count() == 1

    def test_non_object_stored_payload_falls_back_to_defaults(self, user_client, db):
        db.add(
            UserSavedConfig(
                user_id=1,
                scope=SCOPE,
                name="",
                config=["not", "an", "object"],
                version=1,
            )
        )
        db.commit()

        response = user_client.get(URL)
        assert response.status_code == 200
        body = response.json()
        assert body["saved"] is False
        assert body["warning"] == "invalid_saved_config"
        assert body["config"] == DEFAULTS

    def test_put_repairs_an_unreadable_row(self, user_client, db):
        db.add(
            UserSavedConfig(
                user_id=1,
                scope=SCOPE,
                name="",
                config={"universe": "nope"},
                version=99,
            )
        )
        db.commit()
        assert user_client.get(URL).json()["saved"] is False

        assert user_client.put(URL, json={"config": SAMPLE}).status_code == 200
        db.expire_all()
        row = db.query(UserSavedConfig).one()
        assert row.version == 1
        assert row.config == SAMPLE
        assert user_client.get(URL).json()["saved"] is True

    def test_unknown_stored_key_is_dropped_not_fatal(self, user_client, db):
        db.add(
            UserSavedConfig(
                user_id=1,
                scope=SCOPE,
                name="",
                config={**SAMPLE, "foo": 1},
                version=1,
            )
        )
        db.commit()

        body = user_client.get(URL).json()
        assert body["saved"] is True
        assert "foo" not in body["config"]
        assert body["config"]["sort"] == SAMPLE["sort"]

    def test_unknown_stored_filter_key_is_dropped(self, user_client, db):
        db.add(
            UserSavedConfig(
                user_id=1,
                scope=SCOPE,
                name="",
                config={**SAMPLE, "foo": 1, "search": "REL"},
                version=1,
            )
        )
        db.commit()

        body = user_client.get(URL).json()
        assert body["saved"] is True
        assert "foo" not in body["config"]
        assert "search" not in body["config"]
        assert body["config"]["sort"] == SAMPLE["sort"]

    def test_legacy_nested_payload_is_flattened_on_read(self, user_client, db):
        """The plan sketch nested the filter fields; a row written that way must
        still restore, with the top-level ``universe`` authoritative."""
        nested = {k: v for k, v in SAMPLE.items() if k not in ("universe", "view")}
        db.add(
            UserSavedConfig(
                user_id=1,
                scope=SCOPE,
                name="",
                config={
                    "universe": "nifty500",
                    "view": "map",
                    "filters": {**nested, "universe": "nifty50"},
                },
                version=1,
            )
        )
        db.commit()

        body = user_client.get(URL).json()
        assert body["saved"] is True
        assert body["config"] == SAMPLE
        assert body["config"]["universe"] == "nifty500"
        assert "filters" not in body["config"]

    def test_unknown_stored_tier_is_filtered_itemwise(self, user_client, db):
        db.add(
            UserSavedConfig(
                user_id=1,
                scope=SCOPE,
                name="",
                config=_with(capTiers=["mid", "gigantic"]),
                version=1,
            )
        )
        db.commit()

        body = user_client.get(URL).json()
        # One bogus tier must not cost the user the valid ones or the rest of
        # the filters.
        assert body["saved"] is True
        assert body["config"]["capTiers"] == ["mid"]
        assert body["config"]["sort"] == "mcap_desc"


class TestDelete:
    def test_delete_then_get_restores_defaults(self, user_client, db):
        user_client.put(URL, json={"config": SAMPLE})

        deleted = user_client.delete(URL)
        assert deleted.status_code == 200
        assert deleted.json() == {"scope": SCOPE, "deleted": True}
        assert db.query(UserSavedConfig).count() == 0

        body = user_client.get(URL).json()
        assert body["saved"] is False
        assert body["config"] == DEFAULTS

    def test_second_delete_reports_false(self, user_client):
        user_client.put(URL, json={"config": SAMPLE})
        assert user_client.delete(URL).json()["deleted"] is True

        second = user_client.delete(URL)
        assert second.status_code == 200
        assert second.json() == {"scope": SCOPE, "deleted": False}

    def test_delete_without_row_reports_false(self, user_client):
        response = user_client.delete(URL)
        assert response.status_code == 200
        assert response.json()["deleted"] is False


class TestIfMatch:
    def test_matching_if_match_writes(self, user_client):
        first = user_client.put(URL, json={"config": SAMPLE})
        revision = first.json()["updated_at"]

        second = user_client.put(
            URL,
            json={"config": _with(sort="rsi_desc")},
            headers={"If-Match": revision},
        )
        assert second.status_code == 200
        assert second.json()["config"]["sort"] == "rsi_desc"

    def test_quoted_if_match_writes(self, user_client):
        revision = user_client.put(URL, json={"config": SAMPLE}).json()["updated_at"]

        response = user_client.put(
            URL,
            json={"config": SAMPLE},
            headers={"If-Match": f'"{revision}"'},
        )
        assert response.status_code == 200

    def test_stale_if_match_conflicts_with_current_envelope(self, user_client):
        user_client.put(URL, json={"config": SAMPLE})

        response = user_client.put(
            URL,
            json={"config": _with(sort="day_desc")},
            headers={"If-Match": "2000-01-01T00:00:00+00:00"},
        )
        assert response.status_code == 409
        body = response.json()
        assert body["detail"] == "conflict"
        assert body["current"]["config"] == SAMPLE
        assert body["current"]["saved"] is True

    def test_if_match_on_unsaved_scope_conflicts(self, user_client, db):
        response = user_client.put(
            URL,
            json={"config": SAMPLE},
            headers={"If-Match": "2000-01-01T00:00:00+00:00"},
        )
        assert response.status_code == 409
        assert response.json()["current"]["saved"] is False
        assert db.query(UserSavedConfig).count() == 0

    def test_absent_if_match_writes_unconditionally(self, user_client):
        user_client.put(URL, json={"config": SAMPLE})
        changed = _with(sort="day_asc")
        response = user_client.put(URL, json={"config": changed})
        assert response.status_code == 200
        assert response.json()["config"]["sort"] == "day_asc"


class TestConcurrentFirstSave:
    def test_duplicate_insert_adopts_the_existing_row(self, user_client, db, monkeypatch):
        """Two tabs can both see "no row" and both insert; the loser must not 500.

        Simulated by hiding the row from the pre-insert lookup only, which makes
        the flush hit the real ``uq_user_saved_config`` constraint.
        """
        import api.user_configs as uc

        assert user_client.put(URL, json={"config": SAMPLE}).status_code == 200
        db.expire_all()

        real_get_row = uc._get_row
        calls = {"n": 0}

        def hide_first_lookup(session, user_id, scope):
            calls["n"] += 1
            if calls["n"] == 1:
                return None
            return real_get_row(session, user_id, scope)

        monkeypatch.setattr(uc, "_get_row", hide_first_lookup)

        changed = _with(sort="day_asc")
        response = user_client.put(URL, json={"config": changed})

        assert response.status_code == 200
        assert response.json()["saved"] is True
        db.expire_all()
        rows = db.query(UserSavedConfig).all()
        assert len(rows) == 1
        assert rows[0].config["sort"] == "day_asc"


class TestUserIsolation:
    def test_other_user_neither_reads_nor_alters_the_row(self, as_user):
        owner = as_user(1)
        other = as_user(2)
        assert owner.put(URL, json={"config": SAMPLE}).status_code == 200

        seen = other.get(URL)
        assert seen.status_code == 200
        assert seen.json()["saved"] is False
        assert seen.json()["config"] == DEFAULTS

        other_payload = _with(sort="symbol_asc")
        assert other.put(URL, json={"config": other_payload}).status_code == 200
        assert owner.get(URL).json()["config"] == SAMPLE

        assert other.delete(URL).json()["deleted"] is True
        assert owner.get(URL).json()["saved"] is True
        assert owner.get(URL).json()["config"] == SAMPLE

    def test_second_user_gets_a_second_row(self, as_user, db):
        owner = as_user(1)
        other = as_user(2)
        owner.put(URL, json={"config": SAMPLE})
        other.put(URL, json={"config": DEFAULTS})

        rows = db.query(UserSavedConfig).filter(UserSavedConfig.scope == SCOPE).all()
        assert len(rows) == 2
        assert {row.user_id for row in rows} == {1, 2}
        assert all(row.name == "" for row in rows)


class TestDynamicTableScopes:
    """``table.<id>`` scopes share TablePrefsV1 but are keyed per table."""

    DEFAULTS = {"sorting": [], "order": [], "hidden": []}
    APPROACHING_URL = "/api/user-configs/table.screener.52w_high.approaching"
    SAMPLE = {
        "sorting": [{"id": "to_52w_high", "desc": False}],
        "order": [],
        "hidden": [],
    }

    def test_unknown_scope_foo_bar_is_404(self, user_client, db):
        for method in ("get", "put", "delete"):
            kwargs = {"json": {"config": self.DEFAULTS}} if method == "put" else {}
            response = getattr(user_client, method)("/api/user-configs/foo.bar", **kwargs)
            assert response.status_code == 404, method
            assert response.json()["detail"] == "unknown_scope"
        assert db.query(UserSavedConfig).count() == 0

    @pytest.mark.parametrize(
        "scope",
        [
            "table.",
            "table.-bad",
            "TABLE.market",
            "table.market!",
            "table." + "a" * 81,
        ],
    )
    def test_malformed_table_scope_is_404(self, user_client, scope):
        response = user_client.get(f"/api/user-configs/{scope}")
        assert response.status_code == 404
        assert response.json()["detail"] == "unknown_scope"

    def test_scope_at_64_chars_is_accepted(self, user_client, db):
        # "table." (6) + one leading id char + 57 tail chars = 64, the width of
        # user_saved_configs.scope (VARCHAR(64)).
        scope = "table." + "a" * 58
        assert len(scope) == 64
        response = user_client.get(f"/api/user-configs/{scope}")
        assert response.status_code == 200
        assert response.json()["scope"] == scope
        assert response.json()["saved"] is False
        assert response.json()["config"] == self.DEFAULTS

        put = user_client.put(f"/api/user-configs/{scope}", json={"config": self.SAMPLE})
        assert put.status_code == 200
        assert put.json()["saved"] is True

    def test_scope_at_65_chars_is_unknown(self, user_client, db):
        # One char past VARCHAR(64) must be rejected before any DB access, so a
        # Postgres backend cannot truncate or reject the value on insert.
        scope = "table." + "a" * 59
        assert len(scope) == 65
        for method in ("get", "put", "delete"):
            kwargs = {"json": {"config": self.DEFAULTS}} if method == "put" else {}
            response = getattr(user_client, method)(f"/api/user-configs/{scope}", **kwargs)
            assert response.status_code == 404, method
            assert response.json()["detail"] == "unknown_scope"
        assert db.query(UserSavedConfig).count() == 0

    def test_longest_current_scope_round_trips(self, user_client):
        # table.screener.52w_high.approaching is the longest scope in use (35).
        scope = "/api/user-configs/table.screener.52w_high.approaching"
        assert user_client.put(scope, json={"config": self.SAMPLE}).status_code == 200
        assert user_client.get(scope).json()["config"] == self.SAMPLE

    def test_unsaved_table_scope_returns_defaults(self, user_client, db):
        response = user_client.get("/api/user-configs/table.market.grid")
        assert response.status_code == 200
        body = response.json()
        assert body["scope"] == "table.market.grid"
        assert body["version"] == 1
        assert body["saved"] is False
        assert body["updated_at"] is None
        assert body["config"] == self.DEFAULTS
        assert "warning" not in body
        assert db.query(UserSavedConfig).count() == 0

    def test_put_then_get_round_trip(self, user_client):
        put = user_client.put(self.APPROACHING_URL, json={"config": self.SAMPLE, "version": 1})
        assert put.status_code == 200
        body = put.json()
        assert body["saved"] is True
        assert body["config"] == self.SAMPLE
        assert body["updated_at"]

        got = user_client.get(self.APPROACHING_URL)
        assert got.status_code == 200
        assert got.json()["saved"] is True
        assert got.json()["config"] == self.SAMPLE
        assert got.json()["updated_at"] == body["updated_at"]

    @pytest.mark.parametrize(
        "config",
        [
            {"sorting": [{"id": 123, "desc": False}], "order": [], "hidden": []},
            {
                "sorting": [{"id": f"c{i}", "desc": False} for i in range(11)],
                "order": [],
                "hidden": [],
            },
            {"sorting": [], "order": [], "hidden": [], "bogus": 1},
        ],
    )
    def test_invalid_payload_is_422(self, user_client, db, config):
        response = user_client.put(self.APPROACHING_URL, json={"config": config})
        assert response.status_code == 422
        assert db.query(UserSavedConfig).count() == 0

    @pytest.mark.parametrize(
        "config",
        [
            {"sorting": [], "order": [f"c{i}" for i in range(201)], "hidden": []},
            {"sorting": [], "order": [], "hidden": ["x" * 65]},
            {"sorting": [{"id": "", "desc": False}], "order": [], "hidden": []},
        ],
    )
    def test_list_and_string_bounds_are_422(self, user_client, config):
        response = user_client.put(self.APPROACHING_URL, json={"config": config})
        assert response.status_code == 422
        assert response.json()["detail"] == "invalid_config"

    def test_oversize_payload_is_422(self, user_client, db):
        long_ids = ["x" * 64 for _ in range(200)]
        config = {"sorting": [], "order": long_ids, "hidden": long_ids}
        response = user_client.put("/api/user-configs/table.backtest.trades", json={"config": config})
        assert response.status_code == 422
        assert response.json()["detail"] == "config_too_large"
        assert db.query(UserSavedConfig).count() == 0

    def test_scopes_are_isolated(self, user_client, db):
        trades_url = "/api/user-configs/table.backtest.trades"
        positions_url = "/api/user-configs/table.paper.positions"
        trades = {"sorting": [{"id": "pnl", "desc": True}], "order": [], "hidden": []}
        positions = {"sorting": [{"id": "entry_time", "desc": False}], "order": [], "hidden": []}

        assert user_client.put(trades_url, json={"config": trades}).status_code == 200
        assert user_client.put(positions_url, json={"config": positions}).status_code == 200

        assert user_client.get(trades_url).json()["config"] == trades
        assert user_client.get(positions_url).json()["config"] == positions

        rows = db.query(UserSavedConfig).all()
        assert len(rows) == 2
        assert {row.scope for row in rows} == {
            "table.backtest.trades",
            "table.paper.positions",
        }

    def test_unreadable_table_row_falls_back_to_defaults(self, user_client, db):
        db.add(
            UserSavedConfig(
                user_id=1,
                scope="table.market.grid",
                name="",
                config={"sorting": [{"id": 123}], "order": [], "hidden": []},
                version=1,
            )
        )
        db.commit()

        body = user_client.get("/api/user-configs/table.market.grid").json()
        assert body["saved"] is False
        assert body["warning"] == "invalid_saved_config"
        assert body["config"] == self.DEFAULTS
        assert db.query(UserSavedConfig).count() == 1
