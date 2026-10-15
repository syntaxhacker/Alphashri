"""Curated news-text -> NSE_EQ symbol aliases.

Read-only resolver used at the catalyst/event join: news rows carry
``symbol_code`` values (moneycontrol opaque codes like ``WI11``, stale
names like ``Z``, bare collisions like ``PTC``) that never match universe
symbols, so event pipelines silently drop them (see
``experiments/eventtech.md`` V4: UNIMECH / WI11 / PTC).

Data lives in ``data/symbol_aliases.json`` (hand-curated, precision over
recall; ambiguous codes are deliberately left out). Normalization reuses
:func:`api.symbols.normalize_tv_symbol` -- nothing is duplicated here.

Thread-safe, cached, never raises, never writes (no DB writes; instruments
are read via the existing :mod:`api.symbols` loader, fail-soft).
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Dict, FrozenSet, Optional, Tuple

_ALIAS_PATH = Path(__file__).resolve().parent.parent / "data" / "symbol_aliases.json"

_lock = threading.Lock()
_aliases: Optional[Dict[str, str]] = None
_alias_collisions: int = 0
_instruments: Optional[FrozenSet[str]] = None
_instruments_ok: bool = False


def _normalize(raw: object) -> str:
    """Shared normalization (extends api.symbols, never duplicated)."""
    try:
        from api.symbols import normalize_tv_symbol

        return normalize_tv_symbol("" if raw is None else str(raw))
    except Exception:
        try:
            return ("" if raw is None else str(raw)).upper().strip()
        except Exception:
            return ""


def _load_alias_file() -> Dict[str, str]:
    try:
        with open(_ALIAS_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f)
        raw_map = payload.get("aliases", {}) if isinstance(payload, dict) else {}
    except Exception:
        return {}
    out: Dict[str, str] = {}
    collisions = 0
    try:
        items = list(raw_map.items())
    except Exception:
        return {}
    for key, target in items:
        try:
            norm_key = _normalize(key)
            norm_target = ("" if target is None else str(target)).upper().strip()
            if not norm_key or not norm_target:
                continue
            if norm_key in out:
                collisions += 1
                continue
            out[norm_key] = norm_target
        except Exception:
            continue
    global _alias_collisions
    _alias_collisions = collisions
    return out


def _get_aliases() -> Dict[str, str]:
    global _aliases
    if _aliases is not None:
        return _aliases
    with _lock:
        if _aliases is None:
            _aliases = _load_alias_file()
    return _aliases


def _fetch_instruments() -> Tuple[FrozenSet[str], bool]:
    """Read NSE_EQ trading symbols via the existing loader (read-only)."""
    try:
        from api.symbols import _load_instruments

        rows = _load_instruments() or []
        syms = frozenset(
            str(r.get("trading_symbol", "")).upper().strip()
            for r in rows
            if isinstance(r, dict) and str(r.get("trading_symbol", "")).strip()
        )
        syms = frozenset(s for s in syms if s)
        return syms, bool(syms)
    except Exception:
        return frozenset(), False


def _get_instruments() -> Tuple[FrozenSet[str], bool]:
    global _instruments, _instruments_ok
    if _instruments is not None:
        return _instruments, _instruments_ok
    with _lock:
        if _instruments is None:
            try:
                _instruments, _instruments_ok = _fetch_instruments()
            except Exception:
                _instruments, _instruments_ok = frozenset(), False
    return _instruments, _instruments_ok


def resolve_symbol(raw: object) -> Optional[str]:
    """Resolve a raw news symbol to its NSE_EQ trading_symbol.

    Returns the normalized uppercase symbol when resolvable (curated alias
    hit, or exact NSE_EQ instrument hit), else None. Never raises.

    When the instrument list itself is unavailable (DB down), falls back to
    legacy pass-through (normalized raw) so callers behave exactly as before
    instead of dropping every row.
    """
    try:
        norm = _normalize(raw)
        if not norm:
            return None
        aliases = _get_aliases()
        try:
            if norm in aliases:
                return aliases[norm]
        except Exception:
            pass
        instruments, ok = _get_instruments()
        try:
            if norm in instruments:
                return norm
        except Exception:
            pass
        if not ok:
            # Instrument source unavailable: legacy pass-through.
            return norm
        return None
    except Exception:
        return None


def alias_map() -> Dict[str, str]:
    """Copy of the curated alias map (normalized keys). Never raises."""
    try:
        return dict(_get_aliases())
    except Exception:
        return {}


def stats() -> dict:
    """Loader stats (alias count, instrument count, load health). Never raises."""
    try:
        instruments, ok = _get_instruments()
        return {
            "aliases": len(_get_aliases()),
            "alias_collisions": _alias_collisions,
            "instruments": len(instruments),
            "instruments_ok": bool(ok),
            "alias_file": str(_ALIAS_PATH),
        }
    except Exception:
        return {"aliases": 0, "alias_collisions": 0, "instruments": 0,
                "instruments_ok": False, "alias_file": str(_ALIAS_PATH)}


def clear_cache() -> None:
    """Drop cached aliases/instruments (tests). Never raises."""
    global _aliases, _instruments, _instruments_ok, _alias_collisions
    try:
        with _lock:
            _aliases = None
            _instruments = None
            _instruments_ok = False
            _alias_collisions = 0
    except Exception:
        pass
