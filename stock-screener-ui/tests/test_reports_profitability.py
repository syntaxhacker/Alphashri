"""Tests for GET /api/reports/profitability (synthetic frames, mocked universe/candles)."""
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.reports_api.profitability as pb


def _trend(n=120, start=100.0, step=0.6, vol=2000.0, end="2026-09-01"):
    idx = pd.date_range(end=end, periods=n, freq="D", tz="UTC")
    closes = [start + i * step for i in range(n)]
    df = pd.DataFrame(
        {
            "open": [c - 0.4 for c in closes],
            "high": [c + 0.5 for c in closes],
            "low": [c - 0.8 for c in closes],
            "close": closes,
            "volume": vol,
        },
        index=idx,
    )
    # One sharp breakout bar near the end so sr_breakout fires.
    df.iloc[-8] = [
        closes[-8] - 1.0, closes[-8] + 6.0, closes[-8] - 1.5, closes[-8] + 5.0, 9000.0,
    ]
    return df


def _flat(n=120, price=50.0, vol=1000.0, end="2026-09-01"):
    idx = pd.date_range(end=end, periods=n, freq="D", tz="UTC")
    return pd.DataFrame(
        {"open": price, "high": price + 0.1, "low": price - 0.1,
         "close": price, "volume": vol},
        index=idx,
    )


@pytest.fixture
def client(monkeypatch):
    frames = {"AAA": _trend(), "BBB": _flat()}
    import chart_patterns.universes as univ

    monkeypatch.setattr(univ, "get_universe", lambda u: ["AAA", "BBB"])
    import chart_patterns.candles as candles

    monkeypatch.setattr(
        candles, "fetch_for_timeframe",
        lambda symbol, *a, **k: frames.get(str(symbol).upper()),
    )
    monkeypatch.setattr(pb, "EXPERIMENT_FILES", [])
    pb.clear_cache()
    app = FastAPI()
    app.include_router(pb.router)
    with TestClient(app) as c:
        yield c
    pb.clear_cache()


class TestComputeMetrics:
    def test_empty(self):
        assert pb.compute_metrics([])["trades"] == 0

    def test_math(self):
        m = pb.compute_metrics([100.0, -50.0, 200.0])
        assert m["trades"] == 3
        assert m["win_rate"] == pytest.approx(2 / 3, rel=1e-3)
        assert m["net_pnl"] == pytest.approx(250.0)
        assert m["expectancy"] == pytest.approx(round(250.0 / 3, 2))
        assert m["profit_factor"] == pytest.approx(300.0 / 50.0)
        # Curve 100 -> 50 -> 250: trough 50 vs peak 100 => dd 50.
        assert m["max_dd"] == pytest.approx(50.0)

    def test_all_winners_no_div_zero(self):
        m = pb.compute_metrics([10.0, 20.0])
        assert m["profit_factor"] == pytest.approx(30.0)
        assert m["max_dd"] == pytest.approx(0.0)


class TestEndpoint:
    def test_shape_and_sort(self, client):
        r = client.get("/api/reports/profitability?weeks=4&universe=nifty500")
        assert r.status_code == 200
        body = r.json()
        assert body["weeks"] == 4
        assert body["universe"] == "nifty500"
        assert "as_of" in body
        rows = body["strategies"]
        assert {row["id"] for row in rows} == set(pb.STRATEGIES)
        for row in rows:
            for key in ("trades", "win_rate", "net_pnl", "expectancy",
                        "profit_factor", "max_dd", "avg_hold_days"):
                assert key in row
        nets = [row["net_pnl"] for row in rows]
        assert nets == sorted(nets, reverse=True)
        for sig in body["top_signals"]:
            for key in ("symbol", "strategy", "entry_date", "entry", "exit", "net"):
                assert key in sig
        assert len(body["top_signals"]) <= pb.TOP_SIGNALS_LIMIT

    def test_weeks_capped(self, client):
        r = client.get("/api/reports/profitability?weeks=99&universe=nifty500")
        assert r.status_code == 200
        assert r.json()["weeks"] == pb.WEEKS_MAX

    def test_cache_second_hit(self, client):
        first = client.get("/api/reports/profitability?weeks=2&universe=nifty500").json()
        assert first["cached"] is False
        second = client.get("/api/reports/profitability?weeks=2&universe=nifty500").json()
        assert second["cached"] is True
        assert second["strategies"] == first["strategies"]

    def test_fail_soft_never_500(self, monkeypatch):
        import chart_patterns.candles as candles
        import chart_patterns.universes as univ

        monkeypatch.setattr(univ, "get_universe", lambda u: ["AAA"])
        monkeypatch.setattr(
            candles, "fetch_for_timeframe",
            lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")),
        )
        monkeypatch.setattr(pb, "EXPERIMENT_FILES", [])
        pb.clear_cache()
        app = FastAPI()
        app.include_router(pb.router)
        with TestClient(app) as c:
            r = c.get("/api/reports/profitability?weeks=4&universe=nifty500")
            assert r.status_code == 200
            body = r.json()
            assert body["strategies"]
            assert body["top_signals"] == []
        pb.clear_cache()
