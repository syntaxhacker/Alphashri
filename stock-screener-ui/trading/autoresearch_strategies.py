"""Unified intraday strategy simulators for the autoresearch engine.

Every strategy exposes the same interface:
    simulate_<name>(df: pd.DataFrame, params: dict) -> list[dict]

Each returned trade dict contains:
    symbol, side, entry_price, exit_price, gross_pnl, costs, net_pnl,
    exit_reason ('TP'|'SL'|'EOD'|'MID'|'ST_FLIP'), entry_time, exit_time, date

df must have a tz-aware DatetimeIndex (IST) and open/high/low/close/volume
columns (lowercase) — the format produced by experiments/newgen_data.py /
market_data.market_data.fetch_candles.

Costs use backtest.costs.calculate_trading_costs (single source of truth).
"""
from __future__ import annotations

from datetime import timedelta
from typing import Dict, List

import numpy as np
import pandas as pd

import config as root_config
IST = root_config.IST

from backtest.costs import calculate_trading_costs
from trading.pivot_utils import calculate_pivot_points
from trading.ema_utils import calculate_ema

# Default market windows (IST minutes from midnight)
MKT_OPEN = 9 * 60 + 15       # 09:15
MKT_CLOSE = 15 * 60 + 30     # 15:30
DEFAULT_EOD = 15 * 60        # 15:00
DEFAULT_CAPITAL = 100_000

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _minutes(ts: pd.Timestamp) -> int:
    return ts.hour * 60 + ts.minute


def _costs(entry: float, exit_p: float, qty: int, side: str) -> float:
    return calculate_trading_costs(entry, exit_p, qty, side)['total_costs']


def _trade(symbol: str, side: str, entry: float, exit_p: float, qty: int,
           reason: str, entry_time, exit_time, date, include_costs: bool = True) -> dict:
    gross = (exit_p - entry) * qty if side == "LONG" else (entry - exit_p) * qty
    costs = _costs(entry, exit_p, qty, side) if include_costs else 0.0
    return {
        "symbol": symbol, "side": side,
        "entry_price": round(entry, 2), "exit_price": round(exit_p, 2),
        "gross_pnl": round(gross, 2), "costs": round(costs, 2),
        "net_pnl": round(gross - costs, 2), "exit_reason": reason,
        "entry_time": str(entry_time), "exit_time": str(exit_time),
        "date": str(date),
    }


# ---------------------------------------------------------------------------
# ORB — Opening Range Breakout
# ---------------------------------------------------------------------------
def simulate_orb(df: pd.DataFrame, params: Dict) -> List[dict]:
    or_minutes = int(params.get("or_minutes", 15))
    sl_pct = float(params.get("sl_pct", 1.0))
    tp_pct = float(params.get("tp_pct", 1.5))
    buffer_pct = float(params.get("buffer_pct", 0.3))
    cooldown_bars = int(params.get("cooldown_bars", 1))
    shorts = bool(params.get("shorts", False))
    eod = int(params.get("eod_exit_minutes", DEFAULT_EOD))
    min_entry = int(params.get("min_entry_minutes", 0))
    max_per_day = int(params.get("max_per_day", 0))
    min_or_range = float(params.get("min_or_range_pct", 0.3))
    max_or_range = float(params.get("max_or_range_pct", 5.0))
    capital = float(params.get("capital", DEFAULT_CAPITAL))
    symbol = str(params.get("symbol", getattr(df, "attrs", {}).get("symbol", "?")))
    include_costs = bool(params.get("include_costs", True))

    df = df.copy()
    df["ist_time"] = df.index.map(lambda x: x.tz_convert(IST))
    df["tmin"] = df["ist_time"].map(_minutes)
    or_end = MKT_OPEN + or_minutes
    trades: List[dict] = []
    dates = sorted(set(d.date() for d in df["ist_time"]))

    for date in dates:
        day = df[df["ist_time"].dt.date == date]
        if len(day) < 5:
            continue
        pre = day[(day["tmin"] >= MKT_OPEN) & (day["tmin"] < or_end)]
        post = day[day["tmin"] >= or_end]
        if len(pre) < 1 or len(post) < 1:
            continue
        or_high = pre["high"].max()
        or_low = pre["low"].min()
        if or_low <= 0:
            continue
        or_range_pct = (or_high - or_low) / or_low * 100
        if or_range_pct < min_or_range or or_range_pct > max_or_range:
            continue

        long_entry = or_high * (1 + buffer_pct / 100)
        short_entry = or_low * (1 - buffer_pct / 100)
        day_trades = 0
        last_exit = -cooldown_bars - 1
        pos = None

        for i, (idx, row) in enumerate(post.iterrows()):
            if pos:
                if pos["side"] == "LONG":
                    sl_hit = row["low"] <= pos["sl"]
                    tp_hit = row["high"] >= pos["tp"]
                else:
                    sl_hit = row["high"] >= pos["sl"]
                    tp_hit = row["low"] <= pos["tp"]
                if tp_hit:
                    ep, reason = pos["tp"], "TP"
                elif sl_hit:
                    ep, reason = pos["sl"], "SL"
                elif row["tmin"] >= eod:
                    ep, reason = row["close"], "EOD"
                else:
                    continue
                qty = int(capital / pos["entry"])
                trades.append(_trade(symbol, pos["side"], pos["entry"], ep, qty,
                                     reason, pos["entry_time"], idx, date, include_costs))
                pos = None
                last_exit = i
                day_trades += 1
                if max_per_day > 0 and day_trades >= max_per_day:
                    break
                continue

            if (i - last_exit) < cooldown_bars:
                continue
            if row["tmin"] >= eod:
                continue
            if min_entry > 0 and (row["tmin"] - MKT_OPEN) < min_entry:
                continue
            if shorts and row["close"] < short_entry:
                p = row["close"]
                pos = {"side": "SHORT", "entry": p,
                       "sl": p * (1 + sl_pct / 100), "tp": p * (1 - tp_pct / 100),
                       "entry_time": idx}
            elif row["close"] > long_entry:
                p = row["close"]
                pos = {"side": "LONG", "entry": p,
                       "sl": p * (1 - sl_pct / 100), "tp": p * (1 + tp_pct / 100),
                       "entry_time": idx}
    return trades


