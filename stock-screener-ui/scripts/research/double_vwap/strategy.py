#!/usr/bin/env python
"""Double-VWAP NQ study — NY session VWAP (trigger/bias) + overnight VWAP (magnet).

The chart under test (2026-11-19, MNQ 1m):
  1. range defined (overnight / opening range)
  2. FIRST break of the range  -> fade it (short at the failed breakout)
  3. bias = respect the range extreme, get short below NY VWAP
  4. SECOND entry on the NY-VWAP break, same direction
  5. target = OVERNIGHT VWAP while it is untouched since midnight

Honesty rules (borrowed from the repo's agent-AY engine):
  H0 entry at the OPEN of the bar after the signal bar (market, no resting limit)
  H1 no profit exit may fill on the entry-fill bar (the stop may)
  H2 a bar opening beyond the stop fills at the bar OPEN
  H3 stop checked before target inside a bar
  H4 one position per leg; legs simulated independently (per-trade R, not capital)
  H5 costs = full spread in points, subtracted from gross points

Usage:
  .venv/bin/python scripts/research/double_vwap/strategy.py --stage grid
"""
from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BARS = os.path.join(ROOT, "experiments", "data", "duka_cache", "usatechidxusd_1m.parquet")
OUTDIR = os.path.join(ROOT, "reports", "DOUBLE_VWAP")

TZ = "America/New_York"
RTH_OPEN, RTH_CLOSE = 9 * 60 + 30, 16 * 60
LAST_ENTRY = 15 * 60 + 30
EOD = 15 * 60 + 55


# --------------------------------------------------------------------------- #
# data
# --------------------------------------------------------------------------- #
def load():
    df = pd.read_parquet(BARS)
    df.index = df.index.tz_convert(TZ)
    df = df.sort_index()
    return df


@dataclass
class Day:
    date: object
    t: np.ndarray          # minutes-of-day, ET
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    vol: np.ndarray
    atr: np.ndarray
    ny_vwap: np.ndarray    # cumulative RTH VWAP (NaN outside RTH)
    on_vwap: float         # overnight VWAP level at 09:30 (constant all session)
    rth_start: int         # index of the first RTH bar
    rng: dict              # range source -> (hi, lo, end_index)


def _atr(h, l, c, n=14):
    pc = np.concatenate([[c[0]], c[:-1]])
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return pd.Series(tr).rolling(n, min_periods=3).mean().bfill().to_numpy()


def build_days(df, range_srcs=("on", "or15", "or30", "or60")):
    days = []
    for date, g in df.groupby(df.index.date):
        g = g[(g.index.dayofweek < 5)]
        if len(g) < 60:
            continue
        hm = (g.index.hour * 60 + g.index.minute).to_numpy()
        o, h, l, c = (g[k].to_numpy(float) for k in ("o", "h", "l", "c"))
        vol = g["vol"].to_numpy(float)
        typ = (h + l + c) / 3.0
        rth = (hm >= RTH_OPEN) & (hm < RTH_CLOSE)
        on = hm < RTH_OPEN
        if rth.sum() < 60 or on.sum() < 60:
            continue
        rs = np.flatnonzero(rth)
        if len(rs) < 60:
            continue
        # NY session VWAP from 09:30
        cum_v = np.cumsum(np.where(rth, vol, 0.0))
        cum_pv = np.cumsum(np.where(rth, typ * vol, 0.0))
        ny = np.full(len(g), np.nan)
        ny[rth] = cum_pv[rth] / np.maximum(cum_v[rth], 1e-12)
        # overnight VWAP: 00:00 -> 09:30, frozen at the open
        onv = vol[on].sum()
        on_vwap = float((typ[on] * vol[on]).sum() / onv) if onv > 0 else np.nan
        if not np.isfinite(on_vwap):
            continue
        atr = _atr(h, l, c)
        rng = {}
        for src in range_srcs:
            if src == "on":
                hh, ll = float(h[on].max()), float(l[on].min())
                rng[src] = (hh, ll, int(rs[0]))
            else:
                mins = int(src[2:])
                end_t = RTH_OPEN + mins
                m = rth & (hm < end_t)
                if m.sum() < 3:
                    rng[src] = (np.nan, np.nan, -1)
                else:
                    hh, ll = float(h[m].max()), float(l[m].min())
                    rng[src] = (hh, ll, int(np.flatnonzero(m)[-1]) + 1)
        days.append(Day(date=date, t=hm, o=o, h=h, l=l, c=c, vol=vol, atr=atr,
                        ny_vwap=ny, on_vwap=on_vwap, rth_start=int(rs[0]), rng=rng))
    return days


