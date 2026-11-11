"""Tests for GET /api/reports/events/upcoming + /recent (fully mocked I/O)."""

from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.reports_api.events_feed as ef


def _app():
    app = FastAPI()
    app.include_router(ef.router)
    return app


def _rows(*items):
    """(day, symbol, headline, source, name) -> raw news rows."""
    out = []
    for i, (day, sym, headline, source, name) in enumerate(items):
        out.append({
            "article_id": 1000 + i,
            "headline": headline,
            "content": "",
            "source": source,
            "day": day,
            "symbol": sym,
            "name": name,
        })
    return out


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(ef, "_resolve_symbols", lambda csv, uid, cap: ["TCS", "RELIANCE"])
    # Deterministic stand-in for trading.symbol_aliases.resolve_symbol
    # (the real resolver is covered in tests/test_symbol_aliases.py).
    _aliases = {"PTC": "PTCIL"}
    monkeypatch.setattr(ef, "resolve_symbol", lambda s: _aliases.get(str(s or "").upper(), str(s or "").upper() or None))
    monkeypatch.setattr(
        ef, "_fetch_symbol_events",
        # Relative, because the endpoint applies a rolling N-day window:
        # a hardcoded date silently falls out of it as the calendar moves.
        lambda sym: {"symbol": sym,
                     "earnings": [{"date": (date.today() - timedelta(days=2)).isoformat()}],
                     "ex_div": None, "dividends": [], "splits": []},
    )
    monkeypatch.setattr(ef, "_query_news_rows", lambda s, e: [])
    ef.clear_cache()
    yield TestClient(_app())
    ef.clear_cache()


# --- keyword classification ---


def test_classify_qip():
    assert ef.classify_news_kind("PTC Industries shares rise after company launches QIP") == "qip"


def test_classify_order_and_contract():
    assert ef.classify_news_kind("RailTel bags Rs 200 cr order from Railways") == "order"
    assert ef.classify_news_kind("L&T wins contract for bullet train project") == "order"


def test_classify_upgrade():
    assert ef.classify_news_kind("Morgan Stanley upgrades HDFC Bank, raises target") == "upgrade"


def test_classify_results():
    assert ef.classify_news_kind("TCS shares gain ahead of Q2 results") == "results"
    assert ef.classify_news_kind("Net profit jumps 20% on strong earnings") == "results"


def test_classify_update_default_and_business_update():
    assert ef.classify_news_kind("Q2 business updates: Senco Gold shares jump 12%") == "update"
    assert ef.classify_news_kind("Kalyan says Q2 sales rose 26% YoY, issues guidance") == "update"
    assert ef.classify_news_kind("Some completely unrelated market headline") == "update"


def test_classify_corporate_actions():
    assert ef.classify_news_kind("Board declares interim dividend of Rs 9") == "dividend"
    assert ef.classify_news_kind("Company announces 2:1 stock split") == "split"
    assert ef.classify_news_kind("Board approves bonus issue 1:1") == "bonus"
    assert ef.classify_news_kind("AGM scheduled for shareholders next month") == "agm"


def test_classify_never_raises():
    assert ef.classify_news_kind(None, None) == "update"


def test_classify_headline_wins_over_body_noise():
    assert ef.classify_news_kind(
        "Fortis says it was stranger to Daiichi dispute",
        "court order issued in order to settle the matter",
    ) == "update"
    # blank headline falls back to content
    assert ef.classify_news_kind("", "company launches QIP to raise funds") == "qip"


# --- upcoming ---


def test_upcoming_shape_and_sort(client, monkeypatch):
    monkeypatch.setattr(
        ef, "_query_news_rows",
        lambda s, e: _rows(
            ((date.today() - timedelta(days=1)).isoformat(), "TCS",
             "TCS keeps lower outlay for quarterly variable pay in Q2", "moneycontrol", "TATA CONSULTANCY SERV LT"),
            ((date.today() - timedelta(days=3)).isoformat(), "PTC",
             "PTC Industries shares rise after company launches QIP", "moneycontrol", "PTC INDIA LIMITED"),
        ),
    )
    monkeypatch.setattr(ef, "_resolve_symbols", lambda csv, uid, cap: ["TCS", "RELIANCE", "PTCIL"])
    ef.clear_cache()
    r = client.get("/api/reports/events/upcoming?days=14&universe=nifty500")
    assert r.status_code == 200
    body = r.json()
    assert "as_of" in body and body["as_of"]
    assert isinstance(body["events"], list)
    for ev in body["events"]:
        assert set(("date", "symbol", "name", "kind", "title", "source")) <= set(ev)
        assert ev["kind"] in ("results", "update", "qip", "order", "upgrade",
                              "dividend", "split", "bonus", "agm")
    dates = [e["date"] for e in body["events"]]
    assert dates == sorted(dates)
    kinds = {(e["symbol"], e["kind"]) for e in body["events"]}
    assert ("TCS", "results") in kinds  # earnings date lands inside the window
    assert ("PTCIL", "qip") in kinds  # news PTC resolved via symbol alias