# ---------------------------------------------------------------------------
# SR Breakout — pivot R1 breakout
# ---------------------------------------------------------------------------
def simulate_sr_breakout(df: pd.DataFrame, params: Dict) -> List[dict]:
    sl_pct = float(params.get("sl_pct", 2.0))
    tp_pct = float(params.get("tp_pct", 3.0))
    buffer_pct = float(params.get("buffer_pct", 0.1))
    max_dist_pct = float(params.get("max_dist_pct", 5.0))
    pivot_type = str(params.get("pivot_type", "classic"))
    min_entry = int(params.get("min_entry_minutes", 10 * 60))  # 10:00
    eod = int(params.get("eod_exit_minutes", 15 * 60 + 15))
    cooldown_minutes = int(params.get("cooldown_minutes", 30))
    shorts = bool(params.get("shorts", False))
    capital = float(params.get("capital", DEFAULT_CAPITAL))
    symbol = str(params.get("symbol", getattr(df, "attrs", {}).get("symbol", "?")))
    include_costs = bool(params.get("include_costs", True))

    df = df.copy()
    df["ist_time"] = df.index.map(lambda x: x.tz_convert(IST))
    df["tmin"] = df["ist_time"].map(_minutes)
    df_daily = df.resample("1D").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna(subset=["close"])
    dates = sorted(df_daily.index.normalize().unique())
    if len(dates) < 2:
        return []
    date_ohlc = {d.normalize(): {"high": r["high"], "low": r["low"], "close": r["close"]}
                 for d, r in df_daily.iterrows()}

    trades: List[dict] = []
    pos = None
    last_exit = None

    for day_date in dates[1:]:
        prev = date_ohlc.get(dates[dates.index(day_date) - 1])
        if prev is None:
            continue
        pivot = calculate_pivot_points(prev["high"], prev["low"], prev["close"], pivot_type)
        r1, r2 = pivot.r1, pivot.r2
        s1, s2 = pivot.s1, pivot.s2
        buf_trigger = r1 * (1 + buffer_pct / 100)
        max_price = r1 * (1 + max_dist_pct / 100)
        short_trig = s1 * (1 - buffer_pct / 100)

        day_df = df[(df["ist_time"].dt.date == day_date.date())]
        for idx, row in day_df.iterrows():
            ct = row["tmin"]
            if ct < min_entry:
                continue
            if pos and ct >= eod:
                # Close any open position at the EOD close before leaving the day.
                qty = int(capital / pos["entry"])
                trades.append(_trade(symbol, pos["side"], pos["entry"], row["close"], qty,
                                     "EOD", pos["entry_time"], idx, day_date.date(), include_costs))
                pos = None
                last_exit = idx
                break
            if ct >= eod:
                break
            if pos:
                if row["low"] <= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
                elif row["high"] >= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
                else:
                    continue
                qty = int(capital / pos["entry"])
                trades.append(_trade(symbol, pos["side"], pos["entry"], ep, qty,
                                     reason, pos["entry_time"], idx, day_date.date(), include_costs))
                pos = None
                last_exit = idx
                continue

            if last_exit and (idx - last_exit).total_seconds() / 60 < cooldown_minutes:
                continue
            if shorts and row["low"] <= short_trig and row["close"] <= short_trig:
                p = row["close"]
                tp = s2 if s2 and s2 < p else p * (1 - tp_pct / 100)
                pos = {"side": "SHORT", "entry": p,
                       "sl": p * (1 + sl_pct / 100), "tp": tp, "entry_time": idx}
            elif row["high"] >= buf_trigger and row["close"] >= buf_trigger and row["close"] <= max_price:
                p = row["close"]
                tp = r2 if r2 and r2 > p else p * (1 + tp_pct / 100)
                pos = {"side": "LONG", "entry": p,
                       "sl": p * (1 - sl_pct / 100), "tp": tp, "entry_time": idx}
    return trades


