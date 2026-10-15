from datetime import datetime
from zoneinfo import ZoneInfo

from creator_fair_price_reversion import (
    CreatorReversionConfig,
    FairPriceEvent,
    SessionWindow,
    _fair_price_events,
    _session_for,
    run_creator_reversion,
)


ET = ZoneInfo("America/New_York")


def bar(timestamp, open_, high, low, close):
    return {"time": timestamp, "open": open_, "high": high, "low": low, "close": close}


def tick(timestamp_ms, bid, ask):
    return {"timestamp": timestamp_ms, "bidPrice": bid, "askPrice": ask}


def et_timestamp(hour, minute):
    return int(datetime(2026, 9, 14, hour, minute, tzinfo=ET).timestamp())


def test_creator_short_uses_25_point_stop_and_1_5r_target():
    start = et_timestamp(9, 30)
    bars = [
        bar(start + 0 * 60, 100, 101, 99, 100),
        bar(start + 1 * 60, 130, 133, 132, 132.5),  # arm short zone
        bar(start + 2 * 60, 132.5, 134, 131, 133),  # pivot-low candidate
        bar(start + 3 * 60, 133, 135, 132, 133.5),  # confirm pivot
        bar(start + 4 * 60, 133, 134, 130.5, 130.5),  # bearish BOS
        bar(start + 5 * 60, 130.5, 131, 129, 129),
    ]
    ticks = [
        tick((start + 5 * 60) * 1000, 130.5, 130.75),
        tick((start + 5 * 60 + 1) * 1000, 93.0, 93.25),
    ]

    trades = run_creator_reversion(
        bars,
        ticks,
        initial_fair_price=100,
        config=CreatorReversionConfig(sessions=(SessionWindow("ny", "09:30", "11:00"),)),
    )

    assert len(trades) == 1
    assert trades[0]["side"] == "SHORT"
    assert trades[0]["result"] == "TP"
    assert trades[0]["pnl"] == 37.5


def test_creator_long_is_the_mirror_of_short_setup():
    start = et_timestamp(9, 30)
    bars = [
        bar(start + 0 * 60, 100, 101, 99, 100),
        bar(start + 1 * 60, 70, 71, 69, 69.5),  # arm long zone
        bar(start + 2 * 60, 69.5, 72, 68.5, 69.5),  # pivot-high candidate
        bar(start + 3 * 60, 69.5, 71.5, 69, 70.5),  # confirm pivot
        bar(start + 4 * 60, 70.5, 73, 70, 72.5),  # bullish BOS
        bar(start + 5 * 60, 72.5, 110, 72, 109),
    ]
    ticks = [
        tick((start + 5 * 60) * 1000, 72.25, 72.5),
        tick((start + 5 * 60 + 1) * 1000, 110.0, 110.25),
    ]

    trades = run_creator_reversion(
        bars,
        ticks,
        initial_fair_price=100,
        config=CreatorReversionConfig(sessions=(SessionWindow("ny", "09:30", "11:00"),)),
    )

    assert len(trades) == 1
    assert trades[0]["side"] == "LONG"
    assert trades[0]["result"] == "TP"
    assert trades[0]["pnl"] == 37.5


def test_fair_price_events_are_resolved_without_future_data():
    start = et_timestamp(8, 30)
    bars = [
        bar(start, 500, 501, 499, 500.5),
        bar(start + 60 * 60, 510, 511, 509, 510.5),
    ]

    events = _fair_price_events(
        bars,
        (FairPriceEvent("08:30", label="NFP"), FairPriceEvent("09:30", label="cash open")),
    )

    assert events[start] == (500.0, "NFP")
    assert events[start + 60 * 60] == (510.0, "cash open")


def test_session_windows_support_overnight_asia_session():
    sessions = (SessionWindow("asia", "18:00", "02:00"),)

    assert _session_for(et_timestamp(19, 0), sessions) == "asia"
    assert _session_for(et_timestamp(1, 0), sessions) == "asia"
    assert _session_for(et_timestamp(10, 0), sessions) is None
