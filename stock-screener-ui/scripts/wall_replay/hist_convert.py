#!/usr/bin/env python3
"""Convert the LENOVO_USB NIFTY option archive into wall-replay tape rows.

Source layout (USB):
    Archives/nifty-*/nifty/<EXPIRY>/NIFTY_<STRIKE>_<CE|PE>_<DD>_<MMM>_<YY>.csv
each CSV = 1-minute OHLC + volume + OI for one contract, spanning the
contract's whole life.

For every session we take the FRONT expiry (nearest expiry >= date) and emit
one tape row per minute in the same shape `scripts/wall_replay/batch.py`
expects:

    {"t", "spot", "chain": {strike: [ce_ltp, pe_ltp, ce_oi, pe_oi,
                                     ce_vol_cum, pe_vol_cum]},
     "walls": {"calls": [...], "puts": [...]}, "max_pain", "expiry"}

Spot is not in the archive, so it is reconstructed from put-call parity:
    F = median(K + C - P) over the 5 cheapest straddles
    S = F * exp(-r * days_to_expiry / 365)
Level noise is ~ +/-20 pts (validated against daily OHLC); this is reported.

Run:
    .venv/bin/python scripts/wall_replay/hist_convert.py --workers 4
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
import statistics
from concurrent.futures import ProcessPoolExecutor
from datetime import date as Date
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pv

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "experiments" / "data" / "nifty_hist"
USB = Path("/media/mysyntax/LENOVO_USB_1/Archives")
SRC_DIRS = [USB / "nifty-20260627T130953Z-3-001" / "nifty",
            USB / "nifty-20260627T130953Z-3-002" / "nifty"]
RATE = 0.065
MIN_STRIKES = 20
MAX_DTE = 10          # front weekly expiry is at most a week away
DATE_FLOOR = "2024-09-27"


def folders() -> dict[str, Path]:
    """expiry -> folder, preferring the -002 copy (more contracts)."""
    out: dict[str, Path] = {}
    for base in reversed(SRC_DIRS):          # -001 first, then -002 overrides
        if not base.exists():
            continue
        for p in sorted(base.iterdir()):
            if p.is_dir() and re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.name):
                if glob.glob(str(p / "*.csv")):
                    out[p.name] = p
    return out


def trading_dates(folder: Path) -> set[str]:
    dates: set[str] = set()
    for f in glob.glob(str(folder / "*.csv")):
        try:
            with open(f, "rb") as fh:
                fh.readline()
                first = fh.readline().decode().strip()
                fh.seek(0, 2)
                size = fh.tell()
                fh.seek(max(0, size - 4096))
                tail = fh.read().decode(errors="ignore").strip().splitlines()
        except OSError:
            continue
        if not first or not tail:
            continue
        a, b = first[:10], tail[-1][:10]
        try:
            d, e = Date.fromisoformat(a), Date.fromisoformat(b)
        except ValueError:
            continue
        while d <= e:
            if d.weekday() < 5:
                dates.add(d.isoformat())
            d += timedelta(days=1)
    return dates


def read_contract(path: str) -> tuple[int, str, dict[tuple[str, str], tuple]]:
    m = re.search(r"NIFTY_(\d+)_(CE|PE)_", os.path.basename(path))
    strike, opt = int(m.group(1)), m.group(2)
    t = pv.read_csv(path, convert_options=pv.ConvertOptions(
        include_columns=["timestamp", "close", "volume", "oi"],
        column_types={"timestamp": pa.string()}))
    rows: dict[tuple[str, str], tuple] = {}
    if t.num_rows:
        ts = t["timestamp"].to_pylist()
        cl = t["close"].to_pylist()
        vo = t["volume"].to_pylist()
        oi = t["oi"].to_pylist()
        for a, c, v, o in zip(ts, cl, vo, oi):
            if len(a) < 16:
                continue
            rows[(a[:10], a[11:16])] = (float(c or 0.0), float(v or 0.0), float(o or 0.0))
    return strike, opt, rows


def build_chain(strike_rows: dict[tuple[int, str], dict[str, tuple]], minutes: list[str]) -> dict[str, dict]:
    """Forward-fill prices/OI, cumulative volume, per minute."""
    chain: dict[str, dict[int, list[float]]] = {mm: {} for mm in minutes}
    strikes = sorted({k for k, _ in strike_rows})
    for k in strikes:
        for opt, ci, vi in (("CE", 0, 4), ("PE", 1, 5)):
            rows = strike_rows.get((k, opt))
            if not rows:
                continue
            last_c = last_o = 0.0
            cum_v = 0.0
            for mm in minutes:
                c, v, o = rows.get(mm, (None, 0.0, None))
                if c is not None and c > 0:
                    last_c = c
                if o is not None and o > 0:
                    last_o = o
                cum_v += v or 0.0
                if last_c <= 0:
                    continue
                leg = chain[mm].setdefault(k, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
                leg[ci] = last_c
                leg[ci + 2] = last_o
                leg[vi] = cum_v
    return chain


def spot_series(chain: dict[str, dict[int, list[float]]], minutes: list[str],
                days_to_exp: float) -> dict[str, float]:
    fwd: dict[str, float] = {}
    for mm in minutes:
        ch = chain[mm]
        cands = []
        for k, leg in ch.items():
            c, p = leg[0], leg[1]
            if c > 0 and p > 0:
                cands.append((c + p, k + c - p))
        if len(cands) < 3:
            continue
        cands.sort()
        fwd[mm] = statistics.median(f for _, f in cands[:5])
    factor = math.exp(-RATE * days_to_exp / 365.0)
    return {mm: f * factor for mm, f in fwd.items()}


def max_pain_np(strikes: np.ndarray, ce: np.ndarray, pe: np.ndarray) -> float:
    """Standard max-pain over the whole chain (writer payout minimised)."""
    if strikes.size == 0:
        return 0.0
    k = strikes
    # pain(K) = sum_{s<K}(K-s)ce(s) + sum_{s>K}(s-K)pe(s)
    ce_pre = np.concatenate(([0.0], np.cumsum(ce)))
    ce_strike_pre = np.concatenate(([0.0], np.cumsum(ce * k)))
    pe_suf = np.concatenate((np.cumsum((pe * k)[::-1])[::-1], [0.0]))
    pe_cnt_suf = np.concatenate((np.cumsum(pe[::-1])[::-1], [0.0]))
    pain = k * ce_pre[:-1] - ce_strike_pre[:-1] + pe_suf[1:] - k * pe_cnt_suf[1:]
    return float(k[int(np.argmin(pain))])


def walls_of(chain_mm: dict[int, list[float]], spot: float, band: float = 300.0) -> dict:
    """Top-3 OI per side inside +/-band of spot (the live tape's `walls_near`).

    Ranking the whole chain lets a far monthly strike win the wall slot and
    the break never triggers; the live recorder uses a +/-300 pt band.
    """
    near = {k: v for k, v in chain_mm.items() if abs(k - spot) <= band}
    pool = near or chain_mm
    # No side filter: the live recorder ranks ALL strikes in the band by OI,
    # so a call wall can sit below spot (e.g. 22900 vs spot 22955 on 10-30).
    calls = sorted(((k, v[2]) for k, v in pool.items() if v[2] > 0),
                   key=lambda x: -x[1])[:3]
    puts = sorted(((k, v[3]) for k, v in pool.items() if v[3] > 0),
                  key=lambda x: -x[1])[:3]
    return {"calls": [{"strike": float(k), "oi": v, "distance": round(k - spot, 2)} for k, v in calls],
            "puts": [{"strike": float(k), "oi": v, "distance": round(k - spot, 2)} for k, v in puts]}


MINUTES = [f"{h:02d}:{m:02d}" for h in range(9, 16) for m in range(60)
           if (h, m) >= (9, 15) and (h, m) <= (15, 29)]


def convert_folder(expiry: str, folder: str, days: list[str]) -> list[tuple[str, dict | None]]:
    """One pass over the folder; emit every assigned session."""
    allrows: dict[tuple[int, str], dict[tuple[str, str], tuple]] = {}
    for f in glob.glob(os.path.join(folder, "*.csv")):
        k, opt, rows = read_contract(f)
        if rows:
            allrows[(k, opt)] = rows
    out = []
    for day in days:
        strike_rows = {key: {mm: v for (d, mm), v in rows.items() if d == day}
                       for key, rows in allrows.items()}
        strike_rows = {k: v for k, v in strike_rows.items() if v}
        if not strike_rows:
            out.append((day, None))
            continue
        out.append(convert_day(expiry, day, strike_rows))
    return out


def convert_day(expiry: str, day: str,
                strike_rows: dict[tuple[int, str], dict[str, tuple]]) -> tuple[str, dict | None]:
    minutes = MINUTES
    if not strike_rows:
        return day, None
    chain = build_chain(strike_rows, minutes)
    days_to_exp = max(0.0, (Date.fromisoformat(expiry) - Date.fromisoformat(day)).days)
    spots = spot_series(chain, minutes, days_to_exp)
    out_rows = []
    for mm in minutes:
        if mm not in spots:
            continue
        ch = chain[mm]
        if len(ch) < MIN_STRIKES:
            continue
        spot = spots[mm]
        ks_all = sorted(ch)
        near = sum(1 for k in ks_all if abs(k - spot) <= 0.05 * spot)
        if near < 10 or not (ks_all[0] <= spot <= ks_all[-1]):
            continue
        ks = np.array(ks_all, dtype=float)
        ce = np.array([ch[int(k)][2] for k in ks], dtype=float)
        pe = np.array([ch[int(k)][3] for k in ks], dtype=float)
        mp = max_pain_np(ks, ce, pe)
        out_rows.append({
            "t": f"{day}T{mm}:00+05:30",
            "spot": round(spot, 2),
            "chain": {str(int(k)): [round(v, 2) for v in ch[int(k)]] for k in ks},
            "walls": walls_of(ch, spot),
            "max_pain": mp,
            "expiry": expiry,
        })
    if not out_rows:
        return day, None
    return day, {"rows": out_rows, "spot_close": out_rows[-1]["spot"],
                 "spot_high": max(r["spot"] for r in out_rows),
                 "spot_low": min(r["spot"] for r in out_rows)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0, help="debug: cap sessions")
    ap.add_argument("--skip-existing", action="store_true")
    ap.add_argument("--expiry-offset", type=int, default=0,
                    help="0 = front expiry, 1 = next expiry, ...")
    ap.add_argument("--out", default=str(OUT), help="output directory")
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    fmap = folders()
    expiries = sorted(fmap)
    print(f"expiry folders: {len(expiries)} ({expiries[0]} -> {expiries[-1]})", flush=True)

    # date -> expiry at the requested offset (0 = front, 1 = next, ...)
    cands: dict[str, list[str]] = {}
    for exp in expiries:
        for d in trading_dates(fmap[exp]):
            if d < DATE_FLOOR or d > exp:
                continue
            if (Date.fromisoformat(exp) - Date.fromisoformat(d)).days > MAX_DTE + 7 * args.expiry_offset:
                continue
            cands.setdefault(d, []).append(exp)
    front: dict[str, str] = {}
    for d, es in cands.items():
        es = sorted(set(es))
        if len(es) > args.expiry_offset:
            front[d] = es[args.expiry_offset]
    # only keep dates whose front folder actually has >=MIN_STRIKES contracts
    dates = sorted(front)
    if args.skip_existing:
        dates = [d for d in dates if not (out_dir / f"{d}.jsonl").exists()]
    if args.limit:
        dates = dates[: args.limit]
    print(f"candidate sessions: {len(dates)}", flush=True)

    by_folder: dict[str, list[str]] = {}
    for d in dates:
        by_folder.setdefault(front[d], []).append(d)
    jobs = [(exp, str(fmap[exp]), sorted(ds)) for exp, ds in sorted(by_folder.items())]
    diag = []
    done = 0
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        for results in ex.map(convert_folder, *zip(*jobs)):
            for day, res in results:
                done += 1
                if not res:
                    continue
                (out_dir / f"{day}.jsonl").write_text(
                    "\n".join(json.dumps(r) for r in res["rows"]) + "\n")
                diag.append({"date": day, "expiry": front[day],
                             "spot_close": res["spot_close"],
                             "spot_high": res["spot_high"], "spot_low": res["spot_low"]})
            print(f"  {done}/{len(dates)} sessions written", flush=True)
    (out_dir / "_diag.json").write_text(json.dumps(diag, indent=1))
    print(f"done: {len(diag)} sessions -> {out_dir}", flush=True)


if __name__ == "__main__":
    main()
