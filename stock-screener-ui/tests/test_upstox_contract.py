"""Pure-function tests for scripts/upstox_contract.py (no network, no DB writes)."""
import json

import pytest

from scripts.upstox_contract import (
    cache_path,
    find_contract,
    load_cached_contracts,
    parse_chain_payload,
    parse_contract_payload,
    save_cached_contracts,
)

pytestmark = pytest.mark.unit

CONTRACT_FIXTURE = {
    "status": "success",
    "data": [
        {"name": "NIFTY", "segment": "NSE_FO", "exchange": "NSE", "expiry": "2026-10-27",
         "instrument_key": "NSE_FO|111", "exchange_token": "111",
         "trading_symbol": "NIFTY 23000 CE 27 OCT 26", "tick_size": 5, "lot_size": 75,
         "instrument_type": "CE", "strike_price": 23000.0},
        {"name": "NIFTY", "segment": "NSE_FO", "exchange": "NSE", "expiry": "2026-10-27",
         "instrument_key": "NSE_FO|222", "exchange_token": "222",
         "trading_symbol": "NIFTY 23000 PE 27 OCT 26", "tick_size": 5, "lot_size": 75,
         "instrument_type": "PE", "strike_price": 23000.0},
        {"name": "NIFTY", "segment": "NSE_FO", "exchange": "NSE", "expiry": "2026-10-27",
         "instrument_key": "NSE_FO|333", "exchange_token": "333",
         "trading_symbol": "NIFTY 23100 CE 27 OCT 26", "tick_size": 5, "lot_size": 75,
         "instrument_type": "CE", "strike_price": 23100.0},
    ],
}

CHAIN_FIXTURE = {
    "status": "success",
    "data": [
        {"expiry": "2026-10-27", "strike_price": 23000, "underlying_key": "NSE_INDEX|Nifty 50",
         "call_options": {"instrument_key": "NSE_FO|111", "market_data": {"ltp": 10.0}},
         "put_options": {"instrument_key": "NSE_FO|222", "market_data": {"ltp": 12.0}}},
        {"expiry": "2026-10-27", "strike_price": 23100, "underlying_key": "NSE_INDEX|Nifty 50",
         "call_options": {"instrument_key": "NSE_FO|333", "market_data": {"ltp": 5.0}},
         "put_options": {"instrument_key": "NSE_FO|444", "market_data": {"ltp": 20.0}}},
    ],
}


def test_parse_contract_rows():
    rows = parse_contract_payload(CONTRACT_FIXTURE, underlying="NSE_INDEX|Nifty 50")
    assert len(rows) == 3
    assert rows[0] == {"instrument_key": "NSE_FO|111", "strike": 23000.0, "opt": "CE",
                       "expiry": "2026-10-27", "underlying": "NSE_INDEX|Nifty 50",
                       "trading_symbol": "NIFTY 23000 CE 27 OCT 26",
                       "lot_size": 75, "tick_size": 5}
    # Without an explicit underlying the row is still stamped (blank), so a
    # cache writer can never mistake it for a stamped row of another index.
    unstamped = parse_contract_payload(CONTRACT_FIXTURE)
    assert unstamped[0]["underlying"] == ""


def test_parse_contract_malformed():
    assert parse_contract_payload({}) == []
    assert parse_contract_payload(None) == []
    assert parse_contract_payload({"data": "junk"}) == []
    # rows missing key / strike / side are skipped
    rows = parse_contract_payload({"data": [
        {"instrument_key": "NSE_FO|1", "strike_price": 1},
        {"strike_price": 1, "instrument_type": "CE"},
        {"instrument_key": "NSE_FO|2", "instrument_type": "XX", "strike_price": 2},
        {"instrument_key": "NSE_FO|3", "instrument_type": "CE", "strike_price": "x"},
        {"instrument_key": "NSE_FO|4", "instrument_type": "CE", "strike_price": float("nan")},
    ]})
    assert rows == []


def test_find_contract_exact_and_case():
    rows = parse_contract_payload(CONTRACT_FIXTURE)
    assert find_contract(rows, 23000, "CE")["instrument_key"] == "NSE_FO|111"
    assert find_contract(rows, 23000, "pe")["instrument_key"] == "NSE_FO|222"
    assert find_contract(rows, 23100, "CE")["instrument_key"] == "NSE_FO|333"
    assert find_contract(rows, 23200, "CE") is None
    assert find_contract(rows, 23000, "XX") is None
    assert find_contract([], 23000, "CE") is None


def test_parse_chain_legs():
    rows = parse_chain_payload(CHAIN_FIXTURE)
    assert len(rows) == 4
    assert find_contract(rows, 23000, "CE")["instrument_key"] == "NSE_FO|111"
    assert find_contract(rows, 23000, "PE")["instrument_key"] == "NSE_FO|222"
    assert find_contract(rows, 23100, "PE")["instrument_key"] == "NSE_FO|444"


