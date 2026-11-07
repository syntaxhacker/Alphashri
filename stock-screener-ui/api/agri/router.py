"""Agri-commodity mandi prices: GET /api/agri/prices.

Reads the daily scalp CSV built by scripts/market/agri_collect.py
(reports/agri/daily_prices.csv) and returns:
  - latest snapshot (latest modal price per commodity across markets)
  - time series for one commodity (modal price over time, state-level median)

Endpoints are read-only and unauthenticated (market data, consistent with the
chart/market-data endpoints — no broker OAuth needed).
"""

from __future__ import annotations

import csv
import logging
import statistics
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query

from api.reports_api._numeric import safe_opt_float as _num

router = APIRouter(prefix="/api/agri", tags=["agri"])
logger = logging.getLogger("agri.router")

CSV_PATH = Path("reports/agri/daily_prices.csv")

# Commodities we track — display name -> Agmarknet commodity value(s)
COMMODITIES = [
    {"key": "rice", "label": "Rice", "values": ["Rice"]},
    {"key": "wheat", "label": "Wheat", "values": ["Wheat"]},
    {"key": "arhar_tur", "label": "Arhar (Tur) Dal", "values": ["Arhar(Tur)", "Arhar", "Tur"]},
    {"key": "urad", "label": "Urad Dal", "values": ["Urad"]},
    {"key": "moong", "label": "Moong Dal", "values": ["Moong"]},
    {"key": "masoor", "label": "Masoor Dal", "values": ["Masoor"]},
    {"key": "chana", "label": "Chana / Gram Dal", "values": ["Chana", "Gram Dal", "Gram dal", "Chana Dal"]},
    {"key": "soyabean", "label": "Soyabean", "values": ["Soyabean"]},
    {"key": "onion", "label": "Onion", "values": ["Onion"]},
    {"key": "potato", "label": "Potato", "values": ["Potato"]},
    {"key": "tomato", "label": "Tomato", "values": ["Tomato"]},
]


def _parse_date(d: str) -> Optional[datetime]:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(d.strip(), fmt)
        except ValueError:
            continue
    return None


def _load_rows() -> list[dict[str, Any]]:
    if not CSV_PATH.exists():
        return []
    rows: list[dict[str, Any]] = []
    with open(CSV_PATH, newline="") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def _latest_snapshot(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Latest modal price per commodity (median across markets on the latest date)."""
    if not rows:
        return []
    # Latest arrival_date present
    dates = {_parse_date(r.get("arrival_date", "")) for r in rows}
    dates = {d for d in dates if d is not None}
    if not dates:
        return []
    latest = max(dates)
    latest_str = latest.strftime("%d/%m/%Y")

    by_commodity: dict[str, list[float]] = {}
    for r in rows:
        if _parse_date(r.get("arrival_date", "")) != latest:
            continue
        modal = _num(r.get("modal_price"))
        if modal is None:
            continue
        comm = (r.get("commodity") or "").strip()
        by_commodity.setdefault(comm, []).append(modal)

    out: list[dict[str, Any]] = []
    for item in COMMODITIES:
        mods: list[float] = []
        for val in item["values"]:
            mods.extend(by_commodity.get(val, []))
        if not mods:
            continue
        out.append({
            "key": item["key"],
            "label": item["label"],
            "date": latest_str,
            "modal": round(statistics.median(mods), 2),
            "min": round(min(mods), 2),
            "max": round(max(mods), 2),
            "markets": len(mods),
        })
    out.sort(key=lambda x: x["label"])
    return out


def _series(rows: list[dict[str, Any]], commodity_values: list[str]) -> list[dict[str, Any]]:
    """Daily median modal price over time for the given commodity values."""
    by_date: dict[str, list[float]] = {}
    for r in rows:
        comm = (r.get("commodity") or "").strip()
        if comm not in commodity_values:
            continue
        modal = _num(r.get("modal_price"))
        if modal is None:
            continue
        arrival = (r.get("arrival_date") or "").strip()
        by_date.setdefault(arrival, []).append(modal)

    out: list[dict[str, Any]] = []
    for arrival, mods in by_date.items():
        d = _parse_date(arrival)
        if d is None:
            continue
        out.append({
            "date": d.strftime("%Y-%m-%d"),
            "arrival": arrival,
            "modal": round(statistics.median(mods), 2),
        })
    out.sort(key=lambda x: x["date"])
    return out


@router.get("/prices")
def get_agri_prices(
    commodity: Optional[str] = Query(None, description="Commodity key (rice, wheat, arhar_tur, urad, moong, masoor, chana, soyabean, onion, potato, tomato)"),
):
    rows = _load_rows()
    snapshot = _latest_snapshot(rows)

    series: list[dict[str, Any]] = []
    selected: Optional[dict[str, Any]] = None
    if commodity:
        item = next((c for c in COMMODITIES if c["key"] == commodity), None)
        if item:
            selected = {"key": item["key"], "label": item["label"]}
            series = _series(rows, item["values"])

    return {
        "ok": True,
        "source": str(CSV_PATH),
        "rows_loaded": len(rows),
        "snapshot": snapshot,
        "selected": selected,
        "series": series,
    }


@router.get("/commodities")
def get_agri_commodities():
    return {
        "ok": True,
        "commodities": [{"key": c["key"], "label": c["label"]} for c in COMMODITIES],
    }