# ---------------------------------------------------------------------------
# EMA Cross
# ---------------------------------------------------------------------------
def simulate_ema_cross(df: pd.DataFrame, params: Dict) -> List[dict]:
    fast = int(params.get("ema_fast", 9))
    slow = int(params.get("ema_slow", 21))
    sl_pct = float(params.get("sl_pct", 1.0))
    tp_pct = float(params.get("tp_pct", 1.5))
    shorts = bool(params.get("shorts", False))
    cooldown_bars = int(params.get("cooldown_bars", 3))
    eod = int(params.get("eod_exit_minutes", DEFAULT_EOD))
    capital = float(params.get("capital", DEFAULT_CAPITAL))
    symbol = str(params.get("symbol", getattr(df, "attrs", {}).get("symbol", "?")))
    include_costs = bool(params.get("include_costs", True))

    df = df.copy()
    df["ist_time"] = df.index.map(lambda x: x.tz_convert(IST))
    df["tmin"] = df["ist_time"].map(_minutes)
    closes = df["close"].tolist()
    ema_fast = calculate_ema(closes, fast, return_full=True)
    ema_slow = calculate_ema(closes, slow, return_full=True)

    trades: List[dict] = []
    pos = None
    last_exit = -cooldown_bars - 1
    idxs = df.index.tolist()

    for i in range(max(fast, slow) + 1, len(closes)):
        if ema_fast[i] is None or ema_slow[i] is None:
            continue
        if i >= 1 and (ema_fast[i - 1] is None or ema_slow[i - 1] is None):
            continue
        if df["tmin"].iloc[i] < MKT_OPEN:
            continue
        if df["tmin"].iloc[i] >= eod:
            if pos:
                qty = int(capital / pos["entry"])
                trades.append(_trade(symbol, pos["side"], pos["entry"], closes[i], qty,
                                     "EOD", pos["entry_time"], idxs[i], df["ist_time"].iloc[i].date(), include_costs))
                pos = None
            continue

        c = closes[i]
        crossed_up = ema_fast[i - 1] <= ema_slow[i - 1] and ema_fast[i] > ema_slow[i]
        crossed_dn = ema_fast[i - 1] >= ema_slow[i - 1] and ema_fast[i] < ema_slow[i]

        if pos is None:
            if (i - last_exit) < cooldown_bars:
                continue
            if crossed_up:
                pos = {"side": "LONG", "entry": c,
                       "sl": c * (1 - sl_pct / 100), "tp": c * (1 + tp_pct / 100),
                       "entry_time": idxs[i]}
            elif shorts and crossed_dn:
                pos = {"side": "SHORT", "entry": c,
                       "sl": c * (1 + sl_pct / 100), "tp": c * (1 - tp_pct / 100),
                       "entry_time": idxs[i]}
        else:
            reason = None
            if pos["side"] == "LONG":
                if c >= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
                elif c <= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
                elif crossed_dn:
                    ep, reason = c, "EOD"
            else:
                if c <= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
                elif c >= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
                elif crossed_up:
                    ep, reason = c, "EOD"
            if reason:
                qty = int(capital / pos["entry"])
                trades.append(_trade(symbol, pos["side"], pos["entry"], ep, qty,
                                     reason, pos["entry_time"], idxs[i], df["ist_time"].iloc[i].date(), include_costs))
                pos = None
                last_exit = i
    return trades


