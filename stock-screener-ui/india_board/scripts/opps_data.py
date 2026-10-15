#!/usr/bin/env python3
"""Market-wide intraday opportunities screener data.

Wraps `/api/screener/stocks` (50 rows, 200+ fields) and keeps only the fields
the Opportunities view needs, with a short cache so the browser stays fast.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402

_NUM = (
    "close one_day_perc relative_volume iv_rank iv_percentile_1y net_premium "
    "gex_daily_net_gex one_week_perc z_score rsi_14 atr_14 put_call_ratio "
    "week_52_high week_52_low implied_move_perc short_int marketcap "
    "stock_volume avg30_volume call_premium put_premium"
).split()
_FIELDS = ["ticker", "full_name", "sector"] + _NUM
_CACHE: dict = {"ts": 0.0, "rows": None}
_TTL = 60


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def build_opps() -> dict:
    now = time.time()
    if _CACHE["rows"] is not None and now - _CACHE["ts"] < _TTL:
        return {"rows": _CACHE["rows"]}
    rows: list[dict] = []
    try:
        c = UWClient()
        r = c.get("/api/screener/stocks", timeout=30)
        if r.status_code == 200:
            for x in r.json().get("data") or []:
                row = {k: x.get(k) for k in _FIELDS}
                for k in _NUM:
                    row[k] = _f(row.get(k))
                rows.append(row)
    except Exception:  # noqa: BLE001
        rows = []
    _CACHE["ts"] = now
    _CACHE["rows"] = rows
    return {"rows": rows}
