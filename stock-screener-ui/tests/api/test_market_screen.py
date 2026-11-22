"""
Tests for GET /api/market/snapshot (one-page NSE market snapshot).

The endpoint is exercised through ``TestClient(app)`` per the contract rule --
the app is never introspected via ``app.routes``. ``api.tv.scan_frame`` is
mocked so no network call is made.
"""

import json
import os
import re
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from sys import path as sys_path
from time import sleep, time
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
import pytest
import requests
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys_path:
    sys_path.insert(0, str(ROOT))

from api_server_fastapi import app  # noqa: E402
from api.auth import get_current_user  # noqa: E402
from api.market_screen import snapshot as snapshot_mod  # noqa: E402
from api.market_screen.router import _MARKET_SOURCE_UNAVAILABLE_DETAIL  # noqa: E402
from api.market_screen.config import (  # noqa: E402
    ALL_CAP_TIERS,
    TYPE_STOCK_FILTER,
    UNIVERSES,
    UNSERVABLE_UNIVERSES,
    US_COLUMNS,
    US_EXCLUDE_NAME_PATTERN,
    US_EXCLUDE_SYMBOL_PATTERN,
)
from api.market_screen.snapshot import (  # noqa: E402
    ALLOWED_UNIVERSES,
    FETCH_LIMIT_LADDER,
    FORCE_COOLDOWN_SEC,
    LIVE_STALE_MAX_SECONDS,
    LIVE_TTL_SECONDS,
    MAX_LIMIT,
    OFF_TTL_SECONDS,
    _cache,
    _force_last_at,
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
    {"left": "type", "operation": "in_range", "right": ["stock", "fund"]},
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


def _etf_row(symbol: str, description: str, close: float):
    """An NSE ETF row as TV shapes it: no cap and no fundamentals."""
    return dict(
        RELIANCE_ROW,
        name=f"NSE:{symbol}",
        description=description,
        close=close,
        market_cap_basic=None,
        price_earnings_ttm=None,
        price_book_fq=None,
        dividend_yield_recent=None,
        return_on_equity=None,
    )


GOLDBEES_ROW = _etf_row("GOLDBEES", "Nippon India ETF Gold BeES", 107.85)
NIFTYBEES_ROW = _etf_row("NIFTYBEES", "Nippon India ETF Nifty 50 BeES", 287.89)


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
    "fno": True, "etf": False, "currency": "INR",
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


@pytest.fixture(scope="module", autouse=True)
def _worker_stale_dir(tmp_path_factory):
    """Give each worker its own disk-stale snapshot directory.

    ``snapshot._STALE_DIR`` is a fixed repo path. Under xdist every worker
    clears it around each test while other workers write/read snapshots there,
    so one worker deletes or contaminates another's cache. Patching both module
    bindings to a worker-private temp dir removes the shared state without
    changing production code; ``tmp_path_factory`` also cleans it up.
    """
    global _STALE_DIR
    original = snapshot_mod._STALE_DIR
    worker = os.environ.get("PYTEST_XDIST_WORKER", "master")
    _STALE_DIR = tmp_path_factory.mktemp(f"market_screen_stale_{worker}")
    snapshot_mod._STALE_DIR = _STALE_DIR
    try:
        yield _STALE_DIR
    finally:
        snapshot_mod._STALE_DIR = original
        _STALE_DIR = original


@pytest.fixture(scope="module")
def client():
    # /api/market/snapshot is now protected; override the dependency so the
    # existing (authenticated) calls keep working. Cleared in teardown so the
    # override does not leak into other test modules sharing this app object.
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=1, email="qa@test.com", uuid="00000000-0000-0000-0000-000000000001"
    )
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture(autouse=True)
def clear_state():
    _cache.clear()
    _inflight.clear()
    _force_last_at.clear()
    _clear_disk_stale()
    yield
    _cache.clear()
    _inflight.clear()
    _force_last_at.clear()
    _clear_disk_stale()


@pytest.fixture(autouse=True)
def _closed_market_session(monkeypatch):
    """Default every test to a closed market: the 60s TTL is deterministic.

    The live-TTL tests flip these predicates (or ``_universe_is_live``)
    themselves; without this default, running the suite during market hours
    would silently switch every existing test onto the 5s window.
    """
    import market_data.providers.sessions as sessions_mod
    import trading.utils as trading_utils

    monkeypatch.setattr(
        trading_utils, "is_market_open", lambda *args, **kwargs: False
    )
    monkeypatch.setattr(sessions_mod, "is_us_open", lambda *args, **kwargs: False)


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


@pytest.mark.parametrize(
    "universe", ["nifty50", "nifty100", "nifty200", "nifty500", "nse_fo"]
)
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


def _frontend_descriptor_ids() -> set[str]:
    """Parse the `value:` literals out of the frontend universe registry.

    The dropdown is derived from MARKET_UNIVERSE_DESCRIPTORS, so a backend id the
    frontend never shipped (or a frontend id the backend rejects) is exactly the
    drift this guard exists to catch.
    """
    source = (ROOT / "src/config/marketUniverses.ts").read_text(encoding="utf-8")
    block = source.split("MARKET_UNIVERSE_DESCRIPTORS", 1)[1].split("const BY_VALUE", 1)[0]
    return set(re.findall(r'value:\s*"([a-z0-9_]+)"', block))


def test_frontend_universe_ids_match_backend_allowlist():
    frontend_ids = _frontend_descriptor_ids()
    new_ids = {"nifty100", "nifty200", "banknifty", "sensex"}
    assert new_ids <= frontend_ids, f"frontend registry missing {new_ids - frontend_ids}"
    assert frontend_ids <= set(ALLOWED_UNIVERSES), (
        f"frontend ids rejected by backend: {frontend_ids - set(ALLOWED_UNIVERSES)}"
    )
    assert new_ids <= set(ALLOWED_UNIVERSES)
    assert frontend_ids == set(ALLOWED_UNIVERSES), (
        "frontend descriptors and backend allowlist drifted: "
        f"only frontend={frontend_ids - set(ALLOWED_UNIVERSES)}, "
        f"only backend={set(ALLOWED_UNIVERSES) - frontend_ids}"
    )


def test_banknifty_and_sensex_reuse_the_india_spec():
    from api.market_screen.config import UNIVERSES

    for uid in ("banknifty", "sensex"):
        assert UNIVERSES[uid] == UNIVERSES["nifty50"]
        assert UNIVERSES[uid].tickers
        assert UNIVERSES[uid].currency == "INR"
        assert UNIVERSES[uid].mcap_outputs == (("market_cap_cr", 1e7),)


def test_indices_is_excluded_from_market_screener_with_reason():
    """Chart patterns resolve indices; the equity snapshot cannot shape them."""
    reason = UNSERVABLE_UNIVERSES["indices"].lower()
    assert "index" in reason and "equity" in reason
    assert "indices" not in ALLOWED_UNIVERSES
    assert "indices" not in _frontend_descriptor_ids()

    from chart_patterns.universes import get_universe

    assert get_universe("indices"), "the pattern universe still resolves its members"


def test_documented_universe_ids_match_backend_allowlist(client):
    """Swagger's `universe` description must list every registry id.

    Read the served OpenAPI schema, not a private router constant, so this
    guards the artifact users actually see when the registry gains a universe.
    """
    schema = client.get("/openapi.json").json()
    params = schema["paths"]["/api/market/snapshot"]["get"]["parameters"]
    universe = next(p for p in params if p["name"] == "universe")
    description = universe["description"]

    for uid in ALLOWED_UNIVERSES:
        assert re.search(rf"\b{re.escape(uid)}\b", description), (
            f"universe {uid!r} missing from documented description: {description!r}"
        )
    for unservable in UNSERVABLE_UNIVERSES:
        assert re.search(rf"\b{re.escape(unservable)}\b", description)
        assert "unsupported" in description.lower()
    assert "UNSERVABLE_UNIVERSES" in description