def test_upcoming_news_dedupes_duplicate_mentions(client, monkeypatch):
    rows = _rows(
        ("2026-10-08", "TCS", "TCS shares gain 2.6% ahead of Q2 results", "moneycontrol", "TATA CONSULTANCY SERV LT"),
        ("2026-10-08", "TCS", "TCS shares gain 2.6% ahead of Q2 results", "moneycontrol", "TATA CONSULTANCY SERV LT"),
    )
    rows[1]["article_id"] = rows[0]["article_id"]  # same article, two mention rows
    monkeypatch.setattr(ef, "_query_news_rows", lambda s, e: rows)
    monkeypatch.setattr(ef, "_fetch_symbol_events",
                        lambda sym: {"symbol": sym, "earnings": [], "ex_div": None,
                                     "dividends": [], "splits": []})
    ef.clear_cache()
    r = client.get("/api/reports/events/upcoming?days=14")
    assert r.status_code == 200
    news_ev = [e for e in r.json()["events"] if e["source"] != "yfinance"]
    assert len(news_ev) == 1
    assert news_ev[0]["kind"] == "results"
    assert news_ev[0]["name"] == "TATA CONSULTANCY SERV LT"


# --- recent ---


def test_recent_trailing_window(client, monkeypatch):
    monkeypatch.setattr(
        ef, "_fetch_symbol_events",
        lambda sym: {"symbol": sym,
                     "earnings": [{"date": "2026-10-05", "reported_eps": 31.2}],
                     "ex_div": None, "dividends": [], "splits": []},
    )
    monkeypatch.setattr(
        ef, "_query_news_rows",
        lambda s, e: _rows(
            ("2026-10-09", "TCS", "Q2 business updates: TCS shares in focus", "moneycontrol", "TCS"),
            ("2026-09-01", "TCS", "Stale headline from last month", "moneycontrol", "TCS"),
        ),
    )
    monkeypatch.setattr(ef, "_today_str", lambda: "2026-10-11")
    ef.clear_cache()
    r = client.get("/api/reports/events/recent?days=7")
    assert r.status_code == 200
    body = r.json()
    assert "as_of" in body
    evs = body["events"]
    assert evs, "expected recent results + update events"
    assert all("2026-10-04" <= e["date"] <= "2026-10-11" for e in evs)
    assert not any(e["title"] == "Stale headline from last month" for e in evs)
    assert any(e["kind"] == "results" for e in evs)
    assert any(e["kind"] == "update" for e in evs)


# --- fail-soft + cache ---


def test_fail_soft_yf_and_db_down(client, monkeypatch):
    def _boom(sym):
        raise RuntimeError("yfinance down")

    def _db_boom(s, e):
        raise RuntimeError("db down")

    monkeypatch.setattr(ef, "_fetch_symbol_events", _boom)
    monkeypatch.setattr(ef, "_query_news_rows", _db_boom)
    ef.clear_cache()
    for path in ("/api/reports/events/upcoming?days=14", "/api/reports/events/recent?days=7"):
        r = client.get(path)
        assert r.status_code == 200
        assert r.json()["events"] == []


def test_mem_cache_second_hit_cached(client):
    r1 = client.get("/api/reports/events/upcoming?days=14")
    assert r1.status_code == 200
    assert r1.json()["cached"] is False
    r2 = client.get("/api/reports/events/upcoming?days=14")
    assert r2.status_code == 200
    assert r2.json()["cached"] is True
    assert r2.json()["events"] == r1.json()["events"]


# --- regime (Nifty 50 vs 20DMA) ---


def _regime_client(monkeypatch, closes):
    monkeypatch.setattr(ef, "_fetch_nifty_closes", lambda: closes)
    monkeypatch.setattr(ef, "_read_regime_disk", lambda: None)
    monkeypatch.setattr(ef, "_write_regime_disk", lambda c: None)
    ef.clear_cache()
    return TestClient(_app())


def test_regime_above_dma(monkeypatch):
    client = _regime_client(monkeypatch, [100.0] * 20 + [110.0])
    r = client.get("/api/reports/events/regime")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "^NSEI"
    assert body["close"] == 110.0
    assert body["dma20"] == pytest.approx((100.0 * 19 + 110.0) / 20)
    assert body["above"] is True
    assert body["cached"] is False
    assert "20" in body["rule"]


def test_regime_below_dma(monkeypatch):
    client = _regime_client(monkeypatch, [110.0] * 20 + [100.0])
    r = client.get("/api/reports/events/regime")
    assert r.status_code == 200
    body = r.json()
    assert body["above"] is False
    assert body["dma20"] == pytest.approx((110.0 * 19 + 100.0) / 20)


def test_regime_short_history_null_dma(monkeypatch):
    client = _regime_client(monkeypatch, [100.0] * 10)
    r = client.get("/api/reports/events/regime")
    assert r.status_code == 200
    body = r.json()
    assert body["close"] == 100.0
    assert body["dma20"] is None
    assert body["above"] is None


def test_regime_fail_soft_nulls(monkeypatch):
    client = _regime_client(monkeypatch, None)
    r = client.get("/api/reports/events/regime")
    assert r.status_code == 200
    body = r.json()
    assert body["close"] is None
    assert body["dma20"] is None
    assert body["above"] is None


def test_regime_mem_cache_second_hit_cached(monkeypatch):
    client = _regime_client(monkeypatch, [100.0] * 20 + [110.0])
    r1 = client.get("/api/reports/events/regime")
    assert r1.json()["cached"] is False
    r2 = client.get("/api/reports/events/regime")
    assert r2.status_code == 200
    assert r2.json()["cached"] is True
    assert r2.json()["close"] == r1.json()["close"]
