"""Latest prices and prior completed-candle closes for the candle-alert tool."""

from dataclasses import dataclass
import time

import pandas as pd
import yfinance

from .config import SYMBOLS


@dataclass(frozen=True)
class Quote:
    label: str
    price: float
    prev_1h: float
    prev_4h: float
    low_1h: float = 0.0
    high_1h: float = 0.0
    low_4h: float = 0.0
    high_4h: float = 0.0


class QuoteFetchError(Exception):
    pass


def change_pair(current: float, previous: float) -> tuple[float, float]:
    absolute = current - previous
    percent = (current / previous - 1) * 100 if previous != 0 else 0.0
    return absolute, percent


def _fetch_one(ticker: str, label: str) -> Quote:
    try:
        df = yfinance.Ticker(ticker).history(
            period="10d", interval="1h", auto_adjust=False
        )
        if df.index.tzinfo is None:
            df = df.tz_localize("UTC")
        else:
            df = df.tz_convert("UTC")

        missing = {"High", "Low"} - set(df.columns)
        if missing:
            raise QuoteFetchError(f"{label}: missing columns {sorted(missing)}")

        close = df["Close"]
        if len(close) < 2:
            raise QuoteFetchError(f"{label}: expected at least 2 1H closes, got {len(close)}")

        high, low = df["High"], df["Low"]
        price = float(close.iloc[-1])
        prev_1h = float(close.iloc[-2])
        prev_1h_high = float(high.iloc[-2])
        prev_1h_low = float(low.iloc[-2])
        # The last 1H bar is the forming candle; its 4H bucket is still open, so
        # exclude everything from that bucket before taking the last closed 4H bar.
        current_4h_bucket = close.index[-1].floor("4h")
        completed = close.index < current_4h_bucket
        resampled = close[completed].resample("4h", label="left", closed="left").last().dropna()
        if resampled.empty:
            raise QuoteFetchError(f"{label}: no 4H values from completed 1H bars")
        prev_4h = float(resampled.iloc[-1])

        prev_4h_high = float(
            high[completed].resample("4h", label="left", closed="left").max().dropna().iloc[-1]
        )
        prev_4h_low = float(
            low[completed].resample("4h", label="left", closed="left").min().dropna().iloc[-1]
        )
    except QuoteFetchError:
        raise
    except Exception as exc:
        raise QuoteFetchError(f"{label}: failed to fetch quote: {exc}") from exc

    return Quote(
        label=label,
        price=price,
        prev_1h=prev_1h,
        prev_4h=prev_4h,
        low_1h=prev_1h_low,
        high_1h=prev_1h_high,
        low_4h=prev_4h_low,
        high_4h=prev_4h_high,
    )


def fetch_quotes(symbols=SYMBOLS) -> dict[str, Quote]:
    return {label: _fetch_one(ticker, label) for label, ticker in symbols}


_cache: dict = {"quotes": {}, "at": 0.0}


def cached_quotes(
    ttl_seconds: float, now: float | None = None, force: bool = False
) -> dict[str, Quote]:
    if now is None:
        now = time.time()
    cached = _cache["quotes"]
    if not force and cached and now - _cache["at"] < ttl_seconds:
        return cached
    quotes = fetch_quotes()
    _cache["quotes"] = quotes
    _cache["at"] = now
    return quotes
