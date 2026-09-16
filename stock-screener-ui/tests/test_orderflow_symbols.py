"""Symbol mapping is the single source of truth for app <-> broker symbols."""

import pytest

from api.orderflow_symbols import (
    fyers_symbol,
    from_broker_symbol,
    is_fyers_broker,
    normalize_symbol,
    to_broker_symbol,
    upstox_symbol,
)


class TestNormalize:
    def test_upper_cases_plain_symbols(self):
        assert normalize_symbol(" reliance ") == "RELIANCE"

    def test_preserves_instrument_key_case(self):
        # Upstox index keys are case-sensitive and contain a space.
        assert normalize_symbol("NSE_INDEX|Nifty 50") == "NSE_INDEX|Nifty 50"

    def test_empty_and_none(self):
        assert normalize_symbol(None) == ""
        assert normalize_symbol("") == ""


class TestFyersSymbol:
    def test_bare_name_becomes_equity(self):
        assert fyers_symbol("reliance") == "NSE:RELIANCE-EQ"

    def test_qualified_symbol_passes_through(self):
        assert fyers_symbol("NSE:NIFTY50-INDEX") == "NSE:NIFTY50-INDEX"
        assert fyers_symbol("NSE:SBIN-EQ") == "NSE:SBIN-EQ"

    def test_futures_suffix_is_kept(self):
        assert fyers_symbol("NSE:RELIANCE26OCTFUT") == "NSE:RELIANCE26OCTFUT"


class TestUpstoxSymbol:
    def test_instrument_key_is_identity(self):
        assert upstox_symbol("NSE_EQ|INE002A01018") == "NSE_EQ|INE002A01018"


class TestBrokerDispatch:
    @pytest.mark.parametrize("broker", ["fyers", "fyers_tbt", "FYERS_TBT"])
    def test_fyers_family_uses_fyers_format(self, broker):
        assert to_broker_symbol(broker, "raymond") == "NSE:RAYMOND-EQ"

    @pytest.mark.parametrize("broker", ["upstox", "", None])
    def test_everything_else_is_upstox_identity(self, broker):
        assert to_broker_symbol(broker, "RELIANCE") == "RELIANCE"

    def test_is_fyers_broker(self):
        assert is_fyers_broker("fyers")
        assert is_fyers_broker("fyers_tbt")
        assert not is_fyers_broker("upstox")
        assert not is_fyers_broker(None)


class TestReverseMapping:
    """The reverse mapping is what routes hub ticks to the right subscriber.

    Getting it wrong is how one instrument's price/volume gets attributed to
    another symbol, so every shape is pinned here.
    """

    @pytest.mark.parametrize(
        ("broker_symbol", "expected"),
        [
            ("NSE:RAYMOND-EQ", "RAYMOND"),
            ("NSE:SBIN-EQ", "SBIN"),
            ("NSE:NIFTY50-INDEX", "NIFTY50-INDEX"),
            ("NSE:RELIANCE26OCTFUT", "RELIANCE26OCTFUT"),
            ("BSE:TCS-EQ", "TCS"),
            ("RAYMOND", "RAYMOND"),
        ],
    )
    def test_fyers_broker_symbol_to_app_symbol(self, broker_symbol, expected):
        assert from_broker_symbol("fyers_tbt", broker_symbol) == expected

    def test_upstox_instrument_key_is_returned_verbatim(self):
        assert from_broker_symbol("upstox", "NSE_EQ|INE002A01018") == "NSE_EQ|INE002A01018"
        assert from_broker_symbol("upstox", "NSE_INDEX|Nifty 50") == "NSE_INDEX|Nifty 50"

    def test_blank_input(self):
        assert from_broker_symbol("fyers", "") == ""
        assert from_broker_symbol("fyers", None) == ""

    @pytest.mark.parametrize("symbol", ["RAYMOND", "TCS", "SBIN", "INFY", "ICICIBANK"])
    def test_round_trips_for_distinct_symbols(self, symbol):
        assert from_broker_symbol("fyers_tbt", fyers_symbol(symbol)) == symbol
