#!/usr/bin/env python3
"""Standalone EMA Crossover simulation on Indian stocks.

Usage: python3 experiments/ema_benchmark.py
Outputs METRIC name=number lines for autoresearch.

Environment variables:
  EMA_FAST=9             Fast EMA period (bars)
  EMA_SLOW=21            Slow EMA period (bars)
  EMA_SL=1.0             Stop loss percent
  EMA_TP=1.5             Take profit percent
  EMA_COOLDOWN=3         Cooldown bars after exit before re-entry
  EMA_SHORTS=0           Enable short trades (0=no, 1=yes)
  EMA_EOD_HOUR=14        Hour for EOD force exit (IST)
  EMA_EOD_MINUTE=45      Minute for EOD force exit
  EMA_TRADE_CAPITAL=100000  Capital per trade (INR)
  EMA_CACHE_DIR=../experiments/data
  EMA_SYMBOLS=           Comma-separated symbol filter
  EMA_DATE_START=        Start date YYYY-MM-DD
  EMA_DATE_END=          End date YYYY-MM-DD
"""
import os, sys, pickle, hashlib
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
MKT_OPEN = 9 * 60 + 15   # 9:15 IST
MKT_CLOSE = 15 * 60 + 30  # 15:30 IST

ENV = {
    "FAST": int(os.environ.get("EMA_FAST", "9")),
    "SLOW": int(os.environ.get("EMA_SLOW", "21")),
    "SL": float(os.environ.get("EMA_SL", "1.0")),
    "TP": float(os.environ.get("EMA_TP", "1.5")),
    "COOLDOWN": int(os.environ.get("EMA_COOLDOWN", "3")),
    "SHORTS": int(os.environ.get("EMA_SHORTS", "0")),
    "EOD_HOUR": int(os.environ.get("EMA_EOD_HOUR", "14")),
    "EOD_MINUTE": int(os.environ.get("EMA_EOD_MINUTE", "45")),
    "TRADE_CAPITAL": float(os.environ.get("EMA_TRADE_CAPITAL", "100000")),
    "CACHE_DIR": os.environ.get("EMA_CACHE_DIR", "../experiments/data"),
    "SYMBOLS": os.environ.get("EMA_SYMBOLS", ""),
    "DATE_START": os.environ.get("EMA_DATE_START", ""),
    "DATE_END": os.environ.get("EMA_DATE_END", ""),
}

SYMBOLS = [
    "RELIANCE", "TCS", "INFY", "ICICIBANK", "HDFCBANK", "SBIN",
    "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE",
    "MARUTI", "ASIANPAINT", "HCLTECH", "SUNPHARMA", "TITAN", "WIPRO",
    "ULTRACEMCO", "ADANIENT", "TRENT", "DIXON", "BAJAJFINSV",
    "NTPC", "POWERGRID", "HINDALCO", "IEX", "INDUSINDBK", "BPCL",
    "VEDL", "SRF", "BANDHANBNK", "JSWENERGY", "UPL",
]


def ema(values: list, period: int) -> list:
    """Compute EMA over a list of values. Returns same-length list."""
    result = [values[0]]  # seed with SMA at index 0
    k = 2 / (period + 1)
    for i in range(1, len(values)):
        result.append(values[i] * k + result[-1] * (1 - k))
    return result


def load_data(cache_dir: str) -> dict[str, pd.DataFrame]:
    """Load/fetch 5-min data for all symbols. Caches locally."""
    cache_path = os.path.join(cache_dir, "ema_cache.pkl")
    flag_path = cache_path + ".hash"

    param_hash = hashlib.md5(
        f"SYMBOLS={sorted(SYMBOLS)}|START={ENV['DATE_START']}|END={ENV['DATE_END']}".encode()
    ).hexdigest()[:12]

    if os.path.exists(cache_path) and os.path.exists(flag_path):
        with open(flag_path) as f:
            if f.read().strip() == param_hash:
                with open(cache_path, "rb") as f:
                    data = pickle.load(f)
                print(f"Loaded {len(data)} symbols from cache", file=sys.stderr)
                data = filter_symbols(data)
                data = filter_dates(data)
                return data

    print(f"Fetching data for {len(SYMBOLS)} symbols...", file=sys.stderr)
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from market_data.market_data import fetch_candles

    data = {}
    for sym in SYMBOLS:
        df = fetch_candles(symbol=sym, tf=5,
                           from_date=ENV["DATE_START"] or "2026-01-01",
                           to_date=ENV["DATE_END"] or datetime.now(IST).strftime("%Y-%m-%d"))
        if df is not None and len(df) > 20:
            if not df.index.tz:
                df.index = pd.DatetimeIndex(df.index).tz_localize("UTC")
            df = df.sort_index()
            data[sym] = df
            print(f"  {sym}: {len(df)} candles", file=sys.stderr)

    os.makedirs(cache_dir, exist_ok=True)
    with open(cache_path, "wb") as f:
        pickle.dump(data, f)
    with open(flag_path, "w") as f:
        f.write(param_hash)
    print(f"Cached {len(data)} symbols", file=sys.stderr)
    data = filter_symbols(data)
    data = filter_dates(data)
    return data


