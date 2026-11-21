#!/usr/bin/env python3
"""NIFTY intraday anatomy — detect every meaningful move, then test what drove it.

Reads whatever the session actually recorded and builds a tape timeline from the
lanes that exist. On 2026-10-27 the archive has NIFTY tape, chain10s and report
snapshots from 10:04 to 15:29; it has no NIFTY futures and no SENSEX tape/chain,
so those two lanes are omitted and badged unavailable rather than fabricated.

Outputs
-------
reports/nifty_<session>/research/intraday_anatomy.json
reports/nifty_<session>/research/intraday_anatomy.html          (section fragment)
reports/nifty_<session>/research/intraday_anatomy_preview.html  (isolated wrapper)

Usage
-----
    python scripts/market/nifty_research_intraday_anatomy.py
    python scripts/market/nifty_research_intraday_anatomy.py --session 2026-10-27 \
        --expiry 2026-10-27 --clip 15:29

Detection is mechanical:
  1. 8-point zigzag on 1-minute spot closes; legs merge when the counter-swing is
     <= 6 pts and <= 5 min, then extend along the monotone run (max 15 bars).
  2. impulse flags: 5m / 15m return vs the prior 30m distribution, robust
     (median / 1.4826*MAD) z-score. A cluster of flags is an impulse.
An event is a merged leg with |move| >= 14 pts (>= 20 if under 3 minutes), or a
z-impulse >= 8 pts the legs did not already cover.
"""
from __future__ import annotations

import argparse
import bisect
import json
import math
import statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SESSION = "2026-11-17"
EXPIRY = "2026-11-17"
OUT = ROOT / "reports/nifty_2026-11-17/research"
CLIP = "14:09"
P_NIFTY_TAPE = ROOT / "experiments/data/nifty_tape/2026-11-17.jsonl"
P_NIFTY_CHAIN = ROOT / "experiments/data/nifty_chain10s/2026-11-17.jsonl"
P_NIFTY_SNAPS = ROOT / "experiments/data/nifty_snapshots/2026-11-17.jsonl"
P_FUT = ROOT / "reports/nifty_2026-11-17/data/futures_1m.json"
P_SENSEX_TAPE = ROOT / "experiments/data/options_tape/SENSEX/2026-11-17.jsonl"
P_SENSEX_CHAIN = ROOT / "experiments/data/options_chain10s/SENSEX/2026-11-17.jsonl"
P_SENSEX_SNAPS = ROOT / "experiments/data/options_snapshots/SENSEX/2026-11-17.jsonl"

ZIGZAG = 8.0
MERGE_PTS = 6.0
MERGE_MIN = 5
EVENT_MIN_PTS = 20.0
EVENT_MIN_FAST = 28.0


# --------------------------------------------------------------------- utils
def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def hm(iso: str) -> str:
    return iso[11:16]


def minutes(iso: str) -> float:
    return int(iso[11:13]) * 60 + int(iso[14:16]) + int(iso[17:19]) / 60.0


def clock(mins: float) -> str:
    m = int(round(mins))
    return f"{m // 60:02d}:{m % 60:02d}"


def percentile_rank(values: list[float], value: float) -> float:
    if not values:
        return 0.0
    return sum(1 for v in values if v <= value) / len(values)


def rnd(x, n=2):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(x, n)


def within_clip(iso: str, clip: str | None = None) -> bool:
    return hm(iso) <= (clip or CLIP)


def nearest_idx(times: list[float], t: float, max_gap: float = 3.0):
    if not times:
        return None
    pos = bisect.bisect_left(times, t)
    best = None
    for j in (pos - 1, pos):
        if 0 <= j < len(times):
            d = abs(times[j] - t)
            if best is None or d < best[0]:
                best = (d, j)
    if best and best[0] <= max_gap:
        return best[1]
    return None


def nearest(rows: list[dict], t: float, key: str = "t", max_gap: float = 3.0):
    times = [minutes(row[key]) for row in rows]
    i = nearest_idx(times, t, max_gap)
    return rows[i] if i is not None else None


# ---------------------------------------------------------------------- load
def load() -> dict:
    n_tape = [r for r in read_jsonl(P_NIFTY_TAPE) if within_clip(r["t"])]
    n_chain = [r for r in read_jsonl(P_NIFTY_CHAIN) if within_clip(r["t"])]
    n_snaps = [r for r in read_jsonl(P_NIFTY_SNAPS) if within_clip(r["t"])]
    s_tape = [r for r in read_jsonl(P_SENSEX_TAPE) if within_clip(r["t"])]
    s_chain = [r for r in read_jsonl(P_SENSEX_CHAIN) if within_clip(r["t"])]
    s_snaps = [r for r in read_jsonl(P_SENSEX_SNAPS) if within_clip(r["t"])]
    fut_raw = json.loads(P_FUT.read_text()) if P_FUT.exists() else {}
    fut = [c for c in fut_raw.get("candles", []) if within_clip(c["t"])]

    out = {
        "n_tape": n_tape, "n_chain": n_chain, "n_snaps": n_snaps,
        "s_tape": s_tape, "s_chain": s_chain, "s_snaps": s_snaps,
        "fut": fut,
        "fut_meta": {k: fut_raw.get(k) for k in ("symbol", "expiry", "interval")},
    }
    out["_n_chain_t"] = [minutes(r["t"]) for r in n_chain]
    out["_n_tape_t"] = [minutes(r["t"]) for r in n_tape]
    out["_n_snaps_t"] = [minutes(r["t"]) for r in n_snaps]
    out["_s_tape_t"] = [minutes(r["t"]) for r in s_tape]
    return out


# ----------------------------------------------------------------- detection
def zigzag(values: list[float], thresh: float) -> list[int]:
    pivots: list[int] = [0]
    direction = 0
    ext = 0
    for i in range(1, len(values)):
        if direction >= 0:
            if values[i] >= values[ext]:
                ext = i
            if values[ext] - values[i] >= thresh:
                pivots.append(ext)
                direction = -1
                ext = i
        if direction <= 0:
            if values[i] <= values[ext]:
                ext = i
            if values[i] - values[ext] >= thresh:
                pivots.append(ext)
                direction = 1
                ext = i
    pivots.append(ext)
    dedup: list[int] = []
    for i in pivots:
        if not dedup or dedup[-1] != i:
            dedup.append(i)
    return dedup


def raw_legs(bars: list[dict]) -> list[dict]:
    closes = [b["c"] for b in bars]
    piv = zigzag(closes, ZIGZAG)
    legs = []
    for a, b in zip(piv, piv[1:]):
        legs.append({
            "i0": a, "i1": b, "t0": bars[a]["t"], "t1": bars[b]["t"],
            "p0": closes[a], "p1": closes[b], "move": closes[b] - closes[a],
            "dur": b - a,
        })
    return legs


def merge_legs(legs: list[dict]) -> list[dict]:
    out: list[dict] = []
    for leg in legs:
        if out:
            prev = out[-1]
            same_dir = (leg["move"] > 0) == (prev["move"] > 0)
            gap = leg["i0"] - prev["i1"]
            if same_dir and gap <= MERGE_MIN and abs(leg["p0"] - prev["p1"]) <= MERGE_PTS:
                out[-1] = {
                    "i0": prev["i0"], "i1": leg["i1"], "t0": prev["t0"], "t1": leg["t1"],
                    "p0": prev["p0"], "p1": leg["p1"], "move": leg["p1"] - prev["p0"],
                    "dur": leg["i1"] - prev["i0"],
                }
                continue
        out.append(dict(leg))
    return out


def robust_z_flags(bars: list[dict], horizon: int) -> list[dict]:
    closes = [b["c"] for b in bars]
    out = []
    for i in range(horizon, len(closes)):
        r = closes[i] - closes[i - horizon]
        hist = [closes[j] - closes[j - horizon] for j in range(max(horizon, i - 30), i)]
        if len(hist) < 8:
            continue
        med = st.median(hist)
        mad = st.median([abs(x - med) for x in hist])
        scale = 1.4826 * mad
        if scale < 0.5:
            continue
        out.append({"i": i, "t": bars[i]["t"], "r": r, "z": (r - med) / scale, "h": horizon})
    return out


def detect_events(bars: list[dict]):
    legs = merge_legs(raw_legs(bars))
    z5 = robust_z_flags(bars, 5)
    z15 = robust_z_flags(bars, 15)

    impulses = []
    for series, h in ((z5, 5), (z15, 15)):
        for flag in series:
            if abs(flag["z"]) >= 2.5 and abs(flag["r"]) >= (6 if h == 5 else 9):
                impulses.append(flag)
    impulses.sort(key=lambda f: f["i"])
    clusters: list[dict] = []
    for f in impulses:
        start = f["i"] - f["h"] + 1
        if clusters and start <= clusters[-1]["i1"] + 1:
            c = clusters[-1]
            c["i0"] = min(c["i0"], start)
            c["i1"] = max(c["i1"], f["i"])
            if abs(f["z"]) > abs(c["z"]):
                c["z"] = f["z"]
            c["h"] = max(c["h"], f["h"])
        else:
            clusters.append({"i0": start, "i1": f["i"], "z": f["z"], "h": f["h"], "t": f["t"]})

    events = []
    for leg in legs:
        if abs(leg["move"]) < EVENT_MIN_PTS or leg["dur"] < 2:
            continue
        events.append({
            "i0": leg["i0"], "i1": leg["i1"], "t0": leg["t0"], "t1": leg["t1"],
            "p0": leg["p0"], "p1": leg["p1"], "move": leg["move"], "dur": leg["dur"],
            "z": None, "src": "leg",
        })

    for c in clusters:
        hit = any(e["i0"] <= c["i1"] and c["i0"] <= e["i1"] for e in events)
        if hit:
            continue
        span = bars[c["i1"]]["c"] - bars[c["i0"]]["c"]
        if abs(span) < 8:
            continue
        events.append({
            "i0": c["i0"], "i1": c["i1"], "t0": bars[c["i0"]]["t"], "t1": bars[c["i1"]]["t"],
            "p0": bars[c["i0"]]["c"], "p1": bars[c["i1"]]["c"], "move": span,
            "dur": c["i1"] - c["i0"], "z": c["z"], "src": "impulse",
        })

    events.sort(key=lambda e: e["i0"])
    merged: list[dict] = []
    for e in events:
        if merged:
            p = merged[-1]
            same = (e["move"] > 0) == (p["move"] > 0)
            if same and e["i0"] <= p["i1"] + 1:
                p["i1"] = e["i1"]
                p["t1"] = e["t1"]
                p["p1"] = e["p1"]
                p["move"] = e["p1"] - p["p0"]
                p["dur"] = e["i1"] - e["i0"]
                p["src"] = "merged"
                continue
        merged.append(dict(e))

    closes = [b["c"] for b in bars]
    for e in merged:
        up = e["move"] > 0
        lo = e["i0"]
        while lo > 0 and (e["i0"] - lo) < 15 and (
                closes[lo - 1] <= closes[lo] if up else closes[lo - 1] >= closes[lo]):
            lo -= 1
        hi = e["i1"]
        while hi < len(closes) - 1 and (hi - e["i1"]) < 15 and (
                closes[hi + 1] >= closes[hi] if up else closes[hi + 1] <= closes[hi]):
            hi += 1
        e.update(i0=lo, i1=hi, t0=bars[lo]["t"], t1=bars[hi]["t"],
                 p0=closes[lo], p1=closes[hi], move=closes[hi] - closes[lo], dur=hi - lo)

    merged.sort(key=lambda e: e["i0"])
    merged = [e for e in merged
              if abs(e["move"]) >= EVENT_MIN_PTS and (e["dur"] >= 3 or abs(e["move"]) >= EVENT_MIN_FAST)]
    return merged, legs, z5, z15


def tag_events(events: list[dict], bars: list[dict]):
    closes = [b["c"] for b in bars]
    for i, e in enumerate(events, 1):
        e["id"] = f"E{i}"
        e["dir"] = "up" if e["move"] > 0 else "down"
        e["pct"] = e["move"] / e["p0"] * 100
        end = min(e["i1"] + 45, len(closes) - 1)
        path = closes[e["i1"]: end + 1]
        if len(path) > 1 and e["move"]:
            adverse = min(path[1:]) if e["move"] > 0 else max(path[1:])
            raw = (e["p1"] - adverse) / e["move"] * 100
            e["retrace"] = max(-50.0, min(200.0, raw))
            e["full_reversal"] = raw >= 90
            idx = closes.index(adverse, e["i1"] + 1) if adverse in closes[e["i1"] + 1:] else e["i1"]
            e["retrace_at"] = bars[idx]["t"]
        else:
            e["retrace"] = 0.0
            e["full_reversal"] = False
            e["retrace_at"] = None
    return events


# ------------------------------------------------------------------ contexts
def spot_bars(data: dict) -> list[dict]:
    """1-minute spot bars. Futures are used only if the session actually has them."""
    if data["fut"]:
        return [{"t": c["t"], "c": c["c"], "oi": c.get("oi"), "v": c.get("v")} for c in data["fut"]]
    return [{"t": r["t"], "c": r["spot"], "oi": r.get("ce_oi", 0) + r.get("pe_oi", 0),
             "v": r.get("ce_vol", 0) + r.get("pe_vol", 0)} for r in data["n_tape"]]


