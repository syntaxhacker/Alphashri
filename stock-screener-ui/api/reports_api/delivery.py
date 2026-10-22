"""Daily Report delivery-% and results/events endpoints (``/api/reports``).

Two read-only, fail-soft companions to the market/breakout report:

* ``GET /api/reports/delivery?date=YYYY-MM-DD&universe=nifty500&limit=15``
  NSE end-of-day delivery percentages parsed from the free
  ``sec_bhavdata_full_DDMMYYYY.csv`` archive
  (``https://nsearchives.nseindia.com/products/content/``), which carries
  ``DELIV_QTY`` / ``DELIV_PER`` per EQ symbol. One HTTP fetch per trading
  day, immutable on-disk JSON under
  ``experiments/data/reports/delivery/`` plus a 1 h in-process TTL for the
  latest session. When the requested date has no file yet (today, pre-EOD)
  the previous trading day is served (walk back <= 7 days) and ``date``
  reflects the file actually served.

* ``GET /api/reports/events?from=YYYY-MM-DD&to=YYYY-MM-DD&symbols=A,B&universe=nifty500&limit=100``
  Results/dividend/split calendar from ``yfinance`` (free, no key):
  ``Ticker.calendar`` (earnings + ex-dividend dates),
  ``Ticker.earnings_dates`` (upcoming results), ``Ticker.actions``
  (historical dividends/splits filtered to the window). Per-symbol disk
  cache with a daily TTL, thread-pool fan-out, explicit symbol caps.
  Bonus/AGM are NOT covered by yfinance and are omitted by design.

Neither source needs an API key or DB write. Every failure mode returns a
200 with empty ``rows``/``events`` (never 500).

Deliberately skipped (probed 2026-10-11, evidence in module docstring
history):
* OI change per equity symbol — Upstox option-chain OI (``/option/chain``)
  needs a user OAuth token, is per-underlying + per-expiry, and only
  exists for F&O contracts; equity daily candles carry no OI. Fanning out
  chains across a 500-symbol universe is infeasible, so no OI column.
* NSE corporate-announcement feed — no free server-fetchable endpoint;
  covered instead via yfinance earnings/dividend dates above.
"""

from __future__ import annotations

import csv
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query

from api.utils import _sanitize_for_json

router = APIRouter(prefix="/api/reports", tags=["reports"])

BHAVCOPY_URL = (
    "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv"
)
_BHAV_SERIES = {"EQ"}  # delivery % is only meaningful for equity series
_DELIVERY_DISK_TTL = 24 * 3600
_DELIVERY_MEM_TTL = 3600
_DELIVERY_WALKBACK_DAYS = 7
_DELIVERY_TIMEOUT = 25

_EVENTS_MEM_TTL = 6 * 3600
_EVENTS_DISK_TTL = 24 * 3600
_EVENTS_WORKERS = 6
_EVENTS_MAX_SYMBOLS = 80
_EVENTS_MAX_UNIVERSE_SYMBOLS = 80
_EVENTS_DEFAULT_WINDOW_DAYS = 14
_EVENTS_MAX_WINDOW_DAYS = 120
_YF_TIMEOUT = 20

REPORTS_BASE = (
    Path(__file__).resolve().parent.parent.parent / "experiments" / "data" / "reports"
)
DELIVERY_DIR = REPORTS_BASE / "delivery"
EVENTS_DIR = REPORTS_BASE / "events"

_NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "text/csv,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}

_delivery_mem: dict[str, tuple[float, dict]] = {}
_events_mem: dict[str, tuple[float, dict]] = {}

#: In-memory cache entries kept per store. The keys embed the requested
#: window / symbol list / limit, so every distinct request added an entry that
#: was never evicted - an unbounded dict on a long-lived server.
_MEM_CACHE_MAX = 64


def _mem_put(store: dict, key: str, value: tuple[float, dict]) -> None:
    """Store a cache entry, evicting the oldest ones past the cap."""
    store[key] = value
    while len(store) > _MEM_CACHE_MAX:
        store.pop(next(iter(store)), None)


