"""Shared contract and normalization for market-data candle providers."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import pandas as pd

OHLCV = ("open", "high", "low", "close", "volume")


class ProviderNoData(Exception):
    """No usable candles for the requested symbol/timeframe.

    Distinct from a generic exception so callers can map it to a clean 502
    instead of leaking an upstream (Yahoo/Upstox) error as a 500.

    ``kind`` is the neutral discriminator the chart route reads: a plain
    no-data signal stays ``"no_data"`` while auth/rate-limit subclasses of
    this base override it so the route can map them to 502/429.
    """

    kind = "no_data"


@runtime_checkable
class MarketDataProvider(Protocol):
    market: str
    feed: str
    delay_label: str

    def candles(self, symbol: str, timeframe: str) -> pd.DataFrame: ...

    def quote(self, symbol: str) -> dict | None: ...


def normalize_ohlcv(
    df: pd.DataFrame | None,
    *,
    session_tz: str = "America/New_York",
) -> pd.DataFrame:
    """Return a clean UTC OHLCV frame or raise :class:`ProviderNoData`.

    Flattens defensive MultiIndex columns, lowercases names, coerces to
    numeric, drops NaN-OHLC rows, localizes a naive index with ``session_tz``
    (US data must not be pinned to IST), then sorts and de-duplicates.
    """
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        raise ProviderNoData("empty candle frame")

    out = df.copy()
    out.columns = [
        str(col[0]).strip() if isinstance(col, tuple) else str(col).strip()
        for col in out.columns
    ]
    out.columns = [str(col).lower() for col in out.columns]

    if any(col not in out.columns for col in OHLCV):
        raise ProviderNoData("candle frame missing OHLCV columns")
    out = out[list(OHLCV)].copy()

    for col in OHLCV:
        out[col] = pd.to_numeric(out[col], errors="coerce")
    out = out.dropna(subset=["open", "high", "low", "close"])
    out["volume"] = out["volume"].fillna(0)

    index = pd.to_datetime(out.index, errors="coerce")
    if getattr(index, "tz", None) is None:
        # DST gap/overlap never touches US cash hours, but coerce to NaT
        # rather than raise on an ambiguous timestamp.
        index = index.tz_localize(session_tz, ambiguous="NaT", nonexistent="NaT")
    out.index = index.tz_convert("UTC")
    out = out[~out.index.isna()]

    out = out.sort_index()
    out = out[~out.index.duplicated(keep="last")]
    if out.empty:
        raise ProviderNoData("no usable candle rows")
    return out