# ---------------------------------------------------------------------------
# Supertrend
# ---------------------------------------------------------------------------
def supertrend(high: np.ndarray, low: np.ndarray, close: np.ndarray,
               period: int = 10, multiplier: float = 3.0):
    hi, lo, cl = np.asarray(high, float), np.asarray(low, float), np.asarray(close, float)
    hl2 = (hi + lo) / 2
    tr = np.maximum(hi[1:] - lo[1:], np.abs(hi[1:] - cl[:-1]))
    tr = np.maximum(tr, np.abs(lo[1:] - cl[:-1]))
    tr = np.concatenate([[tr[0]], tr])
    atr = pd.Series(tr).rolling(period).mean().values
    basic_up = hl2 - multiplier * atr
    basic_down = hl2 + multiplier * atr
    st = np.full(len(close), np.nan)
    direction = np.ones(len(close))
    for i in range(period, len(close)):
        if direction[i - 1] == 1:
            if cl[i] < basic_up[i]:
                direction[i] = -1
            else:
                direction[i] = 1
        else:
            if cl[i] > basic_down[i]:
                direction[i] = 1
            else:
                direction[i] = -1
        if direction[i] == 1:
            st[i] = max(basic_up[i], st[i - 1]) if not np.isnan(st[i - 1]) else basic_up[i]
        else:
            st[i] = min(basic_down[i], st[i - 1]) if not np.isnan(st[i - 1]) else basic_down[i]
    return st, direction


def simulate_supertrend(df: pd.DataFrame, params: Dict) -> List[dict]:
    atr_period = int(params.get("atr_period", 10))
    multiplier = float(params.get("multiplier", 3.0))
    sl_pct = float(params.get("sl_pct", 0.0))
    tp_pct = float(params.get("tp_pct", 0.0))
    shorts = bool(params.get("shorts", False))
    eod = int(params.get("eod_exit_minutes", DEFAULT_EOD))
    capital = float(params.get("capital", DEFAULT_CAPITAL))
    symbol = str(params.get("symbol", getattr(df, "attrs", {}).get("symbol", "?")))
    include_costs = bool(params.get("include_costs", True))

    df = df.copy()
    df["ist_time"] = df.index.map(lambda x: x.tz_convert(IST))
    df["tmin"] = df["ist_time"].map(_minutes)
    st, dirs = supertrend(df["high"].values, df["low"].values, df["close"].values,
                          atr_period, multiplier)
    closes = df["close"].tolist()
    idxs = df.index.tolist()
    trades: List[dict] = []
    pos = None
    sl = sl_pct / 100
    tp = tp_pct / 100

    for i in range(atr_period + 5, len(closes)):
        c = closes[i]
        if df["tmin"].iloc[i] < MKT_OPEN:
            continue
        if pos is None:
            if dirs[i] != dirs[i - 1]:
                if dirs[i] == 1:
                    pos = {"side": "LONG", "entry": c,
                           "sl": c * (1 - sl) if sl > 0 else st[i],
                           "tp": c * (1 + tp) if tp > 0 else None,
                           "entry_time": idxs[i]}
                elif shorts and dirs[i] == -1:
                    pos = {"side": "SHORT", "entry": c,
                           "sl": c * (1 + sl) if sl > 0 else st[i],
                           "tp": c * (1 - tp) if tp > 0 else None,
                           "entry_time": idxs[i]}
        else:
            ep, reason = None, None
            if pos["tp"] is not None:
                if pos["side"] == "LONG" and c >= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
                elif pos["side"] == "SHORT" and c <= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
            if ep is None and pos["sl"] is not None:
                if pos["side"] == "LONG" and c <= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
                elif pos["side"] == "SHORT" and c >= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
            if ep is None and dirs[i] != dirs[i - 1]:
                ep, reason = c, "ST_FLIP"
            if ep is None and df["tmin"].iloc[i] >= eod:
                ep, reason = c, "EOD"
            if ep is not None:
                qty = int(capital / pos["entry"])
                trades.append(_trade(symbol, pos["side"], pos["entry"], ep, qty,
                                     reason, pos["entry_time"], idxs[i], df["ist_time"].iloc[i].date(), include_costs))
                pos = None
    return trades


# ---------------------------------------------------------------------------
# Bollinger Bands (bounce / breakout / squeeze)
# ---------------------------------------------------------------------------
def _bb(closes: np.ndarray, period: int = 20, num_std: float = 2.0):
    s = pd.Series(closes)
    mid = s.rolling(period).mean().values
    std = s.rolling(period).std().values
    up = mid + num_std * std
    lo = mid - num_std * std
    width = (up - lo) / mid * 100
    return mid, up, lo, width


