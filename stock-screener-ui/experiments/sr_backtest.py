#!/usr/bin/env python3
"""Backtest SR Breakout strategy on optimized high-vol stock list.

Reads cached 5-min data → resamples to daily & checks each candle for breakout.
SR params: SL=1.5%, TP=2.5%, pivot_type=classic, breakout_buffer=0.1%
Entry: 10:00 AM+ only, candle close above R1+buffer
Exit: SL/TP/EOD 15:15
"""
import sys, os, csv, time
from datetime import datetime, timedelta, timezone

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

SL_PCT = 1.5
TP_PCT = 2.5
BREAKOUT_BUFFER_PCT = 0.1
MAX_DIST_R1_PCT = 5.0
MIN_ENTRY_HOUR = 10
MIN_ENTRY_MINUTE = 0
EOD_HOUR = 15
EOD_MINUTE = 15
COOLDOWN_MINUTES = 30
CAPITAL = 100_000

# Filter stocks (same as Bot #15)
MIN_MCAP_CR = 5000; MIN_ATR_PCT = 4.0; MIN_PRICE = 200; MIN_VOLUME = 500_000

tv = load_or_fetch_tv_data()
symbols = []
for s in tv:
    mcap = float(s['mcap_cr']); atr = float(s['atr_pct'])
    price = float(s['price']); vol = float(s['volume'])
    if mcap < MIN_MCAP_CR or atr < MIN_ATR_PCT or price < MIN_PRICE or vol < MIN_VOLUME: continue
    symbols.append(s['symbol'])

print(f"📊 Testing SR Breakout on {len(symbols)} stocks", file=sys.stderr)
print(f"   Params: SL={SL_PCT}% TP={TP_PCT}% buffer={BREAKOUT_BUFFER_PCT}% EOD={EOD_HOUR}:{EOD_MINUTE:02d}", file=sys.stderr)
print(file=sys.stderr)

candle_data = load_or_fetch_candle_data(symbols)

all_trades = []
per_stock = []

for sym in symbols:
    df_5m = candle_data.get(sym)
    if df_5m is None or len(df_5m) < 200:
        per_stock.append({'symbol': sym, 'trades': 0, 'wins': 0, 'net_pnl': 0, 'profit_factor': 0})
        continue

    # Resample to daily for pivot calculation
    df_daily = resample_candles(df_5m, 1440)

    # Get unique trading days (daily index)
    daily_dates = df_daily.index.normalize().unique()
    if len(daily_dates) < 2:
        per_stock.append({'symbol': sym, 'trades': 0, 'wins': 0, 'net_pnl': 0, 'profit_factor': 0})
        continue

    # Map each date to its daily OHLC
    date_ohlc = {}
    for idx, row in df_daily.iterrows():
        d = idx.normalize()
        date_ohlc[d] = {'high': row['high'], 'low': row['low'], 'close': row['close']}

    daily_dates_sorted = sorted(daily_dates)
    date_to_prev = {}
    for i in range(1, len(daily_dates_sorted)):
        date_to_prev[daily_dates_sorted[i]] = daily_dates_sorted[i - 1]

    trades = []
    in_pos = False
    pos = {}
    last_exit_time = None
    total_days = 0

    for day_date in daily_dates_sorted[1:]:  # skip first day (no prev day data)
        prev_date = date_to_prev.get(day_date)
        if prev_date is None: continue
        prev_ohlc = date_ohlc.get(prev_date)
        if prev_ohlc is None: continue

        total_days += 1
        pivot = calculate_pivot_points(prev_ohlc['high'], prev_ohlc['low'], prev_ohlc['close'], 'classic')
        r1 = pivot.r1; r2 = pivot.r2; s1 = pivot.s1; s2 = pivot.s2
        buf_trigger = r1 * (1 + BREAKOUT_BUFFER_PCT / 100)
        max_price = r1 * (1 + MAX_DIST_R1_PCT / 100)

        # Get current day's 5-min data
        day_start = day_date if day_date.tz else day_date.tz_localize('UTC')
        day_df = df_5m[(df_5m.index >= day_start) & (df_5m.index < day_start + timedelta(days=1))]
        if len(day_df) < 3: continue

        for idx, row in day_df.iterrows():
            ts_ist = idx.tz_convert(IST)
            candle_hour = ts_ist.hour; candle_min = ts_ist.minute
            candle_time = candle_hour * 60 + candle_min
            close = float(row['close']); high = float(row['high']); low = float(row['low'])

            # Skip before market opens / min entry time
            if candle_time < MIN_ENTRY_HOUR * 60 + MIN_ENTRY_MINUTE:
                continue
            # Skip after EOD
            if candle_time >= EOD_HOUR * 60 + EOD_MINUTE:
                break

            if not in_pos:
                # Check cooldown
                if last_exit_time and (ts_ist - last_exit_time).total_seconds() / 60 < COOLDOWN_MINUTES:
                    continue

                # Check breakout: high >= trigger and close >= trigger
                if high >= buf_trigger and close >= buf_trigger:
                    # Skip if too far above R1
                    if close > max_price: continue

                    entry_price = close
                    sl = entry_price * (1 - SL_PCT / 100)
                    default_tp = entry_price * (1 + TP_PCT / 100)
                    tp = r2 if r2 and r2 > entry_price else default_tp

                    pos = {'entry': entry_price, 'sl': sl, 'tp': tp, 'entry_time': ts_ist,
                           'r1': r1, 'r2': r2 if r2 else 0}
                    in_pos = True
                    continue

            if in_pos:
                # Check SL
                if low <= pos['sl']:
                    exit_p = pos['sl']; reason = '❌ SL'
                # Check TP
                elif high >= pos['tp']:
                    exit_p = pos['tp']; reason = '✅ TP'
                # Check EOD
                elif candle_time >= EOD_HOUR * 60 + EOD_MINUTE:
                    exit_p = close; reason = '⏰ EOD'
                else:
                    continue

                shares = int(CAPITAL / pos['entry'])
                gp = (exit_p - pos['entry']) * shares
                cs = calc_costs(pos['entry'], exit_p, shares, 'LONG')
                npnl = gp - cs
                trades.append({
                    'symbol': sym, 'entry': pos['entry'], 'exit': exit_p,
                    'net_pnl': npnl, 'gross_pnl': gp, 'costs': cs,
                    'reason': reason, 'entry_time': pos['entry_time'], 'exit_time': ts_ist,
                    'r1': pos['r1'], 'r2': pos['r2'],
                })
                in_pos = False
                last_exit_time = ts_ist

    all_trades.extend(trades)

    # Per-stock stats
    n = len(trades)
    if n >= 2:
        wins = [t for t in trades if t['net_pnl'] > 0]
        losses = [t for t in trades if t['net_pnl'] <= 0]
        net = sum(t['net_pnl'] for t in trades)
        gw = sum(t['net_pnl'] for t in wins)
        gl = abs(sum(t['net_pnl'] for t in losses))
        pf = round(gw / gl, 4) if gl > 0 else 99.9999
        wr = round(len(wins) / n * 100, 1)
    else:
        net = sum(t['net_pnl'] for t in trades)
        pf = 0 if n < 2 else 1.0; wr = 0

    per_stock.append({
        'symbol': sym, 'trades': n, 'wins': len([t for t in trades if t['net_pnl'] > 0]),
        'win_rate': wr, 'net_pnl': round(net, 2), 'profit_factor': pf,
    })

    status = '✅' if pf >= 1.0 and n >= 2 else '❌'
    print(f"  {status} {sym:<18} {n:3d}t WR={wr:>5.1f}% Net=₹{net:>+9,.0f} PF={pf:<8.4f}", file=sys.stderr)