# --------------------------------------------------------------------------- #
# session features (causal, computed at signal close)
# --------------------------------------------------------------------------- #
def first_break(d: Day, src: str, eps: float):
    """(index, dir, hi, lo) of the first RTH close outside the range, else None."""
    hi, lo, start = d.rng[src]
    if not np.isfinite(hi) or start < 0:
        return None
    for i in range(start, len(d.c)):
        if d.t[i] >= RTH_CLOSE:
            break
        if d.c[i] > hi + eps:
            return i, 1, hi, lo
        if d.c[i] < lo - eps:
            return i, -1, hi, lo
    return None


def on_touched(d: Day, upto: int, tol: float) -> bool:
    """Did RTH price trade through the overnight VWAP level before `upto`?"""
    s = d.rth_start
    if upto <= s:
        return False
    return bool(np.any((d.l[s:upto] <= d.on_vwap + tol) & (d.h[s:upto] >= d.on_vwap - tol)))


def swing_extreme(d: Day, i: int, side: int, look: int = 20) -> float:
    j = max(0, i - look + 1)
    return float(d.h[j:i + 1].max()) if side < 0 else float(d.l[j:i + 1].min())


# --------------------------------------------------------------------------- #
# signal construction
# --------------------------------------------------------------------------- #
def dir_ok(cfg, dr, hi, lo, on_vwap):
    mode = cfg.get("dir_filter", "none")
    if mode == "none":
        return True
    # A break that stretches AWAY from the overnight VWAP is the setup in the chart:
    # the untouched overnight level sits behind the breakout and pulls price back to it.
    away = (dr > 0 and hi > on_vwap) or (dr < 0 and lo < on_vwap)
    return away if mode == "away_on" else (not away)


def resolve_target(mode, d, side, entry, risk, hi, lo, touched_pre, ny_level, cfg):
    if mode == "mid":
        return (hi + lo) / 2.0
    if mode == "opp":
        return lo if side < 0 else hi
    if mode == "onvwap":
        if touched_pre and not cfg.get("allow_touched"):
            return None
        return d.on_vwap
    if mode == "onvwap_rr":
        if cfg.get("allow_touched") or not touched_pre:
            return d.on_vwap
        return entry + side * cfg["fb_rr"] * risk
    if mode == "ny":
        return ny_level
    if mode.startswith("rr"):
        return entry + side * float(mode[2:]) * risk
    raise ValueError(mode)


def _valid(side, entry, stop, target):
    if (side > 0 and (stop >= entry or target <= entry)):
        return False
    if (side < 0 and (stop <= entry or target >= entry)):
        return False
    return True


def leg_a_signal(d: Day, brk, cfg):
    i, dr, hi, lo = brk
    j = i + 1
    if j >= len(d.c) or d.t[j] >= LAST_ENTRY:
        return None
    if not dir_ok(cfg, dr, hi, lo, d.on_vwap):
        return None
    if cfg.get("sess_end") and d.t[j] >= cfg["sess_end"]:
        return None
    touched_pre = on_touched(d, i + 1, cfg["touch_tol"])
    if cfg.get("require_untouched") and touched_pre:
        return None
    side = -dr
    entry = d.o[j]
    # the chart's first short sat ABOVE the NY VWAP (a premium fade)
    if cfg.get("a_side_filter") == "stretched":
        if side < 0 and entry <= d.ny_vwap[i]:
            return None
        if side > 0 and entry >= d.ny_vwap[i]:
            return None
    if cfg["stop_src"] == "range":
        stop = hi + cfg["stop_buf"] if side < 0 else lo - cfg["stop_buf"]
    elif cfg["stop_src"] == "sigext":
        stop = d.h[i] + cfg["stop_buf"] if side < 0 else d.l[i] - cfg["stop_buf"]
    else:  # atr
        stop = entry + cfg["stop_atr"] * d.atr[i] if side < 0 else entry - cfg["stop_atr"] * d.atr[i]
    risk = (entry - stop) if side > 0 else (stop - entry)
    if risk <= 0:
        return None
    target = resolve_target(cfg["target_a"], d, side, entry, risk, hi, lo,
                            touched_pre, d.ny_vwap[i], cfg)
    if target is None or not _valid(side, entry, stop, target):
        return None
    return dict(day=d, idx=j, side=side, entry=entry, stop=stop, target=target,
                kind="A", break_dir=dr, on_untouched=not touched_pre)


