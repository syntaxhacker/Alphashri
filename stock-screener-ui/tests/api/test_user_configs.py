"""Contract tests for ``/api/user-configs/{scope}`` (saved user configs, P1).

The behavioural rules under test, in the order they bite:

* an unreadable stored payload must degrade to defaults with a ``warning`` —
  never a 5xx and never a deleted row;
* writes are strict (unknown keys 422, at both nesting levels) while reads are
  tolerant (unknown keys dropped);
* ``DELETE`` is idempotent because the desired end state is "no row";
* ``If-Match`` is advisory — enforced only when the client sends it.
"""

import re
import sys
from datetime import timedelta
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

# These fixtures normally arrive from tests/api/conftest.py. Re-export them as
# module-local fixtures so resolution never depends on whether that conftest was
# attached during collection: a root-level test collected first can otherwise
# leave this module without db/auth_client (and with the root `client`, whose
# bare app has no user-configs route -> 404 instead of the expected 401).
from tests.api.conftest import auth_client, client, db, test_engine  # noqa: E402,F401

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
    "gapMin": None,
    "gapMax": None,
    "rangeVsAtrMin": None,
    "to52wHighMin": None,
    "to52wHighMax": None,
    "from52wLowMin": None,
    "from52wLowMax": None,
    "volumeMin": None,
    "valueTradedMin": None,
    "pePctMax": None,
    "roePctMin": None,
    "dePctMax": None,
    "peMax": None,
    "psMax": None,
    "pbMax": None,
    "roeMin": None,
    "divYieldMin": None,
    "fcfYieldMin": None,
    "debtToEquityMax": None,
    "revYoyMin": None,
    "epsYoyMin": None,
    "aboveSma20": False,
    "aboveSma50": False,
    "aboveSma200": False,
    "fnoOnly": False,
    "etfOnly": False,
    "sectors": [],
    "sort": "mcap_desc",
    "view": "table",
    "colorBy": "change_pct",
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
    "gapMin": 1.0,
    "gapMax": 15.0,
    "rangeVsAtrMin": 2.0,
    "to52wHighMin": -5.0,
    "to52wHighMax": 0.0,
    "from52wLowMin": 20.0,
    "from52wLowMax": 100.0,
    "volumeMin": 500_000.0,
    "valueTradedMin": 10_000_000.0,
    "pePctMax": 0.35,
    "roePctMin": 0.45,
    "dePctMax": 0.3,
    "peMax": 25.0,
    "psMax": 4.0,
    "pbMax": 5.0,
    "roeMin": 12.0,
    "divYieldMin": 0.5,
    "fcfYieldMin": 1.5,
    "debtToEquityMax": 1.8,
    "revYoyMin": 5.0,
    "epsYoyMin": 8.0,
    "aboveSma20": True,
    "aboveSma50": True,
    "aboveSma200": False,
    "fnoOnly": True,
    "etfOnly": False,
    "sectors": ["IT", "Banking"],
    "sort": "relvol_desc",
    "view": "map",
    "colorBy": "rsi",
}


def _with(**overrides) -> dict:
    """A full valid payload with selected fields overridden."""
    return {**DEFAULTS, **overrides}


# The five values shipped before the "Size by" dropdown grew to twelve. A saved
# payload carrying any of these must keep parsing after the Literal is widened.
ORIGINAL_COLOR_BY_VALUES = ("change_pct", "relative_volume", "rsi", "pos_52w", "market_cap")
# The seven fundamental/trend metrics the frontend added to the dropdown.
NEW_COLOR_BY_VALUES = (
    "adx",
    "perf_w",
    "perf_1m",
    "pe_ratio",
    "pb_ratio",
    "roe",
    "dividend_yield",
)

_MARKET_SIZE_VALUES_RE = re.compile(
    r"MARKET_SIZE_METRIC_VALUES\s*=\s*\[(?P<body>.*?)\]\s*as\s+const", re.DOTALL
)
_QUOTED_STRING_RE = re.compile(r"""["']([^"']+)["']""")


def _frontend_market_size_metric_values() -> list[str]:
    """Read the frontend's canonical "Size by" allowlist straight from its source.

    There is no generated JSON shared between the two layers, so parsing the TS
    declaration is the only way to make the backend Literal provably track the
    dropdown: a value added or removed on either side fails the parity test.
    """
    ts_path = ROOT / "src" / "components" / "market" / "marketTreemap.ts"
    match = _MARKET_SIZE_VALUES_RE.search(ts_path.read_text())
    assert match is not None, f"MARKET_SIZE_METRIC_VALUES not found in {ts_path}"
    values = _QUOTED_STRING_RE.findall(match.group("body"))
    assert values, f"no metric values parsed from {ts_path}"
    return values


