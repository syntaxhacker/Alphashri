#!/usr/bin/env python3
"""Simple Nifty short straddle backtest: sell ATM CE + PE each weekly expiry.

Strategy:
- Each weekly expiry (Thursday), short ATM straddle on Monday close
- Entry: sell 1 ATM CE + 1 ATM PE at Monday close price
- Hold to expiry Thursday close
- P&L = credit collected - (max(0, spot - strike) + max(0, strike - spot))

Data:
- Options: /media/mysyntax/LENOVO_USB_/nifty-20260627T130953Z-3-001/nifty/
- Spot: experiments/data/nifty_spot_daily.csv (daily close for ATM determination)
"""
import sys, os, csv, glob
from datetime import datetime, timedelta
import pandas as pd

OPTIONS_DIR = "/media/mysyntax/LENOVO_USB_/nifty-20260627T130953Z-3-001/nifty"
SPOT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'experiments', 'data', 'nifty_spot_daily.csv')

# Load Nifty daily spot
spot = pd.read_csv(SPOT_PATH, parse_dates=['date'], index_col='date')
spot['close'] = spot['close'].astype(float)

def find_atm_strike(spot_price: float) -> int:
    """Find the nearest 50-strike to spot."""
    return round(spot_price / 50) * 50

def parse_filename(fname: str):
    """Parse NIFTY_{strike}_{CE|PE}_{DD}_{MON}_{YY}.csv"""
    parts = fname.replace('.csv', '').split('_')
    # NIFTY, STRIKE, TYPE, DD, MON, YY
    strike = int(parts[1])
    opt_type = parts[2]
    return strike, opt_type

def get_option_price(filepath: str, target_date_str: str, target_time_str: str = "15:29:00") -> float:
    """Read option price at target date+time from CSV. Returns close price."""
    if not os.path.exists(filepath):
        return None
    with open(filepath) as f:
        reader = csv.DictReader(f)
        for row in reader:
            ts = row['timestamp']
            if ts.startswith(target_date_str) and 'T' + target_time_str in ts:
                return float(row['close'])
    # Fallback: read the row closest to target date
    with open(filepath) as f:
        reader = csv.DictReader(f)
        best_row = None
        for row in reader:
            if row['timestamp'].startswith(target_date_str):
                best_row = row
        if best_row:
            return float(best_row['close'])
    return None

def get_expiry_paths(expiry_date_str: str):
    """Get all CE and PE files for an expiry."""
    edir = os.path.join(OPTIONS_DIR, expiry_date_str)
    if not os.path.isdir(edir):
        return [], []
    ces, pes = {}, {}
    for f in os.listdir(edir):
        if not f.endswith('.csv'): continue
        strike, otype = parse_filename(f)
        if otype == 'CE':
            ces[strike] = os.path.join(edir, f)
        elif otype == 'PE':
            pes[strike] = os.path.join(edir, f)
    return ces, pes

def get_weekly_expiry_dates():
    """Get all weekly expiry dates from options directory (Thursday expiries)."""
    exps = []
    for d in sorted(os.listdir(OPTIONS_DIR)):
        if os.path.isdir(os.path.join(OPTIONS_DIR, d)):
            try:
                dt = datetime.strptime(d, '%Y-%m-%d')
                if dt.weekday() == 3:  # Thursday
                    exps.append(d)
            except: pass
    return exps

# Main backtest
expiries = get_weekly_expiry_dates()
print(f"Found {len(expiries)} weekly expiry Thursdays", file=sys.stderr)

