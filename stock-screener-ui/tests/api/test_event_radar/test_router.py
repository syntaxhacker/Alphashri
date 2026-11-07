"""Router tests — wire shape, clamping, and structured upstream failures.

The store and the source adapters are monkeypatched wherever the assertion is
about HTTP behaviour, so a failure here means *the endpoint* broke, not the
scraper or the database.
"""

from __future__ import annotations

import datetime as dt

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.event_radar import router as router_module
from api.event_radar.contract import (
    ANOMALY_COOLDOWN_MIN,
    ANOMALY_MIN_ABS_RET,
    ANOMALY_RET_SIGMA,
    ANOMALY_VOL_MULT,
    Event,
)
from api.event_radar.router import market_today, router
from api.event_radar.store import save_anomalies, upsert_events
from db.database import get_db

EVENT_KEYS = {
    "id",
    "symbol",
    "event_type",
    "title",
    "event_date",
    "source",
    "exchange",
    "name",
    "announced_at",
    "source_url",
    "confidence",
    "recurring",
    "notes",
    "days_until",
    "is_alpha",
}

ANOMALY_KEYS = {
    "symbol",
    "ts",
    "price",
    "ret_pct",
    "ret_sigma",
    "vol_ratio",
    "has_known_event",
    "suspected",
    "exchange",
}


@pytest.fixture
def events_client(db):
    """Router-only app: no auth, no lifespan, the test session as the DB."""
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def _ev(
    *,
    symbol: str = "ORCL",
    event_type: str = "investor_day",
    event_date: dt.date | None = None,
    source: str = "edgar",
    title: str = "Oracle to host Investor Day",
    exchange: str = "NASDAQ",
    event_id: str | None = None,
    announced_at: str | None = "2026-10-23",
) -> Event:
    day = event_date or (market_today("us") + dt.timedelta(days=5))
    return Event(
        id=event_id or f"{source}:{symbol.lower()}-{day.isoformat()}-{event_type}",
        symbol=symbol,
        event_type=event_type,  # type: ignore[arg-type]
        title=title,
        event_date=day.isoformat(),
        source=source,  # type: ignore[arg-type]
        exchange=exchange,
        announced_at=announced_at,
        confidence=0.6,
    )


