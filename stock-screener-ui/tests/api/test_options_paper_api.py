"""API tests for the options paper book (in-memory SQLite, no network)."""
from __future__ import annotations

import os
from datetime import datetime

import pytest

os.environ.setdefault("CI_MODE", "1")

from api_server_fastapi import app  # noqa: E402
from api.auth import get_current_user  # noqa: E402
from api.options_paper import service  # noqa: E402
from db.models import User  # noqa: E402
from db.models.option_snapshot import OptionChainSnapshot  # noqa: E402
from db.models.options_paper import OptionPaperLeg, OptionPaperPosition  # noqa: E402
from db.models.trade import Trade  # noqa: E402

UNDERLYING = "IRFC"
EXPIRY = "2026-11-23"
SESSION = "2026-11-17"
ENTRY_TS = f"{SESSION}T09:47:00+05:30"
STRIKES = (82.5, 85.0)


@pytest.fixture(autouse=True)
def _lot_size(monkeypatch):
    """Keep lot sizing independent of the real instruments master."""
    monkeypatch.setattr(service, "get_lot", lambda symbol: 1000)


@pytest.fixture
def chain(db):
    """Four minutes of IRFC snapshot quotes for a 2-leg bull call spread."""
    for offset in range(4):
        ts = datetime.fromisoformat(f"{SESSION}T09:{47 + offset}:00")
        for strike in STRIKES:
            ce = 2.5 if strike == 82.5 else 0.9
            pe = 0.7 if strike == 82.5 else 1.4
            for side, ltp in (("CE", ce), ("PE", pe)):
                db.add(OptionChainSnapshot(
                    ts=ts, underlying=UNDERLYING, expiry=EXPIRY, strike=strike,
                    side=side, ltp=ltp, iv=18.0, oi=1200, volume=80,
                    spot=83.0, session_date=SESSION, quotes_live=False,
                    iv_source="upstox",
                ))
    db.commit()


def _live_chain(ce_85=0.9):
    async def fake(underlying, expiry):
        chain = []
        for strike in STRIKES:
            ce_ltp = 2.5 if strike == 82.5 else ce_85
            chain.append({
                "strike": strike,
                "ce": {"market_data": {"ltp": ce_ltp}, "instrument_key": f"NSE_FO|CE{int(strike)}"},
                "pe": {"market_data": {"ltp": 0.7 if strike == 82.5 else 1.4},
                       "instrument_key": f"NSE_FO|PE{int(strike)}"},
            })
        return chain, 83.0
    return fake


def _legs(action="BUY", opt="CE"):
    return [
        {"action": "BUY", "opt": "CE", "strike": 82.5, "lots": 1},
        {"action": "SELL", "opt": "CE", "strike": 85.0, "lots": 1},
    ]


def _order(**overrides):
    body = {
        "underlying": UNDERLYING,
        "expiry": EXPIRY,
        "source": "live",
        "legs": _legs(),
        "slippageTicks": 0,
        "name": "IRFC bull call",
        "notes": "dock order",
    }
    body.update(overrides)
    return body


def _replay_order(**overrides):
    return _order(source="replay", entryTs=ENTRY_TS, **overrides)


