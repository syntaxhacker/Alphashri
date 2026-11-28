"""Bit-exact parity guard for the paper-chart classic pivot delegation."""

import struct
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest


def _legacy_classic_pivots(prev_high, prev_low, prev_close):
    """The pre-delegation inline formulas, kept only as a reference oracle."""
    pp = (prev_high + prev_low + prev_close) / 3
    hl = prev_high - prev_low
    return {
        "pp": pp,
        "r1": 2 * pp - prev_low,
        "r2": pp + hl,
        "s1": 2 * pp - prev_high,
        "s2": pp - hl,
    }


_PIVOT_INPUTS = [
    (304.5, 294.5, 301.5),  # last daily bar of the standard chart fixture
    (101.235, 100.125, 100.775),
    (282.13, 281.07, 283.99),
    (299.5, 294.0, 297.25),
    (1_000_000.01, 999_999.98, 1_000_000.03),
]


@pytest.mark.unit
@pytest.mark.parametrize("h,l,c", _PIVOT_INPUTS)
def test_classic_pivot_delegation_is_bit_exact(h, l, c):
    from trading.pivot_utils import calculate_pivot_points

    canonical = calculate_pivot_points(h, l, c, "classic")
    actual = {"pp": canonical.pp, "r1": canonical.r1, "r2": canonical.r2,
              "s1": canonical.s1, "s2": canonical.s2}
    legacy = _legacy_classic_pivots(h, l, c)
    for key in legacy:
        assert struct.pack("!d", actual[key]) == struct.pack("!d", legacy[key]), key


@pytest.mark.unit
def test_chart_pivot_payload_unchanged(client, auth_headers):
    index_1m = pd.date_range("2026-03-30 09:15:00", periods=75, freq="1min", tz="Asia/Kolkata")
    intraday = pd.DataFrame({
        "open": [282.0 + i * 0.1 for i in range(75)],
        "high": [284.0 + i * 0.1 for i in range(75)],
        "low": [281.0 + i * 0.1 for i in range(75)],
        "close": [283.0 + i * 0.1 for i in range(75)],
        "volume": [10000] * 75,
    }, index=index_1m)
    index_1d = pd.date_range("2025-02-24", periods=400, freq="D", tz="Asia/Kolkata")
    daily = pd.DataFrame({
        "open": [102.0 + i * 0.5 for i in range(400)],
        "high": [105.0 + i * 0.5 for i in range(400)],
        "low": [95.0 + i * 0.5 for i in range(400)],
        "close": [102.0 + i * 0.5 for i in range(400)],
        "volume": [50000] * 400,
    }, index=index_1d)

    upstox = MagicMock()
    upstox.fetch_intraday_data_v3.return_value = intraday
    upstox.fetch_historical_data_v3.return_value = daily
    trader = MagicMock()
    trader.positions = {}
    journal = MagicMock()
    journal.trades = []

    with patch("upstox_trader.config_and_utils.upstox_api.UpstoxAPI", return_value=upstox), \
         patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
         patch("api.paper.endpoints.save_cached_candles"), \
         patch("api.paper.endpoints.get_paper_trader", return_value=trader), \
         patch("api.paper_trading.get_journal", return_value=journal, create=True):
        response = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["pivot_levels"] == {
        "pp": 300.17, "r1": 305.83, "r2": 310.17, "s1": 295.83, "s2": 290.17,
    }
