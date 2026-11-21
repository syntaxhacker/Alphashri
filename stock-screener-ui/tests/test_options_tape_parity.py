"""Parity tests: SENSEX / stock recorder vs the NIFTY reference paths.

Three things are asserted here and nowhere else:

* the generic tape row is the NIFTY row plus ``underlying`` — same keys, same
  order (the day files are diffed and replayed, so order is contract);
* the generic replay frame carries the NIFTY stamp fields and the reconciled
  spot, so tape and replay can never disagree;
* expiry selection follows the NIFTY 0-DTE rule and is cached per
  ``(symbol, today, include_today)``, not per symbol.

Everything upstream is mocked and ``DATA_ROOT`` is redirected to ``tmp_path``.
"""

from __future__ import annotations

import inspect
import json
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import config
import api.reports_api.nifty as nifty
from api.reports_api import options_recorder as rec

TODAY = "2026-10-29"
SYMBOL = "SENSEX"

#: The NIFTY tape row's frozen field order (see the golden test in
#: ``tests/test_reports_nifty_tape.py``), plus the generic ``underlying``.
TAPE_KEYS = [
    "t", "t_fetch", "t_write", "spot", "ce_oi", "pe_oi", "ce_vol", "pe_vol",
    "ce_oi_change_day", "pe_oi_change_day", "pcr_oi", "pcr_vol", "max_pain",
    "max_pain_computed", "flip", "net_gex", "gex_degraded", "walls",
    "call_wall", "put_wall", "expiry", "atm_strike", "atm_ce_ltp",
    "atm_pe_ltp", "atm_ce_iv", "atm_pe_iv", "strikes_top", "chain",
]
FRAME_KEYS = {"t", "fetched_at", "mode", "snapshot_at", "source", "report",
              "sensex"}


def _ts(hour: int = 10, minute: int = 0, second: int = 5) -> datetime:
    return datetime(2026, 10, 29, hour, minute, second, tzinfo=config.IST)


def _leg(ltp: float, oi: int, volume: int) -> dict:
    return {
        "instrument_key": "",
        "market_data": {
            "ltp": ltp, "close_price": ltp, "oi": oi, "prev_oi": oi - 50,
            "volume": volume, "bid_price": ltp - 0.5, "ask_price": ltp + 0.5,
        },
        "option_greeks": {
            "delta": 0.5, "gamma": 0.001, "theta": -1.0, "vega": 1.0,
            "iv": 12.5, "rho": 0.02, "pop": 0.4,
        },
    }


def _chain(spot: float = 84000.0, step: float = 100.0) -> list[dict]:
    return [
        {
            "strike_price": spot + i * step,
            "expiry": "2026-10-30",
            "call_options": _leg(120.0 - i * 5, 1000, 4000 + i),
            "put_options": _leg(110.0 + i * 5, 1200, 5000 + i),
        }
        for i in range(-2, 3)
    ]


def _payload(spot: float = 84000.0) -> dict:
    return {"status": "success", "underlying_spot_price": spot,
            "data": _chain(spot=spot)}


def _lines(path: Path) -> list[dict]:
    if not Path(path).exists():
        return []
    return [json.loads(line) for line in Path(path).read_text().splitlines()
            if line.strip()]


@pytest.fixture()
def recorder(tmp_path, monkeypatch):
    """Recorder with DATA_ROOT + every upstream call redirected/mocked."""
    monkeypatch.setattr(rec, "DATA_ROOT", tmp_path)
    monkeypatch.setattr(rec, "INTERVAL_SEC", 10.0)
    monkeypatch.setattr(rec, "GREEKS_ENABLED", True)
    monkeypatch.setattr(rec, "symbols", lambda: [SYMBOL])
    monkeypatch.setattr(rec, "_derivatives_open", lambda: True)
    monkeypatch.setattr(rec, "_today_str", lambda: TODAY)
    monkeypatch.setattr(rec, "_instruments_path",
                        lambda: tmp_path / "no-instruments.json")

    class FakeLimiter:
        def __init__(self, consumer=None):
            self.consumer = consumer

        def acquire(self, cost: int = 1, timeout: float = 10.0) -> bool:
            return True

    monkeypatch.setattr("upstox_trader.rate_limiter.UpstoxRateLimiter",
                        FakeLimiter)

    expiries = AsyncMock(return_value={
        "underlying": SYMBOL,
        "expiries": [{"date": "2026-10-30", "days_to_expiry": 1}],
    })
    payload = AsyncMock(return_value=_payload())
    monkeypatch.setattr(rec, "get_expiries", expiries, raising=False)
    monkeypatch.setattr(rec, "fetch_upstox", payload, raising=False)
    monkeypatch.setattr(rec, "get_instrument_key",
                        lambda s: f"NSE_INDEX|{str(s).upper()}", raising=False)
    monkeypatch.setattr(rec, "fetch_candles_for_timeframe", MagicMock(return_value=[]))

    rec._reset_state()
    yield {"expiries": expiries, "payload": payload, "root": tmp_path}
    rec._reset_state()


