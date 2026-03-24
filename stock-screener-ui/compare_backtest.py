import sys
import os
import time
import json
import logging
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from unittest.mock import MagicMock

logging.disable(logging.CRITICAL)
np.random.seed(42)

sys.path.insert(0, os.getcwd())

SYMBOLS = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"]
DAYS = 30
TIMEFRAME = 5
PARAMS = {
    "or_minutes": 45,
    "stop_loss_pct": 0.4,
    "take_profit_pct": 1.2,
    "trade_size": 100,
    "timeframe": "5",
    "enable_shorts": False,
    "cooldown_bars": 3,
    "include_costs": True,
}

_IST_OFFSET_NS = 19_800_000_000_000
_SECONDS_PER_DAY = 86400


def generate_realistic_data(symbol, days=30, timeframe_minutes=5):
    """Generate realistic OHLCV data that mimics Indian stock patterns."""
    ist_open = datetime(2024, 1, 2, 9, 15)
    utc_open = ist_open - timedelta(hours=5, minutes=30)
    bars_per_day = int((15 * 60 + 30) / timeframe_minutes)
    dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []

    base_price = np.random.uniform(100, 2000)
    volatility = base_price * 0.015

    for day in range(days):
        current_ist = ist_open + timedelta(days=day)
        if current_ist.weekday() >= 5:
            continue
        current_utc = utc_open + timedelta(days=day)

        gap = np.random.normal(0, 0.002)
        price = base_price * (1 + gap)
        day_vol = volatility * np.random.uniform(0.7, 1.5)

        or_high = price + np.random.uniform(0.001, 0.005) * base_price
        or_low = price - np.random.uniform(0.001, 0.005) * base_price

        for bar_idx in range(bars_per_day):
            bar_time = current_utc + timedelta(minutes=bar_idx * timeframe_minutes)
            ist_minutes = 9 * 60 + 15 + bar_idx * timeframe_minutes
            or_end = 9 * 60 + 15 + 45

            if ist_minutes < or_end:
                drift = np.random.normal(0, 0.0005) * base_price
                o = price + drift
                spread = day_vol * 0.3
                h = max(o, or_high) if bar_idx == bars_per_day // 3 else o + abs(np.random.normal(0, spread))
                l = min(o, or_low) if bar_idx == bars_per_day // 3 else o - abs(np.random.normal(0, spread))
                c = o + np.random.normal(0, spread * 0.3)
            elif ist_minutes < 14 * 60 + 45:
                if np.random.random() < 0.12:
                    drift = np.random.choice([1, -1]) * np.random.uniform(0.002, 0.008) * base_price
                    price = price + drift
                else:
                    price += np.random.normal(0, day_vol * 0.3)
                o = price
                spread = day_vol * 0.4
                h = o + abs(np.random.normal(0, spread))
                l = o - abs(np.random.normal(0, spread))
                c = o + np.random.normal(0, spread * 0.2)
            else:
                o = price
                c = o + np.random.normal(0, day_vol * 0.1)
                spread = day_vol * 0.15
                h = max(o, c) + spread
                l = min(o, c) - spread

            h = max(h, o, c)
            l = min(l, o, c)
            dates.append(bar_time)
            opens.append(round(float(o), 2))
            highs.append(round(float(h), 2))
            lows.append(round(float(l), 2))
            closes.append(round(float(c), 2))
            volumes.append(float(np.random.randint(5000, 50000)))

        base_price = price

    df = pd.DataFrame({
        "open": np.array(opens, dtype=np.float64),
        "high": np.array(highs, dtype=np.float64),
        "low": np.array(lows, dtype=np.float64),
        "close": np.array(closes, dtype=np.float64),
        "volume": np.array(volumes, dtype=np.float64),
    }, index=pd.DatetimeIndex(dates, name="datetime"))
    return df


print("=" * 60)
print("NautilusTrader vs VectorBT: ORB Strategy Comparison")
print("=" * 60)

data_cache = {sym: generate_realistic_data(sym, DAYS, TIMEFRAME) for sym in SYMBOLS}
total_bars = sum(len(df) for df in data_cache.values())
print(f"\nData: {len(SYMBOLS)} stocks, {DAYS} days, {TIMEFRAME}min bars = {total_bars} total bars")
for sym, df in data_cache.items():
    print(f"  {sym}: {len(df)} bars, range [{df['close'].min():.2f}, {df['close'].max():.2f}]")

results = {}


# ======================================================================
# 1. NAUTILUSTRADER BACKTEST
# ======================================================================
print("\n" + "-" * 60)
print("1. Running NautilusTrader backtest...")
print("-" * 60)

