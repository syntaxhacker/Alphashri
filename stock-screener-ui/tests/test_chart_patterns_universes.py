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


# Static universes must never contain a symbol the NSE cash feed cannot quote.
# Source: niftyindices.com/IndexConstituent/ind_niftybanklist.csv and the
# BSE Sensex 30 (Wikipedia + TradingView "BSE Sensex" membership, agreeing).
BANKNIFTY_EXPECTED = [
    "AUBANK", "AXISBANK", "BANKBARODA", "CANBK", "FEDERALBNK", "HDFCBANK",
    "ICICIBANK", "IDFCFIRSTB", "INDUSINDBK", "KOTAKBANK", "PNB", "SBIN",
    "UNIONBANK", "YESBANK",
]
SENSEX_EXPECTED = [
    "ADANIPORTS", "ASIANPAINT", "AXISBANK", "BAJFINANCE", "BAJAJFINSV", "BEL",
    "BHARTIARTL", "ETERNAL", "HCLTECH", "HDFCBANK", "HINDUNILVR", "ICICIBANK",
    "INDIGO", "INFY", "ITC", "KOTAKBANK", "LT", "M&M", "MARUTI", "NTPC",
    "POWERGRID", "RELIANCE", "SBIN", "SUNPHARMA", "TCS", "TATASTEEL", "TECHM",
    "TITAN", "TRENT", "ULTRACEMCO",
]


def _canonical_eq_symbols() -> set[str]:
    """Read the checked-in instruments file directly, ignoring test overrides."""
    records = json.loads(universes._CANONICAL.read_text(encoding="utf-8"))
    return {
        str(record["trading_symbol"]).upper()
        for record in records
        if record.get("segment") == "NSE_EQ"
        and record.get("instrument_type") == "EQ"
        and record.get("trading_symbol")
    }


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


@pytest.mark.parametrize("uid", ["nifty100", "nifty200"])
def test_new_market_index_universes_resolve_to_tv_tickers(uid):
    """Registered market id -> full constituent list -> non-empty TV tickers."""
    from api.market_screen.config import UNIVERSES
    from api.tv import to_tv_ticker

    assert uid in UNIVERSES
    assert UNIVERSES[uid].tickers
    symbols = universes.get_universe(uid)
    assert len(symbols) >= 100
    assert all(to_tv_ticker(s) for s in symbols)


def test_banknifty_universe_returns_expected_nse_bank_names():
    assert universes.get_universe("banknifty") == BANKNIFTY_EXPECTED
    assert universes.get_universe("BANKNIFTY") == BANKNIFTY_EXPECTED


def test_sensex_universe_returns_only_nse_resolvable_symbols():
    symbols = universes.get_universe("sensex")
    assert symbols == SENSEX_EXPECTED
    assert len(symbols) == 30
    # TradingView's BSE ticker is NSE:M_M; the NSE cash symbol is M&M.
    assert "M&M" in symbols
    assert "M_M" not in symbols


def test_new_universe_symbols_are_nse_eq_in_the_instruments_file():
    eq = _canonical_eq_symbols()
    for uid in ("banknifty", "sensex"):
        missing = [s for s in universes.get_universe(uid) if s not in eq]
        assert not missing, f"{uid} symbols absent from NSE_EQ/EQ: {missing}"


def test_list_universes_shape(fixture_instruments):
    listing = universes.list_universes()
    ids = [u["id"] for u in listing]
    assert ids == [
        "all_equity", "nse_fo", "indices", "nifty50", "nifty100", "nifty200",
        "nifty500", "banknifty", "sensex",
    ]
    by_id = {u["id"]: u for u in listing}
    assert by_id["all_equity"]["count"] == 2
    assert by_id["nse_fo"]["count"] == 2
    assert by_id["indices"]["count"] == len(universes.get_universe("indices"))
    assert by_id["nifty50"]["count"] == len(universes.get_universe("nifty50"))
    for entry in listing:
        assert set(entry) == {"id", "label", "count"}
        assert isinstance(entry["label"], str) and entry["label"]


def test_indices_universe_contains_broad_and_sector_indices(fixture_instruments):
    ids = universes.get_universe("indices")
    assert "NIFTY" in ids
    assert "BANKNIFTY" in ids
    assert "FINNIFTY" in ids
    assert "MIDCPNIFTY" in ids
    assert "SENSEX" in ids
    assert "NIFTYIT" in ids
    assert len(ids) >= 30
    assert len(ids) == len(set(ids))


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
