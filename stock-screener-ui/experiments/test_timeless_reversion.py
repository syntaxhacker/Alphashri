from datetime import datetime
from zoneinfo import ZoneInfo

from timeless_reversion import (
    ReversionConfig,
    _opening_drive_summary,
    _opening_range_summary,
    run_timeless_reversion,
)


def bar(t, open_, high, low, close):
    return {"time": t, "open": open_, "high": high, "low": low, "close": close}


def tick(ts_ms, bid, ask):
    return {"timestamp": ts_ms, "bidPrice": bid, "askPrice": ask}


def test_opening_drive_summary_uses_only_the_completed_first_window():
    open_time = int(datetime(2026, 9, 14, 9, 30, tzinfo=ZoneInfo("America/New_York")).timestamp())
    bars = [
        bar(open_time + i * 60, 100 + i, 101 + i, 99 + i, 100 + i)
        for i in range(15)
    ]

    summary = _opening_drive_summary(bars, fair_price=100, minutes=15)

    assert summary == (open_time, open_time + 15 * 60, 14.0)


def test_opening_range_summary_returns_completed_high_low_range():
    open_time = int(datetime(2026, 9, 14, 9, 30, tzinfo=ZoneInfo("America/New_York")).timestamp())
    bars = [
        bar(open_time + i * 60, 100, 102 + i, 98 - i, 101 + i)
        for i in range(3)
    ]

    summary = _opening_range_summary(bars, fair_price=100, minutes=3)

    assert summary == (open_time, open_time + 3 * 60, 8.0)


def test_short_enters_on_next_bar_after_overextended_wick_break_and_hits_target():
    bars = [
        bar(0, 100, 101, 99, 100),
        bar(60, 100, 102, 98, 101),
        bar(120, 101, 103, 99, 102),
        bar(180, 102, 132, 131, 131),  # arm the short zone (> fair + 30)
        bar(240, 131, 133, 130.5, 132),  # swing-low candidate
        bar(300, 132, 132.5, 131, 131.5),  # confirms the candidate
        bar(360, 131.5, 132, 130.25, 130.4),  # breaks the confirmed wick low
        bar(420, 130.4, 131, 95, 96),
        bar(480, 96, 97, 92.9, 94),
    ]
    ticks = [
        tick(420_000, 130.4, 130.65),  # next-bar fill after the BOS bar
        tick(421_000, 129, 129.25),
        tick(480_000, 92.9, 93.15),  # TP at entry - 37.5
    ]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=100,
        config=ReversionConfig(
            min_distance=30,
            stop_points=25,
            target_r=1.5,
            cooldown_minutes=15,
            bos_confirmation_bars=0,
        ),
    )

    assert len(trades) == 1
    trade = trades[0]
    assert trade["side"] == "SHORT"
    assert trade["entry"] == 130.4
    assert trade["sl"] == 155.4
    assert trade["tp"] == 92.9
    assert trade["result"] == "TP"


def test_confirmation_mode_waits_for_bos_confirmation_bar_before_entry():
    bars = [
        bar(0, 100, 101, 99, 100),
        bar(60, 100, 102, 98, 101),
        bar(120, 101, 103, 99, 102),
        bar(180, 102, 132, 131, 131),
        bar(240, 131, 132, 130.5, 131),
        bar(300, 131, 132.5, 131, 131.5),
        bar(360, 131.5, 132, 130.25, 130.4),  # BOS below 130.5
        bar(420, 130.4, 131, 129.8, 130.2),   # confirms the break
        bar(480, 130.2, 131, 100, 101),        # entry bar
        bar(540, 101, 102, 92, 94),
    ]
    ticks = [
        tick(480_000, 130.4, 130.65),
        tick(481_000, 129, 129.25),
        tick(540_000, 92.9, 93.15),
    ]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=100,
        config=ReversionConfig(min_distance=30, bos_confirmation_bars=1),
    )

    assert len(trades) == 1
    assert trades[0]["time"] == 480
    assert trades[0]["result"] == "TP"


