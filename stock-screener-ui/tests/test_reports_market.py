"""Tests for GET /api/reports/daily (mocked TV + mocked candles)."""

import json
import math

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


def _row(sym, **kw):
    base = {
        "name": sym,
        "close": 100.0,
        "change": 0.0,
        "volume": 1000.0,
        "average_volume_10d_calc": 1000.0,
        "relative_volume_10d_calc": 1.0,
        "market_cap_basic": 1e10,
        "logoid": "abc-123",
        "gap": 0.0,
        "price_52_week_high": 200.0,
        "price_52_week_low": 50.0,
        "ATR": 2.0,
        "high": 101.0,
        "low": 99.0,
        "open": 100.0,
        "Value.Traded": 1e8,
        "RSI": 55.0,
        "VWAP": 100.0,
        "sector": "X",
        "industry": "Y",
    }
    base.update(kw)
    return base


def _app():
    app = FastAPI()
    app.include_router(m.router)
    return app


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(m, "_fetch_sparks", lambda syms: {s: [0.0, 1.0] for s in syms})
    monkeypatch.setattr(m, "_fetch_index", lambda records=None: None)
    m.clear_cache()
    return TestClient(_app())


def _setup(monkeypatch, rows, universe=("AAA", "BBB", "CCC", "DDD", "EEE", "FFF")):
    monkeypatch.setattr(m, "_fetch_tv_frame", lambda: _FakeDF(rows))
    monkeypatch.setattr(
        "chart_patterns.universes.get_universe", lambda uid: list(universe)
    )


def test_breadth_and_panels(client, monkeypatch):
    rows = [
        _row("AAA", change=5.0, volume=5000.0, relative_volume_10d_calc=4.0,
             gap=4.0, close=200.0, price_52_week_high=200.0, high=110.0, low=90.0,
             **{"Value.Traded": 5e9}),
        _row("BBB", change=-4.0, volume=5000.0, relative_volume_10d_calc=5.0,
             gap=-4.0, close=50.0, price_52_week_low=50.0,
             **{"Value.Traded": 4e9}),
        _row("CCC", change=1.0, volume=500.0, relative_volume_10d_calc=1.0,
             gap=0.5, **{"Value.Traded": 1e8}),
        _row("DDD", change=0.0, volume=100.0, **{"Value.Traded": 1e7}),
        _row("EEE", change=2.0, volume=2000.0, average_volume_10d_calc=1000.0,
             gap=0.0, **{"Value.Traded": 2e8}),
        _row("FFF", change=-1.0, volume=2000.0, average_volume_10d_calc=1000.0,
             gap=0.0, **{"Value.Traded": 3e8}),
    ]
    _setup(monkeypatch, rows)
    r = client.get("/api/reports/daily?universe=nifty500")
    assert r.status_code == 200
    body = r.json()
    b = body["breadth"]
    assert b["total"] == 6
    assert b["advances"] == 3  # AAA, CCC, EEE
    assert b["declines"] == 2  # BBB, FFF
    assert b["unchanged"] == 1  # DDD
    assert b["new_highs"] == 1 and body["moves"]["new_52w_high"][0]["symbol"] == "AAA"
    assert b["new_lows"] == 1 and body["moves"]["new_52w_low"][0]["symbol"] == "BBB"
    assert b["avg_change"] == pytest.approx((5 - 4 + 1 + 0 + 2 - 1) / 6)
    assert b["median_change"] == pytest.approx(0.5)
    # up_volume: AAA, EEE (change>0 and vol>=avg); CCC vol 500 < avg 1000 excluded
    assert b["up_volume"] == 2
    # down_volume: BBB, FFF
    assert b["down_volume"] == 2

    mv = body["moves"]
    assert [x["symbol"] for x in mv["gainers"]][:2] == ["AAA", "EEE"]
    assert [x["symbol"] for x in mv["losers"]][:2] == ["BBB", "FFF"]
    # volume_surge: relvol>=3 desc -> BBB(5), AAA(4)
    assert [x["symbol"] for x in mv["volume_surge"]] == ["BBB", "AAA"]
    assert [x["symbol"] for x in mv["gap_up"]] == ["AAA"]
    assert [x["symbol"] for x in mv["gap_down"]] == ["BBB"]
    # range_expansion: AAA (20/2=10) first
    assert mv["range_expansion"][0]["symbol"] == "AAA"
    # turnover desc
    assert [x["symbol"] for x in mv["turnover"]][:3] == ["AAA", "BBB", "FFF"]
    # turnover formatting
    assert "Cr" in mv["turnover"][0]["sub_value"]
    # row shape
    row = mv["gainers"][0]
    for key in ("symbol", "name", "close", "change", "logo", "sub_label",
                "sub_value", "spark", "rsi", "vwap", "atr",
                "price_52_week_high", "market_cap"):
        assert key in row
    assert row["spark"] == [0.0, 1.0]
    assert row["logo"] == "https://s3-symbol-logo.tradingview.com/abc-123.svg"


