"""
Drift contract for the checked-in ``openapi.yaml`` vs the live FastAPI app.

The spec at the repo root is a generated artifact, never edited by hand.  Any
route, tag, security scheme or metadata change must be followed by:

    python scripts/export_openapi.py

These tests fail when the file and ``app.openapi()`` disagree, when an
operation loses its tag/summary, when ``bearerAuth`` disappears, or when the
path count silently shrinks (usually a router import swallowed by a
``try/except`` in ``api_server_fastapi.py``).

Run with:
    pytest tests/contract/test_openapi_sync.py -v -m contract
"""

import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.export_openapi import (  # noqa: E402
    SPEC_PATH,
    build_schema,
    check_spec,
    render_yaml,
)

pytestmark = pytest.mark.contract

HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head"}
REQUIRED_PATH_PREFIXES = (
    "/api/auth/login",
    "/api/paper/portfolio",
    "/api/bots",
    "/api/value/scan",
    "/api/events/calendar",
    "/api/screeners",
)
REQUIRED_TAGS = (
    "health",
    "auth",
    "screeners",
    "screener",
    "chart",
    "Paper Trading",
    "Bots",
    "strategies",
    "reports",
    "options",
    "value",
    "events",
)


@pytest.fixture(scope="module")
def schema():
    """Build the live schema once (importing the app is expensive)."""
    return build_schema()