def series_by_minute(data):
    bars = spot_bars(data)
    tape = data["n_tape"]
    snaps = data["n_snaps"]
    n0 = tape[0]["spot"] if tape else 0.0

    rows = []
    for bar in bars:
        t = minutes(bar["t"])
        nt = nearest(tape, t)
        snap = nearest(snaps, t, max_gap=4)
        iv = skew = None
        if snap:
            ivs = snap["report"].get("iv_surface") or {}
            atm = ivs.get("atm") or {}
            iv = atm.get("avg_iv")
            sk = ivs.get("skew") or {}
            skew = sk.get("skew_25d")
        rows.append({
            "t": hm(bar["t"]), "min": t, "f": bar["c"], "oi": bar["oi"], "v": bar["v"],
            "ns": nt["spot"] if nt else None,
            "n": (nt["spot"] / n0 - 1) * 100 if nt else None,
            "iv": iv, "skew": skew,
            "gex": nt.get("net_gex") if nt else None,
            "cw": nt["walls"]["calls"][0]["strike"] if nt and nt.get("walls", {}).get("calls") else None,
            "pw": nt["walls"]["puts"][0]["strike"] if nt and nt.get("walls", {}).get("puts") else None,
            "mp": nt.get("max_pain") if nt else None,
            "flip": nt.get("flip") if nt else None,
            "atm_iv": ((nt.get("atm_ce_iv") or 0) + (nt.get("atm_pe_iv") or 0)) / 2
            if nt and (nt.get("atm_ce_iv") or nt.get("atm_pe_iv")) else None,
        })
    return rows, n0


def bucket_volumes(data, t0: float, t1: float, ref_spot: float, width: float = 250.0):
    """ITM/OTM cumulative-volume delta, books fixed at event start."""
    chain = data["n_chain"]
    times = data.get("_n_chain_t") or []
    if not chain:
        return None
    ia = nearest_idx(times, t0, 1.5)
    ib = nearest_idx(times, t1, 1.5)
    if ia is None or ib is None:
        return None
    a, b = chain[ia], chain[ib]
    amap = {round(r[0], 1): r for r in a["rows"]}
    bmap = {round(r[0], 1): r for r in b["rows"]}
    keys = set(amap) & set(bmap)
    itm_put = [k for k in keys if ref_spot < k <= ref_spot + width]
    itm_call = [k for k in keys if ref_spot - width <= k < ref_spot]
    otm_put = [k for k in keys if ref_spot - width <= k < ref_spot]
    otm_call = [k for k in keys if ref_spot < k <= ref_spot + width]

    def delta(keys_, vol_idx, oi_idx):
        v = sum(max(0.0, bmap[k][vol_idx] - amap[k][vol_idx]) for k in keys_)
        oi = sum(bmap[k][oi_idx] - amap[k][oi_idx] for k in keys_)
        return v, oi

    ip_v, ip_oi = delta(itm_put, 6, 5)
    ic_v, ic_oi = delta(itm_call, 3, 2)
    op_v, _ = delta(otm_put, 6, 5)
    oc_v, _ = delta(otm_call, 3, 2)
    return {
        "itm_put_vol": ip_v, "itm_call_vol": ic_v,
        "otm_put_vol": op_v, "otm_call_vol": oc_v,
        "itm_put_oi": ip_oi, "itm_call_oi": ic_oi, "n_strikes": len(keys),
    }


def wall_state(data, t: float, spot: float, strikes: tuple | None = None):
    tape = data["n_tape"]
    row = nearest(tape, t, max_gap=2)
    if not row:
        return None
    chain = data["n_chain"]
    snap = nearest(chain, t, max_gap=1.5)
    calls = (row.get("walls") or {}).get("calls") or []
    puts = (row.get("walls") or {}).get("puts") or []
    cw = strikes[0] if strikes else (calls[0]["strike"] if calls else None)
    pw = strikes[1] if strikes else (puts[0]["strike"] if puts else None)
    ce_oi = pe_oi = None
    if snap:
        m = {round(r[0], 1): r for r in snap["rows"]}
        if cw and round(cw, 1) in m:
            ce_oi = m[round(cw, 1)][2]
        if pw and round(pw, 1) in m:
            pe_oi = m[round(pw, 1)][5]
    return {
        "call_wall": calls[0]["strike"] if calls else None,
        "put_wall": puts[0]["strike"] if puts else None,
        "max_pain": row.get("max_pain"), "gex": row.get("net_gex"), "flip": row.get("flip"),
        "ce_wall_oi": ce_oi, "pe_wall_oi": pe_oi,
        "ce_wall_strike": cw, "pe_wall_strike": pw,
        "dist_call": (calls[0]["strike"] - spot) if calls else None,
        "dist_put": (spot - puts[0]["strike"]) if puts else None,
    }


def intraday_itm_flow(data, width: float = 250.0) -> dict[int, list[float]]:
    """Per-minute ITM option volume, attributed with *prior* moneyness."""
    per: dict[int, list[float]] = {}
    prev = None
    for snap in data["n_chain"]:
        if prev is not None:
            mk = int(minutes(snap["t"]))
            ps = prev["spot"]
            a_map = {round(r[0], 1): r for r in prev["rows"]}
            b_map = {round(r[0], 1): r for r in snap["rows"]}
            put = call = 0.0
            for k in a_map.keys() & b_map.keys():
                if abs(k - ps) > width:
                    continue
                dv_ce = b_map[k][3] - a_map[k][3]
                dv_pe = b_map[k][6] - a_map[k][6]
                if dv_ce > 0 and k < ps:
                    call += dv_ce
                if dv_pe > 0 and k > ps:
                    put += dv_pe
            slot = per.setdefault(mk, [0.0, 0.0])
            slot[0] += put
            slot[1] += call
        prev = snap
    return per


def chain_terrain(data, strike_lo: int, strike_hi: int, step: int = 50, every_min: int = 2):
    grid = list(range(strike_lo, strike_hi + 1, step))
    snaps = data["n_chain"]
    if not snaps:
        return {"times": [], "strikes": grid, "net": [], "ce": [], "pe": []}
    picks, last = [], -1e9
    for s in snaps:
        t = minutes(s["t"])
        if t - last >= every_min:
            picks.append(s)
            last = t
    times, net, ce, pe = [], [], [], []
    for s in picks:
        rowmap = {round(r[0], 1): r for r in s["rows"]}
        times.append(hm(s["t"]))
        net.append([rnd((rowmap[g][5] - rowmap[g][2]) / 1e6, 2) if g in rowmap else None for g in grid])
        ce.append([rnd(rowmap[g][2] / 1e6, 2) if g in rowmap else None for g in grid])
        pe.append([rnd(rowmap[g][5] / 1e6, 2) if g in rowmap else None for g in grid])
    return {"times": times, "strikes": grid, "net": net, "ce": ce, "pe": pe}


# --------------------------------------------------------------- driver math
DRIVERS = [
    ("wall", "Call/put wall rejection or breach", "Wall"),
    ("gamma", "Short-gamma amplification", "Gamma"),
    ("gex_flip", "GEX regime / flip change", "GEX flip"),
    ("itm_flow", "ITM option volume surge", "ITM flow"),
    ("pin", "Max-pain gravity", "Max pain"),
]


def has_persistent_flip(tape: list[dict], t0: float, t1: float) -> bool:
    """A GEX regime change that holds for five minutes, not a crossing near zero."""
    for j in range(1, len(tape)):
        tj = minutes(tape[j]["t"])
        if tj < t0 or tj > t1:
            continue
        a, b = tape[j - 1].get("net_gex"), tape[j].get("net_gex")
        if a is None or b is None or (a < 0) == (b < 0):
            continue
        if abs(a) < 50 or abs(b) < 50:
            continue
        nxt = [r["net_gex"] for r in tape[j: j + 7] if r.get("net_gex") is not None]
        if len(nxt) >= 5 and all((v < 0) == (b < 0) for v in nxt):
            return True
    return False


def build_analysis(data):
    bars = spot_bars(data)
    events, legs, z5, z15 = detect_events(bars)
    tag_events(events, bars)

    for e in events:
        zs5 = [abs(f["z"]) for f in z5 if e["i0"] - 5 <= f["i"] <= e["i1"]]
        zs15 = [abs(f["z"]) for f in z15 if e["i0"] - 15 <= f["i"] <= e["i1"]]
        e["z5"] = max(zs5) if zs5 else None
        e["z15"] = max(zs15) if zs15 else None

    rows, n0 = series_by_minute(data)
    tape = data["n_tape"]
    snaps = data["n_snaps"]

    vol_windows = []
    for i in range(15, len(bars)):
        vol_windows.append(sum((b["v"] or 0) for b in bars[i - 15: i + 1]))
    vol_p90 = st.quantiles(vol_windows, n=10)[8] if len(vol_windows) > 10 else 1.0

    for e in events:
        i0, i1 = e["i0"], e["i1"]
        a, b = bars[i0], bars[i1]
        s0p = a["c"]
        w = wall_state(data, minutes(a["t"]), s0p)
        w1 = wall_state(data, minutes(b["t"]), b["c"],
                        strikes=(w["ce_wall_strike"], w["pe_wall_strike"]) if w else None) if w else None
        e["walls"] = {
            "start": w, "end": w1,
            "call_oi_d": (w1["ce_wall_oi"] - w["ce_wall_oi"]) if w and w1 and w["ce_wall_oi"] and w1["ce_wall_oi"] else None,
            "put_oi_d": (w1["pe_wall_oi"] - w["pe_wall_oi"]) if w and w1 and w["pe_wall_oi"] and w1["pe_wall_oi"] else None,
        }
        inside = [r for r in tape
                  if minutes(a["t"]) - 0.75 <= minutes(r["t"]) <= minutes(b["t"]) + 0.75]
        if inside and w:
            # A wall only matters if it started on the correct side of price:
            # a call wall below spot is already support, not resistance.
            start_gap_call = (w["call_wall"] - s0p) if w.get("call_wall") else None
            start_gap_put = (s0p - w["put_wall"]) if w.get("put_wall") else None
            gaps_call = [(w["call_wall"] or 0) - r["spot"] for r in inside if w.get("call_wall")]
            gaps_put = [r["spot"] - (w["put_wall"] or 0) for r in inside if w.get("put_wall")]
            e["walls"]["min_gap_call"] = min(gaps_call) if gaps_call else None
            e["walls"]["min_gap_put"] = min(gaps_put) if gaps_put else None
            e["walls"]["start_gap_call"] = start_gap_call
            e["walls"]["start_gap_put"] = start_gap_put
            e["walls"]["breach_call"] = bool(start_gap_call is not None and start_gap_call > 2
                                             and any(g < -2 for g in gaps_call))
            e["walls"]["breach_put"] = bool(start_gap_put is not None and start_gap_put > 2
                                            and any(g < -2 for g in gaps_put))
            e["walls"]["wrong_side_call"] = bool(start_gap_call is not None and start_gap_call <= 2)
            e["walls"]["wrong_side_put"] = bool(start_gap_put is not None and start_gap_put <= 2)
        else:
            e["walls"]["min_gap_call"] = None
            e["walls"]["min_gap_put"] = None
            e["walls"]["start_gap_call"] = None
            e["walls"]["start_gap_put"] = None
            e["walls"]["breach_call"] = False
            e["walls"]["breach_put"] = False
            e["walls"]["wrong_side_call"] = False
            e["walls"]["wrong_side_put"] = False

        post = [bar["c"] for bar in bars[i1: i1 + 16]]
        adv = ((max(post) - b["c"]) if e["move"] > 0 else (b["c"] - min(post))) if post else None
        e["walls"]["post_advance"] = adv
        e["walls"]["rejected"] = bool(
            adv is not None and adv < 10
            and not e["walls"].get("wrong_side_call") and not e["walls"].get("wrong_side_put")
            and (
                (e["move"] > 0 and (e["walls"].get("min_gap_call") or 99) <= 10 and not e["walls"].get("breach_call"))
                or (e["move"] < 0 and (e["walls"].get("min_gap_put") or 99) <= 10 and not e["walls"].get("breach_put"))
            )
        )

        e["options"] = bucket_volumes(data, minutes(a["t"]), minutes(b["t"]), s0p) or {}
        gex_win = [r for r in tape
                   if minutes(a["t"]) <= minutes(r["t"]) <= minutes(b["t"]) and r.get("net_gex") is not None]
        e["gex"] = {
            "start": gex_win[0]["net_gex"] if gex_win else None,
            "end": gex_win[-1]["net_gex"] if gex_win else None,
            "min": min((r["net_gex"] for r in gex_win), default=None),
            "max": max((r["net_gex"] for r in gex_win), default=None),
            "short_share": (sum(1 for r in gex_win if r["net_gex"] < 0) / len(gex_win)) if gex_win else None,
            "flip_start": w["flip"] if w else None,
            "flip_end": w1["flip"] if w1 else None,
            "sign_flip": has_persistent_flip(tape, minutes(a["t"]), minutes(b["t"])),
        }
        nt_a = nearest(tape, minutes(a["t"]))
        nt_b = nearest(tape, minutes(b["t"]))
        e["nifty_pct"] = (nt_b["spot"] / nt_a["spot"] - 1) * 100 if nt_a and nt_b else None
        iv_a = ((nt_a.get("atm_ce_iv") or 0) + (nt_a.get("atm_pe_iv") or 0)) / 2 if nt_a else None
        iv_b = ((nt_b.get("atm_ce_iv") or 0) + (nt_b.get("atm_pe_iv") or 0)) / 2 if nt_b else None
        e["iv"] = {"start": rnd(iv_a, 2), "end": rnd(iv_b, 2),
                   "d": rnd(iv_b - iv_a, 2) if iv_a and iv_b else None}

        iv_mean = iv_a or 0
        implied = (n0 * iv_mean / 100.0) / math.sqrt(252 * 375) * math.sqrt(max(1, e["dur"])) if iv_mean else 0
        e["gamma_ratio"] = (abs(e["move"]) / implied) if implied else None

        # ---------------- scores (only measurable drivers)
        scores, methods = {}, {}

        wall_score, wall_note = 0.0, "no wall within reach"
        if e["move"] > 0:
            gap = e["walls"].get("min_gap_call")
            if e["walls"].get("wrong_side_call"):
                wall_note = f"call wall {e['walls']['start']['call_wall']:.0f} already below price — no overhead resistance"
            elif gap is not None:
                if e["walls"].get("breach_call"):
                    wall_score, wall_note = 0.5, f"spot crossed the call wall (min gap {gap:+.0f} pts)"
                elif gap <= 8 and e["walls"].get("rejected"):
                    wall_score, wall_note = 0.9, f"spot stopped {gap:+.0f} pts from the call wall (post +{(e['walls']['post_advance'] or 0):.0f})"
                elif gap <= 8:
                    wall_score, wall_note = 0.55, f"spot touched the call wall (min gap {gap:+.0f}) and kept going"
                elif gap <= 25:
                    wall_score, wall_note = 0.4, f"spot approached the call wall (min gap {gap:+.0f} pts)"
        else:
            gap = e["walls"].get("min_gap_put")
            if e["walls"].get("wrong_side_put"):
                wall_note = f"put wall {e['walls']['start']['put_wall']:.0f} already above price — no support below"
            elif gap is not None:
                if e["walls"].get("breach_put"):
                    wall_score, wall_note = 0.5, f"spot probed through the put wall (min gap {gap:+.0f} pts)"
                elif gap <= 8 and e["walls"].get("rejected"):
                    wall_score, wall_note = 0.9, f"spot held {gap:+.0f} pts above the put wall and bounced"
                elif gap <= 8:
                    wall_score, wall_note = 0.55, f"spot touched the put wall (min gap {gap:+.0f}) and kept falling"
                elif gap <= 25:
                    wall_score, wall_note = 0.4, f"spot pressed the put wall (min gap {gap:+.0f} pts)"
        scores["wall"], methods["wall"] = wall_score, wall_note

        short_share = e["gex"].get("short_share") or 0.0
        ratio = e["gamma_ratio"] or 0.0
        scores["gamma"] = round(min(1.0, 0.55 * short_share + 0.45 * min(1.0, ratio / 1.6)), 2)
        methods["gamma"] = (f"{short_share*100:.0f}% of event minutes in short gamma; "
                            f"realised {abs(e['move']):.1f} pts = {ratio:.2f}x the ATM-IV 1σ for {max(1, e['dur'])} min")

        scores["gex_flip"] = 1.0 if e["gex"]["sign_flip"] else 0.0
        methods["gex_flip"] = ("net GEX sign flipped inside the window" if e["gex"]["sign_flip"]
                               else f"net GEX stayed {'negative' if (e['gex']['start'] or 0) < 0 else 'positive'} "
                                    f"({e['gex']['start']} -> {e['gex']['end']})")

        itm = e["options"].get("itm_put_vol", 0) + e["options"].get("itm_call_vol", 0)
        cache = data.setdefault("_itm_p90", {})
        mins = max(1, e["dur"])
        if mins not in cache:
            rolling = []
            chain = data["n_chain"]
            ref0 = tape[0]["spot"]
            for k in range(0, max(1, len(chain) - 15), 12):
                t_a = minutes(chain[k]["t"])
                if t_a + mins > minutes(chain[-1]["t"]):
                    break
                bk = bucket_volumes(data, t_a, t_a + mins, ref0, width=250.0)
                if bk:
                    rolling.append(bk["itm_put_vol"] + bk["itm_call_vol"])
            cache[mins] = st.quantiles(rolling, n=10)[8] if len(rolling) > 10 else None
        itm_p90 = cache[mins]
        scores["itm_flow"] = round(min(1.0, itm / itm_p90), 2) if itm_p90 else 0.0
        methods["itm_flow"] = (f"ITM CE+PE volume delta {itm/1e6:.1f}M vs same-length p90 {itm_p90/1e6:.1f}M"
                               if itm_p90 else "insufficient chain history")

        mp = e["walls"]["start"].get("max_pain") if e["walls"]["start"] else None
        mp_end = e["walls"]["end"].get("max_pain") if e["walls"]["end"] else None
        if mp and mp_end:
            d0, d1 = abs(a["c"] - mp), abs(b["c"] - mp_end)
            scores["pin"] = round(max(0.0, min(1.0, 1 - d1 / d0)), 2) if d0 > 4 else 0.5
            methods["pin"] = f"distance to max pain {d0:.0f} -> {d1:.0f} pts (pin {mp:.0f} -> {mp_end:.0f})"
        else:
            scores["pin"], methods["pin"] = 0.0, "max pain unavailable"

        e["scores"], e["methods"] = scores, methods

    return events, legs, rows, n0, vol_p90


