"""Unit tests for the US market phase / adaptive freshness policy (no network)."""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import market_status as M  # noqa: E402

ET = ZoneInfo("America/New_York")


def _dt(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=ET)


def test_phases_weekday():
    assert M.phase(_dt(2026, 9, 28, 8, 0)) == "premarket"   # Mon 08:00 ET
    assert M.phase(_dt(2026, 9, 28, 10, 0)) == "open"       # Mon 10:00 ET
    assert M.phase(_dt(2026, 9, 28, 15, 59)) == "open"
    assert M.phase(_dt(2026, 9, 28, 17, 0)) == "afterhours"
    assert M.phase(_dt(2026, 9, 28, 22, 0)) == "closed"


def test_weekend_always_closed():
    assert M.phase(_dt(2026, 9, 26, 10, 0)) == "closed"     # Saturday
    assert M.phase(_dt(2026, 9, 27, 10, 0)) == "closed"     # Sunday


def test_is_open():
    assert M.is_open(_dt(2026, 9, 28, 10, 0)) is True
    assert M.is_open(_dt(2026, 9, 28, 18, 0)) is False


def test_ttl_is_faster_when_open():
    assert M.ttl(_dt(2026, 9, 28, 10, 0)) < M.ttl(_dt(2026, 9, 28, 22, 0))
    assert M.ttl(_dt(2026, 9, 28, 10, 0)) == M._TTL["open"]
    assert M.ttl(_dt(2026, 9, 26, 10, 0)) == M._TTL["closed"]


def test_poll_ms_orders():
    p = M.poll_ms(_dt(2026, 9, 28, 10, 0))
    # live (real-time tape) is the fastest; OI-change is deliberately slow (once/day)
    assert p["live"] <= p["news"] <= p["pulse"]
    assert p["live"] <= p["snapshot"]
    assert p["alerts"] >= p["snapshot"]


def test_status_payload_shape():
    d = M.status_payload(_dt(2026, 9, 28, 10, 0))
    assert d["phase"] == "open" and d["is_open"] is True
    assert set(["phase", "is_open", "et", "utc", "ttl_s", "poll_ms"]).issubset(d.keys())
    assert d["poll_ms"]["default"] > 0


def test_hidden_policy_is_slower_but_present():
    vis = M.poll_ms(_dt(2026, 9, 28, 10, 0))
    hid = M.poll_ms_hidden(_dt(2026, 9, 28, 10, 0))
    assert hid["live"] >= vis["live"]
    d = M.status_payload(_dt(2026, 9, 28, 10, 0))
    assert "poll_ms_hidden" in d and d["poll_ms_hidden"]["live"] > 0
