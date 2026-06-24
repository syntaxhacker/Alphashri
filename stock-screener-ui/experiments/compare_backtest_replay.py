#!/usr/bin/env python3
"""
Compare sector_scan.py ORB backtest vs actual ORBSignalGenerator logic
on the same yfinance 5-min data for 5 volatile beta stocks.
"""
import sys, os, pickle, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np

IST = pd.Timestamp.now(tz='Asia/Kolkata').tz if hasattr(pd.Timestamp.now(tz='Asia/Kolkata'), 'tz') else None

# Load cached yfinance data
CACHE = '../experiments/data/sector_scan_cache.pkl'
with open(CACHE, 'rb') as f:
    cache = pickle.load(f)

ORB_PARAMS = {
    "OR_MIN": 45, "SL": 1.2, "TP": 2.0, "BUFFER": 0.62,
    "COOLDOWN": 50, "SHORTS": 0, "TRADE_SIZE": 100, "EOD_EXIT": 900,
}

# Volatile beta stocks (from cache, mix of sectors)
STOCKS = ["RELIANCE", "PFOCUS", "HFCL", "ADANIENSOL", "IDEA"]

def simulate_orb_high_entry(df: pd.DataFrame, params: dict) -> list:
    """Original high-based entry from sector_scan.py."""
    or_min = params["OR_MIN"]
    sl_pct = params["SL"] / 100.0
    tp_pct = params["TP"] / 100.0
    buffer_pct = params["BUFFER"] / 100.0
    cooldown = params["COOLDOWN"]
    enable_shorts = params["SHORTS"]
    eod_exit_min = params["EOD_EXIT"]
    
    market_open = 9*60 + 15
    trades = []
    cooldown_until = {}
    
    df = df.copy()
    df["date"] = df.index.date
    df["minute"] = df.index.hour * 60 + df.index.minute
    
    for date, day_df in df.groupby("date"):
        day_df = day_df.sort_index()
        or_end = market_open + or_min
        or_mask = (day_df["minute"] >= market_open) & (day_df["minute"] < or_end)
        or_slice = day_df[or_mask]
        if or_slice.empty:
            continue
        or_high = or_slice["High"].max()
        or_low = or_slice["Low"].min()
        or_range = or_high - or_low
        if or_range == 0:
            continue
        
        post_mask = (day_df["minute"] >= or_end) & (day_df["minute"] < eod_exit_min)
        post_day = day_df[post_mask]
        if post_day.empty:
            continue
        
        long_entry = or_high * (1 + buffer_pct)
        long_sl = long_entry * (1 - sl_pct)
        long_tp = long_entry * (1 + tp_pct)
        
        for idx, row in post_day.iterrows():
            sym = str(date)
            if sym in cooldown_until and idx < cooldown_until[sym]:
                continue
            
            o, h, l, c = row["Open"], row["High"], row["Low"], row["Close"]
            
            if h >= long_entry:
                entry_price = long_entry
                exit_price = c
                exit_reason = "EOD"
                if l <= long_sl:
                    exit_price = long_sl
                    exit_reason = "SL"
                elif h >= long_tp:
                    exit_price = long_tp
                    exit_reason = "TP"
                pnl_pct = (exit_price - entry_price) / entry_price * 100
                trades.append({
                    "date": str(date), "time": str(idx.time()),
                    "direction": "LONG", "entry": entry_price, "exit": exit_price,
                    "pnl_pct": round(pnl_pct, 2), "reason": exit_reason,
                })
                cooldown_until[sym] = idx + pd.Timedelta(minutes=5 * cooldown)
    
    return trades

