#!/usr/bin/env python3
"""BTST (Buy Today Sell Tomorrow) strategy benchmark.

Picks stocks from TV screener, enters at close when daily gain >= threshold,
exits next trading day at close (or SL/TP if hit intraday).

Usage: python3 experiments/benchmark_btst.py
Outputs METRIC name=number lines for autoresearch.

Environment variables:
  BTST_SL_PCT=2.0         Stop loss percent
  BTST_TP_PCT=3.0         Take profit percent
  BTST_ENTRY_THRESHOLD=0.5  Min daily gain % to trigger entry
  BTST_ENTRY_MODE=up_day  Entry signal: up_day, any_day, volume_surge
  BTST_MIN_MCAP_CR=1000   Min market cap in Cr
  BTST_MIN_PRICE=50       Min stock price
  BTST_MIN_VOLUME=500000  Min volume
  BTST_LIMIT=100          Max stocks to test
  BTST_DATE_START=2026-01-01
  BTST_DATE_END=2026-07-01
  BTST_TRADE_CAPITAL=100000  Capital per trade (INR)
"""
import os, sys, time, math
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

ENV = {
    "SL_PCT": float(os.environ.get("BTST_SL_PCT", "2.0")),
    "TP_PCT": float(os.environ.get("BTST_TP_PCT", "3.0")),
    "ENTRY_THRESHOLD": float(os.environ.get("BTST_ENTRY_THRESHOLD", "0.5")),
    "ENTRY_MODE": os.environ.get("BTST_ENTRY_MODE", "up_day"),
    "MIN_MCAP_CR": float(os.environ.get("BTST_MIN_MCAP_CR", "1000")),
    "MIN_PRICE": float(os.environ.get("BTST_MIN_PRICE", "50")),
    "MIN_VOLUME": float(os.environ.get("BTST_MIN_VOLUME", "500000")),
    "LIMIT": int(os.environ.get("BTST_LIMIT", "100")),
    "DATE_START": os.environ.get("BTST_DATE_START", "2026-01-01"),
    "DATE_END": os.environ.get("BTST_DATE_END", "2026-07-01"),
    "TRADE_CAPITAL": float(os.environ.get("BTST_TRADE_CAPITAL", "100000")),
}

# Delivery trading costs (BTST is delivery, not intraday)
BROKERAGE_PCT = 0.0003
STT_PCT = 0.001
EXCHANGE_PCT = 0.0000297
SEBI_PCT = 0.000001
STAMP_DUTY_PCT = 0.00015
GST_PCT = 0.18


def calc_costs(entry_price, exit_price, quantity):
    buy_value = entry_price * quantity
    sell_value = exit_price * quantity

    buy_brk = min(20, buy_value * BROKERAGE_PCT)
    buy_stamp = buy_value * STAMP_DUTY_PCT
    buy_exch = buy_value * EXCHANGE_PCT
    buy_sebi = buy_value * SEBI_PCT
    buy_gst = GST_PCT * (buy_brk + buy_exch + buy_sebi)
    buy_total = buy_brk + buy_stamp + buy_exch + buy_sebi + buy_gst

    sell_brk = min(20, sell_value * BROKERAGE_PCT)
    sell_stt = sell_value * STT_PCT
    sell_exch = sell_value * EXCHANGE_PCT
    sell_sebi = sell_value * SEBI_PCT
    sell_gst = GST_PCT * (sell_brk + sell_exch + sell_sebi)
    sell_total = sell_brk + sell_stt + sell_exch + sell_sebi + sell_gst

    return round(buy_total + sell_total, 2)


def fetch_daily(sym, period_days=365):
    """Fetch daily OHLC from yfinance. Returns DataFrame or None."""
    try:
        df = yf.download(sym + '.NS', period=f'{period_days}d', interval='1d', progress=False, auto_adjust=True)
        if df is None or df.empty:
            df = yf.download(sym + '.BO', period=f'{period_days}d', interval='1d', progress=False, auto_adjust=True)
        if df is not None and not df.empty:
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = [c[0].lower() for c in df.columns]
            else:
                df.columns = [c.lower() for c in df.columns]
            df = df.sort_index()
            return df
    except Exception:
        pass
    return None


