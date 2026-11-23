"""TradingView technical fields for the Market Screener.

The scanner is one request per universe, so fields that are not part of the
default table still have to travel in that same scan. Keep the raw TV name and
the shaped row key together here; ``config.COLUMNS`` and ``snapshot._shape_rows``
both consume this mapping, which prevents the two lists from drifting.
"""

from __future__ import annotations

#: Shaped row key -> TradingView scanner column.
EXTRA_FIELDS: dict[str, str] = {
    "ema20": "EMA20",
    "ema50": "EMA50",
    "ema200": "EMA200",
    "vwap": "VWAP",
    "bb_upper": "BB.upper",
    "bb_lower": "BB.lower",
    "macd": "MACD.macd",
    "macd_signal": "MACD.signal",
    "macd_hist": "MACD.hist",
    "stoch_k": "Stoch.K",
    "stoch_d": "Stoch.D",
    "stoch_rsi_k": "Stoch.RSI.K",
    "stoch_rsi_d": "Stoch.RSI.D",
    "cci20": "CCI20",
    "momentum": "Mom",
    "adx_plus": "ADX+DI",
    "adx_minus": "ADX-DI",
    "hull_ma9": "HullMA9",
    "psar": "P.SAR",
    "volatility_d": "Volatility.D",
    "volatility_w": "Volatility.W",
    "perf_3m": "Perf.3M",
    "perf_6m": "Perf.6M",
    "perf_ytd": "Perf.YTD",
    "perf_y": "Perf.Y",
    "recommend_all": "Recommend.All",
    "avg_volume_30d": "average_volume_30d_calc",
}

#: Scanner columns for the extra fields, in the same order as the registry.
EXTRA_COLUMNS: tuple[str, ...] = tuple(EXTRA_FIELDS.values())