# ------------------------------------------------------------- explanations
def explain(e: dict) -> str:
    direction = "rose" if e["move"] > 0 else "fell"
    ranked = sorted(e["scores"].items(), key=lambda kv: -kv[1])
    top = [k for k, v in ranked if v >= 0.4][:2]
    parts = [f"Spot {direction} {abs(e['move']):.1f} pts ({e['pct']:+.2f}%) {hm(e['t0'])}–{hm(e['t1'])}."]

    if "wall" in top and e["walls"].get("start"):
        w = e["walls"]
        if e["move"] > 0:
            if w.get("wrong_side_call"):
                parts.append(f"The {w['start']['call_wall']:.0f} call wall was already below price, so it was support, not resistance.")
            else:
                parts.append(
                    f"Price {'cleared' if w.get('breach_call') else 'stopped'} "
                    f"{abs(w.get('min_gap_call') or 0):.0f} pts "
                    f"{'through' if w.get('breach_call') else 'under'} the "
                    f"{w['start']['call_wall']:.0f} call wall.")
        else:
            if w.get("wrong_side_put"):
                parts.append(f"The {w['start']['put_wall']:.0f} put wall was already above price, so it was resistance, not support.")
            else:
                parts.append(
                    f"The fall {'probed' if w.get('breach_put') else 'stopped'} "
                    f"{abs(w.get('min_gap_put') or 0):.0f} pts "
                    f"{'through' if w.get('breach_put') else 'above'} the "
                    f"{w['start']['put_wall']:.0f} put wall.")
    if "gamma" in top:
        g = e["gex"]
        ratio = e["gamma_ratio"] or 0
        short_share = g.get("short_share") or 0
        if ratio >= 1.15:
            parts.append("Movement outran the vol surface — hedging chased price instead of damping it.")
        elif short_share >= 0.5:
            parts.append(f"Dealers were short gamma for {short_share*100:.0f}% of the window, so hedging leaned "
                         f"with price; the leg still stayed inside the ATM-IV 1σ.")
        else:
            parts.append("Movement stayed inside the vol surface and gamma was not short, so hedging was not forced.")
    if "itm_flow" in top:
        ip = e["options"].get("itm_put_vol", 0)
        ic = e["options"].get("itm_call_vol", 0)
        side = "puts" if ip > ic else "calls"
        aligned = (ip > ic and e["move"] < 0) or (ic > ip and e["move"] > 0)
        parts.append(
            f"ITM {side} traded {max(ip, ic)/1e6:.1f}M in the window — "
            + ("the options book leaned with the move." if aligned
               else "buyers leaned against the move (the other side was absorbing it)."))
    if "pin" in top and e["walls"].get("start"):
        parts.append(f"Max pain sat at {e['walls']['start']['max_pain']:.0f}; price closed the distance to it.")
    if len(parts) == 1:
        parts.append("No measured driver reached the 0.4 evidence threshold; this is a tape-only leg.")
    return " ".join(parts)


def falsify(e: dict) -> str:
    top = sorted(e["scores"].items(), key=lambda kv: -kv[1])[0][0] if e["scores"] else "wall"
    return {
        "wall": "Falsified if the strike-level OI shows the wall unchanged through the window — then price crossed a level nobody defended.",
        "gamma": "Falsified if dealer positioning shows net long gamma through the window, or the move is fully explained by a single block print.",
        "gex_flip": "Falsified if the GEX sign change is a recompute artefact (same chain, different strike grid) rather than an OI change.",
        "itm_flow": "Falsified if the ITM volume delta is concentrated in one strike that did not trade near the spot path.",
        "pin": "Falsified if max pain was already at price before the leg started — then it is not gravity, just proximity.",
    }.get(top, "No falsifier attached.")


