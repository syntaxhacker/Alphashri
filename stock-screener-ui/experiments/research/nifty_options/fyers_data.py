"""Throttled, disk-cached FYERS v3 market-data client for NIFTY options research.

Reuses the repository's existing FYERS conventions (see ``docs/fyers/`` and
``api/orderflow_recorder.recorder_token``) but adds the pieces a research
harness needs and the order-flow recorder does not provide:

* token resolution from the DB (primary) then env vars (fallback),
* request throttling + 429 back-off (FYERS hard-limits the ``/history`` feed),
* automatic 100-day (minute) / 366-day (daily) chunking with concatenation,
* a transparent on-disk parquet cache so no candle is ever fetched twice,
* NSE option-symbol builders (weekly single-letter month, monthly 3-letter).

Nothing here is strategy-specific; this is pure data plumbing.
"""

from __future__ import annotations

import os
import sqlite3
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR = ROOT / "experiments" / "data" / "nifty_options"
CANDLE_DIR = CACHE_DIR / "candles"

#: FYERS data-limits (official reference): minute resolutions 100 days/request,
#: day/week/month 366 days/request, history starts 2017-07-03.
MINUTE_RES = {"1", "2", "3", "5", "10", "15", "20", "30", "45", "60", "120", "180", "240"}
DAY_RES = {"D", "1D", "1W", "1M"}
HISTORY_START = date(2017, 7, 3)

NIFTY_SPOT = "NSE:NIFTY50-INDEX"
INDIA_VIX = "NSE:INDIAVIX-INDEX"

_MONTH3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
           "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
#: NSE weekly option month code: 1-9 then O/N/D.
_MONTH1 = {1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
           10: "O", 11: "N", 12: "D"}


# ---------------------------------------------------------------------------
# token resolution
# ---------------------------------------------------------------------------
def resolve_token(env_token: Optional[str] = None) -> tuple[str, str]:
    """Return ``(app_id, access_token)`` for FYERS.

    Order: explicit arg -> DB ``broker_connections`` -> ``FYERS_ACCESS_TOKEN``.
    Accepts either the combined ``APP_ID:TOKEN`` form or a bare token paired
    with ``FYERS_CLIENT_ID``. Never logs the token.
    """
    try:  # config.py loads .env; keeps this module standalone-runnable
        import sys
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        import config  # noqa: F401
    except Exception:
        pass
    raw = env_token or os.getenv("FYERS_ACCESS_TOKEN")
    app = os.getenv("FYERS_CLIENT_ID") or os.getenv("FYERS_APP_ID")

    if not raw:
        db = ROOT / "db" / "alphashri.db"
        for path in (db, ROOT.parent / "db" / "alphashri.db"):
            if not path.exists():
                continue
            try:
                con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
                row = con.execute(
                    "select access_token from broker_connections "
                    "where broker_name='fyers' order by updated_at desc limit 1"
                ).fetchone()
                con.close()
                if row and row[0]:
                    raw = row[0]
                    break
            except sqlite3.Error:
                continue

    if not raw:
        raise RuntimeError(
            "No FYERS token found (DB broker_connections / FYERS_ACCESS_TOKEN)."
        )

    if ":" in raw:
        head, _, tail = raw.partition(":")
        if head and tail and (not app or head == app):
            return head, tail
        return (app or head), tail

    if not app:
        raise RuntimeError("Bare FYERS token supplied but FYERS_CLIENT_ID is unset.")
    return app, raw


@dataclass
class _Resp:
    ok: bool
    candles: list
    code: object = None
    message: str = ""


