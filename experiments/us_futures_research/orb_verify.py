#!/usr/bin/env python
"""
Verify YouTuber ORB claims on CME futures OHLC data:
  - Claim A: S&P500 ORB, breakout-and-retest limit entry, 1% risk, 1:2 RR -> +19.7%/yr
  - Claim B: same but market entry at open of 4th consecutive 3-min candle closing
             beyond the range -> +51.5%/yr

We cannot replicate the exact 12-month window (minute data: 2026-01-20..2026-04-15,
~74 sessions incl. partials). We test BOTH variants head-to-head on the identical
window for ES (S&P), NQ (Nasdaq), GC (gold).

Assumptions where the video is vague (stated in output):
  - Opening range = first 15 min of RTH (also tested: 30 min)
  - SL = opposite side of opening range, TP = 2R, EOD flat
  - Retest limit fills only if price returns to range edge after breakout close
  - Intrabar double-hit -> SL filled first (conservative)

Usage: python orb_verify.py
"""
import numpy as np
import pandas as pd

USB = "/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main"
DST_SWITCH = pd.Timestamp("2026-03-08")          # US DST 2026
SESSION_MINUTES = 390                             # RTH length
COSTS_PT = {"ES": 1.0, "NQ": 5.0, "GC": 0.7}      # ~RT fees+slippage in points (conservative)


def load_3min(sym: str) -> pd.DataFrame:
    m = pd.read_csv(f"{USB}/{sym}/{sym}_1min_20260120_20260415.csv", parse_dates=["datetime"])
    m = m.set_index("datetime").sort_index()
    b = m.resample("3min", label="left", closed="left").agg(
        open=("open", "first"), high=("high", "max"), low=("low", "min"),
        close=("close", "last"), volume=("volume", "sum")).dropna(subset=["close"])
    # RTH mask: 09:30 ET => 14:30 UTC before DST, 13:30 after
    et = b.index.tz_localize("UTC").tz_convert("America/New_York").tz_localize(None)
    rth_open_et = et.normalize() + pd.Timedelta(hours=9, minutes=30)
    off = (et - rth_open_et).total_seconds() / 60
    mask = (off >= 0) & (off < SESSION_MINUTES)
    b = b[mask]
    b["day"] = et[mask].normalize()
    return b


def simulate_day(g: pd.DataFrame, range_bars: int, consec: int, mode: str, cost_pt: float):
    """Return dict(trade) or None. mode='retest' | 'run'.
    All prices via bar OHLC only. Returns R multiple net of costs (points->R)."""
    if len(g) < range_bars + consec + 2:
        return None
    rng = g.iloc[:range_bars]
    hi, lo = float(rng["high"].max()), float(rng["low"].min())
    body = g.iloc[range_bars:]
    o = body["open"].to_numpy(float); h = body["high"].to_numpy(float)
    l = body["low"].to_numpy(float); c = body["close"].to_numpy(float)
    n = len(body)
    last_close = c[-1]

    def finish(side, entry, stop, tp, j_start):
        dist = abs(entry - stop)
        if dist <= 0:
            return None
        exit_px = None
        for j in range(j_start, n):
            if side == 1:
                hit_sl, hit_tp = l[j] <= stop, h[j] >= tp
            else:
                hit_sl, hit_tp = h[j] >= stop, l[j] <= tp
            if hit_sl:                      # SL first when both (conservative)
                exit_px = stop; break
            if hit_tp:
                exit_px = tp; break
        if exit_px is None:
            exit_px = last_close            # EOD flat
        raw = (exit_px - entry) / dist if side == 1 else (entry - exit_px) / dist
        return raw, raw - cost_pt / dist

    # ---- variant: N consecutive closes beyond range, enter at open of the Nth
    if mode == "run":
        above = (c > hi).astype(int); below = (c < lo).astype(int)
        for i in range(consec - 1, n):
            if above[i - consec + 1:i + 1].sum() == consec:
                side, entry, stop = 1, o[i], lo
            elif below[i - consec + 1:i + 1].sum() == consec:
                side, entry, stop = -1, o[i], hi
            else:
                continue
            if abs(entry - stop) <= 0:
                return None
            tp = entry + side * 2 * abs(entry - stop)
            return finish(side, entry, stop, tp, i)   # entry bar can stop us out
        return None

    # ---- baseline: first close beyond range, then limit at range edge (retest)
    broke = None
    for i in range(n):
        if c[i] > hi:
            broke = (1, hi); break
        if c[i] < lo:
            broke = (-1, lo); break
    if broke is None:
        return None
    side, edge = broke
    for j in range(i + 1, n):               # wait for retest touch
        if side == 1 and l[j] <= edge:
            stop, entry = lo, edge
            tp = entry + 2 * (entry - stop)
            return finish(side, entry, stop, tp, j)
        if side == -1 and h[j] >= edge:
            stop, entry = hi, edge
            tp = entry - 2 * (stop - entry)
            return finish(side, entry, stop, tp, j)
    return None                              # no retest, no trade


def run_backtest(sym: str, range_min: int, consec: int, mode: str):
    bars = load_3min(sym)
    rb = range_min // 3
    rows = []
    for day, g in bars.groupby("day"):
        r = simulate_day(g, rb, consec, mode, COSTS_PT[sym])
        if r is not None:
            rows.append({"day": day, "R_raw": r[0], "R": r[1]})
    t = pd.DataFrame(rows)
    if t.empty:
        return {"sym": sym, "range": range_min, "mode": mode, "trades": 0}
    eq_gross = (1 + 0.01 * t["R_raw"]).cumprod()
    eq_net = (1 + 0.01 * t["R"]).cumprod()   # costs already inside R
    wins = (t["R"] > 0).sum()
    pf = t.loc[t.R > 0, "R"].sum() / abs(t.loc[t.R < 0, "R"].sum()) if (t.R < 0).any() else float("inf")
    dd = (eq_net / eq_net.cummax() - 1).min()
    return {
        "sym": sym, "range": f"{range_min}m", "mode": mode, "trades": len(t),
        "win%": round(wins / len(t) * 100, 1),
        "avg_R": round(t["R"].mean(), 3), "PF": round(pf, 2),
        "net_%": round((eq_net.iloc[-1] - 1) * 100, 1),
        "gross_%": round((eq_gross.iloc[-1] - 1) * 100, 1),
        "maxDD_%": round(dd * 100, 1),
        "days_span": f"{t['day'].min().date()}..{t['day'].max().date()}",
    }


if __name__ == "__main__":
    results = []
    for sym in ("ES", "NQ", "GC"):
        for range_min in (15, 30):
            results.append(run_backtest(sym, range_min, 4, "retest"))   # claim A
            results.append(run_backtest(sym, range_min, 4, "run"))      # claim B
    df = pd.DataFrame(results)
    cols = ["sym", "range", "mode", "trades", "win%", "avg_R", "PF",
            "net_%", "gross_%", "maxDD_%", "days_span"]
    print(df[cols].to_string(index=False))
    print("\nWindow: 2026-01-20..2026-04-15 (~3 months) — NOT the claimed 12 months.")
    print("Costs (pts RT): ES 1.0, NQ 5.0, GC 0.7 · sizing 1% equity/trade compounded · SL=range opposite, TP=2R, EOD flat")
