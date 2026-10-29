"""Poller tests — the market-hours window, the once-a-day digest, and survival.

The loop is exercised with a tiny ``interval_tripwire_sec`` and ``wait_for`` so
the tests are fast and deterministic; every clock and every worker is injected
by monkeypatch, so nothing sleeps for real or touches the network.
"""

from __future__ import annotations

import asyncio
import datetime as dt

import pytest

from api.event_radar import poller
from api.event_radar.contract import Anomaly, Event
from api.event_radar.poller import (
    US_MARKET_HOURS_UTC,
    anomaly_scan_once,
    event_radar_poller,
    is_us_market_open,
    refresh_calendar_once,
)
from api.event_radar.store import list_anomalies, upsert_events

UTC = dt.timezone.utc


class TestMarketHours:
    @pytest.mark.parametrize(
        ("stamp", "expected"),
        [
            # Thursday 2026-10-29
            (dt.datetime(2026, 10, 29, 13, 29, 59, tzinfo=UTC), False),
            (dt.datetime(2026, 10, 29, 13, 30, 0, tzinfo=UTC), True),
            (dt.datetime(2026, 10, 29, 17, 0, 0, tzinfo=UTC), True),
            (dt.datetime(2026, 10, 29, 19, 59, 59, tzinfo=UTC), True),
            (dt.datetime(2026, 10, 29, 20, 0, 0, tzinfo=UTC), False),
            # weekend
            (dt.datetime(2026, 10, 31, 15, 0, 0, tzinfo=UTC), False),  # Saturday
            (dt.datetime(2026, 11, 1, 15, 0, 0, tzinfo=UTC), False),  # Sunday
            # Friday inside the window
            (dt.datetime(2026, 10, 30, 15, 0, 0, tzinfo=UTC), True),
        ],
    )
    def test_boundaries(self, stamp, expected):
        assert is_us_market_open(stamp) is expected

    def test_naive_input_is_treated_as_utc(self):
        assert is_us_market_open(dt.datetime(2026, 10, 29, 15, 0)) is True

    def test_constant_is_the_documented_window(self):
        assert US_MARKET_HOURS_UTC == (13, 30, 20, 0)


class TestDigestSchedule:
    def test_first_tick_after_0730_et_sends(self):
        # 12:00 UTC == 08:00 ET (EDT).
        now = dt.datetime(2026, 10, 29, 12, 0, tzinfo=UTC)
        assert poller._digest_due(now, None) is True

    def test_before_0730_et_waits(self):
        now = dt.datetime(2026, 10, 29, 10, 0, tzinfo=UTC)  # 06:00 ET
        assert poller._digest_due(now, None) is False

    def test_second_tick_the_same_et_day_is_suppressed(self):
        now = dt.datetime(2026, 10, 29, 12, 0, tzinfo=UTC)
        assert poller._digest_due(now + dt.timedelta(minutes=5), dt.date(2026, 10, 29)) is False

    def test_a_new_et_day_sends_again(self):
        now = dt.datetime(2026, 10, 30, 12, 0, tzinfo=UTC)
        assert poller._digest_due(now, dt.date(2026, 10, 29)) is True


async def _run_loop_for(seconds: float = 0.08, **kwargs) -> None:
    """Run the poller for ``seconds`` then cancel it (the loop never returns)."""
    task = asyncio.create_task(
        event_radar_poller(kwargs.pop("interval_calendar_sec", 3600),
                          kwargs.pop("interval_tripwire_sec", 0.005))
    )
    await asyncio.sleep(seconds)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


