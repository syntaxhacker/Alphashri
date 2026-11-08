"""F&O / ETF membership tags for watch rows and pattern-result rows.

Detection rules (verified against the NSE instruments file at
``chart_patterns.universes.instruments_path()``):

* ETF / fund unit  — segment ``NSE_EQ``, ``instrument_type == "EQ"`` and ISIN
  starting with ``INF`` (e.g. SILVERBEES INF204KC1402, LIQUIDCASE INF0R8F01034,
  NIFTYBEES INF204KB14I2). Genuine companies carry ``INE...`` ISINs
  (JETFREIGHT INE982V01025, SHANTIGOLD INE06ZD01017), so names and tickers
  are never used as a heuristic.
* F&O stock        — present in ``universes.get_universe("nse_fo")`` (218
  equity underlyings from the instruments file).

A symbol can carry both tags; unknown symbols carry none. Symbols are
upper-cased, so lookups are case-insensitive. The instruments file is parsed
once per path (``functools.lru_cache``) and any load failure degrades to empty
sets -- this module never raises.
"""

from __future__ import annotations

import functools
import json
from pathlib import Path

from chart_patterns._symbols import norm_symbol
from chart_patterns.universes import instruments_path

#: One loaded copy each of the F&O and ETF symbol sets (small, immutable).
_EMPTY: tuple[frozenset[str], frozenset[str]] = (frozenset(), frozenset())


def _load(path: Path) -> tuple[frozenset[str], frozenset[str]]:
    """Parse the instruments file into ``(fno_symbols, etf_symbols)``.

    Never raises: missing / unreadable / invalid input yields empty sets.
    """
    try:
        raw = path.read_text(encoding="utf-8")
        records = json.loads(raw)
    except Exception:
        return _EMPTY

    fno: set[str] = set()
    etf: set[str] = set()
    if isinstance(records, list):
        for rec in records:
            if not isinstance(rec, dict):
                continue
            segment = rec.get("segment")
            if segment == "NSE_FO" and rec.get("underlying_type") == "EQUITY":
                # F&O records carry the underlying in ``underlying_symbol``
                # (``trading_symbol`` is the contract symbol, e.g. futures).
                sym = str(rec.get("underlying_symbol") or "").upper()
                if sym:
                    fno.add(sym)
            elif segment == "NSE_EQ" and rec.get("instrument_type") == "EQ":
                sym = str(rec.get("trading_symbol") or "").upper()
                if sym and str(rec.get("isin") or "").startswith("INF"):
                    etf.add(sym)
    return frozenset(fno), frozenset(etf)


@functools.lru_cache(maxsize=8)
def _membership(path_str: str) -> tuple[frozenset[str], frozenset[str]]:
    """Loaded ``(fno, etf)`` sets for one instruments path; parse happens once
    per distinct path. Never raises."""
    return _load(Path(path_str))


def fno_symbols() -> frozenset[str]:
    """Cached F&O equity-underlying symbol set (empty on load failure)."""
    return _membership(str(instruments_path()))[0]


def etf_symbols() -> frozenset[str]:
    """Cached ETF / fund-unit symbol set (empty on load failure)."""
    return _membership(str(instruments_path()))[1]


def is_fno(symbol: str) -> bool:
    """True when ``symbol`` is an NSE F&O equity underlying."""
    return norm_symbol(symbol) in fno_symbols()


def is_etf(symbol: str) -> bool:
    """True when ``symbol`` is an ETF/fund unit (INF ISIN)."""
    return norm_symbol(symbol) in etf_symbols()


def tags_for(symbol: str) -> list[str]:
    """Membership tags for ``symbol``: ``["F&O"]``, ``["ETF"]``, both, or ``[]``."""
    sym = norm_symbol(symbol)
    tags: list[str] = []
    if sym in fno_symbols():
        tags.append("F&O")
    if sym in etf_symbols():
        tags.append("ETF")
    return tags
