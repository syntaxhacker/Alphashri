#!/usr/bin/env python3
"""Benchmark SR Breakout with various screener + strategy params.

Usage:
  python3 experiments/benchmark_sr_params.py \
    --min-mcap-cr 2000 --min-atr-pct 2.0 --min-price 100 \
    --sl-pct 2.0 --tp-pct 3.0 --buffer-pct 0.1

Outputs METRIC lines for autoresearch.
"""
import argparse, sys, os, time
from datetime import timedelta, timezone

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))

import pandas as pd
from trading.pivot_utils import calculate_pivot_points
from experiments.benchmark_screener_params import load_or_fetch_tv_data, load_or_fetch_candle_data
from experiments.ema_benchmark import calc_costs
from market_data.market_data import resample_candles

IST = timezone(timedelta(hours=5, minutes=30))

MIN_ENTRY_TIME = 600  # 10:00 AM
EOD_TIME = 915  # 15:15
COOLDOWN = 30  # minutes

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--min-mcap-cr', type=float, default=2000.0)
    p.add_argument('--min-atr-pct', type=float, default=2.0)
    p.add_argument('--min-price', type=float, default=100.0)
    p.add_argument('--min-volume', type=float, default=500000.0)
    p.add_argument('--sl-pct', type=float, default=2.0)
    p.add_argument('--tp-pct', type=float, default=3.0)
    p.add_argument('--buffer-pct', type=float, default=0.1)
    p.add_argument('--max-dist-pct', type=float, default=5.0)
    p.add_argument('--pivot-type', default='classic')
    return p.parse_args()

def main():
    args = parse_args()
    desc = f"scr(mcap>={args.min_mcap_cr} atr>={args.min_atr_pct}% price>={args.min_price}) sr(SL={args.sl_pct}% TP={args.tp_pct}% buf={args.buffer_pct}%)"
    print(f"  {desc}", file=sys.stderr)
    t0 = time.time()

    # Load TV data
    tv = load_or_fetch_tv_data()

    # Filter by screener params
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
        print("  ERROR: <3 qualifying stocks", file=sys.stderr)
        print("METRIC aggregate_pf=0"); print("METRIC qual_stocks=0")
        print("METRIC total_trades=0"); print("METRIC total_net_pnl=0")
        print("METRIC profitable_ratio=0"); return

    # Load candle data
    candle_data = load_or_fetch_candle_data(qualifying)

    all_trades = []
    stock_pfs = []

    for sym in qualifying:
        df_5m = candle_data.get(sym)
        if df_5m is None or len(df_5m) < 200: continue

        df_daily = resample_candles(df_5m, 1440)
        daily_dates = df_daily.index.normalize().unique()
        if len(daily_dates) < 2: continue

        date_ohlc = {}
        for idx, row in df_daily.iterrows():
            date_ohlc[idx.normalize()] = {'high': row['high'], 'low': row['low'], 'close': row['close']}

        daily_sorted = sorted(daily_dates)
        date_to_prev = {}
        for i in range(1, len(daily_sorted)):
            date_to_prev[daily_sorted[i]] = daily_sorted[i - 1]

        # SR Breakout params
        sl_pct = args.sl_pct / 100
        tp_pct = args.tp_pct / 100
        buf_pct = args.buffer_pct / 100
        max_dist = args.max_dist_pct / 100

        trades = []
        in_pos = False; pos = {}; last_exit = None

        for day_date in daily_sorted[1:]:
            prev_date = date_to_prev.get(day_date)
            if prev_date is None: continue
            prev_ohlc = date_ohlc.get(prev_date)
            if prev_ohlc is None: continue

            pivot = calculate_pivot_points(prev_ohlc['high'], prev_ohlc['low'], prev_ohlc['close'], args.pivot_type)
            r1 = pivot.r1; r2 = pivot.r2
            buf_trigger = r1 * (1 + buf_pct)
            max_price = r1 * (1 + max_dist)

            day_start = day_date if day_date.tz else day_date.tz_localize('UTC')
            day_df = df_5m[(df_5m.index >= day_start) & (df_5m.index < day_start + timedelta(days=1))]
            if len(day_df) < 3: continue

            for idx, row in day_df.iterrows():
                ts_ist = idx.tz_convert(IST)
                ct = ts_ist.hour * 60 + ts_ist.minute
                close = float(row['close']); high = float(row['high']); low = float(row['low'])
                if ct < MIN_ENTRY_TIME: continue
                if ct >= EOD_TIME: break

                if not in_pos:
                    if last_exit and (ts_ist - last_exit).total_seconds() / 60 < COOLDOWN: continue
                    if high >= buf_trigger and close >= buf_trigger and close <= max_price:
                        entry = close
                        sl = entry * (1 - sl_pct)
                        default_tp = entry * (1 + tp_pct)
                        tp = r2 if r2 and r2 > entry else default_tp
                        pos = {'entry': entry, 'sl': sl, 'tp': tp, 'entry_time': ts_ist}
                        in_pos = True; continue

                if in_pos:
                    if low <= pos['sl']: exit_p = pos['sl']; reason = 'SL'
                    elif high >= pos['tp']: exit_p = pos['tp']; reason = 'TP'
                    elif ct >= EOD_TIME: exit_p = close; reason = 'EOD'
                    else: continue
                    shares = int(100000 / pos['entry'])
                    gp = (exit_p - pos['entry']) * shares
                    cs = calc_costs(pos['entry'], exit_p, shares, 'LONG')
                    trades.append({'net_pnl': gp - cs, 'gross_pnl': gp, 'costs': cs, 'reason': reason})
                    in_pos = False; last_exit = ts_ist

        all_trades.extend(trades)
        if len(trades) >= 2:
            wins = [t for t in trades if t['net_pnl'] > 0]
            losses = [t for t in trades if t['net_pnl'] <= 0]
            gw = sum(t['net_pnl'] for t in wins)
            gl = abs(sum(t['net_pnl'] for t in losses))
            stock_pfs.append(round(gw / gl, 4) if gl > 0 else 99.9999)

    # Aggregate
    total_trades = len(all_trades)
    total_net = sum(t['net_pnl'] for t in all_trades)
    gw = sum(t['net_pnl'] for t in all_trades if t['net_pnl'] > 0)
    gl = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl'] <= 0))
    agg_pf = round(gw / gl, 4) if gl > 0 else 99.9999
    wins_n = sum(1 for t in all_trades if t['net_pnl'] > 0)
    pf_count = sum(1 for pf in stock_pfs if pf >= 1.0)
    total_count = len(stock_pfs)
    prof_ratio = round(pf_count / total_count * 100, 1) if total_count > 0 else 0
    avg_pf = round(sum(stock_pfs) / total_count, 4) if total_count > 0 else 0
    elapsed = time.time() - t0

    print(f"  Result: {total_trades}t PF={agg_pf} Net=₹{total_net:,.0f} "
          f"Stocks={total_count}/{len(qualifying)} Prof={prof_ratio}% ({elapsed:.0f}s)", file=sys.stderr)

    print(f"METRIC aggregate_pf={agg_pf}")
    print(f"METRIC qual_stocks={total_count}")
    print(f"METRIC total_trades={total_trades}")
    print(f"METRIC total_net_pnl={round(total_net, 2)}")
    print(f"METRIC avg_pf={avg_pf}")
    print(f"METRIC profitable_ratio={prof_ratio}")

if __name__ == '__main__':
    main()
