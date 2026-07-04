#!/usr/bin/env python3
"""Multi-factor quant moat search.

Stack multiple uncorrelated signals, use ATR-based dynamic SL/TP,
volume confirmation, and cross-sectional ranking.

Signals tested: BB squeeze, RSI momentum, volume surge, ADX trend,
EMA alignment, price acceleration, volatility regime.

Goal: find a combination that beats any single factor.
"""
import sys, os, time, pickle, math
from datetime import timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR); sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))

import numpy as np
import pandas as pd
from market_data.market_data import resample_candles
from experiments.ema_benchmark import calc_costs, ema
from experiments.benchmark_screener_params import load_or_fetch_tv_data, load_or_fetch_candle_data

IST = timezone(timedelta(hours=5, minutes=30))

# --- Signal computation functions ---

def compute_rsi(closes, period=14):
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_g = np.mean(gains[:period])
    avg_l = np.mean(losses[:period])
    rsi = [50] * period
    for i in range(period, len(closes)):
        g = gains[i-1]; l = losses[i-1]
        avg_g = (avg_g * (period-1) + g) / period
        avg_l = (avg_l * (period-1) + l) / period
        rs = avg_g / avg_l if avg_l > 0 else 100
        rsi.append(100 - 100 / (1 + rs))
    return np.array(rsi)

def compute_adx(high, low, close, period=14):
    df = pd.DataFrame({'high': high, 'low': low, 'close': close})
    df['tr'] = np.maximum(df['high'] - df['low'],
                          np.abs(df['high'] - df['close'].shift(1)),
                          np.abs(df['low'] - df['close'].shift(1)))
    df['atr'] = df['tr'].rolling(period).mean()
    df['up'] = df['high'].diff()
    df['down'] = -df['low'].diff()
    df['+dm'] = np.where((df['up'] > df['down']) & (df['up'] > 0), df['up'], 0)
    df['-dm'] = np.where((df['down'] > df['up']) & (df['down'] > 0), df['down'], 0)
    df['+di'] = 100 * df['+dm'].rolling(period).mean() / df['atr']
    df['-di'] = 100 * df['-dm'].rolling(period).mean() / df['atr']
    df['dx'] = 100 * (df['+di'] - df['-di']).abs() / (df['+di'] + df['-di'] + 1e-10)
    df['adx'] = df['dx'].rolling(period * 2).mean()
    return (df['adx'].values, df['atr'].values, df['+di'].values, df['-di'].values)

def bb_width(closes, period=20, num_std=2.0):
    arr = np.array(closes)
    mid = pd.Series(arr).rolling(period).mean().values
    std = pd.Series(arr).rolling(period).std().values
    width = (mid + num_std * std - (mid - num_std * std)) / mid * 100
    return width, mid, std

# --- Main backtest ---