# ------------------------------------------------------------------ payload
def build_payload(data):
    events, legs, rows, n0, vol_p90 = build_analysis(data)
    bars = spot_bars(data)
    for e in events:
        e["label"] = f"{hm(e['t0'])}–{hm(e['t1'])} {'pump' if e['move'] > 0 else 'dump'}"

    tape = data["n_tape"]
    first_clock, last_clock = hm(tape[0]["t"]), hm(tape[-1]["t"])

    flow = intraday_itm_flow(data)
    clock_list, mins, spot, gex, cw, pw, mp = [], [], [], [], [], [], []
    pe, ce = [], []
    for r in rows:
        clock_list.append(r["t"])
        mins.append(round(r["min"], 2))
        spot.append(r.get("ns"))
        gex.append(r.get("gex"))
        cw.append(r.get("cw"))
        pw.append(r.get("pw"))
        mp.append(r.get("mp"))
        slot = flow.get(int(r["min"]), [0.0, 0.0])
        pe.append(round(slot[0] / 1e6, 2))
        ce.append(round(slot[1] / 1e6, 2))

    totals = sorted((a + b) for a, b in zip(pe, ce) if (a + b) > 0)
    thr = st.quantiles(totals, n=20)[17] if len(totals) > 20 else 0.0
    bursts, run = [], None
    for i, (a, b) in enumerate(zip(pe, ce)):
        hot = (a + b) >= thr and (a + b) > 0
        if hot and run is None:
            run = {"i0": i, "i1": i, "peak": i}
        elif hot and run is not None:
            run["i1"] = i
            if (a + b) > (pe[run["peak"]] + ce[run["peak"]]):
                run["peak"] = i
        elif run is not None:
            bursts.append(run)
            run = None
    if run is not None:
        bursts.append(run)
    burst_out = [{
        "i0": r["i0"], "i1": r["i1"], "m0": mins[r["i0"]], "m1": mins[r["i1"]],
        "t": clock_list[r["peak"]], "m": mins[r["peak"]],
        "pe": pe[r["peak"]], "ce": ce[r["peak"]],
        "kind": "put" if pe[r["peak"]] > ce[r["peak"]] else "call",
    } for r in bursts]

    flips = []
    for i in range(1, len(rows)):
        a, b = rows[i - 1].get("gex"), rows[i].get("gex")
        if a is None or b is None or (a < 0) == (b < 0):
            continue
        if abs(a) < 50 or abs(b) < 50:
            continue
        nxt = [r["gex"] for r in rows[i: i + 7] if r.get("gex") is not None]
        if len(nxt) >= 5 and all((v < 0) == (b < 0) for v in nxt):
            flips.append({"t": rows[i]["t"], "m": rows[i]["min"], "from": round(a, 1), "to": round(b, 1)})

    ref_strike = int(round(sum(spot[:10]) / max(1, len(spot[:10])) / 50) * 50)

    ev_out = []
    for e in events:
        typ = ("explosion" if e["move"] > 0 else "dump") if abs(e["move"]) >= 45 else "impulse"
        tags = []
        if e["gex"].get("sign_flip"):
            tags.append("gamma flip")
        if (e["move"] > 0 and e["walls"].get("breach_call")) or (e["move"] < 0 and e["walls"].get("breach_put")):
            tags.append("wall break")
            typ = "wall break"
        if e["walls"].get("rejected"):
            tags.append("wall defense")
            typ = "wall defense"
        ev_out.append({
            "id": e["id"], "m": round(minutes(e["t1"]), 2), "m0": round(minutes(e["t0"]), 2),
            "t": hm(e["t1"]), "t0": hm(e["t0"]), "t1": hm(e["t1"]),
            "move": rnd(e["move"], 1), "dir": e["dir"], "type": typ,
            "tags": tags, "spot": e["p1"], "dur": e["dur"],
            "wall_gap": rnd(e["walls"].get("min_gap_call") if e["move"] > 0 else e["walls"].get("min_gap_put"), 0),
            "wall_strike": (e["walls"]["start"]["call_wall"] if e["move"] > 0 and e["walls"]["start"]
                            else (e["walls"]["start"]["put_wall"] if e["walls"]["start"] else None)),
            "explain": explain(e), "falsify": falsify(e),
        })

    neg_start = next((r["t"] for r in rows if (r.get("gex") or 0) < 0), None)
    neg_end = next((r["t"] for r in rows if r["t"] > (neg_start or "00:00") and (r.get("gex") or 0) > 0), None)

    terrain = chain_terrain(data, ref_strike - 300, ref_strike + 300)

    highs = max(rows, key=lambda r: r["ns"] or -1e9)
    lows = min(rows, key=lambda r: r["ns"] or 1e9)
    spots = [r["ns"] for r in rows if r["ns"]]
    gex_valid = [r["gex"] for r in rows if r["gex"] is not None]

    session = {
        "first": rows[0]["ns"], "first_t": rows[0]["t"],
        "last": rows[-1]["ns"], "last_t": rows[-1]["t"],
        "high": {"t": highs["t"], "v": highs["ns"]}, "low": {"t": lows["t"], "v": lows["ns"]},
        "range": (max(spots) - min(spots)) if spots else None,
        "net": (rows[-1]["ns"] - rows[0]["ns"]) if rows[-1]["ns"] and rows[0]["ns"] else None,
        "gex_negative_share": (sum(1 for v in gex_valid if v < 0) / len(gex_valid)) if gex_valid else None,
        "gex_last": gex_valid[-1] if gex_valid else None,
        "gex_neg_band": {"start": neg_start, "end": neg_end},
        "coverage_minutes": len(rows),
    }

    ev_by_id = {e["id"]: e for e in ev_out}
    event_rows = []
    for e in events:
        top = sorted(e["scores"].items(), key=lambda kv: -kv[1])[:3]
        ev_meta = ev_by_id[e["id"]]
        event_rows.append({
            "id": e["id"], "label": e["label"], "dir": e["dir"],
            "type": ev_meta["type"], "tags": ev_meta["tags"],
            "t0": hm(e["t0"]), "t1": hm(e["t1"]), "dur": e["dur"],
            "move": rnd(e["move"], 1), "pct": rnd(e["pct"], 3),
            "z5": rnd(e["z5"], 2), "z15": rnd(e["z15"], 2),
            "retrace": rnd(e["retrace"], 0), "retrace_at": hm(e["retrace_at"]) if e.get("retrace_at") else None,
            "full_reversal": bool(e.get("full_reversal")),
            "spot0": rnd(e["p0"], 1), "spot1": rnd(e["p1"], 1),
            "walls": {
                "call_wall": e["walls"]["start"]["call_wall"] if e["walls"]["start"] else None,
                "put_wall": e["walls"]["start"]["put_wall"] if e["walls"]["start"] else None,
                "call_oi_d": int(e["walls"]["call_oi_d"]) if e["walls"]["call_oi_d"] else None,
                "put_oi_d": int(e["walls"]["put_oi_d"]) if e["walls"]["put_oi_d"] else None,
                "min_gap_call": rnd(e["walls"].get("min_gap_call"), 0),
                "min_gap_put": rnd(e["walls"].get("min_gap_put"), 0),
                "breach_call": e["walls"].get("breach_call"), "breach_put": e["walls"].get("breach_put"),
                "rejected": e["walls"].get("rejected"), "post_advance": rnd(e["walls"].get("post_advance"), 0),
            },
            "options": {k: int(v) for k, v in e["options"].items()},
            "gex": e["gex"], "iv": e["iv"],
            "gamma_ratio": rnd(e["gamma_ratio"], 2),
            "scores": e["scores"], "methods": e["methods"],
            "top": [{"id": k, "v": v} for k, v in top],
            "explain": explain(e), "falsify": falsify(e),
        })

    unavailable = {}
    if not data["fut"]:
        unavailable["futures"] = {"badge": "UNAVAILABLE", "why": "no NIFTY futures 1m archive for this session"}
    if not data["s_tape"]:
        unavailable["sensex"] = {"badge": "UNAVAILABLE", "why": "no SENSEX tape/chain10s archive for this session"}

    has_iv_surface = any("iv_surface" in s["report"] for s in data["n_snaps"])
    unavailable_drivers = []
    if not data["fut"]:
        unavailable_drivers += [
            {"id": "fut_flow", "label": "Futures price/OI quadrant", "why": "no NIFTY futures archive for this session"},
            {"id": "basis", "label": "Basis lead (futures vs cash)", "why": "no NIFTY futures archive for this session"},
        ]
    if not has_iv_surface:
        unavailable_drivers += [
            {"id": "iv", "label": "ATM IV repricing", "why": "no iv_surface block; tape ATM IV is used in the ledger only"},
            {"id": "skew", "label": "25-delta skew shift", "why": "no iv_surface block; the tape has no 25Δ interpolation"},
        ]
    if not data["s_tape"]:
        unavailable_drivers.append(
            {"id": "sensex", "label": "SENSEX confluence (market-wide)", "why": "no SENSEX tape/chain archive for this session"})

    payload = {
        "meta": {
            "session": SESSION, "underlying": "NIFTY", "expiry": EXPIRY, "clip": CLIP,
            "first": first_clock, "last": last_clock,
            "generated_by": "scripts/market/nifty_research_intraday_anatomy.py",
            "lanes": ["price", "flow", "wall", "gex", "events"],
            "unavailable": unavailable,
            "counting": {
                "nifty_tape": len(data["n_tape"]), "nifty_chain10s": len(data["n_chain"]),
                "nifty_snapshots": len(data["n_snaps"]), "futures_1m": len(data["fut"]),
                "sensex_tape": len(data["s_tape"]), "sensex_chain10s": len(data["s_chain"]),
            },
            "drivers": [{"id": k, "label": v, "short": s} for k, v, s in DRIVERS],
            "unavailable_drivers": unavailable_drivers,
            "notes": [
                "Driver scores are evidence strengths in [0,1], not posterior probabilities.",
                "One session is a hypothesis set, not causal proof. Each event carries a falsification line.",
                "GEX is the report's own dealer-exposure proxy (₹ crore per index point), not a measured dealer book.",
                ("Futures and SENSEX lanes are omitted because the archive does not contain them for this session."
                 if unavailable else "All requested lanes are present in this session's archive."),
            ],
        },
        "session": session,
        "events": event_rows,
        "tape": {
            "clock": clock_list, "m": mins, "spot": spot,
            "flow": {"pe": pe, "ce": ce}, "flow_threshold": round(thr, 1), "flow_bursts": burst_out,
            "walls": {"call": cw, "put": pw, "max_pain": mp},
            "gex": gex, "flips": flips, "neg_band": {"start": neg_start, "end": neg_end},
            "events": ev_out, "ref_strike": ref_strike,
            "lanes": ["price", "flow", "wall", "gex", "events"],
        },
        "ladder": {
            "t": clock_list, "spot": spot, "call_wall": cw, "put_wall": pw,
            "max_pain": mp, "gex": gex,
        },
        "terrain": terrain,
        "inputs": {
            "n_tape_first": first_clock, "n_tape_last": last_clock,
            "n_chain_first": hm(data["n_chain"][0]["t"]) if data["n_chain"] else None,
            "n_chain_last": hm(data["n_chain"][-1]["t"]) if data["n_chain"] else None,
            "n_snaps_first": hm(data["n_snaps"][0]["t"]) if data["n_snaps"] else None,
            "n_snaps_last": hm(data["n_snaps"][-1]["t"]) if data["n_snaps"] else None,
        },
    }
    return payload


# ---------------------------------------------------------------- rendering
def fmt(value, digits: int = 0, dash: str = "—") -> str:
    if value is None:
        return dash
    return f"{value:,.{digits}f}"


def signed(value, digits: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value:+,.{digits}f}"