class TestCalendar:
    def test_shape_matches_the_contract(self, events_client, db):
        upsert_events(db, [_ev()])

        payload = events_client.get("/api/events/calendar?market=us").json()

        assert set(payload) == {"events", "meta"}
        assert len(payload["events"]) == 1
        event = payload["events"][0]
        assert set(event) == EVENT_KEYS
        assert event["symbol"] == "ORCL"
        assert event["days_until"] == 5
        assert event["is_alpha"] is True  # investor_day
        assert event["announced_at"] == "2026-10-23"

        meta = payload["meta"]
        assert set(meta) == {"as_of", "scanned", "sources", "warnings"}
        assert meta["scanned"] == 1
        assert meta["sources"] == {"edgar": 1}
        assert meta["warnings"] == []
        assert dt.datetime.fromisoformat(meta["as_of"]).tzinfo is not None

    def test_earnings_is_not_alpha(self, events_client, db):
        upsert_events(db, [_ev(event_type="earnings", source="tv", event_id="tv:e")])
        event = events_client.get("/api/events/calendar").json()["events"][0]
        assert event["is_alpha"] is False

    def test_market_filter_and_defaults(self, events_client, db):
        upsert_events(
            db,
            [
                _ev(symbol="ORCL"),
                _ev(symbol="RELIANCE", exchange="NSE", event_id="edgar:reliance"),
            ],
        )
        us = events_client.get("/api/events/calendar").json()  # default market=us
        assert [event["symbol"] for event in us["events"]] == ["ORCL"]

        india = events_client.get("/api/events/calendar?market=india").json()
        assert [event["symbol"] for event in india["events"]] == ["RELIANCE"]

        both = events_client.get("/api/events/calendar?market=all").json()
        assert len(both["events"]) == 2

    def test_from_and_to_aliases_are_honoured(self, events_client, db):
        today = market_today("us")
        upsert_events(
            db,
            [
                _ev(event_date=today + dt.timedelta(days=3), event_id="near"),
                _ev(symbol="MSFT", event_date=today + dt.timedelta(days=300), event_id="far"),
            ],
        )
        payload = events_client.get(
            f"/api/events/calendar?from={today.isoformat()}"
            f"&to={(today + dt.timedelta(days=30)).isoformat()}"
        ).json()
        assert [event["id"] for event in payload["events"]] == ["near"]

    def test_types_and_symbols_filters(self, events_client, db):
        upsert_events(
            db,
            [
                _ev(event_type="investor_day", event_id="a"),
                _ev(event_type="earnings", source="tv", event_id="b"),
                _ev(symbol="MSFT", event_type="dividend", source="tv", event_id="c"),
            ],
        )
        by_type = events_client.get("/api/events/calendar?types=investor_day").json()
        assert [event["event_type"] for event in by_type["events"]] == ["investor_day"]

        by_symbol = events_client.get("/api/events/calendar?symbols=msft").json()
        assert [event["symbol"] for event in by_symbol["events"]] == ["MSFT"]

    def test_unknown_type_becomes_a_warning(self, events_client, db):
        upsert_events(db, [_ev()])
        payload = events_client.get("/api/events/calendar?types=not_a_type").json()
        assert payload["events"] == []  # filtering by an impossible type
        assert payload["meta"]["warnings"] == ["unknown_event_type:not_a_type"]

    def test_upcoming_only_false_includes_the_past(self, events_client, db):
        today = market_today("us")
        upsert_events(
            db,
            [_ev(event_date=today - dt.timedelta(days=2), event_id="past")],
        )
        upcoming = events_client.get("/api/events/calendar").json()
        assert upcoming["events"] == []

        everything = events_client.get(
            "/api/events/calendar?upcoming_only=false&from=2020-01-01"
            f"&to={(today + dt.timedelta(days=30)).isoformat()}"
        ).json()
        assert [event["id"] for event in everything["events"]] == ["past"]

    def test_unknown_market_is_400(self, events_client):
        response = events_client.get("/api/events/calendar?market=mars")
        assert response.status_code == 400

    def test_limit_is_clamped_to_the_documented_bounds(self, events_client, monkeypatch):
        calls: list[int] = []

        def fake_list(session, **kwargs):
            calls.append(kwargs["limit"])
            return []

        monkeypatch.setattr(router_module, "list_events", fake_list)
        events_client.get("/api/events/calendar?limit=99999")
        events_client.get("/api/events/calendar?limit=-3")
        events_client.get("/api/events/calendar?limit=250")

        assert calls == [2000, 1, 250]

    def test_read_failure_is_503_not_500(self, events_client, monkeypatch):
        def boom(*args, **kwargs):
            raise RuntimeError("db exploded")

        monkeypatch.setattr(router_module, "list_events", boom)
        response = events_client.get("/api/events/calendar")
        assert response.status_code == 503
        assert response.json()["detail"] == "event_calendar_unavailable"


class TestToday:
    def test_defaults_to_all_markets_and_today(self, events_client, db):
        today = market_today("us")
        upsert_events(
            db,
            [
                _ev(event_date=today, event_id="us-today"),
                _ev(symbol="RELIANCE", exchange="NSE", event_date=today,
                    event_id="in-today"),
                _ev(symbol="MSFT", event_date=today + dt.timedelta(days=1),
                    event_id="tomorrow"),
            ],
        )
        payload = events_client.get("/api/events/today").json()
        ids = {event["id"] for event in payload["events"]}
        assert ids == {"us-today", "in-today"}
        assert all(event["days_until"] == 0 for event in payload["events"])

    def test_ordered_by_event_type_priority(self, events_client, db):
        today = market_today("us")
        upsert_events(
            db,
            [
                _ev(symbol="AAA", event_type="dividend", source="tv", event_date=today,
                    event_id="div"),
                _ev(symbol="BBB", event_type="earnings", source="tv", event_date=today,
                    event_id="earn"),
                _ev(symbol="CCC", event_type="investor_day", event_date=today,
                    event_id="inv"),
            ],
        )
        payload = events_client.get("/api/events/today?market=all").json()
        assert [event["id"] for event in payload["events"]] == ["inv", "earn", "div"]

    def test_empty_day(self, events_client):
        payload = events_client.get("/api/events/today").json()
        assert payload == {
            "events": [],
            "meta": {
                "as_of": payload["meta"]["as_of"],
                "scanned": 0,
                "sources": {},
                "warnings": [],
            },
        }


