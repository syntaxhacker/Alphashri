#!/usr/bin/env python3
"""Expiry-day pin / dealer-gamma section for a NIFTY 0-DTE research tab.

Reads the recorded report snapshots (~1-minute cadence), the 1-minute tape and
(where an archive exists) the futures candles, then emits a self-contained
fragment plus its numbers:

    reports/nifty_<session>/research/pin_gamma.json   (numbers, for reuse)
    reports/nifty_<session>/research/pin_gamma.html   (self-contained fragment)

The default session is 2026-11-17, whose recorders were stopped at 14:07:49 --
the last 83 minutes are clipped rather than invented. Later sessions that were
recorded to the close (2026-10-27 reaches 15:29:36) are built without a clip and
the pin is checked against the actual close.

The HTML is a fragment: no <html>/<head>/<body>, no CDN tags. The assembler
loads D3 v7 + Plotly once and this section uses window.d3 / window.Plotly.

Run from the repo root with the project venv:

    .venv/bin/python scripts/market/nifty_research_pin_gamma.py
    .venv/bin/python scripts/market/nifty_research_pin_gamma.py \
        --session 2026-10-27 --expiry 2026-10-27

Every number in the prose bullets is computed here; nothing is hand-typed.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics as stats
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SESSION = "2026-11-17"

# Filled by configure(); module-level so the pure helpers below stay callable
# without threading a config object through every signature.
SESSION = DEFAULT_SESSION
EXPIRY = DEFAULT_SESSION
SNAPSHOT_PATH = ROOT / f"experiments/data/nifty_snapshots/{SESSION}.jsonl"
TAPE_PATH = ROOT / f"experiments/data/nifty_tape/{SESSION}.jsonl"
FUTURES_PATH = ROOT / f"reports/nifty_{SESSION}/data/futures_1m.json"
OUT_JSON = ROOT / f"reports/nifty_{SESSION}/research/pin_gamma.json"
OUT_HTML = ROOT / f"reports/nifty_{SESSION}/research/pin_gamma.html"

# Everything downstream of this wall-clock time is dropped. For the default
# session the recorders were stopped at 14:07 and inventing the last 83 minutes
# would be fiction; a session recorded to the close has no cutoff.
CUTOFF: str | None = "14:07:59"

PIN_BAND = 25.0
SURFACE_STEP_MIN = 5
SURFACE_PAD_STRIKES = 250
PROFILE_PAD_STRIKES = 250
AFTERNOON_MIN = 12 * 60


def configure(session: str, expiry: str | None = None, out_dir: Path | None = None,
              clip: str | None | bool = "auto") -> None:
    global SESSION, EXPIRY, SNAPSHOT_PATH, TAPE_PATH, FUTURES_PATH, OUT_JSON, OUT_HTML, CUTOFF
    SESSION = session
    EXPIRY = expiry or session
    SNAPSHOT_PATH = ROOT / f"experiments/data/nifty_snapshots/{session}.jsonl"
    TAPE_PATH = ROOT / f"experiments/data/nifty_tape/{session}.jsonl"
    FUTURES_PATH = ROOT / f"reports/nifty_{session}/data/futures_1m.json"
    base = Path(out_dir) if out_dir else ROOT / f"reports/nifty_{session}/research"
    OUT_JSON = base / "pin_gamma.json"
    OUT_HTML = base / "pin_gamma.html"
    if clip == "auto":
        CUTOFF = "14:07:59" if session == DEFAULT_SESSION else None
    else:
        CUTOFF = clip  # type: ignore[assignment]


def minute_of(hhmmss: str) -> int:
    return int(hhmmss[:2]) * 60 + int(hhmmss[3:5])


def load_snapshots() -> list[dict]:
    rows: list[dict] = []
    with SNAPSHOT_PATH.open() as fh:
        for line in fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            clock = rec["t"][11:19]
            if CUTOFF is not None and clock > CUTOFF:
                continue
            rows.append(
                {
                    "clock": clock,
                    "min": minute_of(clock),
                    "report": rec["report"],
                }
            )
    if not rows:
        raise SystemExit(f"no snapshots before {CUTOFF} in {SNAPSHOT_PATH}")
    return rows


def flip_level(per: list[dict], spot: float) -> float | None:
    """Strike where the cumulative net-GEX curve crosses zero from below.

    This is the report's own ``zero_cross`` idea (api/options_levels.py) but
    interpolated between strikes instead of snapped to one, so the level can be
    plotted as a continuous line. Crossings further than 5% from spot are
    ignored, matching GEX_FLIP_MAX_DIST_PCT. When the whole book is net short
    the cumulative curve never turns positive and the level is undefined.
    """
    cum = 0.0
    prev_strike: float | None = None
    crossings: list[float] = []
    for entry in per:
        prev_cum = cum
        cum += entry["net_gex"]
        if prev_strike is not None and prev_cum < 0 <= cum and cum != prev_cum:
            frac = (0.0 - prev_cum) / (cum - prev_cum)
            crossings.append(prev_strike + frac * (entry["strike"] - prev_strike))
        prev_strike = entry["strike"]
    if not crossings:
        return None
    near = [c for c in crossings if abs(c - spot) <= spot * 0.05] or crossings
    return round(min(near, key=lambda c: abs(c - spot)), 1)


def local_flip(per: list[dict], spot: float) -> float | None:
    prev: tuple[float, float] | None = None
    crossings: list[float] = []
    for entry in per:
        value = entry["net_gex"]
        if prev is not None and prev[1] < 0 <= value and value != prev[1]:
            frac = (0.0 - prev[1]) / (value - prev[1])
            crossings.append(prev[0] + frac * (entry["strike"] - prev[0]))
        prev = (entry["strike"], value)
    if not crossings:
        return None
    near = [c for c in crossings if abs(c - spot) <= spot * 0.05] or crossings
    return round(min(near, key=lambda c: abs(c - spot)), 1)


def cum_at_spot(per: list[dict], spot: float) -> float:
    cum = 0.0
    upto = 0.0
    for entry in per:
        cum += entry["net_gex"]
        if entry["strike"] <= spot:
            upto = cum
    return round(upto, 1)


def pct_share(rows: list, pred) -> float:
    return round(100.0 * sum(1 for r in rows if pred(r)) / len(rows), 1)


def ols(xs: list[float], ys: list[float]) -> dict:
    mx, my = stats.mean(xs), stats.mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    slope = sxy / sxx if sxx else 0.0
    corr = sxy / math.sqrt(sxx * syy) if sxx and syy else 0.0
    return {"slope": round(slope, 3), "intercept": round(my - slope * mx, 2), "corr": round(corr, 3)}


def quantile(values: list[float], frac: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    idx = min(len(ordered) - 1, max(0, int(frac * len(ordered))))
    return ordered[idx]


def pctile_of(observed: float, sample: list[float]) -> float:
    return round(100.0 * sum(1 for v in sample if v < observed) / len(sample), 1)


def build_null(spot, max_pain, put_wall, call_wall, start_label: str,
               n_paths: int = 2000, seed: int = 17) -> dict:
    """Same-volatility random walk, scored against the recorded pin path.

    Resamples the session's own 1-minute spot changes (so drift and vol shape
    are preserved), accumulates from the first recorded spot, and asks three
    questions at every step: how far is the path from *that minute's* max pain,
    is it inside the ±25 band, and is it inside that minute's put-wall-to-call-wall
    band.

    This is a null about the *spot path*, not about the pin: max pain and the
    walls are held at their recorded values, and they were themselves derived
    from OI that responds to price. It bounds how unusual the path was; it does
    not identify causation.
    """
    n = len(spot)
    returns = [spot[i] - spot[i - 1] for i in range(1, n)]
    rng = random.Random(seed)
    step_gaps: list[list[float]] = [[] for _ in range(n)]
    means, share_25, inside = [], [], []
    for _ in range(n_paths):
        price = spot[0]
        gaps = [0.0] * n
        bars = 0
        for i in range(1, n):
            price += returns[rng.randrange(len(returns))]
            gaps[i] = abs(price - max_pain[i])
            step_gaps[i].append(gaps[i])
            if put_wall[i] <= price <= call_wall[i]:
                bars += 1
        step_gaps[0].append(0.0)
        means.append(stats.mean(gaps))
        share_25.append(100.0 * sum(1 for g in gaps if g <= PIN_BAND) / n)
        inside.append(100.0 * bars / n)

    observed_gaps = [abs(spot[i] - max_pain[i]) for i in range(n)]
    observed_mean = stats.mean(observed_gaps)
    observed_25 = 100.0 * sum(1 for g in observed_gaps if g <= PIN_BAND) / n
    observed_inside = 100.0 * sum(1 for i in range(n) if put_wall[i] <= spot[i] <= call_wall[i]) / n

    def pack(observed: float, sample: list[float]) -> dict:
        return {
            "obs": round(observed, 1),
            "null_mean": round(stats.mean(sample), 1),
            "p05": round(quantile(sample, 0.05), 1),
            "p50": round(quantile(sample, 0.50), 1),
            "p95": round(quantile(sample, 0.95), 1),
            "percentile": pctile_of(observed, sample),
        }

    return {
        "paths": n_paths,
        "seed": seed,
        "method": (
            "2000 bootstrap paths: the session's own 1-minute spot changes resampled with replacement, "
            f"accumulated from the {start_label} spot; max pain and both walls held at their recorded values."
        ),
        "mean_abs_gap": pack(observed_mean, means),
        "share_25": pack(observed_25, share_25),
        "inside_walls": pack(observed_inside, inside),
        "band": {
            "obs": [round(g, 1) for g in observed_gaps],
            "p05": [round(quantile(step_gaps[i], 0.05), 1) for i in range(n)],
            "p50": [round(quantile(step_gaps[i], 0.50), 1) for i in range(n)],
            "p95": [round(quantile(step_gaps[i], 0.95), 1) for i in range(n)],
        },
    }


def build_payload() -> dict:
    rows = load_snapshots()
    start_min = rows[0]["min"]
    end_min = rows[-1]["min"]
    spot_all = [float(r["report"]["spot"]) for r in rows]

    # The strike the prose narrates is the modal wall of the session, not the
    # last print: the last minute can be a one-tick switch that says nothing.
    call_counts = Counter(float(r["report"]["walls"]["calls"][0]["strike"]) for r in rows)
    put_counts = Counter(float(r["report"]["walls"]["puts"][0]["strike"]) for r in rows)
    ce_key = call_counts.most_common(1)[0][0]
    pe_key = put_counts.most_common(1)[0][0]
    pe_alt = next((s for s, _ in put_counts.most_common() if s != pe_key), pe_key)

    series = {
        "t": [], "min": [], "spot": [], "max_pain": [], "call_wall": [], "put_wall": [],
        "call_wall_oi": [], "put_wall_oi": [], "net_gex": [], "flip": [], "flip_cum": [],
        "regime_gex": [], "pin_score": [], "dist_pin": [], "dist_flip": [],
        "ce_key_oi": [], "pe_key_oi": [], "pe_alt_oi": [], "ce_key_gamma": [],
    }
    profiles_frames: list[dict] = []
    for row_index, row in enumerate(rows):
        rep = row["report"]
        spot = float(rep["spot"])
        mp = float(rep["max_pain"])
        per = rep["gex"]["strikes"]
        call_wall = rep["walls"]["calls"][0]
        put_wall = rep["walls"]["puts"][0]
        strikes = {float(s["strike"]): s for s in rep["strikes"]}

        def oi(strike: float, side: str):
            entry = strikes.get(strike)
            return None if entry is None else round(entry[side]["oi"] / 1e6, 2)

        def gamma(strike: float):
            entry = strikes.get(strike)
            return None if entry is None else entry["ce"]["gamma"]

        series["t"].append(row["clock"][:5])
        series["min"].append(row["min"])
        series["spot"].append(round(spot, 1))
        series["max_pain"].append(mp)
        series["call_wall"].append(float(call_wall["strike"]))
        series["put_wall"].append(float(put_wall["strike"]))
        series["call_wall_oi"].append(round(call_wall["oi"] / 1e6, 2))
        series["put_wall_oi"].append(round(put_wall["oi"] / 1e6, 2))
        series["net_gex"].append(round(rep["gex"]["net_total"], 1))
        flip = local_flip(per, spot)
        series["flip"].append(flip)
        series["flip_cum"].append(flip_level(per, spot))
        series["regime_gex"].append(cum_at_spot(per, spot))
        series["dist_pin"].append(round(spot - mp, 1))
        series["dist_flip"].append(None if flip is None else round(spot - flip, 1))
        series["pin_score"].append(
            round(100.0 * max(0.0, 1.0 - abs(spot - mp) / (2 * PIN_BAND)), 1)
        )
        series["ce_key_oi"].append(oi(ce_key, "ce"))
        series["pe_key_oi"].append(oi(pe_key, "pe"))
        series["pe_alt_oi"].append(oi(pe_alt, "pe"))
        series["ce_key_gamma"].append(gamma(ce_key))
        profiles_frames.append({"clock": row["clock"], "min": row["min"], "rep": rep, "idx": row_index})

    spot = series["spot"]
    mp = series["max_pain"]
    n = len(spot)

    ticks = [start_min]
    for hour_min in (600, 660, 720, 780, 840):
        if start_min + 1 < hour_min and end_min - hour_min >= 20 and hour_min - ticks[-1] >= 25:
            ticks.append(hour_min)
    ticks.append(end_min)
    axis = {
        "lo": start_min,
        "hi": end_min,
        "ticks": ticks,
        "labels": {str(m): f"{m // 60:02d}:{m % 60:02d}" for m in ticks},
        "end_label": f"{end_min // 60:02d}:{end_min % 60:02d}",
    }

    last_gex = rows[-1]["report"]["gex"]["strikes"]
    nonzero = [float(e["strike"]) for e in last_gex if abs(e["net_gex"]) >= 1.0]
    if not nonzero:
        nonzero = [float(e["strike"]) for e in last_gex]
    surface_lo = int(math.floor((min(nonzero) - SURFACE_PAD_STRIKES) / 50) * 50)
    surface_hi = int(math.ceil((max(nonzero) + SURFACE_PAD_STRIKES) / 50) * 50)
    surface_strikes = list(range(surface_lo, surface_hi + 1, 50))

    profile_lo = int(math.floor((min(spot_all) - PROFILE_PAD_STRIKES) / 50) * 50)
    profile_hi = int(math.ceil((max(spot_all) + PROFILE_PAD_STRIKES) / 50) * 50)
    profile_strikes = list(range(profile_lo, profile_hi + 1, 50))

    # Two mid-session profiles plus the last print. 135 minutes after the first
    # snapshot lands on 11:30 for the default 09:15 tape; rounding to the
    # quarter-hour keeps later sessions from reading 12:19.
    t1_min = min(max(int(round((start_min + 135) / 15.0)) * 15, start_min), end_min)
    t2_min = min(t1_min + 30, end_min)
    profile_times = [
        f"{t1_min // 60:02d}:{t1_min % 60:02d}",
        f"{t2_min // 60:02d}:{t2_min % 60:02d}",
        f"{end_min // 60:02d}:{end_min % 60:02d}",
    ]

    buckets: dict[int, list[int]] = {}
    for i, m in enumerate(series["min"]):
        buckets.setdefault((m - start_min) // 5, []).append(i)
    bucket_rows = []
    for key in sorted(buckets):
        idx = buckets[key]
        start = start_min + key * 5
        bucket_rows.append(
            {
                "t": f"{start // 60:02d}:{start % 60:02d}",
                "min": start,
                "spot": round(stats.mean(spot[i] for i in idx), 1),
                "mp": mp[idx[-1]],
                "dist": round(stats.mean(spot[i] - mp[i] for i in idx), 1),
                "pin": round(stats.mean(series["pin_score"][i] for i in idx), 1),
                "net": round(stats.mean(series["net_gex"][i] for i in idx), 1),
                "flip": series["flip"][idx[-1]],
                "call_wall": series["call_wall"][idx[-1]],
                "put_wall": series["put_wall"][idx[-1]],
            }
        )

    horizon = 5
    gap, d_spot, d_mp = [], [], []
    for i in range(n - horizon):
        gap.append(spot[i] - mp[i])
        d_spot.append(spot[i + horizon] - spot[i])
        d_mp.append(mp[i + horizon] - mp[i])
    rev_spot = ols(gap, d_spot)
    rev_mp = ols(gap, d_mp)
    rev_total = ols(gap, [a - b for a, b in zip(d_spot, d_mp)])

    def half_life(slope: float) -> float | None:
        if slope >= 0:
            return None
        return round(5.0 * math.log(0.5) / math.log(1.0 + slope), 1)

    fwd = [(abs(spot[i] - mp[i]), abs(spot[i + horizon] - spot[i])) for i in range(n - horizon)]
    near_moves = [f for d, f in fwd if d <= 15]
    mid_moves = [f for d, f in fwd if 15 < d <= 50]
    far_moves = [f for d, f in fwd if d > 50]

    inside = [i for i in range(n) if series["put_wall"][i] <= spot[i] <= series["call_wall"][i]]
    aft_from = max(start_min, AFTERNOON_MIN)
    aft_idx = [i for i in range(n) if series["min"][i] >= aft_from]
    inside_aft = [i for i in aft_idx if series["put_wall"][i] <= spot[i] <= series["call_wall"][i]]
    high_i = max(range(n), key=lambda i: spot[i])
    low_i = min(range(n), key=lambda i: spot[i])

    def oi_at(frame_index: int, strike: float, side: str):
        strikes = {float(s["strike"]): s for s in profiles_frames[frame_index]["rep"]["strikes"]}
        entry = strikes.get(float(strike))
        return None if entry is None else round(entry[side]["oi"] / 1e6, 2)

    def wall_moves(key: str) -> list[dict]:
        out = []
        for i in range(1, n):
            if series[key][i] != series[key][i - 1]:
                out.append(
                    {
                        "t": series["t"][i],
                        "from": series[key][i - 1],
                        "to": series[key][i],
                        "oi": series[key + "_oi"][i],
                    }
                )
        return out

    # The first put-wall step up after the afternoon split, explained by the
    # two strikes' open interest at that snapshot.
    put_flip = next(
        (
            {
                "t": series["t"][i],
                "from": series["put_wall"][i - 1],
                "to": series["put_wall"][i],
                "oi_from": oi_at(i, series["put_wall"][i - 1], "pe"),
                "oi_to": oi_at(i, series["put_wall"][i], "pe"),
            }
            for i in range(1, n)
            if series["min"][i] >= aft_from and series["put_wall"][i] > series["put_wall"][i - 1]
        ),
        None,
    )

    def nearest_clock(target: str) -> dict:
        tgt = minute_of(target + ":00")
        return min(profiles_frames, key=lambda f: abs(f["min"] - tgt))

    profiles = []
    for label in profile_times:
        frame = nearest_clock(label)
        rep = frame["rep"]
        frame_idx = frame["idx"]
        per = {float(e["strike"]): e for e in rep["gex"]["strikes"]}
        cum = 0.0
        net_by_strike, cum_by_strike = [], []
        for strike in profile_strikes:
            value = round(per.get(float(strike), {}).get("net_gex", 0.0), 1)
            cum += value
            net_by_strike.append(value)
            cum_by_strike.append(round(cum, 1))
        profiles.append(
            {
                "label": label,
                "t": frame["clock"][:5],
                "idx": frame_idx,
                "spot": round(float(rep["spot"]), 1),
                "mp": float(rep["max_pain"]),
                "flip": local_flip(rep["gex"]["strikes"], float(rep["spot"])),
                "flip_cum": flip_level(rep["gex"]["strikes"], float(rep["spot"])),
                "regime_cum": cum_at_spot(rep["gex"]["strikes"], float(rep["spot"])),
                "net": round(rep["gex"]["net_total"], 1),
                "strikes": list(profile_strikes),
                "net_gex": net_by_strike,
                "cum_gex": cum_by_strike,
            }
        )

    def profile_net(p_idx: int, strike: float) -> float | None:
        p = profiles[p_idx]
        try:
            return p["net_gex"][p["strikes"].index(float(strike))]
        except ValueError:
            return None

    surface_times: list[str] = []
    surface_minutes: list[int] = []
    surface_z = {float(s): [] for s in surface_strikes}
    first_tick = ((start_min + SURFACE_STEP_MIN - 1) // SURFACE_STEP_MIN) * SURFACE_STEP_MIN
    for tick in range(first_tick, end_min + 1, SURFACE_STEP_MIN):
        frame = min(profiles_frames, key=lambda f: abs(f["min"] - tick))
        rep = frame["rep"]
        per = {float(e["strike"]): e["net_gex"] for e in rep["gex"]["strikes"]}
        surface_times.append(f"{tick // 60:02d}:{tick % 60:02d}")
        surface_minutes.append(tick)
        for strike in surface_strikes:
            surface_z[float(strike)].append(round(per.get(float(strike), 0.0), 1))

    # The last print is the whole point on expiry day (gamma diverges at the
    # pin), so it gets its own column even when it is off the 5-minute grid.
    if surface_minutes and surface_minutes[-1] != end_min:
        rep = profiles_frames[-1]["rep"]
        per = {float(e["strike"]): e["net_gex"] for e in rep["gex"]["strikes"]}
        surface_times.append(f"{end_min // 60:02d}:{end_min % 60:02d}")
        surface_minutes.append(end_min)
        for strike in surface_strikes:
            surface_z[float(strike)].append(round(per.get(float(strike), 0.0), 1))

    surface_matrix = [surface_z[float(s)] for s in surface_strikes]
    amplitudes = [abs(v) for row in surface_matrix for v in row]
    cap = max(25.0, quantile(amplitudes, 0.995))
    surface_scale = {"cmin": -round(cap), "cmax": round(cap)}
    ridge_strikes = []
    for strike, label in ((ce_key, "call wall"), (mp[-1], "max pain")):
        if float(strike) not in surface_z:
            strike = min((s for s in surface_strikes), key=lambda s: abs(s - strike))
        ridge_strikes.append(
            {"strike": strike, "label": label, "values": surface_z[float(strike)]}
        )

    f_t2, f_last = nearest_clock(profile_times[1]), profiles_frames[-1]
    gex_t2 = {float(e["strike"]): e["net_gex"] for e in f_t2["rep"]["gex"]["strikes"]}
    gex_last = {float(e["strike"]): e["net_gex"] for e in f_last["rep"]["gex"]["strikes"]}
    gex_delta = sorted(
        (
            {
                "strike": strike,
                "from": round(gex_t2.get(strike, 0.0), 1),
                "to": round(gex_last[strike], 1),
                "delta": round(gex_last[strike] - gex_t2.get(strike, 0.0), 1),
            }
            for strike in gex_last
        ),
        key=lambda d: abs(d["delta"]),
        reverse=True,
    )[:6]

    regime = {
        "min": round(min(series["regime_gex"]), 1),
        "max": round(max(series["regime_gex"]), 1),
        "at": {p["label"]: p["regime_cum"] for p in profiles},
        "ever_long": any(v > 1 for v in series["regime_gex"]),
        "long_share": pct_share(range(n), lambda i: series["regime_gex"][i] > 1),
        "long_snaps": sum(1 for v in series["regime_gex"] if v > 1),
    }

    flip_from = max(start_min, AFTERNOON_MIN)
    net_flip = next(
        (
            {"t": series["t"][i], "from": series["net_gex"][i - 1], "to": series["net_gex"][i],
             "spot": spot[i], "prev_t": series["t"][i - 1]}
            for i in range(1, n)
            if series["min"][i] >= flip_from and series["net_gex"][i - 1] < 0 <= series["net_gex"][i]
        ),
        None,
    ) or next(
        (
            {"t": series["t"][i], "from": series["net_gex"][i - 1], "to": series["net_gex"][i],
             "spot": spot[i], "prev_t": series["t"][i - 1]}
            for i in range(1, n)
            if series["net_gex"][i - 1] < 0 <= series["net_gex"][i]
        ),
        None,
    )

    flips = [v for v in series["flip"] if v is not None]
    flip_gap = [abs(v) for v in series["dist_flip"] if v is not None]
    flip_stats = {
        "n": len(flips),
        "first": flips[0] if flips else None,
        "last": flips[-1] if flips else None,
        "at": {p["label"]: p["flip"] for p in profiles},
        "mean_abs_gap": round(stats.mean(flip_gap), 1) if flip_gap else None,
        "median_abs_gap": round(stats.median(flip_gap), 1) if flip_gap else None,
        "share_within_20": pct_share(range(n), lambda i: series["dist_flip"][i] is not None and abs(series["dist_flip"][i]) <= 20),
        "share_below": pct_share(
            range(n), lambda i: series["dist_flip"][i] is not None and series["dist_flip"][i] < 0
        ),
    }

    futures = None
    fbars: list[dict] = []
    if FUTURES_PATH.exists():
        futures = json.loads(FUTURES_PATH.read_text())
        fbars = [c for c in futures["candles"] if c["t"][11:16] <= axis["end_label"]]

    aft_idx_all = [i for i in range(n) if series["min"][i] >= aft_from] or list(range(n))
    aft_high_i = max(aft_idx_all, key=lambda i: spot[i])
    aft_low_i = min(aft_idx_all, key=lambda i: spot[i])

    def window_stats(lo: str, hi: str) -> dict:
        # close-to-close across the window, matching the futures page so the same
        # window cannot report two different numbers on the same page set.
        seg = [c for c in fbars if lo < c["t"][11:16] <= hi]
        base = next(c for c in fbars if c["t"][11:16] == lo)
        return {
            "from": lo,
            "to": hi,
            "open": base["c"],
            "close": seg[-1]["c"],
            "dp": round(seg[-1]["c"] - base["c"], 1),
            "doi": int(seg[-1]["oi"] - base["oi"]),
            "vol": int(sum(c["v"] for c in seg)),
        }

    def span(lo: str, hi: str) -> dict:
        idx = [i for i in range(n) if lo <= series["t"][i] <= hi]
        vals = [spot[i] for i in idx]
        return {"from": lo, "to": hi, "n": len(idx), "low": min(vals), "high": max(vals)}

    bounds = [start_min]
    for hour_min in (660, 720, 780):
        if start_min + 30 < hour_min < end_min - 30:
            bounds.append(hour_min)
    bounds.append(end_min)
    window_rows = []
    for k in range(len(bounds) - 1):
        lo_min, hi_min = bounds[k], bounds[k + 1]
        lo, hi = f"{lo_min // 60:02d}:{lo_min % 60:02d}", f"{hi_min // 60:02d}:{hi_min % 60:02d}"
        idx = [
            i for i in range(n)
            if lo <= series["t"][i] and (series["t"][i] < hi or k == len(bounds) - 2)
        ]
        window_rows.append(
            {
                "label": f"{lo}–{hi}",
                "from": lo,
                "to": hi,
                "n": len(idx),
                "mean_abs_dist": round(stats.mean(abs(spot[i] - mp[i]) for i in idx), 1),
                "max_abs_dist": round(max(abs(spot[i] - mp[i]) for i in idx), 1),
                "share_25": pct_share(idx, lambda i: abs(spot[i] - mp[i]) <= PIN_BAND),
            }
        )

    start_label = f"{start_min // 60:02d}:{start_min % 60:02d}"
    null_pack = build_null(spot, mp, series["put_wall"], series["call_wall"], start_label)
    first_sec = minute_of(rows[0]["clock"]) * 60 + int(rows[0]["clock"][6:8])
    last_sec = minute_of(rows[-1]["clock"]) * 60 + int(rows[-1]["clock"][6:8])
    open_sec, close_sec = 9 * 3600 + 15 * 60, 15 * 3600 + 30 * 60
    gaps = []
    for i in range(1, n):
        prev_sec = minute_of(rows[i - 1]["clock"]) * 60 + int(rows[i - 1]["clock"][6:8])
        cur_sec = minute_of(rows[i]["clock"]) * 60 + int(rows[i]["clock"][6:8])
        if cur_sec - prev_sec >= 150:
            gaps.append({
                "from": series["t"][i - 1],
                "to": series["t"][i],
                "minutes": round((cur_sec - prev_sec) / 60.0, 1),
            })
    gap_text = (
        "; ".join(f"{g['from']}→{g['to']} {fmt(g['minutes'], 0)} min" for g in gaps)
        or "none"
    )
    if gaps:
        null_pack["method"] += (
            f" Recording gaps are carried as single price changes rather than interpolated "
            f"({gap_text})."
        )
    coverage = {
        "first_clock": rows[0]["clock"],
        "last_clock": rows[-1]["clock"],
        "first_t": start_label,
        "last_t": f"{end_min // 60:02d}:{end_min % 60:02d}",
        "covered_min": round((last_sec - first_sec) / 60.0, 1),
        "missing_open_min": round(max(0.0, (first_sec - open_sec) / 60.0), 1),
        "to_close_sec": round(max(0.0, close_sec - last_sec), 1),
        "reaches_close": last_sec >= close_sec - 60,
        "clipped": CUTOFF is not None,
        "cutoff": CUTOFF,
        "gaps": gaps,
        "max_gap_min": max((g["minutes"] for g in gaps), default=0.0),
        "gap_text": gap_text,
    }

    post_clip = None
    if futures is not None:
        fx_at_end = next(
            (c for c in fbars if c["t"][11:16] == axis["end_label"]),
            fbars[-1],
        )
        fx_last = next(
            (c for c in futures["candles"] if c["t"][11:16] == "15:29"),
            futures["candles"][-1],
        )
        basis = round(fx_at_end["c"] - spot[-1], 1)
        implied_last = round(fx_last["c"] - basis, 1)
        post_clip = {
            "futures_expiry": futures.get("expiry"),
            "futures_at_end": fx_at_end["c"],
            "futures_t": axis["end_label"],
            "spot_at_end": spot[-1],
            "basis_at_end": basis,
            "futures_last": fx_last["c"],
            "futures_last_t": fx_last["t"][11:16],
            "implied_spot_last": implied_last,
            "pin_at_end": mp[-1],
            "implied_gap_last": round(implied_last - mp[-1], 1),
        }

    stat_pack = {
        "clip": {
            "snapshots": n,
            "first": rows[0]["clock"],
            "last": rows[-1]["clock"],
            "applied": CUTOFF is not None,
            "cutoff": CUTOFF,
        },
        "spot": {
            "open": spot[0],
            "last": spot[-1],
            "change": round(spot[-1] - spot[0], 1),
            "high": {"t": series["t"][high_i], "v": spot[high_i]},
            "low": {"t": series["t"][low_i], "v": spot[low_i]},
            "range": round(spot[high_i] - spot[low_i], 1),
        },
        "max_pain": {
            "open": mp[0],
            "last": mp[-1],
            "changes": sum(1 for i in range(1, n) if mp[i] != mp[i - 1]),
            "final_dist": round(spot[-1] - mp[-1], 1),
            "levels": [
                {"value": value, "share": round(100.0 * count / n, 1)}
                for value, count in Counter(mp).most_common()
            ],
            "modal": max(Counter(mp).items(), key=lambda kv: kv[1])[0],
            "modal_share": round(100.0 * Counter(mp).most_common(1)[0][1] / n, 1),
        },
        "pin": {
            "share_15": pct_share(range(n), lambda i: abs(spot[i] - mp[i]) <= 15),
            "share_25": pct_share(range(n), lambda i: abs(spot[i] - mp[i]) <= PIN_BAND),
            "share_50": pct_share(range(n), lambda i: abs(spot[i] - mp[i]) <= 50),
            "windows": window_rows,
        },
        "reversion": {
            "spot_on_gap": rev_spot,
            "mp_on_gap": rev_mp,
            "gap_on_gap": rev_total,
            "half_life_min": half_life(rev_total["slope"]),
            "horizon_min": horizon,
        },
        "vol_near_pin": {
            "near_15": {"n": len(near_moves), "mean_abs_5m": round(stats.mean(near_moves), 1)},
            "mid_15_50": {"n": len(mid_moves), "mean_abs_5m": round(stats.mean(mid_moves), 1)},
            "far_50p": {"n": len(far_moves), "mean_abs_5m": round(stats.mean(far_moves), 1)},
        },
        "walls": {
            "share_inside": pct_share(range(n), lambda i: series["put_wall"][i] <= spot[i] <= series["call_wall"][i]),
            "share_inside_afternoon": pct_share(
                aft_idx, lambda i: series["put_wall"][i] <= spot[i] <= series["call_wall"][i]
            ),
            "afternoon_n": len(aft_idx),
            "high_gap_to_call_wall": round(series["call_wall"][high_i] - spot[high_i], 1),
            "call_wall_at_high": series["call_wall"][high_i],
            "low_gap_to_put_wall": round(spot[low_i] - series["put_wall"][low_i], 1),
            "put_wall_at_low": series["put_wall"][low_i],
            "call_moves": wall_moves("call_wall"),
            "put_moves": wall_moves("put_wall"),
            "put_flip": put_flip,
        },
        "gex": {
            "net_open": series["net_gex"][0],
            "net_last": series["net_gex"][-1],
            "at": {
                p["label"]: {
                    "net": p["net"], "flip": p["flip"], "flip_cum": p["flip_cum"],
                    "spot": p["spot"], "t": p["t"], "regime_cum": p["regime_cum"],
                }
                for p in profiles
            },
            "definitions": {
                "chain_total": "net_total: sum of net GEX over every strike in the chain (the number the volatility page quotes)",
                "gated_at_spot": "cumulative GEX of the strikes at or below spot (the report's regime gate)",
            },
            "delta_top": gex_delta,
            "regime": regime,
            "net_flip": net_flip,
            "flip": flip_stats,
        },
        "oi": {
            "ce_key": ce_key,
            "pe_key": pe_key,
            "pe_alt": pe_alt,
            "ce_key_open": series["ce_key_oi"][0],
            "ce_key_t1": series["ce_key_oi"][profiles[0]["idx"]],
            "ce_key_t2": series["ce_key_oi"][profiles[1]["idx"]],
            "ce_key_last": series["ce_key_oi"][-1],
            "gamma_key_open": series["ce_key_gamma"][0],
            "gamma_key_t2": series["ce_key_gamma"][profiles[1]["idx"]],
            "gamma_key_last": series["ce_key_gamma"][-1],
            "pe_key_t2": series["pe_key_oi"][profiles[1]["idx"]],
            "pe_key_last": series["pe_key_oi"][-1],
            "net_key_t1": profile_net(0, ce_key),
            "net_key_t2": profile_net(1, ce_key),
            "net_key_last": profile_net(2, ce_key),
        },
        "futures": (
            {
                "build": window_stats("11:45", "12:00"),
                "unwind": window_stats("12:15", "12:45"),
                "bars": len(fbars),
            }
            if futures is not None
            else None
        ),
        "null": null_pack,
        "post_clip": post_clip,
        "coverage": coverage,
        "afternoon": {
            "span": span(f"{aft_from // 60:02d}:{aft_from % 60:02d}", coverage["last_t"]),
            "high": {"t": series["t"][aft_high_i], "v": spot[aft_high_i]},
            "low": {"t": series["t"][aft_low_i], "v": spot[aft_low_i]},
            "fade": round(spot[aft_low_i] - spot[aft_high_i], 1) if aft_low_i > aft_high_i else None,
            "recovery": round(spot[-1] - spot[aft_low_i], 1) if aft_low_i > aft_high_i else None,
            "net_since_split": round(
                spot[-1] - next(s for i, s in zip(series["min"], spot) if i >= aft_from), 1
            ),
        },
    }

    ridges = {str(r["strike"]): r["values"] for r in ridge_strikes}

    return {
        "meta": {
            "session": SESSION,
            "underlying": "NIFTY",
            "expiry": EXPIRY,
            "kind": "0-DTE expiry",
            "clipped_at": rows[-1]["clock"] if CUTOFF else None,
            "snapshots": n,
            "source": str(SNAPSHOT_PATH.relative_to(ROOT)),
            "tape_source": str(TAPE_PATH.relative_to(ROOT)) if TAPE_PATH.exists() else None,
            "futures_available": futures is not None,
            "chain_source": rows[-1]["report"].get("chain_source"),
            "units": "net GEX in Rs crore per index point (gamma x OI x spot / 1e7), per api/options_levels.compute_gex",
            "pin_band_pts": PIN_BAND,
            "surface_step_min": SURFACE_STEP_MIN,
            "profile_times": profile_times,
            "coverage": coverage,
        },
        "axis": axis,
        "keys": {"ce": ce_key, "pe": pe_key, "pe_alt": pe_alt},
        "series": series,
        "buckets5": bucket_rows,
        "surface": {
            "times": surface_times,
            "minutes": surface_minutes,
            "strikes": surface_strikes,
            "z": surface_matrix,
            "scale": surface_scale,
            "ridge_meta": ridge_strikes and [
                {"strike": r["strike"], "label": r["label"]} for r in ridge_strikes
            ],
        },
        "ridges": ridges,
        "profiles": profiles,
        "futures": (
            [
                {"t": c["t"][11:16], "min": minute_of(c["t"][11:19]), "close": c["c"], "oi": c["oi"]}
                for c in fbars[::3]
            ]
            if futures is not None
            else []
        ),
        "stats": stat_pack,
    }


def fmt(v, digits=1, sign=False):
    if v is None:
        return "—"
    body = f"{abs(v):,.{digits}f}"
    if sign:
        return ("+" if v >= 0 else "−") + body
    return ("−" if v < 0 else "") + body


def pct_phrase(p: float) -> str:
    if p <= 0:
        return "below every null path"
    if p >= 100:
        return "above every null path"
    return f"the {fmt(p, 0)}th percentile"


def build_bullets(st: dict) -> str:
    walls, pin, rev, gex, aft = st["walls"], st["pin"], st["reversion"], st["gex"], st["afternoon"]
    late = st["oi"]
    fut = (st["futures"] or {}).get("build")
    reg = gex["regime"]
    flip = gex["flip"]
    at = gex["at"]
    labels = list(at.keys())
    l1, l2, l3 = labels[0], labels[1], labels[2]
    top_delta = gex["delta_top"][0] if gex["delta_top"] else None
    net_flip = gex["net_flip"]
    null = st["null"]
    mpc = st["max_pain"]
    post = st["post_clip"]
    cov = st["coverage"]

    high_gap = st["spot"]["high"]["v"] - walls["call_wall_at_high"]
    low_gap = st["spot"]["low"]["v"] - walls["put_wall_at_low"]
    high_side = "below" if high_gap < 0 else "above"
    low_side = "below" if low_gap < 0 else "above"

    if cov["reaches_close"]:
        pin_verdict = (
            f"<b>This one is verified to the close.</b> The {cov['last_t']} snapshot — "
            f"{cov['to_close_sec']:.0f} s before the 15:30 close — printed spot "
            f"{fmt(st['spot']['last'])} against max pain {fmt(mpc['last'], 0)}, a gap of "
            f"{fmt(abs(mpc['final_dist']), 1)} pts. The tape starts at {cov['first_t']}, so the open "
            f"and the first {fmt(cov['missing_open_min'], 0)} minutes are not in this sample and no "
            f"opening claim is made."
        )
    elif post is not None:
        pin_verdict = (
            f"<b>After the recording stops the pin breaks.</b> The {post['futures_last_t']} futures "
            f"print implies spot ≈{fmt(post['implied_spot_last'], 0)}, "
            f"{fmt(abs(post['implied_gap_last']), 0)} pts from the {fmt(post['pin_at_end'], 0)} print "
            f"at {cov['last_t']}."
        )
    else:
        pin_verdict = (
            f"<b>Not verified past {cov['last_t']}.</b> No later print is available for this session, "
            f"so the last max pain is the last word in this record."
        )

    if top_delta is not None:
        delta_sentence = (
            f"The largest single-strike GEX change after {l2} was at "
            f"{fmt(top_delta['strike'], 0)} ({fmt(top_delta['from'], 1, True)} → "
            f"{fmt(top_delta['to'], 1, True)}, Δ {fmt(top_delta['delta'], 1, True)})."
        )
    else:
        delta_sentence = ""

    net_flip_text = f"crossed zero at {net_flip['t']}" if net_flip else "never re-crossed zero"
    regime_text = (
        f"went positive in {fmt(reg['long_share'])}% of snapshots"
        if reg["ever_long"]
        else "never went positive"
    )
    ce_delta = (late["ce_key_last"] or 0) - (late["ce_key_t2"] or 0)
    ce_move = "build" if ce_delta > 0 else "unwind"
    ce_move_word = "grew" if ce_delta > 0 else "shrank"
    ce_article = "a" if ce_delta > 0 else "an"

    items = [
        (
            f"<b>The walls bracketed the day — descriptive, not a test.</b> Session high "
            f"{fmt(st['spot']['high']['v'])} at {st['spot']['high']['t']} finished "
            f"{fmt(abs(high_gap))} pts {high_side} the "
            f"{fmt(walls['call_wall_at_high'], 0)} call wall; session low "
            f"{fmt(st['spot']['low']['v'])} at {st['spot']['low']['t']} finished "
            f"{fmt(abs(low_gap))} pts {low_side} the "
            f"{fmt(walls['put_wall_at_low'], 0)} put wall, inside a {fmt(st['spot']['range'])}-pt range. "
            f"Spot was inside put-wall-to-call-wall {fmt(walls['share_inside'])}% of snapshots — but the "
            f"walls are re-derived from the same OI snapshot, so on its own that number is near-tautological. "
            f"Against a same-volatility random walk the band still holds {fmt(null['inside_walls']['obs'])}% "
            f"versus a null median of {fmt(null['inside_walls']['p50'])}% "
            f"({fmt(null['inside_walls']['percentile'], 0)}th percentile) — suggestive of containment, not proof."
        ),
        (
            f"<b>Max pain chased price more than price chased max pain.</b> "
            f"Over {rev['horizon_min']}-minute steps, Δmax-pain on the (spot − max-pain) gap has "
            f"r = {fmt(rev['mp_on_gap']['corr'], 2)} (slope {fmt(rev['mp_on_gap']['slope'], 2)}), "
            f"while Δspot on the same gap has r = {fmt(rev['spot_on_gap']['corr'], 2)} "
            f"(slope {fmt(rev['spot_on_gap']['slope'], 2)}). The gap narrowed "
            f"{fmt(abs(rev['gap_on_gap']['slope']) * 100, 0)}% per step (r = "
            f"{fmt(rev['gap_on_gap']['corr'], 2)}) — but that is largely the pin moving toward spot. "
            f"That is the strongest evidence on the page and it is about the pin, not about price."
        ),
        (
            f"<b>There is no single pin.</b> Max pain printed "
            f"{len(mpc['levels'])} levels and changed {mpc['changes']} times; the modal "
            f"{fmt(mpc['modal'], 0)} held {fmt(mpc['modal_share'])}% of the "
            f"{st['clip']['snapshots']} snapshots, so “the pin at {fmt(mpc['last'], 0)}” describes the "
            f"{l3} print, not the session. Spot sat within ±25 of the current pin "
            f"{fmt(pin['share_25'])}% of the time (null median {fmt(null['share_25']['p50'])}%, "
            f"{pct_phrase(null['share_25']['percentile'])}), and mean distance to the pin was "
            f"{fmt(null['mean_abs_gap']['obs'])} pts versus a null median of "
            f"{fmt(null['mean_abs_gap']['p50'])} pts ({pct_phrase(null['mean_abs_gap']['percentile'])}). {pin_verdict}"
        ),
        (
            f"<b>Two GEX numbers, both true, different gates.</b> The <i>chain-wide</i> total (all "
            f"strikes) ran {fmt(gex['net_open'], 1, True)} → {fmt(at[l2]['net'], 1, True)} ({l2}) → "
            f"{fmt(gex['net_last'], 1, True)} ₹ Cr/pt at {l3} and "
            f"{net_flip_text} "
            f"— this is the number the volatility page quotes. The "
            f"<i>gated</i> number the report's regime uses (cumulative GEX of strikes at or below spot) "
            f"{regime_text}: "
            f"min {fmt(reg['min'], 1, True)}, max {fmt(reg['max'], 1, True)}, "
            f"{fmt(at[l1]['regime_cum'], 1, True)} at {l1} and {fmt(at[l3]['regime_cum'], 1, True)} at {l3}. "
            f"Both are plotted in the flip panel; quoting either alone is the mistake. The local flip that "
            f"tracks spot ran {fmt(flip['at'][l1])} → {fmt(flip['at'][l2])} → "
            f"{fmt(flip['at'][l3])} (spot a median {fmt(flip['median_abs_gap'])} pts from it)."
        ),
        (
            f"<b>The {fmt(late['ce_key'], 0)} call wall — the session's modal call wall — "
            f"{ce_move_word} into the close.</b> Call OI "
            f"there went {fmt(late['ce_key_t2'], 1)}M at {l2} → {fmt(late['ce_key_last'], 1)}M at {l3} "
            f"(open {fmt(late['ce_key_open'], 1)}M), {ce_article} {ce_move} of {fmt(abs(ce_delta), 1)}M, "
            f"while per-contract CE gamma moved {fmt(late['gamma_key_t2'], 4)} → "
            f"{fmt(late['gamma_key_last'], 4)}. "
            f"Net GEX at that strike moved {fmt(late['net_key_t1'], 1, True)} ({l1}) → "
            f"{fmt(late['net_key_t2'], 1, True)} ({l2}) → {fmt(late['net_key_last'], 1, True)} ({l3}). "
            f"{delta_sentence} Those GEX numbers inherit the dealer-sign assumption; the OI change is an "
            f"observed quantity, so the headline survives either sign convention."
        ),
        (
            (
                f"<b>The {l2} futures long build was sold, then partly bought back.</b> Futures "
                f"{fmt(fut['dp'], 1, True)} pts with OI {fmt(fut['doi'], 0, True)} contracts on "
                f"{fut['vol']:,} traded (11:45→12:00) left spot at {fmt(at[l2]['spot'])}; it peaked "
                f"at {fmt(aft['high']['v'])} ({aft['high']['t']}), gave back "
                f"{fmt(abs(aft['fade']) if aft['fade'] is not None else 0)} pts to "
                f"{fmt(aft['low']['v'])} ({aft['low']['t']}) and finished "
                f"{fmt(aft['net_since_split'], 1, True)} pts versus {l2}."
            )
            if fut is not None
            else (
                f"<b>No futures archive for this session, so the basis panel is absent rather than "
                f"zero-filled.</b> The spot record is complete on its own: after {l2} the high was "
                f"{fmt(aft['high']['v'])} ({aft['high']['t']}), the low {fmt(aft['low']['v'])} "
                f"({aft['low']['t']}) and the last print {fmt(st['spot']['last'])} — "
                f"{fmt(aft['net_since_split'], 1, True)} pts versus {l2}, with "
                f"{fmt(walls['share_inside_afternoon'])}% of the {walls['afternoon_n']} afternoon snapshots "
                f"inside the put-to-call wall band."
            )
        ),
    ]
    return "\n".join(f"        <li>{item}</li>" for item in items)



def build_kpis(st: dict) -> str:
    oi = st["oi"]
    gex = st["gex"]
    mpc = st["max_pain"]
    null = st["null"]
    labels = list(gex["at"].keys())
    l2, l3 = labels[1], labels[2]
    cov = st["coverage"]
    session_note = (
        f"{fmt(cov['covered_min'], 0)} min of tape from {cov['first_t']}"
        if not cov["reaches_close"]
        else f"{fmt(cov['covered_min'], 0)} min tape · {cov['to_close_sec']:.0f} s before close"
    )
    cards = [
        (f"Spot @ {l3}", fmt(st["spot"]["last"], 1), f"{fmt(st['spot']['change'], 1, True)} · {session_note}", ""),
        (f"Max pain @ {l3}", fmt(mpc["last"], 0), f"{len(mpc['levels'])} levels · modal {fmt(mpc['modal'], 0)} {fmt(mpc['modal_share'])}%", "amber"),
        ("Inside ±25 of pin", f"{fmt(st['pin']['share_25'])}%", f"null median {fmt(null['share_25']['p50'])}% · {pct_phrase(null['share_25']['percentile'])}", ""),
        ("Net GEX (all strikes)", fmt(gex["net_last"], 1, True), f"≤ spot: {fmt(gex['regime']['at'][l3], 1, True)} · ₹ Cr/pt", "green"),
        (f"{fmt(oi['ce_key'], 0)} CE OI", f"{fmt(oi['ce_key_last'], 1)}M", f"{fmt(oi['ce_key_t2'], 1)}M at {l2} · Δ {fmt(oi['ce_key_last'] - oi['ce_key_t2'], 1, True)}M", "amber"),
    ]
    out = []
    for label, value, note, tone in cards:
        cls = f" pg-v-{tone}" if tone else ""
        out.append(
            f'        <div class="pg-kpi"><div class="pg-k">{label}</div>'
            f'<div class="pg-v{cls}">{value}</div><div class="pg-n">{note}</div></div>'
        )
    return "\n".join(out)


CSS = """
#research-pin-gamma{
  --pg-bg:#000;--pg-surface:#13161C;--pg-raised:#1F242D;--pg-border:#2C313B;
  --pg-text:#E8E8E8;--pg-muted:#9B9B9B;--pg-amber:#D9902A;--pg-green:#2FA36B;
  --pg-red:#E5606A;--pg-blue:#4A8FD8;--pg-violet:#8E7CC3;
  --pg-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  color:var(--pg-text);font-size:13px;line-height:1.55;background:var(--pg-bg);
  display:block;max-width:100%;overflow-x:clip
}
#research-pin-gamma *{box-sizing:border-box}
#research-pin-gamma .pg-wrap{display:flex;flex-direction:column;gap:14px;max-width:100%}
#research-pin-gamma .pg-kicker{font:600 10px/1 var(--pg-mono);letter-spacing:.15em;text-transform:uppercase;color:var(--pg-amber)}
#research-pin-gamma h2.pg-h{font-size:22px;line-height:1.25;margin:7px 0 5px;font-weight:650;letter-spacing:-.01em}
#research-pin-gamma .pg-lede{color:var(--pg-muted);font-size:12.5px;max-width:110ch;margin:0}
#research-pin-gamma .pg-lede b{color:var(--pg-text);font-weight:600}
#research-pin-gamma .pg-banner{display:none;border:1px solid var(--pg-red);border-left:3px solid var(--pg-red);
  background:#1a1013;color:#F3C7CA;border-radius:6px;padding:10px 13px;font:12px/1.5 var(--pg-mono)}
