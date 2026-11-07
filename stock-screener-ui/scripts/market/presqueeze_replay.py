#!/usr/bin/env python3
"""Causal replay of the pre-move score on the 10-second chain.

Purpose: prove (or disprove) that the positioning score arms *before* a squeeze
using only data available at each snapshot. No lookahead:

* every feature at snapshot ``i`` uses snapshots ``<= i`` and tape rows ``<= t``;
* the forward label uses ``t+..`` only;
* the score components mirror ``src/pages/report/niftyPreMove.ts``.

Run:
    .venv/bin/python scripts/market/presqueeze_replay.py --date 2026-10-28 --from 12:30 --to 13:05
    .venv/bin/python scripts/market/presqueeze_replay.py --date 2026-10-28 --evaluate
"""
from __future__ import annotations

import argparse
import bisect
import json
import pathlib
import statistics
import sys
import urllib.request
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[2]
TAPE_DIR = ROOT / "experiments" / "data" / "nifty_tape"
API = "http://localhost:8765"
IST_TZ = "Asia/Kolkata"


def fetch_summary(date: str, limit: int = 2000) -> list[dict]:
    url = f"{API}/api/reports/nifty/chain10s?date={date}&summary=1&limit={limit}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        payload = json.loads(resp.read().decode())
    return payload.get("summary") or []


def parse_t(value: str) -> datetime:
    return datetime.fromisoformat(value)


def index_ago(times: list[datetime], i: int, seconds: float) -> int:
    target = times[i].timestamp() - seconds
    j = i
    while j > 0 and times[j].timestamp() > target:
        j -= 1
    return j


def read_flow(d_ce: float, d_pe: float, d_prem_ce: float | None, d_prem_pe: float | None,
              noise: float = 100_000) -> tuple[str, str] | None:
    ce_moved = abs(d_ce) >= noise
    pe_moved = abs(d_pe) >= noise
    if not ce_moved and not pe_moved:
        return None
    side = "ce" if (ce_moved and (not pe_moved or abs(d_ce) >= abs(d_pe))) else "pe"
    doi = d_ce if side == "ce" else d_pe
    dprem = d_prem_ce if side == "ce" else d_prem_pe
    if dprem is None:
        if side == "ce":
            return ("calls unwound", "bull") if doi < 0 else ("calls added", "bear")
        return ("puts added", "bear") if doi > 0 else ("puts unwound", "bull")
    up = doi > 0
    prem_up = dprem > 0
    if side == "ce":
        if up and prem_up:
            return ("calls bought", "bull")
        if up and not prem_up:
            return ("calls sold", "bear")
        if not up and prem_up:
            return ("calls bought back", "bull")
        return ("calls closed", "bear")
    if up and prem_up:
        return ("puts bought", "bear")
    if up and not prem_up:
        return ("puts sold", "bull")
    if not up and prem_up:
        return ("puts bought back", "bear")
    return ("puts closed", "bull")


def load_tape(date: str) -> tuple[list[datetime], list[float | None]]:
    path = TAPE_DIR / f"{date}.jsonl"
    times: list[datetime] = []
    gex: list[float | None] = []
    if not path.exists():
        return times, gex
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
            times.append(parse_t(row["t"]))
            g = row.get("net_gex")
            gex.append(float(g) if isinstance(g, (int, float)) else None)
        except Exception:
            continue
    return times, gex


def last_gex(tape_times: list[datetime], tape_gex: list[float | None], t: datetime) -> float | None:
    if not tape_times:
        return None
    j = bisect.bisect_right(tape_times, t) - 1
    while j >= 0 and tape_gex[j] is None:
        j -= 1
    return tape_gex[j] if j >= 0 else None


