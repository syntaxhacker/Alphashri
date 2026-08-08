#!/usr/bin/env python3
"""NEWGEN intraday benchmark — bb / short / vol strategies (autoresearch session newgen-bb-short-vol).

Self-contained sim runner. Loads the shared NEWGEN cache (read-only) via
experiments.newgen.common, runs ONE strategy sim selected by env var, prints
METRIC lines via common.print_metrics. Each run < 5s.

Env:
  NEWGEN_STRATEGY   bb|short|vol                        (default bb)
  NEWGEN_TF         5|15                                 (default 5)
  NEWGEN_TRADE_SIZE default 100
  NEWGEN_COSTS      1|0 (include round-trip costs)       (default 1)
  NEWGEN_DATE_START / NEWGEN_DATE_END optional IST date filter

  bb:   NEWGEN_BB_MODE   bounce|breakout|squeeze        (default bounce)
        NEWGEN_BB_PERIOD (15/20), NEWGEN_BB_STD (1.5/2.0/2.5)
        NEWGEN_SL (1.0/1.5/2.0), NEWGEN_TP (1.5/2.0/3.0), NEWGEN_EOD (default 885)
        NEWGEN_SQUEEZE_PCTILE (default 0.1)
  short:NEWGEN_SHORT_MODE s1_breakdown|rsi_overbought|breakout_fail|ema_extended
        NEWGEN_SL (1.5/2.0/3.0), NEWGEN_TP (2.0/3.0/4.5)
        NEWGEN_BUFFER (0.1/0.3/0.5), NEWGEN_PIVOT classic|fibonacci
        NEWGEN_EOD (default 915), entry >= 10:00
  vol:  NEWGEN_VOL_MULT (1.5/2.0/3.0), NEWGEN_AVG_PERIOD (10/20)
        NEWGEN_SL (1.0/1.5/2.0), NEWGEN_TP (1.5/2.0/3.0), NEWGEN_EOD (default 885)
"""
import os
import sys
from pathlib import Path