# ``MARKET_VIEW_OPTIONS`` is an array of ``{ value, label }`` objects. Capture
# only the ``value`` of each entry so the parity test reads the ids the frontend
# actually writes, not the display labels.
_MARKET_VIEW_OPTIONS_RE = re.compile(
    r"MARKET_VIEW_OPTIONS\s*=\s*\[(?P<body>.*?)\]\s*as\s+const", re.DOTALL
)
_VIEW_VALUE_RE = re.compile(r"""value\s*:\s*["']([^"']+)["']""")


def _frontend_market_view_ids() -> list[str]:
    """Read the canonical view ids from the frontend registry's TS declaration.

    The backend must accept every id the frontend can write. Parsing the source
    (instead of hardcoding a second list in this test) is what makes an added
    frontend view fail the parity check until the backend Literal is widened.
    """
    ts_path = ROOT / "src" / "components" / "market" / "MarketMapView.tsx"
    match = _MARKET_VIEW_OPTIONS_RE.search(ts_path.read_text())
    assert match is not None, f"MARKET_VIEW_OPTIONS not found in {ts_path}"
    values = _VIEW_VALUE_RE.findall(match.group("body"))
    assert values, f"no view ids parsed from {ts_path}"
    return values


#: ``serializeMarketConfig`` returns ``{ key: value }`` entries; each key is the
#: wire name the backend must accept on PUT.
_SERIALIZE_MARKET_RE = re.compile(
    r"export function serializeMarketConfig\b.*?\n  return \{(?P<body>.*?)\n  \};",
    re.DOTALL,
)
_SERIALIZED_KEY_RE = re.compile(r"^\s{4}(?:\w+):\s", re.MULTILINE)
_MARKET_SORT_OPTIONS_RE = re.compile(
    r"MARKET_SORT_OPTIONS\s*(?::[^=]+)?=\s*\[(?P<body>.*?)\]\s*;", re.DOTALL
)
_NUMERIC_LIMITS_RE = re.compile(
    r"const NUMERIC_LIMITS: [^=]+=\s*\{(?P<body>.*?)\n\};", re.DOTALL
)


def _frontend_market_filter_keys() -> list[str]:
    """Read the Market config keys straight from the frontend serializer.

    There is no generated contract between the two layers, so parsing the TS is
    the only way to make the backend model provably track what the UI writes.
    Every one of the mover/Deep Value filters was missing from the Pydantic
    model while present here, and each save 422'd as `unknown_key`.
    """
    ts_path = ROOT / "src" / "components" / "market" / "useMarketConfig.ts"
    match = _SERIALIZE_MARKET_RE.search(ts_path.read_text())
    assert match is not None, f"serializeMarketConfig not found in {ts_path}"
    body = match.group("body")
    keys = [line.strip().split(":")[0] for line in body.splitlines() if _SERIALIZED_KEY_RE.match(line)]
    return [k for k in keys if k]


def _frontend_numeric_filter_keys() -> list[str]:
    """Every `number | null` filter declared in the frontend's limits table.

    `NUMERIC_LIMITS` is the authoritative list of writable numeric filters, and
    `parseMarketConfig` reads all of them back. A filter can therefore be
    perfectly functional — gate rows and render a chip — and still never persist
    if the serializer omits it. Nine absolute value gates were in exactly that
    state: they filtered and showed chips, then silently vanished on reload.
    """
    ts_path = ROOT / "src" / "components" / "market" / "useMarketConfig.ts"
    match = _NUMERIC_LIMITS_RE.search(ts_path.read_text())
    assert match is not None, f"NUMERIC_LIMITS not found in {ts_path}"
    return [line.strip().split(":")[0] for line in match.group("body").splitlines() if ":" in line and "[" in line]