def _bb_common(entries, df, params) -> List[dict]:
    """Shared exit logic for BB strategies. entries: list of (i, side) tuples."""
    sl_pct = float(params.get("sl_pct", 2.0))
    tp_pct = float(params.get("tp_pct", 4.0))
    exit_mid = bool(params.get("exit_middle", True))
    eod = int(params.get("eod_exit_minutes", DEFAULT_EOD))
    capital = float(params.get("capital", DEFAULT_CAPITAL))
    include_costs = bool(params.get("include_costs", True))
    symbol = str(params.get("symbol", getattr(df, "attrs", {}).get("symbol", "?")))
    mid = _bb(df["close"].values, int(params.get("bb_period", 20)),
              float(params.get("bb_std", 2.0)))[0]
    closes = df["close"].tolist()
    df2 = df.copy()
    df2["ist_time"] = df2.index.map(lambda x: x.tz_convert(IST))
    df2["tmin"] = df2["ist_time"].map(_minutes)
    idxs = df2.index.tolist()

    trades: List[dict] = []
    last_exit = -999
    pos = None
    for i in range(len(closes)):
        c = closes[i]
        if df2["tmin"].iloc[i] < MKT_OPEN:
            continue
        if pos is None:
            if (i - last_exit) < 2:
                continue
            for (ei, side) in entries:
                if ei == i:
                    pos = {"side": side, "entry": c,
                           "sl": c * (1 - sl_pct / 100) if side == "LONG" else c * (1 + sl_pct / 100),
                           "tp": c * (1 + tp_pct / 100) if side == "LONG" else c * (1 - tp_pct / 100),
                           "entry_time": idxs[i]}
                    break
        else:
            ep, reason = None, None
            if pos["side"] == "LONG":
                if c >= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
                elif c <= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
                elif exit_mid and c >= mid[i]:
                    ep, reason = c, "MID"
            else:
                if c <= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
                elif c >= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
                elif exit_mid and c <= mid[i]:
                    ep, reason = c, "MID"
            if ep is None and df2["tmin"].iloc[i] >= eod:
                ep, reason = c, "EOD"
            if ep is not None:
                qty = int(capital / pos["entry"])
                trades.append(_trade(symbol, pos["side"], pos["entry"], ep, qty,
                                     reason, pos["entry_time"], idxs[i], df2["ist_time"].iloc[i].date(), include_costs))
                pos = None
                last_exit = i
    return trades


def simulate_bollinger(df: pd.DataFrame, params: Dict) -> List[dict]:
    mode = str(params.get("bb_mode", "bounce"))
    period = int(params.get("bb_period", 20))
    num_std = float(params.get("bb_std", 2.0))
    closes = df["close"].values
    mid, up, lo, width = _bb(closes, period, num_std)
    entries: List[tuple] = []

    if mode == "bounce":
        for i in range(period + 2, len(closes)):
            c = closes[i]
            if c <= lo[i] and c >= lo[i] * 0.995:
                entries.append((i, "LONG"))
            elif c >= up[i] and c <= up[i] * 1.005:
                entries.append((i, "SHORT"))
    elif mode == "breakout":
        for i in range(period + 2, len(closes)):
            c = closes[i]
            if c > up[i]:
                entries.append((i, "LONG"))
            elif c < lo[i]:
                entries.append((i, "SHORT"))
    elif mode == "squeeze":
        threshold = np.percentile(width[period:], float(params.get("squeeze_pctile", 0.1)) * 100)
        in_squeeze = False
        squeeze_start = -1
        for i in range(period + 2, len(closes)):
            c = closes[i]
            if not in_squeeze:
                if width[i] < threshold:
                    in_squeeze, squeeze_start = True, i
                continue
            if width[i] > threshold and i > squeeze_start + 2:
                if c > mid[i]:
                    entries.append((i, "LONG"))
                elif c < mid[i]:
                    entries.append((i, "SHORT"))
                in_squeeze = False
    return _bb_common(entries, df, params)


# ---------------------------------------------------------------------------
# Short-only strategies (s1_breakdown / rsi_overbought / breakout_fail / ema_extended)
# ---------------------------------------------------------------------------
def calc_rsi(prices, period: int = 14) -> list:
    deltas = np.diff(prices)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    rsi_vals = [50] * period
    rsi_vals.append(100 - 100 / (1 + avg_gain / avg_loss) if avg_loss > 0 else 100)
    for i in range(period + 1, len(prices)):
        gain, loss = gains[i - 1], losses[i - 1]
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        rsi_vals.append(100 - 100 / (1 + avg_gain / avg_loss) if avg_loss > 0 else 100)
    return rsi_vals


