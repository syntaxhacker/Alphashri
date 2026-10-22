"""US futures + options report API (``/api/reports/us``).

Read-only. The recorder writes the tape; these routes only read it, except
``/live`` which may fetch one fresh snapshot when the tape is empty.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api.reports_api import us_chain, us_tape

router = APIRouter(prefix="/api/reports/us", tags=["reports-us"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _date(value: Optional[str]) -> str:
    date_str = value or us_tape.now_et().date().isoformat()
    if not _DATE_RE.match(date_str):
        raise HTTPException(status_code=400, detail=f"bad date {date_str!r}")
    return date_str


@router.get("/roots")
def get_roots():
    """Configured futures roots (NQ only for now)."""
    return {
        "roots": [{"root": r, "label": m["label"], "tv": m["tv"]} for r, m in us_chain.ROOTS.items()],
        "recording": list(us_tape.ROOTS),
    }


@router.get("/live")
def get_live(root: str = Query("NQ")):
    """Latest tape row for ``root`` (one upstream fetch only if the tape is empty)."""
    if root not in us_chain.ROOTS:
        raise HTTPException(status_code=400, detail=f"unsupported root {root!r}")
    date_str = us_tape.now_et().date().isoformat()
    rows = us_tape.read_tape(root, date_str)
    if rows:
        return {"date": date_str, "row": rows[-1], "source": "tape"}
    try:
        row = us_chain.snapshot(root)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"chain fetch failed: {exc}") from exc
    return {"date": date_str, "row": row, "source": "live"}


@router.get("/tape")
def get_tape(root: str = Query("NQ"), date: Optional[str] = Query(None)):
    """Every recorded minute for a day, oldest first (replay frames)."""
    date_str = _date(date)
    rows = us_tape.read_tape(root, date_str)
    if not rows:
        raise HTTPException(status_code=404, detail={
            "date": date_str, "root": root, "message": "no tape recorded",
        })
    return {
        "root": root,
        "date": date_str,
        "interval_sec": us_tape.INTERVAL_SEC,
        "minutes": len(rows),
        "rows": rows,
    }


@router.get("/eod")
def get_eod(root: str = Query("NQ"), date: Optional[str] = Query(None)):
    """Settled end-of-day card derived from the tape."""
    date_str = _date(date)
    summary = us_tape.eod_summary(root, date_str)
    if summary is None:
        raise HTTPException(status_code=404, detail={
            "date": date_str, "root": root, "message": "no tape recorded",
        })
    return summary


@router.get("/replay/dates")
def get_replay_dates(root: str = Query("NQ"), limit: int = Query(30, ge=1, le=180)):
    return {"root": root, "dates": us_tape.replay_dates(root, limit)}


@router.get("/tape/status")
def get_tape_status():
    return us_tape.tape_status()