def test_confirmation_mode_rejects_bos_when_confirmation_bar_reclaims_structure():
    bars = [
        bar(0, 100, 101, 99, 100),
        bar(60, 100, 102, 98, 101),
        bar(120, 101, 103, 99, 102),
        bar(180, 102, 132, 131, 131),
        bar(240, 131, 132, 130.5, 131),
        bar(300, 131, 132.5, 131, 131.5),
        bar(360, 131.5, 132, 130.25, 130.4),  # BOS below 130.5
        bar(420, 130.4, 132, 130, 131),        # reclaims the BOS level
        bar(480, 131, 132, 100, 101),
    ]
    ticks = [
        tick(480_000, 130.4, 130.65),
        tick(481_000, 129, 155.5),
    ]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=100,
        config=ReversionConfig(min_distance=30, bos_confirmation_bars=1),
    )

    assert trades == []


def test_stop_is_checked_before_target_on_an_ambiguous_tick():
    bars = [
        bar(0, 100, 101, 99, 100),
        bar(60, 100, 132, 110, 131),
        bar(120, 131, 133, 105, 132),
        bar(180, 132, 132, 108, 109),
        bar(240, 109, 130, 100, 104),
        bar(300, 104, 105, 99, 100),
    ]
    ticks = [
        tick(300_000, 104, 104.25),
        tick(301_000, 66, 129.25),  # bid is through TP, ask is through SL
    ]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=100,
        config=ReversionConfig(min_distance=0, stop_points=25, target_r=1.5, bos_confirmation_bars=0),
    )

    assert len(trades) == 1
    assert trades[0]["result"] == "SL"
    assert trades[0]["exit"] == 129


def test_cooldown_blocks_a_second_break_until_the_next_setup():
    bars = [
        bar(0, 100, 101, 99, 100),
        bar(60, 100, 132, 110, 131),
        bar(120, 131, 133, 105, 132),
        bar(180, 132, 132, 108, 109),
        bar(240, 109, 130, 100, 104),  # first BOS
        bar(300, 104, 105, 99, 100),
        bar(360, 100, 101, 66, 67),  # first target at 66.5
        bar(420, 67, 134, 110, 133),
        bar(480, 133, 135, 105, 134),
        bar(540, 134, 134, 108, 109),
        bar(600, 109, 130, 100, 99),  # break during cooldown, ignored
        bar(660, 99, 134, 110, 133),
        bar(720, 133, 135, 105, 134),
        bar(780, 134, 134, 108, 109),
        bar(840, 109, 130, 100, 99),  # second eligible BOS
        bar(900, 99, 100, 61, 62),
        bar(960, 62, 63, 53.5, 54),
    ]
    ticks = [
        tick(300_000, 104, 104.25),
        tick(360_000, 66.5, 66.75),
        tick(900_000, 99, 99.25),
        tick(960_000, 61.5, 61.75),
    ]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=0,
        config=ReversionConfig(
            min_distance=0,
            stop_points=25,
            target_r=1.5,
            cooldown_minutes=5,
            bos_confirmation_bars=0,
        ),
    )

    assert len(trades) == 2
    assert trades[0]["time"] == 300
    assert trades[1]["time"] == 900


def test_zone_is_reset_after_price_crosses_back_below_fair_price():
    bars = [
        bar(0, 100, 101, 99, 100),
        bar(60, 100, 132, 110, 131),
        bar(120, 131, 133, 105, 132),
        bar(180, 132, 132, 108, 109),
        bar(240, 109, 110, 95, 99),  # crosses below fair and invalidates the zone
        bar(300, 99, 100, 90, 89),   # breaks the old pivot, but must not short
        bar(360, 89, 90, 80, 85),
    ]
    ticks = [
        tick(300_000, 89, 89.25),
        tick(301_000, 88, 115),  # would hit the stale short's stop
    ]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=100,
        config=ReversionConfig(min_distance=30, bos_confirmation_bars=0),
    )

    assert trades == []


def test_pending_bos_is_cancelled_if_next_tick_is_below_short_zone():
    bars = [
        bar(0, 100, 101, 99, 100),
        bar(60, 100, 132, 131, 131),
        bar(120, 131, 133, 130.5, 132),
        bar(180, 132, 132.5, 131, 131.5),
        bar(240, 131.5, 132, 130.25, 130.4),  # valid BOS signal
        bar(300, 130.4, 131, 120, 125),
    ]
    ticks = [
        tick(300_000, 129.9, 130.1),  # gap below fair + 30
        tick(301_000, 129, 155.5),    # would hit the stale fill's stop
    ]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=100,
        config=ReversionConfig(min_distance=30, bos_confirmation_bars=0),
    )

    assert trades == []


