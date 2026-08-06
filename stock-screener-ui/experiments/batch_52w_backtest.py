#!/usr/bin/env python3
"""Batch 52W backtest on NSE stocks. Runs all 4 52W strategies, saves CSV output.

Usage:
  python3 experiments/batch_52w_backtest.py --limit 20
  python3 experiments/batch_52w_backtest.py --min-price 100 --limit 100
  python3 experiments/batch_52w_backtest.py --full  (all NSE_EQ stocks)
"""
import sys, os, json, time, csv, argparse
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))

from experiments.ema_benchmark import calc_costs

CAPITAL = 100000
H52_PERIOD = 252
IST = datetime.now().astimezone()

# --- Strategy configs ---
STRATEGIES = {
    'target': {
        'label': '52W Target',
        'sl_pct': 1.0, 'tp_pct': 0, 'trail_pct': 1.0,
        'entry_thresh_pct': 1.0, 'min_drought': 10, 'max_hold': 10, 'cooldown': 5,
        'direction': 'LONG',
    },
    'chaser': {
        'label': '52W Chaser',
        'sl_pct': 2.0, 'tp_pct': 3.0, 'trail_pct': 2.0,
        'entry_thresh_pct': 3.0, 'min_breakout_pct': 0.5, 'min_drought': 3,
        'max_hold': 30, 'cooldown': 30, 'direction': 'LONG',
    },
    'blind': {
        'label': 'Blind 52W',
        'sl_pct': 5.0, 'tp_pct': 0, 'trail_pct': 0,
        'entry_thresh_pct': 3.0, 'min_drought': 20,
        'max_hold': 30, 'cooldown': 0, 'direction': 'LONG',
    },
    'short_fail': {
        'label': 'Short 52W Failed',
        'sl_pct': 3.0, 'tp_pct': 5.0, 'trail_pct': 0,
        'lookback': 5, 'max_hold': 15, 'cooldown': 15, 'direction': 'SHORT',
    },
}

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--limit', type=int, default=20, help='Max stocks to test')
    p.add_argument('--min-price', type=float, default=20.0)
    p.add_argument('--min-volume', type=float, default=50000)
    p.add_argument('--full', action='store_true', help='Run on all NSE_EQ stocks')
    p.add_argument('--workers', type=int, default=5)
    p.add_argument('--outdir', default=None, help='Output directory')
    return p.parse_args()

def get_nse_stocks(limit=0, min_price=20, min_vol=50000):
    """Get NSE_EQ real stocks from instruments JSON (filters out ETFs)."""
    instr_path = os.path.join(PROJ_DIR, 'upstox_trader', 'config_and_utils', 'nse_instruments.json')
    with open(instr_path) as f:
        instruments = json.load(f)
    etf_keywords = ['ETF', 'IETF', 'MOMENTUM', 'QUALTY', 'NIFTY', 'BANKNIFTY',
                    'SENSEX', 'GOLD', 'SILVER', 'TOP', 'MID', 'SMALL']
    stocks = []
    for i in instruments:
        if i.get('segment') != 'NSE_EQ': continue
        if i.get('instrument_type') != 'EQ': continue
        sym = (i.get('trading_symbol') or '').upper()
        if not sym: continue
        name = (i.get('name') or '').upper()
        if any(kw in sym or kw in name for kw in etf_keywords): continue
        stocks.append({
            'symbol': sym,
            'name': i.get('name', sym),
            'instrument_key': i.get('instrument_key', ''),
        })
    # Deduplicate by symbol
    seen = set()
    uniq = []
    for s in stocks:
        if s['symbol'] not in seen:
            seen.add(s['symbol'])
            uniq.append(s)
    if limit > 0: uniq = uniq[:limit]
    return uniq

# Save token at module level so each thread can init its own API client
_TOKEN = None

