#!/usr/bin/env python3
"""52-Week High strategies benchmark on all available stocks.

Strategies:
  chaser     — Buy when price breaks above 52W high (SL=2%, TP=3%, trail)
  target     — Buy below 52W high, ride up to it, trail out (SL=2%)
  blind      — Buy after drought (20+ days) near 52W high (SL=5%, TP=52W high)
  short_fail — Short when 52W breakout fails (SL=3%, TP=5%)

Uses yfinance for 2yr daily data (52W calc needs 252+ trading days).
"""
import argparse, sys, os, time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))

import pandas as pd
import numpy as np
import yfinance as yf
from experiments.ema_benchmark import calc_costs
from trending_upside import fetch_trending_stocks

H52_PERIOD = 252
CAPITAL = 100000

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--strategy', default='chaser', choices=['chaser','target','blind','short_fail'])
    p.add_argument('--min-mcap-cr', type=float, default=2000.0)
    p.add_argument('--min-atr-pct', type=float, default=1.5)
    p.add_argument('--min-price', type=float, default=50.0)
    p.add_argument('--limit', type=int, default=100, help='Max stocks to test')
    p.add_argument('--period', type=int, default=500, help='Days of yfinance history')
    return p.parse_args()

def fetch_daily(sym, period_days=365):
    """Fetch daily OHLC from yfinance. Returns (closes, highs, lows, volumes) or None."""
    try:
        df = yf.download(sym + '.NS', period=f'{period_days+30}d', interval='1d', progress=False, auto_adjust=True)
        if df is None or df.empty:
            df = yf.download(sym + '.BO', period=f'{period_days+30}d', interval='1d', progress=False, auto_adjust=True)
        if df is not None and not df.empty:
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = [c[0].lower() for c in df.columns]
            else:
                df.columns = [c.lower() for c in df.columns]
            return (df['close'].values, df['high'].values, df['low'].values, df['volume'].values)
    except:
        pass
    return None

def calc_52w(values, period=H52_PERIOD):
    return pd.Series(values).rolling(period, min_periods=period).max().values

def run_strategy(closes, highs, lows, volumes, strat, args):
    h52 = calc_52w(highs, H52_PERIOD)
    sl = args.sl / 100; tp = args.tp / 100; trail = args.trail / 100
    n = len(closes)
    if n < H52_PERIOD + 10: return []

    trades = []; ip = False; po = {}; le = -999
    min_days = {'chaser': 3, 'target': 5, 'blind': 20}.get(strat, 3)
    cooldown = {'chaser': 30, 'target': 7, 'blind': args.cooldown, 'short_fail': 15}.get(strat, args.cooldown)

    # Track days since last 52W touch
    days_since = np.full(n, 999)
    last_touch = 0
    for i in range(n):
        if highs[i] >= h52[i]: last_touch = i
        days_since[i] = i - last_touch

    for i in range(H52_PERIOD + 5, n):
        c = closes[i]; h = highs[i]; l = lows[i]; v = volumes[i]

        if not ip:
            if (i - le) < cooldown: continue
            entered = False

            if strat == 'chaser':
                bo = 0.5 / 100; et = 3.0 / 100
                if h > h52[i] * (1 + bo) and c <= h52[i] * (1 + et) and days_since[i] >= 3:
                    entry = c
                    po = {'entry': entry, 'sl': entry*(1-sl), 'tp': entry*(1+tp),
                          'hp': c, 'trailing': False, 'h52_entry': h52[i], 'day': i}
                    entered = True

            elif strat == 'target':
                et = 2.0 / 100
                if c < h52[i] and c >= h52[i] * (1 - et) and days_since[i] >= 5:
                    entry = c
                    po = {'entry': entry, 'sl': entry*(1-sl), 'hp': c,
                          'mode': 'below', 'h52_target': h52[i], 'day': i}
                    entered = True

            elif strat == 'blind':
                nh = 3.0 / 100; md = 20
                pct = (h52[i] - c) / h52[i] * 100
                if pct <= nh and days_since[i] >= md:
                    entry = c
                    po = {'entry': entry, 'sl': entry*(1-sl), 'tp': h52[i], 'hp': c, 'day': i}
                    entered = True

            elif strat == 'short_fail':
                lb = 5
                rp = max(highs[i-lb:i+1])
                p52 = max(h52[:i+1])
                if rp > p52 * 1.001 and c < rp * 0.99:
                    entry = c
                    po = {'entry': entry, 'sl': rp*(1+sl), 'tp': entry*(1-tp),
                          'peak': rp, 'day': i}
                    entered = True

            if entered:
                ip = True; le = i; continue

        if ip:
            hp = max(po.get('hp', po['entry']), h)
            po['hp'] = hp
            days = i - po['day']
            ep = None; reason = None

            if strat == 'chaser':
                if not po.get('trailing', False) and c >= po['tp']:
                    ep = po['tp']; reason = 'TP'
                elif not po.get('trailing', False) and c >= po['h52_entry']:
                    po['trailing'] = True
                    po['trail_stop'] = hp * (1 - trail)
                if po.get('trailing', False):
                    po['trail_stop'] = max(po['trail_stop'], hp * (1 - trail))
                    if c <= po['trail_stop']: ep = c; reason = 'TRAIL'
                if ep is None and c <= po['sl']: ep = po['sl']; reason = 'SL'
                if ep is None and days >= 30: ep = c; reason = 'MAX_HOLD'

            elif strat == 'target':
                if po['mode'] == 'below':
                    if c <= po['sl']: ep = po['sl']; reason = 'SL'
                    elif c >= po['h52_target']:
                        po['mode'] = 'above'
                        po['trail_stop'] = hp * (1 - 2.0/100)
                else:
                    po['trail_stop'] = max(po['trail_stop'], hp * (1 - 2.0/100))
                    if c <= po['trail_stop']: ep = c; reason = 'TRAIL'
                if ep is None and days >= 15: ep = c; reason = 'MAX_HOLD'

            elif strat == 'blind':
                if c >= po['tp']: ep = po['tp']; reason = 'TP'
                elif c <= po['sl']: ep = po['sl']; reason = 'SL'
                elif days >= 30: ep = c; reason = 'MAX_HOLD'

            elif strat == 'short_fail':
                if c <= po['tp']: ep = po['tp']; reason = 'TP'
                elif c >= po['sl']: ep = po['sl']; reason = 'SL'
                elif days >= 15: ep = c; reason = 'MAX_HOLD'

            if ep:
                corr = 1 if strat != 'short_fail' else -1
                gp = corr * (ep - po['entry']) * int(CAPITAL / po['entry'])
                cs = calc_costs(po['entry'], ep, int(CAPITAL / po['entry']), 'SHORT' if strat == 'short_fail' else 'LONG')
                trades.append({'net_pnl': gp - cs, 'reason': reason})
                ip = False; le = i
    return trades