trades = []
for exp_str in expiries:
    dt = datetime.strptime(exp_str, '%Y-%m-%d')
    # Entry on Monday before expiry (3 days before Thursday)
    entry_date = dt - timedelta(days=3)
    entry_str = entry_date.strftime('%Y-%m-%d')

    # Get Nifty close on Monday
    if entry_str not in spot.index:
        print(f"  ⏭️  {exp_str}: no spot data for {entry_str}", file=sys.stderr)
        continue
    spot_entry = spot.loc[entry_str, 'close']
    atm_strike = find_atm_strike(spot_entry)

    # Get option files — find closest available strike
    ces, pes = get_expiry_paths(exp_str)
    if not ces or not pes:
        print(f"  ⏭️  {exp_str}: no option files", file=sys.stderr)
        continue
    # Find closest strike that has both CE and PE
    avail = sorted(set(ces.keys()) & set(pes.keys()))
    if not avail:
        print(f"  ⏭️  {exp_str}: no matching CE/PE strikes", file=sys.stderr)
        continue
    closest_strike = min(avail, key=lambda s: abs(s - atm_strike))
    ce_path = ces[closest_strike]
    pe_path = pes[closest_strike]
    if closest_strike != atm_strike:
        print(f"  ⚡ {exp_str}: ATM={atm_strike}, using closest={closest_strike}", file=sys.stderr)

    # Get option prices at Monday close (15:29 IST)
    ce_price = get_option_price(ce_path, entry_str)
    pe_price = get_option_price(pe_path, entry_str)

    if ce_price is None or pe_price is None:
        print(f"  ⏭️  {exp_str}: prices not found at {entry_str}", file=sys.stderr)
        continue

    # Get Nifty close on expiry day (Thursday)
    if exp_str not in spot.index:
        print(f"  ⏭️  {exp_str}: no spot data for expiry day", file=sys.stderr)
        continue
    spot_expiry = spot.loc[exp_str, 'close']

    # Short straddle P&L
    strike = closest_strike
    credit = ce_price + pe_price
    ce_pnl = -(max(0, spot_expiry - strike) - ce_price)
    pe_pnl = -(max(0, strike - spot_expiry) - pe_price)
    total_pnl = ce_pnl + pe_pnl
    costs = 50 * 2
    net_pnl = total_pnl - costs

    trades.append({
        'expiry': exp_str,
        'entry_date': entry_str,
        'atm_strike': strike,
        'spot_entry': round(spot_entry, 1),
        'spot_expiry': round(spot_expiry, 1),
        'ce_price': round(ce_price, 2),
        'pe_price': round(pe_price, 2),
        'credit': round(credit, 2),
        'ce_pnl': round(ce_pnl, 2),
        'pe_pnl': round(pe_pnl, 2),
        'total_pnl': round(total_pnl, 2),
        'net_pnl': round(net_pnl, 2),
    })

    direction = "✅" if net_pnl > 0 else "❌"
    print(f"  {direction} {exp_str} strike={strike} "
          f"CE={ce_price:.0f} PE={pe_price:.0f} Credit={credit:.0f} "
          f"Spot={spot_entry:.0f}→{spot_expiry:.0f} "
          f"P&L=₹{net_pnl:+.0f}", file=sys.stderr)

# Results
if not trades:
    print("\n❌ No trades executed", file=sys.stderr)
    sys.exit(1)

df = pd.DataFrame(trades)

wins = sum(1 for t in trades if t['net_pnl'] > 0)
losses = sum(1 for t in trades if t['net_pnl'] <= 0)
total_net = sum(t['net_pnl'] for t in trades)
avg_win = sum(t['net_pnl'] for t in trades if t['net_pnl'] > 0) / max(wins, 1)
avg_loss = abs(sum(t['net_pnl'] for t in trades if t['net_pnl'] <= 0)) / max(losses, 1)
max_win = max(t['net_pnl'] for t in trades)
max_loss = min(t['net_pnl'] for t in trades)
pf = sum(t['net_pnl'] for t in trades if t['net_pnl'] > 0) / abs(sum(t['net_pnl'] for t in trades if t['net_pnl'] <= 0)) if losses > 0 else 999

print(f"\n{'='*120}")
print(f"  📊 SHORT STRADDLE BACKTEST — Sell ATM CE + PE on Monday, hold to Thursday expiry")
print(f"  Period: {trades[0]['expiry']} to {trades[-1]['expiry']} ({len(trades)} weekly expiries)")
print(f"{'='*120}")
print(f"{'Expiry':<14} {'ATM':>6} {'CE':>8} {'PE':>8} {'Credit':>8} {'Spot→':>9} {'Spot↓':>9} {'CE P&L':>10} {'PE P&L':>10} {'Net P&L':>10}")
print("-" * 120)

for t in trades:
    mark = "✅" if t['net_pnl'] > 0 else "❌"
    print(f"{mark} {t['expiry']:<10} {t['atm_strike']:>6} {t['ce_price']:>8.0f} {t['pe_price']:>8.0f} "
          f"{t['credit']:>8.0f} {t['spot_entry']:>9.0f} {t['spot_expiry']:>9.0f} "
          f"{t['ce_pnl']:>+9.0f} {t['pe_pnl']:>+9.0f} {t['net_pnl']:>+9.0f}")

print("-" * 120)
print(f"\n{'':38} {'TOTAL':>10} {'':10} {total_net:>+10,.0f}")
print(f"\n  Win rate: {wins}/{len(trades)} ({wins/len(trades)*100:.1f}%)")
print(f"  Profit factor: {pf:.4f}")
print(f"  Avg win: ₹{avg_win:,.0f} | Avg loss: ₹{avg_loss:,.0f}")
print(f"  Max win: ₹{max_win:,.0f} | Max loss: ₹{max_loss:,.0f}")
print(f"  Total net: ₹{total_net:,.0f}")
