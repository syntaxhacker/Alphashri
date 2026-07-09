#!/usr/bin/env python3
"""SR Breakout entry + BTST exit hybrid benchmark.

Uses SR Breakout signal (close above R1 + buffer) for entry,
but exits via BTST-style (tight SL, next-day close) instead of 
intraday SL/TP/EOD.

Usage:
  python3 experiments/benchmark_sr_btst.py \
    --min-mcap-cr 2000 --buffer-pct 0.1 \
    --btst-sl-pct 0.5

Outputs METRIC lines plus comparison with pure SR Breakout.
"""
import argparse, sys, os, time
from datetime import timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))

import pandas as pd
import numpy as np
from trading.pivot_utils import calculate_pivot_points
from experiments.benchmark_screener_params import load_or_fetch_tv_data, load_or_fetch_candle_data
from experiments.ema_benchmark import calc_costs
from market_data.market_data import resample_candles

IST = timezone(timedelta(hours=5, minutes=30))
MIN_ENTRY_TIME = 600
EOD_TIME = 915
COOLDOWN = 30
CAPITAL = 100000


def sim_sr_pure(df_5m, args):
    """Pure SR Breakout simulation (intraday entry + SL/TP/EOD exit)."""
    df_daily = resample_candles(df_5m, 1440)
    daily_dates = sorted(df_daily.index.normalize().unique())
    if len(daily_dates) < 2:
        return []

    date_ohlc = {}
    for idx, row in df_daily.iterrows():
        date_ohlc[idx.normalize()] = {'high': row['high'], 'low': row['low'], 'close': row['close']}
    date_to_prev = {}
    for i in range(1, len(daily_dates)):
        date_to_prev[daily_dates[i]] = daily_dates[i - 1]

    sl_pct = args.sl_pct / 100
    tp_pct = args.tp_pct / 100
    buf_pct = args.buffer_pct / 100
    max_dist = args.max_dist_pct / 100

    trades = []
    for day_date in daily_dates[1:]:
        prev_date = date_to_prev.get(day_date)
        if prev_date is None:
            continue
        prev_ohlc = date_ohlc.get(prev_date)
        if prev_ohlc is None:
            continue

        pivot = calculate_pivot_points(prev_ohlc['high'], prev_ohlc['low'], prev_ohlc['close'], args.pivot_type)
        r1 = pivot.r1
        buf_trigger = r1 * (1 + buf_pct)
        max_price = r1 * (1 + max_dist)

        day_start = day_date if day_date.tz else day_date.tz_localize('UTC')
        day_df = df_5m[(df_5m.index >= day_start) & (df_5m.index < day_start + timedelta(days=1))]
        if len(day_df) < 3:
            continue

        last_exit = None
        for idx, row in day_df.iterrows():
            ts_ist = idx.tz_convert(IST)
            ct = ts_ist.hour * 60 + ts_ist.minute
            close = float(row['close'])
            high = float(row['high'])
            low = float(row['low'])

            if high >= buf_trigger and close >= buf_trigger and close <= max_price:
                entry = close
                sl = entry * (1 - sl_pct)
                default_tp = entry * (1 + tp_pct)
                r2 = pivot.r2
                tp = r2 if r2 and r2 > entry else default_tp

                pos_entry = entry
                pos_sl = sl
                pos_tp = tp
                pos_time = ts_ist

                for j_idx, j_row in day_df.loc[idx:].iterrows():
                    if j_idx == idx:
                        continue
                    j_ts = j_idx.tz_convert(IST)
                    j_ct = j_ts.hour * 60 + j_ts.minute
                    j_high = float(j_row['high'])
                    j_low = float(j_row['low'])
                    j_close = float(j_row['close'])

                    if j_low <= pos_sl:
                        exit_p = pos_sl
                        reason = 'SL'
                    elif j_high >= pos_tp:
                        exit_p = pos_tp
                        reason = 'TP'
                    elif j_ct >= EOD_TIME:
                        exit_p = j_close
                        reason = 'EOD'
                    else:
                        continue

                    shares = int(CAPITAL / pos_entry)
                    gp = (exit_p - pos_entry) * shares
                    cs = calc_costs(pos_entry, exit_p, shares, 'LONG')
                    trades.append({
                        'net_pnl': gp - cs, 'gross_pnl': gp, 'costs': cs,
                        'reason': reason, 'exit_type': 'intraday'
                    })
                    last_exit = j_ts
                    break
    return trades


