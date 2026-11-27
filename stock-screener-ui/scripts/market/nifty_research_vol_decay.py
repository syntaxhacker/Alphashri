#!/usr/bin/env python3
"""NIFTY 0-DTE premium decay & IV surface research artifact.

Question: did the ATM put/call premium collapse match theta / spot / IV, and did
the IV surface reprice at any point in the recorded window?

Inputs
------
experiments/data/nifty_snapshots/<session>.jsonl   1-min full reports (chain + greeks)

Outputs
-------
reports/nifty_<session>/research/vol_decay.json
reports/nifty_<session>/research/vol_decay.html    fragment: <section data-research-section="vol-decay">

Usage
-----
    python scripts/market/nifty_research_vol_decay.py                       # 2026-11-17 default
    python scripts/market/nifty_research_vol_decay.py --session 2026-10-27 --expiry 2026-10-27

Method notes (the parts that decide the numbers)
------------------------------------------------
* Every premium is priced from the *vendor IV* with our own Black-76/Black-Scholes
  reprice (r=6.5%, q=1.2%, ACT/365, expiry 15:30 IST). That makes the attribution
  self-consistent: theta = reprice at the new T with the old spot and old IV,
  spot = reprice at the new spot with the new T, IV = reprice at the new IV.
  The three buckets telescope into the model price change; whatever is left is the
  print-vs-model wedge, reported as its own bucket instead of being hidden.
* The vendor theta is an *instantaneous* rate. Summing it over the session is shown
  as a separate, deliberately naive line so the reader can see the difference.
* IV is only used where the option still carries >= 2.00 points of premium: below
  that the 0.05 tick grid makes implied vol numerically explode. Those cells are
  masked, never clipped.
* Every anchor / strike / window is derived from the session data. Nothing about
  2026-11-17 survives when another session is passed in.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
from datetime import datetime
from math import erf, exp, log, sqrt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SESSION = "2026-11-17"
SYMBOL = "NIFTY"
EXPIRY = "2026-11-17"
OUT_DIR = ROOT / "reports/nifty_2026-11-17/research"
SNAPSHOTS = ROOT / "experiments/data/nifty_snapshots/2026-11-17.jsonl"
CLIP = "14:07"
ANCHOR = "09:45"

RATE = 0.065
DIV_YIELD = 0.012
SESSION_MINUTES = 375.0
TRADING_DAYS = 252
IV_FLOOR_PREMIUM = 2.00
IV_MIN, IV_MAX = 0.0, 300.0

# Filled by configure() from the data. Kept at module scope because the pure
# builders below read them the same way the original single-session script did.
ATM = 25500
STRIKE_STEP = 50
CONTRACTS: tuple[tuple[int, str], ...] = ()
SURFACE_STRIKES: list[int] = []
PREMIUM_SURFACE_STRIKES: list[int] = []
SMILE_STRIKES: list[int] = []
SMILE_TIMES: tuple[str, ...] = ()
SMILE_CLOSE = "14:07"
RIP_START = "12:00"
RIP_END = "12:05"
MINUTE_LO = 30.0
MINUTE_HI = 292.0
TAPE_START = "09:15"


def _clock_minutes(clock: str) -> float:
    return int(clock[:2]) * 60 + int(clock[3:5]) + (int(clock[6:8]) / 60.0 if len(clock) > 5 else 0.0)


def _minutes_clock(mins: float) -> str:
    m = int(round(mins))
    return f"{m // 60:02d}:{m % 60:02d}"


def configure(session: str, expiry: str | None, out_dir: str | None,
              clip: str | None, anchor: str | None, snapshots: str | None) -> None:
    global SESSION, EXPIRY, OUT_DIR, SNAPSHOTS, CLIP, ANCHOR, TAPE_START
    global ATM, CONTRACTS, SURFACE_STRIKES, PREMIUM_SURFACE_STRIKES, SMILE_STRIKES
    global SMILE_TIMES, SMILE_CLOSE, RIP_START, RIP_END, MINUTE_LO, MINUTE_HI

    SESSION = session
    EXPIRY = expiry or session
    OUT_DIR = Path(out_dir) if out_dir else ROOT / f"reports/nifty_{session}/research"
    SNAPSHOTS = (Path(snapshots) if snapshots
                 else ROOT / f"experiments/data/nifty_snapshots/{session}.jsonl")

    rows = load_snapshots()
    if not rows:
        raise SystemExit(f"no snapshots at {SNAPSHOTS}")

    first_clock = rows[0]["t"][11:16]
    last_clock = rows[-1]["t"][11:16]
    TAPE_START = first_clock

    # The original session deliberately dropped the 09:15 open print (stale quote
    # wedge), so the anchor is the first snapshot at or after 09:45. On sessions
    # whose tape starts later than that, the anchor is the tape start.
    earliest = _minutes_clock(9 * 60 + 45)
    anchor = anchor or max(first_clock, earliest)
    if anchor < first_clock:
        anchor = first_clock
    ANCHOR = anchor
    CLIP = clip or (last_clock if session != "2026-11-17" else "14:07")
    if CLIP > last_clock:
        CLIP = last_clock

    clipped = [row for row in rows if row["t"][11:16] <= CLIP]
    anchor_row = nearest(clipped, ANCHOR)
    spot0 = anchor_row["report"]["spot"]
    ATM = int(round(spot0 / STRIKE_STEP) * STRIKE_STEP)

    CONTRACTS = (
        (ATM, "pe"), (ATM, "ce"),
        (ATM - STRIKE_STEP, "pe"), (ATM - STRIKE_STEP, "ce"),
        (ATM - 2 * STRIKE_STEP, "pe"), (ATM - 2 * STRIKE_STEP, "ce"),
    )
    SURFACE_STRIKES = list(range(ATM - 6 * STRIKE_STEP, ATM + 4 * STRIKE_STEP, STRIKE_STEP))
    PREMIUM_SURFACE_STRIKES = [ATM - 3 * STRIKE_STEP + i * STRIKE_STEP for i in range(6)]
    SMILE_STRIKES = list(range(ATM - 6 * STRIKE_STEP, ATM + 6 * STRIKE_STEP, STRIKE_STEP))

    MINUTE_LO = _clock_minutes(ANCHOR) - (9 * 60 + 15)
    MINUTE_HI = _clock_minutes(CLIP) - (9 * 60 + 15)

    atm_series = [(row["t"][11:16], atm_otm_iv(row["report"])) for row in clipped
                  if quote_sane(row["report"], ATM)]
    atm_series = [(clock, iv) for clock, iv in atm_series if iv is not None]
    rip_start, rip_end = _pick_repricing_window(atm_series)
    RIP_START, RIP_END = rip_start, rip_end
    # The final quote often has no usable OTM IV (both legs below the tick floor).
    # Use the last usable clock for the fourth smile so it is not a 0% panel.
    smile_close = atm_series[-1][0] if atm_series else CLIP
    SMILE_CLOSE = smile_close
    SMILE_TIMES = (ANCHOR, RIP_START, RIP_END, smile_close)


def _pick_repricing_window(series: list[tuple[str, float]]) -> tuple[str, str]:
    cutoff = _minutes_clock(max(_clock_minutes(ANCHOR) + 15, _clock_minutes(CLIP) - 30))
    usable = [(clock, iv) for clock, iv in series if clock <= cutoff]
    if len(usable) < 12:
        mid = _minutes_clock((MINUTE_LO + MINUTE_HI) / 2)
        return mid, _minutes_clock(_clock_minutes(mid) + 5)
    best = (0.0, usable[0][0], usable[min(10, len(usable) - 1)][0])
    for i in range(1, len(usable)):
        end_clock, end_iv = usable[i]
        end_min = _clock_minutes(end_clock)
        # Match by elapsed time, not by observation index: quote-sanity filtering
        # leaves gaps, and ten observations is not ten minutes.
        start = next((j for j in range(i - 1, -1, -1)
                      if 8 <= end_min - _clock_minutes(usable[j][0]) <= 12), None)
        if start is None:
            continue
        change = abs(end_iv - usable[start][1])
        if change > best[0]:
            best = (change, usable[start][0], end_clock)
    return best[1], best[2]


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


def bs_price(spot: float, strike: float, tau: float, vol: float, side: str) -> float:
    if tau <= 1e-9:
        return max(0.0, (spot - strike) if side == "ce" else (strike - spot))
    if vol <= 0:
        fwd = spot * exp(-DIV_YIELD * tau)
        return max(0.0, (fwd - strike * exp(-RATE * tau)) if side == "ce"
                   else (strike * exp(-RATE * tau) - fwd))
    sq = vol * sqrt(tau)
    d1 = (log(spot / strike) + (RATE - DIV_YIELD + 0.5 * vol * vol) * tau) / sq
    d2 = d1 - sq
    if side == "ce":
        return spot * exp(-DIV_YIELD * tau) * _norm_cdf(d1) - strike * exp(-RATE * tau) * _norm_cdf(d2)
    return strike * exp(-RATE * tau) * _norm_cdf(-d2) - spot * exp(-DIV_YIELD * tau) * _norm_cdf(-d1)


def tau_of(iso_ts: str) -> float:
    stamp = datetime.fromisoformat(iso_ts)
    expiry = datetime.fromisoformat(f"{EXPIRY}T15:30:00+05:30")
    return max(0.0, (expiry - stamp).total_seconds()) / (365.0 * 24 * 3600)


def minute_of(iso_ts: str) -> float:
    return (int(iso_ts[11:13]) * 60 + int(iso_ts[14:16])
            + int(iso_ts[17:19]) / 60.0 - (9 * 60 + 15))


def clock_of(iso_ts: str) -> str:
    return iso_ts[11:16]


def intrinsic(spot: float, strike: float, side: str) -> float:
    return max(0.0, spot - strike) if side == "ce" else max(0.0, strike - spot)


def load_snapshots() -> list[dict]:
    rows = []
    with SNAPSHOTS.open() as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def leg(report: dict, strike: float, side: str) -> dict:
    for row in report["strikes"]:
        if row["strike"] == strike:
            return row.get(side) or {}
    return {}


def quote_sane(report: dict, strike: float) -> bool:
    """A last-traded print below intrinsic means the quote is stale, not cheap.

    Late in a 0-DTE session the ITM leg's LTP lags the index by several points,
    which would otherwise manufacture negative time value and an impossible IV.
    """
    spot = report["spot"]
    ce = leg(report, strike, "ce").get("ltp")
    pe = leg(report, strike, "pe").get("ltp")
    if ce is None or pe is None:
        return False
    return ce >= max(0.0, spot - strike) - 0.5 and pe >= max(0.0, strike - spot) - 0.5


def valid_iv(price: float | None, iv: float | None, delta: float | None = None,
             floor: float = IV_FLOOR_PREMIUM) -> float | None:
    """IV is only usable where premium ≥ the tick floor and the option is not deep ITM."""
    if price is None or iv is None:
        return None
    if not (price >= floor):
        return None
    if delta is not None and abs(delta) > 0.88:
        return None
    if not (IV_MIN < iv < IV_MAX):
        return None
    return iv


def nearest(rows: list[dict], clock: str) -> dict:
    target = _clock_minutes(clock)
    best, best_gap = None, 10 ** 9
    for row in rows:
        stamp = clock_of(row["t"])
        gap = abs(_clock_minutes(stamp) - target)
        if gap < best_gap:
            best, best_gap = row, gap
    return best


def frames_5min(rows: list[dict], start: str | None = None, end: str | None = None) -> list[dict]:
    start = start or ANCHOR
    end = end or _minutes_clock(max(_clock_minutes(ANCHOR), _clock_minutes(CLIP) - 5))
    out = []
    for hour in range(9, 16):
        for minute in range(0, 60, 5):
            clock = f"{hour:02d}:{minute:02d}"
            if not (start <= clock <= end):
                continue
            out.append(nearest(rows, clock))
    return out


def atm_otm_iv(report: dict) -> float | None:
    spot = report["spot"]
    ce_iv = pe_iv = None
    for row in report["strikes"]:
        strike = row["strike"]
        node = row.get("ce" if strike >= spot else "pe") or {}
        iv = valid_iv(node.get("ltp"), node.get("iv"), node.get("delta"))
        if iv is None:
            continue
        if strike >= spot and ce_iv is None:
            ce_iv = iv
        elif strike <= spot and (pe_iv is None or strike > pe_iv[0]):
            pe_iv = (strike, iv)
    legs = [v for v in (ce_iv, pe_iv[1] if pe_iv else None) if v is not None]
    return sum(legs) / len(legs) if legs else None


def iv_at_delta(report: dict, sign: int) -> float | None:
    nodes = []
    for row in report["strikes"]:
        side = "ce" if sign > 0 else "pe"
        node = row.get(side) or {}
        delta = node.get("delta")
        iv = valid_iv(node.get("ltp"), node.get("iv"), node.get("delta"))
        if delta is None or iv is None:
            continue
        if 0.08 < abs(delta) < 0.92:
            nodes.append((abs(delta), iv))
    if len(nodes) < 2:
        return None
    nodes.sort()
    target = 0.25
    if not (nodes[0][0] <= target <= nodes[-1][0]):
        return None
    for (d0, v0), (d1, v1) in zip(nodes, nodes[1:]):
        if d0 <= target <= d1 and d1 != d0:
            return v0 + (target - d0) / (d1 - d0) * (v1 - v0)
    return None


def build_iv_surface(frames: list[dict]) -> dict:
    z, atm_ridge, spots, clocks = [], [], [], []
    for frame in frames:
        report = frame["report"]
        spots.append(round(report["spot"], 1))
        clocks.append(clock_of(frame["t"]))
        atm = atm_otm_iv(report)
        atm_ridge.append(round(atm, 2) if atm is not None else None)
        line = []
        for strike in SURFACE_STRIKES:
            side = "ce" if strike >= report["spot"] else "pe"
            node = leg(report, strike, side)
            iv = valid_iv(node.get("ltp"), node.get("iv"), node.get("delta"))
            line.append(round(iv, 2) if iv is not None else None)
        z.append(line)
    return {
        "strikes": SURFACE_STRIKES,
        "clocks": clocks,
        "minutes": [round(minute_of(frame["t"]), 1) for frame in frames],
        "spot": spots,
        "atm_iv": atm_ridge,
        "z": z,
        "cells": len(frames) * len(SURFACE_STRIKES),
        "missing": sum(1 for line in z for value in line if value is None),
    }


def build_premium_surface(frames: list[dict]) -> dict:
    z, spots, clocks = [], [], []
    for frame in frames:
        report = frame["report"]
        spots.append(round(report["spot"], 1))
        clocks.append(clock_of(frame["t"]))
        z.append([round(leg(report, strike, "pe").get("ltp") or 0.0, 2) for strike in PREMIUM_SURFACE_STRIKES])
    return {
        "strikes": PREMIUM_SURFACE_STRIKES,
        "clocks": clocks,
        "minutes": [round(minute_of(frame["t"]), 1) for frame in frames],
        "spot": spots,
        "z": z,
    }


def build_smiles(rows: list[dict]) -> list[dict]:
    out = []
    for clock in SMILE_TIMES:
        frame = nearest(rows, clock)
        report = frame["report"]
        points, otm = [], []
        for row in report["strikes"]:
            strike = row["strike"]
            if not (SMILE_STRIKES[0] <= strike <= SMILE_STRIKES[-1]):
                continue
            ce, pe = row.get("ce") or {}, row.get("pe") or {}
            ce_iv = valid_iv(ce.get("ltp"), ce.get("iv"), ce.get("delta"))
            pe_iv = valid_iv(pe.get("ltp"), pe.get("iv"), pe.get("delta"))
            points.append({
                "k": strike,
                "ce_iv": round(ce_iv, 2) if ce_iv is not None else None,
                "pe_iv": round(pe_iv, 2) if pe_iv is not None else None,
                "ce_px": ce.get("ltp"),
                "pe_px": pe.get("ltp"),
                "ce_delta": ce.get("delta"),
                "pe_delta": pe.get("delta"),
            })
            side = "ce" if strike >= report["spot"] else "pe"
            iv = ce_iv if side == "ce" else pe_iv
            if iv is not None:
                otm.append({"k": strike, "iv": round(iv, 2), "side": side})
        gap_node = leg(report, float(ATM), "ce"), leg(report, float(ATM), "pe")
        gap = None
        if gap_node[0].get("iv") and gap_node[1].get("iv"):
            gap = round(gap_node[0]["iv"] - gap_node[1]["iv"], 2)
        out.append({
            "clock": clock_of(frame["t"]),
            "spot": round(report["spot"], 1),
            "atm_iv": round(atm_otm_iv(report) or 0.0, 2),
            "points": points,
            "otm": otm,
            "gap_atm": gap,
        })
    return out


def contract_path(rows: list[dict], strike: int, side: str, step: int = 2) -> list[dict]:
    path = []
    for idx, row in enumerate(rows):
        node = leg(row["report"], strike, side)
        if not node.get("ltp"):
            continue
        if idx % step and idx != len(rows) - 1:
            continue
        spot = row["report"]["spot"]
        iv = valid_iv(node.get("ltp"), node.get("iv"), node.get("delta"))
        intr = intrinsic(spot, strike, side)
        path.append({
            "t": round(minute_of(row["t"]), 1),
            "clock": clock_of(row["t"]),
            "px": round(node["ltp"], 2),
            "intr": round(intr, 2),
            "iv": round(iv, 2) if iv is not None else None,
            "spot": round(spot, 1),
            "sane": node["ltp"] >= intr - 0.5,
        })
    for point in path:
        point["tv"] = round(point["px"] - point["intr"], 2)
    return path


def frozen_path(rows: list[dict], strike: int, side: str, step: int = 6) -> list[dict]:
    anchor = nearest(rows, ANCHOR)
    spot0 = anchor["report"]["spot"]
    node0 = leg(anchor["report"], strike, side)
    iv0 = (node0.get("iv") or 0.0) / 100.0
    if iv0 <= 0:
        return []
    out = []
    for idx, row in enumerate(rows):
        if idx % step and idx != len(rows) - 1:
            continue
        if clock_of(row["t"]) < ANCHOR:
            continue
        out.append({
            "t": round(minute_of(row["t"]), 1),
            "px": round(bs_price(spot0, strike, tau_of(row["t"]), iv0, side), 2),
        })
    return out


def decompose(path: list[dict], strike: int, side: str) -> dict:
    totals = {"theta": 0.0, "spot": 0.0, "iv": 0.0, "wedge": 0.0, "dp": 0.0, "naive_theta": 0.0}
    for a, b in zip(path, path[1:]):
        if not a["iv"] or not b["iv"]:
            continue
        spot_a, spot_b = a["spot"], b["spot"]
        tau_a, tau_b = tau_of(f"{SESSION}T{_iso(a['clock'])}"), tau_of(f"{SESSION}T{_iso(b['clock'])}")
        vol_a, vol_b = a["iv"] / 100.0, b["iv"] / 100.0
        p0 = bs_price(spot_a, strike, tau_a, vol_a, side)
        p_th = bs_price(spot_a, strike, tau_b, vol_a, side)
        p_sp = bs_price(spot_b, strike, tau_b, vol_a, side)
        p_iv = bs_price(spot_b, strike, tau_b, vol_b, side)
        totals["theta"] += p_th - p0
        totals["spot"] += p_sp - p_th
        totals["iv"] += p_iv - p_sp
        totals["dp"] += b["px"] - a["px"]
        totals["wedge"] += (b["px"] - a["px"]) - (p_iv - p0)
    return totals


def _iso(clock: str) -> str:
    return f"{clock}:00+05:30"


def naive_theta(rows: list[dict], strike: int, side: str, start: str, end: str) -> float:
    seq = [row for row in rows if start <= clock_of(row["t"]) <= end]
    total = 0.0
    for a, b in zip(seq, seq[1:]):
        node = leg(a["report"], strike, side)
        theta = node.get("theta")
        if theta is None:
            continue
        dt_min = minute_of(b["t"]) - minute_of(a["t"])
        total += theta * dt_min / SESSION_MINUTES
    return total


def build_attribution(rows: list[dict]) -> list[dict]:
    windows = ((ANCHOR, CLIP, f"{ANCHOR} → {CLIP}"),
              (RIP_START, RIP_END, f"{RIP_START} → {RIP_END}"))
    out = []
    for start, end, label in windows:
        items = []
        for strike, side in CONTRACTS:
            path = [p for p in contract_path(rows, strike, side, step=1) if start <= p["clock"] <= end]
            usable = [p for p in path if p["iv"] is not None and p["sane"]]
            if len(usable) < 2:
                continue
            covered_to = usable[-1]["clock"]
            parts = decompose(usable, strike, side)
            first, final = usable[0], usable[-1]
            items.append({
                "strike": strike,
                "side": side,
                "label": f"{strike} {side.upper()}",
                "px0": first["px"],
                "px1": final["px"],
                "dp": round(parts["dp"], 2),
                "pct": round(100.0 * (final["px"] - first["px"]) / first["px"], 1) if first["px"] else None,
                "theta": round(parts["theta"], 2),
                "spot": round(parts["spot"], 2),
                "iv": round(parts["iv"], 2),
                "wedge": round(parts["wedge"], 2),
                "naive_theta": round(naive_theta(rows, strike, side, start, end), 2),
                "tv0": round(first["px"] - first["intr"], 2),
                "tv1": round(final["px"] - final["intr"], 2),
                "intr0": first["intr"],
                "intr1": final["intr"],
                "covered_to": covered_to,
                "covered_pct": round(100.0 * len(usable) / len(path), 0) if path else None,
            })
        out.append({"from": start, "to": end, "label": label, "rows": items})
    return out


def build_straddle(rows: list[dict], intraday: list[dict]) -> dict:
    anchor_row = nearest(rows, ANCHOR)
    spot_anchor = anchor_row["report"]["spot"]
    closes = [bar["close"] for bar in intraday if bar["time"][11:16] <= CLIP]
    log_rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0]
    ann = math.sqrt(SESSION_MINUTES * TRADING_DAYS) * 100.0
    points = []
    last_idx = len(rows) - 1
    for idx, row in enumerate(rows):
        if clock_of(row["t"]) < ANCHOR:
            continue
        if idx % 2 and idx != last_idx:
            continue
        report = row["report"]
        spot = report["spot"]
        strike = min((s["strike"] for s in report["strikes"]), key=lambda k: abs(k - spot))
        ce = leg(report, strike, "ce").get("ltp") or 0.0
        pe = leg(report, strike, "pe").get("ltp") or 0.0
        straddle = ce + pe
        sig1 = straddle / 0.7979 if straddle else None
        future = [r["report"]["spot"] for r in rows[idx:]]
        move = abs(future[-1] - spot) if future else None
        excursion = max(max(future) - spot, spot - min(future)) if future else None
        t_min = int(minute_of(row["t"]))
        window = log_rets[max(0, t_min - 30):max(1, t_min)]
        rv = statistics.pstdev(window) * ann if len(window) >= 5 else None
        points.append({
            "t": round(minute_of(row["t"]), 1),
            "clock": clock_of(row["t"]),
            "spot": round(spot, 1),
            "k": strike,
            "straddle": round(straddle, 2),
            "sig1": round(sig1, 1) if sig1 else None,
            "move_end": round(move, 1) if move is not None else None,
            "excursion": round(excursion, 1) if excursion is not None else None,
            "atm_iv": round(atm_otm_iv(report) or 0.0, 2),
            "rv30": round(rv, 2) if rv else None,
        })
    scored = [p for p in points if p["sig1"] and p["excursion"] is not None
              and p["t"] <= MINUTE_HI - 30 and p["clock"] >= ANCHOR]
    scored_beats = [p for p in scored if p["excursion"] > p["sig1"]]
    return {
        "spot_anchor": round(spot_anchor, 1),
        "points": points,
        "session_rv": round(statistics.pstdev(log_rets) * ann, 2) if len(log_rets) > 5 else None,
        "share_realized_beat_sigma": round(100.0 * len(scored_beats) / max(1, len(scored)), 1),
        "mean_excursion_ratio": round(sum(p["excursion"] / p["sig1"] for p in scored) / len(scored), 3) if scored else None,
    }


def build_skew(rows: list[dict]) -> dict:
    fixed_strikes = (ATM, ATM - STRIKE_STEP, ATM - 2 * STRIKE_STEP)
    points, fixed = [], {strike: [] for strike in fixed_strikes}
    for idx, row in enumerate(rows):
        if idx % 3 and idx != len(rows) - 1:
            continue
        report = row["report"]
        ce25 = iv_at_delta(report, 1)
        pe25 = iv_at_delta(report, -1)
        atm_iv = atm_otm_iv(report)
        points.append({
            "t": round(minute_of(row["t"]), 1),
            "clock": clock_of(row["t"]),
            "atm_iv": round(atm_iv, 2) if atm_iv is not None else None,
            "ce25": round(ce25, 2) if ce25 is not None else None,
            "pe25": round(pe25, 2) if pe25 is not None else None,
            "skew": round(ce25 - pe25, 2) if ce25 is not None and pe25 is not None else None,
        })
        for strike in fixed:
            ce = leg(report, strike, "ce")
            pe = leg(report, strike, "pe")
            if ce.get("iv") and pe.get("iv"):
                fixed[strike].append({
                    "t": round(minute_of(row["t"]), 1),
                    "clock": clock_of(row["t"]),
                    "gap": round(ce["iv"] - pe["iv"], 2),
                })
    raw = [p["skew"] for p in points]
    for idx, point in enumerate(points):
        window = [v for v in raw[max(0, idx - 2): idx + 3] if v is not None]
        point["skew_smooth"] = round(statistics.median(window), 2) if window else None
    return {"points": points,
            "fixed": [{"strike": strike, "points": series} for strike, series in fixed.items()]}


def build_payload() -> dict:
    all_rows = load_snapshots()
    rows = [row for row in all_rows if clock_of(row["t"]) <= CLIP]
    intraday = rows[-1]["report"]["intraday"]
    frames = frames_5min(rows)
    surface = build_iv_surface(frames)
    premium_surface = build_premium_surface(frames)
    smiles = build_smiles(rows)
    attribution = build_attribution(rows)

    contracts = []
    for strike, side in CONTRACTS:
        path = contract_path(rows, strike, side)
        trimmed = [p for p in path if p["clock"] >= ANCHOR]
        full = decompose([p for p in trimmed if p["iv"] is not None and p["sane"]], strike, side)
        contracts.append({
            "strike": strike,
            "side": side,
            "label": f"{strike} {side.upper()}",
            "points": path,
            "frozen": frozen_path(rows, strike, side),
            "day": {
                "px0": trimmed[0]["px"] if trimmed else None,
                "px1": trimmed[-1]["px"] if trimmed else None,
                "theta": round(full["theta"], 2), "spot": round(full["spot"], 2),
                "iv": round(full["iv"], 2), "wedge": round(full["wedge"], 2),
            },
        })

    straddle = build_straddle(rows, intraday)
    skew = build_skew(rows)

    day = next(item for item in attribution[0]["rows"]
               if item["strike"] == ATM and item["side"] == "pe")
    rip_spot = nearest(rows, RIP_START)["report"]["spot"]
    rip_strike = int(round(rip_spot / STRIKE_STEP) * STRIKE_STEP)
    rip = next((item for item in attribution[1]["rows"]
                if item["strike"] == rip_strike and item["side"] == "pe"), None)
    if rip is None:
        rip = next((item for item in attribution[1]["rows"] if item["side"] == "pe"), None)
    if rip is None:
        rip = next(item for item in attribution[0]["rows"]
                   if item["strike"] == ATM and item["side"] == "pe")
    atm_series = [p for p in skew["points"] if p["atm_iv"]]
    anchor_iv = next((p["atm_iv"] for p in atm_series if p["clock"] >= ANCHOR), None)
    pre_iv = next((p["atm_iv"] for p in atm_series if p["clock"] >= RIP_START), None)
    post_iv = next((p["atm_iv"] for p in atm_series if p["clock"] >= RIP_END), None)
    late_end = _minutes_clock(min(_clock_minutes(RIP_END) + 45, _clock_minutes(CLIP)))
    peak_row = max(atm_series, key=lambda p: p["atm_iv"]) if atm_series else None
    late_iv = peak_row["atm_iv"] if peak_row else None
    peak_iv_clock = peak_row["clock"] if peak_row else None
    skew_am = next((p["skew_smooth"] for p in skew["points"]
                    if p["clock"] >= _minutes_clock(_clock_minutes(ANCHOR) + 30) and p["skew_smooth"] is not None), None)
    skew_pm = next((p["skew_smooth"] for p in skew["points"]
                    if p["clock"] >= RIP_END and p["skew_smooth"] is not None), None)
    skew_valid = [p for p in skew["points"] if p["skew_smooth"] is not None]
    last = skew_valid[-1] if skew_valid else skew["points"][-1]
    gap_smiles = [s for s in smiles if s["gap_atm"] is not None]
    gap_atm = gap_smiles[-1]["gap_atm"] if gap_smiles else None
    gap_clock = gap_smiles[-1]["clock"] if gap_smiles else None

    def surface_iv(strike: int, clock: str):
        if strike not in surface["strikes"]:
            return None
        col = surface["strikes"].index(strike)
        row = surface["clocks"].index(clock) if clock in surface["clocks"] else None
        return surface["z"][row][col] if row is not None else None

    def surface_series(strike: int) -> list[float]:
        col = surface["strikes"].index(strike)
        return [row[col] for row in surface["z"] if row[col] is not None]

    wing_low, wing_high = ATM - 6 * STRIKE_STEP, ATM + 2 * STRIKE_STEP
    smile_lift = {}
    for strike in (wing_low, wing_high):
        series = surface_series(strike)
        smile_lift[str(strike)] = {
            "open": surface_iv(strike, ANCHOR),
            "peak": max(series) if series else None,
            "last": series[-1] if series else None,
        }

    iv_report = (rows[-1]["report"].get("iv_surface") or {}).get("atm") or {}
    if iv_report:
        reported_atm = {
            "open": round(((rows[0]["report"].get("iv_surface") or {}).get("atm") or {}).get("avg_iv") or 0.0, 2),
            "last": round(iv_report.get("avg_iv") or 0.0, 2),
            "legs_last": {"ce": iv_report.get("ce_iv"), "pe": iv_report.get("pe_iv")},
            "derived": False,
        }
    else:
        last_iv_row = nearest(rows, SMILE_CLOSE)
        reported_atm = {
            "open": anchor_iv,
            "last": atm_otm_iv(last_iv_row["report"]),
            "legs_last": {
                "ce": valid_iv(leg(last_iv_row["report"], ATM, "ce").get("ltp"),
                               leg(last_iv_row["report"], ATM, "ce").get("iv")),
                "pe": valid_iv(leg(last_iv_row["report"], ATM, "pe").get("ltp"),
                               leg(last_iv_row["report"], ATM, "pe").get("iv")),
            },
            "derived": True,
        }

    payload = {
        "meta": {
            "session": SESSION, "symbol": SYMBOL, "expiry": EXPIRY, "clip": CLIP,
            "anchor": ANCHOR, "tape_start": TAPE_START, "atm": ATM,
            "smile_close": SMILE_CLOSE,
            "strike_lo": SMILE_STRIKES[0], "strike_hi": SMILE_STRIKES[-1],
            "minute_lo": MINUTE_LO, "minute_hi": MINUTE_HI,
            "rip_window": [RIP_START, RIP_END],
            "snapshots": len(rows), "frames": len(frames),
            "snapshot_gap_median_s": round(statistics.median(
                (datetime.fromisoformat(b["t"]) - datetime.fromisoformat(a["t"])).total_seconds()
                for a, b in zip(rows, rows[1:])), 1),
            "source": str(SNAPSHOTS.relative_to(ROOT)),
            "has_iv_surface_block": bool(iv_report),
            "empty_in_window": sum(1 for row in rows if not any(
                (s.get("ce") or {}).get("ltp") for s in row["report"].get("strikes", []))),
        },
        "headline": {
            "day": day,
            "rip": rip,
            "atm_iv": {"anchor": anchor_iv, "settled": anchor_iv,
                       "pre_rip": pre_iv, "post_rip": post_iv, "peak": late_iv,
                       "peak_clock": peak_iv_clock,
                       "first": atm_series[0]["atm_iv"] if atm_series else None,
                       "last": atm_series[-1]["atm_iv"] if atm_series else None,
                       "last_clock": atm_series[-1]["clock"] if atm_series else None},
            "skew": {"am": skew_am, "pm": skew_pm, "last": last.get("skew_smooth"),
                     "last_clock": last.get("clock"),
                     "ce25_last": last["ce25"], "pe25_last": last["pe25"]},
            "gap_atm_last": gap_atm,
            "gap_atm_clock": gap_clock,
            "smile_lift": smile_lift,
            "reported_atm": reported_atm,
            "session_rv": straddle["session_rv"],
            "share_realized_beat_sigma": straddle["share_realized_beat_sigma"],
            "straddle_anchor": next((p["sig1"] for p in straddle["points"] if p["clock"] >= ANCHOR), None),
        },
        "iv_surface": surface,
        "premium_surface": premium_surface,
        "smiles": smiles,
        "contracts": contracts,
        "attribution": attribution,
        "straddle": straddle,
        "skew": skew,
    }
    return payload


def fmt(value, digits: int = 1, dash: str = "—") -> str:
    if value is None:
        return dash
    return f"{value:,.{digits}f}"


def signed(value, digits: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value:+,.{digits}f}"


def pct(part, whole) -> float:
    return 100.0 * part / whole if whole else 0.0


def render_html(payload: dict) -> str:
    meta = payload["meta"]
    day = payload["headline"]["day"]
    rip = payload["headline"]["rip"]
    atm = payload["headline"]["atm_iv"]
    skew = payload["headline"]["skew"]
    contracts = {f"{c['strike']}-{c['side']}": c for c in payload["contracts"]}
    atm_contract = contracts[f"{ATM}-pe"]
    surface = payload["iv_surface"]
    wings = payload["headline"]["smile_lift"]
    wing_low, wing_high = sorted(wings.keys(), key=lambda k: int(k))

    share = {key: pct(abs(day[key]), abs(day["spot"]) + abs(day["theta"]) + abs(day["iv"]) + abs(day["wedge"]))
             for key in ("spot", "theta", "iv", "wedge")}
    tv_pct = 100.0 * (day["tv1"] - day["tv0"]) / day["tv0"] if day["tv0"] else None
    frozen = atm_contract["frozen"]
    frozen_move = frozen[0]["px"] - frozen[-1]["px"] if frozen else None
    max_wedge = max(abs(row["wedge"]) for row in payload["attribution"][0]["rows"])
    smile0 = payload["smiles"][0]
    rip_smile = payload["smiles"][2]
    close_smile = payload["smiles"][3]
    close_clock = close_smile["clock"]
    _s_pre = {p["k"]: p["iv"] for p in payload["smiles"][1]["otm"]}
    _s_post = {p["k"]: p["iv"] for p in rip_smile["otm"]}
    _s_anchor = {p["k"]: p["iv"] for p in smile0["otm"]}
    _s_close = {p["k"]: p["iv"] for p in close_smile["otm"]}
    wing_step = ((_s_post.get(wing_low) or 0) - (_s_pre.get(wing_low) or 0)) if wing_low in _s_post and wing_low in _s_pre else None
    body_step = ((_s_post.get(ATM - STRIKE_STEP) or 0) - (_s_pre.get(ATM - STRIKE_STEP) or 0)) if (ATM - STRIKE_STEP) in _s_post and (ATM - STRIKE_STEP) in _s_pre else None
    call_lift = ((_s_close.get(wing_high) or 0) - (_s_anchor.get(wing_high) or 0)) if wing_high in _s_close and wing_high in _s_anchor else None
    put_lift = ((_s_close.get(ATM - STRIKE_STEP) or 0) - (_s_anchor.get(ATM - STRIKE_STEP) or 0)) if (ATM - STRIKE_STEP) in _s_close and (ATM - STRIKE_STEP) in _s_anchor else None

    def pair_txt(a, b):
        return f"{fmt(a, 1)} → {fmt(b, 1)}" if a is not None and b is not None else None

    left_txt = pair_txt(_s_pre.get(wing_low), _s_post.get(wing_low))
    body_txt = pair_txt(_s_pre.get(ATM - STRIKE_STEP), _s_post.get(ATM - STRIKE_STEP))
    left_clause = f", the {wing_low} wing {left_txt}" if left_txt else ""
    body_clause = f" and the {ATM - STRIKE_STEP} body {body_txt}" if body_txt else ""
    call_clause = (f"the {wing_high} call wing gains <b>{fmt(call_lift, 1)}</b>"
                   if call_lift is not None else "the call wing has no usable IV at both ends")
    put_clause = (f"the {ATM - STRIKE_STEP} body changes {fmt(put_lift, 1)}"
                  if put_lift is not None else "the body has no usable IV at both ends")
    gap_txt = (f"{fmt(payload['headline']['gap_atm_last'], 1)} vol points"
               if payload['headline']['gap_atm_last'] is not None else "not measurable at the last usable clock")
    wing_vals = [wings[wing_low]["open"], wings[wing_low]["peak"],
                 wings[wing_high]["open"], wings[wing_high]["peak"]]
    if all(v is not None for v in wing_vals):
        wing_note = (f"the {wing_low} wing goes {fmt(wing_vals[0], 1)} → {fmt(wing_vals[1], 1)} and the "
                     f"{wing_high} wing {fmt(wing_vals[2], 1)} → {fmt(wing_vals[3], 1)}")
    else:
        wing_note = "one or both wings fall below the ₹2 premium floor at an end of the window, so their IV is masked"
    shape_txt = (f"<b>{wing_low}</b> went {fmt(wing_vals[0], 1)} → {fmt(wing_vals[1], 1)} and "
                 f"<b>{wing_high}</b> {fmt(wing_vals[2], 1)} → {fmt(wing_vals[3], 1)}"
                 if all(v is not None for v in wing_vals)
                 else "the wings did not carry a usable IV at both ends, so only the ATM level is quoted")
    shape_sentence = (f"<b>Shape</b> moved more than the level — {shape_txt}."
                      if all(v is not None for v in wing_vals)
                      else f"<b>Shape</b> could not be compared — {shape_txt}.")
    reported_atm = payload["headline"].get("reported_atm", {})
    straddle_last = payload["straddle"]["points"][-1]
    straddle_peak = max((p["excursion"] for p in payload["straddle"]["points"]
                         if p["clock"] >= ANCHOR and p["excursion"] is not None), default=None)
    late_end = _minutes_clock(min(_clock_minutes(RIP_END) + 45, _clock_minutes(CLIP)))
    peak_clock = atm.get("peak_clock") or late_end
    max_tv = max((pt["tv"] for pt in atm_contract["points"] if pt["clock"] >= ANCHOR), default=None)

    kpis = [
        (f"{ATM} PE · {ANCHOR} → {day['covered_to']}",
         f"{fmt(day['px0'], 2)} → {fmt(day['px1'], 2)}",
         f"{signed(day['pct'])}%  (Δ {signed(day['dp'], 2)} pts)", "neg"),
        ("Split of that move", f"spot {signed(day['spot'])}",
         f"θ {signed(day['theta'])} · IV {signed(day['iv'])} · wedge {signed(day['wedge'])}", ""),
        ("Σ vendor θ vs priced θ", f"{signed(day['naive_theta'])} vs {signed(day['theta'])}",
         f"{abs(day['naive_theta'] / day['theta']):.1f}× overstatement" if day["theta"] else "θ too small to ratio", "neg"),
        ("ATM IV (nearest OTM)", f"{fmt(atm['settled'], 2)} → {fmt(atm['last'], 2)}",
         f"{RIP_START} {fmt(atm['pre_rip'], 2)} → {fmt(atm['post_rip'], 2)} at {RIP_END}", ""),
        ("25Δ call − put skew", f"{signed(skew['last'], 2)} vp",
         f"{ANCHOR} {signed(skew['am'], 2)} → {RIP_END} {signed(skew['pm'], 2)}", ""),
        ("Session RV vs IV", f"{fmt(payload['headline']['session_rv'], 2)}% vs {fmt(atm['last'], 2)}%",
         f"excursion inside 1σ {fmt(100 - payload['headline']['share_realized_beat_sigma'], 0)}% of tape", ""),
    ]
    kpi_html = "\n".join(
        f'<div class="vd-kpi"><div class="vd-kpi-label">{label}</div>'
        f'<div class="vd-kpi-value {cls}">{value}</div>'
        f'<div class="vd-kpi-delta">{delta}</div></div>'
        for label, value, delta, cls in kpis
    )

    contract_rows = ""
    for strike in (ATM, ATM - STRIKE_STEP, ATM - 2 * STRIKE_STEP):
        for side in ("pe", "ce"):
            row = next((r for r in payload["attribution"][0]["rows"]
                        if r["strike"] == strike and r["side"] == side), None)
            if row is None:
                continue
            cls = "vd-neg" if row["dp"] < 0 else "vd-pos"
            contract_rows += (
                f"<tr><td class='vd-cell-name'>{row['label']}</td>"
                f"<td class='vd-num'>{fmt(row['px0'], 2)}</td>"
                f"<td class='vd-num'>{fmt(row['px1'], 2)}</td>"
                f"<td class='vd-num {cls}'>{signed(row['dp'], 2)}</td>"
                f"<td class='vd-num {cls}'>{signed(row['pct'])}%</td>"
                f"<td class='vd-num'>{signed(row['intr1'] - row['intr0'], 2)}</td>"
                f"<td class='vd-num'>{signed(row['tv0'])} → {signed(row['tv1'])}</td>"
                f"<td class='vd-num'>{signed(row['spot'], 2)}</td>"
                f"<td class='vd-num'>{signed(row['theta'], 2)}</td>"
                f"<td class='vd-num'>{signed(row['iv'], 2)}</td>"
                f"<td class='vd-num vd-muted'>{signed(row['naive_theta'], 2)}</td></tr>\n"
            )

    data_json = json.dumps(payload, separators=(",", ":")).replace("</", "<\\/")
    thin = f"spot explained {share['spot']:.0f}% of it"
    iv_tag = "ATM IV" if meta["has_iv_surface_block"] else "ATM IV (derived from legs)"
    tape_note = ("" if meta["tape_start"] <= "09:20"
                 else f" The recording starts at <b>{meta['tape_start']}</b>, so the open is not in this page.")

    return f"""<section data-research-section="vol-decay" id="research-vol-decay">
