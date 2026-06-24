"""Replay Data Provider - Replaces Upstox API with pre-loaded historical data for replay mode.

Duck-typed replacement for `upstox_api` with the same two methods the runner calls:
- fetch_intraday_data_v3(symbol, interval) -> Optional[pd.DataFrame]
- fetch_historical_data_v3(symbol, unit, interval, to_date, from_date, ...) -> Optional[pd.DataFrame]
"""

from datetime import datetime, timedelta
from typing import Optional

import pandas as pd

from trading.timezone import IST
from market_data.market_data import fetch_candles, resample_candles
MKT_OPEN = 9 * 60 + 15
MKT_CLOSE = 15 * 60 + 30


class ReplayDataProvider:

    def __init__(
        self,
        date_str: str,
        symbols: list[str],
        get_current_time_fn,
        api_client=None,
        verbose: bool = False,
    ):
        self._date_str = date_str
        self._symbols = symbols
        self._get_time = get_current_time_fn
        self._verbose = verbose

        self._1m_data: dict[str, pd.DataFrame] = {}
        self._daily_data: dict[str, pd.DataFrame] = {}
        self._1m_seed_data: dict[str, pd.DataFrame] = {}

        self._load_data(api_client)

    def _load_data(self, api_client=None):
        if self._verbose:
            print(f"[ReplayDataProvider] Loading data for {self._date_str}...")

        to_date_1m = (pd.Timestamp(self._date_str, tz=IST) + timedelta(days=1)).strftime("%Y-%m-%d")
        seed_from = (pd.Timestamp(self._date_str, tz=IST) - timedelta(days=10)).strftime("%Y-%m-%d")

        for sym in self._symbols:
            df_1m_full = fetch_candles(
                symbol=sym, tf=1,
                from_date=seed_from, to_date=to_date_1m,
                api_client=api_client,
            )
            if df_1m_full is not None and not df_1m_full.empty:
                replay_start = pd.Timestamp(self._date_str, tz=IST).tz_convert('UTC')
                replay_end = replay_start + timedelta(days=1)
                df_seed = df_1m_full[df_1m_full.index < replay_start]
                if not df_seed.empty:
                    self._1m_seed_data[sym] = df_seed
                df_1m = df_1m_full[(df_1m_full.index >= replay_start) & (df_1m_full.index < replay_end)]
                if not df_1m.empty:
                    self._1m_data[sym] = df_1m

            from_date = (pd.Timestamp(self._date_str, tz=IST) - timedelta(days=450)).strftime("%Y-%m-%d")
            df_daily = fetch_candles(
                symbol=sym, tf=1440,
                from_date=from_date, to_date=self._date_str,
                api_client=api_client,
            )
            if df_daily is not None and not df_daily.empty:
                self._daily_data[sym] = df_daily

        if self._verbose:
            print(f"[ReplayDataProvider] Loaded {len(self._1m_data)} symbols with 1m data, "
                  f"{len(self._daily_data)} with daily data")

    def fetch_intraday_data_v3(
        self,
        symbol: str,
        interval: str = "1",
        instrument_type: str = "EQ",
        exchange: str = "NSE_EQ",
    ) -> Optional[pd.DataFrame]:
        sym = symbol.upper()
        if sym not in self._1m_data:
            return None

        df = self._1m_data[sym]

        tf_minutes = int(interval)
        now = self._get_time()
        now_ist = now.astimezone(IST) if now.tzinfo else now.replace(tzinfo=IST)

        mask = df.index.tz_convert(IST) <= now_ist
        df = df[mask].copy()

        if df.empty:
            return None

        if tf_minutes == 1:
            return df

        result = resample_candles(df, tf_minutes)
        # Drop the last candle if it's partial (fewer 1-min candles than tf_minutes)
        if result is not None and len(result) > 0:
            last_idx = result.index[-1]
            last_start = last_idx
            last_end = last_idx + timedelta(minutes=tf_minutes)
            # Count 1-min candles in this bucket
            bucket_1m = df.index.tz_convert(IST)[
                (df.index.tz_convert(IST) >= last_start) &
                (df.index.tz_convert(IST) < last_end)
            ]
            if len(bucket_1m) < tf_minutes:
                result = result.iloc[:-1]
        return result

    def fetch_historical_data_v3(
        self,
        symbol: str,
        unit: str = "days",
        interval: int = 1,
        to_date: str = "",
        from_date: Optional[str] = None,
        instrument_type: str = "EQ",
        expiry_date: Optional[str] = None,
        strike_price: Optional[float] = None,
        option_type: Optional[str] = None,
        exchange: str = "NSE_EQ",
    ) -> Optional[pd.DataFrame]:
        sym = symbol.upper()
        if sym not in self._daily_data:
            return None

        df = self._daily_data[sym]

        if from_date:
            from_ts = pd.Timestamp(from_date, tz=IST)
            mask = df.index.tz_convert(IST) >= from_ts
            df = df[mask].copy()

        if to_date:
            to_ts = pd.Timestamp(to_date, tz=IST)
            mask = df.index.tz_convert(IST) <= to_ts
            df = df[mask].copy()

        if df.empty:
            return None

        return df