def test_limit_bounds(client, mock_tv):
    mock_tv.return_value = _frame([])
    assert client.get("/api/market/snapshot?limit=0").status_code == 422
    assert client.get("/api/market/snapshot?limit=4001").status_code == 422
    five = [dict(RELIANCE_ROW, name=f"NSE:SYM{i}") for i in range(5)]
    mock_tv.return_value = _frame(five)
    resp = client.get("/api/market/snapshot?limit=5")
    assert resp.status_code == 200
    assert resp.json()["total"] == 5
    # India's scan window is quantized: limit=5 shares the 50-row ladder rung.
    assert mock_tv.call_args.kwargs["limit"] == 50


def test_snapshot_requires_auth(client):
    """An anonymous GET must be rejected: /api/market/snapshot is protected."""
    app.dependency_overrides.pop(get_current_user, None)
    try:
        resp = client.get("/api/market/snapshot")
        assert resp.status_code == 401, resp.text
        detail = resp.json().get("detail", "")
        assert "auth" in detail.lower() or "authenticate" in detail.lower(), detail
    finally:
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
            id=1, email="qa@test.com", uuid="00000000-0000-0000-0000-000000000001"
        )


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


def _tv_type_aware_scan(typed_rows):
    """Mock scan_frame that applies the outgoing `type` filter server-side.

    The real scanner types NSE ETFs as `fund`, so a `type == stock` filter never
    returns them. Emulating that here keeps the test honest: a frame with the
    ETF rows hard-coded would pass even with the exclusion filter restored.
    """
    def _scan(*args, **kwargs):
        type_filter = next(
            (f for f in (kwargs.get("filters") or []) if f.get("left") == "type"),
            None,
        )
        allowed = None
        if type_filter is not None:
            right = type_filter.get("right")
            if type_filter.get("operation") == "equal":
                allowed = {right} if isinstance(right, str) else set(right)
            elif type_filter.get("operation") == "in_range":
                allowed = set(right)
        return _frame([
            row for row, tv_type in typed_rows
            if allowed is None or tv_type in allowed
        ])
    return _scan


def test_all_nse_includes_goldbees_and_etf_control(client, mock_tv):
    """GOLDBEES and NIFTYBEES must survive the All NSE build as ETF rows."""
    mock_tv.side_effect = _tv_type_aware_scan([
        (RELIANCE_ROW, "stock"),
        (GOLDBEES_ROW, "fund"),
        (NIFTYBEES_ROW, "fund"),
    ])
    with patch("api.market_screen.snapshot._ETF_SYMBOLS", {"GOLDBEES", "NIFTYBEES"}):
        body = client.get("/api/market/snapshot?universe=all_equity&limit=4000").json()

    by_symbol = {row["symbol"]: row for row in body["rows"]}
    assert {"RELIANCE", "GOLDBEES", "NIFTYBEES"} <= by_symbol.keys()
    assert by_symbol["GOLDBEES"]["etf"] is True
    assert by_symbol["NIFTYBEES"]["etf"] is True
    assert by_symbol["GOLDBEES"]["close"] == 107.85


def test_etf_rows_are_not_micro_cap(client, mock_tv):
    """An ETF's missing market cap is not a small company's market cap.

    The ETF is reclassified out of the size ranking; a capped equity ranked
    past 500 still earns ``micro``. Without this, the rail's Micro filter returns
    every ETF alongside genuine micro caps.
    """
    equities = [
        dict(RELIANCE_ROW, name=f"NSE:SYM{i:04d}", market_cap_basic=(1000 - i) * 1e9)
        for i in range(501)
    ]
    mock_tv.return_value = _frame([*equities, GOLDBEES_ROW])
    with patch("api.market_screen.snapshot._ETF_SYMBOLS", {"GOLDBEES"}):
        body = client.get("/api/market/snapshot?limit=4000").json()

    by_symbol = {row["symbol"]: row for row in body["rows"]}
    etf = by_symbol["GOLDBEES"]
    assert etf["etf"] is True
    assert etf["market_cap_cr"] is None
    assert etf["cap_tier"] == "etf"
    assert etf["cap_tier"] != "micro"

    micro = by_symbol["SYM0500"]
    assert micro["etf"] is False
    assert micro["market_cap_cr"] is not None
    assert micro["cap_tier"] == "micro"


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



def test_force_cooldown_two_immediate_calls_one_scan(client, mock_tv):
    """Two back-to-back forces: the second reuses the first scan's cached frame."""
    mock_tv.return_value = _frame([RELIANCE_ROW])
    clock = {"t": 1000.0}
    with patch("api.market_screen.snapshot.time.monotonic", lambda: clock["t"]):
        first = client.get("/api/market/snapshot?force=true").json()
        second = client.get("/api/market/snapshot?force=true").json()

    assert mock_tv.call_count == 1
    assert first["cached"] is False and second["cached"] is True
    assert first["stale"] is False and second["stale"] is False
    assert second["rows"] == first["rows"]
    assert ("all_equity", MAX_LIMIT) in _force_last_at


def test_force_cooldown_allows_new_scan_after_window(client, mock_tv):
    """Once the cooldown elapses, a forced scan runs again."""
    mock_tv.return_value = _frame([RELIANCE_ROW])
    clock = {"t": 1000.0}
    with patch("api.market_screen.snapshot.time.monotonic", lambda: clock["t"]):
        first = client.get("/api/market/snapshot?force=true").json()
        clock["t"] += FORCE_COOLDOWN_SEC + 1.0
        second = client.get("/api/market/snapshot?force=true").json()

    assert mock_tv.call_count == 2
    assert first["cached"] is False and second["cached"] is False
    assert second["stale"] is False


def test_force_cooldown_is_per_bucket(client, mock_tv):
    """A force in a different scan bucket has its own cooldown key."""
    rows = [dict(RELIANCE_ROW, name=f"NSE:SYM{i:04d}") for i in range(600)]
    mock_tv.side_effect = lambda *a, **kw: _frame(rows[: kw["limit"]])
    clock = {"t": 1000.0}
    with patch("api.market_screen.snapshot.time.monotonic", lambda: clock["t"]):
        small = client.get("/api/market/snapshot?force=true&limit=12").json()
        # Same 50-rung bucket, still inside cooldown -> cached, no new scan.
        small_again = client.get("/api/market/snapshot?force=true&limit=50").json()
        # Different 500-rung bucket -> its own scan.
        large = client.get("/api/market/snapshot?force=true&limit=300").json()

    assert mock_tv.call_count == 2
    assert [kw["limit"] for _, kw in mock_tv.call_args_list] == [50, 500]
    assert small["cached"] is False
    assert small_again["cached"] is True
    assert large["cached"] is False
    assert set(_force_last_at) == {("all_equity", 50), ("all_equity", 500)}


def test_non_force_still_uses_ttl_not_force_cooldown(client, mock_tv):
    """Advancing the monotonic clock past the force cooldown leaves non-force
    requests on the normal TTL path (still a cache hit, still one scan)."""
    mock_tv.return_value = _frame([RELIANCE_ROW])
    clock = {"t": 1000.0}
    with patch("api.market_screen.snapshot.time.monotonic", lambda: clock["t"]):
        first = client.get("/api/market/snapshot").json()
        clock["t"] += FORCE_COOLDOWN_SEC + 1.0
        second = client.get("/api/market/snapshot").json()

    assert mock_tv.call_count == 1
    assert first["cached"] is False and second["cached"] is True
    assert _force_last_at == {}  # non-force never arms the force cooldown



def _seed_entry(key, age_sec: float, *, expires_in: float = 60.0, symbol="SEEDED"):
    """Seed a memory entry whose ``stored_at`` is ``age_sec`` in the past."""
    stored_at = time() - age_sec
    _cache[key] = {
        "stored_at": stored_at,
        "expires_at": stored_at + expires_in,
        "as_of": "2026-01-05T00:00:00+05:30",
        "update_mode": "streaming",
        "rows": [dict(EXPECTED_RELIANCE_ROW, symbol=symbol)],
    }
    return _cache[key]


