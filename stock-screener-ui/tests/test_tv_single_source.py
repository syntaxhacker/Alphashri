"""Invariant guard: ``api.tv`` is the single source of truth for TradingView scanner transport.

No module outside ``api/tv`` may define its own scanner URL, ``get_scanner_data``,
or a local ``MARKETS`` transport constant, and nothing may import the legacy
``api.tv_auth`` module. ``api.tv.client.get_scanner_data`` must be the only
``get_scanner_data`` definition in app code. Legacy trees (``api/tv``,
``upstox_trader``, ``experiments``, ``reports``, ``tests`` — see
``LEGACY_PREFIXES``) are exempt from the duplicate guards;
``edge_scanner_tv/markets.py`` is exempt from the ``MARKETS`` check only
(session-clock spec, not scanner transport).
"""

from __future__ import annotations

import importlib
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

SCANNED_DIRS = ("api", "chart_patterns", "edge_scanner_tv", "scripts/market")

# Grandfathered legacy code: pre-refactor modules, generated research output
# and test mocks are exempt from the duplicate guards. api/tv is the owner
# (it IS the single source); the rest are allowed to keep their current
# shape until migrated, so they must never trip the guard.
LEGACY_PREFIXES = ("api/tv/", "upstox_trader/", "experiments/", "reports/", "tests/")

# edge_scanner_tv/markets.py declares session-clock MarketSpecs (open/close,
# timezone, index, yf suffix) for the chart session, not the scanner's
# MARKETS transport map — the shared name is coincidental.
MARKETS_TRANSPORT_EXEMPT = frozenset({"edge_scanner_tv/markets.py"})

# Transport patterns that may only live in api.tv.
SCANNER_URL_RE = re.compile(r'SCANNER_URL\s*=\s*"https://scanner\.tradingview\.com')
GET_SCANNER_DATA_RE = re.compile(r"^\s*def get_scanner_data\(", re.MULTILINE)
MARKETS_RE = re.compile(r"^\s*MARKETS\s*[:=]", re.MULTILINE)
TV_AUTH_IMPORT_RE = re.compile(
    r"^\s*(?:from\s+api\.tv_auth\s+import\b"
    r"|from\s+api\s+import\s+[^\n]*\btv_auth\b"
    r"|import\s+api\.tv_auth)\b",
    re.MULTILINE,
)

EXPECTED_TV_NAMES = (
    "SCANNER_URL",
    "MARKETS",
    "get_scanner_data",
    "scan_frame",
    "scan_raw",
    "resolve_market",
    "get_tv_cookies",
    "refresh_tv_cookies",
    "clear_tv_cookie_cache",
    "tv_auth_status",
    "normalize_tv_symbol",
    "to_tv_ticker",
    "strip_tv_prefix",
    "tv_name_to_symbol",
    "note_update_mode",
    "tv_feed_status",
    "auth",
    "client",
    "columns",
    "status",
    "symbols",
)


def _is_legacy(rel) -> bool:
    """True for paths exempt from the duplicate guards (see LEGACY_PREFIXES)."""
    s = str(rel)
    return any(s.startswith(p) or s == p.rstrip("/") for p in LEGACY_PREFIXES)


def _iter_scanned_files():
    """Yield (path, relative) for .py files under the scanned dirs, excluding legacy trees."""
    for dir_name in SCANNED_DIRS:
        base = ROOT / dir_name
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*.py")):
            rel = path.relative_to(ROOT)
            parts = rel.parts
            if "__pycache__" in parts:
                continue
            if _is_legacy(rel):
                continue
            yield path, rel


def _iter_repo_files():
    """Yield all .py files under the repo root, excluding caches and VCS."""
    for path in sorted(ROOT.rglob("*.py")):
        parts = path.relative_to(ROOT).parts
        if "__pycache__" in parts or parts[0] == ".git":
            continue
        yield path


def _read_text(path: Path) -> str:
    """Read a file as text, ignoring undecodable bytes (we only scan ASCII tokens)."""
    try:
        return path.read_text()
    except UnicodeDecodeError:
        return path.read_text(errors="replace")


def test_api_tv_exposes_expected_names():
    """``import api.tv`` must expose the complete transport surface."""
    tv = importlib.import_module("api.tv")
    missing = [name for name in EXPECTED_TV_NAMES if not hasattr(tv, name)]
    assert not missing, f"api.tv missing names: {missing}"
    # The client owns the single get_scanner_data definition.
    assert hasattr(tv.client, "get_scanner_data")
    assert callable(tv.client.get_scanner_data)


def test_no_transport_duplicates_outside_api_tv():
    """No scanned module outside api/tv redefines the scanner URL, get_scanner_data, or MARKETS."""
    violations: list[str] = []
    for path, rel in _iter_scanned_files():
        text = _read_text(path)
        if SCANNER_URL_RE.search(text):
            violations.append(f"{rel}: duplicate SCANNER_URL transport constant")
        if GET_SCANNER_DATA_RE.search(text):
            violations.append(f"{rel}: duplicate get_scanner_data definition")
        if MARKETS_RE.search(text) and str(rel) not in MARKETS_TRANSPORT_EXEMPT:
            violations.append(f"{rel}: local MARKETS transport constant")
    assert not violations, (
        "Transport definitions must live only in api/tv. Violations:\n  "
        + "\n  ".join(violations)
    )


def test_no_api_tv_auth_imports_remain():
    """No file anywhere may import the legacy api.tv_auth module."""
    violations: list[str] = []
    for path in _iter_repo_files():
        text = _read_text(path)
        if TV_AUTH_IMPORT_RE.search(text):
            violations.append(str(path.relative_to(ROOT)))
    assert not violations, (
        "api.tv_auth imports must be gone. Still present in:\n  "
        + "\n  ".join(violations)
    )


def test_get_scanner_data_single_definition_in_app_code():
    """api.tv.client.get_scanner_data is the only get_scanner_data definition in app code."""
    # upstox_trader/** is grandfathered as legacy (see LEGACY_PREFIXES) — the
    # owner api/tv is deliberately NOT skipped: it holds the one allowed definition.
    app_dirs = ("api", "chart_patterns", "edge_scanner_tv", "scripts/market")
    definitions: list[str] = []
    for path in _iter_repo_files():
        rel = path.relative_to(ROOT)
        parts = rel.parts
        s = str(rel)
        if "tests" in parts:
            continue
        if _is_legacy(rel) and not s.startswith("api/tv/"):
            continue
        if not any(s.startswith(d + "/") or s == d for d in app_dirs):
            continue
        text = _read_text(path)
        if GET_SCANNER_DATA_RE.search(text):
            definitions.append(str(rel))
    assert definitions == ["api/tv/client.py"], (
        f"Expected only api/tv/client.py to define get_scanner_data in app code, got: {definitions}"
    )
