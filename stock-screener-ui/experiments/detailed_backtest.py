#!/usr/bin/env python3
"""Run detailed 6-month EMA Cross 60-min backtest on high-vol stocks.

Filters: mcap>=5000Cr, atr>=4%, price>=200, vol>=500K
Outputs per-stock P&L table sorted by net P&L.
"""
import sys, os, csv, time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))

from market_data.market_data import fetch_candles, resample_candles
from experiments.ema_benchmark import ema, calc_costs

# --- Config ---
MIN_MCAP_CR = 5000
MIN_ATR_PCT = 4.0
MIN_PRICE = 200
MIN_VOLUME = 500_000

SL_PCT = 8.0
TP_PCT = 12.0
FAST = 1
SLOW = 2
COOLDOWN = 1
CAPITAL = 100_000
DATE_START = '2026-01-01'
DATE_END = '2026-07-01'

TF = 60  # 60-min

# --- Load TV data ---
from experiments.benchmark_screener_params import load_or_fetch_tv_data, load_or_fetch_candle_data
tv = load_or_fetch_tv_data()

qualifying = []
for s in tv:
    mcap = float(s['mcap_cr'])
    atr = float(s['atr_pct'])
    price = float(s['price'])
    vol = float(s['volume'])
    if mcap < MIN_MCAP_CR: continue
    if atr < MIN_ATR_PCT: continue
    if price < MIN_PRICE: continue
    if vol < MIN_VOLUME: continue
    qualifying.append({
        'symbol': s['symbol'],
        'price': price,
        'atr_pct': atr,
        'mcap_cr': mcap,
        'vol': int(vol),
    })

qualifying.sort(key=lambda x: x['atr_pct'], reverse=True)
print(f"🔍 Filter: mcap≥{MIN_MCAP_CR}Cr, atr≥{MIN_ATR_PCT}%, price≥{MIN_PRICE}, vol≥{MIN_VOLUME:,}")
print(f"📊 Qualifying stocks: {len(qualifying)}")
print(file=sys.stderr)

# --- Fetch candle data & run ---
candle_data = load_or_fetch_candle_data([s['symbol'] for s in qualifying])

all_trades = []
per_stock = []

for s in qualifying:
    sym = s['symbol']
    df = candle_data.get(sym)
    if df is None:
        per_stock.append({'symbol': sym, 'price': s['price'], 'atr': s['atr_pct'],
                          'mcap': s['mcap_cr'], 'trades': 0, 'wins': 0, 'win_rate': 0,
                          'net_pnl': 0, 'profit_factor': 0, 'gross_profit': 0,
                          'gross_loss': 0, 'avg_pnl': 0, 'max_win': 0, 'max_loss': 0})
        continue

    df_60 = resample_candles(df, TF)
    if df_60 is None or len(df_60) < 20:
        per_stock.append({'symbol': sym, 'price': s['price'], 'atr': s['atr_pct'],
                          'mcap': s['mcap_cr'], 'trades': 0, 'wins': 0, 'win_rate': 0,
                          'net_pnl': 0, 'profit_factor': 0, 'gross_profit': 0,
                          'gross_loss': 0, 'avg_pnl': 0, 'max_win': 0, 'max_loss': 0})
        continue

    # Run sim
    closes = df_60['close'].tolist()
    ema_fast_arr = ema(closes, FAST)
    ema_slow_arr = ema(closes, SLOW)
    sl_pct = SL_PCT / 100
    tp_pct = TP_PCT / 100
    eod_min = 15 * 60

    trades = []
    in_pos = False
    last_exit = -COOLDOWN - 1
    pos = {}

    for i in range(1, len(closes)):
        ts_ist = df_60.index[i].tz_convert(__import__('datetime').timezone(__import__('datetime').timedelta(hours=5, minutes=30)))
        time_min = ts_ist.hour * 60 + ts_ist.minute
        row = df_60.iloc[i]

        if in_pos:
            sl_hit = row['low'] <= pos['sl']
            tp_hit = row['high'] >= pos['tp']
            if tp_hit:
                exit_p = pos['tp']; reason = '✅ TP'
            elif sl_hit:
                exit_p = pos['sl']; reason = '❌ SL'
            elif time_min >= eod_min:
                exit_p = row['close']; reason = '⏰ EOD'
            else:
                continue
            shares = int(CAPITAL / pos['entry'])
            gp = (exit_p - pos['entry']) * shares
            cs = calc_costs(pos['entry'], exit_p, shares, 'LONG')
            npnl = gp - cs
            trades.append({'entry': pos['entry'], 'exit': exit_p, 'gross_pnl': gp, 'net_pnl': npnl, 'costs': cs, 'reason': reason, 'entry_time': pos['entry_time'], 'exit_time': ts_ist})
            in_pos = False
            last_exit = i
            continue
        if (i - last_exit) < COOLDOWN:
            continue
        if time_min >= eod_min:
            continue
        if ema_fast_arr[i - 1] <= ema_slow_arr[i - 1] and ema_fast_arr[i] > ema_slow_arr[i]:
            entry = float(row['close'])
            pos = {'entry': entry, 'sl': entry * (1 - sl_pct), 'tp': entry * (1 + tp_pct), 'entry_time': ts_ist}
            in_pos = True

    for t in trades:
        t['symbol'] = sym
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
        avg = round(net / n, 2) if n > 0 else 0
        mw = max(t['net_pnl'] for t in wins) if wins else 0
        ml = min(t['net_pnl'] for t in losses) if losses else 0
    else:
        net = sum(t['net_pnl'] for t in trades)
        pf = 0; wr = 0; avg = net if n > 0 else 0; mw = 0; ml = 0

    per_stock.append({
        'symbol': sym, 'price': s['price'], 'atr': s['atr_pct'], 'mcap': s['mcap_cr'],
        'trades': n, 'wins': len([t for t in trades if t['net_pnl'] > 0]),
        'win_rate': wr, 'net_pnl': round(net, 2),
        'profit_factor': pf, 'avg_pnl': avg, 'max_win': mw, 'max_loss': ml,
    })
    print(f"  {sym:<18} {n:3d}t WR={wr:>5.1f}% Net=₹{net:>+9,.0f} PF={pf:<8.4f}", file=sys.stderr)