def _wait_for(predicate, timeout: float = 5.0) -> bool:
    deadline = time() + timeout
    while time() < deadline:
        if predicate():
            return True
        sleep(0.01)
    return predicate()


def test_ttl_constants_and_predicate_mapping(monkeypatch):
    assert OFF_TTL_SECONDS == 60.0
    assert LIVE_TTL_SECONDS >= 3.0
    assert LIVE_STALE_MAX_SECONDS >= LIVE_TTL_SECONDS

    import market_data.providers.sessions as sessions_mod
    import trading.utils as trading_utils

    monkeypatch.setattr(trading_utils, "is_market_open", lambda *a, **k: True)
    monkeypatch.setattr(sessions_mod, "is_us_open", lambda *a, **k: False)
    assert snapshot_mod._universe_is_live("all_equity") is True
    assert snapshot_mod._universe_is_live("nifty50") is True
    assert snapshot_mod._universe_is_live("us") is False
    assert snapshot_mod._ttl_seconds("all_equity") == LIVE_TTL_SECONDS

    monkeypatch.setattr(trading_utils, "is_market_open", lambda *a, **k: False)
    monkeypatch.setattr(sessions_mod, "is_us_open", lambda *a, **k: True)
    assert snapshot_mod._universe_is_live("all_equity") is False
    assert snapshot_mod._universe_is_live("us") is True
    assert snapshot_mod._ttl_seconds("all_equity") == OFF_TTL_SECONDS
    assert snapshot_mod._ttl_seconds("us") == LIVE_TTL_SECONDS


def test_universe_is_live_fails_safe_to_closed(monkeypatch):
    import trading.utils as trading_utils

    def boom(*args, **kwargs):
        raise RuntimeError("calendar unavailable")

    monkeypatch.setattr(trading_utils, "is_market_open", boom)
    assert snapshot_mod._universe_is_live("all_equity") is False
    assert snapshot_mod._ttl_seconds("all_equity") == OFF_TTL_SECONDS


def test_live_age_4s_is_warm_hit(client, mock_tv, monkeypatch):
    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: True)
    key = ("all_equity", MAX_LIMIT)
    _seed_entry(key, 4.0)

    body = build_snapshot("all_equity", MAX_LIMIT)

    assert mock_tv.call_count == 0
    assert body["cached"] is True and body["stale"] is False
    assert body["age_sec"] >= 4.0


def test_live_age_6s_serves_stale_and_starts_one_refresh(monkeypatch):
    """A live poll just past the TTL returns at once and refreshes in background.

    ``_gated_tv_scan`` holds the scan open until the test releases it, so a
    request that had blocked would not return before the gate.
    """
    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: True)
    key = ("all_equity", MAX_LIMIT)
    _seed_entry(key, 6.0)

    with _gated_tv_scan() as (scan, started, release, outcome):
        t0 = time()
        body = build_snapshot("all_equity", MAX_LIMIT)
        elapsed = time() - t0

        assert elapsed < 2.0, "the request blocked on the scan"
        assert body["cached"] is True and body["stale"] is True
        assert body["rows"][0]["symbol"] == "SEEDED"
        assert body["age_sec"] >= 6.0
        assert key in _inflight

        assert started.wait(timeout=5)
        refresh = _inflight[key]
        again = build_snapshot("all_equity", MAX_LIMIT)
        assert again["cached"] is True and again["stale"] is True
        assert _inflight[key] is refresh, "a second background refresh was started"

        outcome["rows"] = _frame([dict(RELIANCE_ROW, name="NSE:BG")])
        release.set()
        assert refresh["event"].wait(timeout=5)

    assert scan.call_count == 1
    assert key not in _inflight
    assert _cache[key]["rows"][0]["symbol"] == "BG"

    warm = build_snapshot("all_equity", MAX_LIMIT)
    assert warm["cached"] is True and warm["stale"] is False
    assert warm["rows"][0]["symbol"] == "BG"
    assert scan.call_count == 1


def test_live_age_past_stale_window_blocks_on_scan(client, mock_tv, monkeypatch):
    """31s old (default window 30s) is too old to serve: the request scans."""
    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: True)
    key = ("all_equity", MAX_LIMIT)
    _seed_entry(key, LIVE_STALE_MAX_SECONDS + 1.0)
    mock_tv.return_value = _frame([dict(RELIANCE_ROW, name="NSE:LIVE")])

    body = build_snapshot("all_equity", MAX_LIMIT)

    assert mock_tv.call_count == 1
    assert body["cached"] is False and body["stale"] is False
    assert body["rows"][0]["symbol"] == "LIVE"
    assert body["as_of"] != "2026-01-05T00:00:00+05:30"
    assert body["age_sec"] < 1.0
    assert key not in _inflight


def test_live_transition_ignores_pre_open_expires_at(client, mock_tv, monkeypatch):
    """An entry cached pre-open (60s ``expires_at``) is stale on the live 5s TTL."""
    key = ("all_equity", MAX_LIMIT)
    entry = _seed_entry(key, 6.0)
    assert entry["expires_at"] > time()  # the stored diagnostic still says fresh

    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: True)
    mock_tv.return_value = _frame([dict(RELIANCE_ROW, name="NSE:OPEN")])

    body = build_snapshot("all_equity", MAX_LIMIT)

    # Not a warm hit: read-time freshness used the live TTL, not expires_at.
    assert body["cached"] is True and body["stale"] is True
    assert body["rows"][0]["symbol"] == "SEEDED"
    assert _wait_for(lambda: _cache[key]["rows"][0]["symbol"] == "OPEN")
    assert _wait_for(lambda: key not in _inflight)


def test_force_with_expired_live_frame_still_scans(client, mock_tv, monkeypatch):
    """force=1 never takes the live stale path, even inside the window."""
    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: True)
    key = ("all_equity", MAX_LIMIT)
    _seed_entry(key, 6.0)
    mock_tv.return_value = _frame([dict(RELIANCE_ROW, name="NSE:FORCED")])

    body = build_snapshot("all_equity", MAX_LIMIT, force=True)

    assert mock_tv.call_count == 1
    assert body["cached"] is False and body["stale"] is False
    assert body["rows"][0]["symbol"] == "FORCED"
    assert key in _force_last_at


def test_closed_age_30s_is_warm_hit(client, mock_tv):
    key = ("all_equity", MAX_LIMIT)
    _seed_entry(key, 30.0)

    body = build_snapshot("all_equity", MAX_LIMIT)

    assert mock_tv.call_count == 0
    assert body["cached"] is True and body["stale"] is False
    assert body["age_sec"] >= 30.0


def test_closed_age_61s_serves_stale_and_refreshes(client, mock_tv):
    key = ("all_equity", MAX_LIMIT)
    _seed_entry(key, 61.0)
    mock_tv.return_value = _frame([dict(RELIANCE_ROW, name="NSE:BG")])

    body = build_snapshot("all_equity", MAX_LIMIT)

    assert body["cached"] is True and body["stale"] is True
    assert body["rows"][0]["symbol"] == "SEEDED"
    assert _wait_for(lambda: mock_tv.call_count == 1)
    assert _wait_for(
        lambda: key in _cache and _cache[key]["rows"][0]["symbol"] == "BG"
    )
    assert _wait_for(lambda: key not in _inflight)


def test_force_bypasses_live_ttl_then_cooldown_caches(client, mock_tv, monkeypatch):
    """force=1 scans despite a fresh live frame; a second force within 1s does not."""
    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: True)
    key = ("all_equity", MAX_LIMIT)
    _seed_entry(key, 0.5)  # fresh under the live TTL
    mock_tv.return_value = _frame([dict(RELIANCE_ROW, name="NSE:FORCED")])

    clock = {"t": 1000.0}
    with patch("api.market_screen.snapshot.time.monotonic", lambda: clock["t"]):
        first = build_snapshot("all_equity", MAX_LIMIT, force=True)
        second = build_snapshot("all_equity", MAX_LIMIT, force=True)

    assert mock_tv.call_count == 1
    assert first["cached"] is False and first["stale"] is False
    assert first["rows"][0]["symbol"] == "FORCED"
    assert second["cached"] is True and second["stale"] is False
    assert key in _force_last_at


