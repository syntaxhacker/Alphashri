#!/usr/bin/env python3
"""NSE bulk / block deals -> institutional-buy early signal (playbook P8).

Why this exists
---------------
NSE discloses **bulk deals** (a single client crossing 0.5% of paid-up
equity) and **block deals** at end of day. Mutual funds / insurers / PMS / AIF
buying of size shows up here *months before* quarterly shareholding changes,
so a ₹50 Cr+ institutional BUY is an early "smart money" tell.

What this module does
---------------------
1. :func:`fetch_snapshot` — today's JSON from NSE's capital-market large-deal
   snapshot (bulk + block), with a cookie warm-up and retry/backoff.
2. :func:`fetch_bulk_csv` — cookie-free ``archives.nseindia.com`` CSV fallback
   (bulk deals only).
3. :func:`fetch_deals` — prefer the snapshot, fall back to the CSV, else
   ``([], "unavailable")``. Never raises.
4. :func:`normalize` — dedupe (the snapshot repeats rows), coerce numbers,
   compute ``value_cr``, flag ``instrument_type``.
5. :func:`classify_client` — curated client-name classifier
   (mutual_fund / insurance / pms / aif / fpi / trust / corporate /
   individual / unknown).
6. :func:`qualifying` — institutional BUY, equity, ``value_cr >= min_cr``
   (``BULK_DEAL_MIN_CR``, default 50).
7. :func:`enrich` — one cheap Fyers daily series per qualifying symbol fills
   ``vol_z20`` / ``close`` / ``chg_pct`` (+ ``atr20`` for signal levels).
   Off-hours calls are wrapped in ``fyers_pacer.allow_offhours``.
8. :func:`run_once` — the full pipeline, persisting append-only JSONL to
   ``india_board/data/bulk_deals/{YYYY-MM-DD}.jsonl`` and emitting one P8
   signal per qualifying deal.
9. :func:`ensure_started` — daemon that fires **once** per weekday at/after
   ``BULK_DEAL_HOUR`` (env, default 18 = 18:00 IST, after NSE publishes).

Persisted record schema (append-only JSONL, one line per **deduped** deal)::

    {"date":"2026-09-30","symbol":"EBGNG","name":"GNG Electronics Limited",
     "client":"UNIFI CAPITAL PRIVATE LIMITED","side":"BUY","qty":2012345,
     "watp":674.0,"value_cr":135.79,"deal_type":"bulk|block",
     "client_type":"mutual_fund|insurance|pms|aif|fpi|trust|corporate|individual|unknown",
     "client_confidence":"high|medium|low","matched_pattern":"MUTUAL FUND",
     "instrument_type":"equity|invit|etf|other",
     "qualifying":true,"threshold_cr":50.0,
     "vol_z20":2.8,"close":674.0,"chg_pct":4.1,
     "signal_id":"<uuid|null>","captured_at":"<ISO IST>","source":"nse_snapshot|nse_bulk_csv"}

All numbers are JSON-safe (no NaN/Inf). ``vol_z20`` / ``close`` / ``chg_pct``
are ``null`` when Fyers data is unavailable — never fabricated.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import statistics
import sys
import tempfile
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

try:  # package import (india_board.scripts.bulk_deals)
    from india_board.scripts import signal_log  # type: ignore
except ImportError:  # top-level import (india_board/scripts on sys.path)
    import signal_log  # type: ignore

IST = ZoneInfo("Asia/Kolkata")
ROOT = Path(__file__).resolve().parent.parent
#: JSONL tree written by :func:`persist` and read by :func:`read_day`.
DATA_DIR = ROOT / "data" / "bulk_deals"

#: NSE endpoints (verified live; cookie jar required for the JSON API).
NSE_HOME = "https://www.nseindia.com/"
NSE_REPORT_PAGE = "https://www.nseindia.com/report-detail/display-bulk-and-block-deals"
NSE_SNAPSHOT_URL = "https://www.nseindia.com/api/snapshot-capital-market-largedeal"
NSE_BULK_CSV_URL = "https://archives.nseindia.com/content/equities/bulk.csv"

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_HEADERS = {
    "User-Agent": _UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": NSE_REPORT_PAGE,
}

PLAYBOOK = "P8"
KEEP_DAYS = 400
MAX_ENRICH = 15
DEFAULT_MIN_CR = 50.0
DEFAULT_DEAL_HOUR = 18
DEAL_TYPES = ("bulk", "block")
INSTITUTIONAL_TYPES = ("mutual_fund", "insurance", "pms", "aif", "fpi")
SCHED_TICK_SEC = 300

# ---------------------------------------------------------------------------
# Client-name classifier — curated, documented patterns
# ---------------------------------------------------------------------------
#: Mutual-fund markers. First match wins; the matched literal is recorded as
#: ``matched_pattern``. Explicit institutional phrases and well-known Indian
#: AMC names are treated as ``high`` confidence; a bare "FUND" token is
#: ``medium`` (it may be a hedge / sovereign / family fund).
MF_PATTERNS = (
    "MUTUAL FUND", "MASTER UNIT", "GROWTH FUND", "FLEXICAP", "SMALLCAP",
    "MIDCAP FUND", "LARGE CAP FUND", "LIQUID FUND", "ARBITRAGE FUND",
    "BALANCED ADVANTAGE", "INDEX FUND", "ELSS", "TAX SAVER", "MASTER FUND",
    # well-known AMCs / fund houses
    "SBI MUTUAL", "HDFC MUTUAL", "ICICI PRUDENTIAL", "NIPPON", "KOTAK MUTUAL",
    "ADITYA BIRLA", "AXIS MUTUAL", "UTI MUTUAL", "FRANKLIN", "INVESCO",
    "MIRAE", "CANARA ROBECO", "TATA MUTUAL", "DSP MUTUAL", "MOTILAL OSWAL",
    "EDELWEISS", "QUANT MUTUAL", "PPFAS", "PARAG PARIKH", "HELIOS",
    "MAHINDRA MANULIFE", "BANDHAN", "IDFC MUTUAL", "HSBC MUTUAL",
    "NAVI MUTUAL", "ZERODHA MUTUAL", "GROWW MUTUAL",
)

#: Names containing these are **not** mutual funds even though they contain a
#: fund-ish token (welfare / employee / charitable vehicles). They fall through
#: to ``trust`` (see :data:`TRUST_PATTERNS`) or ``corporate``.
MF_EXCLUSIONS = (
    "WELFARE", "FOUNDATION", "EMPLOYEES", "EMPLOYEE", "PROVIDENT",
    "GRATUITY", "PENSION", "CHARITABLE", "ENDOWMENT", "TEMPLE",
)

INSURANCE_PATTERNS = (
    "LIFE INSURANCE", "GENERAL INSURANCE", "INSURANCE COMPANY",
    "INSURANCE CO", "REINSURANCE", "ASSURANCE",
)
PMS_PATTERNS = (
    "PORTFOLIO MANAG", "PORTFOLIO MANAGEMENT", "UNIFI CAPITAL",
    "MARCELLUS", "WHITEOAK", "WHITE OAK",
)
FPI_PATTERNS = (
    "FOREIGN PORTFOLIO", "FOREIGN INSTITUTIONAL", "MASTER FUND LTD",
    "MASTER FUND LIMITED", "MAURITIUS", "SINGAPORE", "CAYMAN", "CYPRUS",
    "LUXEMBOURG", "IRELAND", "GLOBAL FUND", "OFFSHORE FUND",
    "VANGUARD", "BLACKROCK", "FIDELITY FUND",
)
AIF_PATTERNS = (
    "ALTERNATIVE INVESTMENT", "HEDGE FUND", "CATEGORY I", "CATEGORY II",
    "CATEGORY III",
)
TRUST_PATTERNS = (
    "TRUST", "FOUNDATION", "WELFARE", "ENDOWMENT", "CHARITABLE", "TEMPLE",
    "PROVIDENT", "GRATUITY", "PENSION FUND", "EPF",
)
CORPORATE_PATTERNS = (
    "PRIVATE LIMITED", "PVT LTD", "PVT. LTD", "LIMITED", "CORPORATION",
    "COMPANY", "INDUSTRIES", "ENTERPRISES", "VENTURES", "HOLDINGS",
    "TECHNOLOGIES", "TECHNOLOGY", "SOLUTIONS", "FINANCE", "CAPITAL",
    "SECURITIES", "BROKING", "TRADING", "EXPORTS", "PHARMA",
    "LABORATORIES", "MOTORS", "STEEL", "CEMENT", "BANK",
)
#: Short tokens matched on word boundaries only (avoid "LIC" inside "CLICK").
_SHORT_TOKENS = {
    "insurance": "LIC",
    "pms": "PMS",
    "fpi": "FPI",
    "aif": "AIF",
    "mutual_fund": "FUND",
    "corporate": "LTD",
}

#: Instrument-type markers.
_INVIT_MARKERS = ("INVIT", "REIT")
_ETF_MARKERS = ("ETF", "EXCHANGE TRADED", "BEES")

__all__ = [
    "DATA_DIR",
    "IST",
    "KEEP_DAYS",
    "MAX_ENRICH",
    "DEFAULT_MIN_CR",
    "PLAYBOOK",
    "INSTITUTIONAL_TYPES",
    "MF_PATTERNS",
    "classify_client",
    "fetch_snapshot",
    "fetch_bulk_csv",
    "fetch_deals",
    "normalize",
    "qualifying",
    "enrich",
    "run_once",
    "persist",
    "read_day",
    "history",
    "prune_bulk_deals",
    "ensure_started",
]


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def _now_ist(now=None) -> datetime:
    """Coerce ``now`` to an IST-aware datetime (default: now in IST)."""
    if now is None:
        return datetime.now(IST)
    if isinstance(now, datetime):
        return now.replace(tzinfo=IST) if now.tzinfo is None else now.astimezone(IST)
    if isinstance(now, date):
        return datetime(now.year, now.month, now.day, tzinfo=IST)
    if isinstance(now, str):
        parsed = _parse_date(now)
        if parsed is not None:
            return datetime.fromisoformat(parsed).replace(tzinfo=IST)
    return datetime.now(IST)


def _parse_date(value, fallback: str | None = None) -> str | None:
    """Parse an NSE date (ISO or ``30-SEP-2026``) into ``YYYY-MM-DD``."""
    if value is None:
        return fallback
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip()
    if not s:
        return fallback
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d-%b-%y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:11], fmt).date().isoformat()
        except ValueError:
            continue
    return fallback


def _day_str(value=None) -> str:
    """``YYYY-MM-DD`` for a date/datetime/str, defaulting to today IST."""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return _parse_date(value, _now_ist().date().isoformat())


def _json_safe(value):
    """Recursively make ``value`` JSON-safe (NaN/Inf -> None)."""
    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _sanitize(record: dict) -> dict:
    return {str(k): _json_safe(v) for k, v in record.items()}


def _num(value) -> float | None:
    """Coerce a number (commas / strings allowed) or ``None`` when invalid."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        f = float(value)
    else:
        s = str(value).replace(",", "").strip()
        if not s:
            return None
        try:
            f = float(s)
        except (TypeError, ValueError):
            return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _clean(value) -> str:
    """Collapse whitespace and return a stripped string."""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _r2(value):
    """Round to 2 dp, preserving ``None``."""
    return None if value is None else round(float(value), 2)