def _now_iso() -> str:
    try:
        import config as _cfg

        return datetime.now(_cfg.IST).isoformat()
    except Exception:
        return datetime.now().astimezone().isoformat()


def _today_str() -> str:
    try:
        import config as _cfg

        return datetime.now(_cfg.IST).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().astimezone().strftime("%Y-%m-%d")


def _parse_day(value: Optional[str]) -> str:
    text = (value or "").strip()
    if not text:
        return _today_str()
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        return _today_str()


def _parse_window(
    frm: Optional[str], to: Optional[str]
) -> tuple[str, str]:
    today = _today_str()
    try:
        start = datetime.strptime((frm or "").strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        start = date.fromisoformat(today)
    try:
        end = datetime.strptime((to or "").strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        end = start + timedelta(days=_EVENTS_DEFAULT_WINDOW_DAYS)
    if end < start:
        start, end = end, start
    if (end - start).days > _EVENTS_MAX_WINDOW_DAYS:
        end = start + timedelta(days=_EVENTS_MAX_WINDOW_DAYS)
    return start.isoformat(), end.isoformat()


def _universe_symbols(universe: str, cap: int) -> list[str]:
    try:
        from chart_patterns.universes import get_universe

        syms = [str(s).upper() for s in get_universe((universe or "nifty500").strip().lower() or "nifty500")]
        return syms[:cap]
    except Exception:
        return []


def _resolve_symbols(
    symbols: Optional[str], universe: str, cap: int
) -> list[str]:
    if symbols and symbols.strip():
        out: list[str] = []
        for part in symbols.split(","):
            sym = part.strip().upper()
            if sym and sym not in out:
                out.append(sym)
        return out[:cap]
    return _universe_symbols(universe, cap)


# --------------------------------------------------------------------------
# Delivery % (NSE bhavcopy)
# --------------------------------------------------------------------------


def _delivery_disk_path(day: str) -> Path:
    return DELIVERY_DIR / f"{day}.json"


def _read_delivery_disk(day: str) -> Optional[dict]:
    try:
        path = _delivery_disk_path(day)
        if not path.exists():
            return None
        if time.time() - path.stat().st_mtime > _DELIVERY_DISK_TTL * 7:
            return None
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _write_delivery_disk(day: str, payload: dict) -> None:
    try:
        path = _delivery_disk_path(day)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_sanitize_for_json(payload), f)
    except Exception:
        pass


def _fetch_bhavcopy(day: str) -> Optional[str]:
    """Download the bhavcopy CSV for ``day`` (YYYY-MM-DD); None on any error."""
    import requests

    try:
        dt = datetime.strptime(day, "%Y-%m-%d").date()
        url = BHAVCOPY_URL.format(ddmmyyyy=dt.strftime("%d%m%Y"))
        resp = requests.get(url, headers=_NSE_HEADERS, timeout=_DELIVERY_TIMEOUT)
        if resp.status_code != 200 or not resp.content:
            return None
        text = resp.text
        if "SYMBOL" not in text[:500] or "DELIV_PER" not in text[:1000]:
            return None
        return text
    except Exception:
        return None


def _parse_bhavcopy(text: str) -> dict[str, dict]:
    """CSV text -> {SYMBOL: {delivery_qty, delivery_pct, traded_qty, close}}."""
    out: dict[str, dict] = {}
    try:
        reader = csv.DictReader(io.StringIO(text))
        # Real NSE files separate columns with ", " (space after comma).
        fields = [(f or "").strip() for f in (reader.fieldnames or [])]
        for raw in reader:
            try:
                row = {(k or "").strip(): v for k, v in raw.items()}
                if (row.get("SERIES") or "").strip().upper() not in _BHAV_SERIES:
                    continue
                sym = (row.get("SYMBOL") or "").strip().upper()
                if not sym:
                    continue
                deliv_per = float((row.get("DELIV_PER") or "").strip() or 0.0)
                out[sym] = {
                    "symbol": sym,
                    "delivery_qty": int(float((row.get("DELIV_QTY") or "0").strip() or 0.0)),
                    "delivery_pct": round(deliv_per, 2),
                    "traded_qty": int(float((row.get("TTL_TRD_QNTY") or "0").strip() or 0.0)),
                    "close": float((row.get("CLOSE_PRICE") or "0").strip() or 0.0),
                }
            except (ValueError, TypeError, AttributeError):
                continue
    except Exception:
        pass
    return out


def _empty_delivery(day: str, universe: str) -> dict:
    return {
        "date": day,
        "universe": universe,
        "as_of": _now_iso(),
        "cached": False,
        "source": "nse-bhavcopy",
        "rows": [],
    }


def serve_delivery(day: str, universe: str, limit: int) -> dict:
    """Serve top delivery-% rows; walks back to the last available file."""
    limit = max(1, min(int(limit or 15), 100))
    uid = (universe or "nifty500").strip().lower() or "nifty500"
    mem_key = f"{day}|{uid}|{limit}"
    try:
        hit = _delivery_mem.get(mem_key)
        if hit and time.time() - hit[0] < _DELIVERY_MEM_TTL:
            ts, payload = hit
            out = dict(payload)
            out["cached"] = True
            out["age_sec"] = round(time.time() - ts, 1)
            return _sanitize_for_json(out)
    except Exception:
        pass

    try:
        allowed = set(_universe_symbols(uid, 10000))
        base = datetime.strptime(day, "%Y-%m-%d").date()
        served: Optional[tuple[str, dict[str, dict]]] = None
        for back in range(_DELIVERY_WALKBACK_DAYS + 1):
            cand = (base - timedelta(days=back)).isoformat()
            disk = _read_delivery_disk(cand)
            if isinstance(disk, dict) and disk.get("rows_map"):
                served = (cand, disk["rows_map"])
                break
            text = _fetch_bhavcopy(cand)
            if text:
                parsed = _parse_bhavcopy(text)
                if parsed:
                    _write_delivery_disk(cand, {"date": cand, "rows_map": parsed})
                    served = (cand, parsed)
                    break
        if served is None:
            return _sanitize_for_json(_empty_delivery(day, uid))
        served_day, rows_map = served
        rows = [r for s, r in rows_map.items() if not allowed or s in allowed]
        rows.sort(key=lambda r: r.get("delivery_pct", 0.0), reverse=True)
        payload = {
            "date": served_day,
            "universe": uid,
            "as_of": _now_iso(),
            "cached": False,
            "age_sec": 0,
            "source": "nse-bhavcopy",
            "rows": rows[:limit],
        }
        clean = _sanitize_for_json(payload)
        try:
            _mem_put(_delivery_mem, mem_key, (time.time(), clean))
        except Exception:
            pass
        return clean
    except Exception:
        try:
            return _sanitize_for_json(_empty_delivery(day, uid))
        except Exception:
            return {"date": day, "universe": uid, "as_of": "", "cached": False,
                    "source": "nse-bhavcopy", "rows": []}


# --------------------------------------------------------------------------
# Results/events calendar (yfinance)
# --------------------------------------------------------------------------

_EVENT_KINDS = ("results", "dividend", "split")


def _events_disk_path(sym: str) -> Path:
    safe = "".join(c for c in sym.upper() if c.isalnum() or c in ("-", "_")) or "X"
    return EVENTS_DIR / f"{safe}.json"


def _read_events_disk(sym: str) -> Optional[dict]:
    try:
        path = _events_disk_path(sym)
        if not path.exists():
            return None
        if time.time() - path.stat().st_mtime > _EVENTS_DISK_TTL:
            return None
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _write_events_disk(sym: str, payload: dict) -> None:
    try:
        path = _events_disk_path(sym)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_sanitize_for_json(payload), f)
    except Exception:
        pass


