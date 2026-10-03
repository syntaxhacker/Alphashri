"""Universe resolution tests using a small fixture instruments JSON."""

from __future__ import annotations

import json

import pytest

from chart_patterns import universes

FIXTURE = [
    {"segment": "NSE_EQ", "instrument_type": "EQ", "trading_symbol": "RELIANCE"},
    {"segment": "NSE_EQ", "instrument_type": "EQ", "trading_symbol": "TCS"},
    {"segment": "NSE_EQ", "instrument_type": "SG", "trading_symbol": "SDL7.5"},
    {
        "segment": "NSE_FO",
        "underlying_type": "EQUITY",
        "underlying_symbol": "RELIANCE",
        "trading_symbol": "RELIANCE FUT",
    },
    {
        "segment": "NSE_FO",
        "underlying_type": "EQUITY",
        "underlying_symbol": "INFY",
        "trading_symbol": "INFY OPT",
    },
    {
        "segment": "NSE_FO",
        "underlying_type": "INDEX",
        "underlying_symbol": "NIFTY",
        "trading_symbol": "NIFTY OPT",
    },
    {"segment": "NSE_INDEX", "instrument_type": "INDEX", "trading_symbol": "NIFTY"},
]


@pytest.fixture
def fixture_instruments(tmp_path):
    path = tmp_path / "nse_instruments.json"
    path.write_text(json.dumps(FIXTURE), encoding="utf-8")
    universes.set_instruments_path(path)
    yield path
    universes.set_instruments_path(None)


def test_all_equity_filters_segment_and_type(fixture_instruments):
    assert universes.get_universe("all_equity") == ["RELIANCE", "TCS"]


def test_nse_fo_uses_equity_underlyings(fixture_instruments):
    assert universes.get_universe("nse_fo") == ["INFY", "RELIANCE"]


def test_nifty_lists_are_static_and_case_insensitive(fixture_instruments):
    nifty50 = universes.get_universe("NIFTY50")
    assert "RELIANCE" in nifty50
    assert "TCS" in nifty50
    assert len(nifty50) >= 50
    assert universes.get_universe("nifty500") == universes.get_universe("NIFTY500")
    assert len(universes.get_universe("nifty500")) >= 500


def test_list_universes_shape(fixture_instruments):
    listing = universes.list_universes()
    ids = [u["id"] for u in listing]
    assert ids == ["all_equity", "nse_fo", "nifty50", "nifty100", "nifty200", "nifty500"]
    by_id = {u["id"]: u for u in listing}
    assert by_id["all_equity"]["count"] == 2
    assert by_id["nse_fo"]["count"] == 2
    assert by_id["nifty50"]["count"] == len(universes.get_universe("nifty50"))
    for entry in listing:
        assert set(entry) == {"id", "label", "count"}
        assert isinstance(entry["label"], str) and entry["label"]


def test_unknown_universe_raises(fixture_instruments):
    with pytest.raises(ValueError):
        universes.get_universe("does_not_exist")


def test_instruments_are_cached_until_clear(fixture_instruments):
    assert universes.get_universe("all_equity") == ["RELIANCE", "TCS"]
    # Rewrite the file; cached result must not change.
    extra = FIXTURE + [
        {"segment": "NSE_EQ", "instrument_type": "EQ", "trading_symbol": "WIPRO"}
    ]
    fixture_instruments.write_text(json.dumps(extra), encoding="utf-8")
    assert universes.get_universe("all_equity") == ["RELIANCE", "TCS"]
    universes.clear_cache()
    assert universes.get_universe("all_equity") == ["RELIANCE", "TCS", "WIPRO"]


def test_missing_file_does_not_crash(tmp_path):
    universes.set_instruments_path(tmp_path / "missing.json")
    try:
        assert universes.get_universe("all_equity") == []
        assert universes.get_universe("nse_fo") == []
        # Static universes still work without the instruments file.
        assert len(universes.get_universe("nifty50")) >= 50
    finally:
        universes.set_instruments_path(None)


def test_instruments_path_override(fixture_instruments):
    assert universes.instruments_path() == fixture_instruments
    assert universes.instruments_path().exists()
