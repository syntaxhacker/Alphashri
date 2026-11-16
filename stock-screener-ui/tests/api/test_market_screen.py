"""
Tests for GET /api/market/snapshot (one-page NSE market snapshot).

The endpoint is exercised through ``TestClient(app)`` per the contract rule --
the app is never introspected via ``app.routes``. ``api.tv.scan_frame`` is
mocked so no network call is made.
"""

import os
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
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
from api.market_screen import snapshot as snapshot_mod  # noqa: E402
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
    "sector": "Energy", "exchange": "NSE",
    "close": 2946.0, "change": 0.82,
    "relative_volume_10d_calc": 1.4, "market_cap_basic": 1990000000000.0,
    "RSI": 61.2, "ADX": 24.1,
    "SMA20": 2880.0, "SMA50": 2800.0, "SMA200": 2600.0,
    "Perf.W": 2.1, "Perf.1M": 4.6,
    "price_52_week_high": 3000.0, "price_52_week_low": 1800.0,
    "price_earnings_ttm": 22.1,
    "price_book_fq": 1.92,
    "dividend_yield_recent": 0.35,
    "return_on_equity": 9.01,
    "update_mode": "streaming",
}

EXPECTED_RELIANCE_ROW = {
    "symbol": "RELIANCE", "name": "Reliance Industries", "sector": "Energy", "exchange": "NSE",
    "close": 2946.0, "change": 0.82,
    "relative_volume": 1.4, "market_cap_cr": 199000.0, "cap_tier": "large",
    "rsi": 61.2, "adx": 24.1,
    "sma20": 2880.0, "sma50": 2800.0, "sma200": 2600.0,
    "perf_w": 2.1, "perf_1m": 4.6,
    "high_52w": 3000.0, "low_52w": 1800.0, "pos_52w": 95.5,
    "pe_ratio": 22.1, "pb_ratio": 1.92,
    "dividend_yield": 0.35, "roe": 9.01,
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


def test_dropped_fields_absent_from_response(client, mock_tv):
    """The five unused row fields never reach the client; market_cap_cr is kept."""
    mock_tv.return_value = _frame([RELIANCE_ROW])
    body = client.get("/api/market/snapshot").json()
    assert len(body["rows"]) == 1
    row = body["rows"][0]
    for field in ("industry", "volume", "market_cap", "atr", "perf_3m"):
        assert field not in row, field
    assert "market_cap_cr" in row
    assert len(row) == len(EXPECTED_RELIANCE_ROW)


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
    assert r["sector"] is None
    for key in ("close", "change", "relative_volume", "market_cap_cr",
                "rsi", "adx", "sma20", "sma50",
                "sma200", "perf_w", "perf_1m", "high_52w",
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


# --------------------------------------------------------------------------- #
# Optional `symbols` filter (live LTP quote fetch for the pattern dock)
# --------------------------------------------------------------------------- #

def test_symbols_filter_returns_exact_requested_rows_case_insensitive(client, mock_tv):
    rows = [
        RELIANCE_ROW,
        dict(RELIANCE_ROW, name="NSE:TCS"),
        dict(RELIANCE_ROW, name="NSE:INFY"),
    ]
    mock_tv.return_value = _frame(rows)
    body = client.get("/api/market/snapshot?symbols=reliance,InFY").json()
    assert [r["symbol"] for r in body["rows"]] == ["RELIANCE", "INFY"]
    assert body["total"] == 2


def test_symbols_filter_unknown_symbols_are_absent(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW])
    body = client.get("/api/market/snapshot?symbols=NOPE,ALSO_MISSING").json()
    assert body["rows"] == []
    assert body["total"] == 0


def test_symbols_filter_empty_is_no_filter(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW, dict(RELIANCE_ROW, name="NSE:TCS")])
    for value in ("", ",,,", "  ,  "):
        body = client.get(f"/api/market/snapshot?symbols={value}").json()
        assert [r["symbol"] for r in body["rows"]] == ["RELIANCE", "TCS"]
        assert body["total"] == 2


def test_symbols_filter_more_than_20_is_400(client, mock_tv):
    symbols = ",".join(f"S{i}" for i in range(21))
    resp = client.get(f"/api/market/snapshot?symbols={symbols}")
    assert resp.status_code == 400
    assert "at most 20" in resp.json()["detail"]
    assert mock_tv.call_count == 0


def test_symbols_filter_exactly_20_is_allowed(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW])
    symbols = ",".join(f"S{i}" for i in range(19)) + ",RELIANCE"
    resp = client.get(f"/api/market/snapshot?symbols={symbols}")
    assert resp.status_code == 200
    assert [r["symbol"] for r in resp.json()["rows"]] == ["RELIANCE"]


def test_symbols_filter_still_serves_cache_without_force(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW, dict(RELIANCE_ROW, name="NSE:TCS")])
    first = client.get("/api/market/snapshot").json()
    assert first["cached"] is False

    filtered = client.get("/api/market/snapshot?symbols=tcs").json()
    assert [r["symbol"] for r in filtered["rows"]] == ["TCS"]
    assert filtered["total"] == 1
    assert mock_tv.call_count == 1  # no refetch: filter runs after the cached build
    assert filtered["cached"] is True


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
    inflight_entry = _inflight[key]
    inflight_entry["event"].wait(timeout=5)
    assert scan.call_count == 1
    assert key not in _inflight  # the finished refresh releases its slot

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


# --------------------------------------------------------------------------- #
# Background refresh must release its inflight slot (fail or succeed)
# --------------------------------------------------------------------------- #

