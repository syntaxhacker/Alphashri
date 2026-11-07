"""History read endpoints for generic F&O underlyings.

Every test runs against a tmp ``DATA_ROOT`` (monkeypatched), so no real
``experiments/data`` directory — generic *or* NIFTY — is read or written.
Endpoint functions are called directly, so every Query param is passed
explicitly (FastAPI's ``Query`` defaults are ``Param`` objects outside HTTP).
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest
from fastapi import HTTPException

import config
from api.reports_api import options_history as oh
from api.reports_api import options_report as orpt_mod

#: The real ``get_daily_context`` — the ``_offline_analytics`` fixture below
#: stubs it per-test, so tests exercising the genuine daily chain rebind it.
_REAL_GET_DAILY_CONTEXT = orpt_mod.get_daily_context
#: The real ``read_tape`` (file I/O) — rebound by tests that use a real tape file.
_REAL_READ_TAPE = orpt_mod.read_tape

DATE = "2026-10-13"
SYM = "RELIANCE"
BASE = Path(__file__).resolve().parent.parent / "api" / "reports_api" / "options_history.py"


# --------------------------------------------------------------------- fixtures

@pytest.fixture()
def data_root(tmp_path, monkeypatch):
    """Redirect every read to a throwaway data tree."""
    root = tmp_path / "experiments" / "data"
    monkeypatch.setattr(oh, "DATA_ROOT", root)
    oh._SLIM_CACHE.clear()
    yield root
    oh._SLIM_CACHE.clear()


def _write(root: Path, kind: str, date: str, rows, symbol: str = SYM, suffix: str = ".jsonl") -> Path:
    path = root / kind / symbol / f"{date}{suffix}"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as fh:
        if suffix == ".json":
            json.dump(rows, fh)
        else:
            for row in rows:
                fh.write(json.dumps(row) + "\n")
    return path


# ----------------------------------------------------------------------- samples

def _t(hhmm: str, date: str = DATE) -> str:
    return f"{date}T{hhmm}:00+05:30"


def _tape_row(hhmm, ce_oi, pe_oi, ce_vol=0, pe_vol=0, spot=2900.0):
    return {"t": _t(hhmm), "spot": spot, "ce_oi": ce_oi, "pe_oi": pe_oi,
            "ce_vol": ce_vol, "pe_vol": pe_vol, "pcr_oi": 1.2,
            "pcr_vol": 1.1, "max_pain": 2900.0, "flip": 2895.0,
            "walls": {"calls": [{"strike": 3000.0, "oi": 5000}],
                      "puts": [{"strike": 2800.0, "oi": 6000}]},
            "expiry": "2026-10-29", "atm_strike": 2900.0,
            "atom_placeholder": None}


def _flat_tape(date: str = DATE):
    return [{"t": _t(f"09:{15 + i:02d}", date=date), "spot": 2900.0,
             "ce_oi": 1000, "pe_oi": 5000, "ce_vol": 0, "pe_vol": 0,
             "pcr_oi": 1.2} for i in range(4)]


def _spike_tape():
    """Flat call tape, then a +12 000 call-OI jump on the last minute."""
    return [
        _tape_row("09:15", 1000, 5000, ce_vol=100, pe_vol=200),
        _tape_row("09:16", 1100, 5000, ce_vol=110, pe_vol=210),
        _tape_row("09:17", 1200, 5000, ce_vol=120, pe_vol=220),
        _tape_row("09:18", 1300, 5000, ce_vol=130, pe_vol=230),
        _tape_row("09:19", 13300, 5000, ce_vol=140, pe_vol=240),
    ]


def _report(spot=2900.0):
    return {
        "mode": "live",
        "underlying": SYM,
        "date": DATE,
        "expiry": "2026-10-29",
        "spot": spot,
        "pcr_oi": 1.2,
        "max_pain": 2900.0,
        "walls": {"calls": [{"strike": 3000.0, "oi": 5000, "distance": 100.0}],
                  "puts": [{"strike": 2800.0, "oi": 6000, "distance": -100.0}]},
        "walls_near": {"calls": [{"strike": 2950.0, "oi": 4000}],
                       "puts": [{"strike": 2850.0, "oi": 4500}]},
        "strikes": [
            {"strike": 2900.0, "ce": {"ltp": 40.0, "oi": 1000},
             "pe": {"ltp": 35.0, "oi": 1200}},
            {"strike": 2950.0, "ce": {"ltp": 20.0, "oi": 800},
             "pe": {"ltp": 55.0, "oi": 900}},
        ],
    }


def _snapshot_frame(hhmm, spot=2900.0, with_emas=False):
    report = _report(spot)
    if with_emas:
        report = {**report, "emas": {"5": 1, "20": 2}}
    return {"t": _t(hhmm), "fetched_at": _t(hhmm), "report": report, "sensex": None}


def _chain10s_row(hhmm, ce_oi=1000.0, pe_oi=1200.0, ce_vol=10.0, pe_vol=12.0, spot=2900.0):
    return {
        "t": _t(hhmm), "spot": spot, "expiry": "2026-10-29",
        "rows": [
            [2900.0, 40.0, ce_oi, ce_vol, 35.0, pe_oi, pe_vol],
            [2950.0, 20.0, 800.0, 5.0, 55.0, 900.0, 6.0],
        ],
    }


@pytest.fixture(autouse=True)
def _offline_analytics(monkeypatch):
    """Keep read-time enrichment offline: no daily/VIX network, ever.

    ``get_daily_context`` and ``get_vix_block`` are the only two network legs
    inside ``options_report._attach_analytics``; stubbing them makes every
    ``replay?t=`` / ``snapshot`` enrichment in this module pure. Tests that
    need richer analytics override these with their own monkeypatches.
    """
    from api.reports_api import nifty_verdicts as nv
    from api.reports_api import options_report as orpt

    async def _no_daily(symbol, today):
        return {"rows": [], "pivots": None, "baseline_pct": None}

    async def _fake_vix():
        return {"ltp": 12.5, "prev_close": 12.0, "change_pct": 4.17,
                "day_high": 12.8, "day_low": 11.9}

    monkeypatch.setattr(orpt, "get_daily_context", _no_daily)
    monkeypatch.setattr(nv, "get_vix_block", _fake_vix)


# ------------------------------------------------------------------ 1. tape

class TestTape:
    def test_derives_same_formulas_as_nifty(self, data_root):
        _write(data_root, oh.TAPE_DIR, DATE, _spike_tape())
        out = oh.get_options_tape(SYM, date=DATE)
        assert out["date"] == DATE
        assert out["interval_sec"] == 60
        assert out["baseline_t"] == _t("09:15")
        rows = out["rows"]
        assert len(rows) == 5
        # deltas are vs the day's first row
        assert (rows[0]["call_doi"], rows[0]["put_doi"]) == (0, 0)
        assert (rows[-1]["call_doi"], rows[-1]["put_doi"]) == (12300, 0)
        assert rows[-1]["net"] == -12300
        assert rows[-1]["call_tick"] == 10      # cumulative volume diff
        assert rows[-1]["pcr_doi"] == 0.0
        assert rows[-1]["spot_flip"] == 5.0     # 2900 - 2895

    def test_missing_tape_is_404_envelope(self, data_root):
        with pytest.raises(HTTPException) as exc:
            oh.get_options_tape(SYM, date=DATE)
        assert exc.value.status_code == 404
        assert exc.value.detail == {
            "is_trading_day": False,
            "date": DATE,
            "message": f"no {SYM} tape for {DATE}",
        }

    def test_symbol_is_upper_cased(self, data_root):
        _write(data_root, oh.TAPE_DIR, DATE, _flat_tape())
        assert oh.get_options_tape("reliance", date=DATE)["date"] == DATE

    def test_bad_date_400(self, data_root):
        with pytest.raises(HTTPException) as exc:
            oh.get_options_tape(SYM, date="13-10-2026")
        assert exc.value.status_code == 400

    def test_path_traversal_symbol_400(self, data_root):
        for bad in ("../../etc/passwd", "A/B", "", "RELIANCE;rm"):
            with pytest.raises(HTTPException) as exc:
                oh.get_options_tape(bad, date=DATE)
            assert exc.value.status_code == 400

    def test_default_date_is_ist_today(self, data_root):
        today = datetime.now(config.IST).strftime("%Y-%m-%d")
        _write(data_root, oh.TAPE_DIR, today, _flat_tape(today))
        assert oh.get_options_tape(SYM, date=None)["date"] == today


# ------------------------------------------------------------- 2. chain10s

class TestChain10s:
    def test_tail_read_skips_partial_first_line(self, data_root):
        path = _write(data_root, oh.CHAIN10S_DIR, DATE,
                      [_chain10s_row(f"13:3{i}:00") for i in range(4)])
        # Force a tail read that starts mid-record: the partial line is dropped,
        # every complete row survives.
        rows = oh._read_jsonl_tail(path, max_bytes=200)
        assert rows, "tail read returned nothing"
        assert all(isinstance(r.get("t"), str) for r in rows)
        assert rows[-1]["t"] == _t("13:33:00")

    def test_windows_and_limits_newest(self, data_root):
        rows = [_chain10s_row(f"13:3{i}:00") for i in range(4)]
        _write(data_root, oh.CHAIN10S_DIR, DATE, rows)
        out = oh.get_options_chain10s(SYM, date=DATE, start="13:31", end="13:32", limit=10, summary=False)
        assert out["count"] == 2
        assert [r["t"][11:16] for r in out["snapshots"]] == ["13:31", "13:32"]
        out = oh.get_options_chain10s(SYM, date=DATE, start=None, end=None, limit=2, summary=False)
        assert out["count"] == 4
        assert [r["t"][11:16] for r in out["snapshots"]] == ["13:32", "13:33"]

    def test_summary_aggregates_both_legs(self, data_root):
        _write(data_root, oh.CHAIN10S_DIR, DATE,
               [_chain10s_row(f"13:3{i}:00") for i in range(3)])
        out = oh.get_options_chain10s(SYM, date=DATE, start=None, end=None, limit=240, summary=True)
        assert out["date"] == DATE
        assert out["count"] == 3
        assert "snapshots" not in out
        summary = out["summary"]
        assert len(summary) == 3
        first = summary[0]
        assert first["ce_oi"] == 1800            # 1000 + 800
        assert first["pe_oi"] == 2100            # 1200 + 900
        assert first["ce_vol"] == 15             # 10 + 5
        assert first["pe_vol"] == 18             # 12 + 6
        assert first["atm_strike"] == 2900       # nearest 50 to newest spot
        assert first["ce_prem"] == 40
        assert first["pe_prem"] == 35

    def test_missing_day_is_empty_200(self, data_root):
        out = oh.get_options_chain10s(SYM, date=DATE, start=None, end=None, limit=240, summary=False)
        assert out == {"date": DATE, "count": 0, "snapshots": []}


# --------------------------------------------------------------- 3. bursts

class TestBursts:
    def test_spike_yields_one_signal_bearing_burst(self, data_root, monkeypatch):
        monkeypatch.setattr(oh, "_resolve_lot_size", lambda *a: (65, False))
        _write(data_root, oh.TAPE_DIR, DATE, _spike_tape())
        _write(data_root, oh.SNAPSHOTS_DIR, DATE, _report(), suffix=".json")
        out = oh.get_options_bursts(SYM, date=DATE, window=3, min_abs=1000)
        assert out["date"] == DATE
        assert out["interval_sec"] == 60
        assert out["count"] == 1
        burst = out["bursts"][0]
        assert burst["side"] == "call"
        assert burst["t"] == _t("09:19")
        assert burst["delta"] == 12000
        # no NIFTY headline feed for a generic underlying
        assert burst["news"] == []
        assert burst["fuel_state"] is None          # no atm premium on the tape
        # snapshot present → a mechanical plan and structure levels are attached.
        # A call-OI BUILD is a writer's ceiling, so the fade plan is the put leg.
        assert burst["signal"] is not None
        assert burst["signal"]["leg"] == "PE"
        assert burst["signal"]["strike"] == 2900
        assert burst["signal"]["lot_size"] == 65
        assert burst["signal"]["lot_size_verified"] is False
        assert "structure" in burst

    def test_plan_is_resized_onto_the_real_contract_lot(self, data_root, monkeypatch):
        monkeypatch.setattr(oh, "_resolve_lot_size", lambda *a: (500, True))
        _write(data_root, oh.TAPE_DIR, DATE, _spike_tape())
        _write(data_root, oh.SNAPSHOTS_DIR, DATE, _report(), suffix=".json")
        signal = oh.get_options_bursts(SYM, date=DATE, window=3, min_abs=1000)["bursts"][0]["signal"]
        assert signal["lot_size"] == 500
        assert signal["lot_size_verified"] is True
        assert signal["qty"] == signal["lots"] * 500
        assert signal["qty"] % 500 == 0

    def test_snapshot_lot_size_wins(self, data_root):
        report = {**_report(), "lot_size": 250}
        _write(data_root, oh.SNAPSHOTS_DIR, DATE, report, suffix=".json")
        assert oh._resolve_lot_size(SYM, report, report["strikes"]) == (250, True)

    def test_unresolvable_lot_falls_back_unverified(self, data_root, monkeypatch):
        import api.reports_api.options_recorder as recorder

        monkeypatch.setattr(recorder, "lot_size", lambda *a: 1)
        assert oh._resolve_lot_size("ZZUNKNOWN", {}, None) == (oh.NIFTY_LOT_SIZE, False)

    def test_missing_tape_is_empty_200(self, data_root):
        out = oh.get_options_bursts(SYM, date=DATE, window=3, min_abs=1000)
        assert out == {"date": DATE, "count": 0, "interval_sec": 60,
                       "bursts": [], "reason": "no tape"}

    def test_quiet_tape_count_zero_no_reason(self, data_root):
        _write(data_root, oh.TAPE_DIR, DATE, _flat_tape())
        out = oh.get_options_bursts(SYM, date=DATE, window=3, min_abs=1000)
        assert out["count"] == 0
        assert out["bursts"] == []
        assert "reason" not in out

    def test_bad_date_400(self, data_root):
        with pytest.raises(HTTPException) as exc:
            oh.get_options_bursts(SYM, date="nope", window=3, min_abs=1000)
        assert exc.value.status_code == 400


# --------------------------------------------------------------- 4. blasts

class TestBlasts:
    def _rows(self):
        # flat 40 s, then a +1.1M CE OI jump on the last 10 s snapshot
        rows = [_chain10s_row(f"13:30:{i * 10:02d}", ce_oi=100000.0) for i in range(4)]
        rows.append(_chain10s_row("13:30:40", ce_oi=1200000.0))
        return rows

    def test_oi_blast_is_adaptive_and_never_spot(self, data_root):
        _write(data_root, oh.CHAIN10S_DIR, DATE, self._rows())
        out = oh.get_options_blasts(SYM, date=DATE, lookback_min=5, limit=40)
        assert out["date"] == DATE
        assert out["lookback_min"] == 5
        kinds = {b["kind"] for b in out["blasts"]}
        assert kinds == {"oi"}          # volumes were flat; spot is never faked
        blast = out["blasts"][0]
        assert blast["t"] == _t("13:30:40")
        assert blast["side"] == "CE"
        assert blast["delta"] == 1.1     # millions
        assert blast["bias"] == "neutral"   # OI alone cannot tell buyer/writer
        assert blast["severity"] == "critical"
        assert "gate" in blast["detail"]
        assert out["count"] == len(out["blasts"]) == 1

    def test_flat_chain_has_no_blasts(self, data_root):
        _write(data_root, oh.CHAIN10S_DIR, DATE,
               [_chain10s_row(f"13:30:{i * 10:02d}") for i in range(5)])
        out = oh.get_options_blasts(SYM, date=DATE, lookback_min=5, limit=40)
        assert out["blasts"] == []
        assert out["count"] == 0

    def test_missing_day_is_empty_200(self, data_root):
        out = oh.get_options_blasts(SYM, date=DATE, lookback_min=5, limit=40)
        assert out == {"date": DATE, "count": 0, "lookback_min": 5, "blasts": []}


# -------------------------------------------------------- 5/6. replay dates+frames

class TestReplayDates:
    def test_newest_first_skips_empty_and_junk(self, data_root):
        for day in ("2026-10-09", "2026-10-10", "2026-10-13"):
            _write(data_root, oh.SNAPSHOTS_DIR, day, [_snapshot_frame("09:15")])
        _write(data_root, oh.SNAPSHOTS_DIR, "2026-10-12", [])          # empty → skip
        _write(data_root, oh.SNAPSHOTS_DIR, "not-a-date", [{"t": "x"}])  # junk → skip
        out = oh.get_options_replay_dates(SYM, limit=15)
        assert out == {"dates": ["2026-10-13", "2026-10-10", "2026-10-09"],
                       "latest": "2026-10-13"}

    def test_limit_and_empty(self, data_root):
        for day in ("2026-10-09", "2026-10-10"):
            _write(data_root, oh.SNAPSHOTS_DIR, day, [_snapshot_frame("09:15")])
        assert oh.get_options_replay_dates(SYM, limit=1) == {
            "dates": ["2026-10-10"], "latest": "2026-10-10"}
        assert oh.get_options_replay_dates("SENSEX", limit=15) == {"dates": [], "latest": None}


class TestReplay:
    async def test_meta_returns_only_frames(self, data_root):
        _write(data_root, oh.SNAPSHOTS_DIR, DATE,
               [_snapshot_frame("09:15"), _snapshot_frame("09:16", spot=2905.0),
                _snapshot_frame("09:17", spot=2910.0)])
        out = await oh.get_options_replay(SYM, date=DATE, t=None, meta=True)
        assert out == {
            "date": DATE, "count": 3, "interval_sec": 60,
            "frames": [
                {"t": _t("09:15"), "spot": 2900.0},
                {"t": _t("09:16"), "spot": 2905.0},
                {"t": _t("09:17"), "spot": 2910.0},
            ],
        }

    async def test_meta_accepts_int_one(self, data_root):
        _write(data_root, oh.SNAPSHOTS_DIR, DATE, [_snapshot_frame("09:15")])
        out = await oh.get_options_replay(SYM, date=DATE, t=None, meta=1)
        assert out["count"] == 1 and out["frames"][0]["spot"] == 2900.0

    async def test_t_returns_last_frame_at_or_before(self, data_root):
        _write(data_root, oh.SNAPSHOTS_DIR, DATE,
               [_snapshot_frame("09:15"), _snapshot_frame("09:16"), _snapshot_frame("09:17")])
        out = await oh.get_options_replay(SYM, date=DATE, t="2026-10-13 09:16:30", meta=False)
        assert out["date"] == DATE
        assert out["snapshot"]["t"] == _t("09:16")
        # before the first frame → explicit null, not an error
        out = await oh.get_options_replay(SYM, date=DATE, t="2026-10-13T09:00:00+05:30", meta=False)
        assert out == {"date": DATE, "snapshot": None}

    async def test_full_day_projects_frames_and_dedupes_minutes(self, data_root):
        rows = [
            _snapshot_frame("09:15", with_emas=True),
            _snapshot_frame("09:16"),
            _snapshot_frame("09:16"),          # duplicate minute → dropped
            _snapshot_frame("09:17"),
        ]
        _write(data_root, oh.SNAPSHOTS_DIR, DATE, rows)
        out = await oh.get_options_replay(SYM, date=DATE, t=None, meta=False)
        assert out["date"] == DATE
        assert out["count"] == 3
        assert out["interval_sec"] == 60
        assert [s["t"][11:16] for s in out["snapshots"]] == ["09:15", "09:16", "09:17"]
        # projection drops the derived emas block, keeps the stored chain
        assert "emas" not in out["snapshots"][0]["report"]
        assert out["snapshots"][0]["report"]["strikes"]
        assert out["snapshots"][0]["report"]["spot"] == 2900.0
        assert out["snapshots"][0]["sensex"] is None

    async def test_missing_log_is_404_envelope(self, data_root):
        with pytest.raises(HTTPException) as exc:
            await oh.get_options_replay(SYM, date=DATE, t=None, meta=False)
        assert exc.value.status_code == 404
        assert exc.value.detail["is_trading_day"] is False
        assert exc.value.detail["date"] == DATE


# ------------------------------------------------------------- 7. snapshot

class TestSnapshot:
    async def test_returns_stored_report(self, data_root):
        _write(data_root, oh.SNAPSHOTS_DIR, DATE, _report(), suffix=".json")
        out = await oh.get_options_snapshot(SYM, date=DATE)
        assert out["underlying"] == SYM
        assert out["spot"] == 2900.0
        assert out["max_pain"] == 2900.0

    async def test_unwraps_report_envelope(self, data_root):
        _write(data_root, oh.SNAPSHOTS_DIR, DATE,
               {"t": _t("15:29"), "report": _report(), "sensex": None}, suffix=".json")
        assert (await oh.get_options_snapshot(SYM, date=DATE))["spot"] == 2900.0

    async def test_missing_is_404_envelope(self, data_root):
        with pytest.raises(HTTPException) as exc:
            await oh.get_options_snapshot(SYM, date=DATE)
        assert exc.value.status_code == 404
        assert exc.value.detail == {
            "is_trading_day": False, "date": DATE,
            "message": f"no {SYM} snapshot for {DATE}"}

    async def test_corrupt_json_is_404_not_500(self, data_root):
        path = data_root / oh.SNAPSHOTS_DIR / SYM / f"{DATE}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json")
        with pytest.raises(HTTPException) as exc:
            await oh.get_options_snapshot(SYM, date=DATE)
        assert exc.value.status_code == 404


# --------------------------------------------------------------- 8. status

class TestStatus:
    def test_delegates_to_recorder(self, data_root, monkeypatch):
        monkeypatch.setattr(oh, "_recorder_status", lambda: {"last_tick": "x", "interval_sec": 60})
        assert oh.get_options_tape_status(SYM) == {"last_tick": "x", "interval_sec": 60}

    def test_fallback_reads_last_tape_row(self, data_root, monkeypatch):
        monkeypatch.setattr(oh, "_recorder_status", lambda: None)
        today = datetime.now(config.IST).strftime("%Y-%m-%d")
        _write(data_root, oh.TAPE_DIR, today, _flat_tape(today))
        out = oh.get_options_tape_status(SYM)
        assert out["source"] == "tape-fallback"
        assert out["date"] == today
        assert out["rows"] == 4
        assert out["last_tick"] == _t("09:18", date=today)

    def test_fallback_without_tape_is_honest_none(self, data_root, monkeypatch):
        monkeypatch.setattr(oh, "_recorder_status", lambda: None)
        out = oh.get_options_tape_status("SENSEX")
        assert out["last_tick"] is None
        assert out["rows"] == 0


# ------------------------------------------------ NIFTY isolation guarantees

class TestNoNiftyPaths:
    async def test_nifty_directories_are_never_read(self, data_root):
        """Poison every NIFTY directory; the generic reader must ignore them."""
        _write(data_root, "nifty_tape", DATE, _spike_tape())
        _write(data_root, "nifty_snapshots", DATE, [_snapshot_frame("09:15")])
        _write(data_root, "nifty_chain10s", DATE, [_chain10s_row("13:30:00")])
        _write(data_root, "nifty_reports", DATE, _report(), suffix=".json")

        with pytest.raises(HTTPException) as exc:
            oh.get_options_tape(SYM, date=DATE)
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            await oh.get_options_replay(SYM, date=DATE, t=None, meta=False)
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            await oh.get_options_snapshot(SYM, date=DATE)
        assert exc.value.status_code == 404

        assert oh.get_options_chain10s(SYM, date=DATE, start=None, end=None,
                                       limit=240, summary=False)["snapshots"] == []
        assert oh.get_options_bursts(SYM, date=DATE, window=3, min_abs=1000)["count"] == 0
        assert oh.get_options_blasts(SYM, date=DATE, lookback_min=5, limit=40)["blasts"] == []
        assert oh.get_options_replay_dates(SYM, limit=15)["dates"] == []

    def test_module_references_only_generic_dirs(self):
        source = BASE.read_text()
        for nifty_dir in ("nifty_tape", "nifty_snapshots", "nifty_chain10s",
                          "nifty_reports", "nifty_ticks"):
            assert nifty_dir not in source, nifty_dir
        assert {oh.CHAIN10S_DIR, oh.TAPE_DIR, oh.SNAPSHOTS_DIR} == {
            "options_chain10s", "options_tape", "options_snapshots"}

    def test_every_path_stays_inside_data_root(self, data_root):
        for kind in (oh.CHAIN10S_DIR, oh.TAPE_DIR, oh.SNAPSHOTS_DIR):
            path = oh._path(kind, SYM, DATE)
            assert data_root in path.parents
            assert path.parts[-3:-1] == (kind, SYM)


# --------------------------------------- legacy enrichment (EOD analytics)
def _legacy_bars(n: int = 16, base: float = 2900.0):
    """Rising 1-minute bars with real timestamps (RSI/RV need 15+ closes)."""
    bars = []
    for i in range(n):
        close = base + i
        bars.append({
            "time": f"{DATE}T09:{15 + i:02d}:00+05:30",
            "open": round(close - 0.5, 2),
            "high": round(close + 0.5, 2),
            "low": round(close - 1.0, 2),
            "close": round(close, 2),
            "volume": 100 + i,
        })
    return bars


def _legacy_report(symbol: str = SYM, spot: float = 2900.0):
    """A recorder frame as written BEFORE analytics: chain-derived blocks
    (strikes/gex/positioning/intraday/ohlc) present, session analytics absent."""
    bars = _legacy_bars()
    return {
        "mode": "live",
        "underlying": symbol,
        "date": DATE,
        "expiry": "2026-10-29",
        "spot": spot,
        "pcr_oi": 1.2,
        "pcr_vol": 1.1,
        "max_pain": 2900.0,
        "walls": {"calls": [{"strike": 3000.0, "oi": 5000}],
                  "puts": [{"strike": 2800.0, "oi": 6000}]},
        "walls_near": {"calls": [{"strike": 2950.0, "oi": 4000}],
                       "puts": [{"strike": 2850.0, "oi": 4500}]},
        "strikes": [
            {"strike": 2900.0,
             "ce": {"ltp": 40.0, "oi": 1000, "prev_oi": 900,
                    "volume": 50, "iv": 12.5},
             "pe": {"ltp": 35.0, "oi": 1200, "prev_oi": 1100,
                    "volume": 60, "iv": 12.5}},
            {"strike": 2950.0,
             "ce": {"ltp": 20.0, "oi": 800, "prev_oi": 750,
                    "volume": 40, "iv": 12.0},
             "pe": {"ltp": 55.0, "oi": 900, "prev_oi": 850,
                    "volume": 45, "iv": 13.0}},
        ],
        "gex": {"net_total": 100.0, "regime": "flat", "strikes": []},
        "positioning": {"verdict": "balanced", "initiated": 0.0,
                        "lot_size": 500},
        "lot_size": 500,
        "intraday": bars,
        "ohlc": {"open": bars[0]["open"], "high": bars[-1]["high"],
                 "low": bars[0]["low"], "close": bars[-1]["close"]},
        "fetched_at": _t("09:30"),
    }


def _legacy_tape():
    """Tape rows pinning the 2900 strike (what compute_reference needs)."""
    return [
        {"t": _t("09:15"), "spot": 2900.0, "atm_strike": 2900.0,
         "atm_ce_ltp": 38.0, "atm_pe_ltp": 33.0},
        {"t": _t("09:16"), "spot": 2901.0, "atm_strike": 2900.0,
         "atm_ce_ltp": 39.0, "atm_pe_ltp": 34.0},
    ]


@pytest.fixture()
def enriched_deps(monkeypatch):
    """Deterministic offline legs for _attach_analytics: pivots + tape."""
    from api.reports_api import options_report as orpt

    async def _daily(symbol, today):
        return {"rows": [],
                "pivots": {"pp": 2895.0, "prev": {"close": 2890.0}},
                "baseline_pct": 1.5}

    monkeypatch.setattr(orpt, "get_daily_context", _daily)
    monkeypatch.setattr(orpt, "read_tape", lambda symbol, date: _legacy_tape())


def _assert_enriched(report):
    """Field-by-field: the EOD panel must have no ``—`` left."""
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
    assert report["pivots"]["pp"] == 2895.0
    assert report["reference"]["strike"] == 2900.0
    assert report["reference"]["ce_ltp"] == 40.0
    assert report["reference"]["pe_ltp"] == 35.0
    assert report["ohlc"] == {"open": 2899.5, "high": 2915.5,
                              "low": 2899.0, "close": 2915.0}
    assert set(report["market"]) == {"is_open", "session_date", "as_of"}
    assert isinstance(report["timeline"], list)
    assert isinstance(report["structure"], list)  # may be []
    assert report["gex"]["regime"] == "flat"
    assert report["positioning"]["verdict"] == "balanced"
    assert report["max_pain"] == 2900.0
    assert report["pcr_oi"] == 1.2


def _v2_days(end="2026-10-12", n=25):
    """Business-day ``YYYY-MM-DD`` strings ending at ``end`` (oldest first)."""
    import pandas as pd

    return [d.strftime("%Y-%m-%d")
            for d in pd.date_range(end=end, periods=n, freq="B")]


def _v2_payload(rows):
    """``[(date, o, h, l, c)]`` -> v2 ``data.candles`` payload, newest-first."""
    candles = [[f"{d}T00:00:00+05:30", o, h, lo, c, 1000, 0]
               for d, o, h, lo, c in rows]
    return {"status": "success", "data": {"candles": candles[::-1]}}


def _symbol_from_endpoint(endpoint: str) -> str:
    """Which symbol a direct daily URL was built for (via its instrument key).

    Matches on the resolved (URL-quoted) key rather than the symbol text —
    stock keys are ISIN-based (``NSE_EQ|INE002A01018``) and carry no symbol.
    """
    import urllib.parse

    from api.reports_api import options_report as orpt

    for symbol in ("SENSEX", "RELIANCE"):
        key = orpt._resolve_daily_key(symbol)
        if key and urllib.parse.quote(key, safe="") in str(endpoint):
            return symbol
    raise AssertionError(f"no known instrument key in {endpoint!r}")


class TestDailyRetry:
    """The daily leg is flaky (single blips observed); enrichment retries it."""

    PREV = {"SENSEX": (73525.44, 72603.57, 73246.03)}

    def _payload(self):
        days = _v2_days()
        rows = []
        for i, day in enumerate(days):
            if i == len(days) - 1:
                o, h, lo, c = 73241.03, 73525.44, 72603.57, 73246.03
            else:
                o, h, lo, c = 73000 + i, 73600 - i, 72600 + i, 73100 + i
            rows.append((day, o, h, lo, c))
        return _v2_payload(rows)

    async def test_transient_empty_daily_still_yields_pivots(self, monkeypatch):
        import api.options as api_options
        from api.reports_api import options_report as orpt

        monkeypatch.setattr(orpt, "get_daily_context", _REAL_GET_DAILY_CONTEXT)
        monkeypatch.setattr(orpt, "DAILY_FETCH_RETRY_SLEEP_SEC", 0)
        calls = {"n": 0}
        payload = self._payload()

        async def flaky(endpoint, params=None):
            calls["n"] += 1
            if calls["n"] == 1:
                return None
            return payload

        monkeypatch.setattr(api_options, "fetch_upstox", flaky)
        orpt.clear_cache()
        ctx = await orpt.get_daily_context("SENSEX", "2026-10-13")
        assert ctx["pivots"] is not None
        assert ctx["pivots"]["pp"] == pytest.approx(73125.01)
        assert calls["n"] == 2

    async def test_persistent_empty_daily_caches_a_miss(self, monkeypatch):
        import api.options as api_options
        from api.reports_api import options_report as orpt

        monkeypatch.setattr(orpt, "get_daily_context", _REAL_GET_DAILY_CONTEXT)
        monkeypatch.setattr(orpt, "DAILY_FETCH_RETRY_SLEEP_SEC", 0)
        calls = {"n": 0}

        async def empty(endpoint, params=None):
            calls["n"] += 1
            return None

        monkeypatch.setattr(api_options, "fetch_upstox", empty)
        orpt.clear_cache()
        ctx = await orpt.get_daily_context("SENSEX", "2026-10-13")
        assert ctx["pivots"] is None
        assert calls["n"] == orpt.DAILY_FETCH_ATTEMPTS
        # The miss is cached: no further upstream calls within the TTL.
        ctx2 = await orpt.get_daily_context("SENSEX", "2026-10-13")
        assert ctx2["pivots"] is None
        assert calls["n"] == orpt.DAILY_FETCH_ATTEMPTS


    async def test_retries_are_spaced_and_bounded(self, monkeypatch):
        """Attempts are spaced by DAILY_FETCH_RETRY_SLEEP_SEC and time-boxed."""
        import asyncio

        import api.options as api_options
        from api.reports_api import options_report as orpt

        sleeps: list[float] = []

        async def fake_sleep(seconds):
            sleeps.append(seconds)

        monkeypatch.setattr(asyncio, "sleep", fake_sleep)
        monkeypatch.setattr(
            api_options, "fetch_upstox", lambda *a, **k: None)
        out = await orpt._fetch_daily_rows("SENSEX", "2026-10-13")
        assert out == []
        assert sleeps == [orpt.DAILY_FETCH_RETRY_SLEEP_SEC] * (
            orpt.DAILY_FETCH_ATTEMPTS - 1)

    async def test_hung_fetch_does_not_hang_forever(self, monkeypatch):
        import asyncio

        import api.options as api_options
        from api.reports_api import options_report as orpt

        async def hang(endpoint, params=None):
            await asyncio.sleep(5)
            return None  # pragma: no cover - cancelled by wait_for

        monkeypatch.setattr(api_options, "fetch_upstox", hang)
        monkeypatch.setattr(orpt, "DAILY_FETCH_TIMEOUT_SEC", 0.05)
        monkeypatch.setattr(orpt, "DAILY_FETCH_RETRY_SLEEP_SEC", 0)
        out = await orpt._fetch_daily_rows("SENSEX", "2026-10-13")
        assert out == []

    async def test_unresolvable_symbol_returns_no_rows(self, monkeypatch):
        from api.reports_api import options_report as orpt

        monkeypatch.setattr(orpt, "_resolve_daily_key", lambda symbol: None)
        out = await orpt._fetch_daily_rows("NOPE", "2026-10-13")
        assert out == []

    def test_daily_keys_use_each_symbols_own_instrument(self):
        from api.reports_api import options_report as orpt

        assert orpt._resolve_daily_key("SENSEX") == "BSE_INDEX|SENSEX"
        key = orpt._resolve_daily_key("RELIANCE")
        assert key and key.startswith("NSE_EQ|")
        assert "NIFTY" not in key and "Nifty" not in key


class TestLegacyEnrichmentRealDaily:
    """Read-path enrichment with a NON-mocked ``get_daily_context``.

    Only the Upstox boundary and the market-wide VIX are faked; the daily
    rows -> pivots/baseline chain runs for real for SENSEX and RELIANCE.
    """

    PREV = {"SENSEX": (73525.44, 72603.57, 73246.03),
            "RELIANCE": (1180.0, 1160.0, 1172.9)}
    EXPECTED_PP = {"SENSEX": 73125.01, "RELIANCE": 1170.97}

    @pytest.fixture()
    def real_daily(self, monkeypatch):
        from api.reports_api import options_report as orpt
        from api.reports_api import nifty_verdicts as nv
        import api.options as api_options

        monkeypatch.setattr(orpt, "get_daily_context", _REAL_GET_DAILY_CONTEXT)
        monkeypatch.setattr(orpt, "DAILY_FETCH_RETRY_SLEEP_SEC", 0)

        async def fake_fetch_upstox(endpoint, params=None):
            symbol = _symbol_from_endpoint(endpoint)
            h, lo, c = self.PREV[symbol]
            days = _v2_days(end="2026-10-12")
            rows = []
            for i, day in enumerate(days):
                if i == len(days) - 1:
                    o, hh, ll, cc = c - 5, h, lo, c
                else:
                    o, hh, ll, cc = c - 50 + i, h - i, lo + i, c - 20 + i
                rows.append((day, o, hh, ll, cc))
            return _v2_payload(rows)

        async def fake_vix():
            return {"ltp": 12.5, "prev_close": 12.0, "change_pct": 4.17,
                    "day_high": 12.8, "day_low": 11.9}

        monkeypatch.setattr(api_options, "fetch_upstox", fake_fetch_upstox)
        monkeypatch.setattr(nv, "get_vix_block", fake_vix)
        monkeypatch.setattr(orpt, "read_tape", lambda symbol, date: _legacy_tape())
        orpt.clear_cache()
        nv.clear_caches()

    @pytest.mark.parametrize("symbol", ["SENSEX", "RELIANCE"])
    async def test_replay_t_pivots_from_real_daily(
            self, data_root, real_daily, symbol):
        _write(data_root, oh.SNAPSHOTS_DIR, DATE,
               [{"t": _t("09:30"), "fetched_at": _t("09:30"),
                 "report": _legacy_report(symbol), "sensex": None}],
               symbol=symbol)
        out = await oh.get_options_replay(
            symbol, date=DATE, t=f"{DATE}T09:30:00+05:30", meta=False)
        pivots = out["snapshot"]["report"]["pivots"]
        assert pivots is not None
        assert pivots["pp"] == pytest.approx(self.EXPECTED_PP[symbol])
        assert out["snapshot"]["report"]["baseline_range_pct"] > 0

    @pytest.mark.parametrize("symbol", ["SENSEX", "RELIANCE"])
    async def test_snapshot_pivots_from_real_daily(
            self, data_root, real_daily, symbol):
        _write(data_root, oh.SNAPSHOTS_DIR, DATE, _legacy_report(symbol),
               symbol=symbol, suffix=".json")
        out = await oh.get_options_snapshot(symbol, date=DATE)
        assert out["pivots"]["pp"] == pytest.approx(self.EXPECTED_PP[symbol])

    @pytest.mark.parametrize("symbol", ["SENSEX", "RELIANCE"])
    async def test_attach_analytics_direct_with_frame_date(
            self, tmp_path, monkeypatch, real_daily, symbol):
        """The exact enrichment call with the frame's own date, no endpoint.

        ``_attach_analytics(symbol, report, intraday)`` with
        ``report["date"]`` = the stored frame's date (a past session, as in
        the real ``replay?t=`` / ``snapshot`` read path) and a genuine daily
        frame at the fetch boundary — plus a real tape file on disk, so the
        only fakes left are the Upstox boundary itself and the market-wide VIX.
        """
        from api.reports_api import options_report as orpt

        tape_dir = tmp_path / "options_tape" / symbol
        tape_dir.mkdir(parents=True)
        with open(tape_dir / f"{DATE}.jsonl", "w") as fh:
            for row in _legacy_tape():
                fh.write(json.dumps(row) + "\n")
        monkeypatch.setattr(orpt, "read_tape", _REAL_READ_TAPE)
        monkeypatch.setattr(orpt, "TAPE_ROOT", tmp_path / "options_tape")

        report = _legacy_report(symbol)
        assert report["date"] == DATE  # a past session, like the stored frame
        enriched = await orpt._attach_analytics(symbol, report, report["intraday"])
        assert enriched["pivots"] is not None
        assert enriched["pivots"]["pp"] == pytest.approx(self.EXPECTED_PP[symbol])
        assert enriched["pivots"]["prev"]["date"] < DATE
        assert enriched["reference"]["strike"] == 2900.0
        assert enriched["baseline_range_pct"] > 0


class TestLegacyEnrichment:
    @pytest.mark.parametrize("symbol", ["SENSEX", "RELIANCE"])
    async def test_replay_t_enriches_legacy_frame(
            self, data_root, enriched_deps, symbol):
        report = _legacy_report(symbol)
        assert oh._needs_analytics(report) is True
        _write(data_root, oh.SNAPSHOTS_DIR, DATE,
               [{"t": _t("09:30"), "fetched_at": _t("09:30"),
                 "report": report, "sensex": None}],
               symbol=symbol)
        out = await oh.get_options_replay(
            symbol, date=DATE, t=f"{DATE}T09:30:00+05:30", meta=False)
        _assert_enriched(out["snapshot"]["report"])

    @pytest.mark.parametrize("symbol", ["SENSEX", "RELIANCE"])
    async def test_snapshot_enriches_legacy_report(
            self, data_root, enriched_deps, symbol):
        _write(data_root, oh.SNAPSHOTS_DIR, DATE, _legacy_report(symbol),
               symbol=symbol, suffix=".json")
        out = await oh.get_options_snapshot(symbol, date=DATE)
        _assert_enriched(out)

    async def test_full_day_list_and_meta_stay_as_stored(
            self, data_root, enriched_deps):
        _write(data_root, oh.SNAPSHOTS_DIR, DATE,
               [{"t": _t("09:30"), "fetched_at": _t("09:30"),
                 "report": _legacy_report(), "sensex": None}])
        full = await oh.get_options_replay(SYM, date=DATE, t=None, meta=False)
        assert "vix" not in full["snapshots"][0]["report"]
        meta = await oh.get_options_replay(SYM, date=DATE, t=None, meta=True)
        assert meta["frames"] == [{"t": _t("09:30"), "spot": 2900.0}]

    async def test_already_enriched_frame_is_not_recomputed(
            self, data_root, enriched_deps):
        stored = _legacy_report()
        stored["vix"] = {"ltp": 99.0, "prev_close": 98.0,
                         "change_pct": 1.02, "source": "INDIA_VIX"}
        stored["control"] = {"verdict": "balanced"}
        stored["regime"] = {"verdict": "neutral"}
        stored["strength"] = {"verdict": "neutral", "score": 50}
        assert oh._needs_analytics(stored) is False
        _write(data_root, oh.SNAPSHOTS_DIR, DATE,
               [{"t": _t("09:30"), "fetched_at": _t("09:30"),
                 "report": stored, "sensex": None}])
        out = await oh.get_options_replay(
            SYM, date=DATE, t=f"{DATE}T09:30:00+05:30", meta=False)
        assert out["snapshot"]["report"]["vix"]["ltp"] == 99.0
        snap = dict(stored)
        _write(data_root, oh.SNAPSHOTS_DIR, DATE, snap, suffix=".json")
        assert (await oh.get_options_snapshot(SYM, date=DATE))["vix"]["ltp"] == 99.0
