#!/usr/bin/env python3
"""Detailed RSI Overbought SHORT-ONLY backtest."""
import sys, os; SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners')); sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))
import numpy as np; from datetime import timedelta, timezone
from experiments.benchmark_screener_params import load_or_fetch_tv_data, load_or_fetch_candle_data
from experiments.ema_benchmark import calc_costs
from market_data.market_data import resample_candles

IST = timezone(timedelta(hours=5, minutes=30))
MCAP=2000; ATR=3.0; PRICE=100; VOL=500000
SL=1.0; TP=4.0; RSI_PER=14; OB=80; ENTRY=75
MIN_ENTRY=600; EOD=915; COOLDOWN=30; CAP=100000

def rsi(prices, p):
    d=np.diff(prices); g=np.where(d>0,d,0); l=np.where(d<0,-d,0)
    ag=np.mean(g[:p]); al=np.mean(l[:p]); r=[50]*p
    r.append(100-100/(1+ag/al) if al>0 else 100)
    for i in range(p+1,len(prices)):
        ag=(ag*(p-1)+g[i-1])/p; al=(al*(p-1)+l[i-1])/p
        rs=ag/al if al>0 else 100; r.append(100-100/(1+rs) if al>0 else 100)
    return r

tv=load_or_fetch_tv_data()
syms=[]
for s in tv:
    if float(s['mcap_cr'])<MCAP or float(s['atr_pct'])<ATR or float(s['price'])<PRICE or float(s['volume'])<VOL: continue
    syms.append(s['symbol'])
print(f"📊 RSI Overbought Short on {len(syms)} stocks",file=sys.stderr)
cd=load_or_fetch_candle_data(syms)
at=[]; ps=[]

for sym in syms:
    df=cd.get(sym)
    if df is None or len(df)<200: continue
    dd=resample_candles(df,1440)
    ds=sorted(dd.index.normalize().unique())
    if len(ds)<2: continue
    tr=[]; ip=False; po={}; le=None
    for day in ds[1:]:
        d2=day if day.tz else day.tz_localize('UTC')
        d1=df[(df.index>=d2)&(df.index<d2+timedelta(days=1))]
        if len(d1)<RSI_PER+5: continue
        cl=d1['close'].tolist(); hi=d1['high'].tolist(); lo=d1['low'].tolist(); ts=d1.index.tolist()
        rsi_vals=rsi(cl,RSI_PER)
        for i in range(RSI_PER+1,len(cl)):
            ti=ts[i].tz_convert(IST); ct=ti.hour*60+ti.minute
            c=cl[i]; h=hi[i]; l=lo[i]
            if ct>=EOD: break
            if not ip:
                if ct<MIN_ENTRY: continue
                if le and (ti-le).total_seconds()/60<COOLDOWN: continue
                if rsi_vals[i-1]>OB and rsi_vals[i]<=ENTRY:
                    entry=c; sl=entry*(1+SL/100); tp=entry*(1-TP/100)
                    po={'entry':entry,'sl':sl,'tp':tp,'entry_time':ti}; ip=True
                continue
            if h>=po['sl']: ep=po['sl']; r='❌ SL'
            elif l<=po['tp']: ep=po['tp']; r='✅ TP'
            elif ct>=EOD: ep=c; r='⏰ EOD'
            else: continue
            sh=int(CAP/po['entry'])
            gp=(po['entry']-ep)*sh
            cs=calc_costs(po['entry'],ep,sh,'SHORT')
            tr.append({'symbol':sym,'net_pnl':gp-cs,'reason':r,'entry_time':str(po['entry_time']),'exit_time':str(ti)})
            ip=False; le=ti
    at.extend(tr)
    n=len(tr)
    if n>=2:
        w=[t for t in tr if t['net_pnl']>0]; ls=[t for t in tr if t['net_pnl']<=0]
        nt=sum(t['net_pnl'] for t in tr)
        gw=sum(t['net_pnl'] for t in w); gl=abs(sum(t['net_pnl'] for t in ls))
        pf=round(gw/gl,4) if gl>0 else 99.9999; wr=round(len(w)/n*100,1)
    else: nt=sum(t['net_pnl'] for t in tr); pf=0; wr=0
    ps.append({'symbol':sym,'trades':n,'wins':len([t for t in tr if t['net_pnl']>0]),'win_rate':wr,'net_pnl':round(nt,2),'profit_factor':pf})
    print(f"  {'✅' if pf>=1.0 and n>=2 else '❌'} {sym:<18} {n:3d}t WR={wr:>5.1f}% Net=₹{nt:>+9,.0f} PF={pf:<8.4f}",file=sys.stderr)

ps.sort(key=lambda x:x['net_pnl'],reverse=True)
tt=len(at); tw=sum(1 for t in at if t['net_pnl']>0)
tnet=sum(t['net_pnl'] for t in at)
gw=sum(t['net_pnl'] for t in at if t['net_pnl']>0)
gl=abs(sum(t['net_pnl'] for t in at if t['net_pnl']<=0))
apf=round(gw/gl,4) if gl>0 else 99.9999; awr=round(tw/tt*100,1) if tt>0 else 0
tpn=sum(1 for t in at if 'TP' in t['reason'])
sln=sum(1 for t in at if 'SL' in t['reason'])
edn=sum(1 for t in at if 'EOD' in t['reason'])
ps2=sum(1 for s in ps if s['profit_factor']>=1.0 and s['trades']>=2)
tq=len([s for s in ps if s['trades']>=2])

print(f"\n{'='*130}")
print(f"  RSI OVERBOUGHT SHORT | RSI({RSI_PER}) {OB}/{ENTRY} | SL={SL}% TP={TP}%")
print(f"  Screener: mcap≥{MCAP}Cr atr≥{ATR}% price≥{PRICE}")
print(f"{'='*130}")
print(f"\n{'Rank':<5} {'Symbol':<18} {'Trades':>7} {'Wins':>5} {'WR%':>6} {'Net P&L':>14} {'PF':>10}")
print("-"*130)
for i,s in enumerate(ps,1):
    if s['trades']<1: continue
    mark='✅' if s['profit_factor']>=1.0 and s['trades']>=2 else '❌'
    print(f"{mark} {i:<3} {s['symbol']:<18} {s['trades']:>7} {s['wins']:>5} {s['win_rate']:>5.1f}% ₹{s['net_pnl']:>+10,.0f}  {s['profit_factor']:<10.4f}")
print("-"*130)
print(f"\n{'':5} {'TOTAL':<18} {tt:>7} {tw:>5} {awr:>5.1f}% ₹{tnet:>+10,.0f}  {apf:<10.4f}")
print(f"  TP hits: {tpn} | SL hits: {sln} | EOD exits: {edn}")
print(f"  Profitable stocks: {ps2}/{tq} ({round(ps2/max(tq,1)*100,1)}%)")