def test_force_cooldown_scales_with_market_state(monkeypatch):
    key = ("all_equity", MAX_LIMIT)
    _force_last_at[key] = 100.0

    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: True)
    assert snapshot_mod._force_in_cooldown(key, 100.5, "all_equity") is True
    assert snapshot_mod._force_in_cooldown(key, 101.5, "all_equity") is False

    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: False)
    assert snapshot_mod._force_in_cooldown(key, 102.0, "all_equity") is True
    assert snapshot_mod._force_in_cooldown(key, 105.5, "all_equity") is False


def test_live_upstream_failure_falls_back_to_memory_stale(client, mock_tv, monkeypatch):
    """A blocked live refresh that fails still serves the memory frame."""
    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: True)
    key = ("all_equity", MAX_LIMIT)
    _seed_entry(key, LIVE_STALE_MAX_SECONDS + 1.0)
    mock_tv.side_effect = RuntimeError("TV down")

    body = build_snapshot("all_equity", MAX_LIMIT)

    assert mock_tv.call_count == 1
    assert body["cached"] is True and body["stale"] is True
    assert body["rows"][0]["symbol"] == "SEEDED"



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


def test_symbols_filter_repeated_entries_collapse_under_cap(client, mock_tv):
    """Dedupe happens before the cap check: 21 repeats of one symbol -> 1 -> accepted."""
    mock_tv.return_value = _frame([RELIANCE_ROW])
    symbols = ",".join(["RELIANCE"] * 21)
    resp = client.get(f"/api/market/snapshot?symbols={symbols}")
    assert resp.status_code == 200, resp.text
    assert [r["symbol"] for r in resp.json()["rows"]] == ["RELIANCE"]
    assert resp.json()["total"] == 1
    assert mock_tv.call_count == 1


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


def test_symbols_filter_applies_before_limit(client, mock_tv):
    """Regression: the filter must see the full frame, not the truncated head.

    With ``limit=12`` the old code filtered a 12-row response, so a symbol at
    rank 40 returned ``total: 0`` even though it exists. The scan is now built
    at MAX_LIMIT and the cap is applied after the filter.
    """
    rows = [dict(RELIANCE_ROW, name=f"NSE:SYM{i:02d}") for i in range(40)]
    rows.append(dict(RELIANCE_ROW, name="NSE:KAYNES"))
    mock_tv.return_value = _frame(rows)

    body = client.get("/api/market/snapshot?limit=12&symbols=KAYNES").json()
    assert [r["symbol"] for r in body["rows"]] == ["KAYNES"]
    assert body["total"] == 1
    # The scan itself is not chopped to 12 rows: the filter needs the universe.
    assert mock_tv.call_args.kwargs["limit"] == MAX_LIMIT


def test_limit_without_symbols_still_truncates(client, mock_tv):
    rows = [dict(RELIANCE_ROW, name=f"NSE:SYM{i:02d}") for i in range(20)]
    # A real TV scan honours `limit`; the stub must too or the cap is untested.
    mock_tv.side_effect = lambda *a, **kw: _frame(rows[: kw["limit"]])

    body = client.get("/api/market/snapshot?limit=12").json()
    assert body["total"] == 12
    assert len(body["rows"]) == 12
    assert [r["symbol"] for r in body["rows"]] == [f"SYM{i:02d}" for i in range(12)]
    # Scan the ceiling rung; the 12-row cap is applied to the response.
    assert mock_tv.call_args.kwargs["limit"] == 50


def test_symbols_filter_total_matches_and_respects_limit(client, mock_tv):
    rows = [dict(RELIANCE_ROW, name="NSE:NOPE0") for _ in range(3)]
    rows += [dict(RELIANCE_ROW, name=f"NSE:PICK{i}") for i in range(5)]
    rows += [dict(RELIANCE_ROW, name="NSE:OTHER")]
    mock_tv.return_value = _frame(rows)

    body = client.get("/api/market/snapshot?symbols=pick0,PICK4").json()
    assert [r["symbol"] for r in body["rows"]] == ["PICK0", "PICK4"]
    assert body["total"] == 2

    # ``limit`` caps the returned rows but ``total`` still counts all matches.
    capped = client.get("/api/market/snapshot?symbols=PICK0,PICK1,PICK2&limit=2").json()
    assert [r["symbol"] for r in capped["rows"]] == ["PICK0", "PICK1"]
    assert capped["total"] == 3


def test_upstream_failure_502_without_cache(client, mock_tv, caplog):
    mock_tv.side_effect = RuntimeError("TV scanner blew up secret")
    with caplog.at_level("ERROR", logger="api.market_screen.router"):
        resp = client.get("/api/market/snapshot?limit=123")
    assert resp.status_code == 502
    assert resp.json()["detail"] == _MARKET_SOURCE_UNAVAILABLE_DETAIL
    # Fixed client detail; upstream text only in the server-side log.
    assert "TV scanner blew up secret" not in resp.text
    assert "market snapshot upstream failure" in caplog.text
    assert "TV scanner blew up secret" in caplog.text


def test_upstream_failure_serves_stale_memory_entry(client, mock_tv):
    """Upstream down + expired memory entry -> serve stale, cached=true, stale=true."""
    two = [RELIANCE_ROW, dict(RELIANCE_ROW, name="NSE:TCS", market_cap_basic=1.4e12)]
    mock_tv.return_value = _frame(two)
    first = client.get("/api/market/snapshot").json()
    # Expire the in-memory entry (freshness reads stored_at), then make the
    # upstream fail.
    key = ("all_equity", MAX_LIMIT)
    _cache[key]["stored_at"] = time() - 120
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



def test_stale_path_is_json():
    """The stale path keeps its <universe>_<limit> shape, now with .json."""
    assert _stale_path("all_equity", 17) == (
        _STALE_DIR / "snapshot_stale_all_equity_17.json"
    )


def test_stale_snapshot_json_round_trip():
    """write -> read yields the same envelope, stored as plain JSON."""
    stored_rows = [EXPECTED_RELIANCE_ROW]
    _save_stale_snapshot(
        "all_equity", MAX_LIMIT, 1234.5, "2026-01-05T00:00:00+05:30",
        "streaming", stored_rows,
    )
    path = _stale_path("all_equity", MAX_LIMIT)
    assert path.suffix == ".json"

    # The bytes on disk are JSON, decodable without any pickle machinery.
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk["as_of"] == "2026-01-05T00:00:00+05:30"
    assert on_disk["update_mode"] == "streaming"
    assert on_disk["rows"] == stored_rows

    loaded = snapshot_mod._load_stale_snapshot("all_equity", MAX_LIMIT)
    assert loaded == on_disk


def test_stale_snapshot_coerces_non_json_safe_values():
    """Odd field values are coerced (NaN -> None, object -> str) on write."""
    row = dict(EXPECTED_RELIANCE_ROW, close=float("nan"), weird=object())
    _save_stale_snapshot(
        "all_equity", MAX_LIMIT, time(), "asof", "streaming", [row]
    )
    loaded = snapshot_mod._load_stale_snapshot("all_equity", MAX_LIMIT)
    assert loaded["rows"][0]["close"] is None
    assert isinstance(loaded["rows"][0]["weird"], str)


def test_malformed_json_stale_is_ignored():
    """Malformed or wrong-shape JSON is treated as no stale cache."""
    path = _stale_path("all_equity", MAX_LIMIT)
    path.write_text("{not valid json", encoding="utf-8")
    assert snapshot_mod._load_stale_snapshot("all_equity", MAX_LIMIT) is None

    path.write_text("[1, 2, 3]", encoding="utf-8")  # parses, wrong shape
    assert snapshot_mod._load_stale_snapshot("all_equity", MAX_LIMIT) is None


