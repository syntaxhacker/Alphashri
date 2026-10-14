"""Tests for the Nifty report `market` session gate."""

from api.reports_api import nifty


def test_market_block_shape_when_open(monkeypatch):
    import trading.utils as tu

    monkeypatch.setattr(tu, "is_market_open", lambda: True)
    out = nifty.market_block()
    assert set(out) == {"is_open", "session_date", "as_of"}
    assert out["is_open"] is True
    assert out["session_date"]  # non-empty IST date


def test_market_block_false_when_closed(monkeypatch):
    import trading.utils as tu

    monkeypatch.setattr(tu, "is_market_open", lambda: False)
    assert nifty.market_block()["is_open"] is False


def test_market_block_degrades_to_closed_on_error(monkeypatch):
    import trading.utils as tu

    def boom():
        raise RuntimeError("no calendar")

    monkeypatch.setattr(tu, "is_market_open", boom)
    assert nifty.market_block()["is_open"] is False