def test_parse_chain_malformed():
    assert parse_chain_payload({}) == []
    assert parse_chain_payload(None) == []
    rows = parse_chain_payload({"data": [
        {"strike_price": 1},  # no legs
        {"strike_price": 2, "call_options": {}, "put_options": {"instrument_key": "NSE_FO|9"}},
        {"call_options": {"instrument_key": "NSE_FO|8"}},  # no strike
    ]})
    assert rows == [{"instrument_key": "NSE_FO|9", "strike": 2.0, "opt": "PE",
                     "expiry": "", "underlying": "", "trading_symbol": "",
                     "lot_size": None, "tick_size": None}]


def test_parse_chain_stamps_row_underlying_when_absent():
    rows = parse_chain_payload({"data": [
        {"strike_price": 23000, "call_options": {"instrument_key": "NSE_FO|1"}},
    ]})
    assert rows[0]["underlying"] == ""
    stamped = parse_chain_payload({"data": [
        {"strike_price": 23000, "underlying_key": "NSE_INDEX|Bank Nifty",
         "call_options": {"instrument_key": "NSE_FO|1"}},
    ]})
    assert stamped[0]["underlying"] == "NSE_INDEX|Bank Nifty"


# ---------------------------------------------------------------------------
# Cache is per underlying, never per expiry only (BANKNIFTY != NIFTY)
# ---------------------------------------------------------------------------

NIFTY_KEY = "NSE_INDEX|Nifty 50"
BANK_KEY = "NSE_INDEX|Bank Nifty"


def test_cache_path_is_per_underlying():
    assert cache_path("2026-10-27", "/tmp/x", NIFTY_KEY).name == "NIFTY_2026-10-27.json"
    assert cache_path("2026-10-27", "/tmp/x", BANK_KEY).name == "BANKNIFTY_2026-10-27.json"
    # unknown underlyings get their own sanitised file, never NIFTY's
    assert cache_path("2026-10-27", "/tmp/x", "NSE_INDEX|Nifty Next 50").name != \
        "NIFTY_2026-10-27.json"


def test_banknifty_lookup_cannot_read_the_nifty_cache(tmp_path):
    nifty_rows = parse_contract_payload(CONTRACT_FIXTURE, underlying=NIFTY_KEY)
    save_cached_contracts("2026-10-27", nifty_rows, tmp_path, NIFTY_KEY)

    assert load_cached_contracts("2026-10-27", tmp_path, BANK_KEY) is None
    assert find_contract(
        load_cached_contracts("2026-10-27", tmp_path, NIFTY_KEY) or [],
        23000, "CE", underlying=BANK_KEY) is None

    # a hand-copied NIFTY cache file under the BANKNIFTY name is a MISS, not a hit
    bank_path = cache_path("2026-10-27", tmp_path, BANK_KEY)
    bank_path.write_text(cache_path("2026-10-27", tmp_path, NIFTY_KEY).read_text(),
                         encoding="utf-8")
    assert load_cached_contracts("2026-10-27", tmp_path, BANK_KEY) is None


def test_find_contract_skips_rows_of_another_underlying():
    rows = parse_contract_payload(CONTRACT_FIXTURE, underlying=NIFTY_KEY)
    assert find_contract(rows, 23000, "CE", underlying=NIFTY_KEY) is not None
    assert find_contract(rows, 23000, "CE", underlying=BANK_KEY) is None
    # unstamped legacy rows still match (the caller's underlying is the filter)
    legacy = [{"instrument_key": "NSE_FO|1", "strike": 23000.0, "opt": "CE"}]
    assert find_contract(legacy, 23000, "CE", underlying=BANK_KEY) is not None


def test_cache_roundtrip(tmp_path):
    rows = parse_contract_payload(CONTRACT_FIXTURE)
    path = save_cached_contracts("2026-10-27", rows, tmp_path)
    assert path == cache_path("2026-10-27", tmp_path)
    loaded = load_cached_contracts("2026-10-27", tmp_path)
    assert loaded == rows
    assert find_contract(loaded, 23000, "CE")["instrument_key"] == "NSE_FO|111"


def test_cache_missing_and_corrupt(tmp_path):
    assert load_cached_contracts("2099-01-01", tmp_path) is None
    bad = tmp_path / "NIFTY_2099-01-01.json"
    bad.write_text("{not json", encoding="utf-8")
    assert load_cached_contracts("2099-01-01", tmp_path) is None
    bad.write_text(json.dumps({"contracts": []}), encoding="utf-8")
    assert load_cached_contracts("2099-01-01", tmp_path) is None
