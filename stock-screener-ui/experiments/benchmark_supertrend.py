#!/usr/bin/env python3
"""Supertrend strategy benchmark.

Parameters:
  atr_period — ATR lookback (7, 10, 14, 20)
  multiplier — ATR multiplier (2, 3, 4, 5)
  sl_pct, tp_pct — optional fixed SL/TP (0 = use Supertrend flip for exit)
  tf — timeframe in minutes

Strategy:
  Long  when Supertrend flips from red→green
  Short when Supertrend flips from green→red
  Exit when Supertrend flips back (or SL/TP hit)

Usage:
  python3 experiments/benchmark_supertrend.py \
    --atr-period 10 --multiplier 3.0 \
    --sl-pct 0 --tp-pct 0 \
    --tf 60 --min-mcap-cr 2000
"""
import argparse, sys, os, time
from datetime import timedelta, timezone

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners')); sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))

import pandas as pd
import numpy as np
from experiments.benchmark_screener_params import load_or_fetch_tv_data, load_or_fetch_candle_data
from experiments.ema_benchmark import calc_costs
from market_data.market_data import resample_candles

IST = timezone(timedelta(hours=5, minutes=30))

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--atr-period', type=int, default=10)
    p.add_argument('--multiplier', type=float, default=3.0)
    p.add_argument('--sl-pct', type=float, default=0)
    p.add_argument('--tp-pct', type=float, default=0)
    p.add_argument('--tf', type=int, default=60)
    p.add_argument('--min-mcap-cr', type=float, default=2000.0)
    p.add_argument('--min-atr-pct', type=float, default=1.5)
    p.add_argument('--min-price', type=float, default=100.0)
    p.add_argument('--min-volume', type=float, default=500000.0)
    return p.parse_args()

def supertrend(high, low, close, period=10, multiplier=3.0):
    """Calculate Supertrend. Returns (st_value, st_direction) arrays.
    direction: 1 = up (green), -1 = down (red)"""
    hi = np.array(high); lo = np.array(low); cl = np.array(close)
    hl2 = (hi + lo) / 2
    tr = np.maximum(hi[1:] - lo[1:], np.abs(hi[1:] - cl[:-1]), np.abs(lo[1:] - cl[:-1]))
    tr = np.concatenate([[tr[0]], tr])
    atr = pd.Series(tr).rolling(period).mean().values
    basic_up = hl2 - multiplier * atr
    basic_down = hl2 + multiplier * atr
    st = np.full(len(close), np.nan)
    direction = np.ones(len(close))
    for i in range(period, len(close)):
        if direction[i-1] == 1:  # in uptrend, check for flip down
            if cl[i] < basic_up[i]:
                direction[i] = -1
            else:
                direction[i] = 1
        else:  # in downtrend, check for flip up
            if cl[i] > basic_down[i]:
                direction[i] = 1
            else:
                direction[i] = -1
        if direction[i] == 1:
            st[i] = max(basic_up[i], st[i-1]) if not np.isnan(st[i-1]) else basic_up[i]
        else:
            st[i] = min(basic_down[i], st[i-1]) if not np.isnan(st[i-1]) else basic_down[i]
    return st, direction

