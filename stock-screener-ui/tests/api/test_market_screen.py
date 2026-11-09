"""
Tests for GET /api/market/snapshot (one-page NSE market snapshot).

The endpoint is exercised through ``TestClient(app)`` per the contract rule --
the app is never introspected via ``app.routes``. ``api.tv.scan_frame`` is
mocked so no network call is made.
"""

from datetime import datetime
from pathlib import Path
from sys import path as sys_path
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys_path:
    sys_path.insert(0, str(ROOT))

from api_server_fastapi import app  # noqa: E402
from api.market_screen.snapshot import (  # noqa: E402
    ALLOWED_UNIVERSES,
    _MAX_LIMIT,
    _cache,
    build_snapshot,
    COLUMNS,
)
from api.tv.client import coerce_numeric  # noqa: E402

ALL_EQUITY_FILTERS = [
    {"left": "type", "operation": "equal", "right": "stock"},
    {"left": "exchange", "operation": "equal", "right": "NSE"},
]

RELIANCE_ROW = {
    "name": "NSE:RELIANCE", "description": "Reliance Industries",
    "sector": "Energy", "industry": "Oil & Gas Refining", "exchange": "NSE",
    "close": 2946.0, "change": 0.82, "volume": 1234567.0,
    "relative_volume_10d_calc": 1.4, "market_cap_basic": 1990000000000.0,
    "RSI": 61.2, "ADX": 24.1, "ATR": 45.0,
    "SMA20": 2880.0, "SMA50": 2800.0, "SMA200": 2600.0,
    "Perf.W": 2.1, "Perf.1M": 4.6, "Perf.3M": 8.2,
    "price_52_week_high": 3000.0, "price_52_week_low": 1800.0,
    "update_mode": "streaming",
}

EXPECTED_RELIANCE_ROW = {
    "symbol": "RELIANCE", "name": "Reliance Industries", "sector": "Energy",
    "industry": "Oil & Gas Refining", "exchange": "NSE",
    "close": 2946.0, "change": 0.82, "volume": 1234567.0,
    "relative_volume": 1.4, "market_cap": 1990000000000.0,
    "market_cap_cr": 199000.0, "cap_tier": "large",
    "rsi": 61.2, "adx": 24.1, "atr": 45.0,
    "sma20": 2880.0, "sma50": 2800.0, "sma200": 2600.0,
    "perf_w": 2.1, "perf_1m": 4.6, "perf_3m": 8.2,
    "high_52w": 3000.0, "low_52w": 1800.0, "pos_52w": 95.5,
    "fno": False, "etf": False,
}


def _frame(records) -> pd.DataFrame:
    """One TV-style frame (numeric columns coerced like scan_frame does)."""
    df = pd.DataFrame(records, columns=COLUMNS)
    return coerce_numeric(df)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clear_cache():
    _cache.clear()
    yield
    _cache.clear()


@pytest.fixture
def mock_tv():
    with patch("api.market_screen.snapshot.scan_frame") as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}), \
            patch("api.market_screen.snapshot.tags_for", return_value=[]):
        yield scan


def test_snapshot_default_universe(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW])
    resp = client.get("/api/market/snapshot")
    assert resp.status_code == 200
    body = resp.json()
    assert body["universe"] == "all_equity"
    assert body["total"] == 1
    assert body["update_mode"] == "streaming"
    datetime.fromisoformat(body["as_of"])
    assert body["as_of"].endswith("+05:30")
    assert body["rows"] == [EXPECTED_RELIANCE_ROW]
    args, kw = mock_tv.call_args
    assert args[0] == "india"
    assert kw["columns"] == COLUMNS
    assert kw["filters"] == ALL_EQUITY_FILTERS
    assert kw["sort"] == "market_cap_basic"
    assert kw["order"] == "desc"
    assert kw["limit"] == _MAX_LIMIT
    assert kw.get("tickers", []) == []


@pytest.mark.parametrize("universe", ["nifty50", "nifty500", "nse_fo"])
def test_other_universes_route_to_tickers(client, mock_tv, universe):
    from chart_patterns.universes import get_universe
    from api.tv import to_tv_ticker

    mock_tv.return_value = _frame([])
    expected_tickers = [to_tv_ticker(s) for s in get_universe(universe)]
    resp = client.get(f"/api/market/snapshot?universe={universe}")
    assert resp.status_code == 200
    assert resp.json()["universe"] == universe
    assert resp.json()["total"] == 0
    kw = mock_tv.call_args.kwargs
    assert kw["tickers"] == expected_tickers
    assert kw.get("filters") is None


def test_invalid_universe_400(client, mock_tv):
    resp = client.get("/api/market/snapshot?universe=forex")
    assert resp.status_code == 400
    assert "unknown universe" in resp.json()["detail"]


def test_limit_bounds(client, mock_tv):
    mock_tv.return_value = _frame([])
    assert client.get("/api/market/snapshot?limit=0").status_code == 422
    assert client.get("/api/market/snapshot?limit=4001").status_code == 422
    five = [dict(RELIANCE_ROW, name=f"NSE:SYM{i}") for i in range(5)]
    mock_tv.return_value = _frame(five)
    resp = client.get("/api/market/snapshot?limit=5")
    assert resp.status_code == 200
    assert resp.json()["total"] == 5
    assert mock_tv.call_args.kwargs["limit"] == 5


