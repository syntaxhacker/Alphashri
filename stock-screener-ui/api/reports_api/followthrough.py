"""Follow-through report: how did a past breakout/breakdown report perform since?

Reads the stored daily report for ``date`` from the breakouts disk cache
(``experiments/data/reports/breakouts/{date}_{universe}.json``) and evaluates
each row against the latest 1D candles from our own disk cache
(``chart_patterns.candles`` — never TradingView).

For every breakout/breakdown row, performance is measured from the report
date's close (``ref_close``) to the latest close:

* ``ret_pct`` — signed ``(last - ref) / ref * 100``.
* ``max_fav_pct`` — best move in the trade's direction since the report date
  (longs: ``(max high - ref)/ref``; shorts: ``(ref - min low)/ref``).
* ``max_adv_pct`` — worst move against the trade since (longs:
  ``(min low - ref)/ref``; shorts: ``(ref - max high)/ref``).
* ``held`` — breakouts: no close below ``level`` since; breakdowns: no close
  above ``level`` since. The "since" window is bars strictly after the report
  date (IST session dates).

Fan-out is threads-only via ``chart_patterns.parallel.run_symbols`` (never
fork inside a request). Past-date payloads are immutable disk JSON under
``experiments/data/reports/followthrough/`` (read-through). A ``date`` of
today or later is evaluated against the latest available tape and marked
``partial: true`` (never disk-cached). Everything is fail-soft — errors yield
empty sections, never a 500.
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from functools import partial
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query

import config as root_config
from api.reports_api import breakouts as breakouts_mod
from chart_patterns.candles import fetch_for_timeframe
from chart_patterns.parallel import max_workers, run_symbols

router = APIRouter(prefix="/api/reports", tags=["reports"])

REPORT_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "experiments"
    / "data"
    / "reports"
    / "followthrough"
)

_MAX_WORKERS = 8


def _now_iso() -> str:
    try:
        return datetime.now(root_config.IST).isoformat()
    except Exception:
        return datetime.now().astimezone().isoformat()


def _today_str() -> str:
    try:
        return datetime.now(root_config.IST).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().astimezone().strftime("%Y-%m-%d")


def _f(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(out):
        return default
    return out


def _bar_ist_dates(df) -> list[str]:
    """Per-bar IST session dates (``YYYY-MM-DD``) for a candle frame.

    Candle indexes are UTC; a bar stamped 18:30 UTC or later belongs to the
    next IST session. Unparseable indexes yield ``""`` (never raises).
    """
    try:
        import pandas as pd

        out: list[str] = []
        for ts in df.index:
            try:
                pts = pd.Timestamp(ts)
                if pts.tz is None:
                    pts = pts.tz_localize("UTC")
                out.append(pts.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d"))
            except Exception:
                out.append("")
        return out
    except Exception:
        return []


def _empty_section() -> dict:
    return {"count": 0, "winners": 0, "losers": 0, "avg_ret": 0.0, "rows": []}


def _empty_payload(date_str: str, universe: str, *, partial: bool = False) -> dict:
    return {
        "date": date_str,
        "universe": universe,
        "as_of": _now_iso(),
        "cached": False,
        "partial": partial,
        "breakouts": _empty_section(),
        "breakdowns": _empty_section(),
    }


def _disk_path(date_str: str, universe: str) -> Path:
    safe_u = "".join(c for c in universe if c.isalnum() or c in ("-", "_"))
    return REPORT_DIR / f"{date_str}_{safe_u or 'universe'}.json"


def _load_report(date_str: str, universe: str) -> dict:
    """Stored breakouts report for ``date``; computed on demand if missing.

    Reads ``breakouts._disk_path`` directly so tests can point
    ``breakouts_mod.REPORT_DIR`` at tmp. Falls back to that module's
    ``compute_report`` (imported, never copied). Never raises.
    """
    try:
        path = breakouts_mod._disk_path(date_str, universe)
    except Exception:
        path = None
    try:
        if path is not None and path.exists():
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                return payload
    except Exception:
        pass
    try:
        payload = breakouts_mod.compute_report(date_str, universe)
        if isinstance(payload, dict):
            return payload
    except Exception:
        pass
    return {}


def evaluate_row(
    symbol: str,
    *,
    name: str = "",
    type: str = "",
    level: float = 0.0,
    ref_close: float = 0.0,
    side: str = "up",
    date_str: str = "",
) -> Optional[dict]:
    """Evaluate one report row against the latest 1D candles.

    Top-level function (thread-pool safe). Returns the follow-through row or
    ``None`` when the frame is unusable. Never raises.
    """
    try:
        sym = str(symbol).upper()
        lvl = _f(level)
        ref = _f(ref_close)
        if not sym or lvl <= 0 or ref <= 0 or not date_str:
            return None
        df = fetch_for_timeframe(sym, "1D")
        if df is None or getattr(df, "empty", True):
            return None
        try:
            closes = [_f(v) for v in df["close"].tolist()]
            highs = [_f(v) for v in df["high"].tolist()]
            lows = [_f(v) for v in df["low"].tolist()]
        except Exception:
            return None
        if not closes or any(v <= 0 for v in closes):
            # A single bad bar poisons extremes; require all closes sane.
            # Highs/lows only need the since-window sane (checked below).
            return None
        last_close = closes[-1]
        if last_close <= 0:
            return None
        ret_pct = (last_close - ref) / ref * 100.0
        dates = _bar_ist_dates(df)
        since_idx = [i for i, d in enumerate(dates) if d and d > date_str]
        if not since_idx:
            max_fav = 0.0
            max_adv = 0.0
            held = True
        else:
            s_highs = [highs[i] for i in since_idx if highs[i] > 0]
            s_lows = [lows[i] for i in since_idx if lows[i] > 0]
            s_closes = [closes[i] for i in since_idx]
            if not s_highs or not s_lows or not s_closes:
                return None
            if side == "down":
                max_fav = (ref - min(s_lows)) / ref * 100.0
                max_adv = (ref - max(s_highs)) / ref * 100.0
                held = all(c <= lvl for c in s_closes)
            else:
                max_fav = (max(s_highs) - ref) / ref * 100.0
                max_adv = (min(s_lows) - ref) / ref * 100.0
                held = all(c >= lvl for c in s_closes)
        return {
            "symbol": sym,
            "name": name or sym,
            "type": type,
            "level": round(lvl, 4),
            "ref_close": round(ref, 4),
            "last_close": round(last_close, 4),
            "ret_pct": round(ret_pct, 4),
            "max_fav_pct": round(max_fav, 4),
            "max_adv_pct": round(max_adv, 4),
            "held": bool(held),
        }
    except Exception:
        return None


def _eval_one(symbol: str, *, jobs: dict, date_str: str) -> Optional[dict]:
    """Thread-pool shim: look up the job and evaluate it. Never raises."""
    try:
        job = (jobs or {}).get(str(symbol).upper())
        if not isinstance(job, dict):
            return None
        return evaluate_row(
            str(symbol).upper(),
            name=job.get("name", ""),
            type=job.get("type", ""),
            level=job.get("level", 0.0),
            ref_close=job.get("ref_close", 0.0),
            side=job.get("side", "up"),
            date_str=date_str,
        )
    except Exception:
        return None


def _summarize(rows: list[dict], *, side: str) -> dict:
    """Aggregate evaluated rows into a section payload.

    Winners mirror by side: breakouts win when ``ret_pct > 0``, breakdowns
    (shorts) win when ``ret_pct < 0``. Zeros count as neither.
    """
    try:
        clean = [r for r in rows if isinstance(r, dict)]
        if side == "down":
            winners = sum(1 for r in clean if _f(r.get("ret_pct")) < 0)
            losers = sum(1 for r in clean if _f(r.get("ret_pct")) > 0)
            clean.sort(key=lambda r: _f(r.get("ret_pct")))
        else:
            winners = sum(1 for r in clean if _f(r.get("ret_pct")) > 0)
            losers = sum(1 for r in clean if _f(r.get("ret_pct")) < 0)
            clean.sort(key=lambda r: _f(r.get("ret_pct")), reverse=True)
        avg = sum(_f(r.get("ret_pct")) for r in clean) / len(clean) if clean else 0.0
        return {
            "count": len(clean),
            "winners": winners,
            "losers": losers,
            "avg_ret": round(avg, 4),
            "rows": clean,
        }
    except Exception:
        return _empty_section()


def compute_followthrough(date_str: str, universe: str) -> dict:
    """Build the follow-through payload (no caching). Fail-soft, never raises."""
    try:
        is_partial = date_str >= _today_str()
        report = _load_report(date_str, universe)
        if not isinstance(report, dict):
            return _empty_payload(date_str, universe, partial=is_partial)
        jobs: dict[str, dict] = {}
        up_syms: list[str] = []
        down_syms: list[str] = []
        try:
            up_rows = (report.get("breakouts") or {}).get("rows") or []
            down_rows = (report.get("breakdowns") or {}).get("rows") or []
        except Exception:
            up_rows, down_rows = [], []
        for side, section_rows in (("up", up_rows), ("down", down_rows)):
            for row in section_rows:
                try:
                    if not isinstance(row, dict):
                        continue
                    sym = str(row.get("symbol") or "").upper()
                    if not sym or sym in jobs:
                        continue
                    jobs[sym] = {
                        "name": row.get("name") or sym,
                        "type": row.get("type") or "",
                        "level": _f(row.get("level")),
                        "ref_close": _f(row.get("close")),
                        "side": side,
                    }
                    (down_syms if side == "down" else up_syms).append(sym)
                except Exception:
                    continue
        try:
            workers = max_workers()
        except Exception:
            workers = 4
        try:
            workers = max(1, min(int(workers), _MAX_WORKERS))
        except Exception:
            workers = 4
        try:
            fn = partial(_eval_one, jobs=jobs, date_str=date_str)
            # Threads only — never fork inside a request.
            results = run_symbols(
                fn, list(jobs), workers=workers, use_processes=False
            )
        except Exception:
            results = []
        up_out = [r for r in results or [] if isinstance(r, dict) and jobs.get(r.get("symbol", ""), {}).get("side") == "up"]
        down_out = [r for r in results or [] if isinstance(r, dict) and jobs.get(r.get("symbol", ""), {}).get("side") == "down"]
        _ = (up_syms, down_syms)
        return {
            "date": date_str,
            "universe": universe,
            "as_of": _now_iso(),
            "cached": False,
            "partial": is_partial,
            "breakouts": _summarize(up_out, side="up"),
            "breakdowns": _summarize(down_out, side="down"),
        }
    except Exception:
        try:
            return _empty_payload(date_str, universe, partial=False)
        except Exception:
            return {
                "date": "", "universe": "", "as_of": "", "cached": False,
                "partial": False,
                "breakouts": _empty_section(), "breakdowns": _empty_section(),
            }


def serve_followthrough(date_str: str, universe: str) -> dict:
    """Serve with caching: past dates read through immutable disk JSON.

    ``partial`` (today/future) payloads are always recomputed and never
    written — the tape is still moving. Never raises.
    """
    try:
        is_partial = date_str >= _today_str()
        if not is_partial:
            try:
                path = _disk_path(date_str, universe)
                if path.exists():
                    payload = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(payload, dict):
                        payload["cached"] = True
                        return payload
            except Exception:
                pass
        payload = compute_followthrough(date_str, universe)
        if not is_partial:
            try:
                path = _disk_path(date_str, universe)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(payload), encoding="utf-8")
            except Exception:
                pass
        return payload
    except Exception:
        try:
            return compute_followthrough(date_str, universe)
        except Exception:
            return _empty_payload(date_str, universe, partial=False)


@router.get("/follow-through")
def get_follow_through(
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD, default today IST"),
    universe: str = Query(default="nifty500"),
):
    """Follow-through since a past breakout/breakdown report (own 1D candles)."""
    try:
        today = _today_str()
        raw = (date or "").strip()
        date_str = raw or today
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except (ValueError, TypeError):
            return _empty_payload(str(date), (universe or "").strip().lower() or "nifty500")
        try:
            # Clamp any date beyond the last completed session back to it
            # (same rule as the breakouts endpoint).
            from chart_patterns.candles import _last_completed_session

            last_done = _last_completed_session().isoformat()
        except Exception:
            last_done = today
        if date_str > last_done:
            date_str = last_done
        univ = (universe or "").strip().lower() or "nifty500"
        return serve_followthrough(date_str, univ)
    except Exception:
        try:
            return _empty_payload(str(date or ""), str(universe or ""))
        except Exception:
            return {"date": "", "universe": "", "as_of": "", "cached": False,
                    "partial": False,
                    "breakouts": _empty_section(), "breakdowns": _empty_section()}
