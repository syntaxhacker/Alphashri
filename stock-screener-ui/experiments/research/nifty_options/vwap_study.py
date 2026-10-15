"""Why did VWAP 'not work'? Test several distinct VWAP formulations causally.

A) reclaim   - fade a pierce, buy the cross back through VWAP      (the one tested)
B) bounce    - trend continuation: pullback to VWAP holds, buy with trend
C) break_hold- momentum: cross VWAP and hold N bars
D) filter_orbit - ORB, but only in the VWAP direction
E) reclaim_trend - reclaim only when it aligns with prior-day trend

Also decomposes gross edge vs cost/spread drag, and splits by regime.
"""
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd
import runner as R
import stats as st
from engine import EngineConfig, SyntheticOptionSource, replay, Leg, Signal
from strategies import orb_breakout
from costs import ExecutionModel

spot = R.load_spot("5")
source = SyntheticOptionSource.from_cached()
resolver = R.build_weekly_resolver(date(2018, 1, 1), date(2026, 9, 25))
meta = R.load_daily_meta()
cfg = EngineConfig(capital=300_000, risk_pct=0.01, stop_pct=0.35, target_pct=0.60,
                   execution=ExecutionModel(), lot=65)
S, E = date(2018, 1, 1), date(2026, 9, 25)


def _rw(ctx, i, lookback):
    return any(ctx.vwap(k) > ctx._closes[k] for k in range(max(0, i - lookback), i)), \
        any(ctx.vwap(k) < ctx._closes[k] for k in range(max(0, i - lookback), i))


# ---- A) reclaim (fade) ----------------------------------------------------
def vwap_reclaim(ctx, i):
    if ctx.to_close_min(i) < 30 or not (30 <= ctx.minutes(i) <= 300):
        return None
    was_below, was_above = _rw(ctx, i, 6)
    v = ctx.vwap(i); c = ctx._closes[i]
    if was_below and c > v * 1.0008:
        return Signal([Leg("CE", "BUY", 0)], "vwap reclaim", "reclaim_ce", 0.35, 0.60, 90)
    if was_above and c < v * 0.9992:
        return Signal([Leg("PE", "BUY", 0)], "vwap reject", "reclaim_pe", 0.35, 0.60, 90)
    return None


# ---- B) bounce (trend continuation) --------------------------------------
def vwap_bounce(ctx, i):
    if ctx.to_close_min(i) < 30 or not (30 <= ctx.minutes(i) <= 300) or i < 10:
        return None
    v = ctx.vwap(i); c = ctx._closes[i]
    v_prev = ctx.vwap(i - 4)
    up = v > v_prev and c > v
    dn = v < v_prev and c < v
    touched = min(ctx._lows[i], ctx._lows[i - 1]) <= v * 1.0015
    if up and touched and c > v * 1.0005 and c > ctx._opens[i]:
        return Signal([Leg("CE", "BUY", 0)], "vwap bounce long", "bounce_ce", 0.35, 0.60, 120)
    touched_top = max(ctx._highs[i], ctx._highs[i - 1]) >= v * 0.9985
    if dn and touched_top and c < v * 0.9995 and c < ctx._opens[i]:
        return Signal([Leg("PE", "BUY", 0)], "vwap bounce short", "bounce_pe", 0.35, 0.60, 120)
    return None


# ---- C) break & hold ------------------------------------------------------
def vwap_break_hold(ctx, i, hold=3):
    if ctx.to_close_min(i) < 30 or not (30 <= ctx.minutes(i) <= 300) or i < hold + 1:
        return None
    v = ctx.vwap(i)
    above = all(ctx._closes[k] > ctx.vwap(k) for k in range(i - hold + 1, i + 1))
    below = all(ctx._closes[k] < ctx.vwap(k) for k in range(i - hold + 1, i + 1))
    prior_below = ctx._closes[i - hold - 1] < ctx.vwap(i - hold - 1)
    prior_above = ctx._closes[i - hold - 1] > ctx.vwap(i - hold - 1)
    if above and prior_below:
        return Signal([Leg("CE", "BUY", 0)], "vwap break-hold up", "breakhold_ce", 0.35, 0.60, 120)
    if below and prior_above:
        return Signal([Leg("PE", "BUY", 0)], "vwap break-hold dn", "breakhold_pe", 0.35, 0.60, 120)
    return None


# ---- D) ORB filtered by VWAP direction -----------------------------------
def orb_vwap_filter(ctx, i):
    sig = orb_breakout(ctx, i, or_min=15, buffer=0.0015, stop_pct=0.30, target_pct=0.50)
    if sig is None:
        return None
    v = ctx.vwap(i)
    c = ctx._closes[i]
    if sig.tag == "orb_long" and c < v:      # breakout up but below VWAP -> skip
        return None
    if sig.tag == "orb_short" and c > v:     # breakdown but above VWAP -> skip
        return None
    sig.tag = "orb_vwap_" + sig.tag
    return sig


# ---- E) reclaim aligned with prior-day trend ------------------------------
def vwap_reclaim_trend(ctx, i):
    sig = vwap_reclaim(ctx, i)
    if sig is None:
        return None
    up_trend = bool(getattr(ctx, "prev_high", 0) and ctx._closes[0] > getattr(ctx, "prev_close", 0))
    if sig.tag == "reclaim_ce" and not up_trend:
        return None
    if sig.tag == "reclaim_pe" and up_trend:
        return None
    return sig


VARIANTS = {
    "A_reclaim(fade)": vwap_reclaim,
    "B_bounce(cont)": vwap_bounce,
    "C_break_hold": vwap_break_hold,
    "D_orb_x_vwap": orb_vwap_filter,
    "E_reclaim+trend": vwap_reclaim_trend,
}

rows = []
for name, fn in VARIANTS.items():
    trades = replay(lambda c, i, fn=fn: fn(c, i), spot, source, resolver, cfg, S, E, day_meta=meta)
    net = np.array([t.net_pnl for t in trades])
    gross = np.array([t.gross_pnl for t in trades])
    fees = np.array([t.fees for t in trades])
    s = st.summarize(net) if len(net) else {"n": 0}
    b = st.bootstrap(net) if len(net) else {}
    rows.append({
        "variant": name, "n": len(net),
        "gross_exp": float(gross.mean()) if len(gross) else 0,
        "fee_exp": float(fees.mean()) if len(fees) else 0,
        "net_exp": float(net.mean()) if len(net) else 0,
        "PF": s.get("profit_factor", float("nan")),
        "win%": s.get("win_rate", 0) * 100,
        "avg_win": s.get("avg_win", 0), "avg_loss": s.get("avg_loss", 0),
        "net_sum": float(net.sum()) if len(net) else 0,
        "CI_low": b.get("ci_low_mean", float("nan")), "CI_high": b.get("ci_high_mean", float("nan")),
        "MFE_avg": float(np.mean([t.mfe for t in trades])) if trades else 0,
        "MAE_avg": float(np.mean([t.mae for t in trades])) if trades else 0,
    })
    print(f"{name:18s} n={len(net):5d} gross={rows[-1]['gross_exp']:7.0f} fee={rows[-1]['fee_exp']:6.0f} "
          f"net={rows[-1]['net_exp']:7.0f} PF={rows[-1]['PF']:.2f} win={rows[-1]['win%']:.0f}% "
          f"CI[{rows[-1]['CI_low']:.0f},{rows[-1]['CI_high']:.0f}]", flush=True)

df = pd.DataFrame(rows)
df.to_csv(Path(__file__).resolve().parent / "vwap_variants.csv", index=False)
print("\n" + df.to_string(index=False))
