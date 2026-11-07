"""Unit tests for the generic option-chain recorder (SENSEX / RELIANCE).

Every upstream call is mocked and ``DATA_ROOT`` is redirected to ``tmp_path``,
so nothing here touches Upstox, Redis or ``experiments/data``.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest

import config
import api.reports_api.nifty as nifty
from api.reports_api import options_recorder as rec

SYMBOLS = ["SENSEX", "RELIANCE"]

#: Fields the NIFTY tape writes; the generic tape row must carry all of them
#: (plus ``underlying``) or the heatmap/radar/bursts rebuild breaks.
TAPE_FIELDS = {
    "t", "spot", "ce_oi", "pe_oi", "ce_vol", "pe_vol", "pcr_oi", "pcr_vol",
    "max_pain", "max_pain_computed", "flip", "net_gex", "gex_degraded", "walls",
    "expiry", "atm_strike", "atm_ce_ltp", "atm_pe_ltp", "atm_ce_iv",
    "atm_pe_iv", "strikes_top", "chain", "underlying",
}


def _ts(hour: int = 10, minute: int = 0, second: int = 5) -> datetime:
    return datetime(2026, 10, 29, hour, minute, second, tzinfo=config.IST)


def _leg(ltp: float, oi: int, volume: int, gamma: float,
         delta: float, key: str = "") -> dict:
    return {
        "instrument_key": key,
        "market_data": {
            "ltp": ltp,
            "close_price": ltp,
            "oi": oi,
            "prev_oi": max(0, oi - 50),
            "volume": volume,
        },
        "option_greeks": {
            "delta": delta, "gamma": gamma, "theta": -1.0, "vega": 1.0, "iv": 12.5,
        },
    }


def _chain(spot: float = 84000.0, ce_oi: int = 1000, pe_oi: int = 1200,
           step: float = 100.0, ce_key: str = "", pe_key: str = "") -> list[dict]:
    rows = []
    for i in range(-2, 3):
        strike = spot + i * step
        rows.append({
            "strike": strike,
            "ce": _leg(120.0 - i * 5, ce_oi, 4000 + i, 0.0012, 0.5, ce_key),
            "pe": _leg(110.0 + i * 5, pe_oi, 5000 + i, 0.0011, -0.5, pe_key),
        })
    return rows


def _lines(path: Path) -> list[dict]:
    if not Path(path).exists():
        return []
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


@pytest.fixture()
def recorder(tmp_path, monkeypatch):
    """Recorder with DATA_ROOT + every upstream call redirected/mocked."""
    monkeypatch.setattr(rec, "DATA_ROOT", tmp_path)
    monkeypatch.setattr(rec, "INTERVAL_SEC", 10.0)
    monkeypatch.setattr(rec, "SYMBOL_TIMEOUT_SEC", 25.0)

    # --- rate limiter: capture the consumer slice, never block ---------------
    class FakeLimiter:
        instances: list["FakeLimiter"] = []

        def __init__(self, consumer=None):
            self.consumer = consumer
            self.calls = 0
            FakeLimiter.instances.append(self)

        def acquire(self, cost: int = 1, timeout: float = 10.0) -> bool:
            self.calls += 1
            return True

    FakeLimiter.instances = []
    monkeypatch.setattr(
        "upstox_trader.rate_limiter.UpstoxRateLimiter", FakeLimiter)

    # --- instruments file: SENSEX is an index, RELIANCE is a stock lot 500 ---
    instruments = tmp_path / "nse_instruments.json"
    instruments.write_text(json.dumps([
        {"segment": "NSE_EQ", "instrument_key": "NSE_EQ|INE002A01018", "lot_size": 1},
        {"segment": "NSE_FO", "instrument_key": "NSE_FO|CE1", "lot_size": 500,
         "underlying_symbol": "RELIANCE", "asset_symbol": "RELIANCE"},
        {"segment": "NSE_FO", "instrument_key": "NSE_FO|PE1", "lot_size": 500,
         "underlying_symbol": "RELIANCE", "asset_symbol": "RELIANCE"},
    ]))
    monkeypatch.setattr(rec, "_instruments_path", lambda: instruments)

    # --- upstream mocks -----------------------------------------------------
    expiries = AsyncMock(return_value={
        "underlying": "SENSEX",
        "expiries": [{"date": "2026-10-30", "weekly": True, "days_to_expiry": 1}],
    })
    chain = AsyncMock(return_value={"status": "ok", "spot": 84000.0,
                                    "chain": _chain()})
    bars = MagicMock(return_value=[])
    monkeypatch.setattr(rec, "get_expiries", expiries, raising=False)
    monkeypatch.setattr(rec, "get_option_chain", chain, raising=False)
    monkeypatch.setattr(rec, "fetch_candles_for_timeframe", bars)

    rec._reset_state()
    rec._gap_minutes.clear()
    yield {"expiries": expiries, "chain": chain, "bars": bars,
           "limiter": FakeLimiter, "root": tmp_path}
    rec._reset_state()
    rec._gap_minutes.clear()


class TestPaths:
    def test_paths_are_generic_and_symbol_scoped(self, recorder):
        root = recorder["root"]
        assert rec.chain10s_path("SENSEX", "2026-10-29") == (
            root / "options_chain10s" / "SENSEX" / "2026-10-29.jsonl")
        assert rec.tape_path("RELIANCE", "2026-10-29") == (
            root / "options_tape" / "RELIANCE" / "2026-10-29.jsonl")
        assert rec.snapshot_log_path("SENSEX", "2026-10-29") == (
            root / "options_snapshots" / "SENSEX" / "2026-10-29.jsonl")
        assert rec.snapshot_path("SENSEX", "2026-10-29") == (
            root / "options_snapshots" / "SENSEX" / "2026-10-29.json")
        assert rec.gap_log_path("SENSEX", "2026-10-29") == (
            root / "options_tape" / "SENSEX" / "2026-10-29.gaps.jsonl")

    def test_no_nifty_namespace_is_touched(self, recorder):
        assert not hasattr(rec, "_compute_live")
        assert not hasattr(rec, "_live_cache")
        assert rec.DATA_ROOT == recorder["root"]
        for path in recorder["root"].rglob("*"):
            assert "nifty" not in path.parts


class TestLotSize:
    def test_index_lot_from_available_underlyings(self, recorder):
        assert rec.lot_size("SENSEX", _chain()) == 20

    def test_stock_lot_from_chain_instrument_key(self, recorder):
        chain = _chain(step=10.0, ce_key="NSE_FO|CE1", pe_key="NSE_FO|PE1")
        assert rec.lot_size("RELIANCE", chain) == 500

    def test_unknown_symbol_falls_back_to_one(self, recorder):
        assert rec.lot_size("MYSTERY", []) == 1

    def test_flattened_strikes_resolve_from_underlying_symbol(self, recorder):
        # The replay report's ``strikes`` keep no instrument_key — the history
        # agent passes exactly that shape to lot_size().
        strikes = [{"strike": 1310.0,
                    "ce": {"ltp": 1.0, "oi": 10, "volume": 1},
                    "pe": {"ltp": 1.0, "oi": 10, "volume": 1}}]
        assert rec.lot_size("RELIANCE", strikes) == 500

    async def test_report_carries_lot_size(self, recorder):
        recorder["chain"].return_value = {
            "status": "ok", "spot": 1310.0,
            "chain": _chain(spot=1310.0, step=10.0,
                            ce_key="NSE_FO|CE1", pe_key="NSE_FO|PE1"),
        }
        await rec.record_tick(now=_ts())
        assert rec.LAST["RELIANCE"]["lot_size"] == 500
        assert rec.LAST["SENSEX"]["lot_size"] == 20
        last = json.loads(rec.snapshot_path("RELIANCE", "2026-10-29").read_text())
        assert last["lot_size"] == 500


class TestOneTick:
    async def test_writes_chain10s_tape_and_snapshot(self, recorder):
        await rec.record_tick(now=_ts())
        date_str = "2026-10-29"

        chain10s = _lines(rec.chain10s_path("SENSEX", date_str))
        assert len(chain10s) == 1
        line = chain10s[0]
        assert set(line) == {"t", "spot", "expiry", "rows"}
        assert line["expiry"] == "2026-10-30"
        assert line["spot"] == pytest.approx(84000.0)
        assert line["t"].endswith("10:00:05+05:30")
        assert len(line["rows"]) == 5
        assert all(len(cell) == 7 for cell in line["rows"])
        # [strike, ceLtp, ceOi, ceVol, peLtp, peOi, peVol]
        assert line["rows"][0][0] == pytest.approx(83800.0)

        tape = _lines(rec.tape_path("SENSEX", date_str))
        assert len(tape) == 1
        row = tape[0]
        assert TAPE_FIELDS <= set(row)
        assert row["underlying"] == "SENSEX"
        assert row["expiry"] == "2026-10-30"
        assert row["ce_oi"] == 5 * 1000
        assert row["pe_oi"] == 5 * 1200
        assert row["atm_strike"] == pytest.approx(84000.0)
        assert row["walls"]["calls"]  # near walls are within ±1% of spot
        assert row["chain"]  # per-strike LTP/OI/volume map
        assert row["gex_degraded"] is False

        frames = _lines(rec.snapshot_log_path("SENSEX", date_str))
        assert len(frames) == 1
        assert set(frames[0]) == {"t", "fetched_at", "report", "sensex"}
        assert frames[0]["sensex"] is None
        assert frames[0]["report"]["underlying"] == "SENSEX"
        assert frames[0]["report"]["gex"]["net_total"] is not None
        assert frames[0]["report"]["positioning"] is not None

        last = json.loads(rec.snapshot_path("SENSEX", date_str).read_text())
        assert last["underlying"] == "SENSEX"
        assert last["mode"] == "snapshot"
        assert last["date"] == date_str
        # atomic write leaves no temp file behind
        assert not list(rec.snapshot_path("SENSEX", date_str).parent.glob("*.tmp"))

    async def test_both_symbols_recorded(self, recorder):
        await rec.record_tick(now=_ts())
        for symbol in SYMBOLS:
            assert _lines(rec.tape_path(symbol, "2026-10-29")), symbol
            assert _lines(rec.snapshot_log_path(symbol, "2026-10-29")), symbol
        assert rec.status()["per_symbol"]["SENSEX"]["chain10s"] == 1

    async def test_two_ticks_same_minute_write_one_tape_row(self, recorder):
        await rec.record_tick(now=_ts(minute=0, second=5))
        await rec.record_tick(now=_ts(minute=0, second=15))
        date_str = "2026-10-29"

        assert len(_lines(rec.chain10s_path("SENSEX", date_str))) == 2
        assert len(_lines(rec.tape_path("SENSEX", date_str))) == 1
        assert len(_lines(rec.snapshot_log_path("SENSEX", date_str))) == 1

    async def test_minute_roll_writes_second_row(self, recorder):
        calls = {"n": 0}

        async def fake_chain(symbol, expiry):
            calls["n"] += 1
            ce_oi = 1000 if calls["n"] <= 2 else 1500  # tick 1 -> tick 2
            return {"status": "ok", "spot": 84000.0 + 10 * (calls["n"] > 2),
                    "chain": _chain(ce_oi=ce_oi)}

        recorder["chain"].side_effect = fake_chain
        await rec.record_tick(now=_ts(minute=0, second=5))
        await rec.record_tick(now=_ts(minute=1, second=5))

        rows = _lines(rec.tape_path("SENSEX", "2026-10-29"))
        assert len(rows) == 2
        derived = nifty.derive_tape_rows(rows)
        assert derived[0]["call_doi"] == 0
        assert derived[1]["call_doi"] == rows[1]["ce_oi"] - rows[0]["ce_oi"]
        assert derived[1]["call_doi"] == 5 * 500
        assert derived[1]["put_doi"] == 0
        assert derived[1]["call_tick"] >= 0


class TestStatusAndBudget:
    async def test_status_contract(self, recorder):
        await rec.record_tick(now=_ts())
        status = rec.status()
        for key in ("symbols", "last_tick", "last_error", "iterations",
                    "interval_sec", "records"):
            assert key in status
        assert status["symbols"] == SYMBOLS
        assert status["iterations"] == 1
        assert status["interval_sec"] == 10.0
        assert status["records"] >= 2  # one chain10s line per symbol
        assert status["last_error"] is None
        assert status["last_tick"].endswith("10:00:05+05:30")

    async def test_rate_limiter_consumer_is_options(self, recorder):
        await rec.record_tick(now=_ts())
        limiter = rec._rate_limiter()
        assert limiter is not None
        assert limiter.consumer == "options"
        assert limiter.calls > 0
        assert recorder["limiter"].instances  # exactly one singleton
        assert len(recorder["limiter"].instances) == 1

    async def test_expiry_cached_for_an_hour(self, recorder):
        await rec.record_tick(now=_ts(minute=0))
        await rec.record_tick(now=_ts(minute=1))
        # one listing per symbol across both ticks
        assert recorder["expiries"].await_count == 2


class TestFailures:
    async def test_one_symbol_failure_does_not_kill_the_other(self, recorder):
        async def fake_chain(symbol, expiry):
            if symbol == "RELIANCE":
                raise RuntimeError("upstream 401")
            return {"status": "ok", "spot": 84000.0, "chain": _chain()}

        recorder["chain"].side_effect = fake_chain
        outcome = await rec.record_tick(now=_ts())

        assert outcome["symbols"]["SENSEX"] == "ok"
        assert outcome["symbols"]["RELIANCE"] == "RuntimeError"
        assert _lines(rec.tape_path("SENSEX", "2026-10-29"))
        assert not _lines(rec.tape_path("RELIANCE", "2026-10-29"))
        gaps = _lines(rec.gap_log_path("RELIANCE", "2026-10-29"))
        assert gaps and gaps[0]["reason"] == "tick-failed"
        assert gaps[0]["symbol"] == "RELIANCE"
        assert rec.status()["last_error"].startswith("RuntimeError")

    async def test_gap_journal_deduped_per_minute(self, recorder):
        recorder["chain"].side_effect = RuntimeError("boom")
        for second in (5, 15, 25, 35, 45, 55):
            await rec.record_tick(now=_ts(minute=0, second=second))
        gaps = _lines(rec.gap_log_path("SENSEX", "2026-10-29"))
        assert len(gaps) == 1

    async def test_no_expiry_skips_without_writing(self, recorder):
        recorder["expiries"].return_value = {"underlying": "SENSEX", "expiries": []}
        await rec.record_tick(now=_ts())
        assert not _lines(rec.chain10s_path("SENSEX", "2026-10-29"))
        gaps = _lines(rec.gap_log_path("SENSEX", "2026-10-29"))
        assert gaps and gaps[0]["reason"] == "no-expiry"

    async def test_empty_chain_is_not_persisted(self, recorder):
        recorder["chain"].return_value = {"status": "ok", "spot": 84000.0, "chain": []}
        await rec.record_tick(now=_ts())
        assert not _lines(rec.chain10s_path("SENSEX", "2026-10-29"))
        assert not _lines(rec.tape_path("SENSEX", "2026-10-29"))
        gaps = _lines(rec.gap_log_path("SENSEX", "2026-10-29"))
        assert gaps and gaps[0]["reason"] == "empty-chain"


class TestIntraday:
    def _df(self) -> pd.DataFrame:
        idx = pd.to_datetime([
            "2026-10-29T09:15:00+05:30",
            "2026-10-29T09:16:00+05:30",
        ])
        return pd.DataFrame(
            {"open": [83990.0, 84010.0], "high": [84050.0, 84080.0],
             "low": [83950.0, 83990.0], "close": [84010.0, 84060.0],
             "volume": [100, 200]},
            index=idx,
        )

    async def test_intraday_emas_and_ohlc_in_replay_report(self, recorder):
        recorder["bars"].return_value = self._df()
        await rec.record_tick(now=_ts())

        report = rec.LAST["SENSEX"]
        assert len(report["intraday"]) == 2
        assert [e["period"] for e in report["emas"]] == [9, 20]
        assert len(report["emas"][0]["data"]) == 2
        assert report["ohlc"] == {"open": 83990.0, "high": 84080.0,
                                  "low": 83950.0, "close": 84060.0}

        frame = _lines(rec.snapshot_log_path("SENSEX", "2026-10-29"))[0]
        assert len(frame["report"]["intraday"]) == 2

    async def test_candles_fetched_at_most_every_120s(self, recorder):
        recorder["bars"].return_value = self._df()
        await rec.record_tick(now=_ts(minute=0))
        await rec.record_tick(now=_ts(minute=1))
        await rec.record_tick(now=_ts(minute=2))
        assert recorder["bars"].call_count == 2  # once per symbol, then cached

    async def test_candle_failure_degrades_to_flat_spot(self, recorder):
        recorder["bars"].side_effect = RuntimeError("no bars")
        await rec.record_tick(now=_ts())
        report = rec.LAST["SENSEX"]
        assert report["intraday"] == []
        assert report["emas"] == []
        assert report["ohlc"] == {"open": 84000.0, "high": 84000.0,
                                  "low": 84000.0, "close": 84000.0}


class TestWalls:
    async def test_near_walls_use_one_percent_band_not_300_points(self, recorder):
        # A far 5000-pt wall must not win walls_near for an 84k spot (±1%).
        chain = _chain()
        chain.append({
            "strike": 89000.0,
            "ce": _leg(1.0, 9_000_000, 1, 0.0, 0.01),
            "pe": _leg(1.0, 9_000_000, 1, 0.0, -0.01),
        })
        recorder["chain"].return_value = {"status": "ok", "spot": 84000.0,
                                          "chain": chain}
        await rec.record_tick(now=_ts())
        report = rec.LAST["SENSEX"]
        near = report["walls_near"]["calls"]
        assert near
        assert all(abs(w["strike"] - 84000.0) <= 840.0 for w in near)
        # The unrestricted ranking still keeps the far mega-wall.
        assert report["walls"]["calls"][0]["strike"] == pytest.approx(89000.0)


class TestCadence:
    def test_on_time_tick_keeps_wall_clock_grid(self):
        # tick at t=100 for a 10 s loop → next tick is 110, not 100+10 float drift
        assert rec._advance_next_tick(100.0, 10.0, 100.4) == pytest.approx(110.0)

    def test_slow_tick_does_not_double_fire(self):
        # a tick that finished at 118 (missed the 110 slot) must not re-run now
        assert rec._advance_next_tick(100.0, 10.0, 118.0) == pytest.approx(128.0)

    def test_reopen_after_closed_sleep_does_not_burst(self):
        # next_tick was set ~60 s ago while the market was shut
        assert rec._advance_next_tick(100.0, 10.0, 160.0) == pytest.approx(170.0)


class TestEodAnalytics:
    """The per-minute replay frame carries the live session blocks.

    After 15:30 the report auto-switches to EOD and reads these stored fields;
    without them the panel shows ``—`` for VIX/control/regime/strength.
    """

    def _df16(self) -> pd.DataFrame:
        idx = pd.to_datetime([
            f"2026-10-29T09:{15 + i:02d}:00+05:30" for i in range(16)
        ])
        closes = [84000.0 + i for i in range(16)]
        return pd.DataFrame(
            {"open": [c - 0.5 for c in closes],
             "high": [c + 0.5 for c in closes],
             "low": [c - 1.0 for c in closes],
             "close": closes,
             "volume": [100 + i for i in range(16)]},
            index=idx,
        )

    @pytest.fixture()
    def analytics_deps(self, recorder, monkeypatch):
        """Deterministic offline legs for ``_attach_analytics``."""
        from api.reports_api import nifty_verdicts as nv
        from api.reports_api import options_report as orpt

        async def _daily(symbol, today):
            return {"rows": [],
                    "pivots": {"pp": 83900.0, "prev": {"close": 83850.0}},
                    "baseline_pct": 1.5}

        async def _fake_vix():
            return {"ltp": 12.5, "prev_close": 12.0, "change_pct": 4.17,
                    "day_high": 12.8, "day_low": 11.9}

        monkeypatch.setattr(orpt, "get_daily_context", _daily)
        monkeypatch.setattr(nv, "get_vix_block", _fake_vix)
        monkeypatch.setattr(
            orpt, "read_tape",
            lambda symbol, date: [
                {"t": "2026-10-29T09:15:00+05:30", "spot": 84000.0,
                 "atm_strike": 84000.0, "atm_ce_ltp": 118.0,
                 "atm_pe_ltp": 108.0},
                {"t": "2026-10-29T09:16:00+05:30", "spot": 84001.0,
                 "atm_strike": 84000.0, "atm_ce_ltp": 119.0,
                 "atm_pe_ltp": 109.0},
            ])
        return recorder

    def _assert_analytics(self, report: dict, symbol: str):
        assert report["vix"]["ltp"] == 12.5
        assert report["vix"]["change_pct"] == 4.17
        assert report["vix"]["source"] == "INDIA_VIX"
        assert isinstance(report["control"]["verdict"], str)
        assert report["control"]["verdict"]
        assert isinstance(report["regime"]["verdict"], str)
        assert "rv" in report["regime"]
        assert report["regime"]["iv"] == 12.5
        assert "rv_iv_ratio" in report["regime"]
        assert isinstance(report["strength"]["verdict"], str)
        assert isinstance(report["strength"]["score"], int)
        assert 0 <= report["strength"]["score"] <= 100
        assert "rsi" in report["strength"]
        assert report["pivots"]["pp"] == 83900.0
        assert report["reference"]["strike"] == pytest.approx(84000.0)
        assert report["reference"]["ce_ltp"] == pytest.approx(120.0)
        assert report["reference"]["pe_ltp"] == pytest.approx(110.0)
        assert report["ohlc"] == {"open": 83999.5, "high": 84015.5,
                                  "low": 83999.0, "close": 84015.0}
        assert set(report["market"]) == {"is_open", "session_date", "as_of"}
        assert isinstance(report["timeline"], list)
        assert isinstance(report["structure"], list)  # may be []
        assert report["gex"]["net_total"] is not None
        assert report["positioning"] is not None
        assert report["max_pain"] > 0
        assert report["pcr_oi"] > 0
        # pre-existing fields survive the enrichment
        assert report["underlying"] == symbol
        assert report["expiry"] == "2026-10-30"
        assert len(report["strikes"]) == 5
        assert len(report["intraday"]) == 16

    async def test_snapshot_carries_analytics(self, analytics_deps):
        analytics_deps["bars"].return_value = self._df16()
        await rec.record_tick(now=_ts())
        for symbol in SYMBOLS:
            frame = _lines(rec.snapshot_log_path(symbol, "2026-10-29"))[0]
            assert set(frame) == {"t", "fetched_at", "report", "sensex"}
            self._assert_analytics(frame["report"], symbol)
            last = json.loads(rec.snapshot_path(symbol, "2026-10-29").read_text())
            self._assert_analytics(last, symbol)

    async def test_no_nifty_paths_created(self, analytics_deps):
        analytics_deps["bars"].return_value = self._df16()
        await rec.record_tick(now=_ts())
        for path in analytics_deps["root"].rglob("*"):
            assert "nifty" not in path.parts

    async def test_enrichment_failure_never_kills_the_tick(
            self, recorder, monkeypatch):
        """If analytics raise, the tape row + snapshot still land (legacy shape)."""
        from api.reports_api import options_report as orpt

        async def _boom(symbol, report, intraday):
            raise RuntimeError("analytics down")

        monkeypatch.setattr(orpt, "_attach_analytics", _boom)
        await rec.record_tick(now=_ts())
        date_str = "2026-10-29"
        assert len(_lines(rec.tape_path("SENSEX", date_str))) == 1
        frame = _lines(rec.snapshot_log_path("SENSEX", date_str))[0]
        assert frame["report"]["underlying"] == "SENSEX"
        assert frame["report"]["strikes"]

    async def test_snapshot_pivots_from_real_daily_rows(
            self, recorder, monkeypatch):
        """Non-mocked ``get_daily_context``: real daily rows -> real pivots.

        Only the Upstox boundary (``fetch_upstox``) and the market-wide VIX
        are faked; the instrument-key mapping, ``compute_pivots`` and
        ``compute_baseline_pct`` all run for real, for both symbols.
        """
        import api.options as api_options
        from api.reports_api import options_report as orpt
        from api.reports_api import nifty_verdicts as nv

        prev = {"SENSEX": (73525.44, 72603.57, 73246.03),
                "RELIANCE": (1180.0, 1160.0, 1172.9)}
        expected_pp = {"SENSEX": 73125.01, "RELIANCE": 1170.97}

        async def fake_fetch_upstox(endpoint, params=None):
            text = endpoint.upper()
            symbol = "SENSEX" if "SENSEX" in text else "RELIANCE"
            assert "/HISTORICAL-CANDLE/" in text
            h, lo, c = prev[symbol]
            import pandas as pd

            days = [d.strftime("%Y-%m-%d")
                    for d in pd.date_range(end="2026-10-28", periods=25, freq="B")]
            rows = []
            for i, day in enumerate(days):
                if i == len(days) - 1:
                    o, hh, ll, cc = c - 5, h, lo, c
                else:
                    o, hh, ll, cc = c - 50 + i, h - i, lo + i, c - 20 + i
                rows.append([f"{day}T00:00:00+05:30", o, hh, ll, cc, 1000, 0])
            return {"status": "success", "data": {"candles": rows[::-1]}}

        async def fake_vix():
            return {"ltp": 12.5, "prev_close": 12.0, "change_pct": 4.17,
                    "day_high": 12.8, "day_low": 11.9}

        monkeypatch.setattr(api_options, "fetch_upstox", fake_fetch_upstox)
        monkeypatch.setattr(nv, "get_vix_block", fake_vix)
        monkeypatch.setattr(
            orpt, "read_tape",
            lambda symbol, date: [
                {"t": "2026-10-29T09:15:00+05:30", "spot": 84000.0,
                 "atm_strike": 84000.0, "atm_ce_ltp": 118.0,
                 "atm_pe_ltp": 108.0},
            ])
        orpt.clear_cache()
        nv.clear_caches()
        recorder["bars"].return_value = self._df16()
        await rec.record_tick(now=_ts())
        for symbol in SYMBOLS:
            frame = _lines(rec.snapshot_log_path(symbol, "2026-10-29"))[0]
            pivots = frame["report"]["pivots"]
            assert pivots is not None, symbol
            assert pivots["pp"] == pytest.approx(expected_pp[symbol]), symbol
            assert pivots["prev"]["close"] > 0, symbol
            assert frame["report"]["baseline_range_pct"] > 0, symbol
