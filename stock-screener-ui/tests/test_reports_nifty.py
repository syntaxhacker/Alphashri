"""Unit tests for api/reports_api/nifty.py.

Pure helpers are tested directly (no network). The live endpoint's Upstox
layer is mocked; snapshot persistence is redirected to tmp_path.
Call endpoint functions directly, passing every Query param explicitly
(FastAPI Query defaults are Param objects when called outside HTTP).
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import api.reports_api.nifty as nifty
from api.reports_api.nifty import (
    build_leg,
    build_report,
    compute_max_pain,
    compute_pcr,
    create_nifty_snapshot,
    get_nifty_live,
    get_nifty_report,
    get_sentiment,
    parse_chain_payload,
    read_snapshot,
    top_walls,
    write_snapshot,
)


@pytest.fixture(autouse=True)
def _clear_live_cache():
    nifty._live_cache.clear()
    yield
    nifty._live_cache.clear()


@pytest.fixture()
def _tmp_snapshots(tmp_path, monkeypatch):
    monkeypatch.setattr(nifty, "SNAPSHOT_DIR", tmp_path)
    return tmp_path


def _chain_payload():
    """Minimal Upstox-shaped /option/chain payload (3 strikes)."""
    def side(ltp, close, oi, prev_oi, vol):
        return {"market_data": {"ltp": ltp, "close_price": close, "oi": oi,
                                "prev_oi": prev_oi, "volume": vol}}
    return {
        "underlying_spot_price": 22363.35,
        "data": [
            {"expiry": "2026-10-13", "strike_price": 22400.0,
             "underlying_spot_price": 22363.35,
             "call_options": side(50.0, 60.0, 1000, 800, 500),
             "put_options": side(70.0, 60.0, 2000, 1500, 900)},
            {"expiry": "2026-10-13", "strike_price": 22300.0,
             "underlying_spot_price": 22363.35,
             "call_options": side(90.0, 80.0, 500, 550, 100),
             "put_options": side(40.0, 45.0, 3000, 3200, 200)},
            {"expiry": "2026-10-13", "strike_price": 22500.0,
             "underlying_spot_price": 22363.35,
             "call_options": side(20.0, 25.0, 5000, 4000, 300),
             "put_options": side(120.0, 100.0, 100, 90, 50)},
        ],
    }


# ---------------- sentiment ----------------

class TestSentiment:
    def test_long_buildup(self):
        assert get_sentiment(5.0, 1000)["type"] == "Long Buildup"

    def test_short_buildup(self):
        assert get_sentiment(-5.0, 1000)["type"] == "Short Buildup"

    def test_short_covering(self):
        assert get_sentiment(5.0, -1000)["type"] == "Short Covering"

    def test_long_unwinding(self):
        assert get_sentiment(-5.0, -1000)["type"] == "Long Unwinding"

    def test_neutral_on_small_oi_change(self):
        assert get_sentiment(50.0, 50)["type"] == "Neutral"
        assert get_sentiment(-50.0, -99)["type"] == "Neutral"


# ---------------- PCR ----------------

class TestPcr:
    def test_basic(self):
        assert compute_pcr(150.0, 100.0) == 1.5

    def test_zero_call_base(self):
        assert compute_pcr(150.0, 0.0) == 0.0

    def test_rounding(self):
        assert compute_pcr(10.0, 3.0) == 3.33


# ---------------- max pain ----------------

class TestMaxPain:
    def test_empty(self):
        assert compute_max_pain([]) == 0.0

    def test_synthetic(self):
        rows = [
            {"strike": 100.0, "ce_oi": 10, "pe_oi": 0},
            {"strike": 110.0, "ce_oi": 0, "pe_oi": 0},
            {"strike": 120.0, "ce_oi": 0, "pe_oi": 1},
        ]
        # loss(100) = 20*1 = 20; loss(110) = 100+10 = 110; loss(120) = 200
        assert compute_max_pain(rows) == 100.0

    def test_unsorted_input(self):
        rows = [
            {"strike": 120.0, "ce_oi": 0, "pe_oi": 1},
            {"strike": 100.0, "ce_oi": 10, "pe_oi": 0},
        ]
        assert compute_max_pain(rows) == 100.0


# ---------------- parse + legs ----------------

class TestParseChain:
    def test_expiry_spot_rows(self):
        expiry, spot, rows = parse_chain_payload(_chain_payload())
        assert expiry == "2026-10-13"
        assert spot == 22363.35
        assert [r["strike"] for r in rows] == [22300.0, 22400.0, 22500.0]

    def test_leg_math(self):
        _, _, rows = parse_chain_payload(_chain_payload())
        ce = rows[1]["ce"]  # 22400 CE: ltp 50, close 60, oi 1000, prev 800
        assert ce["oi_change"] == 200
        assert ce["price_change"] == -10.0
        assert ce["sentiment"]["type"] == "Short Buildup"

    def test_build_leg_missing_market_data(self):
        leg = build_leg({})
        assert leg["oi"] == 0 and leg["sentiment"]["type"] == "Neutral"

    def test_empty_payload(self):
        assert parse_chain_payload({}) == ("", 0.0, [])


# ---------------- report assembly ----------------

class TestBuildReport:
    def test_totals_and_walls(self):
        _, spot, rows = parse_chain_payload(_chain_payload())
        rep = build_report("2026-10-13", spot, rows, mode="live")
        assert rep["mode"] == "live"
        assert rep["pcr_oi"] == compute_pcr(2000 + 3000 + 100, 1000 + 500 + 5000)
        assert rep["pcr_vol"] == compute_pcr(900 + 200 + 50, 500 + 100 + 300)
        assert rep["walls"]["calls"][0] == {"strike": 22500.0, "oi": 5000}
        assert rep["walls"]["puts"][0] == {"strike": 22300.0, "oi": 3000}
        assert len(rep["walls"]["calls"]) == 3

    def test_max_pain_window_excludes_far_strikes(self):
        rows = [
            {"strike": 20000.0, "ce": build_leg({}), "pe": build_leg({})},
            {"strike": 22300.0, "ce": build_leg({"ltp": 1, "close_price": 1, "oi": 10, "prev_oi": 0, "volume": 0}),
             "pe": build_leg({})},
            {"strike": 22400.0, "ce": build_leg({}),
             "pe": build_leg({"ltp": 1, "close_price": 1, "oi": 10, "prev_oi": 0, "volume": 0})},
        ]
        # Far 20000 strike carries huge OI that would drag max pain if included.
        rows[0]["ce"] = build_leg({"ltp": 1, "close_price": 1, "oi": 10**9, "prev_oi": 0, "volume": 0})
        rep = build_report("2026-10-13", 22363.35, rows, mode="live")
        assert rep["max_pain"] in (22300.0, 22400.0)

    def test_top_walls_limit(self):
        rows = [{"strike": float(s), "ce": {"oi": s}, "pe": {"oi": 0}} for s in (1, 2, 3, 4, 5)]
        assert [w["strike"] for w in top_walls(rows, "ce")] == [5.0, 4.0, 3.0]


# ---------------- snapshots ----------------

class TestSnapshots:
    def test_roundtrip(self, _tmp_snapshots):
        data = {"mode": "snapshot", "date": "2026-10-12", "spot": 1.0}
        path = write_snapshot("2026-10-12", data)
        assert path.exists()
        assert read_snapshot("2026-10-12") == data

    def test_missing_returns_none(self, _tmp_snapshots):
        assert read_snapshot("1999-01-01") is None

    def test_get_404_envelope(self, _tmp_snapshots):
        with pytest.raises(HTTPException) as exc:
            get_nifty_report(date="1999-01-01")
        assert exc.value.status_code == 404
        assert exc.value.detail["is_trading_day"] is False
        assert exc.value.detail["date"] == "1999-01-01"

    def test_get_serves_saved(self, _tmp_snapshots):
        write_snapshot("2026-10-12", {"mode": "snapshot", "spot": 22363.35})
        assert get_nifty_report(date="2026-10-12")["spot"] == 22363.35

    def test_bad_date_400(self, _tmp_snapshots):
        with pytest.raises(HTTPException) as exc:
            get_nifty_report(date="not-a-date")
        assert exc.value.status_code == 400


# ---------------- live + snapshot endpoints (mocked Upstox) ----------------

def _mock_chain(payload):
    fetch = AsyncMock(return_value=payload)
    expiries = AsyncMock(return_value={"expiries": [{"date": "2026-10-13"}]})
    return patch("api.options.fetch_upstox", fetch), patch("api.options.get_expiries", expiries)


class TestLiveEndpoint:
    async def test_shape(self):
        p1, p2 = _mock_chain(_chain_payload())
        with p1, p2:
            rep = await get_nifty_live(expiry="2026-10-13")
        assert rep["mode"] == "live"
        for key in ("expiry", "spot", "fetched_at", "pcr_oi", "pcr_vol",
                    "max_pain", "walls", "strikes"):
            assert key in rep, f"missing {key}"
        assert len(rep["strikes"]) == 3

    async def test_default_expiry_uses_nearest(self):
        p1, p2 = _mock_chain(_chain_payload())
        with p1, p2:
            rep = await get_nifty_live(expiry=None)
        assert rep["expiry"] == "2026-10-13"

    async def test_cache_ttl(self):
        p1, p2 = _mock_chain(_chain_payload())
        with p1, p2:
            first = await get_nifty_live(expiry="2026-10-13")
            second = await get_nifty_live(expiry="2026-10-13")
        assert first is second

    async def test_fetch_failure_is_502(self):
        p1, p2 = _mock_chain(_chain_payload())
        with p1, p2, patch("api.options.fetch_upstox", side_effect=RuntimeError("boom")):
            nifty._live_cache.clear()
            with pytest.raises(HTTPException) as exc:
                await get_nifty_live(expiry="2026-10-13")
        assert exc.value.status_code == 502


class TestSnapshotEndpoint:
    async def test_snapshot_persists(self, _tmp_snapshots):
        from api.reports_api.nifty import NiftySnapshotRequest
        p1, p2 = _mock_chain(_chain_payload())
        with p1, p2:
            snap = await create_nifty_snapshot(NiftySnapshotRequest(date="2026-10-12", expiry="2026-10-13"))
        assert snap["mode"] == "snapshot"
        assert snap["date"] == "2026-10-12"
        assert snap["source"] == "upstox-option-chain"
        assert "snapshot_at" in snap and isinstance(snap["timeline"], list)
        on_disk = json.loads((nifty.SNAPSHOT_DIR / "2026-10-12.json").read_text())
        assert on_disk["max_pain"] == snap["max_pain"]
