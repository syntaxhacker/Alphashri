"""Shared NEWGEN experiment library for parallel intraday autoresearch sessions.

Single source of data loading (Upstox-only newgen_cache.pkl), cost calculation,
metrics aggregation, and a timeframe-aware ORB simulator. Other strategy sims
(SR breakout, EMA cross, supertrend, BB, short, volume surge) are written by each
session's benchmark script but all use load_newgen + compute_metrics + calc_costs
from here so results are comparable.

Env vars honored:
  NEWGEN_TF=5           primary candle timeframe (5/10/15/60)
  NEWGEN_DATE_START=    YYYY-MM-DD start filter (IST)
  NEWGEN_DATE_END=      YYYY-MM-DD end filter (IST)
  NEWGEN_TRADE_SIZE=100 shares per trade
  NEWGEN_CAPITAL=100000 capital per trade
  NEWGEN_COSTS=1        include round-trip costs (1=yes, 0=no)
"""
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

import config as root_config
IST = root_config.IST

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CACHE_PATH = os.path.join(DATA_DIR, "newgen_cache.pkl")

BROKERAGE_PCT = 0.0003
STT_PCT = 0.00025
EXCHANGE_PCT = 0.0000297
SEBI_PCT = 0.000001
STAMP_DUTY_PCT = 0.00003
GST_PCT = 0.18


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def load_newgen(tf: int) -> pd.DataFrame:
    """Load NEWGEN candles for a timeframe from the shared Upstox cache."""
    with open(CACHE_PATH, "rb") as f:
        import pickle
        cache = pickle.load(f)
    df = cache[tf].copy()
    if df.index.tz is None:
        df.index = pd.DatetimeIndex(df.index).tz_localize(IST)
    else:
        df.index = df.index.tz_convert(IST)
    return df.sort_index()


def filter_dates(df: pd.DataFrame, date_start: str = "", date_end: str = "") -> pd.DataFrame:
    if date_start:
        df = df[df.index >= pd.Timestamp(date_start, tz=IST)]
    if date_end:
        df = df[df.index <= pd.Timestamp(date_end + " 23:59:59", tz=IST)]
    return df


def time_in_minutes(ts: pd.Timestamp) -> int:
    return ts.hour * 60 + ts.minute


# ---------------------------------------------------------------------------
# Costs
# ---------------------------------------------------------------------------
def calc_costs(entry_price: float, exit_price: float, quantity: int, side: str = "LONG") -> float:
    """Round-trip intraday costs (mirrors experiments/ema_benchmark.calc_costs)."""
    buy_value = entry_price * quantity if side == "LONG" else exit_price * quantity
    sell_value = exit_price * quantity if side == "LONG" else entry_price * quantity
    buy_brk = min(20, buy_value * BROKERAGE_PCT)
    buy_stamp = buy_value * STAMP_DUTY_PCT
    buy_exch = buy_value * EXCHANGE_PCT
    buy_sebi = buy_value * SEBI_PCT
    buy_gst = GST_PCT * (buy_brk + buy_exch + buy_sebi)
    buy_total = buy_brk + buy_stamp + buy_exch + buy_sebi + buy_gst
    sell_brk = min(20, sell_value * BROKERAGE_PCT)
    sell_stt = sell_value * STT_PCT
    sell_exch = sell_value * EXCHANGE_PCT
    sell_sebi = sell_value * SEBI_PCT
    sell_gst = GST_PCT * (sell_brk + sell_exch + sell_sebi)
    sell_total = sell_brk + sell_stt + sell_exch + sell_sebi + sell_gst
    return round(buy_total + sell_total, 2)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
def compute_metrics(trades: list) -> dict:
    """Aggregate metrics from a list of trade dicts with 'net_pnl' and 'exit_reason'."""
    if not trades:
        return {
            "total_trades": 0, "wins": 0, "losses": 0, "net_pnl": 0.0,
            "profit_factor": 0.0, "win_rate": 0.0,
            "tp_exits": 0, "sl_exits": 0, "eod_exits": 0,
        }
    wins = [t for t in trades if t["net_pnl"] > 0]
    losses = [t for t in trades if t["net_pnl"] <= 0]
    gross_profit = sum(t["net_pnl"] for t in wins)
    gross_loss = abs(sum(t["net_pnl"] for t in losses))
    net_pnl = sum(t["net_pnl"] for t in trades)
    return {
        "total_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "net_pnl": round(net_pnl, 2),
        "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss > 0 else (99.9999 if gross_profit > 0 else 0.0),
        "win_rate": round(len(wins) / len(trades) * 100, 1) if trades else 0.0,
        "tp_exits": sum(1 for t in trades if t["exit_reason"] == "TP"),
        "sl_exits": sum(1 for t in trades if t["exit_reason"] == "SL"),
        "eod_exits": sum(1 for t in trades if t["exit_reason"] == "EOD"),
    }


