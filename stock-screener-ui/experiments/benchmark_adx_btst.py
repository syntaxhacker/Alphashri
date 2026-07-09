#!/usr/bin/env python3
"""Grid search: ADX trend entry + BTST exit.

Computes ADX on daily data, enters on trend signal,
exits next day with tight SL (BTST-style).

Usage: python3 experiments/benchmark_adx_btst.py
Outputs METRIC lines for best config found.
"""
import os, sys, time, itertools
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))

import pandas as pd
import numpy as np
import yfinance as yf
from trending_upside import fetch_trending_stocks

CAPITAL = 100000
BROKERAGE_PCT = 0.0003
STT_PCT = 0.001
EXCHANGE_PCT = 0.0000297
SEBI_PCT = 0.000001
STAMP_DUTY_PCT = 0.00015
GST_PCT = 0.18

GRID = {
    'adx_period': [10, 14, 21],
    'adx_threshold': [20, 25, 30, 35],
    'sl_pct': [0.3, 0.5, 1.0, 1.5],
    'entry_mode': ['adx_trend_up', 'adx_green_day', 'adx_only'],
}

MIN_MCAP_CR = 1000
MIN_PRICE = 50
MIN_VOLUME = 500000
STOCK_LIMIT = 100
DATE_START = '2025-07-01'
DATE_END = '2026-06-30'


def calc_costs(entry_price, exit_price, quantity):
    buy_value = entry_price * quantity
    sell_value = exit_price * quantity
    buy_brk = min(20, buy_value * BROKERAGE_PCT)
    buy_stamp = buy_value * STAMP_DUTY_PCT
    buy_exch = buy_value * EXCHANGE_PCT
    buy_sebi = buy_value * SEBI_PCT
    buy_gst = GST_PCT * (buy_brk + buy_exch + buy_sebi)
    sell_brk = min(20, sell_value * BROKERAGE_PCT)
    sell_stt = sell_value * STT_PCT
    sell_exch = sell_value * EXCHANGE_PCT
    sell_sebi = sell_value * SEBI_PCT
    sell_gst = GST_PCT * (sell_brk + sell_exch + sell_sebi)
    return round(buy_brk + buy_stamp + buy_exch + buy_sebi + buy_gst +
                 sell_brk + sell_stt + sell_exch + sell_sebi + sell_gst, 2)


def compute_adx(high, low, close, period=14):
    n = len(close)
    if n < period + 5:
        return None

    tr = np.full(n, np.nan)
    plus_dm = np.full(n, np.nan)
    minus_dm = np.full(n, np.nan)

    for i in range(1, n):
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))
        up_move = high[i] - high[i - 1]
        down_move = low[i - 1] - low[i]
        plus_dm[i] = up_move if up_move > down_move and up_move > 0 else 0
        minus_dm[i] = down_move if down_move > up_move and down_move > 0 else 0

    tr_ema = pd.Series(tr).ewm(span=period, min_periods=period).mean().values
    plus_ema = pd.Series(plus_dm).ewm(span=period, min_periods=period).mean().values
    minus_ema = pd.Series(minus_dm).ewm(span=period, min_periods=period).mean().values

    di_plus = 100 * plus_ema / np.maximum(tr_ema, 1e-10)
    di_minus = 100 * minus_ema / np.maximum(tr_ema, 1e-10)

    dx = 100 * np.abs(di_plus - di_minus) / np.maximum(di_plus + di_minus, 1e-10)
    adx = pd.Series(dx).ewm(span=period, min_periods=period).mean().values

    return adx, di_plus, di_minus


def sim_exit(entry_idx, closes, highs, lows, sl_pct):
    if entry_idx >= len(closes) - 1:
        return None
    sl_price = closes[entry_idx] * (1 - sl_pct / 100) if sl_pct > 0 else 0
    next_low = lows[entry_idx + 1]
    next_close = closes[entry_idx + 1]

    if sl_pct > 0 and next_low <= sl_price:
        return sl_price, 'SL'
    return next_close, 'CLOSE'


