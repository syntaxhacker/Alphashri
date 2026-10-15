"""Tests for GET /api/reports/delivery + /api/reports/events (fully mocked I/O)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.reports_api.delivery as d


BHAVCOPY = """SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
RELIANCE, EQ, 09-Oct-2026, 1500.0, 1510.0, 1520.0, 1505.0, 1515.0, 1515.5, 1514.0, 100000, 1514.0, 5000, 65000, 65.00
TCS, EQ, 09-Oct-2026, 4100.0, 4110.0, 4120.0, 4090.0, 4105.0, 4106.0, 4100.0, 50000, 2050.0, 3000, 10000, 20.00
RELIANCE, BE, 09-Oct-2026, 1500.0, 1510.0, 1520.0, 1505.0, 1515.0, 1515.5, 1514.0, 10, 1.0, 5, 9, 90.00
NIFTY, IDX, 09-Oct-2026, 25000.0, 25100.0, 25200.0, 25050.0, 25150.0, 25150.0, 25100.0, 0, 0.0, 0, 0, 0.00
"""


def _app():
    app = FastAPI()
    app.include_router(d.router)
    return app


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(d, "_fetch_bhavcopy", lambda day: BHAVCOPY)
    monkeypatch.setattr(d, "_universe_symbols", lambda uid, cap: ["RELIANCE", "TCS"])
    d.clear_cache()
    # isolate disk cache
    monkeypatch.setattr(d, "DELIVERY_DIR", d.DELIVERY_DIR / "test_tmp")
    monkeypatch.setattr(d, "EVENTS_DIR", d.EVENTS_DIR / "test_tmp")
    yield TestClient(_app())
    d.clear_cache()


def test_parse_bhavcopy_eq_only():
    parsed = d._parse_bhavcopy(BHAVCOPY)
    assert set(parsed) == {"RELIANCE", "TCS"}
    assert parsed["RELIANCE"]["delivery_pct"] == 65.0
    assert parsed["RELIANCE"]["delivery_qty"] == 65000
    assert parsed["TCS"]["close"] == 4106.0


def test_delivery_sorted_desc_and_shape(client):
    r = client.get("/api/reports/delivery?date=2026-10-09&universe=nifty500&limit=10")
    assert r.status_code == 200
    body = r.json()
    assert body["date"] == "2026-10-09"
    assert body["source"] == "nse-bhavcopy"
    assert [row["symbol"] for row in body["rows"]] == ["RELIANCE", "TCS"]
    assert body["rows"][0]["delivery_pct"] == 65.0


def test_delivery_fail_soft(client, monkeypatch):
    monkeypatch.setattr(d, "_fetch_bhavcopy", lambda day: None)
    monkeypatch.setattr(d, "_read_delivery_disk", lambda day: None)
    d.clear_cache()
    r = client.get("/api/reports/delivery?date=2026-10-09")
    assert r.status_code == 200
    assert r.json()["rows"] == []


def test_delivery_walkback_to_previous_session(client, monkeypatch):
    calls = []

    def _fetch(day):
        calls.append(day)
        return BHAVCOPY if day == "2026-10-08" else None

    monkeypatch.setattr(d, "_fetch_bhavcopy", lambda day: _fetch(day))
    monkeypatch.setattr(d, "_read_delivery_disk", lambda day: None)
    monkeypatch.setattr(d, "_write_delivery_disk", lambda day, payload: None)
    d.clear_cache()
    r = client.get("/api/reports/delivery?date=2026-10-09")
    assert r.status_code == 200
    body = r.json()
    assert body["date"] == "2026-10-08"
    assert len(body["rows"]) == 2


def test_events_from_yfinance_facts(client, monkeypatch):
    def _facts(sym):
        return {
            "symbol": sym,
            "earnings": [{"date": "2026-10-16", "eps_estimate": 12.3, "reported_eps": None}],
            "ex_div": {"date": "2026-10-20"},
            "dividends": [{"date": "2026-09-01", "amount": 9.0}],
            "splits": [{"date": "2026-10-25", "ratio": 2.0}],
        }

    monkeypatch.setattr(d, "_fetch_symbol_events", _facts)
    d.clear_cache()
    r = client.get("/api/reports/events?from=2026-10-10&to=2026-10-31&symbols=RELIANCE,TCS")
    assert r.status_code == 200
    body = r.json()
    kinds = {(e["symbol"], e["kind"]) for e in body["events"]}
    assert ("RELIANCE", "results") in kinds
    assert ("RELIANCE", "dividend") in kinds  # ex-div 10-20 in window
    assert ("RELIANCE", "split") in kinds  # 10-25 in window
    # Sep dividend is outside the window
    assert not any(e["kind"] == "dividend" and "Rs.9" in e["title"] for e in body["events"])
    assert body["symbols_covered"] == 2
    assert body["symbols_total"] == 2


def test_events_window_defaults_and_sort(client, monkeypatch):
    monkeypatch.setattr(
        d, "_fetch_symbol_events",
        lambda sym: {"symbol": sym, "earnings": [{"date": "2030-01-05"}],
                     "ex_div": None, "dividends": [], "splits": []},
    )
    d.clear_cache()
    r = client.get("/api/reports/events?symbols=INFY")
    assert r.status_code == 200
    body = r.json()
    assert body["from"] <= body["to"]
    assert body["events"] == []  # 2030 outside the default ~14d window


def test_events_fail_soft(client, monkeypatch):
    def _boom(sym):
        raise RuntimeError("yfinance down")

    monkeypatch.setattr(d, "_fetch_symbol_events", _boom)
    d.clear_cache()
    r = client.get("/api/reports/events?symbols=RELIANCE")
    assert r.status_code == 200
    assert r.json()["events"] == []


def test_facts_to_events_dedupes_and_filters():
    facts = {
        "symbol": "RELIANCE",
        "earnings": [{"date": "2026-10-16"}, {"date": "2026-10-16", "eps_estimate": 12.3}],
        "ex_div": {"date": "2026-10-16"},
        "dividends": [],
        "splits": [],
    }
    out = d._facts_to_events(facts, "2026-10-10", "2026-10-31")
    results = [e for e in out if e["kind"] == "results"]
    assert len(results) == 1
    assert "est EPS 12.3" in results[0]["title"]
    assert any(e["kind"] == "dividend" for e in out)
    assert any(e["kind"] == "dividend" for e in out)
    assert d._facts_to_events(facts, "2026-11-01", "2026-11-30") == []
