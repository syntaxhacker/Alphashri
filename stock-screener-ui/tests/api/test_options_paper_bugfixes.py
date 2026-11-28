"""Bug-hunt regressions for the options paper backend.

Every test here must fail on the shipped code and pass after the fix. Narrow,
in-memory only: no network, no ``db/alphashri.db``, no report artifacts.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

import pytest

os.environ.setdefault("CI_MODE", "1")

from api_server_fastapi import app  # noqa: E402
from api.options_paper import service  # noqa: E402
from config import IST  # noqa: E402
from db.models.option_snapshot import OptionChainSnapshot  # noqa: E402
from db.models.options_paper import OptionPaperLeg, OptionPaperPosition  # noqa: E402
from db.models.trade import Trade  # noqa: E402
from options_paper import structures  # noqa: E402
from options_paper.multi_day_replay import build_replay  # noqa: E402
from options_paper.replay_data import (  # noqa: E402
    SnapshotChainProvider,
    available_sessions,
)

UNDERLYING = "IRFC"
EXPIRY = "2026-11-23"
DAY = "2026-11-18"
ENTRY_TS = f"{DAY}T09:47:00+05:30"
BASE = datetime(2026, 11, 20, 9, 15, tzinfo=IST)


@pytest.fixture(autouse=True)
def _lot_size(monkeypatch):
    monkeypatch.setattr(service, "get_lot", lambda symbol: 1000)


@pytest.fixture(autouse=True)
def _frozen_clock(monkeypatch):
    """Pin the service clock to the recorded session, before the test expiry."""
    monkeypatch.setattr(
        service, "_now", lambda: datetime.fromisoformat("2026-11-22T10:00:00+05:30")
    )


@pytest.fixture
def chain(db):
    for offset in range(7):
        ts = datetime.fromisoformat(f"{DAY}T09:{47 + offset}:00")
        for strike, ce, pe in ((82.5, 2.5, 0.7), (85.0, 0.9, 1.4),
                               (87.5, 0.5, 2.2)):
            for side, ltp in (("CE", ce), ("PE", pe)):
                db.add(OptionChainSnapshot(
                    ts=ts, underlying=UNDERLYING, expiry=EXPIRY, strike=strike,
                    side=side, ltp=ltp, iv=18.0, oi=1200, volume=80,
                    spot=83.0, session_date=DAY, quotes_live=False,
                    iv_source="upstox",
                ))
    db.commit()


def _replay_order(**overrides):
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


def _live_order(**overrides):
    body = {
        "underlying": UNDERLYING, "expiry": EXPIRY, "source": "live",
        "legs": _replay_order()["legs"],
    }
    body.update(overrides)
    return body


def _live_chain():
    async def fake(underlying, expiry):
        rows = []
        for strike, ce, pe in ((82.5, 2.5, 0.7), (85.0, 0.9, 1.4)):
            rows.append({
                "strike": strike,
                "ce": {"market_data": {"ltp": ce}, "instrument_key": f"NSE_FO|CE{strike:g}"},
                "pe": {"market_data": {"ltp": pe}, "instrument_key": f"NSE_FO|PE{strike:g}"},
            })
        return rows, 83.0
    return fake


def _place(client, body):
    response = client.post("/api/options-paper/orders", json=body)
    assert response.status_code == 200, response.text
    return response.json()["position"]


def _seed_position(db, *, status="open", expiry=EXPIRY, entry_ts=None, legs=None):
    position = OptionPaperPosition(
        user_id=1, source="live", status=status, underlying=UNDERLYING,
        expiry=expiry, name="bugfix", entry_ts=entry_ts or datetime.fromisoformat(ENTRY_TS),
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
        )
        leg.entry_ts = position.entry_ts
        db.add(leg)
    db.commit()
    db.refresh(position)
    _ = position.legs
    return position


# ---------------------------------------------------------------------------
# Domain helpers used by the pure replay regressions
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TimedLeg(structures.ResolvedLeg):
    entry_time: Optional[datetime] = None


class _BarsProvider:
    source = "bugfix-fake"

    def __init__(self, bars):
        self.bars = bars

    def chain_at(self, underlying, expiry, ts):
        return None

    def premium_series(self, underlying, expiry, strike, opt, from_ts, to_ts):
        key = (float(strike), str(opt).upper())
        return [(t, px, priced) for t, _spot, series in self.bars
                if from_ts <= t <= to_ts
                for k, (px, priced) in series.items() if k == key]


def _collision_bars():
    out = []
    for i in range(4):
        t = BASE + timedelta(minutes=i)
        out.append((t, 100.0, {(100.0, "CE"): (9.0 + i, True)}))
    return out


# ---------------------------------------------------------------------------
# 1. Replay keys / fill map
# ---------------------------------------------------------------------------
def test_colliding_strike_opt_legs_get_distinct_marks_and_active_keys():
    legs = [
        TimedLeg("BUY", "CE", 100.0, 1, 1, entry_time=BASE),
        TimedLeg("SELL", "CE", 100.0, 1, 1, entry_time=BASE + timedelta(minutes=2)),
    ]
    result = build_replay(
        legs=legs, entry_ts=BASE, end_ts=BASE + timedelta(minutes=3),
        provider=_BarsProvider(_collision_bars()), lot_size=1, costs=False,
    )
    assert result.skipped is None
    last = result.frames[-1]
    assert len(last["marks"]) == 2
    assert set(last["marks"]) == set(last["active"])
    assert all(key.startswith("100-CE-") for key in last["marks"])
    assert [v for v in last["active"].values()].count(True) == 2
    assert last["grossPnl"] == pytest.approx(2.0)  # long 9->12, short flat


def test_replay_fill_map_does_not_merge_ce_and_pe_at_same_strike(auth_client, chain, db):
    order = _replay_order(legs=[
        {"action": "BUY", "opt": "CE", "strike": 82.5, "lots": 1},
        {"action": "BUY", "opt": "PE", "strike": 82.5, "lots": 1},
    ])
    position = _place(auth_client, order)
    assert sorted(leg["entryPremium"] for leg in position["legs"]) == pytest.approx([0.7, 2.5])


# ---------------------------------------------------------------------------
# 2. Staggered leg validation
# ---------------------------------------------------------------------------
def test_leg_entered_before_position_entry_is_refused(auth_client, chain, db):
    position = _place(auth_client, _replay_order(entryTs=f"{DAY}T09:51:00+05:30"))
    response = auth_client.post(
        f"/api/options-paper/positions/{position['id']}/legs",
        json={"action": "BUY", "opt": "CE", "strike": 87.5, "lots": 1,
              "entryTs": f"{DAY}T09:50:00+05:30"},
    )
    assert response.status_code == 400, response.text
    assert "entryts" in response.json()["detail"].lower()
    assert db.query(OptionPaperLeg).filter(
        OptionPaperLeg.position_id == position["id"]
    ).count() == 2


# ---------------------------------------------------------------------------
# 3. Close concurrency / cost stamping
# ---------------------------------------------------------------------------
def test_stale_concurrent_close_cannot_book_trades_twice(db):
    position = _seed_position(db)
    stale = db.query(OptionPaperPosition).one()
    _ = stale.legs
    db.expunge(position)

    premiums = {"82.5-CE": 4.0, "85-CE": 1.2}
    first = service.close_position(db, position, premiums)
    assert first["status"] == "closed"
    assert db.query(Trade).count() == 2

    with pytest.raises(service.OrderError, match="closed"):
        service.close_position(db, stale, premiums)
    assert db.query(Trade).count() == 2


def test_booked_trade_stamps_the_cost_version_actually_used(db, monkeypatch):
    position = _seed_position(db)
    real = service.option_round_trip_cost

    def _patched(*args, **kwargs):
        out = dict(real(*args, **kwargs))
        out["costs_version"] = "test-schedule-v9"
        return out

    monkeypatch.setattr(service, "option_round_trip_cost", _patched)
    service.close_position(db, position, {"82.5-CE": 4.0, "85-CE": 1.2})
    notes = {t.notes for t in db.query(Trade).all()}
    assert notes
    assert all("test-schedule-v9" in note for note in notes)


def test_collision_safe_close_overrides_exit_each_leg_separately(auth_client, chain, db):
    position = _place(auth_client, _replay_order())
    added = auth_client.post(
        f"/api/options-paper/positions/{position['id']}/legs",
        json={"action": "SELL", "opt": "CE", "strike": 82.5, "lots": 1,
              "entryTs": f"{DAY}T09:50:00+05:30"},
    )
    assert added.status_code == 200, added.text
    response = auth_client.post(
        f"/api/options-paper/positions/{position['id']}/close",
        json={"premiums": {
            "82.5-CE-BUY-0": 4.0, "85-CE": 1.2, "82.5-CE-SELL-2": 3.0,
        }},
    )
    assert response.status_code == 200, response.text
    exits = sorted(leg["exitPremium"] for leg in response.json()["legs"])
    assert exits == pytest.approx([1.2, 3.0, 4.0])


# ---------------------------------------------------------------------------
# 4. Numeric edges
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_non_finite_close_premium_is_400(auth_client, chain, db, bad):
    position = _place(auth_client, _replay_order())
    response = auth_client.post(
        f"/api/options-paper/positions/{position['id']}/close",
        content=json.dumps({"premiums": {"82.5-CE": bad, "85-CE": 1.2}}),
        headers={"Content-Type": "application/json"},
    )
    assert 400 <= response.status_code < 500, response.text
    assert "premium" in str(response.json()["detail"]).lower()
    assert db.query(Trade).count() == 0


def test_infinite_snapshot_mark_falls_back_to_stored_mark(auth_client, chain, db):
    position = _place(auth_client, _replay_order())
    db.add(OptionChainSnapshot(
        ts=datetime.fromisoformat(f"{DAY}T09:59:00"),
        underlying=UNDERLYING, expiry=EXPIRY, strike=82.5, side="CE",
        ltp=float("inf"), iv=18.0, oi=10, volume=1, spot=83.0,
        session_date=DAY, quotes_live=False, iv_source="upstox",
    ))
    db.commit()
    row = auth_client.get(f"/api/options-paper/positions/{position['id']}").json()
    leg = next(leg for leg in row["legs"] if leg["strike"] == 82.5)
    assert leg["markPremium"] == 2.5


def test_infinite_live_ltp_is_400(auth_client, monkeypatch, db):
    async def _live(underlying, expiry):
        rows = [
            {"strike": 82.5,
             "ce": {"market_data": {"ltp": float("inf")}},
             "pe": {"market_data": {"ltp": 0.7}}},
            {"strike": 85.0,
             "ce": {"market_data": {"ltp": 0.9}},
             "pe": {"market_data": {"ltp": 1.4}}},
        ]
        return rows, 83.0

    monkeypatch.setattr("api.options._fetch_chain_rows", _live)
    response = auth_client.post("/api/options-paper/orders", json=_live_order())
    assert 400 <= response.status_code < 500, response.text
    assert db.query(OptionPaperPosition).count() == 0


def test_absurd_lot_count_is_400(auth_client, monkeypatch, db):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain())
    legs = [{"action": "BUY", "opt": "CE", "strike": 82.5, "lots": 10 ** 6},
            _live_order()["legs"][1]]
    response = auth_client.post("/api/options-paper/orders", json=_live_order(legs=legs))
    assert 400 <= response.status_code < 500, response.text
    assert "lots" in str(response.json()["detail"]).lower()
    assert db.query(OptionPaperPosition).count() == 0


def test_absurd_live_expiry_is_400(auth_client, monkeypatch):
    monkeypatch.setattr("api.options._fetch_chain_rows", _live_chain())
    response = auth_client.post(
        "/api/options-paper/orders", json=_live_order(expiry="1999-01-01"))
    assert response.status_code == 400, response.text
    assert "expiry" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 5. Provider safety / clear errors
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("bad", ["../IRFC", "/".join(["..", "..", "etc", "passwd"]), "NSE/IRFC", ""])
def test_safe_underlying_guards_provider_entry_points(db, bad):
    provider = SnapshotChainProvider(session_factory=lambda: db)
    with pytest.raises(ValueError):
        provider.chain_at(bad, EXPIRY, datetime.fromisoformat(ENTRY_TS))
    with pytest.raises(ValueError):
        provider.premium_series(bad, EXPIRY, 82.5, "CE",
                                datetime.fromisoformat(ENTRY_TS),
                                datetime.fromisoformat(ENTRY_TS))
    with pytest.raises(ValueError):
        available_sessions(bad, session_factory=lambda: db)


def test_safe_underlying_guards_service_chain_at(db):
    with pytest.raises(service.OrderError, match="underlying"):
        service.chain_at(db, "../IRFC", EXPIRY, DAY, "09:48")


def test_chain_at_without_history_is_a_clear_error(auth_client, db):
    response = auth_client.get(
        "/api/options-paper/chain-at",
        params={"underlying": "NOHISTORY", "date": DAY, "time": "09:48"},
    )
    assert response.status_code == 400, response.text
    assert "chain" in response.json()["detail"].lower()


@pytest.mark.parametrize("bad_time", ["09:47:00+05:30", "9:47", "25:00", "09:47Z"])
def test_chain_at_rejects_non_minute_time(auth_client, chain, bad_time):
    response = auth_client.get(
        "/api/options-paper/chain-at",
        params={"underlying": UNDERLYING, "date": DAY, "time": bad_time},
    )
    assert 400 <= response.status_code < 500, response.text
    assert "time" in str(response.json()["detail"]).lower()
