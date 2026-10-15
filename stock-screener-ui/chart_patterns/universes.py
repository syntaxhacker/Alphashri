"""Universe resolution for the chart-pattern scanner.

Universes are built from the Upstox instruments JSON
(``../upstox_trader/config_and_utils/nse_instruments.json``) plus a bundled
static NIFTY constituent list (:mod:`chart_patterns.constituents`).

* ``all_equity``  — ``segment == "NSE_EQ"`` and ``instrument_type == "EQ"``
* ``nse_fo``      — ``NSE_FO`` equity underlyings (``underlying_type == "EQUITY"``)
* ``nifty50/100/200/500`` — static constituent symbol lists.

The parsed instruments file is cached in-process.
"""

from __future__ import annotations

import json
from pathlib import Path

from .constituents import CONSTITUENTS

# Relative to this file: chart_patterns/ -> stock-screener-ui/ -> Alphashri/
_CANONICAL = (
    Path(__file__).resolve().parents[2]
    / "upstox_trader"
    / "config_and_utils"
    / "nse_instruments.json"
)

_INDEX_IDS = ["nifty50", "nifty100", "nifty200", "nifty500"]
_LABELS = {
    "all_equity": "All NSE Equity",
    "nse_fo": "NSE F&O",
    "nifty50": "NIFTY 50",
    "nifty100": "NIFTY 100",
    "nifty200": "NIFTY 200",
    "nifty500": "NIFTY 500",
}

# Test/injection hooks.
_INSTRUMENTS_PATH_OVERRIDE: Path | None = None
_CACHE: dict[str, dict[str, list[str]]] = {}


def _candidate_paths() -> list[Path]:
    here = Path(__file__).resolve()
    return [
        _CANONICAL,
        here.parents[2] / "upstox_trader" / "config_and_utils" / "nse_instruments.json",
        here.parents[1].parent / "upstox_trader" / "config_and_utils" / "nse_instruments.json",
        Path.cwd().parent / "upstox_trader" / "config_and_utils" / "nse_instruments.json",
    ]


def instruments_path() -> Path:
    """Filesystem path actually used to load instruments (honours override)."""
    if _INSTRUMENTS_PATH_OVERRIDE is not None:
        return Path(_INSTRUMENTS_PATH_OVERRIDE)
    for candidate in _candidate_paths():
        if candidate.exists():
            return candidate
    return _CANONICAL


def set_instruments_path(path: str | Path | None) -> None:
    """Override the instruments path (primarily for tests) and clear caches."""
    global _INSTRUMENTS_PATH_OVERRIDE
    _INSTRUMENTS_PATH_OVERRIDE = Path(path) if path is not None else None
    clear_cache()


def clear_cache() -> None:
    """Drop the in-process parsed-instruments cache."""
    _CACHE.clear()


def _load() -> dict[str, list[str]]:
    """Parse (and cache) the instruments file into ``all_equity`` / ``nse_fo``."""
    path = instruments_path()
    key = str(path)
    cached = _CACHE.get(key)
    if cached is not None:
        return cached

    equity: set[str] = set()
    fo: set[str] = set()
    try:
        raw = path.read_text(encoding="utf-8")
        records = json.loads(raw)
    except (OSError, ValueError):
        records = []

    if isinstance(records, list):
        for rec in records:
            if not isinstance(rec, dict):
                continue
            segment = rec.get("segment")
            if segment == "NSE_EQ" and rec.get("instrument_type") == "EQ":
                sym = rec.get("trading_symbol")
                if sym:
                    equity.add(str(sym).upper())
            elif segment == "NSE_FO" and rec.get("underlying_type") == "EQUITY":
                sym = rec.get("underlying_symbol")
                if sym:
                    fo.add(str(sym).upper())

    parsed = {
        "all_equity": sorted(equity),
        "nse_fo": sorted(fo),
    }
    _CACHE[key] = parsed
    return parsed


def get_universe(universe_id: str) -> list[str]:
    """Return constituent symbols for ``universe_id``.

    Raises:
        ValueError: for an unknown universe id.
    """
    uid = (universe_id or "").strip().lower()
    if uid == "all_equity":
        return list(_load()["all_equity"])
    if uid == "nse_fo":
        return list(_load()["nse_fo"])
    if uid in CONSTITUENTS:
        return list(CONSTITUENTS[uid])
    raise ValueError(f"Unknown universe {universe_id!r}")


def list_universes() -> list[dict]:
    """Return ``[{id, label, count}]`` for every available universe."""
    data = _load()
    out = [
        {"id": "all_equity", "label": _LABELS["all_equity"], "count": len(data["all_equity"])},
        {"id": "nse_fo", "label": _LABELS["nse_fo"], "count": len(data["nse_fo"])},
    ]
    for uid in _INDEX_IDS:
        out.append(
            {"id": uid, "label": _LABELS[uid], "count": len(CONSTITUENTS.get(uid, []))}
        )
    return out
