"""Unit tests for api/reports_api/nifty_verdicts.py.

Pure helpers are tested directly (no network). The three cached fetchers are
exercised against a mocked ``api.options.fetch_upstox`` — no real HTTP. The
last test wires the blocks through the live endpoint composition.
"""

from unittest.mock import AsyncMock, patch

import pytest

import api.reports_api.nifty_verdicts as nv


@pytest.fixture(autouse=True)
def _clear_caches():
    nv.clear_caches()
    yield
    nv.clear_caches()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _side(oi, prev_oi, iv=None):
    return {"oi": oi, "prev_oi": prev_oi, "iv": iv}


def _candle(hhmm, hi, lo, close=None, day="2026-10-13"):
    return {"time": f"{day}T{hhmm}:00+05:30", "open": lo, "high": hi, "low": lo,
            "close": close if close is not None else (hi + lo) / 2}


def _const_session(day, hi, lo, n=120, minute_start=(9, 15)):
    """Raw Upstox rows ``[ts, o, h, l, c, vol, oi]`` for a constant-range session."""
    rows = []
    start = minute_start[0] * 60 + minute_start[1]
    for i in range(n):
        m = start + i
        ts = f"{day}T{m // 60:02d}:{m % 60:02d}:00+05:30"
        rows.append([ts, lo, hi, lo, (hi + lo) / 2, 0, 0])
    return rows


# ---------------------------------------------------------------------------
# control
# ---------------------------------------------------------------------------

class TestControlVerdict:
    def test_call_writers_dominates(self):
        assert nv.control_verdict(1000, 100) == "call_writers"

    def test_put_writers_dominates(self):
        assert nv.control_verdict(100, 1000) == "put_writers"

    def test_balanced_within_25pct(self):
        assert nv.control_verdict(100, 100) == "balanced"
        assert nv.control_verdict(124, 100) == "balanced"  # 124 <= 125

    def test_threshold_boundary(self):
        # exactly 1.25x is NOT greater → balanced
        assert nv.control_verdict(125, 100) == "balanced"
        assert nv.control_verdict(126, 100) == "call_writers"

    def test_zero_zero_is_balanced(self):
        assert nv.control_verdict(0, 0) == "balanced"


class TestComputeControl:
    def test_doi_sums_and_verdict(self):
        rows = [
            {"strike": 100.0, "ce": _side(1000, 800), "pe": _side(500, 400)},
            {"strike": 110.0, "ce": _side(300, 500), "pe": _side(2000, 1000)},
        ]
        out = nv.compute_control(rows, spot=105.0, gex_regime="long")
        # calls: +200 -200 = 0 ; puts: +100 +1000 = 1100
        assert out["ce_doi"] == 0
        assert out["pe_doi"] == 1100
        assert out["verdict"] == "put_writers"
        assert out["gex_regime"] == "long"

    def test_atm_iv_and_skew(self):
        rows = [
            {"strike": 100.0, "ce": _side(1, 1, 12.0), "pe": _side(1, 1, 15.0)},
            {"strike": 110.0, "ce": _side(1, 1, 99.0), "pe": _side(1, 1, 99.0)},
        ]
        out = nv.compute_control(rows, spot=101.0)
        assert out["atm_ce_iv"] == 12.0
        assert out["atm_pe_iv"] == 15.0
        assert out["skew"] == 3.0  # put skew = downside hedging

    def test_missing_iv_is_null_skew(self):
        rows = [{"strike": 100.0, "ce": _side(1, 1), "pe": _side(1, 1)}]
        out = nv.compute_control(rows, spot=100.0)
        assert out["atm_ce_iv"] is None
        assert out["atm_pe_iv"] is None
        assert out["skew"] is None

    def test_bad_gex_regime_defaults_flat(self):
        assert nv.compute_control([], 100.0, gex_regime="weird")["gex_regime"] == "flat"
        assert nv.compute_control([], 100.0, gex_regime=None)["gex_regime"] == "flat"

    def test_empty_rows_balanced(self):
        out = nv.compute_control([], spot=100.0, gex_regime="short")
        assert out["verdict"] == "balanced"
        assert out["ce_doi"] == 0 and out["pe_doi"] == 0
        assert out["gex_regime"] == "short"

    def test_frozen_contract_keys(self):
        out = nv.compute_control([], 100.0)
        assert set(out) == {"verdict", "ce_doi", "pe_doi", "atm_ce_iv",
                            "atm_pe_iv", "skew", "gex_regime"}


