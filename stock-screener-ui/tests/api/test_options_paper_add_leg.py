"""Staggered leg additions to an options paper position (in-memory SQLite).

Each leg keeps its own entry time and premium; the position is repriced from
every leg and the replay engine receives the per-leg times. No network.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("CI_MODE", "1")

from api_server_fastapi import app  # noqa: E402
from api.auth import get_current_user  # noqa: E402
from api.options_paper import service  # noqa: E402
from db.models import User  # noqa: E402
from db.models.option_snapshot import OptionChainSnapshot  # noqa: E402
from db.models.options_paper import OptionPaperLeg, OptionPaperPosition  # noqa: E402
from db.models.trade import Trade  # noqa: E402
from options_paper import structures  # noqa: E402
from options_paper.costs import option_entry_cost  # noqa: E402

UNDERLYING = "IRFC"
EXPIRY = "2026-11-23"
DAY1 = "2026-11-17"
DAY2 = "2026-11-18"
ENTRY_TS = f"{DAY1}T09:47:00+05:30"
ADDED_TS = f"{DAY2}T09:50:00+05:30"
IST = timezone(timedelta(hours=5, minutes=30))

# (strike, CE ltp, PE ltp) per minute. The 09:52 DAY2 minute deliberately drops
# the 87.5 CE print to zero to exercise the unpriced-strike guard; 09:53 restores
# it so a replay filling at 09:51 still has a later priced mark.
QUOTES = {
    (DAY1, "09:47"): [(82.5, 2.5, 0.7), (85.0, 0.9, 1.4)],
    (DAY1, "09:48"): [(82.5, 2.5, 0.7), (85.0, 0.9, 1.4)],
    (DAY1, "09:49"): [(82.5, 2.5, 0.7), (85.0, 0.9, 1.4)],
    (DAY1, "09:50"): [(82.5, 2.5, 0.7), (85.0, 0.9, 1.4)],
    (DAY2, "09:50"): [(82.5, 3.0, 0.8), (85.0, 1.1, 1.6), (87.5, 0.5, 2.2)],
    (DAY2, "09:51"): [(82.5, 3.0, 0.8), (85.0, 1.1, 1.6), (87.5, 0.5, 2.2)],
    (DAY2, "09:52"): [(82.5, 3.0, 0.8), (85.0, 1.1, 1.6), (87.5, 0.0, 2.2)],
    (DAY2, "09:53"): [(82.5, 3.0, 0.8), (85.0, 1.1, 1.6), (87.5, 0.5, 2.2)],
}


@pytest.fixture(autouse=True)
def _lot_size(monkeypatch):
    monkeypatch.setattr(service, "get_lot", lambda symbol: 1000)


@pytest.fixture
def chain(db):
    for (day, hm), rows in QUOTES.items():
        ts = datetime.fromisoformat(f"{day}T{hm}:00")
        for strike, ce, pe in rows:
            for side, ltp in (("CE", ce), ("PE", pe)):
                db.add(OptionChainSnapshot(
                    ts=ts, underlying=UNDERLYING, expiry=EXPIRY, strike=strike,
                    side=side, ltp=ltp, iv=18.0, oi=1200, volume=80,
                    spot=83.0, session_date=day, quotes_live=False,
                    iv_source="upstox",
                ))
    db.commit()


def _order(**overrides):
    body = {
        "underlying": UNDERLYING, "expiry": EXPIRY, "source": "replay",
        "entryTs": ENTRY_TS,
        "legs": [
            {"action": "BUY", "opt": "CE", "strike": 82.5, "lots": 1},
            {"action": "SELL", "opt": "CE", "strike": 85.0, "lots": 1},
        ],
    }
    body.update(overrides)
    return body


def _place(client):
    response = client.post("/api/options-paper/orders", json=_order())
    assert response.status_code == 200, response.text
    return response.json()["position"]


def _add(client, position_id, **overrides):
    body = {
        "action": "BUY", "opt": "CE", "strike": 87.5, "lots": 1,
        "entryTs": ADDED_TS,
    }
    body.update(overrides)
    return client.post(f"/api/options-paper/positions/{position_id}/legs", json=body)


def _seed_position(db, *, expiry=EXPIRY, entry_ts=None, legs=None):
    """Direct insert for the validation/settlement cases."""
    position = OptionPaperPosition(
        user_id=1, source="replay", status="open", underlying=UNDERLYING,
        expiry=expiry, name="staggered", entry_ts=(
            datetime.fromisoformat(entry_ts or ENTRY_TS)
        ),
        entry_spot=83.0, lots=1, net_debit=1600.0, costs_est=60.0,
        max_profit=0.0, max_loss=1600.0, breakevens="[]",
    )
    db.add(position)
    db.flush()
    for action, opt, strike, premium in (legs or [
        ("BUY", "CE", 82.5, 2.5), ("SELL", "CE", 85.0, 0.9),
    ]):
        leg = OptionPaperLeg(
            position=position, action=action, opt_type=opt, strike=strike,
            lots=1, qty=1000, entry_premium=premium, mark_premium=premium,
            mark_ts=position.entry_ts, exit_premium=None,
        )
        leg.entry_ts = position.entry_ts
        db.add(leg)
    db.commit()
    db.refresh(position)
    return position


def _filled_from_db(db, position_id):
    return [
        structures.ResolvedLeg(
            action=leg.action, opt=leg.opt_type, strike=float(leg.strike),
            lots=int(leg.lots), qty=int(leg.qty),
            entry_premium=float(leg.entry_premium),
        )
        for leg in db.query(OptionPaperLeg).filter(
            OptionPaperLeg.position_id == position_id
        ).all()
    ]


# ---------------------------------------------------------------------------
# 1. Backdated additions
# ---------------------------------------------------------------------------
def test_add_leg_one_day_after_initial_position(auth_client, chain, db):
    position = _place(auth_client)
    response = _add(auth_client, position["id"])
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["status"] == "open"
    assert len(row["legs"]) == 3

    initial = {leg["strike"]: leg for leg in position["legs"]}
    added = next(leg for leg in row["legs"] if leg["strike"] == 87.5)
    assert added["action"] == "BUY" and added["optType"] == "CE"
    assert added["entryPremium"] == 0.5
    assert added["markPremium"] == 0.5
    assert added["entryTs"].startswith(ADDED_TS[:-6])
    assert initial[82.5]["entryPremium"] == 2.5
    assert initial[85.0]["entryPremium"] == 0.9

    stored = db.query(OptionPaperLeg).filter(
        OptionPaperLeg.position_id == position["id"], OptionPaperLeg.strike == 87.5
    ).one()
    assert stored.entry_premium == 0.5
    assert stored.mark_ts == datetime.fromisoformat(ADDED_TS).replace(tzinfo=None)
    # No Trade is booked until close/settlement.
    assert db.query(Trade).count() == 0


def test_add_leg_same_day_later_keeps_its_own_entry_time(auth_client, chain):
    position = _place(auth_client)
    response = _add(auth_client, position["id"], action="BUY", opt="PE",
                    strike=85.0, entryTs=f"{DAY1}T09:49:00+05:30")
    assert response.status_code == 200, response.text
    row = response.json()
    added = next(
        leg for leg in row["legs"]
        if leg["strike"] == 85.0 and leg["optType"] == "PE"
    )
    assert added["entryPremium"] == 1.4
    assert added["entryTs"].startswith(f"{DAY1}T09:49")
    assert row["entryTs"].startswith(f"{DAY1}T09:47")
    assert added["entryTs"] != row["entryTs"]


def test_add_leg_without_entry_ts_uses_live_chain_and_snake_aliases(
    auth_client, chain, db, monkeypatch,
):
    position = _place(auth_client)

    async def _live(underlying, expiry):
        chain = [{
            "strike": 87.5,
            "ce": {"market_data": {"ltp": 1.25}, "instrument_key": "NSE_FO|CE87"},
            "pe": {"market_data": {"ltp": 2.2}, "instrument_key": "NSE_FO|PE87"},
        }]
        return chain, 83.0

    monkeypatch.setattr("api.options._fetch_chain_rows", _live)
    monkeypatch.setattr(service, "_market_open_now", lambda: True)
    response = auth_client.post(
        f"/api/options-paper/positions/{position['id']}/legs",
        json={
            "action": "BUY", "optType": "CE", "strike": 87.5, "lots": 1,
            "instrument_key": "NSE_FO|CE87",
        },
    )
    assert response.status_code == 200, response.text
    row = response.json()
    added = next(leg for leg in row["legs"] if leg["strike"] == 87.5)
    assert added["entryPremium"] == 1.25
    assert added["instrumentKey"] == "NSE_FO|CE87"
    assert added["entryTs"] is not None
    assert db.query(Trade).count() == 0


# ---------------------------------------------------------------------------
# 2. Validation
# ---------------------------------------------------------------------------
def test_duplicate_leg_is_400(auth_client, chain):
    position = _place(auth_client)
    response = _add(auth_client, position["id"], strike=82.5)
    assert response.status_code == 400, response.text
    assert "duplicate" in response.json()["detail"].lower()


@pytest.mark.parametrize("strike", ["ATM+99", "garbage", 999])
def test_invalid_strike_is_400(auth_client, chain, strike):
    position = _place(auth_client)
    response = _add(auth_client, position["id"], strike=strike)
    assert response.status_code == 400, response.text
    assert "strike" in response.json()["detail"].lower()


def test_unpriced_strike_is_400(auth_client, chain):
    position = _place(auth_client)
    response = _add(auth_client, position["id"],
                    entryTs=f"{DAY2}T09:52:00+05:30")
    assert response.status_code == 400, response.text
    assert "strike" in response.json()["detail"].lower()
    assert "unpriced" in response.json()["detail"].lower()


def test_fifth_leg_is_400(auth_client, db):
    position = _seed_position(db, legs=[
        ("BUY", "CE", 80.0, 3.0), ("SELL", "CE", 81.0, 2.0),
        ("BUY", "PE", 82.0, 1.0), ("SELL", "PE", 83.0, 0.5),
    ])
    response = _add(auth_client, position.id)
    assert response.status_code == 400, response.text
    assert "legs" in response.json()["detail"].lower()
    assert db.query(OptionPaperLeg).filter(
        OptionPaperLeg.position_id == position.id
    ).count() == 4


def test_mixed_expiry_and_underlying_are_400(auth_client, chain, db):
    position = _place(auth_client)
    for field, value in (("expiry", "2026-12-23"), ("underlying", "RELIANCE")):
        response = _add(auth_client, position["id"], **{field: value})
        assert response.status_code == 400, response.text
        assert field in response.json()["detail"].lower()


def test_wrong_user_gets_404(auth_client, chain, db):
    position = _place(auth_client)
    other = User(id=2, email="other@example.com", hashed_password="x",
                 display_name="Other", is_active=True)
    db.add(other)
    db.commit()

    app.dependency_overrides[get_current_user] = lambda: other
    try:
        assert _add(auth_client, position["id"]).status_code == 404
    finally:
        app.dependency_overrides[get_current_user] = (
            lambda: db.query(User).filter(User.id == 1).one()
        )
    assert db.query(OptionPaperLeg).filter(
        OptionPaperLeg.position_id == position["id"]
    ).count() == 2


# ---------------------------------------------------------------------------
# 3. Repricing and replay
# ---------------------------------------------------------------------------
def test_position_metrics_recomputed_from_all_legs(auth_client, chain, db):
    position = _place(auth_client)
    before = auth_client.get(
        f"/api/options-paper/positions/{position['id']}"
    ).json()
    response = _add(auth_client, position["id"])
    assert response.status_code == 200, response.text
    after = response.json()

    filled = _filled_from_db(db, position["id"])
    expected_costs = sum(
        option_entry_cost(
            leg.entry_premium, leg.qty, is_short=leg.action == "SELL"
        )["costs"]
        for leg in filled
    )
    assert len(filled) == 3
    assert after["costsEst"] == pytest.approx(round(expected_costs, 2))
    assert after["netDebit"] == pytest.approx(
        round(structures.net_entry_cost(filled), 2)
    )
    assert after["breakevens"] != before["breakevens"] or after["maxLoss"] != before["maxLoss"]
    # An extra long leg deepens the debit, so the sampled worst case worsens.
    assert after["maxLoss"] < before["maxLoss"]
    assert db.query(OptionPaperPosition).get(position["id"]).costs_est == pytest.approx(
        expected_costs
    )


def test_replay_receives_each_leg_effective_entry_time(auth_client, chain, monkeypatch):
    position = _place(auth_client)
    response = _add(auth_client, position["id"])
    assert response.status_code == 200, response.text

    captured = {}
    real_build = service.build_replay

    def _capture(**kwargs):
        captured.update(kwargs)
        return real_build(**kwargs)

    monkeypatch.setattr(service, "build_replay", _capture)
    replay = auth_client.get(f"/api/options-paper/replay/{position['id']}")
    assert replay.status_code == 200, replay.text
    payload = replay.json()
    assert payload["skipped"] is None
    assert payload["frames"]

    legs = captured["legs"]
    assert len(legs) == 3
    assert [leg.entry_time for leg in legs[:2]] == [
        datetime.fromisoformat(ENTRY_TS), datetime.fromisoformat(ENTRY_TS)
    ]
    assert legs[2].entry_time == datetime.fromisoformat(ADDED_TS)

    # The engine turns those times into a per-frame active map: the added leg
    # is absent until its own fill bar, while the original two are already live.
    before_add = next(
        frame for frame in payload["frames"]
        if frame["t"].startswith(f"{DAY2}T09:50")
    )
    after_add = next(
        frame for frame in payload["frames"]
        if frame["t"].startswith(f"{DAY2}T09:51")
    )
    assert before_add["active"] == {
        "82.5-CE": True, "85-CE": True, "87.5-CE": False,
    }
    assert after_add["active"]["87.5-CE"] is True


# ---------------------------------------------------------------------------
# 4. Close and expiry settlement
# ---------------------------------------------------------------------------
def test_close_books_one_trade_per_leg_with_its_own_entry_price(
    auth_client, chain, db,
):
    position = _place(auth_client)
    assert _add(auth_client, position["id"]).status_code == 200

    close = auth_client.post(
        f"/api/options-paper/positions/{position['id']}/close",
        json={"premiums": {"82.5-CE": 4.0, "85-CE": 1.2, "87.5-CE": 0.8}},
    )
    assert close.status_code == 200, close.text
    trades = db.query(Trade).all()
    assert len(trades) == 3
    assert {t.entry_price for t in trades} == {2.5, 0.9, 0.5}
    assert {t.exit_price for t in trades} == {4.0, 1.2, 0.8}
    assert {t.exit_reason for t in trades} == {"MANUAL"}

    third = next(t for t in trades if t.entry_price == 0.5)
    assert third.entry_time == datetime.fromisoformat(ADDED_TS).replace(tzinfo=None)


def test_expiry_settlement_handles_staggered_legs(auth_client, chain, db):
    position = _place(auth_client)
    assert _add(auth_client, position["id"]).status_code == 200
    db.query(OptionPaperPosition).filter(
        OptionPaperPosition.id == position["id"]
    ).one().expiry = "2026-01-01"
    db.query(OptionChainSnapshot).update({OptionChainSnapshot.expiry: "2026-01-01"})
    db.commit()

    settled = auth_client.get(
        "/api/options-paper/positions", params={"status": "expired"}
    )
    assert settled.status_code == 200, settled.text
    rows = settled.json()["positions"]
    assert len(rows) == 1
    assert len(rows[0]["legs"]) == 3
    assert rows[0]["closeReason"] == "EXPIRED"

    trades = db.query(Trade).filter(Trade.exit_reason == "EXPIRED").all()
    assert len(trades) == 3
    # At expiry the 82.5 CE settles intrinsic (spot 83 → 0.5); OTM legs → 0.
    assert {t.exit_price for t in trades} == {0.5, 0.0}
    assert {t.entry_price for t in trades} == {2.5, 0.9, 0.5}

    # Settlement is lazy/idempotent on read.
    auth_client.get("/api/options-paper/positions", params={"status": "expired"})
    assert db.query(Trade).filter(Trade.exit_reason == "EXPIRED").count() == 3
