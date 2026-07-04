#!/usr/bin/env python3
"""Multi-strategy SHORT-ONLY intraday benchmark.

Strategies:
  s1_breakdown   — S1 breakdown (Fibonacci/classic pivots) [default]
  rsi_overbought — RSI > threshold then drops back in (mean reversion)
  breakout_fail  — Price breaks above resistance, falls back below
  ema_extended   — Price far above moving average, mean reversion

Usage:
  python3 experiments/benchmark_short_multi.py --strategy rsi_overbought \
    --min-mcap-cr 1000 --min-atr-pct 3.0
"""
import argparse, sys, os, time
from datetime import timedelta, timezone
import math

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners')); sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))

import pandas as pd
import numpy as np
from trading.pivot_utils import calculate_pivot_points
from experiments.benchmark_screener_params import load_or_fetch_tv_data, load_or_fetch_candle_data
from experiments.ema_benchmark import calc_costs, ema
from market_data.market_data import resample_candles

IST = timezone(timedelta(hours=5, minutes=30))
MIN_ENTRY_TIME = 600  # 10:00 AM
EOD_TIME = 915        # 15:15
COOLDOWN = 30         # minutes
CAPITAL = 100000

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--strategy', default='s1_breakdown', choices=['s1_breakdown','rsi_overbought','breakout_fail','ema_extended'])
    # Screener
    p.add_argument('--min-mcap-cr', type=float, default=1000.0)
    p.add_argument('--min-atr-pct', type=float, default=3.0)
    p.add_argument('--min-price', type=float, default=50.0)
    p.add_argument('--min-volume', type=float, default=500000.0)
    # SR-specific
    p.add_argument('--sl-pct', type=float, default=1.0)
    p.add_argument('--tp-pct', type=float, default=3.5)
    p.add_argument('--buffer-pct', type=float, default=0.5)
    p.add_argument('--pivot-type', default='fibonacci')
    # RSI-specific
    p.add_argument('--rsi-period', type=int, default=14)
    p.add_argument('--rsi-overbought', type=float, default=75)
    p.add_argument('--rsi-entry', type=float, default=70)
    # Breakout-fail-specific
    p.add_argument('--fail-lookback', type=int, default=12)  # candles to look back
    p.add_argument('--fail-resistance', default='r1', choices=['prev_high','r1','prev_close'])
    p.add_argument('--fail-retrace-pct', type=float, default=0.0)  # how far below resistance to confirm
    # EMA-extended-specific
    p.add_argument('--ema-period', type=int, default=20)
    p.add_argument('--extend-pct', type=float, default=2.0)  # % above EMA to trigger
    return p.parse_args()

def calc_rsi(prices, period=14):
    deltas = np.diff(prices)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    rs = avg_gain / avg_loss if avg_loss > 0 else 100
    rsi_vals = [50] * period
    rsi_vals.append(100 - 100 / (1 + rs) if avg_loss > 0 else 100)
    for i in range(period + 1, len(prices)):
        gain = gains[i - 1]; loss = losses[i - 1]
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        rs = avg_gain / avg_loss if avg_loss > 0 else 100
        rsi_vals.append(100 - 100 / (1 + rs) if avg_loss > 0 else 100)
    return rsi_vals

def get_resistance(prev_day, resistance_type):
    h = prev_day['high']; l = prev_day['low']; c = prev_day['close']
    if resistance_type == 'prev_high': return h
    if resistance_type == 'prev_close': return c
    if resistance_type == 'r1':
        pivot = calculate_pivot_points(h, l, c, 'fibonacci')
        return pivot.r1
    return h