def run_strategy(closes, highs, lows, period, mult, sl_pct, tp_pct, capital=100000):
    st, dirs = supertrend(highs, lows, closes, period, mult)
    sl = sl_pct / 100; tp = tp_pct / 100
    trades = []; in_pos = False; pos = {}
    for i in range(period + 5, len(closes)):
        c = closes[i]
        if not in_pos:
            # Entry on flip: direction changed
            if i > period + 5 and dirs[i] != dirs[i-1]:
                if dirs[i] == 1:  # flipped up → long
                    sl_price = c * (1 - sl) if sl > 0 else st[i]
                    tp_price = c * (1 + tp) if tp > 0 else None
                    pos = {'side': 'LONG', 'entry': c, 'sl': sl_price, 'tp': tp_price,
                           'st_entry': st[i], 'entry_idx': i}
                    in_pos = True
                elif dirs[i] == -1:  # flipped down → short
                    sl_price = c * (1 + sl) if sl > 0 else st[i]
                    tp_price = c * (1 - tp) if tp > 0 else None
                    pos = {'side': 'SHORT', 'entry': c, 'sl': sl_price, 'tp': tp_price,
                           'st_entry': st[i], 'entry_idx': i}
                    in_pos = True
        else:
            ep = None; reason = None
            # Check SL/TP first
            if pos['tp'] is not None:
                if pos['side'] == 'LONG' and c >= pos['tp']: ep = pos['tp']; reason = 'TP'
                elif pos['side'] == 'SHORT' and c <= pos['tp']: ep = pos['tp']; reason = 'TP'
            if pos['sl'] is not None and ep is None:
                if pos['side'] == 'LONG' and c <= pos['sl']: ep = pos['sl']; reason = 'SL'
                elif pos['side'] == 'SHORT' and c >= pos['sl']: ep = pos['sl']; reason = 'SL'
            # Check Supertrend flip exit
            if ep is None and dirs[i] != dirs[i-1]:
                ep = c; reason = 'ST_FLIP'
            if ep:
                corr = 1 if pos['side'] == 'LONG' else -1
                gp = corr * (ep - pos['entry']) * int(capital / pos['entry'])
                cs = calc_costs(pos['entry'], ep, int(capital / pos['entry']), pos['side'])
                trades.append({'net_pnl': gp - cs, 'reason': reason})
                in_pos = False
    return trades

def main():
    args = parse_args()
    t0 = time.time()
    tv = load_or_fetch_tv_data()
    qualifying = []
    for s in tv:
        mcap = float(s['mcap_cr']); atr = float(s['atr_pct'])
        price = float(s['price']); vol = float(s['volume'])
        if mcap < args.min_mcap_cr or atr < args.min_atr_pct or price < args.min_price or vol < args.min_volume: continue
        qualifying.append(s['symbol'])
    if len(qualifying) < 3: print("ERROR: <3 stocks"); print("METRIC aggregate_pf=0"); return

    candle_data = load_or_fetch_candle_data(qualifying)
    desc = f"st(period={args.atr_period} mult={args.multiplier} SL={args.sl_pct}% TP={args.tp_pct}% tf={args.tf})"
    print(f"  {desc}", file=sys.stderr)

    all_trades = []; stock_pfs = []
    for sym in qualifying:
        df = candle_data.get(sym)
        if df is None or len(df) < 200: continue
        rdf = resample_candles(df, args.tf)
        if rdf is None or len(rdf) < args.atr_period + 15: continue
        tr = run_strategy(rdf['close'].tolist(), rdf['high'].tolist(), rdf['low'].tolist(),
                          args.atr_period, args.multiplier, args.sl_pct, args.tp_pct)
        all_trades.extend(tr)
        if len(tr) >= 2:
            wins = [t for t in tr if t['net_pnl'] > 0]; losses = [t for t in tr if t['net_pnl'] <= 0]
            gw = sum(t['net_pnl'] for t in wins); gl = abs(sum(t['net_pnl'] for t in losses))
            stock_pfs.append(round(gw/gl,4) if gl>0 else 99.9999)

    tt = len(all_trades); tn = sum(t['net_pnl'] for t in all_trades)
    gw = sum(t['net_pnl'] for t in all_trades if t['net_pnl']>0); gl = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl']<=0))
    apf = round(gw/gl,4) if gl>0 else 99.9999; tw = sum(1 for t in all_trades if t['net_pnl']>0)
    pc = sum(1 for pf in stock_pfs if pf>=1.0); tc = len(stock_pfs); pr = round(pc/tc*100,1) if tc>0 else 0
    el = time.time()-t0
    print(f"  Result: {tt}t PF={apf} Net=₹{tn:,.0f} WR={round(tw/max(tt,1)*100,1)}% Stocks={tc}/{len(qualifying)} Prof={pr}% ({el:.0f}s)", file=sys.stderr)
    print(f"METRIC aggregate_pf={apf}"); print(f"METRIC qual_stocks={tc}")
    print(f"METRIC total_trades={tt}"); print(f"METRIC total_net_pnl={round(tn,2)}")
    print(f"METRIC profitable_ratio={pr}"); print(f"METRIC win_rate={round(tw/max(tt,1)*100,1)}")

if __name__ == '__main__':
    main()