def _place(client, body):
    response = client.post("/api/options-paper/orders", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_lot_resolution_is_sourced_and_never_invented(db, monkeypatch):
    from options_paper.spec import get_lot as real_get_lot

    monkeypatch.setattr(service, "get_lot", real_get_lot)
    assert service._lot_size(db, "IRFC") == 5425
    with pytest.raises(service.OrderError, match="no verified lot size"):
        service._lot_size(db, "UNKNOWNXYZ")


def test_expired_positions_settle_on_read(auth_client, db):
    position = OptionPaperPosition(
        user_id=1, source="live", status="open", underlying=UNDERLYING,
        expiry="2026-01-01", name="", entry_ts=datetime(2026, 1, 1, 9, 15),
        entry_spot=83.0, lots=1, net_debit=1600.0, costs_est=60.0,
        max_profit=0.0, max_loss=1600.0, breakevens="[]",
    )
    db.add(position)
    db.flush()
    db.add(OptionPaperLeg(
        position_id=position.id, action="BUY", opt_type="CE", strike=82.5,
        lots=1, qty=1000, entry_premium=2.5, mark_premium=2.5,
    ))
    db.commit()

    response = auth_client.get("/api/options-paper/positions", params={"status": "expired"})
    assert response.status_code == 200, response.text
    rows = response.json()["positions"]
    assert len(rows) == 1
    assert rows[0]["status"] == "expired"
    assert rows[0]["closeReason"] == "EXPIRED"
    assert db.query(Trade).filter(Trade.exit_reason == "EXPIRED").count() == 1

    # Idempotent: a second read must not book the same leg twice.
    auth_client.get("/api/options-paper/positions", params={"status": "expired"})
    assert db.query(Trade).filter(Trade.exit_reason == "EXPIRED").count() == 1


def test_live_order_persists_position_and_legs(auth_client, monkeypatch):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain())
    result = _place(auth_client, _order())

    assert result["dryRun"] is False
    assert result["replay"] is None
    position = result["position"]
    assert position["source"] == "live"
    assert position["status"] == "open"
    assert position["userId"] == 1
    assert position["expiry"] == EXPIRY
    assert position["entrySpot"] == 83.0
    assert position["netDebit"] > 0
    assert position["costsEst"] > 0
    assert len(position["legs"]) == 2
    assert {leg["action"] for leg in position["legs"]} == {"BUY", "SELL"}
    assert {leg["entryPremium"] for leg in position["legs"]} == {2.5, 0.9}
    assert all(leg["markPremium"] == leg["entryPremium"] for leg in position["legs"])
    assert position["dte"] >= 0
    assert position["unrealizedPnl"] <= 0  # entry costs are paid


def test_live_order_writes_no_db_on_dry_run(auth_client, monkeypatch, db):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain())
    first = _place(auth_client, _order(dryRun=True))
    second = _place(auth_client, _order(dryRun=True))

    assert first == second
    assert first["dryRun"] is True
    assert first["position"] is None
    assert first["replay"] is not None
    assert first["replay"]["frames"] == []
    assert first["replay"]["source"] == "live"
    assert db.query(OptionPaperPosition).count() == 0
    assert db.query(OptionPaperLeg).count() == 0


def test_backdated_replay_order_commits_with_fill_premiums(auth_client, chain, db):
    result = _place(auth_client, _replay_order())

    assert result["dryRun"] is False
    assert result["replay"] is None
    position = result["position"]
    assert position["source"] == "replay"
    assert position["status"] == "open"
    assert position["entryTs"].startswith(SESSION)
    assert position["entrySpot"] == 83.0
    assert len(position["legs"]) == 2
    assert {leg["entryPremium"] for leg in position["legs"]} == {2.5, 0.9}
    assert db.query(OptionPaperPosition).count() == 1
    assert db.query(OptionPaperLeg).count() == 2


def test_dry_run_replay_is_deterministic_and_writes_nothing(auth_client, chain, db):
    first = _place(auth_client, _replay_order(dryRun=True))
    second = _place(auth_client, _replay_order(dryRun=True))

    assert first == second
    assert first["dryRun"] is True
    assert first["position"] is None
    assert len(first["replay"]["frames"]) >= 2
    assert first["replay"]["summary"]["costs"] > 0
    assert first["replay"]["skipped"] is None
    assert db.query(OptionPaperPosition).count() == 0