def render_html(payload: dict) -> str:
    ev = payload["events"]
    s = payload["session"]
    meta = payload["meta"]
    T = payload["tape"]
    big_up = max(ev, key=lambda e: e["move"])
    big_dn = min(ev, key=lambda e: e["move"])
    band = s["gex_neg_band"]

    kpis = [
        ("Moves detected", f"{len(ev)}", f"spot legs ≥{EVENT_MIN_PTS:.0f} pts, z-tested"),
        ("Largest up", f"+{big_up['move']:.0f}", f"{big_up['t0']}–{big_up['t1']} · {big_up['spot1']:.0f}"),
        ("Largest down", f"{big_dn['move']:.0f}", f"{big_dn['t0']}–{big_dn['t1']} · {big_dn['spot1']:.0f}"),
        ("Session range", f"{s['range']:.0f} pts", f"low {s['low']['t']} {s['low']['v']:.0f} · high {s['high']['t']} {s['high']['v']:.0f}"),
        ("Short-gamma share", f"{(s['gex_negative_share'] or 0)*100:.0f}%", f"neg from {band['start'] or '—'} · last {fmt(s['gex_last'], 0)}"),
        ("Tape coverage", f"{s['coverage_minutes']} min", f"{meta['first']}–{meta['last']} · clip {CLIP}"),
    ]
    kpi_html = "".join(
        f'<div class="ia-kpi"><div class="ia-k">{k}</div>'
        f'<div class="ia-v{" ia-green" if i == 1 else " ia-red" if i == 2 else ""}">{v}</div>'
        f'<div class="ia-n">{n}</div></div>'
        for i, (k, v, n) in enumerate(kpis)
    )

    driver_labels = {d["id"]: d["short"] for d in meta["drivers"]}
    rows_html = []
    for e in ev:
        w = e["walls"]
        wall_txt = "—"
        if e["dir"] == "up" and w["call_wall"]:
            tag = ("below" if w.get("wrong_side_call") else "breach" if w["breach_call"]
                   else ("reject" if w.get("rejected") else ("test" if (w["min_gap_call"] or 99) <= 10 else "")))
            wall_txt = f'C {w["call_wall"]:.0f} {tag}'.strip()
        elif e["dir"] == "down" and w["put_wall"]:
            tag = ("above" if w.get("wrong_side_put") else "breach" if w["breach_put"]
                   else ("hold" if w.get("rejected") else ("test" if (w["min_gap_put"] or 99) <= 10 else "")))
            wall_txt = f'P {w["put_wall"]:.0f} {tag}'.strip()
        top = e["top"][0]
        itm = e["options"].get("itm_put_vol", 0) + e["options"].get("itm_call_vol", 0)
        retr = "full" if (e["full_reversal"] or (e["retrace"] or 0) >= 100) else ("none" if (e["retrace"] or 0) <= 0 else f'{e["retrace"]:.0f}%')
        rows_html.append(
            f'<tr data-ev="{e["id"]}">'
            f'<td><span class="ia-id">{e["id"]}</span></td>'
            f'<td>{e["t0"]}–{e["t1"]} <span class="ia-evlab">({e["dur"]}m)</span></td>'
            f'<td class="{"ia-green" if e["move"] > 0 else "ia-red"}">{e["move"]:+.1f}</td>'
            f'<td>{e["pct"]:+.2f}%</td>'
            f'<td>{e["z5"] if e["z5"] is not None else "—"}</td>'
            f'<td>{itm/1e6:.1f}M</td>'
            f'<td>{wall_txt}</td>'
            f'<td>{"short" if (e["gex"]["short_share"] or 0) >= 0.5 else "long"} '
            f'{((e["gex"]["short_share"] or 0) if (e["gex"]["short_share"] or 0) >= 0.5 else 1 - (e["gex"]["short_share"] or 0))*100:.0f}%</td>'
            f'<td>{signed(e["iv"]["d"], 2) if e["iv"]["d"] is not None else "—"}</td>'
            f'<td>{retr}</td>'
            f'<td style="text-align:left"><span class="ia-drvlong">{driver_labels.get(top["id"], top["id"])}</span>'
            f'<span class="ia-drvshort">{top["id"]}</span> <span class="ia-amber">{top["v"]:.2f}</span></td>'
            f'</tr>'
        )
    table_html = "".join(rows_html)

    ev_cards = []
    for e in ev:
        chips = "".join(
            f'<span class="ia-chip">{driver_labels.get(t["id"], t["id"])} <b>{t["v"]:.2f}</b></span>'
            for t in e["top"]
        )
        ev_cards.append(
            f'<article class="ia-ev" data-ev="{e["id"]}">'
            f'<div class="ia-evhead">'
            f'<span class="ia-id">{e["id"]}</span>'
            f'<span class="ia-evt">{e["t0"]}–{e["t1"]}</span>'
            f'<span class="{"ia-green" if e["move"] > 0 else "ia-red"}">{e["move"]:+.1f} pts</span>'
            f'<span class="ia-tag ia-{e["dir"]}">{e["type"]}</span>'
            f'</div>'
            f'<p class="ia-evtext">{e["explain"]}</p>'
            f'<div class="ia-chips">{chips}</div>'
            f'<p class="ia-evfalse"><b>Falsified if</b> {e["falsify"][len("Falsified if "):]}</p>'
            f'</article>'
        )
    ev_html = "".join(ev_cards)

    heat_cols = meta["drivers"]
    heat_head = "".join(f"<th>{d['short']}</th>" for d in heat_cols)
    heat_rows = []
    for e in ev:
        cells = []
        for d in heat_cols:
            v = e["scores"].get(d["id"], 0)
            if v > 0:
                cells.append(f'<td class="ia-heat" style="background:rgba(217,144,42,{0.08 + 0.62 * v:.2f})">{v:.2f}</td>')
            else:
                cells.append('<td class="ia-heat">—</td>')
        heat_rows.append(f'<tr><td class="ia-id">{e["id"]}</td>{"".join(cells)}</tr>')
    heat_html = "".join(heat_rows)

    lane_label = {"futures": "Futures", "sensex": "SENSEX"}
    missing_names = [lane_label.get(k, k.title()) for k in meta["unavailable"]]
    if missing_names:
        unavail_lede = ("<b>" + " and ".join(missing_names) + "</b> "
                        + ("are" if len(missing_names) > 1 else "is")
                        + " <b>omitted</b> — no archive exists for this session, and the page does not synthesise "
                          "them. The badge panel above states that explicitly.")
    else:
        unavail_lede = ("Every requested lane has an archive for this session; no lane is synthesised or "
                        "interpolated beyond its recorded minutes.")
    unavail_html = "".join(
        f'<div class="ia-un"><span class="ia-badge">{v["badge"]}</span>'
        f'<div><b>{lane_label.get(k, k.title())} lane</b>'
        f'<span>{v["why"]}</span></div></div>'
        for k, v in meta["unavailable"].items()
    )

    data_json = json.dumps(payload, separators=(",", ":")).replace("</", "<\\/")
    coverage_note = "" if meta["first"] <= "09:20" else (
        f'The tape starts at <b>{meta["first"]}</b>; the opening auction and everything '
        f'before {meta["first"]} is not in this archive.')

    return f"""<section data-research-section="intraday-anatomy" id="research-intraday-anatomy">
<style>
#research-intraday-anatomy{{
  --ia-bg:#000;--ia-surface:#13161C;--ia-raised:#1F242D;--ia-border:#2C313B;
  --ia-text:#E8E8E8;--ia-muted:#9B9B9B;--ia-amber:#D9902A;--ia-green:#2FA36B;
  --ia-red:#E5606A;--ia-blue:#4A8FD8;
  --ia-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  color:var(--ia-text);font-size:13px;line-height:1.55;background:var(--ia-bg);
  display:block;max-width:100%;overflow-x:clip;box-sizing:border-box;
  padding:18px clamp(10px,2vw,26px) 36px;
}}
#research-intraday-anatomy *{{box-sizing:border-box}}
#research-intraday-anatomy .ia-wrap{{display:flex;flex-direction:column;gap:14px;max-width:1560px;margin:0 auto;min-width:0}}
#research-intraday-anatomy .ia-kicker{{color:var(--ia-amber);font:600 10px/1.2 var(--ia-mono);letter-spacing:.14em;text-transform:uppercase}}
#research-intraday-anatomy h2{{font-size:clamp(20px,2.2vw,27px);line-height:1.16;margin:0;letter-spacing:-.02em}}
#research-intraday-anatomy h2 .ia-thin{{color:var(--ia-muted);font-weight:400}}
#research-intraday-anatomy .ia-lede{{color:var(--ia-muted);font-size:12.5px;margin:0;max-width:1000px}}
#research-intraday-anatomy .ia-lede b{{color:var(--ia-text)}}
#research-intraday-anatomy .ia-kpis{{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;background:var(--ia-border);border:1px solid var(--ia-border);border-radius:8px;overflow:hidden}}
#research-intraday-anatomy .ia-kpi{{background:var(--ia-surface);padding:9px 11px;min-width:0}}
#research-intraday-anatomy .ia-k{{color:var(--ia-muted);font:600 9px/1.25 var(--ia-mono);letter-spacing:.08em;text-transform:uppercase}}
#research-intraday-anatomy .ia-v{{font:600 17px/1.3 var(--ia-mono);margin-top:4px}}
#research-intraday-anatomy .ia-n{{font:10.5px/1.35 var(--ia-mono);color:var(--ia-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
#research-intraday-anatomy .ia-green{{color:var(--ia-green)}}
#research-intraday-anatomy .ia-red{{color:var(--ia-red)}}
#research-intraday-anatomy .ia-amber{{color:var(--ia-amber)}}
#research-intraday-anatomy .ia-panel{{background:var(--ia-surface);border:1px solid var(--ia-border);border-radius:8px;min-width:0;overflow:hidden}}
#research-intraday-anatomy .ia-ph{{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;padding:10px 12px;border-bottom:1px solid var(--ia-border)}}
#research-intraday-anatomy .ia-ph h3{{font-size:12.5px;margin:0;font-weight:600}}
#research-intraday-anatomy .ia-hint{{font:10px/1.4 var(--ia-mono);color:var(--ia-muted)}}
#research-intraday-anatomy .ia-body{{padding:8px 10px 10px;min-width:0}}
#research-intraday-anatomy .ia-read{{font-size:11px;line-height:1.55;color:var(--ia-muted);padding:0 12px 10px}}
#research-intraday-anatomy .ia-read b{{color:var(--ia-text)}}
#research-intraday-anatomy .ia-un{{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid rgba(217,144,42,.4);border-left:2px solid var(--ia-amber);border-radius:6px;background:rgba(217,144,42,.06);margin:0}}
#research-intraday-anatomy .ia-un b{{display:block;font-size:12px}}
#research-intraday-anatomy .ia-un span:not(.ia-badge){{display:block;font-size:11px;color:var(--ia-muted)}}
#research-intraday-anatomy .ia-badge{{font:700 8.5px/1 var(--ia-mono);letter-spacing:.08em;color:#000;background:var(--ia-amber);border-radius:3px;padding:4px 5px;white-space:nowrap}}
#research-intraday-anatomy .ia-unwrap{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}
#research-intraday-anatomy .ia-tablewrap{{overflow-x:auto;-webkit-overflow-scrolling:touch}}
#research-intraday-anatomy table.ia-tab{{width:100%;min-width:900px;border-collapse:collapse;font:11px/1.4 var(--ia-mono)}}
#research-intraday-anatomy table.ia-tab th{{text-align:right;color:var(--ia-muted);font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:6px 7px;border-bottom:1px solid var(--ia-border);white-space:nowrap}}
#research-intraday-anatomy table.ia-tab th:first-child,#research-intraday-anatomy table.ia-tab td:first-child{{text-align:left}}
#research-intraday-anatomy table.ia-tab td{{padding:5px 7px;text-align:right;border-bottom:1px solid rgba(44,49,59,.5);white-space:nowrap}}
#research-intraday-anatomy table.ia-tab tr:last-child td{{border-bottom:0}}
#research-intraday-anatomy table.ia-tab tr.ia-hl td{{background:rgba(217,144,42,.12)}}
#research-intraday-anatomy .ia-id{{font-weight:700;color:var(--ia-amber)}}
#research-intraday-anatomy .ia-evlab{{color:var(--ia-muted);font-size:10px}}
#research-intraday-anatomy .ia-tag{{font:600 9px/1 var(--ia-mono);padding:3px 5px;border-radius:3px;border:1px solid var(--ia-border);white-space:nowrap}}
#research-intraday-anatomy .ia-tag.ia-up{{color:var(--ia-green);border-color:rgba(47,163,107,.45)}}
#research-intraday-anatomy .ia-tag.ia-down{{color:var(--ia-red);border-color:rgba(229,96,106,.45)}}
#research-intraday-anatomy .ia-drvlong{{display:block;font-size:10px;color:var(--ia-text)}}
#research-intraday-anatomy .ia-drvshort{{font-size:9px;color:var(--ia-muted)}}
#research-intraday-anatomy .ia-tl{{display:flex;align-items:stretch;min-width:0}}
#research-intraday-anatomy .ia-tl-labels{{flex:0 0 90px;border-right:1px solid var(--ia-border);background:#0D1015}}
#research-intraday-anatomy .ia-tl-lab{{display:flex;align-items:center;padding:0 8px;font:600 8.5px/1.15 var(--ia-mono);letter-spacing:.05em;color:var(--ia-muted);border-bottom:1px solid #1A1F27}}
#research-intraday-anatomy .ia-tl-scroll{{flex:1 1 auto;min-width:0;overflow-x:auto;overflow-y:hidden;cursor:crosshair}}
#research-intraday-anatomy .ia-tl-scroll::-webkit-scrollbar{{height:8px}}
#research-intraday-anatomy .ia-tl-scroll::-webkit-scrollbar-thumb{{background:#2C313B;border-radius:4px}}
#research-intraday-anatomy .ia-tl-svg{{display:block}}
#research-intraday-anatomy .ia-tl-tip{{position:fixed;pointer-events:none;z-index:80;opacity:0;transition:opacity .08s;background:#0B0E13;border:1px solid var(--ia-border);border-radius:5px;padding:7px 9px;font:10.5px/1.45 var(--ia-mono);color:var(--ia-text);min-width:180px;max-width:280px;box-shadow:0 8px 24px rgba(0,0,0,.55)}}
#research-intraday-anatomy .ia-tt-h{{color:var(--ia-amber);font-weight:600;margin-bottom:3px;display:flex;justify-content:space-between;gap:12px}}
#research-intraday-anatomy .ia-tt-r{{display:flex;justify-content:space-between;gap:12px}}
#research-intraday-anatomy .ia-tt-r b{{font-weight:500;color:#fff}}
#research-intraday-anatomy .ia-tt-ev{{margin-top:5px;padding-top:5px;border-top:1px solid var(--ia-border);color:#CFCFCF}}
#research-intraday-anatomy .ia-tt-ev b{{color:var(--ia-amber)}}
#research-intraday-anatomy .ia-tl-reset{{font:9px/1.6 var(--ia-mono);color:var(--ia-muted);background:transparent;border:1px solid var(--ia-border);border-radius:3px;padding:2px 6px;cursor:pointer;margin:4px 8px}}
#research-intraday-anatomy .ia-tl-reset:hover{{color:var(--ia-text);border-color:var(--ia-amber)}}
#research-intraday-anatomy .ia-legend{{display:flex;flex-wrap:wrap;gap:4px 14px;font:10px/1.4 var(--ia-mono);color:var(--ia-muted);padding:0 12px 8px}}
#research-intraday-anatomy .ia-legend i{{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}}
#research-intraday-anatomy .ia-plot{{width:100%;min-width:0}}
#research-intraday-anatomy .ia-split{{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:8px}}
#research-intraday-anatomy .ia-evs{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:10px}}
#research-intraday-anatomy .ia-ev{{border:1px solid var(--ia-border);border-radius:6px;padding:9px 10px;min-width:0;background:#0D1015}}
#research-intraday-anatomy .ia-ev.ia-hl{{border-color:var(--ia-amber);box-shadow:0 0 0 1px rgba(217,144,42,.35)}}
#research-intraday-anatomy .ia-evhead{{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-bottom:5px}}
#research-intraday-anatomy .ia-evt{{font:10.5px/1 var(--ia-mono);color:var(--ia-muted)}}
#research-intraday-anatomy .ia-evtext{{font-size:11.5px;line-height:1.55;color:#CFCFCF;margin:0 0 6px}}
#research-intraday-anatomy .ia-chips{{display:flex;flex-wrap:wrap;gap:4px}}
#research-intraday-anatomy .ia-chip{{font:9.5px/1.5 var(--ia-mono);color:var(--ia-muted);border:1px solid var(--ia-border);border-radius:3px;padding:1px 5px}}
#research-intraday-anatomy .ia-chip b{{color:var(--ia-amber);font-weight:600}}
#research-intraday-anatomy .ia-evfalse{{font-size:10.5px;line-height:1.45;color:var(--ia-muted);margin:6px 0 0;border-top:1px solid var(--ia-border);padding-top:5px}}
#research-intraday-anatomy .ia-evfalse b{{color:var(--ia-red)}}
#research-intraday-anatomy .ia-heatwrap{{overflow-x:auto}}
#research-intraday-anatomy table.ia-heat-tab{{width:100%;min-width:520px;border-collapse:collapse;font:10px/1.4 var(--ia-mono)}}
#research-intraday-anatomy table.ia-heat-tab th{{color:var(--ia-muted);font-size:9px;padding:5px;text-align:center;font-weight:600;border-bottom:1px solid var(--ia-border)}}
#research-intraday-anatomy table.ia-heat-tab td{{padding:4px 6px;text-align:center;border:1px solid #0B0E13;color:#fff}}
#research-intraday-anatomy table.ia-heat-tab td.ia-id{{text-align:left;color:var(--ia-amber);background:transparent;border:0}}
#research-intraday-anatomy .ia-foot{{border:1px solid var(--ia-border);border-radius:8px;background:var(--ia-surface);padding:11px 14px;font-size:11px;line-height:1.55;color:var(--ia-muted)}}
#research-intraday-anatomy .ia-foot b{{color:var(--ia-text)}}
#research-intraday-anatomy .ia-foot p{{margin:0 0 6px}}
#research-intraday-anatomy .ia-foot p:last-child{{margin-bottom:0}}
@media (max-width:1180px){{
  #research-intraday-anatomy .ia-kpis{{grid-template-columns:repeat(3,minmax(0,1fr))}}
  #research-intraday-anatomy .ia-evs{{grid-template-columns:1fr}}
}}
@media (max-width:760px){{
  #research-intraday-anatomy{{padding:12px 8px 28px}}
  #research-intraday-anatomy .ia-kpis{{grid-template-columns:repeat(2,minmax(0,1fr))}}
  #research-intraday-anatomy .ia-n{{white-space:normal}}
  #research-intraday-anatomy .ia-unwrap{{grid-template-columns:1fr}}
  #research-intraday-anatomy .ia-tl-labels{{flex:0 0 58px}}
  #research-intraday-anatomy .ia-tl-lab{{padding:0 4px;font-size:7px;letter-spacing:.02em}}
  #research-intraday-anatomy .ia-split{{grid-template-columns:1fr}}
  #research-intraday-anatomy .ia-evs{{padding:8px}}
}}
</style>

<div class="ia-wrap">
  <div>
    <div class="ia-kicker">NIFTY · 0-DTE · expiry {EXPIRY} · intraday anatomy</div>
    <h2 class="ia-h">Why price moved: {len(ev)} legs, <span class="ia-thin">measured against the lanes that exist</span></h2>
    <p class="ia-lede">Every spot leg of ≥{EVENT_MIN_PTS:.0f} points between {meta['first']} and <b>{CLIP}</b> is
      listed, then tested against the call/put walls, net GEX, ITM option volume and max-pain gravity. Driver
      values are <b>evidence strengths (0–1), not probabilities</b>. {coverage_note}</p>
  </div>

  <div class="ia-kpis">{kpi_html}</div>

  <div class="ia-unwrap">{unavail_html}</div>

  <div class="ia-panel">
    <div class="ia-ph"><h3>Event ledger</h3><span class="ia-hint">spot 1m · wall = the wall at leg start (fixed reference) · retrace = adverse excursion within 45m</span></div>
    <div class="ia-tablewrap">
      <table class="ia-tab">
        <thead><tr>
          <th>#</th><th>window</th><th>Δ pts</th><th>Δ %</th><th>z5</th><th>ITM vol</th>
          <th>wall</th><th>GEX</th><th>ΔIV</th><th>retrace</th><th>top driver</th>
        </tr></thead>
        <tbody>{table_html}</tbody>
      </table>
    </div>
  </div>

  <div class="ia-panel" id="ia-tape-panel">
    <div class="ia-ph"><h3>Forensic tape — what was unusual, minute by minute</h3>
      <span class="ia-hint">{meta['first']}–{meta['last']} IST · one x-axis, five lanes · hover for the read · click a marker to jump to its card · drag the strip to zoom</span></div>
    <div class="ia-tl" id="ia-tape-host">
      <div class="ia-tl-labels" id="ia-tape-labels"></div>
      <div class="ia-tl-scroll" id="ia-tape-scroll"></div>
    </div>
    <div class="ia-tl-tip" id="ia-tape-tip"></div>
    <div class="ia-legend" id="ia-tape-legend"></div>
    <div class="ia-read" id="ia-tape-read"></div>
  </div>

  <div class="ia-panel">
    <div class="ia-ph"><h3>Wall ladder — distance from spot to the live walls</h3>
      <span class="ia-hint">call gap = wall − spot · put gap = spot − wall · zero = price at the wall</span></div>
    <div class="ia-body"><div class="ia-plot" id="ia-ladder"></div></div>
    <div class="ia-read" id="ia-ladder-read"></div>
    <div class="ia-legend">
      <span><i style="background:#E5606A"></i>gap to call wall</span>
      <span><i style="background:#2FA36B"></i>gap to put wall</span>
      <span><i style="background:#D9902A"></i>max pain distance</span>
    </div>
  </div>

  <div class="ia-panel">
    <div class="ia-ph"><h3>Net GEX</h3>
      <span class="ia-hint">net dealer gamma proxy (₹ crore / index point) · red = short gamma</span></div>
    <div class="ia-body"><div class="ia-plot" id="ia-gex"></div></div>
    <div class="ia-read" id="ia-gex-read"></div>
  </div>

  <div class="ia-panel">
    <div class="ia-ph"><h3>Strike terrain — put minus call open interest</h3>
      <span class="ia-hint">₹M · green = put-heavy (support) · red = call-heavy (resistance)</span></div>
    <div class="ia-body"><div class="ia-plot" id="ia-terrain"></div></div>
  </div>

  <div class="ia-panel">
    <div class="ia-ph"><h3>What each leg most likely was</h3>
      <span class="ia-hint">ranked read · driver chips are the top three evidence scores · one falsifier per leg</span></div>
    <div class="ia-evs">{ev_html}</div>
  </div>

  <div class="ia-panel">
    <div class="ia-ph"><h3>Evidence matrix</h3>
      <span class="ia-hint">0–1 evidence strength per measurable driver · unavailable drivers are listed at the top, not scored</span></div>
    <div class="ia-body"><div class="ia-heatwrap">
      <table class="ia-heat-tab"><thead><tr><th></th>{heat_head}</tr></thead><tbody>{heat_html}</tbody></table>
    </div></div>
  </div>

  <div class="ia-foot">
    <p><b>Lanes on this page.</b> price/spot, ITM PE/CE flow, walls, GEX and the event ticker. {unavail_lede}</p>
    <p><b>Method.</b> Legs from an {ZIGZAG:.0f}-point zigzag on 1-minute spot closes, merged when the counter-swing
      is ≤{MERGE_PTS:.0f} pts and ≤{MERGE_MIN} min, extended along the monotone run, kept at
      ≥{EVENT_MIN_PTS:.0f} pts (≥{EVENT_MIN_FAST:.0f} if under 3 minutes). Checks: 5m and 15m returns vs the prior
      30m robust z (median / 1.4826·MAD). ITM buckets are fixed at event start so a spot crossing cannot move
      strikes between buckets. The wall lane is the tape's highest-OI call/put strike; a leg only treats it as
      resistance/support if it started on that side of price. IV is the tape's average of ATM CE and PE IV; there
      is no <code>iv_surface</code> block.</p>
    <p><b>Clocks.</b> NIFTY tape {meta['first']}–{meta['last']}, chain10s {payload['inputs']['n_chain_first']}–{payload['inputs']['n_chain_last']},
      snapshots {payload['inputs']['n_snaps_first']}–{payload['inputs']['n_snaps_last']}, all clipped at {CLIP}.</p>
    <p><b>Honesty.</b> Driver scores normalise against this session's own distributions. One session is a hypothesis
      set, not causal proof — every read names the observation that would break it.</p>
  </div>
</div>

<script type="application/json" id="ia-data">{data_json}</script>
<script>
(function () {{
  "use strict";
  var root = document.getElementById("research-intraday-anatomy");
  if (!root) return;
  var dataEl = document.getElementById("ia-data");
  var D;
  try {{ D = JSON.parse(dataEl.textContent); }} catch (e) {{ return; }}
  var NARROW = window.innerWidth < 760;
  var MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
  var C = {{
    bg: "#000000", surface: "#13161C", raised: "#1F242D", border: "#2C313B",
    text: "#E8E8E8", muted: "#9B9B9B", amber: "#D9902A", green: "#2FA36B",
    red: "#E5606A", blue: "#4A8FD8", grey: "#6B7280"
  }};
  function rgba(hex, a) {{
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }}
  function focusEvent(id) {{
    Array.prototype.forEach.call(root.querySelectorAll(".ia-hl"), function (n) {{ n.classList.remove("ia-hl"); }});
    var card = root.querySelector('.ia-ev[data-ev="' + id + '"]');
    var row = root.querySelector('tr[data-ev="' + id + '"]');
    if (card) card.classList.add("ia-hl");
    if (row) row.classList.add("ia-hl");
    var target = card || row;
    if (target) target.scrollIntoView({{ behavior: "smooth", block: "center" }});
  }}

  /* ------------------------------------------------------------- tape lanes */
  var tapeResize = null;
  function drawTape() {{
    var T = D.tape;
    if (!window.d3 || !T || !T.clock || !T.clock.length) return;
    var d3 = window.d3;
    var labelHost = document.getElementById("ia-tape-labels");
    var scroll = document.getElementById("ia-tape-scroll");
    var tip = document.getElementById("ia-tape-tip");
    var legend = document.getElementById("ia-tape-legend");
    var readEl = document.getElementById("ia-tape-read");
    if (!labelHost || !scroll) return;
    var existing = scroll.querySelector("svg");
    if (existing) scroll.innerHTML = "";
    labelHost.innerHTML = "";

    var LANES = [
      {{ k: "price", n: "PRICE / SPOT", s: "PX", h: 132 }},
      {{ k: "flow", n: "ITM FLOW", s: "FLOW", h: 62 }},
      {{ k: "wall", n: "WALLS", s: "WALL", h: 66 }},
      {{ k: "gex", n: "GEX", s: "GEX", h: 50 }},
      {{ k: "events", n: "EVENTS", s: "EV", h: 58 }}
    ];
    var AXIS_H = 24, BRUSH_H = 26, PAD_T = 0;
    var TYPE_COL = {{
      explosion: C.green, dump: C.red, "wall break": C.red, "wall defense": C.blue, impulse: C.muted
    }};
    var off = {{}}, yy = PAD_T;
    LANES.forEach(function (l) {{ off[l.k] = yy; yy += l.h; }});
    var laneH = yy, axisY = yy, H = laneH + AXIS_H;

    labelHost.innerHTML = LANES.map(function (l) {{
      return '<div class="ia-tl-lab" style="height:' + l.h + 'px">' + (NARROW ? l.s : l.n) + "</div>";
    }}).join("") + '<div class="ia-tl-lab" style="height:' + AXIS_H + 'px;border-bottom:0"></div>'
      + '<div class="ia-tl-lab" style="height:' + BRUSH_H + 'px;border-bottom:0">ZOOM</div>';

    var svg = d3.select(scroll).append("svg").attr("class", "ia-tl-svg");
    var bsvg = d3.select(scroll).append("svg").attr("class", "ia-tl-svg");
    var rootG = svg.append("g");
    var state = {{ dom: [T.m[0], T.m[T.m.length - 1]] }};

    function nearestIdx(m) {{
      var lo = 0, hi = T.m.length - 1;
      while (hi - lo > 1) {{
        var mid = (lo + hi) >> 1;
        if (T.m[mid] < m) lo = mid; else hi = mid;
      }}
      return Math.abs(T.m[lo] - m) <= Math.abs(T.m[hi] - m) ? lo : hi;
    }}
    function fmt(v) {{ return v == null ? "—" : d3.format(",")(Math.round(v)); }}
    function hideTip() {{ if (tip) tip.style.opacity = 0; }}
    function moveTip(ev) {{
      if (!tip) return;
      var w = tip.offsetWidth, h = tip.offsetHeight;
      var x0 = ev.clientX + 14, y0 = ev.clientY + 14;
      if (x0 + w > window.innerWidth - 8) x0 = ev.clientX - w - 14;
      if (y0 + h > window.innerHeight - 8) y0 = ev.clientY - h - 14;
      tip.style.left = Math.max(4, x0) + "px";
      tip.style.top = Math.max(4, y0) + "px";
    }}
    function row(k, v) {{
      return '<div class="ia-tt-r"><span>' + k + "</span><b>" + v + "</b></div>";
    }}
    function showEventTip(ev, e) {{
      if (!tip) return;
      tip.innerHTML =
        '<div class="ia-tt-h"><span>' + e.id + " · " + e.t0 + "–" + e.t1 + "</span><span>" +
        (e.move > 0 ? "+" : "") + e.move + " pts</span></div>" +
        row("type", e.type + (e.tags.length ? " · " + e.tags.join(", ") : "")) +
        row("spot", e.spot == null ? "—" : e.spot) +
        row("wall", e.wall_gap == null ? "—" : (e.wall_gap > 0 ? "+" : "") + e.wall_gap + " pts @ " + e.wall_strike) +
        '<div class="ia-tt-ev">' + e.explain.slice(0, 190) + "…</div>";
      tip.style.opacity = 1;
      moveTip(ev);
    }}
    function showMinuteTip(ev, i) {{
      if (!tip) return;
      var near = null;
      for (var j = 0; j < T.events.length; j++) {{
        if (Math.abs(T.events[j].m - T.m[i]) <= 2.5) {{ near = T.events[j]; break; }}
      }}
      var gapC = (T.walls.call[i] != null && T.spot[i] != null) ? (T.walls.call[i] - T.spot[i]) : null;
      var gapP = (T.walls.put[i] != null && T.spot[i] != null) ? (T.spot[i] - T.walls.put[i]) : null;
      tip.innerHTML =
        '<div class="ia-tt-h"><span>' + T.clock[i] + " IST</span><span>net GEX " + fmt(T.gex[i]) + "</span></div>" +
        row("spot", T.spot[i] == null ? "—" : T.spot[i]) +
        row("ITM flow", "PE " + (T.flow.pe[i] || 0) + "M / CE " + (T.flow.ce[i] || 0) + "M") +
        row("walls", "C " + (T.walls.call[i] || "—") + " (" + (gapC == null ? "—" : (gapC > 0 ? "+" : "") + Math.round(gapC)) +
          ") · P " + (T.walls.put[i] || "—") + " (" + (gapP == null ? "—" : (gapP > 0 ? "+" : "") + Math.round(gapP)) + ")") +
        (near ? '<div class="ia-tt-ev"><b>' + near.id + "</b> " + near.type + " · " + near.t0 + "–" + near.t1 + "</div>" : "");
      tip.style.opacity = 1;
      moveTip(ev);
    }}
    function tickVals() {{
      var out = [], step = 30;
      var first = Math.ceil(state.dom[0] / step) * step;
      for (var v = first; v <= state.dom[1]; v += step) out.push(v);
      return out;
    }}
    function bindEvent(g, e) {{
      g.style("cursor", "pointer");
      g.on("mouseenter", function (ev) {{
        var r = g.select("rect");
        if (!r.empty()) r.attr("fill", rgba(C.amber, 0.12));
        showEventTip(ev, e);
      }});
      g.on("mouseleave", function () {{
        var r = g.select("rect");
        if (!r.empty()) r.attr("fill", "transparent");
        hideTip();
      }});
      g.on("click", function (ev) {{ ev.stopPropagation(); focusEvent(e.id); }});
    }}

    function render() {{
      var W = Math.max(scroll.clientWidth - 1, NARROW ? 1180 : 900);
      svg.attr("width", W).attr("height", H);
      bsvg.attr("width", W).attr("height", BRUSH_H);
      rootG.selectAll("*").remove();
      var x = d3.scaleLinear().domain(state.dom).range([12, W - 14]);

      LANES.forEach(function (l) {{
        rootG.append("rect").attr("x", 0).attr("y", off[l.k]).attr("width", W).attr("height", l.h)
          .attr("fill", l.k === "events" ? "#0D1015" : "transparent");
        rootG.append("line").attr("x1", 0).attr("x2", W)
          .attr("y1", off[l.k] + l.h - 0.5).attr("y2", off[l.k] + l.h - 0.5).attr("stroke", "#1A1F27");
      }});

      T.events.forEach(function (e) {{
        rootG.append("line").attr("x1", x(e.m)).attr("x2", x(e.m))
          .attr("y1", off.price + 2).attr("y2", off.events + 42)
          .attr("stroke", e.dir === "up" ? C.green : C.red).attr("stroke-opacity", 0.12);
      }});

      // price
      (function () {{
        var y0 = off.price, h = 132;
        var vals = T.spot.filter(function (v) {{ return v != null; }});
        var ext = d3.extent(vals);
        var y = d3.scaleLinear().domain([ext[0] - 6, ext[1] + 6]).range([y0 + h - 12, y0 + 8]);
        [0.2, 0.5, 0.8].forEach(function (f) {{
          var v = ext[0] + (ext[1] - ext[0]) * f;
          rootG.append("line").attr("x1", 0).attr("x2", W).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", "#151A22");
          rootG.append("text").attr("x", W - 4).attr("y", y(v) - 2).attr("text-anchor", "end")
            .attr("fill", "#5F6670").attr("font-size", 7.5).attr("font-family", MONO).text(Math.round(v));
        }});
        var ln = d3.line().defined(function (d) {{ return d != null; }})
          .x(function (d, i) {{ return x(T.m[i]); }})
          .y(function (d) {{ return y(d); }});
        rootG.append("path").datum(T.spot).attr("fill", "none").attr("stroke", C.amber)
          .attr("stroke-width", 1.7).attr("d", ln);
        T.events.forEach(function (e) {{
          if (e.spot == null) return;
          var big = e.type === "explosion" || e.type === "dump";
          var g = rootG.append("g");
          g.append("rect").attr("x", x(e.m) - 9).attr("y", y(e.spot) - 9).attr("width", 18).attr("height", 18)
            .attr("fill", "transparent");
          g.append("path")
            .attr("d", d3.symbol().type(big ? d3.symbolStar : d3.symbolDiamond).size(big ? 64 : 30)())
            .attr("transform", "translate(" + x(e.m) + "," + y(e.spot) + ")")
            .attr("fill", e.dir === "up" ? C.green : C.red)
            .attr("stroke", "#0B0E13").attr("stroke-width", 0.8);
          bindEvent(g, e);
        }});
      }})();

      // ITM flow
      (function () {{
        var y0 = off.flow, h = 62, mid = y0 + h / 2;
        var maxF = d3.max(T.flow.pe.concat(T.flow.ce)) || 1;
        var up = d3.scaleLinear().domain([0, maxF]).range([0, h / 2 - 9]);
        var areaPE = d3.area().defined(function (d) {{ return d != null; }})
          .x(function (d, i) {{ return x(T.m[i]); }}).y0(mid).y1(function (d) {{ return mid - up(d); }});
        var areaCE = d3.area().defined(function (d) {{ return d != null; }})
          .x(function (d, i) {{ return x(T.m[i]); }}).y0(mid).y1(function (d) {{ return mid + up(d); }});
        rootG.append("path").datum(T.flow.pe).attr("fill", rgba(C.red, 0.40)).attr("d", areaPE);
        rootG.append("path").datum(T.flow.ce).attr("fill", rgba(C.green, 0.40)).attr("d", areaCE);
        rootG.append("line").attr("x1", 0).attr("x2", W).attr("y1", mid).attr("y2", mid).attr("stroke", "#2C313B");
        T.flow_bursts.forEach(function (b) {{
          var bx0 = x(b.m0), bx1 = Math.max(x(b.m1) + 1, bx0 + 2);
          rootG.append("rect").attr("x", bx0).attr("y", y0 + 2).attr("width", bx1 - bx0).attr("height", h - 6)
            .attr("fill", rgba(C.amber, 0.13));
          var top = b.kind === "put" ? mid - up(b.pe) : mid + up(b.ce);
          rootG.append("path").attr("d", d3.symbol().type(d3.symbolTriangle).size(20)())
            .attr("transform", "translate(" + x(b.m) + "," + top + ") rotate(" + (b.kind === "put" ? 0 : 180) + ")")
            .attr("fill", b.kind === "put" ? C.red : C.green).attr("stroke", "#0B0E13").attr("stroke-width", 0.6);
        }});
        rootG.append("text").attr("x", 6).attr("y", y0 + 10).attr("text-anchor", "start")
          .attr("fill", "#5F6670").attr("font-size", 7.5).attr("font-family", MONO)
          .text("PE ↑ / CE ↓ · burst p90 " + T.flow_threshold + "M");      }})();

      // walls
      (function () {{
        var y0 = off.wall, h = 66;
        var vals = T.walls.call.concat(T.walls.put).filter(function (v) {{ return v != null; }});
        var ext = d3.extent(vals);
        var y = d3.scaleLinear().domain([ext[0] - 30, ext[1] + 30]).range([y0 + h - 8, y0 + 8]);
        rootG.append("line").attr("x1", 0).attr("x2", W).attr("y1", y(T.ref_strike)).attr("y2", y(T.ref_strike))
          .attr("stroke", rgba(C.amber, 0.42)).attr("stroke-dasharray", "5 4");
        rootG.append("text").attr("x", W - 4).attr("y", y(ext[1]) + 8).attr("text-anchor", "end")
          .attr("fill", "#5F6670").attr("font-size", 7.5).attr("font-family", MONO).text(Math.round(ext[1]));
        rootG.append("text").attr("x", W - 4).attr("y", y(ext[0]) - 2).attr("text-anchor", "end")
          .attr("fill", "#5F6670").attr("font-size", 7.5).attr("font-family", MONO).text(Math.round(ext[0]));
        var step = d3.line().defined(function (d) {{ return d != null; }}).curve(d3.curveStepAfter)
          .x(function (d, i) {{ return x(T.m[i]); }})
          .y(function (d) {{ return y(d); }});
        rootG.append("path").datum(T.walls.call).attr("fill", "none").attr("stroke", C.red)
          .attr("stroke-width", 1.9).attr("d", step);
        rootG.append("path").datum(T.walls.put).attr("fill", "none").attr("stroke", C.green)
          .attr("stroke-width", 1.9).attr("d", step);
        T.events.forEach(function (e) {{
          if (e.wall_strike == null) return;
          var brk = e.tags.indexOf("wall break") >= 0;
          var def = e.tags.indexOf("wall defense") >= 0;
          if (!brk && !def) return;
          rootG.append("path")
            .attr("d", d3.symbol().type(brk ? d3.symbolX : d3.symbolDiamond).size(brk ? 32 : 28)())
            .attr("transform", "translate(" + x(e.m) + "," + y(e.wall_strike) + ")")
            .attr("fill", brk ? "none" : C.blue).attr("stroke", brk ? C.red : C.blue).attr("stroke-width", 1.2);
        }});
        rootG.append("text").attr("x", 10).attr("y", y0 + h - 6).attr("text-anchor", "start")
          .attr("fill", "#3F4650").attr("font-size", 7).attr("font-family", MONO)
          .text("ref " + T.ref_strike);
      }})();

      // GEX
      (function () {{
        var y0 = off.gex, h = 50;
        var gmax = d3.max(T.gex.map(Math.abs).filter(function (v) {{ return v != null; }})) || 1;
        var y = d3.scaleLinear().domain([-gmax, gmax]).range([y0 + h - 6, y0 + 6]);
        var zero = y(0);
        var pos = d3.area().defined(function (d) {{ return d != null && d >= 0; }})
          .x(function (d, i) {{ return x(T.m[i]); }}).y0(zero).y1(function (d) {{ return y(d); }});
        var neg = d3.area().defined(function (d) {{ return d != null && d < 0; }})
          .x(function (d, i) {{ return x(T.m[i]); }}).y0(zero).y1(function (d) {{ return y(d); }});
        rootG.append("path").datum(T.gex).attr("fill", rgba(C.green, 0.26)).attr("d", pos);
        rootG.append("path").datum(T.gex).attr("fill", rgba(C.red, 0.32)).attr("d", neg);
        rootG.append("path").datum(T.gex).attr("fill", "none").attr("stroke", C.amber)
          .attr("stroke-width", 1).attr("d", d3.line().defined(function (d) {{ return d != null; }})
            .x(function (d, i) {{ return x(T.m[i]); }}).y(function (d) {{ return y(d); }}));
        rootG.append("line").attr("x1", 0).attr("x2", W).attr("y1", zero).attr("y2", zero).attr("stroke", "#3A4048");
        T.flips.forEach(function (f) {{
          rootG.append("line").attr("x1", x(f.m)).attr("x2", x(f.m)).attr("y1", y0 + 2).attr("y2", y0 + h - 2)
            .attr("stroke", rgba(C.amber, 0.55)).attr("stroke-dasharray", "3 3");
          rootG.append("circle").attr("cx", x(f.m)).attr("cy", y(f.to)).attr("r", 2.6)
            .attr("fill", f.to > 0 ? C.green : C.red).attr("stroke", "#0B0E13").attr("stroke-width", 0.8);
        }});
        rootG.append("text").attr("x", W - 4).attr("y", y0 + 9).attr("text-anchor", "end")
          .attr("fill", "#3F4650").attr("font-size", 7).attr("font-family", MONO)
          .text("net GEX · " + T.flips.length + " persistent flip" + (T.flips.length == 1 ? "" : "s"));
      }})();

      // events lane
      (function () {{
        var y0 = off.events;
        T.events.forEach(function (e, i) {{
          var col = TYPE_COL[e.type] || C.muted;
          rootG.append("rect").attr("x", x(e.m) - 4).attr("y", y0 + 8).attr("width", 8).attr("height", 12)
            .attr("rx", 1).attr("fill", col).attr("fill-opacity", 0.9);
          var ly = y0 + 17 + (i % 2) * 11;
          rootG.append("line").attr("x1", x(e.m) + 5).attr("x2", x(e.m) + 9)
            .attr("y1", y0 + 14).attr("y2", ly - 6).attr("stroke", "#2C313B");
          rootG.append("text").attr("x", x(e.m) + 10).attr("y", ly)
            .attr("fill", C.muted).attr("font-size", 7.5).attr("font-family", MONO).text(e.id);
        }});
      }})();

      // axis
      var axis = rootG.append("g").attr("transform", "translate(0," + axisY + ")");
      axis.append("g").attr("transform", "translate(0," + AXIS_H + ")").call(
        d3.axisBottom(x).tickValues(tickVals()).tickFormat(function (m) {{
          var hh = Math.floor(m / 60), mm = Math.round(m % 60);
          return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
        }})
      ).call(function (g) {{
        g.selectAll("text").attr("fill", C.muted).style("font", "8.5px " + MONO);
        g.selectAll("line").attr("stroke", C.border);
        g.selectAll("path.domain").attr("stroke", C.border);
      }});

      // hover crosshair
      var cross = rootG.append("line").attr("y1", 0).attr("y2", axisY)
        .attr("stroke", rgba(C.amber, 0.5)).attr("stroke-dasharray", "2 3").style("display", "none");
      svg.on("mousemove", function (ev) {{
        var pt = d3.pointer(ev, svg.node());
        var m = x.invert(pt[0]);
        var i = nearestIdx(m);
        cross.style("display", null).attr("x1", x(T.m[i])).attr("x2", x(T.m[i]));
        showMinuteTip(ev, i);
      }}).on("mouseleave", function () {{ cross.style("display", "none"); hideTip(); }});
    }}

    // brush strip
    var bsvgWidth = Math.max(scroll.clientWidth - 1, NARROW ? 1180 : 900);
    bsvg.attr("width", bsvgWidth).attr("height", BRUSH_H);
    var bx = d3.scaleLinear().domain([T.m[0], T.m[T.m.length - 1]]).range([12, bsvgWidth - 14]);
    bsvg.append("rect").attr("x", 12).attr("y", 3).attr("width", bsvgWidth - 26).attr("height", BRUSH_H - 6)
      .attr("fill", "#10141B").attr("stroke", "#1A1F27");
    bsvg.append("g").selectAll("rect").data(T.m).enter().append("rect")
      .attr("x", function (d) {{ return bx(d); }}).attr("y", 4).attr("width", 1).attr("height", BRUSH_H - 8)
      .attr("fill", function (d, i) {{ return i % 2 ? "#2C313B" : "#232830"; }});
    var brush = d3.brushX().extent([[12, 0], [bsvgWidth - 14, BRUSH_H - 2]])
      .on("end", function (ev) {{
        if (!ev.selection) {{
          state.dom = [T.m[0], T.m[T.m.length - 1]];
          render();
          return;
        }}
        var a = bx.invert(ev.selection[0]), b = bx.invert(ev.selection[1]);
        if (b - a < 5) return;
        state.dom = [a, b];
        render();
      }});
    var gb = bsvg.append("g").call(brush);
    bsvg.on("dblclick", function () {{
      gb.call(brush.move, null);
      state.dom = [T.m[0], T.m[T.m.length - 1]];
      render();
    }});

    render();

    // reset + legend
    var reset = document.createElement("button");
    reset.className = "ia-tl-reset";
    reset.textContent = "reset zoom";
    reset.addEventListener("click", function () {{
      gb.call(brush.move, null);
      state.dom = [T.m[0], T.m[T.m.length - 1]];
      render();
    }});
    if (legend) {{
      legend.innerHTML =
        '<span><i style="background:' + C.amber + '"></i>spot</span>' +
        '<span><i style="background:' + C.red + '"></i>ITM put flow</span>' +
        '<span><i style="background:' + C.green + '"></i>ITM call flow</span>' +
        '<span><i style="background:' + C.red + '"></i>call wall</span>' +
        '<span><i style="background:' + C.green + '"></i>put wall</span>' +
        '<span><i style="background:' + C.amber + '"></i>net GEX</span>';
      legend.appendChild(reset);
    }}
    if (readEl) {{
      readEl.innerHTML = "Five lanes on the tape clock, not a schematic: spot, per-minute ITM PE/CE volume, " +
        "the live call/put walls, net GEX and the event ticker. Hover any lane for that minute's numbers; " +
        "click a marker to jump to its card; drag the strip to zoom.";
    }}
  }}

  /* --------------------------------------------------------------- ladder */
  function drawLadder() {{
    var L = D.ladder;
    if (!window.d3 || !L || !L.t.length) return;
    var d3 = window.d3;
    var host = document.getElementById("ia-ladder");
    var readEl = document.getElementById("ia-ladder-read");
    if (!host) return;
    var width = Math.max(300, host.clientWidth || 700);
    var height = 230;
    var m = {{ t: 14, r: 44, b: 22, l: 38 }};
    host.innerHTML = "";
    var svg = d3.select(host).append("svg").attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width).attr("height", height);
    var iw = width - m.l - m.r, ih = height - m.t - m.b;
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    var mm = L.t.length ? L.t.map(function (c) {{
      return parseInt(c.slice(0, 2), 10) * 60 + parseInt(c.slice(3, 5), 10);
    }}) : [0, 1];
    var x = d3.scaleLinear().domain([mm[0], mm[mm.length - 1]]).range([0, iw]);
    var callGap = L.call_wall.map(function (v, i) {{ return v == null || L.spot[i] == null ? null : v - L.spot[i]; }});
    var putGap = L.put_wall.map(function (v, i) {{ return v == null || L.spot[i] == null ? null : L.spot[i] - v; }});
    var mpGap = L.max_pain.map(function (v, i) {{ return v == null || L.spot[i] == null ? null : L.spot[i] - v; }});
    var vals = callGap.concat(putGap, mpGap).filter(function (v) {{ return v != null; }});
    var ext = d3.extent(vals);
    var y = d3.scaleLinear().domain([Math.min(0, ext[0] - 15), ext[1] + 15]).range([ih, 0]);
    var line = d3.line().defined(function (d) {{ return d != null; }})
      .x(function (d, i) {{ return x(mm[i]); }}).y(function (d) {{ return y(d); }});
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#3A4048");
    [[callGap, C.red], [putGap, C.green], [mpGap, C.amber]].forEach(function (pair) {{
      g.append("path").datum(pair[0]).attr("fill", "none").attr("stroke", pair[1])
        .attr("stroke-width", 1.5).attr("d", line);
    }});
    g.append("g").attr("transform", "translate(0," + ih + ")")
      .call(d3.axisBottom(x).tickValues([mm[0], (mm[0] + mm[mm.length - 1]) / 2, mm[mm.length - 1]])
        .tickFormat(function (v) {{
          return String(Math.floor(v / 60)).padStart(2, "0") + ":" + String(Math.round(v % 60)).padStart(2, "0");
        }}))
      .call(function (g) {{
        g.selectAll("text").attr("fill", C.muted).style("font", "8.5px " + MONO);
        g.selectAll("line").attr("stroke", C.border); g.selectAll("path.domain").attr("stroke", C.border);
      }});
    g.append("g").call(d3.axisLeft(y).ticks(4)).call(function (g) {{
      g.selectAll("text").attr("fill", C.muted).style("font", "8.5px " + MONO);
      g.selectAll("line").attr("stroke", C.border); g.selectAll("path.domain").attr("stroke", C.border);
    }});
    if (readEl) {{
      readEl.innerHTML = "The call wall is the nearest high-OI call strike, the put wall the nearest high-OI put. " +
        "A gap near zero means price is sitting on the wall; a persistent positive gap means the wall is overhead resistance.";
    }}
  }}

  /* ------------------------------------------------------------------ GEX */
  function drawGex() {{
    var L = D.ladder;
    if (!window.d3 || !L || !L.t.length) return;
    var d3 = window.d3;
    var host = document.getElementById("ia-gex");
    var readEl = document.getElementById("ia-gex-read");
    if (!host) return;
    var width = Math.max(300, host.clientWidth || 700), height = 210;
    var m = {{ t: 14, r: 14, b: 22, l: 44 }};
    host.innerHTML = "";
    var svg = d3.select(host).append("svg").attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width).attr("height", height);
    var iw = width - m.l - m.r, ih = height - m.t - m.b;
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    var mm = L.t.map(function (c) {{
      return parseInt(c.slice(0, 2), 10) * 60 + parseInt(c.slice(3, 5), 10);
    }});
    var x = d3.scaleLinear().domain([mm[0], mm[mm.length - 1]]).range([0, iw]);
    var vals = L.gex.filter(function (v) {{ return v != null; }}).slice().sort(d3.ascending);
    var p01 = d3.quantile(vals, 0.01), p99 = d3.quantile(vals, 0.99);
    var ext = [Math.min(p01, 0), Math.max(p99, 0)];
    var clipped = vals.filter(function (v) {{ return v < ext[0] || v > ext[1]; }});
    var y = d3.scaleLinear().domain([ext[0] - 5, ext[1] + 5]).range([ih, 0]);
    var clamp = function (v) {{ return v == null ? null : Math.max(ext[0] - 5, Math.min(ext[1] + 5, v)); }};
    var zero = y(0);
    var area = d3.area().defined(function (d) {{ return d != null; }})
      .x(function (d, i) {{ return x(mm[i]); }}).y0(zero).y1(function (d) {{ return y(clamp(d)); }});
    g.append("path").datum(L.gex).attr("fill", rgba(C.red, 0.3)).attr("d", area);
    g.append("path").datum(L.gex).attr("fill", "none").attr("stroke", C.amber).attr("stroke-width", 1.2)
      .attr("d", d3.line().defined(function (d) {{ return d != null; }})
        .x(function (d, i) {{ return x(mm[i]); }}).y(function (d) {{ return y(clamp(d)); }}));
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", zero).attr("y2", zero).attr("stroke", "#3A4048");
    g.append("g").attr("transform", "translate(0," + ih + ")")
      .call(d3.axisBottom(x).tickValues([mm[0], (mm[0] + mm[mm.length - 1]) / 2, mm[mm.length - 1]])
        .tickFormat(function (v) {{
          return String(Math.floor(v / 60)).padStart(2, "0") + ":" + String(Math.round(v % 60)).padStart(2, "0");
        }}))
      .call(function (g) {{
        g.selectAll("text").attr("fill", C.muted).style("font", "8.5px " + MONO);
        g.selectAll("line").attr("stroke", C.border); g.selectAll("path.domain").attr("stroke", C.border);
      }});
    g.append("g").call(d3.axisLeft(y).ticks(4)).call(function (g) {{
      g.selectAll("text").attr("fill", C.muted).style("font", "8.5px " + MONO);
      g.selectAll("line").attr("stroke", C.border); g.selectAll("path.domain").attr("stroke", C.border);
    }});
    if (clipped.length) {{
      g.append("text").attr("x", iw - 2).attr("y", 9).attr("text-anchor", "end")
        .attr("fill", C.muted).style("font", "8px " + MONO)
        .text(clipped.length + " min off scale · min " + Math.round(d3.min(vals)));
    }}
    if (readEl) {{
      readEl.innerHTML = "Net dealer gamma proxy from the report. Negative readings mean hedging leans with price; " +
        "the longer the negative stretch, the further a leg can travel without order-flow support.";
    }}
  }}

  /* -------------------------------------------------------------- terrain */
  function drawTerrain() {{
    var T = D.terrain;
    if (!window.Plotly || !T || !T.times.length) return;
    var host = document.getElementById("ia-terrain");
    if (!host) return;
    var step = Math.max(1, Math.round(T.times.length / 8));
    var trace = {{
      type: "heatmap", x: T.strikes, y: T.times, z: T.net,
      colorscale: [[0, "#e5606a"], [0.35, "#5a2a2f"], [0.5, "#13161C"],
                   [0.65, "#1f5a3c"], [1, "#2FA36B"]],
      zmid: 0, connectgaps: true,
      colorbar: {{ title: {{ text: "PE−CE OI ₹M", side: "right", font: {{ color: C.muted, size: 9 }} }},
        tickfont: {{ color: C.muted, size: 8 }}, thickness: 8, len: 0.7, outlinewidth: 0 }},
      hovertemplate: "strike %{{x}}<br>%{{y}}<br>PE−CE %{{z:.1f}}M<extra></extra>"
    }};
    window.Plotly.react(host, [trace], {{
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      margin: {{ l: 44, r: 8, t: 6, b: 28 }},
      height: host.clientWidth > 700 ? 380 : 280,
      font: {{ color: C.muted, size: 9, family: MONO }},
      xaxis: {{ title: {{ text: "strike", font: {{ size: 9 }} }}, gridcolor: "#242A33",
                tickfont: {{ size: 8 }}, ticks: "outside", tickcolor: "#2C313B" }},
      yaxis: {{ title: {{ text: "clock", font: {{ size: 9 }} }}, gridcolor: "#242A33",
                tickfont: {{ size: 8 }}, tickmode: "array",
                tickvals: T.times.filter(function (_, i) {{ return i % step === 0; }}),
                ticktext: T.times.filter(function (_, i) {{ return i % step === 0; }}),
                autorange: "reversed" }}
    }}, {{ displayModeBar: false, responsive: true }});
  }}

  function boot() {{
    drawTape(); drawLadder(); drawGex(); drawTerrain();
    if (window.ResizeObserver) {{
      if (tapeResize) tapeResize.disconnect();
      var timer = null;
      tapeResize = new ResizeObserver(function () {{
        clearTimeout(timer);
        timer = setTimeout(function () {{ drawTape(); drawLadder(); drawGex(); }}, 180);
      }});
      ["ia-tape-scroll", "ia-ladder", "ia-gex"].forEach(function (id) {{
        var n = document.getElementById(id); if (n) tapeResize.observe(n);
      }});
    }}
  }}
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {{ once: true }});
  else boot();
}})();
</script>
</section>
"""


