#!/usr/bin/env python3
"""Who actually positioned? — participant-flow research section for a NIFTY expiry session.

Classifies every (strike, side, 5-minute bucket) cell of the 0-DTE chain into the
standard four-quadrant buildup states, then reads the session's own windows:

  * which side carried the opening move,
  * what the session high / low buckets were actually made of,
  * what happened into the close (and where the recorder stopped being live),
  * which strikes churned between states (and which simply ran noise).

Everything is derived from the 10-second chain recorder, clipped at its own last
snapshot (or `--clip`). A 1-minute futures file, when the session has one, is only
a cross-check on index OI — never a chart input; the option book is the subject.

Outputs (fragment contract — the assembler owns the page, D3 + Plotly):

    reports/nifty_<session>/research/participant_flow.json
    reports/nifty_<session>/research/participant_flow.html

Run with the project venv:

    .venv/bin/python scripts/market/nifty_research_participant_flow.py
    .venv/bin/python scripts/market/nifty_research_participant_flow.py \\
        --session 2026-10-27 --expiry 2026-10-27 --clip 15:29
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SESSION = "2026-11-17"
BUCKET_MIN = 5
GAP_SECONDS = 90          # longer than this between frames = recorder outage, not flow
BAND_RADIUS = 300         # strikes kept on each side of the session-median spot

# Four-quadrant states. Order is the legend/stack order.
CLASSES = [
    {"id": "long_buildup", "label": "long buildup", "short": "LB", "color": "#2FA36B",
     "note": "premium up + OI up"},
    {"id": "short_buildup", "label": "short buildup", "short": "SB", "color": "#E5606A",
     "note": "premium down + OI up"},
    {"id": "short_cover", "label": "short covering", "short": "SC", "color": "#3B93AD",
     "note": "premium up + OI down"},
    {"id": "long_unwind", "label": "long unwinding", "short": "LU", "color": "#8E80B8",
     "note": "premium down + OI down"},
    {"id": "flat", "label": "flat / noise", "short": "FL", "color": "#5C6A7D",
     "note": "|Δprem| < 1 pt and |ΔOI| < 1,000"},
]
CIDX = {c["id"]: i for i, c in enumerate(CLASSES)}
SIDES = ["CE", "PE"]

SESSION_START: datetime
CLIP_MIN: float
CLIP_LABEL: str
CHAIN_FIRST_LABEL = ""
BAND: list[int]
FUTURES: Path | None = None


# --------------------------------------------------------------------------- #
# config / load
# --------------------------------------------------------------------------- #
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--session", default=DEFAULT_SESSION, help="session date (chain file name)")
    p.add_argument("--expiry", default=None, help="expiry date the chain rows belong to")
    p.add_argument("--out-dir", default=None, help="output dir (default reports/nifty_<session>/research)")
    p.add_argument("--chain", default=None, help="chain10s jsonl (default experiments/data/nifty_chain10s/<session>.jsonl)")
    p.add_argument("--futures", default=None, help="optional futures_1m.json cross-check")
    p.add_argument("--tape", default=None, help="optional tape jsonl for context metrics")
    p.add_argument("--clip", default=None, metavar="HH:MM",
                   help="include every snapshot up to the end of this minute (default: last snapshot)")
    p.add_argument("--band-radius", type=int, default=BAND_RADIUS,
                   help="strikes kept within this many points of the median spot")
    return p.parse_args()


def minutes(ts: str) -> float:
    return (datetime.fromisoformat(ts) - SESSION_START).total_seconds() / 60.0


def hhmm(m: float) -> str:
    t = SESSION_START.timestamp() + m * 60
    return datetime.fromtimestamp(t, SESSION_START.tzinfo).strftime("%H:%M")


def load_chain(path: Path, expiry: str) -> list[dict[str, Any]]:
    out = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            snap = json.loads(line)
            if minutes(snap["t"]) > CLIP_MIN:
                continue
            if snap.get("expiry") and snap["expiry"] != expiry:
                raise SystemExit(
                    f"{path.name} carries expiry {snap['expiry']}, not {expiry} — "
                    "pass --expiry to label it correctly or check the file"
                )
            out.append(snap)
    if not out:
        raise SystemExit(f"{path} is empty within the clip — nothing to classify")
    return out


def pick_band(snaps: list[dict[str, Any]], radius: int) -> list[int]:
    strikes = sorted({int(r[0]) for r in snaps[0]["rows"]})
    spots = sorted(float(s["spot"]) for s in snaps)
    mid = spots[len(spots) // 2]
    band = [k for k in strikes if abs(k - mid) <= radius]
    if len(band) < 6:
        raise SystemExit(f"band radius {radius} leaves only {len(band)} strikes around {mid:,.0f}")
    return band


def frame(snaps: list[dict[str, Any]], minute: float) -> dict[str, Any]:
    for snap in snaps:
        if minutes(snap["t"]) >= minute:
            return snap
    return snaps[-1]


def rows(snap: dict[str, Any]) -> dict[int, list[float]]:
    """`[strike, ce_ltp, ce_oi, ce_vol, pe_ltp, pe_oi, pe_vol]`."""
    return {int(r[0]): r for r in snap["rows"]}


def classify(d_prem: float, d_oi: float) -> str:
    if abs(d_prem) < 1.0 and abs(d_oi) < 1000:
        return "flat"
    if d_prem > 0 and d_oi > 0:
        return "long_buildup"
    if d_prem < 0 and d_oi > 0:
        return "short_buildup"
    if d_prem > 0 and d_oi < 0:
        return "short_cover"
    if d_prem < 0 and d_oi < 0:
        return "long_unwind"
    return "flat"


# --------------------------------------------------------------------------- #
# buckets / cells
# --------------------------------------------------------------------------- #
def bucket_edges(snaps: list[dict[str, Any]]) -> list[float]:
    """Session-grid 5-min edges, with the first frame at the real first snapshot.

    A late start (e.g. 10:04) must not be back-filled to 09:15: the first bucket is
    short and carries only the data that exists.
    """
    first = minutes(snaps[0]["t"])
    edges = [round(first, 2)]
    m = float(int(first // BUCKET_MIN) * BUCKET_MIN) + BUCKET_MIN
    while m < CLIP_MIN - 0.01:
        edges.append(float(m))
        m += BUCKET_MIN
    edges.append(round(min(CLIP_MIN, minutes(snaps[-1]["t"])), 2))
    return edges


def build(snaps: list[dict[str, Any]]) -> dict[str, Any]:
    edges = bucket_edges(snaps)
    frames = [frame(snaps, e) for e in edges]
    frame_min = [minutes(f["t"]) for f in frames]

    buckets: list[dict[str, Any]] = []
    cells: list[list[Any]] = []
    levels: dict[int, dict[int, list[float]]] = {0: rows(frames[0])}
    for i in range(1, len(edges)):
        a, b = rows(frames[i - 1]), rows(frames[i])
        levels[i] = b
        span = frame_min[i] - frame_min[i - 1]
        gap = span * 60 > GAP_SECONDS + BUCKET_MIN * 60 or span <= 0.01
        spot0, spot1 = float(frames[i - 1]["spot"]), float(frames[i]["spot"])
        buckets.append({
            "i": i,
            "s": hhmm(frame_min[i - 1]),        # actual frame, not the nominal edge
            "e": hhmm(frame_min[i]),
            "edge": edges[i],
            "start": edges[i - 1],
            "spot": round(spot1, 2),
            "spot0": round(spot0, 2),
            "partial": edges[i] - edges[i - 1] < BUCKET_MIN - 0.01,
            "gap": gap,
            "span_min": round(span, 2),
        })
        if gap:
            continue
        for strike in BAND:
            if strike not in a or strike not in b:
                continue
            ra, rb = a[strike], b[strike]
            for side, pi, ii, vi in (("CE", 1, 2, 3), ("PE", 4, 5, 6)):
                dp = float(rb[pi]) - float(ra[pi])
                doi = float(rb[ii]) - float(ra[ii])
                dvol = float(rb[vi]) - float(ra[vi])
                cls = classify(dp, doi)
                cells.append([
                    i, strike, SIDES.index(side),
                    round(dp, 2), int(doi), int(dvol), CIDX[cls],
                ])

    gaps = merge_gaps(buckets, frame_min)
    return {"edges": edges, "buckets": buckets, "cells": cells,
            "futures": load_futures(edges), "levels": levels, "gaps": gaps}


def merge_gaps(buckets: list[dict[str, Any]], frame_min: list[float]) -> list[dict[str, Any]]:
    """One record per contiguous outage — the hole, not every bucket it swallowed."""
    out: list[dict[str, Any]] = []
    k = 0
    while k < len(buckets):
        if not buckets[k]["gap"]:
            k += 1
            continue
        j = k
        while j + 1 < len(buckets) and buckets[j + 1]["gap"]:
            j += 1
        start, end = frame_min[k], frame_min[j + 1]
        out.append({"i": buckets[k]["i"], "from": hhmm(start), "to": hhmm(end),
                    "minutes": round(end - start, 1), "buckets": j - k + 1})
        k = j + 1
    return out


def load_futures(edges: list[float]) -> list[dict[str, Any]]:
    if not FUTURES or not FUTURES.exists():
        return []
    candles = json.loads(FUTURES.read_text())["candles"]
    by_min: dict[int, dict[str, Any]] = {}
    for c in candles:
        m = int(minutes(c["t"]))
        if m <= CLIP_MIN:
            by_min[m] = c
    out = []
    for i in range(1, len(edges)):
        start, end = int(edges[i - 1]), int(edges[i])
        last = by_min.get(min(end, int(CLIP_MIN)))
        if last is None:
            continue
        out.append({
            "i": i,
            "c": round(float(last["c"]), 1),
            "oi": int(last["oi"]),
            "vol": int(sum(by_min[m]["v"] for m in range(start, end) if m in by_min)),
        })
    return out


def fut_window(edges: list[float], a: float, b: float) -> dict[str, Any] | None:
    if not FUTURES or not FUTURES.exists():
        return None
    candles = json.loads(FUTURES.read_text())["candles"]
    by_min = {int(minutes(c["t"])): c for c in candles}
    first = by_min.get(int(a))
    last = by_min.get(int(b) - 1)
    if not first or not last:
        return None
    return {
        "open": round(float(first["o"]), 1),
        "close": round(float(last["c"]), 1),
        "dp": round(float(last["c"]) - float(first["o"]), 1),
        "doi": int(last["oi"] - first["oi"]),
        "vol": int(sum(by_min[m]["v"] for m in range(int(a), int(b)) if m in by_min)),
    }


# --------------------------------------------------------------------------- #
# aggregates
# --------------------------------------------------------------------------- #
def class_totals(cells: list[list[Any]], nb: int) -> list[dict[str, Any]]:
    abs_oi = [[0.0] * len(CLASSES) for _ in range(nb + 1)]
    counts = [[0] * len(CLASSES) for _ in range(nb + 1)]
    net = [[0.0] * len(CLASSES) for _ in range(nb + 1)]
    for bi, _strike, _side, _dp, doi, _dv, ci in cells:
        abs_oi[bi][ci] += abs(doi)
        counts[bi][ci] += 1
        net[bi][ci] += doi
    return [
        {
            "i": i,
            "abs_oi": [round(v / 1e6, 2) for v in abs_oi[i]],
            "count": counts[i],
            "net_oi": [round(v / 1e6, 2) for v in net[i]],
        }
        for i in range(1, nb + 1)
    ]


def net_side(cells: list[list[Any]], buckets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    acc: dict[int, dict[str, float]] = defaultdict(lambda: {"ce": 0.0, "pe": 0.0,
                                                            "cev": 0.0, "pev": 0.0})
    for bi, _strike, side, _dp, doi, dvol, _ci in cells:
        key = "ce" if side == 0 else "pe"
        acc[bi][key] += doi
        acc[bi][key + "v"] += dvol
    out = []
    for b in buckets:
        a = acc[b["i"]]
        out.append({
            "i": b["i"],
            "ce_oi": round(a["ce"] / 1e6, 3),
            "pe_oi": round(a["pe"] / 1e6, 3),
            "ce_vol": round(a["cev"] / 1e6, 1),
            "pe_vol": round(a["pev"] / 1e6, 1),
            "spot": b["spot"],
            "gap": b["gap"],
        })
    return out


def side_mix(cells: list[list[Any]], side: int) -> list[float]:
    mix = [0.0] * len(CLASSES)
    for _bi, _strike, sd, _dp, doi, _dv, ci in cells:
        if sd == side:
            mix[ci] += abs(doi)
    return mix


def dominant(mix: list[float]) -> tuple[int, float]:
    total = sum(mix)
    if not total:
        return CIDX["flat"], 0.0
    ci = max(range(len(CLASSES)), key=lambda j: mix[j])
    return ci, 100.0 * mix[ci] / total


def window_stats(cells: list[list[Any]], buckets: list[dict[str, Any]],
                 levels: dict[int, dict[int, list[float]]],
                 first_i: int, last_i: int) -> dict[str, Any]:
    """Aggregate the bucket range [first_i, last_i] (bucket indices, inclusive)."""
    sel = [c for c in cells if first_i <= c[0] <= last_i]
    by_strike: dict[int, dict[str, Any]] = {}
    for bi, strike, side, dp, doi, dvol, ci in sel:
        s = by_strike.setdefault(strike, {
            "strike": strike,
            "d_ce_oi": 0, "d_pe_oi": 0,
            "d_ce_prem": 0.0, "d_pe_prem": 0.0,
            "d_ce_vol": 0, "d_pe_vol": 0,
            "ce_class": "flat", "pe_class": "flat",
            "ce_oi_mag": 0.0, "pe_oi_mag": 0.0,
        })
        if side == 0:
            s["d_ce_oi"] += doi
            s["d_ce_prem"] = round(s["d_ce_prem"] + dp, 2)
            s["d_ce_vol"] += dvol
            s["ce_oi_mag"] += abs(doi)
            s["ce_class"] = classify(s["d_ce_prem"], s["d_ce_oi"])
        else:
            s["d_pe_oi"] += doi
            s["d_pe_prem"] = round(s["d_pe_prem"] + dp, 2)
            s["d_pe_vol"] += dvol
            s["pe_oi_mag"] += abs(doi)
            s["pe_class"] = classify(s["d_pe_prem"], s["d_pe_oi"])

    strikes = sorted(by_strike.values(), key=lambda r: -r["strike"])
    b0, b1 = buckets[first_i - 1], buckets[last_i - 1]
    tot_ce = sum(s["d_ce_oi"] for s in strikes)
    tot_pe = sum(s["d_pe_oi"] for s in strikes)
    vol = sum(s["d_ce_vol"] + s["d_pe_vol"] for s in strikes)
    divergence = sorted(strikes, key=lambda s: -abs(s["d_pe_oi"] - s["d_ce_oi"]))

    ce_mix, pe_mix = side_mix(sel, 0), side_mix(sel, 1)
    ce_dom, ce_share = dominant(ce_mix)
    pe_dom, pe_share = dominant(pe_mix)

    atm = min(BAND, key=lambda k: abs(k - b0["spot0"]))
    row0 = levels.get(first_i - 1, {}).get(atm)
    row1 = levels.get(last_i, {}).get(atm)

    return {
        "label": f"{b0['s']}–{b1['e']}" if first_i == last_i else f"{b0['s']}–{b1['e']}",
        "start": b0["s"], "end": b1["e"],
        "first_i": first_i, "last_i": last_i,
        "spot0": b0["spot0"], "spot1": b1["spot"],
        "d_spot": round(b1["spot"] - b0["spot0"], 1),
        "d_ce_oi": int(tot_ce), "d_pe_oi": int(tot_pe),
        "volume": int(vol),
        "strikes": strikes,
        "ce_dom": CLASSES[ce_dom]["id"], "ce_dom_label": CLASSES[ce_dom]["label"],
        "ce_dom_share": round(ce_share, 1),
        "pe_dom": CLASSES[pe_dom]["id"], "pe_dom_label": CLASSES[pe_dom]["label"],
        "pe_dom_share": round(pe_share, 1),
        "atm": atm,
        "atm_ce": [round(float(row0[1]), 2), round(float(row1[1]), 2)] if row0 and row1 else None,
        "atm_pe": [round(float(row0[4]), 2), round(float(row1[4]), 2)] if row0 and row1 else None,
        "atm_straddle": ([round(float(row0[1]) + float(row0[4]), 2),
                          round(float(row1[1]) + float(row1[4]), 2)] if row0 and row1 else None),
        "top_ce": sorted(strikes, key=lambda s: -s["ce_oi_mag"])[:6],
        "top_pe": sorted(strikes, key=lambda s: -s["pe_oi_mag"])[:6],
        "divergence": divergence[:9],
    }


def transitions(cells: list[list[Any]], buckets: list[dict[str, Any]]) -> dict[str, Any]:
    seq: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for bi, strike, side, _dp, _doi, _dv, ci in cells:
        seq[(strike, side)].append((bi, ci))

    matrix = [[0] * len(CLASSES) for _ in CLASSES]
    switches: Counter[int] = Counter()
    total = 0
    for (_strike, _side), series in seq.items():
        series.sort()
        for (ba, a), (bb, b) in zip(series, series[1:]):
            if bb - ba != 1:          # do not bridge a recorder outage
                continue
            matrix[a][b] += 1
            total += 1
            if a != b:
                switches[_strike] += 1
    persist = sum(matrix[i][i] for i in range(len(CLASSES)))

    dwell: dict[int, Counter] = defaultdict(Counter)
    for (strike, _side), series in seq.items():
        for _, ci in series:
            dwell[strike][ci] += 1

    top = []
    for strike in sorted(switches, key=lambda s: -switches[s])[:8]:
        counts = dwell[strike]
        n = sum(counts.values()) or 1
        top.append({
            "strike": strike,
            "switches": int(switches[strike]),
            "dominant": CLASSES[counts.most_common(1)[0][0]]["label"],
            "dominant_pct": round(100 * counts.most_common(1)[0][1] / n, 1),
            "dwell": [round(100 * counts[i] / n, 1) for i in range(len(CLASSES))],
        })
    return {
        "matrix": matrix,
        "total": total,
        "persist": persist,
        "persist_pct": round(100 * persist / total, 1) if total else 0.0,
        "top": top,
    }


def focus_series(cells: list[list[Any]], buckets: list[dict[str, Any]],
                 levels: dict[int, dict[int, list[float]]], strike: int,
                 side: str) -> dict[str, Any]:
    sidx = SIDES.index(side)
    pi, ii, vi = (1, 2, 3) if side == "CE" else (4, 5, 6)
    series = []
    for bucket in buckets:
        row = levels.get(bucket["i"], {}).get(strike)
        if row is None or bucket["gap"]:
            continue
        match = next((c for c in cells if c[0] == bucket["i"] and c[1] == strike
                      and c[2] == sidx), None)
        series.append({
            "i": bucket["i"],
            "prem": round(float(row[pi]), 2),
            "oi": int(row[ii]),
            "vol": int(row[vi]),
            "dprem": round(match[3], 2) if match else 0.0,
            "doi": int(match[4]) if match else 0,
            "cls": CLASSES[match[6]]["id"] if match else "flat",
            "spot": bucket["spot"],
            "moneyness": round((bucket["spot"] - strike) if side == "CE"
                               else (strike - bucket["spot"]), 1),
        })
    return {
        "strike": strike, "side": side,
        "color": "#4F8BFF" if side == "CE" else "#FF8A3D",
        "series": series,
    }


def lifecycle(snaps: list[dict[str, Any]], bands: list[dict[str, Any]],
              strike: int, side: str) -> dict[str, Any]:
    """OI path of one leg at the window boundaries + its intraday peak."""
    ii = 5 if side == "PE" else 2
    marks = []
    for b in bands:
        snap = frame(snaps, b["start"])
        row = rows(snap).get(strike)
        if row is None:
            continue
        marks.append({"t": b["s"], "oi": int(row[ii]), "spot": round(float(snap["spot"]), 1)})
    peak_row, peak_min = 0, 0.0
    for snap in snaps:
        row = rows(snap).get(strike)
        if row is not None and row[ii] > peak_row:
            peak_row, peak_min = int(row[ii]), minutes(snap["t"])
    return {"strike": strike, "side": side, "marks": marks,
            "oi_peak": peak_row, "peak_time": hhmm(peak_min) if peak_row else None}


# --------------------------------------------------------------------------- #
# text helpers — every sentence is built from the numbers above
# --------------------------------------------------------------------------- #
def human(v: float) -> str:
    a = abs(v)
    if a >= 1e6:
        return f"{v / 1e6:,.1f}M"
    if a >= 1e3:
        return f"{v / 1e3:,.1f}k"
    return f"{v:,.0f}"


def sgn(v: float) -> str:
    return ("+" if v >= 0 else "−") + human(abs(v))


def pct(v: float) -> str:
    return f"{v:.1f}%"


def window_body(w: dict[str, Any], frozen: dict[str, Any] | None = None) -> str:
    ce = w["atm_ce"] or [0, 0]
    pe = w["atm_pe"] or [0, 0]
    if frozen and w["end"] >= frozen["from"][:5]:
        strad = w.get("atm_straddle") or [0, 0]
        lead = (f"Spot is frozen at <b>{frozen['value']:,.2f}</b> from {frozen['from'][:5]} "
                f"({frozen['minutes']:.0f} min), so this window's d_spot is unknown, not zero — read "
                f"the OI below as book changes at a stale underlying print. The ATM "
                f"{w['atm']:,} straddle went <b>{strad[0]:.1f} → {strad[1]:.1f}</b> pts in the same "
                f"window: into expiry the premium decay, not the index, carried the P&L. ")
    else:
        lead = (f"Spot <b>{w['d_spot']:+.1f}</b> pts to <b>{w['spot1']:,.0f}</b> on "
                f"<b>{human(w['volume'])}</b> contracts. ")
    return (
        lead +
        f"Calls: OI <b>{sgn(w['d_ce_oi'])}</b>, "
        f"{pct(w['ce_dom_share'])} of call |ΔOI| in <b>{w['ce_dom_label']}</b>, "
        f"ATM {w['atm']:,} CE {ce[0]:.1f} → {ce[1]:.1f}. Puts: OI <b>{sgn(w['d_pe_oi'])}</b>, "
        f"{pct(w['pe_dom_share'])} in <b>{w['pe_dom_label']}</b>, ATM PE {pe[0]:.1f} → {pe[1]:.1f}."
    )


def read_clause(w: dict[str, Any]) -> str:
    """One short, rule-chosen reading of the window — never an identity claim."""
    clauses = []
    d = w["d_spot"]
    if w["ce_dom"] == "short_cover" and d > 0:
        clauses.append("calls were bought back into the rise")
    if w["ce_dom"] == "short_buildup" and d < 0:
        clauses.append("fresh call supply met the decline")
    if w["ce_dom"] == "long_buildup" and d > 0:
        clauses.append("call OI was added with premium rising")
    if w["pe_dom"] == "long_buildup" and d < 0:
        clauses.append("puts were accumulated as spot fell")
    if w["pe_dom"] == "short_buildup" and d > 0:
        clauses.append("puts were written into the rise")
    if w["pe_dom"] == "short_cover" and d > 0:
        clauses.append("put shorts covered")
    if w["pe_dom"] == "short_cover" and d < 0:
        clauses.append("put shorts covered into the fall")
    if w["pe_dom"] == "long_unwind" and d > 0:
        clauses.append("put longs banked the move")
    if not clauses:
        clauses.append("both sides mostly churned rather than repriced")
    return "; ".join(clauses[:2]) + "."


# --------------------------------------------------------------------------- #
# findings
# --------------------------------------------------------------------------- #
def valid_window(buckets: list[dict[str, Any]], first_i: int, last_i: int) -> bool:
    sel = [b for b in buckets if first_i <= b["i"] <= last_i]
    return bool(sel) and all(not b["gap"] for b in sel)


def best_move(buckets: list[dict[str, Any]], n: int, sign: int,
              min_i: int = 0) -> tuple[int, int, float]:
    """Contiguous n-bucket window with the largest signed spot change."""
    best: tuple[float, int, int] | None = None
    for k in range(len(buckets) - n + 1):
        win = buckets[k:k + n]
        if win[0]["i"] < min_i:
            continue
        if any(b["gap"] for b in win) or win[-1]["i"] - win[0]["i"] != n - 1:
            continue
        d = win[-1]["spot"] - win[0]["spot0"]
        if best is None or sign * d > sign * best[0]:
            best = (d, win[0]["i"], win[-1]["i"])
    if best is None:
        return buckets[0]["i"], buckets[0]["i"], 0.0
    return best[1], best[2], best[0]


def build_findings(payload: dict[str, Any], snaps: list[dict[str, Any]],
                   built: dict[str, Any], tape: dict[str, Any] | None,
                   pre_open: dict[str, Any]) -> dict[str, Any]:
    buckets = payload["buckets"]
    cells = payload["cells"]
    levels = built["levels"]
    gaps = built["gaps"]
    first_i, last_i = buckets[0]["i"], buckets[-1]["i"]

    # anchors taken from the session itself, not from a previous day's narrative
    hi = max(snaps, key=lambda s: s["spot"])
    lo = min(snaps, key=lambda s: s["spot"])
    open_i0, open_i1 = first_i, min(last_i, first_i + 5)
    rip_i0, rip_i1, rip_d = best_move(buckets, 3, 1)
    slide_i0, slide_i1, slide_d = best_move(buckets, 3, -1, min_i=open_i1 + 1)
    close_i0, close_i1 = max(first_i, last_i - 3), last_i
    if not valid_window(buckets, close_i0, close_i1):
        close_i0 = close_i1

    w_open = window_stats(cells, buckets, levels, open_i0, open_i1)
    w_rip = window_stats(cells, buckets, levels, rip_i0, rip_i1)
    w_slide = window_stats(cells, buckets, levels, slide_i0, slide_i1)
    w_close = window_stats(cells, buckets, levels, close_i0, close_i1)

    # expiry decay across the band
    r0, r1 = levels[0], levels[last_i]
    band_ce0 = sum(float(r0[k][2]) for k in BAND if k in r0)
    band_ce1 = sum(float(r1[k][2]) for k in BAND if k in r1)
    band_pe0 = sum(float(r0[k][5]) for k in BAND if k in r0)
    band_pe1 = sum(float(r1[k][5]) for k in BAND if k in r1)
    vol_ce = sum(float(r1[k][3]) - float(r0[k][3]) for k in BAND if k in r0 and k in r1)
    vol_pe = sum(float(r1[k][6]) - float(r0[k][6]) for k in BAND if k in r0 and k in r1)

    # pin candidates: largest OI added on each side between first and last frame
    ce_gain = max(BAND, key=lambda k: float(r1[k][2]) - float(r0[k][2]))
    pe_gain = max(BAND, key=lambda k: float(r1[k][5]) - float(r0[k][5]))
    ce_delta = float(r1[ce_gain][2]) - float(r0[ce_gain][2])
    pe_delta = float(r1[pe_gain][5]) - float(r0[pe_gain][5])
    pin_pe = lifecycle(snaps, buckets, pe_gain, "PE")
    pin_ce = lifecycle(snaps, buckets, ce_gain, "CE")

    biggest = max(payload["net_side"], key=lambda r: abs(r["ce_oi"]) + abs(r["pe_oi"]))
    busiest = max(payload["net_side"], key=lambda r: r["ce_vol"] + r["pe_vol"])
    b_at = next(b for b in buckets if b["i"] == busiest["i"])

    gap_min = sum(g["minutes"] for g in gaps)
    frozen = longest_frozen(snaps)

    cards = [
        {"cls": "open", "title": f"{w_open['start']}–{w_open['end']} · the opening drive",
         "metric": window_metric(w_open), "body": window_body(w_open) + " " + read_clause(w_open)},
        {"cls": "slide", "title": f"the slide · {w_slide['start']}–{w_slide['end']} ({slide_d:+.1f} pts)",
         "metric": window_metric(w_slide), "body": window_body(w_slide) + " " + read_clause(w_slide)},
        {"cls": "rip", "title": f"the rip · {w_rip['start']}–{w_rip['end']} ({rip_d:+.1f} pts)",
         "metric": window_metric(w_rip), "body": window_body(w_rip) + " " + read_clause(w_rip)},
        {"cls": "close", "title": f"{w_close['start']}–{w_close['end']} · "
                                   + ("into the close" if CLIP_MIN >= 370 else
                                      f"the last window (recorder ends {CLIP_LABEL})"),
         "metric": window_metric(w_close, frozen),
         "body": window_body(w_close, frozen)},
        {"cls": "pin", "title": (
            f"the strikes that gained OI — {pe_gain:,} PE / {ce_gain:,} CE"
            if max(ce_delta, pe_delta) > 0 else
            "expiry decay — no strike added OI across the session"),
         "metric": (f"{pe_gain:,} PE {human(float(r0[pe_gain][5]))} → {human(pin_pe['oi_peak'])} → "
                    f"{human(float(r1[pe_gain][5]))} · {ce_gain:,} CE "
                    f"{human(float(r0[ce_gain][2]))} → {human(float(r1[ce_gain][2]))}"),
         "body": pin_body(pin_pe, pin_ce, r0, r1, buckets[-1]["spot"],
                          "the close" if CLIP_MIN >= 370 else f"the last frame at {CLIP_LABEL}")},
    ]

    kpis = [
        {"label": "classifications", "value": f"{len(cells):,}",
         "sub": f"{sum(1 for b in buckets if not b['gap'])} buckets × {len(BAND) * 2} legs"},
        {"label": "state persistence", "value": pct(payload["transitions"]["persist_pct"]),
         "sub": "same class in the next bucket"},
        {"label": "session range", "value": f"{lo['spot']:,.0f}–{hi['spot']:,.0f}",
         "sub": f"high {hhmm(minutes(hi['t']))} · low {hhmm(minutes(lo['t']))}"},
        {"label": "band CE OI", "value": f"{band_ce0 / 1e6:,.0f}M → {band_ce1 / 1e6:,.0f}M",
         "sub": f"{sgn(band_ce1 - band_ce0)} across the session"},
        {"label": "band PE OI", "value": f"{band_pe0 / 1e6:,.0f}M → {band_pe1 / 1e6:,.0f}M",
         "sub": f"{sgn(band_pe1 - band_pe0)} across the session"},
        {"label": "busiest bucket", "value": f"{busiest['ce_vol'] + busiest['pe_vol']:,.0f}M",
         "sub": f"contracts at {b_at['s']}–{b_at['e']}"},
        {"label": "band volume (session)", "value": human(vol_ce + vol_pe),
         "sub": f"contract increments · CE {human(vol_ce)} / PE {human(vol_pe)}"},
    ]
    if tape:
        kpis.append({"label": "max pain (close)", "value": f"{tape['max_pain_close']:,.0f}",
                     "sub": f"open {tape['max_pain_open']:,.0f} · tape"})
        kpis.append({"label": "net GEX", "value": f"{tape['gex_open']:,.0f} → {tape['gex_close']:,.0f}",
                     "sub": "tape net_gex · read the sign (negative = short gamma)"})

    windows_meta = [
        {"k": "open", "label": f"{w_open['start']}–{w_open['end']}"},
        {"k": "slide", "label": f"{w_slide['start']}–{w_slide['end']}"},
        {"k": "rip", "label": f"{w_rip['start']}–{w_rip['end']}"},
        {"k": "close", "label": f"{w_close['start']}–{w_close['end']}"},
    ]

    return {
        "windows": {"open": w_open, "rip": w_rip, "slide": w_slide, "close": w_close},
        "window_order": windows_meta,
        "kpis": kpis,
        "cards": cards,
        "pin": {"pe": pin_pe, "ce": pin_ce},
        "extremes": {
            "spot_max": round(float(hi["spot"]), 2), "spot_max_t": hhmm(minutes(hi["t"])),
            "spot_min": round(float(lo["spot"]), 2), "spot_min_t": hhmm(minutes(lo["t"])),
            "biggest_oi_bucket": {
                "i": biggest["i"],
                "label": next(b["s"] for b in buckets if b["i"] == biggest["i"]),
                "ce": biggest["ce_oi"], "pe": biggest["pe_oi"],
            },
            "busiest_bucket": {"i": b_at["i"], "label": b_at["s"],
                               "vol": round(busiest["ce_vol"] + busiest["pe_vol"], 1)},
            "band_ce": [band_ce0, band_ce1], "band_pe": [band_pe0, band_pe1],
            "gap_minutes": gap_min, "frozen_spot": frozen, "tape": tape,
        },
        "events": events_from_windows(buckets, [w_open, w_rip, w_slide, w_close]),
        "gap_note": gap_note(gaps, frozen),
        "method_html": method_html(gaps, frozen, buckets[0]["span_min"], pre_open),
        "caveat_html": caveat_html(),
    }


def window_metric(w: dict[str, Any], frozen: dict[str, Any] | None = None) -> str:
    if frozen and w["end"] >= frozen["from"][:5]:
        spot = f"spot {w['spot0']:,.1f} → stale {frozen['value']:,.2f} from {frozen['from'][:5]}"
    else:
        spot = f"spot {w['spot0']:,.1f} → {w['spot1']:,.1f} ({w['d_spot']:+.1f})"
    return (f"{spot} · CE ΔOI {sgn(w['d_ce_oi'])} · PE ΔOI {sgn(w['d_pe_oi'])} · "
            f"{human(w['volume'])} contracts")


def pin_body(pin_pe: dict[str, Any], pin_ce: dict[str, Any],
             r0: dict[int, list[float]], r1: dict[int, list[float]],
             close_spot: float, tail_label: str) -> str:
    kp, kc = pin_pe["strike"], pin_ce["strike"]
    pe0, pe1 = float(r0[kp][5]), float(r1[kp][5])
    ce0, ce1 = float(r0[kc][2]), float(r1[kc][2])
    pe_itm = kp - close_spot
    ce_otm = kc - close_spot
    return (
        f"{kp:,} PE ran {human(pe0)} → <b>{human(pin_pe['oi_peak'])}</b> at "
        f"{pin_pe['peak_time']} → {human(pe1)}; {kc:,} CE ran {human(ce0)} → "
        f"<b>{human(ce1)}</b>. At {tail_label} (spot {close_spot:,.1f}) the {kp:,} PE finished "
        f"{pe_itm:.1f} pts ITM and the {kc:,} CE {ce_otm:.1f} pts OTM — the OI built up at the strikes "
        f"the book was defending, which is what a pin looks like in the chain. "
        f"<b>On expiry day this is partly settlement, not only positioning</b>: contracts are "
        f"added to hedge a strike that expires the same session, so the level says where the "
        f"book sat, not who intends to stay."
    )


def events_from_windows(buckets: list[dict[str, Any]],
                        windows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen, out = set(), []
    for w in windows:
        i = w["first_i"]
        if i in seen:
            continue
        seen.add(i)
        out.append({"i": i, "t": next(b["s"] for b in buckets if b["i"] == i)})
    return sorted(out, key=lambda e: e["i"])


def longest_frozen(snaps: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Longest run of identical spot prints — a stale upstream quote, not a flat market."""
    best = (0, "", "", 0.0)
    cur, start, n = None, None, 0
    for s in snaps:
        if s["spot"] == cur:
            n += 1
        else:
            if n > best[0]:
                best = (n, start, cur, minutes(s["t"]) - minutes(start))
            cur, start, n = s["spot"], s["t"], 1
    if n > best[0]:
        best = (n, start, cur, minutes(snaps[-1]["t"]) - minutes(start))
    n, start, value, span = best
    if n < 40 or span < 5:
        return None
    return {"prints": n, "from": start[11:19], "to": hhmm(minutes(start) + span),
            "value": value, "minutes": round(span, 1)}


