"""Small indicator helpers shared by replay engines (no pandas)."""
from __future__ import annotations


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def rsi(closes: list[float], period: int = 14) -> float:
    """Simple RSI over the last ``period`` deltas (0-100)."""
    if len(closes) < period + 1:
        return 0.0
    deltas = [closes[i] - closes[i - 1] for i in range(len(closes) - period, len(closes))]
    gains = sum(d for d in deltas if d > 0) / period
    losses = -sum(d for d in deltas if d < 0) / period
    if losses == 0:
        return 100.0
    rs = gains / losses
    return round(100.0 - 100.0 / (1.0 + rs), 2)


def adx(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float:
    """Smoothed ADX via the canonical generator implementation."""
    from trading.adx_trend_signals import compute_adx

    return compute_adx(highs, lows, closes, period).get("adx", 0.0)


def atr_pct(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float:
    """ATR as a percentage of the latest close."""
    n = min(len(highs), len(lows), len(closes))
    if n < period + 1 or not closes[-1]:
        return 0.0
    trs = []
    for i in range(1, n):
        trs.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    atr = sum(trs[-period:]) / period
    return round(atr / closes[-1] * 100, 2)