# --- Aggregate ---
total_trades = len(all_trades)
total_wins = sum(1 for t in all_trades if t['net_pnl'] > 0)
total_net = sum(t['net_pnl'] for t in all_trades)
gw = sum(t['net_pnl'] for t in all_trades if t['net_pnl'] > 0)
gl = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl'] <= 0))
agg_pf = round(gw / gl, 4) if gl > 0 else 99.9999
agg_wr = round(total_wins / total_trades * 100, 1) if total_trades > 0 else 0
tp_n = sum(1 for t in all_trades if 'TP' in t['reason'])
sl_n = sum(1 for t in all_trades if 'SL' in t['reason'])
eod_n = sum(1 for t in all_trades if 'EOD' in t['reason'])
total_costs = sum(t.get('costs', 0) for t in all_trades)
profitable_stocks = sum(1 for s in per_stock if s['profit_factor'] >= 1.0 and s['trades'] >= 2)

# --- Per-stock table (sorted by net P&L desc) ---
per_stock.sort(key=lambda x: x['net_pnl'], reverse=True)

print(f"\n{'='*130}")
print(f"  SR BREAKOUT BACKTEST | SL={SL_PCT}% TP={TP_PCT}% buffer={BREAKOUT_BUFFER_PCT}%")
print(f"  45 high-vol stocks | Classic pivots | EOD={EOD_HOUR}:{EOD_MINUTE:02d}")
print(f"{'='*130}")
print(f"\n{'Rank':<5} {'Symbol':<18} {'Trades':>7} {'Wins':>5} {'WR%':>6} {'Net P&L':>14} {'PF':>10} {'TP':>5} {'SL':>5} {'EOD':>5}")
print("-" * 130)

for i, s in enumerate(per_stock, 1):
    if s['trades'] < 1:
        print(f"  {i:<3} {s['symbol']:<18} {'—':>7} {'—':>5} {'—':>6} {'—':>14} {'—':>10} {'':5} {'':5} {'':5}")
        continue
    mark = '✅' if s['profit_factor'] >= 1.0 and s['trades'] >= 2 else '❌'
    print(f"{mark} {i:<3} {s['symbol']:<18} {s['trades']:>7} {s['wins']:>5} {s['win_rate']:>5.1f}% ₹{s['net_pnl']:>+10,.0f}  {s['profit_factor']:<10.4f} {'':5} {'':5} {'':5}")

print("-" * 130)
print(f"\n{'':5} {'TOTAL':<18} {total_trades:>7} {total_wins:>5} {agg_wr:>5.1f}% ₹{total_net:>+10,.0f}  {agg_pf:<10.4f}")
print(f"  TP hits: {tp_n} | SL hits: {sl_n} | EOD exits: {eod_n}")
print(f"  Total costs: ₹{total_costs:,.2f}")
print(f"  Profitable stocks: {profitable_stocks}/{len([s for s in per_stock if s['trades'] >= 2])}")
