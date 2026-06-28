#!/usr/bin/env python3
"""Nifty Iron Condor weekly backtest.

Structure (per expiry):
  Buy  OTM PE (wing)   — long_put  at ATM - N - W
  Sell OTM PE (body)   — short_put at ATM - N
  Sell OTM CE (body)   — short_call at ATM + N
  Buy  OTM CE (wing)   — long_call  at ATM + N + W

Where:
  N = short_offset (strikes away from ATM, default 2 = 100pts)
  W = wing_width   (strikes beyond short, default 1 = 50pts)

Net credit = short_put + short_call - long_put - long_call
Max loss   = W * 50 - credit (per lot of 50)
"""
import sys, os, csv
from datetime import datetime, timedelta
import pandas as pd
from straddle_backtest import (OPTIONS_DIR, SPOT_PATH, spot,
                                find_atm_strike, parse_filename,
                                get_option_price, get_expiry_paths,
                                get_weekly_expiry_dates)

SHORT_OFFSET = 2  # strikes away from ATM for short legs
WING_WIDTH = 1    # strikes beyond short for long legs

expiries = get_weekly_expiry_dates()
print(f"Found {len(expiries)} weekly Thursdays", file=sys.stderr)

trades = []
for exp_str in expiries:
    dt = datetime.strptime(exp_str, '%Y-%m-%d')
    entry_date = dt - timedelta(days=3)
    entry_str = entry_date.strftime('%Y-%m-%d')

    if entry_str not in spot.index:
        continue
    spot_entry = spot.loc[entry_str, 'close']
    atm = find_atm_strike(spot_entry)

    ces, pes = get_expiry_paths(exp_str)
    avail = sorted(set(ces.keys()) & set(pes.keys()))
    if not avail:
        continue

    # Find the 4 strikes needed
    def closest_avail(target):
        return min(avail, key=lambda s: abs(s - target))

    short_put_strike = closest_avail(atm - SHORT_OFFSET * 50)
    long_put_strike  = closest_avail(atm - (SHORT_OFFSET + WING_WIDTH) * 50)
    short_call_strike = closest_avail(atm + SHORT_OFFSET * 50)
    long_call_strike  = closest_avail(atm + (SHORT_OFFSET + WING_WIDTH) * 50)

    # Get prices at Monday close
    sp = get_option_price(pes.get(short_put_strike), entry_str)
    lp = get_option_price(pes.get(long_put_strike), entry_str)
    sc = get_option_price(ces.get(short_call_strike), entry_str)
    lc = get_option_price(ces.get(long_call_strike), entry_str)

    if None in (sp, lp, sc, lc):
        print(f"  ⏭️  {exp_str}: prices missing", file=sys.stderr)
        continue

    # Get spot at expiry
    if exp_str not in spot.index:
        continue
    spot_expiry = spot.loc[exp_str, 'close']

    # Iron condor P&L
    credit = (sp + sc) - (lp + lc)
    # Put side: max(0, short_put - spot) - max(0, long_put - spot)
    put_pnl = max(0, short_put_strike - spot_expiry) - max(0, long_put_strike - spot_expiry)
    call_pnl = max(0, spot_expiry - short_call_strike) - max(0, spot_expiry - long_call_strike)
    # Short IC: we keep credit, pay out at expiry
    net = credit - (put_pnl + call_pnl)
    net -= 100  # costs (~₹25 per leg × 4)

    width_val = abs(long_call_strike - short_call_strike)
    max_loss = width_val - credit

    trades.append({
        'expiry': exp_str,
        'atm': atm,
        'short_p': short_put_strike, 'long_p': long_put_strike,
        'short_c': short_call_strike, 'long_c': long_call_strike,
        'sp': round(sp, 1), 'lp': round(lp, 1),
        'sc': round(sc, 1), 'lc': round(lc, 1),
        'credit': round(credit, 1),
        'max_loss': round(max_loss, 1),
        'spot_entry': round(spot_entry, 1),
        'spot_expiry': round(spot_expiry, 1),
        'put_pnl': round(put_pnl, 1),
        'call_pnl': round(call_pnl, 1),
        'net_pnl': round(net, 1),
    })

    mark = "✅" if net > 0 else "❌"
    print(f"  {mark} {exp_str} ATM={atm} "
          f"P={short_put_strike}/{long_put_strike} "
          f"C={short_call_strike}/{long_call_strike} "
          f"Credit={credit:.0f} MaxLoss={max_loss:.0f} "
          f"Spot={spot_entry:.0f}→{spot_expiry:.0f} "
          f"P&L=₹{net:+.0f}", file=sys.stderr)

if not trades:
    print("❌ No trades", file=sys.stderr); sys.exit(1)

df = pd.DataFrame(trades)
wins = sum(1 for t in trades if t['net_pnl'] > 0)
losses = sum(1 for t in trades if t['net_pnl'] <= 0)
total_net = sum(t['net_pnl'] for t in trades)
gw = sum(t['net_pnl'] for t in trades if t['net_pnl'] > 0)
gl = abs(sum(t['net_pnl'] for t in trades if t['net_pnl'] <= 0))
pf = round(gw / gl, 4) if gl > 0 else 999
avg_w = gw / max(wins, 1)
avg_l = gl / max(losses, 1)
max_w = max(t['net_pnl'] for t in trades)
max_l = min(t['net_pnl'] for t in trades)

print(f"\n{'='*130}")
print(f"  📊 IRON CONDOR — {SHORT_OFFSET}strike short, {WING_WIDTH}strike wings | {len(trades)} weeks")
print(f"{'='*130}")
print(f"{'Expiry':<14} {'ShortP':>7} {'LongP':>7} {'ShortC':>7} {'LongC':>7} {'Credit':>8} "
      f"{'MaxLoss':>8} {'PutP&L':>8} {'CallP&L':>8} {'NetP&L':>9}")
print("-" * 130)
for t in trades:
    m = "✅" if t['net_pnl'] > 0 else "❌"
    print(f"{m} {t['expiry']:<10} {t['short_p']:>7} {t['long_p']:>7} {t['short_c']:>7} {t['long_c']:>7} "
          f"{t['credit']:>8.0f} {t['max_loss']:>8.0f} {t['put_pnl']:>+8.0f} {t['call_pnl']:>+8.0f} {t['net_pnl']:>+9.0f}")
print("-" * 130)
print(f"\n{'':53} {'TOTAL':>9} {total_net:>+9,.0f}")
print(f"  Win rate: {wins}/{len(trades)} ({wins/len(trades)*100:.1f}%)")
print(f"  Profit factor: {pf}")
print(f"  Avg win: ₹{avg_w:,.0f} | Avg loss: ₹{avg_l:,.0f}")
print(f"  Max win: ₹{max_w:,.0f} | Max loss: ₹{max_l:,.0f}")
print(f"  Total net: ₹{total_net:,.0f}")
