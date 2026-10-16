"""Unit tests for api/reports_api/nifty.py.

Pure helpers are tested directly (no network). The live endpoint's Upstox
layer is mocked; snapshot persistence is redirected to tmp_path.
Call endpoint functions directly, passing every Query param explicitly
(FastAPI Query defaults are Param objects when called outside HTTP).
"""

import asyncio
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
    get_sensex_live,
    get_sentiment,
    parse_chain_payload,
    read_snapshot,
    top_walls,
    write_snapshot,
)


@pytest.fixture(autouse=True)
def _clear_live_cache():
    nifty._live_cache.clear()
    nifty._sensex_cache.clear()
    nifty._live_ws_cache.clear()
    yield
    nifty._live_cache.clear()
    nifty._sensex_cache.clear()
    nifty._live_ws_cache.clear()


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
            n_mod._candles_cache.clear()
            rep = await get_nifty_live(expiry="2026-10-13")
        fc.assert_called_once()
        assert rep["candles"] == fake
        n_mod._candles_cache.clear()

    def test_fetch_candles_never_raises(self):
        from api.reports_api import nifty as n_mod
        with patch("yfinance.download", side_effect=RuntimeError("down")):
            assert n_mod._fetch_nifty_candles("2026-10-12") == []


class TestLiveRefresh:
    def test_live_ttl_is_five_seconds(self):
        assert nifty._LIVE_TTL == 5

    async def test_cache_serves_within_ttl_and_recomputes_after(self):
        p1, p2 = _mock_chain(_chain_payload())
        with p1, p2:
            first = await get_nifty_live(expiry="2026-10-13")
            second = await get_nifty_live(expiry="2026-10-13")
            assert first is second
            # Age the entry past the TTL: the next call must recompute.
            nifty._live_cache["2026-10-13"]["ts"] -= (nifty._LIVE_TTL + 1)
            third = await get_nifty_live(expiry="2026-10-13")
        assert third is not first

    async def test_compute_live_runs_candles_off_event_loop(self, monkeypatch):
        """The yfinance candle fetch must not run on the event loop thread."""
        from api.reports_api import nifty as n_mod
        p1, p2 = _mock_chain(_chain_payload())
        # The call site now goes through the 60s candle cache wrapper.
        monkeypatch.setattr(n_mod, "_fetch_nifty_candles_cached", lambda *a, **k: [])
        seen: list = []
        real_to_thread = asyncio.to_thread

        async def _spy(func, /, *args, **kwargs):
            seen.append(func)
            return await real_to_thread(func, *args, **kwargs)

        monkeypatch.setattr(asyncio, "to_thread", _spy)
        with p1, p2:
            await n_mod._compute_live("2026-10-13")
        assert any(f is n_mod._fetch_nifty_candles_cached for f in seen)

    def test_candle_cache_avoids_refetch(self, monkeypatch):
        """The 5s report TTL must not hit Yahoo every 5s."""
        from api.reports_api import nifty as n_mod
        n_mod._candles_cache.clear()
        calls = {"n": 0}

        def _fake(date_str, walkback_days=0):
            calls["n"] += 1
            return [{"time": "t", "close": 1.0}]

        monkeypatch.setattr(n_mod, "_fetch_nifty_candles", _fake)
        a = n_mod._fetch_nifty_candles_cached("2026-10-13")
        b = n_mod._fetch_nifty_candles_cached("2026-10-13")
        assert a == b
        assert calls["n"] == 1  # second call served from cache
        n_mod._candles_cache.clear()


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


# ---------------- Sensex live context (mocked Upstox) ----------------

def _ohlc_payload(open_=22100.0, high=22450.0, low=22050.0, close=22380.0):
    """Upstox /market-quote/ohlc shape — fields nest under a child 'ohlc'."""
    return {
        "data": {
            "BSE_INDEX|SENSEX": {
                "ohlc": {"open": open_, "high": high, "low": low, "close": close},
                "last_price": close,
                "instrument_token": "BSE_INDEX|SENSEX",
            }
        }
    }


