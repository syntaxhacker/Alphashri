#!/usr/bin/env python3
"""NEWGEN EMA Cross benchmark for autoresearch session 'newgen-ema'.

Env params:
  NEWGEN_TF=5             candle timeframe (5/15/60)
  NEWGEN_FAST=9           fast EMA period
  NEWGEN_SLOW=21          slow EMA period
  NEWGEN_SL=1.0           stop loss percent
  NEWGEN_TP=1.5           take profit percent (0 = disabled)
  NEWGEN_COOLDOWN=3       cooldown bars after exit
  NEWGEN_SHORTS=0         enable shorts (0/1)
  NEWGEN_EOD_EXIT=885     EOD exit minutes (IST)
  NEWGEN_CAPITAL=100000   capital per trade
  NEWGEN_TRADE_SIZE=0     fixed shares per trade (0 = use capital/entry)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd

from experiments.newgen.common import load_newgen, compute_metrics, print_metrics, calc_costs, IST

ENV = {
    "TF": int(os.environ.get("NEWGEN_TF", "5")),
    "FAST": int(os.environ.get("NEWGEN_FAST", "9")),
    "SLOW": int(os.environ.get("NEWGEN_SLOW", "21")),
    "SL": float(os.environ.get("NEWGEN_SL", "1.0")),
    "TP": float(os.environ.get("NEWGEN_TP", "1.5")),
    "COOLDOWN": int(os.environ.get("NEWGEN_COOLDOWN", "3")),
    "SHORTS": int(os.environ.get("NEWGEN_SHORTS", "0")),
    "EOD_EXIT": int(os.environ.get("NEWGEN_EOD_EXIT", "885")),
    "CAPITAL": float(os.environ.get("NEWGEN_CAPITAL", "100000")),
    "TRADE_SIZE": int(os.environ.get("NEWGEN_TRADE_SIZE", "0")),
}


def ema(values, period):
    result = [values[0]]
    k = 2 / (period + 1)
    for i in range(1, len(values)):
        result.append(values[i] * k + result[-1] * (1 - k))
    return result


def simulate(df, fast, slow, sl_pct, tp_pct, cooldown, shorts, eod_minutes, capital, trade_size):
    closes = df["close"].tolist()
    ema_fast_arr = ema(closes, fast)
    ema_slow_arr = ema(closes, slow)

    trades = []
    in_position = False
    pos = {}
    last_exit_idx = -cooldown - 1

    for i in range(1, len(closes)):
        ema_f_cur = ema_fast_arr[i]
        ema_f_prev = ema_fast_arr[i - 1]
        ema_s_cur = ema_slow_arr[i]
        ema_s_prev = ema_slow_arr[i - 1]
        row = df.iloc[i]
        ts_ist = row.name.tz_convert(IST) if hasattr(row.name, "tz_convert") else row.name
        time_min = ts_ist.hour * 60 + ts_ist.minute

        if in_position:
            sl_hit = row["low"] <= pos["sl"] if pos["side"] == "LONG" else row["high"] >= pos["sl"]
            tp_hit = row["high"] >= pos["tp"] if pos["side"] == "LONG" else row["low"] <= pos["tp"]

            if tp_hit:
                exit_price = pos["tp"]
                reason = "TP"
            elif sl_hit:
                exit_price = pos["sl"]
                reason = "SL"
            elif time_min >= eod_minutes:
                exit_price = row["close"]
                reason = "EOD"
            else:
                continue

            shares = trade_size if trade_size > 0 else int(capital / pos["entry"])
            gross_pnl = (exit_price - pos["entry"]) * shares if pos["side"] == "LONG" \
                        else (pos["entry"] - exit_price) * shares
            costs = calc_costs(pos["entry"], exit_price, shares, pos["side"])
            net_pnl = gross_pnl - costs
            trades.append({
                "side": pos["side"],
                "entry": pos["entry"],
                "exit": exit_price,
                "gross_pnl": round(gross_pnl, 2),
                "costs": costs,
                "net_pnl": round(net_pnl, 2),
                "exit_reason": reason,
                "entry_time": pos["entry_time"],
                "exit_time": ts_ist,
            })
            in_position = False
            last_exit_idx = i
            continue

        if (i - last_exit_idx) < cooldown:
            continue

        if time_min >= eod_minutes:
            continue

        bullish = ema_f_prev <= ema_s_prev and ema_f_cur > ema_s_cur
        bearish = ema_f_prev >= ema_s_prev and ema_f_cur < ema_s_cur

        if bullish:
            entry = float(row["close"])
            pos = {
                "side": "LONG",
                "entry": entry,
                "sl": entry * (1 - sl_pct),
                "tp": entry * (1 + tp_pct) if tp_pct > 0 else float("inf"),
                "entry_time": ts_ist,
            }
            in_position = True
        elif bearish and shorts:
            entry = float(row["close"])
            pos = {
                "side": "SHORT",
                "entry": entry,
                "sl": entry * (1 + sl_pct),
                "tp": entry * (1 - tp_pct) if tp_pct > 0 else 0.0,
                "entry_time": ts_ist,
            }
            in_position = True

    return trades


def main():
    df = load_newgen(ENV["TF"])
    print(f"tf={ENV['TF']} rows={len(df)} range={df.index[0]}..{df.index[-1]} "
          f"FAST={ENV['FAST']} SLOW={ENV['SLOW']} SL={ENV['SL']} TP={ENV['TP']} "
          f"CD={ENV['COOLDOWN']} shorts={ENV['SHORTS']} EOD={ENV['EOD_EXIT']}", file=sys.stderr)
    trades = simulate(
        df, ENV["FAST"], ENV["SLOW"], ENV["SL"] / 100, ENV["TP"] / 100,
        ENV["COOLDOWN"], bool(ENV["SHORTS"]), ENV["EOD_EXIT"],
        ENV["CAPITAL"], ENV["TRADE_SIZE"],
    )
    metrics = compute_metrics(trades)
    print(file=sys.stderr)
    for k in ("total_trades", "win_rate", "net_pnl", "profit_factor", "tp_exits", "sl_exits", "eod_exits"):
        print(f"{k}: {metrics[k]}", file=sys.stderr)
    print_metrics(metrics)


if __name__ == "__main__":
    main()