#research-pin-gamma .pg-banner.on{display:block}
#research-pin-gamma .pg-callout{border:1px solid #4A3A22;border-left:3px solid var(--pg-amber);
  background:#171310;border-radius:6px;padding:11px 15px 12px}
#research-pin-gamma .pg-callout-tag{font:600 9.5px/1 var(--pg-mono);letter-spacing:.12em;
  text-transform:uppercase;color:var(--pg-amber);margin-bottom:6px}
#research-pin-gamma .pg-callout p{margin:0;color:#C9C9C9;font-size:12px;max-width:135ch}
#research-pin-gamma .pg-callout b{color:var(--pg-amber);font-weight:600}
#research-pin-gamma .pg-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;
  background:var(--pg-border);border:1px solid var(--pg-border);border-radius:8px;overflow:hidden}
#research-pin-gamma .pg-kpi{background:var(--pg-surface);padding:11px 13px 12px;min-width:0}
#research-pin-gamma .pg-k{font:600 9.5px/1.2 var(--pg-mono);letter-spacing:.09em;text-transform:uppercase;color:var(--pg-muted)}
#research-pin-gamma .pg-v{font:600 19px/1.2 var(--pg-mono);margin-top:6px;letter-spacing:-.01em}
#research-pin-gamma .pg-v-green{color:var(--pg-green)}#research-pin-gamma .pg-v-amber{color:var(--pg-amber)}
#research-pin-gamma .pg-n{color:var(--pg-muted);font:10.5px/1.35 var(--pg-mono);margin-top:3px}
#research-pin-gamma .pg-bullets{border:1px solid var(--pg-border);border-left:3px solid var(--pg-amber);
  border-radius:6px;background:var(--pg-surface);padding:13px 17px}