@pytest.mark.parametrize("leg,expected", [
    ({"action": "HOLD", "opt": "CE", "strike": 82.5, "lots": 1}, "action"),
    ({"action": "BUY", "opt": "CE", "strike": "ATM+99", "lots": 1}, "strike"),
    ({"action": "BUY", "opt": "CE", "strike": 999, "lots": 1}, "strike"),
    ({"action": "BUY", "opt": "CE", "strike": 82.5, "lots": 0}, "lots"),
    ({"action": "BUY", "opt": "XX", "strike": 82.5, "lots": 1}, "opt"),
])
def test_invalid_leg_returns_400_naming_field(auth_client, monkeypatch, leg, expected):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain())
    body = _order(legs=[leg, _legs()[1]])
    response = auth_client.post("/api/options-paper/orders", json=body)
    assert response.status_code == 400, response.text
    assert expected in response.json()["detail"].lower()


@pytest.mark.parametrize("dry_run", [False, True])
def test_duplicate_initial_legs_are_400(auth_client, monkeypatch, db, dry_run):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain())
    legs = [
        {"action": "BUY", "opt": "CE", "strike": 82.5, "lots": 1},
        {"action": "BUY", "opt": "CE", "strike": 82.5, "lots": 1},
    ]
    response = auth_client.post(
        "/api/options-paper/orders", json=_order(legs=legs, dryRun=dry_run)
    )
    assert response.status_code == 400, response.text
    assert "duplicate" in response.json()["detail"].lower()
    assert db.query(OptionPaperPosition).count() == 0
    assert db.query(OptionPaperLeg).count() == 0


def test_live_chain_zero_spot_is_400(auth_client, monkeypatch, db):
    base = _live_chain()

    async def _zero_spot(underlying, expiry):
        chain, _ = await base(underlying, expiry)
        return chain, 0.0

    monkeypatch.setattr("api.options._fetch_chain_rows", _zero_spot)
    response = auth_client.post("/api/options-paper/orders", json=_order())
    assert response.status_code == 400, response.text
    assert "spot" in response.json()["detail"].lower()
    assert db.query(OptionPaperPosition).count() == 0
    assert db.query(OptionPaperLeg).count() == 0


def test_replay_with_all_spots_missing_is_400(auth_client, db):
    for offset in range(4):
        ts = datetime.fromisoformat(f"{SESSION}T09:{47 + offset}:00")
        for strike in STRIKES:
            for side, ltp in (("CE", 2.5 if strike == 82.5 else 0.9),
                              ("PE", 0.7 if strike == 82.5 else 1.4)):
                db.add(OptionChainSnapshot(
                    ts=ts, underlying=UNDERLYING, expiry=EXPIRY, strike=strike,
                    side=side, ltp=ltp, iv=18.0, oi=1200, volume=80,
                    spot=None, session_date=SESSION, quotes_live=False,
                    iv_source="upstox",
                ))
    db.commit()

    response = auth_client.post("/api/options-paper/orders", json=_replay_order())
    assert response.status_code == 400, response.text
    assert "spot" in response.json()["detail"].lower()
    assert db.query(OptionPaperPosition).count() == 0
    assert db.query(OptionPaperLeg).count() == 0


def test_unpriced_leg_returns_400(auth_client, monkeypatch):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain(ce_85=0))
    response = auth_client.post("/api/options-paper/orders", json=_order())
    assert response.status_code == 400, response.text
    assert "unpriced" in response.json()["detail"].lower()


def test_mixed_expiry_returns_400(auth_client, monkeypatch):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain())
    legs = _legs()
    legs[1]["expiry"] = "2026-12-23"
    response = auth_client.post("/api/options-paper/orders", json=_order(legs=legs))
    assert response.status_code == 400, response.text
    assert "expiry" in response.json()["detail"].lower()


