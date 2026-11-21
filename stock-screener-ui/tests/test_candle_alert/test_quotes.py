from unittest.mock import patch

import pandas as pd
import pytest

from candle_alert import quotes as quotes_mod
from candle_alert.quotes import Quote, QuoteFetchError, cached_quotes, change_pair, fetch_quotes


def _one_hour_frame(closes):
    start = pd.Timestamp("2026-01-01 00:00:00", tz="UTC")
    idx = pd.date_range(start=start, periods=len(closes), freq="1h")
    values = [float(c) for c in closes]
    return pd.DataFrame({
        "Close": values,
        "High": [v + 1 for v in values],
        "Low": [v - 1 for v in values],
    }, index=idx)


class _Ticker:
    def __init__(self, history_value=None, history_error=None):
        self._history_value = history_value
        self._history_error = history_error

    def history(self, **kwargs):
        if self._history_error is not None:
            raise self._history_error
        return self._history_value


def test_change_pair():
    assert change_pair(110.0, 100.0) == pytest.approx((10.0, 10.0))
    assert change_pair(90.0, 100.0) == pytest.approx((-10.0, -10.0))
    assert change_pair(50.0, 0.0) == pytest.approx((50.0, 0.0))


def test_fetch_quotes():
    frame = _one_hour_frame([100, 110, 120, 130, 140, 150, 160, 170, 180, 190])
    symbols = (("GOLD", "GC=F"),)

    with patch.object(quotes_mod.yfinance, "Ticker") as ticker:
        ticker.return_value.history.return_value = frame
        result = fetch_quotes(symbols)

    ticker.assert_called_once_with("GC=F")
    ticker.return_value.history.assert_called_once_with(
        period="10d", interval="1h", auto_adjust=False
    )

    # The last 1H bar is 09:00, so the 08:00 4H bucket is still open; the last
    # completed 4H candle is 04:00-08:00 (close 170, high 171, low 139).
    assert result["GOLD"] == Quote(
        label="GOLD",
        price=190.0,
        prev_1h=180.0,
        prev_4h=170.0,
        low_1h=179.0,
        high_1h=181.0,
        low_4h=139.0,
        high_4h=171.0,
    )


def test_fetch_quotes_too_few_rows():
    frame = _one_hour_frame([100.0])
    symbols = (("GOLD", "GC=F"),)

    with patch.object(quotes_mod.yfinance, "Ticker", return_value=_Ticker(history_value=frame)):
        with pytest.raises(QuoteFetchError, match="GOLD"):
            fetch_quotes(symbols)


def test_fetch_quotes_history_exception():
    symbols = (("NQ", "NQ=F"),)

    with patch.object(
        quotes_mod.yfinance,
        "Ticker",
        return_value=_Ticker(history_error=RuntimeError("boom")),
    ):
        with pytest.raises(QuoteFetchError, match="NQ"):
            fetch_quotes(symbols)


def test_cached_quotes(monkeypatch):
    monkeypatch.setattr(quotes_mod, "_cache", {"quotes": {}, "at": 0.0})

    first = {"GOLD": Quote("GOLD", 1.0, 1.0, 1.0)}
    second = {"GOLD": Quote("GOLD", 2.0, 2.0, 2.0)}
    third = {"GOLD": Quote("GOLD", 3.0, 3.0, 3.0)}

    with patch.object(quotes_mod, "fetch_quotes", side_effect=[first, second, third]) as fetch:
        assert cached_quotes(ttl_seconds=30, now=1000) == first
        assert cached_quotes(ttl_seconds=30, now=1010) == first
        assert cached_quotes(ttl_seconds=30, now=1035) == second
        assert cached_quotes(ttl_seconds=30, now=1036, force=True) == third

    assert fetch.call_count == 3