#research-pin-gamma .pg-bullets ol{margin:0;padding-left:17px}
#research-pin-gamma .pg-bullets li{margin:0 0 9px;max-width:140ch}
#research-pin-gamma .pg-bullets li:last-child{margin-bottom:0}
#research-pin-gamma .pg-bullets b{color:var(--pg-amber);font-weight:600}
#research-pin-gamma .pg-panel{border:1px solid var(--pg-border);border-radius:8px;background:var(--pg-surface);min-width:0}
#research-pin-gamma .pg-ph{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  padding:11px 14px 9px;border-bottom:1px solid var(--pg-border);flex-wrap:wrap}
#research-pin-gamma .pg-ph h3{font-size:13px;margin:0;font-weight:600;letter-spacing:.01em}
#research-pin-gamma .pg-ph .pg-hint{color:var(--pg-muted);font:10.5px var(--pg-mono)}
#research-pin-gamma .pg-body{padding:8px 10px 4px;min-width:0;overflow:hidden}
#research-pin-gamma .pg-read{color:var(--pg-muted);font-size:11.5px;padding:2px 14px 11px;max-width:150ch}
#research-pin-gamma .pg-read b{color:#C9C9C9;font-weight:600}
#research-pin-gamma .pg-profgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
#research-pin-gamma svg{display:block;width:100%;height:auto;overflow:visible}
#research-pin-gamma .pg-axis text{fill:var(--pg-muted);font:9.5px var(--pg-mono)}
#research-pin-gamma .pg-axis line{stroke:var(--pg-border)}
#research-pin-gamma .pg-gridline{stroke:var(--pg-border);stroke-width:1}
#research-pin-gamma .pg-gridline.dim{stroke:#1D222A}
#research-pin-gamma .pg-label{fill:var(--pg-muted);font:9.5px var(--pg-mono)}
#research-pin-gamma .pg-anno{fill:var(--pg-amber);font:600 9.5px var(--pg-mono)}
#research-pin-gamma .pg-legend{display:flex;flex-wrap:wrap;gap:3px 13px;padding:0 14px 7px;font:10.5px var(--pg-mono);color:var(--pg-muted)}
#research-pin-gamma .pg-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
#research-pin-gamma .pg-legend i{width:11px;height:3px;border-radius:2px;display:inline-block}
#research-pin-gamma .pg-tip{position:fixed;pointer-events:none;z-index:70;opacity:0;transition:opacity .07s linear;
  background:var(--pg-raised);border:1px solid var(--pg-border);border-radius:5px;padding:7px 9px;
  box-shadow:0 8px 24px rgba(0,0,0,.6);font:10.5px/1.5 var(--pg-mono);min-width:150px;color:var(--pg-text)}