def sim_sr_btst(df_5m, args):
    """SR Breakout entry + BTST exit (next-day close with tight SL)."""
    df_daily = resample_candles(df_5m, 1440)
    daily_dates = sorted(df_daily.index.normalize().unique())
    if len(daily_dates) < 3:
        return []

    date_ohlc = {}
    for idx, row in df_daily.iterrows():
        date_ohlc[idx.normalize()] = {'high': row['high'], 'low': row['low'], 'close': row['close']}
    date_to_prev = {}
    for i in range(1, len(daily_dates)):
        date_to_prev[daily_dates[i]] = daily_dates[i - 1]

    buf_pct = args.buffer_pct / 100
    max_dist = args.max_dist_pct / 100
    btst_sl = args.btst_sl_pct / 100
    slippage = args.btst_slippage_pct / 100

    trades = []
    for i in range(1, len(daily_dates) - 1):
        day_date = daily_dates[i]
        next_date = daily_dates[i + 1]
        prev_date = date_to_prev.get(day_date)
        if prev_date is None:
            continue
        prev_ohlc = date_ohlc.get(prev_date)
        if prev_ohlc is None:
            continue

        pivot = calculate_pivot_points(prev_ohlc['high'], prev_ohlc['low'], prev_ohlc['close'], args.pivot_type)
        r1 = pivot.r1
        buf_trigger = r1 * (1 + buf_pct)
        max_price = r1 * (1 + max_dist)

        day_start = day_date if day_date.tz else day_date.tz_localize('UTC')
        day_df = df_5m[(df_5m.index >= day_start) & (df_5m.index < day_start + timedelta(days=1))]
        if len(day_df) < 3:
            continue

        # Check for entry signal
        signal_fired = False
        for idx, row in day_df.iterrows():
            ts_ist = idx.tz_convert(IST)
            ct = ts_ist.hour * 60 + ts_ist.minute
            close = float(row['close'])
            high = float(row['high'])
            if ct < MIN_ENTRY_TIME or ct >= EOD_TIME:
                continue
            if high >= buf_trigger and close >= buf_trigger and close <= max_price:
                signal_fired = True
                break

        if not signal_fired:
            continue

        # Entry at day's close
        entry_close = date_ohlc[day_date]['close']

        # BTST exit next day
        next_ohlc = date_ohlc[next_date]
        next_low = next_ohlc['low']
        next_close = next_ohlc['close']

        sl_price = entry_close * (1 - btst_sl) if btst_sl > 0 else 0

        if btst_sl > 0 and next_low <= sl_price:
            exit_price = sl_price
            reason = 'SL'
        else:
            exit_price = next_close
            reason = 'CLOSE'

        if slippage > 0:
            entry_actual = entry_close * (1 + slippage)
            exit_actual = exit_price * (1 - slippage)
        else:
            entry_actual = entry_close
            exit_actual = exit_price

        shares = int(CAPITAL / entry_actual)
        if shares == 0:
            continue

        gp = (exit_actual - entry_actual) * shares
        cs = calc_costs(entry_actual, exit_actual, shares, 'LONG')
        trades.append({
            'net_pnl': gp - cs, 'gross_pnl': gp, 'costs': cs,
            'reason': reason, 'exit_type': 'btst'
        })

    return trades