def _frontend_market_sort_keys() -> list[str]:
    """Read the persisted sort ids from the frontend ``MARKET_SORT_OPTIONS``.

    ``sort`` is written into the saved config, so the backend Literal must accept
    every id the dropdown can produce. It did not: all seven mover sorts were
    missing, and applying a mover preset 422'd as `invalid_config` on `sort`.
    """
    ts_path = ROOT / "src" / "components" / "market" / "marketFilters.ts"
    match = _MARKET_SORT_OPTIONS_RE.search(ts_path.read_text())
    assert match is not None, f"MARKET_SORT_OPTIONS not found in {ts_path}"
    values = _VIEW_VALUE_RE.findall(match.group("body"))
    assert values, f"no sort ids parsed from {ts_path}"
    return values


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

    def test_unknown_scope_still_requires_a_token(self, client):
        # Auth is a dependency too, and it is listed first: an unauthenticated
        # caller must not learn which scopes exist from a 404-vs-401 difference.
        for method in ("get", "delete"):
            assert getattr(client, method)("/api/user-configs/nope.nope").status_code == 401
        assert client.put("/api/user-configs/nope.nope").status_code == 401
        assert client.put("/api/user-configs/nope.nope", json={"config": DEFAULTS}).status_code == 401


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

    @pytest.mark.parametrize("metric", ["change_pct", "relative_volume", "rsi", "pos_52w", "market_cap"])
    def test_map_color_by_round_trips_through_put_get(self, user_client, db, metric):
        payload = SAMPLE | {"colorBy": metric}
        put = user_client.put(URL, json={"config": payload, "version": 1})
        assert put.status_code == 200
        assert put.json()["config"]["colorBy"] == metric
        assert user_client.get(URL).json()["config"]["colorBy"] == metric
        db.expire_all()
        assert db.query(UserSavedConfig).one().config["colorBy"] == metric

    def test_value_view_round_trips_through_put_get(self, user_client, db):
        # The Market Value view saves `view: "value"`; the write path must accept
        # it and the read path must return it unchanged (it used to 422).
        payload = SAMPLE | {"view": "value"}
        put = user_client.put(URL, json={"config": payload, "version": 1})
        assert put.status_code == 200
        assert put.json()["config"]["view"] == "value"

        got = user_client.get(URL)
        assert got.status_code == 200
        assert got.json()["saved"] is True
        assert got.json()["config"] == payload
        db.expire_all()
        assert db.query(UserSavedConfig).one().config["view"] == "value"


class TestMarketViewValues:
    """The ``view`` field: the renamed Vis id plus the legacy and canonical ids.

    The frontend renamed ``map`` to ``vis``. The whole ``market.filters`` payload
    must still save when the Vis tab is active — a stale backend Literal used to
    reject the lot with ``invalid_config``/``literal_error``, discarding the
    user's filters, sort and colour metric along with the view.
    """

    def test_vis_view_full_payload_saves(self, user_client, db):
        # Exact 422 reproduction: a full payload written while the Vis tab is
        # active. On the stale Literal this returns 422, not 200.
        payload = SAMPLE | {"view": "vis"}
        put = user_client.put(URL, json={"config": payload, "version": 1})
        assert put.status_code == 200, put.text
        assert put.json()["config"]["view"] == "vis"
        assert user_client.get(URL).json()["config"] == payload
        db.expire_all()
        assert db.query(UserSavedConfig).one().config["view"] == "vis"

    def test_legacy_map_view_still_saves(self, user_client):
        # A saved row / legacy ``?view=map`` link still carries the old id; the
        # backend must keep accepting it even though the frontend writes ``vis``.
        payload = SAMPLE | {"view": "map"}
        put = user_client.put(URL, json={"config": payload, "version": 1})
        assert put.status_code == 200, put.text
        assert put.json()["config"]["view"] == "map"

    @pytest.mark.parametrize("view", ["table", "movers", "value"])
    def test_canonical_views_still_save(self, user_client, view):
        payload = SAMPLE | {"view": view}
        put = user_client.put(URL, json={"config": payload, "version": 1})
        assert put.status_code == 200, put.text
        assert put.json()["config"]["view"] == view

    def test_unknown_view_is_still_rejected(self, user_client, db):
        response = user_client.put(URL, json={"config": _with(view="not_a_view")})
        assert response.status_code == 422
        assert response.json()["detail"] == "invalid_config"
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

    @pytest.mark.parametrize("view", ["grid", "values", "Value", ""])
    def test_unknown_view_is_still_422(self, user_client, db, view):
        # Adding "value" must not open the gate to arbitrary strings.
        response = user_client.put(URL, json={"config": _with(view=view)})
        assert response.status_code == 422
        assert response.json()["detail"] == "invalid_config"
        assert db.query(UserSavedConfig).count() == 0

    @pytest.mark.parametrize("metric", ["day_change", "PE", "", None, 1])
    def test_unknown_color_by_is_422(self, user_client, db, metric):
        response = user_client.put(URL, json={"config": _with(colorBy=metric)})
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