def gap_note(gaps: list[dict[str, Any]], frozen: dict[str, Any] | None) -> str:
    bits = []
    for g in gaps:
        bits.append(f"<b>no chain snapshots {g['from']}–{g['to']}</b> ({g['minutes']:.0f} min) — "
                    f"buckets in that hole are blank, not flat")
    if frozen:
        bits.append(f"spot pinned at {frozen['value']:,.2f} for {frozen['minutes']:.0f} min "
                    f"from {frozen['from'][:5]} — the last buckets' spot is a stale quote")
    return " · ".join(bits)


def method_html(gaps: list[dict[str, Any]], frozen: dict[str, Any] | None,
                first_bucket_min: float, pre_open: dict[str, Any]) -> str:
    parts = [
        f"A bucket is <code>flat</code> when |Δprem| &lt; 1 point and |ΔOI| &lt; 1,000 contracts; "
        f"everything else takes the sign pair of the two deltas. Buckets are {BUCKET_MIN} minutes "
        f"wide, strikes are the {len(BAND)} names from {BAND[0]:,} to {BAND[-1]:,}, and volume is "
        f"the increment of the cumulative volume field between two snapshots — never a sampled level. "
        f"The first bucket is only {first_bucket_min * 60:.0f} s wide (the session starts mid-bucket) and "
        f"the first bucket after an outage is short in the same way.",
        f"Each class is attributed to the bucket it <i>ends</i> in: a cell at 12:45 describes the "
        f"12:40→12:45 change, measured from the prior frame, so no bucket borrows flow from the one "
        f"after it. Deltas are per strike and taken <i>before</i> any moneyness adjustment — an ITM "
        f"and an OTM leg with the same sign pair get the same label, which is why the focus panel "
        f"prints moneyness next to the class.",
    ]
    parts.append(
        f"<b>Chain coverage starts at {CHAIN_FIRST_LABEL}, not 09:15.</b> "
        f"{pre_open['cause']} The opening auction, the first {pre_open['missing_min']:.0f} minutes "
        f"and the overnight-to-open OI change are therefore absent — nothing here is extrapolated "
        f"back to the open."
    )
    if gaps:
        parts.append(
            f"{len(gaps)} recorder outage{'s' if len(gaps) > 1 else ''} — "
            f"{'; '.join(g['from'] + '–' + g['to'] + ', ' + format(g['minutes'], '.0f') + ' min' for g in gaps)} — "
            f"leaves whole buckets with no snapshot pair; those buckets carry no cells, are blank in "
            f"the state map and are excluded from the transition matrix, so a multi-minute jump is "
            f"never counted as one 5-minute step."
        )
    if frozen:
        parts.append(
            f"From {frozen['from']} the chain's spot field repeats {frozen['value']:,.2f} for "
            f"{frozen['prints']} consecutive snapshots ({frozen['minutes']:.0f} min) while option "
            f"prices keep moving: the underlying print is stale, the book is not. Treat that "
            f"window's d_spot as unknown, not as zero — the ATM premium decay in the same window "
            f"is still a real print."
        )
    return " ".join(parts)