def fetch_daily_data(stock):
    """Fetch ~500 days of daily data from Upstox (thread-safe, creates own client)."""
    global _TOKEN
    try:
        # Each thread creates its own API client (avoids thread-safety issues)
        sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))
        from config_and_utils.free_indian_apis import UpstoxAPI
        api = UpstoxAPI(api_key='dummy', api_secret='dummy', quiet=True)
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=800)).strftime('%Y-%m-%d')
        df = api.fetch_historical_data_v3(
            stock['symbol'], 'days', 1, to_date, from_date,
            instrument_type='EQ', exchange='NSE_EQ'
        )
        if df is not None and len(df) >= H52_PERIOD + 10:
            return df
    except Exception as e:
        pass
    return None

def run_strategy(df, cfg):
    """Run a 52W strategy on a daily DataFrame. Returns list of trade dicts."""
    c = df['close'].values.astype(float)
    h = df['high'].values.astype(float)
    l = df['low'].values.astype(float)
    v = df['volume'].values.astype(float)
    dates = df.index.values
    n = len(c)

    h52 = pd.Series(h).rolling(H52_PERIOD, min_periods=H52_PERIOD).max().values
    if n < H52_PERIOD + 10: return []

    # Days since last 52W touch
    ds = np.full(n, 9999); lt = 0
    for i in range(n):
        if h[i] >= h52[i]: lt = i
        ds[i] = i - lt

    strat = cfg.get('direction', 'LONG')
    sl_r = cfg.get('sl_pct', 2.0) / 100
    tp_val = cfg.get('tp_pct', 0)
    tp_r = tp_val / 100 if tp_val > 0 else None
    tr = cfg.get('trail_pct', 0) / 100
    et = cfg.get('entry_thresh_pct', 3.0) / 100
    mh = cfg.get('max_hold', 30)
    cd = cfg.get('cooldown', 5)

    trades = []; in_pos = False; po = {}; le = -9999

    for i in range(H52_PERIOD + 5, n):
        cx = c[i]; hx = h[i]; lx = l[i]; dt = dates[i]

        if not in_pos:
            if (i - le) < cd: continue

            if strat == 'LONG':
                mind = cfg.get('min_drought', 0)
                if mind > 0 and ds[i] < mind: continue

                if 'min_breakout_pct' in cfg:  # CHASER: price above 52WH
                    bo = cfg['min_breakout_pct'] / 100
                    if hx > h52[i] * (1 + bo) and cx <= h52[i] * (1 + et):
                        entry = cx
                        po = {'entry': entry, 'sl': entry*(1-sl_r), 'tp': entry*(1+tp_r) if tp_r else None,
                              'hp': entry, 'trailing': False, 'h52_entry': h52[i], 'entry_i': i, 'entry_dt': dt}
                        in_pos = True
                else:  # TARGET or BLIND: price below but near 52WH
                    if cx < h52[i] and cx >= h52[i] * (1 - et):
                        entry = cx
                        if cfg.get('trail_pct', 0) > 0:
                            po = {'entry': entry, 'sl': entry*(1-sl_r), 'hp': entry,
                                  'mode': 'below', 'h52_target': h52[i], 'entry_i': i, 'entry_dt': dt}
                        else:
                            po = {'entry': entry, 'sl': entry*(1-sl_r), 'tp': h52[i], 'hp': entry,
                                  'entry_i': i, 'entry_dt': dt}
                        in_pos = True

            else:  # SHORT (short_fail)
                lb = cfg.get('lookback', 5)
                rp = max(h[i-lb:i+1])
                p52 = max(h52[:i+1])
                if rp > p52 * 1.001 and cx < rp * 0.99:
                    entry = cx
                    po = {'entry': entry, 'sl': rp*(1+sl_r), 'tp': entry*(1-tp_r) if tp_r is not None else None,
                          'peak': rp, 'entry_i': i, 'entry_dt': dt}
                    in_pos = True
            continue

        if in_pos:
            hp = max(po.get('hp', po['entry']), hx)
            po['hp'] = hp
            days = i - po['entry_i']
            ep = None; reason = None

            if strat == 'LONG':
                if po.get('trailing'):
                    po['trail_stop'] = max(po.get('trail_stop', 0), hp * (1 - tr))
                    if cx <= po['trail_stop']: ep = cx; reason = 'TRAIL'
                elif po.get('mode') == 'below':  # Target: below 52WH
                    if cx <= po['sl']: ep = po['sl']; reason = 'SL'
                    elif cx >= po['h52_target']:
                        po['mode'] = 'above'
                        if tr > 0:
                            po['trailing'] = True
                            po['trail_stop'] = hp * (1 - tr)
                elif po.get('tp') is not None:  # Blind or Chaser with fixed TP
                    if cx >= po['tp']: ep = po['tp']; reason = 'TP'
                    elif cx <= po['sl']: ep = po['sl']; reason = 'SL'
                    elif po.get('h52_entry') and cx >= po['h52_entry'] and not po.get('trailing') and tr > 0:
                        po['trailing'] = True
                        po['trail_stop'] = hp * (1 - tr)
                elif po.get('tp') is None and not po.get('trailing') and tr > 0:
                    if cx >= po['h52_entry'] if po.get('h52_entry') else cx > po['entry']:
                        po['trailing'] = True
                        po['trail_stop'] = hp * (1 - tr)
                        if cx <= po['trail_stop']: ep = cx; reason = 'TRAIL'

                if ep is None and days >= mh: ep = cx; reason = 'MAX_HOLD'

            else:  # SHORT
                if cx <= po['tp']: ep = po['tp']; reason = 'TP'
                elif cx >= po['sl']: ep = po['sl']; reason = 'SL'
                elif days >= mh: ep = cx; reason = 'MAX_HOLD'

            if ep:
                corr = 1 if strat == 'LONG' else -1
                shares = int(CAPITAL / po['entry'])
                gp = corr * (ep - po['entry']) * shares
                cs = calc_costs(po['entry'], ep, shares, strat)
                exit_dt = pd.Timestamp(dt)
                dt_str = lambda d: str(d)[:10] if hasattr(d, 'strftime') else str(d)[:10]
                trades.append({
                    'symbol': getattr(df, 'name', ''),
                    'entry_date': dt_str(po['entry_dt']),
                    'entry_price': round(po['entry'], 2),
                    'exit_date': dt_str(exit_dt),
                    'exit_price': round(ep, 2),
                    'side': strat,
                    'reason': reason,
                    'net_pnl': round(gp - cs, 2),
                    'gross_pnl': round(gp, 2),
                    'costs': round(cs, 2),
                    'days_held': days,
                })
                in_pos = False; le = i
    return trades

