#!/usr/bin/env python3
"""Shared backtest primitives.

Mechanics are deliberately conservative:
  * when a bar's range spans both the stop and the target we assume the STOP;
  * entries fill at the close of the trigger bar (bars) or the first tick that
    breaches the level (ticks);
  * round-trip cost = $1 commission + $1 slippage = $2 = 1.0 MNQ point.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

ET = ZoneInfo("America/New_York")
UTC = timezone.utc

MNQ_POINT_VALUE = 2.0
ROUND_TRIP_COST_POINTS = 1.0   # $2 total / $2 per point


@dataclass
class Trade:
    day: str
    side: str            # 'long' | 'short'
    entry_ts: int
    entry: float
    stop: float
    target: float
    exit_ts: int = 0
    exit: float = 0.0
    reason: str = ""
    mae: float = 0.0     # adverse excursion in points (positive number)
    mfe: float = 0.0     # favourable excursion in points
    points: float = 0.0  # gross points (before cost)
    bars_held: int = 0
    rule: str = ""
    extras: dict = field(default_factory=dict)

    @property
    def net_points(self) -> float:
        return self.points - ROUND_TRIP_COST_POINTS

    @property
    def dollars(self) -> float:
        return self.net_points * MNQ_POINT_VALUE


def _pnl(side: str, entry: float, exit: float) -> float:
    return (exit - entry) if side == "long" else (entry - exit)


def simulate_bar_path(side: str, entry: float, stop: float, target: float,
                      bars: list[dict], start_idx: int, day: str,
                      rule: str = "") -> Trade:
    """Walk 1-minute bars after entry; stop takes precedence on ambiguity."""
    t = Trade(day=day, side=side, entry_ts=bars[start_idx]["ts"], entry=entry,
              stop=stop, target=target, rule=rule)
    mae = mfe = 0.0
    for i in range(start_idx + 1, len(bars)):
        b = bars[i]
        hi, lo, cl, ts = b["high"], b["low"], b["close"], b["ts"]
        if side == "long":
            mae = max(mae, entry - lo)
            mfe = max(mfe, hi - entry)
            if lo <= stop:
                t.exit, t.reason, t.exit_ts, t.bars_held = stop, "STOP", ts, i - start_idx
                break
            if hi >= target:
                t.exit, t.reason, t.exit_ts, t.bars_held = target, "TARGET", ts, i - start_idx
                break
        else:
            mae = max(mae, hi - entry)
            mfe = max(mfe, entry - lo)
            if hi >= stop:
                t.exit, t.reason, t.exit_ts, t.bars_held = stop, "STOP", ts, i - start_idx
                break
            if lo <= target:
                t.exit, t.reason, t.exit_ts, t.bars_held = target, "TARGET", ts, i - start_idx
                break
    else:
        last = bars[-1]
        t.exit, t.reason, t.exit_ts, t.bars_held = last["close"], "EOD", last["ts"], len(bars) - 1 - start_idx
    t.mae, t.mfe = mae, mfe
    t.points = _pnl(side, entry, t.exit)
    return t


def ema(values: list[float], period: int) -> list[float]:
    out, k = [], 2 / (period + 1)
    e = None
    for v in values:
        e = v if e is None else v * k + e * (1 - k)
        out.append(e)
    return out


def value_area(profile: dict[float, float], pct: float = 0.70):
    """Return (poc, vah, val) from a {price_bin: volume} profile."""
    if not profile:
        return None, None, None
    items = sorted(profile.items())
    total = sum(v for _, v in items)
    if total <= 0:
        return None, None, None
    poc = max(items, key=lambda kv: kv[1])[0]
    prices = [p for p, _ in items]
    vols = [v for _, v in items]
    pi = prices.index(poc)
    lo_i = hi_i = pi
    acc = vols[pi]
    target = total * pct
    while acc < target and (lo_i > 0 or hi_i < len(prices) - 1):
        up = vols[hi_i + 1] if hi_i < len(prices) - 1 else -1
        dn = vols[lo_i - 1] if lo_i > 0 else -1
        if up >= dn:
            hi_i += 1
            acc += vols[hi_i]
        else:
            lo_i -= 1
            acc += vols[lo_i]
    return poc, prices[hi_i], prices[lo_i]


def summarize(trades: list[Trade], label: str = "") -> dict:
    if not trades:
        return {"label": label, "trades": 0}
    net = np.array([t.net_points for t in trades])
    gross = np.array([t.points for t in trades])
    wins = net[net > 0]
    losses = net[net <= 0]
    equity = np.cumsum(net)
    peak = np.maximum.accumulate(equity)
    dd = float((peak - equity).max()) if len(equity) else 0.0
    return {
        "label": label,
        "trades": len(trades),
        "win_rate": round(len(wins) / len(trades), 3),
        "avg_points": round(float(gross.mean()), 3),
        "avg_net_points": round(float(net.mean()), 3),
        "total_points": round(float(gross.sum()), 2),
        "total_net_points": round(float(net.sum()), 2),
        "total_dollars": round(float(net.sum()) * MNQ_POINT_VALUE, 2),
        "avg_mae": round(float(np.mean([t.mae for t in trades])), 3),
        "avg_mfe": round(float(np.mean([t.mfe for t in trades])), 3),
        "worst_drawdown_points": round(dd, 2),
        "avg_win": round(float(wins.mean()), 2) if len(wins) else 0.0,
        "avg_loss": round(float(losses.mean()), 2) if len(losses) else 0.0,
    }


def per_session_table(trades: list[Trade]) -> list[dict]:
    from collections import defaultdict
    g = defaultdict(list)
    for t in trades:
        g[t.day].append(t)
    out = []
    for day in sorted(g):
        ts = g[day]
        out.append({
            "day": day,
            "trades": len(ts),
            "net_points": round(sum(t.net_points for t in ts), 2),
            "gross_points": round(sum(t.points for t in ts), 2),
            "reasons": ",".join(sorted({t.reason for t in ts})),
        })
    return out


def fmt_ts(ms: int, tz=UTC) -> str:
    from datetime import datetime
    return datetime.fromtimestamp(ms / 1000, tz).strftime("%Y-%m-%d %H:%M")