# ---------------------------------------------------------------------------
# classifier
# ---------------------------------------------------------------------------
def _hit(name: str, patterns) -> str | None:
    """First ``pattern`` that appears as a substring in ``name``."""
    for p in patterns:
        if p in name:
            return p
    return None


def _hit_word(name: str, token: str) -> str | None:
    """Return ``token`` when it appears on a word boundary in ``name``."""
    if re.search(r"(?<![A-Z0-9])" + re.escape(token) + r"(?![A-Z0-9])", name):
        return token
    return None


def _res(client_type: str, confidence: str, pattern) -> dict:
    return {
        "client_type": client_type,
        "client_confidence": confidence,
        "matched_pattern": pattern,
    }


def classify_client(name) -> dict:
    """Classify an NSE deal client name.

    Returns ``{"client_type", "client_confidence", "matched_pattern"}`` where
    ``client_type`` is one of ``mutual_fund`` / ``insurance`` / ``pms`` /
    ``aif`` / ``fpi`` / ``trust`` / ``corporate`` / ``individual`` / ``unknown``.

    Ordering matters and is deliberate:

    1. ``insurance`` (explicit insurance phrases, ``LIC`` token)
    2. ``pms`` (portfolio-manager phrases + known PMS names)
    3. ``fpi`` (offshore / foreign-portfolio patterns — checked **before**
       mutual funds so ``X MASTER FUND LTD`` is FPI, not MF)
    4. ``aif`` (alternative-investment / hedge-fund phrases)
    5. ``trust`` (trust / welfare / foundation vehicles — checked before
       mutual funds so a "welfare foundation" is never an MF)
    6. ``mutual_fund`` — explicit :data:`MF_PATTERNS` (high), else a bare
       ``FUND`` token (medium), unless an :data:`MF_EXCLUSIONS` marker is hit
    7. ``corporate`` (Indian company suffixes)
    8. ``individual`` fallback (low); ``unknown`` only for a blank name.
    """
    n = _clean(name).upper()
    if not n:
        return _res("unknown", "low", None)

    # 1. insurance
    p = _hit(n, INSURANCE_PATTERNS) or _hit_word(n, _SHORT_TOKENS["insurance"])
    if p:
        return _res("insurance", "high", p)

    # 2. PMS
    p = _hit(n, PMS_PATTERNS) or _hit_word(n, _SHORT_TOKENS["pms"])
    if p:
        conf = "high" if p in ("UNIFI CAPITAL", "MARCELLUS", "WHITEOAK", "WHITE OAK") else "medium"
        return _res("pms", conf, p)

    # 3. FPI
    p = _hit(n, FPI_PATTERNS) or _hit_word(n, _SHORT_TOKENS["fpi"])
    if p:
        return _res("fpi", "high", p)

    # 4. AIF
    p = _hit(n, AIF_PATTERNS) or _hit_word(n, _SHORT_TOKENS["aif"])
    if p:
        return _res("aif", "high", p)

    # 5. trust / welfare / foundation
    p = _hit(n, TRUST_PATTERNS)
    if p:
        return _res("trust", "high", p)

    # 6. mutual fund (explicit patterns, then generic FUND)
    if not _hit(n, MF_EXCLUSIONS):
        p = _hit(n, MF_PATTERNS)
        if p:
            return _res("mutual_fund", "high", p)
        p = _hit_word(n, _SHORT_TOKENS["mutual_fund"])
        if p:
            return _res("mutual_fund", "medium", p)

    # 7. corporate
    p = _hit(n, CORPORATE_PATTERNS) or _hit_word(n, _SHORT_TOKENS["corporate"])
    if p:
        return _res("corporate", "medium", p)

    # 8. individual fallback
    return _res("individual", "low", None)


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------
def _rows_from_snapshot(snapshot: dict) -> list[dict]:
    """Flatten ``BULK_DEALS_DATA`` / ``BLOCK_DEALS_DATA``, tagging deal type."""
    out: list[dict] = []
    if not isinstance(snapshot, dict):
        return out
    for key, deal_type in (("BULK_DEALS_DATA", "bulk"), ("BLOCK_DEALS_DATA", "block")):
        rows = snapshot.get(key)
        if not isinstance(rows, list):
            continue
        for row in rows:
            if isinstance(row, dict):
                tagged = dict(row)
                tagged["deal_type"] = deal_type
                out.append(tagged)
    return out


