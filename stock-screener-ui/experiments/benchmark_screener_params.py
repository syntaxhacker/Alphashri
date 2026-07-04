#!/usr/bin/env python3
"""Benchmark different screener filter params for EMA Cross 60-min.

Usage: python3 experiments/benchmark_screener_params.py \
    --min-mcap-cr 1000 --min-atr-pct 3.0 --min-price 100 --min-volume 500000

Outputs METRIC lines for autoresearch loop.
On first run, fetches TV screener data and caches candle data (takes ~5 min).
Subsequent runs use cache (< 5s).
"""
import argparse, sys, os, pickle, csv, time
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)  # parent of stock-screener-ui
sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))

import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
from trending_upside import fetch_trending_stocks
from market_data.market_data import fetch_candles, resample_candles

DATA_DIR = os.path.join(SCRIPT_DIR, 'experiments', 'data')
TV_CACHE = os.path.join(DATA_DIR, 'highvol_raw.csv')
CANDLE_CACHE = os.path.join(DATA_DIR, 'highvol_cache.pkl')


def load_or_fetch_tv_data():
    if os.path.exists(TV_CACHE):
        print(f"  TV data: loaded {TV_CACHE}", file=sys.stderr)
        with open(TV_CACHE) as f:
            return list(csv.DictReader(f))
    print(f"  Fetching TV screener data (volatility_trend)...", file=sys.stderr)
    df = fetch_trending_stocks(limit=200, profile='volatility_trend')
    if df is None or df.empty:
        print("ERROR: No TV data returned", file=sys.stderr)
        sys.exit(1)
    rows = []
    for _, row in df.iterrows():
        rows.append({
            'symbol': str(row.get('name', '?')).upper(),
            'price': str(row.get('close', '0')),
            'atr_pct': str(row.get('Volatility.D', '0')),
            'adx': str(row.get('ADX', '0')),
            'rsi': str(row.get('RSI', '0')),
            'mcap_cr': str(float(row.get('market_cap_basic', 0)) / 1e7),
            'volume': str(row.get('volume', '0')),
        })
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(TV_CACHE, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    print(f"  TV data: cached {len(rows)} stocks", file=sys.stderr)
    return rows


def load_or_fetch_candle_data(symbols):
    if os.path.exists(CANDLE_CACHE):
        print(f"  Candle cache: loaded ({os.path.getsize(CANDLE_CACHE)//1024}KB)", file=sys.stderr)
        with open(CANDLE_CACHE, 'rb') as f:
            return pickle.load(f)
    print(f"  Fetching 5-min candles for {len(symbols)} symbols...", file=sys.stderr)
    data = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        fut_map = {}
        for sym in symbols:
            fut = pool.submit(fetch_candles, sym, 5, '2026-01-01', '2026-07-01')
            fut_map[fut] = sym
        for fut in as_completed(fut_map):
            sym = fut_map[fut]
            df = fut.result()
            if df is not None and len(df) > 100:
                data[sym] = df
                print(f"    {sym}: {len(df)} candles", file=sys.stderr)
            else:
                print(f"    {sym}: skipped (no data)", file=sys.stderr)
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CANDLE_CACHE, 'wb') as f:
        pickle.dump(data, f)
    print(f"  Candle cache: saved {len(data)} symbols", file=sys.stderr)
    return data


def sim_symbol_60m(df_60m):
    """Minimal EMA Cross sim for 60-min data. Returns list of trade dicts."""
    from experiments.ema_benchmark import ema
    closes = df_60m['close'].tolist()
    ema_fast = ema(closes, 1)
    ema_slow = ema(closes, 2)
    trades = []
    in_pos = False
    last_exit = -2
    sl_pct = 8.0 / 100
    tp_pct = 12.0 / 100
    eod_min = 15 * 60
    capital = 100000
    for i in range(1, len(closes)):
        ts_ist = df_60m.index[i].tz_convert(
            __import__('datetime').timezone(__import__('datetime').timedelta(hours=5, minutes=30))
        )
        time_min = ts_ist.hour * 60 + ts_ist.minute
        row = df_60m.iloc[i]
        if in_pos:
            pnl_pct = (row['close'] - pos['entry']) / pos['entry'] * 100
            sl_hit = row['low'] <= pos['sl']
            tp_hit = row['high'] >= pos['tp']
            if tp_hit:
                exit_p = pos['tp']; reason = 'TP'
            elif sl_hit:
                exit_p = pos['sl']; reason = 'SL'
            elif time_min >= eod_min:
                exit_p = row['close']; reason = 'EOD'
            else:
                continue
            shares = int(capital / pos['entry'])
            gp = (exit_p - pos['entry']) * shares
            trades.append({'side': 'LONG', 'entry': pos['entry'], 'exit': exit_p, 'gross_pnl': gp, 'net_pnl': gp, 'reason': reason, 'entry_time': pos['entry_time'], 'exit_time': ts_ist})
            in_pos = False
            last_exit = i
            continue
        if (i - last_exit) < 1:
            continue
        if time_min >= eod_min:
            continue
        if ema_fast[i - 1] <= ema_slow[i - 1] and ema_fast[i] > ema_slow[i]:
            entry = float(row['close'])
            pos = {'side': 'LONG', 'entry': entry, 'sl': entry * (1 - sl_pct), 'tp': entry * (1 + tp_pct), 'entry_time': ts_ist}
            in_pos = True
    return trades


