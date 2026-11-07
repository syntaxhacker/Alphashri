"""1D live-edge: the synthetic today bar only exists on a trading day."""
from datetime import date

import pandas as pd

import market_data.market_data as md
from chart_patterns import candles


def _daily(last_day: str) -> pd.DataFrame:
    idx = pd.DatetimeIndex([pd.Timestamp(f"{last_day} 18:30", tz="UTC")])
    return pd.DataFrame(
        {"open": [1.0], "high": [2.0], "low": [0.5], "close": [1.5], "volume": [100]},
        index=idx,
    )


def _spy(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(md, "_fetch_backfill_tape", lambda *a, **k: calls.append("tape"))
    monkeypatch.setattr(md, "_synthetic_today_bar", lambda *a, **k: calls.append("synth"))
    return calls


def test_non_trading_day_never_fetches_the_partial_tape(monkeypatch):
    monkeypatch.setattr(candles, "_last_completed_session", lambda *a, **k: date(2026, 11, 6))
    monkeypatch.setattr(candles, "_is_trading_day", lambda d: False)
    calls = _spy(monkeypatch)

    out = md._daily_live_edge(None, "X", _daily("2026-11-06"), "2026-11-07", True)

    assert calls == []
    assert len(out) == 1


def test_trading_day_still_fetches_tape_and_synth(monkeypatch):
    # Monday's session is missing from the frame: backfill + partial both run.
    monkeypatch.setattr(candles, "_last_completed_session", lambda *a, **k: date(2026, 11, 9))
    monkeypatch.setattr(candles, "_is_trading_day", lambda d: True)
    calls = _spy(monkeypatch)

    md._daily_live_edge(None, "X", _daily("2026-11-05"), "2026-11-09", True)

    assert "tape" in calls
    assert "synth" in calls


def test_with_partial_today_skips_the_intraday_call_on_a_non_trading_day(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(candles, "_today_is_session", lambda: False)
    monkeypatch.setattr(md, "_synthetic_today_bar", lambda *a, **k: calls.append("synth"))

    out = candles._with_partial_today(_daily("2026-11-05"), "X")

    assert calls == []
    assert len(out) == 1
