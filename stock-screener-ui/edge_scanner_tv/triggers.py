"""Pure-function intraday triggers (edge-scanner trigger_catalog idioms).

Each trigger takes a small explicit state bundle and returns an Alert or None.
No I/O, no globals — every function is unit-testable with synthetic bars.

State model (per symbol, owned by scanner.py):
    bars:   list of 1-min bar dicts (oldest → newest)
    daily:  dict with prior_high/prior_low/prior_close/atr (from warmup)
    extra:  dict with session_high/session_low/orb_high/orb_low/vwap/av/prev_ema...
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Alert:
    symbol: str
    setup: str
    direction: str  # 'long' | 'short'
    price: float
    why: str


def _last(bars: list[dict]) -> dict | None:
    return bars[-1] if bars else None


def ema(values: list[float], period: int) -> float | None:
    if len(values) < period or period <= 0:
        return None
    k = 2.0 / (period + 1)
    e = sum(values[:period]) / period
    for v in values[period:]:
        e = v * k + e * (1 - k)
    return e


def session_vwap(bars: list[dict]) -> float | None:
    """Cumulative typical-price VWAP over the session bars."""
    num = den = 0.0
    for b in bars:
        tp = (b["high"] + b["low"] + b["close"]) / 3.0
        v = max(float(b.get("volume", 0) or 0), 0.0)
        num += tp * v
        den += v
    if den <= 0:
        closes = [b["close"] for b in bars if b.get("close")]
        return sum(closes) / len(closes) if closes else None
    return num / den


def trigger_hod_breakout(bars: list[dict], direction: str = "long") -> Alert | None:
    """New session high (long) / low (short) on the latest closed bar."""
    if len(bars) < 2:
        return None
    prev, cur = bars[-2], bars[-1]
    if direction == "long":
        prior = max(b["high"] for b in bars[:-1])
        if cur["high"] > prior:
            return Alert(cur["symbol"], "hod_breakout", "long", cur["close"],
                         f"high {cur['high']:.2f} > prior HOD {prior:.2f}")
    else:
        prior = min(b["low"] for b in bars[:-1])
        if cur["low"] < prior:
            return Alert(cur["symbol"], "lod_breakdown", "short", cur["close"],
                         f"low {cur['low']:.2f} < prior LOD {prior:.2f}")
    return None


def trigger_vwap(bars: list[dict], lookback: int = 3) -> Alert | None:
    """VWAP cross on the latest bar with `lookback` bars of prior confirmation."""
    if len(bars) < lookback + 1:
        return None
    vwap = session_vwap(bars)
    if not vwap:
        return None
    cur = bars[-1]
    prior = bars[-(lookback + 1):-1]
    if all(b["close"] < vwap for b in prior) and cur["close"] > vwap:
        return Alert(cur["symbol"], "vwap_reclaim", "long", cur["close"],
                     f"reclaimed VWAP {vwap:.2f}")
    if all(b["close"] > vwap for b in prior) and cur["close"] < vwap:
        return Alert(cur["symbol"], "vwap_reject", "short", cur["close"],
                     f"lost VWAP {vwap:.2f}")
    return None


def trigger_ema_cross(bars: list[dict], fast: int = 3, slow: int = 9) -> Alert | None:
    """Fast/slow EMA cross between the last two bars."""
    closes = [b["close"] for b in bars]
    if len(closes) < slow + 1:
        return None
    f_now, s_now = ema(closes, fast), ema(closes, slow)
    f_prev, s_prev = ema(closes[:-1], fast), ema(closes[:-1], slow)
    if None in (f_now, s_now, f_prev, s_prev):
        return None
    cur = bars[-1]
    if f_prev <= s_prev and f_now > s_now:
        return Alert(cur["symbol"], f"ema{fast}_{slow}_bull", "long", cur["close"],
                     f"EMA{fast} {f_now:.2f} crossed above EMA{slow} {s_now:.2f}")
    if f_prev >= s_prev and f_now < s_now:
        return Alert(cur["symbol"], f"ema{fast}_{slow}_bear", "short", cur["close"],
                     f"EMA{fast} {f_now:.2f} crossed below EMA{slow} {s_now:.2f}")
    return None


def trigger_orb(bars: list[dict], or_minutes: int = 15,
                bars_per_min: int = 1) -> Alert | None:
    """Opening-range breakout: latest close outside the first `or_minutes` range."""
    n = or_minutes * bars_per_min
    if len(bars) <= n:
        return None
    orb = bars[:n]
    cur = bars[-1]
    orb_high = max(b["high"] for b in orb)
    orb_low = min(b["low"] for b in orb)
    if cur["close"] > orb_high:
        return Alert(cur["symbol"], f"orb{or_minutes}_breakout", "long", cur["close"],
                     f"close {cur['close']:.2f} > ORH {orb_high:.2f}")
    if cur["close"] < orb_low:
        return Alert(cur["symbol"], f"orb{or_minutes}_breakdown", "short", cur["close"],
                     f"close {cur['close']:.2f} < ORL {orb_low:.2f}")
    return None


def trigger_momentum(bars: list[dict], window: int = 5,
                     min_move_pct: float = 1.0, min_rvol: float = 1.0,
                     avg_vol: float = 0.0) -> Alert | None:
    """Window momentum: % move over last `window` bars + optional RVOL gate."""
    if len(bars) < window + 1:
        return None
    cur = bars[-1]
    base = bars[-(window + 1)]["close"]
    if not base:
        return None
    move = (cur["close"] / base - 1) * 100
    rvol = None
    if avg_vol > 0:
        win_vol = sum(b.get("volume", 0) or 0 for b in bars[-window:])
        rvol = win_vol / (avg_vol * window)
        if rvol < min_rvol:
            return None
    if move >= min_move_pct:
        why = f"+{move:.2f}% in {window} bars" + (f", rvol {rvol:.1f}x" if rvol else "")
        return Alert(cur["symbol"], f"momentum_{window}m", "long", cur["close"], why)
    if move <= -min_move_pct:
        why = f"{move:.2f}% in {window} bars" + (f", rvol {rvol:.1f}x" if rvol else "")
        return Alert(cur["symbol"], f"momentum_{window}m", "short", cur["close"], why)
    return None


def trigger_rvol_spike(bars: list[dict], avg_vol: float,
                       factor: float = 2.0) -> Alert | None:
    """Latest bar volume >= factor × per-bar average (edge-scanner rvol gate)."""
    if avg_vol <= 0 or not bars:
        return None
    cur = bars[-1]
    if (cur.get("volume", 0) or 0) >= avg_vol * factor:
        direction = "long" if cur["close"] >= cur["open"] else "short"
        return Alert(cur["symbol"], "rvol_spike", direction, cur["close"],
                     f"vol {cur['volume']:.0f} >= {factor}x avg {avg_vol:.0f}")
    return None


SETUPS: dict[str, str] = {
    "breakout": "hod_breakout",
    "52w": "near_52w_high",
    "vwap": "vwap_reclaim/reject",
    "ema": "ema3_9_cross",
    "orb": "orb15_breakout",
    "momentum": "momentum_5m",
    "rvol": "rvol_spike",
}

# Trigger names (what a trigger/snapshot branch actually emits) -> the setup
# group code the dashboard filters and lists as a system setup. Kept here so
# scanner.py and the server share one mapping.
_SETUP_GROUPS: dict[str, str] = {
    "hod_breakout": "breakout",
    "lod_breakdown": "breakout",
    "near_52w_high": "52w",
    "near_52w_low": "52w",
    "vwap_reclaim": "vwap",
    "vwap_reject": "vwap",
    "above_vwap_proxy": "vwap",
    "rvol_spike": "rvol",
    "momentum_day": "momentum",
}


def setup_group(setup: str) -> str:
    """Map a concrete trigger name to its system setup-group code.

    ``hod_breakout`` -> ``breakout``, ``near_52w_high`` -> ``52w``,
    ``ema3_9_bull`` -> ``ema``, ``orb15_breakout`` -> ``orb``,
    ``momentum_5m`` -> ``momentum`` … so a dashboard whose filters are the
    group codes matches the alerts. Unknown names pass through unchanged.
    """
    s = (setup or "").lower()
    if s in _SETUP_GROUPS:
        return _SETUP_GROUPS[s]
    if s.startswith("ema"):
        return "ema"
    if s.startswith("orb"):
        return "orb"
    if s.startswith("momentum"):
        return "momentum"
    if s.startswith("vwap"):
        return "vwap"
    if s.startswith("rvol"):
        return "rvol"
    if "52w" in s:
        return "52w"
    if "breakout" in s or "breakdown" in s or "hod" in s or "lod" in s:
        return "breakout"
    return s or "unknown"