class TestColorByMetrics:
    """The 12-value "Size by" allowlist and its backward-compatibility contract."""

    @pytest.mark.parametrize("metric", NEW_COLOR_BY_VALUES)
    def test_new_color_by_value_round_trips_through_put_get(self, user_client, db, metric):
        # These seven used to 422 on save; each must now persist and restore.
        payload = SAMPLE | {"colorBy": metric}
        put = user_client.put(URL, json={"config": payload, "version": 1})
        assert put.status_code == 200, put.text
        assert put.json()["config"]["colorBy"] == metric

        got = user_client.get(URL)
        assert got.status_code == 200
        assert got.json()["config"]["colorBy"] == metric
        db.expire_all()
        assert db.query(UserSavedConfig).one().config["colorBy"] == metric

    @pytest.mark.parametrize("metric", ORIGINAL_COLOR_BY_VALUES)
    def test_legacy_saved_color_by_still_parses(self, user_client, db, metric):
        # A row written before the widening must still read as saved, not fall
        # back to defaults with a warning.
        db.add(
            UserSavedConfig(
                user_id=1, scope=SCOPE, name="", config=_with(colorBy=metric), version=1
            )
        )
        db.commit()

        body = user_client.get(URL).json()
        assert body["saved"] is True, body
        assert "warning" not in body
        assert body["config"]["colorBy"] == metric

    @pytest.mark.parametrize("metric", ["adx_uppercase", "day_change", "PE", ""])
    def test_unknown_stored_color_by_falls_back_to_defaults(self, user_client, db, metric):
        # Reads reject the unknown value too: the whole payload degrades to
        # defaults with a warning, exactly as it did before the widening.
        db.add(
            UserSavedConfig(
                user_id=1, scope=SCOPE, name="", config=_with(colorBy=metric), version=1
            )
        )
        db.commit()

        body = user_client.get(URL).json()
        assert body["saved"] is False, body
        assert body["warning"] == "invalid_saved_config"
        assert body["config"] == DEFAULTS