def _mock_sensex(chain=None, max_pain=22400.0, ohlc=None):
    """Patch every Upstox dependency of _compute_sensex_live.

    fetch_upstox is dispatched on the path because the function calls three
    different endpoints (option chain, max pain, OHLC quote). Pass an Exception
    for `chain`/`ohlc` to make that specific call fail.
    """
    chain = _chain_payload() if chain is None else chain
    quote = _ohlc_payload() if ohlc is None else ohlc

    async def fake_fetch(path, params=None):
        if path == "/option/chain":
            value = chain
        elif path == "/market/max-pain":
            value = {"data": {"max_pain": max_pain}}
        elif path == "/market-quote/ohlc":
            value = quote
        else:
            raise AssertionError(f"unexpected Upstox path: {path}")
        if isinstance(value, Exception):
            raise value
        return value

    return (
        patch("api.options.fetch_upstox", AsyncMock(side_effect=fake_fetch)),
        patch("api.options.get_expiries",
              AsyncMock(return_value={"expiries": [{"date": "2026-10-13"}]})),
        patch("api.options.get_instrument_key", return_value="BSE_INDEX|SENSEX"),
    )


class TestSensexEndpoint:
    async def test_shape(self):
        p1, p2, p3 = _mock_sensex()
        with p1, p2, p3:
            rep = await get_sensex_live()
        assert rep["symbol"] == "SENSEX"
        for key in ("expiry", "spot", "ohlc", "fetched_at", "pcr_oi", "pcr_vol",
                    "max_pain", "walls", "market"):
            assert key in rep, f"missing {key}"
        assert rep["walls"]["calls"] and rep["walls"]["puts"]

    async def test_ohlc_read_from_nested_block(self):
        """Regression: open/high/low live under a child 'ohlc' object.

        Reading them off the row itself always returned None, so every field
        collapsed to spot and the payload shipped a fake flat bar.
        """
        p1, p2, p3 = _mock_sensex()
        with p1, p2, p3:
            rep = await get_sensex_live()
        assert rep["ohlc"] == {
            "open": 22100.0, "high": 22450.0, "low": 22050.0, "close": 22380.0,
        }
        # Not a flat bar, and spot follows the quote's last price.
        assert rep["ohlc"]["high"] > rep["ohlc"]["low"]
        assert rep["spot"] == 22380.0

    async def test_official_max_pain_wins(self):
        p1, p2, p3 = _mock_sensex(max_pain=22400.0)
        with p1, p2, p3:
            rep = await get_sensex_live()
        assert rep["max_pain"] == 22400.0

    async def test_local_max_pain_when_official_missing(self):
        p1, p2, p3 = _mock_sensex(max_pain=0)
        with p1, p2, p3:
            rep = await get_sensex_live()
        # Falls back to the value computed from the chain, not 0.
        assert rep["max_pain"] > 0

    async def test_ohlc_failure_degrades_without_raising(self):
        p1, p2, p3 = _mock_sensex(ohlc=RuntimeError("quote down"))
        with p1, p2, p3:
            rep = await get_sensex_live()
        # The quote block is best-effort: ohlc degrades to a flat bar at spot.
        assert rep["ohlc"]["close"] == rep["spot"]

    async def test_chain_failure_is_502(self):
        p1, p2, p3 = _mock_sensex(chain=RuntimeError("boom"))
        with p1, p2, p3:
            with pytest.raises(HTTPException) as exc:
                await get_sensex_live()
        assert exc.value.status_code == 502

    async def test_no_spot_is_502(self):
        p1, p2, p3 = _mock_sensex(chain={"data": [], "underlying_spot_price": 0})
        with p1, p2, p3:
            with pytest.raises(HTTPException) as exc:
                await get_sensex_live()
        assert exc.value.status_code == 502

    async def test_cache_ttl_serves_same_object(self):
        p1, p2, p3 = _mock_sensex()
        with p1, p2, p3:
            first = await get_sensex_live()
            second = await get_sensex_live()
        assert first is second

    async def test_error_is_not_cached(self):
        p1, p2, p3 = _mock_sensex(chain=RuntimeError("boom"))
        with p1, p2, p3:
            with pytest.raises(HTTPException):
                await get_sensex_live()
        assert nifty._sensex_cache == {}


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
                            "sentiment", "gamma", "delta", "iv"}
        assert leg["iv"] is None  # absent greeks.iv stays None, not 0.0
        assert leg["delta"] is None  # absent greeks.delta stays None, not 0.0

    def test_parse_chain_picks_option_greeks(self):
        payload = _chain_payload()
        payload["data"][0]["call_options"]["option_greeks"] = {
            "delta": 0.5, "gamma": 0.001, "vega": 1.0, "theta": -0.5, "iv": 12.0}
        payload["data"][0]["put_options"]["option_greeks"] = {"gamma": 0.002}
        _, _, rows = parse_chain_payload(payload)
        by_strike = {r["strike"]: r for r in rows}
        assert by_strike[22400.0]["ce"]["gamma"] == 0.001
        assert by_strike[22400.0]["pe"]["gamma"] == 0.002
        assert by_strike[22400.0]["ce"]["delta"] == 0.5
        assert by_strike[22400.0]["pe"]["delta"] is None  # put greeks had no delta
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


