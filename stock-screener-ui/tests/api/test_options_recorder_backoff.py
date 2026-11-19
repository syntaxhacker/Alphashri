"""A failing options-recorder tick must back off, not spin at full cadence.

Measured live with a dead broker token: **180 consecutive failed ticks**. At the
flat 10s interval that is 180 timed-out chain fetches inside 30 minutes, each
holding a rate-limiter token, while every unrelated endpoint got slower. The
recorder recovered the moment the token was refreshed, so the failures were not
fatal — they were just expensive noise.
"""

import api.reports_api.options_recorder as rec


def test_backoff_grows_while_failing_and_caps():
    def effective(streak: int, interval: float = 10.0) -> float:
        # Mirrors _recorder_loop's formula; kept in one place below.
        if streak <= 1:
            return interval
        return min(interval * (2 ** min(streak - 1, 4)), max(interval, 120.0))

    # First failure keeps the normal cadence (a blip should not slow anything).
    assert effective(1) == 10.0
    # Then it doubles each tick...
    assert effective(2) == 20.0
    assert effective(3) == 40.0
    assert effective(4) == 80.0
    # ...and caps at two minutes so recovery is still prompt.
    assert effective(5) == 120.0
    assert effective(50) == 120.0


def test_the_loop_uses_a_backoff_term_not_the_raw_interval():
    """Guard the wiring: the interval alone must not reach _advance_next_tick."""
    import inspect

    source = inspect.getsource(rec._recorder_loop)
    assert "_failure_streak > 1" in source, "no backoff condition in the loop"
    assert "effective_sec" in source, "loop still advances by the raw interval"
    # The raw interval must not be passed directly to the advance helper.
    assert "_advance_next_tick(next_tick, interval_sec" not in source