class TestUniverseRegistryDerivation:
    """Universe and cap-tier ids come from the market-screen registry, not copies."""

    def test_us_round_trips_with_all_filters(self, user_client, db):
        from api.market_screen.config import ALLOWED_UNIVERSES

        assert "us" in ALLOWED_UNIVERSES
        payload = _with(
            universe="us",
            capTiers=["large", "small"],
            sectors=["Technology", "Healthcare"],
            priceMin=25.0,
            priceMax=800.0,
            dayChangeMin=-5.0,
            dayChangeMax=12.0,
            mcapMinCr=500.0,
            mcapMaxCr=90000.0,
            rsiMin=30.0,
            rsiMax=70.0,
            relVolMin=1.2,
            relVolMax=8.0,
            aboveSma200=True,
            sort="day_desc",
            view="movers",
        )
        put = user_client.put(URL, json={"config": payload, "version": 1})
        assert put.status_code == 200
        assert put.json()["config"] == payload
        got = user_client.get(URL)
        assert got.status_code == 200
        assert got.json()["saved"] is True
        assert got.json()["config"] == payload
        db.expire_all()
        assert db.query(UserSavedConfig).one().config == payload

    def test_unknown_universe_is_rejected(self, user_client, db):
        response = user_client.put(URL, json={"config": _with(universe="nasdaq")})
        assert response.status_code == 422
        assert response.json()["detail"] == "invalid_config"
        assert db.query(UserSavedConfig).count() == 0

    def test_four_legacy_india_universes_unchanged(self, user_client):
        for universe in ("all_equity", "nifty500", "nifty50", "nse_fo"):
            payload = _with(universe=universe)
            assert user_client.put(URL, json={"config": payload}).status_code == 200
            assert user_client.get(URL).json()["config"] == payload

    @pytest.mark.parametrize("universe", ["banknifty", "sensex"])
    def test_new_index_universes_do_not_422(self, user_client, universe):
        response = user_client.put(URL, json={"config": _with(universe=universe)})
        assert response.status_code == 200, response.json()
        assert response.json()["config"]["universe"] == universe

    def test_cap_tiers_derive_from_registry(self, user_client):
        import api.user_configs as uc
        from api.market_screen.config import ALL_CAP_TIERS, RANK_TIERS

        assert uc.CAP_TIERS == frozenset(ALL_CAP_TIERS)
        # Guard against shrinkage without freezing the vocabulary: the India
        # rank ladder and its fallback are the size tiers every consumer needs.
        required = {label for _, label in RANK_TIERS.ranks} | {RANK_TIERS.fallback}
        assert required <= uc.CAP_TIERS
        for tier in ALL_CAP_TIERS:
            assert user_client.put(
                URL, json={"config": _with(capTiers=[tier])}
            ).status_code == 200, tier
        assert user_client.put(
            URL, json={"config": _with(capTiers=["huge"])}
        ).status_code == 422

    def test_saved_config_accepts_every_tier_the_snapshot_can_emit(self, user_client):
        import api.user_configs as uc
        from api.market_screen.config import UNIVERSES

        # The saved-filter allowlist must cover the rail's whole vocabulary,
        # including class tiers (ETFs carry no cap but are still selectable).
        emitted = {
            label
            for spec in UNIVERSES.values()
            for label in (
                *(tier for _, tier in spec.cap_tiers.ranks),
                *(tier for _, tier in spec.cap_tiers.absolute),
                spec.cap_tiers.fallback,
                *((spec.cap_tiers.non_equity_tier,) if spec.cap_tiers.non_equity_tier else ()),
            )
        }
        assert emitted == uc.CAP_TIERS
        for tier in sorted(emitted):
            response = user_client.put(URL, json={"config": _with(capTiers=[tier])})
            assert response.status_code == 200, (tier, response.json())
        assert user_client.put(
            URL, json={"config": _with(capTiers=["not_a_tier"])}
        ).status_code == 422

    def test_types_track_registry_for_openapi(self):
        from typing import get_args

        import api.user_configs as uc
        from api.market_screen.config import ALLOWED_UNIVERSES, ALL_CAP_TIERS

        assert set(get_args(uc.MarketUniverse)) == set(ALLOWED_UNIVERSES)
        assert set(get_args(uc.CapTier)) == set(ALL_CAP_TIERS)
        schema = uc.MarketFiltersV1.model_json_schema()
        assert set(schema["properties"]["universe"]["enum"]) == set(ALLOWED_UNIVERSES)
        assert "us" in schema["properties"]["universe"]["enum"]

    def test_market_filters_accept_new_universes_without_422(self):
        import api.user_configs as uc

        for uid in ("banknifty", "sensex"):
            parsed = uc.MarketFiltersV1(universe=uid)
            assert parsed.universe == uid

    def test_view_literal_accepts_every_frontend_market_view(self):
        from typing import get_args

        import api.user_configs as uc

        backend = set(get_args(uc.MarketView))
        frontend = _frontend_market_view_ids()
        # Superset, not equality: the backend keeps the legacy ``map`` id for
        # old saved rows while the frontend writes only canonical ids. What must
        # never drift is the other direction — every id the frontend can write
        # has to be accepted by the backend Literal.
        assert set(frontend) <= backend, (
            "MarketView is missing frontend view ids: "
            f"only frontend={sorted(set(frontend) - backend)}"
        )
        assert "vis" in frontend, "the frontend registry no longer has the Vis id"
        assert "map" in backend, "the legacy view id must stay accepted on write"

    def test_color_by_literal_matches_frontend_market_size_metrics(self):
        from typing import get_args

        import api.user_configs as uc

        backend = list(get_args(uc.MarketColorBy))
        frontend = _frontend_market_size_metric_values()
        # Compare the real TS declaration, not a second hardcoded copy: that
        # copy is exactly what let the dropdown gain seven values unnoticed.
        assert set(backend) == set(frontend), (
            "MarketColorBy and MARKET_SIZE_METRIC_VALUES drifted: "
            f"only backend={sorted(set(backend) - set(frontend))}, "
            f"only frontend={sorted(set(frontend) - set(backend))}"
        )
        assert len(backend) == len(set(backend)), "duplicate in MarketColorBy"
        assert len(frontend) == len(set(frontend)), "duplicate in MARKET_SIZE_METRIC_VALUES"
        assert "colorBy" in uc.MarketFiltersV1.model_fields

    def test_market_filters_accept_every_key_the_frontend_serializes(self):
        """Every key `serializeMarketConfig` writes must be storable.

        It was not: the Deep Value / mover filters (gap, 52W distance, volume,
        value traded, sector percentiles) existed only on the frontend, so each
        save was rejected 422 `unknown_key` and the presets silently failed to
        persist. The adapter already had `extra="ignore"`, so nothing warned.
        """
        import api.user_configs as uc

        backend = set(uc.MarketFiltersV1.model_fields)
        frontend = _frontend_market_filter_keys()
        assert frontend, "no keys parsed from serializeMarketConfig"
        missing = sorted(set(frontend) - backend)
        assert not missing, (
            "MarketFiltersV1 is missing keys the frontend serializes: "
            f"{missing} — a save carrying any of them 422s as `unknown_key`"
        )

    def test_every_numeric_filter_the_frontend_declares_is_serialized(self):
        """A filter the UI declares and applies must also persist.

        `parseMarketConfig` reads every `NUMERIC_LIMITS` key, so a missing
        serializer entry is invisible until reload — the filter works, shows its
        chip, then silently resets. Nine absolute value gates were in that state.
        """
        serialized = set(_frontend_market_filter_keys())
        declared = set(_frontend_numeric_filter_keys())
        missing = sorted(declared - serialized)
        assert not missing, (
            "serializeMarketConfig omits filters that parseMarketConfig reads: "
            f"{missing} — they filter rows and then vanish on reload"
        )

    def test_sort_literal_accepts_every_frontend_market_sort(self):
        from typing import get_args

        import api.user_configs as uc

        backend = set(get_args(uc.MarketSortKey))
        frontend = _frontend_market_sort_keys()
        missing = sorted(set(frontend) - backend)
        assert not missing, (
            "MarketSortKey is missing frontend sort ids: "
            f"{missing} — saving any of them 422s as `invalid_config`"
        )


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


