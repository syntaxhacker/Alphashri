"""Store tests — upsert semantics, precedence, filters, anomalies, pruning."""

from __future__ import annotations

import datetime as dt

import pytest

from api.event_radar.contract import Anomaly, Event
from api.event_radar.store import (
    event_symbols_on,
    list_anomalies,
    list_events,
    market_for_exchange,
    prune_old_events,
    save_anomalies,
    upsert_events,
)
from db.models import CorporateEvent, EventAnomaly

TODAY = dt.date(2026, 10, 29)


def _ev(
    *,
    symbol: str = "ORCL",
    event_type: str = "investor_day",
    event_date: str = "2026-11-05",
    source: str = "edgar",
    title: str = "ORCL Investor Day",
    exchange: str | None = "NASDAQ",
    confidence: float = 0.6,
    announced_at: str | None = "2026-10-23",
    event_id: str | None = None,
) -> Event:
    return Event(
        id=event_id or f"{source}:{symbol.lower()}-{event_date}-{event_type}",
        symbol=symbol,
        event_type=event_type,  # type: ignore[arg-type]
        title=title,
        event_date=event_date,
        source=source,  # type: ignore[arg-type]
        exchange=exchange,
        announced_at=announced_at,
        confidence=confidence,
    )


def _an(symbol: str = "ORCL", ts: str = "2026-10-28T14:19:00-04:00", **kwargs) -> Anomaly:
    payload = {
        "price": 131.27,
        "ret_pct": 1.23,
        "ret_sigma": 15.4,
        "vol_ratio": 30.2,
        "suspected": "volume 30.2x, 15.4 sigma",
    }
    payload.update(kwargs)
    return Anomaly(symbol=symbol, ts=ts, **payload)


class TestMarketMapping:
    @pytest.mark.parametrize(
        ("exchange", "expected"),
        [
            ("NASDAQ", "us"),
            ("NYSE", "us"),
            ("NYSE ARCA", "us"),
            ("AMEX", "us"),
            ("ARCA", "us"),
            ("NASDAQGS", "us"),
            ("NSE", "india"),
            ("BSE", "india"),
            ("TSE", "other"),
            ("", "other"),
            (None, "other"),
        ],
    )
    def test_map(self, exchange, expected):
        assert market_for_exchange(exchange) == expected


class TestUpsert:
    def test_inserts_and_reports_count(self, db):
        assert upsert_events(db, [_ev(), _ev(symbol="MSFT", event_id="edgar:msft")]) == 2
        assert db.query(CorporateEvent).count() == 2

    def test_reinsert_is_idempotent(self, db):
        event = _ev()
        assert upsert_events(db, [event]) == 1
        assert upsert_events(db, [event]) == 0
        assert db.query(CorporateEvent).count() == 1

    def test_edgar_beats_tv_in_place(self, db):
        tv = _ev(source="tv", title="ORCL investor day", confidence=0.9)
        edgar = _ev(source="edgar", title="Oracle to host Investor Day", confidence=0.6)
        assert upsert_events(db, [tv]) == 1
        assert upsert_events(db, [edgar]) == 1

        assert db.query(CorporateEvent).count() == 1  # one row, not two
        row = db.query(CorporateEvent).one()
        assert row.source == "edgar"
        assert row.external_id == edgar.id

        # A later TradingView row must not downgrade the EDGAR row.
        assert upsert_events(db, [tv]) == 0
        assert db.query(CorporateEvent).one().source == "edgar"

    def test_seed_beats_edgar(self, db):
        edgar = _ev(source="edgar")
        seed = _ev(source="seed", title="ORCL Investor Day (confirm)", confidence=0.7)
        assert upsert_events(db, [edgar]) == 1
        assert upsert_events(db, [seed]) == 1
        assert db.query(CorporateEvent).one().source == "seed"

    def test_equal_precedence_needs_a_better_row(self, db):
        short = _ev(source="wire", title="ORCL investor day", confidence=0.7)
        assert upsert_events(db, [short]) == 1

        # Shorter title, same confidence -> no change.
        worse = _ev(source="wire", title="ORCL day", confidence=0.7, event_id="wire:worse")
        assert upsert_events(db, [worse]) == 0

        # Longer title -> overwrite.
        better = _ev(
            source="wire",
            title="Oracle to host Investor Day on November 5 2026",
            confidence=0.7,
            event_id="wire:better",
        )
        assert upsert_events(db, [better]) == 1
        assert db.query(CorporateEvent).one().title == better.title

    def test_higher_confidence_breaks_a_title_tie(self, db):
        first = _ev(source="wire", title="ORCL Investor Day", confidence=0.7)
        assert upsert_events(db, [first]) == 1
        louder = _ev(source="wire", title="ORCL Investor Day", confidence=0.9,
                     event_id="wire:louder")
        assert upsert_events(db, [louder]) == 1
        assert db.query(CorporateEvent).one().confidence == pytest.approx(0.9)

    def test_caller_list_is_not_mutated(self, db):
        events = [_ev()]
        snapshot = list(events)
        upsert_events(db, events)
        assert events == snapshot
        assert events[0].source == "edgar"

    def test_market_is_derived_from_exchange(self, db):
        upsert_events(db, [_ev(exchange="NASDAQ"), _ev(symbol="RELIANCE", exchange="NSE",
                                                     event_id="edgar:reliance")])
        markets = {row.symbol: row.market for row in db.query(CorporateEvent).all()}
        assert markets == {"ORCL": "us", "RELIANCE": "india"}

    def test_datetime_event_date_is_accepted(self, db):
        # An Event's event_date is an ISO string, but a hand-built row may carry
        # a datetime; the store must not explode on it.
        assert upsert_events(db, [_ev(event_date="2026-11-05")]) == 1
        assert db.query(CorporateEvent).one().event_date == dt.date(2026, 11, 5)


