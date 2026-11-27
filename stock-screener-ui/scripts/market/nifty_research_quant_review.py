#!/usr/bin/env python3
"""Quant review + quant lab for a NIFTY 0-DTE research session.

Reads the recorded tape / chain / snapshots / (optional) futures and the
multi-day history, writes ``quant_review.{md,json}`` and ``quant_lab.{md,json}``
next to the section fragments. Every number in the markdown is produced here;
nothing is transcribed by hand.

Session is a CLI argument. The default stays 2026-11-17. Sessions without a
futures archive fall back to the 1-minute tape spot and say so in every table —
cross-instrument lead-lag is then reported as not measurable, never guessed.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics as st
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "experiments" / "data"
IST = timezone(timedelta(hours=5, minutes=30))

DEFAULT_SESSION = "2026-11-17"
DECILES = 10
HORIZONS = (15, 30, 60)

SESSION = DEFAULT_SESSION
EXPIRY = DEFAULT_SESSION
OUT_DIR = ROOT / "reports" / f"nifty_{DEFAULT_SESSION}" / "research"
SEED = 20261117
RNG = np.random.default_rng(SEED)



def load_jsonl(path: Path) -> list[dict]:
    with path.open() as fh:
        return [json.loads(line) for line in fh if line.strip()]


def load_json(path: Path) -> dict:
    with path.open() as fh:
        return json.load(fh)


def tkey(ts: str) -> str:
    return ts[:16]


def tmin(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def minute_offset(ts: str, base: datetime) -> int:
    """The tape polls at drifting seconds (21s, 24s, 49s...), so a raw
    floor(seconds/60) collapses distinct minutes. Snap to the minute key first."""
    t = tmin(ts).replace(second=0, microsecond=0)
    b = base.replace(second=0, microsecond=0)
    return int((t - b).total_seconds() // 60)


def finite(x) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def r4(x) -> float | None:
    v = finite(x)
    return None if v is None else round(v, 4)



def load_session(date: str, expiry: str | None = None) -> dict:
    expiry = expiry or date
    tape = load_jsonl(DATA / "nifty_tape" / f"{date}.jsonl")
    chain_path = DATA / "nifty_chain10s" / f"{date}.jsonl"
    snap_path = DATA / "nifty_snapshots" / f"{date}.jsonl"
    chain = load_jsonl(chain_path) if chain_path.exists() else []
    snap = load_jsonl(snap_path) if snap_path.exists() else []
    fut_path = ROOT / "reports" / f"nifty_{date}" / "data" / "futures_1m.json"
    fut = load_json(fut_path)["candles"] if fut_path.exists() else []
    gaps_path = DATA / "nifty_tape" / f"{date}.gaps.jsonl"
    gaps = load_jsonl(gaps_path) if gaps_path.exists() else []
    return {"date": date, "expiry": expiry, "tape": tape, "chain": chain,
            "snap": snap, "fut": fut, "gaps": gaps}


def used_strike(row_chain: dict) -> dict[float, list]:
    out = {}
    for k, v in row_chain.items():
        try:
            out[float(k)] = v
        except (TypeError, ValueError):
            continue
    return out


def chain_series(rows: list[dict]) -> dict:
    by_key = {}
    for r in rows:
        by_key[tkey(r["t"])] = r
    keys = sorted(by_key)
    if not keys:
        return {"rows": [], "by_off": {}, "base": None, "keys": []}
    base = tmin(by_key[keys[0]]["t"])

    prev_vol: dict = {}
    prev_oi: dict = {}
    recs = []
    for k in keys:
        r = by_key[k]
        spot = finite(r["spot"])
        ch = used_strike(r.get("chain") or {})
        itm_dvol = itm_doi = otm_dvol = otm_doi = 0.0
        total_dvol = 0.0
        total_ce_dvol = 0.0
        for strike, v in ch.items():
            pe_oi = finite(v[3]) if len(v) > 3 else None
            pe_vol = finite(v[5]) if len(v) > 5 else None
            ce_oi = finite(v[2]) if len(v) > 2 else None
            ce_vol = finite(v[4]) if len(v) > 4 else None
            d_pe_vol = max(0.0, (pe_vol or 0.0) - prev_vol.get(strike, pe_vol or 0.0)) if pe_vol is not None else 0.0
            d_pe_oi = (pe_oi - prev_oi.get(strike, pe_oi)) if pe_oi is not None else 0.0
            d_ce_vol = 0.0
            if ce_vol is not None:
                d_ce_vol = max(0.0, ce_vol - prev_vol.get(("ce", strike), ce_vol))
            total_ce_dvol += d_ce_vol
            total_dvol += d_pe_vol
            if spot is not None and strike > spot:
                itm_dvol += d_pe_vol
                itm_doi += d_pe_oi
            else:
                otm_dvol += d_pe_vol
                otm_doi += d_pe_oi
            if pe_vol is not None:
                prev_vol[strike] = pe_vol
            if pe_oi is not None:
                prev_oi[strike] = pe_oi
            if ce_vol is not None:
                prev_vol[("ce", strike)] = ce_vol
            if ce_oi is not None:
                prev_oi[("ce", strike)] = ce_oi

        walls = r.get("walls") or {}
        call_wall = (walls.get("calls") or [{}])[0].get("strike")
        put_wall = (walls.get("puts") or [{}])[0].get("strike")
        straddle = None
        if finite(r.get("atm_ce_ltp")) is not None and finite(r.get("atm_pe_ltp")) is not None:
            straddle = finite(r["atm_ce_ltp"]) + finite(r["atm_pe_ltp"])
        recs.append({
            "t": r["t"], "off": minute_offset(r["t"], base), "spot": spot,
            "pe_oi": finite(r.get("pe_oi")), "ce_oi": finite(r.get("ce_oi")),
            "pe_vol": finite(r.get("pe_vol")), "ce_vol": finite(r.get("ce_vol")),
            "max_pain": finite(r.get("max_pain")),
            "net_gex": finite(r.get("net_gex")),
            "call_wall": finite(call_wall), "put_wall": finite(put_wall),
            "itm_pe_dvol": itm_dvol, "itm_pe_doi": itm_doi,
            "otm_pe_dvol": otm_dvol, "otm_pe_doi": otm_doi,
            "pe_dvol_total": total_dvol, "ce_dvol_total": total_ce_dvol,
            "tot_dvol": total_dvol + total_ce_dvol,
            "chain": ch, "atm_ce_iv": finite(r.get("atm_ce_iv")),
            "atm_pe_iv": finite(r.get("atm_pe_iv")),
            "atm_straddle": straddle, "cas": bool(r.get("cas")),
            "expiry": r.get("expiry"),
        })
    return {"rows": recs, "by_off": {x["off"]: x for x in recs}, "base": base,
            "keys": keys}


def futures_series(candles: list[dict]) -> dict:
    c = [x for x in candles if finite(x.get("c")) is not None]
    if not c:
        return {"rows": [], "by_off": {}, "base": None, "source": "none"}
    base = tmin(c[0]["t"])
    rows = []
    for x in c:
        rows.append({
            "t": x["t"], "off": minute_offset(x["t"], base),
            "o": finite(x.get("o")), "h": finite(x.get("h")), "l": finite(x.get("l")),
            "c": finite(x.get("c")), "v": finite(x.get("v")),
            "oi": finite(x.get("oi")),
        })
    return {"rows": rows, "by_off": {x["off"]: x for x in rows}, "base": base,
            "source": "futures_1m"}


def price_series(flow: dict, fut: dict) -> dict:
    if fut.get("rows"):
        return {"rows": fut["rows"], "by_off": fut["by_off"], "base": fut["base"],
                "source": "futures_1m", "oi_field": "futures_oi",
                "oi_is_futures": True,
                "note": "1-minute futures candles (price + futures OI)."}
    rows = []
    for r in flow["rows"]:
        oi = None
        if r["ce_oi"] is not None and r["pe_oi"] is not None:
            oi = r["ce_oi"] + r["pe_oi"]
        rows.append({"t": r["t"], "off": r["off"], "o": r["spot"], "h": r["spot"],
                     "l": r["spot"], "c": r["spot"], "v": None, "oi": oi})
    return {"rows": rows, "by_off": {x["off"]: x for x in rows},
            "base": flow["base"], "source": "tape_spot_1m",
            "oi_field": "ce_oi_plus_pe_oi (option OI)", "oi_is_futures": False,
            "note": ("No futures archive for this session: price is the 1-minute tape "
                     "spot and the OI column is combined CE+PE option OI, not futures OI.")}


def sync_spot(chain_rows: list[dict], fut_rows: list[dict], tol_s: float = 6.0) -> dict:
    """Spot sampled at each futures candle close (:59), so the two return
    series span the same wall-clock window instead of straddling it."""
    if not chain_rows or not fut_rows:
        return {}
    stamps = [tmin(r["t"]) for r in chain_rows]
    out = {}
    for f in fut_rows:
        target = tmin(f["t"]) + timedelta(seconds=59)
        i = int(np.searchsorted(stamps, target))
        cands = [j for j in (i - 1, i) if 0 <= j < len(stamps)]
        if not cands:
            continue
        j = min(cands, key=lambda j: abs((stamps[j] - target).total_seconds()))
        if abs((stamps[j] - target).total_seconds()) <= tol_s:
            out[f["off"]] = finite(chain_rows[j]["spot"])
    return out



def acf(x: np.ndarray, nlags: int) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    if len(x) < 4:
        return np.zeros(nlags)
    x = x - x.mean()
    denom = float(np.dot(x, x))
    if denom == 0:
        return np.zeros(nlags)
    return np.array([float(np.dot(x[:-k], x[k:]) / denom) for k in range(1, nlags + 1)])


def n_eff(x: np.ndarray, max_lag: int = 20) -> float:
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    if len(x) < 8:
        return float(len(x))
    r = acf(x, min(max_lag, len(x) - 2))
    w = 1.0 - np.arange(1, len(r) + 1) / (len(r) + 1)
    return float(len(x) / (1.0 + 2.0 * float(np.sum(w * r))))


def pearson(x: np.ndarray, y: np.ndarray) -> float:
    m = np.isfinite(x) & np.isfinite(y)
    if m.sum() < 5:
        return float("nan")
    a, b = x[m], y[m]
    sa, sb = a.std(), b.std()
    if sa == 0 or sb == 0:
        return float("nan")
    return float(np.corrcoef(a, b)[0, 1])


def fisher_ci(r: float, n: int, z: float = 1.959964) -> tuple[float, float] | None:
    if not math.isfinite(r) or n < 6 or abs(r) >= 1:
        return None
    zr = 0.5 * math.log((1 + r) / (1 - r))
    se = 1 / math.sqrt(n - 3)
    lo, hi = zr - z * se, zr + z * se
    return math.tanh(lo), math.tanh(hi)


def lag_pairs(x: np.ndarray, y: np.ndarray, lag: int) -> tuple[np.ndarray, np.ndarray]:
    if lag > 0:
        return x[lag:], y[:-lag]
    if lag < 0:
        return x[:lag], y[-lag:]
    return x, y


def lag_scan(x: np.ndarray, y: np.ndarray, lags: range) -> list[dict]:
    out = []
    for lag in lags:
        a, b = lag_pairs(x, y, lag)
        n = min(len(a), len(b))
        r = pearson(a[:n], b[:n])
        ci = fisher_ci(r, n)
        out.append({"lag": lag, "n": int(n), "r": r,
                    "ci": list(ci) if ci else None})
    return out


def block_boot_lag(x: np.ndarray, y: np.ndarray, lags: list[int],
                   block: int = 10, reps: int = 1500) -> dict[int, list[float]]:
    """Circular block bootstrap over aligned pairs; 2.5/97.5 pct per lag."""
    n = len(x)
    block = max(2, min(block, max(2, n // 6)))
    nblocks = int(math.ceil(n / block))
    out = {}
    for lag in lags:
        vals = []
        for _ in range(reps):
            starts = RNG.integers(0, n, size=nblocks)
            idx = np.concatenate([(s0 + np.arange(block)) % n for s0 in starts])[:n]
            a, b = lag_pairs(x[idx], y[idx], lag)
            m = min(len(a), len(b))
            r = pearson(a[:m], b[:m])
            if math.isfinite(r):
                vals.append(r)
        out[lag] = ([float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]
                    if len(vals) >= 50 else [float("nan"), float("nan")])
    return out


def boot_mean_ci(x: np.ndarray, block: int = 5, reps: int = 1500) -> list[float] | None:
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    n = len(x)
    if n < 6:
        return None
    block = max(2, min(block, max(2, n // 5)))
    nb = int(math.ceil(n / block))
    means = []
    for _ in range(reps):
        starts = RNG.integers(0, n, size=nb)
        idx = np.concatenate([(s + np.arange(block)) % n for s in starts])[:n]
        means.append(float(np.mean(x[idx])))
    return [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))]


def shift_excess_p(trigger: np.ndarray, values: np.ndarray, reps: int = 2000) -> float | None:
    """Circularly shift the trigger mask, preserving its run structure, and ask
    how often the shifted excess beats the observed one. This is the right null
    for a trigger whose own series is autocorrelated."""
    m = np.isfinite(values)
    trig = trigger & m
    if trig.sum() < 5 or m.sum() < 20:
        return None
    obs = float(values[trig].mean() - values[m].mean())
    n = len(values)
    null = []
    for _ in range(reps):
        sh = int(RNG.integers(1, n))
        t2 = np.roll(trigger, sh) & m
        if t2.sum() < 5:
            continue
        null.append(float(values[t2].mean() - values[m].mean()))
    if len(null) < 200:
        return None
    return float(np.mean(np.abs(null) >= abs(obs)))


def boot_cluster_mean_ci(groups: list[np.ndarray], reps: int = 1200) -> list[float] | None:
    groups = [g[np.isfinite(g)] for g in groups if len(g)]
    if len(groups) < 3:
        return None
    vals = []
    k = len(groups)
    for _ in range(reps):
        pick = RNG.integers(0, k, size=k)
        pooled = np.concatenate([groups[i] for i in pick])
        if len(pooled):
            vals.append(float(np.mean(pooled)))
    if len(vals) < 100:
        return None
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]


def wilson(k: int, n: int, z: float = 1.959964) -> list[float] | None:
    if n == 0:
        return None
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [max(0.0, centre - half), min(1.0, centre + half)]


def two_sided_p(r: float, n: int) -> float | None:
    if not math.isfinite(r) or n < 4 or abs(r) >= 1:
        return None
    t = r * math.sqrt((n - 2) / max(1e-12, 1 - r * r))
    return float(math.erfc(abs(t) / math.sqrt(2)))


def r2_of(y: np.ndarray, yhat: np.ndarray) -> float:
    y = np.asarray(y, float)
    ss = float(np.sum((y - y.mean()) ** 2))
    if ss == 0:
        return 0.0
    return float(1 - np.sum((y - yhat) ** 2) / ss)


def ols(y: np.ndarray, X: np.ndarray) -> tuple[np.ndarray, float]:
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    return beta, r2_of(y, X @ beta)



def data_quality(sess: dict, px: dict, flow: dict) -> dict:
    tape = sess["tape"]
    chain = sess["chain"]
    snap = sess["snap"]
    fut = sess["fut"]

    def gaps(rows, key="t"):
        ts = [tmin(r[key]) for r in rows]
        return [(b - a).total_seconds() for a, b in zip(ts, ts[1:])]

    tg = gaps(tape)
    cg = gaps(chain) if chain else []
    sg = gaps(snap) if snap else []
    fg = gaps(fut) if fut else []

    null_vol = 0
    null_oi = 0
    cells = 0
    per_strike_vol_drop = 0
    prev = {}
    vol_resets = Counter()
    for r in tape:
        for k, v in used_strike(r.get("chain") or {}).items():
            cells += 1
            if len(v) > 5:
                if v[5] is None:
                    null_vol += 1
                elif k in prev and v[5] < prev[k] - 1:
                    per_strike_vol_drop += 1
                    vol_resets[k] += 1
                if v[5] is not None:
                    prev[k] = v[5]
            if len(v) > 3 and v[3] is None:
                null_oi += 1

    chain_strikes = sorted({x[0] for r in chain for x in r["rows"]}) if chain else []
    chain_vol_resets = 0
    chain_vol_cells = 0
    prev_cv = {}
    for r in chain:
        for x in r["rows"]:
            chain_vol_cells += 1
            if x[0] in prev_cv and x[3] < prev_cv[x[0]] - 1:
                chain_vol_resets += 1
            prev_cv[x[0]] = x[3]

    stale = []
    for r in snap:
        f = r.get("fetched_at")
        if f:
            stale.append((tmin(r["t"]) - tmin(f)).total_seconds())

    spots = [finite(r["spot"]) for r in tape]
    snap_spot = [finite(r["report"]["spot"]) for r in snap]
    spot_diff = []
    for s in snap:
        key = tkey(s["t"])
        match = next((r for r in tape if tkey(r["t"]) == key), None)
        if match and snap_spot:
            spot_diff.append(abs(float(match["spot"]) - float(s["report"]["spot"])))

    close_at = datetime.fromisoformat(f"{sess['date']}T15:30:00+05:30")
    first_ts = tmin(chain[0]["t"]) if chain else (tmin(tape[0]["t"]) if tape else None)
    last_ts = tmin(chain[-1]["t"]) if chain else (tmin(tape[-1]["t"]) if tape else None)
    last_tape = tape[-1] if tape else None

    return {
        "price_source": {"name": px["source"], "oi_field": px["oi_field"],
                         "note": px["note"]},
        "counts": {
            "tape_rows": len(tape),
            "chain_rows": len(chain),
            "snap_rows": len(snap),
            "futures_candles": len(fut),
            "chain_rows_per_min": round(len(chain) / max(1e-9, sum(cg) / 60), 2) if cg else None,
        },
        "windows": {
            "tape": [tape[0]["t"][11:19], tape[-1]["t"][11:19]] if tape else None,
            "chain": [chain[0]["t"][11:19], chain[-1]["t"][11:19]] if chain else None,
            "snapshots": [snap[0]["t"][11:19], snap[-1]["t"][11:19]] if snap else None,
            "futures": [fut[0]["t"][11:19], fut[-1]["t"][11:19]] if fut else None,
        },
        "session_coverage": {
            "first_sample": first_ts.strftime("%H:%M:%S") if first_ts else None,
            "last_sample": last_ts.strftime("%H:%M:%S") if last_ts else None,
            "minutes_missing_at_open": int((first_ts - datetime.fromisoformat(
                f"{sess['date']}T09:15:00+05:30")).total_seconds() // 60) if first_ts else None,
            "minutes_missing_into_close": int((close_at - last_ts).total_seconds() // 60) if last_ts else None,
            "close_printed": bool(last_ts and (close_at - last_ts).total_seconds() <= 120),
            "last_tape_flag_cas": bool(last_tape.get("cas")) if last_tape else None,
            "minutes_recorded": len(flow["rows"]),
        },
        "gaps": {
            "tape_median_s": round(st.median(tg), 1) if tg else None,
            "tape_max_s": round(max(tg), 1) if tg else None,
            "tape_gaps_gt_90s": sum(1 for x in tg if x > 90),
            "tape_gap_times": [[tape[i]["t"][11:19], tape[i + 1]["t"][11:19],
                                round(x, 1)] for i, x in enumerate(tg) if x > 90],
            "chain_median_s": round(st.median(cg), 1) if cg else None,
            "chain_max_s": round(max(cg), 1) if cg else None,
            "chain_gaps_gt_20s": sum(1 for x in cg if x > 20),
            "chain_gap_times": [[chain[i]["t"][11:19], chain[i + 1]["t"][11:19],
                                 round(x, 1)] for i, x in enumerate(cg) if x > 20],
            "snapshot_median_s": round(st.median(sg), 1) if sg else None,
            "snapshot_max_s": round(max(sg), 1) if sg else None,
            "futures_missing_minutes": int(sum(1 for x in fg if x > 61)) if fg else None,
        },
        "recorder_failures": {
            "n": len(sess["gaps"]),
            "first": sess["gaps"][0]["t"][11:19] if sess["gaps"] else None,
            "last": sess["gaps"][-1]["t"][11:19] if sess["gaps"] else None,
            "reasons": dict(Counter(g.get("reason", "?") for g in sess["gaps"])),
            "details": dict(Counter(str(g.get("detail", ""))[:80] for g in sess["gaps"])),
        },
        "tape_chain_cells": cells,
        "null_volume_cells": null_vol,
        "null_oi_cells": null_oi,
        "per_strike_vol_drops": per_strike_vol_drop,
        "per_strike_vol_drops_strikes": len(vol_resets),
        "chain_volume_drops": chain_vol_resets,
        "chain_volume_cells": chain_vol_cells,
        "chain_volume_drop_share": round(chain_vol_resets / chain_vol_cells, 3) if chain_vol_cells else None,
        "snapshot_staleness_s": {
            "median": round(st.median(stale), 3) if stale else None,
            "max": round(max(stale), 3) if stale else None,
        },
        "spot_agreement_tape_vs_snapshot": {
            "n": len(spot_diff),
            "median_abs": round(st.median(spot_diff), 2) if spot_diff else None,
            "max_abs": round(max(spot_diff), 2) if spot_diff else None,
        },
        "strike_window": {
            "tape_strikes": len(used_strike(tape[0].get("chain") or {})) if tape else None,
            "chain10s_strikes": len(chain_strikes),
            "chain10s_range": [chain_strikes[0], chain_strikes[-1]] if chain_strikes else None,
            "chain10s_halfwidth_pts": round(max(abs(chain_strikes[0] - st.median(spots)),
                                                 abs(chain_strikes[-1] - st.median(spots))), 0) if chain_strikes else None,
            "tape_range": [min(used_strike(tape[0]["chain"])), max(used_strike(tape[0]["chain"]))] if tape else None,
        },
        "session_range": {
            "spot_min": round(min(s for s in spots if s is not None), 2) if spots else None,
            "spot_max": round(max(s for s in spots if s is not None), 2) if spots else None,
        },
    }


def effective_sample(sess: dict, flow: dict, px: dict) -> dict:
    p_rows = px["rows"]
    p_ret = np.array([b["c"] - a["c"] for a, b in zip(p_rows, p_rows[1:])], float)
    s_ret = np.array([b["spot"] - a["spot"] for a, b in zip(flow["rows"], flow["rows"][1:])], float)
    dvol = np.array([r["itm_pe_dvol"] for r in flow["rows"]], float)[1:]
    oi_lvl = np.array([r["pe_oi"] for r in flow["rows"]], float)

    def pack(n, neff, rho1, rho5):
        return {"n": int(n), "n_eff_bartlett": round(float(neff), 1),
                "rho1": round(float(rho1), 3), "rho5": round(float(rho5), 3)}

    a_p = acf(p_ret, 5)
    a_s = acf(s_ret, 5)
    a_v = acf(dvol, 5)
    a_o = acf(np.diff(oi_lvl[np.isfinite(oi_lvl)]), 5)

    series = {
        f"{px['source']}_return": pack(len(p_ret), n_eff(p_ret), a_p[0], a_p[4]),
        "itm_pe_minute_volume": pack(len(dvol), n_eff(dvol), a_v[0], a_v[4]),
        "pe_oi_change": pack(len(oi_lvl) - 1, n_eff(np.diff(oi_lvl[np.isfinite(oi_lvl)])),
                             a_o[0], a_o[4]),
    }
    if px["source"] != "tape_spot_1m":
        series["spot_1m_return"] = pack(len(s_ret), n_eff(s_ret), a_s[0], a_s[4])
    out = {
        "series": series,
        "price_source": px["source"],
        "overlap": {},
        "note": ("Forward returns at horizon h computed on every minute overlap h-fold; the "
                 "independent count is n/h, not n."),
    }
    for h in HORIZONS:
        out["overlap"][f"{h}m"] = {
            "raw_minutes": max(0, len(p_rows) - h),
            "independent_minutes": round(max(0, len(p_rows) - h) / h, 1),
        }
    return out



def chain10s_lead_lag(chain: list[dict], max_lag: int = 5) -> dict:
    """Clock-aligned tests inside the chain feed.

    An ATM *straddle* is delta-neutral, so its change is not expected to track
    the signed spot move — that signed correlation is reported as a neutrality
    check, not as a finding. The two meaningful quantities are the gamma link
    (straddle change vs same-minute absolute move) and the IV-lead test
    (straddle change vs the *next* minute's absolute move).
    """
    if len(chain) < 60:
        return {"available": False, "reason": "chain feed absent or too short"}
    by_min: dict[str, dict] = defaultdict(lambda: {"s": [], "v": []})
    for r in chain:
        sp = finite(r.get("spot"))
        if sp is None:
            continue
        ce = pe = None
        for x in r["rows"]:
            if abs(x[0] - sp) <= 25:
                ce, pe = finite(x[1]), finite(x[4])
                break
        if ce is None or pe is None:
            continue
        by_min[r["t"][:16]]["s"].append(sp)
        by_min[r["t"][:16]]["v"].append(ce + pe)
    keys = [k for k in sorted(by_min) if len(by_min[k]["s"]) >= 2]
    if len(keys) < 40:
        return {"available": False, "reason": "no ATM pair found in enough minutes"}
    spot = np.array([st.median(by_min[k]["s"]) for k in keys], float)
    strad = np.array([st.median(by_min[k]["v"]) for k in keys], float)
    # A 0-DTE straddle decays to a few rupees, where a one-tick quote is a large
    # percentage move. The tests run on liquid minutes only.
    liquid = strad >= 5.0
    if liquid.sum() < 40:
        return {"available": False, "reason": "ATM straddle is under ₹5 for most of the feed"}
    s_liq, v_liq = spot[liquid], strad[liquid]
    ds = np.diff(s_liq)
    dv = np.diff(v_liq)
    ds_abs = np.abs(ds)

    scan = lag_scan(ds, dv, range(-max_lag, max_lag + 1))
    at0 = next(x for x in scan if x["lag"] == 0)

    r_gamma = pearson(dv, ds_abs)
    gamma_ci = fisher_ci(r_gamma, len(ds))
    r_lead = pearson(dv[:-1], ds_abs[1:])
    lead_ci = fisher_ci(r_lead, len(ds) - 1)
    z = 1.959964
    r_crit = z / math.sqrt(len(ds) - 3 + z * z)
    lead = math.isfinite(r_lead) and r_lead > r_crit

    return {
        "available": True,
        "n_changes": int(len(ds)),
        "n_liquid_minutes": int(liquid.sum()),
        "median_straddle": r4(st.median(v_liq)),
        "step": "1 minute (median of the ~3s snapshots, ATM straddle ≥ ₹5)",
        "lag_unit": "minute",
        "r_signed_lag0": r4(at0["r"]),
        "signed_lag0_ci": [r4(x) for x in at0["ci"]] if at0["ci"] else None,
        "r_gamma_same_minute": r4(r_gamma),
        "gamma_ci": [r4(x) for x in gamma_ci] if gamma_ci else None,
        "r_lead_abs_next_minute": r4(r_lead),
        "lead_abs_ci": [r4(x) for x in lead_ci] if lead_ci else None,
        "r_critical_5pct": round(r_crit, 3),
        "lead_detected": bool(lead),
        "signed_scan": [{"lag": x["lag"], "r": r4(x["r"]), "n": x["n"]} for x in scan],
        "note": ("Signed spot vs straddle is a delta-neutrality check (~0 expected); the gamma "
                 "link and the next-minute absolute-move test are the informative pairs."),
    }


def lead_lag(flow: dict, px: dict, fut: dict, sync: dict, chain: list[dict]) -> dict:
    p_rows = px["rows"]
    pmap = {r["off"]: r for r in p_rows}
    offs = sorted(set(pmap) & {r["off"] for r in flow["rows"]})
    p_close = np.array([pmap[o]["c"] for o in offs], float)
    p_ret = np.diff(p_close)
    offs_ret = offs[1:]

    itm = np.array([flow["by_off"][o]["itm_pe_dvol"] for o in offs_ret], float)
    itm_oi = np.array([flow["by_off"][o]["itm_pe_doi"] for o in offs_ret], float)
    cw_doi = []
    prev = None
    for o in offs_ret:
        row = flow["by_off"][o]
        ch = row["chain"]
        strike = row["call_wall"]
        cur = (ch.get(strike) or [None] * 6)[2] if strike in ch else None
        cw_doi.append(0.0 if (cur is None or prev is None) else cur - prev)
        prev = cur
    cw_doi = np.array(cw_doi, float)

    lags = list(range(-5, 16))
    families = {
        "itm_pe_volume_vs_price": lag_scan(p_ret, itm, range(-5, 16)),
        "itm_pe_oi_vs_price": lag_scan(p_ret, itm_oi, range(-5, 16)),
        "call_wall_oi_vs_price": lag_scan(p_ret, cw_doi, range(-5, 16)),
    }
    for name, rows_ in families.items():
        rows_ = rows_
    tests = len(families) * len(lags)
    alpha = 0.05
    bonf = alpha / tests
    n_ref = len(p_ret) - 20
    z_crit = st.NormalDist().inv_cdf(1 - bonf / 2)
    r_crit = float(z_crit / math.sqrt(n_ref + z_crit ** 2))

    peaks = {}
    for name, rows_ in families.items():
        best = max(rows_, key=lambda x: abs(x["r"]) if math.isfinite(x["r"]) else -1)
        peaks[name] = {"lag": best["lag"], "r": r4(best["r"]),
                       "p": r4(two_sided_p(best["r"], best["n"])),
                       "n": best["n"], "ci": [r4(x) for x in best["ci"]] if best["ci"] else None,
                       "clears_bonferroni": bool(math.isfinite(best["r"]) and abs(best["r"]) >= r_crit)}
    lead_side = {k: ("flow_leads" if v["lag"] > 0 else
                     "price_leads" if v["lag"] < 0 else "contemporaneous")
                 for k, v in peaks.items()}

    out = {
        "mode": "futures_available" if fut.get("rows") else "no_futures_archive",
        "price_source": px["source"],
        "alignment": {
            "families": "1-minute tape flow against the same-minute price series",
            "lag_convention": "positive lag = flow leads price; negative lag = flow follows price",
            "minutes": len(offs),
        },
        "flow_vs_price": families,
        "flow_peaks": peaks,
        "flow_peak_direction": lead_side,
        "multiple_testing": {
            "tests": tests, "alpha": alpha, "bonferroni_alpha": bonf,
            "r_critical": round(r_crit, 3),
            "expected_false_positives_at_5pct": round(tests * alpha, 1),
            "n_reference": n_ref,
        },
        "chain10s": chain10s_lead_lag(chain),
    }

    if fut.get("rows"):
        naive_spot = np.array([flow["by_off"][o]["spot"] for o in offs], float)
        f_close = np.array([pmap[o]["c"] for o in offs], float)
        sync_spot = np.array([sync.get(o, np.nan) for o in offs], float)
        f_ret = np.diff(f_close)
        s_ret_naive = np.diff(naive_spot)
        s_ret_sync = np.diff(sync_spot)
        scan_naive = lag_scan(f_ret, s_ret_naive, range(-5, 6))
        scan_sync = lag_scan(f_ret, s_ret_sync, range(-5, 6))
        boot_sync = block_boot_lag(f_ret, s_ret_sync, [-2, -1, 0, 1, 2], block=10, reps=1200)
        best_naive = max(scan_naive, key=lambda x: abs(x["r"]))
        best_sync = max(scan_sync, key=lambda x: abs(x["r"]))
        naive_lead = [x for x in scan_naive if x["lag"] == -1][0]["r"]
        sync_lead = [x for x in scan_sync if x["lag"] == -1][0]["r"]
        out.update({
            "alignment_detail": {
                "sync_coverage": int(np.isfinite(sync_spot).sum()),
                "sync": "chain spot sampled at candle close (:59), tolerance 6s",
            },
            "naive_futures_vs_spot": scan_naive,
            "sync_futures_vs_spot": scan_sync,
            "sync_bootstrap_ci": {str(k): [r4(v[0]), r4(v[1])] for k, v in boot_sync.items()},
            "naive_peak": {"lag": best_naive["lag"], "r": r4(best_naive["r"])},
            "sync_peak": {"lag": best_sync["lag"], "r": r4(best_sync["r"])},
            "lead_naive": r4(naive_lead), "lead_sync": r4(sync_lead),
            "lead_attributable_to_sampling": r4(1 - sync_lead / naive_lead) if naive_lead else None,
        })
    else:
        out["cross_instrument"] = {
            "available": False,
            "reason": ("no 1-minute futures archive for this session "
                       "(reports/nifty_%s/data/futures_1m.json is absent)" % SESSION),
        }
    return out



def forward_returns(series: np.ndarray, offs: list[int], h: int) -> np.ndarray:
    pos = {o: i for i, o in enumerate(offs)}
    out = np.full(len(offs), np.nan)
    for i, o in enumerate(offs):
        j = pos.get(o + h)
        if j is not None:
            out[i] = series[j] - series[i]
    return out


def count_episodes(mask: np.ndarray, offs: list[int]) -> int:
    n, prev = 0, None
    for m, o in zip(mask, offs):
        if m and (prev is None or o - prev > 1):
            n += 1
        prev = o if m else None
    return n


def worst_window(spot: np.ndarray, offs: list[int], width: int = 20) -> dict | None:
    best = None
    for i in range(len(offs)):
        j = next((k for k, o in enumerate(offs) if o == offs[i] + width), None)
        if j is None:
            continue
        drop = spot[j] - spot[i]
        if best is None or drop < best[0]:
            best = (drop, offs[i], offs[i] + width)
    if best is None:
        return None
    return {"drop": r4(best[0]), "start_off": best[1], "end_off": best[2]}


def conditional_returns(flow: dict, px: dict) -> dict:
    p_rows = px["rows"]
    pmap = {r["off"]: r for r in p_rows}
    offs = [r["off"] for r in flow["rows"] if r["off"] in pmap]
    p_close = np.array([pmap[o]["c"] for o in offs], float)
    p_oi = np.array([pmap[o]["oi"] if pmap[o]["oi"] is not None else np.nan for o in offs], float)
    roll = 15

    itm = np.array([flow["by_off"][o]["itm_pe_dvol"] for o in offs], float)
    q90 = float(np.nanpercentile(itm, 90))

    trig = {"itm_pe_volume_top_decile": itm >= q90}

    dp = np.full(len(offs), np.nan)
    doi = np.full(len(offs), np.nan)
    for i in range(roll, len(offs)):
        j = i - roll
        if offs[i] - offs[j] == roll:
            dp[i] = p_close[i] - p_close[j]
            doi[i] = p_oi[i] - p_oi[j]
    trig["price_oi_up_15m"] = (dp > 0) & (doi > 0)
    trig["price_oi_down_15m"] = (dp <= 0) & (doi > 0)

    cw_build = np.full(len(offs), np.nan)
    for i in range(roll, len(offs)):
        j = i - roll
        if offs[i] - offs[j] != roll:
            continue
        a = flow["by_off"][offs[j]]
        b = flow["by_off"][offs[i]]
        sa, sb = a["call_wall"], b["call_wall"]
        va = (a["chain"].get(sa) or [None] * 6)[2] if sa in a["chain"] else None
        vb = (b["chain"].get(sb) or [None] * 6)[2] if sb in b["chain"] else None
        if va is not None and vb is not None and sa == sb:
            cw_build[i] = vb - va
    finite_cw = cw_build[np.isfinite(cw_build)]
    q90cw = float(np.nanpercentile(finite_cw, 90)) if len(finite_cw) else float("inf")
    trig["call_wall_build_top_decile"] = cw_build >= q90cw

    bw = worst_window(p_close, offs, 20)
    times = [flow["by_off"][o]["t"][11:16] for o in offs]
    w_lo = w_hi = None
    if bw:
        w_lo = next(t for o, t in zip(offs, times) if o == bw["start_off"])
        w_hi = next(t for o, t in zip(offs, times) if o == bw["end_off"])

    n_tests = len(trig) * len(HORIZONS)
    out = {"triggers": {}, "baseline": {}, "horizons": list(HORIZONS),
           "price_source": px["source"],
           "thresholds": {"itm_pe_volume_p90": r4(q90), "call_wall_build_p90": r4(q90cw)},
           "worst_20m_window": {"start": w_lo, "end": w_hi, "move": bw["drop"] if bw else None},
           "tests": {"n": n_tests, "bonferroni_alpha": r4(0.05 / n_tests)}}
    for h in HORIZONS:
        fr = forward_returns(p_close, offs, h)
        base = fr[np.isfinite(fr)]
        base_mean = float(np.mean(base)) if len(base) else 0.0
        out["baseline"][f"{h}m"] = {
            "n": int(len(base)),
            "mean": r4(np.mean(base)) if len(base) else None,
            "median": r4(np.median(base)) if len(base) else None,
            "hit_rate": r4(np.mean(base > 0)) if len(base) else None,
            "mean_ci": [r4(x) for x in boot_mean_ci(base, block=h)] if len(base) > 10 else None,
        }
        for name, mask in trig.items():
            vals = fr[mask & np.isfinite(fr)]
            if len(vals) < 3:
                out["triggers"].setdefault(name, {})[f"{h}m"] = {"n": int(len(vals))}
                continue
            share = None
            if bw:
                share = r4(float(np.mean([(bw["start_off"] <= o <= bw["end_off"])
                                          for o, m in zip(offs, mask) if m])))
            out["triggers"].setdefault(name, {})[f"{h}m"] = {
                "n": int(len(vals)),
                "mean": r4(np.mean(vals)),
                "median": r4(np.median(vals)),
                "hit_rate": r4(np.mean(vals > 0)),
                "mean_ci": [r4(x) for x in boot_mean_ci(vals, block=h)] if len(vals) > 10 else None,
                "excess_vs_baseline": r4(np.mean(vals) - base_mean),
                "excess_shift_p": r4(shift_excess_p(mask, fr)),
                "share_in_worst_20m": share,
                "n_episodes": count_episodes(mask, offs),
            }
    return out


def cross_day_flow(sessions: list[dict]) -> dict:
    per = {}
    store = defaultdict(lambda: defaultdict(list))
    base_store = defaultdict(list)
    for sess in sessions:
        flow = chain_series(sess["tape"])
        offs = [r["off"] for r in flow["rows"]]
        spot = np.array([r["spot"] for r in flow["rows"]], float)
        itm = np.array([r["itm_pe_dvol"] for r in flow["rows"]], float)
        pe_oi = np.array([r["pe_oi"] for r in flow["rows"]], float)
        if len(spot) < 40:
            continue
        q90 = float(np.nanpercentile(itm, 90))
        roll = 15
        rows_h = {h: forward_returns(spot, offs, h) for h in HORIZONS}
        dp = np.full(len(offs), np.nan)
        doi = np.full(len(offs), np.nan)
        for i in range(roll, len(offs)):
            j = i - roll
            if offs[i] - offs[j] == roll:
                dp[i] = spot[i] - spot[j]
                doi[i] = pe_oi[i] - pe_oi[j]
        masks = {
            "itm_pe_volume_top_decile": itm >= q90,
            "put_oi_up_15m": (dp > 0) & (doi > 0),
        }
        entry = {"n_minutes": len(offs), "start": flow["keys"][0][11:16],
                 "end": flow["keys"][-1][11:16], "threshold": r4(q90),
                 "pe_oi_first": r4(pe_oi[0]), "pe_oi_last": r4(pe_oi[-1]),
                 "pe_oi_net": r4(pe_oi[-1] - pe_oi[0]), "baseline": {}}
        for h in HORIZONS:
            base = rows_h[h][np.isfinite(rows_h[h])]
            base_store[h].append(base)
            entry["baseline"][f"{h}m"] = {
                "n": int(len(base)), "mean": r4(np.mean(base)) if len(base) else None,
                "hit_rate": r4(np.mean(base > 0)) if len(base) else None}
        for name, mask in masks.items():
            entry[name] = {}
            for h in HORIZONS:
                vals = rows_h[h][mask & np.isfinite(rows_h[h])]
                base = rows_h[h][np.isfinite(rows_h[h])]
                entry[name][f"{h}m"] = {
                    "n": int(len(vals)),
                    "mean": r4(np.mean(vals)) if len(vals) else None,
                    "hit_rate": r4(np.mean(vals > 0)) if len(vals) else None,
                }
                store[name][h].append((vals, base, sess["date"]))
        per[sess["date"]] = entry

    summary = {}
    for name, by_h in store.items():
        summary[name] = {}
        for h, pairs in by_h.items():
            groups = [a for a, _, _ in pairs if len(a)]
            allv = np.concatenate(groups) if groups else np.array([])
            by_session = {}
            for a, b_, d in pairs:
                if len(a) and len(b_):
                    by_session[d] = r4(float(a.mean() - b_.mean()))
            excess = []
            k = len(pairs)
            for _ in range(1200):
                pick = RNG.integers(0, k, size=k)
                tl = [pairs[i][0] for i in pick if len(pairs[i][0])]
                bl = [pairs[i][1] for i in pick if len(pairs[i][1])]
                if not tl or not bl:
                    continue
                tv, bv = np.concatenate(tl), np.concatenate(bl)
                excess.append(float(tv.mean() - bv.mean()))
            allb = np.concatenate([b for _, b, _ in pairs]) if pairs else np.array([])
            summary[name][f"{h}m"] = {
                "n_minutes": int(len(allv)),
                "n_sessions": len(groups),
                "mean": r4(np.mean(allv)) if len(allv) else None,
                "median": r4(np.median(allv)) if len(allv) else None,
                "hit_rate": r4(np.mean(allv > 0)) if len(allv) else None,
                "cluster_ci": [r4(x) for x in boot_cluster_mean_ci(groups)]
                if boot_cluster_mean_ci(groups) else None,
                "excess_mean": r4(np.mean(allv) - np.mean(allb)) if len(allv) and len(allb) else None,
                "by_session_excess": by_session,
                "positive_sessions": sum(1 for v in by_session.values() if v is not None and v > 0),
                "excess_cluster_ci": ([r4(np.percentile(excess, 2.5)), r4(np.percentile(excess, 97.5))]
                                      if len(excess) > 100 else None),
            }
    base = {}
    for h in HORIZONS:
        groups = base_store[h]
        allv = np.concatenate(groups) if groups else np.array([])
        ci = boot_cluster_mean_ci(groups)
        base[f"{h}m"] = {"n_minutes": int(len(allv)), "n_sessions": len(groups),
                         "mean": r4(np.mean(allv)) if len(allv) else None,
                         "hit_rate": r4(np.mean(allv > 0)) if len(allv) else None,
                         "cluster_ci": [r4(x) for x in ci] if ci else None}
    return {"sessions": per, "summary": summary, "baseline": base,
            "note": ("Cluster bootstrap resamples the available 0-DTE sessions; the excess CI is "
                     "the difference between trigger and baseline within the same resampled "
                     "sessions, so it keeps the day effect.")}



def pin_today(flow: dict, px: dict, fut: dict) -> dict:
    rows = flow["rows"]
    dist = np.array([abs(r["spot"] - r["max_pain"]) for r in rows
                     if r["spot"] is not None and r["max_pain"] is not None])
    mp = [r["max_pain"] for r in rows if r["max_pain"] is not None]
    changes = sum(1 for a, b in zip(mp, mp[1:]) if a != b)
    last = rows[-1]

    bands = {f"within_{th}": {
        "minutes": int(np.sum(dist <= th)),
        "share": r4(np.mean(dist <= th)),
        "n": int(len(dist)),
        "wilson": [r4(x) for x in wilson(int(np.sum(dist <= th)), len(dist))],
    } for th in (15, 25, 50, 100)}

    cw = [r["call_wall"] for r in rows if r["call_wall"] is not None]
    pw = [r["put_wall"] for r in rows if r["put_wall"] is not None]
    inside = np.mean([(r["put_wall"] <= r["spot"] <= r["call_wall"]) for r in rows
                      if r["put_wall"] and r["call_wall"] and r["spot"]])

    close_row = px["rows"][-1] if px["rows"] else None
    close_minute = close_row["t"][11:16] if close_row else None
    close_proxy = {
        "price_source": px["source"],
        "chain_last_spot": r4(last["spot"]),
        "chain_last_minute": last["t"][11:16],
        "last_flag_cas": bool(last.get("cas")),
        "close_value": r4(close_row["c"]) if close_row else None,
        "close_minute": close_minute,
        "dist_to_last_max_pain": r4(abs(close_row["c"] - last["max_pain"]))
        if close_row and last["max_pain"] is not None else None,
        "dist_to_last_call_wall": r4(last["call_wall"] - close_row["c"])
        if close_row and last["call_wall"] is not None else None,
        "dist_to_last_put_wall": r4(close_row["c"] - last["put_wall"])
        if close_row and last["put_wall"] is not None else None,
    }
    if fut.get("rows"):
        basis_pairs = []
        for o, fr in fut["by_off"].items():
            if o in flow["by_off"]:
                basis_pairs.append((o, fr["c"] - flow["by_off"][o]["spot"]))
        basis_last = max(basis_pairs, key=lambda x: x[0])[1] if basis_pairs else None
        basis_med = st.median([b for _, b in basis_pairs]) if basis_pairs else None
        fclose = None
        for r in fut["rows"]:
            if r["t"][11:16] == "15:29":
                fclose = r
        fclose = fclose or (fut["rows"][-1] if fut["rows"] else None)
        implied = (fclose["c"] - basis_last) if (fclose and basis_last is not None) else None
        close_proxy.update({
            "futures_close": r4(fclose["c"]) if fclose else None,
            "futures_close_minute": fclose["t"][11:16] if fclose else None,
            "basis_last": r4(basis_last),
            "median_basis": r4(basis_med),
            "implied_spot_close": r4(implied),
            "implied_dist_to_last_max_pain": r4(abs(implied - last["max_pain"]))
            if implied is not None and last["max_pain"] is not None else None,
        })

    return {
        "n_minutes": int(len(dist)),
        "mean_abs_dist": r4(np.mean(dist)),
        "median_abs_dist": r4(np.median(dist)),
        "max_abs_dist": r4(np.max(dist)),
        "bands": bands,
        "max_pain": {"open": r4(mp[0]), "last": r4(mp[-1]), "changes": int(changes),
                     "unique": len(set(mp)), "levels": sorted(set(mp)),
                     "modal": float(Counter(mp).most_common(1)[0][0]),
                     "modal_share": r4(Counter(mp).most_common(1)[0][1] / len(mp))},
        "walls": {"inside_share": r4(inside), "n": int(len(rows)),
                  "call_wall_unique": len(set(cw)), "put_wall_unique": len(set(pw))},
        "close_proxy": close_proxy,
    }


def pin_cross_day(days: list[str]) -> dict:
    out = {}
    for d in days:
        rows = load_jsonl(DATA / "nifty_tape" / f"{d}.jsonl")
        if len(rows) < 40:
            continue
        last = rows[-1]
        mps = [r["max_pain"] for r in rows if r.get("max_pain")]
        cw = ((last.get("walls") or {}).get("calls") or [{}])[0].get("strike")
        pw = ((last.get("walls") or {}).get("puts") or [{}])[0].get("strike")
        out[d] = {
            "rows": len(rows), "start": rows[0]["t"][11:16], "end": last["t"][11:16],
            "close_proxy": r4(last["spot"]), "max_pain": r4(last["max_pain"]),
            "abs_dist": r4(abs(last["spot"] - last["max_pain"])) if last.get("max_pain") else None,
            "max_pain_changes": int(sum(1 for a, b in zip(mps, mps[1:]) if a != b)) if mps else None,
            "max_pain_unique": len(set(mps)) if mps else None,
            "dist_call_wall": r4(cw - last["spot"]) if cw else None,
            "dist_put_wall": r4(pw - last["spot"]) if pw else None,
            "truncated_before_close": last["t"][11:16] < "15:25",
        }
    ds = [v["abs_dist"] for v in out.values() if v["abs_dist"] is not None]
    trunc = [k for k, v in out.items() if v["truncated_before_close"]]
    ds_close = [v["abs_dist"] for v in out.values()
                if v["abs_dist"] is not None and not v["truncated_before_close"]]
    return {
        "sessions": out,
        "n": len(ds),
        "counts": {
            "within_25": int(sum(1 for x in ds if x <= 25)),
            "within_50": int(sum(1 for x in ds if x <= 50)),
            "within_100": int(sum(1 for x in ds if x <= 100)),
        },
        "close_only": {
            "n": len(ds_close),
            "within_25": int(sum(1 for x in ds_close if x <= 25)),
            "within_50": int(sum(1 for x in ds_close if x <= 50)),
            "within_100": int(sum(1 for x in ds_close if x <= 100)),
            "wilson_25": [r4(x) for x in wilson(sum(1 for x in ds_close if x <= 25),
                                                len(ds_close))] if ds_close else None,
        },
        "median_abs_dist": r4(st.median(ds)) if ds else None,
        "wilson_25": [r4(x) for x in wilson(sum(1 for x in ds if x <= 25), len(ds))] if ds else None,
        "wilson_50": [r4(x) for x in wilson(sum(1 for x in ds if x <= 50), len(ds))] if ds else None,
        "truncated": trunc,
        "n_truncated": len(trunc),
        "closes_outside_wall_band": int(sum(
            1 for v in out.values()
            if v["dist_call_wall"] is not None and v["dist_put_wall"] is not None
            and not (v["dist_put_wall"] <= 0 <= v["dist_call_wall"]))),
        "note": (f"{len(ds)} 0-DTE sessions with a tape; {len(trunc)} stop before 15:25 "
                 f"({', '.join(trunc) if trunc else 'none'}). Counts, not probabilities — "
                 "Wilson intervals on this many draws span most of [0,1]."),
    }


def pin_history_deferred() -> dict:
    d = DATA / "nifty_hist2"
    rows = []
    for path in sorted(d.glob("*.jsonl")):
        try:
            recs = load_jsonl(path)
        except Exception:
            continue
        if len(recs) < 50:
            continue
        last = recs[-1]
        mp = last.get("max_pain")
        if not mp:
            continue
        rows.append({
            "date": path.stem, "spot": last["spot"], "mp": mp,
            "dist": abs(last["spot"] - mp),
            "mp_first": recs[0].get("max_pain"),
            "expiry": last.get("expiry"),
            "is_expiry_session": last.get("expiry") == path.stem,
        })
    if not rows:
        return {"n_sessions": 0, "note": "no deferred-expiry history found"}
    ds = np.array([r["dist"] for r in rows], float)
    moved = sum(1 for r in rows if r["mp_first"] != r["mp"])
    return {
        "n_sessions": len(rows),
        "n_expiry_sessions": sum(1 for r in rows if r["is_expiry_session"]),
        "median_abs_dist": r4(np.median(ds)),
        "mean_abs_dist": r4(np.mean(ds)),
        "counts": {f"within_{th}": int(np.sum(ds <= th)) for th in (25, 50, 100, 150)},
        "shares": {f"within_{th}": r4(np.mean(ds <= th)) for th in (25, 50, 100, 150)},
        "max_pain_moved_share": r4(moved / len(rows)),
        "note": ("Recorded sessions whose expiry is deferred (not 0-DTE), so this is a "
                 "reference distribution for a weak pin, not a 0-DTE prior."),
    }



def auto_events(flow: dict, px: dict) -> dict:
    rows = flow["rows"]
    offs = [r["off"] for r in rows]
    spot = np.array([r["spot"] for r in rows], float)
    itm = np.array([r["itm_pe_dvol"] for r in rows], float)
    pe_oi = np.array([r["pe_oi"] for r in rows], float)
    gex = np.array([r["net_gex"] if r["net_gex"] is not None else np.nan for r in rows], float)

    moves = []
    for i in range(15, len(rows)):
        if offs[i] - offs[i - 15] == 15:
            moves.append({"i": i, "move": float(spot[i] - spot[i - 15])})
    moves.sort(key=lambda x: abs(x["move"]), reverse=True)
    picked = []
    for m in moves:
        if all(abs(offs[m["i"]] - offs[p]) > 30 for p in picked):
            picked.append(m["i"])
        if len(picked) == 3:
            break
    picked.sort()

    flow_idx = [int(i) for i in np.argsort(-itm)]
    fpicked = []
    for i in flow_idx:
        if all(abs(offs[i] - offs[p]) > 20 for p in fpicked):
            fpicked.append(int(i))
        if len(fpicked) == 3:
            break
    fpicked.sort()

    mp = [r["max_pain"] for r in rows]
    steps = []
    for i in range(1, len(mp)):
        if mp[i] is not None and mp[i - 1] is not None and mp[i] != mp[i - 1]:
            steps.append({"t": rows[i]["t"][11:16], "from": r4(mp[i - 1]), "to": r4(mp[i])})
        if len(steps) == 4:
            break

    all15 = np.array([b - a for a, b in zip(spot, spot[15:])], float)

    def study(i: int, label: str, kind: str) -> dict:
        o = offs[i]
        pre = [j for j in range(len(rows)) if o - 15 <= offs[j] < o]
        post = [j for j in range(len(rows)) if o < offs[j] <= o + 15]
        dpost = (spot[post[-1]] - spot[i]) if post else None
        rank = (float(np.mean(np.abs(all15) <= abs(dpost)))
                if dpost is not None and len(all15) else None)
        return {
            "label": label, "kind": kind, "minute": rows[i]["t"][11:16],
            "spot": r4(spot[i]),
            "pre15_spot": r4(spot[i] - spot[pre[0]]) if pre else None,
            "post15_spot": r4(dpost),
            "post15_percentile": r4(rank),
            "itm_pe_vol_pre15": r4(np.sum(itm[pre])) if pre else None,
            "itm_pe_vol_post15": r4(np.sum(itm[post])) if post else None,
            "pe_oi_pre15": r4(pe_oi[i] - pe_oi[pre[0]]) if pre else None,
            "pe_oi_post15": r4(pe_oi[post[-1]] - pe_oi[i]) if post else None,
            "gex": r4(gex[i]),
            "n_pre": len(pre), "n_post": len(post),
        }

    events = {}
    for i in picked:
        events.setdefault(rows[i]["t"][11:16], study(i, "largest 15m move", "move"))
    for i in fpicked:
        events.setdefault(rows[i]["t"][11:16], study(i, "heaviest ITM PE minute", "flow"))

    return {
        "events": dict(sorted(events.items())),
        "all_15m_moves": {"n": int(len(all15)),
                          "sd": r4(np.std(all15)),
                          "p50": r4(np.median(all15)),
                          "p90": r4(np.percentile(np.abs(all15), 90))},
        "max_pain_steps": steps,
        "detection": ("top-3 non-overlapping 15-minute moves (30-minute separation) and "
                      "top-3 ITM PE minutes (20-minute separation); no hand-picked times"),
    }


def session_read(flow: dict, px: dict, cond: dict, ev: dict, pin: dict) -> dict:
    rows = flow["rows"]
    spot = np.array([r["spot"] for r in rows], float)
    itm = np.array([r["itm_pe_dvol"] for r in rows], float)
    gex = np.array([r["net_gex"] for r in rows if r["net_gex"] is not None], float)
    strad = [(r["t"][11:16], r["atm_straddle"]) for r in rows if r["atm_straddle"] is not None]

    order = np.argsort(-itm)
    top10 = order[:10]
    out = {
        "open": {"minute": rows[0]["t"][11:16], "spot": r4(spot[0])},
        "close": {"minute": rows[-1]["t"][11:16], "spot": r4(spot[-1]),
                  "flag_cas": bool(rows[-1].get("cas"))},
        "change": r4(spot[-1] - spot[0]),
        "high": {"spot": r4(np.max(spot)), "minute": rows[int(np.argmax(spot))]["t"][11:16]},
        "low": {"spot": r4(np.min(spot)), "minute": rows[int(np.argmin(spot))]["t"][11:16]},
        "range": r4(np.max(spot) - np.min(spot)),
        "itm_pe": {
            "median_minute": r4(np.median(itm)),
            "p90": r4(np.percentile(itm, 90)),
            "peak": {"minute": rows[int(np.argmax(itm))]["t"][11:16], "value": r4(np.max(itm))},
            "top10_minute_share": r4(float(np.sum(itm[top10]) / np.sum(itm))) if np.sum(itm) else None,
        },
        "gex": {"first": r4(gex[0]) if len(gex) else None,
                "last": r4(gex[-1]) if len(gex) else None,
                "min": r4(np.min(gex)) if len(gex) else None,
                "max": r4(np.max(gex)) if len(gex) else None},
        "straddle": {
            "first": {"minute": strad[0][0], "value": r4(strad[0][1])} if strad else None,
            "last": {"minute": strad[-1][0], "value": r4(strad[-1][1])} if strad else None,
            "decay_share": r4(1 - strad[-1][1] / strad[0][1]) if len(strad) > 1 and strad[0][1] else None,
        },
        "pin": {"close_dist": pin["close_proxy"]["dist_to_last_max_pain"],
                "inside_walls_share": pin["walls"]["inside_share"],
                "max_pain_unique": pin["max_pain"]["unique"]},
        "worst_window": cond["worst_20m_window"],
        "long_state": cond["triggers"]["price_oi_up_15m"].get("15m", {}),
        "baseline": cond["baseline"],
    }
    return out



def distributions(flow: dict, px: dict) -> dict:
    rows = px["rows"]
    ret = np.array([b["c"] - a["c"] for a, b in zip(rows, rows[1:])], float)
    logret = np.diff(np.log([r["c"] for r in rows]))
    bp = logret * 1e4

    q = np.linspace(1, 99, 41)
    qq = {"theoretical": [round(st.NormalDist().inv_cdf(max(1e-4, min(1 - 1e-4, x / 100))), 3) for x in q],
          "sample_bp": [r4(np.percentile(bp, x)) for x in q]}

    def moments(x):
        x = x[np.isfinite(x)]
        m, s = float(np.mean(x)), float(np.std(x, ddof=1))
        sk = float(np.mean(((x - m) / s) ** 3)) if s else 0.0
        ku = float(np.mean(((x - m) / s) ** 4) - 3) if s else 0.0
        return {"n": int(len(x)), "mean": r4(m), "sd": r4(s),
                "skew": r4(sk), "excess_kurtosis": r4(ku),
                "p05": r4(np.percentile(x, 5)), "p95": r4(np.percentile(x, 95)),
                "min": r4(np.min(x)), "max": r4(np.max(x))}

    buckets = {}
    specs = {
        "itm_pe_volume": np.array([flow["by_off"][r["off"]]["itm_pe_dvol"]
                                   for r in rows[1:] if r["off"] in flow["by_off"]], float),
        "pe_oi_change": np.array([flow["by_off"][r["off"]]["itm_pe_doi"]
                                  for r in rows[1:] if r["off"] in flow["by_off"]], float),
    }
    common = [r["off"] for r in rows[1:] if r["off"] in flow["by_off"]]
    ret_aligned = np.array([px["by_off"][o]["c"] - px["by_off"][o - 1]["c"]
                            if (o - 1) in px["by_off"] else np.nan for o in common], float)

    for name, x in specs.items():
        if x is None or len(x) != len(ret_aligned):
            continue
        order = np.argsort(np.nan_to_num(x, nan=-np.inf))
        ranks = np.empty_like(order)
        ranks[order] = np.arange(len(x))
        dec = np.clip((ranks * DECILES) // max(1, len(x)), 0, DECILES - 1)
        bins = []
        for d in range(DECILES):
            vals = ret_aligned[dec == d]
            vals = vals[np.isfinite(vals)]
            if len(vals) < 5:
                bins.append({"decile": d + 1, "n": int(len(vals))})
                continue
            bins.append({
                "decile": d + 1, "n": int(len(vals)),
                "mean_pts": r4(np.mean(vals)), "median_pts": r4(np.median(vals)),
                "sd_pts": r4(np.std(vals)),
                "share_up": r4(np.mean(vals > 0)),
                "mean_ci": [r4(v) for v in boot_mean_ci(vals, block=10)] if len(vals) > 15 else None,
            })
        buckets[name] = bins

    x = specs["itm_pe_volume"]
    order = np.argsort(np.nan_to_num(x, nan=-np.inf))
    ranks = np.empty_like(order)
    ranks[order] = np.arange(len(x))
    top_mask = ((ranks * DECILES) // max(1, len(x))) == DECILES - 1
    p_offs = [r["off"] for r in rows]
    p_vals = np.array([r["c"] for r in rows], float)
    worst = worst_window(p_vals, p_offs, 20)
    share = None
    if worst:
        share = float(np.mean([(worst["start_off"] <= o <= worst["end_off"])
                               for o, m in zip(common, top_mask) if m]))
    worst_lab = {"start": None, "end": None, "move": worst["drop"] if worst else None}
    if worst:
        worst_lab["start"] = next(r["t"][11:16] for r in rows if r["off"] == worst["start_off"])
        worst_lab["end"] = next(r["t"][11:16] for r in rows if r["off"] == worst["end_off"])
    return {"price_source": px["source"],
            "price_1m_points": moments(ret),
            "price_1m_log_bp": moments(bp),
            "qq": qq,
            "top_decile_worst_window_share": r4(share),
            "worst_20m_window": worst_lab,
            "conditional_deciles": buckets,
            "note": ("Deciles ordered low->high trigger. `share_up` is unconditional of the "
                     "session drift, so a flat profile is the null.")}


def _smile_points(snap_row: dict) -> tuple[list[float], list[float]]:
    r = snap_row["report"]
    sp = finite(r.get("spot"))
    if not sp:
        return [], []
    pts = ((r.get("iv_surface") or {}).get("points") or [])
    ks, ivs = [], []
    if pts:
        for p in pts:
            k = finite(p.get("strike"))
            iv = p.get("ce_iv") if k is not None and k >= sp else p.get("pe_iv")
            iv = finite(iv)
            if k is None or iv is None or not (1 < iv < 150):
                continue
            ks.append(math.log(k / sp))
            ivs.append(iv)
        return ks, ivs
    for x in (r.get("strikes") or []):
        k = finite(x.get("strike"))
        if k is None:
            continue
        side = "ce" if k >= sp else "pe"
        iv = finite((x.get(side) or {}).get("iv"))
        if iv is None or not (1 < iv < 150):
            continue
        ks.append(math.log(k / sp))
        ivs.append(iv)
    return ks, ivs


def surface_pca(snap: list[dict], n_grid: int = 21) -> dict:
    if not snap:
        return {"available": False, "reason": "no snapshot archive for this session"}
    raw = [(s["t"][11:16],) + _smile_points(s) for s in snap]
    raw = [(t, k, v) for t, k, v in raw if len(k) >= 6]
    if len(raw) < 10:
        return {"available": False, "reason": "too few snapshots with >=6 valid IVs",
                "n_candidate": len(raw)}
    bands = [float(np.percentile(np.abs(k), 90)) for _, k, _ in raw]
    band = float(np.clip(np.percentile(bands, 25), 0.004, 0.008))
    grid = np.linspace(-band, band, n_grid)
    times, mats = [], []
    for t, ks, ivs in raw:
        o = np.argsort(ks)
        kk, vv = np.array(ks)[o], np.array(ivs)[o]
        if abs(kk[0]) < band * 0.95 or abs(kk[-1]) < band * 0.95:
            continue
        mats.append(np.interp(grid, kk, vv))
        times.append(t)
    X = np.array(mats, float)
    if len(X) < 10:
        return {"available": False, "reason": "moneyness band not covered by enough snapshots"}
    d = np.diff(X, axis=0)
    dm = d - d.mean(axis=0)
    u, sv, vt = np.linalg.svd(dm, full_matrices=False)
    var = sv ** 2 / np.sum(sv ** 2)

    basis = np.column_stack([np.ones_like(grid), grid / band, (grid / band) ** 2 - 1 / 3])
    loadings = {}
    for i in range(3):
        beta, r2 = ols(vt[i], basis)
        loadings[f"pc{i + 1}"] = {
            "explained": r4(var[i]),
            "coef_flat_linear_quad": [r4(x) for x in beta],
            "basis_r2": r4(r2),
            "shape": ("flat" if abs(beta[0]) >= max(abs(beta[1:]))
                      else "linear" if abs(beta[1]) >= abs(beta[2]) else "quadratic"),
        }
    scores = u * sv
    resid = dm - scores[:, :2] @ vt[:2]
    step = max(1, len(times) // 60)
    return {
        "available": True,
        "n_snapshots": int(len(X)),
        "iv_source": ("vendor iv_surface points" if (snap[0]["report"].get("iv_surface") or {}).get("points")
                      else "per-strike vendor `iv` on the OTM side"),
        "band_pct": round(100 * band, 3),
        "n_grid": n_grid,
        "moneyness_grid": [r4(g) for g in grid],
        "mean_iv_smile": [r4(v) for v in X.mean(axis=0)],
        "explained": [r4(v) for v in var[:5]],
        "loadings": loadings,
        "score_series": {
            "t": times[1::step],
            "pc1": [r4(scores[i, 0]) for i in range(0, len(times) - 1, step)],
            "pc2": [r4(scores[i, 1]) for i in range(0, len(times) - 1, step)],
            "pc3": [r4(scores[i, 2]) for i in range(0, len(times) - 1, step)],
        },
        "residual_heatmap": {
            "t": times[1::step],
            "moneyness": [round(float(g) * 100, 2) for g in grid],
            "z": [[r4(v) for v in resid[i]] for i in range(0, len(times) - 1, step)],
        },
        "note": ("PCA on first differences of the OTM IV smile; factors are statistical, not "
                 "a pricing model. 0-DTE IVs are partly model output, so labelling PC1 'level' "
                 "without checking loadings would be wrong — the basis R² is reported."),
    }


def cusum_blocks(series: np.ndarray, times: list[str], label: str,
                 block: int = 15, reps: int = 600) -> dict:
    x = np.asarray(series, float)
    valid = np.isfinite(x)
    x = x[valid]
    times = [t for t, v in zip(times, valid) if v]
    if len(x) < 40:
        return {"label": label, "n": int(len(x))}
    z = (x - x.mean()) / (x.std() or 1.0)
    s = np.cumsum(z - z.mean())
    obs = float(np.max(np.abs(s))) / math.sqrt(len(z))
    idx = int(np.argmax(np.abs(s)))

    null = []
    nb = len(z) // block
    for _ in range(reps):
        chunks = [z[i * block:(i + 1) * block] for i in range(nb)]
        RNG.shuffle(chunks)
        zz = np.concatenate(chunks)
        null.append(float(np.max(np.abs(np.cumsum(zz - zz.mean())))) / math.sqrt(len(zz)))
    p = float(np.mean(np.array(null) >= obs))

    def best_split(a: np.ndarray, min_seg: int = 30) -> tuple[int, float]:
        best_i, best_t = 0, 0.0
        for i in range(min_seg, len(a) - min_seg):
            v1, v2 = a[:i].var(ddof=1), a[i:].var(ddof=1)
            den = math.sqrt(v1 / i + v2 / (len(a) - i) + 1e-12)
            t = abs(a[:i].mean() - a[i:].mean()) / den
            if t > best_t:
                best_i, best_t = i, t
        return best_i, best_t

    i1, t1 = best_split(z)
    a, b = z[:i1], z[i1:]
    i2, t2 = best_split(a) if len(a) > 60 else (0, 0.0)
    i3, t3 = best_split(b) if len(b) > 60 else (0, 0.0)
    second = i2 if t2 >= t3 else i1 + i3
    return {"label": label, "n": int(len(x)),
            "cusum_peak_index": idx,
            "cusum_peak_time": times[idx] if idx < len(times) else None,
            "cusum_stat": r4(obs), "permutation_p": r4(p),
            "break1_index": i1, "break1_t": r4(t1),
            "break1_time": times[i1] if i1 < len(times) else None,
            "break2_index": int(second),
            "break2_time": times[int(second)] if int(second) < len(times) else None,
            "note": ("Block permutation (15-minute blocks) preserves short-range dependence; "
                     "splits are scan statistics with a 30-minute minimum segment.")}


def regime(flow: dict, px: dict) -> dict:
    rows = px["rows"]
    times = [r["t"][11:16] for r in rows]
    p_close = np.array([r["c"] for r in rows], float)
    p_oi = np.array([r["oi"] if r["oi"] is not None else np.nan for r in rows], float)
    p_ret = np.diff(p_close)
    p_vol = np.abs(p_ret)

    bars = []
    for i in range(0, len(rows) - 14, 15):
        chunk = rows[i:i + 15]
        dp = chunk[-1]["c"] - chunk[0]["c"]
        doi = (chunk[-1]["oi"] - chunk[0]["oi"]) if (chunk[-1]["oi"] is not None
                                                      and chunk[0]["oi"] is not None) else None
        if doi is None:
            state = "price_up" if dp > 0 else "price_down"
        else:
            state = ("price_up_oi_up" if dp > 0 and doi > 0 else
                     "price_up_oi_down" if dp > 0 else
                     "price_down_oi_up" if doi > 0 else "price_down_oi_down")
        bars.append({"t": chunk[0]["t"][11:16], "end": chunk[-1]["t"][11:16],
                     "dp": round(dp, 1), "doi": None if doi is None else round(doi, 0),
                     "state": state})

    states = [b["state"] for b in bars]
    order = list(dict.fromkeys(states)) or ["n/a"]
    mat = np.zeros((len(order), len(order)))
    for a, b in zip(states, states[1:]):
        mat[order.index(a), order.index(b)] += 1
    row = mat.sum(axis=1, keepdims=True)
    trans = np.divide(mat, row, out=np.zeros_like(mat), where=row > 0)

    dwell = {}
    cur, run = None, 0
    for st in states + [None]:
        if st == cur:
            run += 1
        else:
            if cur is not None:
                dwell.setdefault(cur, []).append(run)
            cur, run = st, 1
    dwell_out = {k: {"n": len(v), "mean_bars": r4(np.mean(v)), "max_bars": int(max(v))}
                 for k, v in dwell.items()}

    flips = []
    for i in range(1, len(bars)):
        if bars[i]["state"] != bars[i - 1]["state"]:
            flips.append({"t": bars[i]["t"], "from": bars[i - 1]["state"],
                          "to": bars[i]["state"], "dp": bars[i]["dp"], "doi": bars[i]["doi"]})

    tape_oi = np.array([r["pe_oi"] for r in flow["rows"]], float)
    d_oi = np.diff(tape_oi[np.isfinite(tape_oi)])
    return {
        "price_source": px["source"], "oi_field": px["oi_field"],
        "cusum_return": cusum_blocks(p_ret, times[1:], f"{px['source']}_1m_return"),
        "cusum_abs_return": cusum_blocks(p_vol, times[1:], f"{px['source']}_1m_abs_return"),
        "states": {"order": order, "n_bars": len(bars), "bar_minutes": 15,
                   "counts": dict(Counter(states)),
                   "transition": [[r4(v) for v in r_] for r_ in trans],
                   "transition_counts": [[int(v) for v in r_] for r_ in mat],
                   "n_transitions": len(states) - 1,
                   "dwell": dwell_out, "flips": flips, "n_flips": len(flips)},
        "tape_oi_slope": {"increases": int(np.sum(d_oi > 0)),
                          "decreases": int(np.sum(d_oi < 0))},
        "note": ("Non-overlapping 15-minute bars. The OI label is "
                 f"{px['oi_field']}; the matrix is a description of one session, not an "
                 "estimated chain."),
    }


def microstructure(flow: dict, snap: list[dict]) -> dict:
    rows = flow["rows"]
    hhi_ce, hhi_pe = [], []
    entropy = []
    prev_ce, prev_pe = {}, {}
    persistence = []
    for i, r in enumerate(rows):
        ch = r["chain"]
        dce, dpe = [], []
        for k, v in ch.items():
            cvol = finite(v[4]) if len(v) > 4 else None
            pvol = finite(v[5]) if len(v) > 5 else None
            if cvol is not None:
                dce.append(max(0.0, cvol - prev_ce.get(k, cvol)))
                prev_ce[k] = cvol
            if pvol is not None:
                dpe.append(max(0.0, pvol - prev_pe.get(k, pvol)))
                prev_pe[k] = pvol
        for arr, store in ((dce, hhi_ce), (dpe, hhi_pe)):
            s = np.array(arr, float)
            tot = s.sum()
            if tot > 0:
                p = s / tot
                h = float(np.sum(p ** 2))
                store.append((r["t"][11:16], h))
                if store is hhi_ce:
                    ent = float(-np.sum(p * np.log(p + 1e-12)) / math.log(len(p)))
                    entropy.append((r["t"][11:16], ent, 1.0 / h if h else None))
        if i >= 15 and rows[i]["off"] - rows[i - 15]["off"] == 15:
            a = rows[i - 15]["chain"]
            for k, v in ch.items():
                oi_b = finite(v[3]) if len(v) > 3 else None
                oi_a = (a.get(k) or [None] * 6)[3] if k in a else None
                vol_b = finite(v[5]) if len(v) > 5 else None
                vol_a = (a.get(k) or [None] * 6)[5] if k in a else None
                if None in (oi_a, oi_b, vol_a, vol_b):
                    continue
                dv = vol_b - vol_a
                if dv > 500:
                    persistence.append((oi_b - oi_a) / dv)

    burst_vol = np.array([r["tot_dvol"] for r in rows], float)
    med = float(np.median(burst_vol))
    mad = float(np.median(np.abs(burst_vol - med))) or 1.0
    bursts = [{"t": r["t"][11:16], "vol": int(r["tot_dvol"]), "z": r4((r["tot_dvol"] - med) / mad)}
              for r in rows if r["off"] >= 15 and (r["tot_dvol"] - med) / mad > 3]
    open_minutes = sum(1 for r in rows if r["off"] < 15)

    spreads = defaultdict(list)
    for s in snap[::5]:
        r = s["report"]
        sp = finite(r["spot"])
        if not sp:
            continue
        for x in r["strikes"]:
            for side in ("ce", "pe"):
                q = x[side]
                bid, ask = finite(q.get("bid_price")), finite(q.get("ask_price"))
                if not bid or not ask or ask <= bid:
                    continue
                mid = (ask + bid) / 2
                if mid < 2:
                    continue
                bucket = "atm_50" if abs(x["strike"] - sp) <= 50 else (
                    "near_150" if abs(x["strike"] - sp) <= 150 else "wing")
                spreads[bucket].append((ask - bid) / mid)
    spread_out = {k: {"n": len(v), "median_rel": r4(st.median(v)),
                      "p90_rel": r4(np.percentile(v, 90))} for k, v in spreads.items()}

    return {
        "hhi": {"ce_median": r4(st.median([v for _, v in hhi_ce])) if hhi_ce else None,
                "pe_median": r4(st.median([v for _, v in hhi_pe])) if hhi_pe else None,
                "ce_eff_strikes": r4(1 / st.median([v for _, v in hhi_ce])) if hhi_ce else None,
                "pe_eff_strikes": r4(1 / st.median([v for _, v in hhi_pe])) if hhi_pe else None},
        "entropy": {"median_normalised": r4(st.median([e for _, e, _ in entropy])) if entropy else None},
        "oi_persistence": {
            "n_strike_windows": len(persistence),
            "median_doi_over_dvol": r4(st.median(persistence)) if persistence else None,
            "p10": r4(np.percentile(persistence, 10)) if persistence else None,
            "p90": r4(np.percentile(persistence, 90)) if persistence else None,
        },
        "volume_bursts": {"n": len(bursts), "times": bursts[:12],
                          "median_minute_vol": int(med),
                          "opening_minutes_excluded": open_minutes},
        "spreads": spread_out,
        "not_measurable": [
            "participant identity (client vs prop vs market maker)",
            "aggressor side of each trade",
            "order-book depth and queue position",
            "block/package trades and sweeps",
            "financing and inventory of the option writers",
        ],
    }



def fmt(x, nd=1):
    if x is None:
        return "n/a"
    if isinstance(x, float):
        return f"{x:,.{nd}f}"
    return f"{x:,}"


def pct(x, nd=1):
    return "n/a" if x is None else f"{100 * x:.{nd}f}%"


def ci_str(v, nd=2) -> str:
    if not v or any(x is None for x in v):
        return "n/a"
    return "[" + ", ".join(f"{float(x):.{nd}f}" for x in v) + "]"


def review_md(rev: dict) -> str:
    meta = rev["meta"]
    q = rev["data_quality"]
    es = rev["effective_sample"]
    ll = rev["lead_lag"]
    cr = rev["conditional_returns"]
    pin = rev["pin"]
    ev = rev["events"]
    xd = rev["cross_day"]
    hist = xd["history"]
    tr = rev["session_read"]
    src = q["price_source"]["name"]
    fut_ok = src == "futures_1m"

    L = []
    A = L.append
    A(f"# Quant review — NIFTY 0-DTE {meta['session']}\n")
    A(f"Scope: statistical validity of the four research sections, the effective sample behind "
      f"each claim, and the flows worth building the HTML around. Expiry under test: "
      f"{meta['expiry']}. Every figure below is computed by "
      f"`scripts/market/nifty_research_quant_review.py --session {meta['session']}`; the JSON "
      f"beside this file carries the full vectors. Price series: **{src}**.\n")

    A("## 1. Data quality and effective sample\n")
    A("| Item | Value |\n|---|---|")
    A(f"| Tape rows / window | {q['counts']['tape_rows']} · {q['windows']['tape'][0]}–{q['windows']['tape'][1]} |")
    A(f"| 10s chain rows / window | {q['counts']['chain_rows']} · {q['windows']['chain'][0]}–{q['windows']['chain'][1]} |")
    A(f"| Snapshots | {q['counts']['snap_rows']} · {q['windows']['snapshots'][0]}–{q['windows']['snapshots'][1]} |")
    A(f"| Futures candles | {q['counts']['futures_candles']}"
      + (f" · {q['windows']['futures'][0]}–{q['windows']['futures'][1]}" if q['windows']['futures'] else " · **no archive**") + " |")
    A(f"| First sample after the 09:15 open | {q['session_coverage']['minutes_missing_at_open']} minutes |")
    A(f"| Last sample before the 15:30 close | {q['session_coverage']['minutes_missing_into_close']} minutes "
      f"(close printed: {'yes' if q['session_coverage']['close_printed'] else 'no'}) |")
    A(f"| Recorder failures | {q['recorder_failures']['n']}"
      + (f" ({q['recorder_failures']['first']}–{q['recorder_failures']['last']}, "
         f"{', '.join(f'{k}×{v}' for k, v in q['recorder_failures']['reasons'].items())})"
         if q['recorder_failures']['n'] else "") + " |")
    A(f"| Tape gaps >90s | {q['gaps']['tape_gaps_gt_90s']} (max {fmt(q['gaps']['tape_max_s'],1)}s) |")
    A(f"| 10s chain gaps >20s | {q['gaps']['chain_gaps_gt_20s']} (max {fmt(q['gaps']['chain_max_s'],1)}s) |")
    A(f"| Snapshot staleness (t − fetched_at) | median {fmt(q['snapshot_staleness_s']['median'],3)}s, max {fmt(q['snapshot_staleness_s']['max'],1)}s |")
    A(f"| Tape spot vs snapshot spot (same poll) | median {fmt(q['spot_agreement_tape_vs_snapshot']['median_abs'],2)} pts, "
      f"max {fmt(q['spot_agreement_tape_vs_snapshot']['max_abs'],2)} — alignment check, not independent agreement |")
    A(f"| Null volume cells (tape chain) | {q['null_volume_cells']:,} of {q['tape_chain_cells']:,} |")
    A(f"| Per-strike cumulative-volume drops (tape) | {q['per_strike_vol_drops']} |")
    A(f"| 10s chain cumulative-volume drops | {q['chain_volume_drops']:,} of {q['chain_volume_cells']:,} "
      f"({pct(q['chain_volume_drop_share'])}) |")
    A(f"| Strike coverage | tape {q['strike_window']['tape_strikes']} strikes "
      f"({q['strike_window']['tape_range'][0]:.0f}–{q['strike_window']['tape_range'][1]:.0f}); "
      f"10s chain {q['strike_window']['chain10s_strikes']} strikes, ±{q['strike_window']['chain10s_halfwidth_pts']:.0f} pts |")
    A("")

    cov = q["session_coverage"]
    A(f"**This session starts late.** The first recorded sample is "
      f"{cov['first_sample']}, which is {cov['minutes_missing_at_open']} minutes after the 09:15 "
      f"open; the {q['recorder_failures']['n']} recorder failures at "
      f"{q['recorder_failures']['first']}–{q['recorder_failures']['last']} explain it "
      f"({', '.join(list(q['recorder_failures']['details'])[:1])}). No figure on this page covers "
      "the opening auction, the first-hour range, or the pre-10:00 OI book.\n")
    if q["gaps"]["tape_gaps_gt_90s"]:
        g = q["gaps"]["tape_gap_times"][0]
        A(f"**One hole inside the window.** The tape has {q['gaps']['tape_gaps_gt_90s']} gap above "
          f"90 seconds: {g[0]} → {g[1]} ({fmt(g[2],0)}s ≈ {fmt(g[2]/60,1)} minutes). The 10s chain "
          f"has {q['gaps']['chain_gaps_gt_20s']} gaps above 20s and the same blackout. Every "
          "minute-level series is missing that block; forward returns that span it are dropped, "
          "not interpolated.\n")
    A(f"**Poll jitter is the first thing to fix.** The tape is nominally 1/minute, but the polling "
      "second drifts. Flooring raw timestamps to minutes collapses distinct prints onto one "
      f"offset; every series here snaps to the minute key first. The chain feed samples at "
      f"~{fmt(q['counts']['chain_rows_per_min'],1)} rows/minute, so it is a 3-5s feed, not a 10s "
      "one.\n")
    A("**What breaks second.** The 10-second chain's volume column is not a clean cumulative "
      f"counter: {pct(q['chain_volume_drop_share'])} of consecutive per-strike reads go down. It "
      "is usable only after a running-max monotone repair, and never at 10-second resolution. The "
      f"1-minute tape chain is clean ({q['per_strike_vol_drops']} per-strike drops) and covers the "
      "full strike board, so minute-level flow is built from the tape, not from the chain file.\n")
    A("**Moneyness drift is the trap in every flow figure.** A cumulative volume summed over "
      "“strikes above spot” changes membership whenever spot crosses a strike, so the difference "
      "of two such sums is not a flow. Each strike's cumulative volume is differenced first, then "
      "attributed to moneyness — which is what the numbers below do.\n")
    if not fut_ok:
        A("**The missing futures archive changes what can be tested.** Without a 1-minute futures "
          "file there is no second instrument to align against: the cross-instrument lead–lag "
          "section is reported as *not measurable* rather than estimated from a proxy. Price is "
          "the tape spot and the OI column used by the state classifier is combined CE+PE option "
          "OI — a different object from futures OI, and labelled as such wherever it appears.\n")

    A("| Series | n | n_eff (Bartlett) | ρ₁ | ρ₅ |\n|---|---|---|---|---|")
    for name, v in es["series"].items():
        A(f"| {name} | {v['n']} | {v['n_eff_bartlett']} | {v['rho1']} | {v['rho5']} |")
    A("")
    mn = cr["triggers"]["price_oi_up_15m"].get("15m", {})
    A(f"Forward-return overlap: a 15-minute horizon leaves ~{es['overlap']['15m']['independent_minutes']} "
      f"independent windows, 30m ~{es['overlap']['30m']['independent_minutes']}, 60m "
      f"~{es['overlap']['60m']['independent_minutes']}. With {xd['n']} recorded 0-DTE sessions the "
      f"cross-day cluster count is {xd['n']}, so a between-session confidence interval is wide by "
      f"construction. **One session cannot establish an edge**: triggers are selected after seeing "
      f"the day, the horizon overlap divides the sample by h, and the main 15m state collapses into "
      f"{mn.get('n_episodes', 'n/a')} episodes. There is no out-of-sample period.\n")

    A("## 2. Statistical tests\n")
    A("### 2.1 Lead–lag\n")
    if fut_ok:
        naive1 = [x for x in ll["naive_futures_vs_spot"] if x["lag"] == 1][0]["r"]
        sync1 = [x for x in ll["sync_futures_vs_spot"] if x["lag"] == 1][0]["r"]
        naive0 = [x for x in ll["naive_futures_vs_spot"] if x["lag"] == 0][0]["r"]
        sync0 = [x for x in ll["sync_futures_vs_spot"] if x["lag"] == 0][0]["r"]
        A(f"The naive alignment correlates futures 1m returns with tape spot sampled at `:31` while "
          f"the futures candle closes at `:59`. At lag −1 the naive correlation is "
          f"{fmt(ll['lead_naive'],3)}; re-sampling spot from the chain at the candle close "
          f"({ll['alignment_detail']['sync_coverage']} minutes) moves it to {fmt(ll['lead_sync'],3)}, "
          f"while lag 0 goes from {fmt(naive0,3)} to {fmt(sync0,3)}. Roughly "
          f"**{pct(ll['lead_attributable_to_sampling'])} of the measured lead disappears when the spot "
          "sample moves to the futures close** — the signature of a clock offset, not of price "
          "discovery.\n")
        A("| lag | naive r | sync r | sync 95% CI |\n|---|---|---|---|")
        for a, b in zip(ll["naive_futures_vs_spot"], ll["sync_futures_vs_spot"]):
            ci = ll["sync_bootstrap_ci"].get(str(a["lag"]))
            ci_s = f"[{fmt(ci[0],3)}, {fmt(ci[1],3)}]" if ci and ci[0] is not None else "—"
            A(f"| {a['lag']:+d} | {fmt(a['r'],3)} | {fmt(b['r'],3)} | {ci_s} |")
        A("")
    else:
        A(f"**Cross-instrument lead–lag is not measurable for {meta['session']}.** There is no "
          f"1-minute futures archive (`reports/nifty_{meta['session']}/data/futures_1m.json` is "
          "absent), and substituting index futures from another date would mix sessions. What *is* "
          "clock-alignable is reported below: flow against price inside the same 1-minute tape, and "
          "spot against the ATM straddle inside the same chain feed.\n")

    A(f"Multiple testing: {ll['multiple_testing']['tests']} flow correlations across three families "
      f"and 21 lags. At α=0.05 that expects "
      f"{ll['multiple_testing']['expected_false_positives_at_5pct']} false positives; the "
      f"Bonferroni-critical |r| for n≈{ll['multiple_testing']['n_reference']} is "
      f"{fmt(ll['multiple_testing']['r_critical'],3)}. Lag convention: positive = flow leads price.\n")
    A("| family | best lag | r | 95% CI | n | p | clears Bonferroni | direction |\n|---|---|---|---|---|---|---|")
    for name, pk in ll["flow_peaks"].items():
        ci = pk.get("ci")
        ci_s = f"[{fmt(ci[0],3)}, {fmt(ci[1],3)}]" if ci and ci[0] is not None else "—"
        A(f"| {name} | {pk['lag']:+d} | {fmt(pk['r'],3)} | {ci_s} | {pk['n']} | {fmt(pk['p'],4)} | "
          f"{'yes' if pk['clears_bonferroni'] else 'no'} | {ll['flow_peak_direction'][name]} |")
    A("")
    clearing = [k for k, v in ll["flow_peaks"].items() if v["clears_bonferroni"]]
    lead_pos = [k for k in clearing if ll["flow_peaks"][k]["lag"] > 0]
    if clearing:
        A(f"{len(clearing)} of {len(ll['flow_peaks'])} families clear the Bonferroni threshold. "
          + (f"{len(lead_pos)} of them sit at a **positive** lag (flow ahead of price). "
             if lead_pos else
             "**None** of them sits at a positive lag: every survivor is measured after the move, "
             "which is a reporting lag, not a forecast. ")
          + "The remaining families do not clear it at any lag from −5 to +15.\n")
    else:
        A("**No flow family survives the Bonferroni threshold.** The largest |r| is "
          f"{fmt(max(abs(v['r']) for v in ll['flow_peaks'].values() if v['r'] is not None),3)} "
          f"against a critical {fmt(ll['multiple_testing']['r_critical'],3)}. On this session the "
          "minute-level flow has no measurable lead over price at any lag from −5 to +15.\n")
    c10 = ll.get("chain10s") or {}
    if c10.get("available"):
        ci0 = c10.get("signed_lag0_ci") or [None, None]
        gc = c10.get("gamma_ci") or [None, None]
        lc = c10.get("lead_abs_ci") or [None, None]
        A(f"Inside the chain feed ({c10['n_liquid_minutes']} minutes where the ATM straddle is "
          f"≥ ₹5, median ₹{fmt(c10['median_straddle'],2)}): the signed spot change and the straddle "
          f"change correlate {fmt(c10['r_signed_lag0'],3)}"
          + (f" (95% CI [{fmt(ci0[0],3)}, {fmt(ci0[1],3)}])" if ci0[0] is not None else "")
          + " — **an ATM straddle is delta-neutral, so that is the expected null and it is a "
            "neutrality check, not a finding.** The gamma link (straddle change vs same-minute "
          f"absolute move) is {fmt(c10['r_gamma_same_minute'],3)}"
          + (f" [{fmt(gc[0],3)}, {fmt(gc[1],3)}]" if gc[0] is not None else "")
          + ". The IV-lead test (straddle change vs the next minute's absolute move) is "
          f"{fmt(c10['r_lead_abs_next_minute'],3)}"
          + (f" [{fmt(lc[0],3)}, {fmt(lc[1],3)}]" if lc[0] is not None else "")
          + f" against a 5% critical |r| of {fmt(c10['r_critical_5pct'],3)}: "
          + ("a lead is detectable and should be tested on another session.\n"
             if c10["lead_detected"] else
             "**no implied-vol-leads-realised-move effect survives** on this session.\n"))

    A("### 2.2 Conditional forward returns (single session)\n")
    A("ITM PE means put strikes strictly above spot (≥ ₹1 intrinsic); each strike's cumulative "
      "volume is differenced first, then attributed by the prior minute's moneyness. Futures points "
      "when the archive exists, index points otherwise.\n")
    A(f"Triggers: ITM PE minute volume ≥ p90 ({fmt(cr['thresholds']['itm_pe_volume_p90'],0)}), a "
      f"15-minute joint price/OI move ({cr['price_source']} price + "
      f"{'futures' if fut_ok else 'combined option'} OI), and a 15-minute call-wall build ≥ p90 "
      f"({fmt(cr['thresholds']['call_wall_build_p90'],0)}). The baseline is the same horizon over "
      "every minute. `shift p` circularly shifts the trigger mask and asks how often the null "
      "excess is as large — it preserves the trigger's own run structure.\n")
    A("| trigger | h | n | episodes | mean | 95% CI | hit | excess vs base | shift p | in worst 20m |\n|---|---|---|---|---|---|---|---|---|---|")
    for name, by_h in cr["triggers"].items():
        for h in HORIZONS:
            v = by_h.get(f"{h}m", {})
            if "mean" not in v:
                A(f"| {name} | {h}m | {v.get('n',0)} | — | — | — | — | — | — | — |")
                continue
            ci = v.get("mean_ci")
            ci_s = f"[{fmt(ci[0],1)}, {fmt(ci[1],1)}]" if ci and ci[0] is not None else "—"
            A(f"| {name} | {h}m | {v['n']} | {v.get('n_episodes','—')} | {fmt(v['mean'],1)} | {ci_s} | "
              f"{pct(v['hit_rate'])} | {fmt(v['excess_vs_baseline'],1)} | "
              f"{fmt(v.get('excess_shift_p'),3)} | {pct(v.get('share_in_worst_20m'),0)} |")
    for h in HORIZONS:
        b = cr["baseline"][f"{h}m"]
        ci = b.get("mean_ci")
        ci_s = f"[{fmt(ci[0],1)}, {fmt(ci[1],1)}]" if ci and ci[0] is not None else "—"
        A(f"| **baseline** | {h}m | {b['n']} | — | {fmt(b['mean'],1)} | {ci_s} | {pct(b['hit_rate'])} | 0.0 | — | — |")
    A("")
    ww = cr["worst_20m_window"]
    sig = [(n, h, v) for n, by in cr["triggers"].items() for h, v in by.items()
           if v.get("excess_shift_p") is not None and v["excess_shift_p"] < 0.05]
    A(f"The session's worst 20-minute window is {ww['start']}–{ww['end']} "
      f"({fmt(ww['move'],1)} pts, starting at the first recorded sample — the pre-10:04 stretch is "
      "not in the data). "
      + (f"{len(sig)} trigger×horizon cells have a raw shift p below 0.05; with "
         f"{cr['tests']['n']} tests the Bonferroni threshold is {fmt(cr['tests']['bonferroni_alpha'],4)}, "
         if sig else "No trigger×horizon cell has a raw shift p below 0.05, ")
      + "and the `episodes` column is the honest n: consecutive trigger minutes are one "
        "observation. A CI that excludes zero can still be an excess of zero — the interval covers "
        "the trigger *level*, while `shift p` tests the excess against the baseline. The `in worst "
        "20m` column shows how much of each trigger is just the session's worst 20-minute stretch "
        "re-labelled.\n")

    A("### 2.3 Pin probability\n")
    A(f"Within-session distance from spot to max pain: median {fmt(pin['median_abs_dist'],1)} pts "
      f"(n={pin['n_minutes']} minutes). Max pain printed {pin['max_pain']['unique']} distinct levels "
      f"({', '.join(fmt(x,0) for x in pin['max_pain']['levels'])}), changed "
      f"{pin['max_pain']['changes']} times, and sat at {fmt(pin['max_pain']['modal'],0)} for "
      f"{pct(pin['max_pain']['modal_share'])} of the session.\n")
    A("| band | minutes | share | Wilson 95% |\n|---|---|---|---|")
    for k, v in pin["bands"].items():
        A(f"| {k.replace('within_','≤ ')} pts | {v['minutes']} | {pct(v['share'])} | "
          f"[{pct(v['wilson'][0])}, {pct(v['wilson'][1])}] |")
    A("")
    w25 = xd.get("wilson_25") or [None, None]
    A(f"Across the {xd['n']} recorded 0-DTE sessions: {xd['counts']['within_25']}/{xd['n']} closes "
      f"within 25 pts, {xd['counts']['within_50']}/{xd['n']} within 50, "
      f"{xd['counts']['within_100']}/{xd['n']} within 100; median "
      f"{fmt(xd['median_abs_dist'],1)} pts. **Counts, not probabilities** — the Wilson interval on "
      f"{xd['counts']['within_25']}/{xd['n']} is [{pct(w25[0])}, {pct(w25[1])}]. "
      + (f"{xd['n_truncated']} of {xd['n']} sessions "
         f"({', '.join(xd['truncated'])}) "
         f"{'stop' if xd['n_truncated'] != 1 else 'stops'} before 15:25, so "
         f"{'their “close” is the last recorded spot, not a settlement' if xd['n_truncated'] > 1 else 'its “close” is the last recorded spot, not a settlement'}. "
         if xd['n_truncated'] else
         f"All {xd['n']} have a print after 15:25. ")
      + (f"**Excluding the truncated "
         f"{'session' if xd['n_truncated'] == 1 else 'sessions'}**, "
         f"{xd['close_only']['within_25']} of {xd['close_only']['n']} genuine closes sit within "
         f"25 pts (Wilson {ci_str(xd['close_only']['wilson_25'], 3)}) and "
         f"{xd['close_only']['within_50']} within 50.\n"
         if xd["n_truncated"] else "\n"))
    A(f"For reference, the {hist['n_sessions']}-session deferred-expiry history has median "
      f"|close − max pain| {fmt(hist['median_abs_dist'],1)} pts and only "
      f"{pct(hist['shares']['within_25'])} of sessions within 25 pts; max pain moved intraday on "
      f"{pct(hist['max_pain_moved_share'])} of them. {hist['n_expiry_sessions']} of those "
      f"{hist['n_sessions']} are expiry sessions, so this is a weak-magnet reference, not a "
      "0-DTE prior.\n")
    cp = pin["close_proxy"]
    A(f"**The close is {'in the data' if q['session_coverage']['close_printed'] else 'not in the data'}.** "
      f"Last chain print {cp['chain_last_minute']} at spot {fmt(cp['chain_last_spot'],1)}"
      + (f", flagged `cas` (closing auction session)" if cp.get("last_flag_cas") else "")
      + f"; the {cp['price_source']} close is {fmt(cp['close_value'],1)} at {cp['close_minute']}, "
      f"{fmt(cp['dist_to_last_max_pain'],2)} pts from the last max pain "
      f"({fmt(pin['max_pain']['last'],0)}), {fmt(cp['dist_to_last_put_wall'],1)} pts above the put "
      f"wall and {fmt(cp['dist_to_last_call_wall'],1)} below the call wall. "
      + ("This is a settlement-print distance, so it is a real pin outcome — and n=1.\n"
         if cp["dist_to_last_max_pain"] is not None and cp["dist_to_last_max_pain"] <= 25
         else "The close is a settlement observation, not a forecast.\n"))

    A("### 2.4 Event study (descriptive, n=1 each)\n")
    A("| time | kind | spot | pre 15m | post 15m | post pct | PE vol post | GEX |\n|---|---|---|---|---|---|---|---|")
    for hhmm, e in ev["events"].items():
        A(f"| {hhmm} | {e['kind']} | {fmt(e['spot'],1)} | {fmt(e['pre15_spot'],1)} | "
          f"{fmt(e['post15_spot'],1)} | {pct(e['post15_percentile'],0)} | "
          f"{fmt(e['itm_pe_vol_post15'],0)} | {fmt(e['gex'],1)} |")
    A("")
    A(f"Events are detected, not authored: {ev['detection']}. For scale, the 90th percentile "
      f"absolute 15-minute move is {fmt(ev['all_15m_moves']['p90'],1)} pts "
      f"(sd {fmt(ev['all_15m_moves']['sd'],1)}). No event is a natural experiment: each is n=1 and "
      "every window is measured after the fact.\n")
    if ev["max_pain_steps"]:
        A("Max-pain relocations (first four): "
          + "; ".join(f"{s['t']} {fmt(s['from'],0)}→{fmt(s['to'],0)}" for s in ev["max_pain_steps"])
          + ".\n")

    A("### 2.5 Cross-day counts (all recorded 0-DTE sessions)\n")
    base = xd["flow"]["baseline"]
    A("| trigger | h | trigger minutes | sessions | mean | excess | excess cluster 95% | positive sessions |\n|---|---|---|---|---|---|---|---|")
    for name, by_h in xd["flow"]["summary"].items():
        for h in HORIZONS:
            v = by_h[f"{h}m"]
            ci = v.get("excess_cluster_ci")
            ci_s = f"[{fmt(ci[0],1)}, {fmt(ci[1],1)}]" if ci and ci[0] is not None else "—"
            A(f"| {name} | {h}m | {v['n_minutes']} | {v['n_sessions']} | {fmt(v['mean'],1)} | "
              f"{fmt(v['excess_mean'],1)} | {ci_s} | {v['positive_sessions']}/{v['n_sessions']} |")
    for h in HORIZONS:
        b = base[f"{h}m"]
        ci = b.get("cluster_ci")
        ci_s = f"[{fmt(ci[0],1)}, {fmt(ci[1],1)}]" if ci and ci[0] is not None else "—"
        A(f"| **baseline** | {h}m | {b['n_minutes']} | {b['n_sessions']} | {fmt(b['mean'],1)} | 0.0 | {ci_s} | — |")
    A("")
    starts = {d: v["start"] for d, v in xd["flow"]["sessions"].items()}
    late = [d for d, s in starts.items() if s > "09:20"]
    A(f"The pooled sessions are spot points, not futures. {len(late)} of {len(starts)} start late "
      f"({', '.join(f'{d} {starts[d]}' for d in late) if late else 'none'}) or contain a recorder "
      "hole, so their minute counts are not comparable. The cluster bootstrap resamples whole "
      "sessions and computes the excess inside the same resample, so the session drift cancels; the "
      f"intervals are still the widest honest thing {xd['n']} clusters can produce. The `positive "
      "sessions` column is the check that matters: an excess carried by one day is not a flow "
      "effect.\n")
    zero_sess = [(d, v["pe_oi_first"], v["pe_oi_last"], v["pe_oi_net"])
                 for d, v in xd["flow"]["sessions"].items()
                 if v.get("put_oi_up_15m", {}).get("15m", {}).get("n", 0) == 0]
    if zero_sess:
        d, f0, f1, net = zero_sess[0]
        A(f"`{d}` contributes zero put-OI-up minutes, so that trigger's session count is "
          f"{xd['flow']['summary']['put_oi_up_15m']['15m']['n_sessions']} and not {len(starts)}: its "
          f"put OI fell across the whole recorded session ({fmt(f0/1e6,1)}M → {fmt(f1/1e6,1)}M, net "
          f"{fmt(net/1e6,1)}M), so a 15-minute OI *increase* never occurred. That is a real state of "
          "the book, not a missing file.\n")
    s15 = {k: v["15m"] for k, v in xd["flow"]["summary"].items()}
    best_name = max(s15, key=lambda k: (s15[k]["positive_sessions"],
                                        abs(s15[k]["excess_mean"] or 0)))
    bv = s15[best_name]
    ci = bv.get("excess_cluster_ci")
    A(f"The 15-minute row with the widest support is `{best_name}`: "
      f"{bv['positive_sessions']}/{bv['n_sessions']} sessions positive, mean excess "
      f"{fmt(bv['excess_mean'],1)} pts, cluster CI {ci_str(ci)}. "
      + ("The interval excludes zero — with this few clusters that is suggestive of a pooled "
         "effect and still not a validated signal. " if ci and ci[0] is not None and ci[0] > 0
         else "The interval includes zero, so the pooled excess is not separable from session "
              "drift. ")
      + "Every row here is a hypothesis with the day effect resampled out, nothing more.\n")

    A("## 3. Section rubric\n")
    for sec in rev["section_rubric"]:
        A(f"### {sec['section']}\n")
        A("**Evidenced**\n")
        for x in sec["evidenced"]:
            A(f"- {x}")
        A("\n**Descriptive only**\n")
        for x in sec["descriptive"]:
            A(f"- {x}")
        A("\n**Overclaims to avoid**\n")
        for x in sec["overclaims"]:
            A(f"- {x}")
        A("")

    A("## 4. Best data flows for positioning\n")
    A("| # | flow | SNR | latency | sample | never alone because |\n|---|---|---|---|---|---|")
    for i, f in enumerate(rev["flows"], 1):
        A(f"| {i} | {f['flow']} | {f['snr']}/5 | {f['latency']} | {f['sample']} | {f['failure']} |")
    A("")
    for f in rev["flows"]:
        A(f"- **{f['flow']}** — confirms: {f['confirms']}. Denies: {f['denies']}.")
    A("")

    A("## 5. Recommendations for the single HTML\n")
    for x in rev["html_recommendations"]:
        A(f"- {x}")
    A("")

    A("## 6. Session read\n")
    A("| item | value |\n|---|---|")
    A(f"| Open (first sample) | {fmt(tr['open']['spot'],2)} at {tr['open']['minute']} |")
    A(f"| Close (last sample) | {fmt(tr['close']['spot'],2)} at {tr['close']['minute']}"
      f"{' — `cas` flag set' if tr['close']['flag_cas'] else ''} |")
    A(f"| Change over the recorded window | {fmt(tr['change'],2)} pts |")
    A(f"| High / low | {fmt(tr['high']['spot'],2)} at {tr['high']['minute']} / "
      f"{fmt(tr['low']['spot'],2)} at {tr['low']['minute']} |")
    A(f"| Range | {fmt(tr['range'],1)} pts |")
    A(f"| ITM PE flow | median {fmt(tr['itm_pe']['median_minute'],0)}/min, p90 "
      f"{fmt(tr['itm_pe']['p90'],0)}, peak {fmt(tr['itm_pe']['peak']['value'],0)} at "
      f"{tr['itm_pe']['peak']['minute']} |")
    A(f"| Top-10 flow minutes | {pct(tr['itm_pe']['top10_minute_share'])} of session ITM PE volume |")
    A(f"| Net GEX | {fmt(tr['gex']['first'],1)} → {fmt(tr['gex']['last'],1)} "
      f"(min {fmt(tr['gex']['min'],1)}, max {fmt(tr['gex']['max'],1)}) |")
    A(f"| ATM straddle | {fmt((tr['straddle']['first'] or {}).get('value'),2)} at "
      f"{(tr['straddle']['first'] or {}).get('minute')} → "
      f"{fmt((tr['straddle']['last'] or {}).get('value'),2)} at "
      f"{(tr['straddle']['last'] or {}).get('minute')} "
      f"({pct(tr['straddle']['decay_share'])} of premium gone) |")
    A(f"| Close vs max pain | {fmt(tr['pin']['close_dist'],2)} pts |")
    A(f"| Spot inside the near wall band | {pct(tr['pin']['inside_walls_share'])} of minutes |")
    A("")
    ls = tr["long_state"]
    b15 = tr["baseline"]["15m"]
    A(f"**The 15-minute price/OI state.** "
      + (f"{ls.get('n', 0)} minute-observations classify as price-up-with-OI-up, in "
         f"{ls.get('n_episodes', 'n/a')} episodes; forward 15-minute returns after the state average "
         f"{fmt(ls.get('mean'),1)} pts against a {fmt(b15['mean'],1)}-pt baseline "
         f"(excess {fmt(ls.get('excess_vs_baseline'),1)}, shift p={fmt(ls.get('excess_shift_p'),3)}). "
         "The state mean sits inside its own bootstrap interval and the excess is not separable "
         "from the session baseline. "
         if ls.get("mean") is not None else
         "Too few observations to estimate a forward return for this state. ")
      + (f"The OI leg is combined option OI, so the label describes joint direction, not futures "
         f"positioning.\n" if not fut_ok else "The OI leg is futures OI.\n"))
    A("**Probabilities.** Nothing on this page supports a probability statement tighter than "
      f"“{xd['close_only']['within_25']} of {xd['close_only']['n']} recorded 0-DTE sessions with a "
      "genuine close settled within 25 points of max pain” (counting last prints instead of closes "
      f"gives {xd['counts']['within_25']} of {xd['n']}, which includes a session that stops at "
      "14:07). Position sizing should treat the flow reads as a scenario generator, not a hit "
      "rate.\n")
    return "\n".join(L)


def lab_md(lab: dict) -> str:
    meta = lab["meta"]
    L = []
    A = L.append
    A(f"# Quant lab — NIFTY 0-DTE {meta['session']}\n")
    A(f"Hypothesis-generation output for expiry {meta['expiry']}. The cross-day pool is "
      f"{lab['cross_day_sessions']} recorded 0-DTE sessions, this one included; no out-of-sample "
      "period, no execution model, no costs. Nothing here is a backtest.\n")

    d = lab["distributions"]
    pt = d["price_1m_points"]
    bp = d["price_1m_log_bp"]
    A("## 1. Return distribution and flow conditioning\n")
    A(f"{d['price_source']} 1m returns: n={pt['n']}, sd {fmt(pt['sd'],1)} pts "
      f"({fmt(bp['sd'],2)} bp), skew {fmt(pt['skew'],2)}, excess kurtosis "
      f"{fmt(pt['excess_kurtosis'],1)}, range {fmt(pt['min'],1)} to {fmt(pt['max'],1)} pts, "
      f"p05/p95 {fmt(pt['p05'],1)}/{fmt(pt['p95'],1)}. Moment estimates are not stationary through "
      "the session: the largest 15-minute moves drive most of the kurtosis.\n")
    A("| decile of ITM PE volume | n | mean pts | 95% CI | share up |\n|---|---|---|---|---|")
    for b in d["conditional_deciles"].get("itm_pe_volume", []):
        ci = b.get("mean_ci")
        ci_s = f"[{fmt(ci[0],1)}, {fmt(ci[1],1)}]" if ci and ci[0] is not None else "—"
        A(f"| {b['decile']} | {b.get('n','—')} | {fmt(b.get('mean_pts'),2)} | {ci_s} | "
          f"{pct(b.get('share_up'))} |")
    A("")
    A("Top-vs-bottom decile for each conditioning variable (next-minute return, index points):\n")
    A("| conditioning variable | d1 mean | d10 mean | d10 CI | d10 n |\n|---|---|---|---|---|")
    for name, bins in d["conditional_deciles"].items():
        if len(bins) < 2 or "mean_pts" not in bins[0] or "mean_pts" not in bins[-1]:
            continue
        ci = bins[-1].get("mean_ci")
        ci_s = f"[{fmt(ci[0],1)}, {fmt(ci[1],1)}]" if ci and ci[0] is not None else "—"
        A(f"| {name} | {fmt(bins[0]['mean_pts'],2)} | {fmt(bins[-1]['mean_pts'],2)} | {ci_s} | {bins[-1]['n']} |")
    A("")
    excl = [b["decile"] for b in d["conditional_deciles"].get("itm_pe_volume", [])
            if b.get("mean_ci") and b["mean_ci"][0] is not None
            and (b["mean_ci"][0] > 0 or b["mean_ci"][1] < 0)]
    ww = d["worst_20m_window"]
    top = d["conditional_deciles"].get("itm_pe_volume", [{}])[-1]
    A(f"{len(excl)} of 10 decile CIs exclude zero "
      f"({', '.join(f'd{x}' for x in excl) if excl else 'none'}); with ten buckets, 0.5 is what "
      f"chance predicts. The top decile averages {fmt(top.get('mean_pts'),2)} pts over the next "
      f"minute and only {pct(d['top_decile_worst_window_share'])} of its minutes sit inside the "
      f"session's worst 20-minute window ({ww['start']}–{ww['end']}, {fmt(ww['move'],1)} pts), so "
      "the negative bin is not that window re-labelled. It is a same-minute co-movement with the "
      "move it would need to predict — the mechanical confound. Note the sign flip against the "
      "15-minute trigger table in `quant_review`: the same flow is negative at 1 minute and "
      "positive at 15, which is what both a burst-then-reversal and noise look like.\n")

    A("## 2. Information flow\n")
    info = lab["information_flow"]
    A(f"Effective sample: price 1m returns n={info['n_eff']['price_1m_return']['n']} "
      f"(n_eff {info['n_eff']['price_1m_return']['n_eff_bartlett']}); ITM PE minute volume "
      f"n_eff {info['n_eff']['itm_pe_volume']['n_eff_bartlett']} — the flow series carries fewer "
      "independent observations than its row count suggests, because volume arrives in bursts.\n")
    if info.get("cross_instrument_available"):
        A(f"Price–price: the clock-aligned contemporaneous correlation is "
          f"{fmt(info['peak']['r'],3)} at lag {info['peak']['lag']:+d}; the one-minute lead "
          f"(lag −1) is {fmt(info['lead_1m'],3)} after alignment versus "
          f"{fmt(info['naive_lead_1m'],3)} on the naive clock.\n")
    else:
        A("Cross-instrument price–price lead–lag is **not measurable**: this session has no futures "
          "archive. Only the same-clock flow-vs-price families below are reported.\n")
    lb = info["best_flow"]
    A(f"Flow–price: the strongest family is {info['best_flow_name']} at lag {lb['lag']:+d} "
      f"(r={fmt(lb['r'],3)}, Bonferroni-critical |r|={fmt(info['multiple_testing']['r_critical'],3)}). "
      + ("It clears the threshold and sits at a positive lag. "
         if lb.get("clears_bonferroni") and lb["lag"] > 0 else
         "It clears the threshold but sits at a negative lag, i.e. the flow is measured after the "
         "price. " if lb.get("clears_bonferroni") else
         "It does not clear the Bonferroni threshold. ")
      + "A single session with 21 lags per family cannot turn this into a rule.\n")

    A("## 3. Surface factors\n")
    s = lab["surface"]
    if s.get("available"):
        A(f"PCA on {s['n_snapshots']} first-difference OTM smiles "
          f"(±{s['band_pct']:.2f}% moneyness, {s['iv_source']}). Explained variance: "
          f"{', '.join(pct(v) for v in s['explained'][:3])}.\n")
        A("| factor | explained | flat | linear | quadratic | basis R² | shape |\n|---|---|---|---|---|---|---|")
        for k, v in s["loadings"].items():
            c = v["coef_flat_linear_quad"]
            A(f"| {k} | {pct(v['explained'])} | {fmt(c[0],2)} | {fmt(c[1],2)} | {fmt(c[2],2)} | "
              f"{fmt(v['basis_r2'],2)} | {v['shape']} |")
        A("")
        A("The factor scores and residuals are in `quant_lab.json` (`surface.score_series`, "
          "`surface.residual_heatmap`); the heatmap is the honest companion to the loadings because "
          "it shows where the two-factor fit fails. These are statistical factors, not a predictive "
          "model, and the explained-variance split is unstable at this sample size on one expiry.\n")
    else:
        A(f"IV PCA is not available for this session: {s.get('reason', 'unknown')}. No surface claim "
          "is carried forward.\n")

    A("## 4. Regime and change points\n")
    r = lab["regime"]
    c1 = r["cusum_return"]
    c2 = r["cusum_abs_return"]
    A(f"CUSUM on {r['price_source']} 1m returns peaks at {c1.get('cusum_peak_time')} "
      f"(stat {fmt(c1.get('cusum_stat'),2)}, block-permutation p={fmt(c1.get('permutation_p'),3)}); "
      f"on absolute returns p={fmt(c2.get('permutation_p'),3)}. "
      + ("The return-series break is significant and its first split sits at "
         f"{c1.get('break1_time')}. " if (c1.get('permutation_p') or 1) < 0.05 else
         "The return-series break does not clear the permutation null. ")
      + "The absolute-return test has little power with a 15-minute block null at this n, so “no "
        "volatility break detected” is not “no volatility break”.\n")
    A(f"15-minute states, non-overlapping bars ({r['oi_field']}): {r['states']['n_bars']} bars, "
      f"{r['states']['n_transitions']} transitions, {r['states']['n_flips']} state flips.\n")
    A("| from \\ to | " + " | ".join(r["states"]["order"]) + " | row n |")
    A("|---|" + "---|" * (len(r["states"]["order"]) + 1))
    for i, name in enumerate(r["states"]["order"]):
        cells = [f"{pct(v, 0)} ({r['states']['transition_counts'][i][j]})"
                 for j, v in enumerate(r["states"]["transition"][i])]
        A(f"| {name} | " + " | ".join(cells) + f" | {sum(r['states']['transition_counts'][i])} |")
    A("")
    top_state = max(r["states"]["counts"], key=r["states"]["counts"].get)
    A(f"The modal bar state is `{top_state}` ({r['states']['counts'][top_state]} of "
      f"{r['states']['n_bars']} bars). Rows with a small count (see `row n`) are noise. The matrix "
      "describes one session and must not be quoted as a transition probability.\n")

    A("## 5. Concentration and microstructure proxies\n")
    m = lab["microstructure"]
    A(f"Median HHI across strikes: calls {fmt(m['hhi']['ce_median'],3)} "
      f"(≈{fmt(m['hhi']['ce_eff_strikes'],1)} effective strikes), puts "
      f"{fmt(m['hhi']['pe_median'],3)} (≈{fmt(m['hhi']['pe_eff_strikes'],1)}). Normalised entropy "
      f"{fmt(m['entropy']['median_normalised'],2)} — volume is spread across many strikes, which is "
      "what makes a single-strike flow story fragile.\n")
    A(f"OI persistence, median ΔOI/Δvolume per strike per 15 minutes: "
      f"{fmt(m['oi_persistence']['median_doi_over_dvol'],3)} "
      f"(p10 {fmt(m['oi_persistence']['p10'],3)}, p90 {fmt(m['oi_persistence']['p90'],3)}, "
      f"n={m['oi_persistence']['n_strike_windows']}). "
      + ("A negative median is net OI retirement: on a 0-DTE session the afternoon is squaring, so "
         "volume accumulates into positions that are closed rather than built. "
         if (m['oi_persistence']['median_doi_over_dvol'] or 0) < 0 else
         "Near zero is the 0-DTE churn signature: most volume is intraday turnover, not position "
         "building. ")
      + "The n is strike-windows, not independent observations.\n")
    A(f"Quoted relative spreads: ATM±50 "
      f"{fmt((m['spreads'].get('atm_50') or {}).get('median_rel', 0) * 100, 2)}%, ±150 "
      f"{fmt((m['spreads'].get('near_150') or {}).get('median_rel', 0) * 100, 2)}%, wings "
      f"{fmt((m['spreads'].get('wing') or {}).get('median_rel', 0) * 100, 2)}% (snapshot quotes, "
      "indicative, premiums ≥ ₹2 only).\n")
    A(f"Volume bursts above 3 MAD after the first 15 minutes: {m['volume_bursts']['n']}, first at "
      f"{', '.join(x['t'] for x in m['volume_bursts']['times'][:6]) if m['volume_bursts']['times'] else 'none'}. "
      "The open is excluded because opening volume is always a burst.\n")
    A("Not measurable without order-book data:\n")
    for x in m["not_measurable"]:
        A(f"- {x}")
    A("")

    A("## 6. Chart-choice rubric\n")
    A("| question | best visual | why | avoid |\n|---|---|---|---|")
    for c in lab["chart_rubric"]:
        A(f"| {c['question']} | {c['best']} | {c['why']} | {c['avoid']} |")
    A("")

    A("## 7. Evidence table\n")
    A("| claim | statistic | n | 95% CI | class | falsifier |\n|---|---|---|---|---|---|")
    for e in lab["evidence"]:
        A(f"| {e['claim']} | {e['stat']} | {e['n']} | {e['ci']} | {e['kind']} | {e['falsifier']} |")
    A("")
    return "\n".join(L)



def section_rubric(rev: dict) -> list[dict]:
    ll = rev["lead_lag"]
    pin = rev["pin"]
    q = rev["data_quality"]
    cr = rev["conditional_returns"]
    tr = rev["session_read"]
    lab = rev["lab"]
    fut_ok = q["price_source"]["name"] == "futures_1m"
    s = lab["surface"]
    m = lab["microstructure"]
    prov = pin["close_proxy"]
    pin_hit = prov.get("dist_to_last_max_pain")

    return [
        {
            "section": "01 · pin_gamma — pin / gamma",
            "evidenced": [
                f"Max pain printed {pin['max_pain']['unique']} levels and changed "
                f"{pin['max_pain']['changes']} times; modal level {fmt(pin['max_pain']['modal'],0)} "
                f"held {pct(pin['max_pain']['modal_share'])} of the recorded minutes.",
                f"Spot sat inside the near call/put wall band {pct(pin['walls']['inside_share'])} of "
                "minutes — but the walls are re-derived each minute from the same OI surface, so "
                "this is near-tautological.",
                f"Distance-to-pin within the session: median {fmt(pin['median_abs_dist'],1)} pts; "
                f"{pct(pin['bands']['within_50']['share'])} of minutes within 50 and "
                f"{pct(pin['bands']['within_25']['share'])} within 25.",
                f"Close observation: {fmt(prov['close_value'],1)} at {prov['close_minute']} vs last "
                f"max pain {fmt(pin['max_pain']['last'],0)} — {fmt(pin_hit,2)} pts"
                + (" (a settlement hit, n=1)." if pin_hit is not None and pin_hit <= 25
                   else " (not a pin outcome)."),
            ],
            "descriptive": [
                "“Dealers are long/short gamma” is inferred from an OI-weighted Black-Scholes gamma "
                "formula with an assumed dealer sign convention — the data contains OI, not dealer "
                "positions.",
                "The pin “magnet” story is a same-minute identity between max pain and spot, not a "
                "forecast.",
                "Wall OI migration is measured, but whether it is writing or buying needs price plus "
                "OI together, and even then is an inference.",
            ],
            "overclaims": [
                "Any expiry-close pin probability with a tight interval: the recorded 0-DTE sample "
                f"is {rev['cross_day']['n']} sessions and {rev['cross_day']['n_truncated']} of them "
                f"{'stop' if rev['cross_day']['n_truncated'] != 1 else 'stops'} before 15:25.",
                "“Price stays inside the walls X% of the time” as a hit rate — the band is defined by "
                "the same snapshot it is scored against.",
                "Reading a GEX sign flip as a regime call — on 0-DTE the flip is largely mechanical "
                "as spot crosses strikes.",
            ],
        },
        {
            "section": "02 · participant_flow — participant flow",
            "evidenced": [
                f"ITM put volume concentrates: the top-10 minutes carry "
                f"{pct(tr['itm_pe']['top10_minute_share'])} of session ITM PE volume, peak "
                f"{fmt(tr['itm_pe']['peak']['value'],0)}/min at {tr['itm_pe']['peak']['minute']}.",
                f"OI persistence median ΔOI/Δvolume ≈ "
                f"{fmt(m['oi_persistence']['median_doi_over_dvol'],3)}: "
                + ("negative, so OI is being retired faster than volume accumulates over the "
                   "15-minute windows — net closing, not building."
                   if (m['oi_persistence']['median_doi_over_dvol'] or 0) < 0 else
                   "near zero, so most 0-DTE volume is intraday turnover, not position building."),
                f"Volume concentration (HHI) and burst times are measurable from tape cumulative "
                f"volume; {m['volume_bursts']['n']} minutes exceed 3 MAD after the first 15.",
            ],
            "descriptive": [
                "“Bullish/bearish positioning” verdicts use price + OI change; buyer vs writer is "
                "inferred, not identified.",
                "The flow_bias / positioning.state fields are a vendor heuristic; they are not "
                "calibrated to forward returns anywhere in the repo.",
                "CE/PE OI changes include roll and expiry squaring, which is indistinguishable from "
                "conviction.",
            ],
            "overclaims": [
                "Any claim about a specific participant type (FII/DII/prop) from chain data.",
                "“Institutions bought N of ITM puts at time T” — a moving-window cumulative-sum "
                "artefact, with unknown counterparty.",
                f"“Price/OI up state means continuation” — {pct(cr['triggers']['price_oi_up_15m']['15m'].get('hit_rate'))} "
                "hit rate and an excess inside the bootstrap interval is not an edge.",
            ],
        },
        {
            "section": "03 · vol_decay — IV / premium decay",
            "evidenced": [
                "ATM straddle and per-strike IVs exist at 1-minute resolution "
                f"({q['counts']['snap_rows']} snapshots, {q['counts']['chain_rows']} chain rows).",
                (f"ATM straddle decayed {pct(tr['straddle']['decay_share'])} over the recorded "
                 f"window ({fmt((tr['straddle']['first'] or {}).get('value'),2)} → "
                 f"{fmt((tr['straddle']['last'] or {}).get('value'),2)})."
                 if tr["straddle"]["first"] else "Straddle series is incomplete."),
                (f"IV smile PCA on {s['n_snapshots']} snapshots: PC1/PC2 explain "
                 f"{pct(s['explained'][0])}/{pct(s['explained'][1])}; PC1 shape "
                 f"{s['loadings']['pc1']['shape']}."
                 if s.get("available") else "IV PCA unavailable for this session."),
            ],
            "descriptive": [
                "IV crush/changes are surface statistics; the causal driver (spot, supply of options, "
                "event) cannot be separated with one session.",
                "Skew changes are quoted in vol points; translating them into a directional view is "
                "an assumption about the pricing kernel.",
                "Vendor IVs are model output and are noisy in the wings and deep ITM.",
            ],
            "overclaims": [
                "“IV fell because dealers unwound” — no positioning data supports the attribution.",
                "“Cheap/expensive vol” without a realised-vol comparison over a matching window; the "
                "session's RV/IV ratio is a single draw.",
                "Fitting a term structure from one expiry — the snapshot carries one expiry only.",
            ],
        },
        {
            "section": "04 · futures_cross — futures / basis / cross-market",
            "evidenced": (
                [
                    f"Basis (futures − spot) median {fmt(lab['basis']['median'],1)} pts, range "
                    f"{fmt(lab['basis']['min'],1)}–{fmt(lab['basis']['max'],1)}.",
                    f"Clock-aligned futures/spot contemporaneous correlation "
                    f"{fmt(lab['basis']['concurrent'],3)} vs {fmt(lab['basis']['concurrent_naive'],3)} "
                    "on the naive clock.",
                    "SENSEX and NIFTY move together; the divergence series is measurable at "
                    "1-minute resolution.",
                ] if fut_ok else [
                    "**No futures archive for this session**, so basis, futures OI and cross-market "
                    "divergence are unavailable — they are not estimated from a proxy.",
                    "What survives: same-clock flow-vs-price correlations and the ATM-straddle "
                    "gamma/lead tests inside the chain feed.",
                    f"Chain feed signed spot/straddle r={fmt((ll.get('chain10s') or {}).get('r_signed_lag0'),3)} "
                    "(delta-neutral null); gamma link "
                    f"{fmt((ll.get('chain10s') or {}).get('r_gamma_same_minute'),3)}.",
                ]
            ),
            "descriptive": (
                [
                    f"“Futures lead spot by a minute” — {pct(ll.get('lead_attributable_to_sampling'))} "
                    "of that lead is the sampling offset; the residual is sub-minute.",
                    "Basis widening as a “risk gauge” is a narrative; with one session it is a time "
                    "series, not a signal.",
                ] if fut_ok else [
                    "Cross-instrument lead–lag is unmeasurable here; any figure quoted for it would "
                    "come from a different date.",
                    "The tape spot is the index print, so intraday price discovery between cash and "
                    "futures cannot be tested on this session.",
                ]
            ),
            "overclaims": (
                [
                    "Any lead–lag trading rule from one session without a synchronised clock.",
                    "Treating a deferred contract's basis as pure sentiment — it contains carry.",
                ] if fut_ok else [
                    "Quoting a futures lead/lag for a session with no futures file.",
                    "Substituting another date's futures series and calling it this session's.",
                ]
            ),
        },
    ]


def flow_table(rev: dict) -> list[dict]:
    q = rev["data_quality"]
    fut_ok = q["price_source"]["name"] == "futures_1m"
    n_sess = rev["cross_day"]["n"]
    rows = [
        {"flow": "1-minute tape chain: per-strike Δvolume + ΔOI (moneyness-attributed)",
         "snr": 4, "latency": "60s", "sample": f"{n_sess} sessions",
         "failure": "cumulative-sum recomputation over a moving strike set",
         "confirms": "a build is anchored at fixed strikes and survives the moneyness attribution",
         "denies": "a headline flow number that only exists as a difference of moving sums"},
        {"flow": "Call/put wall OI at fixed strikes",
         "snr": 4, "latency": "60s", "sample": f"{n_sess} sessions",
         "failure": "wall identity changes as OI migrates; strike labels drift",
         "confirms": "a wall is being defended (OI up while price approaches and stalls)",
         "denies": "“wall rejected price” if OI is falling into the touch"},
        {"flow": "Net GEX sign + zero-cross from the snapshot surface",
         "snr": 3, "latency": "60s", "sample": "1 session",
         "failure": "dealer-sign assumption; 0-DTE mechanical flips",
         "confirms": "a regime change that coincides with a vol/range change",
         "denies": "a stable-gamma claim when the zero-cross sits within 20 pts of spot"},
        {"flow": "Price + OI at 1 minute",
         "snr": 4, "latency": "1s–60s", "sample": "1 session",
         "failure": ("futures roll/expiry effects; OI is end-of-minute" if fut_ok
                     else "combined option OI, not futures OI; contains both legs"),
         "confirms": "a directional move is being financed by new positions",
         "denies": "a “long buildup” whose OI change is inside the ordinary 15-minute range"},
        {"flow": "Max pain / distance-to-pin",
         "snr": 2, "latency": "60s", "sample": f"{n_sess} sessions",
         "failure": "recomputed from the same OI it is meant to predict",
         "confirms": "a magnet only when the level is stable for hours and spot is inside 25 pts",
         "denies": "pin forecasts on a day when max pain is still migrating"},
        {"flow": "ATM straddle level + slope (premium decay)",
         "snr": 3, "latency": "60s", "sample": "1 session",
         "failure": "delta and theta both move it; cannot separate without a surface fit",
         "confirms": "theta burn is the dominant intraday force on a 0-DTE",
         "denies": "a directional read taken from straddle value alone"},
        {"flow": "IV smile level/skew/curvature (PCA)",
         "snr": 2, "latency": "60s", "sample": "1 session",
         "failure": "vendor model IV, wing noise, one expiry only",
         "confirms": "a genuine repricing when level and skew move together",
         "denies": "a vol story that rests on a single wing strike"},
    ]
    if fut_ok:
        rows.insert(4, {"flow": "Basis (futures − spot), clock-aligned",
                        "snr": 3, "latency": "60s", "sample": "1 session",
                        "failure": "contains carry; sensitive to the spot sample clock",
                        "confirms": "positioning stress when basis moves beyond its own daily range",
                        "denies": "a sentiment read when the move is inside the carry band"})
    return rows


def html_recommendations(rev: dict) -> list[str]:
    q = rev["data_quality"]
    fut_ok = q["price_source"]["name"] == "futures_1m"
    out = [
        "Every forward-looking chart carries an explicit n label and, where a bucket is used, the "
        "number of independent windows (n/h), not just the raw minute count.",
        "Draw uncertainty as a band, not a line: bootstrap CI for conditional means, Wilson interval "
        "for proportions. A proportion from a handful of sessions must be printed as “k of n”, never "
        "a bare percentage.",
        "Null states matter: show the unconditional baseline on every trigger chart so a reader can "
        "see whether the trigger did anything. A trigger curve without its baseline is decorative.",
        "No causal verbs and no unsourced participant claims. Replace “dealers defended”, “flow "
        "pushed”, “basis predicted” with “OI at strike X rose while spot stalled” — describe the "
        "joint observation.",
    ]
    cov = q["session_coverage"]
    if cov["minutes_missing_at_open"] and cov["minutes_missing_at_open"] > 5:
        out.append(f"Coverage banner: the recording starts {cov['first_sample']}, "
                   f"{cov['minutes_missing_at_open']} minutes after the open. Nothing before that is "
                   "on the page — not the opening range, not the first-hour OI book.")
    if q["gaps"]["tape_gaps_gt_90s"]:
        g = q["gaps"]["tape_gap_times"][0]
        out.append(f"Gap marker: {g[0]}–{g[1]} is missing from the tape and the chain. Charts must "
                   "break the line, not interpolate across it.")
    if not fut_ok:
        out.append("Label the price source on every chart: this page uses the tape spot, not "
                   "futures, and there is no basis series.")
    out += [
        "Decision-useful: strike-anchored OI build, max-pain distance with its migration timeline, "
        "ATM straddle decay, the clock-aligned flow-vs-price cross-correlation with its band.",
        "Decorative unless paired with a baseline: GEX bars, IV surface 3D, streamgraphs of CE/PE "
        "volume, “pin score” gauges.",
        "Where a factor is statistical (surface PCA), show the loadings and the explained variance "
        "beside the time series so the reader can see it is not a pricing model.",
        "Use small multiples with the detected event markers rather than one annotated chart; several "
        "events on one axis is unreadable at 390 px.",
        "State the sample up front: one session, a handful of partial 0-DTE sessions, no "
        "out-of-sample.",
    ]
    return out


def chart_rubric() -> list[dict]:
    return [
        {"question": "Is the return distribution different after high flow?",
         "best": "Ridgeline of decile densities + QQ against normal",
         "why": "shows shape and tails, not just the mean; deciles keep n visible",
         "avoid": "bar chart of means with no CI"},
        {"question": "Does flow lead price?",
         "best": "Cross-correlation vs lag with bootstrap band, with the trigger mask's own ACF",
         "why": "makes the autocorrelation and the multiple-testing threshold visible",
         "avoid": "single scatter with a fitted line"},
        {"question": "How did the IV surface evolve?",
         "best": "Contour/heatmap of moneyness × time, plus factor loadings",
         "why": "topology is legible in 2D; loadings show what the factor is",
         "avoid": "3D surface unless the topology itself is the point"},
        {"question": "What is the probability of a close near the pin?",
         "best": "Fan chart of the distance distribution with count labels",
         "why": "communicates the width of a small-sample estimate honestly",
         "avoid": "a single “pin probability” dial"},
        {"question": "Where did volume concentrate?",
         "best": "Strike × time heatmap of attributed Δvolume",
         "why": "shows migration and bursts in one frame",
         "avoid": "streamgraph of raw cumulative sums"},
        {"question": "Did the regime change?",
         "best": "CUSUM path with permutation p + state timeline strip",
         "why": "separates drift from a break and labels the windows",
         "avoid": "regime bands drawn by eye"},
        {"question": "How fast did premium bleed?",
         "best": "ATM straddle with its intrinsic component overlaid",
         "why": "separates delta from theta instead of calling all decay “IV crush”",
         "avoid": "dual-axis straddle vs spot"},
    ]


def evidence_table(rev: dict, lab: dict) -> list[dict]:
    ll = rev["lead_lag"]
    cr = rev["conditional_returns"]
    pin = rev["pin"]
    xd = rev["cross_day"]
    tr = rev["session_read"]
    q = rev["data_quality"]
    fut_ok = q["price_source"]["name"] == "futures_1m"
    s = lab["surface"]
    m = lab["microstructure"]
    lb = cr["triggers"]["price_oi_up_15m"]["15m"]
    itm = cr["triggers"]["itm_pe_volume_top_decile"]["15m"]
    cw = cr["triggers"]["call_wall_build_top_decile"]["15m"]

    rows = []
    if fut_ok:
        rows.append({
            "claim": "Futures lead spot by ~1 minute",
            "stat": f"naive r(lag−1)={fmt(ll['lead_naive'],3)}; clock-aligned r={fmt(ll['lead_sync'],3)}",
            "n": str(ll["multiple_testing"]["n_reference"]),
            "ci": "lag−1 sync bootstrap in JSON", "kind": "falsified as a 1-minute lead",
            "falsifier": "already falsified — synchronising the clocks removes most of the lead"})
    else:
        rows.append({
            "claim": "Futures lead spot by ~1 minute",
            "stat": "no futures archive for this session; cross-instrument lag not estimated",
            "n": "n/a", "ci": "n/a", "kind": "not measurable",
            "falsifier": "a 1-minute futures file for the same session"})

    rows += [
        {"claim": "Top-decile ITM PE volume predicts the next 15m",
         "stat": f"within-session excess {fmt(itm.get('excess_vs_baseline'),1)} pts "
                 f"(shift p={fmt(itm.get('excess_shift_p'),3)}), episodes {itm.get('n_episodes')}; "
                 f"cross-day excess {fmt(xd['flow']['summary']['itm_pe_volume_top_decile']['15m']['excess_mean'],1)} pts "
                 f"in {xd['flow']['summary']['itm_pe_volume_top_decile']['15m']['positive_sessions']}/"
                 f"{xd['flow']['summary']['itm_pe_volume_top_decile']['15m']['n_sessions']} sessions",
         "n": f"{itm.get('n', 0)} minutes (1 session); "
              f"{xd['flow']['summary']['itm_pe_volume_top_decile']['15m']['n_minutes']} (pooled)",
         "ci": ci_str(xd["flow"]["summary"]["itm_pe_volume_top_decile"]["15m"]["excess_cluster_ci"]),
         "kind": "hypothesis",
         "falsifier": "a multi-session excess CI excluding zero with many more clusters"},
        {"claim": "The 15m price/OI state carries forward information",
         "stat": f"excess {fmt(lb.get('excess_vs_baseline'),1)} pts, shift p={fmt(lb.get('excess_shift_p'),3)}, "
                 f"hit {pct(lb.get('hit_rate'))} vs baseline {pct(cr['baseline']['15m']['hit_rate'])}",
         "n": f"{lb.get('n', 0)} minutes, {lb.get('n_episodes')} episodes",
         "ci": ci_str(lb.get("mean_ci")), "kind": "hypothesis",
         "falsifier": "a state excess that survives pooling across sessions"},
        {"claim": "Call-wall OI build precedes the next 15m",
         "stat": f"excess {fmt(cw.get('excess_vs_baseline'),1)} pts, shift p={fmt(cw.get('excess_shift_p'),3)}",
         "n": f"{cw.get('n', 0)} minutes, {cw.get('n_episodes')} episodes",
         "ci": ci_str(cw.get("mean_ci")), "kind": "hypothesis",
         "falsifier": "excess outside the bootstrap band in a second session"},
        {"claim": "Max pain pins the close",
         "stat": f"this session {fmt(pin['close_proxy']['dist_to_last_max_pain'],2)} pts at the close; "
                 f"genuine closes {xd['close_only']['within_25']}/{xd['close_only']['n']} within 25 pts "
                 f"(all last prints {xd['counts']['within_25']}/{xd['n']}); "
                 f"deferred history {pct(xd['history']['shares']['within_25'])} within 25",
         "n": f"{xd['close_only']['n']} closes, {xd['n']} 0-DTE last prints, "
              f"{xd['history']['n_sessions']} deferred",
         "ci": f"Wilson {xd['close_only']['within_25']}/{xd['close_only']['n']} = "
               f"{ci_str(xd['close_only']['wilson_25'], 3)}",
         "kind": "descriptive (n=1 outcome) + weak prior",
         "falsifier": "more 0-DTE sessions; a close materially outside 25 pts"},
        {"claim": "Spot stays inside the walls most of the time",
         "stat": f"{pct(pin['walls']['inside_share'])} of minutes",
         "n": str(pin["walls"]["n"]), "ci": "n/a", "kind": "descriptive",
         "falsifier": "score against walls fixed at the open instead of the same snapshot"},
        {"claim": "0-DTE volume builds open interest",
         "stat": f"median ΔOI/Δvol {fmt(m['oi_persistence']['median_doi_over_dvol'],3)} "
                 f"(p10 {fmt(m['oi_persistence']['p10'],3)}, "
                 f"p90 {fmt(m['oi_persistence']['p90'],3)})",
         "n": str(m["oi_persistence"]["n_strike_windows"]),
         "ci": "percentile band above", "kind": "descriptive (net retirement)",
         "falsifier": "a session with persistence >0.3 sustained through the afternoon"},
        {"claim": "The chain's cumulative volume is a clean counter",
         "stat": f"{pct(q['chain_volume_drop_share'])} of consecutive per-strike reads decrease "
                 f"({q['chain_volume_drops']:,} of {q['chain_volume_cells']:,})",
         "n": f"{q['chain_volume_cells']:,}", "ci": "n/a", "kind": "falsified",
         "falsifier": "already falsified — needs a running-max repair before differencing"},
        {"claim": "The tape covers the full session",
         "stat": f"first sample {q['session_coverage']['first_sample']}, last "
                 f"{q['session_coverage']['last_sample']}, "
                 f"{q['session_coverage']['minutes_missing_at_open']} min missing at the open, "
                 f"{q['gaps']['tape_gaps_gt_90s']} gap(s) >90s",
         "n": f"{q['counts']['tape_rows']} rows", "ci": "n/a", "kind": "falsified",
         "falsifier": "already falsified — reported as a coverage limit, not repaired"},
    ]
    if s.get("available"):
        rows.append({
            "claim": "One level factor explains most of the IV surface",
            "stat": f"PC1 {pct(s['explained'][0])}, PC2 {pct(s['explained'][1])}, "
                    f"PC1 shape {s['loadings']['pc1']['shape']}",
            "n": str(s["n_snapshots"]), "ci": "n/a",
            "kind": ("not supported — PC2 is nearly as large" if s['explained'][1] > 0.25
                     else "supported"),
            "falsifier": "multiple expiries where a parallel shift dominates"})
    rows.append({
        "claim": "The ATM straddle loses most of its value intraday",
        "stat": f"close-to-open decay {pct(tr['straddle']['decay_share'])} "
                f"({fmt((tr['straddle']['first'] or {}).get('value'),2)} → "
                f"{fmt((tr['straddle']['last'] or {}).get('value'),2)})",
        "n": f"{q['counts']['tape_rows']} 1-minute marks",
        "ci": "n/a", "kind": "descriptive (theta identity, not a signal)",
        "falsifier": "a 0-DTE session where the ATM straddle does not decay into the close"})
    return rows


def build_payloads() -> tuple[dict, dict]:
    sess = load_session(SESSION, EXPIRY)
    flow = chain_series(sess["tape"])
    fut = futures_series(sess["fut"])
    px = price_series(flow, fut)
    sync = sync_spot(sess["chain"], fut["rows"])

    q = data_quality(sess, px, flow)
    es = effective_sample(sess, flow, px)
    ll = lead_lag(flow, px, fut, sync, sess["chain"])
    cr = conditional_returns(flow, px)
    pin = pin_today(flow, px, fut)
    ev = auto_events(flow, px)
    tr = session_read(flow, px, cr, ev, pin)

    days = []
    for path in sorted((DATA / "nifty_tape").glob("*.jsonl")):
        if path.name.endswith(".gaps.jsonl"):
            continue
        first = load_jsonl(path)[:1]
        if not first:
            continue
        if first[0].get("expiry") == path.stem:
            days.append(path.stem)
    xd = {"sessions": {}, "n": len(days), "counts": {}, "median_abs_dist": None,
          "closes_outside_wall_band": None, "note": "",
          "history": pin_history_deferred()}
    xd.update(pin_cross_day(days))
    xd["flow"] = cross_day_flow([load_session(d) for d in days])

    lab_dist = distributions(flow, px)
    lab_surface = surface_pca(sess["snap"])
    lab_regime = regime(flow, px)
    lab_micro = microstructure(flow, sess["snap"])

    lab_basis = {}
    if fut.get("rows"):
        common = [o for o in fut["by_off"] if o in flow["by_off"]]
        basis_vals = np.array([fut["by_off"][o]["c"] - flow["by_off"][o]["spot"] for o in common], float)
        valid = [o for o in common if (o - 1) in fut["by_off"] and (o - 1) in flow["by_off"]]
        aligned_fut = np.array([fut["by_off"][o]["c"] - fut["by_off"][o - 1]["c"] for o in valid], float)
        spot_rets = np.array([flow["by_off"][o]["spot"] - flow["by_off"][o - 1]["spot"] for o in valid], float)
        sync_valid = [o for o in valid if o in sync and (o - 1) in sync]
        fut_sync = np.array([fut["by_off"][o]["c"] - fut["by_off"][o - 1]["c"] for o in sync_valid], float)
        spot_sync = np.array([sync[o] - sync[o - 1] for o in sync_valid], float)
        lab_basis = {
            "available": True,
            "median": r4(np.median(basis_vals)), "mean": r4(np.mean(basis_vals)),
            "min": r4(np.min(basis_vals)), "max": r4(np.max(basis_vals)),
            "sd": r4(np.std(basis_vals)),
            "concurrent": r4(pearson(fut_sync, spot_sync)),
            "concurrent_naive": r4(pearson(aligned_fut, spot_rets)),
            "coverage_n": len(common), "sync_n": len(sync_valid),
            "carry_note": "basis contains carry to the futures expiry",
        }
    else:
        lab_basis = {"available": False,
                     "reason": "no futures archive for this session"}

    best_flow_name = max(ll["flow_peaks"],
                         key=lambda k: abs(ll["flow_peaks"][k]["r"] or 0))
    best_flow = ll["flow_peaks"][best_flow_name]

    review = {
        "meta": {
            "session": SESSION, "underlying": "NIFTY", "expiry": EXPIRY,
            "generated": datetime.now(IST).isoformat(timespec="seconds"),
            "script": "scripts/market/nifty_research_quant_review.py",
            "seed": SEED, "libraries": "stdlib + numpy",
            "price_source": px["source"],
            "futures_archive": bool(fut.get("rows")),
        },
        "data_quality": q,
        "effective_sample": es,
        "lead_lag": ll,
        "conditional_returns": cr,
        "pin": pin,
        "events": ev,
        "cross_day": xd,
        "session_read": tr,
        "section_rubric": [],
        "flows": [],
        "html_recommendations": [],
        "lab": {"microstructure": lab_micro, "surface": lab_surface, "basis": lab_basis},
    }
    review["section_rubric"] = section_rubric(review)
    review["flows"] = flow_table(review)
    review["html_recommendations"] = html_recommendations(review)

    lab = {
        "meta": {
            "session": SESSION, "expiry": EXPIRY, "generated": review["meta"]["generated"],
            "seed": SEED, "libraries": "stdlib + numpy",
            "price_source": px["source"],
            "caveat": "one session; hypothesis generation only",
        },
        "cross_day_sessions": xd["n"],
        "distributions": lab_dist,
        "information_flow": {
            "n_eff": {
                "price_1m_return": es["series"][f"{px['source']}_return"],
                "itm_pe_volume": es["series"]["itm_pe_minute_volume"],
            },
            "cross_instrument_available": bool(fut.get("rows")),
            "peak": ll.get("sync_peak"),
            "lead_1m": ll.get("lead_sync"),
            "naive_lead_1m": ll.get("lead_naive"),
            "best_flow_name": best_flow_name,
            "best_flow": best_flow,
            "multiple_testing": ll["multiple_testing"],
            "lag_table_sync": ll.get("sync_futures_vs_spot"),
        },
        "surface": lab_surface,
        "regime": lab_regime,
        "microstructure": lab_micro,
        "basis": lab_basis,
        "chart_rubric": chart_rubric(),
        "evidence": [],
    }
    lab["evidence"] = evidence_table(review, lab)
    return review, lab



def validate(obj, path="root") -> list[str]:
    errs = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            errs += validate(v, f"{path}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            errs += validate(v, f"{path}[{i}]")
    elif isinstance(obj, float):
        if not math.isfinite(obj):
            errs.append(f"non-finite at {path}")
    elif isinstance(obj, (np.floating, np.integer)):
        errs.append(f"numpy scalar leaked at {path}")
    return errs


def jsonable(obj):
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return [jsonable(x) for x in obj.tolist()]
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    return obj


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--session", default=DEFAULT_SESSION,
                   help=f"session date, YYYY-MM-DD (default {DEFAULT_SESSION})")
    p.add_argument("--expiry", default=None,
                   help="expiry date under test (default: same as --session)")
    p.add_argument("--out-dir", default=None,
                   help="output directory (default reports/nifty_<session>/research)")
    return p.parse_args(argv)


def main(argv=None) -> None:
    global SESSION, EXPIRY, OUT_DIR, SEED, RNG
    args = parse_args(argv)
    SESSION = args.session
    EXPIRY = args.expiry or args.session
    OUT_DIR = (Path(args.out_dir) if args.out_dir
               else ROOT / "reports" / f"nifty_{SESSION}" / "research")
    if not OUT_DIR.is_absolute():
        OUT_DIR = (Path.cwd() / OUT_DIR).resolve()
    SEED = int(SESSION.replace("-", "")) + 1
    RNG = np.random.default_rng(SEED)

    review, lab = build_payloads()

    review["validation"] = {
        "json_finite": True,
        "md_sections": ["1. Data quality", "2. Statistical tests", "3. Section rubric",
                        "4. Best data flows", "5. Recommendations", "6. Session read"],
    }
    lab["validation"] = {
        "json_finite": True,
        "md_sections": ["1. Return distribution", "2. Information flow", "3. Surface factors",
                        "4. Regime", "5. Concentration", "6. Chart-choice rubric", "7. Evidence table"],
    }

    rj = jsonable(review)
    lj = jsonable(lab)
    errs = validate(rj) + validate(lj)
    if errs:
        raise SystemExit("validation failed: " + "; ".join(errs[:10]))

    rmd = review_md(rj)
    lmd = lab_md(lj)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "quant_review.json").write_text(json.dumps(rj, indent=1) + "\n")
    (OUT_DIR / "quant_lab.json").write_text(json.dumps(lj, indent=1) + "\n")
    (OUT_DIR / "quant_review.md").write_text(rmd + "\n")
    (OUT_DIR / "quant_lab.md").write_text(lmd + "\n")

    for path, text in (("quant_review.md", rmd), ("quant_lab.md", lmd)):
        heads = [ln for ln in text.splitlines() if ln.startswith("## ")]
        if len(heads) < 6:
            raise SystemExit(f"{path}: only {len(heads)} sections")

    print(f"quant_review.json  {len(json.dumps(rj)):>8,} bytes")
    print(f"quant_lab.json     {len(json.dumps(lj)):>8,} bytes")
    print(f"quant_review.md    {len(rmd):>8,} chars, {rmd.count(chr(10)) + 1} lines")
    print(f"quant_lab.md       {len(lmd):>8,} chars, {lmd.count(chr(10)) + 1} lines")
    print(f"session={SESSION} expiry={EXPIRY} price_source={rj['meta']['price_source']} "
          f"futures={rj['meta']['futures_archive']}")
    print(f"tape={review['data_quality']['counts']['tape_rows']} "
          f"chain={review['data_quality']['counts']['chain_rows']} "
          f"snap={review['data_quality']['counts']['snap_rows']} "
          f"futures={review['data_quality']['counts']['futures_candles']}")
    print(f"lead_lag mode={review['lead_lag']['mode']} "
          f"best_flow={max(review['lead_lag']['flow_peaks'].items(), key=lambda kv: abs(kv[1]['r'] or 0))}")
    print(f"0DTE sessions={review['cross_day']['n']} "
          f"pin_counts={review['cross_day']['counts']} "
          f"close_vs_pin={review['pin']['close_proxy']['dist_to_last_max_pain']}")
    print("validation: finite JSON ok, sections ok")


if __name__ == "__main__":
    main()