<style>
#research-vol-decay {{
  --vd-bg: #000000; --vd-surface: #13161C; --vd-raised: #1F242D; --vd-border: #2C313B;
  --vd-text: #E8E8E8; --vd-muted: #9B9B9B; --vd-amber: #D9902A; --vd-ce: #4F8BFF;
  --vd-pe: #FF8A3D; --vd-pos: #2FA36B; --vd-neg: #E5606A; --vd-iv: #A98BFF;
  --vd-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --vd-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  display: block; background: var(--vd-bg); color: var(--vd-text);
  font: 13px/1.55 var(--vd-sans); -webkit-font-smoothing: antialiased;
  padding: 20px clamp(10px, 2vw, 26px) 40px; overflow-x: hidden; box-sizing: border-box;
}}
#research-vol-decay *, #research-vol-decay *::before, #research-vol-decay *::after {{ box-sizing: border-box; }}
#research-vol-decay .vd-wrap {{ max-width: 1560px; margin: 0 auto; min-width: 0; }}
#research-vol-decay .vd-kicker {{
  color: var(--vd-amber); font: 600 10px/1.2 var(--vd-mono); letter-spacing: .14em;
  text-transform: uppercase; margin-bottom: 8px;
}}
#research-vol-decay h2 {{ font-size: clamp(20px, 2.2vw, 27px); line-height: 1.16; margin: 0 0 8px; letter-spacing: -.02em; }}
#research-vol-decay h2 .vd-thin {{ color: var(--vd-muted); font-weight: 400; }}
#research-vol-decay .vd-sub {{ color: var(--vd-muted); font-size: 12.5px; margin: 0 0 6px; max-width: 1000px; }}
#research-vol-decay .vd-sub b {{ color: var(--vd-text); font-weight: 600; }}
#research-vol-decay .vd-stamp {{ font: 11px/1.6 var(--vd-mono); color: var(--vd-muted); margin-top: 8px; }}
#research-vol-decay .vd-lim {{
  margin: 10px 0 0; padding: 7px 10px; border: 1px solid rgba(217,144,42,.45);
  border-left: 2px solid var(--vd-amber); border-radius: 4px; background: rgba(217,144,42,.07);
  color: var(--vd-muted); font-size: 11px; line-height: 1.5;
}}
#research-vol-decay .vd-lim b {{ color: var(--vd-text); }}
#research-vol-decay .vd-kpis {{
  display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1px;
  background: var(--vd-border); border: 1px solid var(--vd-border);
  border-radius: 8px; overflow: hidden; margin: 16px 0 18px;
}}
#research-vol-decay .vd-kpi {{ background: var(--vd-surface); padding: 10px 12px; min-width: 0; }}
#research-vol-decay .vd-kpi-label {{
  color: var(--vd-muted); font: 600 9px/1.25 var(--vd-mono); letter-spacing: .08em;
  text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}}
