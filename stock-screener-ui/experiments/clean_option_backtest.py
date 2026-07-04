#!/usr/bin/env python3
"""Backtest long puts/calls on Nifty weekly options — CLEAN DATA ONLY.

Only trades weeks where the closest available strike is within 50pts of true ATM.
This eliminates the strike-mismatch noise from sparse-data expiries.
"""
import sys, os, csv, re, pandas as pd
from datetime import datetime, timedelta

OPTIONS_DIR = "/media/mysyntax/LENOVO_USB_/nifty-20260627T130953Z-3-001/nifty"
SPOT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'experiments', 'data', 'nifty_spot_daily.csv')

spot = pd.read_csv(SPOT_PATH, parse_dates=['date'], index_col='date')
spot['close'] = spot['close'].astype(float)

def get_option_price(filepath, target_date_str):
    if not os.path.exists(filepath): return None
    best = None
    with open(filepath) as f:
        for row in csv.DictReader(f):
            if row['timestamp'].startswith(target_date_str):
                best = float(row['close'])
    return best

def get_strikes(exp_dir):
    ces, pes = {}, {}
    for f in os.listdir(exp_dir):
        m = re.match(r'NIFTY_(\d+)_(CE|PE)_', f)
        if m:
            s, t = int(m.group(1)), m.group(2)
            fp = os.path.join(exp_dir, f)
            if t == 'CE': ces[s] = fp
            else: pes[s] = fp
    return ces, pes

expiries = sorted([
    d for d in os.listdir(OPTIONS_DIR)
    if os.path.isdir(os.path.join(OPTIONS_DIR, d)) and datetime.strptime(d, '%Y-%m-%d').weekday() == 3
])

call_trades, put_trades, straddle_trades = [], [], []
skipped_no_data = 0
skipped_no_atm = 0
skipped_no_price = 0

for exp_str in expiries:
    dt = datetime.strptime(exp_str, '%Y-%m-%d')
    entry_str = (dt - timedelta(days=3)).strftime('%Y-%m-%d')
    if entry_str not in spot.index:
        skipped_no_data += 1
        continue

    spot_entry = spot.loc[entry_str, 'close']
    true_atm = round(spot_entry / 50) * 50

    ces, pes = get_strikes(os.path.join(OPTIONS_DIR, exp_str))
    avail = sorted(set(ces.keys()) & set(pes.keys()))
    if not avail:
        skipped_no_data += 1
        continue

    # Find closest strike — MUST be within 50pts of true ATM
    closest = min(avail, key=lambda s: abs(s - true_atm))
    if abs(closest - true_atm) > 50:
        skipped_no_atm += 1
        continue

    ce_price = get_option_price(ces.get(closest), entry_str)
    pe_price = get_option_price(pes.get(closest), entry_str)
    if ce_price is None or pe_price is None:
        skipped_no_price += 1
        continue
    if exp_str not in spot.index:
        skipped_no_data += 1
        continue

    spot_expiry = spot.loc[exp_str, 'close']

    # Long call P&L
    call_pnl = max(0, spot_expiry - closest) - ce_price
    # Long put P&L
    put_pnl = max(0, closest - spot_expiry) - pe_price
    # Short straddle P&L (sell both)
    straddle_pnl = (ce_price + pe_price) - (max(0, spot_expiry - closest) + max(0, closest - spot_expiry))

    call_trades.append({'expiry': exp_str, 'strike': closest, 'spot_entry': round(spot_entry,1),
                        'spot_expiry': round(spot_expiry,1), 'premium': round(ce_price,2), 'pnl': round(call_pnl,2)})
    put_trades.append({'expiry': exp_str, 'strike': closest, 'spot_entry': round(spot_entry,1),
                       'spot_expiry': round(spot_expiry,1), 'premium': round(pe_price,2), 'pnl': round(put_pnl,2)})
    straddle_trades.append({'expiry': exp_str, 'strike': closest, 'spot_entry': round(spot_entry,1),
                            'spot_expiry': round(spot_expiry,1), 'credit': round(ce_price+pe_price,2), 'pnl': round(straddle_pnl,2)})

print(f"Expiries: {len(expiries)} total, {skipped_no_data} no spot, {skipped_no_atm} no ATM, {skipped_no_price} no price, {len(call_trades)} clean trades", file=sys.stderr)

for label, trades in [("LONG CALLS", call_trades), ("LONG PUTS", put_trades), ("SHORT STRADDLE", straddle_trades)]:
    if not trades: continue
    wins = sum(1 for t in trades if t['pnl'] > 0)
    losses = sum(1 for t in trades if t['pnl'] <= 0)
    total = sum(t['pnl'] for t in trades)
    gw = sum(t['pnl'] for t in trades if t['pnl'] > 0)
    gl = abs(sum(t['pnl'] for t in trades if t['pnl'] <= 0))
    pf = round(gw / gl, 4) if gl > 0 else 999

    print(f"\n{'='*130}")
    label2 = f"📊 {label} — Buy ATM Monday→Thursday | {len(trades)} clean weeks"
    print(f"  {label2}")
    print(f"{'='*130}")
    print(f"{'Expiry':<14} {'Strike':>7} {'Premium':>9} {'Spot→':>9} {'Spot↓':>9} {'P&L':>11}")
    print("-" * 130)
    for t in trades:
        m = "✅" if t['pnl'] > 0 else "❌"
        p = t.get('premium', t.get('credit', 0))
        print(f"{m} {t['expiry']:<10} {t['strike']:>7} ₹{p:>7.0f} {t['spot_entry']:>9.0f} {t['spot_expiry']:>9.0f} ₹{t['pnl']:>+9,.0f}")
    print("-" * 130)
    print(f"\n{'':32} {'Wins':>6} {'Losses':>7} {'WR':>6} {'PF':>8} {'Total':>10}")
    print(f"{'':32} {wins:>6} / {losses:>6} {wins/len(trades)*100:>5.1f}% {pf:>8.4f} ₹{total:>+8,.0f}")
    if wins: print(f"  Avg win: ₹{gw/max(wins,1):,.0f} | Avg loss: ₹{gl/max(losses,1):,.0f} | Max win: ₹{max(t['pnl'] for t in trades):,.0f} | Max loss: ₹{min(t['pnl'] for t in trades):,.0f}")
