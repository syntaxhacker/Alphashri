"""Single source of truth for technical indicators.

Public API (import from here, never from the family modules):

    from trading.indicators import ema, rsi, adx, adx_di, atr, atr_pct, bbands

Input contract: pass a ``pandas.Series`` to get a Series back; pass a sequence of
floats to get the latest ``float`` (or a list when ``full=True``).

Engine: ``_engine`` (pandas-ta, TA-Lib disabled) — the only file to touch when
swapping the underlying library. Streaming callers should use ``_stream``.
"""
from .momentum import macd, rsi, rsi_wilder, stoch
from .strength import adx, adx_di
from .trend import ema, ema_first_close, ema_sma_seed, sma
from .volatility import (DEFAULT_ATR_PERIOD, atr, atr_first_bar, atr_mean_range,
                         atr_mean_true_range, atr_pct, bbands, supertrend)
from .volume import vwap

__all__ = [
    "ema",
    "ema_sma_seed",
    "ema_first_close",
    "sma",
    "rsi",
    "rsi_wilder",
    "macd",
    "stoch",
    "adx",
    "adx_di",
    "atr",
    "DEFAULT_ATR_PERIOD",
    "atr_first_bar",
    "atr_mean_range",
    "atr_mean_true_range",
    "atr_pct",
    "bbands",
    "supertrend",
    "vwap",
]