def print_metrics(metrics: dict):
    """Print METRIC lines for autoresearch."""
    for key, val in metrics.items():
        print(f"METRIC {key}={val}")


# ---------------------------------------------------------------------------
# ORB simulator (timeframe aware)
# ---------------------------------------------------------------------------
def simulate_orb(
    df: pd.DataFrame,
    or_minutes: int = 15,
    sl_pct: float = 1.0,
    tp_pct: float = 1.5,
    buffer_pct: float = 0.3,
    cooldown_bars: int = 1,
    shorts: bool = False,
    trade_size: int = 100,
    eod_exit_minutes: int = 900,
    min_entry_minutes: int = 0,
    max_per_day: int = 0,
    include_costs: bool = True,
    min_or_range_pct: float = 0.3,
    max_or_range_pct: float = 5.0,
) -> list:
    """Opening Range Breakout on intraday candles. Returns list of trade dicts.

    OR = first `or_minutes` after 9:15 IST. Breakout entry on close above OR high
    (+ buffer%) / below OR low (- buffer%). Exit on TP/SL/EOD (close-based checks,
    matching trading/orb_signals.py behavior). Costs via calc_costs when enabled.
    """
    MKT_OPEN = 9 * 60 + 15
    df = df.copy()
    df["ist_time"] = df.index.map(lambda x: x.tz_convert(IST))
    df["time_minutes"] = df["ist_time"].map(time_in_minutes)

    trades = []
    or_end = MKT_OPEN + or_minutes
    dates = sorted(set(d.date() for d in df["ist_time"]))

    for date in dates:
        day_df = df[df["ist_time"].dt.date == date]
        if len(day_df) < 5:
            continue
        pre_or = day_df[(day_df["time_minutes"] >= MKT_OPEN) & (day_df["time_minutes"] < or_end)]
        post_or = day_df[day_df["time_minutes"] >= or_end]
        if len(pre_or) < 1 or len(post_or) < 1:
            continue

        or_high = pre_or["high"].max()
        or_low = pre_or["low"].min()
        or_range_pct = (or_high - or_low) / or_low * 100 if or_low > 0 else 0
        if or_range_pct < min_or_range_pct or or_range_pct > max_or_range_pct:
            continue

        long_entry = or_high * (1 + buffer_pct / 100)
        short_entry = or_low * (1 - buffer_pct / 100)

        day_trades = 0
        last_exit_i = -cooldown_bars - 1
        in_position = False
        position = {}

        for i, (idx, row) in enumerate(post_or.iterrows()):
            if in_position:
                pos = position
                if pos["side"] == "LONG":
                    sl_hit = row["low"] <= pos["sl"]
                    tp_hit = row["high"] >= pos["tp"]
                else:
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
                costs = calc_costs(pos["entry"], exit_price, trade_size, pos["side"]) if include_costs else 0.0
                trades.append({
                    "side": pos["side"], "entry": pos["entry"], "exit": exit_price,
                    "gross_pnl": gross_pnl, "costs": costs,
                    "net_pnl": gross_pnl - costs, "exit_reason": exit_reason,
                    "entry_time": idx, "exit_time": idx, "date": str(date),
                })
                in_position = False
                last_exit_i = i
                day_trades += 1
                if max_per_day > 0 and day_trades >= max_per_day:
                    break
                continue

            if (i - last_exit_i) < cooldown_bars:
                continue
            if row["time_minutes"] >= eod_exit_minutes:
                continue
            if min_entry_minutes > 0 and (row["time_minutes"] - MKT_OPEN) < min_entry_minutes:
                continue

            if shorts and row["close"] < short_entry:
                price = row["close"]
                position = {
                    "side": "SHORT", "entry": price,
                    "sl": price * (1 + sl_pct / 100), "tp": price * (1 - tp_pct / 100),
                }
                in_position = True
                continue

            if row["close"] > long_entry:
                price = row["close"]
                position = {
                    "side": "LONG", "entry": price,
                    "sl": price * (1 - sl_pct / 100), "tp": price * (1 + tp_pct / 100),
                }
                in_position = True

    return trades


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NEWGEN shared lib sanity check")
    parser.add_argument("--tf", type=int, default=5)
    args = parser.parse_args()
    df = load_newgen(args.tf)
    print(f"tf={args.tf}m rows={len(df)} range={df.index[0]}..{df.index[-1]}", file=sys.stderr)
    trades = simulate_orb(df, or_minutes=15)
    m = compute_metrics(trades)
    print(f"ORB(OR=15) trades={m['total_trades']} PF={m['profit_factor']}", file=sys.stderr)
    print_metrics(m)