def simulate_orb_close_entry(df: pd.DataFrame, params: dict) -> list:
    """Close-based entry matching the actual ORBSignalGenerator + runner logic."""
    or_min = params["OR_MIN"]
    sl_pct = params["SL"] / 100.0
    tp_pct = params["TP"] / 100.0
    buffer_pct = params["BUFFER"] / 100.0
    cooldown = params["COOLDOWN"]
    eod_exit_min = params["EOD_EXIT"]
    
    market_open = 9*60 + 15
    trades = []
    cooldown_until = {}
    
    df = df.copy()
    df["date"] = df.index.date
    df["minute"] = df.index.hour * 60 + df.index.minute
    
    for date, day_df in df.groupby("date"):
        day_df = day_df.sort_index()
        or_end = market_open + or_min
        or_mask = (day_df["minute"] >= market_open) & (day_df["minute"] < or_end)
        or_slice = day_df[or_mask]
        if or_slice.empty:
            continue
        or_high = or_slice["High"].max()
        or_low = or_slice["Low"].min()
        or_range = or_high - or_low
        if or_range == 0:
            continue
        
        post_mask = (day_df["minute"] >= or_end) & (day_df["minute"] < eod_exit_min)
        post_day = day_df[post_mask]
        if post_day.empty:
            continue
        
        long_entry = or_high * (1 + buffer_pct)
        
        for idx, row in post_day.iterrows():
            sym = str(date)
            if sym in cooldown_until and idx < cooldown_until[sym]:
                continue
            
            o, h, l, c = row["Open"], row["High"], row["Low"], row["Close"]
            
            # Close-based entry (matches ORBSignalGenerator.check_breakout)
            if c > long_entry:
                entry_price = c
                sl = entry_price * (1 - sl_pct)
                tp = entry_price * (1 + tp_pct)
                
                # Check SL/TP within entry candle itself, then rest of day
                exit_price = c
                exit_reason = "EOD"
                if l <= sl:
                    exit_price = sl
                    exit_reason = "SL"
                elif h >= tp:
                    exit_price = tp
                    exit_reason = "TP"
                else:
                    rest = post_day.loc[post_day.index > idx]
                    if not rest.empty:
                        exit_price = rest.iloc[-1]["Close"]
                    for _, r2 in rest.iterrows():
                        if r2["Low"] <= sl:
                            exit_price = sl
                            exit_reason = "SL"
                            break
                        if r2["High"] >= tp:
                            exit_price = tp
                            exit_reason = "TP"
                            break
                pnl_pct = (exit_price - entry_price) / entry_price * 100
                trades.append({
                    "date": str(date), "time": str(idx.time()),
                    "direction": "LONG", "entry": entry_price, "exit": exit_price,
                    "pnl_pct": round(pnl_pct, 2), "reason": exit_reason,
                })
                cooldown_until[sym] = idx + pd.Timedelta(minutes=5 * cooldown)
    
    return trades

# Run comparison
print(f"{'Stock':<12} {'Method':<12} {'Trades':>6} {'Wins':>5} {'WR%':>5} {'AvgPnL%':>8} {'PF':>6}")
print("=" * 55)

for sym in STOCKS:
    raw_sym = sym
    if raw_sym not in cache:
        # Try with .NS suffix normalized
        found = None
        for k in cache:
            if k.upper() == raw_sym.upper() or k.upper().replace('.NS','') == raw_sym.upper():
                found = k
                break
        if found:
            raw_sym = found
        else:
            print(f"{sym:<12} SKIP (no data)")
            continue
    
    df = cache[raw_sym]
    
    for method_name, method_fn in [("HIGH_ENTRY", simulate_orb_high_entry), ("CLOSE_ENTRY", simulate_orb_close_entry)]:
        trades = method_fn(df, ORB_PARAMS)
        n = len(trades)
        wins = sum(1 for t in trades if t["pnl_pct"] > 0)
        wr = (wins / n * 100) if n > 0 else 0
        avg_pnl = np.mean([t["pnl_pct"] for t in trades]) if n > 0 else 0
        gross_win = sum(t["pnl_pct"] for t in trades if t["pnl_pct"] > 0) if wins > 0 else 0
        gross_loss = abs(sum(t["pnl_pct"] for t in trades if t["pnl_pct"] <= 0)) if n - wins > 0 else 1
        pf = round(gross_win / gross_loss, 2) if gross_loss > 0 else 999
        print(f"{sym:<12} {method_name:<12} {n:>6} {wins:>5} {wr:>5.1f} {avg_pnl:>8.2f} {pf:>6}")
    
    print()

# Also show trade-level comparison for RELIANCE
print("\n=== Trade-level comparison: RELIANCE ===")
df = cache["RELIANCE"]
high_trades = simulate_orb_high_entry(df, ORB_PARAMS)
close_trades = simulate_orb_close_entry(df, ORB_PARAMS)
print(f"\nHIGH_ENTRY ({len(high_trades)} trades):")
for t in high_trades[:10]:
    print(f"  {t['date']} {t['time']} {t['direction']:5} entry={t['entry']:.1f} exit={t['exit']:.1f} "
          f"pnl={t['pnl_pct']:+.2f}% {t['reason']}")
print(f"\nCLOSE_ENTRY ({len(close_trades)} trades):")
for t in close_trades[:10]:
    print(f"  {t['date']} {t['time']} {t['direction']:5} entry={t['entry']:.1f} exit={t['exit']:.1f} "
          f"pnl={t['pnl_pct']:+.2f}% {t['reason']}")
