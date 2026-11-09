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


def _chain_for(spots):
    """Chain with material strikes around a spot near 25,000 (call) / 24,900 (put)."""
    return {
        "24800": [320.0, 85.0, 500000.0, 3200000.0, 40000.0, 200000.0],
        "24900": [300.0, 110.0, 1000000.0, 1000000.0, 60000.0, 150000.0],
        "25000": [spots[-1] - 24900.0 + 100.0, 140.0, 4000000.0, 2000000.0, 100000.0, 180000.0],
        "25100": [180.0, 160.0, 800000.0, 600000.0, 30000.0, 100000.0],
        "25600": [120.0, 200.0, 2000000.0, 300000.0, 50000.0, 90000.0],
    }


def _write_spot_tape(path, spots):
    base = datetime(2026, 11, 17, 11, 0, 0)
    rows = []
    for i, spot in enumerate(spots):
        ts = (base + timedelta(minutes=i)).isoformat() + "+05:30"
        chain = _chain_for(spots)
        rows.append({
            "t": ts, "spot": spot, "max_pain": 25000.0, "flip": 25100.0,
            "net_gex": 0.0, "atm_strike": 25000.0, "expiry": DATE_STR, "chain": chain,
        })
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))


def _client_for_spots(tmp_path, monkeypatch, spots):
    tape = tmp_path / f"{DATE_STR}.jsonl"
    _write_spot_tape(tape, spots)
    monkeypatch.setattr(
        options_walls, "_tape_path", lambda symbol, ds: tape
    )
    app = FastAPI()
    app.include_router(options_walls.router)
    return TestClient(app)


def _call_row(payload, strike):
    return next(r for r in payload["calls"] if r["strike"] == strike)


def test_time_to_break_call_rising_finite(tmp_path, monkeypatch):
    # Spot rising toward the 25,000 call wall (above spot): finite ttb.
    spots = [24800.0] * 30 + [24950.0, 24960.0, 24970.0, 24980.0, 24990.0]
    client = _client_for_spots(tmp_path, monkeypatch, spots)
    p = client.get(f"/api/reports/options/NIFTY/walls?date={DATE_STR}").json()
    row = _call_row(p, 25000.0)
    assert row["time_to_break_min"] is not None
    assert row["time_to_break_min"] > 0


def test_time_to_break_call_falling_none(tmp_path, monkeypatch):
    # Spot falling away from the 25,000 call wall: None.
    spots = [24990.0] * 30 + [24950.0, 24940.0, 24930.0, 24920.0, 24910.0]
    client = _client_for_spots(tmp_path, monkeypatch, spots)
    p = client.get(f"/api/reports/options/NIFTY/walls?date={DATE_STR}").json()
    row = _call_row(p, 25000.0)
    assert row["time_to_break_min"] is None


def test_time_to_break_far_wall_none(tmp_path, monkeypatch):
    # Far wall (25,600) with slow drift -> distance/velocity > 60 -> None.
    spots = [24980.0] * 34 + [24990.0]
    client = _client_for_spots(tmp_path, monkeypatch, spots)
    p = client.get(f"/api/reports/options/NIFTY/walls?date={DATE_STR}").json()
    row = _call_row(p, 25600.0)
    assert row["time_to_break_min"] is None


def test_time_to_break_put_down_finite_put_up_none(tmp_path, monkeypatch):
    # Put moving down toward 24,900 put wall (below spot): finite.
    spots_down = [25010.0] * 30 + [25000.0, 24995.0, 24990.0, 24985.0, 24980.0]
    client = _client_for_spots(tmp_path, monkeypatch, spots_down)
    p = client.get(f"/api/reports/options/NIFTY/walls?date={DATE_STR}").json()
    put_row = next(r for r in p["puts"] if r["strike"] == 24900.0)
    assert put_row["time_to_break_min"] is not None
    assert put_row["time_to_break_min"] > 0

    # Put moving up (away from 24,900 wall below spot): None.
    spots_up = [24980.0] * 30 + [24985.0, 24990.0, 24995.0, 25000.0, 25010.0]
    client = _client_for_spots(tmp_path, monkeypatch, spots_up)
    p = client.get(f"/api/reports/options/NIFTY/walls?date={DATE_STR}").json()
    put_row = next(r for r in p["puts"] if r["strike"] == 24900.0)
    assert put_row["time_to_break_min"] is None


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
