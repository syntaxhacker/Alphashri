"""Lane 1: US chart provider core. All yfinance calls are mocked (no network)."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from market_data.providers import (
    DEFAULT_MARKET,
    MarketDataProvider,
    ProviderNoData,
    normalize_us_symbol,
    provider_for,
    register_provider,
    reset_providers,
)
from market_data.providers.symbol_map import NormalizedSymbol
from market_data.providers.yahoo import TIMEFRAMES, YahooProvider


def _frame(index=None, *, volumes=None, closes=None):
    if index is None:
        index = pd.date_range(
            "2026-11-16 14:00", periods=3, freq="1min", tz="America/New_York"
        )
    n = len(index)
    closes = closes if closes is not None else [100.0 + i for i in range(n)]
    return pd.DataFrame(
        {
            "Open": closes,
            "High": [close + 1.0 for close in closes],
            "Low": [close - 1.0 for close in closes],
            "Close": closes,
            "Volume": volumes if volumes is not None else [1000] * n,
        },
        index=index,
    )


def _forming_ohlc_frame():
    """1m frame whose last bar has Volume=0 and identical OHLC."""
    index = pd.date_range("2026-11-16 14:00", periods=2, freq="1min", tz="America/New_York")
    return pd.DataFrame(
        {
            "open": [100.0, 101.0],
            "high": [100.5, 101.0],
            "low": [99.5, 101.0],
            "close": [100.2, 101.0],
            "volume": [1000, 0],
        },
        index=index,
    )


@pytest.fixture
def ticker_cls():
    with patch("yfinance.Ticker") as cls:
        yield cls


def _stub(ticker_cls, frame):
    ticker_cls.return_value.history.return_value = frame
    return ticker_cls.return_value.history


class TestYahooCandles:
    def test_frame_normalization(self, ticker_cls):
        index = pd.to_datetime(
            [
                "2026-11-16 14:02",
                "2026-11-16 14:00",
                "2026-11-16 14:01",
                "2026-11-16 14:01",
                "2026-11-16 14:03",
            ]
        )
        frame = pd.DataFrame(
            {
                ("Open", "AAPL"): [102.0, 100.0, 101.0, 999.0, 103.0],
                ("High", "AAPL"): [103.0, 101.0, 102.0, 999.0, 104.0],
                ("Low", "AAPL"): [101.0, 99.0, 100.0, 999.0, 102.0],
                ("Close", "AAPL"): [102.5, 100.5, 101.5, 999.0, 103.5],
                ("Volume", "AAPL"): [1000, 1000, 1000, 1000, 1000],
            },
            index=index,
        )
        frame.columns = pd.MultiIndex.from_tuples(frame.columns)
        frame.iloc[0, frame.columns.get_loc(("Close", "AAPL"))] = float("nan")
        history = _stub(ticker_cls, frame)

        df = YahooProvider().candles("AAPL", "5m")

        assert list(df.columns) == ["open", "high", "low", "close", "volume"]
        assert df.index.tz is not None and str(df.index.tz) == "UTC"
        assert df.index.is_monotonic_increasing
        assert not df.index.has_duplicates
        assert df["close"].notna().all()
        assert len(df) == 3  # NaN row + duplicate timestamp removed
        assert df.iloc[-1]["close"] == 103.5
        history.assert_called_once()

    def test_naive_index_localized_to_us_eastern(self, ticker_cls):
        index = pd.date_range("2026-11-16 14:00", periods=2, freq="1min")
        _stub(ticker_cls, _frame(index))

        df = YahooProvider().candles("AAPL", "5m")

        assert str(df.index[0]) == "2026-11-16 19:00:00+00:00"

    def test_tz_aware_index_converted_to_utc(self, ticker_cls):
        index = pd.date_range(
            "2026-11-16 14:00", periods=2, freq="1min", tz="America/New_York"
        )
        _stub(ticker_cls, _frame(index))

        df = YahooProvider().candles("AAPL", "5m")

        assert str(df.index[0]) == "2026-11-16 19:00:00+00:00"

    def test_forming_bar_dropped_for_1m(self, ticker_cls):
        _stub(ticker_cls, _forming_ohlc_frame())

        df = YahooProvider().candles("AAPL", "1m")

        assert len(df) == 1
        assert df.attrs["partial_last"] is True
        assert df.attrs["forming_dropped"] is True

    def test_forming_bar_kept_for_non_1m(self, ticker_cls):
        _stub(ticker_cls, _forming_ohlc_frame())

        df = YahooProvider().candles("AAPL", "5m")

        assert len(df) == 2
        assert df.attrs["forming_dropped"] is False

    def test_drop_forming_false_keeps_bar(self, ticker_cls):
        _stub(ticker_cls, _forming_ohlc_frame())

        df = YahooProvider(drop_forming=False).candles("AAPL", "1m")

        assert len(df) == 2
        assert df.attrs["partial_last"] is True
        assert df.attrs["forming_dropped"] is False

    def test_zero_volume_bar_with_unequal_ohlc_kept(self, ticker_cls):
        index = pd.date_range(
            "2026-11-16 14:00", periods=2, freq="1min", tz="America/New_York"
        )
        _stub(ticker_cls, _frame(index, volumes=[1000, 0]))

        df = YahooProvider().candles("AAPL", "1m")

        assert len(df) == 2
        assert df.attrs["partial_last"] is False

    def test_empty_frame_raises_provider_no_data(self, ticker_cls):
        _stub(ticker_cls, pd.DataFrame())

        with pytest.raises(ProviderNoData):
            YahooProvider().candles("AAPL", "1m")

    def test_missing_ohlcv_columns_raises_provider_no_data(self, ticker_cls):
        _stub(ticker_cls, pd.DataFrame({"close": [1.0]}))

        with pytest.raises(ProviderNoData):
            YahooProvider().candles("AAPL", "1m")

    def test_upstream_error_raises_provider_no_data(self, ticker_cls):
        ticker_cls.return_value.history.side_effect = RuntimeError("429 rate limited")

        with pytest.raises(ProviderNoData):
            YahooProvider().candles("AAPL", "1m")

    def test_unsupported_timeframe_raises_provider_no_data(self, ticker_cls):
        with pytest.raises(ProviderNoData):
            YahooProvider().candles("AAPL", "2m")
        ticker_cls.assert_not_called()

    @pytest.mark.parametrize("timeframe,expected", list(TIMEFRAMES.items()))
    def test_timeframe_call_args(self, ticker_cls, timeframe, expected):
        history = _stub(ticker_cls, _frame())

        YahooProvider().candles("AAPL", timeframe)

        history.assert_called_once_with(
            interval=expected[0],
            period=expected[1],
            auto_adjust=True,
            prepost=False,
            actions=False,
        )

    def test_vendor_symbol_passed_to_ticker(self, ticker_cls):
        _stub(ticker_cls, _frame())

        YahooProvider().candles("NASDAQ:BRK.B", "5m")

        ticker_cls.assert_called_once_with("BRK-B")

    def test_quote_returns_none(self):
        assert YahooProvider().quote("AAPL") is None

    def test_protocol_conformance(self):
        assert isinstance(YahooProvider(), MarketDataProvider)


class TestSymbolMap:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("BRK.B", "BRK-B"),
            ("BF.B", "BF-B"),
            ("NASDAQ:aapl", "AAPL"),
            ("NYSE: BRK.B", "BRK-B"),
            ("amex:spy", "SPY"),
            ("  msft  ", "MSFT"),
        ],
    )
    def test_normalization_preserves_display(self, raw, expected):
        result = normalize_us_symbol(raw)

        assert isinstance(result, str)
        assert isinstance(result, NormalizedSymbol)
        assert result == expected
        assert result.display_symbol == raw.strip()

    def test_empty_symbol_raises(self):
        with pytest.raises(ValueError):
            normalize_us_symbol("  ")


class TestRegistry:
    def setup_method(self):
        reset_providers()

    def teardown_method(self):
        reset_providers()

    def test_unknown_and_none_default_to_india(self):
        assert DEFAULT_MARKET == "india"
        for market in (None, "", "india", "unknown"):
            assert provider_for(market).market == "india"

    def test_usa_defaults_to_yahoo(self):
        provider = provider_for("usa")

        assert provider.market == "usa"
        assert provider.feed == "yahoo"

    def test_register_instance_and_lookup_is_case_insensitive(self):
        dummy = MagicMock()
        dummy.market = "test"

        register_provider("TEST", dummy)

        assert provider_for(" test ") is dummy
        assert provider_for("unknown").market == "india"

    def test_register_factory_is_instantiated_lazily(self):
        sentinel = MagicMock()
        sentinel.market = "lazy"
        calls = []

        def factory():
            calls.append(1)
            return sentinel

        register_provider("lazy", factory)
        assert calls == []
        assert provider_for("lazy") is sentinel
        assert calls == [1]
        assert provider_for("lazy") is sentinel
        assert calls == [1]  # cached after first resolution
