from ifvg_reversion import (
    IFVGConfig,
    aggregate_bars,
    detect_ifvg_signals,
    run_ifvg_reversion,
    strict_ifvg_config,
)


def bar(timestamp, open_, high, low, close):
    return {"time": timestamp, "open": open_, "high": high, "low": low, "close": close}


def tick(timestamp_ms, bid, ask):
    return {"timestamp": timestamp_ms, "bidPrice": bid, "askPrice": ask}


def test_strict_profile_encodes_the_measured_context_gates():
    config = strict_ifvg_config()

    assert config.htf_timeframe_minutes == 15
    assert config.require_htf_alignment is True
    assert config.sweep_lookback == 3
    assert config.min_stop_points == 25
    assert config.min_gap_points == 1


def test_aggregate_bars_builds_five_minute_ohlc():
    bars = [
        bar(0, 100, 102, 99, 101),
        bar(60, 101, 104, 100, 103),
        bar(120, 103, 105, 102, 104),
        bar(300, 104, 106, 103, 105),
    ]

    result = aggregate_bars(bars, timeframe_minutes=5)

    assert result == [
        {"time": 0, "open": 100.0, "high": 105.0, "low": 99.0, "close": 104.0},
        {"time": 300, "open": 104.0, "high": 106.0, "low": 103.0, "close": 105.0},
    ]


def test_bearish_gap_inverts_to_long_and_retest_hits_target():
    bars = [
        bar(0, 100, 105, 99, 104),
        bar(300, 104, 106, 103, 105),
        bar(600, 97, 98, 94, 95),  # bearish FVG: zone 98-99
        bar(900, 98, 102, 97, 101),  # closes above zone: inversion
        bar(1200, 99, 102, 98.5, 100),  # retest and bullish confirmation
    ]
    ticks = [
        tick(1500_000, 100.0, 100.25),
        tick(1501_000, 105.2, 105.45),
    ]

    signals = detect_ifvg_signals(bars)
    trades = run_ifvg_reversion(
        bars,
        ticks,
        config=IFVGConfig(entry_start=None, entry_end=None, stop_buffer_points=1.0),
    )

    assert len(signals) == 1
    assert signals[0].side == "LONG"
    assert signals[0].zone.kind == "BEARISH_FVG"
    assert len(trades) == 1
    assert trades[0]["result"] == "TP"
    assert trades[0]["side"] == "LONG"


def test_bullish_gap_inverts_to_short_and_retest_hits_target():
    bars = [
        bar(0, 100, 101, 95, 96),
        bar(300, 96, 98, 94, 95),
        bar(600, 103, 106, 102, 105),  # bullish FVG: zone 101-102
        bar(900, 104, 106, 99, 100),  # closes below zone: inversion
        bar(1200, 100, 102, 98, 99),  # retest and bearish confirmation
    ]
    ticks = [
        tick(1500_000, 99.0, 99.25),
        tick(1501_000, 92.8, 93.05),
    ]

    trades = run_ifvg_reversion(
        bars,
        ticks,
        config=IFVGConfig(entry_start=None, entry_end=None, stop_buffer_points=1.0),
    )

    assert len(trades) == 1
    assert trades[0]["result"] == "TP"
    assert trades[0]["side"] == "SHORT"


def test_unconfirmed_gap_does_not_create_signal():
    bars = [
        bar(0, 100, 105, 99, 104),
        bar(300, 104, 106, 103, 105),
        bar(600, 97, 98, 94, 95),
        bar(900, 98, 99, 96, 97),  # remains below bearish gap; no inversion
        bar(1200, 97, 98, 95, 96),
    ]

    assert detect_ifvg_signals(bars) == []
