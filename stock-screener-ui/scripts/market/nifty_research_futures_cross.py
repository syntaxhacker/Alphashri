#!/usr/bin/env python3
"""NIFTY futures basis + cross-market confirmation research fragment.

Answers one question for the 2026-11-17 0-DTE session: was the 11:45-12:00
move confirmed by (a) the futures basis, (b) futures OI/volume, and (c) SENSEX,
or was it a NIFTY-only squeeze?

Outputs a self-contained HTML *fragment* (no head/body/CDN; the assembler owns
D3/Plotly) plus a machine-readable JSON payload.

    .venv/bin/python scripts/market/nifty_research_futures_cross.py
    .venv/bin/python scripts/market/nifty_research_futures_cross.py --check

Method notes that matter for reading the numbers:

* basis = futures close (bar ending m:59) - spot tape snapshot (stamped m:~25s).
  That is a ~35 second leg offset, so the raw basis is biased by intra-minute
  drift. A time-aligned variant linearly interpolates the futures bar between
  its open and close at the spot timestamp; both are plotted.
* lead-lag is a Pearson correlation of 1-minute price changes at integer lags,
  computed twice: on the naive tape clock and on spot re-sampled from the 10s
  chain at the futures candle close. Negative lag = futures leads. The
  difference between the two is the sampling offset, not a tradable lead.
* SENSEX comes from the same-minute snapshot snapshots (~60s cadence, 281 of
  293 minutes). Its expiry is 2026-11-19 while NIFTY is 0-DTE, so it is a
  control for "index-wide", not a like-for-like expiry-day proxy.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
from bisect import bisect_left
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

import numpy as np

IST = timezone(timedelta(hours=5, minutes=30))
REPO_ROOT = Path(__file__).resolve().parents[2]
SESSION = "2026-11-17"

FUTURES_FILE = REPO_ROOT / "reports" / f"nifty_{SESSION}" / "data" / "futures_1m.json"
TAPE_FILE = REPO_ROOT / "experiments" / "data" / "nifty_tape" / f"{SESSION}.jsonl"
CHAIN_FILE = REPO_ROOT / "experiments" / "data" / "nifty_chain10s" / f"{SESSION}.jsonl"
SNAP_FILE = REPO_ROOT / "experiments" / "data" / "nifty_snapshots" / f"{SESSION}.jsonl"
OUT_HTML = REPO_ROOT / "reports" / f"nifty_{SESSION}" / "research" / "futures_cross.html"
OUT_JSON = REPO_ROOT / "reports" / f"nifty_{SESSION}" / "research" / "futures_cross.json"
PALETTE_FILE = REPO_ROOT / "src" / "ui" / "palette.ts"

CLIP_MINUTE = 14 * 60 + 9
SESSION_OPEN = 9 * 60 + 15
NOON = 12 * 60
IMPULSE_START = 11 * 60 + 45
IMPULSE_END = 12 * 60 + 5
REGIME_MINUTES = 15
PRICE_THRESHOLD = 5.0              # pts; neutral floor
OI_THRESHOLD = 20_000              # contracts; neutral floor
MAX_LAG = 5

REGIME_LABELS = {
    "long_buildup": "Long buildup",
    "short_buildup": "Short buildup",
    "long_unwinding": "Long unwinding",
    "short_covering": "Short covering",
    "neutral": "Neutral",
}
REGIME_ORDER = ["long_buildup", "short_covering", "short_buildup", "long_unwinding", "neutral"]

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def minute_of(iso: str) -> int:
    return int(iso[11:13]) * 60 + int(iso[14:16])


def hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def quantile(values: list[float], q: float) -> float:
    s = sorted(values)
    pos = (len(s) - 1) * q
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def describe(values: list[float]) -> dict:
    mean = statistics.fmean(values)
    sd = statistics.pstdev(values)
    peak = max(values)
    trough = min(values)
    return {
        "mean": mean,
        "median": statistics.median(values),
        "sd": sd,
        "min": trough,
        "max": peak,
        "p5": quantile(values, 0.05),
        "p25": quantile(values, 0.25),
        "p75": quantile(values, 0.75),
        "p95": quantile(values, 0.95),
        "z_max": (peak - mean) / sd if sd else 0.0,
        "z_min": (trough - mean) / sd if sd else 0.0,
        "rank_max": sum(1 for v in values if v <= peak) / len(values),
    }


def corr(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 3:
        return float("nan")
    mx = statistics.fmean(xs)
    my = statistics.fmean(ys)
    sxx = sum((a - mx) ** 2 for a in xs)
    syy = sum((b - my) ** 2 for b in ys)
    if sxx <= 0 or syy <= 0:
        return float("nan")
    return sum((a - mx) * (b - my) for a, b in zip(xs, ys)) / math.sqrt(sxx * syy)


def log_returns(series: dict[int, float]) -> dict[int, float]:
    ks = sorted(series)
    out = {}
    for prev, cur in zip(ks, ks[1:]):
        if cur - prev == 1 and series[prev] > 0:
            out[cur] = math.log(series[cur] / series[prev])
    return out


def alpha(hex_color: str, opacity: float) -> str:
    raw = hex_color.lstrip("#")
    r, g, b = (int(raw[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r}, {g}, {b}, {opacity})"


def load_palette() -> dict[str, str]:
    txt = PALETTE_FILE.read_text()
    anchors = {
        "PRIMARY": "primary", "POSITIVE_COLOR": "positive", "NEGATIVE_COLOR": "negative",
        "TEXT_COLOR": "text", "TEXT_MUTED_COLOR": "muted", "BG_COLOR": "bg",
        "SURFACE_COLOR": "surface", "SURFACE_ALT_COLOR": "raised",
        "BORDER_COLOR": "border", "INFO": "info", "WARNING": "warning",
    }
    out: dict[str, str] = {}
    for const, name in anchors.items():
        m = re.search(rf'export const {const}\s*=\s*"(#[0-9A-Fa-f]{{6}})"', txt)
        if not m:
            raise SystemExit(f"palette.ts: missing {const}")
        out[name] = m.group(1)
    out["mono"] = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
    out["sans"] = 'ui-sans-serif, -apple-system, "Segoe UI", Inter, Roboto, sans-serif'
    out["tint_primary"] = alpha(out["primary"], 0.14)
    out["tint_info"] = alpha(out["info"], 0.10)
    out["tint_positive"] = alpha(out["positive"], 0.14)
    out["tint_negative"] = alpha(out["negative"], 0.14)
    out["tint_neutral"] = alpha(out["muted"], 0.16)
    out["grid"] = alpha(out["border"], 0.55)
    return out


def load_inputs() -> tuple[
    dict[int, dict], dict[int, float], dict[int, float], dict[int, float], dict[int, float]
]:
    fut_all = json.loads(FUTURES_FILE.read_text())["candles"]
    fut = {minute_of(bar["t"]): bar for bar in fut_all if minute_of(bar["t"]) <= CLIP_MINUTE}

    spot_rows: dict[int, list[tuple[float, float]]] = {}
    tape_last: dict[int, float] = {}
    for row in load_jsonl(TAPE_FILE):
        m = minute_of(row["t"])
        if m > CLIP_MINUTE:
            continue
        spot_rows.setdefault(m, []).append((float(row["t"][17:19]), float(row["spot"])))
        tape_last[m] = float(row["spot"])

    nifty: dict[int, float] = {}
    spot_second: dict[int, float] = {}
    for m, vals in spot_rows.items():
        nifty[m] = statistics.fmean(v for _, v in vals)
        spot_second[m] = statistics.fmean(s for s, _ in vals)

    sensex_rows: dict[int, list[float]] = {}
    for row in load_jsonl(SNAP_FILE):
        block = row.get("sensex")
        if not block or "spot" not in block:
            continue
        m = minute_of(row["t"])
        if m > CLIP_MINUTE:
            continue
        sensex_rows.setdefault(m, []).append(float(block["spot"]))
    sensex = {m: statistics.fmean(v) for m, v in sensex_rows.items()}

    return fut, nifty, spot_second, sensex, tape_last


def load_chain_spot() -> list[tuple[datetime, float]]:
    """10-second chain spot prints used to re-sample spot at the bar close."""
    out: list[tuple[datetime, float]] = []
    for row in load_jsonl(CHAIN_FILE):
        spot = row.get("spot")
        if spot is None:
            spot = (row.get("report") or {}).get("spot")
        if spot is None:
            continue
        m = minute_of(row["t"])
        if m > CLIP_MINUTE:
            continue
        out.append((datetime.fromisoformat(row["t"]), float(spot)))
    return out


def sync_spot_at_close(fut: dict[int, dict], chain: list[tuple[datetime, float]],
                       tol_s: float = 6.0) -> dict[int, float]:
    """Spot nearest each futures candle close (:59) within tol_s.

    The tape prints ~25-42 s before the bar closes, so the naive pairing
    straddles the bar and manufactures a lead. Sampling the 10s chain at the
    close puts both return series on the same wall-clock window.
    """
    stamps = [t for t, _ in chain]
    out: dict[int, float] = {}
    for m, bar in fut.items():
        target = datetime.fromisoformat(bar["t"]) + timedelta(seconds=59)
        i = bisect_left(stamps, target)
        cands = [j for j in (i - 1, i) if 0 <= j < len(stamps)]
        if not cands:
            continue
        j = min(cands, key=lambda j: abs((stamps[j] - target).total_seconds()))
        if abs((stamps[j] - target).total_seconds()) <= tol_s:
            out[m] = chain[j][1]
    return out


def build_basis(fut: dict[int, dict], nifty: dict[int, float], spot_second: dict[int, float]) -> list[dict]:
    rows: list[dict] = []
    prev_oi = None
    for m in sorted(nifty):
        bar = fut.get(m)
        if bar is None:
            continue
        weight = min(max(spot_second[m] / 60.0, 0.0), 1.0)
        aligned = bar["o"] + (bar["c"] - bar["o"]) * weight
        doi = 0 if prev_oi is None else int(bar["oi"] - prev_oi)
        prev_oi = bar["oi"]
        rows.append({
            "m": m,
            "t": hhmm(m),
            "f": round(bar["c"], 2),
            "s": round(nifty[m], 2),
            "b": round(bar["c"] - nifty[m], 2),
            "ba": round(aligned - nifty[m], 2),
            "oi": int(bar["oi"]),
            "doi": doi,
            "v": int(bar["v"]),
            "sec": round(spot_second[m], 1),
        })
    return rows


def classify(dp: float, doi: float) -> str:
    if abs(dp) < PRICE_THRESHOLD and abs(doi) < OI_THRESHOLD:
        return "neutral"
    if dp >= 0 and doi >= 0:
        return "long_buildup"
    if dp < 0 and doi >= 0:
        return "short_buildup"
    if dp < 0 and doi < 0:
        return "long_unwinding"
    return "short_covering"


def build_regimes(fut: dict[int, dict]) -> list[dict]:
    last = max(fut)
    buckets: list[dict] = []
    start = SESSION_OPEN
    while start < last:
        end = min(start + REGIME_MINUTES, last)
        if start not in fut or end not in fut:
            start = end
            continue
        dp = fut[end]["c"] - fut[start]["c"]
        doi = fut[end]["oi"] - fut[start]["oi"]
        vol = sum(fut[k]["v"] for k in range(start + 1, end + 1) if k in fut)
        key = classify(dp, doi)
        buckets.append({
            "s": start,
            "e": end,
            "start": hhmm(start),
            "end": hhmm(end),
            "dp": round(dp, 1),
            "doi": int(doi),
            "vol": int(vol),
            "key": key,
            "label": REGIME_LABELS[key],
            "partial": end - start < REGIME_MINUTES,
        })
        start = end
    return buckets


def _lag_pairs(x: np.ndarray, y: np.ndarray, lag: int) -> tuple[np.ndarray, np.ndarray]:
    if lag > 0:
        return x[lag:], y[:-lag]
    if lag < 0:
        return x[:lag], y[-lag:]
    return x, y


def _pearson(x: np.ndarray, y: np.ndarray) -> tuple[float, int]:
    mask = np.isfinite(x) & np.isfinite(y)
    a, b = x[mask], y[mask]
    if len(a) < 5 or a.std() == 0 or b.std() == 0:
        return float("nan"), int(len(a))
    return float(np.corrcoef(a, b)[0, 1]), int(len(a))


def _fisher_ci(r: float, n: int, z: float = 1.959964) -> list[float] | None:
    if not math.isfinite(r) or n < 6 or abs(r) >= 1:
        return None
    zr = 0.5 * math.log((1 + r) / (1 - r))
    se = 1 / math.sqrt(n - 3)
    return [math.tanh(zr - z * se), math.tanh(zr + z * se)]


def _block_boot_ci(x: np.ndarray, y: np.ndarray, lags: list[int], rng: np.random.Generator,
                   block: int = 10, reps: int = 1200) -> dict[int, list[float]]:
    """Circular block bootstrap over aligned pairs, identical to the quant review."""
    n = len(x)
    block = max(2, min(block, max(2, n // 6)))
    nblocks = int(math.ceil(n / block))
    out: dict[int, list[float]] = {}
    for lag in lags:
        vals = []
        for _ in range(reps):
            starts = rng.integers(0, n, size=nblocks)
            idx = np.concatenate([(s0 + np.arange(block)) % n for s0 in starts])[:n]
            a, b = _lag_pairs(x[idx], y[idx], lag)
            m = min(len(a), len(b))
            r, _ = _pearson(a[:m], b[:m])
            if math.isfinite(r):
                vals.append(r)
        out[lag] = ([float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]
                    if len(vals) >= 50 else [float("nan"), float("nan")])
    return out


def build_leadlag(fut: dict[int, dict], tape_last: dict[int, float], sync: dict[int, float]) -> dict:
    """Futures vs spot one-minute price changes, naive and clock-aligned.

    Convention follows the quant review: lag = spot minute - futures minute,
    so negative lag means futures leads. Returns are point changes, not logs.
    """
    common = sorted(set(fut) & set(tape_last))
    f_close = np.array([fut[m]["c"] for m in common], float)
    naive_spot = np.array([tape_last[m] for m in common], float)
    sync_spot = np.array([sync.get(m, np.nan) for m in common], float)

    f_ret = np.diff(f_close)
    s_naive = np.diff(naive_spot)
    s_sync = np.diff(sync_spot)

    rows = []
    for lag in range(-MAX_LAG, MAX_LAG + 1):
        a, b = _lag_pairs(f_ret, s_naive, lag)
        rn, nn = _pearson(a, b)
        a2, b2 = _lag_pairs(f_ret, s_sync, lag)
        rs, ns = _pearson(a2, b2)
        rows.append({
            "lag": lag, "naive": rn, "sync": rs,
            "naive_ci": _fisher_ci(rn, nn), "sync_ci": _fisher_ci(rs, ns),
            "n_naive": nn, "n_sync": ns,
        })

    rng = np.random.default_rng(20261117)
    boot = _block_boot_ci(f_ret, s_sync, [-2, -1, 0, 1, 2], rng)
    boot.update(_block_boot_ci(f_ret, s_sync, [-5, -4, -3, 3, 4, 5], rng))
    for row in rows:
        ci = boot.get(row["lag"])
        if ci and math.isfinite(ci[0]):
            row["sync_ci"] = ci

    by_lag = {r["lag"]: r for r in rows}
    naive_lead = by_lag[-1]["naive"]
    sync_lead = by_lag[-1]["sync"]
    attributable = 1 - sync_lead / naive_lead if naive_lead else float("nan")

    naive_autocorr = _pearson(f_ret[:-1], f_ret[1:])[0]
    spot_autocorr = _pearson(s_naive[:-1], s_naive[1:])[0]

    return {
        "method": {
            "naive": "tape spot at its drift stamp (~:25) vs futures bar close (:59)",
            "sync": "chain10s spot nearest the candle close, tolerance 6s",
            "returns": "first difference of price (points), not log returns",
            "lag_sign": "lag = spot minute - futures minute; negative = futures leads",
            "ci": "circular block bootstrap, block=10, reps=1200, seed 20261117",
        },
        "rows": rows,
        "minutes": len(common),
        "sync_coverage": sum(1 for m in common if m in sync),
        "tolerance_s": 6.0,
        "concurrent": by_lag[0]["sync"],
        "concurrent_naive": by_lag[0]["naive"],
        "lead_1_naive": naive_lead,
        "lead_1_sync": sync_lead,
        "lead_1_ci": by_lag[-1]["sync_ci"],
        "lag0_ci": by_lag[0]["sync_ci"],
        "attributable_to_sampling": attributable,
        "autocorr_fut_1": naive_autocorr,
        "autocorr_spot_1": spot_autocorr,
    }


def build_cross(nifty: dict[int, float], sensex: dict[int, float]) -> dict:
    common = sorted(set(nifty) & set(sensex))
    base_m = common[0]
    base_n, base_s = nifty[base_m], sensex[base_m]
    rows = [{
        "m": m,
        "t": hhmm(m),
        "n": round((nifty[m] / base_n - 1) * 100, 4),
        "s": round((sensex[m] / base_s - 1) * 100, 4),
        "spread": round((nifty[m] / base_n - sensex[m] / base_s) * 10_000, 2),
    } for m in common]

    rn = log_returns({m: nifty[m] for m in common})
    rs = log_returns({m: sensex[m] for m in common})
    ret_minutes = sorted(set(rn) & set(rs))
    xs = [rn[m] for m in ret_minutes]
    ys = [rs[m] for m in ret_minutes]
    mean_y = statistics.fmean(ys)
    beta = (
        sum((b - mean_y) * (a - statistics.fmean(xs)) for a, b in zip(xs, ys))
        / sum((b - mean_y) ** 2 for b in ys)
    ) if len(ys) > 2 else float("nan")

    spreads = [r["spread"] for r in rows]
    widest = max(rows, key=lambda r: abs(r["spread"]))
    return {
        "rows": rows,
        "stats": {
            "n_minutes": len(common),
            "base_time": hhmm(base_m),
            "nifty_base": base_n,
            "sensex_base": base_s,
            "corr_1m": corr(xs, ys),
            "beta": beta,
            "n_returns": len(ret_minutes),
            "spread_mean": statistics.fmean(spreads),
            "spread_sd": statistics.pstdev(spreads),
            "spread_min": min(spreads),
            "spread_max": max(spreads),
            "widest_time": widest["t"],
            "widest_bps": widest["spread"],
            "first": {"n": rows[0]["n"], "s": rows[0]["s"]},
            "last": {"t": rows[-1]["t"], "n": rows[-1]["n"], "s": rows[-1]["s"], "spread": rows[-1]["spread"]},
        },
    }


def window_metrics(fut: dict[int, dict], nifty: dict[int, float], sensex: dict[int, float],
                   start: int, end: int) -> dict:
    vol = sum(fut[k]["v"] for k in range(start + 1, end + 1) if k in fut)
    dp = fut[end]["c"] - fut[start]["c"]
    doi = fut[end]["oi"] - fut[start]["oi"]
    return {
        "start": hhmm(start),
        "end": hhmm(end),
        "dp": round(dp, 1),
        "dp_pct": round((fut[end]["c"] / fut[start]["c"] - 1) * 100, 4),
        "doi": int(doi),
        "vol": int(vol),
        "regime": classify(dp, doi),
        "spot_pts": round(nifty[end] - nifty[start], 2),
        "spot_pct": round((nifty[end] / nifty[start] - 1) * 100, 4),
        "sensex_pct": round((sensex[end] / sensex[start] - 1) * 100, 4),
        "div_bps": round(((nifty[end] / nifty[start]) - (sensex[end] / sensex[start])) * 10_000, 2),
        "fut_excess_pts": round(dp - (nifty[end] - nifty[start]), 2),
    }


def build_events(basis_rows: list[dict], nifty: dict[int, float], sensex: dict[int, float],
                 sensex_base: float, nifty_base: float) -> list[dict]:
    by_min = {r["m"]: r for r in basis_rows}
    noon = by_min[NOON]
    out = []
    for off in (-30, -15, -5, 0, 5, 15, 30):
        m = NOON + off
        if m not in by_min:
            continue
        row = by_min[m]
        out.append({
            "off": off,
            "m": m,
            "t": row["t"],
            "f": row["f"],
            "df": round(row["f"] - noon["f"], 1),
            "oi": row["oi"],
            "doi": row["oi"] - noon["oi"],
            "b": row["b"],
            "ba": row["ba"],
            "npct": round((nifty[m] / nifty_base - 1) * 100, 3),
            "spct": round((sensex[m] / sensex_base - 1) * 100, 3),
            "spread": round(((nifty[m] / nifty_base) - (sensex[m] / sensex_base)) * 10_000, 2),
        })
    return out


def basis_forward_check(rows: list[dict], nifty: dict[int, float], horizon: int = 5) -> dict:
    if not rows:
        return {"r": float("nan"), "n": 0, "horizon": horizon}
    values = [r["ba"] for r in rows]
    mean = statistics.fmean(values)
    sd = statistics.pstdev(values)
    xs, ys = [], []
    for r in rows:
        m = r["m"]
        if m + horizon not in nifty or m not in nifty or sd == 0:
            continue
        xs.append((r["ba"] - mean) / sd)
        ys.append(nifty[m + horizon] / nifty[m] - 1)
    return {"r": corr(xs, ys), "n": len(xs), "horizon": horizon}


def build_payload() -> dict:
    fut, nifty, spot_second, sensex, tape_last = load_inputs()
    if not fut or not nifty or not sensex:
        raise SystemExit("missing input series")
    chain = load_chain_spot()
    sync = sync_spot_at_close(fut, chain)
    basis_rows = build_basis(fut, nifty, spot_second)
    b = [r["b"] for r in basis_rows]
    ba = [r["ba"] for r in basis_rows]

    at = {r["m"]: r for r in basis_rows}
    peak = max(basis_rows, key=lambda r: r["b"])
    trough = min(basis_rows, key=lambda r: r["b"])
    peak_adj = max(basis_rows, key=lambda r: r["ba"])
    oi_peak = max(basis_rows, key=lambda r: r["oi"])

    stats = describe(b)
    stats_adj = describe(ba)
    peak_adj_same = at[peak["m"]]["ba"] if peak["m"] in at else peak["ba"]
    stats["at"] = {
        "peak": {
            "t": peak["t"],
            "v": peak["b"],
            "oi": peak["oi"],
            "v_adj": peak_adj_same,
            "z_adj_same": (peak_adj_same - stats_adj["mean"]) / stats_adj["sd"],
        },
        "trough": {"t": trough["t"], "v": trough["b"], "oi": trough["oi"], "v_adj": trough["ba"]},
        "peak_adj": {"t": peak_adj["t"], "v": peak_adj["ba"]},
        "noon": at[NOON]["b"],
        "noon_adj": at[NOON]["ba"],
        "impulse_start": at[IMPULSE_START]["b"],
        "rank_impulse": sum(1 for v in b if v <= at[IMPULSE_START]["b"]) / len(b),
        "z_peak": (peak["b"] - stats["mean"]) / stats["sd"],
        "z_peak_adj": (peak_adj["ba"] - stats_adj["mean"]) / stats_adj["sd"],
        "rich_1156": at[NOON - 4]["ba"] - stats_adj["mean"],
        "selloff": {
            "start_t": at[13 * 60]["t"],
            "trough_t": trough["t"],
            "fut_pts": round(trough["f"] - at[13 * 60]["f"], 1),
            "spot_pts": round(trough["s"] - at[13 * 60]["s"], 1),
            "recover_t": at[13 * 60 + 30]["t"],
            "recover_b": at[13 * 60 + 30]["b"],
        },
    }
    stats_adj["at"] = {
        "peak": {"t": peak_adj["t"], "v": peak_adj["ba"]},
        "noon": at[NOON]["ba"],
    }

    leadlag = build_leadlag(fut, tape_last, sync)
    cross = build_cross(nifty, sensex)
    sstats = cross["stats"]

    windows = {
        "pre": window_metrics(fut, nifty, sensex, 11 * 60 + 30, IMPULSE_START),
        "impulse": window_metrics(fut, nifty, sensex, IMPULSE_START, NOON),
        "pop": window_metrics(fut, nifty, sensex, IMPULSE_START, 11 * 60 + 55),
        "catchup": window_metrics(fut, nifty, sensex, 11 * 60 + 55, NOON),
        "stall": window_metrics(fut, nifty, sensex, NOON, 12 * 60 + 15),
        "retrace": window_metrics(fut, nifty, sensex, NOON, 12 * 60 + 45),
        "unwind": window_metrics(fut, nifty, sensex, 12 * 60 + 15, 12 * 60 + 45),
        "selloff": window_metrics(fut, nifty, sensex, 13 * 60, 13 * 60 + 30),
    }

    events = build_events(basis_rows, nifty, sensex, sstats["sensex_base"], sstats["nifty_base"])
    regimes = build_regimes(fut)
    sensex_minutes = sorted(sensex)
    sensex_gaps = [b - a for a, b in zip(sensex_minutes, sensex_minutes[1:])]
    forward = basis_forward_check(basis_rows, nifty)

    return {
        "session": SESSION,
        "generated": datetime.now(IST).isoformat(timespec="seconds"),
        "clip": hhmm(max(fut)),
        "coverage": {
            "futures_first": hhmm(min(fut)),
            "futures_last": hhmm(max(fut)),
            "basis_first": basis_rows[0]["t"],
            "basis_last": basis_rows[-1]["t"],
            "basis_n": len(basis_rows),
            "futures_n": len(fut),
            "spot_seconds_median": statistics.median(spot_second.values()),
            "sensex_n": len(sensex),
            "sensex_gap_max": max(sensex_gaps) if sensex_gaps else 0,
            "sensex_expiry": "2026-11-19",
            "nifty_expiry": "2026-11-17",
            "chain_n": len(chain),
            "chain_gap_median_s": round(statistics.median(
                [(b - a).total_seconds() for (a, _), (b, _) in zip(chain, chain[1:])]
            ), 1) if len(chain) > 1 else 0,
            "sync_n": len(sync),
        },
        "basis": {"rows": basis_rows, "stats": stats, "stats_adj": stats_adj},
        "forward_check": forward,
        "regimes": regimes,
        "leadlag": leadlag,
        "cross": cross,
        "windows": windows,
        "events": events,
        "oi_peak": {"t": oi_peak["t"], "oi": oi_peak["oi"], "doi_from_noon": oi_peak["oi"] - at[NOON]["oi"]},
        "palette": load_palette(),
    }


def fmt(value: float, digits: int = 1) -> str:
    return f"{value:,.{digits}f}"


def sgn(value: float, digits: int = 1) -> str:
    return f"{value:+,.{digits}f}"


def ci_text(ci: list[float] | None) -> str:
    if not ci:
        return "n/a"
    lo = f"{ci[0]:.3f}".replace("-", "−")
    hi = f"{ci[1]:.3f}".replace("-", "−")
    return f"{lo} to {hi}"


BASE_CSS = """
#research-futures-cross *,#research-futures-cross *::before,#research-futures-cross *::after{box-sizing:border-box}
#research-futures-cross{
  background:var(--fc-bg);color:var(--fc-text);display:block;
  font-family:var(--fc-sans);font-size:13px;line-height:1.5;
  padding:16px;border:1px solid var(--fc-border);border-radius:10px;
  max-width:100%;overflow-x:clip;
}
#research-futures-cross .fc-wrap{display:flex;flex-direction:column;gap:16px;min-width:0}
#research-futures-cross h2{font-size:20px;line-height:1.25;margin:2px 0 0;letter-spacing:-.01em}
#research-futures-cross h3{font-size:12px;margin:0;letter-spacing:.08em;text-transform:uppercase;color:var(--fc-muted);font-weight:600}
#research-futures-cross p{margin:0}
#research-futures-cross .fc-kicker{font-family:var(--fc-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--fc-primary)}
#research-futures-cross .fc-lede{color:var(--fc-muted);max-width:92ch;font-size:13px}
#research-futures-cross .fc-lede b{color:var(--fc-text);font-weight:600}
#research-futures-cross .fc-verdict{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
#research-futures-cross .fc-verdict>div{
  border:1px solid var(--fc-border);border-left-width:3px;border-radius:6px;
  background:var(--fc-surface);padding:8px 10px;min-width:0;
}
#research-futures-cross .fc-verdict .fc-ok{border-left-color:var(--fc-positive)}
#research-futures-cross .fc-verdict .fc-part{border-left-color:var(--fc-warning)}
#research-futures-cross .fc-verdict .fc-bad{border-left-color:var(--fc-negative)}
#research-futures-cross .fc-verdict dt{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--fc-muted);font-family:var(--fc-mono)}
#research-futures-cross .fc-verdict dd{margin:2px 0 0;font-size:12px;color:var(--fc-text)}
#research-futures-cross .fc-verdict dd b{font-family:var(--fc-mono);font-size:11px}
#research-futures-cross .fc-ok-text{color:var(--fc-positive)}
#research-futures-cross .fc-bad-text{color:var(--fc-negative)}
#research-futures-cross .fc-warn-text{color:var(--fc-warning)}
#research-futures-cross .fc-tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
#research-futures-cross .fc-tile{
  background:var(--fc-surface);border:1px solid var(--fc-border);border-radius:6px;
  padding:10px 11px;min-width:0;display:flex;flex-direction:column;gap:3px;
}
#research-futures-cross .fc-tile .fc-t-label{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--fc-muted);font-family:var(--fc-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#research-futures-cross .fc-tile .fc-t-value{font-family:var(--fc-mono);font-size:17px;line-height:1.15;font-variant-numeric:tabular-nums}
#research-futures-cross .fc-tile .fc-t-sub{font-size:10px;color:var(--fc-muted);font-family:var(--fc-mono)}
#research-futures-cross .fc-panel{
  background:var(--fc-surface);border:1px solid var(--fc-border);border-radius:8px;
  padding:12px;min-width:0;display:flex;flex-direction:column;gap:8px;
}
#research-futures-cross .fc-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
#research-futures-cross .fc-panel-head .fc-tag{font-family:var(--fc-mono);font-size:10px;color:var(--fc-muted);min-width:0;text-align:right;overflow-wrap:anywhere}
#research-futures-cross .fc-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
#research-futures-cross .fc-grid2>*{min-width:0}
#research-futures-cross .fc-3d-grid{display:grid;grid-template-columns:minmax(0,660px) minmax(0,1fr);gap:18px;align-items:start}
#research-futures-cross .fc-3d-read{display:flex;flex-direction:column;gap:13px;max-width:72ch;min-width:0}
#research-futures-cross .fc-step{display:grid;grid-template-columns:20px minmax(0,1fr);gap:9px}
#research-futures-cross .fc-step>span{font-family:var(--fc-mono);font-size:9px;color:var(--fc-primary);padding-top:2px}
#research-futures-cross .fc-step>b{font-size:11.5px;margin-bottom:2px}
#research-futures-cross .fc-step div>b{display:block;font-size:11.5px;color:var(--fc-text);margin-bottom:2px}
#research-futures-cross .fc-step p{font-size:11.5px;color:var(--fc-muted);line-height:1.55}
#research-futures-cross .fc-step p b{color:var(--fc-text);font-weight:600}
#research-futures-cross .fc-plot{width:100%;min-width:0}
#fc-plot-3d{height:420px}
#fc-plot-basis{height:300px}
#fc-plot-lag{height:260px}
#fc-plot-cross{height:300px}
#fc-plot-quad{height:380px}
#research-futures-cross .fc-note{font-size:11.5px;color:var(--fc-muted);line-height:1.55}
#research-futures-cross .fc-note b{color:var(--fc-text);font-weight:600}
#research-futures-cross .fc-note code{font-family:var(--fc-mono);font-size:10.5px;color:var(--fc-text);background:var(--fc-raised);padding:0 3px;border-radius:3px}
#research-futures-cross .fc-strip-wrap{margin-top:2px}
#research-futures-cross .fc-strip{display:flex;height:20px;margin:0 14px 0 54px}
#research-futures-cross .fc-strip span{display:block;height:100%;border-right:1px solid var(--fc-bg);min-width:2px;opacity:.85}
#research-futures-cross .fc-strip span:last-child{border-right:0}
#research-futures-cross .fc-strip-axis{position:relative;height:14px;margin:2px 14px 0 54px;font-family:var(--fc-mono);font-size:9px;color:var(--fc-muted)}
#research-futures-cross .fc-strip-axis span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
#research-futures-cross .fc-legend{display:flex;flex-wrap:wrap;gap:10px;font-family:var(--fc-mono);font-size:10px;color:var(--fc-muted)}
#research-futures-cross .fc-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:1px}
#research-futures-cross .fc-scroll{overflow-x:auto;min-width:0;-webkit-overflow-scrolling:touch}
#research-futures-cross .fc-scroll-hint{display:none}
#research-futures-cross table{border-collapse:collapse;width:100%;min-width:720px;font-family:var(--fc-mono);font-size:11px;font-variant-numeric:tabular-nums}
#research-futures-cross thead th{
  text-align:right;font-weight:600;font-size:9px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--fc-muted);padding:6px 8px;border-bottom:1px solid var(--fc-border);white-space:nowrap;
}
#research-futures-cross thead th:first-child,#research-futures-cross tbody td:first-child{text-align:left}
#research-futures-cross tbody td{text-align:right;padding:5px 8px;border-bottom:1px solid var(--fc-grid);white-space:nowrap}
#research-futures-cross tbody tr:hover{background:var(--fc-raised)}
#research-futures-cross tbody tr.fc-noon td{border-top:1px solid var(--fc-primary);border-bottom:1px solid var(--fc-primary)}
#research-futures-cross .fc-pos{color:var(--fc-positive)}
#research-futures-cross .fc-neg{color:var(--fc-negative)}
#research-futures-cross .fc-dim{color:var(--fc-muted)}
#research-futures-cross .fc-caveats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 20px}
#research-futures-cross .fc-caveats div{border-left:2px solid var(--fc-border);padding-left:10px;min-width:0}
#research-futures-cross .fc-caveats b{display:block;font-size:11px;color:var(--fc-text);margin-bottom:2px}
#research-futures-cross .fc-caveats p{font-size:11px;color:var(--fc-muted);line-height:1.55}
#research-futures-cross .fc-src{font-family:var(--fc-mono);font-size:10px;color:var(--fc-muted);line-height:1.7;overflow-wrap:anywhere}
#research-futures-cross .fc-src code{color:var(--fc-text)}
@media (max-width:1180px){
  #research-futures-cross .fc-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}
  #research-futures-cross .fc-verdict{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:820px){
  #research-futures-cross{padding:12px}
  #research-futures-cross .fc-grid2{grid-template-columns:minmax(0,1fr)}
  #research-futures-cross .fc-3d-grid{grid-template-columns:minmax(0,1fr)}
  #research-futures-cross .fc-caveats{grid-template-columns:minmax(0,1fr)}
  #fc-plot-3d{height:320px}
  #fc-plot-basis{height:250px}
  #fc-plot-cross{height:250px}
  #fc-plot-quad{height:320px}
}
@media (max-width:520px){
  #research-futures-cross .fc-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  #research-futures-cross .fc-verdict{grid-template-columns:minmax(0,1fr)}
  #research-futures-cross h2{font-size:17px}
  #research-futures-cross .fc-strip{margin:0 8px 0 46px}
  #research-futures-cross .fc-strip-axis{margin:2px 8px 0 46px}
  #research-futures-cross .fc-scroll-hint{display:inline}
  #research-futures-cross table{min-width:560px;font-size:10px}
  #research-futures-cross thead th{padding:5px 5px;font-size:8px}
  #research-futures-cross tbody td{padding:4px 5px}
  #research-futures-cross thead th:nth-child(2),#research-futures-cross tbody td:nth-child(2),
  #research-futures-cross thead th:nth-child(8),#research-futures-cross tbody td:nth-child(8){display:none}
  #fc-plot-3d{height:280px}
  #fc-plot-basis{height:236px}
  #fc-plot-cross{height:236px}
  #fc-plot-quad{height:300px}
}
"""

BASE_HTML = """__CSS__
<section data-research-section="futures-cross" id="research-futures-cross">
<div class="fc-wrap">
  <header>
    <div class="fc-kicker">NIFTY 0-DTE · __SESSION__ · research fragment</div>
    <h2>Futures basis &amp; cross-market confirmation</h2>
    <p class="fc-lede" style="margin-top:6px">
      The 11:45–12:00 impulse added <b>__IMP_DP__ pts</b> on <b>__IMP_DOI__ contracts</b> of fresh OI.
      Three independent witnesses could have contradicted it: the futures premium, the OI/volume regime,
      and SENSEX. <b>OI and SENSEX confirmed it cleanly; the basis only partly.</b>
      SENSEX moved <b>__IMP_SEN__</b> against NIFTY's <b>__IMP_NIF__</b> — only <b>__IMP_DIV__</b> apart, no divergence —
      so this was an index-wide bid, not a NIFTY-only squeeze. The headline basis print (<b>+__PEAK_B__</b>) is mostly a
      timestamp artifact: re-timed to the spot stamp it is <b>+__PEAK_ADJ__</b>. What survives is a ~__RICH_1156__-point
      rich premium for two minutes, but the apparent one-minute futures lead does not: <b>__OFFSET_PCT__% of it is clock
      offset</b>, and what remains (__LEAD_SYNC__) has a CI that includes zero. The position was real; the
      premium print was mostly the leg offset, and the lead was an artefact of sampling. The whole position
      still unwound by 12:45.
    </p>
  </header>

  <dl class="fc-verdict">
    <div class="fc-part"><dt>Basis</dt><dd>Partial. The <b>+__PEAK_B__</b> print at <b>__PEAK_T__</b> is a <b>~__SEC_OFFSET__s leg-offset</b> artifact; time-aligned it is <b>+__PEAK_ADJ__</b> (__PEAK_ADJ_SAME_Z__σ) with a ~__RICH_1156__-pt rich premium at 11:56–11:57.</dd></div>
    <div class="fc-ok"><dt>OI / volume</dt><dd>Confirmed. Price up + OI up = <b>long buildup</b>, not short covering: <b>__IMP_DOI__</b> contracts, <b>__IMP_VOL__</b> traded.</dd></div>
    <div class="fc-ok"><dt>SENSEX</dt><dd>Confirmed. <b>__XS_CORR__</b> 1-minute correlation, <b>__XS_BETA__</b> beta; impulse divergence only <b>__IMP_DIV__</b>.</dd></div>
    <div class="fc-bad"><dt>Follow-through</dt><dd>Absent. <b>__UNWIND_DOI__</b> contracts unwound 12:15→12:45 and price gave back <b>__RETRACE_DP__ pts</b> from the 12:00 level.</dd></div>
  </dl>

  <div class="fc-tiles">
    <div class="fc-tile"><span class="fc-t-label">Basis at 12:00</span><span class="fc-t-value">__NOON_B__</span><span class="fc-t-sub">mean __MEAN_B__ · p95 __P95_B__</span></div>
    <div class="fc-tile"><span class="fc-t-label">Basis peak 11:55</span><span class="fc-t-value fc-warn-text">__PEAK_B__</span><span class="fc-t-sub">__PEAK_Z__σ raw · __PEAK_ADJ__ aligned</span></div>
    <div class="fc-tile"><span class="fc-t-label">Futures 11:45→12:00</span><span class="fc-t-value fc-pos">__IMP_DP__ pts</span><span class="fc-t-sub">OI __IMP_DOI__ · __IMP_REGIME__</span></div>
    <div class="fc-tile"><span class="fc-t-label">Spot catch-up 11:55→12:00</span><span class="fc-t-value fc-pos">__CATCHUP_SPOT__ pts</span><span class="fc-t-sub">futures only __CATCHUP_FUT__ pts</span></div>
    <div class="fc-tile"><span class="fc-t-label">NIFTY − SENSEX impulse</span><span class="fc-t-value">__IMP_DIV__</span><span class="fc-t-sub">__IMP_NIF__ vs __IMP_SEN__</span></div>
    <div class="fc-tile"><span class="fc-t-label">Futures → spot 1m lead</span><span class="fc-t-value">__LEAD_SYNC__</span><span class="fc-t-sub">naive __LEAD_NAIVE__ · __OFFSET_PCT__% clock offset</span></div>
  </div>

  <section class="fc-panel">
    <div class="fc-panel-head">
      <h3>3D · time × basis × open interest</h3>
      <span class="fc-tag">x = session time · y = basis (pts) · z = OI · marker = OI Δ/min, size = volume</span>
    </div>
    <div class="fc-3d-grid">
      <div class="fc-plot" id="fc-plot-3d" role="img" aria-label="3D path of futures basis against open interest through the session"></div>
      <div class="fc-3d-read">
        <div class="fc-step"><span>01</span><div><b>11:45 → 11:55 · premium moves first</b><p>Raw basis prints <b>__PEAK_B__</b> (__PEAK_Z__σ) on <b>__POP_DP__ pts</b> but only <b>__POP_DOI__</b> contracts. Re-timed to the spot stamp the same minute is <b>__PEAK_ADJ__</b>: the 42-second leg offset, not a 30-point dislocation.</p></div></div>
        <div class="fc-step"><span>02</span><div><b>11:55 → 12:00 · spot pays up, size arrives</b><p>Spot adds <b>__CATCHUP_SPOT__ pts</b> while futures add only <b>__CATCHUP_FUT__ pts</b> — the gap closes from the spot side. OI rises <b>__CATCHUP_DOI__</b> on <b>__IMP_REGIME__</b>: fresh longs, not shorts covering.</p></div></div>
        <div class="fc-step"><span>03</span><div><b>12:00 → 12:15 · the bid stalls, shorts join</b><p>Price <b>__STALL_DP__ pts</b> with OI <b>__STALL_DOI__</b> — the quadrant flips to short buildup. Then 12:15→12:45 gives back <b>__UNWIND_DOI__</b> contracts and <b>__UNWIND_DP__ pts</b>.</p></div></div>
        <p class="fc-note">The ordering is the finding: <b>premium pop, then spot catch-up, then size, then unwind</b> — a demand burst being absorbed, not a repricing. Colour is OI Δ per minute; the amber and blue diamonds mark 11:55 and 12:28.</p>
      </div>
    </div>
  </section>

  <div class="fc-grid2">
    <section class="fc-panel">
      <div class="fc-panel-head">
        <h3>2D · basis path and regime strip</h3>
        <span class="fc-tag">close basis vs time-aligned basis</span>
      </div>
      <div class="fc-plot" id="fc-plot-basis" role="img" aria-label="Futures minus spot basis with mean and percentile bands"></div>
      <div class="fc-strip-wrap">
        <div class="fc-strip" id="fc-strip" aria-hidden="true"></div>
        <div class="fc-strip-axis" id="fc-strip-axis" aria-hidden="true"></div>
        <div class="fc-legend" id="fc-strip-legend" style="margin-top:6px"></div>
      </div>
      <p class="fc-note">
        The amber line is the book's convention (futures close − spot). The blue line re-times the futures leg to the
        spot stamp and shows how much of the 11:55 spike was the <b>~__SEC_OFFSET__s leg offset</b> plus intra-minute drift:
        raw <b>__PEAK_B__</b> (__PEAK_Z__σ) becomes <b>__PEAK_ADJ__</b> at the same minute (__PEAK_ADJ_SAME_Z__σ). The
        <b>direction survives, the spike does not</b> — the residual is a ~__RICH_1156__-pt rich premium at 11:56–11:57,
        not a 30-point dislocation. The basis trough <b>__TROUGH_B__ at __TROUGH_T__</b> is the mirror image: futures
        <b>__SELL_FUT__ pts</b> against spot <b>__SELL_SPOT__ pts</b> from 13:00, so that down-leg was <b>futures-led</b>;
        the premium then recovered to __TROUGH_RECOVER_B__ by __TROUGH_RECOVER_T__ as spot caught down.
      </p>
    </section>

    <section class="fc-panel">
      <div class="fc-panel-head">
        <h3>2D · lead–lag, naive vs clock-aligned</h3>
        <span class="fc-tag">1-min price changes · negative = futures leads · 95% CI</span>
      </div>
      <div class="fc-plot" id="fc-plot-lag" role="img" aria-label="Grouped bars of futures versus spot one-minute return correlation by lag, naive and clock-aligned"></div>
      <div class="fc-legend" id="fc-lag-legend" style="margin-top:2px"></div>
      <p class="fc-note">
        Negative lag = futures minute <code>t</code> against spot minute <code>t+k</code>, so a real one-minute lead
        would sit at <b>−1</b>. On the naive clock — tape spot stamped ~<b>:__SEC_OFFSET__</b>, futures bar closing
        <b>:59</b> — that lag reads <b>__LEAD_NAIVE__</b>. Re-sampling spot from the 10-second chain at the candle close
        (±6 s, __SYNC_N__ of __LL_N__ minutes) drops it to <b>__LEAD_SYNC__</b> (95% CI __LEAD_CI__) while same-minute
        correlation rises from __LAG0_NAIVE__ to <b>__LAG0_SYNC__</b>. About <b>__OFFSET_PCT__%</b> of the apparent
        one-minute lead is the sampling offset, and the residual CI touches zero:
        <b>no tradable lead from this data</b>. The same-minute co-movement is real; the lead is not.
      </p>
    </section>

    <section class="fc-panel">
      <div class="fc-panel-head">
        <h3>NIFTY vs SENSEX · normalized and spread</h3>
        <span class="fc-tag">both indexed to 09:15 · spread in bps</span>
      </div>
      <div class="fc-plot" id="fc-plot-cross" role="img" aria-label="Normalized NIFTY and SENSEX paths with their spread in basis points"></div>
      <p class="fc-note">
        Both indices lift off at the same minute — <b>11:56</b>, not 11:45. NIFTY's <b>__IMP_NIF__</b> against SENSEX's
        <b>__IMP_SEN__</b> over 11:45→12:00 leaves a <b>__IMP_DIV__</b> spread change, and the session-wide spread stays inside
        <b>__SPREAD_RANGE__</b>. That is the signature of an <b>index-wide bid</b>. The one caveat that matters: SENSEX expires
        19 Nov, NIFTY today, so SENSEX is the control for "is this the market or just this expiry" — and it says the market.
      </p>
    </section>

    <section class="fc-panel">
      <div class="fc-panel-head">
        <h3>15-minute price / OI quadrants</h3>
        <span class="fc-tag">Δprice vs ΔOI · bubble = traded volume</span>
      </div>
      <div class="fc-plot" id="fc-plot-quad" role="img" aria-label="Scatter of fifteen-minute futures price change against open interest change"></div>
      <p class="fc-note">
        The noon bucket sits alone in the top-right: <b>__IMP_DP__ pts with __IMP_DOI__ contracts</b>, the largest
        joint positive print of the session. It is immediately followed by the top-left (price down, OI up) bucket —
        new shorts joining a falling tape — and then bottom-left, where <b>__UNWIND_DOI__</b> contracts leave over
        12:15→12:45. The same 15-minute window is shaded on the basis chart so the premium and the position can be
        read together.
      </p>
    </section>
  </div>

  <section class="fc-panel">
    <div class="fc-panel-head">
      <h3>Event study · ±30 minutes around 12:00</h3>
      <span class="fc-tag">levels are session-relative; Δ columns are versus 12:00</span>
      <span class="fc-tag fc-scroll-hint" style="color:var(--fc-primary)">swipe table →</span>
    </div>
    <div class="fc-scroll"><table id="fc-event-table" aria-label="Event study around noon"></table></div>
    <p class="fc-note">
      The three columns that decide the question are the last three. NIFTY and SENSEX track within
      <b>__EVENT_MAXDIV__</b> through the whole window, and the spread is flat across noon — no NIFTY-only gap opens.
      Basis, meanwhile, is <b>__EVENT_B_RANGE__</b> wide across the same window, then compresses while price holds:
      the premium mean-reverts before the price does.
    </p>
  </section>

  <section class="fc-panel">
    <div class="fc-panel-head"><h3>Caveats — what this evidence cannot say</h3></div>
    <div class="fc-caveats">
      <div><b>SENSEX is sampled, not ticked</b><p>__SENSEX_N__ of 293 minutes carry a SENSEX block (~60s cadence, median gap 60.0s, worst __SENSEX_GAP__). Sub-minute divergence between the two indices is invisible here.</p></div>
      <div><b>Not a like-for-like expiry</b><p>NIFTY expires today, SENSEX on 19 Nov. SENSEX is a control for index-wide direction, not for 0-DTE flow. A same-expiry control would need BANKNIFTY or a second 0-DTE index.</p></div>
      <div><b>The basis level is carry, not sentiment</b><p>Futures expire 23 Nov, so the ~__MEAN_B__ mean premium contains six days of carry. Only the <b>deviation</b> from that mean is information; the level is not comparable to a true 0-DTE basis.</p></div>
      <div><b>Basis is a stress gauge, not a forecast</b><p>Rich basis does not predict spot catch-up: r = __FWD_R__ against forward 5-minute spot returns over 282 overlapping windows. It describes demand at a moment; it does not time the reversal.</p></div>
      <div><b>Clock alignment, not causality</b><p>The naive 1-minute lead–lag straddles two clocks (tape ~:__SEC_OFFSET__, futures close :59). Re-sampling spot from the 10s chain at the candle close removes __OFFSET_PCT__% of the apparent lead and leaves __LEAD_SYNC__ with a CI that includes zero. A Granger or tick study would still be needed to claim direction.</p></div>
      <div><b>Single contract, single session</b><p>OI is the front (23 Nov) contract only. One session, one expiry, one regime — the __CATCHUP_SPOT__-point catch-up is an observation, not a base rate.</p></div>
    </div>
  </section>

  <div class="fc-src">
    basis = futures 1m close − NIFTY spot tape (mean when a minute has multiple rows), clipped at __CLIP__.
    Sources: <code>reports/nifty_2026-11-17/data/futures_1m.json</code> ·
    <code>experiments/data/nifty_tape/2026-11-17.jsonl</code> ·
    <code>experiments/data/nifty_snapshots/2026-11-17.jsonl</code> (SENSEX block).
    Colours from <code>src/ui/palette.ts</code>. Generated __GENERATED__.
  </div>