def sim_symbol(df):
    """Run BTST simulation on one symbol's daily data. Returns list of trade dicts."""
    sl_pct = ENV["SL_PCT"] / 100
    tp_pct = ENV["TP_PCT"] / 100
    entry_threshold = ENV["ENTRY_THRESHOLD"] / 100
    entry_mode = ENV["ENTRY_MODE"]
    capital = ENV["TRADE_CAPITAL"]

    closes = df['close'].values
    highs = df['high'].values
    lows = df['low'].values
    volumes = df['volume'].values
    dates = df.index.values

    trades = []
    for i in range(1, len(closes) - 1):
        prev_close = closes[i - 1]
        cur_close = closes[i]
        day_return = (cur_close - prev_close) / prev_close

        if entry_mode == 'up_day':
            if day_return < entry_threshold:
                continue
        elif entry_mode == 'volume_surge':
            avg_vol = np.mean(volumes[max(0, i - 20):i])
            if avg_vol == 0:
                continue
            vol_ratio = volumes[i] / avg_vol
            if vol_ratio < 1.5 or day_return < 0:
                continue
        elif entry_mode == 'any_day':
            pass

        entry_price = float(cur_close)
        next_high = float(highs[i + 1])
        next_low = float(lows[i + 1])
        next_close = float(closes[i + 1])

        sl_price = entry_price * (1 - sl_pct) if sl_pct > 0 else 0
        tp_price = entry_price * (1 + tp_pct) if tp_pct > 0 else float('inf')

        if sl_pct > 0 and next_low <= sl_price:
            exit_price = sl_price
            reason = 'SL'
        elif tp_pct > 0 and next_high >= tp_price:
            exit_price = tp_price
            reason = 'TP'
        else:
            exit_price = next_close
            reason = 'CLOSE'

        shares = int(capital / entry_price)
        if shares == 0:
            continue

        gross_pnl = (exit_price - entry_price) * shares
        costs = calc_costs(entry_price, exit_price, shares)
        net_pnl = gross_pnl - costs

        trades.append({
            'entry_date': pd.Timestamp(dates[i]),
            'exit_date': pd.Timestamp(dates[i + 1]),
            'entry': entry_price,
            'exit': exit_price,
            'day_return': round(day_return * 100, 2),
            'shares': shares,
            'gross_pnl': gross_pnl,
            'costs': costs,
            'net_pnl': net_pnl,
            'reason': reason,
        })

    return trades


def compute_metrics(all_trades):
    if not all_trades:
        return {'total_trades': 0, 'wins': 0, 'losses': 0, 'net_pnl': 0.0,
                'profit_factor': 0.0, 'win_rate': 0.0, 'sl_exits': 0,
                'tp_exits': 0, 'close_exits': 0, 'stocks_with_trades': 0,
                'total_costs': 0, 'avg_holding_days': 0}

    wins = [t for t in all_trades if t['net_pnl'] > 0]
    losses = [t for t in all_trades if t['net_pnl'] <= 0]
    gross_profit = sum(t['net_pnl'] for t in wins)
    gross_loss = abs(sum(t['net_pnl'] for t in losses))
    total_costs = sum(t.get('costs', 0) for t in all_trades)
    unique_stocks = len(set(t.get('symbol', '?') for t in all_trades))
    total_holding = sum((t['exit_date'] - t['entry_date']).days for t in all_trades if 'exit_date' in t)

    return {
        'total_trades': len(all_trades),
        'wins': len(wins),
        'losses': len(losses),
        'net_pnl': round(sum(t['net_pnl'] for t in all_trades), 2),
        'profit_factor': round(gross_profit / gross_loss, 4) if gross_loss > 0 else 99.9999,
        'win_rate': round(len(wins) / len(all_trades) * 100, 1) if all_trades else 0.0,
        'sl_exits': sum(1 for t in all_trades if t.get('reason') == 'SL'),
        'tp_exits': sum(1 for t in all_trades if t.get('reason') == 'TP'),
        'close_exits': sum(1 for t in all_trades if t.get('reason') == 'CLOSE'),
        'stocks_with_trades': unique_stocks,
        'total_costs': round(total_costs, 2),
        'avg_holding_days': round(total_holding / len(all_trades), 1) if all_trades else 0,
    }


