#!/usr/bin/env python3
"""Standalone ORB simulation on cached intraday data for high beta Indian stocks.

Usage: python3 experiments/orb_benchmark.py
Outputs METRIC name=number lines for autoresearch.

Environment variables:
  ORB_OR_MIN=45          Opening range minutes (from 9:15 IST)
  ORB_SL=1.0             Stop loss percent
  ORB_TP=1.5             Take profit percent
  ORB_BUFFER=0.3         Breakout buffer percent
  ORB_COOLDOWN=3         Cooldown in bars (5-min bars) after exit
  ORB_SHORTS=0           Enable short trades (0=no, 1=yes)
  ORB_TRADE_SIZE=100     Shares per trade
  ORB_MIN_ENTRY=0        Min entry time in minutes from 9:15 (0=no filter)
  ORB_MAX_PER_DAY=0      Max trades per day (0=unlimited)
  ORB_EOD_EXIT=885       EOD exit in minutes from midnight IST (885=14:45, 900=15:00)
  ORB_CACHE_DIR=../experiments/data
"""
import os
import sys
import pickle
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))

ENV = {
    "OR_MIN": int(os.environ.get("ORB_OR_MIN", "45")),
    "SL": float(os.environ.get("ORB_SL", "1.0")),
    "TP": float(os.environ.get("ORB_TP", "1.5")),
    "BUFFER": float(os.environ.get("ORB_BUFFER", "0.3")),
    "COOLDOWN": int(os.environ.get("ORB_COOLDOWN", "3")),
    "SHORTS": int(os.environ.get("ORB_SHORTS", "0")),
    "TRADE_SIZE": int(os.environ.get("ORB_TRADE_SIZE", "100")),
    "MIN_ENTRY": int(os.environ.get("ORB_MIN_ENTRY", "0")),
    "MAX_PER_DAY": int(os.environ.get("ORB_MAX_PER_DAY", "0")),
    "EOD_EXIT": int(os.environ.get("ORB_EOD_EXIT", "885")),
    "CACHE_DIR": os.environ.get("ORB_CACHE_DIR", "../experiments/data"),
}


def load_cached_data(cache_dir: str) -> dict[str, pd.DataFrame]:
    path = os.path.join(cache_dir, "orb_cache.pkl")
    with open(path, "rb") as f:
        data = pickle.load(f)
    for sym, df in data.items():
        if not df.index.tz:
            df.index = pd.DatetimeIndex(df.index).tz_localize("UTC")
        data[sym] = df.sort_index()
    return data


def ist_time(dt: pd.Timestamp) -> pd.Timestamp:
    return dt.tz_convert(IST)


def time_in_minutes(ts: pd.Timestamp) -> int:
    return ts.hour * 60 + ts.minute


def simulate_stock(
    df: pd.DataFrame,
    or_minutes: int,
    sl_pct: float,
    tp_pct: float,
    buffer_pct: float,
    cooldown: int,
    shorts: bool,
    trade_size: int,
    min_entry: int,
    max_per_day: int,
    eod_exit_minutes: int,
) -> list[dict]:
    trades = []
    df = df.copy()
    df["ist_time"] = df.index.map(ist_time)
    df["time_minutes"] = df["ist_time"].map(time_in_minutes)
    OR_START = 9 * 60 + 15
    MARKET_CLOSE = 15 * 60 + 30
    or_end = OR_START + or_minutes
    or_start_dt = OR_START

    dates = sorted(set(d.date() for d in df["ist_time"]))
    for date in dates:
        day_df = df[df["ist_time"].dt.date == date]
        if len(day_df) < 10:
            continue
        pre_or = day_df[(day_df["time_minutes"] >= or_start_dt) & (day_df["time_minutes"] < or_end)]
        post_or = day_df[day_df["time_minutes"] >= or_end]
        if len(pre_or) < 5 or len(post_or) < 3:
            continue

        or_high = pre_or["high"].max()
        or_low = pre_or["low"].min()
        or_range_pct = (or_high - or_low) / or_low * 100

        if or_range_pct < 0.5 or or_range_pct > 3.0:
            continue

        long_entry = or_high * (1 + buffer_pct / 100)
        short_entry = or_low * (1 - buffer_pct / 100)

        day_trades = 0
        last_exit_bar = -cooldown - 1
        in_position = False
        position = {}

        for i, (idx, row) in enumerate(post_or.iterrows()):
            if in_position:
                pos = position
                if pos["side"] == "LONG":
                    pnl_pct = (row["close"] - pos["entry"]) / pos["entry"] * 100
                    sl_hit = row["low"] <= pos["sl"]
                    tp_hit = row["high"] >= pos["tp"]
                else:
                    pnl_pct = (pos["entry"] - row["close"]) / pos["entry"] * 100
                    sl_hit = row["high"] >= pos["sl"]
                    tp_hit = row["low"] <= pos["tp"]

                if tp_hit:
                    exit_price = pos["tp"]
                    exit_reason = "TP"
                elif sl_hit:
                    exit_price = pos["sl"]
                    exit_reason = "SL"
                elif row["time_minutes"] >= eod_exit_minutes:
                    exit_price = row["close"]
                    exit_reason = "EOD"
                else:
                    continue

                gross_pnl = (exit_price - pos["entry"]) * trade_size if pos["side"] == "LONG" else (pos["entry"] - exit_price) * trade_size
                trades.append({
                    "symbol": df.attrs.get("symbol", "?"),
                    "date": date,
                    "side": pos["side"],
                    "entry": pos["entry"],
                    "exit": exit_price,
                    "gross_pnl": gross_pnl,
                    "exit_reason": exit_reason,
                    "entry_time": pos["entry_time"],
                    "exit_time": idx,
                })
                in_position = False
                last_exit_bar = i
                day_trades += 1
                if max_per_day > 0 and day_trades >= max_per_day:
                    break
                continue

            if (i - last_exit_bar) < cooldown:
                continue

            if row["time_minutes"] >= eod_exit_minutes:
                continue

            if shorts and row["close"] < short_entry:
                price = row["close"]
                sl = price * (1 + sl_pct / 100)
                tp = price * (1 - tp_pct / 100)
                in_position = True
                position = {"side": "SHORT", "entry": price, "sl": sl, "tp": tp, "entry_time": idx}

            if row["close"] > long_entry:
                if min_entry > 0 and (row["time_minutes"] - OR_START) < min_entry:
                    continue
                price = row["close"]
                sl = price * (1 - sl_pct / 100)
                tp = price * (1 + tp_pct / 100)
                in_position = True
                position = {"side": "LONG", "entry": price, "sl": sl, "tp": tp, "entry_time": idx}

    return trades


