#!/usr/bin/env python3
"""Historical OI trend — daily EOD snapshots of option OI per strike.

Each trading day after market close (15:35 IST, Mon–Fri) we snapshot the
nearest-expiry option chain for every universe ticker and store it on disk:

    india_board/data/oi_history/{TICKER}/{YYYY-MM-DD}.json
        -> {date, ticker, spot, expiry, strikes: [{strike, ce_oi, pe_oi}]}

The dashboard reads them back via ``GET /api/oi-history/{TICKER}`` and draws
a per-strike OI-over-time trend chart plus a latest-snapshot table with
day-over-day change.

The Fyers token is obtained via ``api.orderflow_recorder.recorder_token``
exactly like ``fyers_data`` does — it is never printed or logged.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

_SCRIPTS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

IST = ZoneInfo("Asia/Kolkata")

ROOT = Path(__file__).resolve().parent.parent
OI_DIR = ROOT / "data" / "oi_history"

#: Snapshot once the closing auction / OI restatement window has passed.
EOD_HOUR, EOD_MIN = 15, 35
_POLL_INTERVAL_SEC = 60

_TICKER_RE = None


def _ticker_ok(ticker: str) -> bool:
    import re  # noqa: PLC0415

    global _TICKER_RE
    if _TICKER_RE is None:
        _TICKER_RE = re.compile(r"[A-Z0-9][A-Z0-9.\-]{0,24}")
    return bool(_TICKER_RE.fullmatch(ticker or ""))


def _today_ist() -> str:
    return datetime.now(IST).date().isoformat()


def snapshot_path(ticker: str, date: str | None = None) -> Path:
    t = (ticker or "").upper().strip()
    return OI_DIR / t / f"{date or _today_ist()}.json"


def snapshot_ticker(ticker: str, date: str | None = None) -> dict:
    """Fetch today's chain for one ticker and persist it. Returns the record."""
    import fyers_data  # noqa: PLC0415
    import fyers_pacer  # noqa: PLC0415

    t = (ticker or "").upper().strip()
    if not _ticker_ok(t):
        raise ValueError(f"bad ticker: {ticker!r}")
    # Deliberate EOD archival (15:35) and manual refreshes run after the close;
    # exempt them from the off-hours circuit breaker. Ordinary polling is not
    # exempt because it never reaches this function.
    with fyers_pacer.allow_offhours("oi-history-eod"):
        chain = fyers_data.get_chain(t)
    day = date or _today_ist()
    strikes = [
        {
            "strike": float(s.get("strike")),
            "ce_oi": float(s.get("ce_oi") or 0),
            "pe_oi": float(s.get("pe_oi") or 0),
        }
        for s in (chain.get("strikes") or [])
        if s.get("strike") not in (None, -1)
    ]
    strikes.sort(key=lambda r: r["strike"])
    record = {
        "date": day,
        "ticker": t,
        "spot": chain.get("spot"),
        "expiry": (chain.get("expiries") or [""])[0],
        "strikes": strikes,
    }
    dest = snapshot_path(t, day)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    tmp.write_text(json.dumps(record), encoding="utf-8")
    tmp.replace(dest)
    return record


def snapshot_all(universe: list[str] | None = None) -> dict:
    """Snapshot every universe ticker. Failures are collected, never raised."""
    import fyers_data  # noqa: PLC0415

    tickers = universe or list(fyers_data.UNIVERSE)
    saved, failed = [], {}
    for t in tickers:
        try:
            snapshot_ticker(t)
            saved.append(t)
        except Exception as exc:  # noqa: BLE001
            failed[t] = str(exc)[:160]
        time.sleep(0.3)
    return {"date": _today_ist(), "saved": saved, "failed": failed}


def load_history(ticker: str) -> dict:
    """Return all stored snapshots for a ticker, oldest first."""
    t = (ticker or "").upper().strip()
    if not _ticker_ok(t):
        raise ValueError(f"bad ticker: {ticker!r}")
    d = OI_DIR / t
    snaps = []
    if d.is_dir():
        for f in sorted(d.glob("*.json")):
            try:
                rec = json.loads(f.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                continue
            if isinstance(rec, dict) and isinstance(rec.get("strikes"), list):
                snaps.append(rec)
    snaps.sort(key=lambda r: str(r.get("date") or ""))
    return {"ticker": t, "snapshots": snaps}


def _past_eod(now: datetime | None = None) -> bool:
    """True on Mon–Fri at/after 15:35 IST (market closed for the day)."""
    now = now or datetime.now(IST)
    if now.weekday() >= 5:  # Sat / Sun — no session, nothing new to snapshot
        return False
    return (now.hour, now.minute) >= (EOD_HOUR, EOD_MIN)


def _today_covered(tickers: list[str], day: str) -> bool:
    """Skip the EOD run when every universe ticker already has today's file."""
    return all(snapshot_path(t, day).is_file() for t in tickers)


def eod_poller(interval_sec: int = _POLL_INTERVAL_SEC) -> None:
    """Background loop: after market close, snapshot the universe once a day."""
    import fyers_data  # noqa: PLC0415

    while True:
        try:
            day = _today_ist()
            if _past_eod() and not _today_covered(list(fyers_data.UNIVERSE), day):
                snapshot_all()
        except Exception:  # noqa: BLE001
            pass  # never kill the dashboard over a background snapshot
        time.sleep(interval_sec)


def start_eod_poller() -> threading.Thread:
    th = threading.Thread(target=eod_poller, name="oi-history-eod", daemon=True)
    th.start()
    return th


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="OI history snapshots")
    ap.add_argument("ticker", nargs="?", help="snapshot one ticker (default: all)")
    ap.add_argument("--date", default=None, help="override date YYYY-MM-DD")
    args = ap.parse_args()
    if args.ticker:
        rec = snapshot_ticker(args.ticker.upper(), args.date)
        print(json.dumps({"saved": rec["ticker"], "date": rec["date"],
                          "strikes": len(rec["strikes"])}))
    else:
        out = snapshot_all()
        print(json.dumps({"date": out["date"], "saved": len(out["saved"]),
                          "failed": out["failed"]}))