def render_preview(fragment: str) -> str:
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
        "<title>Intraday anatomy — standalone validation wrapper</title>\n"
        "<script src=\"https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js\"></script>\n"
        "<script src=\"https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js\"></script>\n"
        "<style>html,body{margin:0;background:#000;color:#E8E8E8;"
        "font:13px/1.5 ui-monospace,SFMono-Regular,\"SF Mono\",Menlo,Consolas,monospace}"
        "body{padding:16px;max-width:100%}</style>\n</head>\n<body>\n"
        + fragment + "\n</body>\n</html>\n"
    )


def main() -> None:
    global SESSION, EXPIRY, OUT, CLIP, P_NIFTY_TAPE, P_NIFTY_CHAIN, P_NIFTY_SNAPS
    global P_FUT, P_SENSEX_TAPE, P_SENSEX_CHAIN, P_SENSEX_SNAPS

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", default="2026-11-17")
    parser.add_argument("--expiry", default=None)
    parser.add_argument("--out-dir", default=None)
    parser.add_argument("--clip", default=None)
    parser.add_argument("--root", default=None, help="data root (defaults to repo)")
    args = parser.parse_args()

    SESSION = args.session
    EXPIRY = args.expiry or args.session
    OUT = Path(args.out_dir) if args.out_dir else ROOT / f"reports/nifty_{SESSION}/research"
    data_root = Path(args.root) if args.root else ROOT
    P_NIFTY_TAPE = data_root / f"experiments/data/nifty_tape/{SESSION}.jsonl"
    P_NIFTY_CHAIN = data_root / f"experiments/data/nifty_chain10s/{SESSION}.jsonl"
    P_NIFTY_SNAPS = data_root / f"experiments/data/nifty_snapshots/{SESSION}.jsonl"
    P_FUT = data_root / f"reports/nifty_{SESSION}/data/futures_1m.json"
    P_SENSEX_TAPE = data_root / f"experiments/data/options_tape/SENSEX/{SESSION}.jsonl"
    P_SENSEX_CHAIN = data_root / f"experiments/data/options_chain10s/SENSEX/{SESSION}.jsonl"
    P_SENSEX_SNAPS = data_root / f"experiments/data/options_snapshots/SENSEX/{SESSION}.jsonl"
    if args.clip:
        CLIP = args.clip
    else:
        snaps = read_jsonl(P_NIFTY_SNAPS)
        CLIP = hm(snaps[-1]["t"]) if snaps else "15:30"

    data = load()
    payload = build_payload(data)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "intraday_anatomy.json").write_text(json.dumps(payload, indent=1))
    frag = render_html(payload)
    (OUT / "intraday_anatomy.html").write_text(frag)
    (OUT / "intraday_anatomy_preview.html").write_text(render_preview(frag))
    print("session", SESSION, "clip", CLIP, "| tape", len(data["n_tape"]),
          "| chain10s", len(data["n_chain"]), "| snaps", len(data["n_snaps"]),
          "| futures", len(data["fut"]), "| sensex tape", len(data["s_tape"]))
    print("events", len(payload["events"]),
          "| json", (OUT / "intraday_anatomy.json").stat().st_size // 1024, "KB",
          "| html", (OUT / "intraday_anatomy.html").stat().st_size // 1024, "KB",
          "| preview", (OUT / "intraday_anatomy_preview.html").stat().st_size // 1024, "KB")
    print(json.dumps([
        {"id": e["id"], "t": f"{e['t0']}->{e['t1']}", "move": e["move"],
         "type": e["type"], "top": e["top"][:2]}
        for e in payload["events"]
    ], indent=1))


if __name__ == "__main__":
    main()
