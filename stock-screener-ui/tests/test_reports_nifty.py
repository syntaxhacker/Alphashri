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
    compute_gex,
    compute_max_pain,
    compute_pcr,
    create_nifty_snapshot,
    get_nifty_expiries,
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

    async def test_candles_attached(self):
        from api.reports_api import nifty as n_mod
        p1, p2 = _mock_chain(_chain_payload())
        fake = [{"time": "2026-10-12T09:15:00+05:30", "open": 1.0,
                 "high": 2.0, "low": 0.5, "close": 1.5, "volume": 0}]
        with p1, p2, patch.object(n_mod, "_fetch_nifty_candles",
                                  return_value=fake) as fc:
            nifty._live_cache.clear()
            rep = await get_nifty_live(expiry="2026-10-13")
        fc.assert_called_once()
        assert rep["candles"] == fake

    def test_fetch_candles_never_raises(self):
        from api.reports_api import nifty as n_mod
        with patch("yfinance.download", side_effect=RuntimeError("down")):
            assert n_mod._fetch_nifty_candles("2026-10-12") == []


class TestExpiriesEndpoint:
    async def test_returns_expiries(self):
        _, p2 = _mock_chain(_chain_payload())
        with p2:
            out = await get_nifty_expiries()
        assert out == {"expiries": [{"date": "2026-10-13"}]}

    async def test_failure_is_502(self):
        with patch("api.options.get_expiries", side_effect=RuntimeError("boom")):
            with pytest.raises(HTTPException) as exc:
                await get_nifty_expiries()
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


# ---------------- gamma / GEX ----------------

def _gex_row(strike, g_ce, oi_ce, g_pe, oi_pe):
    return {"strike": float(strike),
            "ce": {"gamma": g_ce, "oi": oi_ce},
            "pe": {"gamma": g_pe, "oi": oi_pe}}


class TestGammaParsing:
    def test_build_leg_carries_gamma(self):
        leg = build_leg({"ltp": 50.0, "close_price": 60.0, "oi": 1000,
                         "prev_oi": 800, "volume": 500},
                        {"delta": 0.5, "gamma": 0.0042, "vega": 1.0,
                         "theta": -0.5, "iv": 12.0})
        assert leg["gamma"] == 0.0042
        # existing keys unchanged
        assert leg["oi"] == 1000 and leg["oi_change"] == 200
        assert leg["price_change"] == -10.0

    def test_build_leg_missing_greeks_defaults_zero(self):
        assert build_leg({})["gamma"] == 0.0
        assert build_leg({"ltp": 1}, None)["gamma"] == 0.0
        assert build_leg({"ltp": 1}, {})["gamma"] == 0.0
        assert build_leg({"ltp": 1}, {"gamma": None})["gamma"] == 0.0
        assert build_leg({"ltp": 1}, {"gamma": "bad"})["gamma"] == 0.0

    def test_build_leg_existing_keys_preserved(self):
        leg = build_leg({"ltp": 1}, {"gamma": 0.001})
        assert set(leg) == {"ltp", "close_price", "oi", "prev_oi",
                            "oi_change", "volume", "price_change",
                            "sentiment", "gamma"}

    def test_parse_chain_picks_option_greeks(self):
        payload = _chain_payload()
        payload["data"][0]["call_options"]["option_greeks"] = {
            "delta": 0.5, "gamma": 0.001, "vega": 1.0, "theta": -0.5, "iv": 12.0}
        payload["data"][0]["put_options"]["option_greeks"] = {"gamma": 0.002}
        _, _, rows = parse_chain_payload(payload)
        by_strike = {r["strike"]: r for r in rows}
        assert by_strike[22400.0]["ce"]["gamma"] == 0.001
        assert by_strike[22400.0]["pe"]["gamma"] == 0.002
        # strikes without greeks default to 0.0
        assert by_strike[22300.0]["ce"]["gamma"] == 0.0
        assert by_strike[22300.0]["pe"]["gamma"] == 0.0