def compute_metrics(all_trades: list[dict]) -> dict:
    if not all_trades:
        return {"total_trades": 0, "wins": 0, "losses": 0, "net_pnl": 0.0, "profit_factor": 0.0, "win_rate": 0.0, "tp_exits": 0, "sl_exits": 0, "eod_exits": 0, "stocks_with_trades": 0}

    wins = [t for t in all_trades if t["gross_pnl"] > 0]
    losses = [t for t in all_trades if t["gross_pnl"] <= 0]
    gross_profit = sum(t["gross_pnl"] for t in wins)
    gross_loss = abs(sum(t["gross_pnl"] for t in losses))
    unique_stocks = set(t["symbol"] for t in all_trades)
    net_pnl = sum(t["gross_pnl"] for t in all_trades)

    return {
        "total_trades": len(all_trades),
        "wins": len(wins),
        "losses": len(losses),
        "net_pnl": round(net_pnl, 2),
        "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss > 0 else 99.9999,
        "win_rate": round(len(wins) / len(all_trades) * 100, 1) if all_trades else 0.0,
        "tp_exits": sum(1 for t in all_trades if t["exit_reason"] == "TP"),
        "sl_exits": sum(1 for t in all_trades if t["exit_reason"] == "SL"),
        "eod_exits": sum(1 for t in all_trades if t["exit_reason"] == "EOD"),
        "stocks_with_trades": len(unique_stocks),
    }


def main():
    print(f"Loading cached data from {ENV['CACHE_DIR']}...", file=sys.stderr)
    data = load_cached_data(ENV["CACHE_DIR"])
    print(f"Loaded {len(data)} symbols", file=sys.stderr)

    all_trades = []
    for symbol, df in data.items():
        trades = simulate_stock(
            df,
            or_minutes=ENV["OR_MIN"],
            sl_pct=ENV["SL"],
            tp_pct=ENV["TP"],
            buffer_pct=ENV["BUFFER"],
            cooldown=ENV["COOLDOWN"],
            shorts=bool(ENV["SHORTS"]),
            trade_size=ENV["TRADE_SIZE"],
            min_entry=ENV["MIN_ENTRY"],
            max_per_day=ENV["MAX_PER_DAY"],
            eod_exit_minutes=ENV["EOD_EXIT"],
        )
        for t in trades:
            t["symbol"] = symbol
        all_trades.extend(trades)
        print(f"  {symbol}: {len(trades)} trades", file=sys.stderr)

    metrics = compute_metrics(all_trades)
    print(file=sys.stderr)
    print(f"Total trades: {metrics['total_trades']}", file=sys.stderr)
    print(f"Win rate: {metrics['win_rate']}%", file=sys.stderr)
    print(f"Net P&L: Rs {metrics['net_pnl']:,.2f}", file=sys.stderr)
    print(f"Profit factor: {metrics['profit_factor']}", file=sys.stderr)
    print(f"TP/SL/EOD: {metrics['tp_exits']}/{metrics['sl_exits']}/{metrics['eod_exits']}", file=sys.stderr)
    print(f"Stocks: {metrics['stocks_with_trades']}", file=sys.stderr)

    print(f"METRIC profit_factor={metrics['profit_factor']}")
    print(f"METRIC win_rate={metrics['win_rate']}")
    print(f"METRIC net_pnl={metrics['net_pnl']}")
    print(f"METRIC total_trades={metrics['total_trades']}")
    print(f"METRIC tp_exits={metrics['tp_exits']}")
    print(f"METRIC sl_exits={metrics['sl_exits']}")
    print(f"METRIC eod_exits={metrics['eod_exits']}")
    print(f"METRIC stocks_with_trades={metrics['stocks_with_trades']}")


if __name__ == "__main__":
    main()
