"""Unit tests for the Nifty OI tape (api/reports_api/nifty.py tape section).

Derivation math is verified against hand-computed values; the recorder is
tested with a mocked ``_compute_live`` and ``TAPE_DIR`` redirected to
tmp_path. Never hits real endpoints.
Call endpoint functions directly, passing every Query param explicitly
(FastAPI Query defaults are Param objects when called outside HTTP).
"""

import asyncio
import copy
import json
from datetime import datetime
from unittest.mock import AsyncMock, call, patch

import pytest
from fastapi import HTTPException

import config
import api.reports_api.nifty as nifty
from api.reports_api.nifty import (
    derive_tape_rows,
    get_nifty_tape,
    read_snapshots,
    read_tape,
    record_nifty_tape_tick,
)


@pytest.fixture()
def _tmp_tape(tmp_path, monkeypatch):
    monkeypatch.setattr(nifty, "TAPE_DIR", tmp_path)
    monkeypatch.setattr(nifty, "SNAPSHOT_LOG_DIR", tmp_path / "snapshots")
    # The recorder also refreshes the day's snapshot file — it must NOT write
    # to the real experiments/data/nifty_reports/ directory from a test.
    monkeypatch.setattr(nifty, "SNAPSHOT_DIR", tmp_path / "day_snapshots")
    # In-minute retries are real (2-3 s) in production; a test must not sleep.
    monkeypatch.setattr(nifty, "TAPE_RETRY_BACKOFF_SEC", (0.0, 0.0))
    # The per-minute snapshot also pulls the Sensex context block; no network
    # in tests — it degrades to `sensex: null` on the snapshot line.
    monkeypatch.setattr(
        nifty, "_compute_sensex_live",
        AsyncMock(side_effect=RuntimeError("no sensex in tests")), raising=False)
    nifty._sensex_cache.clear()
    nifty._GAP_MINUTES.clear()
    nifty._TAPE_INFLIGHT = False
    yield tmp_path
    nifty._sensex_cache.clear()
    nifty._GAP_MINUTES.clear()
    nifty._TAPE_INFLIGHT = False


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
        # The put volume counter went DOWN (6300 -> 6100): a cumulative
        # counter that resets (a new expiry/day) must not publish a negative
        # minute volume, so the tick is floored at zero.
        assert (r2["call_tick"], r2["put_tick"]) == (200, 0)
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
        full = _fake_report(control={"verdict": "Calls control"},
                            positioning={"verdict": "Calls"})
        with patch.object(
                nifty, "_compute_live",
                AsyncMock(return_value=full)) as cl:
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        # ONE pass per minute: the same report feeds the tape row and the
        # replay snapshot (it used to be a light pass + a full pass).
        assert cl.await_count == 1
        assert cl.call_args_list[0] == call(
            None, walkback_days=0, with_verdicts=True, with_candles=True)
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
        assert row["net_gex"] is None  # fake gex has no net_total
        assert row["atm_ce_iv"] is None
        assert row["atm_pe_iv"] is None
        assert read_tape("2026-10-13") == [row]
        # One full snapshot line alongside the light row.
        snaps = read_snapshots("2026-10-13")
        assert len(snaps) == 1
        snap = snaps[0]
        assert snap["t"] == row["t"]
        assert "fetched_at" in snap
        assert snap["sensex"] is None  # fetch failed in tests -> null, not raise
        for key in ("strikes", "gex", "positioning", "control"):
            assert key in snap["report"], f"missing {key}"

    async def test_snapshot_records_sensex_when_available(self, _tmp_tape):
        sensex = {"symbol": "SENSEX", "spot": 81400.0}
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())), \
             patch.object(nifty, "_compute_sensex_live",
                          AsyncMock(return_value=sensex)):
            await record_nifty_tape_tick(now=_ist(9, 15))
        snap = read_snapshots("2026-10-13")[0]
        assert snap["sensex"] == sensex

    async def test_snapshot_sensex_cached_second_tick(self, _tmp_tape):
        """The cached Sensex helper stores its result in the shared cache."""
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())), \
             patch.object(nifty, "_compute_sensex_live",
                          AsyncMock(return_value={"symbol": "SENSEX",
                                                  "spot": 81400.0})):
            await record_nifty_tape_tick(now=_ist(9, 15))
        assert "default" in nifty._sensex_cache

    async def test_row_records_gex_and_atm_iv(self, _tmp_tape):
        rep = _fake_report(gex={"zero_cross": 25100.0, "net_total": -3440.31})
        rep["strikes"] = [
            {"strike": 25000.0,
             "ce": {"oi": 1000, "volume": 5000, "iv": 12.2},
             "pe": {"oi": 2000, "volume": 6000, "iv": 14.1}},
        ]
        with patch.object(nifty, "_compute_live", AsyncMock(return_value=rep)):
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        assert row["net_gex"] == -3440.31
        assert row["atm_ce_iv"] == 12.2
        assert row["atm_pe_iv"] == 14.1

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

    async def test_background_tick_timeout_is_recorded(self, monkeypatch, _tmp_tape):
        async def slow_tick():
            await asyncio.Event().wait()

        async def stop_sleep(_delay):
            raise RuntimeError("stop recorder test")

        monkeypatch.setattr(nifty, "TAPE_TICK_TIMEOUT_SEC", 1)
        with patch.object(nifty, "record_nifty_tape_tick", side_effect=slow_tick), \
                patch("trading.utils.is_derivatives_open", return_value=True), \
                patch.object(asyncio, "sleep", side_effect=stop_sleep):
            with pytest.raises(RuntimeError, match="stop recorder test"):
                await nifty.start_nifty_tape_task(poll_sec=1)

        assert nifty._tape_last_error == "tick timed out after 1s"

    async def test_null_flip_recorded(self, _tmp_tape):
        rep = _fake_report()
        rep["gex"] = {"zero_cross": None}
        with patch.object(nifty, "_compute_live", AsyncMock(return_value=rep)):
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        assert row["flip"] is None

    async def test_snapshot_failure_still_writes_tape_row(self, _tmp_tape):
        """The replay snapshot is best-effort: the tape row survives it."""
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())), \
                patch.object(nifty, "_append_minute_snapshot",
                             AsyncMock(side_effect=RuntimeError("snapshot boom"))):
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        assert row is not None
        assert len(read_tape("2026-10-13")) == 1
        assert read_snapshots("2026-10-13") == []

    async def test_empty_chain_is_not_persisted(self, _tmp_tape):
        """An empty/all-zero-OI chain is a failed fetch, never a data point.

        This is the regression guard for the persisted ``strikes: []`` rows:
        the recorder must skip the tape row AND the snapshot instead of
        writing a ``net_total: 0 / regime: "flat" / max_pain: 0`` frame.
        """
        empty = _fake_report(strikes=[
            {"strike": 25000.0,
             "ce": {"oi": 0, "volume": 0},
             "pe": {"oi": 0, "volume": 0}},
        ], gex={"net_total": 0, "regime": "flat", "zero_cross": None},
            max_pain=0.0)
        with patch.object(nifty, "_compute_live", AsyncMock(return_value=empty)):
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        assert row is None
        assert nifty._tape_last_skip == "empty-chain"
        assert read_tape("2026-10-13") == []
        assert read_snapshots("2026-10-13") == []

    async def test_snapshot_dedupes_same_minute(self, _tmp_tape):
        """A snapshot line already carrying this minute never appends twice."""
        t = _ist(9, 16).isoformat()
        seeded = {"t": t, "fetched_at": t, "report": {}, "sensex": None}
        nifty.SNAPSHOT_LOG_DIR.mkdir(parents=True, exist_ok=True)
        nifty.snapshot_log_path("2026-10-13").write_text(
            json.dumps(seeded) + "\n")
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())) as cl:
            line = await nifty._append_minute_snapshot("2026-10-13", t)
        assert line is None
        assert cl.await_count == 0  # deduped BEFORE the second upstream pass
        content = json.loads(nifty.snapshot_log_path("2026-10-13").read_text())
        assert content["report"] == {}  # the seeded line is kept, untouched

    async def test_snapshot_happy_path_line_shape(self, _tmp_tape):
        full = _fake_report(gex={"zero_cross": 25100.0, "net_total": -3440.31},
                            positioning={"verdict": "Calls"},
                            control={"verdict": "Calls control"},
                            regime={"verdict": "high-vol"},
                            vix={"ltp": 13.2},
                            strength={"score": 2},
                            pivots={"pp": 22897.05},
                            reference={"strike": 25000.0},
                            market={"is_open": True},
                            intraday=[], emas=[])
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=full)):
            line = await nifty._append_minute_snapshot(
                "2026-10-13", "2026-10-13T09:15:00+05:30")
        assert line is not None
        # The line carries the frame's own stamp so a replay consumer can
        # identify it without walking into the report.
        assert set(line) == {"t", "fetched_at", "mode", "snapshot_at",
                             "source", "report", "sensex"}
        assert line["mode"] == "snapshot"
        assert line["source"] == "upstox-option-chain"
        for key in ("strikes", "gex", "positioning", "control", "regime",
                    "vix", "strength", "pivots", "reference", "walls",
                    "intraday", "emas", "market"):
            assert key in line["report"], f"missing {key}"

    async def test_read_snapshots_skips_corrupt_lines(self, _tmp_tape):
        p = nifty.snapshot_log_path("2026-10-13")
        nifty.SNAPSHOT_LOG_DIR.mkdir(parents=True, exist_ok=True)
        good = json.dumps({"t": "2026-10-13T09:15:00+05:30", "report": {}})
        good2 = json.dumps({"t": "2026-10-13T09:16:00+05:30", "report": {}})
        # blank line, plain-JSON-bad text, a bare `null`, and a JSON array are
        # all skipped; JSON-object noise like {"x": 1} is an object but carry
        # it through — corrupt-SHAPE filtering is the caller's concern.
        p.write_text("\n".join([good, "", "{not json", "null", "[1, 2]", good2,
                                "\n"]))
        snaps = read_snapshots("2026-10-13")
        assert len(snaps) == 2
        assert [s["t"] for s in snaps] == ["2026-10-13T09:15:00+05:30",
                                          "2026-10-13T09:16:00+05:30"]
        assert read_snapshots("1999-01-01") == []  # missing file

    async def test_read_snapshots_dedupes_the_same_minute(self, _tmp_tape):
        """Two recorder loops can write the same minute twice — one frame."""
        p = nifty.snapshot_log_path("2026-10-13")
        nifty.SNAPSHOT_LOG_DIR.mkdir(parents=True, exist_ok=True)
        good = json.dumps({"t": "2026-10-13T09:15:00+05:30", "report": {}})
        p.write_text("\n".join([good, good, "\n"]))
        assert len(read_snapshots("2026-10-13")) == 1

    async def test_append_minute_snapshot_refuses_empty_chain(self, _tmp_tape):
        """An empty-all-OI report never reaches the replay log."""
        empty = _fake_report(strikes=[], gex={"net_total": 0, "regime": "flat"},
                             max_pain=0.0)
        assert await nifty._append_minute_snapshot(
            "2026-10-13", "2026-10-13T09:15:00+05:30", empty) is None
        assert read_snapshots("2026-10-13") == []

    async def test_tail_reader_handles_edge_cases(self, _tmp_tape):
        """The tail reader replaces a full-file scan of a growing log."""
        p = _tmp_tape / "tail.jsonl"
        assert nifty._tail_last_json_line(p) is None  # missing
        p.write_text("")
        assert nifty._tail_last_json_line(p) is None  # empty
        p.write_text('{"a": 1}\n{"b": 2}\n')
        assert nifty._tail_last_json_line(p) == {"b": 2}
        # A last line larger than the initial 64 KiB window is still found.
        p.write_text("x" * 200_000 + "\n" + json.dumps({"c": 3}) + "\n")
        assert nifty._tail_last_json_line(p) == {"c": 3}