def simulate_short(df: pd.DataFrame, params: Dict) -> List[dict]:
    mode = str(params.get("short_mode", "s1_breakdown"))
    sl_pct = float(params.get("sl_pct", 2.0))
    tp_pct = float(params.get("tp_pct", 4.0))
    buffer_pct = float(params.get("buffer_pct", 0.3))
    pivot_type = str(params.get("pivot_type", "classic"))
    rsi_period = int(params.get("rsi_period", 14))
    rsi_overbought = float(params.get("rsi_overbought", 75))
    rsi_entry = float(params.get("rsi_entry", 70))
    fail_lookback = int(params.get("fail_lookback", 12))
    fail_resistance = str(params.get("fail_resistance", "r1"))
    ema_period = int(params.get("ema_period", 20))
    extend_pct = float(params.get("extend_pct", 2.0))
    min_entry = int(params.get("min_entry_minutes", 10 * 60))
    eod = int(params.get("eod_exit_minutes", 15 * 60 + 15))
    cooldown = int(params.get("cooldown_minutes", 30))
    capital = float(params.get("capital", DEFAULT_CAPITAL))
    symbol = str(params.get("symbol", getattr(df, "attrs", {}).get("symbol", "?")))
    include_costs = bool(params.get("include_costs", True))

    df = df.copy()
    df["ist_time"] = df.index.map(lambda x: x.tz_convert(IST))
    df["tmin"] = df["ist_time"].map(_minutes)
    df_daily = df.resample("1D").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna(subset=["close"])
    dates = sorted(df_daily.index.normalize().unique())
    if len(dates) < 2:
        return []
    ohlc = {d.normalize(): {"high": r["high"], "low": r["low"], "close": r["close"]}
            for d, r in df_daily.iterrows()}

    def _resistance(prev: dict):
        h, l, c = prev["high"], prev["low"], prev["close"]
        if fail_resistance == "prev_high":
            return h
        if fail_resistance == "prev_close":
            return c
        return calculate_pivot_points(h, l, c, "fibonacci").r1

    trades: List[dict] = []
    pos = None
    last_exit = None

    for i in range(1, len(dates)):
        prev = ohlc.get(dates[i - 1])
        if prev is None:
            continue
        day_date = dates[i]
        pivot = calculate_pivot_points(prev["high"], prev["low"], prev["close"], pivot_type)
        resistance = _resistance(prev)
        day_df = df[df["ist_time"].dt.date == day_date.date()]
        if len(day_df) < rsi_period + 5:
            continue
        closes = day_df["close"].tolist()
        highs = day_df["high"].tolist()
        lows = day_df["low"].tolist()
        idxs = day_df.index.tolist()
        rsi_vals = calc_rsi(closes, rsi_period) if mode == "rsi_overbought" else None
        ema_vals = calculate_ema(closes, ema_period, return_full=True) if mode == "ema_extended" else None

        for j in range(rsi_period if mode == "rsi_overbought" else 1, len(closes)):
            c, h, lo = closes[j], highs[j], lows[j]
            ct = day_df["tmin"].iloc[j]
            if ct < min_entry:
                continue
            if ct >= eod:
                break
            if pos is None:
                if last_exit and (idxs[j] - last_exit).total_seconds() / 60 < cooldown:
                    continue
                entry_price = None
                tp = None
                if mode == "s1_breakdown":
                    trig = pivot.s1 * (1 - buffer_pct / 100)
                    if lo <= trig and c <= trig:
                        entry_price = c
                        tp = pivot.s2 if pivot.s2 and pivot.s2 < c else c * (1 - tp_pct / 100)
                elif mode == "rsi_overbought" and rsi_vals:
                    if j >= rsi_period + 1 and rsi_vals[j - 1] > rsi_overbought and rsi_vals[j] <= rsi_entry:
                        entry_price = c
                        tp = c * (1 - tp_pct / 100)
                elif mode == "breakout_fail":
                    did_break = any(closes[k - 1] > resistance for k in range(max(1, j - fail_lookback), j + 1))
                    if did_break and c <= resistance:
                        entry_price = c
                        tp = c * (1 - tp_pct / 100)
                elif mode == "ema_extended" and ema_vals:
                    if j >= ema_period and ema_vals[j]:
                        if (c - ema_vals[j]) / ema_vals[j] * 100 >= extend_pct:
                            entry_price = c
                            tp = c * (1 - tp_pct / 100)
                if entry_price is not None:
                    pos = {"side": "SHORT", "entry": entry_price,
                           "sl": entry_price * (1 + sl_pct / 100), "tp": tp,
                           "entry_time": idxs[j]}
                    continue
            if pos:
                if h >= pos["sl"]:
                    ep, reason = pos["sl"], "SL"
                elif lo <= pos["tp"]:
                    ep, reason = pos["tp"], "TP"
                elif ct >= eod:
                    ep, reason = c, "EOD"
                else:
                    continue
                qty = int(capital / pos["entry"])
                trades.append(_trade(symbol, "SHORT", pos["entry"], ep, qty, reason,
                                     pos["entry_time"], idxs[j], day_date.date(), include_costs))
                pos = None
                last_exit = idxs[j]
    return trades


