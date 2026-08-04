"""NEWGEN SR (Support/Resistance pivot) Breakout benchmark — newgen-sr autoresearch.

Reads params from env vars and runs the SR breakout sim on cached NEWGEN candles,
then prints METRIC key=value lines via common.print_metrics. Single stock, cached
data — each run completes in <5s.

Env params:
  NEWGEN_TF           candle timeframe in minutes (5/15/60), default 5
  NEWGEN_PIVOT        pivot type (classic/fibonacci), default classic
  NEWGEN_SL           stop loss pct, default 2.0
  NEWGEN_TP           take profit pct, default 3.0
  NEWGEN_BUFFER       breakout buffer pct above R1 / below S1, default 0.1
  NEWGEN_MAX_DIST     max distance pct above R1 / below S1, default 5.0
  NEWGEN_MIN_ENTRY    earliest entry as minutes-since-midnight (600 = 10:00), default 600
  NEWGEN_COOLDOWN     min minutes between exit and next entry, default 30
  NEWGEN_SHORTS       enable S1 breakdown shorts (1/0), default 0
  NEWGEN_TRADE_SIZE   shares per trade, default 100
  NEWGEN_COSTS        include round-trip costs (1/0), default 1

Semantics mirror experiments/sr_backtest.py + benchmark_sr_params.py:
  - Daily pivots from PREVIOUS trading day's OHLC (intraday df resampled .resample('1D')).
  - Long entry: candle close >= R1*(1+buffer%) and close <= R1*(1+max_dist%).
  - Short entry: candle close <= S1*(1-buffer%) and close >= S1*(1-max_dist%).
  - TP = R2 if above entry else entry*(1+tp%); shorts mirror with S2.
  - Exit on SL/TP/EOD (15:15 = 915).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd

from trading.pivot_utils import calculate_pivot_points
from experiments.newgen.common import (
    IST,
    load_newgen,
    calc_costs,
    compute_metrics,
    print_metrics,
)

MKT_OPEN = 555  # 9:15
EOD_MINUTES = 915  # 15:15


def _f(name, default):
    return float(os.environ.get(name, str(default)))


def _i(name, default):
    return int(os.environ.get(name, str(default)))


def simulate_sr(
    df: pd.DataFrame,
    tf: int,
    pivot_type: str,
    sl_pct: float,
    tp_pct: float,
    buffer_pct: float,
    max_dist_pct: float,
    min_entry: int,
    cooldown_min: int,
    shorts: bool,
    trade_size: int = 100,
    include_costs: bool = True,
) -> list:
    df = df.copy()
    df["ist_time"] = df.index.tz_convert(IST)
    df["time_minutes"] = df["ist_time"].map(lambda x: x.hour * 60 + x.minute)

    daily = df.resample("1D").agg({"high": "max", "low": "min", "close": "last"}).dropna(subset=["close"])
    dates = sorted(set(d.date() for d in df["ist_time"]))
    date_ohlc = {d.date(): {"high": r["high"], "low": r["low"], "close": r["close"]} for d, r in daily.iterrows()}
    date_to_prev = {dates[i]: dates[i - 1] for i in range(1, len(dates))}

    trades = []
    for day_date in dates[1:]:
        prev_date = date_to_prev.get(day_date)
        prev_ohlc = date_ohlc.get(prev_date)
        if prev_ohlc is None:
            continue
        pivot = calculate_pivot_points(prev_ohlc["high"], prev_ohlc["low"], prev_ohlc["close"], pivot_type)
        r1, r2, s1, s2 = pivot.r1, pivot.r2, pivot.s1, pivot.s2

        day_df = df[df["ist_time"].dt.date == day_date]
        if len(day_df) < 3:
            continue

        in_pos = False
        pos = {}
        last_exit_ts = None

        for idx, row in day_df.iterrows():
            ct = row["time_minutes"]
            close = float(row["close"])
            high = float(row["high"])
            low = float(row["low"])
            if ct < min_entry:
                continue
            if ct >= EOD_MINUTES:
                break

            if in_pos:
                if pos["side"] == "LONG":
                    sl_hit = low <= pos["sl"]
                    tp_hit = high >= pos["tp"]
                else:
                    sl_hit = high >= pos["sl"]
                    tp_hit = low <= pos["tp"]

                if sl_hit:
                    exit_price, reason = pos["sl"], "SL"
                elif tp_hit:
                    exit_price, reason = pos["tp"], "TP"
                elif ct >= EOD_MINUTES:
                    exit_price, reason = close, "EOD"
                else:
                    continue

                gross = (exit_price - pos["entry"]) * trade_size if pos["side"] == "LONG" else (pos["entry"] - exit_price) * trade_size
                costs = calc_costs(pos["entry"], exit_price, trade_size, pos["side"]) if include_costs else 0.0
                trades.append({
                    "side": pos["side"], "entry": pos["entry"], "exit": exit_price,
                    "gross_pnl": gross, "costs": costs, "net_pnl": gross - costs,
                    "exit_reason": reason, "entry_time": idx, "exit_time": idx, "date": str(day_date),
                })
                in_pos = False
                last_exit_ts = idx
                continue

            if last_exit_ts is not None and (idx - last_exit_ts).total_seconds() / 60 < cooldown_min:
                continue

            long_trigger = r1 * (1 + buffer_pct / 100)
            long_max = r1 * (1 + max_dist_pct / 100)
            if close >= long_trigger and close <= long_max:
                default_tp = close * (1 + tp_pct / 100)
                tp = r2 if r2 and r2 > close else default_tp
                pos = {"side": "LONG", "entry": close, "sl": close * (1 - sl_pct / 100), "tp": tp}
                in_pos = True
                continue

            if shorts:
                short_trigger = s1 * (1 - buffer_pct / 100)
                short_max = s1 * (1 - max_dist_pct / 100)
                if close <= short_trigger and close >= short_max:
                    default_tp = close * (1 - tp_pct / 100)
                    tp = s2 if s2 and s2 < close else default_tp
                    pos = {"side": "SHORT", "entry": close, "sl": close * (1 + sl_pct / 100), "tp": tp}
                    in_pos = True

    return trades


def main():
    tf = _i("NEWGEN_TF", 5)
    pivot_type = os.environ.get("NEWGEN_PIVOT", "classic")
    sl_pct = _f("NEWGEN_SL", 2.0)
    tp_pct = _f("NEWGEN_TP", 3.0)
    buffer_pct = _f("NEWGEN_BUFFER", 0.1)
    max_dist_pct = _f("NEWGEN_MAX_DIST", 5.0)
    min_entry = _i("NEWGEN_MIN_ENTRY", 600)
    cooldown_min = _i("NEWGEN_COOLDOWN", 30)
    shorts = os.environ.get("NEWGEN_SHORTS", "0") == "1"
    trade_size = _i("NEWGEN_TRADE_SIZE", 100)
    include_costs = os.environ.get("NEWGEN_COSTS", "1") == "1"

    df = load_newgen(tf)
    trades = simulate_sr(
        df,
        tf=tf,
        pivot_type=pivot_type,
        sl_pct=sl_pct,
        tp_pct=tp_pct,
        buffer_pct=buffer_pct,
        max_dist_pct=max_dist_pct,
        min_entry=min_entry,
        cooldown_min=cooldown_min,
        shorts=shorts,
        trade_size=trade_size,
        include_costs=include_costs,
    )
    m = compute_metrics(trades)
    print_metrics(m)


if __name__ == "__main__":
    main()
