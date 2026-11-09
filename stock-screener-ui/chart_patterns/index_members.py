"""Constituent membership for the Indian index universe."""

from __future__ import annotations

import csv
import io
import logging
import re
import threading
import time

import requests

from chart_patterns.constituents import NIFTY50, NIFTY100, NIFTY200, NIFTY500
from chart_patterns.indices import INDEX_KEYS, INDEX_LABELS
from api.tv import scan_raw

logger = logging.getLogger(__name__)

NIFTY_CSV_BASE = "https://www.niftyindices.com/IndexConstituent/"
CACHE_TTL_SECONDS = 6 * 60 * 60

INDEX_CSV_FILES: dict[str, str] = {
    "NIFTY": "ind_nifty50list.csv",
    "BANKNIFTY": "ind_niftybanklist.csv",
    "FINNIFTY": "ind_niftyfinancelist.csv",
    "MIDCPNIFTY": "ind_niftymidcapselect_list.csv",
    "NIFTYNXT50": "ind_niftynext50list.csv",
    "NIFTY100": "ind_nifty100list.csv",
    "NIFTY200": "ind_nifty200list.csv",
    "NIFTY500": "ind_nifty500list.csv",
    "NIFTYMIDCAP50": "ind_niftymidcap50list.csv",
    "NIFTYMIDCAP100": "ind_niftymidcap100list.csv",
    "NIFTYMIDCAP150": "ind_niftymidcap150list.csv",
    "NIFTYSMLCAP50": "ind_niftysmallcap50list.csv",
    "NIFTYSMLCAP100": "ind_niftysmallcap100list.csv",
    "NIFTYSMLCAP250": "ind_niftysmallcap250list.csv",
    "NIFTYTOTALMKT": "ind_niftytotalmarket_list.csv",
    "NIFTYIT": "ind_niftyitlist.csv",
    "NIFTYAUTO": "ind_niftyautolist.csv",
    "NIFTYPHARMA": "ind_niftypharmalist.csv",
    "NIFTYFMCG": "ind_niftyfmcglist.csv",
    "NIFTYMETAL": "ind_niftymetallist.csv",
    "NIFTYENERGY": "ind_niftyenergylist.csv",
    "NIFTYPSUBANK": "ind_niftypsubanklist.csv",
    "NIFTYPVTBANK": "ind_nifty_privatebanklist.csv",
    "NIFTYREALTY": "ind_niftyrealtylist.csv",
    "NIFTYMEDIA": "ind_niftymedialist.csv",
    "NIFTYINFRA": "ind_niftyinfralist.csv",
    "NIFTYCOMMODITIES": "ind_niftycommoditieslist.csv",
    "NIFTYCPSE": "ind_niftycpselist.csv",
    "NIFTYPSE": "ind_niftypselist.csv",
    "NIFTYSERV": "ind_niftyservicelist.csv",
    "NIFTYCEMENT": "ind_NiftyCement_list.csv",
    "NIFTYCHEMICALS": "ind_niftyChemicals_list.csv",
    "NIFTYCONSUMPTION": "ind_niftyconsumptionlist.csv",
    "NIFTYDEFENCE": "ind_niftyindiadefence_list.csv",
    "NIFTYDIGITAL": "ind_niftyindiadigital_list.csv",
    "NIFTYMFG": "ind_niftyindiamanufacturing_list.csv",
    "NIFTYHOUSING": "ind_niftyhousing_list.csv",
    "NIFTYCAPMKT": "ind_niftyCapitalMarkets_list.csv",
    "NIFTYMOBILITY": "ind_niftymobility_list.csv",
    "NIFTYEV": "ind_niftyEv_NewAgeAutomotive_list.csv",
    "NIFTYINTERNET": "ind_niftyIndiaInternet_list.csv",
    "NIFTYMNC": "ind_niftymnclist.csv",
    "NIFTYRAILWAYS": "ind_niftyIndiaRailwaysPSU_list.csv",
    "NIFTYTRANSLOG": "ind_niftytransportationandlogistics_list.csv",
    "NIFTYCONSDUR": "ind_niftyconsumerdurableslist.csv",
    "NIFTYNEWCONS": "ind_niftyIndiaNewAgeConsumption_list.csv",
    "NIFTYNONCYC": "ind_niftynon-cyclicalconsumer_list.csv",
    "NIFTYOILGAS": "ind_niftyoilgaslist.csv",
}

STATIC_MEMBERS: dict[str, list[str]] = {
    "NIFTY": NIFTY50,
    "NIFTY100": NIFTY100,
    "NIFTY200": NIFTY200,
    "NIFTY500": NIFTY500,
    "NIFTYNXT50": [symbol for symbol in NIFTY100 if symbol not in set(NIFTY50)],
}

TV_FALLBACK_INDEX_IDS = {"NIFTYRURAL", "SENSEX", "BANKEX"}
NO_MEMBERS_INDEX_IDS = {"INDIAVIX"}

