"""Symbol normalization shared by ``chart_patterns.tags`` and ``chart_patterns.watch``.

Symbols are upper-cased and stripped; ``None``/blank -> ``""``. Lookups are
case-insensitive, so callers normalize before set membership. Never raises.
"""

from __future__ import annotations


def norm_symbol(s) -> str:
    """Upper-cased, stripped symbol; ``None``/blank -> ``""``."""
    if s is None:
        return ""
    return str(s).strip().upper()


def norm_symbols(xs) -> list[str]:
    """Upper-cased, stripped symbols; blanks dropped, order preserved."""
    out: list[str] = []
    for x in (xs or []):
        s = norm_symbol(x)
        if s:
            out.append(s)
    return out