_SRCDIR = str(Path(__file__).resolve().parents[3])
_ROOT = str(Path(__file__).resolve().parents[4])
for _p in (str(Path(__file__).resolve().parents[2]), _SRCDIR, _ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np
import pandas as pd

from experiments.newgen.common import (
    load_newgen, filter_dates, compute_metrics, print_metrics,
    calc_costs, time_in_minutes, IST,
)
from trading.pivot_utils import calculate_pivot_points

MKT_OPEN = 9 * 60 + 15  # 09:15 IST


def _close_trade(trades, side, entry, exit_price, reason, entry_ts, exit_ts, qty, include_costs):
    gross = (exit_price - entry) * qty if side == 'LONG' else (entry - exit_price) * qty
    cost = calc_costs(entry, exit_price, qty, side) if include_costs else 0.0
    trades.append({
        'side': side, 'entry': entry, 'exit': exit_price,
        'gross_pnl': gross, 'costs': cost, 'net_pnl': gross - cost,
        'exit_reason': reason, 'entry_time': entry_ts, 'exit_time': exit_ts,
        'date': str(pd.Timestamp(exit_ts).tz_convert(IST).date()),
    })


# ---------------------------------------------------------------------------
# Strategy 1: Bollinger Bands (close-based entries/exits, intraday-aware)
# ---------------------------------------------------------------------------
def sim_bb(df, mode, period, std, sl_pct, tp_pct, eod_minutes, trade_size, include_costs, squeeze_pctile=0.1):
    df = df.copy()
    df['ist'] = df.index.tz_convert(IST)
    df['tm'] = df['ist'].map(time_in_minutes)
    closes = df['close'].astype(float).values
    n = len(df)
    mid = pd.Series(closes).rolling(period).mean().values
    sd = pd.Series(closes).rolling(period).std().values
    upper = mid + std * sd
    lower = mid - std * sd
    width = (upper - lower) / mid * 100
    thr = None
    if mode == 'squeeze':
        w = width[pd.notna(width)]
        thr = float(np.nanpercentile(w, squeeze_pctile * 100)) if len(w) else 1.0
    sl, tp = sl_pct / 100.0, tp_pct / 100.0
    trades = []
    in_pos = False
    pos = {}
    last_exit = -2
    in_squeeze = False
    squeeze_start = -1
    for i in range(period, n):
        c = closes[i]
        tm = int(df['tm'].iloc[i])
        if in_pos:
            reason = ep = None
            if pos['side'] == 'LONG':
                if c >= pos['tp']:
                    ep, reason = pos['tp'], 'TP'
                elif c <= pos['sl']:
                    ep, reason = pos['sl'], 'SL'
                elif tm >= eod_minutes:
                    ep, reason = c, 'EOD'
            else:
                if c <= pos['tp']:
                    ep, reason = pos['tp'], 'TP'
                elif c >= pos['sl']:
                    ep, reason = pos['sl'], 'SL'
                elif tm >= eod_minutes:
                    ep, reason = c, 'EOD'
            if reason:
                _close_trade(trades, pos['side'], pos['entry'], ep, reason, pos['ts'], df.index[i], trade_size, include_costs)
                in_pos = False
                last_exit = i
                continue
            continue
        if tm < MKT_OPEN or tm >= eod_minutes:
            continue
        if (i - last_exit) < 2:
            continue
        if mode == 'bounce':
            if c <= lower[i] and c >= lower[i] * 0.995:
                pos = {'side': 'LONG', 'entry': c, 'ts': df.index[i], 'sl': c * (1 - sl), 'tp': c * (1 + tp)}
                in_pos = True
                continue
            if c >= upper[i] and c <= upper[i] * 1.005:
                pos = {'side': 'SHORT', 'entry': c, 'ts': df.index[i], 'sl': c * (1 + sl), 'tp': c * (1 - tp)}
                in_pos = True
                continue
        elif mode == 'breakout':
            if c > upper[i]:
                pos = {'side': 'LONG', 'entry': c, 'ts': df.index[i], 'sl': c * (1 - sl), 'tp': c * (1 + tp)}
                in_pos = True
                continue
            if c < lower[i]:
                pos = {'side': 'SHORT', 'entry': c, 'ts': df.index[i], 'sl': c * (1 + sl), 'tp': c * (1 - tp)}
                in_pos = True
                continue
        elif mode == 'squeeze':
            if not in_squeeze:
                if width[i] < thr:
                    in_squeeze = True
                    squeeze_start = i
                continue
            if width[i] > thr and i > squeeze_start + 2:
                if c > mid[i]:
                    pos = {'side': 'LONG', 'entry': c, 'ts': df.index[i], 'sl': c * (1 - sl), 'tp': c * (1 + tp)}
                    in_pos = True
                    in_squeeze = False
                    continue
                elif c < mid[i]:
                    pos = {'side': 'SHORT', 'entry': c, 'ts': df.index[i], 'sl': c * (1 + sl), 'tp': c * (1 - tp)}
                    in_pos = True
                    in_squeeze = False
                    continue
    if in_pos:
        _close_trade(trades, pos['side'], pos['entry'], closes[-1], 'EOD', pos['ts'], df.index[-1], trade_size, include_costs)
    return trades


# ---------------------------------------------------------------------------
# Strategy 2: Short-only (mirrors benchmark_short_multi.py modes)
# ---------------------------------------------------------------------------
def _ema(arr, period):
    return pd.Series(arr).ewm(span=period, adjust=False).mean().values


def _calc_rsi(prices, period=14):
    prices = np.asarray(prices, dtype=float)
    deltas = np.diff(prices)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    rs = avg_gain / avg_loss if avg_loss > 0 else 100.0
    rsi_vals = [50.0] * period
    rsi_vals.append(100.0 - 100.0 / (1.0 + rs) if avg_loss > 0 else 100.0)
    for i in range(period + 1, len(prices)):
        gain = gains[i - 1]
        loss = losses[i - 1]
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        rs = avg_gain / avg_loss if avg_loss > 0 else 100.0
        rsi_vals.append(100.0 - 100.0 / (1.0 + rs) if avg_loss > 0 else 100.0)
    return rsi_vals


def sim_short(df, mode, sl_pct, tp_pct, buffer_pct, pivot_type, eod_minutes, trade_size, include_costs,
              rsi_period=14, rsi_overbought=75.0, rsi_entry=70.0,
              fail_lookback=12, ema_period=20, extend_pct=2.0):
    min_entry = 10 * 60
    cooldown = 30
    df = df.copy()
    df['ist'] = df.index.tz_convert(IST)
    df['tm'] = df['ist'].map(time_in_minutes)
    daily = df.resample('1D').agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'}).dropna()
    dates = [d.date() for d in daily.index]
    sl, tp = sl_pct / 100.0, tp_pct / 100.0
    buf = buffer_pct / 100.0
    trades = []
    for d in range(1, len(dates)):
        prev = daily.iloc[d - 1]
        day_date = dates[d]
        pivot = calculate_pivot_points(float(prev['high']), float(prev['low']), float(prev['close']), pivot_type)
        day = df[df['ist'].dt.date == day_date]
        if len(day) < 5:
            continue
        closes = day['close'].astype(float).values
        highs = day['high'].astype(float).values
        lows = day['low'].astype(float).values
        tms = day['tm'].astype(int).values
        n = len(day)
        rsi_vals = ema_vals = None
        if mode == 'rsi_overbought':
            if n < rsi_period + 5:
                continue
            rsi_vals = _calc_rsi(closes, rsi_period)
        elif mode == 'ema_extended':
            if n < ema_period + 2:
                continue
            ema_vals = _ema(closes, ema_period)
        in_pos = False
        pos = {}
        last_exit = -10 ** 9
        start_i = rsi_period if mode == 'rsi_overbought' else 1
        for i in range(start_i, n):
            tm = int(tms[i])
            c = float(closes[i])
            h = float(highs[i])
            lo = float(lows[i])
            if tm < min_entry:
                continue
            if in_pos:
                if h >= pos['sl']:
                    ep, reason = pos['sl'], 'SL'
                elif lo <= pos['tp']:
                    ep, reason = pos['tp'], 'TP'
                elif tm >= eod_minutes:
                    ep, reason = c, 'EOD'
                else:
                    continue
                _close_trade(trades, 'SHORT', pos['entry'], ep, reason, pos['ts'], day.index[i], trade_size, include_costs)
                in_pos = False
                last_exit = tm
                if tm >= eod_minutes:
                    break
                continue
            if tm >= eod_minutes:
                break
            if (tm - last_exit) < cooldown:
                continue
            entry = tp_target = None
            if mode == 's1_breakdown':
                s1 = pivot.s1
                trig = s1 * (1 - buf)
                if lo <= trig and c <= trig:
                    entry = c
                    s2 = pivot.s2
                    tp_target = s2 if (s2 and s2 < c) else c * (1 - tp)
            elif mode == 'rsi_overbought':
                if i >= 1 and rsi_vals[i - 1] > rsi_overbought and rsi_vals[i] <= rsi_entry:
                    entry = c
                    tp_target = c * (1 - tp)
            elif mode == 'breakout_fail':
                resistance = pivot.r1
                did_break = False
                for j in range(max(1, i - fail_lookback), i + 1):
                    if closes[j - 1] > resistance:
                        did_break = True
                        break
                if did_break and c <= resistance:
                    entry = c
                    tp_target = c * (1 - tp)
            elif mode == 'ema_extended':
                if i >= ema_period and ema_vals[i] and (c - ema_vals[i]) / ema_vals[i] * 100 >= extend_pct:
                    entry = c
                    tp_target = c * (1 - tp)
            if entry is not None:
                pos = {'entry': entry, 'sl': entry * (1 + sl), 'tp': tp_target, 'ts': day.index[i]}
                in_pos = True
    if in_pos:
        _close_trade(trades, 'SHORT', pos['entry'], closes[-1], 'EOD', pos['ts'], day.index[-1], trade_size, include_costs)
    return trades


# ---------------------------------------------------------------------------
# Strategy 3: Volume Surge (long on bar-volume spike, close up)
# ---------------------------------------------------------------------------
def sim_vol(df, vol_mult, avg_period, sl_pct, tp_pct, eod_minutes, trade_size, include_costs):
    df = df.copy()
    df['ist'] = df.index.tz_convert(IST)
    df['tm'] = df['ist'].map(time_in_minutes)
    closes = df['close'].astype(float).values
    highs = df['high'].astype(float).values
    lows = df['low'].astype(float).values
    vols = df['volume'].astype(float).values
    n = len(df)
    avg_vol = pd.Series(vols).rolling(avg_period).mean().shift(1).values
    sl, tp = sl_pct / 100.0, tp_pct / 100.0
    trades = []
    in_pos = False
    pos = {}
    last_exit = -2
    for i in range(avg_period, n):
        c = closes[i]
        tm = int(df['tm'].iloc[i])
        if in_pos:
            if highs[i] >= pos['tp']:
                ep, reason = pos['tp'], 'TP'
            elif lows[i] <= pos['sl']:
                ep, reason = pos['sl'], 'SL'
            elif tm >= eod_minutes:
                ep, reason = c, 'EOD'
            else:
                continue
            _close_trade(trades, 'LONG', pos['entry'], ep, reason, pos['ts'], df.index[i], trade_size, include_costs)
            in_pos = False
            last_exit = i
            continue
        if tm < MKT_OPEN or tm >= eod_minutes:
            continue
        if (i - last_exit) < 1:
            continue
        av = avg_vol[i]
        if not np.isfinite(av) or av <= 0:
            continue
        if vols[i] / av >= vol_mult and c > closes[i - 1]:
            pos = {'side': 'LONG', 'entry': c, 'ts': df.index[i], 'sl': c * (1 - sl), 'tp': c * (1 + tp)}
            in_pos = True
    if in_pos:
        _close_trade(trades, 'LONG', pos['entry'], closes[-1], 'EOD', pos['ts'], df.index[-1], trade_size, include_costs)
    return trades


def main():
    strategy = os.environ.get('NEWGEN_STRATEGY', 'bb')
    tf = int(os.environ.get('NEWGEN_TF', '5'))
    trade_size = int(os.environ.get('NEWGEN_TRADE_SIZE', '100'))
    include_costs = os.environ.get('NEWGEN_COSTS', '1') != '0'

    df = load_newgen(tf)
    ds = os.environ.get('NEWGEN_DATE_START', '')
    de = os.environ.get('NEWGEN_DATE_END', '')
    if ds or de:
        df = filter_dates(df, ds, de)

    if strategy == 'bb':
        mode = os.environ.get('NEWGEN_BB_MODE', 'bounce')
        period = int(os.environ.get('NEWGEN_BB_PERIOD', '20'))
        std = float(os.environ.get('NEWGEN_BB_STD', '2.0'))
        sl = float(os.environ.get('NEWGEN_SL', '1.0'))
        tp = float(os.environ.get('NEWGEN_TP', '1.5'))
        eod = int(os.environ.get('NEWGEN_EOD', '885'))
        sq = float(os.environ.get('NEWGEN_SQUEEZE_PCTILE', '0.1'))
        trades = sim_bb(df, mode, period, std, sl, tp, eod, trade_size, include_costs, sq)
        desc = f'bb:{mode} tf={tf} p={period} std={std} SL={sl} TP={tp} EOD={eod}'
    elif strategy == 'short':
        mode = os.environ.get('NEWGEN_SHORT_MODE', 's1_breakdown')
        sl = float(os.environ.get('NEWGEN_SL', '1.5'))
        tp = float(os.environ.get('NEWGEN_TP', '2.0'))
        buf = float(os.environ.get('NEWGEN_BUFFER', '0.3'))
        piv = os.environ.get('NEWGEN_PIVOT', 'classic')
        eod = int(os.environ.get('NEWGEN_EOD', '915'))
        trades = sim_short(df, mode, sl, tp, buf, piv, eod, trade_size, include_costs)
        desc = f'short:{mode} tf={tf} SL={sl} TP={tp} buf={buf} piv={piv} EOD={eod}'
    elif strategy == 'vol':
        vm = float(os.environ.get('NEWGEN_VOL_MULT', '2.0'))
        ap = int(os.environ.get('NEWGEN_AVG_PERIOD', '20'))
        sl = float(os.environ.get('NEWGEN_SL', '1.0'))
        tp = float(os.environ.get('NEWGEN_TP', '1.5'))
        eod = int(os.environ.get('NEWGEN_EOD', '885'))
        trades = sim_vol(df, vm, ap, sl, tp, eod, trade_size, include_costs)
        desc = f'vol tf={tf} mult={vm} avg={ap} SL={sl} TP={tp} EOD={eod}'
    else:
        print(f"ERROR: unknown NEWGEN_STRATEGY {strategy}", file=sys.stderr)
        sys.exit(1)

    m = compute_metrics(trades)
    print(f"DESC {desc} | trades={m['total_trades']} PF={m['profit_factor']} net={m['net_pnl']} WR={m['win_rate']}% "
          f"TP={m['tp_exits']} SL={m['sl_exits']} EOD={m['eod_exits']}", file=sys.stderr)
    print_metrics(m)


if __name__ == '__main__':
    main()
