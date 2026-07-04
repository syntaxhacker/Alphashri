#!/usr/bin/env python3
"""Autoresearch: optimize 52W Target strategy parameters.

Varies: min_drought, entry_threshold, trailing_stop, sl, max_hold.
Finds the config that maximizes PF.
"""
import sys, os, time, itertools, yfinance as yf
import numpy as np, pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, os.path.join(SCRIPT_DIR, '..'))
sys.path.insert(0, os.path.join(SCRIPT_DIR, '..', 'scanners'))
from experiments.ema_benchmark import calc_costs
from trending_upside import fetch_trending_stocks

CAPITAL = 100000; H52P = 252

# Get stock symbols
tv = fetch_trending_stocks(limit=200, profile='near_52w_breakout')
symbols = []
if tv is not None and not tv.empty:
    for _, row in tv.iterrows():
        if float(row.get('close', 40)) > 30 and float(row.get('volume', 0)) > 50000:
            symbols.append(str(row.get('name', '')).upper())
print(f"Symbols: {len(symbols)}", file=sys.stderr)

# Pre-fetch daily data for all symbols
print("Pre-fetching yfinance data...", file=sys.stderr)
data_cache = {}
with ThreadPoolExecutor(max_workers=5) as pool:
    def fetch(sym):
        try:
            df = yf.download(sym+'.NS', period='550d', interval='1d', progress=False, auto_adjust=True)
            if df is not None and not df.empty:
                if isinstance(df.columns, pd.MultiIndex): df.columns = [c[0].lower() for c in df.columns]
                return sym, (df['close'].values, df['high'].values)
        except: pass
        return sym, None
    futures = {pool.submit(fetch, sym): sym for sym in symbols}
    for f in as_completed(futures):
        sym, data = f.result()
        if data is not None: data_cache[sym] = data

print(f"Data cached: {len(data_cache)} symbols", file=sys.stderr)

def run_config(sym, closes, highs, sl_pct, trail_pct, entry_thresh_pct, min_days, max_hold, cooldown):
    h52 = pd.Series(highs).rolling(H52P, min_periods=H52P).max().values
    n = len(closes)
    ds = np.full(n, 999); lt = 0
    for i in range(n):
        if highs[i] >= h52[i]: lt = i
        ds[i] = i - lt
    
    sl_r = sl_pct/100; tr = trail_pct/100; et = entry_thresh_pct/100
    trd = []; ip = False; po = {}; le = -999
    
    for i in range(H52P+5, n):
        cx = closes[i]; hx = highs[i]
        if not ip:
            if (i - le) < cooldown: continue
            if cx < h52[i] and cx >= h52[i]*(1-et) and ds[i] >= min_days:
                po = {'entry': cx, 'sl': cx*(1-sl_r), 'hp': cx,
                      'mode': 'below', 'h52_target': h52[i], 'day': i}
                ip = True; continue
        if ip:
            hp = max(po['hp'], hx); d = i - po['day']; ep = None; r = None
            if po['mode'] == 'below':
                if cx <= po['sl']: ep = po['sl']; r = 'SL'
                elif cx >= po['h52_target']:
                    po['mode'] = 'above'; po['trail_stop'] = hp*(1-tr)
            else:
                po['trail_stop'] = max(po['trail_stop'], hp*(1-tr))
                if cx <= po['trail_stop']: ep = cx; r = 'TRAIL'
            if ep is None and d >= max_hold: ep = cx; r = 'MAX_HOLD'
            if ep:
                gp = (ep-po['entry'])*int(CAPITAL/po['entry'])
                cs = calc_costs(po['entry'], ep, int(CAPITAL/po['entry']), 'LONG')
                trd.append({'net_pnl': gp-cs})
                ip = False; le = i
    return trd

# Grid search
params = {
    'sl_pct': [1.0, 2.0, 3.0, 5.0],
    'trail_pct': [1.0, 2.0, 3.0, 5.0],
    'entry_thresh_pct': [1.0, 2.0, 3.0, 5.0],
    'min_days': [5, 10, 15, 20, 30, 45],
    'max_hold': [10, 15, 20, 30],
}

keys = list(params.keys())
results = []
total = 1
for v in params.values(): total *= len(v)
done = 0

print(f"\nGrid search: {total} configs × {len(data_cache)} stocks", file=sys.stderr)

for combo in itertools.product(*params.values()):
    cfg = dict(zip(keys, combo))
    done += 1
    if done % 20 == 0: print(f"  {done}/{total}...", file=sys.stderr)
    
    all_trades = []
    for sym, (closes, highs) in data_cache.items():
        tr = run_config(sym, closes, highs,
                       cfg['sl_pct'], cfg['trail_pct'], cfg['entry_thresh_pct'],
                       cfg['min_days'], cfg['max_hold'], max(5, cfg['min_days']//2))
        all_trades.extend(tr)
    
    tt = len(all_trades)
    if tt < 5: continue
    tw = sum(1 for t in all_trades if t['net_pnl']>0)
    tn = sum(t['net_pnl'] for t in all_trades)
    gw = sum(t['net_pnl'] for t in all_trades if t['net_pnl']>0)
    gl = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl']<=0))
    pf = round(gw/gl,4) if gl>0 else 99.9999
    awr = round(tw/tt*100,1)
    
    results.append((pf, tn, tt, awr, cfg))

# Sort by PF
results.sort(key=lambda x: x[0], reverse=True)

print(f"\n{'='*120}")
print(f"  📊 52W TARGET — TOP CONFIGS (by PF)")
print(f"{'='*120}")
print(f"{'PF':>8} {'Net P&L':>12} {'Trades':>7} {'WR%':>6} {'SL%':>5} {'Trail%':>7} {'Entry%':>7} {'Drought':>8} {'MaxHold':>8}")
print("-" * 120)

best_n = results[:3]
for pf, net, tt, wr, cfg in best_n:
    c = cfg
    print(f"{pf:>8.4f} ₹{net:>+9,.0f} {tt:>7} {wr:>5.1f}% {c['sl_pct']:>5.1f}% {c['trail_pct']:>6.1f}% {c['entry_thresh_pct']:>6.1f}% {c['min_days']:>8}d {c['max_hold']:>8}d")

# Also show bot's current config for comparison
print(f"\n{'='*120}")
print(f"  Bot #3 CURRENT config (for comparison):")
print(f"  SL=2% Trail=2% Entry=2% Drought=20d MaxHold=15d")
print(f"  → PF=13.29 (from earlier run)")

# Show best config recommendation
best = results[0][4]
print(f"\n✅ RECOMMENDED: SL={best['sl_pct']}% Trail={best['trail_pct']}% "
      f"Entry={best['entry_thresh_pct']}% Drought={best['min_days']}d MaxHold={best['max_hold']}d")
print(f"   PF={results[0][0]:.4f}")

# Also show the best by drought level
print(f"\n📊 BEST CONFIG BY DROUGHT LEVEL:")
for drought in [5, 10, 15, 20, 30, 45]:
    subset = [r for r in results if r[4]['min_days'] == drought]
    if subset:
        best_s = subset[0]
        print(f"  Drought={drought:2d}d → PF={best_s[0]:.4f} ₹{best_s[1]:>+9,.0f} "
              f"SL={best_s[4]['sl_pct']}% Trail={best_s[4]['trail_pct']}% "
              f"Entry={best_s[4]['entry_thresh_pct']}% Hold={best_s[4]['max_hold']}d")
