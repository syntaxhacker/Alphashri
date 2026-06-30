"""
Risk management and data fetching utilities for MultiStrategyRunner.

Contains risk-related helper methods for fetching and validating data.
"""

from datetime import datetime, timedelta
from typing import Optional

import config
from cache.redis_client import cache_get, cache_set

from trading.strategy_runner import INTRADAY_STRATEGY_TYPES
from trading.week52_utils import calculate_52w_high, days_since_52w_high_touch, check_intraday_52w_touch

from trading.timezone import IST
from trading.utils import MARKET_OPEN


class RunnerRiskMixin:
    """Mixin class providing risk management and data fetching methods for MultiStrategyRunner."""

    def fetch_or_data(self, symbol: str, runner=None) -> Optional[dict]:
        """Fetch opening range data for a symbol using the given runner's or_minutes.
        
        Static OR levels (high/low/range) are cached in Redis with a 60s TTL.
        The latest price is always fetched fresh so it reflects the current time,
        even during fast replay where real-time seconds don't advance.
        """
        cache_key = f"orb:or_data:{symbol}"
        or_levels = cache_get(cache_key)

        try:
            fetcher = self._get_data_fetcher()
            if not fetcher:
                return or_levels

            # Check cycle cache before API call
            intra_cache_key = f"intraday:{symbol}:5"
            df = self._cycle_data_cache.get(intra_cache_key)
            if df is None:
                df = fetcher.upstox_api.fetch_intraday_data_v3(
                    symbol=symbol,
                    interval='5'
                )
                if df is not None and not df.empty:
                    self._cycle_data_cache[intra_cache_key] = df

            if df is None or df.empty:
                return or_levels

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
            if not signal_gen:
                return or_levels

            # If OR period isn't complete yet, discard any partial cached levels.
            # (A 09:45 cache with only 30 min of data would give wrong OR high.)
            if or_levels is not None and not self._is_or_period_complete(signal_gen):
                or_levels = None

            # (Re)calculate static OR levels on cache miss
            if or_levels is None:
                or_levels = signal_gen.calculate_or_levels(candles)
                # Only cache once the OR period is complete
                if or_levels and self._is_or_period_complete(signal_gen):
                    cache_set(cache_key, or_levels, ttl=60)

            # Latest price is always fresh — never cached
            if or_levels and candles:
                or_levels['latest_price'] = candles[-1]['close']
                or_levels['latest_high'] = candles[-1]['high']
                or_levels['latest_low'] = candles[-1]['low']

            return or_levels

        except Exception as e:
            from rich.console import Console
            console = Console()
            console.print(f"[dim red]Error fetching OR for {symbol}: {e}[/dim red]")
            return or_levels

    def _is_or_period_complete(self, signal_gen) -> bool:
        """Check if the opening range period is complete at the current simulated time."""
        now = self._ist_now()
        or_minutes = getattr(signal_gen, 'or_minutes', 45)
        or_end = now.replace(hour=MARKET_OPEN[0], minute=MARKET_OPEN[1], second=0, microsecond=0)
        from datetime import timedelta
        or_end += timedelta(minutes=or_minutes)
        return now >= or_end

    def fetch_daily_data(self, symbol: str) -> Optional[dict]:
        """Fetch daily OHLCV data for a symbol (used by swing strategies)."""
        try:
            # Check cycle cache first
            cache_key = f"daily_data:{symbol}"
            cached = self._cycle_data_cache.get(cache_key)
            if cached is not None:
                return cached

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
                intra_cache_key = f"intraday:{symbol}:1"
                intraday = self._cycle_data_cache.get(intra_cache_key)
                if intraday is None:
                    intraday = fetcher.upstox_api.fetch_intraday_data_v3(
                        symbol=symbol, interval='1'
                    )
                    if intraday is not None and not intraday.empty:
                        self._cycle_data_cache[intra_cache_key] = intraday
            except Exception:
                intraday = None

            intraday_high = 0.0
            if intraday is not None and not intraday.empty:
                current_price = float(intraday['close'].iloc[-1])
                intraday_high = float(intraday['high'].max())

            days_since_52w_high = check_intraday_52w_touch(
                intraday_high, high_52w, days_since_52w_high,
            )

            result = {
                'current_price': current_price,
                'high_52w': high_52w,
                'days_since_52w_high': days_since_52w_high,
                'daily_highs': highs,
                'daily_lows': lows,
                'daily_closes': closes,
                'volume': volumes[-1] if volumes else 0.0,
                'avg_volume_20d': avg_volume_20d,
                'ma50': ma50,
                'ma200': ma200,
                'prev_high': highs[-2] if len(highs) >= 2 else highs[-1],
                'prev_low': lows[-2] if len(lows) >= 2 else lows[-1],
                'prev_close': closes[-2] if len(closes) >= 2 else closes[-1],
            }
            self._cycle_data_cache[cache_key] = result
            return result

        except Exception as e:
            from rich.console import Console
            console = Console()
            console.print(f"[dim red]Error fetching daily data for {symbol}: {e}[/dim red]")
            return None

    def fetch_previous_day_data(self, symbol: str) -> Optional[dict]:
        """Fetch previous day's HLC for pivot point calculation."""
        cache_key = f"prev_day_data:{symbol}"
        cached = self._cycle_data_cache.get(cache_key)
        if cached is not None:
            return cached

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

        result = {
            'current_price': current_price,
            'prev_high': prev_row['high'],
            'prev_low': prev_row['low'],
            'prev_close': prev_row['close'],
        }
        self._cycle_data_cache[cache_key] = result
        return result

    def fetch_ema_data(self, symbol: str, ema_fast_period: int = 9, ema_slow_period: int = 21,
                        runner=None) -> Optional[dict]:
        """Fetch intraday data and compute EMA crossover state for a symbol.
        
        Uses configurable interval (ema_interval_minutes in runner config, default 5).
        Applies market range filter (min_market_range_pct) if configured.
        """
        from trading.ema_utils import calculate_ema

        ema_interval = 5
        min_range = 0.0
        if runner and hasattr(runner, 'config'):
            ema_interval = int(runner.config.get("ema_interval_minutes", runner.config.get("or_minutes", 5)))
            min_range = float(runner.config.get("min_market_range_pct", 0.0))

        # Check cycle cache before API call
        intra_cache_key = f"intraday:{symbol}:{ema_interval}"
        df = self._cycle_data_cache.get(intra_cache_key)
        if df is None:
            fetcher = self._get_data_fetcher()
            if not fetcher:
                return None

            # Market range filter: check JUNIORBEES daily range before scanning
            if min_range > 0:
                market_ok = self._check_market_range(min_range)
                if not market_ok:
                    return None

            try:
                df = fetcher.upstox_api.fetch_intraday_data_v3(
                    symbol=symbol,
                    interval=str(ema_interval),
                )
            except Exception as e:
                from rich.console import Console
                console = Console()
                console.print(f"[dim red]Error fetching EMA data for {symbol}: {e}[/dim red]")
                return None
            if df is not None and not df.empty:
                self._cycle_data_cache[intra_cache_key] = df

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

    _market_range_cache: dict = {}

    def _check_market_range(self, min_range_pct: float) -> bool:
        """Check if today's JUNIORBEES daily range meets the minimum threshold.
        Caches result per date (simulated date in replay) so it's only fetched once per day."""
        today = self._ist_now().date()
        if today in self._market_range_cache:
            return self._market_range_cache[today]

        try:
            now = self._ist_now()
            to_date = now.strftime('%Y-%m-%d')
            from datetime import timedelta
            from_date = (now - timedelta(days=10)).strftime('%Y-%m-%d')
            df = self._get_data_fetcher().upstox_api.fetch_historical_data_v3(
                symbol="JUNIORBEES", unit='days', interval=1,
                to_date=to_date, from_date=from_date,
            )
            if df is not None and len(df) > 0:
                row = df.iloc[-1]
                o, h, l = float(row['open']), float(row['high']), float(row['low'])
                if o > 0:
                    range_pct = (h - l) / o * 100
                    is_ok = range_pct >= min_range_pct
                    self._market_range_cache[today] = is_ok
                    return is_ok
        except Exception:
            from rich.console import Console
            Console().print(f"[dim red]Market range check failed for JUNIORBEES, allowing trade[/dim red]")
        self._market_range_cache[today] = True
        return True