class TestLoop:
    pytestmark = pytest.mark.asyncio

    async def test_digest_is_sent_once_per_et_day(self, monkeypatch):
        calls = {"digest": 0, "refresh": 0}
        fixed = dt.datetime(2026, 10, 29, 12, 0, tzinfo=UTC)  # 08:00 ET

        async def fake_refresh():
            calls["refresh"] += 1
            return {"ok": True, "inserted": 0}

        def fake_digest():
            calls["digest"] += 1
            return 1

        monkeypatch.setattr(poller, "_utc_now", lambda: fixed)
        monkeypatch.setattr(poller, "refresh_calendar_once", fake_refresh)
        monkeypatch.setattr(poller, "_deliver_digest", fake_digest)
        monkeypatch.setattr(poller, "is_us_market_open", lambda now=None: False)

        await _run_loop_for(0.08)

        assert calls["digest"] == 1
        assert calls["refresh"] == 1  # calendar interval not yet elapsed

    async def test_calendar_refreshes_again_after_the_interval(self, monkeypatch):
        calls = {"refresh": 0}
        clock = {"now": dt.datetime(2026, 10, 29, 12, 0, tzinfo=UTC)}

        async def fake_refresh():
            calls["refresh"] += 1
            return {"ok": True, "inserted": 0}

        monkeypatch.setattr(poller, "_utc_now", lambda: clock["now"])
        monkeypatch.setattr(poller, "refresh_calendar_once", fake_refresh)
        monkeypatch.setattr(poller, "_deliver_digest", lambda: 0)
        monkeypatch.setattr(poller, "is_us_market_open", lambda now=None: False)

        task = asyncio.create_task(
            event_radar_poller(interval_calendar_sec=0.02, interval_tripwire_sec=0.005)
        )
        await asyncio.sleep(0.03)
        clock["now"] = clock["now"] + dt.timedelta(seconds=5)
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert calls["refresh"] >= 2

    async def test_one_bad_cycle_does_not_kill_the_loop(self, monkeypatch):
        calls = {"refresh": 0}

        async def boom():
            calls["refresh"] += 1
            raise RuntimeError("upstream down")

        monkeypatch.setattr(poller, "_utc_now", lambda: dt.datetime(2026, 10, 29, 12, 0, tzinfo=UTC))
        monkeypatch.setattr(poller, "refresh_calendar_once", boom)
        monkeypatch.setattr(poller, "_deliver_digest", lambda: 0)
        monkeypatch.setattr(poller, "is_us_market_open", lambda now=None: False)

        await _run_loop_for(0.08)

        # Still alive after the first failure: the loop kept re-entering but the
        # calendar interval throttles the retry, so what matters is that the
        # task survived and logged instead of propagating.
        assert calls["refresh"] >= 1

    async def test_tripwire_only_runs_when_the_market_is_open(self, monkeypatch):
        calls = {"scan": 0}
        open_now = dt.datetime(2026, 10, 29, 15, 0, tzinfo=UTC)

        async def fake_scan(symbols, market):
            calls["scan"] += 1
            return []

        async def fake_refresh():
            return {"ok": True, "inserted": 0}

        monkeypatch.setenv("EVENT_RADAR_TRIPWIRE_SYMBOLS", "ORCL,MSFT")
        monkeypatch.setenv("EVENT_RADAR_MARKET", "us")
        monkeypatch.setattr(poller, "_utc_now", lambda: open_now)
        monkeypatch.setattr(poller, "refresh_calendar_once", fake_refresh)
        monkeypatch.setattr(poller, "_deliver_digest", lambda: 0)
        monkeypatch.setattr(poller, "anomaly_scan_once", fake_scan)
        monkeypatch.setattr(poller, "is_us_market_open", lambda now=None: False)

        await _run_loop_for(0.05)
        assert calls["scan"] == 0

        monkeypatch.setattr(poller, "is_us_market_open", lambda now=None: True)
        await _run_loop_for(0.05)
        assert calls["scan"] > 0

    async def test_cancellation_is_a_clean_exit(self, monkeypatch):
        monkeypatch.setattr(poller, "_utc_now", lambda: dt.datetime(2026, 10, 29, 12, 0, tzinfo=UTC))
        monkeypatch.setattr(poller, "_deliver_digest", lambda: 0)
        monkeypatch.setattr(poller, "is_us_market_open", lambda now=None: False)

        task = asyncio.create_task(event_radar_poller(interval_tripwire_sec=0.005))
        await asyncio.sleep(0.02)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1.0)
        assert task.cancelled()


class TestWorkers:
    async def test_refresh_calendar_once_returns_the_inserted_count(self, monkeypatch):
        monkeypatch.setattr(
            poller,
            "_refresh_and_store",
            lambda: {"ok": True, "inserted": 2, "fetched": 3},
        )
        assert await refresh_calendar_once() == {"ok": True, "inserted": 2, "fetched": 3}

    async def test_scan_suppresses_moves_the_calendar_explains(self, db, monkeypatch):
        """ORCL has an event today (muted); MSFT does not (alerted)."""
        from api.event_radar.router import market_today
        from api.event_radar.store import list_anomalies

        today = market_today("us")
        upsert_events(
            db,
            [
                Event(
                    id="edgar:orcl-today",
                    symbol="ORCL",
                    event_type="investor_day",
                    title="Oracle Investor Day",
                    event_date=today.isoformat(),
                    source="edgar",
                    exchange="NASDAQ",
                )
            ],
        )

        def fake_scan(symbol, market):
            return [
                Anomaly(
                    symbol=symbol,
                    ts=f"{today.isoformat()}T14:19:00-04:00",
                    price=100.0,
                    ret_pct=6.0,
                    ret_sigma=20.0,
                    vol_ratio=12.0,
                )
            ]

        alerts: list[str] = []
        monkeypatch.setattr(poller, "_session", lambda: db)
        monkeypatch.setattr("api.event_radar.anomaly.scan_symbol", fake_scan)
        monkeypatch.setattr(
            "api.event_radar.alerts.send_anomaly",
            lambda anomaly: alerts.append(anomaly.symbol) or True,
        )

        found = await anomaly_scan_once(["ORCL", "MSFT"], "us")

        by_symbol = {anomaly.symbol: anomaly for anomaly in found}
        assert by_symbol["ORCL"].has_known_event is True
        assert by_symbol["MSFT"].has_known_event is False
        assert alerts == ["MSFT"]  # suppression happens before delivery

        stored = {anomaly.symbol for anomaly in list_anomalies(db, today, "us")}
        assert stored == {"ORCL", "MSFT"}

    async def test_scan_survives_one_bad_symbol(self, db, monkeypatch):
        def fake_scan(symbol, market):
            if symbol == "BROKEN":
                raise RuntimeError("no data")
            return []

        monkeypatch.setattr(poller, "_session", lambda: db)
        monkeypatch.setattr("api.event_radar.anomaly.scan_symbol", fake_scan)

        assert await anomaly_scan_once(["BROKEN", "ORCL"], "us") == []

    async def test_empty_symbol_list_is_a_no_op(self, db, monkeypatch):
        monkeypatch.setattr(poller, "_session", lambda: db)
        assert await anomaly_scan_once([], "us") == []