class TestRevisionPrecision:
    """A revision must identify one write, not one wall-clock second.

    ``CURRENT_TIMESTAMP`` on SQLite is second-resolution, so the two writes below
    used to receive the *same* ``updated_at``: the stale tab's ``If-Match`` then
    matched and its write silently overwrote the newer one (lost update).
    """

    @staticmethod
    def _freeze(monkeypatch, frozen):
        import api.user_configs as uc

        monkeypatch.setattr(uc, "_utcnow", lambda: frozen)

    @staticmethod
    def _instant(text: str):
        """The wire form follows the column (naive on SQLite); compare instants."""
        from datetime import datetime, timezone

        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    def test_two_writes_in_one_second_have_distinct_revisions(self, user_client, monkeypatch):
        from datetime import datetime, timezone

        frozen = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        self._freeze(monkeypatch, frozen)

        first = user_client.put(URL, json={"config": SAMPLE})
        second = user_client.put(URL, json={"config": _with(sort="rsi_desc")})

        assert first.status_code == second.status_code == 200
        rev1 = first.json()["updated_at"]
        rev2 = second.json()["updated_at"]
        # The revision comes from the write, and both land inside the same
        # wall-clock second — the exact case the DB clock could not express.
        assert self._instant(rev1) == frozen
        assert rev2 != rev1
        assert self._instant(rev2) == frozen + timedelta(microseconds=1)

    def test_stale_revision_is_rejected_after_a_same_second_write(self, user_client, monkeypatch):
        from datetime import datetime, timezone

        frozen = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        self._freeze(monkeypatch, frozen)

        rev1 = user_client.put(URL, json={"config": SAMPLE}).json()["updated_at"]
        rev2 = user_client.put(
            URL, json={"config": _with(sort="rsi_desc")}, headers={"If-Match": rev1}
        ).json()["updated_at"]
        assert rev2 != rev1

        # The stale tab still holds rev1: it must not win over rev2.
        stale = user_client.put(
            URL, json={"config": _with(sort="day_desc")}, headers={"If-Match": rev1}
        )
        assert stale.status_code == 409
        assert stale.json()["current"]["updated_at"] == rev2
        assert stale.json()["current"]["config"]["sort"] == "rsi_desc"

        # The tab that just wrote is still allowed to write again.
        fresh = user_client.put(
            URL, json={"config": _with(sort="day_desc")}, headers={"If-Match": rev2}
        )
        assert fresh.status_code == 200
        assert fresh.json()["config"]["sort"] == "day_desc"

    def test_two_immediate_writes_have_distinct_revisions(self, user_client, db):
        # The regression case without freezing anything: on SQLite the DB clock
        # is second-resolution, so an unmodified handler produced two identical
        # revisions for two writes milliseconds apart.
        rev1 = user_client.put(URL, json={"config": SAMPLE}).json()["updated_at"]
        rev2 = user_client.put(URL, json={"config": _with(sort="rsi_desc")}).json()["updated_at"]

        assert rev1 != rev2
        assert self._instant(rev2) > self._instant(rev1)

        db.expire_all()
        row = db.query(UserSavedConfig).one()
        assert self._instant(row.updated_at.isoformat()) == self._instant(rev2)

        stale = user_client.put(
            URL, json={"config": _with(sort="day_desc")}, headers={"If-Match": rev1}
        )
        assert stale.status_code == 409

    def test_revision_advances_even_if_the_clock_steps_backwards(self, user_client, monkeypatch):
        from datetime import datetime, timezone

        import api.user_configs as uc

        later = datetime(2026, 1, 1, 12, 0, 5, tzinfo=timezone.utc)
        monkeypatch.setattr(uc, "_utcnow", lambda: later)
        rev1 = user_client.put(URL, json={"config": SAMPLE}).json()["updated_at"]

        earlier = datetime(2026, 1, 1, 12, 0, 1, tzinfo=timezone.utc)
        monkeypatch.setattr(uc, "_utcnow", lambda: earlier)
        rev2 = user_client.put(URL, json={"config": _with(sort="rsi_desc")}).json()["updated_at"]

        assert self._instant(rev2) == later + timedelta(microseconds=1)
        assert rev2 != rev1

    def test_stored_row_carries_the_returned_revision(self, user_client, db):
        body = user_client.put(URL, json={"config": SAMPLE}).json()
        db.expire_all()
        row = db.query(UserSavedConfig).one()
        assert self._instant(row.updated_at.isoformat()) == self._instant(body["updated_at"])

    def test_second_resolution_row_from_before_the_fix_still_validates(self, user_client, db):
        """No migration: rows written by the old DB clock keep a second-resolution
        ``updated_at``, and the revision a browser already holds must still match."""
        from datetime import datetime, timezone

        legacy = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        db.add(
            UserSavedConfig(
                user_id=1,
                scope=SCOPE,
                name="",
                config=SAMPLE,
                version=1,
                updated_at=legacy,
            )
        )
        db.commit()

        held = user_client.get(URL).json()["updated_at"]
        assert self._instant(held) == legacy

        response = user_client.put(
            URL, json={"config": _with(sort="rsi_desc")}, headers={"If-Match": held}
        )
        assert response.status_code == 200
        # The write itself still advances to microsecond precision.
        assert self._instant(response.json()["updated_at"]) > legacy