class FyersData:
    """Min rate-limited, cached wrapper over ``FyersModel.history``/``optionchain``."""

    def __init__(self, min_interval: float = 0.45, max_retries: int = 6, verbose: bool = True):
        from fyers_apiv3.fyersModel import FyersModel

        app, token = resolve_token()
        self._fyers = FyersModel(client_id=app, token=token)
        self.min_interval = min_interval
        self.max_retries = max_retries
        self.verbose = verbose
        self._last = 0.0
        self.calls = 0
        self.throttled = 0

    # -- transport ---------------------------------------------------------
    def _wait(self) -> None:
        gap = time.time() - self._last
        if gap < self.min_interval:
            time.sleep(self.min_interval - gap)
            self.throttled += 1
        self._last = time.time()

    def _get(self, path: str, fn, **kw) -> dict:
        delay = 1.0
        for attempt in range(self.max_retries):
            self._wait()
            self.calls += 1
            try:
                resp = fn(**kw)
            except Exception as exc:  # network / SDK error
                if self.verbose:
                    print(f"  ! {path} exception {type(exc).__name__}: {exc}")
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            if isinstance(resp, dict) and str(resp.get("s", "")).lower() == "ok":
                return resp
            code = resp.get("code") if isinstance(resp, dict) else None
            msg = (resp.get("message") if isinstance(resp, dict) else str(resp)) or ""
            if code == 429:
                if self.verbose:
                    print(f"  ~ 429 on {path}; backing off {delay:.0f}s")
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            if code in (-50,) or "range" in msg.lower() and "cannot" in msg.lower():
                return resp  # caller must re-chunk; not retryable
            if code in (-300,):
                return resp  # invalid symbol: not retryable
            if self.verbose:
                print(f"  ! {path} code={code} {msg[:90]}")
            return resp
        return {"s": "error", "code": 429, "message": "retries exhausted"}

    # -- history -----------------------------------------------------------
    def history(self, symbol: str, resolution: str, range_from: str, range_to: str,
                oi: bool = False) -> list[list]:
        """Fetch and concatenate candle chunks. Returns positional rows."""
        frm = _as_date(range_from)
        to = _as_date(range_to)
        if resolution in MINUTE_RES:
            cap_days, chunk = 100, 90
        elif resolution in ("D", "1D"):
            cap_days, chunk = 366, 350
        elif resolution in ("1W", "1M"):
            cap_days, chunk = 366, 350
        else:  # seconds
            cap_days, chunk = 30, 25
        if frm < HISTORY_START:
            frm = HISTORY_START

        out: list[list] = []
        cur = frm
        while cur <= to:
            end = min(cur + timedelta(days=chunk - 1), to)
            data = {
                "symbol": symbol, "resolution": resolution, "date_format": "1",
                "range_from": cur.isoformat(), "range_to": end.isoformat(), "cont_flag": "1",
            }
            if oi:
                data["oi_flag"] = "1"
            resp = self._get("history", self._fyers.history, data=data)
            if isinstance(resp, dict) and str(resp.get("s")).lower() == "ok":
                out.extend(resp.get("candles") or [])
            elif isinstance(resp, dict) and resp.get("code") == -300:
                return out  # invalid symbol; caller sees empty
            cur = end + timedelta(days=1)

        # de-dup on epoch, sort
        if out:
            dedup = {int(r[0]): r for r in out}
            out = [dedup[k] for k in sorted(dedup)]
        return out

    # -- option chain / quotes --------------------------------------------
    def option_chain(self, underlying: str = NIFTY_SPOT, strikecount: int = 25,
                     expiry: Optional[str] = None, greeks: bool = True) -> Optional[dict]:
        data = {"symbol": underlying, "strikecount": int(strikecount)}
        if expiry:
            data["timestamp"] = str(expiry)
        if greeks:
            data["greeks"] = "1"
        resp = self._get("optionchain", self._fyers.optionchain, data=data)
        if isinstance(resp, dict) and str(resp.get("s")).lower() == "ok":
            d = resp.get("data")
            return d if isinstance(d, dict) else None
        return None

    def quotes(self, symbols: Iterable[str]) -> dict:
        syms = ",".join(symbols)
        resp = self._get("quotes", self._fyers.quotes, data={"symbols": syms})
        out = {}
        if isinstance(resp, dict) and str(resp.get("s")).lower() == "ok":
            for row in resp.get("d") or []:
                out[row.get("n")] = row.get("v") or {}
        return out


# ---------------------------------------------------------------------------
# disk cache
# ---------------------------------------------------------------------------
def _cache_path(symbol: str, resolution: str) -> Path:
    safe = symbol.replace(":", "_").replace("/", "-")
    return CANDLE_DIR / f"{safe}__{resolution}.parquet"


