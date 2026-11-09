"""
Tests for GET /api/market/snapshot (one-page NSE market snapshot).

The endpoint is exercised through ``TestClient(app)`` per the contract rule --
the app is never introspected via ``app.routes``. ``api.tv.scan_frame`` is
mocked so no network call is made.
"""

import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from sys import path as sys_path
from time import sleep, time
from unittest.mock import Mock, patch

import pandas as pd
import pytest
import requests
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys_path:
    sys_path.insert(0, str(ROOT))

from api_server_fastapi import app  # noqa: E402
from api.market_screen.snapshot import (  # noqa: E402
    ALLOWED_UNIVERSES,
    MAX_LIMIT,
    _cache,
    _inflight,
    _STALE_DIR,
    _STALE_MAX_AGE_SEC,
    _stale_path,
    _save_stale_snapshot,
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
    "fno": True, "etf": False,
}


def _frame(records) -> pd.DataFrame:
    """One TV-style frame (numeric columns coerced like scan_frame does)."""
    df = pd.DataFrame(records, columns=COLUMNS)
    return coerce_numeric(df)


def _clear_disk_stale() -> None:
    """Wipe the market-screen disk-stale directory (test isolation)."""
    if _STALE_DIR.exists():
        shutil.rmtree(_STALE_DIR)
    _STALE_DIR.mkdir(parents=True, exist_ok=True)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clear_state():
    _cache.clear()
    _inflight.clear()
    _clear_disk_stale()
    yield
    _cache.clear()
    _inflight.clear()
    _clear_disk_stale()


@pytest.fixture
def mock_tv():
    with patch("api.market_screen.snapshot.scan_frame") as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}):
        yield scan


def test_snapshot_default_universe(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW])
    resp = client.get("/api/market/snapshot")
    assert resp.status_code == 200
    body = resp.json()
    assert body["universe"] == "all_equity"
    assert body["total"] == 1
    assert body["update_mode"] == "streaming"
    assert body["cached"] is False
    assert body["stale"] is False
    assert body["age_sec"] >= 0
    datetime.fromisoformat(body["as_of"])
    assert body["as_of"].endswith("+05:30")
    assert body["rows"] == [EXPECTED_RELIANCE_ROW]
    args, kw = mock_tv.call_args
    assert args[0] == "india"
    assert kw["columns"] == COLUMNS
    assert kw["filters"] == ALL_EQUITY_FILTERS
    assert kw["sort"] == "market_cap_basic"
    assert kw["order"] == "desc"
    assert kw["limit"] == MAX_LIMIT
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


def test_fno_etf_tags_use_hoisted_sets(client):
    """F&O/ETF membership comes from the hoisted sets, not per-row tags_for."""
    with patch("api.market_screen.snapshot.scan_frame") as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}), \
            patch("api.market_screen.snapshot._FNO_SYMBOLS", {"RELIANCE"}), \
            patch("api.market_screen.snapshot._ETF_SYMBOLS", {"RELIANCE", "NIFTYBEES"}):
        scan.return_value = _frame([
            dict(RELIANCE_ROW, name="NSE:RELIANCE"),
            dict(RELIANCE_ROW, name="NSE:TCS"),
            dict(RELIANCE_ROW, name="NSE:NIFTYBEES"),
        ])
        body = client.get("/api/market/snapshot").json()
        assert scan.call_count == 1
        flags = {r["symbol"]: (r["fno"], r["etf"]) for r in body["rows"]}
        assert flags["RELIANCE"] == (True, True)
        assert flags["TCS"] == (False, False)
        assert flags["NIFTYBEES"] == (False, True)


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
    assert first["rows"] == second["rows"]
    assert mock_tv.call_count == 1
    assert first["cached"] is False and first["stale"] is False
    assert second["cached"] is True and second["stale"] is False
    assert second["age_sec"] >= 0


def test_force_bypasses_cache(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW])
    first = client.get("/api/market/snapshot").json()
    second = client.get("/api/market/snapshot?force=true").json()
    assert mock_tv.call_count == 2
    assert first["cached"] is False and second["cached"] is False
    assert first["stale"] is False and second["stale"] is False


def test_upstream_failure_502_without_cache(client, mock_tv):
    mock_tv.side_effect = RuntimeError("TV scanner blew up")
    resp = client.get("/api/market/snapshot?limit=123")
    assert resp.status_code == 502
    assert resp.json()["detail"] == (
        "market_source_unavailable: TV scanner blew up")


def test_upstream_failure_serves_stale_memory_entry(client, mock_tv):
    """Upstream down + expired memory entry -> serve stale, cached=true, stale=true."""
    two = [RELIANCE_ROW, dict(RELIANCE_ROW, name="NSE:TCS", market_cap_basic=1.4e12)]
    mock_tv.return_value = _frame(two)
    first = client.get("/api/market/snapshot").json()
    # Expire the in-memory entry, then make the upstream fail.
    key = ("all_equity", MAX_LIMIT)
    _cache[key]["expires_at"] = time() - 1
    mock_tv.side_effect = RuntimeError("gone")
    resp = client.get("/api/market/snapshot")
    assert resp.status_code == 200
    got = resp.json()
    assert got["rows"] == first["rows"]
    assert got["update_mode"] == first["update_mode"]
    assert got["cached"] is True and got["stale"] is True


def test_build_snapshot_rejects_bad_universe():
    with pytest.raises(ValueError, match="unknown universe"):
        build_snapshot("forex")


# --------------------------------------------------------------------------- #
# Singleflight: N concurrent misses/force requests == one TV scan
# --------------------------------------------------------------------------- #