def compute_aggregate_metrics(all_trades):
    if not all_trades:
        return {'total_trades': 0, 'net_pnl': 0.0, 'profit_factor': 0.0, 'win_rate': 0.0, 'tp_exits': 0, 'sl_exits': 0, 'eod_exits': 0}
    wins = [t for t in all_trades if t['net_pnl'] > 0]
    losses = [t for t in all_trades if t['net_pnl'] <= 0]
    gw = sum(t['net_pnl'] for t in wins)
    gl = abs(sum(t['net_pnl'] for t in losses))
    return {
        'total_trades': len(all_trades),
        'net_pnl': round(sum(t['net_pnl'] for t in all_trades), 2),
        'profit_factor': round(gw / gl, 4) if gl > 0 else 99.9999,
        'win_rate': round(len(wins) / len(all_trades) * 100, 1) if all_trades else 0.0,
        'tp_exits': sum(1 for t in all_trades if t.get('reason') == 'TP'),
        'sl_exits': sum(1 for t in all_trades if t.get('reason') == 'SL'),
        'eod_exits': sum(1 for t in all_trades if t.get('reason') == 'EOD'),
    }


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--min-mcap-cr', type=float, default=1000.0)
    p.add_argument('--min-atr-pct', type=float, default=3.0)
    p.add_argument('--min-price', type=float, default=100.0)
    p.add_argument('--min-volume', type=float, default=500000.0)
    return p.parse_args()


def main():
    args = parse_args()
    desc = f"mcap>={args.min_mcap_cr}Cr atr>={args.min_atr_pct}% price>={args.min_price} vol>={args.min_volume}"
    print(f"  Params: {desc}", file=sys.stderr)
    t0 = time.time()

    tv_stocks = load_or_fetch_tv_data()

    qualifying = []
    for s in tv_stocks:
        mcap = float(s['mcap_cr'])
        atr = float(s['atr_pct'])
        price = float(s['price'])
        vol = float(s['volume'])
        if mcap < args.min_mcap_cr: continue
        if atr < args.min_atr_pct: continue
        if price < args.min_price: continue
        if vol < args.min_volume: continue
        qualifying.append(s['symbol'])

    print(f"  Qualifying stocks: {len(qualifying)}", file=sys.stderr)

    if len(qualifying) < 3:
        print("  ERROR: <3 qualifying stocks", file=sys.stderr)
        print("METRIC aggregate_pf=0"); print("METRIC qual_stocks=0"); print("METRIC total_trades=0")
        print("METRIC total_net_pnl=0"); print("METRIC avg_pf=0"); print("METRIC profitable_ratio=0")
        return

    candle_data = load_or_fetch_candle_data(qualifying)

    all_trades = []
    stock_pfs = []
    for sym in qualifying:
        df = candle_data.get(sym)
        if df is None: continue
        df_60 = resample_candles(df, 60)
        if df_60 is None or len(df_60) < 20: continue
        trades = sim_symbol_60m(df_60)
        for t in trades:
            t['symbol'] = sym
        if len(trades) >= 2:
            m = compute_aggregate_metrics(trades)
            stock_pfs.append(m['profit_factor'])
        all_trades.extend(trades)

    metrics = compute_aggregate_metrics(all_trades)
    elapsed = time.time() - t0

    profitable_count = sum(1 for pf in stock_pfs if pf >= 1.0)
    total_count = len(stock_pfs)
    profitable_ratio = round(profitable_count / total_count * 100, 1) if total_count > 0 else 0
    avg_pf = round(sum(stock_pfs) / total_count, 4) if total_count > 0 else 0

    print(file=sys.stderr)
    print(f"  Result: {metrics['total_trades']}t PF={metrics['profit_factor']} "
          f"Net=₹{metrics['net_pnl']:,.0f} Stocks={total_count}/{len(qualifying)} "
          f"ProfitRatio={profitable_ratio}% AvgPF={avg_pf} ({elapsed:.0f}s)", file=sys.stderr)

    print(f"METRIC aggregate_pf={metrics['profit_factor']}")
    print(f"METRIC qual_stocks={total_count}")
    print(f"METRIC total_trades={metrics['total_trades']}")
    print(f"METRIC total_net_pnl={metrics['net_pnl']}")
    print(f"METRIC avg_pf={avg_pf}")
    print(f"METRIC profitable_ratio={profitable_ratio}")


if __name__ == '__main__':
    main()