def test_positions_list_marks_held_strike(auth_client, chain, db):
    position = _place(auth_client, _replay_order())["position"]
    db.add(OptionChainSnapshot(
        ts=datetime.fromisoformat(f"{SESSION}T09:55:00"),
        underlying=UNDERLYING, expiry=EXPIRY, strike=82.5, side="CE",
        ltp=5.0, iv=20.0, oi=1500, volume=90, spot=84.0,
        session_date=SESSION, quotes_live=False, iv_source="upstox",
    ))
    db.commit()

    response = auth_client.get("/api/options-paper/positions?status=open")
    assert response.status_code == 200, response.text
    rows = response.json()["positions"]
    assert len(rows) == 1
    assert rows[0]["id"] == position["id"]
    marked = next(leg for leg in rows[0]["legs"] if leg["strike"] == 82.5)
    assert marked["markPremium"] == 5.0
    assert rows[0]["markSpot"] == 84.0
    assert rows[0]["unrealizedPnl"] > position["unrealizedPnl"]
    assert rows[0]["totalPnl"] == pytest.approx(
        rows[0]["unrealizedPnl"] + rows[0]["realizedPnl"]
    )


def test_close_books_trades_row(auth_client, chain, db):
    position = _place(auth_client, _replay_order())["position"]
    response = auth_client.post(
        f"/api/options-paper/positions/{position['id']}/close",
        json={"premiums": {"82.5-CE": 4.0, "85-CE": 1.2}},
    )
    assert response.status_code == 200, response.text
    closed = response.json()
    assert closed["status"] == "closed"
    assert closed["closeReason"] == "MANUAL"
    assert closed["closedAt"]
    assert closed["realizedPnl"] > 0
    assert closed["unrealizedPnl"] == 0
    assert {leg["exitPremium"] for leg in closed["legs"]} == {4.0, 1.2}

    trades = db.query(Trade).all()
    assert len(trades) == 2
    assert {t.source for t in trades} == {"options_paper_replay"}
    assert {t.exit_reason for t in trades} == {"MANUAL"}
    assert all(t.symbol.startswith(UNDERLYING) for t in trades)
    assert all("manual exit:" in (t.notes or "") for t in trades)


def test_replay_sessions_from_snapshots(auth_client, chain):
    response = auth_client.get("/api/options-paper/replay/sessions")
    assert response.status_code == 200, response.text
    sessions = response.json()["sessions"]
    assert any(
        s["underlying"] == UNDERLYING and s["date"] == SESSION and s["expiry"] == EXPIRY
        for s in sessions
    )


def test_replay_frames_recomputed_for_position(auth_client, chain):
    position = _place(auth_client, _replay_order())["position"]
    response = auth_client.get(f"/api/options-paper/replay/{position['id']}")
    assert response.status_code == 200, response.text
    replay = response.json()
    assert replay["positionId"] == position["id"]
    assert replay["skipped"] is None
    assert len(replay["frames"]) >= 2
    assert replay["frames"][-1]["t"] >= replay["frames"][0]["t"]
    assert replay["summary"]["costs"] > 0
    assert replay["payoff"]["spots"]


def test_chain_at_returns_tuple_legs(auth_client, chain):
    response = auth_client.get(
        "/api/options-paper/chain-at",
        params={"underlying": UNDERLYING, "date": SESSION, "time": "09:48"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["expiry"] == EXPIRY
    assert payload["spot"] == 83.0
    assert payload["source"] == "snapshot"
    assert len(payload["legs"]) == 2
    row = next(row for row in payload["legs"] if row[0] == 82.5)
    assert row[1] == 2.5  # CE LTP


def test_wrong_user_cannot_read_or_close(auth_client, chain, db):
    position = _place(auth_client, _replay_order())["position"]
    other = User(
        id=2, email="other@example.com", hashed_password="x",
        display_name="Other", is_active=True,
    )
    db.add(other)
    db.commit()

    app.dependency_overrides[get_current_user] = lambda: other
    try:
        assert auth_client.get(f"/api/options-paper/positions/{position['id']}").status_code == 404
        assert auth_client.post(
            f"/api/options-paper/positions/{position['id']}/close", json={}
        ).status_code == 404
        assert auth_client.get(f"/api/options-paper/replay/{position['id']}").status_code == 404
    finally:
        app.dependency_overrides[get_current_user] = lambda: db.query(User).filter(User.id == 1).one()