class TestWriteSnapshot:
    def test_compact_and_atomic_roundtrip(self, tmp_path, monkeypatch):
        monkeypatch.setattr(nifty, "SNAPSHOT_DIR", tmp_path)
        data = {"mode": "snapshot", "strikes": [{"strike": 1.0}], "x": 2}
        path = nifty.write_snapshot("2026-10-12", data)
        assert nifty.read_snapshot("2026-10-12") == data
        # No temp file left behind, and no pretty-printing whitespace.
        assert not (tmp_path / "2026-10-12.json.tmp").exists()
        assert "\n" not in path.read_text()


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
        resp = get_nifty_tape(date="2026-10-13")
        assert resp.media_type == "application/json"
        out = json.loads(resp.body)
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
        resp = get_nifty_tape(date="2026-10-13")
        out = json.loads(resp.body)
        assert out["baseline_t"] == _ist(12, 4).isoformat()
        assert out["baseline_t"] == out["rows"][0]["t"]
        assert out["baseline_t"] < out["rows"][-1]["t"]

    async def test_wire_bytes_match_fastapi_pipeline(self, _tmp_tape):
        """The pre-encoded Response carries exactly what FastAPI would send.

        The tape payload is plain JSON primitives (parsed via json.loads),
        so skipping jsonable_encoder must not change a single byte. The
        reference is the real pipeline: encoder + JSONResponse render.
        """
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse

        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())):
            await record_nifty_tape_tick(now=_ist(9, 15))
            await record_nifty_tape_tick(now=_ist(9, 16))
        rows = derive_tape_rows(read_tape("2026-10-13"))
        # The served rows are chain-trimmed; the pre-encoded body must still be
        # byte-identical to what FastAPI's pipeline would render for them.
        served = nifty._trim_tape_chains(rows)
        expected = JSONResponse(jsonable_encoder({
            "date": "2026-10-13",
            "interval_sec": nifty.TAPE_INTERVAL_SEC,
            "baseline_t": rows[0].get("t") if rows else None,
            "rows": served,
        })).body
        resp = get_nifty_tape(date="2026-10-13")
        assert resp.status_code == 200
        assert resp.media_type == "application/json"
        assert resp.body == expected

    def test_wire_bytes_preserve_unicode_and_floats(self, _tmp_tape):
        """Non-ASCII text and floats survive the fast path byte-identically."""
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse

        (nifty.TAPE_DIR / "2026-10-13.jsonl").write_text(
            json.dumps({
                "t": "2026-10-13T09:15:00+05:30",
                "spot": 25000.125, "ce_oi": 1000, "pe_oi": 2000,
                "ce_vol": 5000, "pe_vol": 6000, "pcr_oi": 2.0,
                "expiry": "2026-10-15-héllo",
                "walls": {"calls": [], "puts": []},
            }) + "\n", encoding="utf-8")
        rows = derive_tape_rows(read_tape("2026-10-13"))
        expected = JSONResponse(jsonable_encoder({
            "date": "2026-10-13",
            "interval_sec": nifty.TAPE_INTERVAL_SEC,
            "baseline_t": rows[0].get("t") if rows else None,
            "rows": rows,
        })).body
        resp = get_nifty_tape(date="2026-10-13")
        assert resp.body == expected
        assert "héllo".encode("utf-8") in resp.body