def run_config(closes, highs, lows, volumes, adx, di_plus, di_minus, threshold, sl_pct, entry_mode):
    trades = []
    n = len(closes)
    for i in range(1, n - 1):
        if np.isnan(adx[i]) or adx[i] < threshold:
            continue

        if entry_mode == 'adx_trend_up':
            if di_plus[i] <= di_minus[i]:
                continue
        elif entry_mode == 'adx_green_day':
            if closes[i] <= closes[i - 1]:
                continue

        entry = closes[i]
        result = sim_exit(i, closes, highs, lows, sl_pct)
        if result is None:
            continue
        exit_price, reason = result

        shares = int(CAPITAL / entry)
        if shares == 0:
            continue
        gp = (exit_price - entry) * shares
        costs = calc_costs(entry, exit_price, shares)
        trades.append({'net_pnl': gp - costs, 'reason': reason})

    return trades


def score_config(name, all_trades):
    if not all_trades:
        return 0, 0, 0, 0
    wins = [t for t in all_trades if t['net_pnl'] > 0]
    losses = [t for t in all_trades if t['net_pnl'] <= 0]
    gw = sum(t['net_pnl'] for t in wins)
    gl = abs(sum(t['net_pnl'] for t in losses))
    pf = round(gw / gl, 4) if gl > 0 else 99.9999
    net = round(sum(t['net_pnl'] for t in all_trades), 2)
    wr = round(len(wins) / len(all_trades) * 100, 1) if all_trades else 0
    nt = len(all_trades)
    return pf, net, wr, nt


def fetch_daily(sym, start, end):
    try:
        period = (pd.Timestamp(end) - pd.Timestamp(start)).days + 60
        df = yf.download(sym + '.NS', period=f'{period}d', interval='1d', progress=False, auto_adjust=True)
        if df is None or df.empty:
            df = yf.download(sym + '.BO', period=f'{period}d', interval='1d', progress=False, auto_adjust=True)
        if df is not None and not df.empty:
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = [c[0].lower() for c in df.columns]
            else:
                df.columns = [c.lower() for c in df.columns]
            df = df.sort_index()
            df = df[(df.index >= start) & (df.index <= end)]
            return df
    except Exception:
        pass
    return None