def leg_b_signal(d: Day, brk, cfg):
    i, dr, hi, lo = brk
    if not dir_ok(cfg, dr, hi, lo, d.on_vwap):
        return None
    side = -dr
    touched_break = on_touched(d, i + 1, cfg["touch_tol"])
    if cfg.get("require_untouched") and touched_break:
        return None
    tgt_mode = cfg["target_b"]
    if tgt_mode == "onvwap" and cfg.get("require_untouched") and touched_break:
        return None
    touched_all = on_touched(d, len(d.c), cfg["touch_tol"])
    for j in range(i + 1, len(d.c)):
        if d.t[j] >= LAST_ENTRY:
            break
        if cfg.get("sess_end") and d.t[j] >= cfg["sess_end"]:
            break
        crossed = (dr > 0 and d.c[j] < d.ny_vwap[j]) or (dr < 0 and d.c[j] > d.ny_vwap[j])
        if not crossed:
            continue
        k = j + 1
        if k >= len(d.c) or d.t[k] >= LAST_ENTRY:
            return None
        entry = d.o[k]
        if cfg["stop_src"] == "range":
            stop = hi + cfg["stop_buf"] if side < 0 else lo - cfg["stop_buf"]
        elif cfg["stop_src"] == "swing":
            stop = swing_extreme(d, j, side) + cfg["stop_buf"] if side < 0 \
                else swing_extreme(d, j, side) - cfg["stop_buf"]
        else:  # atr
            stop = entry + cfg["stop_atr"] * d.atr[j] if side < 0 else entry - cfg["stop_atr"] * d.atr[j]
        risk = (entry - stop) if side > 0 else (stop - entry)
        if risk <= 0:
            return None
        touched_pre = on_touched(d, k, cfg["touch_tol"])
        target = resolve_target(tgt_mode, d, side, entry, risk, hi, lo,
                                touched_pre, d.ny_vwap[j], cfg)
        if target is None or not _valid(side, entry, stop, target):
            return None
        return dict(day=d, idx=k, side=side, entry=entry, stop=stop, target=target,
                    kind="B", break_dir=dr, on_vwap=d.on_vwap,
                    on_untouched=not touched_pre, touched_all=touched_all)
    return None