def caveat_html() -> str:
    return (
        "<b>Read this as flow, not identity.</b> Premium + OI is an inference: a rising premium "
        "with falling OI is labelled <code>short covering</code> by the standard four-quadrant "
        "convention, but on a put it is equally consistent with a long holder taking profit — the "
        "two are indistinguishable from the aggregate book. The recorder sees one book per strike "
        "at 10-second resolution, so it cannot split client / prop / DII, and a single account can "
        "dominate a strike. Add 0-DTE mechanics: on expiry day OI also falls because positions are "
        "closed or allowed to lapse, so late-session OI collapse is partly expiry, not only "
        "positioning. Use the labels as descriptions of <i>what the book did</i>, never as "
        "“FII bought” or “retail sold”."
    )


# --------------------------------------------------------------------------- #
# HTML
# --------------------------------------------------------------------------- #
HTML_TEMPLATE = r"""
<section data-research-section="participant-flow" id="research-participant-flow">
<style>
#research-participant-flow{
  --pf-bg:#000000; --pf-panel:#13161C; --pf-raised:#1F242D; --pf-border:#2C313B;
  --pf-text:#E8E8E8; --pf-muted:#9B9B9B; --pf-primary:#D9902A;
  --pf-ce:#4F8BFF; --pf-pe:#FF8A3D;
  --pf-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  background:var(--pf-bg); color:var(--pf-text);
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-size:14px; line-height:1.5; padding:22px clamp(12px,2.4vw,32px) 40px;
  border-top:1px solid var(--pf-border);
}
#research-participant-flow *{box-sizing:border-box}
#research-participant-flow .pf-wrap{max-width:1560px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
#research-participant-flow .pf-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between}
#research-participant-flow .pf-eyebrow{font-family:var(--pf-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--pf-primary)}
#research-participant-flow h2{margin:2px 0 4px;font-size:clamp(20px,2.4vw,27px);font-weight:600;letter-spacing:-.01em}
#research-participant-flow .pf-lede{margin:0;max-width:78ch;color:var(--pf-muted);font-size:13px}
#research-participant-flow .pf-src{font-family:var(--pf-mono);font-size:10.5px;color:var(--pf-muted);text-align:right;line-height:1.6}
#research-participant-flow .pf-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:8px}
#research-participant-flow .pf-kpi{background:var(--pf-panel);border:1px solid var(--pf-border);border-radius:6px;padding:9px 11px;min-width:0}
#research-participant-flow .pf-kpi .pf-k-label{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--pf-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#research-participant-flow .pf-kpi .pf-k-val{font-family:var(--pf-mono);font-size:19px;line-height:1.25;margin-top:3px}
#research-participant-flow .pf-kpi .pf-k-sub{font-size:10.5px;color:var(--pf-muted);margin-top:1px}
#research-participant-flow .pf-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:8px}
#research-participant-flow .pf-card{background:var(--pf-panel);border:1px solid var(--pf-border);border-left:2px solid var(--pf-primary);border-radius:6px;padding:11px 13px;display:flex;flex-direction:column;gap:5px;min-width:0}
#research-participant-flow .pf-card.pf-c-open{border-left-color:#2FA36B}
#research-participant-flow .pf-card.pf-c-rip{border-left-color:#E5606A}
#research-participant-flow .pf-card.pf-c-slide{border-left-color:#3B93AD}
#research-participant-flow .pf-card.pf-c-close{border-left-color:#FF8A3D}
#research-participant-flow .pf-card.pf-c-pin{border-left-color:#8E80B8}
#research-participant-flow .pf-card h3{margin:0;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--pf-muted);font-weight:600}
#research-participant-flow .pf-card p{margin:0;font-size:12.5px;color:#D3D7DE}
#research-participant-flow .pf-card b{color:#fff;font-weight:600}
#research-participant-flow .pf-card .pf-metric{font-family:var(--pf-mono);font-size:11px;color:var(--pf-muted)}
#research-participant-flow .pf-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
#research-participant-flow .pf-panel{background:var(--pf-panel);border:1px solid var(--pf-border);border-radius:6px;padding:11px 12px 8px;margin:0;min-width:0;display:flex;flex-direction:column;gap:8px}
#research-participant-flow .pf-col2{grid-column:span 2}
#research-participant-flow .pf-panel figcaption{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;font-size:11px;color:var(--pf-muted)}
#research-participant-flow .pf-panel figcaption .pf-cap-t{font-size:12px;color:var(--pf-text);font-weight:600;letter-spacing:.01em}
#research-participant-flow .pf-panel figcaption .pf-cap-x{font-family:var(--pf-mono);font-size:10px}
#research-participant-flow .pf-chart{position:relative;width:100%;min-width:0}
#research-participant-flow .pf-chart svg{display:block;overflow:visible}
#research-participant-flow .pf-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
#research-participant-flow .pf-seg{display:inline-flex;border:1px solid var(--pf-border);border-radius:4px;overflow:hidden}
#research-participant-flow .pf-seg button{appearance:none;background:transparent;border:0;color:var(--pf-muted);font:inherit;font-size:10.5px;padding:4px 9px;cursor:pointer;border-right:1px solid var(--pf-border)}
#research-participant-flow .pf-seg button:last-child{border-right:0}
#research-participant-flow .pf-seg button[aria-pressed="true"]{background:var(--pf-raised);color:var(--pf-text)}
#research-participant-flow .pf-legend{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:10px;color:var(--pf-muted)}
#research-participant-flow .pf-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
#research-participant-flow .pf-legend i{width:8px;height:8px;border-radius:2px;display:inline-block}
#research-participant-flow table.pf-tbl{width:100%;border-collapse:collapse;font-size:11.5px;table-layout:auto}
#research-participant-flow .pf-tbl-wrap{width:100%;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}
#research-participant-flow table.pf-tbl th{text-align:left;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--pf-muted);font-weight:600;padding:5px 8px;border-bottom:1px solid var(--pf-border);white-space:nowrap}
#research-participant-flow table.pf-tbl td{padding:5px 8px;border-bottom:1px solid #1B1F26;font-family:var(--pf-mono);font-size:11px}
#research-participant-flow table.pf-tbl th.pf-n,#research-participant-flow table.pf-tbl td.pf-n{text-align:right}
#research-participant-flow table.pf-tbl td.pf-dwell{padding:4px 8px;width:46%}
#research-participant-flow .pf-dbar{display:flex;height:7px;border-radius:2px;overflow:hidden;background:#0B0D11}
#research-participant-flow .pf-dbar i{display:block;height:100%}
#research-participant-flow .pf-caveat{background:var(--pf-panel);border:1px solid var(--pf-border);border-left:2px solid var(--pf-primary);border-radius:6px;padding:11px 13px;font-size:11.5px;color:#C9CED6}
#research-participant-flow .pf-caveat b{color:#fff}
#research-participant-flow .pf-caveat code{font-family:var(--pf-mono);font-size:10.5px;color:var(--pf-muted)}
#research-participant-flow .pf-gapnote{font-size:10.5px;color:#D9A45B;font-family:var(--pf-mono)}
#research-participant-flow .pf-empty{font-size:11px;color:var(--pf-muted);padding:8px 0}
#research-participant-flow #pf-tip{position:fixed;left:0;top:0;z-index:80;pointer-events:none;opacity:0;transition:opacity .08s;background:#1F242D;border:1px solid #2C313B;border-radius:4px;padding:6px 8px;font-size:10.5px;line-height:1.45;color:#E8E8E8;max-width:260px;box-shadow:0 8px 24px rgba(0,0,0,.55)}
#research-participant-flow #pf-tip b{color:#fff}
#research-participant-flow #pf-tip .pf-t-m{font-family:var(--pf-mono)}
#research-participant-flow .pf-note{font-size:10px;color:var(--pf-muted);font-family:var(--pf-mono)}
@media (max-width:1099px){
  #research-participant-flow .pf-grid{grid-template-columns:minmax(0,1fr)}
  #research-participant-flow .pf-col2{grid-column:span 1}
  #research-participant-flow .pf-src{text-align:left}
}
@media (max-width:520px){
  #research-participant-flow{padding:16px 12px 32px}
  #research-participant-flow .pf-panel{padding:9px 9px 6px}
  #research-participant-flow .pf-card p{font-size:12px}
  #research-participant-flow .pf-kpi .pf-k-val{font-size:17px}
  #research-participant-flow .pf-ctl .pf-seg{flex-wrap:wrap}
  #research-participant-flow .pf-kpis > .pf-kpi:last-child:nth-child(odd){grid-column:1 / -1}
  #research-participant-flow table.pf-tbl th:nth-child(4),
  #research-participant-flow table.pf-tbl td:nth-child(4){display:none}
}
</style>

<div class="pf-wrap">
  <div class="pf-head">
    <div>
      <div class="pf-eyebrow">research · participant flow</div>
      <h2>Who actually positioned?</h2>
      <p class="pf-lede">Every (strike, side, 5-minute) cell of the 0-DTE chain classified from premium and
        open-interest deltas — long buildup, short buildup, short covering, long unwinding — then read against
        the session's own high, low, open and close.</p>
    </div>
    <div class="pf-src" id="pf-src"></div>
  </div>

  <div class="pf-kpis" id="pf-kpis"></div>
  <div class="pf-cards" id="pf-cards"></div>

  <div class="pf-grid">
    <figure class="pf-panel">
      <figcaption>
        <span class="pf-cap-t">Strike × time × flow — 3D</span>
        <span class="pf-cap-x" id="pf-3d-axis"></span>
        <span class="pf-cap-x">marker colour = buildup class · size = |value|</span>
      </figcaption>
      <div class="pf-ctl">
        <div class="pf-seg" id="pf-3d-seg" role="group" aria-label="3D metric">
          <button type="button" data-metric="vol" aria-pressed="true">incremental volume</button>
          <button type="button" data-metric="oi" aria-pressed="false">OI delta</button>
          <button type="button" data-metric="prem" aria-pressed="false">premium delta</button>
        </div>
        <div class="pf-legend" id="pf-3d-legend"></div>
      </div>
      <div class="pf-chart" id="pf-3d"></div>
    </figure>

    <figure class="pf-panel">
      <figcaption>
        <span class="pf-cap-t">Where the OI activity sat</span>
        <span class="pf-cap-x" id="pf-stream-note">Σ|ΔOI| by class, per 5-min bucket (M contracts)</span>
      </figcaption>
      <div class="pf-chart" id="pf-stream"></div>
    </figure>

    <figure class="pf-panel">
      <figcaption>
        <span class="pf-cap-t">CE vs PE net positioning</span>
        <span class="pf-cap-x">net ΔOI per bucket · line = spot</span>
      </figcaption>
      <div class="pf-chart" id="pf-net"></div>
    </figure>

    <figure class="pf-panel">
      <figcaption>
        <span class="pf-cap-t">Transition matrix</span>
        <span class="pf-cap-x" id="pf-matrix-x"></span>
        <span class="pf-cap-x">LB long buildup · SB short buildup · SC short covering · LU long unwinding · FL flat</span>
      </figcaption>
      <div class="pf-chart" id="pf-matrix"></div>
    </figure>

    <figure class="pf-panel pf-col2">
      <figcaption>
        <span class="pf-cap-t">State map — strike (CE block / PE block) × 5-min bucket</span>
        <span class="pf-cap-x">one cell = the class that bucket's Δpremium + ΔOI produced</span>
        <span class="pf-cap-x pf-gapnote" id="pf-gap-note"></span>
      </figcaption>
      <div class="pf-legend" id="pf-heat-legend"></div>
      <div class="pf-chart" id="pf-heat"></div>
    </figure>

    <figure class="pf-panel pf-col2">
      <figcaption>
        <span class="pf-cap-t">Divergence — CE vs PE at the same strike</span>
        <span class="pf-cap-x" id="pf-div-x"></span>
      </figcaption>
      <div class="pf-ctl" id="pf-div-seg"></div>
      <div class="pf-chart" id="pf-div"></div>
    </figure>

    <figure class="pf-panel pf-col2">
      <figcaption>
        <span class="pf-cap-t">Focus strikes — premium, OI, and the class the bucket produced</span>
        <span class="pf-cap-x" id="pf-focus-x"></span>
      </figcaption>
      <div class="pf-chart" id="pf-focus"></div>
    </figure>

    <figure class="pf-panel pf-col2">
      <figcaption>
        <span class="pf-cap-t">Top strikes by classification transitions</span>
        <span class="pf-cap-x" id="pf-switch-x"></span>
      </figcaption>
      <div class="pf-tbl-wrap"><table class="pf-tbl" id="pf-switch"></table></div>
    </figure>
  </div>

  <div class="pf-caveat" id="pf-caveat"></div>
</div>

<div id="pf-tip" role="status" aria-live="polite"></div>

<script>
(function () {
  "use strict";
  var D = __PF_DATA__;
  var CLASSES = D.classes;
  var NB = D.buckets.length;
  var B = D.buckets;
  var fmt = new Intl.NumberFormat("en-IN");
  var C = {
    bg: "#000000", panel: "#13161C", raised: "#1F242D", border: "#2C313B",
    text: "#E8E8E8", muted: "#9B9B9B", grid: "#232830",
    ce: "#4F8BFF", pe: "#FF8A3D", primary: "#D9902A"
  };
  var MONO = 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace';

  function bAt(i) { return B[i - 1]; }
  function mC(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(0) + "k";
    return String(Math.round(v));
  }
  function sgn(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + mC(Math.abs(v)); }
  function pct(v) { return v.toFixed(1) + "%"; }
  function spotFmt(v) {
    return v.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  // ---------------------------------------------------------------- tooltip
  var tip = document.getElementById("pf-tip");
  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.style.opacity = "1";
    var r = tip.getBoundingClientRect();
    var x = evt.clientX + 14, y = evt.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - 14;
    tip.style.transform = "translate(" + Math.max(4, x) + "px," + Math.max(4, y) + "px)";
  }
  function hideTip() { tip.style.opacity = "0"; }

  // ------------------------------------------------------------------ frame
  function frame(el, height) {
    el.innerHTML = "";
    var w = Math.max(260, Math.floor(el.clientWidth || 600));
    var fig = el.closest ? el.closest("figure") : null;
    var cap = fig ? fig.querySelector(".pf-cap-t") : null;
    var svg = d3.select(el).append("svg")
      .attr("width", w).attr("height", height)
      .attr("viewBox", "0 0 " + w + " " + height)
      .attr("role", "img")
      .attr("aria-label", cap ? cap.textContent : "participant flow chart");
    el.style.height = height + "px";
    return { svg: svg, w: w, h: height };
  }
  function tickIdx(w) {
    var step = w < 520 ? 12 : w < 860 ? 12 : 6;
    var out = [];
    for (var i = step; i <= NB; i += step) out.push(i);
    return out;
  }
  function xAxis(g, x, w, y, labelEvery) {
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y).attr("y2", y)
      .attr("stroke", C.border);
    g.selectAll("text.pf-xtick").data(labelEvery).join("text")
      .attr("class", "pf-xtick")
      .attr("x", function (d) { return x(d); }).attr("y", y + 13)
      .attr("text-anchor", "middle").attr("fill", C.muted)
      .attr("font-size", 9).attr("font-family", MONO)
      .text(function (d) { return bAt(d).e; });
  }
  var EVENTS = D.findings.events || [];
  function eventRules(g, x, h, opts) {
    opts = opts || {};
    var show = opts.labels !== false;
    var sel = g.selectAll("g.pf-ev").data(EVENTS).join("g").attr("class", "pf-ev");
    sel.append("line").attr("x1", function (d) { return x(d.i); })
      .attr("x2", function (d) { return x(d.i); })
      .attr("y1", 0).attr("y2", h)
      .attr("stroke", "#3A4150").attr("stroke-dasharray", "2 4");
    if (show) {
      var evs = opts.pick
        ? EVENTS.filter(function (e, i) { return opts.pick.indexOf(i) >= 0; })
        : EVENTS;
      sel.filter(function (d) { return evs.indexOf(d) >= 0; })
        .append("text").attr("x", function (d) { return x(d.i); }).attr("y", -4)
        .attr("text-anchor", function (d) {
          var px = x(d.i);
          return px < 16 ? "start" : px > x.range()[1] - 20 ? "end" : "middle";
        }).attr("fill", C.muted)
        .attr("font-size", 8.5).attr("font-family", MONO)
        .text(function (d) { return d.t; });
    }
  }

  // -------------------------------------------------------------------- kpis
  function renderKpis() {
    var host = document.getElementById("pf-kpis");
    host.innerHTML = D.findings.kpis.map(function (k) {
      return '<div class="pf-kpi"><div class="pf-k-label">' + k.label + "</div>" +
        '<div class="pf-k-val">' + k.value + "</div>" +
        '<div class="pf-k-sub">' + k.sub + "</div></div>";
    }).join("");
    document.getElementById("pf-src").innerHTML = D.meta.src_html;
  }

  // ------------------------------------------------------------------- cards
  function renderCards() {
    document.getElementById("pf-cards").innerHTML = D.findings.cards.map(function (c) {
      return '<div class="pf-card pf-c-' + c.cls + '"><h3>' + c.title + "</h3>" +
        '<div class="pf-metric">' + c.metric + "</div>" +
        "<p>" + c.body + "</p></div>";
    }).join("");
  }

  // ---------------------------------------------------------------- 3D (Plotly)
  var METRICS = {
    vol: { axis: "incremental volume (contracts)", get: function (c) { return c[5]; } },
    oi: { axis: "Δ open interest (contracts)", get: function (c) { return c[4]; } },
    prem: { axis: "Δ premium (points)", get: function (c) { return c[3]; } }
  };
  var metric = "vol";

  function draw3d() {
    var host = document.getElementById("pf-3d");
    if (!window.Plotly) {
      host.innerHTML = '<div class="pf-empty">3D view needs Plotly (loaded by the page shell).</div>';
      return;
    }
    var spec = METRICS[metric];
    var w = Math.max(280, Math.floor(host.clientWidth || 600));
    var narrow = w < 560;
    var h = narrow ? 400 : 500;
    var cells = D.cells;
    var maxAbs = 1;
    cells.forEach(function (c) { maxAbs = Math.max(maxAbs, Math.abs(spec.get(c))); });
    var x = [], y = [], z = [], col = [], size = [], txt = [];
    cells.forEach(function (c) {
      var v = spec.get(c);
      var cls = CLASSES[c[6]];
      var b = bAt(c[0]);
      x.push(c[0]); y.push(c[1]); z.push(v);
      col.push(cls.color);
      size.push(3 + 11 * Math.sqrt(Math.abs(v) / maxAbs));
      txt.push("<b>" + fmt.format(c[1]) + " " + (c[2] === 0 ? "CE" : "PE") + "</b> · " + b.s +
        "–" + b.e + "<br>" + cls.label + (c[6] === 4 ? "" : " <span style='color:#9B9B9B'>(" + cls.note + ")</span>") +
        "<br>Δprem " + (c[3] > 0 ? "+" : "") + c[3].toFixed(2) + " pts · ΔOI " + sgn(c[4]) +
        " · Δvol " + sgn(c[5]));
    });
    var ticks = [];
    for (var i = 6; i <= NB; i += 12) ticks.push(i);
    var strikeTicks = D.meta.strike_ticks;
    var trace = {
      type: "scatter3d", mode: "markers",
      x: x, y: y, z: z,
      marker: { size: size, color: col, opacity: 0.82, line: { width: 0 } },
      text: txt, hovertemplate: "%{text}<extra></extra>"
    };
    var layout = {
      height: h, width: w, margin: { l: 0, r: 0, t: 4, b: 0 },
      paper_bgcolor: C.bg, plot_bgcolor: C.bg, showlegend: false,
      font: { color: C.muted, size: 10, family: "Inter,system-ui,sans-serif" },
      hoverlabel: { bgcolor: C.raised, bordercolor: C.border, font: { color: C.text, size: 11 } },
      scene: {
        bgcolor: C.bg,
        aspectmode: "manual",
        aspectratio: narrow ? { x: 1.25, y: 1.0, z: 0.85 } : { x: 2.15, y: 1.0, z: 0.85 },
        camera: { eye: { x: narrow ? 1.9 : 1.5, y: narrow ? -2.35 : -1.95, z: 0.8 } },
        xaxis: {
          title: { text: "session time", font: { size: 10, color: C.muted } },
          tickmode: "array", tickvals: ticks,
          ticktext: ticks.map(function (t) { return bAt(t).e; }),
          gridcolor: C.grid, zerolinecolor: C.grid, color: C.muted,
          tickfont: { size: 9, family: MONO }
        },
        yaxis: {
          title: { text: "strike", font: { size: 10, color: C.muted } },
          tickmode: "array", tickvals: strikeTicks,
          gridcolor: C.grid, zerolinecolor: C.grid, color: C.muted,
          tickfont: { size: narrow ? 8 : 9, family: MONO }
        },
        zaxis: {
          title: { text: narrow ? "" : spec.axis, font: { size: 10, color: C.muted } },
          gridcolor: C.grid, zerolinecolor: "#4A5260", color: C.muted,
          tickfont: { size: narrow ? 8 : 9, family: MONO }, tickformat: "~s"
        }
      }
    };
    Plotly.react(host, [trace], layout, { displayModeBar: false, responsive: true });
    document.getElementById("pf-3d-axis").textContent = spec.axis;
  }

  function render3dLegend() {
    document.getElementById("pf-3d-legend").innerHTML = CLASSES.map(function (c) {
      return '<span><i style="background:' + c.color + '"></i>' + c.label + "</span>";
    }).join("");
    var heat = document.getElementById("pf-heat-legend");
    if (heat) {
      heat.innerHTML = CLASSES.map(function (c) {
        return '<span><i style="background:' + c.color + '"></i>' + c.label + "</span>";
      }).join("");
    }
  }

  function wireSeg() {
    var seg = document.getElementById("pf-3d-seg");
    seg.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-metric]");
      if (!btn) return;
      metric = btn.getAttribute("data-metric");
      Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      draw3d();
    });
  }

  // ------------------------------------------------------------- streamgraph
  function drawStream() {
    var host = document.getElementById("pf-stream");
    var w = Math.max(260, Math.floor(host.clientWidth || 600));
    var h = w < 520 ? 250 : 300;
    var f = frame(host, h);
    var svg = f.svg;
    var m = { l: 34, r: 8, t: 16, b: 22 };
    var iw = Math.max(80, w - m.l - m.r);
    var ih = h - m.t - m.b;
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    var keys = CLASSES.map(function (c) { return c.id; });
    var rows = D.class_totals.map(function (r) {
      var o = { i: r.i };
      keys.forEach(function (k, ci) { o[k] = r.abs_oi[ci]; });
      return o;
    });
    var series = d3.stack().keys(keys).offset(d3.stackOffsetWiggle)
      .order(d3.stackOrderInsideOut)(rows);
    var x = d3.scaleLinear().domain([1, NB]).range([0, iw]);
    var maxY = d3.max(series, function (s) {
      return d3.max(s, function (d) { return d[1]; });
    }) || 1;
    var minY = d3.min(series, function (s) {
      return d3.min(s, function (d) { return d[0]; });
    }) || 0;
    var y = d3.scaleLinear().domain([minY, maxY]).range([ih, 0]);

    var area = d3.area()
      .defined(function (d) { return !bAt(d.data.i).gap; })
      .x(function (d) { return x(d.data.i); })
      .y0(function (d) { return y(d[0]); })
      .y1(function (d) { return y(d[1]); })
      .curve(d3.curveBasis);

    series.forEach(function (s, si) {
      g.append("path").datum(s).attr("d", area)
        .attr("fill", CLASSES[si].color).attr("fill-opacity", 0.78)
        .attr("stroke", "#0B0D11").attr("stroke-width", 0.6);
    });

    eventRules(g, x, ih, w >= 900 ? {} : { pick: [0, EVENTS.length - 1] });
    xAxis(g, x, iw, ih, tickIdx(w));

    var guide = g.append("line").attr("y1", 0).attr("y2", ih)
      .attr("stroke", "#6E7684").attr("stroke-width", 1).attr("opacity", 0);
    var hover = g.append("rect").attr("width", iw).attr("height", ih)
      .attr("fill", "transparent")
      .on("mousemove", function (evt) {
        var mx = d3.pointer(evt, g)[0];
        var i = Math.max(1, Math.min(NB, Math.round(x.invert(mx))));
        guide.attr("opacity", 0.6).attr("x1", x(i)).attr("x2", x(i));
        var row = D.class_totals[i - 1];
        var b = bAt(i);
        var lines = CLASSES.map(function (c, ci) {
          return '<span style="color:' + c.color + '">■</span> ' + c.label + " <span class='pf-t-m'>" +
            row.abs_oi[ci].toFixed(1) + "M</span> <span style='color:#9B9B9B'>(" +
            row.count[ci] + " legs)</span>";
        }).join("<br>");
        showTip(evt, "<b>" + b.s + "–" + b.e + "</b> · spot " + b.spot.toLocaleString("en-IN") +
          (b.gap ? " · <span style='color:#D9A45B'>no chain data</span>" : "") +
          "<br>Σ|ΔOI| total <span class='pf-t-m'>" +
          row.abs_oi.reduce(function (a, v) { return a + v; }, 0).toFixed(1) + "M</span><br>" + lines);
      })
      .on("mouseleave", function () { guide.attr("opacity", 0); hideTip(); });
  }

  // --------------------------------------------------------------- net side
  function drawNet() {
    var host = document.getElementById("pf-net");
    var w = Math.max(260, Math.floor(host.clientWidth || 600));
    var h = w < 520 ? 260 : 310;
    var f = frame(host, h);
    var svg = f.svg;
    var m = { l: w < 520 ? 42 : 36, r: 36, t: 14, b: 22 };
    var iw = Math.max(80, w - m.l - m.r);
    var ih = h - m.t - m.b;
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    var data = D.net_side;
    var x = d3.scaleBand().domain(data.map(function (d) { return d.i; }))
      .range([0, iw]).paddingInner(0.32).paddingOuter(0.05);
    var ext = d3.max(data, function (d) { return Math.max(Math.abs(d.ce_oi), Math.abs(d.pe_oi)); }) || 1;
    var y = d3.scaleLinear().domain([-ext * 1.05, ext * 1.05]).range([ih, 0]);
    var bw = Math.max(1, x.bandwidth() / 2);

    data.forEach(function (d) {
      if (!d.gap) return;
      g.append("rect").attr("x", x(d.i)).attr("y", 0).attr("width", x.bandwidth())
        .attr("height", ih).attr("fill", "#D9A45B").attr("fill-opacity", 0.07);
    });

    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0))
      .attr("stroke", C.border);

    var bars = [{ key: "ce_oi", col: C.ce, off: 0 }, { key: "pe_oi", col: C.pe, off: bw }];
    bars.forEach(function (bar) {
      g.selectAll("rect.pf-" + bar.key).data(data).join("rect")
        .attr("class", "pf-" + bar.key)
        .attr("x", function (d) { return x(d.i) + bar.off; })
        .attr("width", bw)
        .attr("y", function (d) { return d[bar.key] >= 0 ? y(d[bar.key]) : y(0); })
        .attr("height", function (d) { return Math.max(0.6, Math.abs(y(d[bar.key]) - y(0))); })
        .attr("fill", bar.col).attr("fill-opacity", 0.88);
    });

    // spot on a secondary axis
    var sExt = d3.extent(data, function (d) { return d.spot; });
    var sy = d3.scaleLinear().domain([sExt[0] - 8, sExt[1] + 8]).range([ih, 0]);
    g.append("path").datum(data)
      .attr("d", d3.line().defined(function (d) { return !d.gap; })
        .x(function (d) { return x(d.i) + x.bandwidth() / 2; })
        .y(function (d) { return sy(d.spot); }).curve(d3.curveMonotoneX))
      .attr("fill", "none").attr("stroke", "#D8DCE3").attr("stroke-width", 1.1)
      .attr("stroke-opacity", 0.75);

    eventRules(g, function (i) { return x(i) + x.bandwidth() / 2; }, ih, { labels: false });
    yAxisTicks(g, y, -8, iw);
    xAxis(g, function (i) { return x(i) + x.bandwidth() / 2; }, iw, ih, tickIdx(w));

    g.selectAll("rect.pf-hit").data(data).join("rect")
      .attr("class", "pf-hit")
      .attr("x", function (d) { return x(d.i); }).attr("width", x.bandwidth())
      .attr("y", 0).attr("height", ih).attr("fill", "transparent")
      .on("mousemove", function (evt, d) {
        var b = bAt(d.i);
        showTip(evt, "<b>" + b.s + "–" + b.e + "</b> · spot " + b.spot.toLocaleString("en-IN") +
          (d.gap ? "<br><span style='color:#D9A45B'>no chain snapshots in this bucket</span>" : "") +
          "<br><span style='color:" + C.ce + "'>■</span> CE ΔOI <span class='pf-t-m'>" + sgn(d.ce_oi * 1e6) +
          "</span><br><span style='color:" + C.pe + "'>■</span> PE ΔOI <span class='pf-t-m'>" + sgn(d.pe_oi * 1e6) +
          "</span><br>vol CE " + d.ce_vol.toFixed(0) + "M · PE " + d.pe_vol.toFixed(0) + "M");
      })
      .on("mouseleave", hideTip);

    var lg = svg.append("g").attr("transform", "translate(" + (w - m.r - 132) + ",8)");
    [{ c: C.ce, t: "CE ΔOI" }, { c: C.pe, t: "PE ΔOI" }, { c: "#D8DCE3", t: "spot" }]
      .forEach(function (it, i) {
        lg.append("rect").attr("x", i * 46).attr("y", 0).attr("width", 7).attr("height", 7)
          .attr("fill", it.c).attr("rx", 1);
        lg.append("text").attr("x", i * 46 + 10).attr("y", 7).attr("fill", C.muted)
          .attr("font-size", 9).text(it.t);
      });
  }
  function yAxisTicks(g, y, x0, iw) {
    g.selectAll("g.pf-yt").data(y.ticks(4)).join(function (enter) {
      var gg = enter.append("g").attr("class", "pf-yt");
      gg.append("line").attr("x1", x0).attr("x2", iw).attr("stroke", C.grid);
      gg.append("text").attr("x", x0 - 6).attr("text-anchor", "end")
        .attr("font-size", 9).attr("font-family", MONO).attr("fill", C.muted);
      return gg;
    }).attr("transform", function (d) { return "translate(0," + y(d) + ")"; })
      .call(function (gg) {
        gg.select("text").attr("dy", "0.32em").text(function (d) { return d.toFixed(0) + "M"; });
      });
  }

  // ----------------------------------------------------------------- heatmap
  function drawHeat() {
    var host = document.getElementById("pf-heat");
    var w = Math.max(260, Math.floor(host.clientWidth || 600));
    var rowH = w < 520 ? 9 : 11;
    var groupGap = 8;
    var narrow = w < 520;
    var top = 18, bottom = 22, left = narrow ? 40 : 52, right = 8;
    var rowsDef = [];
    D.meta.strikes.slice().reverse().forEach(function (s) { rowsDef.push({ strike: s, side: 0 }); });
    rowsDef.push({ gap: true });
    D.meta.strikes.slice().reverse().forEach(function (s) { rowsDef.push({ strike: s, side: 1 }); });
    var nRows = rowsDef.filter(function (r) { return !r.gap; }).length;
    var h = top + bottom + nRows * rowH + groupGap;
    var f = frame(host, h);
    var svg = f.svg;
    var iw = Math.max(60, w - left - right);
    var cw = iw / NB;
    var g = svg.append("g").attr("transform", "translate(" + left + "," + top + ")");

    var cells = {};
    D.cells.forEach(function (c) { cells[c[0] + "|" + c[1] + "|" + c[2]] = c; });

    var y = 0;
    rowsDef.forEach(function (r) {
      if (r.gap) {
        g.append("line").attr("x1", -left).attr("x2", iw).attr("y1", y + groupGap / 2)
          .attr("y2", y + groupGap / 2).attr("stroke", C.border);
        y += groupGap;
        return;
      }
      r.y = y;
      var lab = narrow
        ? (r.strike % 100 === 0 ? r.strike.toLocaleString("en-IN") : "")
        : (r.side === 0 ? "C " : "P ") + r.strike.toLocaleString("en-IN");
      g.append("text").attr("x", -6).attr("y", y + rowH - 2).attr("text-anchor", "end")
        .attr("fill", r.side === 0 ? C.ce : C.pe).attr("font-size", narrow ? 8 : 9)
        .attr("font-family", MONO).text(lab);
      y += rowH;
    });

    var byRow = [];
    rowsDef.forEach(function (r) {
      if (r.gap) return;
      for (var i = 1; i <= NB; i++) {
        var c = cells[i + "|" + r.strike + "|" + r.side];
        byRow.push({ r: r, i: i, c: c });
      }
    });
    g.selectAll("rect.pf-hc").data(byRow).join("rect")
      .attr("class", "pf-hc")
      .attr("x", function (d) { return (d.i - 1) * cw; })
      .attr("y", function (d) { return d.r.y; })
      .attr("width", Math.max(1, cw - 0.6))
      .attr("height", rowH - 0.8)
      .attr("fill", function (d) { return d.c ? CLASSES[d.c[6]].color : "#0B0D11"; })
      .attr("fill-opacity", function (d) { return d.c ? 0.9 : 0.5; })
      .on("mousemove", function (evt, d) {
        if (!d.c) {
          var bb = bAt(d.i);
          showTip(evt, "<b>" + fmt.format(d.r.strike) + " " + (d.r.side === 0 ? "CE" : "PE") + "</b> · " +
            bb.s + "–" + bb.e + "<br><span style='color:#D9A45B'>no chain snapshot in this bucket</span>");
          return;
        }
        var b = bAt(d.i), cls = CLASSES[d.c[6]];
        showTip(evt, "<b>" + fmt.format(d.r.strike) + " " + (d.r.side === 0 ? "CE" : "PE") + "</b> · " +
          b.s + "–" + b.e + "<br><span style='color:" + cls.color + "'>■</span> " + cls.label +
          "<br>Δprem " + (d.c[3] > 0 ? "+" : "") + d.c[3].toFixed(2) + " pts · ΔOI " + sgn(d.c[4]) +
          " · Δvol " + sgn(d.c[5]));
      })
      .on("mouseleave", hideTip);

    xAxis(g, function (i) { return (i - 0.5) * cw; }, iw, y, tickIdx(w));
  }

  // -------------------------------------------------------------- transition
  function drawMatrix() {
    var host = document.getElementById("pf-matrix");
    var w = Math.max(260, Math.floor(host.clientWidth || 600));
    var h = w < 520 ? 300 : 330;
    var f = frame(host, h);
    var svg = f.svg;
    var m = { l: 74, r: 8, t: 26, b: 26 };
    var iw = Math.max(80, w - m.l - m.r);
    var ih = h - m.t - m.b;
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    var n = CLASSES.length;
    var cw = iw / n, ch = ih / n;
    var matrix = D.transitions.matrix;
    var maxV = d3.max(matrix, function (r) { return d3.max(r); }) || 1;
    var fill = d3.scaleLinear().domain([0, maxV]).range(["#151922", "#3B93AD"]);
    var rowTot = matrix.map(function (r) { return d3.sum(r); });

    for (var a = 0; a < n; a++) {
      for (var b = 0; b < n; b++) {
        var v = matrix[a][b];
        var ai = a, bi = b;
        var gg = g.append("g").attr("transform",
          "translate(" + b * cw + "," + a * ch + ")");
        gg.append("rect")
          .attr("width", Math.max(1, cw - 2)).attr("height", Math.max(1, ch - 2))
          .attr("rx", 2)
          .attr("fill", fill(v))
          .attr("stroke", a === b ? "#8E80B8" : "none")
          .attr("stroke-width", a === b ? 1 : 0);
        gg.append("text").attr("x", cw / 2 - 1).attr("y", ch / 2 - 1)
          .attr("text-anchor", "middle").attr("fill", v / maxV > 0.55 ? "#08110F" : C.text)
          .attr("font-size", 10).attr("font-family", MONO).text(v ? fmt.format(v) : "·");
        var share = rowTot[a] ? (100 * v / rowTot[a]) : 0;
        gg.append("text").attr("x", cw / 2 - 1).attr("y", ch / 2 + 11)
          .attr("text-anchor", "middle")
          .attr("fill", v / maxV > 0.55 ? "#0A1512" : C.muted)
          .attr("font-size", 8.5).attr("font-family", MONO)
          .text(v ? share.toFixed(0) + "%" : "");
        gg.append("rect")
          .attr("width", Math.max(1, cw - 2)).attr("height", Math.max(1, ch - 2))
          .attr("fill", "transparent")
          .on("mousemove", (function (row, col) {
            return function (evt) {
              showTip(evt, "<b>" + CLASSES[row].label + " → " + CLASSES[col].label + "</b><br>" +
                fmt.format(matrix[row][col]) + " transitions · " +
                (rowTot[row] ? (100 * matrix[row][col] / rowTot[row]).toFixed(1) : "0") + "% of the row");
            };
          })(ai, bi))
          .on("mouseleave", hideTip);
      }
    }

    CLASSES.forEach(function (c, i) {
      g.append("text").attr("x", -8).attr("y", i * ch + ch / 2 + 3).attr("text-anchor", "end")
        .attr("fill", C.muted).attr("font-size", 9).text(c.short);
      g.append("text").attr("x", i * cw + cw / 2 - 1).attr("y", -8).attr("text-anchor", "middle")
        .attr("fill", C.muted).attr("font-size", 9).text(c.short);
    });
    g.append("text").attr("x", -m.l + 4).attr("y", -16).attr("fill", C.muted)
      .attr("font-size", 8.5).attr("font-family", MONO).text("state at t ↓   → at t+1");
  }

  // -------------------------------------------------------------- divergence
  var divKey = D.findings.window_order[0].k;
  function drawDiv() {
    var host = document.getElementById("pf-div");
    var win = D.windows[divKey];
    var w = Math.max(260, Math.floor(host.clientWidth || 600));
    var rowH = 30;
    var wide = w >= 560;
    var m = { l: w < 520 ? 48 : 64, r: wide ? 92 : 54, t: 10, b: 22 };
    var h = m.t + m.b + win.divergence.length * rowH;
    var f = frame(host, h);
    var svg = f.svg;
    var iw = Math.max(70, w - m.l - m.r);
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    var ext = d3.max(win.divergence, function (s) {
      return Math.max(Math.abs(s.d_ce_oi), Math.abs(s.d_pe_oi));
    }) || 1;
    var x = d3.scaleLinear().domain([-ext, ext]).range([0, iw]);
    var y = d3.scaleBand().domain(win.divergence.map(function (s) { return s.strike; }))
      .range([0, win.divergence.length * rowH]).paddingInner(0.3);

    g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0)
      .attr("y2", win.divergence.length * rowH).attr("stroke", C.border);

    g.selectAll("text.pf-dst").data(win.divergence).join("text")
      .attr("class", "pf-dst").attr("x", -8)
      .attr("y", function (s) { return y(s.strike) + y.bandwidth() / 2 + 3; })
      .attr("text-anchor", "end").attr("fill", C.muted).attr("font-size", 9.5)
      .attr("font-family", MONO).text(function (s) { return fmt.format(s.strike); });

    var bh = y.bandwidth() / 2 - 0.5;
    [{ key: "d_ce_oi", col: C.ce, off: 0, side: "CE", cls: "ce_class" },
     { key: "d_pe_oi", col: C.pe, off: bh + 1, side: "PE", cls: "pe_class" }]
      .forEach(function (bar) {
        g.selectAll("rect.pf-" + bar.key).data(win.divergence).join("rect")
          .attr("class", "pf-" + bar.key)
          .attr("x", function (s) { return x(Math.min(0, s[bar.key])); })
          .attr("width", function (s) { return Math.max(0.8, Math.abs(x(s[bar.key]) - x(0))); })
          .attr("y", function (s) { return y(s.strike) + bar.off; })
          .attr("height", bh)
          .attr("fill", bar.col).attr("fill-opacity", 0.85);
        g.selectAll("text.pf-lb-" + bar.key).data(win.divergence).join("text")
          .attr("x", function (s) {
            var px = x(s[bar.key]);
            var wide = Math.abs(px - x(0)) > 34;
            if (wide) return s[bar.key] >= 0 ? px - 4 : px + 4;
            return s[bar.key] >= 0 ? px + 4 : px - 4;
          })
          .attr("y", function (s) { return y(s.strike) + bar.off + bh - 2.5; })
          .attr("text-anchor", function (s) {
            var px = x(s[bar.key]);
            var wide = Math.abs(px - x(0)) > 34;
            if (wide) return s[bar.key] >= 0 ? "end" : "start";
            return s[bar.key] >= 0 ? "start" : "end";
          })
          .attr("fill", function (s) {
            var px = x(s[bar.key]);
            return Math.abs(px - x(0)) > 34 ? "#0A0D12" : C.muted;
          })
          .attr("font-size", 8.5).attr("font-family", MONO)
          .text(function (s) { return sgn(s[bar.key]); });
        if (!wide) return;
        g.selectAll("text.pf-cls-" + bar.key).data(win.divergence).join("text")
          .attr("x", iw + 8)
          .attr("text-anchor", "start")
          .attr("y", function (s) { return y(s.strike) + bar.off + bh - 1; })
          .attr("fill", bar.col).attr("font-size", 8).attr("font-family", MONO)
          .attr("fill-opacity", 0.9)
          .text(function (s) {
            var c = CLASSES[CLASSES.findIndex(function (x) { return x.id === s[bar.cls]; })];
            return c.short;
          });
      });

    g.selectAll("rect.pf-dhit").data(win.divergence).join("rect")
      .attr("class", "pf-dhit")
      .attr("x", 0).attr("width", iw)
      .attr("y", function (s) { return y(s.strike); })
      .attr("height", y.bandwidth()).attr("fill", "transparent")
      .on("mousemove", function (evt, s) {
        showTip(evt, "<b>" + fmt.format(s.strike) + "</b> · " + win.label +
          "<br>CE ΔOI " + sgn(s.d_ce_oi) + " · " + s.ce_class +
          "<br>PE ΔOI " + sgn(s.d_pe_oi) + " · " + s.pe_class +
          "<br>CE Δprem " + s.d_ce_prem.toFixed(2) + " · PE Δprem " + s.d_pe_prem.toFixed(2));
      })
      .on("mouseleave", hideTip);

    xAxis(g, function (v) { return x(v); }, iw, win.divergence.length * rowH, []);
    var xt = g.append("g").attr("transform", "translate(0," + (win.divergence.length * rowH) + ")");
    x.ticks(4).filter(function (t) { return x(t) > 14 && x(t) < iw - 14; }).forEach(function (t) {
      xt.append("text").attr("x", x(t)).attr("y", 14).attr("text-anchor", "middle")
        .attr("fill", C.muted).attr("font-size", 8.5).attr("font-family", MONO)
        .text(sgn(t));
    });
    document.getElementById("pf-div-x").textContent =
      win.label + " · spot " + win.spot0.toLocaleString("en-IN") + " → " +
      win.spot1.toLocaleString("en-IN") + " · top 9 by |ΔPE−ΔCE|";
  }

  function wireDiv() {
    var host = document.getElementById("pf-div-seg");
    host.className = "pf-seg";
    host.innerHTML = D.findings.window_order.map(function (o) {
      return '<button type="button" data-w="' + o.k + '" aria-pressed="' +
        (o.k === divKey ? "true" : "false") + '">' + o.label + "</button>";
    }).join("");
    host.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-w]");
      if (!btn) return;
      divKey = btn.getAttribute("data-w");
      Array.prototype.forEach.call(host.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      drawDiv();
    });
  }

  // ------------------------------------------------------------------- focus
  function drawFocus() {
    var host = document.getElementById("pf-focus");
    var w = Math.max(260, Math.floor(host.clientWidth || 600));
    var narrow = w < 520;
    var panelH = narrow ? 132 : 146;
    var gap = 14;
    var padTop = 16;
    var h = padTop + D.focus.length * panelH + (D.focus.length - 1) * gap + 6;
    var f = frame(host, h);
    var svg = f.svg;
    var m = { l: w < 520 ? 34 : 42, r: w < 520 ? 34 : 42 };
    var iw = Math.max(60, w - m.l - m.r);

    D.focus.forEach(function (panel, pi) {
      var top = padTop + pi * (panelH + gap);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + top + ")");
      var ih = panelH - 30;
      var x = d3.scaleLinear().domain([1, NB]).range([0, iw]);
      var prem = panel.series.map(function (s) { return s.prem; });
      var ois = panel.series.map(function (s) { return s.oi; });
      var yp = d3.scaleLinear().domain([0, d3.max(prem) * 1.12 || 1]).range([ih, 0]);
      var yo = d3.scaleLinear().domain([0, d3.max(ois) * 1.15 || 1]).range([ih, 0]);

      g.append("rect").attr("x", 0).attr("y", 0).attr("width", iw).attr("height", ih)
        .attr("fill", "#0F1216");

      g.append("path").datum(panel.series)
        .attr("d", d3.area().x(function (s) { return x(s.i); })
          .y0(ih).y1(function (s) { return yo(s.oi); }).curve(d3.curveMonotoneX))
        .attr("fill", panel.color).attr("fill-opacity", 0.1);

      g.append("path").datum(panel.series)
        .attr("d", d3.line().x(function (s) { return x(s.i); })
          .y(function (s) { return yp(s.prem); }).curve(d3.curveMonotoneX))
        .attr("fill", "none").attr("stroke", panel.color).attr("stroke-width", 1.5);

      // class strip — the bucket's state
      var stripY = ih + 3, stripH = 7;
      g.selectAll("rect.pf-fc").data(panel.series).join("rect")
        .attr("class", "pf-fc")
        .attr("x", function (s) { return x(s.i) - iw / NB / 2; })
        .attr("width", Math.max(1, iw / NB - 0.5))
        .attr("y", stripY).attr("height", stripH)
        .attr("fill", function (s) {
          return CLASSES[CLASSES.findIndex(function (c) { return c.id === s.cls; })].color;
        });

      eventRules(g, x, ih, { labels: !narrow && pi === 0 });
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", ih).attr("y2", ih)
        .attr("stroke", C.border);

      var last = panel.series[panel.series.length - 1];
      g.append("text").attr("x", 0).attr("y", -4).attr("fill", C.text)
        .attr("font-size", 10.5).attr("font-weight", 600)
        .text(fmt.format(panel.strike) + " " + panel.side);
      g.append("text").attr("x", narrow ? 84 : 96).attr("y", -4).attr("fill", panel.color)
        .attr("font-size", 9.5).attr("font-family", MONO)
        .text("ltp " + last.prem.toFixed(2));
      g.append("text").attr("x", narrow ? 146 : 156).attr("y", -4).attr("fill", C.muted)
        .attr("font-size", 9.5).attr("font-family", MONO)
        .text("OI " + mC(last.oi));
      g.selectAll("rect.pf-fhit").data(panel.series).join("rect")
        .attr("class", "pf-fhit")
        .attr("x", function (s) { return x(s.i) - iw / NB / 2; })
        .attr("width", Math.max(2, iw / NB))
        .attr("y", 0).attr("height", ih + 12).attr("fill", "transparent")
        .on("mousemove", function (evt, s) {
          var b = bAt(s.i);
          var cls = CLASSES[CLASSES.findIndex(function (c) { return c.id === s.cls; })];
          showTip(evt, "<b>" + fmt.format(panel.strike) + " " + panel.side + "</b> · " + b.s + "–" + b.e +
            "<br>premium " + s.prem.toFixed(2) + " · spot " + b.spot.toLocaleString("en-IN") +
            "<br>OI " + fmt.format(s.oi) + " · ΔOI " + sgn(s.doi) +
            "<br>moneyness " + (s.moneyness >= 0 ? "+" : "") + s.moneyness.toFixed(1) + " pts " +
            (panel.side === "CE" ? (s.moneyness >= 0 ? "ITM" : "OTM")
                                 : (s.moneyness >= 0 ? "ITM" : "OTM")) +
            "<br><span style='color:" + cls.color + "'>■</span> " + cls.label);
        })
        .on("mouseleave", hideTip);

      xAxis(g, x, iw, ih + stripH + 3, pi === D.focus.length - 1 ? tickIdx(w) : []);
      var yt = [0, d3.max(prem) / 2, d3.max(prem)];
      yt.forEach(function (v) {
        g.append("text").attr("x", -6).attr("y", yp(v) + 3).attr("text-anchor", "end")
          .attr("fill", C.muted).attr("font-size", 8.5).attr("font-family", MONO)
          .text(v.toFixed(0));
      });
    });
    document.getElementById("pf-focus-x").textContent = D.meta.focus_caption;
  }

  // ------------------------------------------------------------------- table
  function renderSwitchTable() {
    var t = D.transitions;
    var head = "<thead><tr><th>strike</th><th class='pf-n'>switches</th>" +
      "<th>dominant</th><th>dwell share (LB / SB / SC / LU / FL)</th></tr></thead>";
    var rows = t.top.map(function (r) {
      var bar = r.dwell.map(function (v, i) {
        return '<i style="width:' + v + "%;background:" + CLASSES[i].color + '"></i>';
      }).join("");
      return "<tr><td>" + fmt.format(r.strike) + "</td>" +
        "<td class='pf-n'>" + r.switches + "</td>" +
        "<td>" + r.dominant + " <span style='color:#9B9B9B'>" + pct(r.dominant_pct) + "</span></td>" +
        "<td class='pf-dwell'><div class='pf-dbar'>" + bar + "</div></td></tr>";
    }).join("");
    document.getElementById("pf-switch").innerHTML = head + "<tbody>" + rows + "</tbody>";
    document.getElementById("pf-matrix-x").textContent =
      fmt.format(t.total) + " per-leg transitions · " + pct(t.persist_pct) + " stay in the same class";
    document.getElementById("pf-switch-x").textContent =
      "state switches across " + fmt.format(t.total) + " per-leg transitions · dwell share per class";
  }

  // --------------------------------------------------------------- resize
  var draws = [drawStream, drawNet, drawHeat, drawMatrix, drawDiv, drawFocus];
  var lastW = 0;
  function renderAll() {
    draws.forEach(function (fn) { try { fn(); } catch (e) { console.error("[pf]", fn.name, e); } });
    try { draw3d(); } catch (e) { console.error("[pf] 3d", e); }
  }

  function boot() {
    renderKpis();
    renderCards();
    render3dLegend();
    wireSeg();
    wireDiv();
    renderSwitchTable();
    document.getElementById("pf-caveat").innerHTML = D.findings.method_html +
      "<br><br>" + D.findings.caveat_html;
    document.getElementById("pf-gap-note").innerHTML = D.findings.gap_note;

    var totals = D.class_totals.map(function (r) {
      return r.abs_oi.reduce(function (a, v) { return a + v; }, 0);
    });
    var mi = totals.indexOf(Math.max.apply(null, totals));
    var note = document.getElementById("pf-stream-note");
    if (note && mi >= 0) {
      note.textContent = "Σ|ΔOI| by class per 5-min bucket · peak " +
        totals[mi].toFixed(0) + "M at " + bAt(mi + 1).s;
    }

    renderAll();

    var t = null;
    window.addEventListener("resize", function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        var w = document.getElementById("research-participant-flow").clientWidth;
        if (Math.abs(w - lastW) < 4) return;
        lastW = w;
        renderAll();
      }, 150);
    });
  }

  if (window.d3 && window.Plotly) {
    boot();
  } else {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (window.d3 && window.Plotly) { clearInterval(timer); boot(); }
      else if (tries > 240) {
        clearInterval(timer);
        if (window.d3) boot();
        else console.warn("[pf] d3 not available");
      }
    }, 50);
  }
})();
</script>
</section>
"""


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def pre_open_cause(session: str, snaps: list[dict[str, Any]]) -> str:
    """Why the chain has no snapshots before its first print — from the recorder's own log."""
    log = ROOT / f"experiments/data/nifty_tape/{session}.gaps.jsonl"
    first = minutes(snaps[0]["t"])
    fails = []
    if log.exists():
        with log.open() as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                g = json.loads(line)
                if minutes(g["t"]) < first:
                    fails.append(g)
    if not fails:
        return "The recorder produced no chain snapshots before then."
    detail = " ".join(str(g.get("detail", "")) for g in fails)
    last_t = max(fails, key=lambda g: g["t"])["t"][11:16]
    if "401" in detail:
        return (f"The recorder's broker token was rejected (HTTP 401) on {len(fails)} consecutive "
                f"fetches until {last_t}, so the feed only starts when it does.")
    return (f"The recorder logged {len(fails)} failed chain fetches until {last_t} "
            f"({fails[-1].get('reason', 'unknown')}).")