def main():
    global_start = time.time()
    print(f"  Grid: {GRID['entry_mode']} × adx_period={GRID['adx_period']} "
          f"threshold={GRID['adx_threshold']} sl={GRID['sl_pct']}", file=sys.stderr)
    total_combos = (len(GRID['adx_period']) * len(GRID['adx_threshold']) *
                    len(GRID['sl_pct']) * len(GRID['entry_mode']))
    print(f"  Total combos: {total_combos}", file=sys.stderr)

    tv = fetch_trending_stocks(limit=STOCK_LIMIT, profile='volatility_trend')
    if tv is None or tv.empty:
        tv = fetch_trending_stocks(limit=STOCK_LIMIT, profile='trending')
    if tv is None or tv.empty:
        print("ERROR: No TV data", file=sys.stderr)
        return

    symbols = []
    for _, row in tv.iterrows():
        price = float(row.get('close', 0))
        vol = float(row.get('volume', 0))
        mcap = float(row.get('market_cap_basic', 0)) / 1e7
        if mcap < MIN_MCAP_CR or price < MIN_PRICE or vol < MIN_VOLUME:
            continue
        symbols.append(str(row.get('name', '')).upper())

    print(f"  Qualifying: {len(symbols)} stocks", file=sys.stderr)
    if len(symbols) < 5:
        print("ERROR: <5 stocks", file=sys.stderr)
        return

    daily_data = {}
    done = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(fetch_daily, sym, DATE_START, DATE_END): sym for sym in symbols}
        for f in as_completed(futures):
            sym = futures[f]
            done += 1
            if done % 10 == 0:
                print(f"  Data: {done}/{len(symbols)}...", file=sys.stderr)
            df = f.result()
            if df is not None and len(df) > 30:
                daily_data[sym] = df

    print(f"  Data loaded: {len(daily_data)} stocks", file=sys.stderr)

    results = []
    combo_count = 0
    t0 = time.time()

    for adx_period in GRID['adx_period']:
        stock_adx = {}
        for sym, df in daily_data.items():
            adx, di_plus, di_minus = compute_adx(
                df['high'].values, df['low'].values, df['close'].values, adx_period
            )
            if adx is not None:
                stock_adx[sym] = {
                    'closes': df['close'].values,
                    'highs': df['high'].values,
                    'lows': df['low'].values,
                    'volumes': df['volume'].values,
                    'adx': adx,
                    'di_plus': di_plus,
                    'di_minus': di_minus,
                }

        for threshold in GRID['adx_threshold']:
            for sl_pct in GRID['sl_pct']:
                for entry_mode in GRID['entry_mode']:
                    combo_count += 1
                    all_trades = []

                    for sym, sd in stock_adx.items():
                        trades = run_config(
                            sd['closes'], sd['highs'], sd['lows'], sd['volumes'],
                            sd['adx'], sd['di_plus'], sd['di_minus'],
                            threshold, sl_pct, entry_mode
                        )
                        all_trades.extend(trades)

                    pf, net, wr, nt = score_config(None, all_trades)
                    desc = f"ADX({adx_period})>{threshold} {entry_mode} SL={sl_pct}%"
                    results.append((pf, net, wr, nt, desc, adx_period, threshold, sl_pct, entry_mode))

                    if combo_count % 20 == 0:
                        elapsed = time.time() - t0
                        print(f"  [{combo_count}/{total_combos}] {desc}: PF={pf} Net=₹{net:,.0f} "
                              f"({elapsed:.0f}s)", file=sys.stderr)

    results.sort(key=lambda r: r[0], reverse=True)
    elapsed = time.time() - global_start

    print(f"\n{'='*80}", file=sys.stderr)
    print(f"  ADX+BTST GRID SEARCH RESULTS ({elapsed:.0f}s)", file=sys.stderr)
    print(f"{'='*80}", file=sys.stderr)
    print(f"  {'Rank':<5} {'PF':<8} {'Net':<14} {'WR':<6} {'Trades':<8} Config", file=sys.stderr)
    print(f"  {'-'*5} {'-'*8} {'-'*14} {'-'*6} {'-'*8} {'-'*40}", file=sys.stderr)
    for rank, (pf, net, wr, nt, desc, *_) in enumerate(results[:15], 1):
        print(f"  #{rank:<3} {pf:<8} ₹{net:<10,.0f} {wr:<5}% {nt:<8} {desc}", file=sys.stderr)

    print(f"\n{'='*80}", file=sys.stderr)
    best = results[0]
    print(f"  BEST: PF={best[0]} Net=₹{best[1]:,.0f} WR={best[2]}% Trades={best[3]}", file=sys.stderr)
    print(f"  Config: ADX(period={best[5]})>{best[6]} {best[8]} SL={best[7]}%", file=sys.stderr)

    print(f"\nMETRIC best_pf={best[0]}")
    print(f"METRIC best_net={best[1]}")
    print(f"METRIC best_wr={best[2]}")
    print(f"METRIC best_trades={best[3]}")
    print(f"METRIC best_config={best[4]}")

    # Also output top 5
    for rank, (pf, net, wr, nt, desc, *_) in enumerate(results[:5], 1):
        esc_desc = desc.replace(' ', '_').replace('(', '').replace(')', '').replace('>', '_gt_')
        print(f"METRIC top{rank}_pf={pf}")
        print(f"METRIC top{rank}_net={net}")
        print(f"METRIC top{rank}_config={esc_desc}")

    # Summary stats
    profitable = sum(1 for r in results if r[0] >= 1.0)
    print(f"METRIC total_combos={total_combos}")
    print(f"METRIC profitable_combos={profitable}")
    print(f"METRIC profitable_pct={round(profitable/total_combos*100, 1)}")


if __name__ == '__main__':
    main()