# --------------------------------------------------------------------------- #
# honest simulator
# --------------------------------------------------------------------------- #
def simulate(sig, cost_pts):
    d = sig["day"]
    side, stop, target = sig["side"], sig["stop"], sig["target"]
    entry_idx = sig["idx"]
    if entry_idx >= len(d.c):
        return None
    entry = d.o[entry_idx]
    # the signal was built on the previous close: reject a gap that invalidates it
    if (side > 0 and entry <= stop) or (side < 0 and entry >= stop):
        return None
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    exit_px, exit_kind, bars = None, None, 0
    for j in range(entry_idx, len(d.c)):
        bars = j - entry_idx
        # H2: gap through the stop fills at the open
        if side > 0 and d.o[j] <= stop:
            exit_px, exit_kind = d.o[j], "stop_gap"
            break
        if side < 0 and d.o[j] >= stop:
            exit_px, exit_kind = d.o[j], "stop_gap"
            break
        if j > entry_idx:  # H1: no profit exit on the fill bar
            if side > 0:
                if d.l[j] <= stop:
                    exit_px, exit_kind = stop, "stop"
                    break
                if d.h[j] >= target:
                    exit_px, exit_kind = target, "target"
                    break
            else:
                if d.h[j] >= stop:
                    exit_px, exit_kind = stop, "stop"
                    break
                if d.l[j] <= target:
                    exit_px, exit_kind = target, "target"
                    break
        else:
            # H1 charge: stop may fill on the entry bar
            if side > 0 and d.l[j] <= stop:
                exit_px, exit_kind = stop, "stop"
                break
            if side < 0 and d.h[j] >= stop:
                exit_px, exit_kind = stop, "stop"
                break
        if d.t[j] >= EOD:
            exit_px, exit_kind = d.c[j], "time"
            break
    if exit_px is None:
        exit_px, exit_kind = d.c[-1], "time"
    gross = (exit_px - entry) * side
    net = gross - cost_pts
    return dict(date=d.date, kind=sig["kind"], side=side, R=net / risk,
                pts=net, risk=risk, exit=exit_kind, bars=bars,
                mfe=None, on_untouched=sig.get("on_untouched"),
                entry_t=d.t[entry_idx])


# --------------------------------------------------------------------------- #
# config + evaluation
# --------------------------------------------------------------------------- #
def base_cfg(**kw):
    cfg = dict(range_src="on", legs="AB", stop_src="range", stop_buf=10.0,
               stop_atr=1.0, target_a="mid", target_b="onvwap", fb_rr=2.0,
               touch_tol=2.0, allow_touched=False, sess_end=None, eps=0.25,
               dir_filter="none", require_untouched=False, a_side_filter="none")
    cfg.update(kw)
    return cfg


def collect(days, cfg, cost_pts):
    trades = []
    for d in days:
        brk = first_break(d, cfg["range_src"], cfg["eps"])
        if brk is None:
            continue
        sigs = []
        if "A" in cfg["legs"]:
            s = leg_a_signal(d, brk, cfg)
            if s:
                sigs.append(s)
        if "B" in cfg["legs"]:
            s = leg_b_signal(d, brk, cfg)
            if s:
                sigs.append(s)
        for s in sigs:
            tr = simulate(s, cost_pts)
            if tr:
                trades.append(tr)
    return trades


def stats(trades, n_days):
    if not trades:
        return dict(n=0, avgR=0.0, win=0.0, PF=0.0, t=0.0, Rm=0.0, tpd=0.0)
    R = np.array([t["R"] for t in trades], float)
    dates = [t["date"] for t in trades]
    wins, losses = R[R > 0], R[R <= 0]
    pf = float(wins.sum() / -losses.sum()) if losses.sum() < 0 else 99.0
    t = float(R.mean() / (R.std(ddof=1) / np.sqrt(len(R)) + 1e-12)) if len(R) > 2 else 0.0
    s = pd.Series(R, index=pd.Index(dates)).groupby(level=0).sum()
    return dict(n=int(len(R)), avgR=round(float(R.mean()), 4),
                win=round(100 * float((R > 0).mean()), 1), PF=round(pf, 2),
                t=round(t, 2), Rm=round(float(R.sum()) * 21.0 / max(n_days, 1), 2),
                tpd=round(len(R) / max(n_days, 1), 3))


def split_stats(trades, n_days):
    return stats(trades, n_days)