def compute_metrics(trades):
    if not trades: return {'trades': 0, 'wins': 0, 'losses': 0, 'wr': 0,
                          'net_pnl': 0, 'pf': 0, 'avg_win': 0, 'avg_loss': 0,
                          'max_win': 0, 'max_loss': 0, 'total_costs': 0}
    wins = [t for t in trades if t['net_pnl'] > 0]
    losses = [t for t in trades if t['net_pnl'] <= 0]
    net = sum(t['net_pnl'] for t in trades)
    gw = sum(t['net_pnl'] for t in wins)
    gl = abs(sum(t['net_pnl'] for t in losses))
    return {
        'trades': len(trades),
        'wins': len(wins), 'losses': len(losses),
        'wr': round(len(wins)/len(trades)*100, 1),
        'net_pnl': round(net, 2),
        'pf': round(gw/gl, 4) if gl > 0 else 99.9999,
        'avg_win': round(gw/len(wins), 2) if wins else 0,
        'avg_loss': round(gl/len(losses), 2) if losses else 0,
        'max_win': round(max(t['net_pnl'] for t in wins), 2) if wins else 0,
        'max_loss': round(min(t['net_pnl'] for t in losses), 2) if losses else 0,
        'total_costs': round(sum(t['costs'] for t in trades), 2),
    }