def test_logo_null_cases(client, monkeypatch):
    rows = [
        _row("AAA", logoid=None),
        _row("BBB", logoid="0"),
        _row("CCC", logoid="bad slug!"),
        _row("DDD", logoid="None"),
        _row("EEE", logoid="ok-99"),
    ]
    _setup(monkeypatch, rows, universe=("AAA", "BBB", "CCC", "DDD", "EEE"))
    body = client.get("/api/reports/daily?universe=nifty500").json()
    by_sym = {r["symbol"]: r for r in body["moves"]["gainers"]}
    assert by_sym["AAA"]["logo"] is None
    assert by_sym["BBB"]["logo"] is None
    assert by_sym["CCC"]["logo"] is None
    assert by_sym["DDD"]["logo"] is None
    assert by_sym["EEE"]["logo"] == "https://s3-symbol-logo.tradingview.com/ok-99.svg"


def test_spark_fail_soft(monkeypatch):
    import chart_patterns.candles as candles

    rows = [_row("AAA", change=3.0), _row("BBB", change=-3.0)]
    monkeypatch.setattr(m, "_fetch_tv_frame", lambda: _FakeDF(rows))
    monkeypatch.setattr(
        "chart_patterns.universes.get_universe", lambda uid: ["AAA", "BBB"]
    )

    def _boom(sym, tf):
        raise RuntimeError("tape down")

    monkeypatch.setattr(candles, "fetch_for_timeframe", _boom)
    # Real module helper (client fixture would mock it) -> all [] on failure.
    assert m._fetch_sparks(["AAA", "BBB"]) == {"AAA": [], "BBB": []}

    m.clear_cache()
    cli = TestClient(_app())
    body = cli.get("/api/reports/daily?universe=nifty500").json()
    for panel in body["moves"].values():
        for row in panel:
            assert row["spark"] == []


def test_past_date_disk_cache_and_today_ttl(client, monkeypatch, tmp_path):
    monkeypatch.setattr(m, "REPORTS_DIR", tmp_path)
    rows = [_row("AAA", change=2.0)]
    calls = {"n": 0}

    def _tv():
        calls["n"] += 1
        return _FakeDF(rows)

    monkeypatch.setattr(m, "_fetch_tv_frame", _tv)
    monkeypatch.setattr("chart_patterns.universes.get_universe", lambda uid: ["AAA"])

    past = "2020-01-02"
    r1 = client.get(f"/api/reports/daily?date={past}&universe=nifty500")
    assert r1.status_code == 200 and r1.json()["cached"] is False
    assert calls["n"] == 1
    assert (tmp_path / f"{past}_nifty500.json").exists()
    # second hit reads disk, no new TV call
    r2 = client.get(f"/api/reports/daily?date={past}&universe=nifty500")
    assert r2.json()["cached"] is True
    assert calls["n"] == 1

    # today TTL: second call served from memory cache
    today_body_1 = client.get("/api/reports/daily?universe=nifty500").json()
    n_after_first = calls["n"]
    today_body_2 = client.get("/api/reports/daily?universe=nifty500").json()
    assert calls["n"] == n_after_first  # TTL hit, no refetch
    assert today_body_2["cached"] is True
    assert today_body_1["breadth"] == today_body_2["breadth"]