def run_grid(days, costs=(1.0,), log=print):
    configs = []
    targets_a = ["mid", "opp", "onvwap", "onvwap_rr", "rr1.0", "rr1.5", "rr2.0", "rr3.0"]
    targets_b = ["onvwap", "onvwap_rr", "rr1.5", "rr2.0", "rr3.0"]
    dirs = ("none", "away_on")
    for rs in ("on", "or15", "or30", "or60"):
        for dirlt in dirs:
            for stop_src in ("range", "sigext", "atr"):
                for buf in (5.0, 10.0, 20.0):
                    if stop_src == "atr" and buf != 10.0:
                        continue
                    for tg in targets_a:
                        for leg in ("A", "AB"):
                            for unt in (False, True):
                                configs.append(base_cfg(
                                    range_src=rs, legs=leg, stop_src=stop_src,
                                    stop_buf=buf, target_a=tg, dir_filter=dirlt,
                                    require_untouched=unt))
            for stop_src in ("range", "swing", "atr"):
                for buf in (5.0, 10.0, 20.0):
                    if stop_src == "atr" and buf != 10.0:
                        continue
                    for tg in targets_b:
                        for allow in (False, True):
                            for leg in ("B", "AB"):
                                configs.append(base_cfg(
                                    range_src=rs, legs=leg, stop_src=stop_src,
                                    stop_buf=buf, target_b=tg, allow_touched=allow,
                                    dir_filter=dirlt))
    # dedupe
    seen, uniq = set(), []
    for c in configs:
        k = json.dumps(c, sort_keys=True, default=str)
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    log(f"grid: {len(uniq)} configs")

    dates = sorted({d.date for d in days})
    cut = dates[int(len(dates) * 0.6)]
    is_days = [d for d in days if d.date < cut]
    oos_days = [d for d in days if d.date >= cut]
    log(f"IS {dates[0]} -> {cut}  ({len(is_days)} days) | OOS {cut} -> {dates[-1]} ({len(oos_days)})")

    rows = []
    t0 = time.time()
    for n, cfg in enumerate(uniq, 1):
        cost = costs[0]
        tr = collect(days, cfg, cost)
        tr_is = [t for t in tr if t["date"] < cut]
        tr_oos = [t for t in tr if t["date"] >= cut]
        s_is, s_oos = stats(tr_is, len(is_days)), stats(tr_oos, len(oos_days))
        a = [t for t in tr if t["kind"] == "A"]
        b = [t for t in tr if t["kind"] == "B"]
        rows.append(dict(cfg=cfg, all=stats(tr, len(days)), IS=s_is, OOS=s_oos,
                         A=stats(a, len(days)), B=stats(b, len(days)),
                         pooled_t=stats(tr, len(days))["t"]))
        if n % 100 == 0:
            log(f"  {n}/{len(uniq)}  {time.time() - t0:.0f}s")
    return rows, cut


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="grid")
    ap.add_argument("--cost", type=float, default=1.1)
    args = ap.parse_args()
    os.makedirs(OUTDIR, exist_ok=True)

    df = load()
    days = build_days(df)
    print(f"bars={len(df):,}  sessions={len(days)}  "
          f"{df.index.min().date()} -> {df.index.max().date()}")
    rows, cut = run_grid(days, costs=(args.cost,))
    with open(os.path.join(OUTDIR, "grid.json"), "w") as fh:
        json.dump(rows, fh, indent=1, default=str)
    # rank: both halves positive, then pooled t
    ok = [r for r in rows if r["IS"]["avgR"] > 0 and r["OOS"]["avgR"] > 0 and r["all"]["n"] >= 30]
    ok.sort(key=lambda r: (min(r["IS"]["avgR"], r["OOS"]["avgR"]), r["all"]["t"]), reverse=True)
    print(f"\n{len(ok)}/{len(rows)} configs positive in BOTH halves (n>=30)")
    for r in ok[:25]:
        c = r["cfg"]
        print(f"  {c['range_src']:5s} {c['legs']:2s} stop={c['stop_src']:6s}/{c['stop_buf']:>4.0f} "
              f"A={c['target_a']:9s} B={c['target_b']:9s} dir={c['dir_filter']:7s} "
              f"unt={int(c['require_untouched'])} touch={int(c['allow_touched'])} | "
              f"n={r['all']['n']:3d} avgR={r['all']['avgR']:+.3f} t={r['all']['t']:5.2f} "
              f"win={r['all']['win']:4.1f} PF={r['all']['PF']:4.2f} "
              f"IS={r['IS']['avgR']:+.3f} OOS={r['OOS']['avgR']:+.3f} "
              f"A={r['A']['avgR']:+.3f}({r['A']['n']}) B={r['B']['avgR']:+.3f}({r['B']['n']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