def run_strategy(args, sym, df_5m, prev_daily):
    sl_pct = args.sl_pct / 100
    tp_pct = args.tp_pct / 100
    strat = args.strategy
    trades = []; in_pos = False; pos = {}; last_exit = None

    df_daily = resample_candles(df_5m, 1440)
    dates = sorted(df_daily.index.normalize().unique())
    if len(dates) < 2: return []
    ohlc = {}
    for idx, row in df_daily.iterrows():
        ohlc[idx.normalize()] = {'high': row['high'], 'low': row['low'], 'close': row['close']}

    # Pre-compute per-day data for strategies that need it
    for day_date in dates[1:]:
        prev = dates[dates.index(day_date) - 1]
        po = ohlc.get(prev)
        if not po: continue

        # Pre-compute pivots
        pivot = calculate_pivot_points(po['high'], po['low'], po['close'], args.pivot_type)

        # Pre-compute resistance
        resistance = get_resistance(po, args.fail_resistance) if strat == 'breakout_fail' else None

        # Get day's 5-min data
        ds = day_date if day_date.tz else day_date.tz_localize('UTC')
        dd = df_5m[(df_5m.index >= ds) & (df_5m.index < ds + timedelta(days=1))]
        if len(dd) < args.rsi_period + 5: continue

        closes = dd['close'].tolist()
        highs = dd['high'].tolist()
        lows = dd['low'].tolist()
        times = dd.index.tolist()

        # Pre-compute RSI for the whole day
        rsi_vals = calc_rsi(closes, args.rsi_period) if strat in ('rsi_overbought',) else None
        # Pre-compute EMA for the whole day
        ema_vals = ema(closes, args.ema_period) if strat in ('ema_extended',) else None

        for i in range(args.rsi_period if strat == 'rsi_overbought' else 1, len(closes)):
            ti = times[i].tz_convert(IST)
            ct = ti.hour * 60 + ti.minute
            c = closes[i]; h = highs[i]; lo = lows[i]

            if ct < MIN_ENTRY_TIME: continue
            if ct >= EOD_TIME: break

            if not in_pos:
                if last_exit and (ti - last_exit).total_seconds() / 60 < COOLDOWN: continue
                entry_price = None

                if strat == 's1_breakdown':
                    s1 = pivot.s1
                    buf = args.buffer_pct / 100
                    trig = s1 * (1 - buf)
                    if lo <= trig and c <= trig:
                        entry_price = c
                        s2 = pivot.s2
                        tp = s2 if s2 and s2 < c else c * (1 - tp_pct)

                elif strat == 'rsi_overbought':
                    if i >= args.rsi_period + 1:
                        rsi_prev = rsi_vals[i - 1]
                        rsi_cur = rsi_vals[i]
                        # RSI was overbought, now dropping below entry threshold
                        if rsi_prev > args.rsi_overbought and rsi_cur <= args.rsi_entry:
                            entry_price = c
                            tp = c * (1 - tp_pct)

                elif strat == 'breakout_fail':
                    # Check if any of last N candles broke above resistance
                    did_break = False
                    for j in range(max(1, i - args.fail_lookback), i + 1):
                        if closes[j - 1] > resistance:  # previous candle closed above resistance
                            did_break = True
                            break
                    if did_break and c <= resistance:
                        entry_price = c
                        tp = c * (1 - tp_pct)

                elif strat == 'ema_extended':
                    if i >= args.ema_period:
                        extend = (c - ema_vals[i]) / ema_vals[i] * 100
                        if extend >= args.extend_pct:
                            entry_price = c
                            tp = c * (1 - tp_pct)

                if entry_price is not None:
                    sl = entry_price * (1 + sl_pct)
                    pos = {'entry': entry_price, 'sl': sl, 'tp': tp, 'entry_time': ti}
                    in_pos = True
                    continue

            if in_pos:
                if h >= pos['sl']: ep = pos['sl']; r = 'SL'
                elif lo <= pos['tp']: ep = pos['tp']; r = 'TP'
                elif ct >= EOD_TIME: ep = c; r = 'EOD'
                else: continue
                sh = int(CAPITAL / pos['entry'])
                gp = (pos['entry'] - ep) * sh
                cs = calc_costs(pos['entry'], ep, sh, 'SHORT')
                trades.append({'net_pnl': gp - cs, 'gross_pnl': gp, 'reason': r, 'symbol': sym})
                in_pos = False; last_exit = ti

    return trades

def main():
    args = parse_args()
    t0 = time.time()
    tv = load_or_fetch_tv_data()
    qualifying = []
    for s in tv:
        mcap = float(s['mcap_cr']); atr = float(s['atr_pct'])
        price = float(s['price']); vol = float(s['volume'])
        if mcap < args.min_mcap_cr: continue
        if atr < args.min_atr_pct: continue
        if price < args.min_price: continue
        if vol < args.min_volume: continue
        qualifying.append(s['symbol'])
    if len(qualifying) < 3:
        print("ERROR: <3 stocks"); print("METRIC aggregate_pf=0"); return

    candle_data = load_or_fetch_candle_data(qualifying)
    desc_parts = [f"strat={args.strategy}", f"scr(mcap>={args.min_mcap_cr} atr>={args.min_atr_pct}% price>={args.min_price})"]
    if args.strategy == 's1_breakdown':
        desc_parts.append(f"sr(SL={args.sl_pct}% TP={args.tp_pct}% buf={args.buffer_pct}% pivot={args.pivot_type})")
    elif args.strategy == 'rsi_overbought':
        desc_parts.append(f"rsi(period={args.rsi_period} ob={args.rsi_overbought} entry={args.rsi_entry} SL={args.sl_pct}% TP={args.tp_pct}%)")
    elif args.strategy == 'breakout_fail':
        desc_parts.append(f"fail(lookback={args.fail_lookback} res={args.fail_resistance} retrace={args.fail_retrace_pct}% SL={args.sl_pct}% TP={args.tp_pct}%)")
    elif args.strategy == 'ema_extended':
        desc_parts.append(f"ema(period={args.ema_period} extend={args.extend_pct}% SL={args.sl_pct}% TP={args.tp_pct}%)")
    print(f"  {' | '.join(desc_parts)}", file=sys.stderr)

    all_trades = []; stock_pfs = []
    for sym in qualifying:
        df_5m = candle_data.get(sym)
        if df_5m is None or len(df_5m) < 200: continue
        trades = run_strategy(args, sym, df_5m, None)
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
    awr = round(tw / tt * 100, 1) if tt > 0 else 0
    pf_count = sum(1 for pf in stock_pfs if pf >= 1.0)
    tc = len(stock_pfs); pr = round(pf_count / tc * 100, 1) if tc > 0 else 0
    tpn = sum(1 for t in all_trades if t['reason'] == 'TP')
    sln = sum(1 for t in all_trades if t['reason'] == 'SL')
    edn = sum(1 for t in all_trades if t['reason'] == 'EOD')
    elapsed = time.time() - t0

    print(f"  Result: {tt}t PF={apf} Net=₹{tn:,.0f} WR={awr}% TP={tpn} SL={sln} EOD={edn} Stocks={tc}/{len(qualifying)} Prof={pr}% ({elapsed:.0f}s)", file=sys.stderr)
    print(f"METRIC aggregate_pf={apf}")
    print(f"METRIC qual_stocks={tc}")
    print(f"METRIC total_trades={tt}")
    print(f"METRIC total_net_pnl={round(tn, 2)}")
    print(f"METRIC profitable_ratio={pr}")
    print(f"METRIC win_rate={awr}")

if __name__ == '__main__':
    main()