def fetch_snapshot() -> dict:
    """Today's NSE large-deal snapshot JSON (bulk + block).

    Warms up a cookie jar (homepage then the report page) before hitting the
    JSON API, retries with backoff, and **never raises** — returns ``{}`` on
    any failure.
    """
    try:
        import requests  # type: ignore  # noqa: PLC0415
    except ImportError:
        return {}

    for attempt in range(3):
        try:
            session = requests.Session()
            session.headers.update(_HEADERS)
            session.get(NSE_HOME, timeout=15)
            session.get(NSE_REPORT_PAGE, timeout=15)
            resp = session.get(NSE_SNAPSHOT_URL, timeout=20)
            if int(getattr(resp, "status_code", 0)) == 200:
                data = resp.json()
                if isinstance(data, dict) and isinstance(
                    data.get("BULK_DEALS_DATA"), list
                ):
                    return data
                if isinstance(data, dict) and isinstance(
                    data.get("BLOCK_DEALS_DATA"), list
                ):
                    return data
        except Exception:  # noqa: BLE001 - never raise out of a fetch
            pass
        time.sleep(1.5 * (attempt + 1))
    return {}


def _parse_bulk_csv(text: str) -> list[dict]:
    """Parse ``bulk.csv`` into snapshot-shaped raw rows (bulk only)."""
    out: list[dict] = []
    if not text:
        return out
    reader = csv.DictReader(io.StringIO(text))
    for raw in reader:
        row = {
            "date": raw.get("Date"),
            "symbol": raw.get("Symbol"),
            "name": raw.get("Security Name"),
            "clientName": raw.get("Client Name"),
            "buySell": raw.get("Buy/Sell"),
            "qty": raw.get("Quantity Traded"),
            "watp": raw.get("Trade Price / Wght. Avg. Pr"),
            "remarks": raw.get("Remarks"),
            "deal_type": "bulk",
        }
        if _clean(row["symbol"]) and _clean(row["clientName"]):
            out.append(row)
    return out