def main():
    args = parse_args()

    # Output directory
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    outdir = args.outdir or os.path.join(SCRIPT_DIR, 'experiments', 'output', f'run_{ts}')
    os.makedirs(outdir, exist_ok=True)
    print(f"📁 Output: {outdir}", file=sys.stderr)

    # Get stocks
    limit = 0 if args.full else args.limit
    stocks = get_nse_stocks(limit=limit)
    print(f"📊 Stocks: {len(stocks)} NSE_EQ", file=sys.stderr)

    # Save config
    config = vars(args)
    config['strategies'] = {k: v for k, v in STRATEGIES.items()}
    with open(os.path.join(outdir, 'config.json'), 'w') as f:
        json.dump(config, f, indent=2, default=str)

    # Get token from SQLite directly
    import sqlite3
    db_path = os.path.join(SCRIPT_DIR, 'db', 'alphashri.db')
    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT access_token FROM broker_connections WHERE broker_name='upstox' LIMIT 1").fetchone()
    conn.close()
    if not row: print("❌ No Upstox token in DB"); sys.exit(1)
    token = row[0]
    print(f"🔑 Token OK ({len(token)} chars)", file=sys.stderr)
    # Save token globally for threads
    global _TOKEN
    _TOKEN = token
    token_path = os.path.join(PROJ_DIR, '.upstox_token.json')
    with open(token_path, 'w') as f:
        json.dump({'access_token': token}, f)

    # Run backtest
    all_trades = {s: [] for s in STRATEGIES}
    stock_rows = []
    done = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_daily_data, s): s for s in stocks}
        for f in as_completed(futures):
            stock = futures[f]
            done += 1
            sym = stock['symbol']
            df = f.result()
            if df is None:
                print(f"  ⏭️  {done:4d}/{len(stocks)} {sym:<20} — no data", file=sys.stderr)
                continue

            df.name = sym
            n_days = len(df)
            stock_row = {'symbol': sym, 'data_days': n_days}

            for strat_name, strat_cfg in STRATEGIES.items():
                trades = run_strategy(df, strat_cfg)
                if trades:
                    all_trades[strat_name].extend(trades)
                m = compute_metrics(trades)
                stock_row[f'{strat_name}_trades'] = m['trades']
                stock_row[f'{strat_name}_wr'] = m['wr']
                stock_row[f'{strat_name}_pf'] = m['pf']
                stock_row[f'{strat_name}_net'] = m['net_pnl']

            stock_rows.append(stock_row)
            print(f"  ✅ {done:4d}/{len(stocks)} {sym:<20} — {n_days} days", file=sys.stderr)

    # Save summary CSV
    if stock_rows:
        summary_df = pd.DataFrame(stock_rows)
        summary_path = os.path.join(outdir, 'stocks_summary.csv')
        summary_df.to_csv(summary_path, index=False)
        print(f"✅ Summary: {summary_path}", file=sys.stderr)

    # Save trades CSVs
    for strat_name, trades in all_trades.items():
        if trades:
            trades_df = pd.DataFrame(trades)
            path = os.path.join(outdir, f'trades_{strat_name}.csv')
            trades_df.to_csv(path, index=False)
            print(f"✅ Trades: {path} ({len(trades_df)} trades)", file=sys.stderr)
        else:
            print(f"  ℹ️  {strat_name}: 0 trades", file=sys.stderr)

    # Print summary table
    print(f"\n{'='*80}")
    print(f"  STRATEGY SUMMARY")
    print(f"{'='*80}")
    print(f"{'Strategy':<20} {'Trades':>7} {'WR%':>6} {'PF':>10} {'Net P&L':>12} {'AvgWin':>10} {'AvgLoss':>10}")
    print("-" * 80)
    for strat_name, cfg in STRATEGIES.items():
        trades = all_trades[strat_name]
        m = compute_metrics(trades)
        print(f"{cfg['label']:<20} {m['trades']:>7} {m['wr']:>5.1f}% {m['pf']:>10.4f} ₹{m['net_pnl']:>+9,.0f} ₹{m['avg_win']:>+8,.0f} ₹{m['avg_loss']:>+8,.0f}")
    print(f"\n📁 All files in: {outdir}", file=sys.stderr)

if __name__ == '__main__':
    main()