TV_INDEX_NAMES: dict[str, list[str]] = {
    "BANKNIFTY": ["Nifty Bank"],
    "FINNIFTY": ["Nifty Financial Services"],
    "MIDCPNIFTY": ["Nifty MidCap Select"],
    "NIFTYPVTBANK": ["Nifty Private Bank"],
    "NIFTYSERV": ["Nifty Services Sector"],
    "NIFTYCONSUMPTION": ["Nifty India Consumption"],
    "NIFTYDEFENCE": ["Nifty India Defence"],
    "NIFTYDIGITAL": ["Nifty India Digital"],
    "NIFTYMFG": ["Nifty India Manufacturing"],
    "NIFTYCAPMKT": ["Nifty Capital Markets"],
    "NIFTYTRANSLOG": ["Nifty Transportation & Logistics"],
    "NIFTYEV": ["Nifty EV & New Age Automotive"],
    "NIFTYCONSDUR": ["Nifty Consumer Durables"],
    "NIFTYNONCYC": ["Nifty Non-Cyclical Consumer"],
    "NIFTYTOTALMKT": ["Nifty Total Market"],
    "NIFTYINFRA": ["Nifty Infrastructure"],
    "NIFTYRAILWAYS": ["Nifty India Railways PSU"],
    "NIFTYINTERNET": ["Nifty India Internet"],
    "NIFTYNEWCONS": ["Nifty India New Age Consumption"],
    "NIFTYRURAL": ["Nifty Rural"],
    "SENSEX": ["BSE Sensex"],
    "BANKEX": ["BSE Bankex"],
}

_cache: dict[str, tuple[float, list[str]]] = {}
_cache_lock = threading.Lock()
_tv_cache: tuple[float, dict[str, set[str]]] | None = None
_tv_cache_lock = threading.Lock()


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def parse_constituent_csv(text: str) -> list[str]:
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    symbols: list[str] = []
    seen: set[str] = set()
    for row in reader:
        symbol = str(row.get("Symbol") or "").strip().upper()
        if symbol and symbol not in seen:
            seen.add(symbol)
            symbols.append(symbol)
    return symbols


def _fetch_csv_members(index_id: str) -> list[str] | None:
    filename = INDEX_CSV_FILES.get(index_id)
    if not filename:
        return None
    try:
        response = requests.get(
            f"{NIFTY_CSV_BASE}{filename}",
            timeout=20,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/csv,*/*"},
        )
        response.raise_for_status()
        symbols = parse_constituent_csv(response.text)
        return symbols or None
    except requests.RequestException as exc:
        logger.warning("NiftyIndices CSV failed for %s: %s", index_id, exc)
        return None


def _load_tv_index_map() -> dict[str, set[str]]:
    global _tv_cache
    now = time.time()
    with _tv_cache_lock:
        if _tv_cache and _tv_cache[0] > now:
            return _tv_cache[1]
        payload = {
            "filter": [{"left": "type", "operation": "equal", "right": "stock"}],
            "columns": ["name", "indexes"],
            "range": [0, 10000],
        }
        response = scan_raw("india", payload, timeout=30)
        response.raise_for_status()
        by_index: dict[str, set[str]] = {}
        for row in response.json().get("data", []):
            raw_symbol = str(row.get("s") or "")
            symbol = raw_symbol.split(":", 1)[-1].strip().upper()
            if not symbol:
                continue
            for item in (row.get("d") or [None, None])[1] or []:
                for candidate in (item.get("name"), item.get("proname")):
                    key = _normalize(str(candidate or ""))
                    if key:
                        by_index.setdefault(key, set()).add(symbol)
                proname = str(item.get("proname") or "")
                if ":" in proname:
                    key = _normalize(proname.split(":", 1)[1])
                    if key:
                        by_index.setdefault(key, set()).add(symbol)
        _tv_cache = (now + CACHE_TTL_SECONDS, by_index)
        return by_index


def _fetch_tv_members(index_id: str) -> list[str] | None:
    labels = [INDEX_LABELS.get(index_id, ""), INDEX_KEYS.get(index_id, "").split("|", 1)[-1]]
    candidates = TV_INDEX_NAMES.get(index_id, []) + labels
    try:
        by_index = _load_tv_index_map()
    except requests.RequestException as exc:
        logger.warning("TradingView index membership failed for %s: %s", index_id, exc)
        return None
    for candidate in candidates:
        key = _normalize(candidate)
        if key and key in by_index:
            return sorted(by_index[key])
    return None


def members_for_index(index_id: str) -> list[str] | None:
    key = str(index_id or "").strip().upper()
    if key in NO_MEMBERS_INDEX_IDS:
        return []
    if key not in INDEX_LABELS:
        return None
    static = STATIC_MEMBERS.get(key)
    if static is not None:
        return list(static)

    now = time.time()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and cached[0] > now:
            return list(cached[1])
        symbols = _fetch_csv_members(key)
        if not symbols:
            symbols = _fetch_tv_members(key)
        if symbols is None:
            return None
        _cache[key] = (now + CACHE_TTL_SECONDS, list(symbols))
        return list(symbols)


def clear_cache() -> None:
    global _tv_cache
    with _cache_lock:
        _cache.clear()
    with _tv_cache_lock:
        _tv_cache = None
