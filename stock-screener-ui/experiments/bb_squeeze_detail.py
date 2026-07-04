#!/usr/bin/env python3
"""Detailed BB Squeeze backtest with best params."""
import sys, os, time
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners')); sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))
import numpy as np; import pandas as pd
from experiments.benchmark_screener_params import load_or_fetch_tv_data, load_or_fetch_candle_data
from experiments.ema_benchmark import calc_costs
from market_data.market_data import resample_candles

MCAP=2000; ATR=1.5; PRICE=100; VOL=500000
PERIOD=16; STD=2.0; SL=3.0; TP=10.0; TF=60; THRESH=0.15

tv = load_or_fetch_tv_data()
syms = []
for s in tv:
    if float(s['mcap_cr'])<MCAP or float(s['atr_pct'])<ATR or float(s['price'])<PRICE or float(s['volume'])<VOL: continue
    syms.append(s['symbol'])
print(f"📊 BB Squeeze on {len(syms)} stocks", file=sys.stderr)
cd = load_or_fetch_candle_data(syms)
at = []; ps = []

for sym in syms:
    df = cd.get(sym)
    if df is None or len(df) < 200: continue
    rdf = resample_candles(df, TF)
    if rdf is None or len(rdf) < PERIOD + 10: continue
    cls = rdf['close'].tolist()
    arr = np.array(cls)
    mid = pd.Series(arr).rolling(PERIOD).mean().values
    stdev = pd.Series(arr).rolling(PERIOD).std().values
    up = mid + STD * stdev; lo = mid - STD * stdev; w = (up - lo) / mid * 100
    thr = np.percentile(w[PERIOD:], THRESH * 100)
    sl = SL/100; tpp = TP/100
    tr = []; ip = False; po = {}; le = -999; insq = False; sqs = -1
    for i in range(PERIOD + 2, len(cls)):
        c = cls[i]
        if not insq:
            if w[i] < thr: insq = True; sqs = i
            continue
        if not ip:
            if (i - le) < 2: continue
            if w[i] > thr and i > sqs + 2:
                if c > mid[i]:
                    po = {'side':'LONG','entry':c,'sl':c*(1-sl),'tp':c*(1+tpp)}; ip = True; insq = False; continue
                elif c < mid[i]:
                    po = {'side':'SHORT','entry':c,'sl':c*(1+sl),'tp':c*(1-tpp)}; ip = True; insq = False; continue
        if ip:
            ep = None; r = None
            if po['side'] == 'LONG':
                if c >= po['tp']: ep = po['tp']; r = '✅ TP'
                elif c <= po['sl']: ep = po['sl']; r = '❌ SL'
            else:
                if c <= po['tp']: ep = po['tp']; r = '✅ TP'
                elif c >= po['sl']: ep = po['sl']; r = '❌ SL'
            if ep:
                gp = (ep-po['entry'])*100000/po['entry'] if po['side']=='LONG' else (po['entry']-ep)*100000/po['entry']
                cs = calc_costs(po['entry'],ep,int(100000/po['entry']),po['side'])
                tr.append({'symbol':sym,'net_pnl':gp-cs,'reason':r})
                ip = False; le = i
    at.extend(tr)
    n = len(tr)
    if n >= 2:
        ww = [t for t in tr if t['net_pnl']>0]; ll = [t for t in tr if t['net_pnl']<=0]
        nt = sum(t['net_pnl'] for t in tr)
        gw = sum(t['net_pnl'] for t in ww); gl = abs(sum(t['net_pnl'] for t in ll))
        pf = round(gw/gl,4) if gl>0 else 99.9999; wr = round(len(ww)/n*100,1)
    else: nt=sum(t['net_pnl'] for t in tr); pf=0; wr=0
    ps.append({'symbol':sym,'trades':n,'wins':len([t for t in tr if t['net_pnl']>0]),'win_rate':wr,'net_pnl':round(nt,2),'profit_factor':pf})
    print(f"  {'✅' if pf>=1.0 and n>=2 else '❌'} {sym:<18} {n:3d}t WR={wr:>5.1f}% Net=₹{nt:>+9,.0f} PF={pf:<8.4f}", file=sys.stderr)

ps.sort(key=lambda x:x['net_pnl'],reverse=True)
tt = len(at); tw = sum(1 for t in at if t['net_pnl']>0)
tn = sum(t['net_pnl'] for t in at)
gw = sum(t['net_pnl'] for t in at if t['net_pnl']>0)
gl = abs(sum(t['net_pnl'] for t in at if t['net_pnl']<=0))
apf = round(gw/gl,4) if gl>0 else 99.9999; awr = round(tw/tt*100,1) if tt>0 else 0
tpn = sum(1 for t in at if 'TP' in t.get('reason',''))
sln = sum(1 for t in at if 'SL' in t.get('reason',''))
ps2 = sum(1 for s in ps if s['profit_factor']>=1.0 and s['trades']>=2)
tq = len([s for s in ps if s['trades']>=2])

print(f"\n{'='*130}")
print(f"  📊 BB SQUEEZE | Period={PERIOD} Std={STD} | SL={SL}% TP={TP}% | {TF}-min")
print(f"  Screener: mcap≥{MCAP}Cr atr≥{ATR}%")
print(f"{'='*130}")
print(f"{'Rank':<5} {'Symbol':<18} {'Trades':>7} {'Wins':>5} {'WR%':>6} {'Net P&L':>14} {'PF':>10}")
print("-"*130)
for i,s in enumerate(ps,1):
    if s['trades']<1: continue
    mark = '✅' if s['profit_factor']>=1.0 and s['trades']>=2 else '❌'
    print(f"{mark} {i:<3} {s['symbol']:<18} {s['trades']:>7} {s['wins']:>5} {s['win_rate']:>5.1f}% ₹{s['net_pnl']:>+10,.0f}  {s['profit_factor']:<10.4f}")
print("-"*130)
print(f"\n{'':5} {'TOTAL':<18} {tt:>7} {tw:>5} {awr:>5.1f}% ₹{tn:>+10,.0f}  {apf:<10.4f}")
print(f"  TP hits: {tpn} | SL hits: {sln}")
print(f"  Profitable stocks: {ps2}/{tq} ({round(ps2/max(tq,1)*100,1)}%)")