class TestTapeChainTrim:
    """The served tape carries only the strikes the report UI can read.

    ``GET /nifty/tape`` was 2,294,050 B for 254 rows, 85.7% of it the full
    ~142-strike ``chain`` embedded in every row. The heatmap and the volume
    profile never read outside spot ± 500 pts, so the served rows are trimmed;
    the recorded file keeps every strike (the replay/research scripts read
    arbitrary strikes from it).
    """

    @staticmethod
    def _row(t: str, spot: float, strikes: dict, **extra) -> dict:
        row = {
            "t": t, "spot": spot, "ce_oi": 1_000, "pe_oi": 1_000,
            "ce_vol": 10, "pe_vol": 10, "pcr_oi": 1.0, "pcr_vol": 1.0,
            "max_pain": spot, "flip": None, "expiry": "2026-11-19",
            "walls": {"calls": [], "puts": []}, "strikes_top": [],
            "chain": strikes,
        }
        row.update(extra)
        return row

    @staticmethod
    def _chain(spot: float, step: float = 50.0) -> dict:
        """A recorded-looking 142-strike ladder around ``spot``.

        The real tape carries ~142 strikes spanning far more than the visible
        window (-4,400 / +2,650 pts around a 25,260 spot), which is why the
        full chain dominated the payload.
        """
        low = int((spot - 4_000.0) // step)
        high = int((spot + 3_050.0) // step)
        return {
            str(int(i * step)): [100.0, 120.0, 1_000_000 + i, 900_000 + i,
                                 500_000 + i, 400_000 + i]
            for i in range(low, high + 1)
        }

    def test_trims_to_the_ui_window_and_keeps_the_row_shape(self):
        rows = [self._row("2026-11-16T09:15:00+05:30", 25_000.0,
                          self._chain(25_000.0)),
                self._row("2026-11-16T15:29:00+05:30", 25_100.0,
                          self._chain(25_100.0))]
        out = nifty._trim_tape_chains(nifty.derive_tape_rows(rows))
        for row in out:
            assert isinstance(row["chain"], dict)
            assert row["chain_truncated"] is True
            assert row["chain_center"] == row["spot"]
            assert row["chain_window_pts"] == nifty.TAPE_CHAIN_WINDOW_PTS
            assert len(row["chain"]) <= nifty.TAPE_CHAIN_MAX_STRIKES
            # Every kept key is still a strike the heatmap can address.
            for key in row["chain"]:
                assert isinstance(row["chain"][key], list)
                assert len(row["chain"][key]) == 6
        # The heatmap's rendered universe (last spot ± 500) survives untouched
        # in every row — that is the set of cells it will paint.
        ref = out[-1]["spot"]
        visible = {k for k in rows[-1]["chain"]
                   if abs(float(k) - ref) <= nifty.TAPE_CHAIN_WINDOW_PTS}
        for trimmed in out:
            assert visible <= set(trimmed["chain"])

    def test_the_trim_drops_most_of_the_payload(self):
        """A 254-row day loses ≥70% of its JSON bytes."""
        rows = [
            self._row(f"2026-11-16T{h:02d}:{m:02d}:00+05:30",
                      25_000.0 + (m % 7) * 5.0, self._chain(25_000.0 + (m % 7) * 5.0))
            for h in (9, 10, 11, 12, 13, 14) for m in range(0, 60)
        ][:254]
        derived = nifty.derive_tape_rows(rows)
        before = len(json.dumps({"rows": derived}, separators=(",", ":")).encode())
        after = len(json.dumps({"rows": nifty._trim_tape_chains(derived)},
                               separators=(",", ":")).encode())
        assert after / before <= 0.30, f"{after} B of {before} B"
        for row in nifty._trim_tape_chains(derived):
            assert len(row["chain"]) <= nifty.TAPE_CHAIN_MAX_STRIKES

    def test_wall_max_pain_and_atm_strikes_survive_outside_the_window(self):
        """A named level far from spot is still named in the payload."""
        spot = 25_000.0
        far_call, far_put = 27_000.0, 23_000.0     # 2,000 pts out — well outside ±500
        chain = self._chain(spot)
        chain[str(int(far_call))] = [1.0, 1.0, 7_000_000, 1, 1, 1]
        chain[str(int(far_put))] = [1.0, 1.0, 1, 8_000_000, 1, 1]
        row = self._row(
            "2026-11-16T10:00:00+05:30", spot, chain,
            call_wall=far_call, put_wall=far_put,
            walls={"calls": [{"strike": 26_500.0, "oi": 1}],
                   "puts": [{"strike": 23_500.0, "oi": 1}]},
            strikes_top=[{"strike": 26_000.0, "ce_oi": 1, "pe_oi": 1}],
        )
        out = nifty._trim_tape_chains([row])[0]
        for strike in (far_call, far_put, 26_500.0, 23_500.0, 26_000.0):
            assert str(int(strike)) in out["chain"]

    def test_a_row_whose_spot_ran_away_keeps_its_own_band(self):
        """A row is trimmed against ITS spot as well as the closing spot."""
        morning_spot, close_spot = 24_500.0, 25_500.0
        rows = [
            self._row("2026-11-16T09:15:00+05:30", morning_spot,
                      self._chain(morning_spot)),
            self._row("2026-11-16T15:29:00+05:30", close_spot,
                      self._chain(close_spot)),
        ]
        out = nifty._trim_tape_chains(rows)
        band = nifty.TAPE_CHAIN_WINDOW_PTS
        morning_visible = {k for k in rows[0]["chain"]
                           if abs(float(k) - morning_spot) <= band}
        assert morning_visible <= set(out[0]["chain"])
        # ...and the closing row keeps the window the heatmap will render.
        window = nifty.TAPE_CHAIN_WINDOW_PTS
        close_visible = {k for k in rows[1]["chain"]
                         if abs(float(k) - close_spot) <= window}
        assert close_visible <= set(out[1]["chain"])

    def test_rows_without_a_chain_are_untouched(self):
        rows = [self._row("2026-11-16T09:15:00+05:30", 25_000.0, {})]
        out = nifty._trim_tape_chains(rows)
        assert out[0]["chain"] == {}
        assert "chain_truncated" not in out[0]

    def test_malformed_input_never_raises(self):
        assert nifty._trim_tape_chains([]) == []
        assert nifty._trim_tape_chains([None, "x", 5]) == []
        rows = [{"t": "2026-11-16T09:15:00+05:30", "spot": 25_000.0,
                 "chain": {"25000": [1, 2]}}]   # short tuple — keep, do not crash
        assert nifty._trim_tape_chains(rows)[0]["chain"] == {"25000": [1, 2]}

    def test_grows_the_day_wide_anchors_and_named_levels(self):
        """Anchors survive in EVERY row, not just the row that named them.

        The wall-migration detector and the participant-flow classifier rank
        the whole chain per frame; a strike that is the day's heaviest wall in
        one row must not vanish from the others.
        """
        deep_call, deep_put = 23_000.0, 27_000.0   # far outside both bands
        rows = []
        for i in range(4):
            spot = 25_000.0 + i
            chain = self._chain(spot)
            # The far strikes are the day's heaviest OI, but only appear late.
            if i >= 2:
                chain[str(int(deep_call))] = [1.0, 1.0, 60_000_000, 1, 1, 1]
                chain[str(int(deep_put))] = [1.0, 1.0, 1, 60_000_000, 1, 1]
            rows.append(self._row(f"2026-11-16T09:1{i}:00+05:30", spot, chain))
        out = nifty._trim_tape_chains(rows)
        anchors = nifty._day_wide_anchor_strikes(rows)
        assert str(int(deep_call)) in anchors
        assert str(int(deep_put)) in anchors
        # Row 0 never contained them, so they cannot be kept there; rows that
        # had them DO keep them even though both are 2,000 pts from spot.
        for row in out[2:]:
            assert str(int(deep_call)) in row["chain"]
            assert str(int(deep_put)) in row["chain"]

    def test_no_visible_strike_is_lost_at_any_replay_playhead(self):
        """Replay clips the tape at a playhead, so the window reference moves.

        The heatmap's reference spot is the LAST visible row's spot — mid-day
        in replay, not the close. A row band narrower than the window dropped
        edge cells at most cuts; this asserts the invariant that made the two
        constants equal.
        """
        rows = []
        # A rising day: every row's spot is 60 pts above the previous one.
        for i in range(24):
            spot = 25_000.0 + i * 60.0
            rows.append(self._row(f"2026-11-16T{9 + i // 60:02d}:{i % 60:02d}:00+05:30",
                                  spot, self._chain(spot)))
        out = nifty._trim_tape_chains(rows)
        window = nifty.TAPE_CHAIN_WINDOW_PTS

        def universe(rws: list[dict]) -> set[str]:
            ref = next((r["spot"] for r in reversed(rws) if r.get("spot")), 0)
            return {k for r in rws for k in r["chain"]
                    if abs(float(k) - ref) <= window}

        for cut in range(1, len(rows) + 1):
            assert universe(rows[:cut]) <= universe(out[:cut]), f"cut {cut}"

    async def test_endpoint_serves_trimmed_rows(self, _tmp_tape):
        """The endpoint (not the recorder) is where the trim applies."""
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())):
            await record_nifty_tape_tick(now=_ist(9, 15))
        # The recorder writes the full chain...
        recorded = read_tape("2026-10-13")[0]
        assert len(recorded["chain"]) == 2
        # ...and the endpoint serves the trimmed shape (2 strikes here, so no
        # truncation — but the marker keys are never invented).
        out = json.loads(get_nifty_tape(date="2026-10-13").body)
        assert len(out["rows"]) == 1
        assert set(out["rows"][0]["chain"]) == set(recorded["chain"])
        assert "chain_truncated" not in out["rows"][0]