class TestAnomalies:
    def _seed(self, db, day: dt.date):
        from api.event_radar.contract import Anomaly

        save_anomalies(
            db,
            [
                Anomaly(
                    symbol="ORCL",
                    ts=f"{day.isoformat()}T14:19:00-04:00",
                    price=131.27,
                    ret_pct=1.23,
                    ret_sigma=24.49,
                    vol_ratio=56.55,
                    has_known_event=False,
                    suspected="volume 56.6x, 24.5 sigma",
                )
            ],
            market="us",
        )

    def test_shape_and_thresholds(self, events_client, db):
        day = market_today("us")
        self._seed(db, day)

        payload = events_client.get(f"/api/events/anomalies?date={day.isoformat()}").json()

        assert set(payload) == {"anomalies", "meta"}
        assert len(payload["anomalies"]) == 1
        anomaly = payload["anomalies"][0]
        assert set(anomaly) == ANOMALY_KEYS
        assert anomaly["symbol"] == "ORCL"
        assert anomaly["ts"].endswith("-04:00")

        meta = payload["meta"]
        assert set(meta) == {"as_of", "date", "scanned", "thresholds", "warnings"}
        assert meta["date"] == day.isoformat()
        assert meta["scanned"] == 1
        assert meta["thresholds"] == {
            "ret_sigma": ANOMALY_RET_SIGMA,
            "vol_mult": ANOMALY_VOL_MULT,
            "min_abs_ret": ANOMALY_MIN_ABS_RET,
            "cooldown_min": ANOMALY_COOLDOWN_MIN,
        }

    def test_defaults_to_today_et(self, events_client, db):
        self._seed(db, market_today("us"))
        payload = events_client.get("/api/events/anomalies").json()
        assert len(payload["anomalies"]) == 1

    def test_read_failure_is_503(self, events_client, monkeypatch):
        def boom(*args, **kwargs):
            raise RuntimeError("db exploded")

        monkeypatch.setattr(router_module, "list_anomalies", boom)
        assert events_client.get("/api/events/anomalies").status_code == 503


class TestRefresh:
    def test_inserts_and_is_idempotent(self, events_client, db, monkeypatch):
        events = [_ev(event_id="refresh-1"), _ev(symbol="MSFT", event_id="refresh-2")]
        monkeypatch.setattr(router_module, "refresh_calendar", lambda **kwargs: events)

        first = events_client.post("/api/events/refresh")
        assert first.status_code == 200
        assert first.json() == {"ok": True, "inserted": 2}

        second = events_client.post("/api/events/refresh")
        assert second.json() == {"ok": True, "inserted": 0}

    def test_upstream_failure_is_503(self, events_client, monkeypatch):
        def boom(**kwargs):
            raise RuntimeError("event_source_unavailable: tv: HTTP 503")

        monkeypatch.setattr(router_module, "refresh_calendar", boom)
        response = events_client.post("/api/events/refresh")
        assert response.status_code == 503
        assert response.json()["detail"] == "event_source_unavailable"

    def test_write_failure_is_503(self, events_client, monkeypatch):
        monkeypatch.setattr(router_module, "refresh_calendar", lambda **kwargs: [_ev()])

        def boom(*args, **kwargs):
            raise RuntimeError("disk full")

        monkeypatch.setattr(router_module, "upsert_events", boom)
        response = events_client.post("/api/events/refresh")
        assert response.status_code == 503
        assert response.json()["detail"] == "event_store_unavailable"


class TestRefreshCalendar:
    def test_partial_source_failure_still_returns_events(self, monkeypatch):
        from api.event_radar.sources import edgar, tradingview

        good = _ev(event_id="edgar:good")

        monkeypatch.setattr(edgar, "fetch_events", lambda *a, **k: [good])

        def dead(*args, **kwargs):
            raise RuntimeError("tv_source_unavailable: HTTP 503")

        monkeypatch.setattr(tradingview, "fetch_events", dead)

        events = router_module.refresh_calendar(client=object())
        assert [event.id for event in events] == ["edgar:good"]

    def test_both_sources_dead_raises(self, monkeypatch):
        from api.event_radar.sources import edgar, tradingview

        def dead(*args, **kwargs):
            raise RuntimeError("HTTP 503")

        monkeypatch.setattr(edgar, "fetch_events", dead)
        monkeypatch.setattr(tradingview, "fetch_events", dead)

        with pytest.raises(RuntimeError, match="event_source_unavailable"):
            router_module.refresh_calendar(client=object())

    def test_empty_result_is_not_an_error(self, monkeypatch):
        from api.event_radar.sources import edgar, tradingview

        monkeypatch.setattr(edgar, "fetch_events", lambda *a, **k: [])
        monkeypatch.setattr(tradingview, "fetch_events", lambda *a, **k: [])
        assert router_module.refresh_calendar(client=object()) == []
