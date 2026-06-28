#!/usr/bin/env python3
"""Bollinger Bands strategy benchmark for different entry rules.

Strategies:
  bounce    — Mean reversion: long at lower band, short at upper band
  breakout  — Trend: enter when close closes outside bands
  squeeze   — Volatility: enter when BB contracts then price breaks out

Usage:
  python3 experiments/benchmark_bb_strategy.py \
    --strategy bounce --bb-period 20 --bb-std 2.0 \
    --sl-pct 2.0 --tp-pct 4.0 \
    --min-mcap-cr 2000 --tf 60

Outputs METRIC lines for autoresearch.
"""
import argparse, sys, os, time, math
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
    p.add_argument('--strategy', default='bounce', choices=['bounce','breakout','squeeze'])
    p.add_argument('--bb-period', type=int, default=20)
    p.add_argument('--bb-std', type=float, default=2.0)
    p.add_argument('--sl-pct', type=float, default=2.0)
    p.add_argument('--tp-pct', type=float, default=4.0)
    p.add_argument('--tf', type=int, default=60)
    p.add_argument('--squeeze-threshold', type=float, default=0.1,
                   help='BB width percentile for squeeze detection (0.05-0.3)')
    p.add_argument('--exit-middle', action='store_true', help='Exit when price touches middle band')
    p.add_argument('--min-mcap-cr', type=float, default=2000.0)
    p.add_argument('--min-atr-pct', type=float, default=1.5)
    p.add_argument('--min-price', type=float, default=100.0)
    p.add_argument('--min-volume', type=float, default=500000.0)
    return p.parse_args()

def bb(closes, period=20, num_std=2.0):
    """Return (middle, upper, lower, width_pct) arrays."""
    arr = np.array(closes)
    middle = pd.Series(arr).rolling(period).mean().values
    std = pd.Series(arr).rolling(period).std().values
    upper = middle + num_std * std
    lower = middle - num_std * std
    width = (upper - lower) / middle * 100  # % bandwidth
    return middle, upper, lower, width

def bb_bounce(closes, period, num_std, sl_pct, tp_pct):
    """Mean reversion: long at lower band touch, short at upper band."""
    mid, up, lo, _ = bb(closes, period, num_std)
    sl = sl_pct / 100; tp = tp_pct / 100
    trades = []; in_pos = False; pos = {}; last_exit = -999
    for i in range(period + 2, len(closes)):
        c = closes[i]
        if not in_pos:
            if (i - last_exit) < 2: continue
            # Long at lower band
            if c <= lo[i] and c >= lo[i] * 0.995:
                pos = {'side': 'LONG', 'entry': c, 'entry_time': i,
                       'sl': c * (1 - sl), 'tp': c * (1 + tp)}
                in_pos = True; continue
            # Short at upper band
            if c >= up[i] and c <= up[i] * 1.005:
                pos = {'side': 'SHORT', 'entry': c, 'entry_time': i,
                       'sl': c * (1 + sl), 'tp': c * (1 - tp)}
                in_pos = True; continue
        else:
            reason = None; ep = None
            if pos['side'] == 'LONG':
                if c >= pos['tp']: ep = pos['tp']; reason = 'TP'
                elif c <= pos['sl']: ep = pos['sl']; reason = 'SL'
                elif c >= mid[i]: ep = c; reason = 'MID'
            else:
                if c <= pos['tp']: ep = pos['tp']; reason = 'TP'
                elif c >= pos['sl']: ep = pos['sl']; reason = 'SL'
                elif c <= mid[i]: ep = c; reason = 'MID'
            if reason:
                gp = (ep - pos['entry']) * 100000 / pos['entry'] if pos['side'] == 'LONG' else (pos['entry'] - ep) * 100000 / pos['entry']
                cs = calc_costs(pos['entry'], ep, int(100000/pos['entry']), pos['side'])
                trades.append({'net_pnl': gp - cs, 'reason': reason})
                in_pos = False; last_exit = i
    return trades