def test_cap_tier_ranking(client, mock_tv):
    rows = [
        dict(RELIANCE_ROW, name=f"NSE:SYM{i:04d}",
             market_cap_basic=(300 - i) * 1e9)
        for i in range(300)
    ]
    rows.append(dict(RELIANCE_ROW, name="NSE:NOCAP", market_cap_basic=None))
    mock_tv.return_value = _frame(rows)
    tiers = [r["cap_tier"] for r in client.get("/api/market/snapshot").json()["rows"]]
    assert tiers[:100] == ["large"] * 100
    assert tiers[100:250] == ["mid"] * 150
    assert tiers[250:300] == ["small"] * 50
    assert tiers[300] == "micro"
    assert client.get("/api/market/snapshot").json()["rows"][300]["symbol"] == "NOCAP"


def test_pos_52w_nulls(client, mock_tv):
    base = dict(RELIANCE_ROW)
    rows = [
        dict(base, name="NSE:NOHIGH", price_52_week_high=None),
        dict(base, name="NSE:NOLOW", price_52_week_low=None),
        dict(base, name="NSE:SAME", close=100.0,
             price_52_week_high=100.0, price_52_week_low=100.0),
        dict(base, name="NSE:NOCLOSE", close=None,
             price_52_week_high=200.0, price_52_week_low=100.0),
    ]
    mock_tv.return_value = _frame(rows)
    assert all(r["pos_52w"] is None
               for r in client.get("/api/market/snapshot").json()["rows"])

    normal = dict(base, name="NSE:NORMAL", close=250.0,
                  price_52_week_high=300.0, price_52_week_low=100.0)
    mock_tv.return_value = _frame([normal])
    assert client.get("/api/market/snapshot?force=true").json()["rows"][0]["pos_52w"] == 75.0


def test_fno_etf_tags(client):
    with patch("api.market_screen.snapshot.scan_frame") as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "delayed_streaming_900"}), \
            patch("api.market_screen.snapshot.tags_for",
                  side_effect=lambda s: ["F&O", "ETF"] if s == "RELIANCE" else []):
        scan.return_value = _frame([
            dict(RELIANCE_ROW, name="NSE:RELIANCE"),
            dict(RELIANCE_ROW, name="NSE:TCS"),
        ])
        body = client.get("/api/market/snapshot").json()
        assert body["update_mode"] == "delayed_streaming_900"
        assert body["rows"][0]["symbol"] == "RELIANCE"
        assert body["rows"][0]["fno"] is True and body["rows"][0]["etf"] is True
        assert body["rows"][1]["symbol"] == "TCS"
        assert body["rows"][1]["fno"] is False and body["rows"][1]["etf"] is False


def test_missing_numerics_are_null(client, mock_tv):
    row = {col: None for col in COLUMNS}
    row["name"] = "NSE:NODATA"
    row["description"] = "No Data"
    row["exchange"] = "NSE"
    row["update_mode"] = "streaming"
    mock_tv.return_value = _frame([row])
    r = client.get("/api/market/snapshot").json()["rows"][0]
    assert r["symbol"] == "NODATA"
    assert r["name"] == "No Data"
    assert r["sector"] is None and r["industry"] is None
    for key in ("close", "change", "volume", "relative_volume", "market_cap",
                "market_cap_cr", "rsi", "adx", "atr", "sma20", "sma50",
                "sma200", "perf_w", "perf_1m", "perf_3m", "high_52w",
                "low_52w", "pos_52w"):
        assert r[key] is None, key
    assert r["cap_tier"] == "micro"
    assert r["fno"] is False and r["etf"] is False


def test_cache_hit_avoids_refetch(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW])
    first = client.get("/api/market/snapshot").json()
    second = client.get("/api/market/snapshot").json()
    assert {k: v for k, v in first.items() if k != "as_of"} == {
        k: v for k, v in second.items() if k != "as_of"
    }
    assert mock_tv.call_count == 1


def test_force_bypasses_cache(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW])
    client.get("/api/market/snapshot")
    client.get("/api/market/snapshot?force=true")
    assert mock_tv.call_count == 2


def test_upstream_failure_502_without_cache(client, mock_tv):
    mock_tv.side_effect = RuntimeError("TV scanner blew up")
    resp = client.get("/api/market/snapshot?limit=123")
    assert resp.status_code == 502
    assert resp.json()["detail"] == (
        "market_source_unavailable: TV scanner blew up")


def test_upstream_failure_serves_last_good(client, mock_tv):
    two = [RELIANCE_ROW, dict(RELIANCE_ROW, name="NSE:TCS", market_cap_basic=1.4e12)]
    mock_tv.return_value = _frame(two)
    first = client.get("/api/market/snapshot").json()
    mock_tv.side_effect = RuntimeError("gone")
    resp = client.get("/api/market/snapshot")
    assert resp.status_code == 200
    assert {k: v for k, v in resp.json().items() if k != "as_of"} == {
        k: v for k, v in first.items() if k != "as_of"
    }


def test_build_snapshot_rejects_bad_universe():
    with pytest.raises(ValueError, match="unknown universe"):
        build_snapshot("forex")