class TestAtmIvs:
    def test_nearest_strike_wins(self):
        rows = [
            {"strike": 90.0, "ce": _side(1, 1, 5.0), "pe": _side(1, 1, 6.0)},
            {"strike": 100.0, "ce": _side(1, 1, 12.0), "pe": _side(1, 1, 13.0)},
            {"strike": 140.0, "ce": _side(1, 1, 50.0), "pe": _side(1, 1, 51.0)},
        ]
        assert nv.atm_ivs(rows, spot=99.0) == (12.0, 13.0)

    def test_nonpositive_iv_treated_missing(self):
        rows = [{"strike": 100.0, "ce": _side(1, 1, 0.0), "pe": _side(1, 1, -3.0)}]
        assert nv.atm_ivs(rows, 100.0) == (None, None)

    def test_empty(self):
        assert nv.atm_ivs([], 100.0) == (None, None)


# ---------------------------------------------------------------------------
# indicators
# ---------------------------------------------------------------------------

class TestEma:
    def test_hand_computed(self):
        assert nv.ema([1, 2, 3, 4], 3) == 3.0

    def test_insufficient_returns_none(self):
        assert nv.ema([1, 2], 3) is None
        assert nv.ema([], 20) is None


class TestRsi:
    def test_monotonic_up_is_100(self):
        closes = [float(i) for i in range(1, 16)]
        assert nv.rsi_wilder(closes, 14) == 100.0

    def test_monotonic_down_is_zero(self):
        closes = [float(i) for i in range(15, 0, -1)]
        assert nv.rsi_wilder(closes, 14) == 0.0

    def test_equal_gains_losses_is_50(self):
        closes = [10.0, 11.0, 10.0, 11.0, 10.0, 11.0, 10.0, 11.0,
                  10.0, 11.0, 10.0, 11.0, 10.0, 11.0, 10.0]
        assert nv.rsi_wilder(closes, 14) == pytest.approx(50.0, abs=1e-9)

    def test_needs_period_plus_one(self):
        assert nv.rsi_wilder([1.0] * 14, 14) is None
        assert nv.rsi_wilder([1.0] * 15, 14) is not None


class TestRealizedVol:
    def test_positive_and_finite_on_1min(self):
        # Oscillating closes give non-trivial realised vol (a smooth ramp is ~0).
        candles = [_candle(f"{9 + (15 + i) // 60:02d}:{(15 + i) % 60:02d}",
                           22020 + (i % 2) * 40, 21980 + (i % 2) * 40,
                           22000 + (i % 2) * 40)
                   for i in range(60)]
        rv = nv.realized_vol_pct(candles)
        assert rv is not None and 0 < rv < 1000

    def test_none_when_too_few(self):
        assert nv.realized_vol_pct([]) is None
        assert nv.realized_vol_pct([_candle("09:15", 1, 0, 1)]) is None

    def test_flat_series_is_zero(self):
        candles = [_candle("09:15", 1, 1, 1) for _ in range(5)]
        assert nv.realized_vol_pct(candles) == 0.0


# ---------------------------------------------------------------------------
# baseline
# ---------------------------------------------------------------------------

