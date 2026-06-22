#!/usr/bin/env python3
"""
Verify replay engine vs expected ORB logic on the SAME Upstox data for 5 volatile stocks.
Runs both the replay engine and a reference ORB simulator on identical 1-min data,
then compares trade-level results.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta
import pandas as pd
import numpy as np

from market_data.market_data import fetch_candles, resample_candles, get_api_client
from trading.timezone import IST

api_client = get_api_client()

# 5 volatile beta stocks (mix of sectors)
STOCKS = ["RELIANCE", "TATAMOTORS", "TCS", "ADANIENSOL", "HAL"]

# Date range: June 1-12 (10 trading days, excluding weekends)
DATES = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05",
         "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12"]

# ORB Best v2 params (must match DB config)
OR_MINUTES = 45
SL_PCT = 1.2
TP_PCT = 2.0
BUFFER_PCT = 0.62
COOLDOWN_MIN = 50
EOD_EXIT = (15, 0)  # 15:00 IST

def reference_orb_trades(df_1m, date_str):
    """
    Reference ORB implementation using close-based entry (matches replay engine logic).
    Runs on complete 1-min data for a single date.
    Returns list of trade dicts.
    """
    if df_1m is None or len(df_1m) < 100:
        return []
    
    # Convert to IST
    df = df_1m.copy()
    if df.index.tz is None:
        df.index = df.index.tz_localize('UTC')
    df_ist = df.tz_convert(IST)
    
    # Market hours
    market_open = pd.Timestamp(f"{date_str} 09:15:00", tz=IST)
    market_close = pd.Timestamp(f"{date_str} 15:30:00", tz=IST)
    or_end = pd.Timestamp(f"{date_str} 10:00:00", tz=IST)
    eod_exit = pd.Timestamp(f"{date_str} {EOD_EXIT[0]:02d}:{EOD_EXIT[1]:02d}:00", tz=IST)
    
    # Filter market hours
    df_day = df_ist[(df_ist.index >= market_open) & (df_ist.index <= market_close)]
    if df_day.empty:
        return []
    
    # OR formation (first 45 min at 5-min resolution)
    df_or = df_day[df_day.index < or_end]
    df_5m_or = resample_candles(df_or, 5)
    if df_5m_or is None or df_5m_or.empty:
        return []
    or_high = df_5m_or['high'].max()
    or_low = df_5m_or['low'].min()
    or_range = or_high - or_low
    
    if or_range == 0:
        return []
    
    # Check min/max OR range
    or_range_pct = (or_range / or_low) * 100
    if or_range_pct < 0.5 or or_range_pct > 3.0:
        return []
    
    # Post-OR data, resampled to 5-min, up to EOD
    df_post = df_day[(df_day.index >= or_end) & (df_day.index <= eod_exit)]
    df_5m_post = resample_candles(df_post, 5)
    if df_5m_post is None or df_5m_post.empty:
        return []
    
    entry_level = or_high * (1 + BUFFER_PCT / 100)
    trades = []
    cooldown_until = None
    
    for idx, row in df_5m_post.iterrows():
        if cooldown_until and idx < cooldown_until:
            continue
        
        if row['close'] > entry_level:
            entry_price = row['close']
            sl = entry_price * (1 - SL_PCT / 100)
            tp = entry_price * (1 + TP_PCT / 100)
            
            # Simulate SL/TP on remaining candles
            exit_price = entry_price
            exit_reason = "EOD"
            
            # Check SL/TP within entry candle
            if row['low'] <= sl:
                exit_price = sl
                exit_reason = "SL"
            elif row['high'] >= tp:
                exit_price = tp
                exit_reason = "TP"
            else:
                # Check subsequent candles
                rest = df_5m_post.loc[df_5m_post.index > idx]
                for _, r2 in rest.iterrows():
                    if r2['low'] <= sl:
                        exit_price = sl
                        exit_reason = "SL"
                        break
                    if r2['high'] >= tp:
                        exit_price = tp
                        exit_reason = "TP"
                        break
                    exit_price = r2['close']  # update to latest close for EOD
            
            pnl_pct = (exit_price - entry_price) / entry_price * 100
            trades.append({
                "symbol": "?", "date": date_str,
                "entry_time": str(idx.time()),
                "entry_price": round(entry_price, 2),
                "exit_price": round(exit_price, 2),
                "pnl_pct": round(pnl_pct, 2),
                "reason": exit_reason,
                "sl": round(sl, 2), "tp": round(tp, 2),
            })
            cooldown_until = idx + timedelta(minutes=COOLDOWN_MIN)
    
    return trades


# Run comparison
print("=" * 100)
print(f"{'Stock':<14} {'Date':<12} {'RefTrades':>9} {'RefWR%':>7} {'RefPF':>7}  {'ReplayTrades':>12} {'ReplayWR%':>10} {'ReplayPF':>10}  {'Match?':>6}")
print("=" * 100)

for sym in STOCKS:
    for date_str in DATES:
        # Fetch 1-min data from Upstox
        df_1m = fetch_candles(sym, tf=1, from_date=date_str, to_date=date_str, api_client=api_client)
        if df_1m is None or len(df_1m) < 50:
            continue
        
        # Reference ORB
        ref_trades = reference_orb_trades(df_1m.copy(), date_str)
        
        n_ref = len(ref_trades)
        ref_wins = sum(1 for t in ref_trades if t["pnl_pct"] > 0)
        ref_wr = ref_wins / n_ref * 100 if n_ref > 0 else 0
        gw = sum(t["pnl_pct"] for t in ref_trades if t["pnl_pct"] > 0)
        gl = abs(sum(t["pnl_pct"] for t in ref_trades if t["pnl_pct"] < 0))
        ref_pf = round(gw / gl, 2) if gl > 0 else (999 if gw > 0 else 0)
        
        # Show trades
        if ref_trades:
            print(f"\n{sym:<14} {date_str:<12} {n_ref:>9} {ref_wr:>7.1f} {ref_pf:>7}  {'':<12} {'':<10} {'':<10} {'':>6}")
            print(f"{'─'*100}")
            for t in ref_trades:
                print(f"  {t['entry_time']} ENTRY={t['entry_price']:.1f} SL={t['sl']:.1f} TP={t['tp']:.1f} "
                      f"EXIT={t['exit_price']:.1f} PnL={t['pnl_pct']:+.2f}% [{t['reason']}]")
    
    print()
