"""Tests for api/value_scan/router.py (get_scored_frame monkeypatched)."""

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

router_module = importlib.import_module("api.value_scan.router")
from api.value_scan import cache as cache_module
from api.value_scan.tv_source import TvSourceError


def _row(symbol, **overrides):
    base = {
        "name": f"NSE:{symbol}", "description": f"{symbol} Ltd",
        "type": "stock", "sector": "Energy", "industry": "Oil",
        "exchange": "NSE", "currency": "INR", "close": 100.0,
        "change": 1.0, "volume": 1_000_000,
        "market_cap_basic": 5e9, "total_revenue": 1e9,
        "net_income": 1e8, "free_cash_flow_ttm": 5e7,
        "price_earnings_ttm": 12.0, "price_sales_ratio": 1.5,
        "price_book_fq": 1.2, "return_on_equity_fq": 15.0,
        "gross_margin_ttm": 30.0, "operating_margin_ttm": 20.0,
        "total_revenue_yoy_growth_ttm": 10.0,
        "earnings_per_share_diluted_yoy_growth_ttm": 12.0,
        "earnings_per_share_diluted_ttm": 5.0,
        "dividends_yield_current": 1.0, "debt_to_equity_fq": 0.5,
        "current_ratio": 1.5, "SMA200": 95.0, "RSI": 55.0,
        "price_52_week_high": 120.0, "score": 70.0,
        "subscores": {"value": 70.0, "quality": 70.0,
                      "growth": 70.0, "health": 70.0},
        "peer": {}, "flags": [], "derived": {},
    }
    base.update(overrides)
    return base


def _meta(**overrides):
    base = {"as_of": "2026-10-21T00:00:00+00:00", "cached": False,
            "age_seconds": 0, "scanned": 3, "fields_complete": True,
            "warnings": []}
    base.update(overrides)
    return base


@pytest.fixture()
def client(monkeypatch):
    frame = [
        _row("RELIANCE", sector="Energy", score=80.0,
             price_earnings_ttm=10.0),
        _row("INFY", sector="Technology", score=60.0,
             price_earnings_ttm=25.0),
        _row("TCS", sector="Technology", score=70.0,
             price_earnings_ttm=20.0),
    ]

    def fake_frame(market):
        assert market in ("india", "usa", "global")
        return frame, _meta(scanned=len(frame))

    monkeypatch.setattr(router_module, "get_scored_frame", fake_frame)
    app = FastAPI()
    app.include_router(router_module.router)
    return TestClient(app)


ROW_KEYS = {"symbol", "name", "exchange", "currency", "price", "change",
            "mcap_bn", "rev_bn", "pe", "ps", "pb", "fcf_yield",
            "div_yield", "roe", "gross_margin", "op_margin", "rev_yoy",
            "eps_yoy", "debt_to_equity", "current_ratio", "rsi",
            "vs_200dma", "off_52w_high", "score", "subscores", "peer",
            "flags", "derived"}


class TestScanShape:
    def test_200_response_shape(self, client):
        resp = client.get("/api/value/scan")
        assert resp.status_code == 200
        body = resp.json()
        for key in ("market", "currency", "as_of", "scanned", "matched",
                    "fields_complete", "filters_applied", "rows",
                    "sectors", "warnings"):
            assert key in body
        assert body["market"] == "india"
        assert body["currency"] == "INR"
        assert body["matched"] == 3
        assert ROW_KEYS <= set(body["rows"][0].keys())
        assert body["rows"][0]["symbol"] == "RELIANCE"
        assert body["rows"][0]["mcap_bn"] == pytest.approx(5.0)
        # sectors sorted by count desc
        counts = [s["count"] for s in body["sectors"]]
        assert counts == sorted(counts, reverse=True)
        assert body["sectors"][0]["name"] == "Technology"
        for sector in body["sectors"]:
            assert {"name", "count", "avg_score"} <= set(sector.keys())

    def test_default_sort_is_score_desc(self, client):
        scores = [r["score"]
                  for r in client.get("/api/value/scan").json()["rows"]]
        assert scores == sorted(scores, reverse=True)

    def test_include_flags_false_drops_flags(self, client):
        body = client.get("/api/value/scan",
                          params={"include_flags": False}).json()
        assert all("flags" not in r for r in body["rows"])


class TestValidation:
    def test_unknown_market_400(self, client):
        resp = client.get("/api/value/scan", params={"market": "mars"})
        assert resp.status_code == 400

    @pytest.mark.parametrize("limit", [0, -1, 501, 1000])
    def test_limit_out_of_range_400(self, client, limit):
        resp = client.get("/api/value/scan", params={"limit": limit})
        assert resp.status_code == 400

    def test_limit_applied(self, client):
        body = client.get("/api/value/scan", params={"limit": 2}).json()
        assert len(body["rows"]) == 2
        assert body["matched"] == 3


