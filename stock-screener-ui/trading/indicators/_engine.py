"""Batch indicator engine — the ONLY place that imports a TA library.

Swapping engines (pandas-ta <-> TA-Lib) is a change to this file alone.

``talib=False`` is passed so results do not silently change depending on whether
the optional TA-Lib C library happens to be installed in the environment.
"""
from __future__ import annotations

import pandas as pd
import pandas_ta as ta


def _call(fn, *args, **kwargs):
    """Call a pandas-ta function with talib disabled when the signature allows it."""
    try:
        return fn(*args, talib=False, **kwargs)
    except TypeError:
        return fn(*args, **kwargs)


def ema(close: pd.Series, length: int) -> pd.Series:
    return _call(ta.ema, close, length=length)


def sma(close: pd.Series, length: int) -> pd.Series:
    return _call(ta.sma, close, length=length)


def rsi(close: pd.Series, length: int = 14) -> pd.Series:
    return _call(ta.rsi, close, length=length)


def adx(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.DataFrame:
    """Returns pandas-ta's ADX frame (columns ADX_/DMP_/DMN_ suffixed with the length)."""
    return _call(ta.adx, high, low, close, length=length)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    return _call(ta.atr, high, low, close, length=length)


def bbands(close: pd.Series, length: int = 20, std: float = 2.0) -> pd.DataFrame:
    return _call(ta.bbands, close, length=length, std=std)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    return _call(ta.macd, close, fast=fast, slow=slow, signal=signal)


def stoch(high: pd.Series, low: pd.Series, close: pd.Series, k: int = 14, d: int = 3, smooth: int = 3) -> pd.DataFrame:
    return _call(ta.stoch, high, low, close, k=k, d=d, smooth_k=smooth)


def supertrend(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 7, multiplier: float = 3.0) -> pd.DataFrame:
    return _call(ta.supertrend, high, low, close, length=length, multiplier=multiplier)


def vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, anchor: str = "D") -> pd.Series:
    return _call(ta.vwap, high, low, close, volume, anchor=anchor)
