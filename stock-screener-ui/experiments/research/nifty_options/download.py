"""Download NIFTY research data from FYERS into the parquet cache.

Subcommands:
  spot     NIFTY50 index + INDIAVIX, resolutions 1/5/15/D, full available history
  options  currently-listed option contracts, 1-minute candles (strike ladder)
  chain    option-chain snapshots (expiry calendar + current greeks/IV)

Every fetch is throttled + cached (``experiments/data/nifty_options/``), so a
re-run only requests missing data.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402

TODAY = date(2026, 9, 26)
SPOT_FROM = date(2017, 7, 3)


def _log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def download_spot(client, resolutions=("1", "5", "15", "D"), refresh=False):
    for res in resolutions:
        for sym, label in ((fd.NIFTY_SPOT, "NIFTY"), (fd.INDIA_VIX, "VIX")):
            t0 = time.time()
            df = fd.fetch_candles_cached(client, sym, res, SPOT_FROM.isoformat(),
                                         TODAY.isoformat(), refresh=refresh)
            span = f"{df['ts'].min()}..{df['ts'].max()}" if len(df) else "-"
            _log(f"spot {label:5s} {res:>2s}: {len(df):7d} rows  {span}  ({time.time()-t0:.0f}s)")


def listed_expiries(client):
    ch = client.option_chain(strikecount=1, greeks=False)
    out = []
    for e in (ch or {}).get("expiryData", []):
        out.append({"date": e["date"], "epoch": e["expiry"], "flag": e["expiry_flag"]})
    return out


def _strike_range(client):
    """Strike ladder bounds from recent spot extremes."""
    df = fd.fetch_candles_cached(client, fd.NIFTY_SPOT, "D", "2026-01-01", TODAY.isoformat())
    lo, hi = float(df["low"].min()), float(df["high"].max())
    lo = int((lo - 2000) // 50 * 50)
    hi = int((hi + 2000) // 50 * 50)
    return lo, hi


def download_options(client, max_days=100, strikes_cap=90, resolutions=("1",), refresh=False):
    expiries = listed_expiries(client)
    _log(f"listed expiries: {[e['date'] for e in expiries]}")
    lo, hi = _strike_range(client)
    _log(f"spot strike range: {lo}..{hi}")
    steps = list(range(lo, hi + 1, 50))
    if len(steps) > strikes_cap:
        mid = (lo + hi) // 2
        steps = sorted(steps, key=lambda s: abs(s - mid))[:strikes_cap]
        steps.sort()
    today = datetime.strptime(expiries[0]["date"], "%d-%m-%Y").date() if expiries else TODAY

    jobs = []
    for e in expiries:
        exp = datetime.strptime(e["date"], "%d-%m-%Y").date()
        if (exp - TODAY).days > max_days:
            continue
        weekly = e["flag"] == "W"
        for k in steps:
            for opt in ("CE", "PE"):
                sym = fd.nifty_symbol(exp, k, opt, weekly=weekly)
                jobs.append((sym, exp))

    _log(f"{len(jobs)} contract downloads (1-min)")
    done = 0
    for res in resolutions:
        for sym, exp in jobs:
            frm = (exp - timedelta(days=130)).isoformat()
            df = fd.fetch_candles_cached(client, sym, res, frm, TODAY.isoformat(), refresh=refresh)
            done += 1
            if done % 25 == 0:
                _log(f"  {done}/{len(jobs)}  {sym} rows={len(df)} calls={client.calls}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["spot", "options", "chain", "all"])
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--max-days", type=int, default=100)
    ap.add_argument("--min-interval", type=float, default=0.4)
    args = ap.parse_args()

    client = fd.FyersData(min_interval=args.min_interval)
    if args.cmd in ("spot", "all"):
        download_spot(client, refresh=args.refresh)
    if args.cmd in ("chain", "all"):
        ch = client.option_chain(strikecount=25, greeks=True)
        out = fd.CACHE_DIR / "option_chains" / f"chain_{TODAY.isoformat()}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(ch, indent=2))
        _log(f"chain saved -> {out.name}  expiries={len((ch or {}).get('expiryData', []))}")
    if args.cmd in ("options", "all"):
        download_options(client, max_days=args.max_days, refresh=args.refresh)
    _log(f"total FYERS calls: {client.calls}  throttled: {client.throttled}")


if __name__ == "__main__":
    main()
