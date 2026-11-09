"""TradingView symbol normalisation (one implementation).

Upstox/NSE symbols use ``-`` where TV uses ``_`` (``BAJAJ-AUTO`` vs
``BAJAJ_AUTO``), and TV tickers carry an exchange prefix. These helpers keep
both directions explicit; do not re-implement them at call sites.
"""

from __future__ import annotations

_PREFIXES = (
    "NSE_EQ:", "BSE_EQ:", "NSE:", "BSE:", "NASDAQ:", "NYSE:", "AMEX:",
)
_DOTTED_SUFFIXES = (".NS", ".BO", "-NS", "-BO", "-EQ", " EQ")


def strip_tv_prefix(ticker: str) -> str:
    """Drop a leading exchange prefix (``NSE:IDEA`` -> ``IDEA``)."""
    s = str(ticker or "").upper().strip()
    for pref in _PREFIXES:
        if s.startswith(pref):
            return s[len(pref):].strip()
    return s


def normalize_tv_symbol(raw: str) -> str:
    """TV ticker/name -> local bare trading symbol.

    Handles ``NSE:BAJAJ_AUTO`` -> ``BAJAJ-AUTO`` and leaves ``SIEMENS`` /
    ``20MICRONS`` intact (only dotted/dashed suffixes are stripped).
    """
    if not raw:
        return ""
    s = str(raw).upper().strip()
    s = strip_tv_prefix(s)

    # Recover the last token from malformed "TICKER    NSE:FOO" strings.
    if "NSE:" in s or "BSE:" in s:
        for part in reversed(s.replace("\n", " ").split()):
            if part.startswith("NSE:") or part.startswith("BSE:"):
                s = part.split(":", 1)[1] if ":" in part else part
                break

    for suf in _DOTTED_SUFFIXES:
        if s.endswith(suf):
            s = s[: -len(suf)].strip()
            break

    # TV uses _ where NSE uses - (BAJAJ_AUTO -> BAJAJ-AUTO). Keep & as-is.
    s = s.replace("_", "-").replace(" ", "")
    s = s.replace(".", "")
    return s.strip()


def to_tv_ticker(bare_symbol: str, exchange: str = "NSE") -> str:
    """Local bare symbol -> TV ticker (``BAJAJ-AUTO`` -> ``NSE:BAJAJ_AUTO``)."""
    sym = normalize_tv_symbol(bare_symbol)
    if not sym:
        return ""
    ex = (exchange or "NSE").upper().strip().rstrip(":") + ":"
    return f"{ex}{sym.replace('-', '_')}"


def tv_name_to_symbol(name: str) -> str:
    """Normalise the bare ``name`` column returned by the scanner."""
    return normalize_tv_symbol(name)