#research-pin-gamma .pg-tip .pg-tt{color:var(--pg-amber);font-weight:600;margin-bottom:2px}
#research-pin-gamma .pg-tip .pg-tr{display:flex;justify-content:space-between;gap:14px}
#research-pin-gamma .pg-tip .pg-tr b{font-weight:500}
#research-pin-gamma .pg-err{padding:22px 16px;color:#F0AEB2;font:11.5px/1.6 var(--pg-mono)}
#research-pin-gamma .pg-foot{color:var(--pg-muted);font-size:11px;border-top:1px solid var(--pg-border);padding-top:10px;max-width:150ch}
#research-pin-gamma .pg-foot code{color:var(--pg-text);font-family:var(--pg-mono);font-size:10.5px}
#research-pin-gamma .pg-foot p{margin:0 0 5px}
@media (max-width:1180px){
  #research-pin-gamma .pg-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (max-width:720px){
  #research-pin-gamma .pg-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  #research-pin-gamma .pg-profgrid{grid-template-columns:minmax(0,1fr)}
  #research-pin-gamma h2.pg-h{font-size:19px}
}
"""

JS = r"""
(function () {
  "use strict";
  var root = document.getElementById("research-pin-gamma");
  if (!root) return;

  var dataEl = document.getElementById("pg-data");
  var D;
  try { D = JSON.parse(dataEl.textContent); }
  catch (err) { banner("Could not parse the embedded payload: " + err.message); return; }

  var d3 = window.d3;
  var Plotly = window.Plotly;
  var missing = [];
  if (!d3) missing.push("D3 v7");
  if (!Plotly) missing.push("Plotly");
  if (missing.length) banner("Missing " + missing.join(" + ") + " — the affected charts cannot render. The summary numbers and the JSON are still valid.");

  var MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
  var C = {
    bg: "#000000", surface: "#13161C", raised: "#1F242D", border: "#2C313B",
    text: "#E8E8E8", muted: "#9B9B9B", amber: "#D9902A",
    green: "#2FA36B", red: "#E5606A", blue: "#4A8FD8", violet: "#8E7CC3",
    orange: "#E08A3C"
  };
  var S = D.series;
  var AX = D.axis;
  var KEYS = D.keys;

  function banner(msg) {
    var el = root.querySelector(".pg-banner");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("on");
  }
  function mountError(hostId, msg) {
    var host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = '<div class="pg-err">' + msg + "</div>";
  }
  function f(v, d) {
    if (v === null || v === undefined) return "—";
    return Number(v).toLocaleString("en-IN", { minimumFractionDigits: d === undefined ? 1 : d, maximumFractionDigits: d === undefined ? 1 : d });
  }
  function fsign(v, d) {
    if (v === null || v === undefined) return "—";
    return (v >= 0 ? "+" : "−") + f(Math.abs(v), d);
  }

  // ---------------------------------------------------------------- tooltip
  var tip = root.querySelector("#pg-tip");
  function showTip(evt, title, rows) {
    if (!tip) return;
    tip.innerHTML = '<div class="pg-tt">' + title + "</div>" +
      rows.map(function (r) { return '<div class="pg-tr"><span>' + r[0] + "</span><b>" + r[1] + "</b></div>"; }).join("");
    tip.style.opacity = "1";
    var w = tip.offsetWidth || 170, h = tip.offsetHeight || 80;
    var x = evt.clientX + 14, y = evt.clientY + 12;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - 12;
    tip.style.left = Math.max(6, x) + "px";
    tip.style.top = Math.max(6, y) + "px";
  }
  function hideTip() { if (tip) tip.style.opacity = "0"; }

  // ------------------------------------------------------------------ svg kit
  function makeSvg(hostId, height) {
    var host = document.getElementById(hostId);
    if (!host) return null;
    var w = Math.max(260, Math.round(host.clientWidth || host.getBoundingClientRect().width || 640));
    host.innerHTML = "";
    var svg = d3.select(host).append("svg")
      .attr("viewBox", "0 0 " + w + " " + height)
      .attr("width", "100%")
      .attr("height", height)
      .attr("preserveAspectRatio", "xMinYMin meet")
      .attr("role", "img");
    return { host: host, svg: svg, w: w, h: height };
  }

  function drawTimeAxis(g, x, ih, withLabels) {
    var gx = g.append("g").attr("class", "pg-axis").attr("transform", "translate(0," + ih + ")");
    gx.append("line").attr("x1", 0).attr("x2", x.range()[1]).attr("y1", 0).attr("y2", 0)
      .attr("stroke", C.border);
    AX.ticks.forEach(function (t) {
      gx.append("line").attr("x1", x(t)).attr("x2", x(t)).attr("y1", 0).attr("y2", 4)
        .attr("stroke", C.border);
      if (withLabels) {
        gx.append("text").attr("x", x(t)).attr("y", 14).attr("text-anchor", "middle")
          .text(AX.labels[String(t)]);
      }
    });
  }

  function drawYGrid(g, y, iw, ticks) {
    var gy = g.append("g").attr("class", "pg-axis");
    ticks.forEach(function (v) {
      gy.append("line").attr("class", "pg-gridline dim").attr("x1", 0).attr("x2", iw)
        .attr("y1", y(v)).attr("y2", y(v));
      gy.append("text").attr("x", -7).attr("y", y(v)).attr("dy", "0.32em")
        .attr("text-anchor", "end").text(v.toLocaleString("en-IN"));
    });
  }

  function hoverCapture(c, x, iw, ih, m, onIndex) {
    var overlay = c.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    var rule = overlay.append("line").attr("y1", 0).attr("y2", ih)
      .attr("stroke", C.muted).attr("stroke-width", 1).attr("stroke-dasharray", "2 3").attr("opacity", 0);
    var dot = overlay.append("circle").attr("r", 3).attr("fill", C.amber).attr("opacity", 0);
    var hot = overlay.append("rect").attr("x", 0).attr("y", 0).attr("width", iw).attr("height", ih)
      .attr("fill", "transparent").style("cursor", "crosshair");
    hot.on("mousemove", function (evt) {
      var px = d3.pointer(evt)[0];
      var value = x.invert(px);
      var hit = onIndex(value, evt);
      if (!hit) { rule.attr("opacity", 0); dot.attr("opacity", 0); hideTip(); return; }
      rule.attr("x1", hit.px).attr("x2", hit.px).attr("opacity", .55);
      dot.attr("cx", hit.px).attr("cy", hit.py).attr("opacity", 1);
      showTip(evt, hit.title, hit.rows);
    });
    hot.on("mouseleave", function () {
      rule.attr("opacity", 0); dot.attr("opacity", 0); hideTip();
    });
  }

  function nearestIndex(minuteValue) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < S.min.length; i++) {
      var d = Math.abs(S.min[i] - minuteValue);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function clampPx(v, max) {
    return Math.max(0, Math.min(max, v));
  }

  // ------------------------------------------------- chart 1: spot vs the pin
  function drawSpotPin() {
    var H = 340;
    var c = makeSvg("pg-spotpin", H);
    if (!c) return;
    var m = { t: 10, r: 12, b: 24, l: 46 };
    var iw = c.w - m.l - m.r, ih = H - m.t - m.b;
    // The domain follows spot: early on the top-OI call wall was 26,000 (700 pts
    // away) and including it flattens the whole session. Walls outside the band
    // are clipped rather than compressed into the plot.
    var lo = d3.min(S.spot) - 25, hi = d3.max(S.spot) + 35;
    var x = d3.scaleLinear().domain([AX.lo, AX.hi]).range([0, iw]);
    var y = d3.scaleLinear().domain([lo, hi]).range([ih, 0]).nice();
    var g = c.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    var ticks = y.ticks(6);
    drawYGrid(g, y, iw, ticks);
    drawTimeAxis(g, x, ih, true);

    var plot = g.append("g");

    var band = d3.area()
      .x(function (i) { return x(S.min[i]); })
      .y0(function (i) { return clampPx(y(S.max_pain[i] - 25), ih); })
      .y1(function (i) { return clampPx(y(S.max_pain[i] + 25), ih); })
      .curve(d3.curveStepAfter);
    plot.append("path").attr("d", band(d3.range(S.min.length)))
      .attr("fill", C.amber).attr("fill-opacity", .12).attr("stroke", "none");

    function stepLine(values, color, width, dash, opacity) {
      var line = d3.line()
        .defined(function (i) { return values[i] >= lo && values[i] <= hi; })
        .x(function (i) { return x(S.min[i]); })
        .y(function (i) { return clampPx(y(values[i]), ih); })
        .curve(d3.curveStepAfter);
      plot.append("path").attr("d", line(d3.range(values.length)))
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", width)
        .attr("stroke-dasharray", dash || null).attr("opacity", opacity || 1);
    }
    stepLine(S.call_wall, C.red, 1.4, "5 3", .95);
    stepLine(S.put_wall, C.green, 1.4, "5 3", .95);
    stepLine(S.max_pain, C.amber, 1.7, "1 3", 1);

    var spotLine = d3.line()
      .x(function (i) { return x(S.min[i]); })
      .y(function (i) { return y(S.spot[i]); });
    plot.append("path").attr("d", spotLine(d3.range(S.spot.length)))
      .attr("fill", "none").attr("stroke", C.text).attr("stroke-width", 1.7);

    var tight = iw < 640;
    D.profiles.forEach(function (p, k) {
      var pm = parseInt(p.t.slice(0, 2), 10) * 60 + parseInt(p.t.slice(3, 5), 10);
      var anchor = k === D.profiles.length - 1 ? "end" : "start";
      var yOff = k === 1 && tight ? 21 : 9;
      g.append("line").attr("x1", x(pm)).attr("x2", x(pm)).attr("y1", 0).attr("y2", ih)
        .attr("stroke", C.border).attr("stroke-dasharray", "2 4").attr("opacity", .8);
      g.append("text").attr("class", "pg-anno").attr("x", x(pm) + (anchor === "end" ? -3 : 3))
        .attr("y", yOff).attr("text-anchor", anchor).text(p.label);
    });

    var hiIdx = S.spot.indexOf(Math.max.apply(null, S.spot));
    var loIdx = S.spot.indexOf(Math.min.apply(null, S.spot));
    [[hiIdx, "high " + f(S.spot[hiIdx]), -8, "end"], [loIdx, "low " + f(S.spot[loIdx]), 13, "start"]].forEach(function (a) {
      plot.append("circle").attr("cx", x(S.min[a[0]])).attr("cy", y(S.spot[a[0]])).attr("r", 2.6)
        .attr("fill", C.text);
      plot.append("text").attr("class", "pg-label").attr("x", x(S.min[a[0]]))
        .attr("y", y(S.spot[a[0]]) + a[2]).attr("text-anchor", a[3]).text(a[1]);
    });

    hoverCapture(c, x, iw, ih, m, function (value, evt) {
      var i = nearestIndex(value);
      var px = x(S.min[i]), py = y(S.spot[i]);
      return {
        px: px, py: py, title: S.t[i] + " IST",
        rows: [
          ["spot", f(S.spot[i])],
          ["max pain", f(S.max_pain[i], 0)],
          ["dist to pin", fsign(S.dist_pin[i])],
          ["pin score", f(S.pin_score[i], 0) + " / 100"],
          ["call wall", f(S.call_wall[i], 0)],
          ["put wall", f(S.put_wall[i], 0)]
        ]
      };
    });
  }

  function drawPinScore() {
    var H = 74;
    var c = makeSvg("pg-pinscore", H);
    if (!c) return;
    var m = { t: 8, r: 12, b: 16, l: 46 };
    var iw = c.w - m.l - m.r, ih = H - m.t - m.b;
    var x = d3.scaleLinear().domain([AX.lo, AX.hi]).range([0, iw]);
    var y = d3.scaleLinear().domain([0, 100]).range([ih, 0]);
    var g = c.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    g.append("line").attr("class", "pg-gridline").attr("x1", 0).attr("x2", iw)
      .attr("y1", y(50)).attr("y2", y(50));
    g.append("text").attr("class", "pg-label").attr("x", -7).attr("y", y(50))
      .attr("dy", "0.32em").attr("text-anchor", "end").text("50");
    g.append("text").attr("class", "pg-label").attr("x", -7).attr("y", 4)
      .attr("text-anchor", "end").text("100");

    var area = d3.area()
      .x(function (d) { return x(d.min); })
      .y0(ih).y1(function (d) { return y(d.pin); });
    g.append("path").attr("d", area(D.buckets5))
      .attr("fill", C.amber).attr("fill-opacity", .22).attr("stroke", "none");
    var line = d3.line().x(function (d) { return x(d.min); }).y(function (d) { return y(d.pin); });
    g.append("path").attr("d", line(D.buckets5))
      .attr("fill", "none").attr("stroke", C.amber).attr("stroke-width", 1.3);
    drawTimeAxis(g, x, ih, false);

    hoverCapture(c, x, iw, ih, m, function (value, evt) {
      var best = D.buckets5[0];
      D.buckets5.forEach(function (b) { if (Math.abs(b.min - value) < Math.abs(best.min - value)) best = b; });
      return {
        px: x(best.min), py: y(best.pin), title: best.t + " · 5-min bucket",
        rows: [["pin score", f(best.pin, 0) + " / 100"], ["mean dist", fsign(best.dist)], ["spot (mean)", f(best.spot)]]
      };
    });
  }

  // ------------------------------- chart 2b: pin distance vs the random-walk null
  function drawNull() {
    var H = 236;
    var c = makeSvg("pg-null", H);
    if (!c) return;
    var m = { t: 12, r: 12, b: 22, l: 46 };
    var iw = c.w - m.l - m.r, ih = H - m.t - m.b;
    var x = d3.scaleLinear().domain([AX.lo, AX.hi]).range([0, iw]);
    var band = D.stats.null.band;
    var yTop = d3.max(band.p95) * 1.06;
    var y = d3.scaleLinear().domain([0, yTop]).range([ih, 0]).nice();
    var g = c.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    drawYGrid(g, y, iw, y.ticks(4));
    drawTimeAxis(g, x, ih, true);

    var cone = d3.area()
      .x(function (i) { return x(S.min[i]); })
      .y0(function (i) { return y(band.p05[i]); })
      .y1(function (i) { return y(band.p95[i]); });
    g.append("path").attr("d", cone(d3.range(S.min.length)))
      .attr("fill", "#8A8F98").attr("fill-opacity", .18).attr("stroke", "none");

    var median = d3.line()
      .x(function (i) { return x(S.min[i]); })
      .y(function (i) { return y(band.p50[i]); });
    g.append("path").attr("d", median(d3.range(S.min.length)))
      .attr("fill", "none").attr("stroke", "#8A8F98").attr("stroke-width", 1.3)
      .attr("stroke-dasharray", "4 3");

    var observed = d3.line()
      .x(function (i) { return x(S.min[i]); })
      .y(function (i) { return y(band.obs[i]); });
    g.append("path").attr("d", observed(d3.range(S.min.length)))
      .attr("fill", "none").attr("stroke", C.amber).attr("stroke-width", 1.7);

    var st = D.stats.null;
    g.append("text").attr("class", "pg-label").attr("x", iw).attr("y", 10)
      .attr("text-anchor", "end")
      .text("observed mean " + f(st.mean_abs_gap.obs, 1) + " pts · null median " + f(st.mean_abs_gap.p50, 1));

    hoverCapture(c, x, iw, ih, m, function (value, evt) {
      var i = nearestIndex(value);
      return {
        px: x(S.min[i]), py: y(band.obs[i]), title: S.t[i] + " IST",
        rows: [
          ["observed |spot − pin|", f(band.obs[i], 1)],
          ["null median", f(band.p50[i], 1)],
          ["null p05–p95", f(band.p05[i], 0) + "–" + f(band.p95[i], 0)]
        ]
      };
    });
  }

  // --------------------------------------- chart 2: gamma flip + net GEX path
  function drawFlip() {
    var H = 330;
    var c = makeSvg("pg-flip", H);
    if (!c) return;
    var m = { t: 10, r: 12, b: 22, l: 48 };
    var iw = c.w - m.l - m.r, ih = H - m.t - m.b;
    var topH = Math.round(ih * 0.58), gap = 20, botH = ih - topH - gap;
    var x = d3.scaleLinear().domain([AX.lo, AX.hi]).range([0, iw]);

    var flips = S.flip.filter(function (v) { return v !== null; });
    var lo = Math.min(d3.min(S.spot), d3.min(flips)) - 20;
    var hi = Math.max(d3.max(S.spot), d3.max(flips)) + 20;
    var y = d3.scaleLinear().domain([lo, hi]).range([topH, 0]).nice();
    var g = c.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    drawYGrid(g, y, iw, y.ticks(5));
    drawTimeAxis(g, x, topH, false);

    function lineOf(values, color, width, dash) {
      var line = d3.line()
        .defined(function (i) { return values[i] !== null && values[i] !== undefined; })
        .x(function (i) { return x(S.min[i]); })
        .y(function (i) { return y(values[i]); });
      g.append("path").attr("d", line(d3.range(values.length)))
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", width)
        .attr("stroke-dasharray", dash || null);
    }
    lineOf(S.spot, C.text, 1.4);
    lineOf(S.flip, C.violet, 1.9);

    // Ribbon between spot and its flip: green where spot is above the flip
    // (long-gamma side), red where it is below. Drawn as contiguous runs so the
    // colour is a property of the run, not of a gradient.
    (function signedRibbon() {
      var i = 0;
      while (i < S.min.length) {
        var f0 = S.flip[i];
        var sign = f0 === null ? 0 : Math.sign(S.spot[i] - f0);
        if (!sign) { i++; continue; }
        var j = i;
        while (j + 1 < S.min.length && S.flip[j + 1] !== null &&
               Math.sign(S.spot[j + 1] - S.flip[j + 1]) === sign) j++;
        if (j - i >= 1) {
          var top = [], bottom = [];
          for (var k = i; k <= j; k++) {
            var a = x(S.min[k]);
            var spotY = y(S.spot[k]), flipY = y(S.flip[k]);
            top.push(a + "," + (sign > 0 ? spotY : flipY));
            bottom.push(a + "," + (sign > 0 ? flipY : spotY));
          }
          g.append("path")
            .attr("d", "M" + top.join("L") + "L" + bottom.reverse().join("L") + "Z")
            .attr("fill", sign > 0 ? C.green : C.red).attr("fill-opacity", .22);
        }
        i = j + 1;
      }
    })();

    var gb = c.svg.append("g").attr("transform", "translate(" + m.l + "," + (m.t + topH + gap) + ")");
    var netLo = Math.min(0, d3.min(S.net_gex)), netHi = Math.max(0, d3.max(S.net_gex));
    var pad = (netHi - netLo) * 0.2 || 10;
    // The last expiry print can be orders of magnitude larger than the rest of
    // the session (gamma diverges at the pin), so a linear axis would flatten
    // every earlier move into the zero line. Only switch when it really does.
    var netAbs = S.net_gex.map(Math.abs).sort(d3.ascending);
    var netMedian = netAbs[Math.floor(netAbs.length / 2)] || 1;
    var yn = (netHi > 25 * netMedian ? d3.scaleSymlog() : d3.scaleLinear())
      .domain([netLo - pad, netHi + pad]).range([botH, 0]);
    drawYGrid(gb, yn, iw, yn.ticks(4));
    drawTimeAxis(gb, x, botH, true);

    gb.append("line").attr("x1", 0).attr("x2", iw).attr("y1", yn(0)).attr("y2", yn(0))
      .attr("stroke", C.muted).attr("stroke-opacity", .45);

    var area = d3.area()
      .x(function (i) { return x(S.min[i]); })
      .y0(yn(0))
      .y1(function (i) { return yn(S.net_gex[i]); });
    gb.append("path").attr("d", area(d3.range(S.net_gex.length)))
      .attr("fill", C.blue).attr("fill-opacity", .14).attr("stroke", "none");
    var netLine = d3.line().x(function (i) { return x(S.min[i]); }).y(function (i) { return yn(S.net_gex[i]); });
    gb.append("path").attr("d", netLine(d3.range(S.net_gex.length)))
      .attr("fill", "none").attr("stroke", C.blue).attr("stroke-width", 1.5);

    // The second GEX number: the report's regime gate sums only strikes at or
    // below spot. It stayed negative while the chain-wide total turned positive.
    var gatedLine = d3.line().x(function (i) { return x(S.min[i]); }).y(function (i) { return yn(S.regime_gex[i]); });
    gb.append("path").attr("d", gatedLine(d3.range(S.regime_gex.length)))
      .attr("fill", "none").attr("stroke", C.orange).attr("stroke-width", 1.5);

    var lastIdx = S.min.length - 1;
    [[S.net_gex[lastIdx], C.blue], [S.regime_gex[lastIdx], C.orange]].forEach(function (pair) {
      gb.append("text").attr("class", "pg-label").attr("x", iw - 2).attr("y", yn(pair[0]) - 6)
        .attr("text-anchor", "end").attr("fill", pair[1])
        .text(AX.end_label + " " + fsign(pair[0], 1));
    });

    var netFlip = D.stats.gex.net_flip;
    if (netFlip) {
      var nm = parseInt(netFlip.t.slice(0, 2), 10) * 60 + parseInt(netFlip.t.slice(3, 5), 10);
      var fi = nearestIndex(nm);
      [g, gb].forEach(function (gg) {
        gg.append("line").attr("x1", x(S.min[fi])).attr("x2", x(S.min[fi])).attr("y1", 0)
          .attr("y2", gg === g ? topH : botH)
          .attr("stroke", C.green).attr("stroke-dasharray", "2 3").attr("opacity", .8);
      });
      var flipLabel = "book turns net long " + netFlip.t;
      var flipAnchor = x(S.min[fi]) + 4 > iw - 118 ? "end" : "start";
      g.append("text").attr("class", "pg-anno")
        .attr("x", x(S.min[fi]) + (flipAnchor === "end" ? -4 : 4)).attr("y", 9)
        .attr("text-anchor", flipAnchor).text(flipLabel);
    }

    gb.append("text").attr("class", "pg-label").attr("x", 0).attr("y", -7)
      .text("net GEX, ₹ Cr/pt");

    function tooltipFor(value, evt) {
      var i = nearestIndex(value);
      var px = x(S.min[i]);
      return {
        px: px, py: y(S.spot[i]), title: S.t[i] + " IST",
        rows: [
          ["spot", f(S.spot[i])],
          ["gamma flip", S.flip[i] === null ? "no cross" : f(S.flip[i], 1)],
          ["net GEX", fsign(S.net_gex[i], 1)],
          ["cum GEX @ spot", fsign(S.regime_gex[i], 1)]
        ]
      };
    }
    hoverCapture(c, x, iw, ih, m, tooltipFor);
  }

  // ----------------------------------- chart 3: dealer gamma horizontal profile
  function drawProfiles() {
    if (!d3) return;
    D.profiles.forEach(function (p, idx) {
      var hostId = "pg-prof-" + idx;
      var H = 268;
      var c = makeSvg(hostId, H);
      if (!c) return;
      var m = { t: 26, r: 10, b: 22, l: 46 };
      var iw = c.w - m.l - m.r, ih = H - m.t - m.b;
      var maxAbs = Math.max(20, d3.max(p.net_gex.map(Math.abs)));
      var allValues = [].concat.apply([], D.profiles.map(function (q) { return q.net_gex; }));
      var maxAbsAll = Math.max(20, d3.max(allValues.map(Math.abs))) * 1.06;
      var sortedAbs = allValues.map(Math.abs).sort(d3.ascending);
      var medianAbs = sortedAbs[Math.floor(sortedAbs.length / 2)] || 1;
      var x = (maxAbsAll > 25 * medianAbs ? d3.scaleSymlog() : d3.scaleLinear())
        .domain([-maxAbsAll, maxAbsAll]).range([0, iw]);
      var allStrikes = p.strikes;
      var y = d3.scaleBand().domain(allStrikes).range([0, ih]).padding(0.22);
      var stepPts = (allStrikes[allStrikes.length - 1] - allStrikes[0]) / (allStrikes.length - 1);
      // spot and flip are not strikes, so a band scale cannot place them: map the
      // price onto the band axis by fractional index instead of y(price) -> undefined.
      var yStrike = function (strike) {
        var idx = (strike - allStrikes[0]) / stepPts;
        return y(allStrikes[0]) + idx * y.step() + y.bandwidth() / 2;
      };
      var g = c.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      c.svg.append("text").attr("x", m.l).attr("y", 14)
        .attr("fill", C.text).attr("font", "600 11px " + MONO).text(p.label);
      c.svg.append("text").attr("x", m.l + 46).attr("y", 14)
        .attr("fill", C.muted).attr("font", "10px " + MONO)
        .text("net " + fsign(p.net, 1) + " · spot " + f(p.spot, 0));

      g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", ih)
        .attr("stroke", C.border);

      g.selectAll(".pg-bar").data(p.net_gex).enter().append("rect")
        .attr("x", function (v) { return v >= 0 ? x(0) : x(v); })
        .attr("y", function (v, i) { return y(allStrikes[i]); })
        .attr("width", function (v) { return Math.max(1, Math.abs(x(v) - x(0))); })
        .attr("height", y.bandwidth())
        .attr("fill", function (v) { return v >= 0 ? C.green : C.red; })
        .attr("fill-opacity", function (v) { return 0.35 + 0.5 * Math.min(1, Math.abs(v) / maxAbs); });

      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", yStrike(p.spot)).attr("y2", yStrike(p.spot))
        .attr("stroke", C.text).attr("stroke-width", 1.2).attr("stroke-dasharray", "3 2");
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", yStrike(p.mp)).attr("y2", yStrike(p.mp))
        .attr("stroke", C.amber).attr("stroke-width", 1.2).attr("stroke-dasharray", "1 2");
      if (p.flip !== null) {
        g.append("circle").attr("cx", iw - 5).attr("cy", yStrike(p.flip)).attr("r", 2.4).attr("fill", C.violet);
      }

      var gy = g.append("g").attr("class", "pg-axis");
      allStrikes.forEach(function (s) {
        if (s % 100 !== 0) return;
        gy.append("text").attr("x", -7).attr("y", y(s) + y.bandwidth() / 2)
          .attr("dy", "0.32em").attr("text-anchor", "end").text(s.toLocaleString("en-IN"));
      });
      gy.append("text").attr("x", x(0)).attr("y", ih + 14).attr("text-anchor", "middle")
        .attr("class", "pg-label").text("₹ Cr / pt");
    });
  }

  // ------------------------------------- chart 4: wall migration + OI build-up
  function drawWalls() {
    var H = 360;
    var c = makeSvg("pg-walls", H);
    if (!c) return;
    var m = { t: 12, r: 12, b: 24, l: 50 };
    var iw = c.w - m.l - m.r, ih = H - m.t - m.b;
    var topH = Math.round(ih * 0.56), gap = 22, botH = ih - topH - gap;
    var x = d3.scaleLinear().domain([AX.lo, AX.hi]).range([0, iw]);

    var lo = Math.min(d3.min(S.spot), KEYS.pe) - 70, hi = Math.max(d3.max(S.spot), KEYS.ce) + 70;
    var y = d3.scaleLinear().domain([lo, hi]).range([topH, 0]).nice();
    var g = c.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    drawYGrid(g, y, iw, y.ticks(5));
    drawTimeAxis(g, x, topH, false);

    g.append("text").attr("class", "pg-label").attr("x", iw).attr("y", 10)
      .attr("text-anchor", "end").text("wall strike");

    var plot = g.append("g");

    function step(values, color, width) {
      var line = d3.line()
        .defined(function (i) { return values[i] >= lo && values[i] <= hi; })
        .x(function (i) { return x(S.min[i]); })
        .y(function (i) { return clampPx(y(values[i]), topH); })
        .curve(d3.curveStepAfter);
      plot.append("path").attr("d", line(d3.range(values.length)))
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", width);
    }
    step(S.call_wall, C.red, 2);
    step(S.put_wall, C.green, 2);
    step(S.spot, "#B8BDC6", 1.2);

    var gb = c.svg.append("g").attr("transform", "translate(" + m.l + "," + (m.t + topH + gap) + ")");
    var maxOi = Math.max(
      d3.max(S.ce_key_oi), d3.max(S.pe_alt_oi), d3.max(S.pe_key_oi)
    );
    var yn = d3.scaleLinear().domain([0, maxOi * 1.1]).range([botH, 0]);
    drawYGrid(gb, yn, iw, yn.ticks(4));
    drawTimeAxis(gb, x, botH, true);

    function oiLine(values, color, width, dash) {
      var line = d3.line()
        .defined(function (i) { return values[i] !== null && values[i] !== undefined; })
        .x(function (i) { return x(S.min[i]); })
        .y(function (i) { return yn(values[i]); });
      gb.append("path").attr("d", line(d3.range(values.length)))
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", width)
        .attr("stroke-dasharray", dash || null);
    }
    oiLine(S.pe_alt_oi, "#6E9C82", 1.5);
    oiLine(S.pe_key_oi, C.green, 1.8);
    oiLine(S.ce_key_oi, C.amber, 1.8);

    var last = D.stats.oi;
    var lastIdx = S.min.length - 1;
    gb.append("circle").attr("cx", x(S.min[lastIdx])).attr("cy", yn(S.ce_key_oi[lastIdx]))
      .attr("r", 2.6).attr("fill", C.amber);
    gb.append("text").attr("class", "pg-anno").attr("x", x(S.min[lastIdx]) - 4)
      .attr("y", yn(S.ce_key_oi[lastIdx]) - 7).attr("text-anchor", "end")
      .text(f(KEYS.ce, 0) + " CE " + f(last.ce_key_last, 1) + "M");

    hoverCapture(c, x, iw, ih, m, function (value, evt) {
      var i = nearestIndex(value);
      return {
        px: x(S.min[i]), py: y(S.spot[i]), title: S.t[i] + " IST",
        rows: [
          ["spot", f(S.spot[i])],
          ["call wall", f(S.call_wall[i], 0)],
          ["put wall", f(S.put_wall[i], 0)],
          [f(KEYS.pe_alt, 0) + " PE OI", f(S.pe_alt_oi[i], 1) + "M"],
          [f(KEYS.pe, 0) + " PE OI", f(S.pe_key_oi[i], 1) + "M"],
          [f(KEYS.ce, 0) + " CE OI", f(S.ce_key_oi[i], 1) + "M"]
        ]
      };
    });
  }

  // --------------------------------------------------- chart 5: 3D GEX surface
  var surfaceDrawn = false;
  var camState = { eye: { x: -1.35, y: -1.55, z: 1.35 }, center: { x: 0, y: 0, z: -0.06 }, up: { x: 0, y: 0, z: 1 } };

  function drawSurface() {
    var host = document.getElementById("pg-surface");
    if (!host) return;
    if (!Plotly) {
      host.innerHTML = '<div class="pg-err">Plotly is not available in this page session, so the time x strike x GEX surface cannot render. The 2D panels carry the same series.</div>';
      return;
    }
    host.style.height = (root.clientWidth < 720 ? 360 : 470) + "px";
    var SU = D.surface;
    var times = SU.minutes;
    var strikes = SU.strikes;
    var traces = [{
      type: "surface",
      x: times, y: strikes, z: SU.z,
      colorscale: [
        [0, "#8E2F3A"], [0.18, "#E5606A"], [0.42, "#3A2A2E"],
        [0.5, "#171B22"], [0.58, "#1E3B31"], [0.82, "#2FA36B"], [1, "#9FE3C0"]
      ],
      cmin: SU.scale.cmin, cmax: SU.scale.cmax, cmid: 0,
      showscale: true,
      colorbar: {
        title: { text: "₹ Cr/pt", side: "top", font: { size: 9, color: C.muted, family: MONO } },
        thickness: 8, len: 0.55, outlinewidth: 0,
        tickfont: { size: 8, color: C.muted, family: MONO }
      },
      hovertemplate: "strike %{y:.0f}<br>net GEX %{z:.1f} ₹ Cr/pt<br>minute offset %{x}<extra></extra>",
      contours: { z: { show: false } },
      lighting: { ambient: 0.72, diffuse: 0.62, specular: 0.08, roughness: 0.9 },
      name: "net GEX"
    }];

    function ridge(strike, color, label) {
      var row = D.ridges[String(strike)];
      return {
        type: "scatter3d", mode: "lines", x: times, y: times.map(function () { return strike; }), z: row,
        line: { color: color, width: 5 }, name: label,
        hovertemplate: label + "<br>net %{z:.1f}<extra></extra>"
      };
    }
    var RIDGE_COLORS = ["#FFD39B", "#BBD4FF"];
    (SU.ridge_meta || []).forEach(function (r, i) {
      traces.push(ridge(r.strike, RIDGE_COLORS[i % RIDGE_COLORS.length],
        f(r.strike, 0) + " · " + r.label));
    });

    traces.push({
      type: "scatter3d", mode: "lines",
      x: times, y: times.map(function (_, i) { return S.spot[nearestIndex(times[i])]; }),
      z: times.map(function () { return 0; }),
      line: { color: "#FFFFFF", width: 4 }, name: "spot path",
      hovertemplate: "spot %{y:.0f}<extra></extra>"
    });

    var layout = {
      paper_bgcolor: C.bg, plot_bgcolor: C.bg,
      margin: { l: 52, r: 28, t: 6, b: 0 },
      font: { family: MONO, color: C.muted, size: 10 },
      showlegend: false,
      scene: {
        bgcolor: C.bg,
        camera: camState,
        xaxis: sceneAxis("time (IST)", {
          tickvals: AX.ticks,
          ticktext: AX.ticks.map(function (t) { return AX.labels[String(t)]; })
        }),
        yaxis: sceneAxis("strike", { tickformat: ".0f", nticks: 5 }),
        zaxis: sceneAxis("", { nticks: 5, zeroline: true }),
        aspectmode: "manual",
        aspectratio: { x: 1.9, y: 1.35, z: 0.6 },
        dragmode: "orbit"
      },
      hovermode: "closest"
    };

    function sceneAxis(title, extra) {
      return Object.assign({
        title: { text: title, font: { size: 9.5, color: C.muted, family: MONO } },
        gridcolor: C.border, zerolinecolor: C.border,
        showbackground: true, backgroundcolor: "rgba(31,36,45,0.35)",
        tickfont: { size: 8.5, color: C.muted, family: MONO },
        showspikes: false
      }, extra || {});
    }

    var config = { responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ["toImage", "sendDataToCloud"] };
    if (surfaceDrawn) {
      Plotly.react(host, traces, layout, config);
    } else {
      Plotly.newPlot(host, traces, layout, config);
      surfaceDrawn = true;
      host.on("plotly_relayout", function (ev) {
        if (ev && ev["scene.camera"]) camState = ev["scene.camera"];
      });
    }
  }

  // ------------------------------------------------------------------ render
  function drawD3() {
    if (!d3) {
      ["pg-spotpin", "pg-pinscore", "pg-null", "pg-flip", "pg-walls", "pg-prof-0", "pg-prof-1", "pg-prof-2"].forEach(function (id) {
        mountError(id, "D3 v7 is not available — this chart cannot render.");
      });
      return;
    }
    try { drawSpotPin(); } catch (e) { mountError("pg-spotpin", "spot-vs-pin chart failed: " + e.message); }
    try { drawPinScore(); } catch (e) { mountError("pg-pinscore", "pin-score strip failed: " + e.message); }
    try { drawNull(); } catch (e) { mountError("pg-null", "null-model chart failed: " + e.message); }
    try { drawFlip(); } catch (e) { mountError("pg-flip", "gamma-flip chart failed: " + e.message); }
    try { drawProfiles(); } catch (e) { mountError("pg-prof-0", "gamma profile failed: " + e.message); }
    try { drawWalls(); } catch (e) { mountError("pg-walls", "wall-migration chart failed: " + e.message); }
  }

  function drawAll() {
    drawD3();
    try { drawSurface(); } catch (e) { mountError("pg-surface", "3D surface failed: " + e.message); }
  }

  drawAll();

  var raf = null;
  function onResize() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      raf = null;
      drawD3();
      if (surfaceDrawn && Plotly) {
        var h = (root.clientWidth < 720 ? 360 : 470);
        var host = document.getElementById("pg-surface");
        if (host && host.style.height !== h + "px") {
          host.style.height = h + "px";
          Plotly.relayout(host, { height: h });
        }
      }
    });
  }
  window.addEventListener("resize", onResize, { passive: true });
  if (window.ResizeObserver) {
    var lastW = root.clientWidth;
    var ro = new ResizeObserver(function () {
      if (Math.abs(root.clientWidth - lastW) < 8) return;
      lastW = root.clientWidth;
      onResize();
    });
    ro.observe(root);
  }
})();
"""


def build_html(payload: dict) -> str:
    st = payload["stats"]
    data_json = json.dumps(payload, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")
    bullets = build_bullets(st)
    kpis = build_kpis(st)
    meta = payload["meta"]
    cov = st["coverage"]
    labels = list(st["gex"]["at"].keys())
    l1, l2, l3 = labels
    keys = payload["keys"]
    profiles = payload["profiles"]
    last_profile = profiles[-1]
    per_last = dict(zip([int(s) for s in last_profile["strikes"]], last_profile["net_gex"]))
    hole = min(per_last.items(), key=lambda kv: kv[1])
    ridge = max(per_last.items(), key=lambda kv: kv[1])
    first_profile = profiles[0]
    per_first = dict(zip([int(s) for s in first_profile["strikes"]], first_profile["net_gex"]))
    hole_first = min(per_first.items(), key=lambda kv: kv[1])
    walls = st["walls"]
    put_flip = walls["put_flip"]
    if put_flip:
        put_flip_text = (
            f"The put wall stepped up {fmt(put_flip['from'], 0)} → {fmt(put_flip['to'], 0)} at "
            f"{put_flip['t']} because the {fmt(put_flip['to'], 0)} put OI overtook the "
            f"{fmt(put_flip['from'], 0)} line ({fmt(put_flip['oi_to'], 1)}M vs "
            f"{fmt(put_flip['oi_from'], 1)}M)."
        )
    else:
        put_flip_text = "The put wall did not step up after the afternoon split."
    wall_text = (
        f"The put wall moved {len(walls['put_moves'])} times and the call wall "
        f"{len(walls['call_moves'])} times; it ended at {fmt(payload['series']['put_wall'][-1], 0)} "
        f"and {fmt(payload['series']['call_wall'][-1], 0)}. {put_flip_text} The lower panel plots "
        f"three fixed strikes so a wall switch never looks like OI collapsing."
    )
    first_call_wall = payload["series"]["call_wall"][0]
    chart_hi = max(max(payload["series"]["spot"]), keys["ce"]) + 70
    if first_call_wall > chart_hi:
        wall_text += (
            f" The call wall opened at {fmt(first_call_wall, 0)}, above the top panel's scale; "
            f"the step line starts where it comes inside the band."
        )

    if cov["reaches_close"]:
        coverage_line = (
            f"{meta['snapshots']} report snapshots at ~1-minute cadence "
            f"({cov['first_clock'][:5]}–{cov['last_clock'][:5]} IST) — <b>the tape starts at "
            f"{cov['first_t']}, {fmt(cov['missing_open_min'], 0)} minutes after the 09:15 open, and runs "
            f"to {cov['to_close_sec']:.0f} s before the 15:30 close</b>. No opening print is claimed."
        )
        callout_tag = f"Verified to {l3} — the pin can be checked at the close"
        callout_body = (
            f"The recording reaches {cov['last_clock']}, so this page contains the close rather than "
            f"inferring it. The last snapshot printed spot <b>{fmt(st['spot']['last'])}</b> against max "
            f"pain <b>{fmt(st['max_pain']['last'], 0)}</b> — <b>{fmt(abs(st['max_pain']['final_dist']), 1)} pts "
            f"{'below' if st['max_pain']['final_dist'] < 0 else 'above'}</b> the pin. Max pain held "
            f"{fmt(st['max_pain']['modal_share'])}% of the session at {fmt(st['max_pain']['modal'], 0)} and "
            f"changed {st['max_pain']['changes']} times. The gap at the close is the fact; whether gamma "
            f"caused it is the question the null model tests."
        )
    elif st["post_clip"] is not None:
        post = st["post_clip"]
        end_h, end_m = (int(part) for part in cov["last_t"].split(":"))
        minutes_left = 15 * 60 + 30 - (end_h * 60 + end_m)
        coverage_line = (
            f"{meta['snapshots']} report snapshots at ~1-minute cadence "
            f"({cov['first_clock'][:5]}–{cov['last_clock'][:5]} IST, <b>clipped at {l3} — the last "
            f"{minutes_left} minutes of the session are not in this data</b>)."
        )
        callout_tag = f"Not verified past {l3}"
        callout_body = (
            f"The chain recording stops at {l3}, so nothing here shows what price did next — and the "
            f"futures print implies it did not stay. At {post['futures_last_t']} the futures contract "
            f"traded <b>{fmt(post['futures_last'])}</b>; minus the {l3} futures−spot basis "
            f"({fmt(post['basis_at_end'], 1, True)}) that implies spot ≈ "
            f"<b>{fmt(post['implied_spot_last'], 0)}</b> at the close — "
            f"<b>{fmt(abs(post['implied_gap_last']), 0)} pts from</b> the "
            f"{fmt(post['pin_at_end'], 0)} max pain printed at {l3}. The basis is held constant (a "
            f"different expiry's contract carried {fmt(post['basis_at_end'], 1, True)}), so this is an "
            f"estimate, not a tick."
        )
    else:
        coverage_line = (
            f"{meta['snapshots']} report snapshots at ~1-minute cadence "
            f"({cov['first_clock'][:5]}–{cov['last_clock'][:5]} IST). No later record exists, so the "
            f"last max pain is the last word."
        )
        callout_tag = f"Not verified past {l3}"
        callout_body = (
            f"The record ends at {l3}; no futures archive exists for this session, so there is no "
            f"post-record print and no implied close. Everything after the last snapshot is simply "
            f"unknown here rather than zero-filled."
        )

    gap_note = (
        f" Recording gap{'s' if len(cov['gaps']) > 1 else ''}: {cov['gap_text']}; the lines step "
        f"across {'them' if len(cov['gaps']) > 1 else 'it'} rather than invent minutes."
        if cov["gaps"]
        else ""
    )
    coverage_line += gap_note
    null_gap_note = (
        f" Recording gaps are carried as single price changes in the null rather than "
        f"interpolated ({cov['gap_text']}), which widens the null slightly."
        if cov["gaps"]
        else ""
    )

    futures_foot = (        f"<code>{meta['source']}</code> and <code>reports/nifty_{meta['session']}/data/futures_1m.json</code> "
        f"for the 11:45–12:00 window and the {cov['last_t']} basis print."
        if meta["futures_available"]
        else f"<code>{meta['source']}</code>. No futures archive exists for {meta['session']}, so the "
             f"basis and futures panels are omitted."
    )
    surfaces_note = (
        f"the largest short-gamma strike is {fmt(hole[0], 0)} at "
        f"{fmt(hole[1], 0, True)} ₹ Cr/pt and the largest long-gamma strike "
        f"{fmt(ridge[0], 0)} at {fmt(ridge[1], 1, True)}"
    )
    max_abs_z = max((abs(v) for row in payload["surface"]["z"] for v in row), default=0.0)
    cap = payload["surface"]["scale"]["cmax"]
    scale_note = (
        f" The colour scale is clipped at ±{fmt(cap, 0)} ₹ Cr/pt (the 99.5th percentile), so the "
        f"{fmt(hole[0], 0)} print saturates instead of washing out the rest of the session."
        if max_abs_z > cap * 1.5
        else ""
    )

    if cov["reaches_close"]:
        limits_text = "The record reaches the close, so the final gap is observed."
    elif st["post_clip"] is not None:
        post = st["post_clip"]
        limits_text = (
            f"The chain recording ends at {l3}; everything after it is inference. The "
            f"{post['futures_last_t']} futures print minus the basis implies spot ≈"
            f"{fmt(post['implied_spot_last'])}, {fmt(abs(post['implied_gap_last']))} pts from the last "
            f"max pain. The basis is held constant and the contract is a different expiry "
            f"({post['futures_expiry']}), so that implied spot is an estimate."
        )
    else:
        limits_text = (
            f"The record ends at {l3} and no later print exists, so nothing after it is claimed."
        )

    return f"""<section data-research-section="pin-gamma" id="research-pin-gamma">