def filter_symbols(data: dict) -> dict:
    if not ENV["SYMBOLS"]:
        return data
    wanted = set(s.strip().upper() for s in ENV["SYMBOLS"].split(","))
    return {k: v for k, v in data.items() if k in wanted}


def filter_dates(data: dict) -> dict:
    if not ENV["DATE_START"] and not ENV["DATE_END"]:
        return data
    result = {}
    for sym, df in data.items():
        if ENV["DATE_START"]:
            start_ts = pd.Timestamp(ENV["DATE_START"], tz=IST)
            df = df[df.index >= start_ts.tz_convert("UTC")]
        if ENV["DATE_END"]:
            end_ts = pd.Timestamp(ENV["DATE_END"] + " 23:59:59", tz=IST)
            df = df[df.index <= end_ts.tz_convert("UTC")]
        if len(df) > 20:
            result[sym] = df
    return result


def sim_symbol(df: pd.DataFrame) -> list[dict]:
    """Run EMA cross simulation on one symbol's 5-min data."""
    fast = ENV["FAST"]
    slow = ENV["SLOW"]
    sl_pct = ENV["SL"] / 100
    tp_pct = ENV["TP"] / 100
    cooldown = ENV["COOLDOWN"]
    shorts = bool(ENV["SHORTS"])
    eod_minutes = ENV["EOD_HOUR"] * 60 + ENV["EOD_MINUTE"]
    capital = ENV["TRADE_CAPITAL"]

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
            pnl_pct = (row["close"] - pos["entry"]) / pos["entry"] * 100 if pos["side"] == "LONG" \
                      else (pos["entry"] - row["close"]) / pos["entry"] * 100
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

            shares = int(capital / pos["entry"])
            gross_pnl = (exit_price - pos["entry"]) * shares if pos["side"] == "LONG" \
                        else (pos["entry"] - exit_price) * shares
            trades.append({
                "side": pos["side"],
                "entry": pos["entry"],
                "exit": exit_price,
                "gross_pnl": gross_pnl,
                "reason": reason,
                "entry_time": pos["entry_time"],
                "exit_time": ts_ist,
            })
            in_position = False
            last_exit_idx = i
            continue

        # Cooldown check
        if (i - last_exit_idx) < cooldown:
            continue

        # No entry after EOD
        if time_min >= eod_minutes:
            continue

        # Check for crossover
        bullish = ema_f_prev <= ema_s_prev and ema_f_cur > ema_s_cur
        bearish = ema_f_prev >= ema_s_prev and ema_f_cur < ema_s_cur

        if bullish:
            entry = float(row["close"])
            pos = {
                "side": "LONG",
                "entry": entry,
                "sl": entry * (1 - sl_pct),
                "tp": entry * (1 + tp_pct),
                "entry_time": ts_ist,
            }
            in_position = True

        elif bearish and shorts:
            entry = float(row["close"])
            pos = {
                "side": "SHORT",
                "entry": entry,
                "sl": entry * (1 + sl_pct),
                "tp": entry * (1 - tp_pct),
                "entry_time": ts_ist,
            }
            in_position = True

    return trades


def compute_metrics(all_trades: list) -> dict:
    if not all_trades:
        return {"total_trades": 0, "wins": 0, "losses": 0, "net_pnl": 0.0,
                "profit_factor": 0.0, "win_rate": 0.0, "tp_exits": 0,
                "sl_exits": 0, "eod_exits": 0, "stocks_with_trades": 0}
    wins = [t for t in all_trades if t["gross_pnl"] > 0]
    losses = [t for t in all_trades if t["gross_pnl"] <= 0]
    gross_profit = sum(t["gross_pnl"] for t in wins)
    gross_loss = abs(sum(t["gross_pnl"] for t in losses))
    unique_stocks = set(t.get("symbol", "?") for t in all_trades)
    return {
        "total_trades": len(all_trades),
        "wins": len(wins),
        "losses": len(losses),
        "net_pnl": round(sum(t["gross_pnl"] for t in all_trades), 2),
        "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss > 0 else 99.9999,
        "win_rate": round(len(wins) / len(all_trades) * 100, 1) if all_trades else 0.0,
        "tp_exits": sum(1 for t in all_trades if t["reason"] == "TP"),
        "sl_exits": sum(1 for t in all_trades if t["reason"] == "SL"),
        "eod_exits": sum(1 for t in all_trades if t["reason"] == "EOD"),
        "stocks_with_trades": len(unique_stocks),
    }


def main():
    print(f"Params: FAST={ENV['FAST']} SLOW={ENV['SLOW']} SL={ENV['SL']}% TP={ENV['TP']}% "
          f"CD={ENV['COOLDOWN']} shorts={ENV['SHORTS']} EOD={ENV['EOD_HOUR']}:{ENV['EOD_MINUTE']:02d}",
          file=sys.stderr)

    data = load_data(ENV["CACHE_DIR"])
    print(f"Running simulation on {len(data)} symbols...", file=sys.stderr)

    all_trades = []
    for symbol, df in data.items():
        trades = sim_symbol(df)
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
