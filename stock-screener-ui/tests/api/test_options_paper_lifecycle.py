"""Lifecycle and edge-case regressions for the options paper book.

Complements ``test_options_paper_api.py``: ownership isolation, request
validation, dry-run/real ordering, close, expiry settlement, history-less
replay and per-contract marking. In-memory SQLite only, no network.
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

UNDERLYING = "IRFC"
EXPIRY = "2026-11-23"
SESSION = "2026-11-17"
ENTRY_TS = f"{SESSION}T09:47:00+05:30"
STRIKES = (82.5, 85.0)
IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture(autouse=True)
def _lot_size(monkeypatch):
    """Keep lot sizing independent of the real instruments master."""
    monkeypatch.setattr(service, "get_lot", lambda symbol: 1000)


@pytest.fixture
def chain(db):
    """Four minutes of IRFC quotes for a two-leg bull call spread."""
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


def _live_chain(unpriced=None):
    async def fake(underlying, expiry):
        result = []
        for strike in STRIKES:
            row = {"strike": strike}
            for opt in ("CE", "PE"):
                ltp = {"CE": 2.5 if strike == 82.5 else 0.9,
                       "PE": 0.7 if strike == 82.5 else 1.4}[opt]
                if unpriced == (f"{strike:g}", opt):
                    ltp = 0
                row[opt.lower()] = {
                    "market_data": {"ltp": ltp},
                    "instrument_key": f"NSE_FO|{opt}{int(strike)}",
                }
            result.append(row)
        return result, 83.0
    return fake


def _legs():
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
        "notes": "lifecycle",
    }
    body.update(overrides)
    return body


def _replay_order(**overrides):
    return _order(source="replay", entryTs=ENTRY_TS, **overrides)


def _place(client, body):
    response = client.post("/api/options-paper/orders", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _seed_position(db, *, user_id=1, underlying=UNDERLYING, expiry=EXPIRY,
                   status="open", source="live", entry_ts=None,
                   premiums=None, marks=None):
    """Insert a two-leg position directly for read/close/settlement tests."""
    position = OptionPaperPosition(
        user_id=user_id, source=source, status=status, underlying=underlying,
        expiry=expiry, name="lifecycle",
        entry_ts=entry_ts or datetime.fromisoformat(ENTRY_TS),
        entry_spot=83.0, lots=1, net_debit=1600.0, costs_est=60.0,
        max_profit=0.0, max_loss=1600.0, breakevens="[]",
    )
    db.add(position)
    db.flush()
    premiums = premiums or {}
    marks = marks or {}
    for strike, action, opt, default in (
        (82.5, "BUY", "CE", 2.5), (85.0, "SELL", "CE", 0.9),
    ):
        key = f"{strike:g}-{opt}"
        entry = float(premiums.get(key, default))
        mark = float(marks.get(key, entry))
        db.add(OptionPaperLeg(
            position_id=position.id, action=action, opt_type=opt, strike=strike,
            lots=1, qty=1000, entry_premium=entry, mark_premium=mark,
            mark_ts=datetime.fromisoformat(ENTRY_TS), exit_premium=None,
        ))
    db.commit()
    db.refresh(position)
    return position


# ---------------------------------------------------------------------------
# 1. Ownership isolation
# ---------------------------------------------------------------------------
def test_cross_user_get_close_and_replay_are_404(auth_client, db):
    other = User(
        id=2, email="other@example.com", hashed_password="x",
        display_name="Other", is_active=True,
    )
    db.add(other)
    db.commit()
    mine = _seed_position(db, user_id=1)
    theirs = _seed_position(db, user_id=2)

    app.dependency_overrides[get_current_user] = lambda: other
    try:
        assert auth_client.get(f"/api/options-paper/positions/{mine.id}").status_code == 404
        assert auth_client.post(
            f"/api/options-paper/positions/{mine.id}/close", json={"premiums": {}}
        ).status_code == 404
        assert auth_client.get(f"/api/options-paper/replay/{mine.id}").status_code == 404
        # The same user can still read their own row (the 404 is ownership, not auth).
        own = auth_client.get(f"/api/options-paper/positions/{theirs.id}")
        assert own.status_code == 200, own.text
        assert own.json()["id"] == theirs.id
    finally:
        app.dependency_overrides[get_current_user] = (
            lambda: db.query(User).filter(User.id == 1).one()
        )

    assert db.query(Trade).count() == 0
    assert mine.status == "open"
    assert all(leg.exit_premium is None for leg in mine.legs)


# ---------------------------------------------------------------------------
# 2. Validation
# ---------------------------------------------------------------------------
FIVE_LEGS = [
    {"action": "BUY", "opt": "CE", "strike": 80, "lots": 1},
    {"action": "SELL", "opt": "CE", "strike": 81, "lots": 1},
    {"action": "BUY", "opt": "PE", "strike": 82, "lots": 1},
    {"action": "SELL", "opt": "PE", "strike": 83, "lots": 1},
    {"action": "BUY", "opt": "CE", "strike": 84, "lots": 1},
]


@pytest.mark.parametrize("legs", [[], FIVE_LEGS])
def test_leg_count_outside_one_to_four_is_400(auth_client, legs):
    response = auth_client.post("/api/options-paper/orders", json=_order(legs=legs))
    assert response.status_code == 400, response.text
    assert "legs" in response.json()["detail"].lower()


@pytest.mark.parametrize("index,wrong_expiry", [(0, "2026-10-23"), (1, "2026-12-23")])
def test_single_leg_expiry_disagreeing_with_order_is_400(auth_client, index, wrong_expiry):
    legs = _legs()
    legs[index]["expiry"] = wrong_expiry
    response = auth_client.post("/api/options-paper/orders", json=_order(legs=legs))
    assert response.status_code == 400, response.text
    assert "expiry" in response.json()["detail"].lower()


@pytest.mark.parametrize("strike", ["ATM+13", "ATM-0", "garbage", "1e309"])
def test_invalid_strike_reference_is_400(auth_client, strike):
    legs = [{"action": "BUY", "opt": "CE", "strike": strike, "lots": 1}, _legs()[1]]
    response = auth_client.post("/api/options-paper/orders", json=_order(legs=legs))
    assert response.status_code == 400, response.text
    assert "strike" in response.json()["detail"].lower()


def test_fractional_lots_are_rejected(auth_client):
    legs = [{"action": "BUY", "opt": "CE", "strike": 82.5, "lots": 1.5}, _legs()[1]]
    response = auth_client.post("/api/options-paper/orders", json=_order(legs=legs))
    assert 400 <= response.status_code < 500, response.text
    assert "lots" in str(response.json()["detail"]).lower()


@pytest.mark.parametrize("unpriced,legs", [
    (("82.5", "CE"), _legs()),
    (("85", "PE"), [
        {"action": "BUY", "opt": "PE", "strike": 85.0, "lots": 1}, _legs()[1],
    ]),
])
def test_unpriced_live_leg_is_400(auth_client, monkeypatch, unpriced, legs):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain(unpriced=unpriced))
    response = auth_client.post("/api/options-paper/orders", json=_order(legs=legs))
    assert response.status_code == 400, response.text
    assert "unpriced" in response.json()["detail"].lower()


def test_replay_order_without_entry_ts_is_400(auth_client):
    response = auth_client.post("/api/options-paper/orders", json=_order(source="replay"))
    assert response.status_code == 400, response.text
    assert "entryts" in response.json()["detail"].lower()


@pytest.mark.parametrize("entry_ts", ["not-a-date", "2026-13-45T99:99:99+05:30"])
def test_malformed_entry_ts_is_rejected(auth_client, entry_ts):
    body = _order(source="replay", entryTs=entry_ts)
    response = auth_client.post("/api/options-paper/orders", json=body)
    assert 400 <= response.status_code < 500, response.text
    assert "entry" in str(response.json()["detail"]).lower()


@pytest.mark.parametrize("status", ["OPEN", "closed_", ""])
def test_invalid_status_filter_is_rejected(auth_client, status):
    response = auth_client.get("/api/options-paper/positions", params={"status": status})
    assert 400 <= response.status_code < 500, response.text


# ---------------------------------------------------------------------------
# 3. Dry-run replay followed by the real order
# ---------------------------------------------------------------------------
def test_dry_run_replay_writes_nothing_then_real_order_writes_one_position(
    auth_client, chain, db,
):
    payload = _replay_order(dryRun=True)
    preview = _place(auth_client, payload)
    assert preview["dryRun"] is True
    assert preview["position"] is None
    assert len(preview["replay"]["frames"]) >= 2
    assert db.query(OptionPaperPosition).count() == 0
    assert db.query(OptionPaperLeg).count() == 0
    assert db.query(Trade).count() == 0

    real = dict(payload)
    real.pop("dryRun")
    placed = _place(auth_client, real)
    assert placed["dryRun"] is False
    assert placed["replay"] is None
    assert len(placed["position"]["legs"]) == 2
    assert db.query(OptionPaperPosition).count() == 1
    assert db.query(OptionPaperLeg).count() == 2
    assert db.query(Trade).count() == 0


# ---------------------------------------------------------------------------
# 4. Close path
# ---------------------------------------------------------------------------
def test_close_books_one_trade_per_leg_and_cannot_be_repeated(auth_client, chain, db):
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
    assert closed["unrealizedPnl"] == 0
    assert {leg["exitPremium"] for leg in closed["legs"]} == {4.0, 1.2}

    trades = db.query(Trade).all()
    assert len(trades) == 2
    assert {t.source for t in trades} == {"options_paper_replay"}
    assert {t.exit_reason for t in trades} == {"MANUAL"}
    assert {t.exit_price for t in trades} == {4.0, 1.2}

    again = auth_client.post(f"/api/options-paper/positions/{position['id']}/close", json={})
    assert again.status_code == 400, again.text
    assert "closed" in again.json()["detail"].lower()
    assert db.query(Trade).count() == 2


def test_live_close_books_trades_with_ui_source(auth_client, monkeypatch, db):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain())
    position = _place(auth_client, _order())["position"]
    response = auth_client.post(
        f"/api/options-paper/positions/{position['id']}/close",
        json={"premiums": {"82.5-CE": 3.0, "85-CE": 0.5}},
    )
    assert response.status_code == 200, response.text
    trades = db.query(Trade).all()
    assert len(trades) == 2
    assert {t.source for t in trades} == {"options_paper_ui"}
    assert {t.exit_reason for t in trades} == {"MANUAL"}


# ---------------------------------------------------------------------------
# 5. Expiry settlement
# ---------------------------------------------------------------------------
def test_expired_position_settles_once_and_future_position_stays_open(auth_client, db):
    past_entry = datetime(2025, 12, 1, 9, 15, tzinfo=IST)
    expired = _seed_position(db, expiry="2026-01-01", entry_ts=past_entry)
    future = _seed_position(db, expiry="2027-12-31")
    db.add(OptionChainSnapshot(
        ts=datetime(2026, 1, 1, 15, 30), underlying=UNDERLYING,
        expiry="2026-01-01", strike=82.5, side="CE", ltp=0.5,
        spot=83.0, session_date="2026-01-01",
    ))
    db.commit()

    open_rows = auth_client.get("/api/options-paper/positions").json()["positions"]
    assert [row["id"] for row in open_rows] == [future.id]

    settled = auth_client.get(
        "/api/options-paper/positions", params={"status": "expired"}
    ).json()["positions"]
    assert len(settled) == 1
    row = settled[0]
    assert row["id"] == expired.id
    assert row["status"] == "expired"
    assert row["closeReason"] == "EXPIRED"
    assert row["closedAt"]
    # Intrinsic at the final spot 83: 82.5 CE → 0.5, 85 CE → 0.
    assert {leg["exitPremium"] for leg in row["legs"]} == {0.5, 0.0}

    trades = db.query(Trade).filter(Trade.exit_reason == "EXPIRED").all()
    assert len(trades) == 2
    assert {t.exit_reason for t in trades} == {"EXPIRED"}
    assert {t.exit_price for t in trades} == {0.5, 0.0}

    auth_client.get("/api/options-paper/positions")
    auth_client.get(f"/api/options-paper/positions/{expired.id}")
    assert db.query(Trade).filter(Trade.exit_reason == "EXPIRED").count() == 2


# ---------------------------------------------------------------------------
# 6. Replay with no recorded history
# ---------------------------------------------------------------------------
def test_replay_without_history_returns_skipped_payload(auth_client, db):
    position = _seed_position(db, underlying="UNLISTEDXYZ")
    response = auth_client.get(f"/api/options-paper/replay/{position.id}")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["positionId"] == position.id
    assert payload["skipped"]
    assert isinstance(payload["frames"], list)
    assert isinstance(payload["summary"], dict)
    assert isinstance(payload["coverage"], dict)
    assert isinstance(payload["payoff"], dict)


# ---------------------------------------------------------------------------
# 7. Mark-to-market
# ---------------------------------------------------------------------------
def test_mark_uses_latest_snapshot_for_own_strike_and_side(auth_client, chain, db):
    position = _place(auth_client, _replay_order())["position"]
    db.add(OptionChainSnapshot(
        ts=datetime.fromisoformat(f"{SESSION}T09:55:00"),
        underlying=UNDERLYING, expiry=EXPIRY, strike=82.5, side="CE",
        ltp=5.0, iv=20.0, oi=1500, volume=90, spot=84.0,
        session_date=SESSION, quotes_live=False, iv_source="upstox",
    ))
    # A different side at the other strike is a decoy: it must not mark a CE leg.
    db.add(OptionChainSnapshot(
        ts=datetime.fromisoformat(f"{SESSION}T09:56:00"),
        underlying=UNDERLYING, expiry=EXPIRY, strike=85.0, side="PE",
        ltp=9.0, iv=20.0, oi=1500, volume=90, spot=84.0,
        session_date=SESSION, quotes_live=False, iv_source="upstox",
    ))
    db.commit()

    rows = auth_client.get("/api/options-paper/positions").json()["positions"]
    assert len(rows) == 1
    by_key = {(leg["strike"], leg["optType"]): leg for leg in rows[0]["legs"]}
    assert by_key[(82.5, "CE")]["markPremium"] == 5.0
    assert by_key[(85.0, "CE")]["markPremium"] == 0.9
    assert rows[0]["markSpot"] == 84.0
    assert rows[0]["id"] == position["id"]


def test_missing_snapshot_falls_back_to_stored_mark(auth_client, monkeypatch, db):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain())
    position = _place(auth_client, _order())["position"]
    # No OptionChainSnapshot rows: the stored mark is the only honest price.
    leg = (
        db.query(OptionPaperLeg)
        .filter(OptionPaperLeg.position_id == position["id"], OptionPaperLeg.strike == 82.5)
        .one()
    )
    leg.mark_premium = 3.75
    db.commit()

    row = auth_client.get(f"/api/options-paper/positions/{position['id']}").json()
    marked = next(leg for leg in row["legs"] if leg["strike"] == 82.5)
    assert marked["markPremium"] == 3.75
    assert marked["entryPremium"] == 2.5
    assert row["markSpot"] == 83.0
