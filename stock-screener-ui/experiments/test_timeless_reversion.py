from timeless_reversion import ReversionConfig, run_timeless_reversion


def bar(t, open_, high, low, close):
    return {"time": t, "open": open_, "high": high, "low": low, "close": close}


def tick(ts_ms, bid, ask):
    return {"timestamp": ts_ms, "bidPrice": bid, "askPrice": ask}


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
        config=ReversionConfig(min_distance=30, stop_points=25, target_r=1.5, cooldown_minutes=15),
    )

    assert len(trades) == 1
    trade = trades[0]
    assert trade["side"] == "SHORT"
    assert trade["entry"] == 130.4
    assert trade["sl"] == 155.4
    assert trade["tp"] == 92.9
    assert trade["result"] == "TP"


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
        config=ReversionConfig(min_distance=0, stop_points=25, target_r=1.5),
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
        config=ReversionConfig(min_distance=0, stop_points=25, target_r=1.5, cooldown_minutes=5),
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
        config=ReversionConfig(min_distance=30),
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
        config=ReversionConfig(min_distance=30),
    )

    assert trades == []
