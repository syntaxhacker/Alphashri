"""Unit tests for the Nifty OI tape (api/reports_api/nifty.py tape section).

Derivation math is verified against hand-computed values; the recorder is
tested with a mocked ``_compute_live`` and ``TAPE_DIR`` redirected to
tmp_path. Never hits real endpoints.
Call endpoint functions directly, passing every Query param explicitly
(FastAPI Query defaults are Param objects when called outside HTTP).
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import config
import api.reports_api.nifty as nifty
from api.reports_api.nifty import (
    derive_tape_rows,
    get_nifty_tape,
    read_tape,
    record_nifty_tape_tick,
)


@pytest.fixture()
def _tmp_tape(tmp_path, monkeypatch):
    monkeypatch.setattr(nifty, "TAPE_DIR", tmp_path)
    return tmp_path


def _raw(t, spot, ce_oi, pe_oi, ce_vol, pe_vol, pcr_oi, flip):
    return {
        "t": t, "spot": spot,
        "ce_oi": ce_oi, "pe_oi": pe_oi,
        "ce_vol": ce_vol, "pe_vol": pe_vol,
        "pcr_oi": pcr_oi, "pcr_vol": 1.0,
        "max_pain": 25000.0, "flip": flip,
        "walls": {"calls": [], "puts": []},
        "expiry": "2026-10-15",
    }


def _rows():
    # first row anchors all vs-first deltas
    return [
        _raw("2026-10-13T09:15:00+05:30", 25000.0, 1000, 2000, 5000, 6000, 2.0, 25100.0),
        _raw("2026-10-13T09:16:00+05:30", 25050.0, 1200, 2300, 5200, 6300, 1.92, 25100.0),
        _raw("2026-10-13T09:17:00+05:30", 24950.0, 1100, 1900, 5400, 6100, 1.73, None),
    ]


class TestDeriveTapeRows:
    def test_hand_computed(self):
        out = derive_tape_rows(_rows())
        assert len(out) == 3

        r0 = out[0]
        assert (r0["call_doi"], r0["put_doi"], r0["net"]) == (0, 0, 0)
        assert r0["net_pct"] == 0.0  # zero denominator -> 0.0
        assert (r0["call_tick"], r0["put_tick"]) == (0, 0)  # first row
        assert r0["pcr_doi"] == 0.0
        assert r0["spot_flip"] == -100.0  # 25000 - 25100

        r1 = out[1]
        assert (r1["call_doi"], r1["put_doi"]) == (200, 300)
        assert r1["net"] == 100  # 300 - 200
        assert r1["net_pct"] == 20.0  # 100*100/500
        assert (r1["call_tick"], r1["put_tick"]) == (200, 300)  # 5200-5000, 6300-6000
        assert r1["pcr_doi"] == -0.08  # 1.92 - 2.0
        assert r1["spot_flip"] == -50.0  # 25050 - 25100

        r2 = out[2]
        assert (r2["call_doi"], r2["put_doi"]) == (100, -100)
        assert r2["net"] == -200  # -100 - 100
        assert r2["net_pct"] == -100.0  # 100*-200/(|100|+|-100|): absolute-share stays sane
        assert (r2["call_tick"], r2["put_tick"]) == (200, -200)
        assert r2["pcr_doi"] == -0.27  # 1.73 - 2.0
        assert r2["spot_flip"] is None  # null flip

    def test_net_pct_negative_total_unwind(self):
        # expiry-day unwinding: both sides fall, calls fall faster
        rows = [
            _raw("2026-10-13T09:15:00+05:30", 25000.0, 10000, 20000, 0, 0, 2.0, 25100.0),
            _raw("2026-10-13T09:16:00+05:30", 25000.0, 9000, 19500, 0, 0, 2.0, 25100.0),
        ]
        out = derive_tape_rows(rows)
        # call_doi=-1000, put_doi=-500, net=+500, denom=1500 -> +33.33 (not negative)
        assert out[1]["net"] == 500
        assert out[1]["net_pct"] == 33.33

    def test_raw_keys_preserved(self):
        out = derive_tape_rows(_rows())
        for raw, derived in zip(_rows(), out):
            for key in ("t", "spot", "ce_oi", "pe_oi", "max_pain", "expiry"):
                assert derived[key] == raw[key]

    def test_empty(self):
        assert derive_tape_rows([]) == []


def _fake_report(**over):
    strikes = [
        {"strike": 25000.0,
         "ce": {"oi": 1000, "volume": 5000},
         "pe": {"oi": 2000, "volume": 6000}},
        {"strike": 25100.0,
         "ce": {"oi": 200, "volume": 200},
         "pe": {"oi": 300, "volume": 300}},
    ]
    rep = {
        "expiry": "2026-10-15", "spot": 25000.0,
        "pcr_oi": 1.92, "pcr_vol": 1.21, "max_pain": 25000.0,
        "walls": {"calls": [{"strike": 25000.0, "oi": 1000}],
                  "puts": [{"strike": 25000.0, "oi": 2000}]},
        "gex": {"zero_cross": 25100.0},
        "strikes": strikes,
    }
    rep.update(over)
    return rep


def _ist(h, m):
    return datetime(2026, 10, 13, h, m, 0, tzinfo=config.IST)


class TestRecorder:
    async def test_append_row(self, _tmp_tape):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())) as cl:
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        cl.assert_awaited_once_with(None, walkback_days=0)
        assert row is not None
        assert row["t"] == _ist(9, 15).isoformat()
        assert row["spot"] == 25000.0
        assert (row["ce_oi"], row["pe_oi"]) == (1200, 2300)
        assert (row["ce_vol"], row["pe_vol"]) == (5200, 6300)
        assert (row["pcr_oi"], row["pcr_vol"]) == (1.92, 1.21)
        assert row["max_pain"] == 25000.0
        assert row["flip"] == 25100.0
        assert row["expiry"] == "2026-10-15"
        assert row["walls"]["calls"] == [{"strike": 25000.0, "oi": 1000}]
        assert read_tape("2026-10-13") == [row]

    async def test_skip_duplicate_minute(self, _tmp_tape):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())):
            first = await record_nifty_tape_tick(now=_ist(9, 15))
            dup = await record_nifty_tape_tick(
                now=datetime(2026, 10, 13, 9, 15, 45, tzinfo=config.IST))
            assert first is not None
            assert dup is None  # same IST minute bucket
            nxt = await record_nifty_tape_tick(now=_ist(9, 16))
            assert nxt is not None
        assert len(read_tape("2026-10-13")) == 2

    async def test_compute_failure_returns_none(self, _tmp_tape):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(side_effect=RuntimeError("boom"))):
            assert await record_nifty_tape_tick(now=_ist(9, 15)) is None
        assert read_tape("2026-10-13") == []

    async def test_null_flip_recorded(self, _tmp_tape):
        rep = _fake_report()
        rep["gex"] = {"zero_cross": None}
        with patch.object(nifty, "_compute_live", AsyncMock(return_value=rep)):
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        assert row["flip"] is None


class TestTapeEndpoint:
    def test_404_on_missing_date(self, _tmp_tape):
        with pytest.raises(HTTPException) as exc:
            get_nifty_tape(date="1999-01-01")
        assert exc.value.status_code == 404
        assert exc.value.detail["is_trading_day"] is False
        assert exc.value.detail["date"] == "1999-01-01"

    def test_404_on_empty_file(self, _tmp_tape):
        (nifty.TAPE_DIR / "2026-10-13.jsonl").write_text("\n")
        with pytest.raises(HTTPException) as exc:
            get_nifty_tape(date="2026-10-13")
        assert exc.value.status_code == 404

    def test_bad_date_400(self, _tmp_tape):
        with pytest.raises(HTTPException) as exc:
            get_nifty_tape(date="not-a-date")
        assert exc.value.status_code == 400

    async def test_serves_derived_rows(self, _tmp_tape):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())):
            await record_nifty_tape_tick(now=_ist(9, 15))
            await record_nifty_tape_tick(now=_ist(9, 16))
        out = get_nifty_tape(date="2026-10-13")
        assert out["date"] == "2026-10-13"
        assert out["interval_sec"] == 60
        assert len(out["rows"]) == 2
        # second row is identical chain state -> zero DOI, zero ticks
        r1 = out["rows"][1]
        assert (r1["call_doi"], r1["put_doi"], r1["net"]) == (0, 0, 0)
        assert r1["net_pct"] == 0.0
        assert (r1["call_tick"], r1["put_tick"]) == (0, 0)
        assert r1["spot_flip"] == -100.0

    async def test_baseline_t_is_first_row(self, _tmp_tape):
        # Honest baseline: deltas anchor to the first RECORDED row, which may
        # be well after the open when the recorder booted late.
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())):
            await record_nifty_tape_tick(now=_ist(12, 4))
            await record_nifty_tape_tick(now=_ist(12, 5))
        out = get_nifty_tape(date="2026-10-13")
        assert out["baseline_t"] == _ist(12, 4).isoformat()
        assert out["baseline_t"] == out["rows"][0]["t"]
        assert out["baseline_t"] < out["rows"][-1]["t"]