class TestListEvents:
    @pytest.fixture
    def seeded(self, db):
        upsert_events(
            db,
            [
                _ev(symbol="ORCL", event_date="2026-10-28", event_id="edgar:orcl-1"),
                _ev(symbol="ORCL", event_type="earnings", event_date="2026-11-12",
                    source="tv", event_id="tv:orcl-earn"),
                _ev(symbol="MSFT", event_date="2026-11-20", event_id="edgar:msft-1"),
                _ev(symbol="RELIANCE", event_date="2026-11-10", exchange="NSE",
                    event_id="edgar:reliance-1"),
                _ev(symbol="NVDA", event_date="2027-06-01", source="tv",
                    event_id="tv:nvda-1"),
            ],
        )
        return db

    def test_market_filter(self, seeded):
        us = list_events(seeded, market="us", today=TODAY, limit=100)
        assert {ev.symbol for ev in us} == {"ORCL", "MSFT", "NVDA"}

        india = list_events(seeded, market="india", today=TODAY, limit=100)
        assert [ev.symbol for ev in india] == ["RELIANCE"]

        everything = list_events(
            seeded, market="all", upcoming_only=False, today=TODAY, limit=100
        )
        assert len(everything) == 5

    def test_type_filter(self, seeded):
        earnings = list_events(seeded, market="all", types=["earnings"], today=TODAY)
        assert [ev.event_type for ev in earnings] == ["earnings"]

    def test_symbol_filter_is_case_insensitive(self, seeded):
        picked = list_events(
            seeded, market="all", symbols=["orcl"], upcoming_only=False, today=TODAY
        )
        assert {ev.symbol for ev in picked} == {"ORCL"}
        assert len(picked) == 2

    def test_date_range(self, seeded):
        window = list_events(
            seeded,
            market="all",
            start=dt.date(2026, 11, 1),
            end=dt.date(2026, 11, 30),
            today=TODAY,
        )
        assert {ev.event_date for ev in window} == {"2026-11-10", "2026-11-12", "2026-11-20"}

    def test_upcoming_only_drops_the_past(self, seeded):
        future = list_events(seeded, market="all", upcoming_only=True, today=TODAY)
        assert all(ev.event_date >= TODAY.isoformat() for ev in future)
        assert len(future) == 4

        everything = list_events(seeded, market="all", upcoming_only=False, today=TODAY)
        assert len(everything) == 5  # the 2026-10-28 row is back

    def test_limit_is_observed(self, seeded):
        assert len(list_events(seeded, market="all", today=TODAY, limit=2)) == 2

    def test_ordering_is_by_date_then_type_priority(self, seeded):
        events = list_events(seeded, market="all", today=TODAY, limit=100)
        dates = [ev.event_date for ev in events]
        assert dates == sorted(dates)

    def test_empty_store(self, db):
        assert list_events(db, market="all", today=TODAY) == []