def test_universe_filtering(client, monkeypatch):
    rows = [_row("AAA", change=9.0), _row("ZZZ", change=99.0)]
    _setup(monkeypatch, rows, universe=("AAA",))
    body = client.get("/api/reports/daily?universe=nifty500").json()
    assert body["breadth"]["total"] == 1
    assert body["moves"]["gainers"][0]["symbol"] == "AAA"


def test_nan_to_null_and_fail_soft(client, monkeypatch):
    rows = [_row("AAA", change=float("nan"), close=float("inf"),
                  volume=float("nan"), RSI=float("nan"))]
    _setup(monkeypatch, rows, universe=("AAA",))
    r = client.get("/api/reports/daily?universe=nifty500")
    raw = r.text
    assert "NaN" not in raw and "Infinity" not in raw
    body = json.loads(raw)
    # change NaN -> gainers empty (no finite change), breadth counts AAA as unchanged
    assert body["moves"]["gainers"] == []
    assert body["breadth"]["unchanged"] == 1

    # TV failure -> fail-soft, never 500
    monkeypatch.setattr(m, "_fetch_tv_frame", lambda: (_ for _ in ()).throw(RuntimeError("tv down")))
    m.clear_cache()
    r2 = client.get("/api/reports/daily?universe=nifty500")
    assert r2.status_code == 200
    assert r2.json()["moves"] == {} and r2.json()["breadth"] is None


def test_all_equity_universe_accepted(client, monkeypatch):
    seen = {}

    def _gu(uid):
        seen["uid"] = uid
        return ["AAA"]

    monkeypatch.setattr(m, "_fetch_tv_frame", lambda: _FakeDF([_row("AAA", change=1.0)]))
    monkeypatch.setattr("chart_patterns.universes.get_universe", _gu)
    body = client.get("/api/reports/daily?universe=all_equity").json()
    assert seen["uid"] == "all_equity"
    assert body["universe"] == "all_equity"


def test_backward_compat_keys(client, monkeypatch):
    rows = [_row("AAA", change=1.0), _row("BBB", change=-1.0)]
    _setup(monkeypatch, rows, universe=("AAA", "BBB"))
    body = client.get("/api/reports/daily?universe=nifty500").json()
    for key in ("date", "universe", "as_of", "cached", "age_sec",
                "breadth", "moves", "sector_leaders", "theme_leaders", "index"):
        assert key in body


def _sector_row(sym, sector, change, mcap):
    return _row(sym, change=change, market_cap_basic=mcap, sector=sector)


def test_sector_leaders_weighting_and_shape(client, monkeypatch):
    # BANK: (4*300 + 2*100)/400 = 3.5 ; IT: (-5*100 + 0*100)/200 = -2.5
    rows = [
        _sector_row("AAA", "BANK", 4.0, 300.0),
        _sector_row("BBB", "BANK", 2.0, 100.0),
        _sector_row("CCC", "IT", -5.0, 100.0),
        _sector_row("DDD", "IT", 0.0, 100.0),
        _sector_row("EEE", "OIL", 1.0, 50.0),
    ]
    _setup(monkeypatch, rows, universe=("AAA", "BBB", "CCC", "DDD", "EEE"))
    body = client.get("/api/reports/daily?universe=nifty500").json()
    sl = body["sector_leaders"]
    assert set(sl.keys()) == {"top", "bottom"}
    by_name = {e["name"]: e for e in sl["top"] + sl["bottom"]}
    assert by_name["BANK"]["change"] == pytest.approx(3.5)
    assert by_name["IT"]["change"] == pytest.approx(-2.5)
    assert by_name["BANK"]["stock_count"] == 2
    assert by_name["BANK"]["advances"] == 2 and by_name["BANK"]["declines"] == 0
    assert by_name["IT"]["advances"] == 0 and by_name["IT"]["declines"] == 1
    assert sl["top"][0]["name"] == "BANK"  # desc
    assert sl["bottom"][0]["name"] == "IT"  # worst first
    assert len(sl["top"]) <= 5 and len(sl["bottom"]) <= 5
    for entry in sl["top"] + sl["bottom"]:
        assert set(entry.keys()) == {"name", "change", "stock_count", "advances", "declines"}