class TestTapeRowParity:
    async def test_generic_row_is_the_nifty_row_plus_underlying(self, recorder):
        await rec.record_tick(now=_ts())
        row = _lines(rec.tape_path(SYMBOL, TODAY))[0]
        assert list(row) == TAPE_KEYS + ["underlying"]
        assert row["underlying"] == SYMBOL

        # The same fixture through the NIFTY writer: identical keys and order.
        nifty_row = await _nifty_row(recorder["root"])
        assert list(row)[:-1] == list(nifty_row)

    async def test_generic_row_carries_the_seven_previously_missing_fields(
            self, recorder):
        await rec.record_tick(now=_ts())
        row = _lines(rec.tape_path(SYMBOL, TODAY))[0]

        assert row["t_fetch"] == row["t"]
        assert row["t_write"].endswith("+05:30")
        assert row["t_write"] >= row["t"]
        assert "spot_raw" not in row  # chain spot was not moved

        # NEAR walls: the scalar wall strikes come from the SAME block the row
        # records, so the wall-change detector can diff two frames.
        assert row["call_wall"] == row["walls"]["calls"][0]["strike"]
        assert row["put_wall"] == row["walls"]["puts"][0]["strike"]

        # Day-change OI is oi - prev_oi (5 strikes x 50), NOT the row-to-row
        # delta the derived tape publishes as ``call_doi``.
        assert row["ce_oi_change_day"] == 5 * 50
        assert row["pe_oi_change_day"] == 5 * 50

    async def test_reconciled_spot_is_written_to_tape_and_replay(
            self, recorder):
        await rec.record_tick(now=_ts(minute=0, second=5))
        recorder["payload"].return_value = _payload(spot=84600.0)
        with patch("api.options.get_spot_price",
                   AsyncMock(return_value={"spot": 84020.0})):
            await rec.record_tick(now=_ts(minute=1, second=5))

        rows = _lines(rec.tape_path(SYMBOL, TODAY))
        assert len(rows) == 2
        row = rows[1]
        assert row["spot"] == 84020.0
        assert row["spot_raw"] == 84600.0

        frame = _lines(rec.snapshot_log_path(SYMBOL, TODAY))[-1]
        assert frame["report"]["spot"] == row["spot"]  # tape and replay agree
        assert frame["report"]["spot_raw"] == row["spot_raw"]
        assert frame["report"]["spot_source"] == "tape_reconciled"
        snapshot = json.loads(rec.snapshot_path(SYMBOL, TODAY).read_text())
        assert snapshot["spot"] == row["spot"]

    async def test_replay_frame_has_the_nifty_stamp_fields(self, recorder):
        await rec.record_tick(now=_ts())
        frame = _lines(rec.snapshot_log_path(SYMBOL, TODAY))[0]
        assert set(frame) == FRAME_KEYS
        assert frame["snapshot_at"] == frame["t"]
        assert frame["mode"] == frame["report"].get("mode", "snapshot")
        assert frame["source"] == "upstox-option-chain"


async def _nifty_row(tmp: Path) -> dict:
    """A NIFTY tape row for a fixed fixture (I/O patched out)."""
    strikes = [
        {"strike": 25000.0,
         "ce": {"ltp": 80.0, "oi": 1000, "prev_oi": 950, "volume": 5000, "iv": 12.5},
         "pe": {"ltp": 25.0, "oi": 2000, "prev_oi": 1900, "volume": 6000, "iv": 13.5}},
        {"strike": 25100.0,
         "ce": {"ltp": 40.0, "oi": 700, "prev_oi": 700, "volume": 2200, "iv": 12.2},
         "pe": {"ltp": 60.0, "oi": 900, "prev_oi": 880, "volume": 3300, "iv": 13.0}},
    ]
    report = {"expiry": "2026-10-15", "spot": 25000.0, "pcr_oi": 1.9,
              "pcr_vol": 1.2, "max_pain": 25000.0,
              "walls": {"calls": [{"strike": 25100.0, "oi": 900}],
                        "puts": [{"strike": 24900.0, "oi": 950}]},
              "gex": {"zero_cross": 25100.0, "net_total": -10.0},
              "strikes": strikes}
    with patch.object(nifty, "TAPE_DIR", tmp), \
            patch.object(nifty, "_peek_last_tape_row", lambda p, m: (None, False)), \
            patch.object(nifty, "_append_tape_line", lambda p, r: None), \
            patch.object(nifty, "write_snapshot", lambda d, s: tmp / "s.json"), \
            patch.object(nifty, "_append_minute_snapshot",
                         AsyncMock(return_value=None)):
        return await nifty._write_tape_row(
            report, "2026-10-13", "2026-10-13T09:15:00+05:30",
            datetime(2026, 10, 13, 9, 15, tzinfo=config.IST),
            nifty.tape_path("2026-10-13"), "2026-10-13T09:15")


