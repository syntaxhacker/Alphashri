"""NSE stock-options universe from Fyers' PUBLIC daily symbol master.

Source: https://public.fyers.in/sym_details/NSE_FO_sym_master.json
(~85MB, ~82k entries). No API token needed.

Entry shape (relevant keys):
    {"underSym": "RELIANCE", "optType": "CE"/"PE"/"XX",
     "tradeStatus": 1, "minLotSize": ..., "expiryDate": ...}

Stock underlyings with options ~= 210 (index underlyings excluded).
"""
from __future__ import annotations

import json
import os
import time

try:
    import requests  # type: ignore
    _HAS_REQUESTS = True
except ImportError:  # pragma: no cover
    _HAS_REQUESTS = False

import urllib.request

MASTER_URL = "https://public.fyers.in/sym_details/NSE_FO_sym_master.json"
CACHE_FILE = "/tmp/fyers_nse_fo.json"
CACHE_TTL_SEC = 20 * 3600  # 20h

INDEX_UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"]

INDEX_EQ_MAP = {
    "NIFTY": "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY": "NSE:FINNIFTY-INDEX",
    "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
    "SENSEX": "BSE:SENSEX-INDEX",
}

# underSym -> EQ symbol alias (post corporate-action renames)
ALIAS_MAP = {"TATAMOTORS": "TMPV"}

# set by load_master(); used by stock_underlyings/lot_size without re-parse
_master: dict | None = None


def _cache_fresh(path: str = CACHE_FILE) -> bool:
    try:
        age = time.time() - os.path.getmtime(path)
    except OSError:
        return False
    return age < CACHE_TTL_SEC


def _download(path: str = CACHE_FILE) -> None:
    if _HAS_REQUESTS:
        with requests.get(MASTER_URL, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    if chunk:
                        f.write(chunk)
    else:
        req = urllib.request.Request(MASTER_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)


def load_master(force: bool = False) -> dict:
    """Download (if stale) and parse the Fyers NSE_FO symbol master."""
    global _master
    if not force and _cache_fresh():
        pass
    else:
        _download()
    with open(CACHE_FILE, "r", encoding="utf-8") as f:
        _master = json.load(f)
    return _master


def _master_data() -> dict:
    global _master
    if _master is None:
        load_master()
    assert _master is not None
    return _master


def _is_index_underlying(under: str) -> bool:
    u = under.upper()
    return "NIFTY" in u or "SENSEX" in u or "BANKEX" in u


def stock_underlyings() -> list[str]:
    """Sorted unique underSym with tradeStatus==1 and >=1 CE and >=1 PE row."""
    data = _master_data()
    ce: set[str] = set()
    pe: set[str] = set()
    for _sym, row in data.items():
        try:
            if row.get("tradeStatus") != 1:
                continue
            under = row.get("underSym")
            if not under:
                continue
            ot = row.get("optType")
            if ot == "CE":
                ce.add(under)
            elif ot == "PE":
                pe.add(under)
        except AttributeError:
            continue
    out = sorted(u for u in (ce & pe) if not _is_index_underlying(u))
    # alias target must exist in master, else drop the source symbol
    for src, dst in ALIAS_MAP.items():
        if src in out:
            found = any(
                isinstance(r, dict) and r.get("underSym") == dst
                for r in data.values()
            )
            if not found:
                out.remove(src)
    return out


def eq_symbol(under: str) -> str:
    """Map an FO underSym to its NSE equity symbol, e.g. 'NSE:RELIANCE-EQ'."""
    u = ALIAS_MAP.get(under, under)
    return f"NSE:{u}-EQ"


def lot_size(under: str) -> int | None:
    """minLotSize from any CE row for this underSym, else None."""
    data = _master_data()
    for row in data.values():
        if (
            isinstance(row, dict)
            and row.get("underSym") == under
            and row.get("optType") == "CE"
        ):
            try:
                return int(row["minLotSize"])
            except (KeyError, TypeError, ValueError):
                return None
    return None


if __name__ == "__main__":
    master = load_master()
    unders = stock_underlyings()
    print(f"master entries: {len(master)}")
    print(f"stock underlyings with options: {len(unders)}")
    print(f"first 10: {unders[:10]}")
    blob = json.dumps({"underlyings": unders})
    print(blob[:200])
