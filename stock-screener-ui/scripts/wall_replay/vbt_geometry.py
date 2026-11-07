#!/usr/bin/env python3
"""Geometry-only wall test, vectorised with vectorbt.

Rule: at 09:30 fix the day's call wall (top call OI) and put wall (top put OI).
  - CE signal: spot comes within `prox` x ATR of the PUT wall (support) -> buy CE
  - PE signal: spot comes within `prox` x ATR of the CALL wall (resistance) -> buy PE
No OI-rising, no rejection, no max-pain, no hour filter. This is the "geometry
only" version the verifier's placebo pointed at.

Execution: the fixed wall-strike premium series for the day. Stops/targets/trail
are vectorbt's; costs are applied post-hoc with the repo's exact model.

Run:
    .venv/bin/python scripts/wall_replay/vbt_geometry.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import vectorbt as vbt

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
sys.path.insert(0, str(ROOT))
import batch  # noqa: E402
import hist_batch as hb  # noqa: E402
from options_paper import costs  # noqa: E402

HIST = ROOT / "experiments" / "data" / "nifty_hist"
LOT = 65
_DATES = None


def dates() -> list[str]:
    global _DATES
    if _DATES is None:
        all_d = sorted(p.stem for p in HIST.glob("*.jsonl")
                       if not p.stem.startswith("_") and ".gaps" not in p.stem)
        batch.TAPE = HIST
        batch._CACHE.clear()
        batch.DATES = all_d
        _DATES = [d for d in all_d if hb.chain_complete(d)]
    return _DATES


def px(r, strike, opt):
    leg = (r.get("chain") or {}).get(str(int(strike)))
    return float(leg[0] if opt == "CE" else leg[1]) if leg and len(leg) >= 2 else 0.0


def atr_series(closes, n=14):
    s = pd.Series(closes)
    return (s.diff().abs().rolling(n).mean()).bfill().fillna(0.0).to_numpy()


def session_frame(date: str):
    rs = batch.rows(date)
    if len(rs) < 340:
        return None
    spot = np.array([float(r["spot"]) for r in rs])
    # walls fixed at 09:30
    r0 = next((r for r in rs if r["t"][11:16] >= "09:30"), rs[0])
    calls = (r0.get("walls") or {}).get("calls") or []
    puts = (r0.get("walls") or {}).get("puts") or []
    if not calls or not puts:
        return None
    cw = float(calls[0]["strike"])
    pw = float(puts[0]["strike"])
    ce = np.array([px(r, pw, "CE") for r in rs])   # CE at the put wall (support)
    pe = np.array([px(r, cw, "PE") for r in rs])   # PE at the call wall (resistance)
    a = atr_series(spot)
    idx = pd.to_datetime([r["t"] for r in rs], utc=True)
    df = pd.DataFrame({"spot": spot, "ce": ce, "pe": pe, "atr": a,
                       "pw": pw, "cw": cw}, index=idx)
    df["ce_sig"] = ((spot - pw >= 0) & (spot - pw <= 1.5 * a)).astype(int)
    df["pe_sig"] = ((cw - spot >= 0) & (cw - spot <= 1.5 * a)).astype(int)
    df["eod"] = (df.index.strftime("%H:%M") >= "15:00").astype(int)
    return df


def run_side(df, side, stop, target, trail, fee=0.0146):
    price = df["ce"] if side == "CE" else df["pe"]
    price = price.replace(0, np.nan).ffill().bfill()
    sig = (df["ce_sig"] if side == "CE" else df["pe_sig"]).astype(bool) & price.notna()
    if price.isna().all() or (price <= 0).all() or sig.sum() == 0:
        return []
    pf = vbt.Portfolio.from_signals(
        close=price, entries=sig.astype(bool), exits=df["eod"].astype(bool),
        sl_stop=stop, tp_stop=(target if target else np.nan),
        sl_trail=bool(trail), fees=0.0, freq="1min",
        init_cash=100000, size=LOT, size_type="amount", accumulate=False,
    )
    rec = pf.trades.records_readable
    if rec is None or rec.empty:
        return []
    out = []
    for _, t in rec.iterrows():
        e, x = float(t["Avg Entry Price"]), float(t["Avg Exit Price"])
        c = costs.option_round_trip_cost(e, x, LOT)
        out.append({"side": side, "entry": e, "exit": x, "net": c["net_pnl"],
                    "gross": c["gross_pnl"], "costs": c["costs"],
                    "entry_time": str(t["Entry Timestamp"]), "exit_time": str(t["Exit Timestamp"])})
    return out


def main():
    ds = dates()
    train = [d for d in ds if d < "2025-11-01"]
    test = [d for d in ds if d >= "2025-11-01"]
    frames = {d: session_frame(d) for d in ds}
    print(f"sessions {len(ds)} (train {len(train)} / test {len(test)})", flush=True)

    configs = []
    for prox in (1.25, 1.5):
        for stop in (0.15, 0.20):
            for target in (0.0, 0.25):
                for trail in (0.0, 0.15):
                    configs.append((prox, stop, target, trail))

    rows = []
    for prox, stop, target, trail in configs:
        # rebuild signals for the prox (cheap: recompute the two columns)
        tr_all = []
        for d in ds:
            df = frames.get(d)
            if df is None:
                continue
            spot = df["spot"].to_numpy(); a = df["atr"].to_numpy()
            df["ce_sig"] = ((spot - df["pw"].iloc[0] >= 0) &
                            (spot - df["pw"].iloc[0] <= prox * a)).astype(int)
            df["pe_sig"] = ((df["cw"].iloc[0] - spot >= 0) &
                            (df["cw"].iloc[0] - spot <= prox * a)).astype(int)
            tr_all += run_side(df, "CE", stop, target, trail)
            tr_all += run_side(df, "PE", stop, target, trail)
        if not tr_all:
            continue
        def st(x):
            n = len(x); net = sum(t["net"] for t in x)
            gw = sum(t["net"] for t in x if t["net"] > 0)
            gl = -sum(t["net"] for t in x if t["net"] < 0)
            eq = peak = dd = 0.0
            for t in sorted(x, key=lambda z: z["exit_time"]):
                eq += t["net"]; peak = max(peak, eq); dd = min(dd, eq - peak)
            return n, net, (gw / gl if gl else 0), dd
        a = st([t for t in tr_all if t["entry_time"][:10] < "2025-11-01"])
        b = st([t for t in tr_all if t["entry_time"][:10] >= "2025-11-01"])
        rows.append((prox, stop, target, trail, a, b))
        print(f"prox={prox} stop={stop} tgt={target} trail={trail} | "
              f"TR n={a[0]:3d} PF={a[2]:5.2f} net={a[1]:+8.0f} | "
              f"TE n={b[0]:3d} PF={b[2]:5.2f} net={b[1]:+8.0f} DD={b[3]:+7.0f}", flush=True)

    if rows:
        best = max(rows, key=lambda r: r[5][1] if r[4][2] >= 1.3 else -1e9)
        print(f"\nBEST (train-gated): prox={best[0]} stop={best[1]} tgt={best[2]} trail={best[3]} "
              f"-> test n={best[5][0]} PF={best[5][2]:.2f} net={best[5][1]:+.0f}")


if __name__ == "__main__":
    main()
