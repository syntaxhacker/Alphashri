"""Tests for api/value_scan/tv_source.py (no network — requests.post mocked)."""

import math

import pytest
import requests

from api.value_scan import tv_source
from api.value_scan.tv_source import (
    COLUMNS,
    FRAME_LIMIT,
    GLOBAL_COUNTRIES,
    TvSourceError,
    fetch_frame,
    frame_summary,
)


def _entry(name, exchange="NSE", type_="stock", currency="INR",
           mcap=5e9, pe=12.0, **overrides):
    """Build one {"s", "d"} scanner entry with values in COLUMNS order."""
    base = {
        "name": name, "description": f"{name} Ltd", "type": type_,
        "sector": "Energy", "industry": "Oil & Gas", "exchange": exchange,
        "country": overrides.pop("country", "India" if exchange in ("NSE", "BSE") else "Germany"),
        "currency": currency, "close": 100.0, "change": 1.0, "open": 99.0,
        "high": 101.0, "low": 98.0, "volume": 1_000_000,
        "relative_volume_10d_calc": 1.2, "market_cap_basic": mcap,
        "total_revenue": 1e9, "net_income": 1e8, "total_debt": 1e8,
        "free_cash_flow_ttm": 5e7, "price_earnings_ttm": pe,
        "price_sales_ratio": 1.5, "price_book_fq": 1.2,
        "return_on_equity_fq": 15.0, "gross_margin_ttm": 30.0,
        "operating_margin_ttm": 20.0, "return_on_assets_fq": 8.0,
        "debt_to_equity_fq": 0.5, "current_ratio": 1.5, "quick_ratio": 1.0,
        "total_revenue_yoy_growth_ttm": 10.0,
        "earnings_per_share_diluted_yoy_growth_ttm": 12.0,
        "earnings_per_share_diluted_ttm": 5.0,
        "revenue_per_share_ttm": 50.0, "dividends_yield_current": 1.0,
        "SMA20": 99.0, "SMA50": 98.0, "SMA100": 97.0, "SMA200": 95.0,
        "EMA20": 99.5, "EMA50": 98.5, "RSI": 55.0, "Recommend.All": 0.5,
        "Recommend.MA": 0.5, "ADX": 25.0, "ATR": 2.0, "beta_1_year": 1.0,
        "Volatility.D": 1.5, "Perf.W": 2.0, "Perf.1M": 3.0, "Perf.3M": 5.0,
        "Perf.Y": 20.0, "price_52_week_high": 120.0,
        "price_52_week_low": 80.0,
    }
    base.update(overrides)
    return {"s": f"{exchange}:{name}", "d": [base[c] for c in COLUMNS]}


