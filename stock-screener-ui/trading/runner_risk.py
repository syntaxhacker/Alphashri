"""
Risk management and data fetching utilities for MultiStrategyRunner.

Contains risk-related helper methods for fetching and validating data.
"""

from datetime import datetime, timedelta
from typing import Optional

import config
from cache.redis_client import cache_get, cache_set

from trading.strategy_runner import INTRADAY_STRATEGY_TYPES
from trading.week52_utils import calculate_52w_high, days_since_52w_high_touch

from trading.timezone import IST


class RunnerRiskMixin:
    """Mixin class providing risk management and data fetching methods for MultiStrategyRunner."""

    def fetch_or_data(self, symbol: str, runner=None) -> Optional[dict]:
        """Fetch opening range data for a symbol using the given runner's or_minutes.
        
        Results are cached in Redis with a 60s TTL to avoid API rate limits.
        """
        cache_key = f"orb:or_data:{symbol}"
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

        try:
            fetcher = self._get_data_fetcher()
            if not fetcher:
                return None

            df = fetcher.upstox_api.fetch_intraday_data_v3(
                symbol=symbol,
                interval='5'
            )

            if df is None or df.empty:
                return None

            candles = []
            for idx, row in df.iterrows():
                candles.append({
                    'time': idx.isoformat() if hasattr(idx, 'isoformat') else str(idx),
                    'open': row['open'],
                    'high': row['high'],
                    'low': row['low'],
                    'close': row['close'],
                })

            signal_gen = (runner.signal_generator if runner and runner.signal_generator
                          else next((r.signal_generator for r in self.strategies.values()
                                     if r.strategy_type == "ORB" and r.signal_generator), None))
            if signal_gen:
                or_levels = signal_gen.calculate_or_levels(candles)
                if or_levels and candles:
                    or_levels['latest_price'] = candles[-1]['close']
                    or_levels['latest_high'] = candles[-1]['high']
                    or_levels['latest_low'] = candles[-1]['low']
                if or_levels:
                    cache_set(cache_key, or_levels, ttl=60)
                return or_levels

            return None

        except Exception as e:
            from rich.console import Console
            console = Console()
            console.print(f"[dim red]Error fetching OR for {symbol}: {e}[/dim red]")
            # Return stale cache on error (better than nothing)
            if cached is None:
                cached = cache_get(cache_key)
            return cached

    def fetch_daily_data(self, symbol: str) -> Optional[dict]:
        """Fetch daily OHLCV data for a symbol (used by swing strategies)."""
        try:
            fetcher = self._get_data_fetcher()
            if not fetcher:
                return None

            from datetime import timedelta as td
            to_date = self._get_to_date().strftime('%Y-%m-%d')
            from_date = (self._get_to_date() - td(days=400)).strftime('%Y-%m-%d')

            df = fetcher.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
            )

            if df is None or df.empty:
                return None

            closes = df['close'].tolist()
            highs = df['high'].tolist()
            lows = df['low'].tolist()
            volumes = df['volume'].tolist() if 'volume' in df.columns else []

            high_52w = calculate_52w_high(highs, period=252, exclude_current=False) or 0.0

            # Trading days since 52W high was last touched (uses 98% threshold, not exact match)
            days_since_52w_high = 0
            if high_52w > 0 and highs:
                result = days_since_52w_high_touch(highs, high_52w)
                if result is not None:
                    days_since_52w_high = result

            avg_volume_20d = 0.0
            if len(volumes) >= 20:
                avg_volume_20d = sum(volumes[-20:]) / 20

            ma50 = 0.0
            ma200 = 0.0
            if len(closes) >= 50:
                ma50 = sum(closes[-50:]) / 50
            if len(closes) >= 200:
                ma200 = sum(closes[-200:]) / 200

            current_price = closes[-1]
            try:
                intraday = fetcher.upstox_api.fetch_intraday_data_v3(
                    symbol=symbol, interval='1'
                )
            except Exception:
                intraday = None

            if intraday is not None and not intraday.empty:
                current_price = float(intraday['close'].iloc[-1])

            return {
                'current_price': current_price,
                'high_52w': high_52w,
                'days_since_52w_high': days_since_52w_high,
                'daily_highs': highs,
                'daily_closes': closes,
                'volume': volumes[-1] if volumes else 0.0,
                'avg_volume_20d': avg_volume_20d,
                'ma50': ma50,
                'ma200': ma200,
                'prev_high': highs[-2] if len(highs) >= 2 else highs[-1],
                'prev_low': lows[-2] if len(lows) >= 2 else lows[-1],
                'prev_close': closes[-2] if len(closes) >= 2 else closes[-1],
            }

        except Exception as e:
            from rich.console import Console
            console = Console()
            console.print(f"[dim red]Error fetching daily data for {symbol}: {e}[/dim red]")
            return None

    def fetch_previous_day_data(self, symbol: str) -> Optional[dict]:
        """Fetch previous day's HLC for pivot point calculation."""
        fetcher = self._get_data_fetcher()
        if not fetcher:
            return None

        from datetime import timedelta as td
        to_date = self._get_to_date().strftime('%Y-%m-%d')
        from_date = (self._get_to_date() - td(days=10)).strftime('%Y-%m-%d')

        try:
            df = fetcher.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
            )
        except Exception as e:
            from rich.console import Console
            console = Console()
            console.print(f"[dim red]Error fetching prev day data for {symbol}: {e}[/dim red]")
            return None

        if df is None or df.empty or len(df) < 2:
            return None

        prev_row = df.iloc[-2]
        current_price = df.iloc[-1]['close']

        return {
            'current_price': current_price,
            'prev_high': prev_row['high'],
            'prev_low': prev_row['low'],
            'prev_close': prev_row['close'],
        }

    def fetch_ema_data(self, symbol: str, ema_fast_period: int = 9, ema_slow_period: int = 21) -> Optional[dict]:
        """Fetch intraday data and compute EMA crossover state for a symbol."""
        from trading.ema_utils import calculate_ema

        fetcher = self._get_data_fetcher()
        if not fetcher:
            return None

        try:
            df = fetcher.upstox_api.fetch_intraday_data_v3(
                symbol=symbol,
                interval='5',
            )
        except Exception as e:
            from rich.console import Console
            console = Console()
            console.print(f"[dim red]Error fetching EMA data for {symbol}: {e}[/dim red]")
            return None

        if df is None or df.empty:
            return None

        closes = df['close'].tolist()
        if len(closes) < ema_slow_period + 2:
            return None

        ema_fast = calculate_ema(closes, ema_fast_period, return_full=True)
        ema_slow = calculate_ema(closes, ema_slow_period, return_full=True)

        if len(ema_fast) < 2 or len(ema_slow) < 2:
            return None

        current_price = closes[-1]
        ema_fast_current = ema_fast[-1]
        ema_fast_prev = ema_fast[-2]
        ema_slow_current = ema_slow[-1]
        ema_slow_prev = ema_slow[-2]

        return {
            'current_price': current_price,
            'ema_fast_current': round(ema_fast_current, 2),
            'ema_fast_prev': round(ema_fast_prev, 2),
            'ema_slow_current': round(ema_slow_current, 2),
            'ema_slow_prev': round(ema_slow_prev, 2),
            'closes': closes,
        }