def test_singleflight_concurrent_misses_are_one_scan():
    """8 concurrent cold misses for the same key produce exactly 1 TV scan."""
    _cache.clear()
    _inflight.clear()

    def slow_scan(*args, **kwargs):
        sleep(0.25)
        return _frame([RELIANCE_ROW])

    with patch("api.market_screen.snapshot.scan_frame", side_effect=slow_scan) as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(
                lambda _: build_snapshot("all_equity", MAX_LIMIT), range(8)))

    assert scan.call_count == 1
    for result in results:
        assert result["cached"] is False and result["stale"] is False
        assert result["rows"] == results[0]["rows"]


def test_singleflight_force_requests_are_one_scan():
    """8 concurrent force requests for the same key produce exactly 1 TV scan."""
    _cache.clear()
    _inflight.clear()

    def slow_scan(*args, **kwargs):
        sleep(0.25)
        return _frame([RELIANCE_ROW])

    with patch("api.market_screen.snapshot.scan_frame", side_effect=slow_scan) as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(
                lambda _: build_snapshot("all_equity", MAX_LIMIT, True), range(8)))

    assert scan.call_count == 1
    assert all(r["cached"] is False and r["stale"] is False for r in results)


# --------------------------------------------------------------------------- #
# Stale-while-revalidate: disk snapshot on a cold start
# --------------------------------------------------------------------------- #

def test_cold_start_serves_disk_stale_snapshot():
    """No memory cache + disk snapshot -> immediate stale serve from disk,
    background refresh does exactly one scan."""
    _cache.clear()
    _inflight.clear()
    _clear_disk_stale()

    stored_rows = [EXPECTED_RELIANCE_ROW]
    _save_stale_snapshot("all_equity", MAX_LIMIT,
                         time() - 120, "2026-01-05T00:00:00+05:30",
                         "streaming", stored_rows)

    def slow_scan(*args, **kwargs):
        sleep(0.5)
        return _frame([dict(RELIANCE_ROW, name="NSE:TATA")])

    with patch("api.market_screen.snapshot.scan_frame", side_effect=slow_scan) as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}):
        out = build_snapshot("all_equity", MAX_LIMIT)

    # Served from disk immediately: no synchronous scan, rows are the disk
    # payload (symbol RELIANCE), not a fresh TATA scan.
    assert out["stale"] is True and out["cached"] is False
    assert out["rows"][0]["symbol"] == "RELIANCE"
    assert out["rows"] == stored_rows
    assert out["age_sec"] > 60

    key = ("all_equity", MAX_LIMIT)
    assert key in _inflight  # background refresh was started
    _inflight[key]["event"].wait(timeout=5)
    assert scan.call_count == 1

    # Cache is now warm: next request is a fresh hit with the scanned rows.
    out2 = build_snapshot("all_equity", MAX_LIMIT)
    assert out2["cached"] is True and out2["stale"] is False
    assert out2["rows"][0]["symbol"] == "TATA"
    assert scan.call_count == 1


def test_disk_stale_too_old_is_not_served():
    _cache.clear()
    _inflight.clear()
    _clear_disk_stale()

    _save_stale_snapshot("all_equity", MAX_LIMIT,
                         time(), "2026-01-05T00:00:00+05:30",
                         "streaming", [EXPECTED_RELIANCE_ROW])
    # Make the file look ancient so it must be ignored.
    path = _stale_path("all_equity", MAX_LIMIT)
    old = time() - 2 * _STALE_MAX_AGE_SEC
    os.utime(path, (old, old))

    with patch("api.market_screen.snapshot.scan_frame") as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}):
        scan.return_value = _frame([dict(RELIANCE_ROW, name="NSE:FRESH")])
        out = build_snapshot("all_equity", MAX_LIMIT)

    assert out["stale"] is False and out["cached"] is False
    assert out["rows"][0]["symbol"] == "FRESH"  # fresh scan, not the ancient disk payload
    assert scan.call_count == 1


# --------------------------------------------------------------------------- #
# 401 / delayed cookie self-heal
# --------------------------------------------------------------------------- #

def test_401_self_heal_refreshes_cookies_and_retries_once():
    err = requests.HTTPError("401 Unauthorized")
    err.response = Mock(status_code=401)
    with patch("api.market_screen.snapshot.scan_frame",
               side_effect=[err, _frame([RELIANCE_ROW])]) as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}), \
            patch("api.market_screen.snapshot.refresh_tv_cookies") as refresh:
        out = build_snapshot("all_equity", MAX_LIMIT)

    assert scan.call_count == 2
    assert refresh.call_count == 1
    assert out["cached"] is False and out["stale"] is False
    assert out["rows"][0]["symbol"] == "RELIANCE"


def test_delayed_feed_self_heal_retries_once():
    """Delayed feed -> refresh cookies once + retry once; still reports delayed."""
    with patch("api.market_screen.snapshot.scan_frame",
               return_value=_frame([RELIANCE_ROW])) as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "delayed_streaming_900"}), \
            patch("api.market_screen.snapshot.refresh_tv_cookies") as refresh:
        out = build_snapshot("all_equity", MAX_LIMIT)

    assert scan.call_count == 2
    assert refresh.call_count == 1
    assert out["update_mode"] == "delayed_streaming_900"
    assert out["stale"] is False


def test_streaming_feed_triggers_no_cookie_heal():
    with patch("api.market_screen.snapshot.scan_frame") as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}), \
            patch("api.market_screen.snapshot.refresh_tv_cookies") as refresh:
        out = build_snapshot("all_equity", MAX_LIMIT)

    assert scan.call_count == 1
    assert refresh.call_count == 0
    assert out["cached"] is False and out["stale"] is False