def main():
    desc = (f"SL={ENV['SL_PCT']}% TP={ENV['TP_PCT']}% thresh={ENV['ENTRY_THRESHOLD']}% "
            f"mode={ENV['ENTRY_MODE']} mcap>={ENV['MIN_MCAP_CR']}Cr price>={ENV['MIN_PRICE']}")
    print(f"  Params: {desc}", file=sys.stderr)
    t0 = time.time()

    tv = fetch_trending_stocks(limit=ENV['LIMIT'], profile='volatility_trend')
    if tv is None or tv.empty:
        tv = fetch_trending_stocks(limit=ENV['LIMIT'], profile='trending')
    if tv is None or tv.empty:
        print("ERROR: No TV data returned", file=sys.stderr)
        sys.exit(1)

    symbols = []
    for _, row in tv.iterrows():
        price = float(row.get('close', 0))
        vol = float(row.get('volume', 0))
        mcap = float(row.get('market_cap_basic', 0)) / 1e7
        if mcap < ENV['MIN_MCAP_CR'] or price < ENV['MIN_PRICE'] or vol < ENV['MIN_VOLUME']:
            continue
        symbols.append(str(row.get('name', '')).upper())

    print(f"  TV stocks: {len(tv)}, qualifying: {len(symbols)}", file=sys.stderr)
    if len(symbols) < 5:
        print("ERROR: <5 qualifying stocks", file=sys.stderr)
        print("METRIC profit_factor=0")
        print("METRIC win_rate=0")
        print("METRIC net_pnl=0")
        print("METRIC total_trades=0")
        print("METRIC sl_exits=0")
        print("METRIC tp_exits=0")
        print("METRIC stocks_with_trades=0")
        return

    period_days = 365
    if ENV['DATE_START']:
        try:
            from datetime import datetime
            start = datetime.strptime(ENV['DATE_START'], '%Y-%m-%d')
            end = datetime.strptime(ENV['DATE_END'], '%Y-%m-%d')
            period_days = (end - start).days + 60
        except Exception:
            pass

    all_trades = []
    stock_pfs = []
    done = 0
    print(f"  Fetching daily data for {len(symbols)} symbols...", file=sys.stderr)

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(fetch_daily, sym, period_days): sym for sym in symbols}
        for f in as_completed(futures):
            sym = futures[f]
            done += 1
            if done % 10 == 0:
                print(f"  {done}/{len(symbols)}...", file=sys.stderr)
            df = f.result()
            if df is None or len(df) < 60:
                continue

            # Filter date range
            if ENV['DATE_START']:
                df = df[df.index >= ENV['DATE_START']]
            if ENV['DATE_END']:
                df = df[df.index <= ENV['DATE_END']]
            if len(df) < 20:
                continue

            trades = sim_symbol(df)
            for t in trades:
                t['symbol'] = sym
            all_trades.extend(trades)

            if len(trades) >= 2:
                wins = [t for t in trades if t['net_pnl'] > 0]
                losses = [t for t in trades if t['net_pnl'] <= 0]
                gw = sum(t['net_pnl'] for t in wins)
                gl = abs(sum(t['net_pnl'] for t in losses))
                stock_pfs.append(round(gw / gl, 4) if gl > 0 else 99.9999)

            if trades:
                sym_wins = sum(1 for t in trades if t['net_pnl'] > 0)
                sym_pnl = sum(t['net_pnl'] for t in trades)
                print(f"    {sym:<20} {len(trades):3d}t WR={round(sym_wins/len(trades)*100,1):.1f}% Net=₹{sym_pnl:>+8,.0f}", file=sys.stderr)

    metrics = compute_metrics(all_trades)
    elapsed = time.time() - t0

    profitable_count = sum(1 for pf in stock_pfs if pf >= 1.0)
    total_count = len(stock_pfs)
    profitable_ratio = round(profitable_count / total_count * 100, 1) if total_count > 0 else 0
    avg_pf = round(sum(stock_pfs) / total_count, 4) if total_count > 0 else 0

    print(file=sys.stderr)
    print(f"  Result: {metrics['total_trades']}t PF={metrics['profit_factor']} "
          f"WR={metrics['win_rate']}% Net=₹{metrics['net_pnl']:,.0f} "
          f"Stocks={total_count}/{len(symbols)} ProfRatio={profitable_ratio}% "
          f"AvgPF={avg_pf} ({elapsed:.0f}s)", file=sys.stderr)
    print(f"  SL/TP/CLOSE: {metrics['sl_exits']}/{metrics['tp_exits']}/{metrics['close_exits']}", file=sys.stderr)

    print(f"METRIC profit_factor={metrics['profit_factor']}")
    print(f"METRIC win_rate={metrics['win_rate']}")
    print(f"METRIC net_pnl={metrics['net_pnl']}")
    print(f"METRIC total_trades={metrics['total_trades']}")
    print(f"METRIC sl_exits={metrics['sl_exits']}")
    print(f"METRIC tp_exits={metrics['tp_exits']}")
    print(f"METRIC stocks_with_trades={metrics['stocks_with_trades']}")


if __name__ == '__main__':
    main()