def main():
    args = parse_args()
    # Map args
    strat_defaults = {
        'chaser': {'sl': 2.0, 'tp': 3.0, 'trail': 2.0, 'cooldown': 30},
        'target': {'sl': 2.0, 'tp': 0, 'trail': 2.0, 'cooldown': 7},
        'blind':  {'sl': 5.0, 'tp': 0, 'trail': 0, 'cooldown': 0},
        'short_fail': {'sl': 3.0, 'tp': 5.0, 'trail': 0, 'cooldown': 15},
    }
    for k, v in strat_defaults[args.strategy].items():
        setattr(args, k, v)

    t0 = time.time()
    labels = {'chaser': '52W Chaser', 'target': '52W Target', 'blind': 'Blind 52W', 'short_fail': 'Short 52W Failed'}
    print(f"📊 {labels[args.strategy]} | SL={args.sl}% TP={args.tp}% | max {args.limit} stocks", file=sys.stderr)

    # Get stock list — use near_52w_breakout profile for stocks near 52W highs
    tv = fetch_trending_stocks(limit=args.limit, profile='near_52w_breakout')
    symbols = []
    if tv is None or tv.empty:
        tv = fetch_trending_stocks(limit=args.limit, profile='trending')
    if tv is not None and not tv.empty:
        for _, row in tv.iterrows():
            price = float(row.get('close', 0)); vol = float(row.get('volume', 0))
            mcap = float(row.get('market_cap_basic', 0)) / 1e7
            if mcap < args.min_mcap_cr or price < args.min_price or vol < 500000: continue
            symbols.append(str(row.get('name', '')).upper())
    print(f"  {len(symbols)} stocks", file=sys.stderr)

    all_trades = []; stock_pfs = []; done = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(fetch_daily, sym, args.period): sym for sym in symbols}
        for f in as_completed(futures):
            sym = futures[f]
            done += 1
            if done % 10 == 0: print(f"  {done}/{len(symbols)}...", file=sys.stderr)
            data = f.result()
            if data is None: continue
            closes, highs, lows, volumes = data
            tr = run_strategy(closes, highs, lows, volumes, args.strategy, args)
            all_trades.extend(tr)
            if len(tr) >= 2:
                wins = [t for t in tr if t['net_pnl']>0]; losses = [t for t in tr if t['net_pnl']<=0]
                gw = sum(t['net_pnl'] for t in wins); gl = abs(sum(t['net_pnl'] for t in losses))
                stock_pfs.append(round(gw/gl,4) if gl>0 else 99.9999)
            if len(tr) > 0:
                print(f"    {sym:<20} {len(tr):3d}t WR={round(sum(1 for t in tr if t['net_pnl']>0)/len(tr)*100,1):.1f}% PF={round(gw/max(gl,1),4) if len(tr)>=2 else '?':<10} Net=₹{sum(t['net_pnl'] for t in tr):>+8,.0f}", file=sys.stderr)

    tt = len(all_trades); tn = sum(t['net_pnl'] for t in all_trades)
    gw = sum(t['net_pnl'] for t in all_trades if t['net_pnl']>0); gl = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl']<=0))
    apf = round(gw/gl,4) if gl>0 else 99.9999; tw = sum(1 for t in all_trades if t['net_pnl']>0)
    pc = sum(1 for pf in stock_pfs if pf>=1.0); tc = len(stock_pfs); pr = round(pc/tc*100,1) if tc>0 else 0
    el = time.time()-t0

    print(f"\n{'='*80}")
    print(f"  {labels[args.strategy]} — Results")
    print(f"{'='*80}")
    print(f"  Trades:  {tt}")
    print(f"  Win rate: {round(tw/max(tt,1)*100,1)}%")
    print(f"  PF:      {apf}")
    print(f"  Net P&L: ₹{tn:,.0f}")
    print(f"  Stocks:  {tc} ({pr}% profitable)")
    print(f"  Time:    {el:.0f}s")

if __name__ == '__main__':
    main()