def score_series(rows: list[dict], tape_times: list[datetime], tape_gex: list[float | None]) -> list[dict]:
    times = [parse_t(r["t"]) for r in rows]
    spot = [float(r.get("spot") or 0) for r in rows]
    ce_oi = [float(r.get("ce_oi") or 0) for r in rows]
    pe_oi = [float(r.get("pe_oi") or 0) for r in rows]
    ce_vol = [float(r.get("ce_vol") or 0) for r in rows]
    pe_vol = [float(r.get("pe_vol") or 0) for r in rows]
    ce_prem = [float(r.get("ce_prem") or 0) for r in rows]
    pe_prem = [float(r.get("pe_prem") or 0) for r in rows]
    out: list[dict] = []
    flow_cache: dict[int, tuple[str, str] | None] = {}

    def flow(i: int):
        if i in flow_cache:
            return flow_cache[i]
        j = index_ago(times, i, 60)
        d_ce = ce_oi[i] - ce_oi[j]
        d_pe = pe_oi[i] - pe_oi[j]
        dp_ce = ce_prem[i] - ce_prem[j] if ce_prem[i] > 0 and ce_prem[j] > 0 else None
        dp_pe = pe_prem[i] - pe_prem[j] if pe_prem[i] > 0 and pe_prem[j] > 0 else None
        res = read_flow(d_ce, d_pe, dp_ce, dp_pe)
        flow_cache[i] = res
        return res

    for i in range(8, len(rows)):
        comps: list[str] = []
        # 1) put writing persists: >=8 of the last 30 samples (~5 min).
        start = max(0, i - 30 + 1)
        sold = sum(1 for k in range(start, i + 1) if (flow(k) or ("", ""))[0] == "puts sold")
        if sold >= 8:
            comps.append("put-writing")
        # 2) call OI builds over 2 min.
        i2 = index_ago(times, i, 120)
        if ce_oi[i] - ce_oi[i2] >= 500_000:
            comps.append("call-build")
        # 3) call premium richer than the delta-implied move.
        if ce_prem[i] > 0 and ce_prem[i2] > 0 and spot[i] > 0 and spot[i2] > 0:
            residual = (ce_prem[i] - ce_prem[i2] - 0.5 * (spot[i] - spot[i2])) / ce_prem[i2]
            if residual > 0.01:
                comps.append("call-premium")
        # 4) GEX flip/rise (1-min tape joined causally).
        g = last_gex(tape_times, tape_gex, times[i])
        g_prev = None
        if tape_times:
            jj = bisect.bisect_right(tape_times, times[i]) - 1
            k = max(0, jj - 6)
            while k < jj and tape_gex[k] is None:
                k += 1
            g_prev = tape_gex[k]
        if g is not None and g_prev is not None:
            flipped = g > 0 and any(
                (tape_gex[x] is not None and tape_gex[x] < 0)
                for x in range(max(0, (bisect.bisect_right(tape_times, times[i]) - 1) - 6),
                               bisect.bisect_right(tape_times, times[i]))
            )
            if flipped or g - g_prev >= 10:
                comps.append("gex")
        # 5) participation: 60s chain volume vs the prior 20 min median.
        iv = index_ago(times, i, 60)
        v_now = (ce_vol[i] + pe_vol[i]) - (ce_vol[iv] + pe_vol[iv])
        base_vals = []
        for k in range(max(0, i - 120), i, 6):
            kk = index_ago(times, k, 60)
            if kk < k:
                base_vals.append((ce_vol[k] + pe_vol[k]) - (ce_vol[kk] + pe_vol[kk]))
        base = statistics.median(base_vals) if base_vals else 0.0
        rvol = v_now / base if base > 0 else 0.0
        if rvol >= 1.8:
            comps.append("rvol")
        score = min(7, len(comps) + (1 if "put-writing" in comps else 0) + (1 if "call-build" in comps else 0))
        # weighted like the TS score: put 2, call 2, premium/gex/rvol 1.
        score = 0
        for c in comps:
            score += 2 if c in ("put-writing", "call-build") else 1
        out.append({
            "i": i, "t": times[i].isoformat(), "spot": spot[i], "score": score,
            "state": "armed" if score >= 5 else ("watch" if score >= 3 else "quiet"),
            "comps": comps, "rvol": round(rvol, 2), "gex": g,
        })
    return out