def _intraday_candles(n=25, start=22000.0):
    return [
        {"time": f"2026-10-13T09:{15 + i:02d}:00+05:30",
         "open": start + i, "high": start + i + 1, "low": start + i - 1,
         "close": start + i}
        for i in range(n)
    ]


class TestAttachVerdictsEmas:
    async def test_sets_intraday_and_aligned_emas(self, monkeypatch):
        import api.reports_api.nifty_verdicts as nv

        fake = _intraday_candles()
        monkeypatch.setattr(nv, "get_baseline_range", AsyncMock(return_value=None))
        monkeypatch.setattr(nv, "get_vix_block", AsyncMock(return_value=None))
        monkeypatch.setattr(nv, "get_intraday_candles", AsyncMock(return_value=fake))
        monkeypatch.setattr(nifty, "read_tape", lambda date: [])
        monkeypatch.setattr(nifty, "_today_str", lambda: "2026-10-13")

        report: dict = {"candles": [], "gex": {"regime": "flat"}}
        await nifty._attach_verdicts(report, [], 22024.0, "2026-10-13")

        assert report["intraday"] == fake
        assert [e["period"] for e in report["emas"]] == [9, 20]
        for e in report["emas"]:
            assert len(e["data"]) == len(fake)
        closes = [c["close"] for c in fake]
        assert report["emas"][0]["data"][-1] == pytest.approx(nv.ema(closes, 9))
        assert report["emas"][1]["data"][-1] == pytest.approx(nv.ema(closes, 20))

    async def test_no_intraday_degrades_to_empty(self, monkeypatch):
        import api.reports_api.nifty_verdicts as nv

        monkeypatch.setattr(nv, "get_baseline_range", AsyncMock(return_value=None))
        monkeypatch.setattr(nv, "get_intraday_candles", AsyncMock(return_value=None))
        monkeypatch.setattr(nifty, "read_tape", lambda date: [])
        monkeypatch.setattr(nifty, "_today_str", lambda: "2026-10-13")

        report: dict = {"candles": [], "gex": {"regime": "flat"}}
        await nifty._attach_verdicts(report, [], 22000.0, "2026-10-13")

        assert report["intraday"] == []
        assert report["emas"] == []


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


# ---------------- live WS snapshot path ----------------

