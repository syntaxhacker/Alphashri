"""HTTP contract for the Index Report strategy simulator.

Everything here runs against synthetic ticks: no tape file, no network, no DB
write. The engine itself is covered by ``test_structure_engine.py``; this file
only pins the request/response surface around it.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.reports_api import sim
from options_paper.tape import Tick

IST = ZoneInfo("Asia/Kolkata")
DATE = "2026-11-09"
EXPIRY = "2026-11-13"

TEMPLATE_IDS = [
    "long-call", "long-put", "long-straddle", "bull-call-spread",
    "bear-put-spread", "bull-put-spread", "bear-call-spread",
    "short-strangle", "iron-condor",
]


@pytest.fixture(autouse=True)
def _iso_tape(monkeypatch, tmp_path):
    """Keep every test off the real recorder directories (no gaps file exists)."""
    monkeypatch.setattr(
        sim, "_tape_path",
        lambda symbol, date: tmp_path / f"{symbol}-{date}.jsonl",
    )


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()
    app.include_router(sim.router)
    return TestClient(app)


def _tick(hhmm: str, ce: float = 120.0, pe: float = 110.0,
          spot: float = 24900.0) -> Tick:
    hh, mm = (int(part) for part in hhmm.split(":"))
    return Tick(
        t=datetime(2026, 11, 9, hh, mm, tzinfo=IST),
        spot=spot,
        atm_strike=24900.0,
        ce_ltp=ce,
        pe_ltp=pe,
        ce_iv=0.15,
        pe_iv=0.15,
        expiry=EXPIRY,
        chain={24900: (ce, pe), 24950: (90.0, 140.0)},
    )


def _session_ticks() -> list[Tick]:
    return [
        _tick("09:35", ce=120.0, pe=110.0),
        _tick("09:36", ce=120.0, pe=110.0),   # fill bar
        _tick("09:37", ce=240.0, pe=90.0),    # +100% -> target
        _tick("09:38", ce=240.0, pe=90.0),
        _tick("10:01", ce=240.0, pe=90.0),
    ]


def _strategy(sid: str = "s1", name: str = "Long call",
              legs: list[dict] | None = None, **exec_overrides) -> dict:
    exec_spec = {
        "entryTime": "09:35", "slPct": 30, "tpPct": 60,
        "maxHoldMin": 60, "trailPct": 0, "eodExit": "15:10",
    }
    exec_spec.update(exec_overrides)
    return {
        "id": sid,
        "name": name,
        "legs": legs if legs is not None else [
            {"action": "BUY", "opt": "CE", "strike": "ATM", "lots": 1},
        ],
        "exec": exec_spec,
    }


def _body(strategies: list[dict] | None = None, **overrides) -> dict:
    body = {
        "symbol": "NIFTY",
        "date": DATE,
        "strategies": strategies if strategies is not None else [_strategy()],
        "costs": False,
        "slippageTicks": 0,
    }
    body.update(overrides)
    return body


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------
def test_templates_have_the_built_in_structures(client):
    response = client.get("/api/reports/sim/strategies")
    assert response.status_code == 200
    templates = response.json()["templates"]
    assert len(templates) == len(TEMPLATE_IDS)
    assert [t["id"] for t in templates] == TEMPLATE_IDS
    for template in templates:
        assert set(template) == {"id", "name", "blurb", "legs", "exec"}
        assert template["legs"], template["id"]
        assert template["exec"] == {
            "entryTime": "09:35", "slPct": 30.0, "tpPct": 60.0,
            "maxHoldMin": 60, "trailPct": 0.0, "eodExit": "15:10",
        }
        for leg in template["legs"]:
            assert set(leg) == {"action", "opt", "strike", "lots"}


# --------------------------------------------------------------------------
# Run
# --------------------------------------------------------------------------
def test_run_returns_camel_case_payload(client, monkeypatch):
    monkeypatch.setattr(sim, "_load_ticks", lambda symbol, date: _session_ticks())

    response = client.post("/api/reports/sim/run", json=_body())
    assert response.status_code == 200
    payload = response.json()

    assert set(payload) == {
        "symbol", "date", "expiry", "dte", "asOf", "spot", "lotSize",
        "lotVerified", "coverage", "strategies", "combined", "tapeLagSec",
        "fillModel",
    }
    assert payload["symbol"] == "NIFTY"
    assert payload["date"] == DATE
    assert payload["expiry"] == EXPIRY
    assert payload["dte"] == 4
    assert payload["asOf"] == _session_ticks()[-1].t.isoformat()
    assert payload["lotSize"] == 65
    assert payload["lotVerified"] is True
    assert payload["coverage"] == {
        "frames": 5,
        "first": _session_ticks()[0].t.isoformat(),
        "last": _session_ticks()[-1].t.isoformat(),
        "gaps": 0,
    }
    assert payload["tapeLagSec"] == 0
    assert payload["fillModel"] == sim.FILL_MODEL

    strategy = payload["strategies"][0]
    assert strategy["id"] == "s1"
    assert "netDebit" in strategy
    assert strategy["netDebit"] == pytest.approx(120.0 * 65)
    assert strategy["trades"][0]["exitReason"] == "TARGET"
    assert set(payload["combined"]) == {"realized", "unrealized", "total", "equity"}


def test_combined_total_is_the_sum_of_strategy_totals(client, monkeypatch):
    monkeypatch.setattr(sim, "_load_ticks", lambda symbol, date: _session_ticks())
    strategies = [
        _strategy("s1", "Long call"),
        _strategy("s2", "Long put", legs=[
            {"action": "BUY", "opt": "PE", "strike": "ATM", "lots": 1},
        ]),
    ]

    payload = client.post("/api/reports/sim/run",
                          json=_body(strategies=strategies)).json()

    expected = sum(s["total"] for s in payload["strategies"])
    assert payload["combined"]["total"] == pytest.approx(expected)
    assert payload["combined"]["realized"] == pytest.approx(
        sum(s["realized"] for s in payload["strategies"]))
    assert payload["combined"]["unrealized"] == pytest.approx(
        sum(s["unrealized"] for s in payload["strategies"]))
    # One point per recorded minute, aligned across strategies.
    assert len(payload["combined"]["equity"]) == len(_session_ticks())
    assert payload["combined"]["equity"] == sorted(
        payload["combined"]["equity"], key=lambda point: point["t"])


def test_as_of_truncates_the_tape_and_reports_the_lag(client, monkeypatch):
    monkeypatch.setattr(sim, "_load_ticks", lambda symbol, date: _session_ticks())

    payload = client.post(
        "/api/reports/sim/run",
        json=_body(asOf="10:00"),
    ).json()

    assert payload["coverage"]["frames"] == 4
    assert payload["coverage"]["last"].startswith(f"{DATE}T09:38")
    assert payload["coverage"]["last"] <= f"{DATE}T10:00"
    assert payload["asOf"] == payload["coverage"]["last"]
    # 10:00 requested, the tape stops at 09:38.
    assert payload["tapeLagSec"] == 22 * 60


def test_bad_symbol_is_a_400(client, monkeypatch):
    monkeypatch.setattr(sim, "_load_ticks", lambda symbol, date: _session_ticks())
    response = client.post("/api/reports/sim/run",
                           json=_body(symbol="BAD SYMBOL"))
    assert response.status_code == 400
    assert "bad symbol" in response.json()["detail"]


def test_missing_tape_returns_the_trading_day_envelope(client, monkeypatch):
    monkeypatch.setattr(sim, "_load_ticks", lambda symbol, date: [])
    response = client.post("/api/reports/sim/run", json=_body())
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail == {
        "is_trading_day": False,
        "date": DATE,
        "message": f"no NIFTY tape for {DATE}",
    }


def test_zero_strategies_is_rejected_by_validation(client):
    response = client.post("/api/reports/sim/run", json=_body(strategies=[]))
    assert response.status_code == 422


def test_thirteen_legs_are_rejected_by_validation(client):
    legs = [{"action": "BUY", "opt": "CE", "strike": "ATM", "lots": 1}] * 13
    response = client.post(
        "/api/reports/sim/run",
        json=_body(strategies=[_strategy(legs=legs)]),
    )
    assert response.status_code == 422


def test_generic_symbol_reads_the_generic_tape(client, monkeypatch, tmp_path):
    tape_file = tmp_path / f"{DATE}.jsonl"
    tape_file.write_text("{}\n")
    monkeypatch.setattr(sim, "_TICKS_CACHE", {})
    monkeypatch.setattr(sim, "_tape_path", lambda symbol, date: tape_file)
    seen: list = []

    def fake_generic(path):
        seen.append(path)
        return _session_ticks()

    monkeypatch.setattr(sim, "_generic_ticks", fake_generic)

    response = client.post("/api/reports/sim/run",
                           json=_body(symbol="RELIANCE"))
    assert response.status_code == 200
    assert seen == [tape_file]
    payload = response.json()
    assert payload["symbol"] == "RELIANCE"
    assert payload["lotSize"] == 500
    assert payload["lotVerified"] is True


def test_costs_false_books_zero_costs(client, monkeypatch):
    monkeypatch.setattr(sim, "_load_ticks", lambda symbol, date: _session_ticks())

    payload = client.post("/api/reports/sim/run",
                          json=_body(costs=False)).json()
    trades = payload["strategies"][0]["trades"]
    assert trades
    assert all(trade["costs"] == 0 for trade in trades)
    assert trades[0]["netPnl"] == pytest.approx(trades[0]["grossPnl"])


def test_costs_true_charges_the_round_trip(client, monkeypatch):
    monkeypatch.setattr(sim, "_load_ticks", lambda symbol, date: _session_ticks())

    payload = client.post("/api/reports/sim/run",
                          json=_body(costs=True)).json()
    trade = payload["strategies"][0]["trades"][0]
    assert trade["costs"] > 0
    assert trade["netPnl"] == pytest.approx(trade["grossPnl"] - trade["costs"])
