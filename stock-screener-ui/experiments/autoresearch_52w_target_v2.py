#!/usr/bin/env python3
"""52W Target autoresearch — find optimal params with highest PF.

Grid search over: entry_threshold, min_drought, sl, trail, max_hold.
Tests on liquid NSE stocks with 800 days of data.
"""
import sys, os, json, sqlite3, itertools, time
import numpy as np, pandas as pd
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, os.path.join(SCRIPT_DIR, '..'))
sys.path.insert(0, os.path.join(SCRIPT_DIR, '..', 'upstox_trader'))

from config_and_utils.free_indian_apis import UpstoxAPI
from experiments.ema_benchmark import calc_costs

CAPITAL = 100000; H52P = 252

# Get token
token = sqlite3.connect(os.path.join(SCRIPT_DIR, 'db', 'alphashri.db')).execute(
    "SELECT access_token FROM broker_connections WHERE broker_name='upstox' LIMIT 1").fetchone()[0]
with open(os.path.join(SCRIPT_DIR, '..', '.upstox_token.json'), 'w') as f:
    json.dump({'access_token': token}, f)

api = UpstoxAPI('dummy', 'dummy', quiet=True)

# Pre-fetch a universe of liquid stocks from the previous run's summary
# Use all stocks that had data + manually add known good ones
base_symbols = []
summary_path = os.path.join(SCRIPT_DIR, 'experiments', 'output', 'run_20260628_191729', 'stocks_summary.csv')
if os.path.exists(summary_path):
    df = pd.read_csv(summary_path)
    base_symbols = df['symbol'].tolist()
    print(f"Loaded {len(base_symbols)} symbols from previous run", file=sys.stderr)

# Also add known performing stocks
extra = ['NETWEB', 'JMFINANCIL', 'COFORGE', 'KIRLOSENG', 'AVANTIFEED', 'BHARATFORG',
         'NITCO', 'PTC', 'RAMRAT', 'DIVISLAB', 'SBILIFE', 'ABCAPITAL',
         'SKMEGGPROD', 'HINDPETRO', 'TATACONSUM', 'SHRIRAMFIN', 'ALKEM',
         'NATIONALUM', 'SHREECEM', 'MARUTI', 'VCL', 'RAMANEWS', 'INDORAMA']
for s in extra:
    if s not in base_symbols:
        base_symbols.append(s)

print(f"Total symbols: {len(base_symbols)}", file=sys.stderr)

# Pre-fetch daily data for ALL symbols
data_cache = {}
done = 0
print("Pre-fetching data...", file=sys.stderr)
for sym in base_symbols:
    done += 1
    if done % 50 == 0: print(f"  {done}/{len(base_symbols)}...", file=sys.stderr)
    try:
        to_d = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        from_d = (datetime.now() - timedelta(days=800)).strftime('%Y-%m-%d')
        df = api.fetch_historical_data_v3(sym, 'days', 1, to_d, from_d,
                                          instrument_type='EQ', exchange='NSE_EQ')
        if df is not None and len(df) >= H52P + 10 and df['close'].mean() >= 20:
            data_cache[sym] = (df['close'].values.astype(float), df['high'].values.astype(float))
    except:
        pass

print(f"Data cached: {len(data_cache)} symbols", file=sys.stderr)

# Grid search
params = {
    'entry_thresh': [1.0, 2.0, 3.0, 5.0],
    'min_drought': [3, 5, 10, 15, 20, 30],
    'sl': [1.0, 2.0, 3.0, 5.0],
    'trail': [1.0, 2.0, 3.0, 5.0],
    'max_hold': [10, 15, 20, 30],
}

keys = list(params.keys())
total_configs = 1
for v in params.values(): total_configs *= len(v)
print(f"Grid: {total_configs} configs × {len(data_cache)} stocks", file=sys.stderr)

# Pre-compute H52 and drought arrays for each stock (fixed regardless of params)
stock_data_prep = {}
for sym, (c, h) in data_cache.items():
    n = len(c)
    h52 = pd.Series(h).rolling(H52P, min_periods=H52P).max().values
    ds = np.full(n, 9999); lt = 0
    for i in range(n):
        if h[i] >= h52[i] and not np.isnan(h52[i]): lt = i
        ds[i] = i - lt
    stock_data_prep[sym] = (c, h, h52, ds, n)

results = []
combo_num = 0