def load_tape(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    rows_ = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows_.append(json.loads(line))
    if not rows_:
        return None
    first, last = rows_[0], rows_[-1]
    gex = [float(r["net_gex"]) for r in rows_ if r.get("net_gex") is not None]
    return {
        "rows": len(rows_),
        "first": first["t"][11:16], "last": last["t"][11:16],
        "max_pain_open": float(first.get("max_pain") or 0),
        "max_pain_close": float(last.get("max_pain") or 0),
        "pcr_open": float(first.get("pcr_oi") or 0), "pcr_close": float(last.get("pcr_oi") or 0),
        "gex_open": float(first.get("net_gex") or 0), "gex_close": float(last.get("net_gex") or 0),
        "gex_min": min(gex) if gex else 0.0, "gex_max": max(gex) if gex else 0.0,
        "walls_close": last.get("walls") or {},
    }


def main() -> None:
    global SESSION_START, CLIP_MIN, CLIP_LABEL, BAND, FUTURES, CHAIN_FIRST_LABEL
    args = parse_args()

    session = args.session
    expiry = args.expiry or session
    SESSION_START = datetime.fromisoformat(f"{session}T09:15:00+05:30")
    chain = Path(args.chain) if args.chain else ROOT / f"experiments/data/nifty_chain10s/{session}.jsonl"
    FUTURES = Path(args.futures) if args.futures else ROOT / f"reports/nifty_{session}/data/futures_1m.json"
    tape_path = Path(args.tape) if args.tape else ROOT / f"experiments/data/nifty_tape/{session}.jsonl"
    out_dir = Path(args.out_dir) if args.out_dir else ROOT / f"reports/nifty_{session}/research"

    if not chain.exists():
        raise SystemExit(f"missing chain file: {chain}")
    if args.clip:
        hh, mm = (int(x) for x in args.clip.split(":"))
        CLIP_MIN = minutes(f"{session}T{hh:02d}:{mm:02d}:59.99+05:30")   # include the whole named minute
    else:
        CLIP_MIN = 1e9

    snaps = load_chain(chain, expiry)
    if args.clip is None:
        CLIP_MIN = minutes(snaps[-1]["t"])
    CLIP_LABEL = hhmm(CLIP_MIN)
    CHAIN_FIRST_LABEL = hhmm(minutes(snaps[0]["t"]))
    BAND = pick_band(snaps, args.band_radius)

    built = build(snaps)
    buckets = built["buckets"]
    cells = built["cells"]
    tape = load_tape(tape_path)

    payload: dict[str, Any] = {
        "meta": {
            "section": "participant-flow",
            "session": session,
            "underlying": "NIFTY",
            "expiry": expiry,
            "kind": "0-DTE" if expiry == session else f"expiry {expiry}",
            "bucket_minutes": BUCKET_MIN,
            "chain_first": hhmm(minutes(snaps[0]["t"])),
            "chain_last": hhmm(minutes(snaps[-1]["t"])),
            "snapshots": len(snaps),
            "strikes": BAND,
            "strike_ticks": [BAND[0], BAND[len(BAND) // 4], BAND[len(BAND) // 2],
                             BAND[(3 * len(BAND)) // 4], BAND[-1]],
            "clip": CLIP_LABEL,
            "gaps": built["gaps"],
            "focus_caption": "",
            "src_html": "",
        },
        "classes": CLASSES,
        "buckets": buckets,
        "cells": cells,
        "class_totals": class_totals(cells, len(buckets)),
        "net_side": net_side(cells, buckets),
        "futures": built["futures"],
        "transitions": transitions(cells, buckets),
        "windows": {},
        "focus": [],
    }

    pre_open = {
        "session": session,
        "missing_min": minutes(snaps[0]["t"]),
        "cause": pre_open_cause(session, snaps),
    }
    payload["findings"] = build_findings(payload, snaps, built, tape, pre_open)
    payload["windows"] = payload["findings"]["windows"]

    if built["futures"]:
        fw = fut_window(built["edges"], built["edges"][0], built["edges"][-1])
        payload["findings"]["futures_cross"] = fw
        if fw:
            payload["findings"]["kpis"].append({
                "label": "futures cross-check",
                "value": f"{fw['dp']:+.1f} pts",
                "sub": f"index OI {sgn(fw['doi'])} · {human(fw['vol'])} lots",
            })
    else:
        payload["findings"]["futures_cross"] = None

    # focus legs: the biggest OI additions on each side, plus the close's ATM call
    pin = payload["findings"]["pin"]
    close_spot = buckets[-1]["spot"]
    atm_close = min(BAND, key=lambda k: abs(k - close_spot))
    focus_legs = [(pin["pe"]["strike"], "PE"), (pin["ce"]["strike"], "CE"),
                  (atm_close, "CE")]
    seen = set()
    payload["focus"] = []
    for strike, side in focus_legs:
        if (strike, side) in seen:
            continue
        seen.add((strike, side))
        payload["focus"].append(focus_series(cells, buckets, built["levels"], strike, side))
    payload["meta"]["focus_caption"] = " · ".join(
        f"{f['strike']:,} {f['side']}" for f in payload["focus"])

    n_cells = len(cells)
    payload["meta"]["src_html"] = (
        f"chain10s {payload['meta']['chain_first']}–{payload['meta']['chain_last']} · "
        f"{len(snaps):,} snapshots · {n_cells:,} cells<br>"
        f"{BAND[0]:,}–{BAND[-1]:,} · {BUCKET_MIN}-min buckets · clip {CLIP_LABEL}"
        + (f" · futures unavailable" if not built["futures"] else "")
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / "participant_flow.json"
    out_html = out_dir / "participant_flow.html"
    out_json.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    out_html.write_text(HTML_TEMPLATE.replace("__PF_DATA__",
                                              json.dumps(payload, separators=(",", ":"))),
                        encoding="utf-8")

    f = payload["findings"]
    print(f"session={session} expiry={expiry} clip={CLIP_LABEL} band={BAND[0]}–{BAND[-1]} ({len(BAND)})")
    print(f"snapshots={len(snaps):,} buckets={len(buckets)} gaps={len(built['gaps'])} "
          f"cells={len(cells):,} persist={payload['transitions']['persist_pct']}%")
    print(f"spot {f['extremes']['spot_min']:,.1f}–{f['extremes']['spot_max']:,.1f}")
    for c in f["cards"]:
        print(f"[{c['cls']}] {c['title']} :: {c['metric']}")
    def rel(p: Path) -> Path | str:
        try:
            return p.relative_to(ROOT)
        except ValueError:
            return p

    print(f"wrote {rel(out_json)} ({out_json.stat().st_size / 1024:.0f} KB)")
    print(f"wrote {rel(out_html)} ({out_html.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
