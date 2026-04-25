import numpy as np
import pandas as pd

from screeners.utils.tv_logging_utils import log_colored
from screeners.core.technical_analysis import (
    identify_support_resistance_levels,
    display_support_resistance_levels,
)


class SignalMixin:

    def identify_support_resistance_levels_instance(self, symbol):
        if len(self.candle_data.get(symbol, [])) < self.lookback_periods:
            return

        self.support_levels[symbol], self.resistance_levels[symbol] = identify_support_resistance_levels(
            self.candle_data[symbol], self.lookback_periods, self.level_threshold, self.min_touches, self.bounce_threshold
        )

        current_price = self.current_prices.get(symbol, 0)
        display_support_resistance_levels(
            symbol, self.support_levels[symbol], self.resistance_levels[symbol],
            current_price, self.bounce_threshold
        )

    def _group_levels_deprecated(self, levels):
        if not levels:
            return []
        levels.sort()
        grouped, current_group = [], [levels[0]]
        for level in levels[1:]:
            if abs(level - current_group[0]) / current_group[0] * 100 < self.level_threshold:
                current_group.append(level)
            else:
                grouped.append(sum(current_group) / len(current_group))
                current_group = [level]
        grouped.append(sum(current_group) / len(current_group))
        return grouped

    def _filter_by_touches_deprecated(self, levels, price_data):
        return [l for l in levels if sum(1 for p in price_data if abs(p - l) / l * 100 < self.level_threshold) >= self.min_touches]

    def calculate_trend_direction(self, symbol):
        if len(self.candle_data.get(symbol, [])) < self.ema_period:
            self.trend_directions[symbol] = None
            return

        candles = self.candle_data[symbol]
        closes = [c['close'] for c in candles[-self.ema_period:]]
        self.trend_emas[symbol] = pd.Series(closes).ewm(span=self.ema_period, adjust=False).mean().iloc[-1]

        current_price = self.current_prices.get(symbol, 0)
        if current_price > self.trend_emas[symbol] * 1.002:
            self.trend_directions[symbol] = "BULLISH"
        elif current_price < self.trend_emas[symbol] * 0.998:
            self.trend_directions[symbol] = "BEARISH"
        else:
            self.trend_directions[symbol] = "NEUTRAL"

        log_colored(
            f"📈 {symbol} Trend: {self.trend_directions[symbol]} | EMA: {self.trend_emas[symbol]:,.2f} | Price: {current_price:,.2f}",
            "level"
        )

    def find_nearest_levels(self, symbol):
        current_price = self.current_prices.get(symbol, 0)
        support_levels = self.support_levels.get(symbol, [])
        resistance_levels = self.resistance_levels.get(symbol, [])

        nearest_support = max([l for l in support_levels if l < current_price] or [None])
        nearest_resistance = min([l for l in resistance_levels if l > current_price] or [None])

        return nearest_support, nearest_resistance

    def check_support_resistance_signals(self, symbol):
        if self.positions.get(symbol):
            return []

        signals = []
        nearest_support, nearest_resistance = self.find_nearest_levels(symbol)
        current_price = self.current_prices.get(symbol, 0)
        trend_direction = self.trend_directions.get(symbol, "NEUTRAL")

        if (nearest_support and trend_direction in ["BULLISH", "NEUTRAL"] and
            0 < (current_price - nearest_support) / nearest_support * 100 <= self.bounce_threshold):
            signals.append(('BUY', 'support_bounce', 0.8, nearest_support))

        if (nearest_resistance and trend_direction in ["BEARISH", "NEUTRAL"] and
            0 < (nearest_resistance - current_price) / current_price * 100 <= self.bounce_threshold):
            signals.append(('SELL', 'resistance_rejection', 0.8, nearest_resistance))

        return signals