@contextmanager
def _gated_tv_scan():
    """TV scan stub that blocks until the test releases it.

    Because the stub cannot return before the test allows it, the background
    worker is provably still inside ``_compute_once`` when the request returns
    -- so the inflight entry can be inspected without a sleep-based race.
    """
    started = threading.Event()
    release = threading.Event()
    outcome = {"exc": None, "rows": _frame([RELIANCE_ROW])}

    def scan(*args, **kwargs):
        started.set()
        if not release.wait(timeout=5):
            raise AssertionError("scan gate never released")
        if outcome["exc"] is not None:
            raise outcome["exc"]
        return outcome["rows"]

    with patch("api.market_screen.snapshot.scan_frame", side_effect=scan) as scan_mock, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}):
        yield scan_mock, started, release, outcome


def _seed_expired_entry(key) -> None:
    """Expire a warm memory entry so the next request stale-serves + refreshes."""
    _cache[key] = {
        "stored_at": time() - 120,
        "expires_at": time() - 1,
        "as_of": "2026-01-05T00:00:00+05:30",
        "update_mode": "streaming",
        "rows": [EXPECTED_RELIANCE_ROW],
    }


def test_background_refresh_success_clears_inflight_and_warms_cache():
    """A finished background refresh publishes rows and frees the slot."""
    key = ("all_equity", MAX_LIMIT)
    _seed_expired_entry(key)

    with _gated_tv_scan() as (scan, started, release, outcome):
        served = build_snapshot("all_equity", MAX_LIMIT)
        assert served["stale"] is True
        assert started.wait(timeout=5)
        entry = _inflight[key]
        outcome["rows"] = _frame([dict(RELIANCE_ROW, name="NSE:FRESH932")])
        release.set()
        assert entry["event"].wait(timeout=5), "refresh never signalled"

    assert key not in _inflight
    assert scan.call_count == 1
    assert _cache[key]["rows"][0]["symbol"] == "FRESH932"
    assert _cache[key]["as_of"] == entry["as_of"]


def test_background_refresh_failure_clears_inflight():
    """Regression: a failed background refresh must not leave a poisoned slot.

    Before the fix ``_refresh`` only set the event, so the entry (with ``exc``
    set on it) stayed in ``_inflight`` for the life of the process.
    """
    key = ("all_equity", MAX_LIMIT)
    _seed_expired_entry(key)

    with _gated_tv_scan() as (scan, started, release, outcome):
        served = build_snapshot("all_equity", MAX_LIMIT)
        assert served["stale"] is True  # stale-serve while the refresh runs
        assert started.wait(timeout=5)
        entry = _inflight[key]
        outcome["exc"] = RuntimeError("broker token dead")
        release.set()
        assert entry["event"].wait(timeout=5), "refresh never signalled"

    assert entry["exc"] is not None
    assert key not in _inflight, "failed refresh leaked its slot"
    assert scan.call_count == 1


def test_force_after_failed_background_refresh_rescans():
    """force=true must not inherit a dead slot: it scans again and is fresh."""
    key = ("all_equity", MAX_LIMIT)
    _seed_expired_entry(key)

    with _gated_tv_scan() as (scan, started, release, outcome):
        build_snapshot("all_equity", MAX_LIMIT)
        assert started.wait(timeout=5)
        entry = _inflight[key]
        outcome["exc"] = RuntimeError("broker token dead")
        release.set()
        assert entry["event"].wait(timeout=5)
        assert key not in _inflight  # the poisoning condition is gone

        started.clear()
        outcome["exc"] = None
        outcome["rows"] = _frame([dict(RELIANCE_ROW, name="NSE:RECOVERED")])
        out = build_snapshot("all_equity", MAX_LIMIT, True)

    assert scan.call_count == 2, "force did not rescan after the failure"
    assert out["stale"] is False and out["cached"] is False
    assert out["as_of"] != "2026-01-05T00:00:00+05:30"
    assert out["rows"][0]["symbol"] == "RECOVERED"
    assert key not in _inflight


def test_force_singleflight_collapses_after_poisoned_slot():
    """A dead slot is discarded once, and the retry is still single-flighted."""
    key = ("all_equity", MAX_LIMIT)
    dead_event = threading.Event()
    dead_event.set()
    _inflight[key] = {
        "event": dead_event, "stored_at": None, "as_of": None,
        "update_mode": None, "rows": None, "exc": RuntimeError("dead"),
    }

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
    assert all(r["stale"] is False and r["cached"] is False for r in results)
    assert key not in _inflight


@pytest.mark.parametrize("force", [False, True])
def test_no_inflight_leak_on_upstream_failure(force):
    """Every path leaves ``_inflight`` empty, even when the scan raises."""
    key = ("all_equity", MAX_LIMIT)
    with patch("api.market_screen.snapshot.scan_frame",
               side_effect=RuntimeError("boom")) as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}):
        with pytest.raises(RuntimeError, match="boom"):
            build_snapshot("all_equity", MAX_LIMIT, force)
        assert scan.call_count == 1

    assert _inflight == {}


def test_thread_start_failure_leaks_no_slot_and_still_serves_stale():
    """A refresh thread that never starts must not claim the slot forever."""
    key = ("all_equity", MAX_LIMIT)
    _seed_expired_entry(key)

    with patch("api.market_screen.snapshot.threading.Thread.start",
               side_effect=RuntimeError("cannot start new thread")):
        served = build_snapshot("all_equity", MAX_LIMIT)

    assert served["stale"] is True  # stale serve still succeeds
    assert _inflight == {}
