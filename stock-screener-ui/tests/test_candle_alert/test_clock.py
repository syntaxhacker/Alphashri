from datetime import datetime, timedelta, timezone

from candle_alert import clock
from candle_alert.config import ALERT_LEAD_SECONDS

UTC = timezone.utc


def at(hour, minute, second=0, *, tzinfo=UTC):
    return datetime(2026, 1, 1, hour, minute, second, tzinfo=tzinfo)


def test_next_close_is_boundary_strictly_after_now():
    now = at(14, 23)

    assert clock.next_close(60, now) == at(15, 0)
    assert clock.next_close(240, now) == at(16, 0)


def test_next_close_on_exact_boundary_moves_to_the_following_one():
    assert clock.next_close(60, at(15, 0)) == at(16, 0)
    assert clock.next_close(240, at(16, 0)) == at(20, 0)


def test_next_close_uses_utc_four_hour_quarters():
    assert clock.next_close(240, at(3, 59, 59)) == at(4, 0)
    assert clock.next_close(240, at(12, 1)) == at(16, 0)


def test_next_close_is_timezone_aware_utc():
    result = clock.next_close(60, at(14, 23))

    assert result.tzinfo is UTC
    assert result.utcoffset().total_seconds() == 0


def test_next_close_treats_naive_now_as_utc():
    naive = datetime(2026, 1, 1, 14, 23)

    assert clock.next_close(60, naive) == at(15, 0)


def test_seconds_until_returns_remaining_seconds():
    assert clock.seconds_until(60, at(14, 23)) == 37 * 60
    assert clock.seconds_until(60, at(14, 59, 30)) == 30


def test_seconds_until_naive_now_matches_utc():
    assert clock.seconds_until(60, datetime(2026, 1, 1, 14, 23)) == 37 * 60


def test_close_epoch_is_stable_for_the_same_candle():
    first = clock.close_epoch(60, at(14, 23))
    later = clock.close_epoch(60, at(14, 50))

    assert first == later == int(at(15, 0).timestamp())
    assert clock.close_epoch(60, at(15, 1)) != first


def test_in_alert_window_true_inside_lead_time():
    assert clock.in_alert_window(60, at(14, 59, 30)) is True
    assert clock.in_alert_window(240, at(3, 59, 30)) is True


def test_in_alert_window_inclusive_at_lead_boundary():
    within = at(15, 0) - timedelta(seconds=ALERT_LEAD_SECONDS)

    assert clock.in_alert_window(60, within) is True


def test_in_alert_window_false_outside_lead_or_at_boundary():
    assert clock.in_alert_window(60, at(14, 58)) is False
    assert clock.in_alert_window(60, at(15, 0)) is False
    assert clock.in_alert_window(240, at(3, 58, 30)) is False


def test_format_hms_zero_pads_and_rounds_down():
    assert clock.format_hms(3661) == "01:01:01"
    assert clock.format_hms(61.9) == "00:01:01"
    assert clock.format_hms(59.9) == "00:00:59"


def test_format_hms_clamps_negative_to_zero():
    assert clock.format_hms(-5) == "00:00:00"
    assert clock.format_hms(0) == "00:00:00"
