"""Regression tests for ORB cooldown parameter resolution.

The documented ``cooldown_minutes`` was silently ignored by the backtest,
which read only ``cooldown_bars``. These tests pin the conversion contract at
the pure helper boundary so no engine, DB or market data is required.
"""

import pytest

from backtest.strategies.orb import resolve_cooldown_bars


class TestResolveCooldownBarsMinutes:
    """cooldown_minutes is converted via the bar timeframe."""

    @pytest.mark.parametrize(
        "timeframe, expected_bars",
        [
            (5, 15),
            (1, 75),
            (15, 5),
        ],
    )
    def test_75_minutes_converted_by_timeframe(self, timeframe, expected_bars):
        assert resolve_cooldown_bars({'cooldown_minutes': 75}, timeframe) == expected_bars

    def test_sub_bar_minute_rounds_up_to_one_bar(self):
        assert resolve_cooldown_bars({'cooldown_minutes': 1}, 5) == 1

    def test_zero_minutes_means_no_cooldown(self):
        assert resolve_cooldown_bars({'cooldown_minutes': 0}, 5) == 0


class TestResolveCooldownBarsPrecedence:
    """Explicit cooldown_bars wins; the default is unchanged."""

    def test_explicit_bars_wins_over_minutes(self):
        params = {'cooldown_bars': 7, 'cooldown_minutes': 75}
        assert resolve_cooldown_bars(params, 5) == 7

    def test_explicit_zero_bars_is_honoured(self):
        assert resolve_cooldown_bars({'cooldown_bars': 0}, 5) == 0

    def test_neither_key_uses_legacy_default_of_three(self):
        assert resolve_cooldown_bars({}, 5) == 3


class TestResolveCooldownBarsValidation:
    """Negative cooldown values raise a ValueError naming the parameter."""

    def test_negative_minutes_raises(self):
        with pytest.raises(ValueError, match="cooldown_minutes"):
            resolve_cooldown_bars({'cooldown_minutes': -1}, 5)

    def test_negative_bars_raises(self):
        with pytest.raises(ValueError, match="cooldown_bars"):
            resolve_cooldown_bars({'cooldown_bars': -1}, 5)

    def test_negative_explicit_bars_wins_over_valid_minutes(self):
        params = {'cooldown_bars': -3, 'cooldown_minutes': 75}
        with pytest.raises(ValueError, match="cooldown_bars"):
            resolve_cooldown_bars(params, 5)