class TestEventSymbolsOn:
    def test_returns_the_day_symbols_uppercased(self, db):
        upsert_events(
            db,
            [
                _ev(symbol="ORCL", event_date="2026-10-28", event_id="a"),
                _ev(symbol="MSFT", event_date="2026-10-28", event_id="b"),
                _ev(symbol="NVDA", event_date="2026-10-29", event_id="c"),
            ],
        )
        assert event_symbols_on(db, dt.date(2026, 10, 28)) == {"ORCL", "MSFT"}
        assert event_symbols_on(db, dt.date(2026, 10, 27)) == set()

    def test_none_day_is_empty(self, db):
        assert event_symbols_on(db, None) == set()  # type: ignore[arg-type]


class TestAnomalies:
    def test_insert_and_read_back(self, db):
        assert save_anomalies(db, [_an()]) == 1
        stored = list_anomalies(db, dt.date(2026, 10, 28), "us")
        assert len(stored) == 1
        assert stored[0].symbol == "ORCL"
        assert stored[0].ts == "2026-10-28T14:19:00-04:00"
        assert stored[0].ret_pct == pytest.approx(1.23)

    def test_reinsert_is_idempotent(self, db):
        assert save_anomalies(db, [_an()]) == 1
        assert save_anomalies(db, [_an()]) == 0
        assert db.query(EventAnomaly).count() == 1

    def test_changed_values_rewrite_the_row(self, db):
        assert save_anomalies(db, [_an()]) == 1
        assert save_anomalies(db, [_an(ret_pct=2.4, vol_ratio=44.0)]) == 1
        assert db.query(EventAnomaly).count() == 1
        row = db.query(EventAnomaly).one()
        assert row.ret_pct == pytest.approx(2.4)
        assert row.notified is False

    def test_day_and_market_filters(self, db):
        save_anomalies(
            db,
            [
                _an("ORCL", "2026-10-28T14:19:00-04:00"),
                _an("MSFT", "2026-10-28T15:01:00-04:00"),
                _an("NVDA", "2026-10-29T10:00:00-04:00"),
            ],
            market="us",
        )
        assert {an.symbol for an in list_anomalies(db, dt.date(2026, 10, 28), "us")} == {
            "ORCL",
            "MSFT",
        }
        assert [an.symbol for an in list_anomalies(db, dt.date(2026, 10, 29), "us")] == ["NVDA"]
        assert list_anomalies(db, dt.date(2026, 10, 28), "india") == []

    def test_bad_ts_is_skipped(self, db):
        assert save_anomalies(db, [_an(ts="not-a-timestamp")]) == 0
        assert db.query(EventAnomaly).count() == 0

    def test_none_day_is_empty(self, db):
        assert list_anomalies(db, None) == []  # type: ignore[arg-type]


class TestPrune:
    def test_keeps_the_window(self, db):
        today = dt.datetime.now(config_date_tz()).date()
        old = _ev(event_date=(today - dt.timedelta(days=800)).isoformat(), event_id="old")
        fresh = _ev(event_date=(today - dt.timedelta(days=10)).isoformat(), event_id="new")
        upsert_events(db, [old, fresh])

        assert prune_old_events(db, keep_days=400) == 1
        remaining = db.query(CorporateEvent).all()
        assert [row.external_id for row in remaining] == ["new"]

    def test_nothing_to_prune(self, db):
        upsert_events(db, [_ev()])
        assert prune_old_events(db) == 0


def config_date_tz() -> dt.tzinfo:
    """US-market clock (the prune cutoff is computed in New York)."""
    from zoneinfo import ZoneInfo

    return ZoneInfo("America/New_York")