class TestGapJournal:
    """Why a recorded day has holes, kept durably per day.

    Skip reasons used to live only in memory (``_tape_last_skip``) while the
    API log is truncated on every restart, so a past day's gaps were
    unexplainable. The journal is one ``{"t", "reason"}`` line per skipped
    minute; this is what the report UI reads back as "why".
    """

    def test_append_and_read_reasons(self, _tmp_tape):
        nifty._append_gap("2026-10-13", _ist(9, 16).isoformat(), "chain-failed")
        nifty._append_gap("2026-10-13", _ist(9, 17).isoformat(), "chain-failed")
        nifty._append_gap("2026-10-13", _ist(9, 25).isoformat(), "timeout")
        assert nifty.read_gap_reasons("2026-10-13") == {
            "chain-failed": 2, "timeout": 1}
        lines = nifty.gap_log_path("2026-10-13").read_text().strip().splitlines()
        assert len(lines) == 3
        assert json.loads(lines[0])["reason"] == "chain-failed"

    def test_missing_journal_is_empty(self, _tmp_tape):
        # A day recorded before the journal existed has no file at all.
        assert nifty.read_gap_reasons("2026-10-12") == {}

    def test_corrupt_lines_are_skipped(self, _tmp_tape):
        nifty.gap_log_path("2026-10-14").write_text(
            'not json\n{"t":"x","reason":"timeout"}\n{"t":"y"}\n')
        assert nifty.read_gap_reasons("2026-10-14") == {"timeout": 1}

    async def test_chain_failure_is_journaled(self, _tmp_tape):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(side_effect=RuntimeError("boom"))):
            assert await record_nifty_tape_tick(now=_ist(9, 16)) is None
        assert nifty.read_gap_reasons("2026-10-13") == {"chain-failed": 1}

    async def test_duplicate_minute_is_not_a_gap(self, _tmp_tape):
        # `same-minute` is a normal double-tick, not a hole — never journaled.
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())):
            await record_nifty_tape_tick(now=_ist(9, 16))
            await record_nifty_tape_tick(now=_ist(9, 16))
        assert nifty.read_gap_reasons("2026-10-13") == {}

    async def test_empty_chain_is_journaled(self, _tmp_tape):
        # An all-zero chain is a failed fetch, not a market state.
        rep = _fake_report()
        rep["strikes"] = []
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=rep)):
            assert await record_nifty_tape_tick(now=_ist(9, 20)) is None
        assert nifty.read_gap_reasons("2026-10-13") == {"empty-chain": 1}