def test_old_pickle_stale_file_is_ignored():
    """A legacy .pkl stale file is not read -- the read path is JSON-only."""
    pkl = _stale_path("all_equity", MAX_LIMIT).with_suffix(".pkl")
    pkl.write_bytes(b"\x80\x04N.")  # a valid pickle stream, never decoded
    assert pkl.exists()
    assert snapshot_mod._load_stale_snapshot("all_equity", MAX_LIMIT) is None


def test_snapshot_source_has_no_pickle():
    """Security guard: snapshot.py contains no pickle import or use."""
    source = Path(snapshot_mod.__file__).read_text(encoding="utf-8")
    assert "pickle" not in source



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


def test_live_stale_serve_survives_background_refresh_failure(monkeypatch):
    """The served stale frame is untouched when the refresh behind it fails."""
    monkeypatch.setattr(snapshot_mod, "_universe_is_live", lambda universe: True)
    key = ("all_equity", MAX_LIMIT)
    _seed_entry(key, 6.0)

    with _gated_tv_scan() as (scan, started, release, outcome):
        served = build_snapshot("all_equity", MAX_LIMIT)
        assert served["cached"] is True and served["stale"] is True
        assert served["rows"][0]["symbol"] == "SEEDED"
        assert served["age_sec"] >= 6.0

        assert started.wait(timeout=5)
        refresh = _inflight[key]
        outcome["exc"] = RuntimeError("TV down")
        release.set()
        assert refresh["event"].wait(timeout=5), "refresh never signalled"

    assert refresh["exc"] is not None
    assert key not in _inflight
    assert scan.call_count == 1
    assert _cache[key]["rows"][0]["symbol"] == "SEEDED"


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



AAPL_ROW = {
    "name": "NASDAQ:AAPL", "description": "Apple Inc",
    "sector": "Technology", "exchange": "NASDAQ",
    "type": "stock", "currency": "USD",
    "close": 220.0, "change": 1.2,
    "relative_volume_10d_calc": 1.1, "market_cap_basic": 2_500_000_000_000,
    "RSI": 55.0, "ADX": 20.0,
    "SMA20": 215.0, "SMA50": 210.0, "SMA200": 190.0,
    "Perf.W": 1.5, "Perf.1M": 3.2,
    "price_52_week_high": 240.0, "price_52_week_low": 160.0,
    "price_earnings_ttm": 34.0,
    "price_book_fq": 45.0,
    "dividend_yield_recent": 0.5,
    "return_on_equity": 150.0,
    "update_mode": "streaming",
}


def _us_row(symbol: str, exchange: str, mcap, type_: str = "stock") -> dict:
    return dict(
        AAPL_ROW,
        name=f"{exchange}:{symbol}",
        exchange=exchange,
        type=type_,
        market_cap_basic=mcap,
    )


def _us_frame(records) -> pd.DataFrame:
    """US frame includes the extra ``type`` column the scan requests."""
    return coerce_numeric(pd.DataFrame(records, columns=US_COLUMNS))


def test_us_universe_uses_america_scanner(client, mock_tv):
    assert "us" in ALLOWED_UNIVERSES
    mock_tv.return_value = _us_frame([_us_row("AAPL", "NASDAQ", 2.5e12)])
    resp = client.get("/api/market/snapshot?universe=us")
    assert resp.status_code == 200
    body = resp.json()
    assert body["universe"] == "us"
    assert body["total"] == 1
    assert body["update_mode"] == "streaming"
    assert body["cached"] is False and body["stale"] is False
    args, kw = mock_tv.call_args
    assert args[0] == "america"
    assert kw["columns"] == US_COLUMNS
    assert kw["filters"] == [TYPE_STOCK_FILTER]
    assert kw["sort"] == "market_cap_basic"
    assert kw["order"] == "desc"
    assert kw["limit"] == MAX_LIMIT


def test_us_rows_are_usd_with_absolute_cap_tiers(client, mock_tv):
    rows = [
        _us_row("MSFT", "NASDAQ", 3_000_000_000_000),  # $3000B
        _us_row("JPM", "NYSE", 500_000_000_000),       # $500B
        _us_row("BA", "NYSE", 5_000_000_000),          # $5B
        _us_row("ACME", "AMEX", 800_000_000),          # $0.8B
        _us_row("TINY", "NASDAQ", 100_000_000),        # $0.1B
        _us_row("NOCAP", "NASDAQ", None),
    ]
    mock_tv.return_value = _us_frame(rows)
    got = client.get("/api/market/snapshot?universe=us").json()
    out = got["rows"]
    assert [r["symbol"] for r in out] == ["MSFT", "JPM", "BA", "ACME", "TINY", "NOCAP"]
    assert [(r["cap_tier"], r["marketCapUsdB"]) for r in out] == [
        ("mega", 3000.0), ("mega", 500.0), ("mid", 5.0),
        ("small", 0.8), ("micro", 0.1), ("micro", None),
    ]
    assert all(r["currency"] == "USD" for r in out)
    assert all(r["market_cap_cr"] is None for r in out)
    assert all(r["fno"] is False and r["etf"] is False for r in out)
    assert got["total"] == 6


def test_us_cap_tier_boundaries(client, mock_tv):
    """Absolute thresholds are inclusive; a cap below the lowest one takes the
    spec's fallback. Tiers, boundaries and the weakest tier all come from the
    registry, so adding a tier needs no test edit.
    """
    spec = UNIVERSES["us"].cap_tiers
    thresholds = spec.absolute  # ((minimum_billions, tier), ...) descending
    assert thresholds, "US spec must declare absolute cap tiers"

    # One row exactly at every boundary plus one deliberately below the lowest
    # boundary, which exercises the fallback ("weakest") tier.
    below = thresholds[-1][0] * 0.997
    caps_b = [minimum for minimum, _ in thresholds] + [below]
    rows = [
        _us_row(f"BOUND{i:02d}", "NASDAQ", cap * 1e9)
        for i, cap in enumerate(caps_b)
    ]
    mock_tv.return_value = _us_frame(rows)
    out = client.get("/api/market/snapshot?universe=us").json()["rows"]
    got_caps = [r["marketCapUsdB"] for r in out]
    got_tiers = [r["cap_tier"] for r in out]

    def expected_tier(cap_b):
        for minimum, tier in thresholds:
            if cap_b >= minimum:
                return tier
        return spec.fallback

    # Boundary behaviour: each threshold is inclusive and the lowest cap falls
    # back. Derived from the spec, not a frozen tier list.
    assert got_tiers == [expected_tier(cap) for cap in got_caps]
    # Registry membership: no emitted tier is made up.
    assert set(got_tiers) <= set(ALL_CAP_TIERS)
    # Descending size order: tiers follow the registry's threshold order, not
    # the row order, so an inverted pair fails here.
    rank = {tier: i for i, (_, tier) in enumerate(thresholds)}
    rank[spec.fallback] = len(thresholds)
    assert [rank[tier] for tier in got_tiers] == sorted(rank[tier] for tier in got_tiers)
    # The deliberately weak tier is still exercised by the below-threshold row.
    assert got_tiers[-1] == spec.fallback
    assert got_caps[-1] < thresholds[-1][0]


def test_us_drops_otc_foreign_and_funds(client, mock_tv):
    rows = [
        _us_row("AAPL", "NASDAQ", 2e12),
        _us_row("MSFT", "NYSE", 1e12),
        _us_row("BA", "AMEX", 5e10),
        _us_row("OTCCO", "OTC", 1e10),
        _us_row("LSECO", "LSE", 1e10),
        _us_row("TSECO", "TSE", 1e10),
        _us_row("QQQF", "NASDAQ", 1e10, type_="fund"),
        _us_row("ETFF", "NYSE", 1e10, type_="etf"),
        _us_row("DRCO", "NYSE", 1e10, type_="dr"),
    ]
    mock_tv.return_value = _us_frame(rows)
    out = client.get("/api/market/snapshot?universe=us").json()["rows"]
    assert [r["symbol"] for r in out] == ["AAPL", "MSFT", "BA"]