def _to_datestr(value: Any) -> Optional[str]:
    try:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        import pandas as pd

        ts = pd.Timestamp(value)
        return ts.date().isoformat()
    except Exception:
        return None


def _fetch_symbol_events(sym: str) -> dict:
    """Raw per-symbol event facts from yfinance; never raises."""
    cached = _read_events_disk(sym)
    if isinstance(cached, dict) and cached.get("symbol") == sym.upper():
        return cached
    facts: dict[str, Any] = {"symbol": sym.upper(), "earnings": [], "ex_div": None,
                             "dividends": [], "splits": []}
    try:
        import yfinance as yf

        t = yf.Ticker(f"{sym.upper()}.NS")
        try:
            cal = t.calendar
            if isinstance(cal, dict):
                for key in ("Earnings Date", "Earnings_Date"):
                    ed = cal.get(key)
                    if ed:
                        dates = ed if isinstance(ed, list) else [ed]
                        for d in dates:
                            ds = _to_datestr(d)
                            if ds:
                                facts["earnings"].append({"date": ds})
                        break
                for key in ("Ex-Dividend Date", "Ex_Dividend_Date"):
                    xd = cal.get(key)
                    ds = _to_datestr(xd)
                    if ds:
                        facts["ex_div"] = {"date": ds}
                    break
        except Exception:
            pass
        try:
            edf = t.earnings_dates
            if edf is not None and not getattr(edf, "empty", True):
                for idx, row in edf.head(8).iterrows():
                    ds = _to_datestr(idx)
                    if not ds:
                        continue
                    try:
                        est = row.get("EPS Estimate")
                        rep = row.get("Reported EPS")
                        facts["earnings"].append({
                            "date": ds,
                            "eps_estimate": (None if est is None else float(est))
                            if str(est) != "nan" else None,
                            "reported_eps": (None if rep is None else float(rep))
                            if str(rep) != "nan" else None,
                        })
                    except Exception:
                        facts["earnings"].append({"date": ds})
        except Exception:
            pass
        try:
            actions = t.actions
            if actions is not None and not getattr(actions, "empty", True):
                for idx, row in actions.iterrows():
                    ds = _to_datestr(idx)
                    if not ds:
                        continue
                    try:
                        div = float(row.get("Dividends", 0.0) or 0.0)
                    except (TypeError, ValueError):
                        div = 0.0
                    try:
                        spl = float(row.get("Stock Splits", 0.0) or 0.0)
                    except (TypeError, ValueError):
                        spl = 0.0
                    if div > 0:
                        facts["dividends"].append({"date": ds, "amount": round(div, 4)})
                    if spl > 0:
                        facts["splits"].append({"date": ds, "ratio": spl})
        except Exception:
            pass
    except Exception:
        pass
    try:
        _write_events_disk(sym.upper(), facts)
    except Exception:
        pass
    return facts