def test_daily_circuit_breaker_stops_new_entries_after_consecutive_stopouts():
    bars = [
        bar(0, 100, 101, 99, 100),
        bar(60, 100, 132, 110, 131),
        bar(120, 131, 133, 105, 132),
        bar(180, 132, 132, 108, 109),
        bar(240, 109, 130, 100, 104),
        bar(300, 104, 105, 99, 100),
        bar(360, 100, 101, 66, 67),
        bar(420, 67, 134, 110, 133),
        bar(480, 133, 135, 105, 134),
        bar(540, 134, 134, 108, 109),
        bar(600, 109, 130, 100, 99),
        bar(660, 99, 134, 110, 133),
        bar(720, 133, 135, 105, 134),
        bar(780, 134, 134, 108, 109),
        bar(840, 109, 130, 100, 99),
        bar(900, 99, 100, 61, 62),
        bar(960, 62, 63, 53.5, 54),
    ]
    ticks = [
        tick(300_000, 104, 104.25),
        tick(301_000, 104, 130),  # first trade hits its stop
        tick(900_000, 99, 99.25),
        tick(960_000, 61.5, 61.75),  # second setup would otherwise hit target
    ]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=0,
        config=ReversionConfig(
            min_distance=0,
            stop_points=25,
            target_r=1.5,
            max_consecutive_losses=1,
        ),
    )

    assert len(trades) == 1
    assert trades[0]["result"] == "SL"


def test_bearish_ema_gate_blocks_a_bullish_session_signal():
    open_time = int(datetime(2026, 9, 14, 9, 30, tzinfo=ZoneInfo("America/New_York")).timestamp())
    bars = [
        bar(open_time + 0 * 60, 100, 101, 99, 100),
        bar(open_time + 1 * 60, 100, 102, 99, 101),
        bar(open_time + 2 * 60, 101, 103, 100, 102),
        bar(open_time + 3 * 60, 102, 132, 131, 131),
        bar(open_time + 4 * 60, 131, 133, 130.5, 132),
        bar(open_time + 5 * 60, 132, 132.5, 131, 131.5),
        bar(open_time + 6 * 60, 131.5, 132, 130.25, 130.4),
        bar(open_time + 7 * 60, 130.4, 131, 95, 96),
    ]
    ticks = [
        tick((open_time + 7 * 60) * 1000, 130.4, 130.65),
        tick((open_time + 7 * 60 + 1) * 1000, 129, 129.25),
    ]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=100,
        config=ReversionConfig(
            min_distance=30,
            require_bearish_ema=True,
            entry_start="09:30",
            entry_end="11:00",
        ),
    )

    assert trades == []


def test_signal_range_gate_rejects_expansion_candle():
    open_time = int(datetime(2026, 9, 14, 9, 30, tzinfo=ZoneInfo("America/New_York")).timestamp())
    bars = [
        bar(open_time + 0 * 60, 100, 101, 99, 100),
        bar(open_time + 1 * 60, 100, 102, 98, 101),
        bar(open_time + 2 * 60, 101, 103, 99, 102),
        bar(open_time + 3 * 60, 102, 132, 131, 131),
        bar(open_time + 4 * 60, 131, 133, 130.5, 132),
        bar(open_time + 5 * 60, 132, 132.5, 131, 131.5),
        bar(open_time + 6 * 60, 131.5, 150, 120, 120.4),  # expansion BOS candle
        bar(open_time + 7 * 60, 120.4, 121, 95, 96),
    ]
    ticks = [tick((open_time + 7 * 60) * 1000, 120.4, 120.65)]

    trades = run_timeless_reversion(
        bars,
        ticks,
        fair_price=100,
        config=ReversionConfig(
            min_distance=30,
            max_signal_range_points=10,
            entry_start="09:30",
            entry_end="11:00",
        ),
    )

    assert trades == []