</div>
<script>
(function () {
  "use strict";
  var D = __DATA__;
  var P = D.palette;

  function el(id) { return document.getElementById(id); }
  function hhmm(m) {
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }
  function num(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return "–";
    d = (d === undefined) ? 1 : d;
    return Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function sgn(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return "–";
    return (v > 0 ? "+" : "") + num(v, d === undefined ? 1 : d);
  }
  function pct(v, d) { return sgn(v, d === undefined ? 2 : d) + "%"; }

  var PLOT_CONFIG = { responsive: true, displayModeBar: false, scrollZoom: false };
  var FONT = { family: P.mono, size: 11, color: P.text };

  function baseLayout(extra) {
    var base = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      margin: { l: 54, r: 14, t: 10, b: 28 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: P.raised, bordercolor: P.border, font: { family: P.mono, size: 11, color: P.text } },
      showlegend: false,
      xaxis: {
        gridcolor: P.grid, zeroline: false, linecolor: P.border, tickcolor: P.border,
        tickfont: { color: P.muted, size: 10 }, ticks: "outside", ticklen: 3
      },
      yaxis: {
        gridcolor: P.grid, zeroline: false, linecolor: P.border, tickcolor: P.border,
        tickfont: { color: P.muted, size: 10 }, ticks: "outside", ticklen: 3
      }
    };
    return Object.assign(base, extra || {});
  }

  function timeAxis() {
    var ticks = [555, 615, 675, 735, 795, 849];
    return {
      gridcolor: P.grid, zeroline: false, linecolor: P.border, tickcolor: P.border,
      tickfont: { color: P.muted, size: 10 }, ticks: "outside", ticklen: 3,
      range: [552, 851], tickvals: ticks, ticktext: ticks.map(function (m) { return hhmm(m); })
    };
  }

  if (!D || !D.basis || !D.basis.rows.length) return;

  /* ---------------------------------------------------------- 3D: basis/OI */
  (function () {
    var rows = D.basis.rows;
    var x = rows.map(function (r) { return r.m; });
    var y = rows.map(function (r) { return r.b; });
    var z = rows.map(function (r) { return r.oi; });
    var doi = rows.map(function (r) { return r.doi; });
    var size = rows.map(function (r) { return 3 + Math.min(10, Math.sqrt(r.v) / 26); });

    var line = {
      type: "scatter3d", mode: "lines", x: x, y: y, z: z,
      line: { color: P.muted, width: 3 },
      hoverinfo: "skip", showlegend: false
    };
    var pts = {
      type: "scatter3d", mode: "markers", x: x, y: y, z: z,
      marker: {
        size: size, color: doi, colorscale: [[0, P.negative], [0.5, P.muted], [1, P.positive]],
        cmin: -45000, cmax: 45000, cmid: 0, opacity: 0.9,
        colorbar: {
          title: { text: "OI Δ/", side: "right", font: { size: 9, color: P.muted } },
          tickfont: { size: 9, color: P.muted }, thickness: 8, len: 0.55, outlinewidth: 0
        }
      },
      customdata: rows.map(function (r) { return [r.t, r.f, r.s, r.b, r.v]; }),
      hovertemplate: "%{customdata[0]}  basis %{customdata[3]:+.2f}<br>fut %{customdata[1]:,.1f} · spot %{customdata[2]:,.1f}<br>vol %{customdata[4]:,.0f}<extra></extra>",
      showlegend: false
    };
    var marks = [];
    [["11:55", 715, "middle right", P.warning], ["12:28", 748, "top center", P.info]].forEach(function (spec) {
      var row = rows.filter(function (r) { return r.m === spec[1]; })[0];
      if (!row) return;
      marks.push({
        type: "scatter3d", mode: "markers+text", x: [row.m], y: [row.b], z: [row.oi],
        text: [spec[0]], textposition: spec[2],
        textfont: { family: P.mono, size: 10, color: spec[3] },
        marker: { size: 7, color: spec[3], symbol: "diamond", line: { color: P.bg, width: 1 } },
        hovertemplate: spec[0] + "<br>basis %{y:+.2f}<br>OI %{z:,.0f}<extra></extra>", showlegend: false
      });
    });

    var layout = {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT, margin: { l: 20, r: 6, t: 6, b: 6 }, showlegend: false, hovermode: "closest",
      hoverlabel: { bgcolor: P.raised, bordercolor: P.border, font: { family: P.mono, size: 11, color: P.text } },
      scene: {
        bgcolor: "rgba(0,0,0,0)",
        camera: { eye: { x: 1.05, y: -1.45, z: 0.8 } },
        aspectmode: "manual",
        aspectratio: { x: 2.05, y: 0.85, z: 0.7 },
        xaxis: {
          title: { text: "" },
          gridcolor: P.grid, zerolinecolor: P.border, showbackground: false,
          tickfont: { size: 9, color: P.muted }, tickvals: [555, 675, 795],
          ticktext: ["09:15", "11:15", "13:15"], range: [552, 851]
        },
        yaxis: {
          title: { text: "" },
          gridcolor: P.grid, zerolinecolor: P.border, showbackground: false,
          tickfont: { size: 9, color: P.muted }, range: [0, 75]
        },
        zaxis: {
          title: { text: "" },
          gridcolor: P.grid, zerolinecolor: P.border, showbackground: false,
          tickfont: { size: 9, color: P.muted },
          tickformat: ".2s", range: [1.145e7, 1.17e7]
        }
      }
    };
    Plotly.newPlot(el("fc-plot-3d"), [line, pts].concat(marks), layout, PLOT_CONFIG);
  })();

  /* --------------------------------------------------- 2D: basis + markers */
  (function () {
    var rows = D.basis.rows;
    var x = rows.map(function (r) { return r.m; });
    var S = D.basis.stats;
    var bVals = rows.map(function (r) { return r.b; });
    var bLo = Math.min(0, Math.min.apply(null, bVals)) - 6;
    var bHi = Math.max.apply(null, bVals) + 12;

    var zero = {
      type: "scatter", mode: "lines", x: [552, 851], y: [0, 0],
      line: { color: P.border, width: 1, dash: "dot" }, hoverinfo: "skip"
    };
    var meanLine = {
      type: "scatter", mode: "lines", x: [552, 851], y: [S.mean, S.mean],
      line: { color: P.primary, width: 1, dash: "dash" },
      hovertemplate: "session mean %{y:.2f}<extra></extra>"
    };
    var raw = {
      type: "scatter", mode: "lines", x: x, y: rows.map(function (r) { return r.b; }),
      name: "close basis", line: { color: P.primary, width: 1.6 },
      fill: "tozeroy", fillcolor: P.tint_primary,
      customdata: rows.map(function (r) { return [r.t, r.f, r.s, r.oi, r.v]; }),
      hovertemplate: "%{customdata[0]}  basis %{y:+.2f}<br>fut %{customdata[1]:,.1f} · spot %{customdata[2]:,.1f}<br>OI %{customdata[3]:,.0f}<extra></extra>"
    };
    var adj = {
      type: "scatter", mode: "lines", x: x, y: rows.map(function (r) { return r.ba; }),
      name: "time-aligned", line: { color: P.info, width: 1.1, dash: "dot" },
      hovertemplate: "%{customdata}  aligned %{y:+.2f}<extra></extra>",
      customdata: rows.map(function (r) { return r.t; })
    };
    var peak = {
      type: "scatter", mode: "markers", x: [S.at.peak.t], y: [S.at.peak.v],
      marker: { size: 8, color: P.warning, symbol: "diamond", line: { color: P.bg, width: 1 } },
      hovertemplate: "11:55 peak %{y:+.2f}<extra></extra>"
    };

    var layout = baseLayout({
      xaxis: timeAxis(),
      margin: { l: 62, r: 14, t: 10, b: 28 },
      yaxis: {
        gridcolor: P.grid, zeroline: false, linecolor: P.border, title: { text: "futures − spot (pts)", font: { size: 9, color: P.muted } },
        tickfont: { color: P.muted, size: 10 }, range: [bLo, bHi], ticksuffix: ""
      },
      shapes: [
        { type: "rect", xref: "x", yref: "paper", x0: 705, x1: 725, y0: 0, y1: 1, fillcolor: P.tint_info, line: { width: 0 }, layer: "below" },
        { type: "line", xref: "x", yref: "paper", x0: 715, x1: 715, y0: 0, y1: 1, line: { color: P.warning, width: 1, dash: "dot" } },
        { type: "line", xref: "x", yref: "paper", x0: 720, x1: 720, y0: 0, y1: 1, line: { color: P.text, width: 1, dash: "dot" } },
        { type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: S.p95, y1: S.p95, line: { color: P.muted, width: 1, dash: "dot" } },
        { type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: S.p5, y1: S.p5, line: { color: P.muted, width: 1, dash: "dot" } }
      ],
      annotations: [
        { x: 714, y: S.at.peak.v, xref: "x", yref: "y", text: "11:55  " + sgn(S.at.peak.v, 2), showarrow: false, xanchor: "right", yanchor: "bottom", font: { family: P.mono, size: 10, color: P.warning } },
        { x: 720, y: 6, xref: "x", yref: "y", text: "12:00", showarrow: false, xanchor: "center", yanchor: "bottom", font: { family: P.mono, size: 10, color: P.text } },
        { x: 851, y: S.mean, xref: "x", yref: "y", text: "mean " + sgn(S.mean, 1), showarrow: false, xanchor: "right", yanchor: "bottom", font: { family: P.mono, size: 9, color: P.primary } },
        { x: 555, y: S.p95, xref: "x", yref: "y", text: "p95", showarrow: false, xanchor: "left", yanchor: "bottom", font: { family: P.mono, size: 9, color: P.muted } },
        { x: 555, y: S.p5, xref: "x", yref: "y", text: "p5", showarrow: false, xanchor: "left", yanchor: "top", font: { family: P.mono, size: 9, color: P.muted } }
      ]
    });
    Plotly.newPlot(el("fc-plot-basis"), [raw, adj, meanLine, zero, peak], layout, PLOT_CONFIG);
  })();

  /* ------------------------------------------------------------ regime strip */
  (function () {
    var strip = el("fc-strip");
    var axis = el("fc-strip-axis");
    var legend = el("fc-strip-legend");
    var total = 851 - 552;
    var colors = {
      long_buildup: P.positive, short_covering: P.info, short_buildup: P.negative,
      long_unwinding: P.warning, neutral: P.muted
    };
    D.regimes.forEach(function (b) {
      var span = document.createElement("span");
      span.style.width = ((b.e - b.s) / total * 100).toFixed(3) + "%";
      span.style.background = colors[b.key] || P.muted;
      span.title = b.start + "–" + b.end + " · " + b.label + " · Δ " + sgn(b.dp, 1) + " pts · OI " + (b.doi >= 0 ? "+" : "") + b.doi.toLocaleString("en-IN") + " · vol " + b.vol.toLocaleString("en-IN");
      strip.appendChild(span);
    });
    [555, 675, 795].forEach(function (m) {
      var s = document.createElement("span");
      s.style.left = ((m - 552) / total * 100).toFixed(3) + "%";
      s.textContent = hhmm(m);
      axis.appendChild(s);
    });
    var order = ["long_buildup", "short_covering", "short_buildup", "long_unwinding", "neutral"];
    var labels = D.regime_labels;
    order.forEach(function (k) {
      var s = document.createElement("span");
      s.innerHTML = '<i style="background:' + colors[k] + '"></i>' + labels[k];
      legend.appendChild(s);
    });
  })();

  /* ---------------------------------------------------------- lead-lag bars */
  (function () {
    var rows = D.leadlag.rows;
    var lags = rows.map(function (r) { return r.lag; });
    var pair = 0.19;
    var ymax = 0.95;

    var naive = {
      type: "bar", x: lags.map(function (l) { return l - pair; }), y: rows.map(function (r) { return r.naive; }),
      width: 0.34, marker: { color: P.muted, opacity: 0.45, line: { width: 0 } },
      customdata: rows.map(function (r) { return [r.lag, r.n_naive]; }),
      hovertemplate: "naive · lag %{customdata[0]:+d} · r %{y:+.3f}<br>n=%{customdata[1]}<extra></extra>"
    };
    var sync = {
      type: "bar", x: lags.map(function (l) { return l + pair; }), y: rows.map(function (r) { return r.sync; }),
      width: 0.34, marker: { color: P.info, opacity: 0.9, line: { width: 0 } },
      error_y: {
        type: "data", symmetric: false, color: P.muted, thickness: 1, width: 3,
        array: rows.map(function (r) {
          return (r.sync_ci && isFinite(r.sync_ci[1])) ? Math.max(0, r.sync_ci[1] - r.sync) : 0;
        }),
        arrayminus: rows.map(function (r) {
          return (r.sync_ci && isFinite(r.sync_ci[0])) ? Math.max(0, r.sync - r.sync_ci[0]) : 0;
        })
      },
      customdata: rows.map(function (r) {
        return [r.lag, r.n_sync, r.sync_ci ? r.sync_ci[0] : null, r.sync_ci ? r.sync_ci[1] : null];
      }),
      hovertemplate: "aligned · lag %{customdata[0]:+d} · r %{y:+.3f}<br>95% CI %{customdata[2]:+.3f}..%{customdata[3]:+.3f} · n=%{customdata[1]}<extra></extra>"
    };

    var layout = baseLayout({
      xaxis: {
        gridcolor: P.grid, zeroline: false, linecolor: P.border, tickcolor: P.border,
        tickfont: { color: P.muted, size: 10 }, ticks: "outside", ticklen: 3,
        title: { text: "lag (min) · negative = futures leads", font: { size: 9, color: P.muted } },
        tickmode: "array", tickvals: lags, ticktext: lags.map(function (l) { return l > 0 ? "+" + l : (l < 0 ? "−" + Math.abs(l) : "0"); }),
        range: [-5.7, 5.7]
      },
      yaxis: {
        gridcolor: P.grid, zeroline: false, linecolor: P.border,
        tickfont: { color: P.muted, size: 10 }, range: [-0.2, ymax],
        title: { text: "correlation", font: { size: 9, color: P.muted } }
      },
      shapes: [
        { type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: P.border, width: 1 } }
      ],
      annotations: [
        { x: -1.27, y: D.leadlag.lead_1_naive + 0.03, text: "naive " + num(D.leadlag.lead_1_naive, 2), showarrow: false, xanchor: "right", yanchor: "bottom", font: { family: P.mono, size: 9, color: P.muted } },
        { x: 0.19, y: D.leadlag.concurrent + 0.09, text: "aligned " + num(D.leadlag.concurrent, 2), showarrow: false, xanchor: "center", yanchor: "bottom", font: { family: P.mono, size: 9, color: P.info } }
      ]
    });
    Plotly.newPlot(el("fc-plot-lag"), [naive, sync], layout, PLOT_CONFIG);

    var legend = el("fc-lag-legend");
    if (legend) {
      legend.innerHTML =
        '<span><i style="background:' + P.muted + ';opacity:.55"></i>naive tape clock</span>' +
        '<span><i style="background:' + P.info + '"></i>chain spot at candle close</span>' +
        '<span style="color:var(--fc-warning)">whiskers = 95% block bootstrap</span>';
    }
  })();

  /* --------------------------------------------------- NIFTY vs SENSEX path */
  (function () {
    var rows = D.cross.rows;
    var x = rows.map(function (r) { return r.m; });
    var spreadAbs = Math.max(12, Math.ceil(Math.max.apply(null, rows.map(function (r) { return Math.abs(r.spread); })) * 1.25 / 5) * 5);
    var nif = {
      type: "scatter", mode: "lines", x: x, y: rows.map(function (r) { return r.n; }),
      name: "NIFTY", line: { color: P.primary, width: 1.6 },
      hovertemplate: "%{customdata} · NIFTY %{y:+.3f}%<extra></extra>",
      customdata: rows.map(function (r) { return r.t; })
    };
    var sen = {
      type: "scatter", mode: "lines", x: x, y: rows.map(function (r) { return r.s; }),
      name: "SENSEX", line: { color: P.info, width: 1.2, dash: "dash" },
      hovertemplate: "%{customdata} · SENSEX %{y:+.3f}%<extra></extra>",
      customdata: rows.map(function (r) { return r.t; })
    };
    var spread = {
      type: "scatter", mode: "lines", x: x, y: rows.map(function (r) { return r.spread; }),
      name: "spread", yaxis: "y2", line: { color: P.muted, width: 1 },
      fill: "tozeroy", fillcolor: P.tint_neutral,
      hovertemplate: "spread %{y:+.1f} bps<extra></extra>"
    };
    var layout = baseLayout({
      xaxis: timeAxis(),
      margin: { l: 62, r: 46, t: 10, b: 28 },
      yaxis: {
        gridcolor: P.grid, zeroline: false, linecolor: P.border,
        tickfont: { color: P.muted, size: 10 }, ticksuffix: "%",
        title: { text: "change from 09:15", font: { size: 9, color: P.muted } }
      },
      yaxis2: {
        overlaying: "y", side: "right", showgrid: false, zeroline: false,
        tickfont: { color: P.muted, size: 9 }, ticksuffix: " bp", automargin: true,
        title: { text: "spread", font: { size: 9, color: P.muted }, standoff: 4 },
        range: [-spreadAbs, spreadAbs], dtick: spreadAbs >= 15 ? 10 : 5
      },
      shapes: [
        { type: "rect", xref: "x", yref: "paper", x0: 705, x1: 725, y0: 0, y1: 1, fillcolor: P.tint_info, line: { width: 0 }, layer: "below" },
        { type: "line", xref: "x", yref: "paper", x0: 720, x1: 720, y0: 0, y1: 1, line: { color: P.text, width: 1, dash: "dot" } }
      ],
      annotations: [
        { x: 720, y: 1, xref: "x", yref: "paper", text: "12:00", showarrow: false, xanchor: "center", yanchor: "bottom", font: { family: P.mono, size: 10, color: P.text } }
      ]
    });
    Plotly.newPlot(el("fc-plot-cross"), [sen, nif, spread], layout, PLOT_CONFIG);
  })();

  /* ------------------------------------------------------ 15m quadrants */
  (function () {
    var b = D.regimes.filter(function (r) { return !r.partial; });
    var colors = {
      long_buildup: P.positive, short_covering: P.info, short_buildup: P.negative,
      long_unwinding: P.warning, neutral: P.muted
    };
    var xmax = Math.max(1.2e5, Math.max.apply(null, b.map(function (r) { return Math.abs(r.doi); })) * 1.25);
    var ymax = Math.max(60, Math.max.apply(null, b.map(function (r) { return Math.abs(r.dp); })) * 1.25);
    var labelled = { "09:15": 1, "11:15": 1, "11:45": 1, "12:00": 1, "12:15": 1, "12:30": 1, "13:00": 1 };

    var pts = {
      type: "scatter", mode: "markers+text",
      x: b.map(function (r) { return r.doi; }),
      y: b.map(function (r) { return r.dp; }),
      text: b.map(function (r) { return labelled[r.start] ? r.start : ""; }),
      textposition: b.map(function (r) { return r.dp < 0 ? "bottom center" : "top center"; }),
      textfont: { family: P.mono, size: 9, color: P.muted },
      marker: {
        size: b.map(function (r) { return 8 + Math.sqrt(r.vol) / 42; }),
        color: b.map(function (r) { return colors[r.key] || P.muted; }),
        opacity: 0.85, line: { color: P.bg, width: 1 }
      },
      customdata: b.map(function (r) { return [r.end, r.label, r.vol]; }),
      hovertemplate: "%{text}–%{customdata[0]} · %{customdata[1]}<br>Δprice %{y:+.1f} pts · ΔOI %{x:+,.0f}<br>vol %{customdata[2]:,.0f}<extra></extra>"
    };

    var layout = baseLayout({
      hovermode: "closest",
      margin: { l: 64, r: 14, t: 10, b: 44 },
      xaxis: {
        gridcolor: P.grid, zeroline: false, linecolor: P.border,
        tickfont: { color: P.muted, size: 10 }, tickformat: ".2s",
        range: [-xmax, xmax],
        title: { text: "15-minute Δ open interest (contracts)", font: { size: 9, color: P.muted } }
      },
      yaxis: {
        gridcolor: P.grid, zeroline: false, linecolor: P.border,
        tickfont: { color: P.muted, size: 10 }, range: [-ymax, ymax],
        title: { text: "15-minute Δ price (pts)", font: { size: 9, color: P.muted } }
      },
      shapes: [
        { type: "line", xref: "x", yref: "paper", x0: 0, x1: 0, y0: 0, y1: 1, line: { color: P.border, width: 1, dash: "dot" } },
        { type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: P.border, width: 1, dash: "dot" } }
      ],
      annotations: [
        { x: xmax * 0.97, y: ymax * 0.97, text: "long buildup", showarrow: false, xanchor: "right", yanchor: "top", font: { family: P.mono, size: 9, color: P.positive } },
        { x: -xmax * 0.97, y: ymax * 0.97, text: "short buildup", showarrow: false, xanchor: "left", yanchor: "top", font: { family: P.mono, size: 9, color: P.negative } },
        { x: -xmax * 0.97, y: -ymax * 0.97, text: "long unwinding", showarrow: false, xanchor: "left", yanchor: "bottom", font: { family: P.mono, size: 9, color: P.warning } },
        { x: xmax * 0.97, y: -ymax * 0.97, text: "short covering", showarrow: false, xanchor: "right", yanchor: "bottom", font: { family: P.mono, size: 9, color: P.info } }
      ]
    });
    Plotly.newPlot(el("fc-plot-quad"), [pts], layout, PLOT_CONFIG);
  })();

  /* ----------------------------------------------------------- event table */
  (function () {
    var t = el("fc-event-table");
    var head = ["Time", "Δ min", "Futures", "Δ fut", "OI", "Δ OI", "Basis", "Adj basis", "NIFTY", "SENSEX", "N−S"]
    var html = "<thead><tr>" + head.map(function (h, i) {
      return "<th" + (i === 0 ? ' scope="col"' : ' scope="col"') + ">" + h + "</th>";
    }).join("") + "</tr></thead><tbody>";
    D.events.forEach(function (r) {
      html += "<tr" + (r.off === 0 ? ' class="fc-noon"' : "") + ">" +
        "<td>" + r.t + "</td>" +
        "<td>" + (r.off > 0 ? "+" : "") + r.off + "</td>" +
        "<td>" + num(r.f, 1) + "</td>" +
        '<td class="' + (r.df >= 0 ? "fc-pos" : "fc-neg") + '">' + sgn(r.df, 1) + "</td>" +
        "<td>" + (r.oi / 1e6).toFixed(2) + "M</td>" +
        '<td class="' + (r.doi >= 0 ? "fc-pos" : "fc-neg") + '">' + (r.doi === 0 ? "0" : (r.doi > 0 ? "+" : "−") + Math.abs(r.doi).toLocaleString("en-IN")) + "</td>" +
        '<td class="' + (r.b >= D.basis.stats.mean ? "fc-warn-text" : "fc-dim") + '">' + sgn(r.b, 2) + "</td>" +
        '<td class="fc-dim">' + sgn(r.ba, 2) + "</td>" +
        "<td>" + pct(r.npct, 3) + "</td>" +
        "<td>" + pct(r.spct, 3) + "</td>" +
        '<td class="' + (Math.abs(r.spread) > 20 ? "fc-warn-text" : "fc-dim") + '">' + sgn(r.spread, 1) + "</td>" +
        "</tr>";
    });
    t.innerHTML = html + "</tbody>";
  })();

  /* ---------------------------------------------------- container resizing */
  (function () {
    var root = el("research-futures-cross");
    var plots = ["fc-plot-3d", "fc-plot-basis", "fc-plot-lag", "fc-plot-cross", "fc-plot-quad"]
      .map(function (id) { return el(id); });
    var timer = null;
    function resize() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        plots.forEach(function (p) { if (p && p.data) Plotly.Plots.resize(p); });
      }, 80);
    }
    window.addEventListener("resize", resize, { passive: true });
    if (window.ResizeObserver && root) {
      var lastW = root.clientWidth;
      var ro = new ResizeObserver(function () {
        if (Math.abs(root.clientWidth - lastW) < 8) return;
        lastW = root.clientWidth;
        resize();
      });
      ro.observe(root);
    }
  })();
})();
</script>
</section>
"""


def build_html(payload: dict) -> str:
    st = payload["basis"]["stats"]
    sta = payload["basis"]["stats_adj"]
    ll = payload["leadlag"]
    xs = payload["cross"]["stats"]
    w = payload["windows"]
    ev = payload["events"]
    p = payload["palette"]

    theme_css = (
        "#research-futures-cross{"
        "--fc-bg:%s;--fc-surface:%s;--fc-raised:%s;--fc-border:%s;"
        "--fc-text:%s;--fc-muted:%s;--fc-primary:%s;--fc-positive:%s;"
        "--fc-negative:%s;--fc-info:%s;--fc-warning:%s;--fc-grid:%s;"
        "--fc-mono:%s;--fc-sans:%s}"
    ) % (
        p["bg"], p["surface"], p["raised"], p["border"], p["text"], p["muted"],
        p["primary"], p["positive"], p["negative"], p["info"], p["warning"],
        p["grid"], p["mono"], p["sans"],
    )
    css = "<style>" + theme_css + BASE_CSS + "</style>"

    spread_range = f"{xs['spread_min']:+.1f} to {xs['spread_max']:+.1f} bps"
    event_div = max(abs(e["spread"]) for e in ev)
    event_basis = [e["b"] for e in ev]

    replacements = {
        "__CSS__": css,
        "__SESSION__": payload["session"],
        "__DATA__": json.dumps(payload, separators=(",", ":")),
        "__IMP_DP__": sgn(w["impulse"]["dp"], 1),
        "__IMP_DOI__": f"{w['impulse']['doi']:+,d}",
        "__IMP_VOL__": f"{w['impulse']['vol']:,d}",
        "__IMP_REGIME__": payload["regime_labels"][w["impulse"]["regime"]],
        "__POP_DP__": sgn(w["pop"]["dp"], 1),
        "__POP_DOI__": f"{w['pop']['doi']:+,d}",
        "__CATCHUP_DOI__": f"{w['catchup']['doi']:+,d}",
        "__STALL_DP__": sgn(w["stall"]["dp"], 1),
        "__STALL_DOI__": f"{w['stall']['doi']:+,d}",
        "__IMP_SEN__": f"{w['impulse']['sensex_pct']:+.3f}%",
        "__IMP_NIF__": f"{w['impulse']['spot_pct']:+.3f}%",
        "__IMP_DIV__": f"{w['impulse']['div_bps']:+.1f} bp",
        "__PEAK_B__": sgn(st["at"]["peak"]["v"], 2),
        "__PEAK_T__": st["at"]["peak"]["t"],
        "__PEAK_ADJ__": sgn(st["at"]["peak"]["v_adj"], 2),
        "__PEAK_ADJ_SAME_Z__": f"{st['at']['peak']['z_adj_same']:.1f}",
        "__RICH_1156__": f"{st['at']['rich_1156']:.1f}",
        "__PEAK_Z__": f"{st['at']['z_peak']:.1f}",
        "__PEAK_ADJ_Z__": f"{st['at']['z_peak_adj']:.1f}",
        "__NOON_B__": sgn(st["at"]["noon"], 2),
        "__MEAN_B__": sgn(st["mean"], 2),
        "__P95_B__": sgn(st["p95"], 2),
        "__OPEN_B__": sgn(payload["basis"]["rows"][0]["b"], 2),
        "__TROUGH_B__": sgn(st["at"]["trough"]["v"], 2),
        "__TROUGH_T__": st["at"]["trough"]["t"],
        "__SELL_FUT__": sgn(st["at"]["selloff"]["fut_pts"], 1),
        "__SELL_SPOT__": sgn(st["at"]["selloff"]["spot_pts"], 1),
        "__TROUGH_RECOVER_B__": sgn(st["at"]["selloff"]["recover_b"], 2),
        "__TROUGH_RECOVER_T__": st["at"]["selloff"]["recover_t"],
        "__OI_PEAK__": f"{payload['oi_peak']['oi'] / 1e6:.2f}M @ {payload['oi_peak']['t']}",
        "__UNWIND_DOI__": f"{w['unwind']['doi']:+,d}",
        "__UNWIND_DP__": sgn(w["unwind"]["dp"], 1),
        "__RETRACE_DOI__": f"{w['retrace']['doi']:+,d}",
        "__RETRACE_DP__": sgn(w["retrace"]["dp"], 1),
        "__CATCHUP_SPOT__": sgn(w["catchup"]["spot_pts"], 1),
        "__CATCHUP_FUT__": sgn(w["catchup"]["dp"], 1),
        "__XS_CORR__": f"{xs['corr_1m']:.2f}",
        "__XS_BETA__": f"{xs['beta']:.2f}",
        "__SPREAD_RANGE__": spread_range,
        "__LEAD_SYNC__": f"{ll['lead_1_sync']:.2f}",
        "__LEAD_NAIVE__": f"{ll['lead_1_naive']:.2f}",
        "__LEAD_CI__": ci_text(ll["lead_1_ci"]),
        "__LAG0_SYNC__": f"{ll['concurrent']:.2f}",
        "__LAG0_NAIVE__": f"{ll['concurrent_naive']:.2f}",
        "__OFFSET_PCT__": f"{ll['attributable_to_sampling'] * 100:.0f}",
        "__SYNC_N__": f"{ll['sync_coverage']}",
        "__LL_N__": f"{ll['minutes']}",
        "__AC_F__": f"{ll['autocorr_fut_1']:+.2f}",
        "__AC_S__": f"{ll['autocorr_spot_1']:+.2f}",
        "__SEC_OFFSET__": f"{payload['coverage']['spot_seconds_median']:.0f}",
        "__SENSEX_N__": f"{xs['n_minutes']}",
        "__SENSEX_GAP__": f"{payload['coverage']['sensex_gap_max']:.0f}s",
        "__FWD_R__": f"{payload['forward_check']['r']:+.2f}".replace("-", "−"),
        "__EVENT_MAXDIV__": f"{event_div:.1f} bp",
        "__EVENT_B_RANGE__": f"{(max(event_basis) - min(event_basis)):.1f} pts",
        "__CLIP__": payload["clip"],
        "__GENERATED__": payload["generated"],
    }

    html = BASE_HTML
    for key, value in replacements.items():
        html = html.replace(key, str(value))

    missing = re.findall(r"__[A-Z0-9_]+__", html)
    if missing:
        raise SystemExit(f"unfilled placeholders: {sorted(set(missing))}")
    return html


class FragmentChecker(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.errors: list[str] = []
        self.tags: list[str] = []
        self.ids: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        self.tags.append(tag)
        for name, value in attrs:
            if name == "id" and value:
                self.ids.append(value)
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in VOID_TAGS:
            return
        if not self.stack:
            self.errors.append(f"stray </{tag}>")
            return
        if self.stack[-1] != tag:
            self.errors.append(f"expected </{self.stack[-1]}>, got </{tag}>")
            return
        self.stack.pop()


def validate(html: str) -> None:
    errors: list[str] = []
    lowered = html.lower()
    for banned in ("<html", "<head>", "<head ", "<body", "cdn.", "https://", "http://"):
        if banned in lowered:
            errors.append(f"fragment contains {banned!r}")
    if 'data-research-section="futures-cross"' not in html:
        errors.append("missing data-research-section")
    if 'id="research-futures-cross"' not in html:
        errors.append("missing section id")

    checker = FragmentChecker()
    checker.feed(html)
    errors.extend(checker.errors)
    if checker.stack:
        errors.append(f"unclosed tags: {checker.stack}")

    foreign = [i for i in checker.ids if not i.startswith("fc-") and i != "research-futures-cross"]
    if foreign:
        errors.append(f"ids without fc- prefix: {foreign}")

    for marker in ("fc-plot-3d", "fc-plot-basis", "fc-plot-lag", "fc-plot-cross", "fc-plot-quad", "fc-strip"):
        if f'id="{marker}"' not in html:
            errors.append(f"missing chart container {marker}")
    if "Plotly.newPlot" not in html:
        errors.append("no Plotly rendering")
    if errors:
        raise SystemExit("fragment validation failed:\n  - " + "\n  - ".join(errors))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="validate the written fragment and exit")
    args = ap.parse_args()

    payload = build_payload()
    payload["regime_labels"] = REGIME_LABELS

    if args.check:
        validate(OUT_HTML.read_text())
        print(f"{OUT_HTML.relative_to(REPO_ROOT)} passes fragment checks")
        return 0

    html = build_html(payload)
    validate(html)

    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=1))
    OUT_HTML.write_text(html)

    st = payload["basis"]["stats"]
    print(f"wrote {OUT_HTML.relative_to(REPO_ROOT)}  ({len(html):,} bytes)")
    print(f"wrote {OUT_JSON.relative_to(REPO_ROOT)}  ({OUT_JSON.stat().st_size:,} bytes)")
    print(
        "basis mean %+.2f p5 %+.2f p95 %+.2f | peak %+.2f @ %s (%.2fσ) | aligned peak %+.2f (%.2fσ)"
        % (st["mean"], st["p5"], st["p95"], st["at"]["peak"]["v"], st["at"]["peak"]["t"],
           st["at"]["z_peak"], st["at"]["peak_adj"]["v"], st["at"]["z_peak_adj"])
    )
    print(
        "impulse %+.1f pts / %+d OI | spot %+.1f | sensex %+.3f%% vs nifty %+.3f%% (%.1f bp)"
        % (payload["windows"]["impulse"]["dp"], payload["windows"]["impulse"]["doi"],
           payload["windows"]["impulse"]["spot_pts"], payload["windows"]["impulse"]["sensex_pct"],
           payload["windows"]["impulse"]["spot_pct"], payload["windows"]["impulse"]["div_bps"])
    )
    print(
        "lead-lag lag−1 naive %+.3f → aligned %+.3f (95%% CI %s) | lag0 %.3f → %.3f | %.0f%% offset"
        % (payload["leadlag"]["lead_1_naive"], payload["leadlag"]["lead_1_sync"],
           ci_text(payload["leadlag"]["lead_1_ci"]),
           payload["leadlag"]["concurrent_naive"], payload["leadlag"]["concurrent"],
           payload["leadlag"]["attributable_to_sampling"] * 100)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