def fetch_bulk_csv() -> list[dict]:
    """Cookie-free ``archives.nseindia.com`` bulk-deals CSV (bulk only).

    **Never raises** — returns ``[]`` on any failure.
    """
    try:
        import requests  # type: ignore  # noqa: PLC0415

        resp = requests.get(
            NSE_BULK_CSV_URL, headers={"User-Agent": _UA}, timeout=20
        )
        if int(getattr(resp, "status_code", 0)) != 200:
            return []
        text = resp.content.decode("utf-8-sig", errors="replace")
    except Exception:  # noqa: BLE001
        return []
    return _parse_bulk_csv(text)


#: NSE's archives endpoint. Unlike the old ``/api/historical/bulk-deals``
#: (503/WAF), this one answers plain requests. Quirk: a multi-day range returns
#: only the FIRST day, capped at ~70 rows, so it must be called day by day.
_ARCHIVE_URL = (
    "https://www.nseindia.com/api/historicalOR/bulk-block-short-deals"
)
_ARCHIVE_FIELDS = {
    "BD_DT_DATE": "date",
    "BD_SYMBOL": "symbol",
    "BD_SCRIP_NAME": "name",
    "BD_CLIENT_NAME": "clientName",
    "BD_BUY_SELL": "buySell",
    "BD_QTY_TRD": "qty",
    "BD_TP_WATP": "watp",
    "BD_REMARKS": "remarks",
}


def fetch_archive_day(day, *, option_type: str = "bulk_deals", timeout: int = 25) -> list[dict]:
    """One session of archived bulk (or block) deals from NSE.

    ``day`` accepts ``YYYY-MM-DD`` or ``DD-MM-YYYY``. Returns normalized raw
    rows (the same shape as :func:`fetch_snapshot`) with ``deal_type`` set.
    Never raises — returns ``[]`` on any failure.
    """
    import requests  # noqa: PLC0415

    try:
        dmy = _parse_date(day) or day
        d = datetime.strptime(str(dmy), "%Y-%m-%d").strftime("%d-%m-%Y")
    except Exception:  # noqa: BLE001
        return []
    params = {"optionType": option_type, "from": d, "to": d}
    try:
        resp = requests.get(
            _ARCHIVE_URL, params=params, timeout=timeout,
            headers={
                "User-Agent": _UA,
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://www.nseindia.com/report-detail/display-bulk-and-block-deals",
            },
        )
        if resp.status_code != 200:
            return []
        payload = resp.json()
    except Exception:  # noqa: BLE001
        return []
    rows = payload.get("data") if isinstance(payload, dict) else payload
    out: list[dict] = []
    for raw in rows or []:
        if not isinstance(raw, dict):
            continue
        row = {dst: raw.get(src) for src, dst in _ARCHIVE_FIELDS.items()}
        row["deal_type"] = "block" if "block" in option_type else "bulk"
        if row.get("symbol") and row.get("clientName"):
            out.append(row)
    return out


def backfill(days: int = 10, *, end=None, root=None, include_block: bool = True) -> dict:
    """Fetch + persist the last ``days`` sessions of archived deals.

    Returns ``{days, fetched, persisted, per_day}``. Weekends are skipped;
    days that already have a file are skipped unless empty.
    """
    end_d = _parse_date(end) or _now_ist().date().isoformat()
    cur = datetime.strptime(end_d, "%Y-%m-%d").date()
    per_day: dict[str, int] = {}
    fetched = persisted = 0
    sessions = 0
    while sessions < max(0, int(days)):
        if cur.weekday() < 5:  # Mon-Fri
            day_iso = cur.isoformat()
            sessions += 1
            try:
                existing = read_day(day_iso, root=root)
            except Exception:  # noqa: BLE001
                existing = []
            if existing:
                per_day[day_iso] = len(existing)
            else:
                rows = fetch_archive_day(day_iso)
                if include_block:
                    rows += fetch_archive_day(day_iso, option_type="block_deals")
                fetched += len(rows)
                if rows:
                    recs = normalize(rows, date=day_iso)
                    for rec in recs:
                        rec["source"] = "nse_archive"
                    persist(recs, date=day_iso, root=root, replace=True)
                    persisted += len(recs)
                    per_day[day_iso] = len(recs)
                time.sleep(1.0)  # politeness
        cur -= timedelta(days=1)
    return {"days": sessions, "fetched": fetched, "persisted": persisted, "per_day": per_day}


def fetch_deals() -> tuple[list[dict], str]:
    """Prefer the snapshot API, fall back to the bulk CSV, else unavailable.

    Returns ``(rows, source)`` where ``source`` is ``"nse_snapshot"`` /
    ``"nse_bulk_csv"`` / ``"unavailable"``. Never raises.
    """
    try:
        snapshot = fetch_snapshot()
    except Exception:  # noqa: BLE001
        snapshot = {}
    rows = _rows_from_snapshot(snapshot)
    if rows:
        return rows, "nse_snapshot"

    try:
        csv_rows = fetch_bulk_csv()
    except Exception:  # noqa: BLE001
        csv_rows = []
    if csv_rows:
        return csv_rows, "nse_bulk_csv"
    return [], "unavailable"


# ---------------------------------------------------------------------------
# normalize
# ---------------------------------------------------------------------------
def _instrument_type(symbol: str, name: str) -> str:
    """``invit`` for InvIT/REIT/trust names, ``etf`` for ETF names, else equity."""
    sym = _clean(symbol).upper()
    nm = _clean(name).upper()
    hay = f"{sym} {nm}"
    for marker in _INVIT_MARKERS:
        if marker in hay:
            return "invit"
    if "TRUST" in nm:
        return "invit"
    for marker in _ETF_MARKERS:
        if marker in hay:
            return "etf"
    return "equity"


def _min_cr(explicit=None) -> float:
    """Institutional value threshold (₹ Cr): explicit > ``BULK_DEAL_MIN_CR`` > 50."""
    if explicit is not None:
        try:
            val = float(explicit)
            if not (math.isnan(val) or math.isinf(val)) and val >= 0:
                return val
        except (TypeError, ValueError):
            pass
    try:
        val = float(str(os.environ.get("BULK_DEAL_MIN_CR", "")).strip())
        if not (math.isnan(val) or math.isinf(val)) and val >= 0:
            return val
    except (TypeError, ValueError):
        pass
    return DEFAULT_MIN_CR