class TestMedianSessionRange:
    def test_median_excludes_today_and_short_sessions(self):
        candles = (
            _const_session("2026-10-09", 22100, 22000)     # range 100
            + _const_session("2026-10-10", 22200, 22000)   # range 200
            + _const_session("2026-10-12", 22600, 22000, n=30)  # short → dropped
            + _const_session("2026-10-13", 22700, 22000)   # today → dropped
        )
        assert nv.median_session_range(candles, exclude_date="2026-10-13") == 150.0

    def test_out_of_window_bars_ignored(self):
        # afternoon bars outside 09:15-12:30 must not widen the range
        candles = _const_session("2026-10-09", 22100, 22000, n=120)
        candles += _const_session("2026-10-09", 23000, 21000, n=120,
                                  minute_start=(13, 0))
        assert nv.median_session_range(candles, exclude_date="2026-10-13") == 100.0

    def test_none_when_no_qualifying_sessions(self):
        assert nv.median_session_range([], exclude_date="2026-10-13") is None
        candles = _const_session("2026-10-13", 22700, 22000)  # only today
        assert nv.median_session_range(candles, exclude_date="2026-10-13") is None


class TestNormalizeCandles:
    def test_maps_and_sorts_ascending(self):
        rows = [
            ["2026-10-13T09:16:00+05:30", 1, 2, 0.5, 1.5, 0, 0],
            ["2026-10-13T09:15:00+05:30", 1, 2, 0.5, 1.5, 0, 0],
        ]
        out = nv.normalize_candles(rows)
        assert [c["time"] for c in out] == [
            "2026-10-13T09:15:00+05:30", "2026-10-13T09:16:00+05:30"]
        assert out[0]["high"] == 2.0 and out[0]["low"] == 0.5

    def test_skips_malformed(self):
        assert nv.normalize_candles([[None]]) == []


# ---------------------------------------------------------------------------
# regime
# ---------------------------------------------------------------------------

class TestRegimeVerdict:
    def test_range_sell_premium(self):
        assert nv.regime_verdict(50.0, 10.0, 20.0) == "range_sell_premium"
        assert nv.regime_verdict(64.99, None, None) == "range_sell_premium"

    def test_trend_by_realized_vol(self):
        assert nv.regime_verdict(80.0, 25.0, 15.0) == "trend_buy"

    def test_trend_by_range_expansion(self):
        # A wide but dead tape: rv 1% vs iv 99% means long premium paid for
        # nothing, so the range alone must not call it "buy".
        assert nv.regime_verdict(120.0, 1.0, 99.0) == "range_sell_premium"

    def test_neutral(self):
        assert nv.regime_verdict(80.0, 10.0, 15.0) == "neutral"

    def test_nulls_neutral(self):
        assert nv.regime_verdict(None, None, None) == "neutral"
        assert nv.regime_verdict(None, 5.0, None) == "neutral"

    def test_rv_ignored_during_warmup(self):
        # 12 bars at the open: RV/IV ~1.8x must NOT call "buy premium".
        assert nv.regime_verdict(83.0, 24.8, 13.7, bars=12) == "neutral"

    def test_rv_trusted_after_warmup(self):
        assert nv.regime_verdict(83.0, 24.8, 13.7, bars=30) == "trend_buy"

    def test_bars_none_skips_guard(self):
        assert nv.regime_verdict(83.0, 24.8, 13.7) == "trend_buy"


class TestStraddle:
    def test_open_now_pct(self):
        rows = [
            {"atm_ce_ltp": 100.0, "atm_pe_ltp": 100.0},
            {"atm_ce_ltp": 110.0, "atm_pe_ltp": 120.0},
        ]
        assert nv.straddle_from_tape(rows) == (200.0, 230.0, 15.0)

    def test_skips_rows_with_dead_leg(self):
        rows = [
            {"atm_ce_ltp": None, "atm_pe_ltp": 100.0},
            {"atm_ce_ltp": 100.0, "atm_pe_ltp": 100.0},
            {"atm_ce_ltp": 0.0, "atm_pe_ltp": 0.0},
            {"atm_ce_ltp": 120.0, "atm_pe_ltp": 130.0},
        ]
        assert nv.straddle_from_tape(rows) == (200.0, 250.0, 25.0)

    def test_empty_returns_none(self):
        assert nv.straddle_from_tape([]) == (None, None, None)


