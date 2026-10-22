"""Pure-function tests for scripts/futures_volume.py (no network, no DB writes)."""
import pytest

from scripts.futures_volume import (
    compute_rvol,
    is_nifty_futures_symbol,
    parse_candles,
    parse_search_payload,
    pick_current_month,
    window_volumes,
)

pytestmark = pytest.mark.unit

SEARCH_FIXTURE = {
    "status": "success",
    "data": [
        {"instrument_key": "NSE_FO|1", "trading_symbol": "NIFTY 28 OCT 25 FUT",
         "instrument_type": "FUT", "segment": "NSE_FO", "expiry": "2025-10-28"},
        {"instrument_key": "NSE_FO|2", "trading_symbol": "NIFTY 25 NOV 25 FUT",
         "instrument_type": "FUT", "segment": "NSE_FO", "expiry": "2025-11-25"},
        {"instrument_key": "NSE_FO|3", "trading_symbol": "NIFTY 30 SEP 25 FUT",
         "instrument_type": "FUT", "segment": "NSE_FO", "expiry": "2025-09-30"},
        {"instrument_key": "NSE_EQ|4", "trading_symbol": "RELIANCE",
         "instrument_type": "EQ", "segment": "NSE_EQ"},
    ],
    "meta_data": {"page": {"page_number": 1}},
}


def _candles(volumes):
    # V3 rows are [ts, o, h, l, c, volume, oi], newest-first on the wire.
    rows = [[f"2026-10-21T09:{i:02d}:00+05:30", 1, 2, 1, 2, v, 0] for i, v in enumerate(volumes)]
    return {"status": "success", "data": {"candles": list(reversed(rows))}}


def test_parse_search_keeps_futures_only():
    rows = parse_search_payload(SEARCH_FIXTURE)
    assert [r["instrument_key"] for r in rows] == ["NSE_FO|1", "NSE_FO|2", "NSE_FO|3"]
    assert parse_search_payload({}) == []
    assert parse_search_payload(None) == []


@pytest.mark.parametrize("symbol", [
    "NIFTY 28 OCT 25 FUT",
    "NIFTY FUT 27 OCT 2026",
    "NIFTY26OCTFUT",
])
def test_is_nifty_futures_symbol_accepts_nifty_only(symbol):
    assert is_nifty_futures_symbol(symbol) is True


@pytest.mark.parametrize("symbol", [
    "BANKNIFTY 28 OCT 25 FUT",     # starts with BANKNIFTY, not NIFTY
    "FINNIFTY 28 OCT 25 FUT",
    "MIDCPNIFTY 28 OCT 25 FUT",
    "NIFTYNXT50 28 OCT 25 FUT",
    "NIFTY 23000 CE 27 OCT 26",    # an option, not a future
    "NIFTY 23000 PE 27 OCT 26",
    "",
    None,
])
def test_is_nifty_futures_symbol_rejects_other_indices_and_options(symbol):
    assert is_nifty_futures_symbol(symbol) is False


def test_banknifty_row_never_wins_the_nifty_proxy():
    # The old check was ``"NIFTY" in symbol`` -> True for BANKNIFTY, which could
    # win the earliest-expiry pick and proxy the wrong index (different lot).
    rows = parse_search_payload({"data": [
        {"instrument_key": "NSE_FO|BN", "trading_symbol": "BANKNIFTY 28 OCT 25 FUT",
         "instrument_type": "FUT", "segment": "NSE_FO", "expiry": "2025-10-28"},
        {"instrument_key": "NSE_FO|NF", "trading_symbol": "NIFTY 25 NOV 25 FUT",
         "instrument_type": "FUT", "segment": "NSE_FO", "expiry": "2025-11-25"},
    ]})
    nifty = [r for r in rows if is_nifty_futures_symbol(r["trading_symbol"])]
    assert [r["instrument_key"] for r in nifty] == ["NSE_FO|NF"]
    pick = pick_current_month(nifty, "2025-10-20")
    assert pick["instrument_key"] == "NSE_FO|NF"


def test_pick_current_month_earliest_on_or_after():
    rows = parse_search_payload(SEARCH_FIXTURE)
    assert pick_current_month(rows, "2025-10-21")["expiry"] == "2025-10-28"
    assert pick_current_month(rows, "2025-10-28")["expiry"] == "2025-10-28"
    assert pick_current_month(rows, "2025-12-01") is None
    assert pick_current_month([], "2025-10-21") is None
    assert pick_current_month([{"expiry": "junk"}], "2025-10-21") is None


def test_parse_candles_oldest_first_with_volume():
    parsed = parse_candles(_candles([10.0, 20.0, 30.0]))
    assert [c["volume"] for c in parsed] == [10.0, 20.0, 30.0]
    assert parse_candles({}) == []
    assert parse_candles(None) == []
    # bad rows skipped
    parsed = parse_candles({"data": {"candles": [["ts", 1, 2, 1, 2, "x", 0], "junk", [1]]}})
    assert parsed == []


def test_window_volumes_full_chunks_only():
    assert window_volumes([1, 1, 1, 1, 1, 2, 2, 2, 2, 2], 5) == [5, 10]
    assert window_volumes([1, 2, 3], 5) == []
    with pytest.raises(ValueError):
        window_volumes([1], 0)


def test_compute_rvol_last_over_median_of_priors():
    vols = [10] * 5 + [20] * 5 + [30] * 5 + [60] * 5  # windows: 50, 100, 150, 300
    stats = compute_rvol(vols, 5)
    assert stats["windows"] == [50, 100, 150, 300]
    assert stats["last"] == 300
    assert stats["baseline"] == 100  # median of [50, 100, 150]
    assert stats["rvol"] == pytest.approx(3.0)


def test_compute_rvol_insufficient_or_zero_baseline():
    stats = compute_rvol([1, 2, 3], 5)
    assert stats["rvol"] is None and stats["windows"] == []
    stats = compute_rvol([0] * 10, 5)  # windows [0, 0] → baseline 0
    assert stats["rvol"] is None and stats["baseline"] == 0
    stats = compute_rvol([5] * 5, 5)  # single window — no baseline
    assert stats["rvol"] is None and stats["last"] == 25