def test_sector_leaders_fail_soft_on_missing_sector(client, monkeypatch):
    rows = [_row("AAA", change=1.0, sector=""), _row("BBB", change=2.0, sector=None)]
    _setup(monkeypatch, rows, universe=("AAA", "BBB"))
    body = client.get("/api/reports/daily?universe=nifty500").json()
    assert body["sector_leaders"] == {"top": [], "bottom": []}


def test_theme_leaders_weighting_and_shape(client, monkeypatch):
    rows = [
        _sector_row("AAA", "BANK", 6.0, 200.0),
        _sector_row("BBB", "BANK", -2.0, 200.0),
        _sector_row("CCC", "IT", 1.0, 100.0),
    ]
    _setup(monkeypatch, rows, universe=("AAA", "BBB", "CCC"))
    monkeypatch.setattr(
        m, "_load_theme_membership",
        lambda: (
            {"def": {"name": "Defence", "category": "c"}, "rail": {"name": "Railways", "category": "c"}},
            {"def": {"AAA", "BBB"}, "rail": {"CCC"}, "empty": set()},
        ),
    )
    body = client.get("/api/reports/daily?universe=nifty500").json()
    tl = body["theme_leaders"]
    assert set(tl.keys()) == {"top", "bottom"}
    by_name = {e["name"]: e for e in tl["top"] + tl["bottom"]}
    # Defence: (6*200 + -2*200)/400 = 2.0 ; Railways: 1.0
    assert by_name["Defence"]["change"] == pytest.approx(2.0)
    assert by_name["Railways"]["change"] == pytest.approx(1.0)
    assert by_name["Defence"]["stock_count"] == 2
    assert by_name["Defence"]["advances"] == 1 and by_name["Defence"]["declines"] == 1
    assert tl["top"][0]["name"] == "Defence"
    assert "empty" not in by_name  # no frame coverage -> skipped


def test_theme_leaders_db_missing_ok(client, monkeypatch):
    rows = [_row("AAA", change=1.0)]
    _setup(monkeypatch, rows, universe=("AAA",))
    monkeypatch.setattr(m, "_load_theme_membership", lambda: ({}, {}))
    body = client.get("/api/reports/daily?universe=nifty500").json()
    assert body["theme_leaders"] == {"top": [], "bottom": []}


def test_index_null_safe(client, monkeypatch):
    rows = [_row("AAA", change=1.0)]
    _setup(monkeypatch, rows, universe=("AAA",))
    # raising fetcher -> null but still 200 (_build_payload wraps in try/except)
    def _boom(records=None):
        raise RuntimeError("yf down")

    monkeypatch.setattr(m, "_fetch_index", _boom)
    r = client.get("/api/reports/daily?universe=nifty500")
    assert r.status_code == 200
    assert r.json()["index"] is None

    # happy path: reused values pass through
    m.clear_cache()
    monkeypatch.setattr(
        m, "_fetch_index",
        lambda records=None: {"name": "NIFTY 50", "change": 0.5, "close": 25000.0},
    )
    body = client.get("/api/reports/daily?universe=nifty500").json()
    assert body["index"] == {"name": "NIFTY 50", "change": 0.5, "close": 25000.0}


def test_index_from_tv_frame(monkeypatch):
    import sys

    recs = [
        {"symbol": "NIFTY", "change": 0.75, "close": 25100.5},
        {"symbol": "AAA", "change": 1.0, "close": 100.0},
    ]
    assert m._fetch_index(recs) == {"name": "NIFTY 50", "change": 0.75, "close": 25100.5}
    # no index symbol + no yfinance -> None (never raises, no network)
    monkeypatch.setitem(sys.modules, "yfinance", None)
    assert m._fetch_index([{"symbol": "AAA", "change": 1.0, "close": 10.0}]) is None