class TestComputeRegime:
    def test_full_block(self):
        candles = [_candle(f"09:{15 + i:02d}", 22100 + i, 22000 + i, 22050 + i)
                   for i in range(20)]
        rows = [{"atm_ce_ltp": 100.0, "atm_pe_ltp": 100.0},
                {"atm_ce_ltp": 80.0, "atm_pe_ltp": 90.0}]
        out = nv.compute_regime(candles=candles, baseline=200.0, iv=15.0,
                                tape_rows=rows)
        assert set(out) == {"verdict", "range_pts", "range_baseline_pts",
                            "range_pct", "rv", "iv", "bars", "warmup",
                            "straddle_open", "straddle_now", "straddle_pct"}
        assert out["range_pts"] == 119.0
        assert out["range_pct"] == pytest.approx(59.5, abs=0.01)
        assert out["straddle_open"] == 200.0
        assert out["straddle_now"] == 170.0
        assert out["bars"] == 20
        assert out["warmup"] is True  # 20 < REGIME_MIN_BARS


# ---------------------------------------------------------------------------
# strength
# ---------------------------------------------------------------------------

class TestStrengthVerdict:
    def test_thresholds(self):
        assert nv.strength_verdict(65) == "strong"
        assert nv.strength_verdict(100) == "strong"
        assert nv.strength_verdict(64) == "neutral"
        assert nv.strength_verdict(36) == "neutral"
        assert nv.strength_verdict(35) == "weak"
        assert nv.strength_verdict(0) == "weak"


class TestComputeStrength:
    def _series(self, start, step, n=60):
        return [
            _candle(f"{(9 * 60 + 15 + i) // 60:02d}:{(9 * 60 + 15 + i) % 60:02d}",
                    start + i * step + 1, start + i * step - 1, start + i * step)
            for i in range(n)]

    def test_rising_is_strong(self):
        candles = self._series(22000.0, 1.0)
        out = nv.compute_strength(candles, spot=22059.0)
        assert out["score"] == 100
        assert out["verdict"] == "strong"
        assert out["ema20"] is not None and out["ema50"] is not None
        assert out["rsi"] == 100.0
        assert out["pos_in_range"] == pytest.approx(0.98, abs=0.02)

    def test_falling_is_weak(self):
        candles = self._series(22100.0, -1.0)
        out = nv.compute_strength(candles, spot=22041.0)
        assert out["verdict"] == "weak"
        assert out["rsi"] == 0.0

    def test_empty_degrades_to_weak(self):
        out = nv.compute_strength([], spot=None)
        assert out["score"] == 0
        assert out["verdict"] == "weak"
        assert out["ema20"] is None and out["rsi"] is None
        assert out["pos_in_range"] is None

    def test_contract_keys(self):
        out = nv.compute_strength([], spot=None)
        assert set(out) == {"verdict", "score", "ema9", "ema20", "ema50",
                            "rsi", "pos_in_range"}

    def test_ema9_present_when_enough_closes(self):
        candles = self._series(22000.0, 1.0)
        out = nv.compute_strength(candles, spot=22059.0)
        assert out["ema9"] is not None
        assert out["ema9"] == pytest.approx(nv.ema(
            [c["close"] for c in candles], 9), abs=0.01)

    def test_ema9_none_with_few_closes(self):
        candles = self._series(22000.0, 1.0, n=8)
        out = nv.compute_strength(candles, spot=22007.0)
        assert out["ema9"] is None
        assert out["ema20"] is None


