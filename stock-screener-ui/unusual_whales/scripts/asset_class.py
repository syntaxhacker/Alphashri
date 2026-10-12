#!/usr/bin/env python3
"""Classify a symbol as index / etf / stock / other.

The live feeds carry `issue_type` for options rows (used when present); the OI
feed and dark-pool prints do not, so a curated index/ETF set covers the common
noisy symbols (SPX/SPXW, SPY, QQQ, IWM, the 3x ETFs, sector SPDRs, ...).
"""
from __future__ import annotations

# cash-settled indices + their weekly variants
INDEX = {
    "SPX", "SPXW", "NDX", "NDXP", "RUT", "RUTW", "VIX", "VIXW", "XSP", "DJX",
    "XND", "NQX", "VXN", "RVX", "MRUT", "MID", "SML", "OEX", "XEO", "SOX",
    "XAU", "HUI", "BKX", "OSX", "SPXEW", "SPXPM",
}

# the common, high-volume ETFs (covers the noisy ones; not exhaustive)
ETF = {
    "SPY", "QQQ", "IWM", "DIA", "VOO", "IVV", "VTI", "RSP", "MDY",
    "TQQQ", "SQQQ", "SOXL", "SOXS", "SPXL", "SPXS", "UPRO", "SPXU", "TNA", "TZA",
    "VXX", "UVXY", "SVXY", "VIXY",
    "SMH", "SOXX", "XSD", "PSI", "ARKK", "ARKG", "ARKW", "ARKF",
    "XLF", "XLK", "XLE", "XLV", "XLI", "XLP", "XLY", "XLU", "XLB", "XLRE", "XLC",
    "KRE", "KBE", "XOP", "OIH", "ITB", "XHB", "XRT", "XME", "IYT", "XTN", "JETS", "XAR",
    "IBB", "XBI", "IHI", "XHE",
    "GDX", "GDXJ", "SIL", "GLD", "IAU", "SLV", "PSLV", "USO", "UNG", "COPX",
    "EEM", "EFA", "EWZ", "EWJ", "EWY", "FXI", "KWEB", "MCHI", "ASHR", "INDA",
    "TLT", "IEF", "SHY", "LQD", "HYG", "JNK", "AGG", "BND", "BIL", "SGOV",
    "BITO", "IBIT", "FBTC", "ETHE", "ETHA", "GBTC",
    "IYR", "VNQ", "SCHD", "VYM", "VTV", "VUG", "IJH", "IJR", "JEPI", "JEPQ",
}


def classify(ticker: str, issue_type: str | None = None) -> str:
    """Return one of: index | etf | stock | other."""
    t = str(ticker or "").upper().strip()
    it = str(issue_type or "").lower()
    if "index" in it:
        return "index"
    if "etf" in it or "exchange traded" in it or "fund" in it:
        return "etf"
    if "common" in it or "adr" in it or "stock" in it or "equity" in it or "reit" in it:
        return "stock"
    if t in INDEX:
        return "index"
    if t in ETF:
        return "etf"
    if it and "option" not in it:
        return "other"
    # no type info (dark pool / OI): plain tickers are assumed to be stocks
    return "stock"


if __name__ == "__main__":
    import sys

    for sym in sys.argv[1:]:
        print(f"{sym}: {classify(sym)}")
