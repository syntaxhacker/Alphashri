"""The WS market-data producer must never serve a frozen option chain.

On 2026-10-22 the report's chain ladder showed the 22,800 CE at 130.30 for
22 minutes while the REST chain traded 148.35 — and an API restart cleared it.
Root cause: the WS producer refreshed ONE global tick clock, and the index
ticks constantly, so a socket whose option stream had died still looked
"live". The report then built the ladder from the frozen legs.

These tests pin:
  1. every option leg carries its own tick time;
  2. a snapshot whose legs are old is NOT served as a live report (the
     report falls back to the REST chain);
  3. the producer restarts a session whose legs went stale (and survives a
     dropped socket).
"""

import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest

import api.reports_api.nifty as nifty
import api.reports_api.nifty_md as md


def _leg(strike: float, ltp: float, oi: int = 1000) -> dict:
    return {"oi": oi, "iv": 12.0, "ltp": ltp, "volume": 100,
            "delta": 0.5, "gamma": 0.0004}


def _snapshot(n: int = 25, spot: float = 22700.0, legs_ts=None) -> dict:
    legs = {}
    base = spot - (n // 2) * 50.0
    for i in range(n):
        strike = base + i * 50.0
        legs[f"{strike}:ce"] = _leg(strike, 120.0 - i)
        legs[f"{strike}:pe"] = _leg(strike, 20.0 + i)
    return {"ts": "2026-10-22T10:45:00+05:30", "connected": True,
            "spot": spot, "vix": 13.5, "sensex": 81400.0, "legs": legs,
            "legs_ts": time.time() if legs_ts is None else legs_ts}


@pytest.fixture(autouse=True)
def _clean_md_state():
    md._reset_state_for_tests()
    yield
    md._reset_state_for_tests()


class TestLegFreshness:
    def test_a_leg_tick_stamps_the_leg_and_the_state(self):
        md._set_leg(22700.0, "ce", ltp=130.3, oi=1000)
        snap = md.snapshot()
        assert snap["legs_ts"] is not None
        leg = snap["legs"]["22700.0:ce"]
        assert leg["ltp"] == 130.3
        assert leg["ts"] is not None
        assert md.legs_age() is not None
        assert md.legs_fresh() is True

    def test_the_index_tick_does_not_make_the_legs_fresh(self):
        """The bug: the index kept ticking while the option stream was dead."""
        md._set_leg(22700.0, "ce", ltp=130.3, oi=1000)
        md._last_leg_ts = time.time() - 600.0
        md._set_connected(True)
        md._set_spot(22718.0)          # the index is alive
        assert md.is_live() is True     # the global clock says "live"...
        assert md.legs_fresh() is False  # ...but the legs are frozen
        assert md.legs_age() > 300

    def test_legs_age_is_measured_from_the_session_start_before_the_first_tick(self):
        md._session["started"] = time.time() - 120.0
        assert md.legs_age() is not None
        assert md.legs_age() >= 100
        assert md.legs_fresh() is False


class TestReportRefusesStaleLegs:
    def test_a_fresh_snapshot_builds_a_report(self):
        rep = nifty.build_report_from_live(_snapshot(), "2026-10-29")
        assert rep is not None
        assert rep["feed"]["source"] == "ws"

    def test_a_stale_snapshot_is_refused(self):
        """A frozen ladder is not a live chain — the report says no."""
        snap = _snapshot(legs_ts=time.time() - 600.0)
        assert nifty.build_report_from_live(snap, "2026-10-29") is None

    def test_a_snapshot_without_a_timestamp_is_refused(self):
        """No freshness proof → not served as live."""
        snap = _snapshot()
        snap.pop("legs_ts")
        assert nifty.build_report_from_live(snap, "2026-10-29") is None

    async def test_the_report_falls_back_to_the_rest_chain(self, monkeypatch):
        sentinel = {"mode": "live", "spot": 1.0, "feed": {"source": "rest"}}
        monkeypatch.setattr(nifty, "_nifty_md",
                            lambda: type("M", (), {
                                "is_live": staticmethod(lambda: True),
                                "snapshot": staticmethod(
                                    lambda: _snapshot(legs_ts=time.time() - 600.0)),
                            })())
        monkeypatch.setattr(nifty, "get_cached_live",
                            AsyncMock(return_value=sentinel))
        got = await nifty.get_live_report("2026-10-29")
        assert got is sentinel
        nifty.get_cached_live.assert_awaited_once()


class TestProducerSurvivesADeadStream:
    async def test_a_stale_leg_stream_restarts_the_session(self, monkeypatch):
        """The socket is up, the option stream is dead → restart it."""
        stopped = {"n": 0}

        def _stop():
            stopped["n"] += 1

        monkeypatch.setattr(md, "_stop_session", _stop)
        monkeypatch.setattr(md, "_market_open", lambda: True)
        monkeypatch.setattr(md, "POLL_SEC", 0.01)
        monkeypatch.setattr(md, "RECONNECT_BASE_SEC", 0.01)
        # A live session whose legs went stale an hour ago.
        md._session.update({"sig": ("a",), "stop": None, "err": None,
                            "thread": None, "streamer": None,
                            "started": time.time() - 3600.0})
        md._last_tick_ts = time.time()          # the index is alive
        md._last_leg_ts = time.time() - 3600.0   # the legs are frozen

        async def _stop_soon(_delay):
            raise asyncio.CancelledError

        with patch.object(asyncio, "sleep", side_effect=_stop_soon):
            with pytest.raises(asyncio.CancelledError):
                await md.nifty_md_task()
        assert stopped["n"] >= 1, "the stale leg stream was not restarted"

    async def test_a_dropped_socket_ends_the_session_and_reconnects(
            self, monkeypatch):
        """The producer survives a dropped websocket (err → new session)."""
        started = {"n": 0}
        err = asyncio.Event()
        err.set()

        monkeypatch.setattr(md, "_market_open", lambda: True)
        monkeypatch.setattr(md, "POLL_SEC", 0.01)
        monkeypatch.setattr(md, "RECONNECT_BASE_SEC", 0.01)
        monkeypatch.setattr(md, "_fetch_chain_payload", AsyncMock(return_value=None))
        monkeypatch.setattr(md, "_stop_session", lambda: None)
        md._session.update({"sig": ("a",), "stop": None, "err": err,
                            "thread": None, "streamer": None, "started": None})

        async def _stop_soon(_delay):
            raise asyncio.CancelledError

        with patch.object(asyncio, "sleep", side_effect=_stop_soon):
            with pytest.raises(asyncio.CancelledError):
                await md.nifty_md_task()
        # The dead session was detected and the loop kept running.
        assert started["n"] == 0