class TestScopeBeforeBody:
    """An unknown scope is "not in this build" (404), never a client bug (422).

    The frontend maps 422 to *permanently blocked* and 404 to *disabled*, so a
    typo'd or newer-build scope with a missing body must still read as 404.
    """

    UNKNOWN = "/api/user-configs/nope.nope"

    @pytest.mark.parametrize(
        "kwargs",
        [
            {},
            {"json": {}},
            {"json": {"config": "not-an-object"}},
            {"json": {"config": {"sort": 1}, "version": "one"}},
        ],
    )
    def test_unknown_scope_is_404_whatever_the_body(self, user_client, db, kwargs):
        response = user_client.put(self.UNKNOWN, **kwargs)
        assert response.status_code == 404
        assert response.json()["detail"] == "unknown_scope"
        assert db.query(UserSavedConfig).count() == 0

    def test_unknown_table_scope_is_404_without_a_body(self, user_client, db):
        response = user_client.put("/api/user-configs/foo.bar")
        assert response.status_code == 404
        assert response.json()["detail"] == "unknown_scope"
        assert db.query(UserSavedConfig).count() == 0

    def test_known_scope_without_a_body_is_422(self, user_client, db):
        response = user_client.put(URL)
        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body"]
        assert db.query(UserSavedConfig).count() == 0

    def test_known_scope_with_an_empty_body_is_422(self, user_client, db):
        response = user_client.put(URL, json={})
        assert response.status_code == 422
        assert db.query(UserSavedConfig).count() == 0


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


