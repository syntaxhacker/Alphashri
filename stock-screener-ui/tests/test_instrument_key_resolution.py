"""Instrument-key resolution for non-EQ NSE equity series.

The strict ``EQ`` pass is the first choice. Every other tradeable NSE_EQ series
(SME, trade-to-trade, InvIT/REIT units, part-paid) needs the fallback, otherwise
its chart returns ``no_data``. Government paper must never resolve through it —
a bond key in an equity path is worse than a missing one.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

_UI_DIR = Path(__file__).resolve().parent.parent
_ROOT = _UI_DIR.parent
for _p in (str(_ROOT), str(_UI_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import upstox_trader.config_and_utils.upstox_api as upstox_api_module
from upstox_trader.config_and_utils.upstox_api import (
    EQUITY_FALLBACK_TYPES,
    UpstoxAPI,
)

# type -> (symbol, key) taken from the real NSE instrument master.
REAL_LISTINGS = {
    "SM": ("PRIZOR", "NSE_EQ|INE0V9N01017"),
    "ST": ("KLL", "NSE_EQ|INE0Q2V01012"),
    "SZ": ("PERFECT", "NSE_EQ|INE925S01012"),
    "IV": ("CUBEINVIT", "NSE_EQ|INE0NR623014"),
    "RR": ("MINDSPACE", "NSE_EQ|INE0CCU25019"),
    "E1": ("ATLPP", "NSE_EQ|IN90NN701011"),
    "BE": ("QUINTEGRA", "NSE_EQ|INE033B01011"),
    "BZ": ("CRSL", "NSE_EQ|INE716D01033"),
}


@pytest.fixture(autouse=True)
def _no_symbol_validator():
    """Keep the resolver hermetic — the real validator blacklists synthetic tickers."""
    with patch.object(upstox_api_module, "get_valid_symbol", lambda s: str(s).upper()):
        yield


def _row(symbol: str, key: str, instrument_type: str, segment: str = "NSE_EQ") -> dict:
    return {
        "trading_symbol": symbol,
        "instrument_key": key,
        "instrument_type": instrument_type,
        "segment": segment,
    }


def _api(*rows: dict) -> UpstoxAPI:
    api = UpstoxAPI.__new__(UpstoxAPI)
    api.instruments = list(rows)
    api.quiet = True
    return api


# Deliberately test-owned rather than derived from EQUITY_FALLBACK_TYPES: a type
# dropped from the constant must surface as a failure on its own case, not
# vanish with the parametrisation.
@pytest.mark.parametrize("instrument_type", sorted(REAL_LISTINGS))
def test_non_eq_equity_series_resolve_through_the_fallback(instrument_type):
    symbol, key = REAL_LISTINGS[instrument_type]
    assert _api(_row(symbol, key, instrument_type)).get_instrument_key(symbol) == key


def test_the_covered_types_are_exactly_the_equity_series():
    assert set(EQUITY_FALLBACK_TYPES) == {"BE", "BZ", "SM", "ST", "SZ", "IV", "RR", "E1"}


@pytest.mark.parametrize("instrument_type", ["SG", "GS", "TB"])
def test_government_paper_never_resolves_through_the_equity_fallback(instrument_type):
    api = _api(_row("883GS2041", "NSE_EQ|IN0020110063", instrument_type))
    assert api.get_instrument_key("883GS2041") is None


def test_eq_still_wins_when_the_symbol_is_listed_as_both():
    api = _api(
        _row("DUALLISTED", "NSE_EQ|SMESERIES", "SM"),
        _row("DUALLISTED", "NSE_EQ|MAINSERIES", "EQ"),
    )
    assert api.get_instrument_key("DUALLISTED") == "NSE_EQ|MAINSERIES"


def test_fallback_is_scoped_to_the_requested_exchange():
    api = _api(_row("PRIZOR", "NSE_EQ|INE0V9N01017", "SM"))
    assert api.get_instrument_key("PRIZOR", exchange="BSE_EQ") is None


def test_sme_row_in_a_non_nse_segment_does_not_resolve():
    api = _api(_row("PRIZOR", "BSE_EQ|INE0V9N01017", "SM", segment="BSE_EQ"))
    assert api.get_instrument_key("PRIZOR") is None