<style>{CSS}</style>
<div class="pg-wrap">
  <div>
    <div class="pg-kicker">NIFTY · 0-DTE · expiry {meta['expiry']} · research</div>
    <h2 class="pg-h">Expiry-day pin: did spot find a strike, and did dealer gamma put it there?</h2>
    <p class="pg-lede">{coverage_line} Spot is the index level in each snapshot; max pain, walls and
      GEX are the report's own fields. GEX is <b>₹ crore of dealer delta per index point</b>
      (gamma × OI × spot ÷ 1e7) under the standard dealer-sign assumption — a signed exposure proxy, not a
      measured dealer book. <b>Two different GEX numbers appear below</b> and they are not the same
      statistic: the <i>chain-wide total</i> (every strike, the number the volatility page quotes) and the
      <i>cumulative GEX of strikes at or below spot</i> (the report's own regime gate). They can disagree in
      sign for most of the session, which is a finding, not an error.</p>
  </div>

  <div class="pg-banner" role="alert"></div>

  <div class="pg-callout">
    <div class="pg-callout-tag">{callout_tag}</div>
    <p>{callout_body}</p>
  </div>

  <div class="pg-kpis">
{kpis}
  </div>

  <div class="pg-bullets">
    <ol>
{bullets}
    </ol>
  </div>

  <div class="pg-panel">
    <div class="pg-ph">
      <h3>Time × strike × net GEX — where the dealer book was long and short</h3>
      <span class="pg-hint">Plotly surface · z = net GEX, ₹ Cr per point · drag to orbit, scroll to zoom</span>
    </div>
    <div class="pg-body" id="pg-surface"></div>
    <div class="pg-read">The surface is the whole dealer book: red is short gamma (moves accelerate),
      green is long gamma (moves dampen). On the last profile, {surfaces_note}. The white line is the spot
      path laid on the zero plane. Highlighted ridges: <b>{fmt(keys['ce'], 0)}</b> (modal call wall) and
      <b>{fmt(st['max_pain']['last'], 0)}</b> (last max pain).{scale_note}</div>  </div>

  <div class="pg-panel">
    <div class="pg-ph">
      <h3>Spot vs max pain, the walls and the pin band</h3>
      <span class="pg-hint">band = max pain ± {meta['pin_band_pts']:.0f} pts · step lines are the report's daily walls</span>
    </div>
    <div class="pg-body" id="pg-spotpin"></div>
    <div class="pg-body" id="pg-pinscore"></div>
    <div class="pg-legend">
      <span><i style="background:#E8E8E8"></i>spot</span>
      <span><i style="background:#D9902A"></i>max pain</span>
      <span><i style="background:#E5606A"></i>call wall (top OI)</span>
      <span><i style="background:#2FA36B"></i>put wall (top OI)</span>
      <span><i style="background:#D9902A;opacity:.35"></i>pin band ±25</span>
    </div>
    <div class="pg-read">The pin band is the amber ribbon; the strip underneath is the pin score
      (100 = spot exactly on max pain, 0 = 50 pts or more away), averaged in 5-minute buckets. The walls
      are step functions because they are recomputed from OI every minute — a vertical jump is a wall being
      overtaken by a neighbouring strike. At the close, spot was {fmt(abs(st['max_pain']['final_dist']), 1)}
      pts from max pain.</div>
  </div>

  <div class="pg-panel">
    <div class="pg-ph">
      <h3>Is the pin closer than chance? |spot − max pain| vs a same-volatility random walk</h3>
      <span class="pg-hint">{st['null']['paths']:,} bootstrap paths · seed {st['null']['seed']} · observed {pct_phrase(st['null']['mean_abs_gap']['percentile'])}</span>
    </div>
    <div class="pg-body" id="pg-null"></div>
    <div class="pg-legend">
      <span><i style="background:#D9902A"></i>observed |spot − max pain|</span>
      <span><i style="background:#8A8F98"></i>null median</span>
      <span><i style="background:#8A8F98;opacity:.35"></i>null p05–p95</span>
    </div>
    <div class="pg-read">A random walk built from this session's own 1-minute spot changes, replayed
      against the <i>recorded</i> max-pain path, is the baseline. Mean distance to the pin: observed
      <b>{fmt(st['null']['mean_abs_gap']['obs'])}</b> pts versus a null median of
      <b>{fmt(st['null']['mean_abs_gap']['p50'])}</b> (p05 {fmt(st['null']['mean_abs_gap']['p05'])}),
      {pct_phrase(st['null']['mean_abs_gap']['percentile'])}. The pin was itself built
      from OI that follows price, so this bounds the path; it does not prove attraction. The ±25 band:
      {fmt(st['null']['share_25']['obs'])}% of minutes versus a null median of
      {fmt(st['null']['share_25']['p50'])}% ({pct_phrase(st['null']['share_25']['percentile'])}).{null_gap_note}</div>
  </div>

  <div class="pg-panel">
    <div class="pg-ph">
      <h3>Gamma flip vs spot, and the two GEX definitions</h3>
      <span class="pg-hint">flip = nearest strike where the GEX profile turns positive · lower panel: chain-wide vs gated-at-spot</span>
    </div>
    <div class="pg-body" id="pg-flip"></div>
    <div class="pg-legend">
      <span><i style="background:#E8E8E8"></i>spot</span>
      <span><i style="background:#8E7CC3"></i>local gamma flip</span>
      <span><i style="background:#4A8FD8"></i>net GEX, all strikes</span>
      <span><i style="background:#E08A3C"></i>cumulative GEX, strikes ≤ spot</span>
    </div>
    <div class="pg-read">The violet line is the local gamma flip — the nearest strike where the
      GEX profile turns from negative to positive. The lower panel carries <b>both</b> definitions:
      the blue chain-wide total (every strike) and the orange gate the report's own regime uses (only
      strikes at or below spot). At {l3} they read {fmt(st['gex']['net_last'], 1, True)} and
      {fmt(st['gex']['regime']['at'][l3], 1, True)} respectively. The blue line
      {('crosses zero at ' + st['gex']['net_flip']['t']) if st['gex']['net_flip'] else 'does not cross zero after the split'};
      the gated line {('went positive in ' + fmt(st['gex']['regime']['long_share']) + '% of snapshots') if st['gex']['regime']['ever_long'] else 'never went positive'}.
      Read the two together or not at all — the volatility page quotes the blue one.</div>
  </div>

  <div class="pg-panel">
    <div class="pg-ph">
      <h3>Dealer gamma profile — {l1} / {l2} / {l3}</h3>
      <span class="pg-hint">same x-scale across panels · bars drawn from zero · symmetric-log when the last print dwarfs the session</span>
    </div>
    <div class="pg-body">
      <div class="pg-profgrid">
        <div id="pg-prof-0"></div>
        <div id="pg-prof-1"></div>
        <div id="pg-prof-2"></div>
      </div>
    </div>
    <div class="pg-read">Horizontal bars are net GEX per strike. The dashed white line is spot, the
      dotted amber line max pain. At {l1} the largest short-gamma strike was {fmt(hole_first[0], 0)}
      ({fmt(hole_first[1], 0)} ₹ Cr/pt); by {l3} it was {fmt(hole[0], 0)} ({fmt(hole[1], 0)}) and the
      largest long-gamma strike was {fmt(ridge[0], 0)} ({fmt(ridge[1], 0)}).</div>
  </div>

  <div class="pg-panel">
    <div class="pg-ph">
      <h3>Wall migration — strikes move, and the {fmt(keys['ce'], 0)} call wall is the reference</h3>
      <span class="pg-hint">top: wall strike + spot · bottom: open interest of each wall</span>
    </div>
    <div class="pg-body" id="pg-walls"></div>
    <div class="pg-legend">
      <span><i style="background:#E5606A"></i>top: call wall</span>
      <span><i style="background:#2FA36B"></i>top: put wall</span>
      <span><i style="background:#B8BDC6"></i>top: spot</span>
      <span><i style="background:#D9902A"></i>OI: {fmt(keys['ce'], 0)} CE</span>
      <span><i style="background:#2FA36B"></i>OI: {fmt(keys['pe'], 0)} PE</span>
      <span><i style="background:#6E9C82"></i>OI: {fmt(keys['pe_alt'], 0)} PE</span>
    </div>
    <div class="pg-read">{wall_text}</div>
  </div>

  <div class="pg-foot">
    <p><b>Limits.</b> {cov['first_clock'][:5]}–{cov['last_clock'][:5]} IST, {meta['snapshots']} snapshots.
      {limits_text} The tape starts at {cov['first_t']}, so the open is outside this sample. Where no
      futures archive exists the futures panels are omitted, never zero-filled.</p>
    <p><b>Dealer-sign assumption.</b> GEX units are the report's own (₹ Cr per point from
      gamma × OI × spot ÷ 1e7) and are <b>not</b> a dealer book: the sign assumes dealers are short
      customer calls and long customer puts. Flip it and every gamma claim here inverts. OI levels
      (the {fmt(keys['ce'], 0)} wall, the wall migration) do <b>not</b> depend on that assumption.</p>
    <p><b>Endogeneity.</b> Max pain and the walls are recomputed from OI each minute, and OI builds where
      price has been, so “spot sat near the pin” is partly the pin following spot — measured above at
      r = {fmt(st['reversion']['mp_on_gap']['corr'], 2)} for Δmax-pain on the gap versus
      r = {fmt(st['reversion']['spot_on_gap']['corr'], 2)} for Δspot. The random-walk null bounds how
      unusual the path was; it cannot separate attraction from the pin's own drift, and nothing here
      establishes that gamma caused the path.</p>
    <p>Sources: {futures_foot} Builder:
      <code>scripts/market/nifty_research_pin_gamma.py</code> ·
      data: <code>reports/nifty_{meta['session']}/research/pin_gamma.json</code>.</p>
  </div>
