"""Pure-function tests for scripts/eval_entry_speed.py (no network, no DB)."""
import datetime as dt

import pytest

from scripts.eval_entry_speed import (
    is_manual_trade,
    parse_ts,
    speed_at_entry,
    summarize,
)

pytestmark = pytest.mark.unit


def _spots(n=30, start=23000.0, step=1.0):
    base = dt.datetime.fromisoformat("2026-10-21T09:15:00+05:30")
    return [
        {"time": (base + dt.timedelta(minutes=i)).isoformat(), "close": start + i * step}
        for i in range(n)
    ]


def test_is_manual_trade_by_strategy_not_symbol_shape():
    # manual / discretionary book
    assert is_manual_trade({"strategy": "agent_discretionary", "symbol": "NIFTY26OCT22700PE"})
    assert is_manual_trade({"strategy": " Agent_Discretionary ", "symbol": "x"})
    # coded straddles are booked with a spaced symbol too — shape is not a signal
    assert not is_manual_trade({"strategy": "straddle", "symbol": "NIFTY 2026-10-19 22850STRADDLE"})
    assert not is_manual_trade({"strategy": "orb", "symbol": "NIFTY 2026-10-27 22700PE"})
    assert not is_manual_trade({"symbol": "NIFTY 2026-10-27 22700PE"})
    assert not is_manual_trade(None)
    assert not is_manual_trade("agent_discretionary")


def test_parse_ts_never_raises():
    assert parse_ts("2026-10-21T09:40:06+05:30") is not None
    assert parse_ts("garbage") is None
    assert parse_ts(None) is None


def test_speed_at_entry_has_no_lookahead():
    spots = _spots(30, step=1.0)  # +1/min; ATR(|dspot|) = 1.0
    entry = dt.datetime.fromisoformat("2026-10-21T09:29:30+05:30")
    speed = speed_at_entry(spots, entry)
    assert speed["bars"] == 15  # rows at 09:15..09:29 only
    assert speed["roc5"] == pytest.approx(5.0)
    assert speed["roc5_atr"] == pytest.approx(5.0)  # fast tape
    assert speed["verdict"] == "FAST"


def test_speed_at_entry_too_early_is_na():
    spots = _spots(30)
    entry = dt.datetime.fromisoformat("2026-10-21T09:15:02+05:30")  # before 2nd row
    speed = speed_at_entry(spots, entry)
    assert speed["bars"] <= 1
    assert speed["verdict"] == "n/a"


def test_summarize_groups_and_skip_slow_counterfactual():
    rows = [
        {"verdict": "SLOW", "net_pnl": -2000.0},
        {"verdict": "SLOW", "net_pnl": -1000.0},
        {"verdict": "NORMAL", "net_pnl": 500.0},
        {"verdict": "FAST", "net_pnl": 1500.0},
        {"verdict": "n/a", "net_pnl": 999.0},  # excluded
        {"verdict": "FAST", "net_pnl": None},  # open, excluded
    ]
    out = summarize(rows)
    assert out["groups"]["SLOW"] == {"n": 2, "total": -3000.0, "avg": -1500.0}
    assert out["groups"]["FAST"] == {"n": 1, "total": 1500.0, "avg": 1500.0}
    assert out["total_all"] == pytest.approx(-1000.0)
    assert out["total_ex_slow"] == pytest.approx(2000.0)
    assert out["skipped"] == 2


def test_summarize_empty():
    out = summarize([])
    assert out == {"groups": {}, "total_all": 0, "total_ex_slow": 0.0, "skipped": 0}