for combo in itertools.product(*params.values()):
    cfg = dict(zip(keys, combo))
    combo_num += 1
    if combo_num % 50 == 0: print(f"  combo {combo_num}/{total_configs}...", file=sys.stderr)
    
    et = cfg['entry_thresh'] / 100
    md = cfg['min_drought']
    sl_r = cfg['sl'] / 100
    tr = cfg['trail'] / 100
    mh = cfg['max_hold']
    cd = max(3, md // 2)
    
    all_trades = []
    
    for sym, (c, h, h52, ds, n) in stock_data_prep.items():
        trd = []; ip = False; po = {}; le = -9999
        for i in range(H52P + 5, n):
            if np.isnan(h52[i]): continue
            cx = c[i]; hx = h[i]
            if not ip:
                if (i - le) < cd: continue
                if cx < h52[i] and cx >= h52[i] * (1 - et) and ds[i] >= md:
                    po = {'entry': cx, 'sl': cx * (1 - sl_r), 'hp': cx,
                          'mode': 'below', 'h52_target': h52[i], 'day': i}
                    ip = True; continue
            if ip:
                hp = max(po['hp'], hx); d = i - po['day']; ep = None; r = None
                if po['mode'] == 'below':
                    if cx <= po['sl']: ep = po['sl']; r = 'SL'
                    elif cx >= po['h52_target']:
                        po['mode'] = 'above'; po['trail_stop'] = hp * (1 - tr)
                else:
                    po['trail_stop'] = max(po.get('trail_stop', 0), hp * (1 - tr))
                    if cx <= po['trail_stop']: ep = cx; r = 'TRAIL'
                if ep is None and d >= mh: ep = cx; r = 'MAX_HOLD'
                if ep:
                    gp = (ep - po['entry']) * int(CAPITAL / po['entry'])
                    cs = calc_costs(po['entry'], ep, int(CAPITAL / po['entry']), 'LONG')
                    trd.append(gp - cs)
                    ip = False; le = i
        all_trades.extend(trd)
    
    tt = len(all_trades)
    if tt < 3: continue
    tw = sum(1 for t in all_trades if t > 0)
    tn = sum(all_trades)
    gw = sum(t for t in all_trades if t > 0)
    gl = abs(sum(t for t in all_trades if t <= 0))
    pf = round(gw / gl, 4) if gl > 0 else 99.9999
    awr = round(tw / tt * 100, 1)
    
    results.append((pf, tn, tt, awr, cfg))

results.sort(key=lambda x: x[0], reverse=True)

# Print results
print(f"\n{'='*130}")
print(f"  📊 52W TARGET — TOP CONFIGS BY PF ({len(results)} valid configs)")
print(f"{'='*130}")
print(f"{'PF':>10} {'Net P&L':>12} {'Trades':>7} {'WR%':>6} {'Entry%':>7} {'Drought':>8} {'SL%':>5} {'Trail%':>7} {'Hold':>5}")
print("-" * 130)

seen = set()
for pf, tn, tt, awr, cfg in results[:25]:
    key = (cfg['entry_thresh'], cfg['min_drought'], cfg['sl'], cfg['trail'], cfg['max_hold'])
    if key in seen: continue
    seen.add(key)
    print(f"{pf:>10.4f} ₹{tn:>+9,.0f} {tt:>7} {awr:>5.1f}% {cfg['entry_thresh']:>6.1f}% {cfg['min_drought']:>8}d {cfg['sl']:>4.1f}% {cfg['trail']:>6.1f}% {cfg['max_hold']:>5}d")

# Group by drought level
print(f"\n{'='*130}")
print(f"  BEST BY DROUGHT LEVEL")
print(f"{'='*130}")
print(f"{'Drought':>8} {'Best PF':>10} {'Net':>10} {'Trades':>7} {'WR%':>6} {'Entry':>7} {'SL':>5} {'Trail':>7} {'Hold':>5}")
print("-" * 130)
for md in [3, 5, 10, 15, 20, 30]:
    subset = [r for r in results if r[4]['min_drought'] == md and r[2] >= 3]
    if subset:
        best = subset[0]
        c = best[4]
        print(f"{md:>8}d {best[0]:>10.4f} ₹{best[1]:>+8,.0f} {best[2]:>7} {best[3]:>5.1f}% {c['entry_thresh']:>6.1f}% {c['sl']:>4.1f}% {c['trail']:>6.1f}% {c['max_hold']:>5}d")