class TestExpiryParity:
    """Today's contract is the nearest expiry only while F&O is open."""

    def _listing(self, expiries):
        return AsyncMock(return_value={"underlying": SYMBOL,
                                       "expiries": expiries})

    async def test_zero_dte_is_chosen_while_derivatives_are_open(
            self, recorder, monkeypatch):
        monkeypatch.setattr(rec, "_derivatives_open", lambda: True)
        recorder["expiries"].return_value = {
            "underlying": SYMBOL,
            "expiries": [
                {"date": TODAY, "days_to_expiry": 0},
                {"date": "2026-10-30", "days_to_expiry": 1},
            ],
        }
        assert await rec._nearest_expiry(SYMBOL) == TODAY

    async def test_after_the_close_the_next_expiry_wins(self, recorder,
                                                        monkeypatch):
        monkeypatch.setattr(rec, "_derivatives_open", lambda: False)
        recorder["expiries"].return_value = {
            "underlying": SYMBOL,
            "expiries": [
                {"date": TODAY, "days_to_expiry": 0},
                {"date": "2026-10-30", "days_to_expiry": 1},
            ],
        }
        assert await rec._nearest_expiry(SYMBOL) == "2026-10-30"

    async def test_a_session_cache_cannot_keep_the_zero_dte_expiry(
            self, recorder, monkeypatch):
        recorder["expiries"].return_value = {
            "underlying": SYMBOL,
            "expiries": [
                {"date": TODAY, "days_to_expiry": 0},
                {"date": "2026-10-30", "days_to_expiry": 1},
            ],
        }
        monkeypatch.setattr(rec, "_derivatives_open", lambda: True)
        assert await rec._nearest_expiry(SYMBOL) == TODAY
        assert recorder["expiries"].await_count == 1

        # Same symbol, same day, different `include_today`: a symbol-only cache
        # would keep returning today's contract after the close.
        monkeypatch.setattr(rec, "_derivatives_open", lambda: False)
        assert await rec._nearest_expiry(SYMBOL) == "2026-10-30"
        assert recorder["expiries"].await_count == 2
        assert all(isinstance(k, tuple) and len(k) == 3
                   for k in rec._expiry_cache)

    async def test_plain_string_expiries_are_accepted(self, recorder):
        recorder["expiries"].return_value = {
            "underlying": SYMBOL, "expiries": ["2026-10-30"]}
        assert await rec._nearest_expiry(SYMBOL) == "2026-10-30"


class TestTenSecondWindow:
    def test_sensex_window_is_wider_than_the_old_500_band(self):
        window = rec._window_for(84000.0)
        assert window == pytest.approx(4200.0)  # 5% of spot, not the 750 floor
        assert window > 500.0                   # the band this replaced
        # ~41 strikes each side at SENSEX's 100-pt grid.
        assert window // 100 >= 41

    def test_small_underlyings_keep_the_750_floor(self):
        assert rec._window_for(1300.0) == 750.0
        assert rec._window_for(0) == 750.0
        assert rec._window_for(1300.0) > 500.0

    def test_nifty_ten_second_window_is_untouched(self):
        from api.reports_api import chain10s

        assert chain10s.WINDOW_PTS == 750.0
        # The generic helper must never leak into the NIFTY module: NIFTY calls
        # ``slim_rows`` with its own fixed window.
        assert "_window_for" not in inspect.getsource(nifty)


class TestJournalPolicies:
    """The three gap journals keep their distinct, pre-refactor dedupe rules."""

    def test_tape_journal_dedupes_by_minute(self, recorder):
        rec._append_gap(SYMBOL, TODAY, _ts(minute=0, second=5).isoformat(),
                        "chain-failed")
        rec._append_gap(SYMBOL, TODAY, _ts(minute=0, second=45).isoformat(),
                        "timeout")  # same minute, different reason
        lines = _lines(rec.gap_log_path(SYMBOL, TODAY))
        assert len(lines) == 1
        assert lines[0]["symbol"] == SYMBOL

    def test_chain_journal_dedupes_by_minute_and_reason(self, recorder):
        stamp = _ts(minute=0, second=5).isoformat()
        rec._append_chain_gap(SYMBOL, TODAY, stamp, "empty-chain")
        rec._append_chain_gap(SYMBOL, TODAY, stamp, "chain-failed")
        rec._append_chain_gap(SYMBOL, TODAY, stamp, "empty-chain")  # repeat
        lines = _lines(rec.chain10s_gap_path(SYMBOL, TODAY))
        assert [ln["reason"] for ln in lines] == ["empty-chain", "chain-failed"]

    def test_nifty_journal_still_dedupes_by_minute(self, tmp_path, monkeypatch):
        monkeypatch.setattr(nifty, "TAPE_DIR", tmp_path)
        nifty._GAP_MINUTES.clear()
        nifty._append_gap("2026-10-13", _ts(minute=0, second=5).isoformat(),
                          "chain-failed", "boom")
        nifty._append_gap("2026-10-13", _ts(minute=0, second=30).isoformat(),
                          "timeout")
        entries = _lines(nifty.gap_log_path("2026-10-13"))
        assert len(entries) == 1
        assert entries[0]["reason"] == "chain-failed"
        assert entries[0]["detail"] == "boom"
        assert "symbol" not in entries[0]
        nifty._GAP_MINUTES.clear()
