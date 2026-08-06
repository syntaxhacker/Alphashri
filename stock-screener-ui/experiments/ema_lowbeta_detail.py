#!/usr/bin/env python3
"""Detailed EMA Cross 60-min backtest on LOW BETA stocks."""
import sys, os, time
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader', 'screeners'))

from tradingview_screener import Query, col
from concurrent.futures import ThreadPoolExecutor
import pandas as pd

from experiments.benchmark_screener_params import load_or_fetch_candle_data
from experiments.ema_benchmark import calc_costs, ema
from market_data.market_data import resample_candles

try:
    from tv_helpers import get_tradingview_cookies
    cookies = get_tradingview_cookies(quiet=True)
except:
    cookies = None

print("Fetching low-beta stocks from TV...", file=sys.stderr)
_, df = (
    Query()
    .select('name', 'close', 'volume', 'market_cap_basic', 'beta_1_year', 'sector')
    .set_markets('india')
    .where(
        col('market_cap_basic') > 10_000_000_000,
        col('beta_1_year').between(0, 0.85),
        col('close') > 50, col('volume') > 100000,
        col('exchange') == 'NSE',
    )
    .limit(100)
    .get_scanner_data(cookies=cookies)
)

symbols = [str(s).upper() for s in df['name'].tolist()]
print(f"  {len(symbols)} low-beta stocks", file=sys.stderr)

candle_data = load_or_fetch_candle_data(symbols)
all_trades = []; per_stock = []

for sym in symbols:
    df_5m = candle_data.get(sym)
    if df_5m is None or len(df_5m) < 200:
        per_stock.append({'symbol': sym, 'trades': 0, 'wins': 0, 'net_pnl': 0, 'profit_factor': 0})
        continue

    df_60 = resample_candles(df_5m, 60)
    if df_60 is None or len(df_60) < 20:
        per_stock.append({'symbol': sym, 'trades': 0, 'wins': 0, 'net_pnl': 0, 'profit_factor': 0})
        continue

    closes = df_60['close'].tolist()
    f = ema(closes, 1); s = ema(closes, 2)
    sl = 8/100; tp = 12/100
    trades = []; in_pos = False; pos = {}; last_exit = -5

    for i in range(2, len(closes)):
        c = closes[i]
        if not in_pos:
            if (i - last_exit) < 2: continue
            if f[i-1] <= s[i-1] and f[i] > s[i]:
                pos = {'entry': c, 'sl': c*(1-sl), 'tp': c*(1+tp), 'entry_time': i}
                in_pos = True
        else:
            if c >= pos['tp']: ep = pos['tp']; r = '✅ TP'
            elif c <= pos['sl']: ep = pos['sl']; r = '❌ SL'
            else: continue
            sh = int(100000 / pos['entry'])
            gp = (ep - pos['entry']) * sh
            cs = calc_costs(pos['entry'], ep, sh, 'LONG')
            trades.append({'net_pnl': gp - cs, 'reason': r, 'symbol': sym})
            in_pos = False; last_exit = i

    all_trades.extend(trades)
    n = len(trades)
    if n >= 2:
        wins = [t for t in trades if t['net_pnl'] > 0]
        losses = [t for t in trades if t['net_pnl'] <= 0]
        net = sum(t['net_pnl'] for t in trades)
        gw = sum(t['net_pnl'] for t in wins)
        gl = abs(sum(t['net_pnl'] for t in losses))
        pf = round(gw/gl, 4) if gl > 0 else 99.9999
        wr = round(len(wins)/n*100, 1)
    else:
        net = sum(t['net_pnl'] for t in trades); pf = 0; wr = 0

    per_stock.append({'symbol': sym, 'trades': n, 'wins': len([t for t in trades if t['net_pnl']>0]),
                       'win_rate': wr, 'net_pnl': round(net, 2), 'profit_factor': pf})
    print(f"  {'✅' if pf >= 1.0 and n >= 2 else '❌'} {sym:<20} {n:3d}t WR={wr:>5.1f}% Net=₹{net:>+9,.0f} PF={pf:<8.4f}", file=sys.stderr)

per_stock.sort(key=lambda x: x['net_pnl'], reverse=True)

tt = len(all_trades); tw = sum(1 for t in all_trades if t['net_pnl'] > 0)
tn = sum(t['net_pnl'] for t in all_trades)
gw = sum(t['net_pnl'] for t in all_trades if t['net_pnl'] > 0)
gl = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl'] <= 0))
apf = round(gw/gl, 4) if gl > 0 else 99.9999
awr = round(tw/tt*100, 1) if tt > 0 else 0
tpn = sum(1 for t in all_trades if 'TP' in t.get('reason',''))
sln = sum(1 for t in all_trades if 'SL' in t.get('reason',''))
ps2 = sum(1 for s in per_stock if s['profit_factor'] >= 1.0 and s['trades'] >= 2)
tq = len([s for s in per_stock if s['trades'] >= 2])

print(f"\n{'='*140}")
print(f"  📊 EMA CROSS 60-min on LOW BETA STOCKS")
print(f"  SL=8% TP=12% | FAST=1 SLOW=2 | Jan–Jun 2026")
print(f"{'='*140}")
print(f"{'Rank':<5} {'Symbol':<20} {'Trades':>7} {'Wins':>5} {'WR%':>6} {'Net P&L':>14} {'PF':>10}")
print("-" * 140)
for i, s in enumerate(per_stock, 1):
    if s['trades'] < 1: continue
    mark = '✅' if s['profit_factor'] >= 1.0 and s['trades'] >= 2 else '❌'
    print(f"{mark} {i:<3} {s['symbol']:<20} {s['trades']:>7} {s['wins']:>5} {s['win_rate']:>5.1f}% ₹{s['net_pnl']:>+10,.0f}  {s['profit_factor']:<10.4f}")
print("-" * 140)
print(f"\n{'':5} {'TOTAL':<20} {tt:>7} {tw:>5} {awr:>5.1f}% ₹{tn:>+10,.0f}  {apf:<10.4f}")
print(f"  TP hits: {tpn} | SL hits: {sln}")
print(f"  Profitable stocks: {ps2}/{tq} ({round(ps2/max(tq,1)*100,1)}%)")