# ---------------------------------------------------------------------------
# Golden: the tape row is the on-disk contract. ``build_tape_row`` (shared with
# the generic SENSEX / stock recorder) must produce the NIFTY row byte-for-byte,
# including key order — the strings below were captured from the pre-refactor
# ``nifty._write_tape_row``.
# ---------------------------------------------------------------------------
GOLDEN_REPORT = {
    "expiry": "2026-10-15",
    "spot": 25000.0,
    "fetched_at": "2026-10-13T09:15:02+05:30",
    "pcr_oi": 1.92,
    "pcr_vol": 1.21,
    "max_pain": 25000.0,
    "walls": {"calls": [{"strike": 25100.0, "oi": 900}],
              "puts": [{"strike": 24900.0, "oi": 950}]},
    "walls_near": {"calls": [{"strike": 25000.0, "oi": 1000}],
                   "puts": [{"strike": 25000.0, "oi": 2000}]},
    "gex": {"zero_cross": 25100.0, "net_total": -1234.5, "degraded": False},
    "strikes": [
        {"strike": 24800.0,
         "ce": {"ltp": 220.5, "oi": 800, "prev_oi": 780, "volume": 4000, "iv": 13.1},
         "pe": {"ltp": 4.5, "oi": 1200, "prev_oi": 1100, "volume": 5000, "iv": 14.2}},
        {"strike": 24900.0,
         "ce": {"ltp": 140.0, "oi": 900, "prev_oi": 890, "volume": 4100, "iv": 12.8},
         "pe": {"ltp": 12.0, "oi": 1500, "prev_oi": 1400, "volume": 5100, "iv": 13.9}},
        {"strike": 25000.0,
         "ce": {"ltp": 80.25, "oi": 1000, "prev_oi": 950, "volume": 5200, "iv": 12.5},
         "pe": {"ltp": 25.5, "oi": 2000, "prev_oi": 1900, "volume": 6300, "iv": 13.5}},
        {"strike": 25100.0,
         "ce": {"ltp": 40.0, "oi": 700, "prev_oi": 700, "volume": 2200, "iv": 12.2},
         "pe": {"ltp": 60.0, "oi": 900, "prev_oi": 880, "volume": 3300, "iv": 13.0}},
        {"strike": 25200.0,
         "ce": {"ltp": 15.0, "oi": 300, "prev_oi": 290, "volume": 900, "iv": 12.0},
         "pe": {"ltp": 120.0, "oi": 400, "prev_oi": 380, "volume": 1200, "iv": 12.9}},
    ],
}

