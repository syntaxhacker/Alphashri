"""Yahoo (yfinance) candles for US stocks. Unofficial; internal display only."""

from __future__ import annotations

import pandas as pd
import yfinance as yf

from .base import ProviderNoData, normalize_ohlcv
from .symbol_map import normalize_us_symbol

US_SESSION_TZ = "America/New_York"
# Yahoo serves at most 8 days of 1m bars per request; 5d stays inside that cap.
MAX_1M_DAYS = 8

# timeframe -> (yfinance interval, period)
TIMEFRAMES: dict[str, tuple[str, str]] = {
    "1m": ("1m", "5d"),
    "5m": ("5m", "5d"),
    "15m": ("15m", "1mo"),
    "1h": ("1h", "3mo"),
    "1D": ("1d", "1y"),
}


class YahooProvider:
    market = "usa"
    feed = "yahoo"
    delay_label = "~1 min (forming)"

    def __init__(self, *, drop_forming: bool = True) -> None:
        self.drop_forming = drop_forming

    def candles(self, symbol: str, timeframe: str) -> pd.DataFrame:
        tf = str(timeframe).strip()
        spec = TIMEFRAMES.get(tf)
        if spec is None:
            raise ProviderNoData(f"unsupported timeframe: {timeframe}")
        interval, period = spec
        vendor_symbol = str(normalize_us_symbol(symbol))

        try:
            raw = yf.Ticker(vendor_symbol).history(
                interval=interval,
                period=period,
                auto_adjust=True,
                prepost=False,
                actions=False,
            )
        except Exception as exc:
            raise ProviderNoData(f"Yahoo history failed for {vendor_symbol}: {exc}") from exc

        df = normalize_ohlcv(raw, session_tz=US_SESSION_TZ)

        partial = False
        if tf == "1m" and not df.empty:
            last = df.iloc[-1]
            ohlc = [last[col] for col in ("open", "high", "low", "close")]
            partial = (
                float(last["volume"]) == 0.0
                and all(pd.notna(value) for value in ohlc)
                and len({float(value) for value in ohlc}) == 1
            )

        dropped = bool(partial and self.drop_forming)
        if dropped:
            df = df.iloc[:-1].copy()
        df.attrs["partial_last"] = partial
        df.attrs["forming_dropped"] = dropped
        if df.empty:
            raise ProviderNoData(f"Yahoo returned only a forming bar for {vendor_symbol}")
        return df

    def quote(self, symbol: str) -> dict | None:
        # v1 charts only need candles; no reliable unauthenticated Yahoo quote.
        return None