class TestComputeGex:
    def test_formula_hand_computed(self):
        # spot=20000, lot=50 -> factor lot*spot/1e7 = 0.1
        # A: call 0.01*1000*0.1=1.0; put -(0.005*1000*0.1)=-0.5; net 0.5
        # B: call 0.002*500*0.1=0.1; put -(0.02*2000*0.1)=-4.0; net -3.9
        rows = [_gex_row(19000, 0.01, 1000, 0.005, 1000),
                _gex_row(20000, 0.002, 500, 0.02, 2000)]
        out = compute_gex(rows, 20000.0, lot_size=50)
        by_strike = {s["strike"]: s for s in out["strikes"]}
        assert by_strike[19000.0] == {"strike": 19000.0, "call_gex": 1.0,
                                      "put_gex": -0.5, "net_gex": 0.5}
        assert by_strike[20000.0] == {"strike": 20000.0, "call_gex": 0.1,
                                      "put_gex": -4.0, "net_gex": -3.9}
        assert out["net_total"] == -3.4
        assert out["regime"] == "short"
        assert out["top_positive"][0] == {"strike": 19000.0, "net_gex": 0.5}
        assert out["top_negative"][0] == {"strike": 20000.0, "net_gex": -3.9}
        # cum 0.5 -> -3.4 flips sign at the second strike
        assert out["zero_cross"] == 20000.0

    def test_default_lot_size(self):
        # gamma 0.01 * oi 1000 * 65 * 25000 / 1e7 = 1.625 -> 1.62
        rows = [_gex_row(25000, 0.01, 1000, 0.0, 0)]
        out = compute_gex(rows, 25000.0)
        assert out["strikes"][0]["call_gex"] == 1.62
        assert out["strikes"][0]["put_gex"] == 0.0
        assert out["strikes"][0]["net_gex"] == 1.62

    def test_regime_thresholds(self):
        # factor 0.1: gamma 0.01*oi 1000 -> 1.0; gamma 0.0099*oi 1000 -> 0.99
        assert compute_gex([_gex_row(1, 0.01, 1000, 0, 0)],
                           10000.0, lot_size=100)["regime"] == "long"
        assert compute_gex([_gex_row(1, 0.0099, 1000, 0, 0)],
                           10000.0, lot_size=100)["regime"] == "flat"
        assert compute_gex([_gex_row(1, 0, 0, 0.01, 1000)],
                           10000.0, lot_size=100)["regime"] == "short"
        assert compute_gex([_gex_row(1, 0, 0, 0.0099, 1000)],
                           10000.0, lot_size=100)["regime"] == "flat"
        assert compute_gex([], 10000.0)["regime"] == "flat"
        assert compute_gex([], 10000.0)["net_total"] == 0.0

    def test_zero_cross_exact_touch(self):
        # cum +2.0 then 0.0 -> touch at the second strike
        rows = [_gex_row(100, 0.02, 1000, 0, 0),
                _gex_row(200, 0, 0, 0.02, 1000)]
        out = compute_gex(rows, 10000.0, lot_size=100)
        assert [s["net_gex"] for s in out["strikes"]] == [2.0, -2.0]
        assert out["zero_cross"] == 200.0

    def test_zero_cross_ignores_leading_dead_strikes(self):
        # far-OTM zeros must not fake a flip at the first strike
        rows = [_gex_row(100, 0, 0, 0, 0),
                _gex_row(200, 0, 0, 0, 0),
                _gex_row(300, 0.02, 1000, 0, 0),
                _gex_row(400, 0, 0, 0.02, 1000)]
        out = compute_gex(rows, 10000.0, lot_size=100)
        assert out["zero_cross"] == 400.0

    def test_zero_cross_null_when_no_crossing(self):
        pos = [_gex_row(100, 0.01, 1000, 0, 0),
               _gex_row(200, 0.02, 1000, 0, 0)]
        assert compute_gex(pos, 10000.0, lot_size=100)["zero_cross"] is None
        neg = [_gex_row(100, 0, 0, 0.01, 1000),
               _gex_row(200, 0, 0, 0.02, 1000)]
        assert compute_gex(neg, 10000.0, lot_size=100)["zero_cross"] is None
        assert compute_gex([], 10000.0)["zero_cross"] is None

    def test_top_two_selection(self):
        rows = [_gex_row(100, 0.01, 1000, 0, 0),   # net +1.0
                _gex_row(200, 0.03, 1000, 0, 0),   # net +3.0
                _gex_row(300, 0, 0, 0.05, 1000),   # net -5.0
                _gex_row(400, 0.02, 1000, 0, 0)]   # net +2.0
        out = compute_gex(rows, 10000.0, lot_size=100)
        assert [t["strike"] for t in out["top_positive"]] == [200.0, 400.0]
        assert [t["strike"] for t in out["top_negative"]] == [300.0, 100.0]


class TestBuildReportGex:
    def test_report_carries_gex_block(self):
        _, spot, rows = parse_chain_payload(_chain_payload())
        rep = build_report("2026-10-13", spot, rows, mode="live")
        assert "gex" in rep
        gex = rep["gex"]
        assert set(gex) == {"strikes", "net_total", "regime",
                            "top_positive", "top_negative", "zero_cross"}
        assert len(gex["strikes"]) == 3
        assert gex["regime"] in ("long", "short", "flat")
        # existing keys untouched
        for key in ("mode", "expiry", "spot", "fetched_at", "pcr_oi",
                    "pcr_vol", "max_pain", "walls", "strikes", "candles"):
            assert key in rep, f"missing {key}"