GOLDEN_NORMAL = (
    '{"t":"2026-10-13T09:15:00+05:30","t_fetch":"2026-10-13T09:15:00+05:30",'
    '"t_write":"2026-10-13T09:15:03+05:30","spot":25000.0,"ce_oi":3700,'
    '"pe_oi":6000,"ce_vol":16400,"pe_vol":20900,"ce_oi_change_day":90,'
    '"pe_oi_change_day":340,"pcr_oi":1.92,"pcr_vol":1.21,"max_pain":25000.0,'
    '"max_pain_computed":25000.0,"flip":25100.0,"net_gex":-1234.5,'
    '"gex_degraded":false,"walls":{"calls":[{"strike":25000.0,"oi":1000}],'
    '"puts":[{"strike":25000.0,"oi":2000}]},"call_wall":25000.0,'
    '"put_wall":25000.0,"expiry":"2026-10-15","atm_strike":25000.0,'
    '"atm_ce_ltp":80.25,"atm_pe_ltp":25.5,"atm_ce_iv":12.5,"atm_pe_iv":13.5,'
    '"strikes_top":[{"strike":24800.0,"ce_oi":800,"pe_oi":1200},'
    '{"strike":24900.0,"ce_oi":900,"pe_oi":1500},'
    '{"strike":25000.0,"ce_oi":1000,"pe_oi":2000},'
    '{"strike":25100.0,"ce_oi":700,"pe_oi":900},'
    '{"strike":25200.0,"ce_oi":300,"pe_oi":400}],'
    '"chain":{"25000":[80.25,25.5,1000.0,2000.0,5200.0,6300.0],'
    '"24900":[140.0,12.0,900.0,1500.0,4100.0,5100.0],'
    '"25100":[40.0,60.0,700.0,900.0,2200.0,3300.0],'
    '"24800":[220.5,4.5,800.0,1200.0,4000.0,5000.0],'
    '"25200":[15.0,120.0,300.0,400.0,900.0,1200.0]}}'
)

