"""Wall-erosion fields on /api/reports/options/{underlying}/walls."""

import json
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.reports_api.options_walls as options_walls

DATE_STR = "2026-11-17"


def _row(ts, spot, ce_oi, ce_ltp, ce_vol):
    chain = {
        "24800": [320.0, 85.0, 500000.0, 3200000.0, 40000.0, 200000.0],
        "24900": [300.0, 110.0, 1000000.0, 1000000.0, 60000.0, 150000.0],
        "25000": [ce_ltp, 140.0, ce_oi, 2000000.0, ce_vol, 180000.0],
        "25100": [180.0, 160.0, 800000.0, 600000.0, 30000.0, 100000.0],
        "25200": [150.0, 190.0, 300000.0, 400000.0, 20000.0, 80000.0],
    }
    return {
        "t": ts,
        "spot": spot,
        "max_pain": 25000.0,
        "flip": 25100.0,
        "net_gex": 0.0,
        "atm_strike": 25000.0,
        "expiry": DATE_STR,
        "chain": chain,
    }


def _write_tape(path):
    base = datetime(2026, 11, 17, 11, 0, 0)
    rows = []
    for i in range(35):
        ts = (base + timedelta(minutes=i)).isoformat() + "+05:30"
        spot = 24940.0 + i * 90.0 / 34.0  # 24,940 -> 25,030
        ce_oi = 4130000.0 - i * (200000.0 / 34.0)  # 4.13M -> 3.93M
        ce_ltp = 230.0 + i * 30.0 / 34.0  # 230 -> 260
        ce_vol = 100000.0 + i * 1500.0 + 4000.0 * max(0, i - 15)  # accelerating
        rows.append(_row(ts, spot, ce_oi, ce_ltp, ce_vol))
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))


def _make_client(tmp_path, monkeypatch):
    tape = tmp_path / f"{DATE_STR}.jsonl"
    _write_tape(tape)
    monkeypatch.setattr(
        options_walls, "_tape_path", lambda symbol, ds: tape
    )
    app = FastAPI()
    app.include_router(options_walls.router)
    return TestClient(app)


def test_walls_erosion_enrichment(tmp_path, monkeypatch):
    client = _make_client(tmp_path, monkeypatch)
    resp = client.get(f"/api/reports/options/NIFTY/walls?date={DATE_STR}")
    assert resp.status_code == 200
    payload = resp.json()

    assert payload["spot"] == pytest.approx(25030.0, abs=0.5)
    calls = payload["calls"]
    puts = payload["puts"]

    row = next(r for r in calls if r["strike"] == 25000.0)
    assert row["erosion_30m"] < 0
    assert row["erosion_rate_30m"] < 0
    assert row["vol_5m"] > 0
    assert row["vol_mult"] > 1
    assert row["prem_chg_5m"] > 0
    assert row["flow"] == "WRITERS_COVERING"
    assert row["status"] in ("ERODING", "BREACHED")
    assert row["fuel_score"] >= 70
    assert set(row["fuel_parts"]) == {
        "erosion", "volume", "proximity", "gamma", "flow",
    }
    assert all(isinstance(v, int) for v in row["fuel_parts"].values())
    assert row["time_to_break_min"] is None or row["time_to_break_min"] > 0
    assert len(row["oi_history"]) > 0

    # Nearest call strike above spot must be present and flagged (25,000 or
    # 25,100 depending on where spot lands).
    final_spot = payload["spot"]
    above = [r["strike"] for r in calls if r["strike"] > final_spot]
    assert above
    nearest_strikes = {r["strike"] for r in calls if r.get("nearest")}
    assert nearest_strikes
    assert min(above) in nearest_strikes
    assert min(above) in (25000.0, 25100.0)

    nearest_call = payload["nearest_call"]
    nearest_put = payload["nearest_put"]
    assert nearest_call is not None and nearest_call["strike"] == min(above)
    below = [r["strike"] for r in puts if r["strike"] < final_spot]
    assert below
    assert nearest_put is not None and nearest_put["strike"] == max(below)
    assert max(below) in (24900.0, 25000.0)


def test_missing_tape_returns_404(tmp_path, monkeypatch):
    missing = tmp_path / f"{DATE_STR}.jsonl"
    monkeypatch.setattr(
        options_walls, "_tape_path", lambda symbol, ds: missing
    )
    app = FastAPI()
    app.include_router(options_walls.router)
    client = TestClient(app)
    resp = client.get(f"/api/reports/options/NIFTY/walls?date={DATE_STR}")
    assert resp.status_code == 404
    body = resp.json()["detail"]
    assert body["is_trading_day"] is False
    assert "message" in body
