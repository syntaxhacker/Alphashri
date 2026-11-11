"""Regression tests for the option-contract sentiment convention and the
expiry boundary validation.

The price-vs-OI quadrant (Long Buildup / Short Buildup / Short Covering /
Long Unwinding) must be measured against the PREVIOUS CLOSE, exactly like the
live Nifty report (``reports_api/nifty.build_leg``). It used to be measured
against the BID price, which is the bid-ask spread: always >= 0, so Short
Buildup and Long Unwinding could never fire and every leg read as Long
Buildup or Short Covering.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.options import (  # noqa: E402
    _validate_expiry,
    get_option_sentiment,
    transform_option_contract,
)


def _contract(**market_data):
    raw = {
        "instrument_key": "NSE_FO|123",
        "trading_symbol": "NIFTY26MAR25000CE",
        "expiry": "2026-03-17",
        "market_data": market_data,
        "option_greeks": {"delta": 0.5, "iv": 15},
    }
    return raw


class TestSentimentUsesPreviousClose:
    def test_price_down_vs_prev_close_with_oi_up_is_short_buildup(self):
        """ltp 90 vs prev close 100, OI rising -> Short Buildup."""
        out = transform_option_contract(
            _contract(ltp=90, close_price=100, bid_price=89, ask_price=91,
                       oi=5000, prev_oi=4000),
            25000, "CE",
        )
        assert out["sentiment"]["label"] == "SB"

    def test_price_down_vs_prev_close_with_oi_down_is_long_unwinding(self):
        out = transform_option_contract(
            _contract(ltp=90, close_price=100, bid_price=89, ask_price=91,
                       oi=3000, prev_oi=4000),
            25000, "CE",
        )
        assert out["sentiment"]["label"] == "LU"

    def test_price_up_vs_prev_close_with_oi_up_is_long_buildup(self):
        out = transform_option_contract(
            _contract(ltp=110, close_price=100, bid_price=109, ask_price=111,
                       oi=5000, prev_oi=4000),
            25000, "CE",
        )
        assert out["sentiment"]["label"] == "LB"

    def test_price_up_vs_prev_close_with_oi_down_is_short_covering(self):
        out = transform_option_contract(
            _contract(ltp=110, close_price=100, bid_price=109, ask_price=111,
                       oi=3000, prev_oi=4000),
            25000, "CE",
        )
        assert out["sentiment"]["label"] == "SC"

    def test_bid_relative_spread_alone_never_reports_a_bearish_quadrant(self):
        """The old bug: ltp >= bid always, so SB/LU were unreachable."""
        # price is DOWN vs the previous close, but the bid is below the ltp
        out = transform_option_contract(
            _contract(ltp=90, close_price=100, bid_price=85, ask_price=91,
                       oi=5000, prev_oi=4000),
            25000, "CE",
        )
        assert out["sentiment"]["label"] == "SB"

    def test_without_prev_close_the_old_bid_relative_read_is_kept(self):
        """No previous close -> direction unknown -> keep the legacy read."""
        out = transform_option_contract(
            _contract(ltp=150, bid_price=145, oi=5000, prev_oi=4000),
            20000, "CE",
        )
        assert out["sentiment"]["label"] == "LB"

    def test_sanitised_fields_survive_none_and_garbage(self):
        out = transform_option_contract(
            _contract(ltp=None, close_price=None, bid_price="x", oi=None,
                       prev_oi=None, volume=None, bid_qty=None, ask_qty=None),
            25000, "CE",
        )
        assert out["sentiment"]["label"] == "Neutral"
        assert out["market_data"]["oi"] is None

    def test_quadrant_helper_is_unchanged(self):
        """The classifier itself is untouched — only its input changed."""
        assert get_option_sentiment(-5.2, 1000)["label"] == "SB"


@pytest.fixture()
def client():
    """An app with only the options router.

    The global app includes every router inside a try/except that merely
    prints on failure, so a neighbouring module that breaks an import makes
    these routes 404 — order-dependent and silent. A local app cannot drift.
    """
    from fastapi import FastAPI

    from api.options import router as options_router

    app = FastAPI()
    app.include_router(options_router)
    return TestClient(app)


class TestExpiryValidation:
    def test_valid_expiry_passes(self):
        assert _validate_expiry("2026-03-17") == "2026-03-17"

    @pytest.mark.parametrize("bad", ["", "not-a-date", "17-03-2026", "2026-13-01"])
    def test_bad_expiry_is_a_400(self, bad):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            _validate_expiry(bad)
        assert exc.value.status_code == 400

    def test_expiry_is_normalised_to_canonical_iso(self):
        assert _validate_expiry("2026-3-7") == "2026-03-07"

    def test_chain_endpoint_rejects_a_bad_expiry_with_400(self, client: TestClient):
        with patch("api.options.fetch_upstox", new_callable=AsyncMock) as fetch:
            resp = client.get("/api/options/chain/NIFTY?expiry=nope")
        assert resp.status_code == 400
        fetch.assert_not_called()

    def test_positioning_endpoint_rejects_a_bad_expiry_with_400(self, client: TestClient):
        with patch("api.options.fetch_upstox", new_callable=AsyncMock) as fetch:
            resp = client.get("/api/options/positioning/NIFTY?expiry=nope")
        assert resp.status_code == 400
        fetch.assert_not_called()