def bb_breakout(closes, period, num_std, sl_pct, tp_pct):
    """Trend: enter when close closes outside bands."""
    mid, up, lo, _ = bb(closes, period, num_std)
    sl = sl_pct / 100; tp = tp_pct / 100
    trades = []; in_pos = False; pos = {}; last_exit = -999
    for i in range(period + 2, len(closes)):
        c = closes[i]
        if not in_pos:
            if (i - last_exit) < 2: continue
            if c > up[i]:
                entry = c
                pos = {'side': 'LONG', 'entry': entry, 'entry_time': i,
                       'sl': entry * (1 - sl), 'tp': entry * (1 + tp)}
                in_pos = True; continue
            if c < lo[i]:
                entry = c
                pos = {'side': 'SHORT', 'entry': entry, 'entry_time': i,
                       'sl': entry * (1 + sl), 'tp': entry * (1 - tp)}
                in_pos = True; continue
        else:
            reason = None; ep = None
            if pos['side'] == 'LONG':
                if c >= pos['tp']: ep = pos['tp']; reason = 'TP'
                elif c <= pos['sl']: ep = pos['sl']; reason = 'SL'
                elif c <= mid[i]: ep = c; reason = 'MID'
            else:
                if c <= pos['tp']: ep = pos['tp']; reason = 'TP'
                elif c >= pos['sl']: ep = pos['sl']; reason = 'SL'
                elif c >= mid[i]: ep = c; reason = 'MID'
            if reason:
                gp = (ep - pos['entry']) * 100000 / pos['entry'] if pos['side'] == 'LONG' else (pos['entry'] - ep) * 100000 / pos['entry']
                cs = calc_costs(pos['entry'], ep, int(100000/pos['entry']), pos['side'])
                trades.append({'net_pnl': gp - cs, 'reason': reason})
                in_pos = False; last_exit = i
    return trades

def bb_squeeze(closes, period, num_std, sl_pct, tp_pct, squeeze_pctile=0.1):
    """Volatility contraction: enter when BB squeezes then price breaks out."""
    mid, up, lo, width = bb(closes, period, num_std)
    sl = sl_pct / 100; tp = tp_pct / 100
    # Find squeeze periods: width below threshold percentile
    threshold = np.percentile(width[period:], squeeze_pctile * 100)
    in_squeeze = False; squeeze_start = -1
    trades = []; in_pos = False; pos = {}; last_exit = -999
    for i in range(period + 2, len(closes)):
        c = closes[i]
        if not in_squeeze:
            if width[i] < threshold:
                in_squeeze = True; squeeze_start = i
            continue
        # In squeeze — look for breakout
        if not in_pos:
            if (i - last_exit) < 2: continue
            if width[i] > threshold and i > squeeze_start + 2:
                # Squeeze released — enter in breakout direction
                recent_high = max(closes[max(period, i-5):i])
                recent_low = min(closes[max(period, i-5):i])
                if c > mid[i]:
                    entry = c
                    pos = {'side': 'LONG', 'entry': entry, 'entry_time': i,
                           'sl': entry * (1 - sl), 'tp': entry * (1 + tp)}
                    in_pos = True; in_squeeze = False; continue
                elif c < mid[i]:
                    entry = c
                    pos = {'side': 'SHORT', 'entry': entry, 'entry_time': i,
                           'sl': entry * (1 + sl), 'tp': entry * (1 - tp)}
                    in_pos = True; in_squeeze = False; continue
        if in_pos:
            reason = None; ep = None
            if pos['side'] == 'LONG':
                if c >= pos['tp']: ep = pos['tp']; reason = 'TP'
                elif c <= pos['sl']: ep = pos['sl']; reason = 'SL'
            else:
                if c <= pos['tp']: ep = pos['tp']; reason = 'TP'
                elif c >= pos['sl']: ep = pos['sl']; reason = 'SL'
            if reason:
                gp = (ep - pos['entry']) * 100000 / pos['entry'] if pos['side'] == 'LONG' else (pos['entry'] - ep) * 100000 / pos['entry']
                cs = calc_costs(pos['entry'], ep, int(100000/pos['entry']), pos['side'])
                trades.append({'net_pnl': gp - cs, 'reason': reason})
                in_pos = False; last_exit = i
    return trades