def _rows_to_df(rows: list[list], oi: bool) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume", "oi"])
    cols = ["ts", "open", "high", "low", "close", "volume"] + (["oi"] if len(rows[0]) > 6 else [])
    df = pd.DataFrame([r[:len(cols)] for r in rows], columns=cols)
    for c in cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["ts"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert("Asia/Kolkata")
    if "oi" not in df:
        df["oi"] = pd.NA
    return df.drop_duplicates("ts").sort_values("ts").reset_index(drop=True)


def fetch_candles_cached(client: FyersData, symbol: str, resolution: str,
                         range_from: str, range_to: str, oi: bool = False,
                         refresh: bool = False) -> pd.DataFrame:
    """Fetch candles, persisting to parquet and merging with any cached rows."""
    path = _cache_path(symbol, resolution)
    cached = pd.DataFrame()
    if path.exists() and not refresh:
        try:
            cached = pd.read_parquet(path)
        except Exception:
            cached = pd.DataFrame()

    frm, to = _as_date(range_from), _as_date(range_to)
    if not cached.empty and not refresh:
        have_min = cached["ts"].min().date()
        have_max = cached["ts"].max().date()
        if have_min <= frm and have_max >= to:
            return cached[(cached["ts"].dt.date >= frm) & (cached["ts"].dt.date <= to)].reset_index(drop=True)

    rows = client.history(symbol, resolution, frm.isoformat(), to.isoformat(), oi=oi)
    fresh = _rows_to_df(rows, oi)
    merged = fresh if cached.empty else pd.concat([cached, fresh], ignore_index=True)
    if not merged.empty:
        merged = (merged.drop_duplicates("ts").sort_values("ts").reset_index(drop=True))
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            merged.to_parquet(path, index=False)
        except Exception:
            merged.to_pickle(path.with_suffix(".pkl"))
    if merged.empty:
        return fresh
    return merged[(merged["ts"].dt.date >= frm) & (merged["ts"].dt.date <= to)].reset_index(drop=True)


# ---------------------------------------------------------------------------
# symbol helpers
# ---------------------------------------------------------------------------
def _as_date(v) -> date:
    if isinstance(v, date):
        return v
    return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()


def nifty_monthly_symbol(expiry: date, strike: int, opt: str) -> str:
    """``NSE:NIFTY26SEP23000CE`` (3-letter month, monthly expiry)."""
    return f"NSE:NIFTY{expiry:%y}{_MONTH3[expiry.month - 1]}{int(strike)}{opt.upper()}"


def nifty_weekly_symbol(expiry: date, strike: int, opt: str) -> str:
    """``NSE:NIFTY26O0623000CE`` (single-letter month + day, weekly expiry)."""
    return f"NSE:NIFTY{expiry:%y}{_MONTH1[expiry.month]}{expiry.day:02d}{int(strike)}{opt.upper()}"


def nifty_symbol(expiry: date, strike: int, opt: str, weekly: bool = True) -> str:
    return nifty_weekly_symbol(expiry, strike, opt) if weekly else nifty_monthly_symbol(expiry, strike, opt)


def next_tuesday(d: date) -> date:
    """NIFTY weekly expiries moved to Tuesday (NSE)."""
    return d + timedelta(days=(1 - d.weekday()) % 7 or 7)


def weekly_expiries(start: date, end: date) -> list[date]:
    """Every Tuesday in [start, end] (holiday shifts handled by data presence)."""
    out, cur = [], next_tuesday(start - timedelta(days=1))
    while cur <= end:
        out.append(cur)
        cur += timedelta(days=7)
    return out


def monthly_expiry(year: int, month: int) -> date:
    """Last Tuesday of the month (NIFTY monthly expiry)."""
    if month == 12:
        nxt = date(year + 1, 1, 1)
    else:
        nxt = date(year, month + 1, 1)
    d = nxt - timedelta(days=1)
    while d.weekday() != 1:  # Tuesday
        d -= timedelta(days=1)
    return d


if __name__ == "__main__":  # tiny self-check
    c = FyersData(min_interval=0.5)
    df = fetch_candles_cached(c, NIFTY_SPOT, "1", "2026-09-22", "2026-09-26")
    print("spot 1m rows:", len(df), "calls:", c.calls)
    print(df.tail(2).to_string())
