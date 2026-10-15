#!/usr/bin/env python3
"""Fetch and cache Unusual Whales / NDX GEX history.

Despite the repo's earlier assumption, `gex-levels` and `spot-exposures` BOTH
accept a `?date=YYYY-MM-DD` parameter and serve history back to 2023-10-30
(730 trading days on this token).  This module warms a local JSON cache so the
backtests are reproducible and the API is hit at most once per (endpoint, date).

    gex-levels      -> one row/day: call_wall, put_wall, gamma_flip, gamma_magnet
    spot-exposures  -> ~390 rows/day: per-minute NDX price + net gamma exposure

Usage:
    python gex_store.py --fetch --start 2023-10-31 --end 2026-09-29
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from uw_client import UWClient  # noqa: E402

CACHE = Path("/tmp/opencode/gex_cache")
SPOT_CACHE = Path("/tmp/opencode/spotex_cache")
CACHE.mkdir(parents=True, exist_ok=True)
SPOT_CACHE.mkdir(parents=True, exist_ok=True)


def _weekdays(start: date, end: date):
    d = start
    while d <= end:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


def _cached(path: Path, fn):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            pass
    data = fn()
    path.write_text(json.dumps(data))
    return data


def get_levels(client: UWClient, day: str, ticker: str = "NDX"):
    def fetch():
        r = client.get(f"/api/stock/{ticker}/gex-levels", date=day)
        if r.status_code != 200:
            return {"_status": r.status_code, "_error": r.text[:200]}
        return r.json().get("data") or {}
    return _cached(CACHE / f"{ticker}_{day}.json", fetch)


def get_levels_oi(client: UWClient, day: str, ticker: str = "NDX"):
    """Open-interest-based levels — populated for dates where vol is null."""
    def fetch():
        r = client.get(f"/api/stock/{ticker}/gex-levels", date=day, source="oi")
        if r.status_code != 200:
            return {"_status": r.status_code, "_error": r.text[:200]}
        return r.json().get("data") or {}
    return _cached(CACHE / f"{ticker}_oi_{day}.json", fetch)


def backfill_oi(start: str, end: str, ticker: str = "NDX"):
    client = UWClient()
    s = datetime.strptime(start, "%Y-%m-%d").date()
    e = datetime.strptime(end, "%Y-%m-%d").date()
    n = 0
    for d in _weekdays(s, e):
        vol = load_levels(d.isoformat(), ticker)
        if vol and vol.get("call_wall") is not None:
            continue
        get_levels_oi(client, d.isoformat(), ticker)
        n += 1
        if n % 50 == 0:
            print(f"  oi backfill {n} days... used={client.last_usage.get('daily_used')}", flush=True)
    print(f"oi backfill done: {n} days, remaining={client.last_usage.get('daily_remaining')}")


def get_spot_exposures(client: UWClient, day: str, ticker: str = "NDX"):
    def fetch():
        r = client.get(f"/api/stock/{ticker}/spot-exposures", date=day)
        if r.status_code != 200:
            return {"_status": r.status_code, "_error": r.text[:200], "data": []}
        return {"data": r.json().get("data") or []}
    return _cached(SPOT_CACHE / f"{ticker}_{day}.json", fetch)


def load_levels(day: str, ticker: str = "NDX") -> dict | None:
    p = CACHE / f"{ticker}_{day}.json"
    if not p.exists():
        return None
    d = json.loads(p.read_text())
    if not d or d.get("_status") or not d.get("date"):
        return None
    return d


def load_levels_best(day: str, ticker: str = "NDX") -> dict | None:
    """vol levels when populated, else the oi-based levels for that day."""
    d = load_levels(day, ticker)
    if d and d.get("call_wall") is not None:
        return d
    p = CACHE / f"{ticker}_oi_{day}.json"
    if p.exists():
        oi = json.loads(p.read_text())
        if oi.get("date") and oi.get("call_wall") is not None:
            return oi
    return d if (d and d.get("gamma_magnet") is not None) else None


def load_spot(day: str, ticker: str = "NDX") -> list[dict]:
    p = SPOT_CACHE / f"{ticker}_{day}.json"
    if not p.exists():
        return []
    d = json.loads(p.read_text())
    return d.get("data") or []


def fetch_range(start: str, end: str, ticker: str = "NDX", sleep: float = 0.0):
    client = UWClient()
    s = datetime.strptime(start, "%Y-%m-%d").date()
    e = datetime.strptime(end, "%Y-%m-%d").date()
    n = ok_l = ok_s = 0
    t0 = time.time()
    for d in _weekdays(s, e):
        ds = d.isoformat()
        n += 1
        lv = get_levels(client, ds, ticker)
        if lv.get("call_wall") is not None or lv.get("gamma_magnet") is not None:
            ok_l += 1
        sp = get_spot_exposures(client, ds, ticker)
        if sp.get("data"):
            ok_s += 1
        if sleep:
            time.sleep(sleep)
        if n % 50 == 0:
            print(f"  {n} days... levels_ok={ok_l} spot_ok={ok_s} "
                  f"used={client.last_usage.get('daily_used')} "
                  f"[{time.time()-t0:.0f}s]", flush=True)
    print(f"done {n} weekdays: levels_ok={ok_l} spot_ok={ok_s} "
          f"used={client.last_usage.get('daily_used')} remaining={client.last_usage.get('daily_remaining')}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--backfill-oi", action="store_true")
    ap.add_argument("--start", default="2023-10-31")
    ap.add_argument("--end", default=date.today().isoformat())
    ap.add_argument("--ticker", default="NDX")
    args = ap.parse_args()
    if args.fetch:
        fetch_range(args.start, args.end, args.ticker)
    elif args.backfill_oi:
        backfill_oi(args.start, args.end, args.ticker)
    else:
        print(load_levels(args.start, args.ticker))