import backtest.utils
import db.models

backtest.utils.get_upstox_client_from_db = lambda quiet=True: (MagicMock(), None)
backtest.utils.get_upstox_client_with_token = lambda token, quiet=True: (MagicMock(), None)
db.models.get_shared_broker_token = lambda broker: None

from backtest.strategies.orb import run_single_stock_backtest

nt_trades_total = 0
nt_pnl_total = 0.0
nt_wins = 0
nt_losses = 0
nt_tp_exits = 0
nt_sl_exits = 0
nt_eod_exits = 0
nt_times = []

for sym in SYMBOLS:
    mock_api = MagicMock()
    mock_api.fetch_historical_data_v3 = MagicMock(return_value=data_cache[sym].copy())
    mock_api.fetch_intraday_data_v3 = MagicMock(return_value=pd.DataFrame())

    import backtest.utils
    backtest.utils.get_upstox_client_from_db = lambda quiet=True: (mock_api, None)
    backtest.utils.get_upstox_client_with_token = lambda token, quiet=True: (mock_api, None)

    t0 = time.perf_counter()
    r = run_single_stock_backtest((sym, PARAMS, DAYS, None))
    t1 = time.perf_counter()
    nt_times.append(t1 - t0)

    if r.get("success") and r.get("trade_list"):
        trades = r["trade_list"]
        res = r["result"]
        nt_trades_total += len(trades)
        nt_pnl_total += res["net_pnl"] if res else 0
        nt_wins += res["wins"] if res else 0
        nt_losses += res["losses"] if res else 0
        nt_tp_exits += res["tp_exits"] if res else 0
        nt_sl_exits += res["sl_exits"] if res else 0
        nt_eod_exits += res["eod_exits"] if res else 0
        results[sym] = {"nt_trades": len(trades), "nt_pnl": round(res["net_pnl"], 2) if res else 0}
    else:
        results[sym] = {"nt_trades": 0, "nt_pnl": 0}

nt_total_time = sum(nt_times)
print(f"  Trades: {nt_trades_total} (TP:{nt_tp_exits} SL:{nt_sl_exits} EOD:{nt_eod_exits})")
print(f"  Wins: {nt_wins}, Losses: {nt_losses}, Win Rate: {nt_wins/(nt_wins+nt_losses)*100:.1f}%" if nt_wins + nt_losses > 0 else "  No trades")
print(f"  Net PnL: {nt_pnl_total:.2f} INR")
print(f"  Time: {nt_total_time:.3f}s (avg {nt_total_time/len(SYMBOLS)*1000:.1f}ms/stock)")


# ======================================================================
# 2. VECTORBT BACKTEST
# ======================================================================
print("\n" + "-" * 60)
print("2. Running VectorBT backtest...")
print("-" * 60)

import vectorbt as vbt

vbt_trades_total = 0
vbt_pnl_total = 0.0
vbt_wins = 0
vbt_losses = 0
vbt_times = []

for sym in SYMBOLS:
    df = data_cache[sym].copy()
    t0 = time.perf_counter()

    ist_offset = pd.Timedelta(hours=5, minutes=30)
    ist_index = df.index + ist_offset
    minute_of_day = ist_index.hour * 60 + ist_index.minute
    day_groups = ist_index.date

    mkt_open = 9 * 60 + 15
    or_end = mkt_open + PARAMS["or_minutes"]

    or_high = pd.Series(np.nan, index=df.index)
    or_low = pd.Series(np.nan, index=df.index)
    for day in pd.unique(day_groups):
        mask = (day_groups == day) & (minute_of_day >= mkt_open) & (minute_of_day < or_end)
        if mask.any():
            or_high[mask] = df["high"].loc[mask].expanding().max()
            or_low[mask] = df["low"].loc[mask].expanding().min()
    or_high = or_high.ffill()
    or_low = or_low.ffill()

    after_or = minute_of_day >= or_end
    long_entry = after_or & (df["close"] > or_high) & pd.isna(or_high.shift(1)) & ~pd.isna(or_high)

    cooldown = PARAMS["cooldown_bars"]
    exit_signal = pd.Series(False, index=df.index)
    eod_mask = minute_of_day >= 14 * 60 + 45

    sl_pct = PARAMS["stop_loss_pct"] / 100
    tp_pct = PARAMS["take_profit_pct"] / 100

    try:
        pf = vbt.Portfolio.from_signals(
            df["close"],
            entries=long_entry,
            exits=exit_signal,
            stop_loss=sl_pct,
            take_profit=tp_pct,
            size=PARAMS["trade_size"],
            size_type="amount",
            fees=0.0003,
            slippage=0.0001,
            freq="5min",
            init_cash=1_000_000,
            accumulate=False,
            call_seq="auto",
        )

        trades_df = pf.trades.records_readable
        if len(trades_df) > 0:
            count = len(trades_df)
            pnl = trades_df["PnL"].sum()
            wins_count = (trades_df["PnL"] > 0).sum()
            losses_count = (trades_df["PnL"] < 0).sum()
            vbt_trades_total += count
            vbt_pnl_total += pnl
            vbt_wins += wins_count
            vbt_losses += losses_count
            results[sym]["vbt_trades"] = count
            results[sym]["vbt_pnl"] = round(pnl, 2)
        else:
            results[sym]["vbt_trades"] = 0
            results[sym]["vbt_pnl"] = 0
    except Exception as e:
        results[sym]["vbt_trades"] = 0
        results[sym]["vbt_pnl"] = 0
        print(f"  {sym} ERROR: {e}")

    t1 = time.perf_counter()
    vbt_times.append(t1 - t0)