def _live_snapshot(n=25, spot=22700.0):
    """Hand-built nifty_md-style snapshot: legs keyed '<strike>:ce|pe'."""
    legs = {}
    base = spot - (n // 2) * 50.0
    for i in range(n):
        strike = base + i * 50.0
        # Calls stack above spot, puts below — walls land at the edges.
        legs[f"{strike}:ce"] = {
            "oi": 1000 + i * 500, "iv": 12.0, "ltp": max(5.0, 120.0 - i * 4.0),
            "volume": 200 + i * 10, "delta": 0.45, "gamma": 0.0004}
        legs[f"{strike}:pe"] = {
            "oi": 1000 + (n - 1 - i) * 500, "iv": 13.0,
            "ltp": max(5.0, 20.0 + i * 4.0),
            "volume": 150 + i * 5, "delta": -0.45, "gamma": 0.0004}
    return {"ts": "2026-10-16T10:00:00+05:30", "connected": True,
            "spot": spot, "vix": 13.5, "sensex": 81400.0, "legs": legs}


class TestBuildReportFromLive:
    def test_full_envelope_from_legs(self):
        from api.reports_api.nifty import build_report_from_live
        snap = _live_snapshot()
        rep = build_report_from_live(snap, "2026-10-29", candles=[])
        assert rep is not None
        for key in ("mode", "expiry", "spot", "fetched_at", "pcr_oi",
                    "pcr_vol", "max_pain", "walls", "gex", "positioning",
                    "strikes", "candles", "market"):
            assert key in rep, f"missing {key}"
        assert rep["mode"] == "live"
        assert rep["expiry"] == "2026-10-29"
        assert rep["spot"] == 22700.0
        strikes = [r["strike"] for r in rep["strikes"]]
        assert strikes == sorted(strikes) and len(strikes) == 25
        ce_oi = sum(r["ce"]["oi"] for r in rep["strikes"])
        pe_oi = sum(r["pe"]["oi"] for r in rep["strikes"])
        assert rep["pcr_oi"] == compute_pcr(pe_oi, ce_oi)
        assert min(strikes) <= rep["max_pain"] <= max(strikes)
        assert len(rep["walls"]["calls"]) == 3
        assert len(rep["walls"]["puts"]) == 3
        # Calls stack upward, puts stack downward.
        assert rep["walls"]["calls"][0]["oi"] >= rep["walls"]["calls"][-1]["oi"]
        assert rep["walls"]["puts"][0]["oi"] >= rep["walls"]["puts"][-1]["oi"]
        assert rep["gex"]["regime"] in ("long", "short", "flat")
        assert len(rep["gex"]["strikes"]) == 25
        assert isinstance(rep["positioning"], dict) and rep["positioning"]
        assert "verdict" in rep["positioning"]

    def test_too_few_strikes_returns_none(self):
        from api.reports_api.nifty import build_report_from_live
        assert build_report_from_live(_live_snapshot(n=5), "2026-10-29") is None
        assert build_report_from_live(_live_snapshot(n=19), "2026-10-29") is None
        assert build_report_from_live(
            _live_snapshot(n=20), "2026-10-29") is not None

    def test_missing_or_bad_legs_returns_none(self):
        from api.reports_api.nifty import build_report_from_live
        assert build_report_from_live({}, "2026-10-29") is None
        assert build_report_from_live({"legs": {}}, "2026-10-29") is None
        assert build_report_from_live({"legs": "nope"}, "2026-10-29") is None
        assert build_report_from_live(None, "2026-10-29") is None


class TestGetLiveReport:
    async def test_falls_back_to_rest_when_not_live(self, monkeypatch):
        from api.reports_api import nifty as n_mod
        monkeypatch.setattr(n_mod, "_nifty_md", lambda: None)
        sentinel = {"mode": "live", "spot": 1.0}
        monkeypatch.setattr(n_mod, "get_cached_live",
                            AsyncMock(return_value=sentinel))
        assert await n_mod.get_live_report("2026-10-29") is sentinel

    async def test_falls_back_when_chain_too_thin(self, monkeypatch):
        """A live but tiny snapshot is not a real chain → REST fallback."""
        import types
        from api.reports_api import nifty as n_mod
        fake = types.SimpleNamespace(
            is_live=lambda: True,
            snapshot=lambda: _live_snapshot(n=5),
        )
        monkeypatch.setattr(n_mod, "_nifty_md", lambda: fake)
        sentinel = {"mode": "live", "spot": 2.0}
        monkeypatch.setattr(n_mod, "get_cached_live",
                            AsyncMock(return_value=sentinel))
        assert await n_mod.get_live_report("2026-10-29") is sentinel

    async def test_live_path_builds_and_caches(self, monkeypatch):
        import types
        from api.reports_api import nifty as n_mod
        calls = {"n": 0}

        def _snap():
            calls["n"] += 1
            return _live_snapshot()

        fake = types.SimpleNamespace(is_live=lambda: True, snapshot=_snap)
        monkeypatch.setattr(n_mod, "_nifty_md", lambda: fake)
        monkeypatch.setattr(n_mod, "_fetch_nifty_candles_cached",
                            lambda *a, **k: [])
        monkeypatch.setattr(n_mod, "_attach_verdicts",
                            AsyncMock(return_value=None))
        first = await n_mod.get_live_report("2026-10-29")
        assert first["spot"] == 22700.0
        assert len(first["strikes"]) == 25
        # WS vix preferred (_attach_verdicts was stubbed, so no REST block).
        assert first["vix"] == 13.5
        second = await n_mod.get_live_report("2026-10-29")
        assert second is first  # ~1s cache: one build shared
        assert calls["n"] == 1


# ---------------- previous-session pivots ----------------

def _daily_payload():
    """Upstox /historical-candle daily shape, newest-first.

    First row is today's (partial) session and must never be used as the
    pivot source; the 2026-10-15 row is the previous completed session.
    """
    candles = [
        ["2026-10-16T00:00:00+05:30", 23000.0, 23100.0, 22900.0, 23050.0, 0, 0],
        ["2026-10-15T00:00:00+05:30", 22700.0, 23056.4, 22637.4, 22997.35, 0, 0],
        ["2026-10-14T00:00:00+05:30", 22600.0, 22750.0, 22500.0, 22640.0, 0, 0],
    ]
    return {"data": {"candles": candles}}


@pytest.fixture()
def _clear_pivots_cache():
    nifty._PIVOTS_CACHE.update(date=None, value=None)
    yield
    nifty._PIVOTS_CACHE.update(date=None, value=None)


class TestComputePivotsFromCandles:
    def test_classic_values_hand_computed(self):
        # H 23056.4, L 22637.4, C 22997.35 → hl = 419.0, pp = 68691.15/3
        out = nifty.compute_pivots_from_candles(
            _daily_payload()["data"]["candles"], "2026-10-16")
        assert out["type"] == "classic"
        assert out["pp"] == 22897.05
        assert out["r1"] == 23156.70   # 2*pp - L
        assert out["r2"] == 23316.05   # pp + hl
        assert out["r3"] == 23575.70   # H + 2*(pp - L)
        assert out["s1"] == 22737.70   # 2*pp - H
        assert out["s2"] == 22478.05   # pp - hl
        assert out["s3"] == 22318.70   # L - 2*(H - pp)
        assert out["prev"] == {"date": "2026-10-15", "high": 23056.4,
                               "low": 22637.4, "close": 22997.35}

    def test_picks_newest_prior_session_regardless_of_order(self):
        rows = _daily_payload()["data"]["candles"]
        # Feed oldest-first: date selection, not row order, must decide.
        out = nifty.compute_pivots_from_candles(list(reversed(rows)),
                                                "2026-10-16")
        assert out["prev"]["date"] == "2026-10-15"
        assert out["pp"] == 22897.05

    def test_today_row_excluded(self):
        rows = [
            ["2026-10-16T00:00:00+05:30", 1.0, 2.0, 0.5, 1.5, 0, 0],
            ["2026-10-15T00:00:00+05:30", 22700.0, 23056.4, 22637.4,
             22997.35, 0, 0],
        ]
        out = nifty.compute_pivots_from_candles(rows, "2026-10-16")
        assert out["prev"] == {"date": "2026-10-15", "high": 23056.4,
                               "low": 22637.4, "close": 22997.35}

    def test_empty_or_no_prior_session_is_none(self):
        rows = [["2026-10-16T00:00:00+05:30", 1, 2, 1, 1.5, 0, 0]]
        assert nifty.compute_pivots_from_candles(rows, "2026-10-16") is None
        assert nifty.compute_pivots_from_candles([], "2026-10-16") is None
        assert nifty.compute_pivots_from_candles(None, "2026-10-16") is None

    def test_never_raises_on_garbage(self):
        assert nifty.compute_pivots_from_candles(["nope"], "2026-10-16") is None
        assert nifty.compute_pivots_from_candles(
            [[None, None, None, None, None]], "2026-10-16") is None
        assert nifty.compute_pivots_from_candles(
            _daily_payload()["data"]["candles"], "not-a-date") is None


class TestGetPivotsBlock:
    async def test_success_returns_block(self, _clear_pivots_cache):
        with patch("api.options.fetch_upstox",
                   AsyncMock(return_value=_daily_payload())):
            out = await nifty.get_pivots_block("2026-10-16")
        assert out is not None
        assert out["pp"] == 22897.05
        assert out["type"] == "classic"

    async def test_fetch_failure_is_none_without_raising(self, _clear_pivots_cache):
        with patch("api.options.fetch_upstox",
                   AsyncMock(side_effect=RuntimeError("boom"))):
            out = await nifty.get_pivots_block("2026-10-16")
        assert out is None

    async def test_cache_one_fetch_per_day(self, _clear_pivots_cache):
        fetch = AsyncMock(return_value=_daily_payload())
        with patch("api.options.fetch_upstox", fetch):
            first = await nifty.get_pivots_block("2026-10-16")
            second = await nifty.get_pivots_block("2026-10-16")
        assert fetch.call_count == 1  # second call served from the day cache
        assert first is second

    async def test_new_day_refetches(self, _clear_pivots_cache):
        fetch = AsyncMock(return_value=_daily_payload())
        with patch("api.options.fetch_upstox", fetch):
            await nifty.get_pivots_block("2026-10-16")
            await nifty.get_pivots_block("2026-10-17")
        assert fetch.call_count == 2

    async def test_live_report_carries_pivots(self, _clear_pivots_cache):
        from api.reports_api import nifty as n_mod

        async def fake_fetch(path, params=None):
            if path.startswith("/historical-candle/"):
                return _daily_payload()
            return _chain_payload()

        with patch("api.options.fetch_upstox",
                   AsyncMock(side_effect=fake_fetch)), \
             patch.object(n_mod, "_fetch_nifty_candles_cached",
                          lambda *a, **k: []):
            nifty._live_cache.clear()
            rep = await get_nifty_live(expiry="2026-10-13")
        assert rep["pivots"] is not None
        assert rep["pivots"]["pp"] == 22897.05
        assert rep["pivots"]["prev"]["date"] == "2026-10-15"

    async def test_live_report_pivots_none_on_failure(self, _clear_pivots_cache):
        from api.reports_api import nifty as n_mod

        async def fake_fetch(path, params=None):
            if path.startswith("/historical-candle/"):
                raise RuntimeError("boom")
            return _chain_payload()

        with patch("api.options.fetch_upstox",
                   AsyncMock(side_effect=fake_fetch)), \
             patch.object(n_mod, "_fetch_nifty_candles_cached",
                          lambda *a, **k: []):
            nifty._live_cache.clear()
            rep = await get_nifty_live(expiry="2026-10-13")
        assert rep["pivots"] is None  # degrades, never raises