GOLDEN_RECONCILED = (
    '{"t":"2026-10-13T09:16:00+05:30","t_fetch":"2026-10-13T09:16:00+05:30",'
    '"t_write":"2026-10-13T09:15:03+05:30","spot":25010.0,"spot_raw":25250.0,'
    '"ce_oi":3700,"pe_oi":6000,"ce_vol":16400,"pe_vol":20900,'
    '"ce_oi_change_day":90,"pe_oi_change_day":340,"pcr_oi":1.92,"pcr_vol":1.21,'
    '"max_pain":25000.0,"max_pain_computed":25000.0,"flip":25100.0,'
    '"net_gex":-1234.5,"gex_degraded":false,'
    '"walls":{"calls":[{"strike":25000.0,"oi":1000}],'
    '"puts":[{"strike":25000.0,"oi":2000}]},"call_wall":25000.0,'
    '"put_wall":25000.0,"expiry":"2026-10-15","atm_strike":25000.0,'
    '"atm_ce_ltp":80.25,"atm_pe_ltp":25.5,"atm_ce_iv":12.5,"atm_pe_iv":13.5,'
    '"strikes_top":[{"strike":24800.0,"ce_oi":800,"pe_oi":1200},'
    '{"strike":24900.0,"ce_oi":900,"pe_oi":1500},'
    '{"strike":25000.0,"ce_oi":1000,"pe_oi":2000},'
    '{"strike":25100.0,"ce_oi":700,"pe_oi":900},'
    '{"strike":25200.0,"ce_oi":300,"pe_oi":400}],'
    '"chain":{"25000":[80.25,25.5,1000.0,2000.0,5200.0,6300.0],'
    '"25100":[40.0,60.0,700.0,900.0,2200.0,3300.0],'
    '"24900":[140.0,12.0,900.0,1500.0,4100.0,5100.0],'
    '"25200":[15.0,120.0,300.0,400.0,900.0,1200.0],'
    '"24800":[220.5,4.5,800.0,1200.0,4000.0,5000.0]}}'
)