</div>
<script id="pg-data" type="application/json">{data_json}</script>
<div class="pg-tip" id="pg-tip"></div>
<script>{JS}</script>
</section>
"""


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Build the pin/gamma research fragment for one NIFTY expiry session."
    )
    parser.add_argument("--session", default=DEFAULT_SESSION, help="session date (YYYY-MM-DD)")
    parser.add_argument("--expiry", default=None, help="expiry date (defaults to --session)")
    parser.add_argument("--out-dir", type=Path, default=None,
                        help="output directory (defaults to reports/nifty_<session>/research)")
    parser.add_argument("--clip", default="auto",
                        help="HH:MM:SS cutoff, 'auto' (14:07:59 for the default session, none "
                             "otherwise) or 'none'")
    args = parser.parse_args(argv)
    clip = args.clip
    if isinstance(clip, str) and clip.lower() in {"none", "off", ""}:
        clip = None
    configure(args.session, args.expiry, args.out_dir, clip)

    payload = build_payload()
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=1, allow_nan=False))
    OUT_HTML.write_text(build_html(payload))
    st = payload["stats"]
    cov = st["coverage"]
    print(f"session       {payload['meta']['session']}  expiry {payload['meta']['expiry']}")
    print(f"snapshots     {st['clip']['snapshots']}  {cov['first_clock']} -> {cov['last_clock']}"
          f"  (clip {st['clip']['cutoff'] or 'none'})")
    print(f"coverage      {cov['covered_min']} min, {cov['to_close_sec']} s before the close")
    print(f"spot          {st['spot']['open']} -> {st['spot']['last']}  high {st['spot']['high']}  low {st['spot']['low']}")
    print(f"final dist    {st['max_pain']['final_dist']} to max pain {st['max_pain']['last']}")
    print(f"pin share 25  {st['pin']['share_25']}%   ±15 {st['pin']['share_15']}%")
    print(f"net GEX       {st['gex']['net_open']} -> {st['gex']['net_last']}")
    print(f"walls inside  {st['walls']['share_inside']}%  afternoon {st['walls']['share_inside_afternoon']}%")
    print(f"futures       {'available' if payload['meta']['futures_available'] else 'unavailable'}")
    def shown(path: Path) -> str:
        try:
            return str(path.relative_to(ROOT))
        except ValueError:
            return str(path)

    print(f"wrote         {shown(OUT_JSON)}  {OUT_JSON.stat().st_size / 1024:.0f} KB")
    print(f"wrote         {shown(OUT_HTML)}  {OUT_HTML.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