#research-vol-decay .vd-kpi-value {{ font: 600 17px/1.3 var(--vd-mono); margin-top: 5px; white-space: nowrap; }}
#research-vol-decay .vd-kpi-delta {{
  font: 11px/1.35 var(--vd-mono); color: var(--vd-muted); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}}
#research-vol-decay .vd-pos {{ color: var(--vd-pos); }}
#research-vol-decay .vd-neg {{ color: var(--vd-neg); }}
#research-vol-decay .vd-grid {{
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px; align-items: start;
}}
#research-vol-decay .vd-card {{
  background: var(--vd-surface); border: 1px solid var(--vd-border); border-radius: 8px;
  padding: 12px 14px 10px; margin: 0; min-width: 0; overflow: hidden;
}}
#research-vol-decay .vd-span2 {{ grid-column: span 2; }}
#research-vol-decay .vd-card-head {{
  display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between;
  gap: 6px 12px; margin-bottom: 6px;
}}
#research-vol-decay .vd-card h3 {{
  font-size: 12.5px; margin: 0; letter-spacing: -.01em; font-weight: 600;
}}
#research-vol-decay .vd-card .vd-hint {{ font: 10px/1.4 var(--vd-mono); color: var(--vd-muted); }}
#research-vol-decay .vd-chart {{ width: 100%; min-width: 0; overflow: hidden; }}
#research-vol-decay .vd-chart svg {{ display: block; width: 100%; height: auto; overflow: visible; }}
#research-vol-decay .vd-note {{
  color: var(--vd-muted); font-size: 11px; line-height: 1.5; margin: 8px 0 0;
  border-top: 1px solid var(--vd-border); padding-top: 7px;
}}
#research-vol-decay .vd-note b {{ color: var(--vd-text); font-weight: 600; }}
#research-vol-decay .vd-legend {{
  display: flex; flex-wrap: wrap; gap: 4px 14px; font: 10px/1.4 var(--vd-mono);
  color: var(--vd-muted); margin: 4px 0 2px;
}}
#research-vol-decay .vd-legend i {{
  display: inline-block; width: 9px; height: 9px; border-radius: 2px;
  margin-right: 5px; vertical-align: -1px;
}}
#research-vol-decay table.vd-table {{
  width: 100%; border-collapse: collapse; font: 11px/1.4 var(--vd-mono);
  margin-top: 4px; table-layout: auto;
}}
#research-vol-decay table.vd-table th {{
  text-align: right; font-weight: 600; color: var(--vd-muted); font-size: 9px;
  letter-spacing: .06em; text-transform: uppercase; padding: 6px 6px;
  border-bottom: 1px solid var(--vd-border); white-space: nowrap;
}}
#research-vol-decay table.vd-table th.vd-left, #research-vol-decay table.vd-table td.vd-cell-name {{
  text-align: left;
}}
#research-vol-decay table.vd-table td {{
  padding: 5px 6px; border-bottom: 1px solid rgba(44,49,59,.55); white-space: nowrap;
}}
#research-vol-decay table.vd-table tr:last-child td {{ border-bottom: 0; }}
#research-vol-decay .vd-cell-name {{ color: var(--vd-text); }}
#research-vol-decay .vd-num {{ text-align: right; font-variant-numeric: tabular-nums; }}
#research-vol-decay .vd-muted {{ color: var(--vd-muted); }}
#research-vol-decay .vd-scroll {{ overflow-x: auto; -webkit-overflow-scrolling: touch; }}
#research-vol-decay .vd-swipe {{ display: none; }}
@media (max-width: 760px) {{
  #research-vol-decay .vd-swipe {{ display: inline; color: var(--vd-amber); }}
}}
#research-vol-decay .vd-verdict {{
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 14px;
}}
#research-vol-decay .vd-finding {{
  background: var(--vd-surface); border: 1px solid var(--vd-border);
  border-left: 2px solid var(--vd-amber); border-radius: 6px; padding: 10px 12px;
  font-size: 11.5px; line-height: 1.55; color: var(--vd-muted); min-width: 0;
}}
#research-vol-decay .vd-finding strong {{
  display: block; color: var(--vd-text); font: 600 10px/1.3 var(--vd-mono);
  letter-spacing: .07em; text-transform: uppercase; margin-bottom: 5px;
}}
#research-vol-decay .vd-finding b {{ color: var(--vd-text); }}
#research-vol-decay .vd-caveats {{
  margin-top: 14px; border: 1px solid var(--vd-border); border-radius: 8px;
  background: var(--vd-surface); padding: 11px 14px;
}}
#research-vol-decay .vd-caveats h3 {{
  font: 600 9px/1.3 var(--vd-mono); letter-spacing: .1em; text-transform: uppercase;
  color: var(--vd-muted); margin: 0 0 7px;
}}
#research-vol-decay .vd-caveats ul {{
  margin: 0; padding-left: 16px; columns: 2; column-gap: 26px;
  font-size: 11px; line-height: 1.55; color: var(--vd-muted);
}}
#research-vol-decay .vd-caveats li {{ margin-bottom: 3px; break-inside: avoid; }}
#research-vol-decay .vd-caveats b {{ color: var(--vd-text); font-weight: 600; }}
@media (max-width: 1180px) {{
  #research-vol-decay .vd-kpis {{ grid-template-columns: repeat(3, minmax(0, 1fr)); }}
  #research-vol-decay .vd-verdict {{ grid-template-columns: 1fr; }}
}}
@media (max-width: 760px) {{
  #research-vol-decay {{ padding: 14px 10px 30px; }}
  #research-vol-decay .vd-kpis {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
  #research-vol-decay .vd-grid {{ grid-template-columns: minmax(0, 1fr); gap: 10px; }}
  #research-vol-decay .vd-span2 {{ grid-column: span 1; }}
  #research-vol-decay .vd-kpi-value {{ font-size: 14px; white-space: normal; }}
  #research-vol-decay .vd-kpi-delta {{ white-space: normal; overflow: visible; }}
  #research-vol-decay .vd-kpi-label {{ white-space: normal; overflow: visible; }}
  #research-vol-decay .vd-caveats ul {{ columns: 1; }}
  #research-vol-decay table.vd-table {{ font-size: 10px; }}
  #research-vol-decay table.vd-table td, #research-vol-decay table.vd-table th {{ padding: 4px 5px; }}
}}
</style>