def _iter_operations(spec):
    """Yield ``(path, method, operation)`` for real HTTP operations only."""
    for path, item in (spec.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for method, operation in item.items():
            if method.lower() in HTTP_METHODS and isinstance(operation, dict):
                yield path, method.lower(), operation


class TestSchemaBuilds:
    """The live schema must be complete and carry the expected metadata."""

    def test_info_title(self, schema):
        assert schema["info"]["title"] == "Alphashri API"

    def test_info_version_is_non_empty_string(self, schema):
        version = schema["info"].get("version")
        assert isinstance(version, str) and version.strip(), (
            "info.version must be a non-empty string"
        )

    def test_info_description_documents_authentication(self, schema):
        description = schema["info"].get("description") or ""
        assert description, "info.description must not be empty"
        assert "Authentication" in description, (
            "info.description must document the bearer-token flow"
        )

    def test_path_count_floor(self, schema):
        path_count = len(schema.get("paths") or {})
        assert path_count >= 250, (
            f"Only {path_count} paths in the live schema (expected >= 250). "
            "A router import probably failed and was swallowed by a try/except."
        )

    @pytest.mark.parametrize("prefix", REQUIRED_PATH_PREFIXES)
    def test_required_path_prefix_exists(self, schema, prefix):
        paths = schema.get("paths") or {}
        assert any(path.startswith(prefix) for path in paths), (
            f"No path starting with {prefix!r}; router may not be registered"
        )


class TestOperationQuality:
    """Every operation must be discoverable in the Swagger UI."""

    def test_every_operation_has_tags(self, schema):
        missing = [
            f"{method.upper()} {path}"
            for path, method, operation in _iter_operations(schema)
            if not operation.get("tags")
        ]
        assert not missing, (
            "Operations without tags (invisible in Swagger groups): "
            f"{', '.join(sorted(missing)[:20])}"
        )

    def test_every_operation_has_summary_or_operation_id(self, schema):
        missing = [
            f"{method.upper()} {path}"
            for path, method, operation in _iter_operations(schema)
            if not (operation.get("summary") or operation.get("operationId"))
        ]
        assert not missing, (
            "Operations without summary/operationId: "
            f"{', '.join(sorted(missing)[:20])}"
        )

    def test_operation_ids_are_unique(self, schema):
        operation_ids = [
            operation["operationId"]
            for _, _, operation in _iter_operations(schema)
            if operation.get("operationId")
        ]
        duplicates = sorted(
            {op_id for op_id in operation_ids if operation_ids.count(op_id) > 1}
        )
        assert not duplicates, f"Duplicate operationId values: {duplicates[:20]}"


class TestSecurityScheme:
    """The shared bearer-token dependency must stay wired into the schema."""

    def test_bearer_auth_scheme_exists(self, schema):
        security_schemes = (schema.get("components") or {}).get("securitySchemes") or {}
        assert "bearerAuth" in security_schemes, (
            "components.securitySchemes.bearerAuth is missing"
        )

    def test_bearer_auth_is_http_bearer(self, schema):
        bearer = (schema.get("components") or {})["securitySchemes"]["bearerAuth"]
        assert bearer.get("type") == "http"
        assert bearer.get("scheme") == "bearer"

    def test_at_least_100_operations_require_security(self, schema):
        protected = [
            f"{method.upper()} {path}"
            for path, method, operation in _iter_operations(schema)
            if operation.get("security")
        ]
        assert len(protected) >= 100, (
            f"Only {len(protected)} operations declare security (expected >= 100). "
            "The shared auth dependency may have been removed from routers."
        )


class TestTagMetadata:
    """OPENAPI_TAGS drives the Swagger groups; keep it populated and unique."""

    def test_tags_is_non_empty_list(self, schema):
        tags = schema.get("tags")
        assert isinstance(tags, list) and tags, "schema['tags'] must be a non-empty list"

    def test_every_tag_has_name_and_description(self, schema):
        bad = [
            tag.get("name", "<unnamed>")
            for tag in schema["tags"]
            if not isinstance(tag, dict)
            or not tag.get("name")
            or not str(tag.get("description") or "").strip()
        ]
        assert not bad, f"Tags missing a name or description: {bad}"

    def test_tag_names_are_unique(self, schema):
        names = [tag["name"] for tag in schema["tags"] if isinstance(tag, dict)]
        duplicates = sorted({name for name in names if names.count(name) > 1})
        assert not duplicates, f"Duplicate tag names: {duplicates}"

    def test_operational_tags_are_declared(self, schema):
        declared = {tag.get("name") for tag in schema["tags"] if isinstance(tag, dict)}
        missing = [name for name in REQUIRED_TAGS if name not in declared]
        assert not missing, f"Missing operational tags: {missing}"


class TestCheckedInSpecMatchesApp:
    """The generated file must be byte-for-byte explainable from the app."""

    def test_spec_file_exists(self):
        assert SPEC_PATH.exists(), (
            f"Checked-in OpenAPI spec not found at {SPEC_PATH}. "
            "Run python scripts/export_openapi.py"
        )

    def test_checked_in_spec_equals_live_schema(self, schema):
        file_schema = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))
        file_paths = set((file_schema or {}).get("paths") or {})
        live_paths = set(schema.get("paths") or {})
        diff = sorted(file_paths ^ live_paths)[:20]
        assert file_schema == schema, (
            "openapi.yaml is out of sync with app.openapi(). "
            "Regenerate with: python scripts/export_openapi.py\n"
            f"Paths only in openapi.yaml: {sorted(file_paths - live_paths)[:20]}\n"
            f"Paths only in live schema: {sorted(live_paths - file_paths)[:20]}\n"
            f"Symmetric difference (first 20): {diff}"
        )

    def test_check_spec_reports_in_sync(self):
        assert check_spec() is True, (
            "check_spec() reported drift. Regenerate with: "
            "python scripts/export_openapi.py"
        )

    def test_render_yaml_is_deterministic(self, schema):
        first = render_yaml(schema)
        second = render_yaml(schema)
        assert first == second, "render_yaml() is not deterministic"
        assert isinstance(first, str) and first.strip(), (
            "render_yaml() must return a non-empty string"
        )


class TestLiveOpenApiEndpoint:
    """Swagger UI and /openapi.json must be served by the real app."""

    @staticmethod
    def _client():
        try:
            from api_server_fastapi import app
        except Exception as exc:  # pragma: no cover - environment-dependent
            pytest.skip(f"api_server_fastapi import failed: {exc}")
        from fastapi.testclient import TestClient

        return TestClient(app)

    def test_openapi_json_served_with_expected_title(self):
        client = self._client()
        response = client.get("/openapi.json")
        assert response.status_code == 200
        assert response.json()["info"]["title"] == "Alphashri API"

    def test_swagger_ui_is_mounted(self):
        client = self._client()
        response = client.get("/docs")
        assert response.status_code == 200
        assert "text/html" in response.headers.get("content-type", "")
