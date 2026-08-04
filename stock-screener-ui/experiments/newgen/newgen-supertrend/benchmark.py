"""NEWGEN Supertrend benchmark for autoresearch session newgen-supertrend.

Loads the shared NEWGEN candle cache (15m/60m) and runs a standard Supertrend
flip-entry simulator with env-var driven parameters. Prints METRIC key=value
lines consumed by the autoresearch loop. Each run completes <5s.

Strategy:
  Long  when Supertrend flips to up (green)
  Short when Supertrend flips down (red), if shorts enabled
  Exit on Supertrend flip back, OR fixed SL/TP (if > 0), OR EOD.

Supertrend (standard, mirrors experiments/benchmark_supertrend.py):
  hl2 = (high+low)/2; ATR = SMA(TR, atr_period)
  basic_up = hl2 - mult*atr ; basic_down = hl2 + mult*atr
  band follows prior band while trend persists (max/min chain).

Env vars:
  NEWGEN_TF           candle timeframe minutes (15/60)
  NEWGEN_ATR_PERIOD   ATR lookback
  NEWGEN_MULT         ATR multiplier
  NEWGEN_SL           fixed SL pct (0 = Supertrend flip exit)
  NEWGEN_TP           fixed TP pct (0 = Supertrend flip exit)
  NEWGEN_EOD_EXIT     EOD exit minute-of-day (default 885 = 14:45)
  NEWGEN_SHORTS       "1" enables short-side entries
  NEWGEN_TRADE_SIZE   shares per trade
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import numpy as np
import pandas as pd

from experiments.newgen.common import (
    load_newgen,
    compute_metrics,
    print_metrics,
    calc_costs,
    time_in_minutes,
)

MKT_OPEN = 9 * 60 + 15


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "")
    return float(raw) if raw else default


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    return int(raw) if raw else default


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "")
    return bool(int(raw)) if raw else default


def supertrend(high, low, close, period=10, multiplier=3.0):
    """Calculate Supertrend. Returns (st_value, direction) arrays.
    direction: 1 = up (green), -1 = down (red)."""
    hi = np.array(high, dtype=float)
    lo = np.array(low, dtype=float)
    cl = np.array(close, dtype=float)
    hl2 = (hi + lo) / 2
    tr = np.maximum(hi[1:] - lo[1:], np.abs(hi[1:] - cl[:-1]), np.abs(lo[1:] - cl[:-1]))
    tr = np.concatenate([[tr[0]], tr])
    atr = pd.Series(tr).rolling(period).mean().values
    basic_up = hl2 - multiplier * atr
    basic_down = hl2 + multiplier * atr
    st = np.full(len(close), np.nan)
    direction = np.ones(len(close), dtype=int)
    for i in range(period, len(close)):
        if direction[i - 1] == 1:  # in uptrend, check for flip down
            direction[i] = -1 if cl[i] < basic_up[i] else 1
        else:  # in downtrend, check for flip up
            direction[i] = 1 if cl[i] > basic_down[i] else -1
        if direction[i] == 1:
            st[i] = max(basic_up[i], st[i - 1]) if not np.isnan(st[i - 1]) else basic_up[i]
        else:
            st[i] = min(basic_down[i], st[i - 1]) if not np.isnan(st[i - 1]) else basic_down[i]
    return st, direction


def simulate_supertrend(
    df: pd.DataFrame,
    atr_period: int = 10,
    mult: float = 3.0,
    sl_pct: float = 0.0,
    tp_pct: float = 0.0,
    eod_exit_minutes: int = 885,
    shorts: bool = False,
    trade_size: int = 100,
    include_costs: bool = True,
) -> list:
    df = df.copy()
    df["ist_time"] = df.index
    df["time_minutes"] = df["ist_time"].map(time_in_minutes)

    st, dirs = supertrend(df["high"].values, df["low"].values, df["close"].values,
                          atr_period, mult)
    sl = sl_pct / 100
    tp = tp_pct / 100

    trades = []
    in_pos = False
    pos = {}

    start = atr_period + 5
    n = len(df)
    for i in range(start, n):
        row = df.iloc[i]
        c = row["close"]
        t = int(row["time_minutes"])

        if not in_pos:
            if t >= eod_exit_minutes:
                continue
            if dirs[i] != dirs[i - 1] and dirs[i - 1] in (1, -1) and not np.isnan(st[i - 1]):
                if dirs[i] == 1:
                    pos = {"side": "LONG", "entry": c,
                           "sl": c * (1 - sl) if sl > 0 else None,
                           "tp": c * (1 + tp) if tp > 0 else None, "idx": i}
                    in_pos = True
                elif dirs[i] == -1 and shorts:
                    pos = {"side": "SHORT", "entry": c,
                           "sl": c * (1 + sl) if sl > 0 else None,
                           "tp": c * (1 - tp) if tp > 0 else None, "idx": i}
                    in_pos = True
        else:
            ep = None
            reason = None
            if pos["side"] == "LONG":
                if pos["tp"] is not None and row["high"] >= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
                elif pos["sl"] is not None and row["low"] <= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
            else:
                if pos["tp"] is not None and row["low"] <= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
                elif pos["sl"] is not None and row["high"] >= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
            if ep is None and dirs[i] != dirs[i - 1]:
                ep, reason = c, "ST_FLIP"
            if ep is None and t >= eod_exit_minutes:
                ep, reason = c, "EOD"
            if ep is not None:
                corr = 1 if pos["side"] == "LONG" else -1
                gross = corr * (ep - pos["entry"]) * trade_size
                costs = calc_costs(pos["entry"], ep, trade_size, pos["side"]) if include_costs else 0.0
                trades.append({
                    "side": pos["side"], "entry": pos["entry"], "exit": ep,
                    "gross_pnl": gross, "costs": costs,
                    "net_pnl": gross - costs, "exit_reason": reason,
                    "entry_time": df.index[pos["idx"]], "exit_time": df.index[i],
                    "date": str(df.index[i].date()),
                })
                in_pos = False

    return trades


def main():
    tf = env_int("NEWGEN_TF", 15)
    atr_period = env_int("NEWGEN_ATR_PERIOD", 10)
    mult = env_float("NEWGEN_MULT", 3.0)
    sl_pct = env_float("NEWGEN_SL", 0.0)
    tp_pct = env_float("NEWGEN_TP", 0.0)
    eod_exit = env_int("NEWGEN_EOD_EXIT", 885)
    shorts = env_bool("NEWGEN_SHORTS", False)
    trade_size = env_int("NEWGEN_TRADE_SIZE", 100)

    df = load_newgen(tf)
    trades = simulate_supertrend(
        df, atr_period=atr_period, mult=mult, sl_pct=sl_pct, tp_pct=tp_pct,
        eod_exit_minutes=eod_exit, shorts=shorts, trade_size=trade_size,
    )

    metrics = compute_metrics(trades)
    metrics["flip_exits"] = sum(1 for t in trades if t["exit_reason"] == "ST_FLIP")
    metrics["short_exits"] = sum(1 for t in trades if t["exit_reason"] == "SHORT")
    print_metrics(metrics)

    desc = (
        f"tf={tf} ATR={atr_period} MULT={mult} SL={sl_pct} TP={tp_pct} "
        f"EOD={eod_exit} SHORTS={int(shorts)}"
    )
    print(f"DESC {desc}")


if __name__ == "__main__":
    main()
