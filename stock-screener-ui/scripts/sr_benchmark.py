"""
SR Breakout Benchmark — reads from cached data, no API calls.

Parameters via environment variables:
  SR_SL=1.0          Stop loss %
  SR_TP=3.0          Take profit %
  SR_BUFFER=0.1      Breakout buffer %
  SR_PIVOT=classic   Pivot type: classic|fibonacci|camarilla
  SR_MIN_HOUR=9      Min entry hour (skip earlier breakouts)
  SR_MIN_MIN=15      Min entry minute
  SR_MAX_HOUR=15     Max entry hour
  SR_MAX_MIN=15      Max entry minute

Outputs METRIC lines for autoresearch:
  METRIC profit_factor=2.5
  METRIC win_rate=35
  METRIC total_pnl=150
  METRIC total_trades=16
  METRIC wins=6
  METRIC losses=8
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import os
import pickle

CACHE_FILE = Path(__file__).parent.parent / "experiments" / "sr_data_cache.pkl"


def simulate(symbol, candles_1m, entry_price, sl_price, tp_price, side, entry_idx):
    if candles_1m is None or candles_1m.empty or entry_idx is None:
        return None

    max_price = -float("inf")
    min_price = float("inf")

    for i in range(entry_idx, len(candles_1m)):
        h = float(candles_1m.iloc[i]["high"])
        l = float(candles_1m.iloc[i]["low"])
        max_price = max(max_price, h)
        min_price = min(min_price, l)

    exit_price = None
    exit_reason = None
    exit_idx = None

    for i in range(entry_idx + 1, len(candles_1m)):
        h = float(candles_1m.iloc[i]["high"])
        l = float(candles_1m.iloc[i]["low"])

        if side == "BUY":
            if l <= sl_price:
                exit_price = sl_price
                exit_reason = "SL"
                exit_idx = i
                break
            if h >= tp_price:
                exit_price = tp_price
                exit_reason = "TP"
                exit_idx = i
                break
        else:
            if h >= sl_price:
                exit_price = sl_price
                exit_reason = "SL"
                exit_idx = i
                break
            if l <= tp_price:
                exit_price = tp_price
                exit_reason = "TP"
                exit_idx = i
                break

    if exit_idx is None:
        exit_price = float(candles_1m.iloc[-1]["close"])
        exit_reason = "EOD"
        exit_idx = len(candles_1m) - 1

    if side == "BUY":
        pnl_pct = (exit_price - entry_price) / entry_price * 100
    else:
        pnl_pct = (entry_price - exit_price) / entry_price * 100

    return {
        "exit_reason": exit_reason,
        "pnl_pct": pnl_pct,
        "pnl": pnl_pct / 100 * entry_price,
        "hold_minutes": exit_idx - entry_idx,
        "mfe_pct": (max_price - entry_price) / entry_price * 100 if side == "BUY" else (entry_price - min_price) / entry_price * 100,
    }


def main():
    sl_pct = float(os.environ.get("SR_SL", "1.0"))
    tp_pct = float(os.environ.get("SR_TP", "3.0"))
    buffer_pct = float(os.environ.get("SR_BUFFER", "0.1"))
    pivot_type = os.environ.get("SR_PIVOT", "classic")
    min_hour = int(os.environ.get("SR_MIN_HOUR", "9"))
    min_min = int(os.environ.get("SR_MIN_MIN", "15"))
    max_hour = int(os.environ.get("SR_MAX_HOUR", "15"))
    max_min = int(os.environ.get("SR_MAX_MIN", "15"))

    with open(CACHE_FILE, "rb") as f:
        cache = pickle.load(f)

    pivot_key = f"pivot_{pivot_type}"

    trades = []

    for symbol, data in cache.items():
        if pivot_key not in data:
            continue

        pivot_points = data[pivot_key]
        intraday = data["intraday"]
        r1 = pivot_points.get("R1")
        s1 = pivot_points.get("S1")

        if r1 is None or s1 is None:
            continue

        buf = buffer_pct / 100
        entry_price = None
        side = None
        entry_idx = None

        for idx in range(len(intraday)):
            ts = intraday.index[idx]
            h, l, c = float(intraday.iloc[idx]["high"]), float(intraday.iloc[idx]["low"]), float(intraday.iloc[idx]["close"])
            hour = ts.hour if hasattr(ts, "hour") else 0
            minute = ts.minute if hasattr(ts, "minute") else 0

            if hour < min_hour or (hour == min_hour and minute < min_min):
                continue
            if hour > max_hour or (hour == max_hour and minute > max_min):
                break

            if c > r1 * (1 + buf):
                entry_price = c
                side = "BUY"
                entry_idx = idx
                break
            if l < s1 * (1 - buf):
                entry_price = c
                side = "SELL"
                entry_idx = idx
                break

        if entry_price is None or entry_idx is None:
            continue

        if side == "BUY":
            sl_price = round(entry_price * (1 - sl_pct / 100), 2)
            tp_price = round(entry_price * (1 + tp_pct / 100), 2)
        else:
            sl_price = round(entry_price * (1 + sl_pct / 100), 2)
            tp_price = round(entry_price * (1 - tp_pct / 100), 2)

        sim = simulate(symbol, intraday, entry_price, sl_price, tp_price, side, entry_idx)
        if sim is None:
            continue

        trades.append(sim)

    tp_trades = [t for t in trades if t["exit_reason"] == "TP"]
    sl_trades = [t for t in trades if t["exit_reason"] == "SL"]

    total_pnl = sum(t["pnl"] for t in trades)
    win_rate = len(tp_trades) / len(trades) * 100 if trades else 0

    if sl_trades and sum(t["pnl"] for t in sl_trades) != 0:
        pf = abs(sum(t["pnl"] for t in tp_trades) / sum(t["pnl"] for t in sl_trades))
    elif tp_trades:
        pf = float("inf")
    else:
        pf = 0.0

    print(f"METRIC profit_factor={pf:.2f}")
    print(f"METRIC win_rate={win_rate:.1f}")
    print(f"METRIC total_pnl={total_pnl:.0f}")
    print(f"METRIC total_trades={len(trades)}")
    print(f"METRIC wins={len(tp_trades)}")
    print(f"METRIC losses={len(sl_trades)}")
    print(f"METRIC eod={len(trades) - len(tp_trades) - len(sl_trades)}")
    print(f"METRIC avg_hold={sum(t['hold_minutes'] for t in tp_trades) / len(tp_trades) if tp_trades else 0:.0f}")


if __name__ == "__main__":
    main()
