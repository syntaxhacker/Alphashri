"""Indian index metadata + Upstox instrument-key resolution."""

from __future__ import annotations

import market_data.market_data  # noqa: F401 - adds the repo root to sys.path

from chart_patterns.indices import INDEX_KEYS, INDIAN_INDICES


def test_index_keys_cover_broad_sector_and_bse_indices():
    assert INDEX_KEYS["NIFTY"] == "NSE_INDEX|Nifty 50"
    assert INDEX_KEYS["BANKNIFTY"] == "NSE_INDEX|Nifty Bank"
    assert INDEX_KEYS["FINNIFTY"] == "NSE_INDEX|Nifty Fin Service"
    assert INDEX_KEYS["MIDCPNIFTY"] == "NSE_INDEX|NIFTY MID SELECT"
    assert INDEX_KEYS["NIFTYIT"] == "NSE_INDEX|Nifty IT"
    assert INDEX_KEYS["SENSEX"] == "BSE_INDEX|SENSEX"


def test_index_ids_and_labels_are_unique():
    ids = [row["id"] for row in INDIAN_INDICES]
    labels = [row["label"] for row in INDIAN_INDICES]
    assert len(ids) == len(set(ids))
    assert len(labels) == len(set(labels))


def test_upstox_static_index_lookup_bypasses_instruments_file():
    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI

    api = UpstoxAPI.__new__(UpstoxAPI)
    assert api.get_instrument_key("NIFTY") == "NSE_INDEX|Nifty 50"
    assert api.get_instrument_key("BANKNIFTY") == "NSE_INDEX|Nifty Bank"
    assert api.get_instrument_key("SENSEX") == "BSE_INDEX|SENSEX"
    assert api.get_instrument_key("NIFTYIT") == "NSE_INDEX|Nifty IT"