def compute_metrics(trades, label):
    if not trades:
        print(f"  [{label}] No trades", file=sys.stderr)
        return {'total_trades': 0, 'net_pnl': 0.0, 'profit_factor': 0.0, 'win_rate': 0.0}
    wins = [t for t in trades if t['net_pnl'] > 0]
    losses = [t for t in trades if t['net_pnl'] <= 0]
    gw = sum(t['net_pnl'] for t in wins)
    gl = abs(sum(t['net_pnl'] for t in losses))
    pf = round(gw / gl, 4) if gl > 0 else 99.9999
    wr = round(len(wins) / len(trades) * 100, 1)
    sl_cnt = sum(1 for t in trades if t.get('reason') == 'SL')
    tp_cnt = sum(1 for t in trades if t.get('reason') == 'TP')
    eod_cnt = sum(1 for t in trades if t.get('reason') == 'EOD')
    close_cnt = sum(1 for t in trades if t.get('reason') == 'CLOSE')
    net = round(sum(t['net_pnl'] for t in trades), 2)
    print(f"  [{label}] {len(trades)}t PF={pf} WR={wr}% Net=₹{net:,.0f} "
          f"SL/TP/CLOSE={sl_cnt}/{tp_cnt}/{close_cnt}", file=sys.stderr)
    return {'total_trades': len(trades), 'net_pnl': net, 'profit_factor': pf, 'win_rate': wr}


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
    p.add_argument('--btst-sl-pct', type=float, default=0.5,
                   help='BTST exit stop loss percent')
    p.add_argument('--btst-slippage-pct', type=float, default=0.0,
                   help='Slippage on BTST entry and exit (e.g., 0.1)')
    return p.parse_args()


def main():
    args = parse_args()
    desc = (f"SR(buf={args.buffer_pct}%) + BTST(sl={args.btst_sl_pct}%) "
            f"vs SR(SL={args.sl_pct}% TP={args.tp_pct}%) "
            f"scr(mcap>={args.min_mcap_cr} price>={args.min_price})")
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

    print(f"  Qualifying: {len(qualifying)} stocks", file=sys.stderr)
    if len(qualifying) < 3:
        print("  ERROR: <3 stocks", file=sys.stderr)
        return

    candle_data = load_or_fetch_candle_data(qualifying)

    pure_trades = []
    btst_trades = []

    for sym in qualifying:
        df_5m = candle_data.get(sym)
        if df_5m is None or len(df_5m) < 200:
            continue

        pure = sim_sr_pure(df_5m, args)
        for t in pure:
            t['symbol'] = sym
        pure_trades.extend(pure)

        btst = sim_sr_btst(df_5m, args)
        for t in btst:
            t['symbol'] = sym
        btst_trades.extend(btst)

    elapsed = time.time() - t0
    print(file=sys.stderr)

    pure_m = compute_metrics(pure_trades, 'SR Pure')
    btst_m = compute_metrics(btst_trades, 'SR+BTST')

    print(f"\n  {'='*60}", file=sys.stderr)
    print(f"  COMPARISON ({elapsed:.0f}s)", file=sys.stderr)
    print(f"  {'='*60}", file=sys.stderr)
    print(f"  SR Pure:     PF={pure_m['profit_factor']}  "
          f"Net=₹{pure_m['net_pnl']:,.0f}  "
          f"{pure_m['total_trades']}t  WR={pure_m['win_rate']}%", file=sys.stderr)
    print(f"  SR+BTST:     PF={btst_m['profit_factor']}  "
          f"Net=₹{btst_m['net_pnl']:,.0f}  "
          f"{btst_m['total_trades']}t  WR={btst_m['win_rate']}%", file=sys.stderr)

    if btst_m['profit_factor'] > pure_m['profit_factor']:
        delta = ((btst_m['profit_factor'] - pure_m['profit_factor']) / max(pure_m['profit_factor'], 0.001)) * 100
        print(f"  SR+BTST beats SR Pure by {delta:.0f}% on PF", file=sys.stderr)
    else:
        delta = ((pure_m['profit_factor'] - btst_m['profit_factor']) / max(btst_m['profit_factor'], 0.001)) * 100
        print(f"  SR Pure beats SR+BTST by {delta:.0f}% on PF", file=sys.stderr)

    print(file=sys.stderr)
    print(f"METRIC sr_pure_pf={pure_m['profit_factor']}")
    print(f"METRIC sr_btst_pf={btst_m['profit_factor']}")
    print(f"METRIC sr_pure_net={pure_m['net_pnl']}")
    print(f"METRIC sr_btst_net={btst_m['net_pnl']}")
    print(f"METRIC sr_pure_trades={pure_m['total_trades']}")
    print(f"METRIC sr_btst_trades={btst_m['total_trades']}")


if __name__ == '__main__':
    main()