<div class="vd-wrap">
  <div class="vd-kicker">Research · 0-DTE premium decay &amp; IV surface</div>
  <h2>NIFTY {meta['session']} — the {ATM} put {signed(day['pct'])}%, and <span class="vd-thin">{thin}</span></h2>
  <p class="vd-sub">
    From {ANCHOR} to {day['covered_to']} the <b>{ATM} PE went {fmt(day['px0'], 2)} → {fmt(day['px1'], 2)}</b>
    ({signed(day['dp'], 2)}). Repricing every usable minute from the vendor IV splits that into
    <b>spot {signed(day['spot'])}</b> ({share['spot']:.0f}%), <b>time {signed(day['theta'])}</b> ({share['theta']:.0f}%),
    <b>IV {signed(day['iv'])}</b> ({share['iv']:.0f}%) and a {signed(day['wedge'])} print-vs-model wedge.
    The {RIP_START}–{RIP_END} window — the largest 10-minute ATM-IV move before the final half hour — was
    <b>{signed(rip['dp'], 2)}</b> on the {rip['label']}, of which spot was {signed(rip['spot'])} and time
    {signed(rip['theta'])}.
    The headline “{iv_tag} {fmt(atm['settled'], 1)} → {fmt(atm['last'], 1)}” averages two legs that disagree by
    <b>{fmt(payload['headline']['gap_atm_last'], 1)} vol points</b> at the same {ATM} strike
    (CE {fmt(reported_atm.get('legs_last', {}).get('ce'), 1)} / PE {fmt(reported_atm.get('legs_last', {}).get('pe'), 1)}).
  </p>
  <div class="vd-stamp">
    {meta['snapshots']} snapshots · ~{meta['snapshot_gap_median_s']:.0f}s cadence ·
    {surface['cells']} surface cells ({surface['missing']} masked) · clipped {CLIP} ·
    r {RATE:.1%} / q {DIV_YIELD:.1%} · ACT/365 to 15:30 IST
  </div>
  <p class="vd-lim"><b>Tape-start limitation.</b> Premiums are observed only from <b>{meta['tape_start']}</b>;
    the anchor is {ANCHOR} and the clip is {CLIP}.{tape_note} Nothing on this page describes the 09:15–{meta['tape_start']}
    price path or how the expiry pin resolved after {CLIP}.</p>

  <div class="vd-kpis">{kpi_html}</div>

  <div class="vd-grid">

    <figure class="vd-card">
      <div class="vd-card-head">
        <h3>IV surface — level vs curvature</h3>
        <span class="vd-hint">time × strike × IV · 5-min frames · OTM leg</span>
      </div>
      <div class="vd-chart" id="vd-iv-surface"></div>
      <p class="vd-note">
        White line = ATM ridge (spot, interpolated IV). The body of the smile sits at
        {fmt(atm['settled'], 1)} at {ANCHOR}, {fmt(atm['post_rip'], 1)} at {RIP_END} and
        {fmt(atm['last'], 1)} at {close_clock}. Curvature moves more than the level: {wing_note}. The crease
        along the spot path is the put–call IV gap at one strike, not a plotting artefact.
      </p>
    </figure>

    <figure class="vd-card">
      <div class="vd-card-head">
        <h3>PE premium ribbon — decay in place</h3>
        <span class="vd-hint">{PREMIUM_SURFACE_STRIKES[0]}–{PREMIUM_SURFACE_STRIKES[-1]} PE · ₹ premium</span>
      </div>
      <div class="vd-chart" id="vd-premium-surface"></div>
      <p class="vd-note">
        The surface is a ramp — a higher-strike put costs more because it is further ITM — and the whole ramp sags
        as the session runs. The <b>ATM elbow walks down the ladder</b> with spot, and the kink is the same
        convexity that makes a fixed strike decay gently and then collapse once spot arrives. The floor line is the
        spot path.
      </p>
    </figure>

    <figure class="vd-card vd-span2">
      <div class="vd-card-head">
        <h3>Smile at four clocks</h3>
        <span class="vd-hint">CE / PE IV per strike · spot marked</span>
      </div>
      <div class="vd-legend">
        <span><i style="background:#4F8BFF"></i>CE IV</span>
        <span><i style="background:#FF8A3D"></i>PE IV</span>
        <span><i style="background:#6B7280"></i>OTM composite</span>
        <span><i style="background:#E8E8E8"></i>spot</span>
      </div>
      <div class="vd-chart" id="vd-smiles"></div>
      <p class="vd-note">
        One curve per clock: CE above spot, PE below it (an ITM 0-DTE leg carries almost no time value, so its “IV”
        is the strike/spot split — those are dropped, not smoothed). At {RIP_START} → {RIP_END} the ATM moves
        {fmt(atm['pre_rip'], 1)} → {fmt(atm['post_rip'], 1)}{left_clause}{body_clause}.
        Between {ANCHOR} and {close_clock} {call_clause} while {put_clause}; the step at {ATM} (CE vs PE, same
        strike) is {gap_txt}. The fourth panel is the last clock with a usable OTM IV, not necessarily {CLIP}.
      </p>
    </figure>

    <figure class="vd-card vd-span2">
      <div class="vd-card-head">
        <h3>Premium vs intrinsic vs a frozen-spot model — six contracts, one story</h3>
        <span class="vd-hint">solid = traded · dashed = intrinsic · dotted = θ-only counterfactual</span>
      </div>
      <div class="vd-legend">
        <span><i style="background:#FF8A3D"></i>PE premium</span>
        <span><i style="background:#4F8BFF"></i>CE premium</span>
        <span><i style="background:#6B7280"></i>intrinsic</span>
        <span><i style="background:#D9902A"></i>spot &amp; IV frozen at {ANCHOR}</span>
        <span><i style="background:#2C313B"></i>time value</span>
      </div>
      <div class="vd-chart" id="vd-decay"></div>
      <p class="vd-note">
        The gap between the solid and dashed line <b>is</b> time value: at {ATM} it runs
        {fmt(day['tv0'], 1)} → {fmt(day['tv1'], 1)} points. The dotted line is what theta alone would have done with
        the market frozen — it moves {fmt(frozen_move, 1)} points, not the {fmt(abs(day['naive_theta']), 1)} points
        the vendor θ column sums to. <b>The premium path is mostly the intrinsic path</b>; theta only reshuffles the
        small residual.
      </p>
    </figure>

    <figure class="vd-card vd-span2">
      <div class="vd-card-head">
        <h3>Where the premium actually went — and what the θ column claims</h3>
        <span class="vd-hint">points of premium · {ANCHOR} → {CLIP}</span>
      </div>
      <div class="vd-legend">
        <span><i style="background:#4F8BFF"></i>spot</span>
        <span><i style="background:#D9902A"></i>time (priced)</span>
        <span><i style="background:#A98BFF"></i>IV</span>
        <span><i style="background:#6B7280"></i>print wedge</span>
        <span><i style="background:#E8E8E8"></i>white tick = actual Δ premium</span>
      </div>
      <div class="vd-chart" id="vd-attribution"></div>
      <p class="vd-note">
        Left: one bar per bucket, all from zero — spot, time, IV, print wedge — with the white tick marking the
        actual Δ premium the four buckets must add up to (they do, to within ±{fmt(max_wedge, 1)} points). Right:
        the same theta, two ways. The hollow bar is the vendor θ summed over the covered minutes; the filled bar is
        what the chain actually charged. For {ATM} PE that is
        <b>{signed(day['naive_theta'])} vs {signed(day['theta'])}</b> —
        <b>{(abs(day['naive_theta'] / day['theta']) if day['theta'] else 0):.1f}×</b> overstatement.
      </p>
    </figure>

    <figure class="vd-card">
      <div class="vd-card-head">
        <h3>Straddle 1σ vs what happened next</h3>
        <span class="vd-hint">ATM straddle ÷ 0.7979 · points</span>
      </div>
      <div class="vd-chart" id="vd-straddle"></div>
      <p class="vd-note">
        Amber = 1σ remaining priced by the ATM straddle. Grey = the largest move that actually followed from that
        minute to the {CLIP} clip. The {ANCHOR} quote implied <b>{fmt(payload['headline']['straddle_anchor'], 0)}
        points</b> and the biggest subsequent excursion was <b>{fmt(straddle_peak, 0)}</b>. Over frames that still
        had 30 minutes of tape left, the band was {fmt(payload['straddle']['mean_excursion_ratio'], 2)}× consumed
        and breached on {fmt(payload['headline']['share_realized_beat_sigma'], 0)}% of them. It is a
        <b>remaining</b>-move number — comparing it to the move since the open is the usual error.
      </p>
    </figure>

    <figure class="vd-card">
      <div class="vd-card-head">
        <h3>IV vs realized vol</h3>
        <span class="vd-hint">annualised % · RV = trailing 30 min, 1-min returns</span>
      </div>
      <div class="vd-chart" id="vd-ivrv"></div>
      <p class="vd-note">
        Session RV {fmt(payload['headline']['session_rv'], 2)}% against ATM IV
        {fmt(atm['settled'], 2)}–{fmt(atm['peak'], 2)}%. The gap is the 0-DTE seller's edge <b>and</b> the reason
        theta looks large in rupees while realised movement stays small — implied variance was priced for a move
        that did not fully arrive inside the recorded window.
      </p>
    </figure>

    <figure class="vd-card vd-span2">
      <div class="vd-card-head">
        <h3>Skew rotation</h3>
        <span class="vd-hint">25Δ call − put IV, and the CE−PE gap at fixed strikes</span>
      </div>
      <div class="vd-chart" id="vd-skew"></div>
      <p class="vd-note">
        Top: ATM IV (white) with the 25Δ call (blue) and put (orange) wings. Bottom: CE IV minus PE IV at the same
        strike — the quantity that actually moved. {ATM} goes from
        <b>{signed(smile0['gap_atm'], 1)}</b> at {ANCHOR} to
        <b>{signed(payload['headline']['gap_atm_last'], 1)}</b> at {payload['headline'].get('gap_atm_clock') or CLIP}.
      </p>
    </figure>

    <figure class="vd-card vd-span2">
      <div class="vd-card-head">
        <h3>Contract ledger — exact numbers behind the charts</h3>
        <span class="vd-hint">{ANCHOR} → {day['covered_to']} · all values in index points</span>
      </div>
      <div class="vd-scroll">
        <table class="vd-table">          <thead><tr>
            <th class="vd-left">contract</th><th>{ANCHOR}</th><th>{day['covered_to']}</th><th>Δ</th><th>%</th>
            <th>Δ intrinsic</th><th>time value</th><th>spot</th><th>time (θ)</th><th>IV</th>
            <th>Σ vendor θ</th>
          </tr></thead>
          <tbody>{contract_rows}</tbody>
        </table>
      </div>
      <p class="vd-note">
        “spot”, “time (θ)” and “IV” are the three repricing buckets; they sum to Δ minus the print wedge
        (≤ {fmt(max_wedge, 1)} pts). “Σ vendor θ” is the naive integral and is never a P&amp;L forecast. Attribution stops at the
        last minute where the leg still had ≥ ₹{IV_FLOOR_PREMIUM:.0f} of premium and a usable IV, so the close
        column can sit slightly before {CLIP} on contracts that went to zero.
        <span class="vd-swipe">Swipe the table sideways for the θ columns →</span>
      </p>
    </figure>
  </div>

  <div class="vd-verdict">
    <div class="vd-finding">
      <strong>Did the premium collapse match?</strong>
      Yes on spot, no on theta. <b>{signed(day['spot'])} of {signed(day['dp'])}</b> points is the underlying
      re-pricing the {ATM} put. Time decay contributed <b>{signed(day['theta'])}</b> ({share['theta']:.0f}%), IV
      <b>{signed(day['iv'])}</b> ({share['iv']:.0f}%). The premium moved {signed(day['pct'], 1)}% but the
      <b>time value moved {fmt(tv_pct, 1)}%</b> ({fmt(day['tv0'], 1)} → {fmt(day['tv1'], 1)}) — the percentage on
      the tape is a spot number, not a theta number.
    </div>
    <div class="vd-finding">
      <strong>Did IV reprice in {RIP_START}–{RIP_END}?</strong>
      ATM IV {fmt(atm['pre_rip'], 2)} → {fmt(atm['post_rip'], 2)} over that window; the session peak was
      {fmt(atm['peak'], 2)} by {peak_clock}. {shape_sentence} The CE−PE gap at {ATM} went
      <b>{signed(smile0['gap_atm'], 1)} → {signed(payload['headline']['gap_atm_last'], 1)}</b> vol points.
    </div>
    <div class="vd-finding">
      <strong>Why θ is not a P&amp;L forecast</strong>
      The vendor θ is an instantaneous rate. Summed over the covered window it is
      <b>{signed(day['naive_theta'])}</b> points on the {ATM} PE alone —
      <b>{(abs(day['naive_theta']) / max_tv if max_tv else 0):.1f}×</b> the {fmt(max_tv, 1)} points of time value
      that contract ever carried — and <b>{(abs(day['naive_theta'] / day['theta']) if day['theta'] else 0):.1f}×</b>
      what the chain charged. For 0-DTE the correct integral is the √T curve in the dotted line, and it collapses
      as the option loses value.
    </div>
  </div>

  <div class="vd-caveats">
    <h3>Method &amp; caveats</h3>
    <ul>
      <li><b>0-DTE:</b> expiry is 15:30 on {EXPIRY}. τ is ACT/365 to that minute; the window after {CLIP} is
      outside the clip, so nothing here says how the pin resolved.</li>
      <li><b>Model, not exchange greeks:</b> every price in the attribution is our BS reprice of the vendor IV
      (r 6.5%, q 1.2%). The print-vs-model wedge is carried as its own bucket (|≤{fmt(max_wedge, 1)}| pts)
      instead of being folded into theta. Bucket signs are price contributions: for a put, the “spot” bucket is
      positive when spot falls.</li>
      <li><b>IV sentinels:</b> a cell is used only when premium ≥ ₹{IV_FLOOR_PREMIUM:.2f}, |delta| ≤ 0.88 and
      0 &lt; IV &lt; 300; masked cells stay masked, never clipped. The surface drops {surface['missing']} of
      {surface['cells']} cells.</li>
      <li><b>Sparse wings:</b> wing IVs beyond ±{3 * STRIKE_STEP} points are tick noise — a ₹0.35 print on a
      deep-OTM leg “implies” absurd vol. Quote coverage thins as the session runs.</li>
      <li><b>Cadence:</b> median snapshot gap {meta['snapshot_gap_median_s']:.0f}s. The attribution is a
      1-minute Riemann sum; a gap attributes the whole interval to one step.</li>
      <li><b>What is not here:</b> no tick/bid-ask queue data, no dealer inventory, no futures basis, no Greeks
      beyond the vendor snapshot.</li>
      <li><b>Coverage:</b> the recording starts at {meta['tape_start']}, so the anchor is {ANCHOR} and the open
      print is not part of the attribution. The covered end for the {ATM} PE is {day['covered_to']}; contracts
      that decayed below ₹{IV_FLOOR_PREMIUM:.0f} stop earlier.</li>
      <li><b>Reading the surface:</b> IV is the vendor's per-leg number, so call and put IVs at one strike are
      two different quotes, not one smile. “ATM IV” is the mean of the nearest OTM call and OTM put, never a
      single strike's CE+PE average.</li>
    </ul>
  </div>
