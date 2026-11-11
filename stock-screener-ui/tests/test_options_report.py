"""Generic live option-chain report (``/api/reports/options/{underlying}/live``).

Covers the pure shaping helpers plus the handler contract for a stock
(RELIANCE) and an index (SENSEX): payload keys the frontend
``normalizeReport`` reads, wall ordering + distance, ``pcr_vol``, the 30 s
cache with single-flight, the 429 stale-frame path, the ``api`` rate-limiter
acquire, cache namespacing vs the NIFTY report, and the error envelope.
Upstream calls are monkeypatched — no network, no DB.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

import pandas as pd
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import config
from api.reports_api import options_report

EXPIRY = "2026-11-26"


def _live(symbol: str, expiry: str | None = EXPIRY, candles: bool = False) -> dict:
    """Call the handler directly with explicit params.

    FastAPI ``Query`` defaults are ``Param`` objects outside HTTP (and a
    ``Query(False)`` object is truthy), so every direct call must pass both.
    """
    return asyncio.run(
        options_report.get_live_option_report(symbol, expiry=expiry, candles=candles)
    )


# --------------------------------------------------------------------- fixtures
@pytest.fixture(autouse=True)
def _clean_state(monkeypatch, tmp_path):
    """Fresh cache + no rate limiter + offline VIX/tape unless a test overrides."""
    options_report.clear_cache()
    monkeypatch.setattr(options_report, "_rate_limiter", lambda: None)
    # No test may read the real tape directory (another process may be
    # recording into it mid-run).
    monkeypatch.setattr(options_report, "TAPE_ROOT", tmp_path / "options_tape")

    # India VIX is market-wide I/O; keep every handler test offline.
    from api.reports_api import nifty_verdicts as nv

    async def fake_vix():
        return {"ltp": 12.5, "prev_close": 12.0, "change_pct": 4.17,
                "day_high": 12.8, "day_low": 11.9}

    monkeypatch.setattr(nv, "get_vix_block", fake_vix)
    nv.clear_caches()
    # Spacing is covered by a dedicated test; keep this suite fast.
    monkeypatch.setattr(options_report, "DAILY_FETCH_RETRY_SLEEP_SEC", 0)
    yield
    options_report.clear_cache()
    nv.clear_caches()


def _contract(ltp: float, close: float, oi: int, prev_oi: int, volume: int,
              delta: float | None = 0.5) -> dict:
    greeks = None
    if delta is not None:
        greeks = {"delta": delta, "gamma": 0.001, "theta": -2.5, "vega": 3.0, "iv": 22.5}
    return {
        "market_data": {
            "ltp": ltp,
            "close_price": close,
            "oi": oi,
            "prev_oi": prev_oi,
            "volume": volume,
        },
        "option_greeks": greeks,
    }


def _chain(spot: float = 1400.0) -> list[dict]:
    """4 strikes with deliberately uneven OI so wall ordering is checkable."""
    rows = [
        # strike, ce oi, ce vol, pe oi, pe vol
        (1380.0, 100, 10, 800, 5),
        (1400.0, 900, 20, 1200, 10),
        (1420.0, 500, 30, 200, 15),
        (1440.0, 300, 40, 50, 20),
    ]
    out = []
    for strike, ce_oi, ce_vol, pe_oi, pe_vol in rows:
        out.append({
            "strike": strike,
            "ce": _contract(ltp=30.0, close=28.0, oi=ce_oi, prev_oi=ce_oi - 10, volume=ce_vol),
            "pe": _contract(ltp=25.0, close=27.0, oi=pe_oi, prev_oi=pe_oi + 10, volume=pe_vol),
        })
    return out


def _chain_payload(spot: float = 1400.0) -> dict:
    return {
        "status": "ok",
        "underlying": "RELIANCE",
        "expiry": EXPIRY,
        "spot": spot,
        "chain": _chain(spot),
        "summary": {"pcr": 0.75, "max_pain": 1400.0},
    }


@pytest.fixture()
def mocked_upstream(monkeypatch):
    """Patch expiries + chain + candles + the direct daily fetch.

    ``candles`` counts 1-minute fetches only; ``upstox_daily`` counts the
    direct v2 daily-candle fetches behind pivots/baseline (one per symbol
    per session when healthy). ``daily_endpoints`` records the requested
    URLs so tests can assert the symbol's own key was used.
    """
    import api.options as api_options

    calls = {"expiries": 0, "chain": 0, "candles": 0, "daily": 0,
             "upstox_daily": 0, "timeframes": [], "daily_endpoints": []}

    async def fake_expiries(symbol):
        calls["expiries"] += 1
        return {"underlying": symbol, "expiries": [
            {"date": EXPIRY, "weekly": False, "days_to_expiry": 28},
            {"date": "2026-12-31", "weekly": False, "days_to_expiry": 63},
        ]}

    async def fake_chain(symbol, expiry):
        calls["chain"] += 1
        payload = _chain_payload()
        payload["underlying"] = symbol
        payload["expiry"] = expiry
        return payload

    def fake_candles(symbol, timeframe="1m", **kwargs):
        calls["timeframes"].append((symbol, timeframe))
        calls["candles"] += 1
        return None

    async def fake_daily(endpoint, params=None):
        calls["upstox_daily"] += 1
        calls["daily_endpoints"].append(endpoint)
        return None

    monkeypatch.setattr(options_report, "get_expiries", fake_expiries)
    monkeypatch.setattr(options_report, "get_option_chain", fake_chain)
    monkeypatch.setattr(options_report, "fetch_candles_for_timeframe", fake_candles)
    monkeypatch.setattr(api_options, "fetch_upstox", fake_daily)
    return calls


def _v2_candles(rows: list[tuple[str, float, float, float, float]]) -> list[list]:
    """``[(date, o, h, l, c)]`` -> raw v2 ``data.candles`` rows, newest-first."""
    out = [[f"{d}T00:00:00+05:30", o, h, lo, c, 1000, 0]
           for d, o, h, lo, c in rows]
    return out[::-1]


# ------------------------------------------------------------------- pure units
def test_build_side_maps_market_data_and_greeks():
    side = options_report.build_side(_contract(ltp=30.0, close=28.0, oi=900, prev_oi=850, volume=12))
    assert side["ltp"] == 30.0
    assert side["close"] == 28.0
    assert side["oi"] == 900
    assert side["prevOi"] == 850
    assert side["oiChange"] == 50
    assert side["priceChange"] == 2.0
    assert side["volume"] == 12
    assert side["delta"] == 0.5
    assert side["gamma"] == pytest.approx(0.001)
    assert side["theta"] == pytest.approx(-2.5)
    assert side["vega"] == pytest.approx(3.0)
    assert side["iv"] == pytest.approx(22.5)
    assert isinstance(side["sentiment"], str)


def test_build_side_missing_leg_and_greeks_are_zero_and_null():
    side = options_report.build_side(None)
    assert side["ltp"] == 0 and side["oi"] == 0 and side["volume"] == 0
    assert side["delta"] is None and side["iv"] is None

    no_greeks = options_report.build_side(
        {"market_data": {"ltp": 5, "close_price": 5, "oi": 1, "prev_oi": 1}}
    )
    assert no_greeks["gamma"] is None


def test_walls_are_top3_by_oi_with_distance():
    strikes = options_report.build_strikes(_chain())
    calls = options_report.top_walls(strikes, "ce", spot=1400.0)
    puts = options_report.top_walls(strikes, "pe", spot=1400.0)

    assert [w["strike"] for w in calls] == [1400.0, 1420.0, 1440.0]
    assert [w["oi"] for w in calls] == [900, 500, 300]
    assert [w["distance"] for w in calls] == [0.0, 20.0, 40.0]

    assert [w["strike"] for w in puts] == [1400.0, 1380.0, 1420.0]
    assert [w["distance"] for w in puts] == [0.0, -20.0, 20.0]


def test_near_walls_respect_the_spot_band_and_fall_back():
    strikes = options_report.build_strikes(_chain())
    near = options_report.near_walls(strikes, "ce", spot=1400.0)
    assert [w["strike"] for w in near] == [1400.0]  # band = 1% of spot = 14 pts

    far_spot = 5000.0  # nothing inside the band -> fall back to the full chain
    assert len(options_report.near_walls(strikes, "pe", spot=far_spot)) == 3


def test_pcr_vol_and_zero_call_volume():
    strikes = options_report.build_strikes(_chain())
    # PE volume 50 / CE volume 100
    assert options_report.compute_pcr_vol(strikes) == 0.5

    zero_ce = [{"strike": 100.0,
                "ce": {"oi": 1, "volume": 0},
                "pe": {"oi": 1, "volume": 7}}]
    assert options_report.compute_pcr_vol(zero_ce) == 0.0


def test_compute_max_pain_matches_the_minimum_payout_strike():
    strikes = options_report.build_strikes(_chain())
    assert options_report.compute_max_pain(strikes) == 1400.0


def test_candles_to_intraday_and_ohlc():
    idx = pd.date_range("2026-10-29 03:46", periods=3, freq="1min", tz="UTC")
    df = pd.DataFrame(
        {
            "open": [100.0, 101.0, 102.0],
            "high": [101.5, 102.5, 103.0],
            "low": [99.5, 100.5, 101.0],
            "close": [101.0, 102.0, 102.5],
            "volume": [10, 20, 30],
        },
        index=idx,
    )
    intraday = options_report.candles_to_intraday(df)
    assert len(intraday) == 3
    assert set(intraday[0]) == {"time", "open", "high", "low", "close", "volume"}
    # UTC -> IST
    assert intraday[0]["time"].startswith("2026-10-29T09:16")
    assert intraday[0]["volume"] == 10

    ohlc = options_report.ohlc_from_intraday(intraday, spot=999.0)
    assert ohlc == {"open": 100.0, "high": 103.0, "low": 99.5, "close": 102.5}

    assert options_report.ohlc_from_intraday([], spot=123.0) == {
        "open": 123.0, "high": 123.0, "low": 123.0, "close": 123.0,
    }


def test_candles_to_intraday_tolerates_empty_and_garbage():
    assert options_report.candles_to_intraday(None) == []
    assert options_report.candles_to_intraday(pd.DataFrame()) == []
    df = pd.DataFrame({"open": ["bad"], "high": [1], "low": [1], "close": [1]},
                      index=pd.date_range("2026-10-29", periods=1))
    assert options_report.candles_to_intraday(df) == []


# ------------------------------------------------------------------- handler
def test_live_payload_shape_for_stock(mocked_upstream):
    report = _live("reliance", expiry=EXPIRY)

    assert report["mode"] == "live"
    assert report["underlying"] == "RELIANCE"
    assert report["expiry"] == EXPIRY
    assert report["date"] == datetime.now(config.IST).strftime("%Y-%m-%d")
    assert report["spot"] == 1400.0

    # no candles -> flat OHLC at spot
    assert report["ohlc"] == {"open": 1400.0, "high": 1400.0, "low": 1400.0, "close": 1400.0}
    assert report["intraday"] == []

    assert report["pcr_oi"] == 0.75          # from the chain summary
    assert report["pcr_vol"] == 0.5          # computed from volumes
    assert report["max_pain"] == 1400.0      # from the chain summary

    assert [w["strike"] for w in report["walls"]["calls"]] == [1400.0, 1420.0, 1440.0]
    assert [w["strike"] for w in report["walls"]["puts"]] == [1400.0, 1380.0, 1420.0]
    assert [w["strike"] for w in report["walls_near"]["calls"]] == [1400.0]

    assert [s["strike"] for s in report["strikes"]] == [1380.0, 1400.0, 1420.0, 1440.0]
    first = report["strikes"][0]
    assert set(first) == {"strike", "ce", "pe"}
    assert set(first["ce"]) == {
        "ltp", "close", "oi", "prevOi", "oiChange", "prev_oi", "oi_change",
        "priceChange", "sentiment", "volume", "delta", "gamma", "theta",
        "vega", "iv",
    }
    assert first["ce"]["oiChange"] == 10
    assert first["ce"]["oi_change"] == 10
    assert first["pe"]["oiChange"] == -10

    # Chain-derived analytics for THIS symbol (RELIANCE lot = 500).
    assert report["lot_size"] == 500
    assert report["gex"]["regime"] in ("long", "short", "flat")
    assert report["gex"]["strikes"]
    assert report["positioning"]["lot_size"] == 500
    assert report["positioning"]["verdict"] in ("bullish", "bearish", "balanced")

    # Session blocks are computed, not NIFTY placeholders.
    for key in ("control", "regime", "strength", "market"):
        assert isinstance(report[key], dict), key
    assert report["vix"]["source"] == "INDIA_VIX"
    assert report["vix"]["ltp"] == 12.5
    # No tape file and no daily candles in the default mock -> explicit empty
    # values, never NIFTY levels.
    assert report["reference"] is None
    assert report["structure"] == []
    assert report["pivots"] is None
    assert report["emas"] == []
    assert isinstance(report["timeline"], list)
    assert "pivots" in report
    assert isinstance(report["fetched_at"], str)


def test_nearest_expiry_is_used_when_omitted(mocked_upstream):
    # FastAPI ``Query`` defaults are Param objects outside HTTP, so pass None.
    report = _live("SENSEX", expiry=None)
    assert report["expiry"] == EXPIRY
    assert mocked_upstream["expiries"] == 1


def test_candles_true_populate_intraday_and_ohlc(mocked_upstream, monkeypatch):
    idx = pd.date_range("2026-10-29 03:46", periods=2, freq="1min", tz="UTC")
    df = pd.DataFrame(
        {"open": [1401.0, 1402.0], "high": [1403.0, 1405.0],
         "low": [1400.0, 1401.0], "close": [1402.0, 1404.0], "volume": [5, 6]},
        index=idx,
    )
    monkeypatch.setattr(options_report, "fetch_candles_for_timeframe", lambda *a, **k: df)

    report = _live("RELIANCE", expiry=EXPIRY, candles=True)
    assert len(report["intraday"]) == 2
    assert report["ohlc"] == {"open": 1401.0, "high": 1405.0, "low": 1400.0, "close": 1404.0}
    assert report["date"] == "2026-10-29"


def test_candles_failure_never_fails_the_request(mocked_upstream, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(options_report, "fetch_candles_for_timeframe", boom)
    report = _live("RELIANCE", expiry=EXPIRY, candles=True)
    assert report["intraday"] == []
    assert report["spot"] == 1400.0


# ------------------------------------------------------- opt-in candles
def _candle_df():
    idx = pd.date_range("2026-10-29 03:46", periods=2, freq="1min", tz="UTC")
    return pd.DataFrame(
        {"open": [1401.0, 1402.0], "high": [1403.0, 1405.0],
         "low": [1400.0, 1401.0], "close": [1402.0, 1404.0], "volume": [5, 6]},
        index=idx,
    )


def test_default_call_never_fetches_candles(mocked_upstream):
    report = _live("RELIANCE", expiry=EXPIRY)          # candles defaults to False
    assert mocked_upstream["candles"] == 0             # no 1-minute fetch
    assert report["intraday"] == []
    assert report["ohlc"] == {"open": 1400.0, "high": 1400.0, "low": 1400.0, "close": 1400.0}
    assert mocked_upstream["chain"] == 1
    # The daily series is still consulted for pivots/baseline (cheap, 1/session).
    # A persistently empty upstream is retried (DAILY_FETCH_ATTEMPTS) before
    # the 60 s miss is cached — one attempt per healthy fetch.
    assert mocked_upstream["upstox_daily"] == options_report.DAILY_FETCH_ATTEMPTS
    # The direct fetch uses this symbol's own instrument key in the URL
    # (stock keys are ISIN-based, so match the resolved key, not the name).
    import urllib.parse

    key = options_report._resolve_daily_key("RELIANCE")
    assert key and urllib.parse.quote(key, safe="") in "".join(
        mocked_upstream["daily_endpoints"])


def test_chain_only_response_never_fetches_intraday_candles(mocked_upstream, monkeypatch):
    def no_intraday(symbol, timeframe="1m", **kwargs):
        if timeframe not in ("1d", "1D"):
            raise AssertionError("1-minute candle fetch ran on a chain-only request")
        return None

    monkeypatch.setattr(options_report, "fetch_candles_for_timeframe", no_intraday)
    report = _live("RELIANCE", expiry=EXPIRY)
    assert report["spot"] == 1400.0


def test_candles_true_fetches_once_and_caches(mocked_upstream, monkeypatch):
    def counting_candles(symbol, timeframe="1m", **kwargs):
        if timeframe in ("1d", "1D"):
            mocked_upstream["daily"] += 1
            return None
        mocked_upstream["candles"] += 1
        return _candle_df()

    monkeypatch.setattr(options_report, "fetch_candles_for_timeframe", counting_candles)

    first = _live("RELIANCE", expiry=EXPIRY, candles=True)
    second = _live("RELIANCE", expiry=EXPIRY, candles=True)

    assert mocked_upstream["candles"] == 1          # 120 s candle cache
    # The empty daily leg is retried, then the miss is cached per session —
    # the second call reuses it (still 3, not 6).
    assert mocked_upstream["upstox_daily"] == options_report.DAILY_FETCH_ATTEMPTS
    assert mocked_upstream["chain"] == 1            # 30 s chain cache
    assert len(first["intraday"]) == 2 and len(second["intraday"]) == 2
    assert first["ohlc"] == {"open": 1401.0, "high": 1405.0, "low": 1400.0, "close": 1404.0}
    assert options_report._intraday_get("RELIANCE") is not None


def test_cached_candles_are_attached_to_a_default_call_for_free(mocked_upstream, monkeypatch):
    def counting_candles(symbol, timeframe="1m", **kwargs):
        if timeframe in ("1d", "1D"):
            return None
        mocked_upstream["candles"] += 1
        return _candle_df()

    monkeypatch.setattr(options_report, "fetch_candles_for_timeframe", counting_candles)
    _live("RELIANCE", expiry=EXPIRY, candles=True)
    assert mocked_upstream["candles"] == 1

    # A later chain-only call inside the 120 s candle TTL reuses the bars
    # without any upstream call.
    report = _live("RELIANCE", expiry=EXPIRY)
    assert mocked_upstream["candles"] == 1
    assert len(report["intraday"]) == 2
    assert report["ohlc"]["high"] == 1405.0


def test_cold_candles_do_not_block_a_chain_only_request(mocked_upstream, monkeypatch):
    """A candles=True request may be slow; a chain-only one must not be."""
    import threading

    started = threading.Event()
    release = threading.Event()

    def slow_candles(symbol, timeframe="1m", **kwargs):
        if timeframe in ("1d", "1D"):
            return None
        started.set()
        release.wait(5)
        return _candle_df()

    monkeypatch.setattr(options_report, "fetch_candles_for_timeframe", slow_candles)

    async def scenario():
        heavy = asyncio.create_task(
            options_report.get_live_option_report("RELIANCE", expiry=EXPIRY, candles=True)
        )
        await asyncio.to_thread(started.wait, 5)
        # chain is already cached by the heavy request; this must return now
        fast = await asyncio.wait_for(
            options_report.get_live_option_report("RELIANCE", expiry=EXPIRY, candles=False),
            timeout=2.0,
        )
        release.set()
        await heavy
        return fast

    fast = asyncio.run(scenario())
    assert fast["intraday"] == [] or len(fast["intraday"]) == 2
    assert fast["strikes"]


def test_intraday_ttl_is_120_seconds():
    assert options_report.INTRADAY_TTL_SEC == 120.0


# ------------------------------------------------------------------- cache
def test_cache_ttl_is_30_seconds():
    assert options_report.CACHE_TTL_SEC == 30.0
    assert options_report.CACHE_MAX_SYMBOLS == 15
    assert options_report.FETCH_CONCURRENCY == 4


def test_ten_calls_in_the_window_make_one_upstream_fetch(mocked_upstream):
    for _ in range(10):
        _live("RELIANCE", expiry=EXPIRY)
    assert mocked_upstream["chain"] == 1


def test_single_flight_ten_concurrent_calls_one_fetch(mocked_upstream):
    async def fan_out():
        return await asyncio.gather(*[
            options_report.get_live_option_report("RELIANCE", expiry=EXPIRY, candles=False)
            for _ in range(10)
        ])

    reports = asyncio.run(fan_out())
    assert mocked_upstream["chain"] == 1
    assert all(r["spot"] == 1400.0 for r in reports)


def test_cache_is_namespaced_per_symbol_and_expiry(mocked_upstream):
    _live("RELIANCE", expiry=EXPIRY)
    _live("RELIANCE", expiry=EXPIRY)
    assert mocked_upstream["chain"] == 1

    _live("RELIANCE", expiry="2026-12-31")
    _live("SENSEX", expiry=EXPIRY)
    assert mocked_upstream["chain"] == 3


def test_stock_cache_never_touches_the_nifty_cache(mocked_upstream):
    import api.reports_api.nifty as nifty

    nifty._live_cache.clear()
    _live("RELIANCE", expiry=EXPIRY)
    assert nifty._live_cache == {}
    assert options_report._chain_cache is not nifty._live_cache


def test_distinct_symbol_cache_is_lru_capped(mocked_upstream):
    for i in range(options_report.CACHE_MAX_SYMBOLS + 1):
        _live(f"SYM{i}", expiry=EXPIRY)
    symbols = {key[0] for key in options_report._chain_cache}
    assert len(symbols) == options_report.CACHE_MAX_SYMBOLS
    assert "SYM0" not in symbols          # oldest evicted
    assert f"SYM{options_report.CACHE_MAX_SYMBOLS}" in symbols


# ------------------------------------------------------------------- 429 path
def test_429_serves_the_last_good_frame(mocked_upstream, monkeypatch):
    good = _live("RELIANCE", expiry=EXPIRY)
    # Age the entry past the TTL so the handler must refetch.
    key = ("RELIANCE", EXPIRY)
    options_report._chain_cache[key]["ts"] = 0.0

    async def throttled(symbol, expiry):
        raise HTTPException(status_code=429, detail="Upstox API error: rate limited")

    monkeypatch.setattr(options_report, "get_option_chain", throttled)
    stale = _live("RELIANCE", expiry=EXPIRY)

    assert stale["stale"] is True
    assert stale["spot"] == good["spot"]
    assert stale["strikes"] == good["strikes"]
    # the last good frame is still cached (no retry storm wiped it)
    assert options_report._cache_get("RELIANCE", EXPIRY, allow_stale=True) is not None


def test_429_without_a_cached_frame_is_429(mocked_upstream, monkeypatch):
    async def throttled(symbol, expiry):
        raise HTTPException(status_code=429, detail="Upstox API error: rate limited")

    monkeypatch.setattr(options_report, "get_option_chain", throttled)
    with pytest.raises(HTTPException) as exc:
        _live("RELIANCE", expiry=EXPIRY)
    assert exc.value.status_code == 429


def test_rate_limiter_exhaustion_is_429(mocked_upstream, monkeypatch):
    class Exhausted:
        def acquire(self, cost=1, timeout=10.0):
            return False

    monkeypatch.setattr(options_report, "_rate_limiter", lambda: Exhausted())
    with pytest.raises(HTTPException) as exc:
        _live("RELIANCE", expiry=EXPIRY)
    assert exc.value.status_code == 429
    assert mocked_upstream["chain"] == 0


def test_every_upstream_call_acquires_a_token(mocked_upstream, monkeypatch):
    acquired = []

    class FakeLimiter:
        def acquire(self, cost=1, timeout=10.0):
            acquired.append(cost)
            return True

    monkeypatch.setattr(options_report, "_rate_limiter", lambda: FakeLimiter())
    _live("RELIANCE", expiry=None, candles=True)

    # expiries + chain + 1m candles (the direct daily fetch takes no
    # Redis-budget token — same as NIFTY's path).
    assert len(acquired) == 3
    assert set(acquired) == {1}


# ------------------------------------------------------------------- errors
def test_unknown_underlying_is_404(mocked_upstream, monkeypatch):
    async def no_expiries(symbol):
        return {"underlying": symbol, "expiries": []}

    monkeypatch.setattr(options_report, "get_expiries", no_expiries)
    with pytest.raises(HTTPException) as exc:
        _live("NOTAREALTICKER", expiry=None)
    assert exc.value.status_code == 404
    assert "NOTAREALTICKER" in str(exc.value.detail)


def test_empty_chain_is_502(mocked_upstream, monkeypatch):
    async def empty_chain(symbol, expiry):
        return {"spot": 100.0, "chain": [], "summary": {}}

    monkeypatch.setattr(options_report, "get_option_chain", empty_chain)
    with pytest.raises(HTTPException) as exc:
        _live("RELIANCE", expiry=EXPIRY)
    assert exc.value.status_code == 502


def test_upstream_500_is_mapped_to_502(mocked_upstream, monkeypatch):
    async def broken(symbol, expiry):
        raise HTTPException(status_code=500, detail="Failed to fetch option chain: boom")

    monkeypatch.setattr(options_report, "get_option_chain", broken)
    with pytest.raises(HTTPException) as exc:
        _live("RELIANCE", expiry=EXPIRY)
    assert exc.value.status_code == 502
    assert "RELIANCE" in str(exc.value.detail)


def test_bad_expiry_is_400(mocked_upstream):
    with pytest.raises(HTTPException) as exc:
        _live("RELIANCE", expiry="26-11-2026")
    assert exc.value.status_code == 400


# ------------------------------------------------------------------- HTTP route
@pytest.fixture()
def route_client(mocked_upstream):
    app = FastAPI()
    app.include_router(options_report.router)
    return TestClient(app)


def test_route_contract_over_http(route_client):
    resp = route_client.get(f"/api/reports/options/reliance/live?expiry={EXPIRY}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["underlying"] == "RELIANCE"
    assert body["expiry"] == EXPIRY
    assert isinstance(body["strikes"], list) and body["strikes"]
    assert "pcr_vol" in body and "walls_near" in body


def test_route_candles_flag_is_opt_in(route_client, monkeypatch):
    default = route_client.get(f"/api/reports/options/RELIANCE/live?expiry={EXPIRY}")
    assert default.status_code == 200
    assert default.json()["intraday"] == []

    monkeypatch.setattr(options_report, "fetch_candles_for_timeframe", lambda *a, **k: _candle_df())
    with_candles = route_client.get(
        f"/api/reports/options/RELIANCE/live?expiry={EXPIRY}&candles=true"
    )
    assert with_candles.status_code == 200
    assert len(with_candles.json()["intraday"]) == 2


def test_route_without_expiry_picks_the_nearest(route_client):
    resp = route_client.get("/api/reports/options/SENSEX/live")
    assert resp.status_code == 200
    assert resp.json()["expiry"] == EXPIRY


def test_route_error_is_a_json_envelope(route_client, monkeypatch):
    async def no_expiries(symbol):
        return {"underlying": symbol, "expiries": []}

    monkeypatch.setattr(options_report, "get_expiries", no_expiries)
    resp = route_client.get("/api/reports/options/BOGUS/live")
    assert resp.status_code == 404
    assert "detail" in resp.json()


# ------------------------------------------- symbol-owned session analytics
def test_lot_size_resolves_from_the_chain_contract_instrument_key():
    chain = [{"ce": {"instrument_key": "NSE_FO|125833"}, "pe": {}}]
    assert options_report.resolve_lot_size("NOT_A_LISTED_NAME", chain) == 500
    assert options_report.resolve_lot_size("NOT_A_LISTED_NAME", []) == 1


def test_gex_and_positioning_use_the_symbols_own_lot_size(mocked_upstream):
    reliance = _live("RELIANCE", expiry=EXPIRY)
    assert reliance["lot_size"] == 500
    assert reliance["positioning"]["lot_size"] == 500
    assert isinstance(reliance["gex"]["net_total"], float)

    sensex = _live("SENSEX", expiry=EXPIRY)
    assert sensex["lot_size"] == 20
    assert sensex["positioning"]["lot_size"] == 20


def test_pivots_come_from_the_symbols_own_daily_candles(mocked_upstream, monkeypatch):
    import urllib.parse

    import api.options as api_options
    import api.reports_api.nifty as nifty

    rows = [
        ("2026-10-27", 1000.0, 1010.0, 990.0, 1000.0),
        ("2026-10-28", 1000.0, 1050.0, 1020.0, 1040.0),
    ]
    seen: list[str] = []

    async def fake_daily(endpoint, params=None):
        seen.append(endpoint)
        return {"status": "success", "data": {"candles": _v2_candles(rows)}}

    monkeypatch.setattr(api_options, "fetch_upstox", fake_daily)
    nifty._PIVOTS_CACHE.update(date=None, value=None)

    report = _live("RELIANCE", expiry=EXPIRY)

    raw = [[f"{d}T00:00:00+05:30", o, h, lo, c, 0, 0] for d, o, h, lo, c in rows]
    assert report["pivots"] == nifty.compute_pivots_from_candles(raw, report["date"])
    assert report["pivots"]["prev"]["date"] == "2026-10-28"
    assert report["pivots"]["pp"] == round((1050.0 + 1020.0 + 1040.0) / 3, 2)
    # The daily fetch is for THIS symbol (never NIFTY's pivot key): the URL
    # carries RELIANCE's own resolved instrument key.
    key = options_report._resolve_daily_key("RELIANCE")
    assert key and seen
    assert all("NIFTY" not in ep and "Nifty" not in ep for ep in seen)
    assert all(urllib.parse.quote(key, safe="") in ep for ep in seen)
    assert nifty._PIVOTS_CACHE["value"] is None


def test_regime_baseline_is_the_symbols_own_median_daily_range(mocked_upstream, monkeypatch):
    import api.options as api_options

    rows = [
        ("2026-10-27", 100.0, 102.0, 98.0, 100.0),   # 4.0%
        ("2026-10-28", 100.0, 102.0, 98.0, 100.0),   # 4.0%
    ]

    async def fake_daily(endpoint, params=None):
        return {"status": "success", "data": {"candles": _v2_candles(rows)}}

    monkeypatch.setattr(api_options, "fetch_upstox", fake_daily)
    report = _live("RELIANCE", expiry=EXPIRY)

    assert report["baseline_range_pct"] == 4.0
    # compute_regime speaks points; the % is converted at THIS symbol's spot.
    assert report["regime"]["range_baseline_pts"] == 56.0


def _write_tape(symbol: str, rows: list[dict]) -> None:
    today = datetime.now(config.IST).strftime("%Y-%m-%d")
    path = options_report.tape_path(symbol, today)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")


def test_reference_is_read_from_the_generic_symbol_tape(mocked_upstream):
    today = datetime.now(config.IST).strftime("%Y-%m-%d")
    _write_tape("RELIANCE", [{
        "t": f"{today}T09:20:00+05:30",
        "atm_strike": 1400.0,
        "atm_ce_ltp": 40.0,
        "atm_pe_ltp": 30.0,
    }])

    report = _live("RELIANCE", expiry=EXPIRY)

    ref = report["reference"]
    assert ref["strike"] == 1400.0
    assert ref["ce_open"] == 40.0 and ref["pe_open"] == 30.0
    assert ref["ce_ltp"] == 30.0 and ref["pe_ltp"] == 25.0
    assert ref["ce_change"] == -10.0 and ref["pe_change"] == -5.0


def test_analytics_never_read_the_nifty_tape(mocked_upstream, tmp_path, monkeypatch):
    import api.reports_api.nifty as nifty

    today = datetime.now(config.IST).strftime("%Y-%m-%d")
    monkeypatch.setattr(nifty, "TAPE_DIR", tmp_path / "nifty_tape")
    nifty.tape_path(today).parent.mkdir(parents=True, exist_ok=True)
    nifty.tape_path(today).write_text(json.dumps({
        "t": f"{today}T09:20:00+05:30", "atm_strike": 1400.0,
        "atm_ce_ltp": 999.0, "atm_pe_ltp": 999.0,
    }) + "\n")

    report = _live("RELIANCE", expiry=EXPIRY)
    assert report["reference"] is None          # no symbol tape -> no reference
    assert report["structure"] == []


def test_structure_uses_the_symbol_tape_and_keeps_the_last_12(mocked_upstream, monkeypatch):
    from api.reports_api import nifty_structure

    _write_tape("RELIANCE", [
        {"t": "2026-10-29T09:20:00+05:30", "spot": 1400.0},
        {"t": "2026-10-29T09:21:00+05:30", "spot": 1401.0},
        {"t": "2026-10-29T09:22:00+05:30", "spot": 1402.0},
    ])
    seen: dict = {}

    def fake_detect(rows, *args, **kwargs):
        seen["rows"] = rows
        return [{"event": i} for i in range(20)]

    monkeypatch.setattr(nifty_structure, "detect_structure_shifts", fake_detect)

    report = _live("RELIANCE", expiry=EXPIRY)

    assert len(report["structure"]) == 12
    assert [e["event"] for e in report["structure"]] == list(range(8, 20))
    assert len(seen["rows"]) == 3
    assert seen["rows"][0]["spot"] == 1400.0


def test_emas_track_the_intraday_closes(mocked_upstream, monkeypatch):
    from api.reports_api.nifty_verdicts import ema_series

    n = 25
    closes = [1400.0 + i for i in range(n)]
    idx = pd.date_range("2026-10-29 03:46", periods=n, freq="1min", tz="UTC")
    df = pd.DataFrame(
        {"open": closes, "high": [c + 1 for c in closes],
         "low": [c - 1 for c in closes], "close": closes, "volume": [1] * n},
        index=idx,
    )
    monkeypatch.setattr(options_report, "fetch_candles_for_timeframe",
                        lambda symbol, timeframe="1m", **k: df if timeframe not in ("1d", "1D") else None)

    report = _live("RELIANCE", expiry=EXPIRY, candles=True)

    assert [e["period"] for e in report["emas"]] == [9, 20]
    assert len(report["emas"][0]["data"]) == len(report["intraday"]) == n
    assert report["emas"][0]["data"] == ema_series(closes, 9)
    assert report["emas"][1]["data"][-1] is not None


def test_market_block_carries_the_session_keys(mocked_upstream):
    market = _live("RELIANCE", expiry=EXPIRY)["market"]
    assert set(market) == {"is_open", "session_date", "as_of"}
    assert isinstance(market["is_open"], bool)
    assert market["session_date"] == datetime.now(config.IST).strftime("%Y-%m-%d")


def test_vix_is_labelled_as_india_vix(mocked_upstream, monkeypatch):
    report = _live("RELIANCE", expiry=EXPIRY)
    assert report["vix"]["source"] == "INDIA_VIX"
    assert report["vix"]["ltp"] == 12.5

    # A missing VIX still carries the source label (never a fake symbol VIX).
    from api.reports_api import nifty_verdicts as nv

    async def no_vix():
        return None

    monkeypatch.setattr(nv, "get_vix_block", no_vix)
    report = _live("SENSEX", expiry=EXPIRY)
    assert report["vix"]["source"] == "INDIA_VIX"


def test_timeline_names_the_symbol_not_nifty(mocked_upstream):
    events = _live("RELIANCE", expiry=EXPIRY)["timeline"]
    assert events
    assert all("Nifty" not in e["detail"] for e in events)
    assert any("RELIANCE" in e["detail"] for e in events)