class TestForwardCompatibleTableReads:
    """A newer build's extra field must not cost the user their known prefs.

    The write path stays strict (``extra="forbid"``), but reads are tolerant: a
    row written by a future build carries keys this build has never heard of, and
    discarding the whole payload would silently reset sorting/order/hidden.
    """

    URL = "/api/user-configs/table.screener.52w_high.approaching"
    STORED = {
        "sorting": [{"id": "to_52w_high", "desc": True}],
        "order": ["symbol", "to_52w_high"],
        "hidden": ["ltp"],
        # From a build that adds pinning / column widths.
        "pinned": ["symbol"],
        "widths": {"symbol": 120},
        "density": "compact",
    }

    def test_unknown_keys_do_not_discard_known_prefs(self, user_client, db):
        db.add(
            UserSavedConfig(
                user_id=1,
                scope="table.screener.52w_high.approaching",
                name="",
                config=self.STORED,
                version=1,
            )
        )
        db.commit()

        body = user_client.get(self.URL).json()
        assert body["saved"] is True
        assert "warning" not in body
        assert body["config"] == {
            "sorting": [{"id": "to_52w_high", "desc": True}],
            "order": ["symbol", "to_52w_high"],
            "hidden": ["ltp"],
        }

    def test_unknown_key_inside_a_sort_entry_is_ignored(self, user_client, db):
        db.add(
            UserSavedConfig(
                user_id=1,
                scope="table.market.grid",
                name="",
                config={
                    "sorting": [{"id": "day_change_pct", "desc": False, "fn": "custom"}],
                    "order": ["symbol"],
                    "hidden": [],
                },
                version=1,
            )
        )
        db.commit()

        body = user_client.get("/api/user-configs/table.market.grid").json()
        assert body["saved"] is True
        assert body["config"]["sorting"] == [{"id": "day_change_pct", "desc": False}]
        assert body["config"]["order"] == ["symbol"]

    def test_writes_stay_strict_about_unknown_keys(self, user_client, db):
        response = user_client.put(self.URL, json={"config": {**self.STORED}})
        assert response.status_code == 422
        assert response.json()["detail"] == "unknown_key"
        assert db.query(UserSavedConfig).count() == 0


WINDOW_HOME_URL = "/api/user-configs/window.home"


class TestWindowHomeScope:
    """The HOME desk must actually persist.

    `window.home` was never added to `SCOPE_REGISTRY`, so every save 404'd as
    `unknown_scope`. The client treats 404 as "config API absent — stay quiet",
    so the desk looked like it saved and silently persisted nothing: geometry,
    panel settings, named tabs, all lost on reload.
    """

    def test_scope_is_registered(self):
        from api.user_configs import SCOPE_REGISTRY

        assert "window.home" in SCOPE_REGISTRY

    def test_a_desk_layout_round_trips(self, user_client):
        payload = {
            "active": "Main",
            "layouts": [
                {
                    "name": "Main",
                    "windows": [
                        {
                            "id": "market.heatmap-1",
                            "type": "market.heatmap",
                            "title": "MARKET HEATMAP",
                            "x": 8,
                            "y": 8,
                            "w": 600,
                            "h": 400,
                            "z": 1,
                            "settings": {"universe": "nifty50", "sizeBy": "rsi"},
                        }
                    ],
                }
            ],
        }
        put = user_client.put(WINDOW_HOME_URL, json={"config": payload, "version": 1})
        assert put.status_code == 200, put.text

        get = user_client.get(WINDOW_HOME_URL)
        assert get.status_code == 200, get.text
        stored = get.json()["config"]
        assert stored["active"] == "Main"
        window = stored["layouts"][0]["windows"][0]
        assert window["settings"] == {"universe": "nifty50", "sizeBy": "rsi"}

    def test_a_default_read_is_not_a_404(self, user_client):
        # An empty scope must answer with the default payload, not `unknown_scope`.
        get = user_client.get(WINDOW_HOME_URL)
        assert get.status_code == 200, get.text
        assert get.json()["saved"] is False

    def test_an_oversized_layout_is_rejected(self, user_client):
        payload = {
            "active": "Main",
            "layouts": [
                {
                    "name": "Main",
                    "windows": [
                        {"id": f"w{i}", "type": "sector.table", "x": 0, "y": 0, "w": 10, "h": 10, "z": i}
                        for i in range(80)
                    ],
                }
            ],
        }
        put = user_client.put(WINDOW_HOME_URL, json={"config": payload, "version": 1})
        assert put.status_code == 422, put.text

    def test_the_client_version_marker_is_accepted(self, user_client):
        # The frontend stamps `v` on every desk write. Rejecting it 422'd every
        # save with `unknown_key: ["v"]` — the desk still persisted nothing.
        payload = {"v": 1, "active": "Main", "layouts": [{"name": "Main", "windows": []}]}
        put = user_client.put(WINDOW_HOME_URL, json={"config": payload, "version": 1})
        assert put.status_code == 200, put.text
        assert put.json()["config"]["v"] == 1
