"""Call-count regressions for the sector/rotation/heatmap TV consumers.

All three modules now fetch through ``api.tv.cache``. These tests drive a
single scanner stand-in and count *upstream* scans, so they pin down which
queries legitimately share a frame, which stay separate, and what force /
invalidate / TTL do to each descriptor.
"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.heatmap as heatmap
import api.rotation as rotation
import api.sector as sector
import api.tv.cache as tv_cache
from api.tv import PERFORMANCE_FIELDS
from api.tv.cache import FrameDescriptor, invalidate


def _group_frame() -> pd.DataFrame:
    """The canonical fundamentals/technicals frame (groups + rotation)."""
    rows = []
    for i, (name, sec, ind, sign) in enumerate([
        ("NSE:AAA", "Tech", "Software", 1),
        ("NSE:BBB", "Tech", "Software", 1),
        ("NSE:CCC", "Tech", "Services", 1),
        ("NSE:DDD", "Energy", "Oil", -1),
        ("NSE:EEE", "Energy", "Oil", -1),
        ("NSE:FFF", "Energy", "Oil", -1),
    ]):
        rows.append({
            "name": name,
            "sector": sec,
            "industry": ind,
            "change": float(sign * (i + 1)),
            "Perf.W": float(sign * 2),
            "Perf.1M": float(sign * 4),
            "Perf.3M": float(sign * 6),
            "Perf.6M": float(sign * 8),
            "Perf.YTD": float(sign * 10),
            "Perf.Y": float(sign * 12),
            "market_cap_basic": float(1000 - i),
            "relative_volume": 1.0 + i / 10,
        })
    return pd.DataFrame(rows, columns=list(sector.SHARED_FRAME_COLUMNS))


def _sector_frame() -> pd.DataFrame:
    return pd.DataFrame({
        "name": ["NSE:AAA", "NSE:BBB"],
        "close": [100.0, 200.0],
        "change": [2.0, 1.0],
        "sector": ["Tech", "Energy"],
        "market_cap_basic": [1000.0, 900.0],
        "RSI": [60.0, 40.0],
        "ADX": [30.0, 20.0],
    })


def _heatmap_frame() -> pd.DataFrame:
    return pd.DataFrame({
        "name": ["NSE:AAA", "BSE:AAA", "NSE:BBB"],
        "close": [100.0, 100.0, 50.0],
        "change": [1.5, 1.5, -0.5],
        "sector": ["Tech", "Tech", "Energy"],
        "market_cap_basic": [1000.0, 1000.0, 900.0],
        "price_earnings_ttm": [20.0, 20.0, 12.0],
        "price_book_ratio": [3.0, 3.0, 1.5],
        "dividend_yield_recent": [1.0, 1.0, 2.0],
        "Perf.Y": [10.0, 10.0, -5.0],
        "return_on_equity": [15.0, 15.0, 8.0],
        "price_52_week_high": [120.0, 120.0, 60.0],
        "price_52_week_low": [80.0, 80.0, 40.0],
    })


class _Scanner:
    """Records every real upstream scan and serves a frame by query shape."""

    def __init__(self):
        self.calls: list[dict] = []

    def __call__(self, market, **kwargs):
        self.calls.append(kwargs)
        columns = set(kwargs.get("columns") or [])
        if "RSI" in columns:
            return _sector_frame()
        if "price_earnings_ttm" in columns:
            return _heatmap_frame()
        return _group_frame()


def _clear_payload_caches() -> None:
    """Drop aggregated payloads while leaving the shared frame cache alone."""
    sector._sector_cache.clear()
    sector._group_cache.clear()
    with rotation._overview_lock:
        rotation._overview_cache.clear()
    with rotation._frame_lock:
        rotation._frame_cache.clear()
    heatmap._heatmap_cache = {"data": None, "timestamp": None}


@pytest.fixture
def clients(monkeypatch):
    scanner = _Scanner()
    monkeypatch.setattr(tv_cache, "scan_frame", scanner)
    monkeypatch.setattr(
        rotation, "_fetch_benchmark",
        lambda market: {
            "benchmark": "NIFTY 50",
            "returns": {p: 0.0 for p in PERFORMANCE_FIELDS},
            "vix": None,
            "vix_change": None,
        },
    )

    tv_cache.clear()
    sector.clear_sector_cache()
    sector._group_cache.clear()
    rotation.clear_cache()
    heatmap._heatmap_cache = {"data": None, "timestamp": None}

    app = FastAPI()
    for router in (sector.router, rotation.router, heatmap.router):
        app.include_router(router)
    with TestClient(app) as client:
        yield client, scanner

    tv_cache.clear()
    sector.clear_sector_cache()
    sector._group_cache.clear()
    rotation.clear_cache()
    heatmap._heatmap_cache = {"data": None, "timestamp": None}


def _groups(client):
    return client.get("/api/sector/groups", params={"market": "india", "classify": "sector"})


def _rotation(client):
    return client.get(
        "/api/rotation/overview",
        params={"market": "india", "kind": "sector", "min_members": 1},
    )


def _sector(client, **params):
    return client.get("/api/sector", params={"market": "india", **params})


def _heatmap(client):
    return client.get("/api/heatmap/pe")


# --------------------------------------------------------------------------- #
# Sharing / separation
# --------------------------------------------------------------------------- #

def test_matching_descriptors_share_one_scan(clients):
    """Repeated group + rotation reads reuse one canonical frame."""
    client, scanner = clients
    assert _groups(client).status_code == 200
    assert _rotation(client).status_code == 200
    assert len(scanner.calls) == 1
    assert scanner.calls[0]["limit"] == sector.SHARED_FRAME_LIMIT

    # Drop only the aggregate payloads: the next reads must hit the same frame.
    _clear_payload_caches()
    assert _groups(client).status_code == 200
    assert _rotation(client).status_code == 200
    assert len(scanner.calls) == 1


def test_distinct_descriptors_stay_separate(clients):
    """Sector technicals, the shared frame and P/E heatmap are three scans."""
    client, scanner = clients
    assert _sector(client).status_code == 200
    assert _groups(client).status_code == 200
    assert _heatmap(client).status_code == 200
    assert len(scanner.calls) == 3

    by_limit = {call["limit"] for call in scanner.calls}
    assert by_limit == {500, sector.SHARED_FRAME_LIMIT, 1000}
    assert any("RSI" in call["columns"] for call in scanner.calls)
    assert any("price_earnings_ttm" in call["columns"] for call in scanner.calls)
    assert any("relative_volume" in call["columns"] for call in scanner.calls)

    _clear_payload_caches()
    assert _sector(client).status_code == 200
    assert _groups(client).status_code == 200
    assert _heatmap(client).status_code == 200
    assert len(scanner.calls) == 3  # no rescan for any descriptor


def test_group_limit_still_caps_the_aggregation_input(clients):
    """Slicing the shared 3,000-row frame preserves the old top-N input."""
    _, scanner = clients
    frame = sector._fetch_group_data("india", 2)
    assert len(frame) == 2
    assert len(scanner.calls) == 1  # still the one shared scan
    # A second caller with a different limit reuses the same upstream scan.
    assert len(sector._fetch_group_data("india", 5)) == 5
    assert len(scanner.calls) == 1


def test_market_is_part_of_the_descriptor(clients):
    client, scanner = clients
    assert _groups(client).status_code == 200
    assert _rotation(client).status_code == 200
    assert client.get(
        "/api/sector/groups", params={"market": "america", "classify": "sector"}
    ).status_code == 200
    assert client.get(
        "/api/rotation/overview",
        params={"market": "america", "kind": "sector", "min_members": 1},
    ).status_code == 200
    assert len(scanner.calls) == 2  # india and america frames are distinct


# --------------------------------------------------------------------------- #
# Force / invalidation / TTL
# --------------------------------------------------------------------------- #

def test_force_refreshes_only_the_requested_descriptor(clients):
    client, scanner = clients
    assert _sector(client).status_code == 200
    assert _groups(client).status_code == 200
    assert _heatmap(client).status_code == 200
    assert len(scanner.calls) == 3

    assert _sector(client, force="true").status_code == 200
    assert len(scanner.calls) == 4
    assert "RSI" in scanner.calls[-1]["columns"]

    # The forced frame is what later (non-forced) callers see.
    _clear_payload_caches()
    assert _sector(client).status_code == 200
    assert _groups(client).status_code == 200
    assert _heatmap(client).status_code == 200
    assert len(scanner.calls) == 4


def test_invalidate_drops_one_descriptor_and_heatmap_refresh_forces(clients):
    client, scanner = clients
    assert _sector(client).status_code == 200
    assert _groups(client).status_code == 200
    assert _heatmap(client).status_code == 200
    assert len(scanner.calls) == 3

    invalidate(sector._sector_descriptor("india", 500))
    sector._sector_cache.clear()
    assert _sector(client).status_code == 200
    assert len(scanner.calls) == 4
    assert "RSI" in scanner.calls[-1]["columns"]

    # The explicit heatmap refresh bypasses both its payload cache and the
    # shared frame TTL, without touching the other descriptors.
    assert client.post("/api/heatmap/refresh").status_code == 200
    assert len(scanner.calls) == 5
    assert "price_earnings_ttm" in scanner.calls[-1]["columns"]

    _clear_payload_caches()
    assert _groups(client).status_code == 200
    assert len(scanner.calls) == 5


def test_ttl_arguments_preserve_15s_sector_and_60s_rotation(clients, monkeypatch):
    """Cadence comes from TTL args, never a second module-level frame cache."""
    client, scanner = clients
    clock = {"t": 1000.0}
    monkeypatch.setattr(tv_cache, "_monotonic", lambda: clock["t"])

    assert _sector(client).status_code == 200  # 15s frame
    assert len(scanner.calls) == 1

    clock["t"] += 10
    _clear_payload_caches()
    assert _sector(client).status_code == 200  # still fresh at 10s
    assert _groups(client).status_code == 200  # first shared-frame scan
    assert len(scanner.calls) == 2

    clock["t"] += 6  # 16s: sector's 15s window expired, shared frame is 6s old
    _clear_payload_caches()
    assert _sector(client).status_code == 200
    assert len(scanner.calls) == 3

    clock["t"] += 54  # 70s: shared frame's 60s window expired
    _clear_payload_caches()
    assert _groups(client).status_code == 200
    assert len(scanner.calls) == 4
    assert _rotation(client).status_code == 200  # reuses the just-scanned frame
    assert len(scanner.calls) == 4


def test_descriptors_are_stable_keys(clients):
    """Module constants and per-request descriptors agree with the gateway key."""
    _, _ = clients
    india = sector.SHARED_FRAMES["india"]
    assert isinstance(india, FrameDescriptor)
    assert india.cache_key == FrameDescriptor(
        market="india",
        columns=sector.SHARED_FRAME_COLUMNS,
        filters=sector._market_filters("india"),
        sort="market_cap_basic",
        order="desc",
        limit=sector.SHARED_FRAME_LIMIT,
    ).cache_key
    assert heatmap.HEATMAP_FRAME.cache_key != india.cache_key
    assert sector._sector_descriptor("india", 500).cache_key != india.cache_key