def test_us_never_inherits_nse_fno_etf_flags(client):
    with patch("api.market_screen.snapshot.scan_frame") as scan, \
            patch("api.market_screen.snapshot.tv_feed_status",
                  return_value={"mode": "streaming"}), \
            patch("api.market_screen.snapshot._FNO_SYMBOLS", {"AAPL"}), \
            patch("api.market_screen.snapshot._ETF_SYMBOLS", {"AAPL"}):
        scan.return_value = _us_frame([_us_row("AAPL", "NASDAQ", 2e12)])
        body = client.get("/api/market/snapshot?universe=us").json()
    row = body["rows"][0]
    assert row["fno"] is False and row["etf"] is False


def test_india_rows_keep_inr_and_have_no_usd_field(client, mock_tv):
    mock_tv.return_value = _frame([RELIANCE_ROW])
    row = client.get("/api/market/snapshot").json()["rows"][0]
    assert row["currency"] == "INR"
    assert "marketCapUsdB" not in row
    assert row["market_cap_cr"] == 199000.0


def test_cache_is_keyed_by_universe(client, mock_tv):
    def scan(market, **kwargs):
        if market == "america":
            return _us_frame([_us_row("AAPL", "NASDAQ", 2e12)])
        return _frame([RELIANCE_ROW])

    mock_tv.side_effect = scan
    india = client.get("/api/market/snapshot").json()
    us = client.get("/api/market/snapshot?universe=us").json()
    assert india["rows"][0]["symbol"] == "RELIANCE"
    assert us["rows"][0]["symbol"] == "AAPL"
    assert mock_tv.call_count == 2

    india_again = client.get("/api/market/snapshot").json()
    us_again = client.get("/api/market/snapshot?universe=us").json()
    assert india_again["cached"] is True and us_again["cached"] is True
    assert mock_tv.call_count == 2  # each universe reused its own cached frame


def test_us_cache_hit_and_force(client, mock_tv):
    mock_tv.return_value = _us_frame([_us_row("AAPL", "NASDAQ", 2e12)])
    first = client.get("/api/market/snapshot?universe=us").json()
    second = client.get("/api/market/snapshot?universe=us").json()
    assert mock_tv.call_count == 1
    assert first["cached"] is False and second["cached"] is True
    third = client.get("/api/market/snapshot?universe=us&force=true").json()
    assert mock_tv.call_count == 2 and third["cached"] is False


def test_us_cold_start_serves_disk_stale_and_refreshes(client, mock_tv):
    _save_stale_snapshot(
        "us", MAX_LIMIT, time() - 120, "2026-01-05T00:00:00+05:30",
        "streaming", [{"symbol": "STALE", "currency": "USD"}],
    )
    mock_tv.return_value = _us_frame([_us_row("AAPL", "NASDAQ", 2e12)])
    out = build_snapshot("us", MAX_LIMIT)
    assert out["stale"] is True and out["cached"] is False
    assert out["rows"][0]["symbol"] == "STALE"

    key = ("us", MAX_LIMIT)
    assert key in _inflight
    _inflight[key]["event"].wait(timeout=5)
    assert key not in _inflight

    fresh = build_snapshot("us", MAX_LIMIT)
    assert fresh["cached"] is True and fresh["stale"] is False
    assert fresh["rows"][0]["symbol"] == "AAPL"
    assert fresh["rows"][0]["currency"] == "USD"


def test_us_symbols_filter(client, mock_tv):
    mock_tv.return_value = _us_frame([
        _us_row("AAPL", "NASDAQ", 2e12),
        _us_row("MSFT", "NASDAQ", 1e12),
        _us_row("JPM", "NYSE", 5e11),
    ])
    body = client.get("/api/market/snapshot?universe=us&symbols=aapl,jpm").json()
    assert body["universe"] == "us"
    assert [r["symbol"] for r in body["rows"]] == ["AAPL", "JPM"]
    assert body["total"] == 2
    assert body["rows"][0]["currency"] == "USD"
    assert body["rows"][0]["market_cap_cr"] is None



#: The 12 live-offender lines: the first three have no slash in the ticker and
#: are caught by the description token; the rest are caught by the slash.
US_PREFERRED_LINES = [
    ("GOOGN", "NASDAQ", "Alphabet Inc Depositary Shs Repr 1/20th"),
    ("GOOGM", "NASDAQ", "Alphabet Inc Depository Shares Series A"),
    ("METAM", "NASDAQ", "Meta Platforms Inc Cum Conv Pfd"),
    ("JPM/PK", "NYSE", "JPMorgan Chase & Co Pfd Series K"),
    ("JPM/PM", "NYSE", "JPMorgan Chase & Co Pfd Series M"),
    ("JPM/PL", "NYSE", "JPMorgan Chase & Co Pfd Series L"),
    ("JPM/PJ", "NYSE", "JPMorgan Chase & Co Pfd Series J"),
    ("JPM/PD", "NYSE", "JPMorgan Chase & Co Pfd Series D"),
    ("JPM/PC", "NYSE", "JPMorgan Chase & Co Pfd Series C"),
    ("ORCL/PD", "NYSE", "Oracle Corp Pfd Series D"),
    ("BAC/PN", "NYSE", "Bank of America Corp Pfd Series N"),
    ("BML/PL", "NYSE", "Bank of America Corp Pfd Series L"),
]

#: Ordinary class shares that must survive: dots in the ticker and the word
#: "Class" in the description are deliberately absent from the patterns.
US_KEPT_LINES = [
    ("GOOG", "NASDAQ", "Alphabet Inc Class C"),
    ("JPM", "NYSE", "JPMorgan Chase & Co"),
    ("BRK.B", "NYSE", "Berkshire Hathaway Inc Class B"),
    ("BF.B", "NYSE", "Brown-Forman Corp Class B"),
]


def _us_hygiene_row(sym, exchange, description) -> dict:
    return dict(_us_row(sym, exchange, 1.5e12), description=description)


def test_us_drops_preferred_and_depositary_lines(client, mock_tv):
    """All 12 mislabelled lines are dropped; GOOG/JPM/BRK.B/BF.B survive."""
    rows = [_us_hygiene_row(*line) for line in US_PREFERRED_LINES]
    rows += [_us_hygiene_row(*line) for line in US_KEPT_LINES]
    mock_tv.return_value = _us_frame(rows)

    out = client.get("/api/market/snapshot?universe=us").json()["rows"]
    # Brk.B/BF.B lose their dot in tv_name_to_symbol -> BRKB/BFB.
    assert {r["symbol"] for r in out} == {"GOOG", "JPM", "BRKB", "BFB"}
    assert len(out) == len(US_KEPT_LINES)
    assert not any("/" in r["symbol"] for r in out)


def test_us_hygiene_does_not_empty_universe(client, mock_tv):
    """Sanity count: dropping the 12 lines never empties a populated universe."""
    rows = [_us_hygiene_row(*line) for line in US_PREFERRED_LINES]
    rows += [
        dict(_us_row(f"N{i}", "NASDAQ", 1e12), description=f"Normal Co {i}")
        for i in range(20)
    ]
    mock_tv.return_value = _us_frame(rows)

    out = client.get("/api/market/snapshot?universe=us").json()
    assert out["total"] == 20
    assert len(out["rows"]) == 20


@pytest.mark.parametrize(
    "token",
    [
        "Depositary", "Depository", "Pfd", "Preferred Shs",
        "Preferred Shares", "Preferred Stock",
        "Repr 1/", "Cum Conv", "Dep Shs",
    ],
)
def test_us_name_exclusion_tokens_match_case_insensitively(token):
    assert re.search(US_EXCLUDE_NAME_PATTERN, f"Acme {token} Series A", re.I)
    assert re.search(US_EXCLUDE_NAME_PATTERN, f"Acme {token.lower()} Series A", re.I)