class TestEmaSeries:
    def test_length_and_seed(self):
        values = [float(i) for i in range(1, 11)]
        out = nv.ema_series(values, 3)
        assert len(out) == len(values)
        assert out[0] is None and out[1] is None
        assert all(v is not None for v in out[2:])

    def test_tail_matches_ema(self):
        values = [float(i) for i in range(1, 31)]
        for period in (9, 20):
            out = nv.ema_series(values, period)
            assert len(out) == len(values)
            assert out[-1] == pytest.approx(nv.ema(values, period))

    def test_insufficient_returns_all_none(self):
        assert nv.ema_series([1.0, 2.0], 3) == [None, None]
        assert nv.ema_series([], 9) == []

    def test_missing_close_stays_aligned(self):
        values = [1.0, 2.0, None, 4.0, 5.0, 6.0]
        out = nv.ema_series(values, 3)
        assert len(out) == len(values)
        assert out[2] is None


# ---------------------------------------------------------------------------
# cached network fetchers (mocked)
# ---------------------------------------------------------------------------

def _vix_payload(ltp=15.0, close=14.45, hi=15.2, lo=13.8):
    return {"status": "success", "data": {"NSE_INDEX:India VIX": {
        "ohlc": {"open": 14.12, "high": hi, "low": lo, "close": close},
        "last_price": ltp}}}


class TestVixFetcher:
    async def test_parses_and_caches(self):
        # `ohlc.close` is today's close, so the previous close must come from the
        # daily series. `_vix_payload` deliberately sets close == a DISTINCT value
        # so the old structural-0.00% bug would be caught here.
        calls = []

        async def fetch(path, params=None):
            calls.append(path)
            if "historical-candle" in path:
                return {"status": "success", "data": {"candles": [
                    ["2026-10-14T00:00:00+05:30", 14.0, 15.0, 13.8, 15.0],
                    ["2026-10-13T00:00:00+05:30", 14.0, 14.6, 13.9, 14.45],
                ]}}
            return _vix_payload()

        with patch("api.options.fetch_upstox", fetch):
            first = await nv.get_vix_block()
            second = await nv.get_vix_block()
        assert first == second
        assert first["ltp"] == 15.0
        assert first["prev_close"] == 14.45
        assert first["change_pct"] == pytest.approx(3.81, abs=0.01)
        assert first["day_high"] == 15.2 and first["day_low"] == 13.8
        assert len(calls) == 2  # one market quote + one daily series, then cached

    async def test_change_is_null_when_close_equals_last_price(self):
        """The old bug: close == last_price made change_pct a flat 0.00%."""
        async def fetch(path, params=None):
            if "historical-candle" in path:
                return {"status": "success", "data": {"candles": []}}
            return _vix_payload(ltp=14.85, close=14.85)

        with patch("api.options.fetch_upstox", fetch):
            block = await nv.get_vix_block()
        assert block["change_pct"] is None
        assert block["prev_close"] is None

    async def test_failure_returns_none(self):
        fetch = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("api.options.fetch_upstox", fetch):
            assert await nv.get_vix_block() is None


class TestBaselineFetcher:
    async def test_fetches_once_per_day(self):
        payload = {"status": "success", "data": {"candles":
                   _const_session("2026-10-09", 22100, 22000)
                   + _const_session("2026-10-10", 22200, 22000)}}
        fetch = AsyncMock(return_value=payload)
        with patch("api.options.fetch_upstox", fetch):
            a = await nv.get_baseline_range("2026-10-13")
            b = await nv.get_baseline_range("2026-10-13")
            c = await nv.get_baseline_range("2026-10-14")
        assert a == b == 150.0
        assert c == 150.0  # cached value carries to the new day until refetch
        assert fetch.await_count == 2  # one per distinct day

    async def test_failure_caches_none(self):
        fetch = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("api.options.fetch_upstox", fetch):
            assert await nv.get_baseline_range("2026-10-13") is None
            assert await nv.get_baseline_range("2026-10-13") is None
        fetch.assert_awaited_once()