def _is_qualifying(record: dict, min_cr: float) -> bool:
    """Institutional BUY of equity worth at least ``min_cr`` (inclusive)."""
    if str(record.get("side") or "").upper() != "BUY":
        return False
    if record.get("client_type") not in INSTITUTIONAL_TYPES:
        return False
    if record.get("instrument_type") != "equity":
        return False
    value = _num(record.get("value_cr"))
    return value is not None and value >= min_cr


def normalize(rows, *, date=None, deal_type: str = "bulk") -> list[dict]:
    """Dedupe + coerce raw NSE rows into persisted-ready deal records.

    Dedupe key: ``(symbol, client, side, qty, watp, deal_type)`` — the NSE
    snapshot repeats every deal, so a stable key is mandatory. ``deal_type``
    is taken from the row's own ``deal_type`` (set by the fetch layer) and
    falls back to the ``deal_type`` argument. Returns new dicts; never raises.
    """
    day = _day_str(date)
    threshold = _min_cr()
    out: list[dict] = []
    # keyed by the trade itself — deal_type is deliberately NOT part of it
    seen: dict = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        symbol = _clean(row.get("symbol")).upper()
        client = _clean(row.get("clientName") or row.get("client"))
        if not symbol or not client:
            continue

        side = _clean(row.get("buySell") or row.get("side")).upper()
        if side in ("B", "BUY"):
            side = "BUY"
        elif side in ("S", "SELL"):
            side = "SELL"

        qty_f = _num(row.get("qty"))
        watp_f = _num(row.get("watp"))
        qty = int(qty_f) if qty_f is not None else 0
        watp = float(watp_f) if watp_f is not None else 0.0

        dt = _clean(row.get("deal_type") or deal_type).lower() or "bulk"
        if dt not in DEAL_TYPES:
            dt = "bulk"

        key = (symbol, client, side, qty, round(watp, 4))
        idx = seen.get(key)
        if idx is not None:
            # Same trade disclosed in BOTH NSE feeds (13 of 14 block deals also
            # appear in the bulk list): keep one record, note the other list.
            prev = out[idx]
            if prev.get("deal_type") != dt and not prev.get("deal_type_alt"):
                prev["deal_type_alt"] = dt
            continue

        name = _clean(row.get("name"))
        cls = classify_client(client)
        record = {
            "date": _parse_date(row.get("date"), day),
            "symbol": symbol,
            "name": name,
            "client": client,
            "side": side,
            "qty": qty,
            "watp": watp,
            "value_cr": _r2(qty * watp / 1e7),
            "deal_type": dt,
            "client_type": cls["client_type"],
            "client_confidence": cls["client_confidence"],
            "matched_pattern": cls["matched_pattern"],
            "instrument_type": _instrument_type(symbol, name),
            "qualifying": False,
            "threshold_cr": threshold,
            "vol_z20": None,
            "close": None,
            "chg_pct": None,
            "signal_id": None,
            "captured_at": None,
            "source": "",
        }
        record["qualifying"] = _is_qualifying(record, threshold)
        out.append(_sanitize(record))
        seen[key] = len(out) - 1
    return out


def qualifying(deals, *, min_cr=None) -> list[dict]:
    """Filter to institutional BUYs of equity worth ``>= min_cr``.

    ``min_cr`` defaults to ``BULK_DEAL_MIN_CR`` (or 50). Threshold is
    inclusive: a deal at exactly ``min_cr`` qualifies. Returns new dicts with
    ``qualifying`` = True and ``threshold_cr`` set to the applied threshold.
    """
    threshold = _min_cr(min_cr)
    out: list[dict] = []
    for deal in deals or []:
        if not isinstance(deal, dict):
            continue
        if _is_qualifying(deal, threshold):
            record = dict(deal)
            record["qualifying"] = True
            record["threshold_cr"] = threshold
            out.append(record)
    return out


# ---------------------------------------------------------------------------
# enrichment (cheap, budget-aware)
# ---------------------------------------------------------------------------
def _default_history_fn(symbol: str, deal_date: str):
    """One Fyers daily series for ``symbol`` ending on ``deal_date``.

    Wrapped in ``allow_offhours`` because this is deliberate research that may
    run after the close. Returns the raw candle list or ``None``.
    """
    try:  # noqa: PLC0415 - lazy import so tests never touch Fyers
        import fyers_data  # type: ignore
        import fyers_pacer  # type: ignore
    except ImportError:
        return None
    try:
        end = _parse_date(deal_date, _now_ist().date().isoformat())
        start = (date.fromisoformat(end) - timedelta(days=60)).isoformat()
        with fyers_pacer.allow_offhours("bulk-deals-enrich"):
            return fyers_data.get_history(symbol, "D", start, end)
    except Exception:  # noqa: BLE001
        return None


def _series_metrics(candles) -> dict:
    """``{vol_z20, close, chg_pct, atr20}`` from daily candles (None-safe).

    ``vol_z20`` = z-score of the deal day's volume vs the trailing 20
    sessions (population stdev). All values are JSON-safe or ``None``.
    """
    rows: list[tuple] = []
    for c in candles or []:
        if not isinstance(c, (list, tuple)) or len(c) < 6:
            continue
        h, l, cl, v = _num(c[2]), _num(c[3]), _num(c[4]), _num(c[5])
        if None in (h, l, cl, v):
            continue
        rows.append((h, l, cl, v))
    if not rows:
        return {"vol_z20": None, "close": None, "chg_pct": None, "atr20": None}

    deal_vol = rows[-1][3]
    deal_close = rows[-1][2]
    baseline = [r[3] for r in rows[:-1]][-20:]
    vol_z = None
    if len(baseline) >= 5:
        try:
            mu = statistics.fmean(baseline)
            sd = statistics.pstdev(baseline)
            if sd > 0:
                vol_z = (deal_vol - mu) / sd
        except statistics.StatisticsError:
            vol_z = None

    chg_pct = None
    if len(rows) >= 2 and rows[-2][2] > 0:
        chg_pct = (deal_close / rows[-2][2] - 1.0) * 100.0

    trs: list[float] = []
    for i, (h, l, cl, _v) in enumerate(rows):
        prev_close = rows[i - 1][2] if i > 0 else cl
        trs.append(max(h - l, abs(h - prev_close), abs(l - prev_close)))
    atr20 = statistics.fmean(trs[-20:]) if trs else None

    return {
        "vol_z20": _r2(vol_z),
        "close": _r2(deal_close),
        "chg_pct": _r2(chg_pct),
        "atr20": _r2(atr20),
    }


