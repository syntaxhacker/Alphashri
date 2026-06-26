#!/usr/bin/env python3
"""Universal benchmark: run any strategy on any stock universe.

Usage:
  python3 experiments/universal_benchmark.py --profile trending --strategy adx_trend
  python3 experiments/universal_benchmark.py --profile volatility_trend --strategy ema_60m
  python3 experiments/universal_benchmark.py --profile high_momentum --strategy adx_trend

Environment:
  --profile       Screener profile (trending, volatility_trend, high_momentum, etc.)
  --strategy      Strategy (adx_trend, ema_60m, orb, short_52w_failed)
  --limit         Max symbols (default: 30)
  --date-start    Start date YYYY-MM-DD (default: 2025-12-01)
  --date-end      End date YYYY-MM-DD (default: 2026-08-01)
  --sl            Stop loss %
  --tp            Take profit %
"""
import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import config; IST = config.IST
from market_data.market_data import fetch_candles
from backtest.costs import calculate_trading_costs

parser = argparse.ArgumentParser()
parser.add_argument('--profile', default='trending')
parser.add_argument('--strategy', default='adx_trend', choices=['adx_trend', 'ema_60m', 'orb', 'short_52w_failed'])
parser.add_argument('--limit', type=int, default=30)
parser.add_argument('--date-start', default='2025-12-01')
parser.add_argument('--date-end', default='2026-08-01')
parser.add_argument('--sl', type=float, default=None)
parser.add_argument('--tp', type=float, default=None)
args = parser.parse_args()

# ── Get symbols from screener ──
scanner_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..', 'scanners')
sys.path.insert(0, scanner_path)
sys.path.insert(0, os.path.join(scanner_path, '..'))
sys.path.insert(0, os.path.join(scanner_path, '..', 'upstox_trader'))
from trending_upside import fetch_trending_stocks
df = fetch_trending_stocks(limit=args.limit, profile=args.profile)
if df is None or df.empty:
    print(f"No symbols from profile '{args.profile}'")
    sys.exit(1)
SYMBOLS = [s.upper() for s in df['name'].tolist()]
print(f"\nProfile: {args.profile} | Strategy: {args.strategy} | Symbols: {len(SYMBOLS)}", file=sys.stderr)

# ── Run strategy ──
def run_adx_trend():
    from trading.adx_trend_signals import ADXTrendSignalGenerator
    gen = ADXTrendSignalGenerator({
        'sl_pct': args.sl or 5.0, 'tp_pct': args.tp or 6.0, 'adx_threshold': 25,
        'max_holding_days': 20, 'cooldown_days': 10, 'enable_shorts': False,
        'stock_ma50_filter': False,
    })
    all_trades = []
    for sym in SYMBOLS:
        df = fetch_candles(symbol=sym, tf=1440, from_date=args.date_start, to_date=args.date_end)
        if df is None or len(df) < 60: continue
        closes = df['close'].tolist(); highs = df['high'].tolist(); lows = df['low'].tolist()
        in_pos = False; pos = {}
        for i in range(60, len(closes)):
            cp = float(closes[i]); ts = df.index[i]; month = ts.strftime('%Y-%m')
            md = {'current_price': cp, 'high_52w': max(highs[:i]), 'days_since_52w_high': 0,
                'daily_highs': highs[:i], 'daily_closes': closes[:i], 'daily_lows': lows[:i],
                'ma50': sum(closes[i-50:i])/50, 'ma200': 0, 'volume': 0, 'avg_volume_20d': 0}
            if in_pos:
                d = i - pos['ei']
                es = gen.check_exit(sym, pos['side'], pos['entry'], pos['sl'], pos['tp'], cp,
                    days_in_position=d, max_holding_days=20,
                    highest_price_since_entry=max(pos.get('peak', cp), cp), entry_52w_high=md['high_52w'])
                if es:
                    shares = int(100000 / pos['entry'])
                    gp = (cp - pos['entry']) * shares if pos['side'] == 'BUY' else (pos['entry'] - cp) * shares
                    ct = calculate_trading_costs(pos['entry'], cp, shares, pos['side'])['total_costs']
                    all_trades.append({'month': month, 'net': gp - ct})
                    in_pos = False
                continue
            sig = gen.check_entry(sym, md)
            if sig:
                side = 'BUY' if sig.signal_type.value == 'LONG_ENTRY' else 'SELL'
                pos = {'side': side, 'entry': sig.price, 'sl': sig.stop_loss, 'tp': sig.take_profit, 'ei': i, 'peak': sig.price}
                in_pos = True
    return all_trades

def run_ema_60m():
    from experiments.ema_benchmark import SYMBOLS as _dummy, sim_symbol, compute_metrics, calc_costs, ENV as EMA_ENV
    from market_data.market_data import fetch_candles, resample_candles
    from concurrent.futures import ThreadPoolExecutor, as_completed

    EMA_ENV['SL'] = args.sl or 8.0
    EMA_ENV['TP'] = args.tp or 12.0
    EMA_ENV['FAST'] = 1
    EMA_ENV['SLOW'] = 2
    EMA_ENV['COOLDOWN'] = 1
    EMA_ENV['EOD_HOUR'] = 15
    EMA_ENV['EOD_MINUTE'] = 0

    data_5m = {}
    for sym in SYMBOLS:
        df = fetch_candles(symbol=sym, tf=5, from_date=args.date_start, to_date=args.date_end)
        if df is not None and len(df) > 20:
            if not df.index.tz:
                df.index = pd.DatetimeIndex(df.index).tz_localize("UTC")
            data_5m[sym] = df.sort_index()

    data = {}
    for sym, df in data_5m.items():
        rdf = resample_candles(df, 60)
        if rdf is not None and len(rdf) > 5:
            data[sym] = rdf

    all_trades = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        fut = {pool.submit(sim_symbol, df): sym for sym, df in data.items()}
        for f in as_completed(fut):
            sym = fut[f]; trades = f.result()
            for t in trades:
                t['symbol'] = sym
                t['net'] = t['net_pnl']
            all_trades.extend(trades)
    return [{'month': '', 'net': t['net']} for t in all_trades]

# Dispatch to strategy
if args.strategy == 'adx_trend':
    all_trades = run_adx_trend()
elif args.strategy == 'ema_60m':
    all_trades = run_ema_60m()
else:
    print(f"Strategy '{args.strategy}' not yet implemented", file=sys.stderr)
    sys.exit(1)

# ── Results ──
if not all_trades:
    print("No trades generated", file=sys.stderr)
    sys.exit(0)

wins = sum(1 for t in all_trades if t['net'] > 0)
net = sum(t['net'] for t in all_trades)
gp = sum(t['net'] for t in all_trades if t['net'] > 0)
gl = abs(sum(t['net'] for t in all_trades if t['net'] <= 0))
pf = gp / gl if gl else 0
costs = sum(t.get('costs', 0) for t in all_trades)

print(f"\nResults:", file=sys.stderr)
print(f"  Trades: {len(all_trades)} | WR: {wins/len(all_trades)*100:.0f}%", file=sys.stderr)
print(f"  Net: Rs {int(net):+,d} | PF: {pf:.4f}", file=sys.stderr)

print(f"METRIC total_trades={len(all_trades)}")
print(f"METRIC win_rate={round(wins/len(all_trades)*100, 1) if all_trades else 0}")
print(f"METRIC net_pnl={round(net, 2)}")
print(f"METRIC profit_factor={round(pf, 4)}")