@pytest.mark.parametrize(
    "name",
    [
        "BRK.B", "BF.B", "Berkshire Hathaway Inc Class B",
        "Preferred Bank", "PFBC",
    ],
)
def test_us_hygiene_spares_dots_class_and_legit_names(name):
    """A bare 'Preferred' in a company name must not trip the token."""
    assert not re.search(US_EXCLUDE_SYMBOL_PATTERN, name, re.I)
    assert not re.search(US_EXCLUDE_NAME_PATTERN, name, re.I)


def test_us_keeps_preferred_bank_and_drops_preferred_shares(client, mock_tv):
    """Operating company 'Preferred Bank' survives; share instruments do not."""
    rows = [
        _us_hygiene_row("PFBC", "NASDAQ", "Preferred Bank"),
        _us_hygiene_row("JPM", "NYSE", "JPMorgan Chase & Co Preferred Shs Series K"),
        _us_hygiene_row("XYZ", "NYSE", "XYZ Corp Pfd"),
        _us_hygiene_row("GOOGN", "NASDAQ", "Alphabet Inc Depositary Shs"),
    ]
    mock_tv.return_value = _us_frame(rows)

    out = client.get("/api/market/snapshot?universe=us").json()["rows"]
    assert [r["symbol"] for r in out] == ["PFBC"]


#: Observed on the live america frame (2026-11-16): coupon notes, bonds and OP
#: LP units typed ``stock`` with the parent's cap, none carrying an old token.
US_DEBT_AND_OP_LINES = [
    ("SOJD", "NYSE", "Southern Company 4.95 % Notes 2020-30.01.80 Global Series 2020A"),
    ("SOJE", "NYSE", "Southern Co 4.2 % Notes 2020-15.10.60 Global Series 2020C Deferrable"),
    ("XELLL", "NASDAQ", "Xcel Energy Inc. 6.25 % Notes 2025-15.10.85"),
    ("PFH", "NYSE", "Prudential Financial, Inc. 4.125 % Notes 2020-01.09.60 Global"),
    ("PRS", "NYSE", "Prudential Financial, Inc. 5.625 % Bonds 2018-15.08.58"),
    ("KMPB", "NYSE", "Kemper Corp 5.875 % Bonds 2022-15.03.62 Global"),
    ("FISK", "AMEX", "Empire State Realty OP LP Series 250"),
    ("OGCP", "AMEX", "Empire State Realty OP LP Series 60"),
]

#: Issuers whose legal name contains an instrument word but which are common
#: equity; these must survive the extended name pattern.
US_ISSUERS_WITH_INSTRUMENT_WORDS = [
    ("OBAI", "NASDAQ", "Our Bond, Inc."),
    ("CBNT", "NASDAQ", "C-Bond Systems, Inc."),
    ("UNTC", "NASDAQ", "Unit Corporation"),
    ("RTON", "NASDAQ", "Right On Brands Inc"),
    ("FWONA", "NASDAQ", "Liberty Media Corporation Series A"),
    ("UHAL.B", "NYSE", "U-Haul Holding Company Series N Non-Voting"),
    ("ESRT", "NYSE", "Empire State Realty Trust, Inc."),
    ("PFBC", "NASDAQ", "Preferred Bank"),
]


@pytest.mark.parametrize(
    "description", [line[2] for line in US_DEBT_AND_OP_LINES]
    + ["Allstate Corporation Debentures 2013-15.1.53 Subord",
       "Empire State Realty OP, LP Series ES"]
)
def test_us_name_exclusion_debt_and_op_tokens_match(description):
    assert re.search(US_EXCLUDE_NAME_PATTERN, description, re.I)
    assert re.search(US_EXCLUDE_NAME_PATTERN, description.lower(), re.I)


@pytest.mark.parametrize(
    "name", [line[2] for line in US_ISSUERS_WITH_INSTRUMENT_WORDS]
    + ["BRK.B", "BF.B", "MKC.V", "Berkshire Hathaway Inc Class B"]
)
def test_us_hygiene_spares_issuers_with_instrument_words(name):
    assert not re.search(US_EXCLUDE_SYMBOL_PATTERN, name, re.I)
    assert not re.search(US_EXCLUDE_NAME_PATTERN, name, re.I)


def test_us_drops_debt_and_op_lines_keeps_issuers(client, mock_tv):
    """Integration: the new tokens drop debt/OP units, not common issuers."""
    rows = [_us_hygiene_row(*line) for line in US_DEBT_AND_OP_LINES]
    rows += [_us_hygiene_row(*line) for line in US_ISSUERS_WITH_INSTRUMENT_WORDS]
    rows += [_us_hygiene_row("BRK.B", "NYSE", "Berkshire Hathaway Inc Class B")]
    mock_tv.return_value = _us_frame(rows)

    out = client.get("/api/market/snapshot?universe=us").json()["rows"]
    # tv_name_to_symbol strips the dot from BRK.B -> BRKB.
    assert {r["symbol"] for r in out} == {
        "OBAI", "CBNT", "UNTC", "RTON", "FWONA", "UHALB", "ESRT", "PFBC", "BRKB",
    }
    assert not any(re.search(US_EXCLUDE_NAME_PATTERN, r["name"] or "", re.I) for r in out)


def test_india_unaffected_by_us_hygiene_patterns(client, mock_tv):
    """The depositary/name patterns live only on the US descriptor."""
    row = dict(
        RELIANCE_ROW,
        name="NSE:RELIANCE",
        description="Reliance Industries Depositary Shs Pfd",
    )
    mock_tv.return_value = _frame([row])

    out = client.get("/api/market/snapshot").json()["rows"]
    assert [r["symbol"] for r in out] == ["RELIANCE"]



def test_us_small_limit_fetches_full_frame_then_hygienizes(client, mock_tv):
    """Hygiene runs on the full frame, then the response is capped.

    Regression: scanning ``limit=5`` and hygienizing that truncated frame let
    leading OTC/preferred rows under-fill the response even though valid
    NASDAQ names sat just below the cutoff.
    """
    bad = [
        _us_row("OTCCO", "OTC", 9e12),
        _us_row("LSECO", "LSE", 8e12),
        _us_hygiene_row("JPM/PK", "NYSE", "JPMorgan Chase & Co Pfd Series K"),
        _us_row("QQQF", "NASDAQ", 6e12, type_="fund"),
    ]
    good = [_us_row(f"GOOD{i}", "NASDAQ", (5 - i) * 1e12) for i in range(10)]
    mock_tv.return_value = _us_frame(bad + good)

    body = client.get("/api/market/snapshot?universe=us&limit=5").json()
    assert [r["symbol"] for r in body["rows"]] == [f"GOOD{i}" for i in range(5)]
    assert body["total"] == 5
    # Whole window scanned; hygiene + cap happen afterwards.
    assert mock_tv.call_args.kwargs["limit"] == MAX_LIMIT


def test_india_small_limit_scans_smallest_ladder_rung(client, mock_tv):
    """India has no local hygiene: a small cap scans the smallest rung, not 4000."""
    rows = [dict(RELIANCE_ROW, name=f"NSE:SYM{i:02d}") for i in range(20)]
    mock_tv.side_effect = lambda *a, **kw: _frame(rows[: kw["limit"]])
    body = client.get("/api/market/snapshot?limit=5").json()
    assert [r["symbol"] for r in body["rows"]] == [f"SYM{i:02d}" for i in range(5)]
    assert body["total"] == 5
    assert mock_tv.call_args.kwargs["limit"] == 50