def _enrich_records(records, *, history_fn=None, cap: int = MAX_ENRICH):
    """Fill ``vol_z20`` / ``close`` / ``chg_pct`` for qualifying symbols.

    Fetches **one** daily series per distinct qualifying symbol (capped at
    ``cap``, default 15). Never raises; failures leave the fields ``None``.
    Returns ``(records, enriched_count, metrics)`` where ``metrics`` maps
    symbol -> ``{vol_z20, close, chg_pct, atr20}``.
    """
    fn = history_fn or _default_history_fn
    out = [dict(r) if isinstance(r, dict) else r for r in (records or [])]

    order: list[str] = []
    deal_date: dict[str, str] = {}
    for rec in out:
        if not isinstance(rec, dict) or not rec.get("qualifying"):
            continue
        sym = rec.get("symbol")
        if not sym:
            continue
        if sym not in deal_date:
            deal_date[sym] = _day_str(rec.get("date"))
            order.append(sym)

    metrics: dict[str, dict] = {}
    for sym in order[: max(0, int(cap))]:
        try:
            candles = fn(sym, deal_date.get(sym))
        except Exception:  # noqa: BLE001
            candles = None
        metrics[sym] = _series_metrics(candles)

    enriched = 0
    for rec in out:
        if not isinstance(rec, dict):
            continue
        if not rec.get("qualifying"):
            continue
        m = metrics.get(rec.get("symbol")) or {}
        rec["vol_z20"] = m.get("vol_z20")
        rec["close"] = m.get("close")
        rec["chg_pct"] = m.get("chg_pct")
        if rec["vol_z20"] is not None:
            enriched += 1
    return out, enriched, metrics


#: Public alias for the enrichment step (``run_once``'s ``enrich`` bool param
#: would otherwise shadow it).
enrich = _enrich_records


# ---------------------------------------------------------------------------
# signal emission
# ---------------------------------------------------------------------------
def _pytest_signal_root():
    """Temp signal root under pytest (never append into the live archive)."""
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        return None
    live = ROOT / "data" / "signals"
    configured = getattr(signal_log, "DATA_DIR", None)
    try:
        if configured is not None and Path(configured).resolve() != live.resolve():
            return None  # already redirected by the test — respect it
    except OSError:  # pragma: no cover
        pass
    return Path(tempfile.gettempdir()) / "india_board_test_signals"


def _emit_signal(record: dict, metrics: dict, signal_root=None):
    """Emit one P8 LONG signal for a qualifying deal; return its id or ``None``."""
    symbol = _clean(record.get("symbol")).upper()
    if not symbol:
        return None

    close = _num(record.get("close"))
    watp = _num(record.get("watp"))
    entry = close if close else watp
    atr = _num((metrics or {}).get("atr20"))

    if entry and atr and atr > 0:
        stop = entry - 1.0 * atr
        target = entry + 2.0 * atr
        stop_basis = "atr20"
    elif entry:
        stop = entry * 0.97
        target = entry * 1.06
        stop_basis = "pct_fallback"
    else:
        stop = None
        target = None
        stop_basis = "unavailable"

    features = {
        "value_cr": record.get("value_cr"),
        "client_type": record.get("client_type"),
        "client": record.get("client"),
        "qty": record.get("qty"),
        "watp": record.get("watp"),
        "deal_type": record.get("deal_type"),
        "vol_z20": record.get("vol_z20"),
        "min_cr": record.get("threshold_cr"),
        "stop_basis": stop_basis,
        "atr20": atr,
    }
    notes = (
        f"{record.get('client_type')} BUY ₹{record.get('value_cr')} Cr "
        f"({record.get('deal_type')}) by {record.get('client')} "
        f"@ ₹{record.get('watp')} [{stop_basis}]"
    )
    try:
        sig = signal_log.make_signal(
            PLAYBOOK,
            symbol,
            side="LONG",
            features=features,
            entry_ref=_r2(entry),
            stop_ref=_r2(stop),
            target_ref=_r2(target),
            source="bulk_deal",
            notes=notes,
        )
    except Exception:  # noqa: BLE001 - a bad signal must not kill the run
        return None
    sid = signal_log.log_signal(sig, root=signal_root)
    return sid or None


# ---------------------------------------------------------------------------
# persistence
# ---------------------------------------------------------------------------
def _pytest_data_root():
    """Temp data root under pytest (never append into the live tree)."""
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        return None
    live = ROOT / "data" / "bulk_deals"
    configured = globals().get("DATA_DIR")
    try:
        if configured is not None and Path(configured).resolve() != live.resolve():
            return None  # already redirected by the test — respect it
    except OSError:  # pragma: no cover
        pass
    return Path(tempfile.gettempdir()) / "india_board_test_bulk_deals"


def _data_root(root=None) -> Path:
    """Resolve the JSONL root (explicit > pytest temp > :data:`DATA_DIR`)."""
    if root is not None:
        return Path(root)
    safe = _pytest_data_root()
    return safe if safe is not None else DATA_DIR


