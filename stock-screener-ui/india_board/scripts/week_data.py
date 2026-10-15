#!/usr/bin/env python3
"""Forward-looking "next week" data: earnings calendar + next-expiry index levels.

- /api/earnings/premarket|afterhours?date=YYYY-MM-DD  -> companies reporting
- /api/stock/{t}/gex-levels + /api/stock/{t}/max-pain -> next Friday's levels
(The economic and FDA calendars return no future events on this token.)
"""
from __future__ import annotations

import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402

_CACHE: dict = {"ts": 0.0, "payload": None}
_TTL = 1800  # 30 min
_NUM = ("expected_move_perc marketcap")


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _next_week() -> list[date]:
    t = date.today()
    ahead = (0 - t.weekday()) % 7 or 7  # next Monday
    mon = t + timedelta(days=ahead)
    return [mon + timedelta(days=i) for i in range(5)]


def _earn(c: UWClient, kind: str, day: date) -> list[dict]:
    try:
        r = c.get(f"/api/earnings/{kind}", timeout=25, date=day.isoformat())
        rows = r.json().get("data") if r.status_code == 200 else []
    except Exception:  # noqa: BLE001
        rows = []
    out = []
    for x in rows or []:
        out.append(
            {
                "date": day.isoformat(),
                "session": "premarket" if kind == "premarket" else "afterhours",
                "symbol": x.get("symbol"),
                "name": x.get("full_name"),
                "sector": x.get("sector"),
                "report_time": x.get("report_time"),
                "expected_move_perc": _f(x.get("expected_move_perc")),
                "marketcap": _f(x.get("marketcap")),
                "has_options": bool(x.get("has_options")),
                "is_sp500": bool(x.get("is_s_p_500")),
            }
        )
    return out


def _index_levels(c: UWClient, expiry: str) -> list[dict]:
    out = []
    for t in ("SPX", "NDX", "SPY", "QQQ"):
        try:
            g = c.get(f"/api/stock/{t}/gex-levels", timeout=20)
            gx = g.json().get("data") if g.status_code == 200 else {}
            mp = c.get(f"/api/stock/{t}/max-pain", timeout=20)
            rows = mp.json().get("data") if mp.status_code == 200 else []
        except Exception:  # noqa: BLE001
            continue
        gx = gx or {}
        row = next((r for r in (rows or []) if str(r.get("expiry")) == expiry), None) or (rows or [{}])[0]
        out.append(
            {
                "ticker": t,
                "call_wall": gx.get("call_wall"),
                "put_wall": gx.get("put_wall"),
                "gamma_flip": gx.get("gamma_flip"),
                "gamma_magnet": gx.get("gamma_magnet"),
                "max_pain": (row or {}).get("max_pain"),
                "close": (row or {}).get("close"),
                "expiry": (row or {}).get("expiry"),
            }
        )
    return out


def build_week() -> dict:
    now = time.time()
    if _CACHE["payload"] is not None and now - _CACHE["ts"] < _TTL:
        return _CACHE["payload"]
    c = UWClient()
    days = _next_week()
    earn: list[dict] = []
    for d in days:
        earn += _earn(c, "premarket", d)
        earn += _earn(c, "afterhours", d)
    expiry = days[-1].isoformat()  # next Friday (weekly OPEX)
    payload = {
        "week_start": days[0].isoformat(),
        "week_end": days[-1].isoformat(),
        "expiry": expiry,
        "earnings": earn,
        "index_levels": _index_levels(c, expiry),
    }
    _CACHE["ts"] = now
    _CACHE["payload"] = payload
    return payload