def main():
    args = parse_args()
    t0 = time.time()

    tv = load_or_fetch_tv_data()
    qualifying = []
    for s in tv:
        mcap = float(s['mcap_cr']); atr = float(s['atr_pct'])
        price = float(s['price']); vol = float(s['volume'])
        if mcap < args.min_mcap_cr or atr < args.min_atr_pct or price < args.min_price or vol < args.min_volume:
            continue
        qualifying.append(s['symbol'])

    if len(qualifying) < 3:
        print("ERROR: <3 stocks"); print("METRIC aggregate_pf=0"); return

    candle_data = load_or_fetch_candle_data(qualifying)
    desc = f"bb({args.strategy} p={args.bb_period} std={args.bb_std} SL={args.sl_pct}% TP={args.tp_pct}% tf={args.tf}) scr(mcap>={args.min_mcap_cr})"
    print(f"  {desc}", file=sys.stderr)

    all_trades = []; stock_pfs = []
    for sym in qualifying:
        df = candle_data.get(sym)
        if df is None or len(df) < 200: continue
        rdf = resample_candles(df, args.tf)
        if rdf is None or len(rdf) < args.bb_period + 10: continue
        closes = rdf['close'].tolist()

        if args.strategy == 'bounce':
            trades = bb_bounce(closes, args.bb_period, args.bb_std, args.sl_pct, args.tp_pct)
        elif args.strategy == 'breakout':
            trades = bb_breakout(closes, args.bb_period, args.bb_std, args.sl_pct, args.tp_pct)
        elif args.strategy == 'squeeze':
            trades = bb_squeeze(closes, args.bb_period, args.bb_std, args.sl_pct, args.tp_pct, args.squeeze_threshold)
        else:
            trades = []

        all_trades.extend(trades)
        if len(trades) >= 2:
            wins = [t for t in trades if t['net_pnl'] > 0]
            losses = [t for t in trades if t['net_pnl'] <= 0]
            gw = sum(t['net_pnl'] for t in wins)
            gl = abs(sum(t['net_pnl'] for t in losses))
            stock_pfs.append(round(gw / gl, 4) if gl > 0 else 99.9999)

    tt = len(all_trades); tn = sum(t['net_pnl'] for t in all_trades)
    gw = sum(t['net_pnl'] for t in all_trades if t['net_pnl'] > 0)
    gl = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl'] <= 0))
    apf = round(gw / gl, 4) if gl > 0 else 99.9999
    tw = sum(1 for t in all_trades if t['net_pnl'] > 0)
    pc = sum(1 for pf in stock_pfs if pf >= 1.0)
    tc = len(stock_pfs); pr = round(pc / tc * 100, 1) if tc > 0 else 0
    tpn = sum(1 for t in all_trades if t.get('reason') == 'TP')
    sln = sum(1 for t in all_trades if t.get('reason') == 'SL')
    el = time.time() - t0

    print(f"  Result: {tt}t PF={apf} Net=₹{tn:,.0f} WR={round(tw/max(tt,1)*100,1)}% TP={tpn} SL={sln} Stocks={tc}/{len(qualifying)} Prof={pr}% ({el:.0f}s)", file=sys.stderr)
    print(f"METRIC aggregate_pf={apf}")
    print(f"METRIC qual_stocks={tc}")
    print(f"METRIC total_trades={tt}")
    print(f"METRIC total_net_pnl={round(tn, 2)}")
    print(f"METRIC profitable_ratio={pr}")
    print(f"METRIC win_rate={round(tw/max(tt,1)*100,1)}")

if __name__ == '__main__':
    main()
