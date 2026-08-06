#!/usr/bin/env python3
"""Test multiple strategies across different stock universes.

Universes: High Beta, Low Beta, Nifty 50, Mid Cap, Small Cap
Strategies: Supertrend, BB Squeeze, EMA Cross, SR Breakout

Outputs a comparison table of PF × Universe combinations.
"""
import sys, os, time
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader', 'screeners'))

from tradingview_screener import Query, col
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd
import numpy as np

from experiments.benchmark_screener_params import load_or_fetch_candle_data
from experiments.ema_benchmark import calc_costs, ema
from experiments.benchmark_bb_strategy import bb_squeeze
from experiments.benchmark_supertrend import supertrend, run_strategy as st_run
from market_data.market_data import resample_candles

# Try to get TV cookies
try:
    from tv_helpers import get_tradingview_cookies
    cookies = get_tradingview_cookies(quiet=True)
except:
    cookies = None

UNIVERSES = {
    "High Beta": [
        col('market_cap_basic') > 50_000_000_000,
        col('beta_1_year') > 1.2,
        col('close') > 50, col('volume') > 100000,
        col('exchange') == 'NSE',
    ],
    "Low Beta": [
        col('market_cap_basic') > 50_000_000_000,
        col('beta_1_year') < 0.8,
        col('close') > 50, col('volume') > 100000,
        col('exchange') == 'NSE',
    ],
    "Nifty 50": [
        col('close') > 100, col('volume') > 500000,
        col('market_cap_basic') > 500_000_000_000,
        col('exchange') == 'NSE',
    ],
    "Mid Cap": [
        col('close') > 30, col('volume') > 200000,
        col('market_cap_basic').between(10_000_000_000, 100_000_000_000),
        col('exchange') == 'NSE',
    ],
    "Small Cap": [
        col('close') > 20, col('volume') > 100000,
        col('market_cap_basic').between(1_000_000_000, 10_000_000_000),
        col('exchange') == 'NSE',
    ],
    "Volatility Trend": [
        col('close') > 50, col('volume') > 200000,
        col('market_cap_basic') > 10_000_000_000,
        col('exchange') == 'NSE',
    ],
}

STRATEGIES = {
    "Supertrend": {"fn": "st", "suffix": ""},
    "BB Squeeze": {"fn": "bb", "suffix": ""},
    "EMA Cross": {"fn": "emac", "suffix": ""},
    "SR Breakout": {"fn": "srbk", "suffix": ""},
}

def fetch_universe(name, filters):
    try:
        _, df = (
            Query()
            .select('name', 'close', 'volume', 'market_cap_basic', 'beta_1_year')
            .set_markets('india')
            .where(*filters)
            .limit(100)
            .get_scanner_data(cookies=cookies)
        )
        if df is not None and not df.empty:
            return [str(s).upper() for s in df['name'].tolist()]
    except Exception as e:
        pass
    return []

def run_st(closes, highs, lows):
    return st_run(closes, highs, lows, 7, 1.0, 2.0, 10.0)

def run_bb(closes, highs, lows):
    return bb_squeeze(closes, 16, 2.0, 3.0, 10.0, 0.15)

def run_emac(closes, highs, lows):
    """EMA Cross 60-min: fast=1, slow=2, SL=8%, TP=12%."""
    f = ema(closes, 1); s = ema(closes, 2)
    sl = 8/100; tp = 12/100; trades = []; ip = False; po = {}; le = -5
    for i in range(2, len(closes)):
        c = closes[i]
        if not ip:
            if (i-le) < 2: continue
            if f[i-1] <= s[i-1] and f[i] > s[i]:
                po = {'entry': c, 'sl': c*(1-sl), 'tp': c*(1+tp)}; ip = True
        else:
            if c >= po['tp']: ep = po['tp']; r = 'TP'
            elif c <= po['sl']: ep = po['sl']; r = 'SL'
            else: continue
            gp = (ep-po['entry'])*100000/po['entry']
            trades.append({'net_pnl': gp - calc_costs(po['entry'],ep,int(100000/po['entry']),'LONG')})
            ip = False; le = i
    return trades

def run_srbk(closes, highs, lows):
    """Simplified SR Breakout long-side simulation. Not implemented here."""
    return []

STRAT_FNS = {
    "Supertrend": run_st,
    "BB Squeeze": run_bb,
    "EMA Cross": run_emac,
}

print(f"{'Universe':<20} {'Stocks':>7} {'Strategy':<16} {'Trades':>7} {'WR%':>6} {'PF':>8} {'Net P&L':>12}")
print("-" * 80)

results = []

for uname, filters in UNIVERSES.items():
    symbols = fetch_universe(uname, filters)
    if not symbols:
        print(f"{uname:<20} {'—':>7} {'no data':<16}")
        continue

    candle_data = load_or_fetch_candle_data(symbols)
    available = [s for s in symbols if s in candle_data]
    if len(available) < 3:
        print(f"{uname:<20} {len(available):>7} {'<3 stocks':<16}")
        continue

    for sname, strat_fn in STRAT_FNS.items():
        all_trades = []
        for sym in available:
            df = candle_data.get(sym)
            if df is None or len(df) < 200: continue
            rdf = resample_candles(df, 60)
            if rdf is None or len(rdf) < 30: continue
            tr = strat_fn(rdf['close'].tolist(), rdf['high'].tolist(), rdf['low'].tolist())
            all_trades.extend(tr)

        tt = len(all_trades)
        tw = sum(1 for t in all_trades if t.get('net_pnl',0) > 0)
        tn = sum(t.get('net_pnl',0) for t in all_trades)
        gw = sum(t.get('net_pnl',0) for t in all_trades if t.get('net_pnl',0) > 0)
        gl = abs(sum(t.get('net_pnl',0) for t in all_trades if t.get('net_pnl',0) <= 0))
        apf = round(gw/gl, 4) if gl > 0 else 99.9999
        awr = round(tw/tt*100,1) if tt > 0 else 0

        print(f"{uname:<20} {len(available):>7} {sname:<16} {tt:>7} {awr:>5.1f}% {apf:>8.4f} ₹{tn:>+9,.0f}")
        results.append({'universe': uname, 'strategy': sname, 'stocks': len(available),
                        'trades': tt, 'wr': awr, 'pf': apf, 'net_pnl': tn})

# Summary heatmap table
print(f"\n{'='*80}")
print(f"  📊 PF HEATMAP: Strategy × Universe")
print(f"{'='*80}")
print(f"{'Universe':<20}", end="")
for s in ['Supertrend','BB Squeeze','EMA Cross']:
    print(f" {s:<16}", end="")
print()

for uname in [u[0] for u in UNIVERSES.items()]:
    print(f"{uname:<20}", end="")
    for sname in ['Supertrend','BB Squeeze','EMA Cross']:
        r = next((r for r in results if r['universe']==uname and r['strategy']==sname), None)
        if r:
            pf = r['pf']
            mark = "✅" if pf >= 1.5 else "👍" if pf >= 1.0 else "❌"
            print(f" {pf:<6.2f}{mark:<9}", end="")
        else:
            print(f" {'—':<15}", end="")
    print()