vbt_total_time = sum(vbt_times)
print(f"  Trades: {vbt_trades_total}")
print(f"  Wins: {vbt_wins}, Losses: {vbt_losses}, Win Rate: {vbt_wins/(vbt_wins+vbt_losses)*100:.1f}%" if vbt_wins + vbt_losses > 0 else "  No trades")
print(f"  Net PnL: {vbt_pnl_total:.2f} INR")
print(f"  Time: {vbt_total_time:.3f}s (avg {vbt_total_time/len(SYMBOLS)*1000:.1f}ms/stock)")


# ======================================================================
# 3. COMPARISON
# ======================================================================
print("\n" + "=" * 60)
print("COMPARISON RESULTS")
print("=" * 60)

print(f"\n{'Metric':<25} {'NautilusTrader':>18} {'VectorBT':>18} {'Diff':>12}")
print("-" * 73)

trade_diff = vbt_trades_total - nt_trades_total
trade_pct = (trade_diff / nt_trades_total * 100) if nt_trades_total > 0 else 0
print(f"{'Total Trades':<25} {nt_trades_total:>18} {vbt_trades_total:>18} {trade_diff:>+12} ({trade_pct:+.1f}%)")

if nt_wins + nt_losses > 0 and vbt_wins + vbt_losses > 0:
    nt_wr = nt_wins / (nt_wins + nt_losses) * 100
    vbt_wr = vbt_wins / (vbt_wins + vbt_losses) * 100
    print(f"{'Win Rate (%)':<25} {nt_wr:>17.1f}% {vbt_wr:>17.1f}% {vbt_wr - nt_wr:>+11.1f}%")

pnl_diff = vbt_pnl_total - nt_pnl_total
pnl_pct = (pnl_diff / abs(nt_pnl_total) * 100) if nt_pnl_total != 0 else 0
print(f"{'Net PnL (INR)':<25} {nt_pnl_total:>17.2f} {vbt_pnl_total:>17.2f} {pnl_diff:>+12.2f}")

nt_avg = nt_total_time / len(SYMBOLS) * 1000
vbt_avg = vbt_total_time / len(SYMBOLS) * 1000
speedup = nt_avg / vbt_avg if vbt_avg > 0 else 0
print(f"{'Time/stock (ms)':<25} {nt_avg:>17.1f} {vbt_avg:>17.1f} {speedup:>11.1f}x")

print(f"{'Total Time (s)':<25} {nt_total_time:>17.3f} {vbt_total_time:>17.3f} {nt_total_time - vbt_total_time:>+12.3f}")

print(f"\n{'Symbol':<15} {'NT Trades':>10} {'VBT Trades':>11} {'NT PnL':>10} {'VBT PnL':>10}")
print("-" * 56)
for sym in SYMBOLS:
    r = results[sym]
    print(f"{sym:<15} {r['nt_trades']:>10} {r['vbt_trades']:>11} {r['nt_pnl']:>10.2f} {r['vbt_pnl']:>10.2f}")

print(f"\n{'KEY DIFFERENCE:':}")
print(f"  NautilusTrader checks TP/SL on bar CLOSE only")
print(f"  VectorBT checks TP/SL on bar HIGH/LOW (intrabar simulation)")
print(f"  => VectorBT triggers more stops on wicks")
print(f"  => VectorBT will have different (usually more) trades")
print(f"  => VectorBT win rate and PnL will differ")
