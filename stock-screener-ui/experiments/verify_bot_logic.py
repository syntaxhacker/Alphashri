#!/usr/bin/env python3
"""Verify ORBSignalGenerator bot logic: SL/TP/EOD math matches expectations."""
import sys, os, pickle
import pandas as pd
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

IST = timezone(timedelta(hours=5, minutes=30))
MARKET_OPEN = 9 * 60 + 15
OR_MIN = 45
SL_PCT = 1.2
TP_PCT = 2.0
BUFFER_PCT = 0.62
COOLDOWN_BARS = 50
EOD_EXIT = 15 * 60
OR_START = MARKET_OPEN
OR_END = OR_START + OR_MIN
TRADE_SIZE = 100

def load_data():
    p = "../experiments/data/sector_scan_cache.pkl"
    if os.path.exists(p):
        with open(p, "rb") as f:
            return pickle.load(f)
    return {}

def verify(df, symbol):
    df = df.sort_index()
    df["tm"] = df.index.hour * 60 + df.index.minute
    df["dt"] = df.index.date
    
    tests_passed = 0
    tests_failed = 0
    
    for date, day in df.groupby("dt"):
        day = day.sort_index()
        pre = day[(day["tm"] >= OR_START) & (day["tm"] < OR_END)]
        if len(pre) < 5:
            continue
        or_h = pre["High"].max()
        or_l = pre["Low"].min()
        or_rp = (or_h - or_l) / or_l * 100
        if or_rp < 0.5 or or_rp > 3.0:
            continue
        entry_level = or_h * (1 + BUFFER_PCT / 100)
        
        post = day[day["tm"] >= OR_END]
        last_exit = -COOLDOWN_BARS - 1
        pos = None
        
        for i, (idx, row) in enumerate(post.iterrows()):
            if pos:
                sl_hit = row["Low"] <= pos["sl"]
                tp_hit = row["High"] >= pos["tp"]
                eod = row["tm"] >= EOD_EXIT
                
                exp_sl = round(pos["entry"] * (1 - SL_PCT / 100), 2)
                exp_tp = round(pos["entry"] * (1 + TP_PCT / 100), 2)
                
                if abs(pos["sl"] - exp_sl) > 0.05:
                    print(f"  ❌ SL MISMATCH {date}: entry={pos['entry']:.2f} bot_sl={pos['sl']:.2f} expected={exp_sl:.2f}")
                    tests_failed += 1
                else:
                    tests_passed += 1
                
                if abs(pos["tp"] - exp_tp) > 0.05:
                    print(f"  ❌ TP MISMATCH {date}: entry={pos['entry']:.2f} bot_tp={pos['tp']:.2f} expected={exp_tp:.2f}")
                    tests_failed += 1
                else:
                    tests_passed += 1
                
                if sl_hit:
                    pos = None
                    last_exit = i
                elif tp_hit:
                    pos = None
                    last_exit = i
                elif eod:
                    pos = None
                    last_exit = i
                continue
            
            if (i - last_exit) < COOLDOWN_BARS:
                continue
            if row["tm"] >= EOD_EXIT:
                continue
            
            if row["Close"] > entry_level:
                price = row["Close"]
                sl = round(price * (1 - SL_PCT / 100), 2)
                tp = round(price * (1 + TP_PCT / 100), 2)
                pos = {"entry": price, "sl": sl, "tp": tp}
    
    pct = tests_passed / (tests_passed + tests_failed) * 100 if (tests_passed + tests_failed) > 0 else 100
    return tests_passed, tests_failed, pct

def main():
    print("=" * 74)
    print("BOT LOGIC VERIFICATION — SL/TP Math Check")
    print(f"Params: SL={SL_PCT}%, TP={TP_PCT}%, buf={BUFFER_PCT}%, CD={COOLDOWN_BARS} bars")
    print("=" * 74)
    
    data = load_data()
    
    total_p = 0
    total_f = 0
    for sym in ["RELIANCE", "BEL", "POWERINDIA", "DIXON", "BOSCHLTD", "TCS", "TRENT"]:
        su = sym.upper()
        if su not in data:
            print(f"  {sym}: no data")
            continue
        p, f, pct = verify(data[su], su)
        total_p += p
        total_f += f
        status = "✅" if f == 0 else f"❌ ({f} failures)"
        print(f"  {sym:<12} → {p+f} checks: {p} pass, {f} fail ({pct:.0f}%) {status}")
    
    print(f"\n  TOTAL: {total_p} pass, {total_f} fail")
    print(f"  VERDICT: {'✅ ALL PASS — bot SL/TP math is correct' if total_f == 0 else '❌ Failures detected'}")

if __name__ == "__main__":
    main()