def backtest_multi_factor(closes, highs, lows, volumes, config):
    """
    config = {
        'tf': 60,
        'sl_atr': 1.5,      # SL = sl_atr * ATR
        'tp_atr': 4.0,      # TP = tp_atr * ATR
        'min_score': 2,      # entry threshold
        'volume_filter': True, # only trade if vol > avg vol
        'use_bb': True,
        'use_rsi': True,
        'use_adx': True,
        'use_ema': True,
        'use_mom': True,
        'use_squeeze': True,
    }
    """
    n = len(closes)
    if n < 50: return []

    # Compute all signals
    rsi = compute_rsi(closes, 14)
    adx_raw, atr_raw, pdi_raw, mdi_raw = compute_adx(highs, lows, closes, 14)
    bw, bb_mid, bb_std = bb_width(closes, 20, 2.0)
    ema_f = ema(closes, 1)
    ema_s = ema(closes, 2)

    # Ensure all arrays are same length
    n_min = min(len(closes), len(adx_raw), len(rsi), len(bw))
    closes_a = closes[:n_min]; rsi = rsi[:n_min]; bw = bw[:n_min]
    adx = adx_raw[:n_min]; atr = atr_raw[:n_min]
    pdi = pdi_raw[:n_min]; mdi = mdi_raw[:n_min]
    bb_mid = bb_mid[:n_min]; ema_f = ema_f[:n_min]; ema_s = ema_s[:n_min]
    volumes = volumes[:n_min]
    n = n_min

    # Volume ratio
    vol_arr = np.array(volumes)
    vol_avg = pd.Series(vol_arr).rolling(20).mean().values
    vol_ratio = vol_arr / np.maximum(vol_avg, 1)

    # Momentum
    mom_5 = np.array([closes_a[i]/max(closes_a[i-5], 1e-10)-1 for i in range(n)])
    mom_5[:5] = 0

    # BB squeeze: width percentile
    bw_pct = np.zeros(n)
    for i in range(20, n):
        hist = bw[max(20, i-60):i]
        bw_pct[i] = sum(1 for w in hist if w <= bw[i]) / max(len(hist), 1)

    trades = []; in_pos = False; pos = {}; last_exit = -10
    min_idx = max(30, 14*3)

    for i in range(min_idx, n):
        c = closes_a[i]
        if i >= len(adx) or np.isnan(adx[i]) or np.isnan(rsi[i]) or np.isnan(bw[i]):
            continue

        # --- Compute signal scores ---
        score = 0
        signals = []

        # 1. BB Squeeze breakout
        if config.get('use_squeeze', True) and i > 20 and i < len(bw_pct):
            squeeze_hist = bw[max(20, i-60):i+1]
            released = bw[i] > np.percentile(squeeze_hist, 15) if len(squeeze_hist) > 5 else False
            if bw_pct[i] < 0.15 and released:
                # Squeeze releasing — breakout direction
                if c > bb_mid[i]: score += 1; signals.append('SQZ_L')
                else: score -= 1; signals.append('SQZ_S')

        # 2. RSI momentum
        if config.get('use_rsi', True):
            if rsi[i] > 55 and rsi[i] > rsi[i-1]:
                score += 1; signals.append('RSI_L')
            elif rsi[i] < 45 and rsi[i] < rsi[i-1]:
                score -= 1; signals.append('RSI_S')

        # 3. ADX trend
        if config.get('use_adx', True):
            if adx[i] > 25 and pdi[i] > mdi[i]:
                score += 1; signals.append('ADX_L')
            elif adx[i] > 25 and mdi[i] > pdi[i]:
                score -= 1; signals.append('ADX_S')

        # 4. EMA alignment
        if config.get('use_ema', True):
            if ema_f[i] > ema_s[i] and c > ema_f[i]:
                score += 1; signals.append('EMA_L')
            elif ema_f[i] < ema_s[i] and c < ema_f[i]:
                score -= 1; signals.append('EMA_S')

        # 5. Price momentum
        if config.get('use_mom', True):
            if mom_5[i] > 0.01:
                score += 1; signals.append('MOM_L')
            elif mom_5[i] < -0.01:
                score -= 1; signals.append('MOM_S')

        # --- Entry ---
        if not in_pos:
            if (i - last_exit) < 3: continue

            if config.get('volume_filter', False) and vol_ratio[i] < 0.7:
                continue

            if score >= config.get('min_score', 2):
                sl_price = c - atr[i] * config.get('sl_atr', 1.5) if not np.isnan(atr[i]) and atr[i] > 0 else c * 0.98
                tp_price = c + atr[i] * config.get('tp_atr', 4.0) if not np.isnan(atr[i]) and atr[i] > 0 else c * 1.05
                pos = {'entry': c, 'sl': sl_price, 'tp': tp_price,
                       'side': 'LONG', 'signals': signals[:], 'entry_idx': i}
                in_pos = True
            elif score <= -config.get('min_score', 2):
                sl_price = c + atr[i] * config.get('sl_atr', 1.5) if not np.isnan(atr[i]) and atr[i] > 0 else c * 1.02
                tp_price = c - atr[i] * config.get('tp_atr', 4.0) if not np.isnan(atr[i]) and atr[i] > 0 else c * 0.95
                pos = {'entry': c, 'sl': sl_price, 'tp': tp_price,
                       'side': 'SHORT', 'signals': signals[:], 'entry_idx': i}
                in_pos = True
        else:
            ep = None; reason = None
            if pos['side'] == 'LONG':
                if c >= pos['tp']: ep = pos['tp']; reason = 'TP'
                elif c <= pos['sl']: ep = pos['sl']; reason = 'SL'
            else:
                if c <= pos['tp']: ep = pos['tp']; reason = 'TP'
                elif c >= pos['sl']: ep = pos['sl']; reason = 'SL'
            if ep:
                corr = 1 if pos['side'] == 'LONG' else -1
                gp = corr * (ep - pos['entry']) * int(100000 / pos['entry'])
                cs = calc_costs(pos['entry'], ep, int(100000 / pos['entry']), pos['side'])
                trades.append({'net_pnl': gp - cs, 'reason': reason,
                               'n_signals': len(pos['signals']), 'side': pos['side']})
                in_pos = False; last_exit = i
    return trades