def persist(records, *, date=None, root=None, replace: bool = False) -> int:
    """Write deduped deal records to ``{root}/{date}.jsonl`` (one file per date).

    Groups by each record's own ``date`` (falling back to ``date`` then today),
    writes all lines in a single write, prunes >400 days best-effort. Returns
    the number of records written. Never raises.

    ``replace=True`` rewrites the day's file instead of appending — a day's NSE
    disclosure is a *snapshot*, so a re-capture (restart, manual run) must not
    duplicate every deal.
    """
    try:
        base = _data_root(root)
        groups: dict[str, list] = {}
        for rec in records or []:
            if not isinstance(rec, dict):
                continue
            day = _day_str(rec.get("date") or date)
            groups.setdefault(day, []).append(_sanitize(rec))
        total = 0
        for day, recs in groups.items():
            dest = base / f"{day}.jsonl"
            dest.parent.mkdir(parents=True, exist_ok=True)
            lines = [
                json.dumps(_json_safe(r), separators=(",", ":"), allow_nan=False)
                for r in recs
            ]
            mode = "w" if replace else "a"
            with open(dest, mode, encoding="utf-8") as fh:
                fh.write("\n".join(lines) + "\n")
                fh.flush()
            total += len(recs)
        prune_bulk_deals(root=base)
        return total
    except Exception as exc:  # noqa: BLE001 - persistence is best-effort
        print(f"[bulk-deals] persist failed: {type(exc).__name__}: {exc}"[:160], flush=True)
        return 0


def _read_file(path: Path) -> list[dict]:
    try:
        if not path.is_file():
            return []
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
    except Exception as exc:  # noqa: BLE001
        print(f"[bulk-deals] read failed: {type(exc).__name__}", flush=True)
        return []
    out: list[dict] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except (ValueError, TypeError):
            continue  # skip malformed lines
        if isinstance(rec, dict):
            out.append(rec)
    return out


def read_day(date=None, root=None) -> list[dict]:
    """Records stored for one IST day (default today); malformed lines skipped."""
    base = _data_root(root)
    return _read_file(base / f"{_day_str(date)}.jsonl")


def history(days=None, root=None) -> list[dict]:
    """All records across the last ``days`` day-files, oldest first.

    ``days=None`` returns every file. Missing roots yield ``[]``.
    """
    base = _data_root(root)
    try:
        if not base.is_dir():
            return []
        files = sorted(base.glob("*.jsonl"))
    except OSError:
        return []
    if days is not None:
        try:
            n = int(days)
            if n > 0:
                files = files[-n:]
        except (TypeError, ValueError):
            pass
    out: list[dict] = []
    for path in files:
        out.extend(_read_file(path))
    out.sort(key=lambda r: (str(r.get("date") or ""), str(r.get("symbol") or "")))
    return out


def prune_bulk_deals(root=None, keep_days: int = KEEP_DAYS, today=None) -> int:
    """Delete ``*.jsonl`` older than ``keep_days``; return the count removed."""
    base = _data_root(root)
    ref = _now_ist(today).date()
    try:
        cutoff = ref - timedelta(days=int(keep_days))
    except (TypeError, ValueError):
        cutoff = ref - timedelta(days=KEEP_DAYS)
    removed = 0
    try:
        if not base.is_dir():
            return 0
        for path in base.glob("*.jsonl"):
            day = _parse_date(path.stem)
            if day is None:
                continue
            try:
                if date.fromisoformat(day) < cutoff:
                    path.unlink()
                    removed += 1
            except (ValueError, OSError):
                continue
    except Exception as exc:  # noqa: BLE001
        print(f"[bulk-deals] prune failed: {type(exc).__name__}", flush=True)
    return removed


# ---------------------------------------------------------------------------
# one-shot pipeline
# ---------------------------------------------------------------------------
def _rows_day(rows, fallback: str) -> str:
    """Majority ``YYYY-MM-DD`` from the rows' own NSE ``date`` fields.

    NSE's snapshot carries its own session date (``30-Sep-2026``) which can
    differ from the wall clock — e.g. a capture that runs after midnight, or a
    restart the next morning. Trusting the data keeps the archive from being
    mislabelled.
    """
    from collections import Counter  # noqa: PLC0415

    stamps: Counter = Counter()
    for row in rows or []:
        if isinstance(row, dict):
            parsed = _parse_date(row.get("date"))
            if parsed:
                stamps[parsed] += 1
    return stamps.most_common(1)[0][0] if stamps else fallback