# --- Aggregate ---
total_trades = len(all_trades)
total_wins = sum(1 for t in all_trades if t['net_pnl'] > 0)
total_net = sum(t['net_pnl'] for t in all_trades)
gw = sum(t['net_pnl'] for t in all_trades if t['net_pnl'] > 0)
gl = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl'] <= 0))
agg_pf = round(gw / gl, 4) if gl > 0 else 99.9999
agg_wr = round(total_wins / total_trades * 100, 1) if total_trades > 0 else 0
tp_exits = sum(1 for t in all_trades if 'TP' in t['reason'])
sl_exits = sum(1 for t in all_trades if 'SL' in t['reason'])
eod_exits = sum(1 for t in all_trades if 'EOD' in t['reason'])
total_costs = sum(t.get('costs', 0) for t in all_trades)
profitable_stocks = sum(1 for s in per_stock if s['profit_factor'] >= 1.0 and s['trades'] >= 2)

# --- Per-Stock P&L Table (sorted by net P&L desc) ---
per_stock.sort(key=lambda x: x['net_pnl'], reverse=True)

print(f"\n{'='*165}")
print(f"  EMA Cross 60-min | SL={SL_PCT}% TP={TP_PCT}% | {DATE_START} to {DATE_END}")
print(f"  Filter: mcap≥{MIN_MCAP_CR}Cr, atr≥{MIN_ATR_PCT}%, price≥{MIN_PRICE}, vol≥{MIN_VOLUME:,}")
print(f"{'='*165}")

print(f"\n{'Rank':<5} {'Symbol':<18} {'Price':>8} {'ATR%':>6} {'MCap(Cr)':>10} {'Trades':>7} {'Wins':>5} {'WR%':>6} "
      f"{'Net P&L':>14} {'PF':>8} {'AvgP&L':>10} {'MaxWin':>10} {'MaxLoss':>10}")
print("-" * 165)

green = '\033[32m'; red = '\033[31m'; reset = '\033[0m'

profitable = 0
total_net_all = 0
for i, s in enumerate(per_stock, 1):
    if s['trades'] < 2:
        print(f"  {i:<3} {s['symbol']:<18} {s['price']:>8.1f} {s['atr']:>5.1f}% {s['mcap']:>9,.0f} "
              f"{'—':>7} {'—':>5} {'—':>6} {'—':>14} {'—':>8} {'—':>10} {'—':>10} {'—':>10}")
        continue

    pf_ok = s['profit_factor'] >= 1.0
    if pf_ok: profitable += 1
    pnl_str = f"₹{s['net_pnl']:>+10,.0f}"
    total_net_all += s['net_pnl']
    wr_str = f"{s['win_rate']:>5.1f}%"
    pf_str = f"{s['profit_factor']:<8.4f}"
    avg_str = f"₹{s['avg_pnl']:>+8,.0f}"
    mw_str = f"₹{s['max_win']:>+8,.0f}"
    ml_str = f"₹{s['max_loss']:>+8,.0f}"

    mark = '✅' if pf_ok else '❌'
    print(f"{mark} {i:<3} {s['symbol']:<18} {s['price']:>8.1f} {s['atr']:>5.1f}% {s['mcap']:>9,.0f} "
          f"{s['trades']:>7} {s['wins']:>5} {wr_str:>6} {pnl_str:>14} {pf_str:>8} {avg_str:>10} {mw_str:>10} {ml_str:>10}")

print("-" * 165)
print(f"\n{'':5} {'TOTAL':<18} {'':8} {'':6} {'':10} {total_trades:>7} {total_wins:>5} {agg_wr:>5.1f}% "
      f"₹{total_net:>+10,.0f}  {agg_pf:<8.4f}  ₹{round(total_net/total_trades, 0) if total_trades > 0 else 0:>+8,.0f} {'':10} {'':10}")
print(f"  TP exits: {tp_exits}  |  SL exits: {sl_exits}  |  EOD exits: {eod_exits}")
print(f"  Total costs: ₹{total_costs:,.2f}")
print(f"  Profitable stocks: {profitable}/{len([s for s in per_stock if s['trades'] >= 2])} ({round(profitable/max(len([s for s in per_stock if s['trades'] >= 2]),1)*100, 1)}%)")
print(f"  Total capital deployed: ₹{total_trades * CAPITAL:,.0f} (notional)")
