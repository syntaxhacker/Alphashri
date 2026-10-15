"""Market time-of-day guards.

Regression: the force-exit and daily-summary guards compared hour and minute
independently (``hour >= 15 and minute >= 30``), which is False at 16:05 — the
guard stopped firing just after the hour it was meant to trigger in. Separately,
the safety-net exit sat at 15:30, which since NSE's Closing Auction Session is
no longer continuous trading, so a forced market order would hit the auction.
"""

from datetime import datetime

import pytest

from trading.utils import (
    CONTINUOUS_CLOSE,
    FORCE_EXIT,
    MARKET_CLOSE,
    at_or_after,
    is_force_exit_time,
    minutes_of_day,
)


def _dt(hour, minute):
    return datetime(2026, 9, 17, hour, minute)


class TestAtOrAfter:
    @pytest.mark.parametrize(
        ("hour", "minute", "expected"),
        [
            (14, 45, False),
            (15, 0, False),
            (15, 29, False),
            (15, 30, True),
            (15, 35, True),
            (15, 59, True),
            (16, 0, True),      # the old hour/minute pair test was False here
            (16, 5, True),
            (23, 59, True),
        ],
    )
    def test_boundaries(self, hour, minute, expected):
        assert at_or_after(_dt(hour, minute), (15, 30)) is expected

    def test_the_old_pairwise_expression_was_wrong_after_the_hour(self):
        now = _dt(16, 5)
        assert (now.hour >= 15 and now.minute >= 30) is False   # the bug
        assert at_or_after(now, (15, 30)) is True               # the fix

    def test_minutes_of_day(self):
        assert minutes_of_day(_dt(9, 15)) == 555
        assert minutes_of_day(_dt(15, 30)) == 930

    def test_midnight_and_exact_match(self):
        assert at_or_after(_dt(0, 0), (0, 0)) is True
        assert at_or_after(_dt(0, 0), (0, 1)) is False


class TestForceExitWindow:
    def test_force_exit_happens_while_continuous_trading_is_live(self):
        """An auction has no continuous market to fill a forced exit in."""
        assert minutes_of_day(_dt(*FORCE_EXIT)) < minutes_of_day(_dt(*CONTINUOUS_CLOSE))

    def test_the_old_default_would_have_landed_in_the_auction(self):
        auction_start = minutes_of_day(_dt(*CONTINUOUS_CLOSE))
        session_close = minutes_of_day(_dt(*MARKET_CLOSE))
        assert auction_start <= 15 * 60 + 30 <= session_close   # 15:30 is inside

    def test_is_force_exit_time_uses_the_correct_comparison(self):
        assert is_force_exit_time(_dt(15, 9)) is False
        assert is_force_exit_time(_dt(15, 10)) is True
        assert is_force_exit_time(_dt(16, 5)) is True           # would have been False


class TestOrbEodExit:
    """The ORB generator must emit an EOD exit once past its own exit time.

    The exit time comes from strategy config (defaulting to FORCE_EXIT), so the
    override is applied the same way the config loader does it.
    """

    def _generator(self, force_exit=None):
        from trading.orb_signals import ORBSignalGenerator

        gen = ORBSignalGenerator()
        if force_exit is not None:
            gen.FORCE_EXIT = force_exit
        return gen

    def _exit(self, generator, when):
        return generator.check_exit(
            symbol="RELIANCE",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=100.5,
            timestamp=when,
        )

    def test_live_configuration_exits_before_the_auction(self):
        """Guard the real config: an EOD exit at/after 15:15 has no live book.

        The generator loads its exit time from strategy config when one is
        reachable, otherwise it inherits the global FORCE_EXIT.
        """
        gen = self._generator()
        exit_at = minutes_of_day(_dt(*gen.FORCE_EXIT))
        assert exit_at < minutes_of_day(_dt(*CONTINUOUS_CLOSE)), (
            f"ORB EOD exit {gen.FORCE_EXIT} falls inside the closing auction "
            f"(continuous trading ends {CONTINUOUS_CLOSE})"
        )

    def test_the_global_safety_net_is_also_before_the_auction(self):
        assert minutes_of_day(_dt(*FORCE_EXIT)) < minutes_of_day(_dt(*CONTINUOUS_CLOSE))

    def test_exits_at_the_configured_time(self):
        gen = self._generator((15, 10))
        signal = self._exit(gen, _dt(15, 10))
        assert signal is not None
        assert "EOD force exit" in signal.notes

    def test_does_not_exit_before_the_configured_time(self):
        gen = self._generator((15, 10))
        assert self._exit(gen, _dt(15, 9)) is None

    def test_still_exits_after_the_hour_would_have_rolled_over(self):
        """The regression: the pairwise test went False at 16:00."""
        gen = self._generator((15, 10))
        signal = self._exit(gen, _dt(16, 5))
        assert signal is not None
        assert "EOD force exit" in signal.notes

    def test_strategy_config_override_wins(self):
        gen = self._generator((14, 30))
        assert (gen.FORCE_EXIT[0], gen.FORCE_EXIT[1]) == (14, 30)
        assert self._exit(gen, _dt(14, 30)) is not None
        assert self._exit(gen, _dt(14, 29)) is None