def run_once(
    *,
    date=None,
    min_cr=None,
    enrich: bool = True,
    root=None,
    fetcher=None,
    history_fn=None,
    signal_root=None,
    now=None,
    quota: int = MAX_ENRICH,
) -> dict:
    """Run the full pipeline once and return a summary.

    Returns ``{date, total, qualifying, qualifying_value_cr, by_client_type,
    source, enriched, signals}``. ``by_client_type`` is the breakdown **over
    qualifying deals**. ``fetcher`` / ``history_fn`` are injectable for tests
    (defaults: :func:`fetch_deals` / :func:`_default_history_fn`). Never raises.
    """
    day = _day_str(date or _now_ist(now).date())
    source = "unavailable"
    rows: list[dict] = []
    try:
        if fetcher is not None:
            result = fetcher()
            if isinstance(result, tuple) and len(result) == 2:
                rows, source = result
            else:
                rows = list(result or [])
                source = "nse_snapshot"
        else:
            rows, source = fetch_deals()
    except Exception as exc:  # noqa: BLE001
        print(f"[bulk-deals] fetch failed: {type(exc).__name__}", flush=True)
        rows, source = [], "unavailable"

    # The disclosed session date wins over the wall clock (see _rows_day).
    if date is None and rows:
        day = _rows_day(rows, day)

    try:
        records = normalize(rows, date=day)
    except Exception as exc:  # noqa: BLE001
        print(f"[bulk-deals] normalize failed: {type(exc).__name__}", flush=True)
        records = []

    threshold = _min_cr(min_cr)
    for rec in records:
        rec["qualifying"] = _is_qualifying(rec, threshold)
        rec["threshold_cr"] = threshold

    enriched = 0
    metrics: dict[str, dict] = {}
    if enrich and any(r.get("qualifying") for r in records):
        try:
            records, enriched, metrics = _enrich_records(
                records, history_fn=history_fn, cap=quota
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[bulk-deals] enrich failed: {type(exc).__name__}", flush=True)

    sig_root = signal_root if signal_root is not None else _pytest_signal_root()
    signals = 0
    for rec in records:
        if not rec.get("qualifying"):
            continue
        sid = _emit_signal(rec, metrics.get(rec.get("symbol")) or {}, sig_root)
        rec["signal_id"] = sid
        if sid:
            signals += 1

    captured = _now_ist(now).isoformat()
    for rec in records:
        rec["source"] = source
        rec["captured_at"] = captured

    # A day's disclosure is a snapshot: re-captures must replace, not append.
    persist(records, date=day, root=root, replace=True)

    qual_records = [r for r in records if r.get("qualifying")]
    by_type: dict[str, int] = {}
    for rec in qual_records:
        key = str(rec.get("client_type") or "unknown")
        by_type[key] = by_type.get(key, 0) + 1
    qual_value = _r2(
        sum(_num(r.get("value_cr")) or 0.0 for r in qual_records)
    )
    return {
        "date": day,
        "total": len(records),
        "qualifying": len(qual_records),
        "qualifying_value_cr": qual_value,
        "by_client_type": by_type,
        "source": source,
        "enriched": enriched,
        "signals": signals,
    }


# ---------------------------------------------------------------------------
# read API for the dashboard (day payload + latest captured day)
# ---------------------------------------------------------------------------

def _summary(records: list[dict]) -> dict:
    """Aggregate a day's records the way the UI/endpoint contract expects."""
    qual = [r for r in records if r.get("qualifying")]
    by_type: dict[str, dict] = {}
    for rec in qual:
        key = str(rec.get("client_type") or "unknown")
        bucket = by_type.setdefault(key, {"count": 0, "value_cr": 0.0})
        bucket["count"] += 1
        bucket["value_cr"] = _r2((bucket["value_cr"] or 0.0) + (_num(rec.get("value_cr")) or 0.0))
    return {
        "count": len(records),
        "qualifying_count": len(qual),
        "qualifying_value_cr": _r2(sum(_num(r.get("value_cr")) or 0.0 for r in qual)),
        "by_client_type": by_type,
    }


def day_payload(date=None, *, root=None) -> dict:
    """Endpoint payload for one captured day (never raises, always JSON-safe).

    Contract: ``{date, count, qualifying_count, qualifying_value_cr,
    by_client_type, deals, unavailable}`` with deals sorted by value desc.
    """
    try:
        day = _parse_date(date) or _day_str(date)
    except Exception:  # noqa: BLE001
        day = None
    records: list[dict] = []
    try:
        records = read_day(day, root=root) if day else []
    except Exception:  # noqa: BLE001
        records = []
    if not records:
        return {
            "date": day,
            "count": 0,
            "qualifying_count": 0,
            "qualifying_value_cr": 0.0,
            "by_client_type": {},
            "deals": [],
            "unavailable": True,
            "reason": f"no captured deals for {day or 'the requested date'}",
        }
    deals = sorted(
        (_sanitize(r) for r in records),
        key=lambda r: _num(r.get("value_cr")) or 0.0,
        reverse=True,
    )
    out = {"date": day, "deals": deals, "unavailable": False}
    out.update(_summary(deals))
    return out


def latest_date(*, root=None) -> str | None:
    """Newest ``YYYY-MM-DD`` filename in the capture tree, or ``None``."""
    try:
        base = _data_root(root)
        days = sorted(p.stem for p in base.glob("*.jsonl") if p.stem)
        return days[-1] if days else None
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# scheduler
# ---------------------------------------------------------------------------
_STARTED = False
_LAST_RUN_DAY: str | None = None


def _deal_hour() -> int:
    """``BULK_DEAL_HOUR`` (default 18) — the IST hour at/after which to run."""
    try:
        val = int(str(os.environ.get("BULK_DEAL_HOUR", "")).strip())
        return val if 0 <= val <= 23 else DEFAULT_DEAL_HOUR
    except (TypeError, ValueError):
        return DEFAULT_DEAL_HOUR


def _is_due(now=None, last_day: str | None = None) -> bool:
    """True on a weekday at/after ``BULK_DEAL_HOUR`` that has not run yet."""
    cur = _now_ist(now)
    if cur.weekday() >= 5:  # Sat / Sun
        return False
    if cur.hour < _deal_hour():
        return False
    return last_day != cur.date().isoformat()


def _loop() -> None:
    global _LAST_RUN_DAY
    print(
        f"[bulk-deals] scheduler started (hour {_deal_hour()} IST, "
        f"tick {SCHED_TICK_SEC}s)",
        flush=True,
    )
    while True:
        try:
            if _is_due(now=None, last_day=_LAST_RUN_DAY):
                result = run_once()
                if result.get("source") != "unavailable":
                    _LAST_RUN_DAY = _now_ist().date().isoformat()
                print(
                    f"[bulk-deals] {result['date']}: {result['total']} deals, "
                    f"{result['qualifying']} qualifying "
                    f"(₹{result['qualifying_value_cr']} Cr), "
                    f"source={result['source']}",
                    flush=True,
                )
        except Exception as exc:  # noqa: BLE001 - never kill the dashboard
            print(
                f"[bulk-deals] scheduler error: {type(exc).__name__}: {exc}"[:160],
                flush=True,
            )
        time.sleep(SCHED_TICK_SEC)


def ensure_started() -> None:
    """Start the once-per-weekday bulk-deal daemon (idempotent, never raises)."""
    global _STARTED
    if _STARTED:
        return
    _STARTED = True
    threading.Thread(target=_loop, name="bulk-deals", daemon=True).start()


if __name__ == "__main__":  # pragma: no cover - manual smoke
    import argparse

    ap = argparse.ArgumentParser(description="NSE bulk/block deals (P8)")
    ap.add_argument("--date", default=None, help="override date YYYY-MM-DD")
    ap.add_argument("--min-cr", type=float, default=None, help="value threshold (₹ Cr)")
    ap.add_argument("--no-enrich", action="store_true", help="skip Fyers enrichment")
    args = ap.parse_args()
    out = run_once(date=args.date, min_cr=args.min_cr, enrich=not args.no_enrich)
    print(json.dumps(out, indent=2))
