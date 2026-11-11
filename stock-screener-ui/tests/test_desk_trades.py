"""Unit tests for ``api/reports_api/desk_trades.py``.

Pure parsing/marker helpers are tested directly; file reads go through a
``tmp_path`` journal directory. No network, no DB, no writes outside tmp.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.reports_api.desk_trades as desk
from api.reports_api.desk_trades import (
    build_markers,
    build_summary,
    collect_desk_trades,
    normalise_position,
    parse_journal_lines,
    read_journal,
    read_open_positions,
)

DATE = "2026-10-21"


def _record(**over):
    base = {
        "strategy": "agent_discretionary",
        "symbol": "NIFTY 2026-10-27 23000PE",
        "opt": "PE",
        "strike": 23000.0,
        "direction": "LONG",
        "entry_time": "2026-10-21T09:20:00+05:30",
        "exit_time": "2026-10-21T09:40:00+05:30",
        "entry_premium": 120.0,
        "exit_premium": 150.0,
        "entry_spot": 23050.0,
        "exit_spot": 23010.0,
        "net_pnl": 1900.0,
        "exit_reason": "target",
        "reason": "put wall bounce",
        "_key": "k1",
    }
    base.update(over)
    return base


def _write_journal(tmp_path, records, date=DATE, extra_lines=()):
    path = tmp_path / f"{date}.jsonl"
    lines = [json.dumps(r) for r in records] + list(extra_lines)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _write_positions(tmp_path, positions):
    path = tmp_path / "agent_positions.json"
    path.write_text(json.dumps({"positions": positions}), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Markers
# ---------------------------------------------------------------------------

def test_valid_entry_and_exit_markers():
    records = [
        _record(),
        _record(opt="CE", strike=23100.0, direction="SHORT",
                entry_time="2026-10-21T09:30:00+05:30",
                exit_time="2026-10-21T10:05:00+05:30",
                entry_premium=80.0, exit_premium=92.0, net_pnl=-500.0,
                exit_reason="structural stop", reason="range sell",
                _key="k2"),
    ]
    markers = build_markers(records)

    assert len(markers) == 4
    # Chronological across trades (09:20, 09:30, 09:40, 10:05).
    assert [m["kind"] for m in markers] == ["entry", "entry", "exit", "exit"]
    assert [m["t"] for m in markers] == [
        "2026-10-21T09:20:00+05:30",
        "2026-10-21T09:30:00+05:30",
        "2026-10-21T09:40:00+05:30",
        "2026-10-21T10:05:00+05:30",
    ]

    first_entry = markers[0]
    assert first_entry == {
        "kind": "entry",
        "t": "2026-10-21T09:20:00+05:30",
        "spot": 23050.0,
        "opt": "PE",
        "strike": 23000.0,
        "side": "LONG",
        "price": 120.0,
        "net_pnl": None,
        "reason": "put wall bounce",
        "trade_key": "k1",
    }
    first_exit = markers[2]
    assert first_exit["kind"] == "exit"
    assert first_exit["price"] == 150.0
    assert first_exit["net_pnl"] == 1900.0
    assert first_exit["reason"] == "target"
    assert first_exit["spot"] == 23010.0
    assert first_exit["trade_key"] == "k1"
    assert markers[1]["side"] == "SHORT"
    assert markers[3]["net_pnl"] == -500.0


def test_trade_key_falls_back_to_strategy_symbol_entry():
    markers = build_markers([_record(_key=None)])
    assert markers[0]["trade_key"] == (
        "agent_discretionary|NIFTY 2026-10-27 23000PE|"
        "2026-10-21T09:20:00+05:30"
    )


def test_opt_and_side_derived_when_fields_missing():
    record = _record(opt=None, direction=None, exit_time=None,
                     symbol="NIFTY26OCT23050CE", side="sell")
    markers = build_markers([record])
    assert len(markers) == 1
    assert markers[0]["opt"] == "CE"
    assert markers[0]["side"] == "SHORT"


# ---------------------------------------------------------------------------
# Journal parsing
# ---------------------------------------------------------------------------

def test_malformed_lines_are_skipped(tmp_path):
    path = _write_journal(
        tmp_path,
        [_record()],
        extra_lines=["", "not json", "[]", "42", '{"strategy": "x"}',
                     '{"entry_time": ""}', '{"entry_time": "2026-10-21T10:00:00"}'],
    )
    with open(path, encoding="utf-8") as f:
        records = parse_journal_lines(f)
    assert len(records) == 2
    assert records[0]["_key"] == "k1"
    # The last line is valid JSON with a usable entry_time but no exit.
    assert records[1]["entry_time"] == "2026-10-21T10:00:00"


def test_missing_journal_file_returns_empty(tmp_path):
    assert read_journal(DATE, tmp_path) == []
    payload = collect_desk_trades(DATE, tmp_path)
    assert payload == {
        "date": DATE,
        "markers": [],
        "open": [],
        "summary": {
            "closed": 0, "net": 0.0, "wins": 0, "losses": 0,
            "by_book": {
                "manual": {"closed": 0, "net": 0.0, "wins": 0, "losses": 0},
                "coded": {"closed": 0, "net": 0.0, "wins": 0, "losses": 0},
            },
        },
    }


# ---------------------------------------------------------------------------
# Open positions
# ---------------------------------------------------------------------------

def test_open_positions_are_normalised_and_date_scoped(tmp_path):
    _write_positions(tmp_path, [
        {
            "id": "131453", "strategy": "agent_discretionary",
            "opt": "CE", "strike": 23000.0, "direction": "SHORT",
            "lots": 1, "qty": 65, "premium": 70.45,
            "entry_premium": 70.45,
            "entry_time": "2026-10-21T13:14:16.362637+05:30",
            "entry_spot": 22713.45, "expiry": "2026-10-27",
            "stop": 95.0, "target": 52.0, "tag": "range-sell",
            "reason": "re-enter the range sell",
        },
        {
            "opt": "PE", "strike": 22700.0, "direction": "LONG",
            "entry_premium": 110.0,
            "entry_time": "2026-10-20T10:00:00+05:30",
        },
        # No entry_time: kept because it cannot be assigned to another day.
        {
            "opt": "PE", "strike": 22650.0, "direction": "LONG",
            "premium": 99.5,
        },
        "not a position",
    ])

    positions = read_open_positions(DATE, tmp_path)

    assert len(positions) == 2
    first = positions[0]
    assert first["opt"] == "CE"
    assert first["strike"] == 23000.0
    assert first["side"] == "SHORT"
    assert first["entry_premium"] == 70.45
    assert first["stop"] == 95.0 and first["target"] == 52.0
    assert first["lots"] == 1 and first["qty"] == 65
    assert first["entry_time"] == "2026-10-21T13:14:16.362637+05:30"
    assert first["tag"] == "range-sell"
    # ``premium`` is the fallback when ``entry_premium`` is absent.
    assert positions[1]["entry_premium"] == 99.5


def test_missing_positions_file_returns_empty(tmp_path):
    assert read_open_positions(DATE, tmp_path) == []


def test_normalise_position_rejects_unusable_rows():
    assert normalise_position("nope") is None
    assert normalise_position({"opt": None, "strike": None}) is None


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def test_summary_sums_realised_pnl():
    records = [
        _record(net_pnl=100.0),
        _record(net_pnl=-40.0),
        _record(net_pnl=0.0),
        _record(exit_time=None, net_pnl=999.0),   # still open: not counted
        _record(net_pnl="bad"),                    # closed, P&L unknown
    ]
    assert build_summary(records) == {
        "closed": 4, "net": 60.0, "wins": 1, "losses": 1,
        "by_book": {
            "manual": {"closed": 4, "net": 60.0, "wins": 1, "losses": 1},
            "coded": {"closed": 0, "net": 0.0, "wins": 0, "losses": 0},
        },
    }


def test_summary_splits_the_manual_and_coded_books():
    records = [
        _record(strategy="agent_discretionary", net_pnl=500.0),
        _record(strategy="nifty_momentum", net_pnl=-200.0),
        _record(strategy="nifty_momentum", net_pnl=50.0),
        _record(strategy="nifty_iv_delta", net_pnl=-25.0),
    ]
    summary = build_summary(records)
    assert summary["closed"] == 4
    assert summary["net"] == 325.0
    assert summary["wins"] == 2 and summary["losses"] == 2
    assert summary["by_book"]["manual"] == {
        "closed": 1, "net": 500.0, "wins": 1, "losses": 0}
    assert summary["by_book"]["coded"] == {
        "closed": 3, "net": -175.0, "wins": 1, "losses": 2}


def test_collect_combines_markers_open_and_summary(tmp_path):
    _write_journal(tmp_path, [_record()])
    _write_positions(tmp_path, [{
        "opt": "PE", "strike": 22700.0, "direction": "LONG",
        "entry_premium": 110.0, "entry_time": f"{DATE}T12:00:00+05:30",
        "expiry": "2026-10-27",
    }])

    payload = collect_desk_trades(DATE, tmp_path)

    assert payload["date"] == DATE
    assert len(payload["markers"]) == 2
    assert len(payload["open"]) == 1
    assert payload["open"][0]["legs"] == 1
    assert payload["summary"] == {
        "closed": 1, "net": 1900.0, "wins": 1, "losses": 0,
        "by_book": {
            "manual": {"closed": 1, "net": 1900.0, "wins": 1, "losses": 0},
            "coded": {"closed": 0, "net": 0.0, "wins": 0, "losses": 0},
        },
    }


# ---------------------------------------------------------------------------
# Open book: expiry scoping + straddles
# ---------------------------------------------------------------------------

def test_open_positions_today_are_scoped_by_expiry_not_entry_date(tmp_path):
    today = "2026-10-22"
    _write_positions(tmp_path, [
        # carried over from a previous session but still live -> belongs to today
        {"opt": "CE", "strike": 23300.0, "direction": "SHORT",
         "entry_premium": 55.2, "entry_time": "2026-10-21T11:05:00+05:30",
         "expiry": "2026-10-27"},
        # already expired -> dropped from today's book
        {"opt": "PE", "strike": 22700.0, "direction": "LONG",
         "entry_premium": 64.5, "entry_time": "2026-10-21T11:05:00+05:30",
         "expiry": "2026-10-21"},
        # no expiry -> cannot be ruled out, kept
        {"opt": "PE", "strike": 22650.0, "direction": "LONG",
         "entry_premium": 99.5},
    ])

    positions = read_open_positions(today, tmp_path, today=today)

    assert [p["strike"] for p in positions] == [23300.0, 22650.0]


def test_open_straddle_keeps_both_legs_and_strike(tmp_path):
    _write_positions(tmp_path, [{
        "id": "s1", "strategy": "agent_discretionary", "opt": "STRADDLE",
        "strike": 22850.0, "direction": "SHORT", "lots": 1, "qty": 65,
        "entry_premium": 119.7, "entry_time": f"{DATE}T11:05:00+05:30",
        "expiry": "2026-10-27",
    }])

    positions = read_open_positions(DATE, tmp_path, today=DATE)

    assert len(positions) == 1
    assert positions[0]["opt"] == "STRADDLE"
    assert positions[0]["legs"] == 2  # CE + PE, not a single leg
    assert positions[0]["strike"] == 22850.0


def test_opt_and_legs_are_derived_from_a_straddle_symbol():
    position = normalise_position({
        "symbol": "NIFTY 2026-10-19 22850STRADDLE", "strike": 22850.0,
        "entry_premium": 119.7,
    })
    assert position["opt"] == "STRADDLE"
    assert position["legs"] == 2
    single = normalise_position({
        "symbol": "NIFTY 2026-10-27 22700PE", "strike": 22700.0})
    assert single["opt"] == "PE" and single["legs"] == 1


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@pytest.fixture()
def desk_client(tmp_path, monkeypatch):
    monkeypatch.setattr(desk, "JOURNAL_DIR", tmp_path)
    app = FastAPI()
    # Mirrors how nifty.py mounts the router (parent prefix /api/reports).
    app.include_router(desk.router, prefix="/api/reports")
    with TestClient(app) as client:
        yield client


def test_endpoint_returns_payload(desk_client, tmp_path):
    _write_journal(tmp_path, [_record()])

    resp = desk_client.get(f"/api/reports/nifty/desk-trades?date={DATE}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["date"] == DATE
    assert [m["kind"] for m in body["markers"]] == ["entry", "exit"]
    assert body["markers"][1]["net_pnl"] == 1900.0
    assert body["summary"]["closed"] == 1
    assert body["open"] == []


def test_endpoint_missing_files_returns_empty(desk_client):
    resp = desk_client.get(f"/api/reports/nifty/desk-trades?date={DATE}")
    assert resp.status_code == 200
    assert resp.json()["markers"] == []
    assert resp.json()["open"] == []


def test_endpoint_rejects_bad_date(desk_client):
    resp = desk_client.get("/api/reports/nifty/desk-trades?date=21-10-2026")
    assert resp.status_code == 400


def test_route_is_registered_on_the_nifty_router(tmp_path, monkeypatch):
    from api.reports_api import nifty

    monkeypatch.setattr(desk, "JOURNAL_DIR", tmp_path)
    app = FastAPI()
    app.include_router(nifty.router)
    with TestClient(app) as client:
        resp = client.get(f"/api/reports/nifty/desk-trades?date={DATE}")

    assert resp.status_code == 200
    assert resp.json()["date"] == DATE
