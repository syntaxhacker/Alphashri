#!/usr/bin/env python3
"""Detailed SHORT-ONLY SR Breakout backtest."""
import sys, os, csv, time
from datetime import timedelta, timezone
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners')); sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))
import pandas as pd
from trading.pivot_utils import calculate_pivot_points
from experiments.benchmark_screener_params import load_or_fetch_tv_data, load_or_fetch_candle_data
from experiments.ema_benchmark import calc_costs
from market_data.market_data import resample_candles

IST = timezone(timedelta(hours=5, minutes=30))
MIN_MCAP=1000; MIN_ATR=6.0; MIN_PRICE=50; MIN_VOL=500000
SL_PCT=1.0; TP_PCT=3.5; BUFFER=0.5; PIVOT='fibonacci'
MIN_ENTRY=600; EOD=915; COOLDOWN=30; CAPITAL=100000

tv = load_or_fetch_tv_data()
syms = []
for s in tv:
    if float(s['mcap_cr'])<MIN_MCAP or float(s['atr_pct'])<MIN_ATR or float(s['price'])<MIN_PRICE or float(s['volume'])<MIN_VOL: continue
    syms.append(s['symbol'])
print(f"📊 SHORT-ONLY (Fibonacci) on {len(syms)} stocks", file=sys.stderr)
candle_data = load_or_fetch_candle_data(syms)
all_trades=[]; per_stock=[]

for sym in syms:
    df_5m=candle_data.get(sym)
    if df_5m is None or len(df_5m)<200: continue
    df_daily=resample_candles(df_5m,1440)
    dates=sorted(df_daily.index.normalize().unique())
    if len(dates)<2: continue
    ohlc={}
    for idx,row in df_daily.iterrows(): ohlc[idx.normalize()]={'high':row['high'],'low':row['low'],'close':row['close']}
    trades=[]; in_pos=False; pos={}; last_exit=None
    sl_pct=SL_PCT/100; tp_pct=TP_PCT/100; buf_pct=BUFFER/100
    for day_date in dates[1:]:
        prev=dates[dates.index(day_date)-1]
        po=ohlc.get(prev)
        if not po: continue
        pivot=calculate_pivot_points(po['high'],po['low'],po['close'],PIVOT)
        s1=pivot.s1; s2=pivot.s2
        trig=s1*(1-buf_pct)
        ds=day_date if day_date.tz else day_date.tz_localize('UTC')
        dd=df_5m[(df_5m.index>=ds)&(df_5m.index<ds+timedelta(days=1))]
        if len(dd)<3: continue
        for idx,row in dd.iterrows():
            ti=idx.tz_convert(IST); ct=ti.hour*60+ti.minute
            c=float(row['close']); h=float(row['high']); lo=float(row['low'])
            if ct<MIN_ENTRY: continue
            if ct>=EOD: break
            if not in_pos:
                if last_exit and (ti-last_exit).total_seconds()/60<COOLDOWN: continue
                if lo<=trig and c<=trig:
                    entry=c; sl=entry*(1+sl_pct)
                    default_tp=entry*(1-tp_pct)
                    tp=s2 if s2 and s2<entry else default_tp
                    pos={'entry':entry,'sl':sl,'tp':tp,'entry_time':ti,'s2':s2 if s2 else 0}
                    in_pos=True; continue
            if in_pos:
                if h>=pos['sl']: ep=pos['sl']; r='❌ SL'
                elif lo<=pos['tp']: ep=pos['tp']; r='✅ TP'
                elif ct>=EOD: ep=c; r='⏰ EOD'
                else: continue
                sh=int(CAPITAL/pos['entry'])
                gp=(pos['entry']-ep)*sh
                cs=calc_costs(pos['entry'],ep,sh,'SHORT')
                trades.append({'symbol':sym,'net_pnl':gp-cs,'reason':r,'entry_time':str(pos['entry_time']),'exit_time':str(ti)})
                in_pos=False; last_exit=ti
    all_trades.extend(trades)
    n=len(trades)
    if n>=2:
        wins=[t for t in trades if t['net_pnl']>0]; losses=[t for t in trades if t['net_pnl']<=0]
        net=sum(t['net_pnl'] for t in trades)
        gw=sum(t['net_pnl'] for t in wins); gl=abs(sum(t['net_pnl'] for t in losses))
        pf=round(gw/gl,4) if gl>0 else 99.9999; wr=round(len(wins)/n*100,1)
    else: net=sum(t['net_pnl'] for t in trades); pf=0; wr=0
    per_stock.append({'symbol':sym,'trades':n,'wins':len([t for t in trades if t['net_pnl']>0]),'win_rate':wr,'net_pnl':round(net,2),'profit_factor':pf})
    print(f"  {'✅' if pf>=1.0 and n>=2 else '❌'} {sym:<18} {n:3d}t WR={wr:>5.1f}% Net=₹{net:>+9,.0f} PF={pf:<8.4f}", file=sys.stderr)

per_stock.sort(key=lambda x:x['net_pnl'],reverse=True)
tt=len(all_trades); tw=sum(1 for t in all_trades if t['net_pnl']>0)
tn=sum(t['net_pnl'] for t in all_trades)
gw=sum(t['net_pnl'] for t in all_trades if t['net_pnl']>0)
gl=abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl']<=0))
apf=round(gw/gl,4) if gl>0 else 99.9999; awr=round(tw/tt*100,1) if tt>0 else 0
tpn=sum(1 for t in all_trades if 'TP' in t['reason'])
sln=sum(1 for t in all_trades if 'SL' in t['reason'])
edn=sum(1 for t in all_trades if 'EOD' in t['reason'])
tc=sum(t.get('costs',0) for t in all_trades)
ps=sum(1 for s in per_stock if s['profit_factor']>=1.0 and s['trades']>=2)
tq=len([s for s in per_stock if s['trades']>=2])

print(f"\n{'='*130}")
print(f"  SHORT-ONLY | Fibonacci | SL={SL_PCT}% TP={TP_PCT}% buf={BUFFER}%")
print(f"  Screener: mcap≥{MIN_MCAP}Cr atr≥{MIN_ATR}% price≥{MIN_PRICE}")
print(f"{'='*130}")
print(f"\n{'Rank':<5} {'Symbol':<18} {'Trades':>7} {'Wins':>5} {'WR%':>6} {'Net P&L':>14} {'PF':>10}")
print("-"*130)
for i,s in enumerate(per_stock,1):
    if s['trades']<1: continue
    mark='✅' if s['profit_factor']>=1.0 and s['trades']>=2 else '❌'
    print(f"{mark} {i:<3} {s['symbol']:<18} {s['trades']:>7} {s['wins']:>5} {s['win_rate']:>5.1f}% ₹{s['net_pnl']:>+10,.0f}  {s['profit_factor']:<10.4f}")
print("-"*130)
print(f"\n{'':5} {'TOTAL':<18} {tt:>7} {tw:>5} {awr:>5.1f}% ₹{tn:>+10,.0f}  {apf:<10.4f}")
print(f"  TP hits: {tpn} | SL hits: {sln} | EOD exits: {edn}")
print(f"  Profitable stocks: {ps}/{tq} ({round(ps/max(tq,1)*100,1)}%)")