</div>

<script>
(function () {{
  "use strict";
  var DATA = {data_json};
  var META = DATA.meta;
  var C = {{
    bg: "#000000", surface: "#13161C", raised: "#1F242D", border: "#2C313B",
    text: "#E8E8E8", muted: "#9B9B9B", amber: "#D9902A", ce: "#4F8BFF",
    pe: "#FF8A3D", pos: "#2FA36B", neg: "#E5606A", iv: "#A98BFF", grey: "#6B7280"
  }};
  var MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
  var ANCHOR_MIN = META.minute_lo, CLIP_MIN = META.minute_hi;
  var RIP_MIN = {_clock_minutes(RIP_START) - 555};

  function ready(cb) {{
    var tries = 0;
    (function poll() {{
      if (window.d3 && window.Plotly) return cb();
      if (++tries > 1200) return;
      requestAnimationFrame(poll);
    }})();
  }}

  function el(id) {{ return document.getElementById(id); }}

  function clockTicks(minutes) {{
    var ticks = [];
    for (var m = 0; m <= 390; m += 30) {{
      if (m >= ANCHOR_MIN - 1 && m <= CLIP_MIN + 1) ticks.push(m);
    }}
    return ticks;
  }}
  function clockLabel(m) {{
    var total = 9 * 60 + 15 + m;
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(Math.round(total % 60)).padStart(2, "0");
  }}

  function svgRoot(host, height) {{
    var d3 = window.d3;
    var width = Math.max(280, host.clientWidth || 600);
    host.innerHTML = "";
    var svg = d3.select(host).append("svg")
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width).attr("height", height)
      .attr("role", "img");
    return {{ d3: d3, svg: svg, w: width, h: height }};
  }}

  function axisStyles(g) {{
    g.selectAll("text").attr("fill", C.muted).style("font", "9.5px " + MONO);
    g.selectAll("line").attr("stroke", C.border);
    g.selectAll("path.domain").attr("stroke", C.border);
  }}

  function linePath(d3, xs, ys, pts, keep) {{
    return d3.line()
      .defined(keep || function (p) {{ return p[1] !== null && p[1] !== undefined && isFinite(p[1]); }})
      .x(function (p) {{ return xs(p[0]); }})
      .y(function (p) {{ return ys(p[1]); }})(pts || []);
  }}

  function areaPath(d3, xs, y0, y1, pts, keep) {{
    return d3.area()
      .defined(keep || function (p) {{ return isFinite(p[1]) && isFinite(p[2]); }})
      .x(function (p) {{ return xs(p[0]); }})
      .y0(y0).y1(y1)(pts || []);
  }}

  // ---------------------------------------------------------------- IV surface
  function renderIvSurface() {{
    var host = el("vd-iv-surface");
    if (!host) return;
    var s = DATA.iv_surface;
    var wide = host.clientWidth > 700;
    var height = wide ? 480 : 320;
    var trace = {{
      type: "surface", x: s.strikes, y: s.minutes, z: s.z,
      colorscale: [[0, "#1b2a3a"], [0.22, "#2f5f86"], [0.45, "#4F8BFF"],
                   [0.68, "#D9902A"], [0.85, "#e0603a"], [1, "#ffd7a8"]],
      cmin: 17, cmax: 33, connectgaps: false,
      colorbar: {{
        title: {{ text: "IV %", side: "right", font: {{ color: C.muted, size: 10 }} }},
        tickfont: {{ color: C.muted, size: 9 }}, thickness: wide ? 10 : 6,
        len: 0.62, outlinewidth: 0, bgcolor: "rgba(0,0,0,0)"
      }},
      hovertemplate: "strike %{{x}}<br>%{{customdata}}<br>IV %{{z:.2f}}%<extra></extra>",
      customdata: s.minutes.map(function (m) {{ return clockLabel(m); }}),
      lighting: {{ ambient: 0.92, diffuse: 0.28, specular: 0.04, roughness: 0.95 }},
      lightposition: {{ x: 0, y: 0, z: 1000 }}
    }};
    var ridge = {{
      type: "scatter3d", mode: "lines", x: s.spot, y: s.minutes, z: s.atm_iv,
      line: {{ color: "#F2F2F2", width: 4 }}, name: "ATM", hoverinfo: "skip"
    }};
    var layout = {{
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      margin: {{ l: 0, r: 0, t: 6, b: 0 }},
      height: height, showlegend: false,
      font: {{ color: C.muted, size: 9, family: MONO }},
      scene: {{
        bgcolor: "rgba(0,0,0,0)",
        xaxis: {{ title: {{ text: "strike", font: {{ size: 9 }} }}, gridcolor: "#242A33",
                  zerolinecolor: "#242A33", tickfont: {{ size: 8 }},
                  range: [{meta['strike_lo']}, {meta['strike_hi']}] }},
        yaxis: {{ title: {{ text: "clock", font: {{ size: 9 }} }}, gridcolor: "#242A33",
                  zerolinecolor: "#242A33", tickfont: {{ size: 8 }},
                  tickvals: [ANCHOR_MIN, Math.round((ANCHOR_MIN + CLIP_MIN) / 2), CLIP_MIN],
                  ticktext: [META.anchor, clockLabel(Math.round((ANCHOR_MIN + CLIP_MIN) / 2)), META.clip] }},
        zaxis: {{ title: {{ text: "IV %", font: {{ size: 9 }} }}, gridcolor: "#242A33",
                  zerolinecolor: "#242A33", tickfont: {{ size: 8 }}, range: [16, 34] }},
        camera: {{ eye: {{ x: 1.25, y: -1.2, z: 0.68 }} }},
        aspectmode: "manual",
        aspectratio: {{ x: 1.75, y: 1.0, z: 0.55 }}
      }}
    }};
    window.Plotly.react(host, [trace, ridge], layout, {{ displayModeBar: false, responsive: true }});
  }}

  // ---------------------------------------------------------- premium surface
  function renderPremiumSurface() {{
    var host = el("vd-premium-surface");
    if (!host) return;
    var s = DATA.premium_surface;
    var wide = host.clientWidth > 700;
    var height = wide ? 480 : 320;
    var trace = {{
      type: "surface", x: s.strikes, y: s.minutes, z: s.z, connectgaps: true,
      colorscale: [[0, "#12181f"], [0.25, "#4a2a12"], [0.55, "#9b5a1c"],
                   [0.78, "#D9902A"], [1, "#ffd7a8"]],
      colorbar: {{ title: {{ text: "₹", side: "right", font: {{ color: C.muted, size: 10 }} }},
        tickfont: {{ color: C.muted, size: 9 }}, thickness: wide ? 10 : 6,
        len: 0.6, outlinewidth: 0, bgcolor: "rgba(0,0,0,0)" }},
      hovertemplate: "strike %{{x}}<br>%{{customdata}}<br>PE ₹%{{z:.2f}}<extra></extra>",
      customdata: s.minutes.map(function (m) {{ return clockLabel(m); }}),
      lighting: {{ ambient: 0.92, diffuse: 0.28, specular: 0.04, roughness: 0.95 }},
      lightposition: {{ x: 0, y: 0, z: 1000 }}
    }};
    var path = {{
      type: "scatter3d", mode: "lines", x: s.spot, y: s.minutes, z: s.minutes.map(function () {{ return 0; }}),
      line: {{ color: "#E8E8E8", width: 3, dash: "dot" }}, name: "spot", hoverinfo: "skip"
    }};
    window.Plotly.react(host, [trace, path], {{
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      margin: {{ l: 0, r: 0, t: 6, b: 0 }}, height: height, showlegend: false,
      font: {{ color: C.muted, size: 9, family: MONO }},
      scene: {{
        bgcolor: "rgba(0,0,0,0)",
        xaxis: {{ title: {{ text: "strike", font: {{ size: 9 }} }}, gridcolor: "#242A33",
                  zerolinecolor: "#242A33", tickfont: {{ size: 8 }} }},
        yaxis: {{ title: {{ text: "clock", font: {{ size: 9 }} }}, gridcolor: "#242A33",
                  zerolinecolor: "#242A33", tickfont: {{ size: 8 }},
                  tickvals: [ANCHOR_MIN, Math.round((ANCHOR_MIN + CLIP_MIN) / 2), CLIP_MIN],
                  ticktext: [META.anchor, clockLabel(Math.round((ANCHOR_MIN + CLIP_MIN) / 2)), META.clip] }},
        zaxis: {{ title: {{ text: "₹ premium", font: {{ size: 9 }} }}, gridcolor: "#242A33",
                  zerolinecolor: "#242A33", tickfont: {{ size: 8 }} }},
        camera: {{ eye: {{ x: 1.25, y: -1.2, z: 0.74 }} }},
        aspectmode: "manual",
        aspectratio: {{ x: 1.25, y: 1.0, z: 0.62 }}
      }}
    }}, {{ displayModeBar: false, responsive: true }});
  }}

  // ---------------------------------------------------------------- smiles
  function renderSmiles() {{
    var host = el("vd-smiles");
    if (!host) return;
    var panels = DATA.smiles;
    var cols = host.clientWidth > 560 ? 2 : 1;
    var ph = cols > 1 ? 214 : 168;
    host.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0,1fr))";
    wrap.style.gap = "8px";
    host.appendChild(wrap);

    var ivVals = [];
    panels.forEach(function (p) {{
      p.otm.forEach(function (d) {{ if (d.iv && d.iv < 45) ivVals.push(d.iv); }});
    }});
    var ivLo = Math.max(10, d3.min(ivVals) - 2), ivHi = d3.max(ivVals) + 2;

    panels.forEach(function (p) {{
      var cell = document.createElement("div");
      cell.style.minWidth = "0";
      wrap.appendChild(cell);
      var m = {{ t: 20, r: 8, b: 22, l: 34 }};
      var root = svgRoot(cell, ph);
      var d3 = root.d3, svg = root.svg;
      var iw = root.w - m.l - m.r, ih = root.h - m.t - m.b;
      var x = d3.scaleLinear().domain([{meta['strike_lo']}, {meta['strike_hi']}]).range([0, iw]);
      var y = d3.scaleLinear().domain([ivLo, ivHi]).range([ih, 0]);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      g.append("g").attr("transform", "translate(0," + ih + ")")
        .call(d3.axisBottom(x).tickValues([{meta['strike_lo']}, {ATM - 200}, {ATM - 100}, {ATM}, {ATM + 100}, {ATM + 200}])
          .tickFormat(function (v) {{ return (v / 1000).toFixed(1) + "k"; }}))
        .call(axisStyles);
      g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(function (v) {{ return v + "%"; }}))
        .call(axisStyles);

      g.append("line").attr("x1", x({ATM})).attr("x2", x({ATM})).attr("y1", 0).attr("y2", ih)
        .attr("stroke", "#2C313B").attr("stroke-width", 1).attr("stroke-dasharray", "2 3");
      g.append("text").attr("x", x({ATM}) + 3).attr("y", 8)
        .attr("fill", C.muted).style("font", "8px " + MONO).text("{ATM}");

      var otm = p.otm.map(function (d) {{ return [d.k, d.iv]; }});
      g.append("path")
        .attr("d", linePath(d3, x, y, otm, function (d) {{ return d[1] && d[1] <= ivHi; }}))
        .attr("fill", "none").attr("stroke", C.grey).attr("stroke-width", 1.4).attr("stroke-dasharray", "3 3");

      g.selectAll(".vd-otm-dot").data(p.otm.filter(function (d) {{ return d.iv && d.iv <= ivHi; }}))
        .enter().append("circle")
        .attr("cx", function (d) {{ return x(d.k); }})
        .attr("cy", function (d) {{ return y(d.iv); }})
        .attr("r", 2.4)
        .attr("fill", function (d) {{ return d.side === "ce" ? C.ce : C.pe; }})
        .attr("fill-opacity", 0.9);

      g.append("line").attr("x1", x(p.spot)).attr("x2", x(p.spot)).attr("y1", 0).attr("y2", ih)
        .attr("stroke", C.text).attr("stroke-width", 1).attr("stroke-dasharray", "4 3").attr("opacity", 0.8);
      g.append("text").attr("x", x(p.spot) + 4).attr("y", ih - 4)
        .attr("fill", C.text).style("font", "8.5px " + MONO).text(p.spot.toFixed(0));

      svg.append("text").attr("x", m.l).attr("y", 11)
        .attr("fill", C.text).style("font", "600 9.5px " + MONO)
        .text(p.clock + "  ·  ATM " + p.atm_iv.toFixed(2) + "%");
      if (p.gap_atm !== null) {{
        svg.append("text").attr("x", m.l + iw + m.r).attr("y", 11).attr("text-anchor", "end")
          .attr("fill", p.gap_atm >= 0 ? C.pos : C.neg)
          .style("font", "9px " + MONO)
          .text("CE−PE @{ATM} " + (p.gap_atm > 0 ? "+" : "") + p.gap_atm.toFixed(1) + " vp");
      }}
    }});
  }}

  // ---------------------------------------------------------------- decay grid
  function renderDecay() {{
    var host = el("vd-decay");
    if (!host) return;
    var wide = host.clientWidth > 900;
    var cols = wide ? 3 : (host.clientWidth > 520 ? 2 : 1);
    var ph = wide ? 172 : 158;
    host.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0,1fr))";
    wrap.style.gap = "8px";
    host.appendChild(wrap);

    DATA.contracts.forEach(function (c) {{
      var cell = document.createElement("div");
      cell.style.minWidth = "0";
      wrap.appendChild(cell);
      var root = svgRoot(cell, ph);
      var d3 = root.d3, svg = root.svg;
      var m = {{ t: 18, r: 8, b: 20, l: 36 }};
      var iw = root.w - m.l - m.r, ih = root.h - m.t - m.b;
      var pts = c.points.filter(function (p) {{ return p.clock >= META.anchor && p.clock <= META.clip; }});
      var all = pts.map(function (p) {{ return p.px; }})
        .concat(pts.map(function (p) {{ return p.intr; }}))
        .concat(c.frozen.map(function (p) {{ return p.px; }}));
      var hi = Math.max.apply(null, all), lo = Math.min.apply(null, all);
      var pad = Math.max(4, (hi - lo) * 0.08);
      var x = d3.scaleLinear().domain([ANCHOR_MIN, CLIP_MIN]).range([0, iw]);
      var y = d3.scaleLinear().domain([Math.max(0, lo - pad), hi + pad]).range([ih, 0]);
      var color = c.side === "pe" ? C.pe : C.ce;
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      g.append("g").attr("transform", "translate(0," + ih + ")")
        .call(d3.axisBottom(x).tickValues(clockTicks([ANCHOR_MIN, CLIP_MIN]).filter(function (v, i) {{ return i % 2 === 0; }}))
          .tickFormat(clockLabel)).call(axisStyles);
      g.append("g").call(d3.axisLeft(y).ticks(4).tickFormat(function (v) {{ return v.toFixed(0); }}))
        .call(axisStyles);
      g.append("line").attr("x1", x(RIP_MIN)).attr("x2", x(RIP_MIN)).attr("y1", 0).attr("y2", ih)
        .attr("stroke", "#3A414D").attr("stroke-dasharray", "2 3");

      var band = pts.map(function (p) {{ return [p.t, p.px, p.intr]; }});
      g.append("path").attr("fill", "#2C313B").attr("fill-opacity", 0.55)
        .attr("d", areaPath(d3, x, function (d) {{ return y(d[2]); }}, function (d) {{ return y(d[1]); }}, band));

      var frozenPts = c.frozen.filter(function (p) {{ return p.t >= ANCHOR_MIN; }}).map(function (p) {{ return [p.t, p.px]; }});
      g.append("path")
        .attr("fill", "none").attr("stroke", C.amber).attr("stroke-width", 1.2)
        .attr("stroke-dasharray", "1.5 2.5")
        .attr("d", linePath(d3, x, y, frozenPts));

      g.append("path")
        .attr("fill", "none").attr("stroke", C.grey).attr("stroke-width", 1.1)
        .attr("stroke-dasharray", "4 2")
        .attr("d", linePath(d3, x, y, pts.map(function (p) {{ return [p.t, p.intr]; }})));

      g.append("path")
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.8)
        .attr("d", linePath(d3, x, y, pts.map(function (p) {{ return [p.t, p.px]; }})));

      var lastP = pts[pts.length - 1];
      g.append("circle").attr("cx", x(lastP.t)).attr("cy", y(lastP.px)).attr("r", 2.6)
        .attr("fill", color);
      g.append("text").attr("x", x(lastP.t) - 4).attr("y", y(lastP.px) + 12).attr("text-anchor", "end")
        .attr("fill", color).style("font", "600 9px " + MONO).text(lastP.px.toFixed(1));

      svg.append("text").attr("x", m.l).attr("y", 11)
        .attr("fill", C.text).style("font", "600 9.5px " + MONO).text(c.label);
      svg.append("text").attr("x", m.l + iw + m.r).attr("y", 11).attr("text-anchor", "end")
        .attr("fill", C.muted).style("font", "8.5px " + MONO)
        .text("TV " + (lastP.px - lastP.intr).toFixed(1) + " · IV " +
          (lastP.iv == null ? "—" : lastP.iv.toFixed(1) + "%"));
    }});
  }}

  // ---------------------------------------------------------------- attribution
  function renderAttribution() {{
    var host = el("vd-attribution");
    if (!host) return;
    var rows = DATA.attribution[0].rows;
    var narrow = host.clientWidth < 760;
    var height = narrow ? 470 : 356;
    var root = svgRoot(host, height);
    var d3 = root.d3, svg = root.svg;
    var leftW = narrow ? root.w - 8 : Math.floor(root.w * 0.58);
    var rightW = narrow ? root.w - 8 : root.w - leftW - 16;

    var m1 = {{ t: 22, r: narrow ? 40 : 54, b: 26, l: 74 }};
    var ih = narrow ? 200 : height - m1.t - m1.b;
    var iw = leftW - m1.l - m1.r;
    var g1 = svg.append("g").attr("transform", "translate(" + m1.l + "," + m1.t + ")");
    var keys = [["spot", C.ce, "spot"], ["theta", C.amber, "time"], ["iv", C.iv, "IV"], ["wedge", C.grey, "wedge"]];
    var totals = rows.map(function (r) {{ return r.dp; }});
    var x1 = d3.scaleLinear().domain([Math.min(-130, Math.min.apply(null, totals) - 24),
                                      Math.max(40, Math.max.apply(null, totals) + 24)]).range([0, iw]);
    var y1 = d3.scaleBand().domain(rows.map(function (r) {{ return r.label; }})).range([0, ih]).padding(0.3);

    g1.append("g").attr("transform", "translate(0," + ih + ")")
      .call(d3.axisBottom(x1).ticks(6).tickFormat(function (v) {{ return v.toFixed(0); }}))
      .call(axisStyles);
    g1.append("g").call(d3.axisLeft(y1).tickSize(0).tickPadding(6))
      .call(function (g) {{ g.selectAll("text").attr("fill", C.text).style("font", "9px " + MONO); }})
      .call(function (g) {{ g.select(".domain").remove(); }});
    g1.append("line").attr("x1", x1(0)).attr("x2", x1(0)).attr("y1", 0).attr("y2", ih)
      .attr("stroke", "#3A414D").attr("stroke-width", 1);

    rows.forEach(function (r) {{
      var bandY = y1(r.label), bh = y1.bandwidth();
      var gap = 1.4;
      var barH = (bh - gap * (keys.length - 1)) / keys.length;
      keys.forEach(function (key, i) {{
        var value = r[key[0]];
        if (!value) return;
        g1.append("rect")
          .attr("x", Math.min(x1(0), x1(value)))
          .attr("width", Math.max(0.5, Math.abs(x1(value) - x1(0))))
          .attr("y", bandY + i * (barH + gap))
          .attr("height", barH)
          .attr("fill", key[1]).attr("fill-opacity", 0.85);
      }});
      g1.append("line")
        .attr("x1", x1(r.dp)).attr("x2", x1(r.dp))
        .attr("y1", bandY - 3).attr("y2", bandY + bh + 3)
        .attr("stroke", C.text).attr("stroke-width", 2);
      g1.append("text").attr("x", iw + 6)
        .attr("y", bandY + bh / 2 + 3)
        .attr("fill", C.text).style("font", "9px " + MONO).text((r.dp > 0 ? "+" : "") + r.dp.toFixed(1));
    }});

    svg.append("text").attr("x", m1.l).attr("y", 10)
      .attr("fill", C.muted).style("font", "600 9px " + MONO)
      .text("Δ PREMIUM — REPRICING BUCKETS (points)");

    var m2 = {{ t: 16, r: 12, b: 26, l: narrow ? 74 : 60 }};
    var ox = narrow ? 4 : leftW + 12;
    var oy = narrow ? m1.t + ih + 36 : 0;
    var iw2 = rightW - m2.l - m2.r, ih2 = narrow ? 168 : ih;
    var g2 = svg.append("g").attr("transform", "translate(" + (ox + m2.l) + "," + (oy + m2.t) + ")");
    var x2 = d3.scaleLinear().domain([Math.min(-125, Math.min.apply(null, rows.map(function (r) {{ return r.naive_theta; }})) - 8), 6])
      .range([0, iw2]);
    var y2 = d3.scaleBand().domain(rows.map(function (r) {{ return r.label; }})).range([0, ih2]).padding(0.42);

    g2.append("g").attr("transform", "translate(0," + ih2 + ")")
      .call(d3.axisBottom(x2).ticks(4).tickFormat(function (v) {{ return v.toFixed(0); }}))
      .call(axisStyles);
    if (narrow) {{
      g2.append("g").call(d3.axisLeft(y2).tickSize(0).tickPadding(6))
        .call(function (g) {{ g.selectAll("text").attr("fill", C.text).style("font", "9px " + MONO); }})
        .call(function (g) {{ g.select(".domain").remove(); }});
    }}
    g2.append("line").attr("x1", x2(0)).attr("x2", x2(0)).attr("y1", 0).attr("y2", ih2)
      .attr("stroke", "#3A414D").attr("stroke-width", 1);

    rows.forEach(function (r) {{
      var bandY = y2(r.label);
      var h = y2.bandwidth();
      g2.append("rect").attr("x", x2(r.naive_theta)).attr("width", Math.max(1, x2(0) - x2(r.naive_theta)))
        .attr("y", bandY + h * 0.02).attr("height", h * 0.46)
        .attr("fill", "none").attr("stroke", C.amber).attr("stroke-width", 1).attr("stroke-dasharray", "3 2");
      g2.append("rect").attr("x", x2(r.theta)).attr("width", Math.max(1, x2(0) - x2(r.theta)))
        .attr("y", bandY + h * 0.52).attr("height", h * 0.46)
        .attr("fill", C.amber).attr("fill-opacity", 0.8);
    }});
    svg.append("text").attr("x", ox + m2.l).attr("y", oy + 10)
      .attr("fill", C.muted).style("font", "600 9px " + MONO)
      .text("Σ VENDOR θ (hollow) vs PRICED θ (solid)");
  }}

  // ---------------------------------------------------------------- straddle
  function renderStraddle() {{
    var host = el("vd-straddle");
    if (!host) return;
    var pts = DATA.straddle.points.filter(function (p) {{ return p.clock >= META.anchor; }});
    var height = 340;
    var root = svgRoot(host, height);
    var d3 = root.d3, svg = root.svg;
    var m = {{ t: 22, r: 44, b: 24, l: 40 }};
    var iw = root.w - m.l - m.r, ih = height - m.t - m.b;
    var x = d3.scaleLinear().domain([ANCHOR_MIN, CLIP_MIN]).range([0, iw]);
    var lo = Math.min(d3.min(pts, function (p) {{ return Math.min(p.sig1 || 999, p.excursion || 999); }}) || 0, 0);
    var hi = Math.max(d3.max(pts, function (p) {{ return Math.max(p.sig1 || 0, p.excursion || 0); }}), 10);
    var y = d3.scaleLinear().domain([Math.max(0, lo - 6), hi + 12]).range([ih, 0]);
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    g.append("g").attr("transform", "translate(0," + ih + ")")
      .call(d3.axisBottom(x).tickValues(clockTicks([ANCHOR_MIN, CLIP_MIN])).tickFormat(clockLabel)).call(axisStyles);
    g.append("g").call(d3.axisLeft(y).ticks(5)).call(axisStyles);

    g.append("path")
      .attr("fill", C.grey).attr("fill-opacity", 0.16).attr("stroke", C.grey)
      .attr("stroke-width", 1.1)
      .attr("d", areaPath(d3, x, function () {{ return ih; }}, function (d) {{ return y(d[1]); }},
        pts.map(function (p) {{ return [p.t, p.excursion]; }}), function (d) {{ return isFinite(d[1]); }}));
    g.append("path")
      .attr("fill", "none").attr("stroke", C.amber).attr("stroke-width", 1.9)
      .attr("d", linePath(d3, x, y, pts.map(function (p) {{ return [p.t, p.sig1]; }})));
    g.append("path")
      .attr("fill", "none").attr("stroke", C.text).attr("stroke-width", 1.1)
      .attr("stroke-dasharray", "3 3").attr("opacity", 0.7)
      .attr("d", linePath(d3, x, y, pts.map(function (p) {{ return [p.t, p.straddle]; }})));

    var last = pts[pts.length - 1];
    g.append("circle").attr("cx", x(last.t)).attr("cy", y(last.sig1)).attr("r", 3).attr("fill", C.amber);
    g.append("text").attr("x", x(last.t) - 4).attr("y", y(last.sig1) - 6).attr("text-anchor", "end")
      .attr("fill", C.amber).style("font", "600 9px " + MONO).text("1σ " + last.sig1.toFixed(0));
    g.append("text").attr("x", x(last.t) - 4).attr("y", y(last.excursion) - 6).attr("text-anchor", "end")
      .attr("fill", C.muted).style("font", "9px " + MONO).text("done " + last.excursion.toFixed(0));
    g.append("text").attr("x", m.l).attr("y", 10 - m.t + 10)
      .attr("fill", C.muted).style("font", "9px " + MONO)
      .text("straddle ₹" + last.straddle.toFixed(1));
  }}

  // ---------------------------------------------------------------- iv vs rv
  function renderIvRv() {{
    var host = el("vd-ivrv");
    if (!host) return;
    var pts = DATA.straddle.points.filter(function (p) {{ return p.rv30 && p.atm_iv && p.clock >= META.anchor; }});
    var height = 340;
    var root = svgRoot(host, height);
    var d3 = root.d3, svg = root.svg;
    var m = {{ t: 22, r: 14, b: 24, l: 36 }};
    var iw = root.w - m.l - m.r, ih = height - m.t - m.b;
    var all = pts.reduce(function (acc, p) {{ return acc.concat([p.atm_iv, p.rv30]); }}, []);
    var hi = Math.max.apply(null, all) * 1.12, lo = Math.min.apply(null, all) * 0.85;
    var x = d3.scaleLinear().domain([ANCHOR_MIN, CLIP_MIN]).range([0, iw]);
    var y = d3.scaleLinear().domain([Math.max(0, lo), hi]).range([ih, 0]);
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    g.append("g").attr("transform", "translate(0," + ih + ")")
      .call(d3.axisBottom(x).tickValues(clockTicks([ANCHOR_MIN, CLIP_MIN])).tickFormat(clockLabel)).call(axisStyles);
    g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(function (v) {{ return v + "%"; }})).call(axisStyles);

    var gap = pts.map(function (p) {{ return [p.t, p.atm_iv, p.rv30]; }});
    g.append("path").attr("fill", C.amber).attr("fill-opacity", 0.14)
      .attr("d", areaPath(d3, x, function (d) {{ return y(d[2]); }}, function (d) {{ return y(d[1]); }}, gap));
    g.append("path")
      .attr("fill", "none").attr("stroke", C.text).attr("stroke-width", 1.8)
      .attr("d", linePath(d3, x, y, pts.map(function (p) {{ return [p.t, p.atm_iv]; }})));
    g.append("path")
      .attr("fill", "none").attr("stroke", C.pe).attr("stroke-width", 1.5)
      .attr("d", linePath(d3, x, y, pts.map(function (p) {{ return [p.t, p.rv30]; }})));

    var last = pts[pts.length - 1];
    [["IV " + last.atm_iv.toFixed(1) + "%", last.atm_iv, C.text],
     ["RV " + last.rv30.toFixed(1) + "%", last.rv30, C.pe]].forEach(function (item) {{
      g.append("text").attr("x", x(last.t) - 4).attr("y", y(item[1]) + (item[2] === C.text ? -5 : 9))
        .attr("text-anchor", "end").attr("fill", item[2]).style("font", "600 8.5px " + MONO).text(item[0]);
    }});
  }}

  // ---------------------------------------------------------------- skew
  function renderSkew() {{
    var host = el("vd-skew");
    if (!host) return;
    var wide = host.clientWidth > 1000;
    var height = wide ? 300 : 400;
    var root = svgRoot(host, height);
    var d3 = root.d3, svg = root.svg;
    var pts = DATA.skew.points.filter(function (p) {{ return p.clock >= META.anchor; }});
    var leftW = wide ? root.w * 0.54 : root.w;
    var m1 = {{ t: 20, r: 12, b: 26, l: 36 }};
    var g1 = svg.append("g").attr("transform", "translate(" + m1.l + "," + m1.t + ")");
    var topH = wide ? height : 200;
    var iw1 = leftW - m1.l - m1.r, ih1 = topH - m1.t - m1.b;
    var vals = pts.reduce(function (acc, p) {{ return acc.concat([p.atm_iv, p.ce25 || [], p.pe25 || []]); }}, [])
      .filter(function (v) {{ return typeof v === "number"; }});
    var lo = Math.min.apply(null, vals) - 2, hi = Math.max.apply(null, vals) + 2;
    var x1 = d3.scaleLinear().domain([ANCHOR_MIN, CLIP_MIN]).range([0, iw1]);
    var y1 = d3.scaleLinear().domain([lo, hi]).range([ih1, 0]);

    g1.append("g").attr("transform", "translate(0," + ih1 + ")")
      .call(d3.axisBottom(x1).tickValues(clockTicks([ANCHOR_MIN, CLIP_MIN])).tickFormat(clockLabel)).call(axisStyles);
    g1.append("g").call(d3.axisLeft(y1).ticks(5).tickFormat(function (v) {{ return v + "%"; }})).call(axisStyles);
    g1.append("line").attr("x1", x1(RIP_MIN)).attr("x2", x1(RIP_MIN)).attr("y1", 0).attr("y2", ih1)
      .attr("stroke", "#3A414D").attr("stroke-dasharray", "2 3");
    g1.append("text").attr("x", x1(RIP_MIN) + 4).attr("y", 9).attr("fill", C.muted)
      .style("font", "8px " + MONO).text("{RIP_END}");

    [["atm_iv", C.text, "ATM IV", 1.6], ["ce25", C.ce, "25Δ call", 1.1],
     ["pe25", C.pe, "25Δ put", 1.1]].forEach(function (triple) {{
      var key = triple[0];
      g1.append("path")
        .attr("fill", "none").attr("stroke", triple[1]).attr("stroke-width", triple[3])
        .attr("opacity", key === "atm_iv" ? 1 : 0.55)
        .attr("d", linePath(d3, x1, y1, pts.map(function (p) {{ return [p.t, p[key]]; }})));
    }});
    svg.append("text").attr("x", m1.l).attr("y", 10)
      .attr("fill", C.muted).style("font", "600 9px " + MONO).text("ATM IV AND 25Δ WINGS");

    var m2 = {{ t: wide ? 24 : topH + 22, r: 12, b: 24, l: 36 }};
    var ox = wide ? leftW + 14 : 0;
    var g2 = svg.append("g").attr("transform", "translate(" + (ox + m2.l) + "," + m2.t + ")");
    var iw2 = (wide ? root.w - leftW - 14 : root.w) - m2.l - m2.r;
    var ih2 = height - m2.t - m2.b;
    var gvals = [];
    DATA.skew.fixed.forEach(function (series) {{
      series.points.forEach(function (p) {{ if (p.clock >= META.anchor) gvals.push(p.gap); }});
    }});
    var glo = Math.min(-3, Math.min.apply(null, gvals) - 1), ghi = Math.max(11, Math.max.apply(null, gvals) + 1);
    var x2 = d3.scaleLinear().domain([ANCHOR_MIN, CLIP_MIN]).range([0, iw2]);
    var y2 = d3.scaleLinear().domain([glo, ghi]).range([ih2, 0]);

    g2.append("g").attr("transform", "translate(0," + ih2 + ")")
      .call(d3.axisBottom(x2).tickValues(clockTicks([ANCHOR_MIN, CLIP_MIN])).tickFormat(clockLabel)).call(axisStyles);
    g2.append("g").call(d3.axisLeft(y2).ticks(5).tickFormat(function (v) {{ return v + "vp"; }})).call(axisStyles);
    g2.append("line").attr("x1", 0).attr("x2", iw2).attr("y1", y2(0)).attr("y2", y2(0))
      .attr("stroke", "#4A515C").attr("stroke-width", 1);
    g2.append("line").attr("x1", x2(RIP_MIN)).attr("x2", x2(RIP_MIN)).attr("y1", 0).attr("y2", ih2)
      .attr("stroke", "#3A414D").attr("stroke-dasharray", "2 3");

    var colors = {{}};
    colors[String({ATM})] = C.amber; colors[String({ATM - STRIKE_STEP})] = C.ce; colors[String({ATM - 2 * STRIKE_STEP})] = C.pe;
    DATA.skew.fixed.forEach(function (series) {{
      var color = colors[String(series.strike)] || C.grey;
      g2.append("path")
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5)
        .attr("d", linePath(d3, x2, y2, series.points.filter(function (p) {{ return p.clock >= META.anchor; }})
          .map(function (p) {{ return [p.t, p.gap]; }})));
      var last = series.points[series.points.length - 1];
      if (last) {{
        g2.append("text").attr("x", x2(last.t) - 4).attr("y", y2(last.gap) - 4).attr("text-anchor", "end")
          .attr("fill", color).style("font", "8.5px " + MONO).text(series.strike);
      }}
    }});
    svg.append("text").attr("x", ox + m2.l).attr("y", wide ? 10 : topH + 12)
      .attr("fill", C.muted).style("font", "600 9px " + MONO).text("CE − PE IV AT THE SAME STRIKE (vol pts)");
  }}

  var RENDERERS = [
    ["vd-iv-surface", renderIvSurface], ["vd-premium-surface", renderPremiumSurface],
    ["vd-smiles", renderSmiles], ["vd-decay", renderDecay],
    ["vd-attribution", renderAttribution], ["vd-straddle", renderStraddle],
    ["vd-ivrv", renderIvRv], ["vd-skew", renderSkew]
  ];

  function boot() {{
    ready(function () {{
      RENDERERS.forEach(function (pair) {{
        var host = el(pair[0]);
        if (!host) return;
        try {{ pair[1](); }} catch (err) {{ host.textContent = "chart error: " + err.message; console.error("vd render failed", pair[0], err); }}
      }});
      if (!window.ResizeObserver) return;
      var timer = null;
      var observer = new ResizeObserver(function () {{
        clearTimeout(timer);
        timer = setTimeout(function () {{
          RENDERERS.forEach(function (pair) {{
            var host = el(pair[0]);
            if (!host || !host.clientWidth) return;
            try {{ pair[1](); }} catch (err) {{ console.error("vd resize failed", pair[0], err); }}
          }});
        }}, 180);
      }});
      RENDERERS.forEach(function (pair) {{
        var host = el(pair[0]);
        if (host) observer.observe(host);
      }});
    }});
  }}

  if (document.readyState === "loading") {{
    document.addEventListener("DOMContentLoaded", boot, {{ once: true }});
  }} else {{
    boot();
  }}
}})();
</script>
</section>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", default="2026-11-17", help="session date (YYYY-MM-DD)")
    parser.add_argument("--expiry", default=None, help="expiry date (defaults to --session)")
    parser.add_argument("--out-dir", default=None, help="output directory")
    parser.add_argument("--clip", default=None, help="last minute included (HH:MM)")
    parser.add_argument("--anchor", default=None, help="first minute included (HH:MM)")
    parser.add_argument("--snapshots", default=None, help="override snapshots jsonl path")
    args = parser.parse_args()

    configure(args.session, args.expiry, args.out_dir, args.clip, args.anchor, args.snapshots)
    payload = build_payload()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / "vol_decay.json"
    html_path = OUT_DIR / "vol_decay.html"
    json_path.write_text(json.dumps(payload, indent=1))
    html_path.write_text(render_html(payload))

    def show(path: Path) -> str:
        try:
            return str(path.relative_to(ROOT))
        except ValueError:
            return str(path)

    print(f"wrote {show(json_path)} ({json_path.stat().st_size / 1024:.1f} KB)")
    print(f"wrote {show(html_path)} ({html_path.stat().st_size / 1024:.1f} KB)")
    head = payload["headline"]
    print(f"session={SESSION} expiry={EXPIRY} anchor={ANCHOR} clip={CLIP} atm={ATM} "
          f"rip={RIP_START}->{RIP_END}")
    print(json.dumps({k: head[k] for k in ("day", "rip", "atm_iv", "skew")}, indent=1))
    print(f"session_rv={head['session_rv']}  sigma_beat_share={head['share_realized_beat_sigma']}")


if __name__ == "__main__":
    main()
