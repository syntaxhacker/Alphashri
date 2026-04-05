"""
SR Breakout Multi-Day Benchmark — reads from cached data, no API calls.

Runs the strategy simulation across ALL cached trading days and reports
aggregate metrics (PF, WR, PnL) plus per-day breakdown.

Parameters via environment variables:
  SR_SL=0.6          Stop loss %
  SR_TP=2.0          Take profit %
  SR_BUFFER=0.1      Breakout buffer %
  SR_PIVOT=camarilla Pivot type: classic|fibonacci|camarilla
  SR_MIN_HOUR=10     Min entry hour
  SR_MIN_MIN=30      Min entry minute
  SR_MAX_HOUR=15     Max entry hour
  SR_MAX_MIN=15      Max entry minute

Outputs METRIC lines for autoresearch:
  METRIC profit_factor=2.5
  METRIC win_rate=35
  METRIC total_pnl=1500
  METRIC avg_daily_pnl=50
  METRIC total_trades=320
  METRIC winning_days_pct=65
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import os
import pickle

DATA_DIR = Path(__file__).parent / "data"


def simulate(candles_1m, entry_price, sl_price, tp_price, side, entry_idx):
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
                exit_price, exit_reason, exit_idx = sl_price, "SL", i
                break
            if h >= tp_price:
                exit_price, exit_reason, exit_idx = tp_price, "TP", i
                break
        else:
            if h >= sl_price:
                exit_price, exit_reason, exit_idx = sl_price, "SL", i
                break
            if l <= tp_price:
                exit_price, exit_reason, exit_idx = tp_price, "TP", i
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


def calc_pivot(pivot_type, prev_high, prev_low, prev_close):
    pp = (prev_high + prev_low + prev_close) / 3
    hl = prev_high - prev_low
    if pivot_type == "classic":
        r1 = 2 * pp - prev_low
        s1 = 2 * pp - prev_high
        r2 = pp + hl
        s2 = pp - hl
    elif pivot_type == "fibonacci":
        r1 = pp + 0.382 * hl
        s1 = pp - 0.382 * hl
        r2 = pp + 0.618 * hl
        s2 = pp - 0.618 * hl
    elif pivot_type == "camarilla":
        r1 = prev_high + 0.0917 * hl
        s1 = prev_low - 0.0917 * hl
        r2 = prev_high + 0.183 * hl
        s2 = prev_low - 0.183 * hl
    else:
        r1 = 2 * pp - prev_low
        s1 = 2 * pp - prev_high
        r2 = pp + hl
        s2 = pp - hl
    return {"R1": round(r1, 2), "S1": round(s1, 2), "R2": round(r2, 2), "S2": round(s2, 2)}


def main():
    sl_pct = float(os.environ.get("SR_SL", "0.6"))
    tp_pct = float(os.environ.get("SR_TP", "2.0"))
    buffer_pct = float(os.environ.get("SR_BUFFER", "0.1"))
    pivot_type = os.environ.get("SR_PIVOT", "camarilla")
    min_hour = int(os.environ.get("SR_MIN_HOUR", "10"))
    min_min = int(os.environ.get("SR_MIN_MIN", "30"))
    max_hour = int(os.environ.get("SR_MAX_HOUR", "15"))
    max_min = int(os.environ.get("SR_MAX_MIN", "15"))

    with open(DATA_DIR / "daily" / "all_daily.pkl", "rb") as f:
        daily_cache = pickle.load(f)
    with open(DATA_DIR / "intraday" / "all_intraday.pkl", "rb") as f:
        intraday_cache = pickle.load(f)

    days_file = DATA_DIR / "trading_days.txt"
    if days_file.exists():
        with open(days_file) as f:
            trading_days = [line.strip() for line in f if line.strip()]
    else:
        trading_days = sorted(set(d for _, d in intraday_cache.keys()))

    all_trades = []
    daily_pnls = []
    daily_details = []

    for day in trading_days:
        day_trades = []

        for symbol in daily_cache:
            daily_df = daily_cache[symbol]
            if daily_df is None or daily_df.empty:
                continue

            idx = None
            for i in range(len(daily_df)):
                d = daily_df.index[i]
                ds = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)[:10]
                if ds == day:
                    idx = i
                    break
                if ds > day:
                    break

            if idx is None or idx < 1:
                continue

            prev_row = daily_df.iloc[idx - 1]
            prev_high = float(prev_row["high"])
            prev_low = float(prev_row["low"])
            prev_close = float(prev_row["close"])

            pivot_points = calc_pivot(pivot_type, prev_high, prev_low, prev_close)
            r1 = pivot_points.get("R1")
            s1 = pivot_points.get("S1")

            intraday = intraday_cache.get((symbol, day))
            if intraday is None or intraday.empty or r1 is None or s1 is None:
                continue

            buf = buffer_pct / 100
            entry_price = None
            side = None
            entry_idx = None

            for i_idx in range(len(intraday)):
                ts = intraday.index[i_idx]
                h = float(intraday.iloc[i_idx]["high"])
                l = float(intraday.iloc[i_idx]["low"])
                c = float(intraday.iloc[i_idx]["close"])
                hour = ts.hour if hasattr(ts, "hour") else 0
                minute = ts.minute if hasattr(ts, "minute") else 0

                if hour < min_hour or (hour == min_hour and minute < min_min):
                    continue
                if hour > max_hour or (hour == max_hour and minute > max_min):
                    break

                if c > r1 * (1 + buf):
                    entry_price, side, entry_idx = c, "BUY", i_idx
                    break
                if l < s1 * (1 - buf):
                    entry_price, side, entry_idx = c, "SELL", i_idx
                    break

            if entry_price is None:
                continue

            if side == "BUY":
                sl_price = round(entry_price * (1 - sl_pct / 100), 2)
                tp_price = round(entry_price * (1 + tp_pct / 100), 2)
            else:
                sl_price = round(entry_price * (1 + sl_pct / 100), 2)
                tp_price = round(entry_price * (1 - tp_pct / 100), 2)

            sim = simulate(intraday, entry_price, sl_price, tp_price, side, entry_idx)
            if sim is None:
                continue

            sim["symbol"] = symbol
            sim["side"] = side
            sim["day"] = day
            day_trades.append(sim)

        day_pnl = sum(t["pnl"] for t in day_trades)
        day_tp = sum(1 for t in day_trades if t["exit_reason"] == "TP")
        day_sl = sum(1 for t in day_trades if t["exit_reason"] == "SL")
        daily_pnls.append(day_pnl)
        daily_details.append({
            "day": day,
            "trades": len(day_trades),
            "wins": day_tp,
            "losses": day_sl,
            "pnl": day_pnl,
        })
        all_trades.extend(day_trades)

    if not all_trades:
        print("METRIC profit_factor=0")
        print("METRIC win_rate=0")
        print("METRIC total_pnl=0")
        print("METRIC avg_daily_pnl=0")
        print("METRIC total_trades=0")
        print("METRIC winning_days_pct=0")
        print("METRIC days=0")
        return

    tp_trades = [t for t in all_trades if t["exit_reason"] == "TP"]
    sl_trades = [t for t in all_trades if t["exit_reason"] == "SL"]
    winning_days = sum(1 for p in daily_pnls if p > 0)
    total_pnl = sum(daily_pnls)
    avg_daily = total_pnl / len(daily_pnls) if daily_pnls else 0

    if sl_trades and sum(t["pnl"] for t in sl_trades) != 0:
        pf = abs(sum(t["pnl"] for t in tp_trades) / sum(t["pnl"] for t in sl_trades))
    elif tp_trades:
        pf = float("inf")
    else:
        pf = 0.0

    win_rate = len(tp_trades) / len(all_trades) * 100 if all_trades else 0

    print(f"METRIC profit_factor={pf:.2f}")
    print(f"METRIC win_rate={win_rate:.1f}")
    print(f"METRIC total_pnl={total_pnl:.0f}")
    print(f"METRIC avg_daily_pnl={avg_daily:.0f}")
    print(f"METRIC total_trades={len(all_trades)}")
    print(f"METRIC wins={len(tp_trades)}")
    print(f"METRIC losses={len(sl_trades)}")
    print(f"METRIC eod={len(all_trades) - len(tp_trades) - len(sl_trades)}")
    print(f"METRIC winning_days_pct={winning_days / len(daily_pnls) * 100:.1f}")
    print(f"METRIC days={len(daily_pnls)}")
    print(f"METRIC avg_trades_per_day={len(all_trades) / len(daily_pnls):.1f}")


if __name__ == "__main__":
    main()
