"""Parity guard + well-formedness for the additive /api/levels endpoint.

Guards:
1. The endpoint is additive: it runs in complete isolation from the 52W
   screener (``fetch_screener_data`` is never called) and its payload never
   redefines the existing 52W columns.
2. Importing / using the endpoint never replaces the existing functions it
   wraps (the original chart S/R and the 52W row builder keep their identity).
3. The additive LevelBook response is well-formed.
"""

from __future__ import annotations

from copy import deepcopy
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from api.screener_api import screener_scan
from api.levels_api.router import ROUTER_PREFIX, router
from chart_patterns import levels as chart_levels
from tests.helpers.fastapi_client import client_for

SYMBOL = "RELIANCE"
TIMEFRAME = "1D"

_REQUIRED_RESPONSE_KEYS = {
    "schema_version", "symbol", "timeframe", "as_of", "spot",
    "candle_count", "sources", "levels",
}
_REQUIRED_LEVEL_KEYS = {
    "id", "symbol", "timeframe", "as_of", "kind", "source", "geometry",
    "side", "strength", "touches", "price", "bottom", "top",
    "start_price", "end_price", "start_as_of", "end_as_of",
    "evidence", "detector_version", "schema_version",
}
# The existing 52W columns the screener emits. The additive endpoint must not
# redefine them and must not be needed to produce them.
_EXISTING_52W_COLUMNS = ("high_52w", "to_52w_high", "touched_52w", "days_ago")


def _synthetic_frame(n: int = 120) -> pd.DataFrame:
    """A rising, oscillating daily frame that yields S/R zones + trendlines."""
    x = np.arange(n, dtype=float)
    close = 200.0 + 0.05 * x + 2.0 * np.sin(x / 3.0)
    return pd.DataFrame(
        {
            "open": close - 0.2,
            "high": close + 0.8,
            "low": close - 0.8,
            "close": close,
        },
        index=pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC"),
    )


def _client():
    return client_for(router)


@pytest.fixture(autouse=True)
def _patch_candles():
    with patch(
        "chart_patterns.candles.fetch_for_timeframe",
        return_value=_synthetic_frame(),
    ):
        yield


@pytest.fixture
def existing_column_identity():
    """Snapshot the functions the endpoint must never replace."""
    return {
        "compute_sr_zones": chart_levels.compute_sr_zones,
        "build_stock_data": screener_scan._build_stock_data,
        "fetch_screener_data": screener_scan.fetch_screener_data,
    }


def test_levels_payload_is_additive_and_wellformed(existing_column_identity):
    response = _client().get(f"{ROUTER_PREFIX}/{SYMBOL}?timeframe={TIMEFRAME}")
    assert response.status_code == 200
    payload = response.json()

    # Additive response shape: the 52W columns are not part of it, and it is
    # keyed by its own levels/sources contract rather than existing columns.
    assert _REQUIRED_RESPONSE_KEYS.issubset(payload)
    assert payload["symbol"] == SYMBOL
    assert payload["timeframe"] == TIMEFRAME
    assert payload["as_of"]
    assert payload["spot"] is not None
    assert payload["candle_count"] > 0
    # no 52W column names leak into the additive payload
    assert not (set(_EXISTING_52W_COLUMNS) & set(payload))

    # Every level is well-formed.
    assert isinstance(payload["levels"], list) and len(payload["levels"]) > 0
    for level in payload["levels"]:
        assert _REQUIRED_LEVEL_KEYS.issubset(level)
        assert level["source"] in ("price_action", "trendline")
        assert level["geometry"] in ("horizontal", "zone", "segment")
        assert level["side"] in ("below", "above", "inside", None)
        assert level["evidence"] is not None

    # The existing functions were not replaced by importing/using the endpoint.
    assert chart_levels.compute_sr_zones is existing_column_identity["compute_sr_zones"]
    assert screener_scan._build_stock_data is existing_column_identity["build_stock_data"]
    assert screener_scan.fetch_screener_data is existing_column_identity["fetch_screener_data"]

    # Cumulative sources include the additive trendline lane on top of S/R.
    assert "trendline" in payload["sources"]


def _build_52w_stock_data():
    """One canonical screener row with every 52W column populated."""
    return screener_scan._build_stock_data(
        symbol=SYMBOL, tv_price=100.0, upstox_price=100.5, tv_52w_high=120.0,
        to_52w_high=20.0, recent_return_5d=1.5, perf_w=3.0, sector="Tech",
        touched_52w=True, days_ago=0, day_change=0.5, rsi=60.0, stoch_k=55.0,
        wick_close_pct=50.0, volume_surge=1.2, atr_pct=1.0, adx=30.0,
        interest_score=5.0, gap_pct=0.1, premarket_change=0.0,
        impact_score=1.0, market_cap_b=10.0, volume_m=5.0, turnover_cr=700.0,
        reversal_signal="", is_bullish=True, sentiment="bullish", score=70,
        broker_diff=0.5,
    )


def test_levels_endpoint_never_touches_the_52w_screener(existing_column_identity):
    """The additive read must not consult or alter the 52W/scan or raw S/R path."""
    frame = _synthetic_frame()
    before_row = deepcopy(_build_52w_stock_data())
    before_zones = deepcopy(chart_levels.compute_sr_zones(frame, timeframe=TIMEFRAME))

    with patch.object(
        screener_scan, "fetch_screener_data",
        side_effect=AssertionError("levels endpoint must not hit the screener"),
    ) as mock_scan:
        response = _client().get(f"{ROUTER_PREFIX}/{SYMBOL}")
        assert response.status_code == 200
        mock_scan.assert_not_called()

    # Both existing paths produce byte-identical results after the additive
    # endpoint has run: the LevelBook is fused on top, never swapped in.
    assert _build_52w_stock_data() == before_row
    assert chart_levels.compute_sr_zones(frame, timeframe=TIMEFRAME) == before_zones


def test_levels_52w_columns_still_built_unchanged():
    """`_build_stock_data` still emits the existing 52W columns untouched."""
    stock = _build_52w_stock_data()
    for column in _EXISTING_52W_COLUMNS:
        assert column in stock


def test_levels_wellformed_unknown_symbol_is_404():
    with patch("chart_patterns.candles.fetch_for_timeframe", return_value=None):
        response = _client().get(f"{ROUTER_PREFIX}/{SYMBOL}")
    assert response.status_code == 404
    assert "no candle data" in response.json()["detail"]


def test_levels_blank_symbol_is_400():
    assert _client().get(f"{ROUTER_PREFIX}/%20").status_code == 400
