"""Tiny JSON-file stores + shared helpers for the TV compat server.

Layouts and watchlists persist under ``edge_scanner_tv/data/<market>/``.
The directory is created at runtime on first write. Layouts seed as ``[]``
(the dashboard seeds its own starter templates client-side on empty) — we
just persist whatever the UI PUTs.

Also home to the JSON sanitizer (NaN/inf -> None), a tiny TTL cache, and
the static seeds echoed by the settings/profiles/toplists-config endpoints.
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent / "data"


# ── paths ─────────────────────────────────────────────────────────────────

def market_dir(market_key: str) -> Path:
    d = BASE_DIR / market_key.lower().strip()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(market_key: str, name: str) -> Path:
    return market_dir(market_key) / name


# ── JSON load/save ────────────────────────────────────────────────────────

def load_list(market_key: str, name: str) -> list:
    try:
        data = json.loads(_path(market_key, name).read_text())
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def save_list(market_key: str, name: str, items: list) -> None:
    _path(market_key, name).write_text(json.dumps(items))


def load_dict(market_key: str, name: str) -> dict:
    try:
        data = json.loads(_path(market_key, name).read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_dict(market_key: str, name: str, payload: dict) -> None:
    _path(market_key, name).write_text(json.dumps(payload))


# ── sanitizer / timestamps ────────────────────────────────────────────────

def sanitize(obj: Any) -> Any:
    """Recursively convert NaN/inf floats to None (dashboard needs valid JSON)."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize(v) for v in obj]
    return obj


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def coerce_ts(value: Any) -> str:
    """Return value if it looks like an ISO timestamp, else server now."""
    if isinstance(value, str) and len(value) >= 10 and "T" in value:
        return value
    if isinstance(value, datetime):
        ts = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return ts.isoformat()
    return now_iso()


# ── tiny TTL cache (bars endpoint) ────────────────────────────────────────

class TTLCache:
    def __init__(self, ttl_sec: float = 60.0) -> None:
        self.ttl = ttl_sec
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        hit = self._store.get(key)
        if hit and (time.time() - hit[0]) < self.ttl:
            return hit[1]
        self._store.pop(key, None)
        return None

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (time.time(), value)


# ── static seeds ──────────────────────────────────────────────────────────

TOPLIST_DEFS = [
    {"name": "gainers", "label": "Top Gainers", "universe": "up_all",
     "rows": 25, "scope": "full"},
    {"name": "losers", "label": "Top Losers", "universe": "up_all",
     "rows": 25, "scope": "full"},
    {"name": "most_active", "label": "Most Active", "universe": "up_all",
     "rows": 25, "scope": "full"},
]


def settings_payload(values: dict | None = None) -> dict:
    vals = dict(values or {})
    return {
        "schema": [], "values": vals, "defaults": {}, "modified": {},
        "hash": "tv1", "presets": [], "history": [],
        "stats": {"setups": {}, "alerts": 0},
    }


def profiles_payload(universe_size: int,
                     profiles: list | None = None,
                     assignments: dict | None = None,
                     parameter_sets: list | None = None) -> dict:
    return {
        "profiles": profiles or [],
        "assignments": assignments or {},
        "system_keys": [],
        "members": {},
        "catalog": [],
        "stats": {"profiles": 0, "assignments": 0},
        "live": False,
        "universe_size": universe_size,
        "parameter_sets": parameter_sets or [],
    }