def _facts_to_events(facts: dict, start: str, end: str) -> list[dict]:
    sym = str(facts.get("symbol") or "").upper()
    if not sym:
        return []
    events: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    results_idx: dict[str, int] = {}

    def _add(day: str, kind: str, title: str) -> None:
        if kind not in _EVENT_KINDS:
            return
        if not (start <= day <= end):
            return
        # Calendar earnings dates and earnings_dates estimates often describe
        # the same session: keep one results entry per day, preferring the
        # more informative title.
        if kind == "results":
            pos = results_idx.get(day)
            if pos is None:
                results_idx[day] = len(events)
                events.append({"date": day, "symbol": sym, "kind": kind, "title": title})
            elif len(title) > len(events[pos]["title"]):
                events[pos] = {"date": day, "symbol": sym, "kind": kind, "title": title}
            return
        key = (day, kind, title)
        if key in seen:
            return
        seen.add(key)
        events.append({"date": day, "symbol": sym, "kind": kind, "title": title})

    for e in facts.get("earnings") or []:
        day = str(e.get("date") or "")[:10]
        if not day:
            continue
        est = e.get("eps_estimate")
        rep = e.get("reported_eps")
        if rep is not None:
            title = f"Results on {day} (EPS {rep:g})"
        elif est is not None:
            title = f"Results on {day} (est EPS {est:g})"
        else:
            title = f"Results on {day}"
        _add(day, "results", title)
    exd = facts.get("ex_div") or {}
    if exd.get("date"):
        _add(str(exd["date"])[:10], "dividend", f"Ex-dividend {exd['date'][:10]}")
    for d in facts.get("dividends") or []:
        day = str(d.get("date") or "")[:10]
        if day:
            _add(day, "dividend", f"Dividend Rs.{d.get('amount', 0)} (ex {day})")
    for s in facts.get("splits") or []:
        day = str(s.get("date") or "")[:10]
        if day:
            _add(day, "split", f"Split {s.get('ratio'):g}:1 (ex {day})")
    return events