class _FakeResponse:
    def __init__(self, payload=None, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def _mock_post(monkeypatch, payload=None, status_code=200):
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append({"url": url, "json": json,
                      "headers": headers, "timeout": timeout})
        return _FakeResponse(payload, status_code)

    monkeypatch.setattr(tv_source.requests, "post", fake_post)
    return calls


def _payload(*entries):
    return {"data": entries, "totalCount": len(entries)}


class TestFetchFrameUrlAndBody:
    @pytest.mark.parametrize("market,segment,markets", [
        ("india", "india", ["india"]),
        ("usa", "america", ["america"]),
        ("global", "global", GLOBAL_COUNTRIES),
    ])
    def test_url_markets_and_single_post(self, monkeypatch, market,
                                         segment, markets):
        calls = _mock_post(monkeypatch, _payload(_entry("RELIANCE")))
        rows = fetch_frame(market)
        assert len(calls) == 1  # EXACTLY ONE HTTP request
        assert calls[0]["url"] == (
            f"https://scanner.tradingview.com/{segment}/scan")
        body = calls[0]["json"]
        assert body["markets"] == markets
        assert calls[0]["timeout"] == 40

    def test_body_has_filter_sort_range_keys(self, monkeypatch):
        calls = _mock_post(monkeypatch, _payload(_entry("RELIANCE")))
        fetch_frame("india")
        body = calls[0]["json"]
        assert "filter" in body and "sort" in body and "range" in body
        assert body["sort"] == {"sortBy": "market_cap_basic",
                                "sortOrder": "desc"}
        assert body["range"] == [0, FRAME_LIMIT["india"]]
        assert body["ignore_unknown_fields"] is True
        assert body["columns"] == COLUMNS
        mcap_filter = [f for f in body["filter"]
                       if f.get("left") == "market_cap_basic"]
        assert mcap_filter, "expected a market_cap pre-filter"
        assert mcap_filter[0]["operation"] == "greater"

    def test_unknown_market_raises(self, monkeypatch):
        calls = _mock_post(monkeypatch, _payload(_entry("X")))
        with pytest.raises(TvSourceError):
            fetch_frame("mars")
        assert calls == []


class TestGlobalHygiene:
    def test_dr_rows_and_duplicate_nvda_yield_one_stock(self, monkeypatch):
        entries = [
            _entry("NVDA", exchange="NASDAQ", currency="USD", mcap=3e12),
            _entry("NVDA", exchange="XETRA", currency="USD", mcap=3e12),
            _entry("4NVDA", exchange="NEO", currency="CAD", mcap=3e12),
            _entry("NVDA.USD", exchange="TSX", currency="USD", mcap=3e12),
            _entry("NVDA", exchange="NYSE", type_="dr", currency="USD",
                   mcap=3e12),
        ]
        _mock_post(monkeypatch, _payload(*entries))
        rows = fetch_frame("global")
        assert len(rows) == 1
        assert rows[0]["type"] == "stock"

    def test_listing_code_suffix_stripped_to_own_root(self, monkeypatch):
        # NVDC34 (BDR-style code) normalises to NVDC — kept, but distinct
        # from NVDA. The USD-quoted NVDA line is dropped from GLOBAL (it is a
        # US duplicate covered by the USA tab).
        _mock_post(monkeypatch, _payload(
            _entry("NVDA", exchange="NASDAQ", currency="USD", mcap=3e12),
            _entry("NVDC34", exchange="BMFBOVESPA", currency="BRL",
                   mcap=3e12),
        ))
        rows = fetch_frame("global")
        assert len(rows) == 1
        assert rows[0]["name"] == "NVDC34"

    def test_global_drops_us_domiciled_and_coded_rows(self, monkeypatch):
        entries = [
            _entry("SAP", exchange="XETRA", currency="EUR", mcap=2e11,
                   country="Germany"),
            _entry("NVDA", exchange="SIX", currency="CHF", mcap=3e12,
                   country="United States"),
            _entry("869020", exchange="LSX", currency="EUR", mcap=2e9,
                   country="Germany"),
        ]
        _mock_post(monkeypatch, _payload(*entries))
        rows = fetch_frame("global")
        names = {r["name"] for r in rows}
        assert "SAP" in names          # genuinely international -> kept
        assert "NVDA" not in names      # US domiciled -> belongs to the USA tab
        assert "869020" not in names   # instrument code, not a company

    def test_usa_exchange_filter(self, monkeypatch):
        entries = [
            _entry("AAPL", exchange="NASDAQ", currency="USD", mcap=3e12),
            _entry("AAPL", exchange="BSE", currency="INR", mcap=3e12),
        ]
        _mock_post(monkeypatch, _payload(*entries))
        rows = fetch_frame("usa")
        assert len(rows) == 1
        assert rows[0]["exchange"] == "NASDAQ"

    def test_mcap_floor_applied_in_python(self, monkeypatch):
        entries = [
            _entry("BIG", mcap=5e9),
            _entry("SMALL", mcap=1.0),
        ]
        _mock_post(monkeypatch, _payload(*entries))
        rows = fetch_frame("india")
        assert [r["name"] for r in rows] == ["BIG"]


class TestCoercionAndErrors:
    def test_missing_numerics_become_none(self, monkeypatch):
        _mock_post(monkeypatch, _payload(
            _entry("X", price_earnings_ttm=None,
                   free_cash_flow_ttm=None, RSI=None)))
        rows = fetch_frame("india")
        assert len(rows) == 1
        assert rows[0]["price_earnings_ttm"] is None
        assert rows[0]["free_cash_flow_ttm"] is None
        assert rows[0]["RSI"] is None
        for key in ("price_earnings_ttm", "free_cash_flow_ttm", "RSI"):
            value = rows[0][key]
            assert value is None or not (
                isinstance(value, float) and math.isnan(value))

    def test_http_500_raises(self, monkeypatch):
        _mock_post(monkeypatch, {"error": "boom"}, status_code=500)
        with pytest.raises(TvSourceError):
            fetch_frame("india")

    @pytest.mark.parametrize("payload", [{}, {"data": []}, None, [1, 2]])
    def test_empty_payload_raises(self, monkeypatch, payload):
        _mock_post(monkeypatch, payload)
        with pytest.raises(TvSourceError):
            fetch_frame("india")


class TestFrameSummary:
    def test_summary_shape(self, monkeypatch):
        _mock_post(monkeypatch, _payload(
            _entry("A"), _entry("B", price_earnings_ttm=None)))
        rows = fetch_frame("india")
        summary = frame_summary(rows)
        assert summary["count"] == 2
        assert summary["fields_complete"] is True
        assert summary["missing_fields"] == []

    def test_systematically_missing_field_flagged(self):
        rows = [{"market_cap_basic": 1e9, "price_earnings_ttm": None,
                 "price_book_fq": None, "return_on_equity_fq": None,
                 "free_cash_flow_ttm": None, "close": 10.0}
                for _ in range(3)]
        summary = frame_summary(rows)
        assert summary["fields_complete"] is False
        assert "price_earnings_ttm" in summary["missing_fields"]

    def test_empty_frame(self):
        assert frame_summary([]) == {
            "count": 0, "fields_complete": True, "missing_fields": []}