def hhmm(iso: str) -> str:
    return iso[11:19]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="2026-10-28")
    ap.add_argument("--from", dest="t_from", default=None)
    ap.add_argument("--to", dest="t_to", default=None)
    ap.add_argument("--evaluate", action="store_true")
    ap.add_argument("--horizon", type=int, default=300, help="forward window seconds")
    ap.add_argument("--move", type=float, default=40.0, help="event move in points")
    args = ap.parse_args(argv)

    rows = fetch_summary(args.date)
    if not rows:
        print("no 10s data")
        return 1
    tape_times, tape_gex = load_tape(args.date)
    series = score_series(rows, tape_times, tape_gex)
    by_i = {s["i"]: s for s in series}
    times = [parse_t(r["t"]) for r in rows]
    spot = [float(r.get("spot") or 0) for r in rows]

    if not args.evaluate:
        lo = args.t_from or "00:00"
        hi = args.t_to or "23:59"
        print(f"{args.date}: {len(series)} scored snapshots")
        for s in series:
            hm = hhmm(s["t"])
            if lo <= hm <= hi:
                print(
                    f"  {hm}  spot {s['spot']:8.2f}  score {s['score']}/7  "
                    f"{s['state']:<6}  rvol {s['rvol']:.2f}  {'+'.join(s['comps']) or '-'}"
                )
        # first arm in the window and forward move to the peak
        armed = [s for s in series if lo <= hhmm(s["t"]) <= hi and s["score"] >= 5]
        if armed:
            first = armed[0]
            i = first["i"]
            j = index_ago(times, len(rows) - 1, 0)
            peak = max(spot[i:j + 1])
            trough = min(spot[i:j + 1])
            print(f"\nfirst ARM {hhmm(first['t'])} spot {first['spot']:.2f}; "
                  f"session after: peak {peak:.2f} (+{peak - first['spot']:.0f}) "
                  f"trough {trough:.2f} ({trough - first['spot']:+.0f})")
        return 0

    # Causal evaluation: score>=5 -> event within the forward horizon.
    events = 0
    hits = 0
    armed_rows = [s for s in series if s["score"] >= 5]
    for s in series:
        i = s["i"]
        j = i
        while j < len(times) and (times[j] - times[i]).total_seconds() <= args.horizon:
            j += 1
        if j >= len(times):
            continue
        fwd = max(abs(spot[j] - spot[i]), abs(min(spot[i:j + 1]) - spot[i]),
                  abs(max(spot[i:j + 1]) - spot[i]))
        if fwd >= args.move:
            events += 1
            if any((parse_t(a["t"]) <= times[i] and (times[i] - parse_t(a["t"])).total_seconds() <= 600) for a in armed_rows):
                hits += 1
    print(f"{args.date}: {len(series)} snapshots, {events} forward {args.horizon}s moves >= {args.move:g} pts")
    print(f"  armings (score>=5): {len(armed_rows)}")
    if armed_rows:
        lead = []
        miss = 0
        for s in armed_rows:
            i = s["i"]
            j = i
            while j < len(times) and (times[j] - times[i]).total_seconds() <= args.horizon:
                j += 1
            if j >= len(times):
                continue
            if max(abs(spot[j] - spot[i]), abs(max(spot[i:j + 1]) - spot[i]),
                   abs(min(spot[i:j + 1]) - spot[i])) >= args.move:
                lead.append(hhmm(s["t"]))
            else:
                miss += 1
        print(f"  armings followed by a >= {args.move:g} pt move within {args.horizon}s: "
              f"{len(lead)} ({len(lead) / max(len(armed_rows), 1):.0%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