def _empty_events(start: str, end: str) -> dict:
    return {
        "from": start,
        "to": end,
        "as_of": _now_iso(),
        "cached": False,
        "events": [],
        "symbols_covered": 0,
        "symbols_total": 0,
        "coverage_note": "results/dividend/split via yfinance; bonus/AGM not covered",
    }


def serve_events(
    start: str, end: str, symbols: list[str], limit: int
) -> dict:
    """Fan out yfinance per symbol (bounded); fail-soft, never raises."""
    limit = max(1, min(int(limit or 100), 500))
    mem_key = f"{start}|{end}|{','.join(symbols)}|{limit}"
    try:
        hit = _events_mem.get(mem_key)
        if hit and time.time() - hit[0] < _EVENTS_MEM_TTL:
            ts, payload = hit
            out = dict(payload)
            out["cached"] = True
            out["age_sec"] = round(time.time() - ts, 1)
            return _sanitize_for_json(out)
    except Exception:
        pass
    try:
        events: list[dict] = []
        covered = 0
        if symbols:
            with ThreadPoolExecutor(max_workers=_EVENTS_WORKERS) as ex:
                for facts in ex.map(_fetch_symbol_events, symbols):
                    try:
                        if isinstance(facts, dict) and facts.get("symbol"):
                            covered += 1
                            events.extend(_facts_to_events(facts, start, end))
                    except Exception:
                        continue
        events.sort(key=lambda e: (e.get("date", ""), e.get("symbol", "")))
        payload = {
            "from": start,
            "to": end,
            "as_of": _now_iso(),
            "cached": False,
            "age_sec": 0,
            "events": events[:limit],
            "symbols_covered": covered,
            "symbols_total": len(symbols),
            "coverage_note": "results/dividend/split via yfinance; bonus/AGM not covered",
        }
        clean = _sanitize_for_json(payload)
        try:
            _mem_put(_events_mem, mem_key, (time.time(), clean))
        except Exception:
            pass
        return clean
    except Exception:
        try:
            return _sanitize_for_json(_empty_events(start, end))
        except Exception:
            return {"from": start, "to": end, "as_of": "", "cached": False,
                    "events": [], "symbols_covered": 0, "symbols_total": 0,
                    "coverage_note": ""}


def clear_cache() -> None:
    """Drop in-process caches (tests / admin). Never raises."""
    try:
        _delivery_mem.clear()
        _events_mem.clear()
    except Exception:
        pass


@router.get("/delivery")
def get_delivery(
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD, default today IST"),
    universe: str = Query(default="nifty500"),
    limit: int = Query(default=15, ge=1, le=100),
) -> dict:
    """Top delivery-% rows from the NSE bhavcopy (fail-soft, never 500)."""
    try:
        return serve_delivery(_parse_day(date), universe or "nifty500", limit)
    except Exception:
        try:
            return _empty_delivery(_parse_day(date), "nifty500")
        except Exception:
            return {"date": "", "universe": "", "as_of": "", "cached": False,
                    "source": "nse-bhavcopy", "rows": []}


@router.get("/events")
def get_events(
    frm: Optional[str] = Query(default=None, alias="from"),
    to: Optional[str] = Query(default=None, alias="to"),
    symbols: Optional[str] = Query(default=None, description="CSV symbols; else universe"),
    universe: str = Query(default="nifty500"),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    """Results/dividend/split events via yfinance (fail-soft, never 500)."""
    try:
        start, end = _parse_window(frm, to)
        syms = _resolve_symbols(symbols, universe or "nifty500", _EVENTS_MAX_SYMBOLS)
        return serve_events(start, end, syms, limit)
    except Exception:
        try:
            start, end = _parse_window(None, None)
            return _empty_events(start, end)
        except Exception:
            return {"from": "", "to": "", "as_of": "", "cached": False,
                    "events": [], "symbols_covered": 0, "symbols_total": 0,
                    "coverage_note": ""}
