#!/usr/bin/env python3
"""Benchmark SHORT-ONLY intraday strategy (S1 breakdown entry).

Usage:
  python3 experiments/benchmark_short_params.py \
    --min-mcap-cr 2000 --min-atr-pct 2.0 --min-price 100 \
    --sl-pct 3.0 --tp-pct 4.5 --buffer-pct 0.3

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
    p.add_argument('--sl-pct', type=float, default=3.0)
    p.add_argument('--tp-pct', type=float, default=4.5)
    p.add_argument('--buffer-pct', type=float, default=0.3)
    p.add_argument('--max-dist-pct', type=float, default=5.0)
    p.add_argument('--pivot-type', default='fibonacci')
    return p.parse_args()

def main():
    args = parse_args()
    desc = f"shorts(scr:mcap>={args.min_mcap_cr} atr>={args.min_atr_pct}% price>={args.min_price}) sr(SL={args.sl_pct}% TP={args.tp_pct}% buf={args.buffer_pct}% pivot={args.pivot_type})"
    print(f"  {desc}", file=sys.stderr)
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
        print("  ERROR: <3 qualifying stocks", file=sys.stderr); print("METRIC aggregate_pf=0"); return

    candle_data = load_or_fetch_candle_data(qualifying)
    all_trades = []; stock_pfs = []

    sl_pct = args.sl_pct / 100; tp_pct = args.tp_pct / 100
    buf_pct = args.buffer_pct / 100; max_dist_pct = args.max_dist_pct / 100

    for sym in qualifying:
        df_5m = candle_data.get(sym)
        if df_5m is None or len(df_5m) < 200: continue
        df_daily = resample_candles(df_5m, 1440)
        dates = sorted(df_daily.index.normalize().unique())
        if len(dates) < 2: continue
        ohlc = {}
        for idx, row in df_daily.iterrows():
            ohlc[idx.normalize()] = {'high': row['high'], 'low': row['low'], 'close': row['close']}

        trades = []; in_pos = False; pos = {}; last_exit = None
        for day_date in dates[1:]:
            prev = dates[dates.index(day_date) - 1]
            po = ohlc.get(prev)
            if not po: continue
            pivot = calculate_pivot_points(po['high'], po['low'], po['close'], args.pivot_type)
            s1 = pivot.s1; s2 = pivot.s2
            # For shorts: entry when price closes BELOW S1 - buffer
            s1_trigger = s1 * (1 - buf_pct)
            min_price = s1 * (1 - max_dist_pct)  # don't short if already too far below

            ds = day_date if day_date.tz else day_date.tz_localize('UTC')
            dd = df_5m[(df_5m.index >= ds) & (df_5m.index < ds + timedelta(days=1))]
            if len(dd) < 3: continue
            for idx, row in dd.iterrows():
                ti = idx.tz_convert(IST); ct = ti.hour * 60 + ti.minute
                c = float(row['close']); h = float(row['high']); lo = float(row['low'])
                if ct < MIN_ENTRY_TIME: continue
                if ct >= EOD_TIME: break
                if not in_pos:
                    if last_exit and (ti - last_exit).total_seconds() / 60 < COOLDOWN: continue
                    # Short entry: price below S1 buffer, and not too far down
                    if lo <= s1_trigger and c <= s1_trigger and c >= min_price:
                        entry = c
                        # Short SL: stock goes UP by sl_pct%
                        sl = entry * (1 + sl_pct)
                        # Short TP: stock goes DOWN by tp_pct% OR use S2
                        default_tp = entry * (1 - tp_pct)
                        tp = s2 if s2 and s2 < entry else default_tp
                        pos = {'entry': entry, 'sl': sl, 'tp': tp, 'entry_time': ti, 's1': s1, 's2': s2 if s2 else 0}
                        in_pos = True; continue
                if in_pos:
                    # Short: SL hit when price goes UP (high > sl)
                    if h >= pos['sl']: ep = pos['sl']; r = 'SL'
                    # Short: TP hit when price goes DOWN (low < tp)
                    elif lo <= pos['tp']: ep = pos['tp']; r = 'TP'
                    elif ct >= EOD_TIME: ep = c; r = 'EOD'
                    else: continue
                    # P&L for short: (entry - exit) * shares
                    sh = int(100000 / pos['entry'])
                    gp = (pos['entry'] - ep) * sh
                    cs = calc_costs(pos['entry'], ep, sh, 'SHORT')
                    trades.append({'net_pnl': gp - cs, 'gross_pnl': gp, 'costs': cs, 'reason': r, 'symbol': sym})
                    in_pos = False; last_exit = ti

        all_trades.extend(trades)
        if len(trades) >= 2:
            wins = [t for t in trades if t['net_pnl'] > 0]
            losses = [t for t in trades if t['net_pnl'] <= 0]
            gw = sum(t['net_pnl'] for t in wins)
            gl = abs(sum(t['net_pnl'] for t in losses))
            stock_pfs.append(round(gw / gl, 4) if gl > 0 else 99.9999)

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
    tp_n = sum(1 for t in all_trades if t['reason'] == 'TP')
    sl_n = sum(1 for t in all_trades if t['reason'] == 'SL')
    eod_n = sum(1 for t in all_trades if t['reason'] == 'EOD')

    print(f"  Result: {total_trades}t PF={agg_pf} Net=₹{total_net:,.0f} WR={round(wins_n/max(total_trades,1)*100,1)}% TP={tp_n} SL={sl_n} EOD={eod_n} Stocks={total_count}/{len(qualifying)} Prof={prof_ratio}% ({elapsed:.0f}s)", file=sys.stderr)
    print(f"METRIC aggregate_pf={agg_pf}")
    print(f"METRIC qual_stocks={total_count}")
    print(f"METRIC total_trades={total_trades}")
    print(f"METRIC total_net_pnl={round(total_net, 2)}")
    print(f"METRIC avg_pf={avg_pf}")
    print(f"METRIC profitable_ratio={prof_ratio}")
    print(f"METRIC win_rate={round(wins_n/max(total_trades,1)*100,1)}")

if __name__ == '__main__':
    main()