class TestTapeRowGolden:
    """Byte-identical NIFTY tape rows after the shared builder extraction."""

    @pytest.fixture()
    def _iso(self, monkeypatch):
        from api.reports_api import _tape_row

        monkeypatch.setattr(_tape_row, "now_iso",
                            lambda: "2026-10-13T09:15:03+05:30")

    async def _row(self, _tmp_tape, report, *, last_spot=None,
                   minute="2026-10-13T09:15", hh=9, mm=15):
        with patch.object(nifty, "_peek_last_tape_row",
                          lambda p, m: (last_spot, False)), \
             patch.object(nifty, "_append_tape_line", lambda p, r: None), \
             patch.object(nifty, "write_snapshot",
                          lambda d, s: _tmp_tape / "snap.json"), \
             patch.object(nifty, "_append_minute_snapshot",
                          AsyncMock(return_value=None)):
            return await nifty._write_tape_row(
                report, "2026-10-13", f"2026-10-13T{hh:02d}:{mm:02d}:00+05:30",
                _ist(hh, mm), nifty.tape_path("2026-10-13"), minute)

    async def test_normal_row_is_byte_identical(self, _tmp_tape, _iso):
        row = await self._row(_tmp_tape, copy.deepcopy(GOLDEN_REPORT))
        assert json.dumps(row, separators=(",", ":")) == GOLDEN_NORMAL
        assert list(row) == list(json.loads(GOLDEN_NORMAL))

    async def test_reconciled_row_is_byte_identical(self, _tmp_tape, _iso):
        from api.options import get_spot_price

        report = dict(copy.deepcopy(GOLDEN_REPORT), spot=25250.0)
        with patch("api.options.get_spot_price",
                   AsyncMock(return_value={"spot": 25010.0})):
            row = await self._row(_tmp_tape, report, last_spot=25000.0,
                                  minute="2026-10-13T09:16", mm=16)
        assert json.dumps(row, separators=(",", ":")) == GOLDEN_RECONCILED
        assert row["spot"] == 25010.0 and row["spot_raw"] == 25250.0