class TestPresetPrecedence:
    def test_explicit_param_wins_over_preset(self, monkeypatch):
        seen = {}

        def fake_apply(rows, spec):
            seen.update(spec)
            return rows

        monkeypatch.setattr(
            router_module, "_load_filter_engine",
            lambda: (fake_apply, lambda spec: dict(spec),
                     {"cheap": {"max_pe": 15.0, "min_roe": 10.0}}))
        app = FastAPI()
        app.include_router(router_module.router)
        test_client = TestClient(app)
        resp = test_client.get("/api/value/scan",
                               params={"preset": "cheap", "max_pe": 8.0})
        assert resp.status_code == 200
        assert seen["max_pe"] == 8.0  # explicit wins
        assert seen["min_roe"] == 10.0  # preset fills the rest


class TestUpstreamFailure:
    def test_tv_source_error_is_502(self, monkeypatch):
        def boom(market):
            raise TvSourceError("value_source_unavailable: down")

        monkeypatch.setattr(router_module, "get_scored_frame", boom)
        app = FastAPI()
        app.include_router(router_module.router)
        resp = TestClient(app).get("/api/value/scan")
        assert resp.status_code == 502
        assert resp.json()["detail"] == "value_source_unavailable"

    def test_generic_error_is_502_not_500(self, monkeypatch):
        def boom(market):
            raise RuntimeError("connection reset")

        monkeypatch.setattr(router_module, "get_scored_frame", boom)
        app = FastAPI()
        app.include_router(router_module.router)
        resp = TestClient(app).get("/api/value/scan")
        assert resp.status_code == 502


class TestFiltering:
    def test_max_pe_reduces_rows(self, monkeypatch):
        def pe_filter(rows, spec):
            if spec.get("max_pe") is not None:
                return [r for r in rows
                        if (r.get("price_earnings_ttm") or 0)
                        <= spec["max_pe"]]
            return rows

        monkeypatch.setattr(router_module, "get_scored_frame",
                            lambda m: ([_row("A", price_earnings_ttm=8.0),
                                        _row("B", price_earnings_ttm=30.0),
                                        _row("C", price_earnings_ttm=50.0)],
                                       _meta(scanned=3)))
        monkeypatch.setattr(
            router_module, "_load_filter_engine",
            lambda: (pe_filter, lambda spec: dict(spec), {}))
        app = FastAPI()
        app.include_router(router_module.router)
        body = TestClient(app).get(
            "/api/value/scan", params={"max_pe": 10}).json()
        assert body["scanned"] == 3
        assert body["matched"] == 1
        assert body["rows"][0]["symbol"] == "A"

    def test_fallback_engine_filters_without_peer_modules(self, monkeypatch):
        # Simulate filters.py missing: real fallback path end to end.
        from api.value_scan.router import (_fallback_apply_filters,
                                           _fallback_describe_filters)
        frame = [_row("A", price_earnings_ttm=8.0),
                 _row("B", price_earnings_ttm=30.0),
                 _row("C", price_earnings_ttm=50.0)]
        monkeypatch.setattr(router_module, "get_scored_frame",
                            lambda m: (frame, _meta(scanned=3)))
        monkeypatch.setattr(
            router_module, "_load_filter_engine",
            lambda: (_fallback_apply_filters,
                     _fallback_describe_filters, {}))
        app = FastAPI()
        app.include_router(router_module.router)
        test_client = TestClient(app)
        full = test_client.get("/api/value/scan").json()
        assert full["matched"] == 3
        assert "scoring_engine_unavailable" in full["warnings"]
        sui = test_client.get("/api/value/scan",
                              params={"max_pe": 15}).json()
        assert sui["matched"] == 1


class TestCacheDegradation:
    def test_no_redis_no_scoring_still_returns_rows(self, monkeypatch):
        monkeypatch.setattr(cache_module, "is_cache_available",
                            lambda: False)
        monkeypatch.setattr(cache_module, "get_redis_client",
                            lambda: None)
        monkeypatch.setattr(
            cache_module, "fetch_frame",
            lambda market: [_row("A"), _row("B")])
        rows, meta = cache_module.get_scored_frame("india")
        assert len(rows) == 2
        assert all(r.get("score") is not None for r in rows)
        assert "cache_unavailable" in meta["warnings"]
        assert meta["cached"] is False
        assert meta["scanned"] == 2
