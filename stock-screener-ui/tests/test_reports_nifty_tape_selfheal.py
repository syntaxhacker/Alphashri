"""The 1-minute NIFTY tape must be self-healing and honest.

Three failure modes this pins (all observed, none theoretical):

* a single transient 502 at 09:15 lost the opening minute for the day — the
  failed fetch was journalled immediately and the next attempt was 60 s later;
* a lost minute was never reconstructed even though the 10-second chain feed
  had ~6 frames for it;
* a row's timestamp was taken AFTER a ~50 s build, and the snapshot/replay
  frames kept the RAW chain spot while the tape used the reconciled one.

Every test is offline: ``_compute_live`` is mocked, ``TAPE_DIR`` and the
10-second feed's directory are redirected, and no retry actually sleeps.
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

import config
import api.reports_api.nifty as nifty
from api.reports_api.nifty import (
    backfill_tape_from_chain10s,
    build_leg,
    derive_tape_rows,
    read_gap_reasons,
    read_tape,
    record_nifty_tape_tick,
)

DATE = "2026-10-13"


@pytest.fixture()
def _tmp_tape(tmp_path, monkeypatch):
    monkeypatch.setattr(nifty, "TAPE_DIR", tmp_path / "tape")
    monkeypatch.setattr(nifty, "SNAPSHOT_DIR", tmp_path / "day_snapshots")
    monkeypatch.setattr(nifty, "SNAPSHOT_LOG_DIR", tmp_path / "snapshots")
    monkeypatch.setattr(nifty, "TAPE_RETRY_BACKOFF_SEC", (0.0, 0.0))
    monkeypatch.setattr(
        nifty, "_compute_sensex_live",
        AsyncMock(side_effect=RuntimeError("no sensex in tests")), raising=False)
    nifty._sensex_cache.clear()
    nifty._GAP_MINUTES.clear()
    nifty._TAPE_INFLIGHT = False
    nifty._tape_last_skip = None
    nifty._tape_last_error = None
    yield tmp_path
    nifty._sensex_cache.clear()
    nifty._GAP_MINUTES.clear()
    nifty._TAPE_INFLIGHT = False


def _ist(h: int, m: int, s: int = 0) -> datetime:
    return datetime(2026, 10, 13, h, m, s, tzinfo=config.IST)


def _fake_report(spot: float = 25000.0, **over) -> dict:
    rep = {
        "expiry": "2026-10-15", "spot": spot,
        "pcr_oi": 1.92, "pcr_vol": 1.21, "max_pain": 25000.0,
        "walls": {"calls": [{"strike": 25000.0, "oi": 1000}],
                  "puts": [{"strike": 25000.0, "oi": 2000}]},
        "gex": {"zero_cross": 25100.0},
        "strikes": [
            {"strike": 25000.0,
             "ce": {"oi": 1000, "prev_oi": 900, "volume": 5000},
             "pe": {"oi": 2000, "prev_oi": 1800, "volume": 6000}},
            {"strike": 25100.0,
             "ce": {"oi": 200, "prev_oi": 100, "volume": 200},
             "pe": {"oi": 300, "prev_oi": 250, "volume": 300}},
        ],
    }
    rep.update(over)
    return rep


def _empty_report() -> dict:
    return _fake_report(strikes=[], gex={"zero_cross": None, "net_total": 0},
                        max_pain=0.0)


class TestInMinuteRetry:
    async def test_a_transient_failure_is_retried_inside_the_minute(self, _tmp_tape):
        calls = {"n": 0}

        async def flaky(*_a, **_k):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("502 Bad Gateway")
            return _fake_report()

        with patch.object(nifty, "_compute_live", AsyncMock(side_effect=flaky)):
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        assert row is not None
        assert calls["n"] == 2
        # Recovered inside the minute -> the minute is NOT a gap.
        assert read_gap_reasons(DATE) == {}
        assert len(read_tape(DATE)) == 1

    async def test_the_gap_is_journalled_only_after_exhaustion(self, _tmp_tape):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(side_effect=RuntimeError("502"))) as cl:
            assert await record_nifty_tape_tick(now=_ist(9, 15)) is None
        assert cl.await_count == nifty.TAPE_FETCH_ATTEMPTS
        # ONE journalled gap for the minute, not one per attempt.
        assert read_gap_reasons(DATE) == {"chain-failed": 1}
        assert read_tape(DATE) == []

    async def test_the_opening_minute_retries_the_unpopulated_chain(self, _tmp_tape):
        """09:15 is when the chain is most likely not populated yet."""
        calls = {"n": 0}

        async def opening(*_a, **_k):
            calls["n"] += 1
            return _empty_report() if calls["n"] == 1 else _fake_report()

        with patch.object(nifty, "_compute_live", AsyncMock(side_effect=opening)):
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        assert row is not None
        assert row["t"] == _ist(9, 15).isoformat()
        assert calls["n"] == 2
        assert read_gap_reasons(DATE) == {}

    async def test_a_rejected_spot_is_retried_before_the_minute_is_lost(
            self, _tmp_tape, monkeypatch):
        # No independent quote: the 1.4% jump can only be rejected.
        monkeypatch.setattr("api.options.get_spot_price",
                            AsyncMock(side_effect=RuntimeError("no quote")))
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report(spot=22690.0))):
            assert await record_nifty_tape_tick(now=_ist(9, 15)) is not None

        calls = {"n": 0}

        async def flaky_spot(*_a, **_k):
            calls["n"] += 1
            return _fake_report(spot=22363.3 if calls["n"] == 1 else 22691.0)

        with patch.object(nifty, "_compute_live",
                          AsyncMock(side_effect=flaky_spot)):
            row = await record_nifty_tape_tick(now=_ist(9, 16))
        assert row is not None and row["spot"] == 22691.0
        assert calls["n"] == 2
        assert read_gap_reasons(DATE) == {}

    async def test_duplicate_minute_after_success_is_not_refetched(self, _tmp_tape):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())) as cl:
            assert await record_nifty_tape_tick(now=_ist(9, 15)) is not None
            assert await record_nifty_tape_tick(
                now=_ist(9, 15, 45)) is None
        assert cl.await_count == 1
        assert nifty._tape_last_skip == "same-minute"
        assert len(read_tape(DATE)) == 1

    async def test_a_second_tick_cannot_overlap_the_first(self, _tmp_tape):
        nifty._TAPE_INFLIGHT = True
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())) as cl:
            assert await record_nifty_tape_tick(now=_ist(9, 15)) is None
        assert cl.await_count == 0
        assert nifty._tape_last_skip == "in-flight"

    async def test_a_write_failure_is_not_retried(self, _tmp_tape):
        """A half-appended row must never be written twice."""
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())) as cl, \
                patch.object(nifty, "_write_tape_row",
                             AsyncMock(side_effect=OSError("disk full"))):
            assert await record_nifty_tape_tick(now=_ist(9, 15)) is None
        assert cl.await_count == 1
        assert "disk full" in (nifty._tape_last_error or "")


class TestTimestampHonesty:
    async def test_row_stamps_fetch_start_and_write_time(self, _tmp_tape):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())):
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        assert row is not None
        # ``t`` stays the minute bucket (compatibility) and equals the FETCH
        # start, not the time the ~50 s build finished.
        assert row["t"] == row["t_fetch"] == _ist(9, 15).isoformat()
        written = datetime.fromisoformat(row["t_write"])
        assert written.tzinfo is not None
        assert written >= datetime.fromisoformat(row["t_fetch"])


class TestSpotReconciliationInSnapshots:
    async def test_snapshot_and_replay_use_the_reconciled_tape_spot(
            self, _tmp_tape, monkeypatch):
        monkeypatch.setattr("api.options.get_spot_price",
                            AsyncMock(return_value={"spot": 22690.0}))
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report(spot=22690.0))):
            first = await record_nifty_tape_tick(now=_ist(9, 15))
        assert first is not None

        # A corrupt chain print the index contradicts.
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report(spot=22363.3))):
            second = await record_nifty_tape_tick(now=_ist(9, 16))
        assert second is not None
        assert second["spot"] == 22690.0
        assert second["spot_raw"] == 22363.3

        day = nifty.read_snapshot(DATE)
        assert day is not None
        assert day["spot"] == 22690.0
        assert day["spot_raw"] == 22363.3
        assert day["spot_source"] == "tape_reconciled"
        # The replay frame is the same envelope, not the raw one.
        replay = nifty.read_snapshots(DATE)
        assert replay[-1]["report"]["spot"] == 22690.0

    async def test_a_clean_spot_carries_no_raw_copy(self, _tmp_tape):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())):
            row = await record_nifty_tape_tick(now=_ist(9, 15))
        assert row is not None
        assert "spot_raw" not in row
        assert "spot_raw" not in (nifty.read_snapshot(DATE) or {})

    async def test_the_snapshot_builder_adopts_the_reconciled_tape_spot(
            self, _tmp_tape):
        """The 20s snapshot task must not overwrite it with the raw chain print."""
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report(spot=25000.0))):
            assert await record_nifty_tape_tick(now=_ist(9, 15)) is not None

        snap = nifty._build_snapshot_dict(_fake_report(spot=24800.0), DATE)
        assert snap["spot"] == 25000.0      # the tape's reconciled value
        assert snap["spot_raw"] == 24800.0
        assert snap["spot_source"] == "tape_reconciled"

        # A print that agrees with the tape is kept as-is.
        clean = nifty._build_snapshot_dict(_fake_report(spot=24999.0), DATE)
        assert clean["spot"] == 24999.0
        assert "spot_raw" not in clean


class TestBackfillFromChain10s:
    @staticmethod
    def _frame(t: str, spot: float = 25000.0) -> dict:
        return {
            "t": t, "spot": spot, "expiry": "2026-10-20",
            "rows": [
                [24950.0, 80.0, 900, 400, 150.0, 2100, 700],
                [25000.0, 100.0, 1000, 500, 120.0, 2000, 600],
                [25050.0, 130.0, 300, 100, 95.0, 1100, 300],
            ],
        }

    @pytest.fixture()
    def _chain10s_day(self, monkeypatch, tmp_path):
        directory = tmp_path / "chain10s"
        directory.mkdir()
        monkeypatch.setattr("api.reports_api.chain10s._dir", lambda: directory)
        frames = [
            self._frame("2026-10-13T09:15:10+05:30"),
            self._frame("2026-10-13T09:15:50+05:30"),   # last frame wins
            self._frame("2026-10-13T09:16:20+05:30", spot=25005.0),
            self._frame("2026-10-13T09:17:10+05:30", spot=25010.0),
        ]
        with open(directory / f"{DATE}.jsonl", "w") as fh:
            for frame in frames:
                fh.write(json.dumps(frame) + "\n")
        return directory

    async def test_missing_minutes_are_reconstructed_and_marked(
            self, _tmp_tape, _chain10s_day):
        added = await backfill_tape_from_chain10s(DATE, now=_ist(9, 20))
        assert added == 3
        rows = read_tape(DATE)
        assert [row["t"][11:16] for row in rows] == ["09:15", "09:16", "09:17"]
        assert rows[0]["t"] == "2026-10-13T09:15:50+05:30"
        for row in rows:
            assert row["backfilled"] is True
            assert row["source"] == "chain10s"
            # Not derivable from the 10-second feed -> empty/null, never fake.
            assert row["walls"] == {"calls": [], "puts": []}
            assert row["flip"] is None and row["net_gex"] is None
            assert row["gex_degraded"] is True
            assert row["max_pain"] is None
            assert row["max_pain_computed"] == 25000.0
            assert row["ce_oi_change_day"] is None
            assert row["ce_oi"] == 2200 and row["pe_oi"] == 5200
            assert row["ce_vol"] == 1000 and row["pe_vol"] == 1600

    async def test_backfill_is_idempotent(self, _tmp_tape, _chain10s_day):
        assert await backfill_tape_from_chain10s(DATE, now=_ist(9, 20)) == 3
        before = nifty.tape_path(DATE).read_text()
        assert await backfill_tape_from_chain10s(DATE, now=_ist(9, 20)) == 0
        assert nifty.tape_path(DATE).read_text() == before

    async def test_an_existing_row_is_never_replaced(
            self, _tmp_tape, _chain10s_day):
        recorded = {"t": "2026-10-13T09:15:05+05:30", "spot": 24999.0,
                    "ce_oi": 1, "pe_oi": 1, "ce_vol": 1, "pe_vol": 1}
        nifty.tape_path(DATE).parent.mkdir(parents=True, exist_ok=True)
        with open(nifty.tape_path(DATE), "w") as fh:
            fh.write(json.dumps(recorded) + "\n")
        assert await backfill_tape_from_chain10s(DATE, now=_ist(9, 20)) == 2
        rows = read_tape(DATE)
        assert len(rows) == 3
        assert rows[0] == recorded          # untouched
        assert [row["t"][11:16] for row in rows[1:]] == ["09:16", "09:17"]

    async def test_only_past_minutes_of_today_are_backfilled(
            self, _tmp_tape, _chain10s_day):
        # At 09:17 the 09:17 minute is still in progress: the recorder owns it.
        assert await backfill_tape_from_chain10s(DATE, now=_ist(9, 17)) == 2
        # A past session is never reconstructed from today's feed lookup.
        assert await backfill_tape_from_chain10s(
            "2026-10-12", now=_ist(9, 20)) == 0

    async def test_recorder_fills_the_hole_it_just_recovered_from(
            self, _tmp_tape, _chain10s_day):
        with patch.object(nifty, "_compute_live",
                          AsyncMock(return_value=_fake_report())):
            assert await record_nifty_tape_tick(now=_ist(9, 15)) is not None
            # 09:16 fails entirely, so 09:17 is the next recorded minute.
            with patch.object(nifty, "_compute_live",
                              AsyncMock(side_effect=RuntimeError("502"))):
                assert await record_nifty_tape_tick(now=_ist(9, 16)) is None
            assert await record_nifty_tape_tick(now=_ist(9, 17)) is not None
        minutes = [row["t"][11:16] for row in read_tape(DATE)]
        assert minutes == ["09:15", "09:16", "09:17"]
        # The 09:16 minute exists only as a marked backfill.
        backfilled = [row for row in read_tape(DATE) if row.get("backfilled")]
        assert len(backfilled) == 1
        assert backfilled[0]["t"][11:16] == "09:16"
        assert read_gap_reasons(DATE) == {"chain-failed": 1}


class TestDeadFields:
    def test_absent_order_book_flow_is_null_not_zero(self):
        leg = build_leg({"ltp": 10.0})
        assert leg["buy_qty"] is None
        assert leg["sell_qty"] is None
        assert leg["last_trade_price"] is None
        assert leg["last_trade_qty"] is None
        # Keys stay present: an existing consumer must not KeyError.
        for key in ("buy_qty", "sell_qty", "last_trade_price", "last_trade_qty"):
            assert key in leg

    def test_served_flow_fields_are_carried(self):
        leg = build_leg({"ltp": 10.0, "total_buy_quantity": 5,
                         "total_sell_quantity": 7, "last_trade_price": 9.5,
                         "last_trade_qty": 3})
        assert (leg["buy_qty"], leg["sell_qty"]) == (5, 7)
        assert (leg["last_trade_price"], leg["last_trade_qty"]) == (9.5, 3)


class TestDayChangeVsIntervalDelta:
    def _raw(self, t, ce_oi, pe_oi):
        return {"t": t, "spot": 25000.0, "ce_oi": ce_oi, "pe_oi": pe_oi,
                "ce_vol": 0, "pe_vol": 0, "pcr_oi": 1.0, "flip": None}

    def test_interval_delta_is_not_the_vs_first_cumulative(self):
        rows = [
            self._raw("2026-10-13T09:15:00+05:30", 1000, 2000),
            self._raw("2026-10-13T09:16:00+05:30", 1200, 2300),
            self._raw("2026-10-13T09:17:00+05:30", 1250, 2350),
        ]
        out = derive_tape_rows(rows)
        assert out[1]["ce_doi_interval"] == 200
        assert out[2]["ce_doi_interval"] == 50
        # ...while call_doi stays cumulative vs the day's first recorded row.
        assert out[2]["call_doi"] == 250
        assert out[0]["ce_doi_interval"] == 0

    def test_day_change_passes_through_and_backfill_leaves_it_null(self):
        row = self._raw("2026-10-13T09:15:00+05:30", 1000, 2000)
        row["ce_oi_change_day"] = 1234
        row["pe_oi_change_day"] = -56
        out = derive_tape_rows([row])[0]
        assert out["ce_oi_change_day"] == 1234
        assert out["pe_oi_change_day"] == -56

        frame = {"t": "2026-10-13T09:15:10+05:30", "spot": 25000.0,
                 "rows": [[25000.0, 100.0, 1000, 5, 120.0, 2000, 6]]}
        born = nifty.tape_row_from_chain10s_frame(frame)
        assert born is not None
        assert born["ce_oi_change_day"] is None
        assert born["pe_oi_change_day"] is None
