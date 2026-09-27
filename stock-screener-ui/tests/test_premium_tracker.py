"""Tests for GET /api/options/premium-tracker (api/premium_tracker.py)."""

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import premium_tracker
from api.premium_tracker import clear_premium_tracker_cache, router


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_cache():
    clear_premium_tracker_cache()
    yield
    clear_premium_tracker_cache()


def _chain(spot, atm_strike, ce, pe):
    strikes = [
        {"strike": atm_strike - 100, "ce_oi": 0, "pe_oi": 0, "ce_ltp": 5.0, "pe_ltp": 60.0},
        {"strike": atm_strike, "ce_oi": 0, "pe_oi": 0, "ce_ltp": ce, "pe_ltp": pe},
        {"strike": atm_strike + 100, "ce_oi": 0, "pe_oi": 0, "ce_ltp": 60.0, "pe_ltp": 5.0},
    ]
    return {"ticker": "X", "spot": spot, "strikes": strikes, "expiries": ["30-09-2026"]}


def _prices():
    idx = pd.date_range("2026-08-01", periods=45, freq="B")
    close = [100.0 + ((i % 5) - 2) * 0.5 for i in range(45)]
    df = pd.DataFrame(
        {
            "Open": close,
            "High": [c * 1.004 for c in close],
            "Low": [c * 0.996 for c in close],
            "Close": close,
            "Volume": 1000,
        },
        index=idx,
    )
    return df


def test_snapshot_shape_and_verdict(client, monkeypatch):
    chains = {
        "NIFTY": _chain(23140.0, 23150.0, 90.0, 106.0),
        "BANKNIFTY": _chain(55580.0, 55600.0, 300.0, 256.0),
    }
    monkeypatch.setattr(
        "india_board.scripts.fyers_data.get_chain", lambda t: chains[t]
    )
    monkeypatch.setattr("yfinance.download", lambda *a, **k: _prices())

    resp = client.get("/api/options/premium-tracker")
    assert resp.status_code == 200
    body = resp.json()
    assert body["cached"] is False
    assert len(body["legs"]) == 2

    nifty = next(leg for leg in body["legs"] if leg["underlying"] == "NIFTY")
    assert nifty["spot"] == 23140.0
    assert nifty["atm_strike"] == 23150.0
    assert nifty["straddle_price"] == 196.0
    assert nifty["straddle_pct"] == pytest.approx(196.0 / 23140.0 * 100.0, abs=0.001)
    assert nifty["ce_iv_pct"] is not None
    assert nifty["hv20_ann_pct"] is not None
    assert nifty["verdict"] in ("CHEAP", "FAIR", "EXPENSIVE")

    # Second call is served from cache.
    resp2 = client.get("/api/options/premium-tracker")
    assert resp2.json()["cached"] is True


def test_chain_failure_yields_error_leg_not_500(client, monkeypatch):
    def boom(t):
        raise RuntimeError("no token")

    monkeypatch.setattr("india_board.scripts.fyers_data.get_chain", boom)
    resp = client.get("/api/options/premium-tracker")
    assert resp.status_code == 200
    legs = resp.json()["legs"]
    assert all(leg["verdict"] == "UNKNOWN" and leg["error"] for leg in legs)
