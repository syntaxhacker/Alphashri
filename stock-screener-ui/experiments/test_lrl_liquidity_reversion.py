from lrl_liquidity_reversion import (
    LRLLiquidityConfig,
    _fit_lrl,
    _htf_bias_by_base_bar,
    _in_window,
    build_bars,
    detect_lrl,
    measured_lrl_config,
)


def bar(timestamp, price=105.0, low=None, high=None):
    return {
        "time": timestamp,
        "open": price,
        "high": high if high is not None else price + 1.0,
        "low": low if low is not None else price - 1.0,
        "close": price,
    }


def tick(timestamp_ms, bid, ask):
    return {"timestamp": timestamp_ms, "bidPrice": bid, "askPrice": ask}


def test_build_bars_uses_bid_ohlc_without_lookahead_order_assumptions():
    ticks = [tick(61_000, 101.0, 101.25), tick(0, 100.0, 100.25), tick(119_000, 99.0, 99.25)]

    assert build_bars(ticks, 60) == [
        {"time": 0, "open": 100.0, "high": 100.0, "low": 100.0, "close": 100.0},
        {"time": 60, "open": 101.0, "high": 101.0, "low": 99.0, "close": 99.0},
    ]


def test_lrl_below_maps_to_short_direction():
    points = [(10, 95.0), (16, 96.0), (22, 97.0)]
    target = _fit_lrl(
        points,
        index=30,
        current_price=105.0,
        tolerance=1.0,
        max_distance=20.0,
        direction="below",
    )

    assert target is not None
    assert target.direction == "below"
    assert target.touches == 3
    assert target.target < 105.0


def test_chart_profile_defaults_to_retesting_the_i_fvg_zone():
    config = LRLLiquidityConfig()

    assert config.entry_start == "18:00"
    assert config.entry_end == "02:00"
    assert config.require_fvg_retest is True


def test_measured_profile_is_explicitly_more_selective():
    config = measured_lrl_config()

    assert config.lrl_min_touches == 4
    assert config.fvg_timeframes_seconds == (180,)
    assert config.require_fvg_retest is True


def test_detect_lrl_requires_confirmed_pivots():
    bars = [bar(index * 60) for index in range(31)]
    for index, low in ((10, 95.0), (16, 96.0), (22, 97.0)):
        bars[index] = bar(index * 60, low=low)

    config = LRLLiquidityConfig(lrl_tolerance_atr=2.0)
    assert detect_lrl(bars, 22, config) is None
    target = detect_lrl(bars, 30, config)
    assert target is not None
    assert target.direction == "below"


def test_asia_window_wraps_midnight():
    # 2026-09-14 20:00 ET and 2026-09-15 01:00 ET are both Asia;
    # 09:30 ET is not.
    from datetime import datetime
    from zoneinfo import ZoneInfo

    et = ZoneInfo("America/New_York")
    for local, expected in (
        (datetime(2026, 9, 14, 20, 0, tzinfo=et), True),
        (datetime(2026, 9, 15, 1, 0, tzinfo=et), True),
        (datetime(2026, 9, 14, 9, 30, tzinfo=et), False),
    ):
        assert _in_window(int(local.timestamp()), "18:00", "02:00") is expected


def test_htf_bias_uses_only_completed_bars():
    base_bars = [bar(index * 60) for index in range(31)]
    htf_bars = [bar(index * 300, price=price) for index, price in enumerate((100, 101, 102, 103, 105))]
    config = LRLLiquidityConfig(
        htf_bias_timeframe_seconds=300,
        htf_fast_ema_period=2,
        htf_slow_ema_period=3,
        require_htf_bias_alignment=True,
    )

    bias = _htf_bias_by_base_bar(base_bars, htf_bars, config)

    assert bias[3] is None
    assert bias[14] == "LONG"
