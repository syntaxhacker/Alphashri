"""CORS contract for the browser cross-origin path (localhost:5173 -> :8765).

The saved-config PUT sends ``If-Match``. A preflight that does not list it is
rejected by the browser before the request is sent, which is invisible to every
server-side test that does not look at the OPTIONS response itself.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import Response  # noqa: E402

from api_server_fastapi import (  # noqa: E402
    CORS_ALLOW_HEADERS,
    CORS_ALLOW_METHODS,
    CORS_EXPOSE_HEADERS,
    _add_vary_origin,
)

ORIGIN = "http://localhost:5173"
EVIL_ORIGIN = "https://evil.example"


def _header_tokens(value: str) -> list[str]:
    return [token.strip().lower() for token in value.split(",")]


def _vary_tokens(response) -> list[str]:
    return _header_tokens(response.headers.get("vary", ""))


class TestPreflight:
    def test_put_preflight_allows_if_match(self, client):
        response = client.options(
            "/api/user-configs/market.filters",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "authorization,content-type,if-match",
            },
        )
        assert response.status_code == 204
        allow_headers = _header_tokens(response.headers["access-control-allow-headers"])
        assert "if-match" in allow_headers
        assert "authorization" in allow_headers
        assert "content-type" in allow_headers
        assert response.headers["access-control-allow-origin"] == ORIGIN
        assert "origin" in _vary_tokens(response)

    def test_preflight_keeps_credentials_and_methods(self, client):
        response = client.options(
            "/api/user-configs/market.filters",
            headers={"Origin": ORIGIN, "Access-Control-Request-Method": "PUT"},
        )
        assert response.status_code == 204
        assert response.headers["access-control-allow-credentials"] == "true"
        methods = _header_tokens(response.headers["access-control-allow-methods"])
        assert "put" in methods
        assert response.headers["access-control-allow-headers"] != "*"

    def test_preflight_exposes_revision_headers(self, client):
        response = client.options(
            "/api/user-configs/market.filters",
            headers={"Origin": ORIGIN, "Access-Control-Request-Method": "PUT"},
        )
        exposed = _header_tokens(response.headers["access-control-expose-headers"])
        assert "etag" in exposed
        assert "retry-after" in exposed

    def test_disallowed_origin_preflight_gets_no_cors_headers(self, client):
        response = client.options(
            "/api/user-configs/market.filters",
            headers={"Origin": EVIL_ORIGIN, "Access-Control-Request-Method": "PUT"},
        )
        assert response.headers.get("access-control-allow-origin") is None
        assert response.headers.get("access-control-allow-headers") is None


class TestSimpleRequests:
    def test_allowed_origin_is_reflected_and_varies(self, client):
        response = client.get("/api/auth/me", headers={"Origin": ORIGIN})
        assert response.headers["access-control-allow-origin"] == ORIGIN
        assert "origin" in _vary_tokens(response)

    def test_vary_appends_without_clobbering_accept_encoding(self):
        response = Response()
        response.headers["Vary"] = "Accept-Encoding"
        _add_vary_origin(response)
        assert _header_tokens(response.headers["vary"]) == ["accept-encoding", "origin"]

    def test_vary_is_idempotent(self):
        response = Response()
        response.headers["Vary"] = "Origin"
        _add_vary_origin(response)
        assert response.headers["vary"].lower() == "origin"

    def test_disallowed_origin_is_not_reflected(self, client):
        response = client.get("/api/auth/me", headers={"Origin": EVIL_ORIGIN})
        assert response.headers.get("access-control-allow-origin") is None

    def test_authenticated_put_with_if_match_reaches_handler(self, auth_client):
        """No preflight at TestClient level; proves the header is parsed, not rejected."""
        response = auth_client.put(
            "/api/user-configs/market.filters",
            json={"config": {}},
            headers={"If-Match": "2000-01-01T00:00:00+00:00", "Origin": ORIGIN},
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "conflict"
        assert response.headers["access-control-allow-origin"] == ORIGIN


class TestHeaderConstants:
    def test_allow_headers_cover_conditional_family(self):
        tokens = _header_tokens(CORS_ALLOW_HEADERS)
        for header in (
            "content-type",
            "authorization",
            "x-requested-with",
            "if-match",
            "if-none-match",
            "if-modified-since",
            "cache-control",
            "pragma",
        ):
            assert header in tokens, header

    def test_exposed_headers_include_etag_and_retry_after(self):
        tokens = _header_tokens(CORS_EXPOSE_HEADERS)
        assert "etag" in tokens
        assert "retry-after" in tokens

    def test_allow_methods_includes_put(self):
        assert "put" in _header_tokens(CORS_ALLOW_METHODS)