def test_us_two_limits_share_one_full_scan(client, mock_tv):
    """Two requested limits for one hygiene universe = one TV scan.

    The cache is keyed by the fetch window (MAX_LIMIT for US) and sliced per
    request, so differing caps cannot multiply full scans.
    """
    rows = [_us_row(f"GOOD{i}", "NASDAQ", (20 - i) * 1e12) for i in range(20)]
    mock_tv.return_value = _us_frame(rows)

    five = client.get("/api/market/snapshot?universe=us&limit=5").json()
    ten = client.get("/api/market/snapshot?universe=us&limit=10").json()

    assert mock_tv.call_count == 1
    assert [r["symbol"] for r in five["rows"]] == [f"GOOD{i}" for i in range(5)]
    assert [r["symbol"] for r in ten["rows"]] == [f"GOOD{i}" for i in range(10)]
    assert five["total"] == 5 and ten["total"] == 10
    assert five["cached"] is False and ten["cached"] is True


def test_us_symbols_filter_with_small_limit_filters_before_cap(client, mock_tv):
    """symbols stays a response transform: filter the full frame, then cap."""
    rows = [_us_row(f"GOOD{i}", "NASDAQ", (20 - i) * 1e12) for i in range(20)]
    mock_tv.return_value = _us_frame(rows)

    body = client.get(
        "/api/market/snapshot?universe=us&symbols=GOOD0,GOOD7,GOOD19&limit=2"
    ).json()
    assert [r["symbol"] for r in body["rows"]] == ["GOOD0", "GOOD7"]
    assert body["total"] == 3  # matched before the cap
    assert mock_tv.call_args.kwargs["limit"] == MAX_LIMIT



def _india_rows(n: int) -> list[dict]:
    return [dict(RELIANCE_ROW, name=f"NSE:SYM{i:04d}") for i in range(n)]


def test_fetch_limit_ladder_is_small_sorted_and_covers_max():
    ladder = FETCH_LIMIT_LADDER
    assert list(ladder) == sorted(ladder)
    assert ladder[0] > 0
    assert ladder[-1] == MAX_LIMIT
    assert len(ladder) <= 10  # bounded set of rungs, not one per client limit


@pytest.mark.parametrize(
    ("universe", "limit", "expected"),
    [
        ("all_equity", 1, 50),
        ("all_equity", 12, 50),
        ("all_equity", 50, 50),
        ("all_equity", 51, 100),
        ("all_equity", 100, 100),
        ("all_equity", 101, 250),
        ("all_equity", 250, 250),
        ("all_equity", 251, 500),
        ("all_equity", 500, 500),
        ("all_equity", 501, 1000),
        ("all_equity", 1000, 1000),
        ("all_equity", 1001, 2000),
        ("all_equity", 2000, 2000),
        ("all_equity", 2001, MAX_LIMIT),
        ("all_equity", MAX_LIMIT, MAX_LIMIT),
        ("us", 1, MAX_LIMIT),   # hygiene universe: unchanged full-frame path
        ("us", 12, MAX_LIMIT),
        ("us", MAX_LIMIT, MAX_LIMIT),
    ],
)
def test_scan_window_buckets(universe, limit, expected):
    assert snapshot_mod._scan_window(universe, limit) == expected


@pytest.mark.parametrize(
    ("limit", "expected_rung"),
    [(1, 50), (12, 50), (300, 500), (4000, MAX_LIMIT)],
)
def test_india_fetch_limit_maps_to_ladder_rung(client, mock_tv, limit, expected_rung):
    """Cap is ceiling-mapped to a rung; the response keeps the exact cap."""
    rows = _india_rows(4000)
    mock_tv.side_effect = lambda *a, **kw: _frame(rows[: kw["limit"]])

    body = client.get(f"/api/market/snapshot?limit={limit}").json()

    assert mock_tv.call_args.kwargs["limit"] == expected_rung
    assert len(body["rows"]) == limit
    assert body["total"] == limit
    assert ("all_equity", expected_rung) in _cache


def test_india_two_limits_same_rung_share_one_scan(client, mock_tv):
    """limit=12 and limit=50 both map to the 50 rung: one scan, two caps."""
    rows = _india_rows(60)
    mock_tv.side_effect = lambda *a, **kw: _frame(rows[: kw["limit"]])

    twelve = client.get("/api/market/snapshot?limit=12").json()
    fifty = client.get("/api/market/snapshot?limit=50").json()

    assert mock_tv.call_count == 1
    assert [kw["limit"] for _, kw in mock_tv.call_args_list] == [50]
    assert len(twelve["rows"]) == 12 and twelve["total"] == 12
    assert len(fifty["rows"]) == 50 and fifty["total"] == 50
    assert twelve["cached"] is False and fifty["cached"] is True
    assert list(_cache) == [("all_equity", 50)]


def test_india_different_rungs_scan_twice(client, mock_tv):
    """limit=12 (50 rung) and limit=300 (500 rung) are distinct scans/entries."""
    rows = _india_rows(500)
    mock_tv.side_effect = lambda *a, **kw: _frame(rows[: kw["limit"]])

    small = client.get("/api/market/snapshot?limit=12").json()
    large = client.get("/api/market/snapshot?limit=300").json()

    assert mock_tv.call_count == 2
    assert [kw["limit"] for _, kw in mock_tv.call_args_list] == [50, 500]
    assert len(small["rows"]) == 12 and small["total"] == 12
    assert len(large["rows"]) == 300 and large["total"] == 300
    assert set(_cache) == {("all_equity", 50), ("all_equity", 500)}


def test_india_symbols_filter_uses_full_window_bucket(client, mock_tv):
    """symbols sees the full 4000-row window, not the small response cap."""
    rows = _india_rows(60) + [dict(RELIANCE_ROW, name="NSE:KAYNES")]
    mock_tv.side_effect = lambda *a, **kw: _frame(rows[: kw["limit"]])

    body = client.get("/api/market/snapshot?limit=12&symbols=KAYNES").json()

    assert [r["symbol"] for r in body["rows"]] == ["KAYNES"]
    assert body["total"] == 1
    assert mock_tv.call_args.kwargs["limit"] == MAX_LIMIT


class TestCacheBound:
    def test_inserting_more_than_cap_evicts_oldest(self):
        with snapshot_mod._cache_lock:
            snapshot_mod._cache.clear()
        try:
            for i in range(40):
                snapshot_mod._cache[("all_equity", i)] = {"rows": [i]}

            assert len(snapshot_mod._cache) == snapshot_mod.MAX_CACHE_ENTRIES
            assert ("all_equity", 0) not in snapshot_mod._cache
            assert ("all_equity", 39) in snapshot_mod._cache
            assert snapshot_mod._cache[("all_equity", 39)]["rows"] == [39]
        finally:
            with snapshot_mod._cache_lock:
                snapshot_mod._cache.clear()

    def test_touched_entry_is_not_the_one_evicted(self):
        with snapshot_mod._cache_lock:
            snapshot_mod._cache.clear()
        try:
            for i in range(snapshot_mod.MAX_CACHE_ENTRIES):
                snapshot_mod._cache[("all_equity", i)] = {"rows": [i]}

            snapshot_mod._cache.get(("all_equity", 0))  # make it newest
            snapshot_mod._cache[("all_equity", 999)] = {"rows": [999]}

            assert ("all_equity", 0) in snapshot_mod._cache
            assert ("all_equity", 1) not in snapshot_mod._cache
            assert len(snapshot_mod._cache) == snapshot_mod.MAX_CACHE_ENTRIES
        finally:
            with snapshot_mod._cache_lock:
                snapshot_mod._cache.clear()


def test_shape_rows_converts_pandas_nan_text_to_null():
    from api.market_screen.snapshot import _shape_rows

    rows = _shape_rows(
        [
            {
                "name": "NSE:TEST",
                "description": float("nan"),
                "sector": float("nan"),
                "exchange": "NSE",
            }
        ],
        universe="all_equity",
    )

    assert rows[0]["symbol"] == "TEST"
    assert rows[0]["name"] is None
    assert rows[0]["sector"] is None
    assert rows[0]["exchange"] == "NSE"
