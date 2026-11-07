"""The daily market report must not do blocking work on the event loop.

``_build_payload`` reaches yfinance (``_fetch_index``) and the sparkline
fetcher — both blocking. It used to run inline inside the ``async def``
handler, so a slow upstream stalled every other request on the desk
(``/health`` included).
"""

import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.reports_api.market as m


class _FakeDF:
    def __init__(self, rows):
        self._rows = rows
        self.empty = not rows

    def to_dict(self, orient="records"):
        assert orient == "records"
        return list(self._rows)


def _row(sym):
    return {
        "name": sym, "close": 100.0, "change": 1.0, "volume": 1000.0,
        "average_volume_10d_calc": 1000.0, "relative_volume_10d_calc": 1.0,
        "market_cap_basic": 1e10, "logoid": "abc-123", "gap": 0.0,
        "price_52_week_high": 200.0, "price_52_week_low": 50.0, "ATR": 2.0,
        "high": 101.0, "low": 99.0, "open": 100.0, "Value.Traded": 1e8,
        "RSI": 55.0, "VWAP": 100.0, "sector": "X", "industry": "Y",
    }


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(m, "_fetch_sparks", lambda syms: {s: [0.0, 1.0] for s in syms})
    monkeypatch.setattr(m, "_fetch_index", lambda records=None: None)
    m.clear_cache()
    app = FastAPI()
    app.include_router(m.router)
    return TestClient(app)


def test_payload_build_runs_off_the_event_loop(client, monkeypatch):
    monkeypatch.setattr(m, "_fetch_tv_frame", lambda: _FakeDF([_row("AAA")]))
    monkeypatch.setattr("chart_patterns.universes.get_universe", lambda uid: ["AAA"])

    seen: dict = {}
    original = m._build_payload

    def _spy(day, universe, records):
        seen["thread"] = threading.current_thread()
        return original(day, universe, records)

    monkeypatch.setattr(m, "_build_payload", _spy)
    resp = client.get("/api/reports/daily")
    assert resp.status_code == 200
    assert seen["thread"] is not threading.main_thread()