# --- Test different configurations ---

configs = [
    # (name, config)
    ("BB Squeeze only", {'use_bb': True, 'use_squeeze': True, 'use_rsi': False, 'use_adx': False, 'use_ema': False, 'use_mom': False, 'min_score': 1, 'sl_atr': 1.5, 'tp_atr': 4.0, 'volume_filter': False}),
    ("Multi-factor lite", {'use_bb': False, 'use_squeeze': True, 'use_rsi': True, 'use_adx': False, 'use_ema': True, 'use_mom': True, 'min_score': 2, 'sl_atr': 1.5, 'tp_atr': 4.0, 'volume_filter': False}),
    ("Multi-factor full", {'use_bb': False, 'use_squeeze': True, 'use_rsi': True, 'use_adx': True, 'use_ema': True, 'use_mom': True, 'min_score': 3, 'sl_atr': 1.5, 'tp_atr': 4.0, 'volume_filter': False}),
    ("Multi + vol filter", {'use_bb': False, 'use_squeeze': True, 'use_rsi': True, 'use_adx': True, 'use_ema': True, 'use_mom': True, 'min_score': 3, 'sl_atr': 1.5, 'tp_atr': 4.0, 'volume_filter': True}),
    ("High consensus (score>=4)", {'use_bb': False, 'use_squeeze': True, 'use_rsi': True, 'use_adx': True, 'use_ema': True, 'use_mom': True, 'min_score': 4, 'sl_atr': 1.5, 'tp_atr': 4.0, 'volume_filter': True}),
    ("Wide stops", {'use_bb': False, 'use_squeeze': True, 'use_rsi': True, 'use_adx': True, 'use_ema': True, 'use_mom': True, 'min_score': 2, 'sl_atr': 2.0, 'tp_atr': 6.0, 'volume_filter': False}),
    ("Tight stops + vol", {'use_bb': False, 'use_squeeze': True, 'use_rsi': True, 'use_adx': False, 'use_ema': True, 'use_mom': True, 'min_score': 2, 'sl_atr': 1.0, 'tp_atr': 3.0, 'volume_filter': True}),
]

# Load data
print(f"Loading stocks...", file=sys.stderr)
tv = load_or_fetch_tv_data()
symbols = []
for s in tv:
    if float(s['mcap_cr']) >= 2000 and float(s['atr_pct']) >= 1.5:
        symbols.append(s['symbol'])

print(f"Testing {len(symbols)} stocks", file=sys.stderr)
candle_data = load_or_fetch_candle_data(symbols)

print(f"\n{'='*110}")
print(f"  📊 QUANT MOAT SEARCH — Multi-factor signal stacking")
print(f"{'='*110}")
print(f"{'Config':<30} {'Trades':>7} {'WR%':>6} {'PF':>10} {'Net P&L':>12} {'TP':>5} {'SL':>5} {'Sig/Tr':>7}")
print("-" * 110)

results = []

for name, cfg in configs:
    all_trades = []
    for sym in symbols:
        df = candle_data.get(sym)
        if df is None or len(df) < 200: continue
        rdf = resample_candles(df, 60)
        if rdf is None or len(rdf) < 50: continue
        tr = backtest_multi_factor(
            rdf['close'].tolist(), rdf['high'].tolist(),
            rdf['low'].tolist(), rdf['volume'].tolist(), cfg)
        all_trades.extend(tr)

    tt = len(all_trades)
    if tt < 5: continue
    tw = sum(1 for t in all_trades if t['net_pnl'] > 0)
    tn = sum(t['net_pnl'] for t in all_trades)
    gw = sum(t['net_pnl'] for t in all_trades if t['net_pnl'] > 0)
    gl = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl'] <= 0))
    apf = round(gw/gl, 4) if gl > 0 else 99.9999
    awr = round(tw/tt*100, 1) if tt > 0 else 0
    tpn = sum(1 for t in all_trades if t['reason'] == 'TP')
    sln = sum(1 for t in all_trades if t['reason'] == 'SL')
    avg_sig = round(sum(t.get('n_signals', 0) for t in all_trades) / tt, 1) if tt > 0 else 0

    print(f"{name:<30} {tt:>7} {awr:>5.1f}% {apf:>10.4f} ₹{tn:>+9,.0f} {tpn:>5} {sln:>5} {avg_sig:>7}")
    results.append((name, apf, tn, tt))