# ---------------------------------------------------------------------------
# Volume Surge (intraday version — surge bar vs rolling avg volume)
# ---------------------------------------------------------------------------
def simulate_volume_surge(df: pd.DataFrame, params: Dict) -> List[dict]:
    vol_mult = float(params.get("vol_mult", 2.0))
    avg_period = int(params.get("avg_period", 20))
    sl_pct = float(params.get("sl_pct", 1.5))
    tp_pct = float(params.get("tp_pct", 2.0))
    eod = int(params.get("eod_exit_minutes", DEFAULT_EOD))
    capital = float(params.get("capital", DEFAULT_CAPITAL))
    symbol = str(params.get("symbol", getattr(df, "attrs", {}).get("symbol", "?")))
    include_costs = bool(params.get("include_costs", True))

    df = df.copy()
    df["ist_time"] = df.index.map(lambda x: x.tz_convert(IST))
    df["tmin"] = df["ist_time"].map(_minutes)
    vol = df["volume"].rolling(avg_period, min_periods=avg_period // 2).mean().shift(1)
    closes = df["close"].tolist()
    idxs = df.index.tolist()

    trades: List[dict] = []
    pos = None
    for i in range(avg_period + 1, len(closes)):
        if df["tmin"].iloc[i] < MKT_OPEN:
            continue
        c = closes[i]
        if pos is None:
            avgv = vol.iloc[i]
            if avgv and avgv > 0 and df["volume"].iloc[i] >= vol_mult * avgv and c > closes[i - 1]:
                pos = {"side": "LONG", "entry": c,
                       "sl": c * (1 - sl_pct / 100), "tp": c * (1 + tp_pct / 100),
                       "entry_time": idxs[i]}
        else:
            ep, reason = None, None
            if c >= pos["tp"]:
                ep, reason = pos["tp"], "TP"
            elif c <= pos["sl"]:
                ep, reason = pos["sl"], "SL"
            elif df["tmin"].iloc[i] >= eod:
                ep, reason = c, "EOD"
            if ep is not None:
                qty = int(capital / pos["entry"])
                trades.append(_trade(symbol, "LONG", pos["entry"], ep, qty, reason,
                                     pos["entry_time"], idxs[i], df["ist_time"].iloc[i].date(), include_costs))
                pos = None
    return trades


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
STRATEGY_SIMS = {
    "orb": simulate_orb,
    "sr_breakout": simulate_sr_breakout,
    "ema_cross": simulate_ema_cross,
    "supertrend": simulate_supertrend,
    "bollinger": simulate_bollinger,
    "short": simulate_short,
    "volume_surge": simulate_volume_surge,
}

STRATEGY_PARAMS: Dict[str, List[dict]] = {
    "orb": [
        {"key": "or_minutes", "label": "OR period (min)", "type": "number", "default": 15, "min": 5, "max": 120, "step": 5},
        {"key": "sl_pct", "label": "SL %", "type": "number", "default": 1.0, "min": 0.1, "max": 5.0, "step": 0.1},
        {"key": "tp_pct", "label": "TP % (0=none)", "type": "number", "default": 1.5, "min": 0.0, "max": 10.0, "step": 0.1},
        {"key": "buffer_pct", "label": "Buffer %", "type": "number", "default": 0.3, "min": 0.0, "max": 2.0, "step": 0.05},
        {"key": "cooldown_bars", "label": "Cooldown (bars)", "type": "number", "default": 1, "min": 0, "max": 10, "step": 1},
        {"key": "shorts", "label": "Shorts", "type": "boolean", "default": False},
        {"key": "eod_exit_minutes", "label": "EOD exit (min from mid)", "type": "number", "default": DEFAULT_EOD, "min": 780, "max": 930, "step": 15},
        {"key": "min_or_range_pct", "label": "Min OR range %", "type": "number", "default": 0.3, "min": 0.0, "max": 5.0, "step": 0.1},
        {"key": "max_or_range_pct", "label": "Max OR range %", "type": "number", "default": 5.0, "min": 1.0, "max": 20.0, "step": 0.5},
    ],
    "sr_breakout": [
        {"key": "pivot_type", "label": "Pivot type", "type": "select", "default": "classic", "options": ["classic", "fibonacci", "camarilla"]},
        {"key": "sl_pct", "label": "SL %", "type": "number", "default": 2.0, "min": 0.5, "max": 6.0, "step": 0.5},
        {"key": "tp_pct", "label": "TP %", "type": "number", "default": 3.0, "min": 1.0, "max": 8.0, "step": 0.5},
        {"key": "buffer_pct", "label": "Breakout buffer %", "type": "number", "default": 0.1, "min": 0.0, "max": 2.0, "step": 0.1},
        {"key": "max_dist_pct", "label": "Max dist from R1 %", "type": "number", "default": 5.0, "min": 1.0, "max": 15.0, "step": 0.5},
        {"key": "min_entry_minutes", "label": "Min entry (min from mid)", "type": "number", "default": 600, "min": 555, "max": 720, "step": 15},
        {"key": "cooldown_minutes", "label": "Cooldown (min)", "type": "number", "default": 30, "min": 0, "max": 120, "step": 15},
        {"key": "shorts", "label": "Shorts (S1 breakdown)", "type": "boolean", "default": False},
    ],
    "ema_cross": [
        {"key": "ema_fast", "label": "Fast EMA", "type": "number", "default": 9, "min": 2, "max": 50, "step": 1},
        {"key": "ema_slow", "label": "Slow EMA", "type": "number", "default": 21, "min": 5, "max": 100, "step": 1},
        {"key": "sl_pct", "label": "SL %", "type": "number", "default": 1.0, "min": 0.1, "max": 5.0, "step": 0.1},
        {"key": "tp_pct", "label": "TP %", "type": "number", "default": 1.5, "min": 0.1, "max": 5.0, "step": 0.1},
        {"key": "cooldown_bars", "label": "Cooldown (bars)", "type": "number", "default": 3, "min": 0, "max": 10, "step": 1},
        {"key": "shorts", "label": "Shorts", "type": "boolean", "default": False},
    ],
    "supertrend": [
        {"key": "atr_period", "label": "ATR period", "type": "number", "default": 10, "min": 5, "max": 40, "step": 1},
        {"key": "multiplier", "label": "ATR multiplier", "type": "number", "default": 3.0, "min": 0.5, "max": 6.0, "step": 0.5},
        {"key": "sl_pct", "label": "Fixed SL % (0=flip)", "type": "number", "default": 0.0, "min": 0.0, "max": 5.0, "step": 0.5},
        {"key": "tp_pct", "label": "Fixed TP % (0=flip)", "type": "number", "default": 0.0, "min": 0.0, "max": 8.0, "step": 0.5},
        {"key": "shorts", "label": "Shorts", "type": "boolean", "default": False},
    ],
    "bollinger": [
        {"key": "bb_mode", "label": "Mode", "type": "select", "default": "bounce", "options": ["bounce", "breakout", "squeeze"]},
        {"key": "bb_period", "label": "Period", "type": "number", "default": 20, "min": 10, "max": 60, "step": 1},
        {"key": "bb_std", "label": "Std dev", "type": "number", "default": 2.0, "min": 1.0, "max": 3.5, "step": 0.1},
        {"key": "sl_pct", "label": "SL %", "type": "number", "default": 2.0, "min": 0.5, "max": 5.0, "step": 0.5},
        {"key": "tp_pct", "label": "TP %", "type": "number", "default": 4.0, "min": 1.0, "max": 8.0, "step": 0.5},
    ],
    "short": [
        {"key": "short_mode", "label": "Mode", "type": "select", "default": "s1_breakdown",
         "options": ["s1_breakdown", "rsi_overbought", "breakout_fail", "ema_extended"]},
        {"key": "sl_pct", "label": "SL %", "type": "number", "default": 2.0, "min": 0.5, "max": 6.0, "step": 0.5},
        {"key": "tp_pct", "label": "TP %", "type": "number", "default": 4.0, "min": 1.0, "max": 8.0, "step": 0.5},
        {"key": "buffer_pct", "label": "Breakout buffer %", "type": "number", "default": 0.3, "min": 0.0, "max": 2.0, "step": 0.1},
        {"key": "pivot_type", "label": "Pivot type", "type": "select", "default": "classic", "options": ["classic", "fibonacci", "camarilla"]},
        {"key": "rsi_overbought", "label": "RSI overbought", "type": "number", "default": 75, "min": 60, "max": 90, "step": 5},
        {"key": "rsi_entry", "label": "RSI entry", "type": "number", "default": 70, "min": 50, "max": 85, "step": 5},
        {"key": "fail_lookback", "label": "Breakout-fail lookback", "type": "number", "default": 12, "min": 3, "max": 30, "step": 1},
        {"key": "extend_pct", "label": "EMA-extend %", "type": "number", "default": 2.0, "min": 0.5, "max": 10.0, "step": 0.5},
    ],
    "volume_surge": [
        {"key": "vol_mult", "label": "Volume multiple", "type": "number", "default": 2.0, "min": 1.2, "max": 5.0, "step": 0.1},
        {"key": "avg_period", "label": "Avg volume period", "type": "number", "default": 20, "min": 5, "max": 60, "step": 1},
        {"key": "sl_pct", "label": "SL %", "type": "number", "default": 1.5, "min": 0.5, "max": 5.0, "step": 0.5},
        {"key": "tp_pct", "label": "TP %", "type": "number", "default": 2.0, "min": 0.5, "max": 6.0, "step": 0.5},
    ],
}


def get_strategy_defaults(strategy: str) -> Dict:
    return {p["key"]: p["default"] for p in STRATEGY_PARAMS.get(strategy, [])}


def get_strategy_params(strategy: str) -> List[dict]:
    return STRATEGY_PARAMS.get(strategy, [])