class TestIntradayFetcher:
    async def test_normalizes_and_caches(self):
        payload = {"status": "success", "data": {"candles":
                   _const_session("2026-10-13", 22100, 22000, n=3)}}
        fetch = AsyncMock(return_value=payload)
        with patch("api.options.fetch_upstox", fetch):
            out = await nv.get_intraday_candles("2026-10-13")
            out2 = await nv.get_intraday_candles("2026-10-13")
        assert out == out2 and len(out) == 3
        fetch.assert_awaited_once()

    async def test_failure_returns_none(self):
        fetch = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("api.options.fetch_upstox", fetch):
            assert await nv.get_intraday_candles("2026-10-13") is None


# ---------------------------------------------------------------------------
# composition with the live endpoint
# ---------------------------------------------------------------------------

def _chain_payload():
    def side(ltp, close, oi, prev_oi, vol, iv=14.0):
        return {"market_data": {"ltp": ltp, "close_price": close, "oi": oi,
                                "prev_oi": prev_oi, "volume": vol},
                "option_greeks": {"iv": iv, "gamma": 0.001}}
    return {
        "underlying_spot_price": 22150.0,
        "data": [
            {"expiry": "2026-10-13", "strike_price": 22100.0,
             "call_options": side(120.0, 110.0, 1000, 800, 500),
             "put_options": side(90.0, 100.0, 2000, 1500, 900)},
            {"expiry": "2026-10-13", "strike_price": 22200.0,
             "call_options": side(80.0, 90.0, 1500, 1400, 300),
             "put_options": side(110.0, 100.0, 1800, 1700, 400)},
        ],
    }


class TestLiveComposition:
    async def test_live_report_carries_four_blocks(self, monkeypatch):
        import api.reports_api.nifty as nifty

        async def fake_fetch(endpoint, params=None):
            if "market-quote/ohlc" in endpoint:
                return _vix_payload()
            if "intraday" in endpoint:
                return {"data": {"candles": _const_session("2026-10-13", 22250, 22050, n=80)}}
            if "historical-candle" in endpoint:
                return {"data": {"candles":
                                 _const_session("2026-10-09", 22100, 22000)
                                 + _const_session("2026-10-10", 22200, 22000)}}
            return _chain_payload()

        monkeypatch.setattr("api.options.fetch_upstox", fake_fetch)
        monkeypatch.setattr(nifty, "_fetch_nifty_candles", lambda *a, **k: [])
        monkeypatch.setattr(nifty, "read_tape", lambda date: [
            {"atm_ce_ltp": 100.0, "atm_pe_ltp": 100.0},
            {"atm_ce_ltp": 110.0, "atm_pe_ltp": 120.0},
        ])
        monkeypatch.setattr(nifty, "_today_str", lambda: "2026-10-13")
        nifty._live_cache.clear()

        rep = await nifty.get_nifty_live(expiry="2026-10-13")

        for key in ("control", "regime", "vix", "strength"):
            assert key in rep, f"missing {key}"
        assert rep["control"]["gex_regime"] in ("long", "short", "flat")
        assert rep["vix"]["ltp"] == 15.0
        assert rep["regime"]["straddle_pct"] == 15.0
        assert rep["strength"]["score"] >= 0

    async def test_verdict_failure_never_breaks_live(self, monkeypatch):
        import api.reports_api.nifty as nifty

        async def fake_fetch(endpoint, params=None):
            raise RuntimeError("all network down")

        monkeypatch.setattr("api.options.fetch_upstox", fake_fetch)
        monkeypatch.setattr(nifty, "_fetch_nifty_candles", lambda *a, **k: [])
        monkeypatch.setattr(nifty, "read_tape", lambda date: [])
        monkeypatch.setattr(nifty, "_today_str", lambda: "2026-10-13")
        nifty._live_cache.clear()

        # Chain fetch fails first → the endpoint's own 502 contract still holds.
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            await nifty.get_nifty_live(expiry="2026-10-13")
        assert exc.value.status_code == 502
