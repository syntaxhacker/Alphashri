"""Unit tests for the Nifty OI-burst endpoint (api/reports_api/nifty.py).

The detector/signal live in ``api.reports_api.nifty_bursts`` (pure); these
tests exercise the ``GET /api/reports/nifty/bursts`` handler end-to-end from
the stored tape, with tape + snapshot directories redirected to tmp_path.

Call the endpoint function directly, passing every Query param explicitly
(FastAPI ``Query`` defaults are ``Param`` objects outside HTTP).
"""

import json

import pytest
from fastapi import HTTPException

import api.reports_api.nifty as nifty
from api.reports_api.nifty import get_nifty_bursts

DATE = "2026-10-13"


# ------------------------------------------------------------------- fixtures

@pytest.fixture()
def _tmp_tape(tmp_path, monkeypatch):
    tape_dir = tmp_path / "nifty_tape"
    monkeypatch.setattr(nifty, "TAPE_DIR", tape_dir)
    return tape_dir


@pytest.fixture()
def _tmp_snapshots(tmp_path, monkeypatch):
    snap_dir = tmp_path / "nifty_reports"
    monkeypatch.setattr(nifty, "SNAPSHOT_DIR", snap_dir)
    return snap_dir


# --------------------------------------------------------------------- helpers

def _t(hhmm: str) -> str:
    return f"{DATE}T{hhmm}:00+05:30"


def _row(hhmm, ce_oi, pe_oi, ce_vol=0, pe_vol=0, spot=22500.0):
    return {"t": _t(hhmm), "ce_oi": ce_oi, "pe_oi": pe_oi,
            "ce_vol": ce_vol, "pe_vol": pe_vol, "spot": spot, "pcr_oi": 1.0}


def _write_tape(tape_dir, rows, date=DATE):
    tape_dir.mkdir(parents=True, exist_ok=True)
    with open(tape_dir / f"{date}.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def _spike_rows():
    """Flat call tape, then a +12 000 call-OI jump on the last minute."""
    return [
        _row("09:15", 1000, 5000),
        _row("09:16", 1100, 5000),
        _row("09:17", 1200, 5000),
        _row("09:18", 1300, 5000),
        _row("09:19", 13300, 5000),
    ]


def _snapshot(strikes, spot=22500.0):
    return {"spot": spot, "strikes": strikes}


# ----------------------------------------------------------------------- tests

class TestGetNiftyBursts:
    def test_flat_tape_count_zero(self, _tmp_tape):
        _write_tape(_tmp_tape, [_row(f"09:{15 + i:02d}", 1000, 5000)
                                for i in range(10)])
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 0
        assert out["bursts"] == []
        assert out["interval_sec"] == nifty.TAPE_INTERVAL_SEC
        assert "reason" not in out  # tape existed, just quiet

    def test_spike_yields_exactly_one_burst(self, _tmp_tape):
        _write_tape(_tmp_tape, _spike_rows())
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        assert out["date"] == DATE
        b = out["bursts"][0]
        assert b["id"] == f"{_t('09:19')}-call"
        assert b["side"] == "call"
        assert b["t"] == _t("09:19")
        assert b["delta"] == 12000
        assert b["baseline"] == 1000.0
        assert b["score"] == 12.0
        assert b["severity"] == "critical"  # score 12 >= 8
        assert b["cumDoi"] == 12300
        assert b["spot"] == 22500.0
        assert b["tickVol"] == 0

    def test_spike_below_min_abs_ignored(self, _tmp_tape):
        _write_tape(_tmp_tape, _spike_rows())
        out = get_nifty_bursts(date=DATE, window=3, min_abs=20000)
        assert out["count"] == 0
        assert out["bursts"] == []

    def test_spike_during_warmup_ignored(self, _tmp_tape):
        # The +12 000 jump lands on the first delta minute, before warmup=3.
        rows = [
            _row("09:15", 1000, 5000),
            _row("09:16", 13000, 5000),
            _row("09:17", 13100, 5000),
            _row("09:18", 13200, 5000),
            _row("09:19", 13300, 5000),
        ]
        _write_tape(_tmp_tape, rows)
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 0

    def test_missing_tape_is_200_with_reason(self, _tmp_tape):
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out == {"date": DATE, "count": 0,
                       "interval_sec": nifty.TAPE_INTERVAL_SEC,
                       "bursts": [], "reason": "no tape"}

    def test_default_date_uses_today(self, _tmp_tape):
        out = get_nifty_bursts(date=None, window=3, min_abs=1000)
        assert out["date"] == nifty._today_str()
        assert out["count"] == 0
        assert out["reason"] == "no tape"

    def test_invalid_date_400(self, _tmp_tape):
        with pytest.raises(HTTPException) as exc:
            get_nifty_bursts(date="not-a-date", window=3, min_abs=1000)
        assert exc.value.status_code == 400


class TestBurstSignal:
    def test_signal_attached_from_snapshot(self, _tmp_tape, _tmp_snapshots):
        _write_tape(_tmp_tape, _spike_rows())
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text(json.dumps(_snapshot([
            {"strike": 22500.0, "ce": {"ltp": 80.0}, "pe": {"ltp": 30.0}},
        ])))
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        sig = out["bursts"][0]["signal"]
        assert sig is not None
        # call OI build -> fade with puts
        assert sig["leg"] == "PE"
        assert sig["strike"] == 22500.0
        assert sig["entry"] == 30.0
        assert sig["sl"] == 22.5
        assert sig["target"] == 45.0
        assert sig["lots"] == 8
        assert sig["qty"] == 600
        assert set(sig) == {"leg", "strike", "entry", "sl",
                            "target", "qty", "lots", "basis"}

    def test_signal_null_without_snapshot(self, _tmp_tape, _tmp_snapshots):
        _write_tape(_tmp_tape, _spike_rows())
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        assert out["bursts"][0]["signal"] is None

    def test_signal_null_on_corrupt_snapshot(self, _tmp_tape, _tmp_snapshots):
        _write_tape(_tmp_tape, _spike_rows())
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text("{not valid json")
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        assert out["bursts"][0]["signal"] is None

    def test_signal_null_when_snapshot_lacks_strikes(self, _tmp_tape,
                                                    _tmp_snapshots):
        _write_tape(_tmp_tape, _spike_rows())
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text(
            json.dumps({"spot": 22500.0}))
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        assert out["bursts"][0]["signal"] is None

    def test_flat_tape_has_no_bursts_even_with_snapshot(self, _tmp_tape,
                                                        _tmp_snapshots):
        _write_tape(_tmp_tape, [_row(f"09:{15 + i:02d}", 1000, 5000)
                                for i in range(10)])
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text(json.dumps(_snapshot([
            {"strike": 22500.0, "ce": {"ltp": 80.0}, "pe": {"ltp": 30.0}},
        ])))
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 0
        assert out["bursts"] == []
