"""Setup classification for Nifty OI alerts."""

from api.reports_api.nifty_fuel import (
    SETUP_CALL_CAP,
    SETUP_FRESH_LONG,
    SETUP_FRESH_SHORT,
    SETUP_PUT_FLOOR,
    SETUP_PUT_SQUEEZE,
    SETUP_SHORT_SQUEEZE,
    SETUP_WALL_SQUEEZE,
    setup_for_burst,
)


def test_call_covering_near_wall_is_a_scalp_short_squeeze():
    out = setup_for_burst(
        side="call",
        fuel="writers_covering",
        trend="up",
        spot=24_995,
        wall=25_000,
        score=3.6,
    )
    assert out["setup"] == SETUP_SHORT_SQUEEZE
    assert out["horizon"] == "scalp"
    assert out["trigger"] == 25_000
    assert "1-min close above 25,000" in out["playbook"]


def test_wall_break_squeeze_is_the_swing_setup():
    out = setup_for_burst(side="call", fuel="writers_covering", burst_type="squeeze", wall=25_000, score=2.2)
    assert out["setup"] == SETUP_WALL_SQUEEZE
    assert out["horizon"] == "swing"
    assert out["confidence"] == "high"


def test_fresh_buying_is_swing_only_with_trend():
    up = setup_for_burst(side="call", fuel="fresh_buyers", trend="up", wall=25_000)
    down = setup_for_burst(side="call", fuel="fresh_buyers", trend="down", wall=25_000)
    assert up["setup"] == SETUP_FRESH_LONG
    assert up["horizon"] == "swing" and up["confidence"] == "high"
    assert down["horizon"] == "watch" and down["confidence"] == "medium"


def test_put_writer_floor():
    out = setup_for_burst(side="put", fuel="fresh_sellers", wall=24_950)
    assert out["setup"] == SETUP_PUT_FLOOR
    assert out["horizon"] == "watch"


def test_put_covering_below_wall_is_a_put_squeeze():
    out = setup_for_burst(side="put", fuel="writers_covering", wall=24_950)
    assert out["setup"] == SETUP_PUT_SQUEEZE
    assert out["horizon"] == "scalp"


def test_call_writers_and_put_buyers_are_watch_only():
    assert setup_for_burst(side="call", fuel="fresh_sellers", wall=25_000)["setup"] == SETUP_CALL_CAP
    assert setup_for_burst(side="put", fuel="fresh_buyers", wall=24_950)["setup"] == SETUP_FRESH_SHORT


def test_unknown_fuel_has_no_setup():
    assert setup_for_burst(side="call", fuel=None, wall=25_000) == {}
