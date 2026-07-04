#!/usr/bin/env python3
"""Run EMA Cross 60-min on all high-volatility stocks in parallel.

Reads stock list from experiments/data/high_vol_stocks.csv
Runs EMA Cross 60-min (SL=8%, TP=12%) on each stock using ThreadPoolExecutor.
Outputs ranked by profit factor.
"""
import sys, os, csv, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
from market_data.market_data import fetch_candles, resample_candles
from experiments.ema_benchmark import sim_symbol, compute_metrics, ENV

ENV['SL'] = 8.0; ENV['TP'] = 12.0; ENV['FAST'] = 1; ENV['SLOW'] = 2
ENV['COOLDOWN'] = 1; ENV['EOD_HOUR'] = 15; ENV['EOD_MINUTE'] = 0
ENV['TRADE_CAPITAL'] = 100000
ENV['TF'] = 60

# Max stocks to process (top N by ATR%)
MAX_STOCKS = 50

# Read screener results
csv_path = os.path.join(os.path.dirname(__file__), '..', 'experiments', 'data', 'high_vol_stocks.csv')
if not os.path.exists(csv_path):
    print(f"Run high_vol_screener.py first to generate {csv_path}", file=sys.stderr)
    sys.exit(1)

stocks = []
with open(csv_path) as f:
    for row in csv.DictReader(f):
        stocks.append(row)
print(f"Loaded {len(stocks)} stocks from screener", file=sys.stderr)

# Take top N by ATR%
stocks = sorted(stocks, key=lambda x: float(x['atr_pct']), reverse=True)[:MAX_STOCKS]
print(f"Processing top {len(stocks)} by ATR%", file=sys.stderr)

def process_stock(sym: str) -> dict:
    """Fetch data, run EMA 60-min, return metrics."""
    t0 = time.time()
    try:
        df_5m = fetch_candles(symbol=sym, tf=5, from_date="2026-01-01", to_date="2026-07-01")
        if df_5m is None or len(df_5m) < 200:
            return {'symbol': sym, 'error': 'insufficient data', 'trades': 0}

        df_60m = resample_candles(df_5m, 60)
        if df_60m is None or len(df_60m) < 20:
            return {'symbol': sym, 'error': 'insufficient 60m data', 'trades': 0}

        trades = sim_symbol(df_60m)
        elapsed = time.time() - t0
        m = compute_metrics(trades)
        wins = sum(1 for t in trades if t['net_pnl'] > 0)
        net = sum(t['net_pnl'] for t in trades)
        gw = sum(t['gross_pnl'] for t in trades if t['gross_pnl'] > 0)
        gl = abs(sum(t['gross_pnl'] for t in trades if t['gross_pnl'] <= 0))

        return {
            'symbol': sym,
            'trades': m['total_trades'],
            'wins': wins,
            'win_rate': round(m['win_rate'], 1),
            'net_pnl': round(net, 2),
            'profit_factor': round(m['profit_factor'], 4),
            'gross_pf': round(gw / gl, 4) if gl > 0 else 0,
            'total_costs': round(m['total_costs'], 2),
            'elapsed': round(elapsed, 1),
            'error': None,
        }
    except Exception as e:
        return {'symbol': sym, 'error': str(e)[:60], 'trades': 0}

results = []
with ThreadPoolExecutor(max_workers=3) as pool:
    fut_map = {pool.submit(process_stock, s['symbol']): s for s in stocks}
    for fut in as_completed(fut_map):
        r = fut.result()
        results.append(r)
        sym = r['symbol']
        if r['error']:
            print(f"  ✗ {sym:<18} ERROR: {r['error']}", file=sys.stderr)
        else:
            pct = r['win_rate']
            s = '✅' if r['profit_factor'] >= 1.0 else '❌'
            print(f"  {s} {sym:<18} {r['trades']:3d} trades WR={pct:>5.1f}% Net=Rs{r['net_pnl']:>+9,.0f} PF={r['profit_factor']:.4f} ({r['elapsed']}s)", file=sys.stderr)

# Print summary table
results.sort(key=lambda x: x.get('profit_factor', 0), reverse=True)

print(f"\n{'='*110}")
print(f"  EMA Cross 60-min on Top {len(results)} High-Volatility Stocks")
print(f"  Config: SL=8% TP=12% FAST=1 SLOW=2 EOD=15:00 (Jan-Jun 2026)")
print(f"{'='*110}")
print(f"{'Rank':<5} {'Symbol':<18} {'Trades':<7} {'WR':<6} {'Net P&L':<14} {'PF':<10} {'GrossPF':<10} {'Costs':<10} {'Time':<6}")
print("-" * 110)

profitable = 0
total_trades = 0
total_net = 0
for i, r in enumerate(results, 1):
    if r.get('error'):
        continue
    s = '✅' if r['profit_factor'] >= 1.0 else '❌'
    print(f"{s} {i:<3} {r['symbol']:<18} {r['trades']:<7} {r['win_rate']:>5.1f}% {r['net_pnl']:>+10,.0f}  {r['profit_factor']:<10.4f} {r['gross_pf']:<10.4f} {r['total_costs']:>+8,.0f} {r['elapsed']}s")
    if r['profit_factor'] >= 1.0:
        profitable += 1
    total_trades += r['trades']
    total_net += r['net_pnl']

print("-" * 110)
print(f"{'':5} {'TOTAL':<18} {total_trades:<7} {'':6} {total_net:>+10,.0f}  {'':10} {'':10} {'':10}")
print(f"\n✅ Profitable stocks: {profitable}/{len(results)}")

# Top 10 symbols for bot creation
print(f"\n=== Top 10 Symbols for Bot ===")
top10 = [r for r in results if r.get('profit_factor', 0) >= 1.0 and not r.get('error')][:10]
for r in top10:
    print(f"  {r['symbol']}")
