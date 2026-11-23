"""Tests for the multi-day option replay domain and chain providers.

The honesty contract from ``structure_engine`` is restated here as executable
checks: next-bar fill, no lookahead, held-strike marking, carried last prices
with an explicit unpriced flag, no weekend interpolation, costs from
``options_paper.costs`` and IST throughout.

Run: ``source .venv/bin/activate && python -m pytest
tests/test_options_paper_replay_engine.py -q``
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

import config
from options_paper import structures
from options_paper.costs import option_entry_cost
from options_paper.multi_day_replay import ReplayResult, build_replay
from options_paper.replay_data import (
    MAX_ROWS,
    ChainQuote,
    CompositeChainProvider,
    FileChainProvider,
    SnapshotChainProvider,
    UpstoxChainProvider,
    available_sessions,
)

IST = config.IST
T0 = datetime(2026, 11, 20, 9, 15, tzinfo=IST)
EXPIRY = "2026-11-23"


@dataclass(frozen=True)
class DatedLeg(structures.ResolvedLeg):
    """A resolved leg that also carries the contract's underlying/expiry."""

    underlying: str = "IRFC"
    expiry: str = EXPIRY


def leg(action="BUY", opt="CE", strike=100.0, qty=1, lots=1, **kw):
    return DatedLeg(action=action, opt=opt, strike=strike, lots=lots,
                    qty=qty, **kw)


class FakeProvider:
    """Bars: list of ``(t, spot, {(strike, opt): (ltp, priced)})``."""

    def __init__(self, bars, expiry=EXPIRY, underlying="IRFC", source="fake"):
        self.expiry = expiry
        self.underlying = underlying
        self.source = source
        self.bars = []
        for t, spot, px in bars:
            tt = t if t.tzinfo else t.replace(tzinfo=IST)
            self.bars.append({"t": tt.astimezone(IST), "spot": float(spot),
                              "px": {(float(key[0]), key[1]):
                                     (float(value[0]), bool(value[1]))
                                     for key, value in px.items()}})

    def chain_at(self, underlying, expiry, ts):
        ts = ts if ts.tzinfo else ts.replace(tzinfo=IST)
        ts = ts.astimezone(IST)
        prior = [b for b in self.bars if b["t"] <= ts]
        if not prior:
            return None
        b = max(prior, key=lambda x: x["t"])
        premiums = {k: v[0] for k, v in b["px"].items() if v[1]}
        gaps = sum(1 for v in b["px"].values() if not v[1])
        return ChainQuote(t=b["t"], spot=b["spot"], expiry=self.expiry,
                          ladder=tuple(sorted({k[0] for k in b["px"]})),
                          premiums=premiums, source=self.source, gaps=gaps)

    def premium_series(self, underlying, expiry, strike, opt, from_ts, to_ts):
        lo = from_ts if from_ts.tzinfo else from_ts.replace(tzinfo=IST)
        hi = to_ts if to_ts.tzinfo else to_ts.replace(tzinfo=IST)
        lo, hi = lo.astimezone(IST), hi.astimezone(IST)
        out = []
        for b in self.bars:
            if not (lo <= b["t"] <= hi):
                continue
            ltp, priced = b["px"].get((float(strike), opt), (0.0, False))
            out.append((b["t"], ltp, priced))
        return out


def spread_bars(n=5, unpriced_at=None):
    bars = []
    for i in range(n):
        buy = 8.0 + 0.5 * i
        sell = 3.0 + 0.2 * i
        bars.append((
            T0 + timedelta(minutes=i), 100.0 + i,
            {(100.0, "CE"): (buy, i != unpriced_at),
             (110.0, "CE"): (sell, True)},
        ))
    return bars


class FakeQuery:
    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, *a, **k):
        return self

    def order_by(self, *a):
        return self

    def limit(self, n):
        return FakeQuery(self.rows[:n])

    def all(self):
        return list(self.rows)


class FakeSession:
    def __init__(self, rows):
        self.rows = list(rows)

    def query(self, model):
        return FakeQuery(self.rows)

    def close(self):
        pass


def snap_row(minute, strike, side, ltp, spot=100.0):
    return SimpleNamespace(
        ts=T0 + timedelta(minutes=minute), underlying="IRFC", expiry=EXPIRY,
        strike=strike, side=side, ltp=ltp, spot=spot,
    )


class EmptyProvider:
    def chain_at(self, *a, **k):
        return None

    def premium_series(self, *a, **k):
        return []


# ---------------------------------------------------------------------------
# Honesty contract
# ---------------------------------------------------------------------------
def test_next_bar_fill_ignores_signal_bar_prices():
    bars = [
        (T0, 100.0, {(100.0, "CE"): (500.0, True)}),          # signal: absurd
        (T0 + timedelta(minutes=1), 100.0, {(100.0, "CE"): (8.0, True)}),
        (T0 + timedelta(minutes=2), 100.0, {(100.0, "CE"): (8.5, True)}),
    ]
    r = build_replay([leg()], T0, T0 + timedelta(minutes=2),
                     FakeProvider(bars), lot_size=1, costs=False)

    assert r.skipped is None
    assert r.legs[0]["entryPremium"] == 8.0
    assert r.fill_time == T0 + timedelta(minutes=1)
    assert datetime.fromisoformat(r.frames[0]["t"]) == T0
    assert r.frames[0]["grossPnl"] == 0.0


def test_marks_stay_on_held_strike_not_drifting_atm():
    bars = []
    for i in range(4):
        spot = 100.0 + 10 * i
        bars.append((T0 + timedelta(minutes=i), spot, {
            (100.0, "CE"): (8.0 + i, True),
            (110.0, "CE"): (3.0 + i / 2, True),
            (round(spot / 10) * 10, "CE"): (1.0, True),
        }))
    legs = [leg(strike=100.0), leg(action="SELL", strike=110.0)]
    r = build_replay(legs, T0, T0 + timedelta(minutes=3),
                     FakeProvider(bars), lot_size=1, costs=False)

    marks = r.frames[-1]["marks"]
    assert set(marks) == {"100-CE", "110-CE"}
    assert marks["100-CE"] == 11.0
    assert marks["110-CE"] == 4.5


def test_missing_print_carries_last_price_and_flags_frame():
    r = build_replay([leg(strike=100.0), leg(action="SELL", strike=110.0)],
                     T0, T0 + timedelta(minutes=4),
                     FakeProvider(spread_bars(unpriced_at=2)), lot_size=1,
                     costs=False)

    gap = r.frames[2]
    assert gap["priced"] is False
    assert gap["marks"]["100-CE"] == 8.5       # last print was at minute 1
    assert gap["marks"]["110-CE"] == 3.4
    assert r.coverage["gaps"] >= 1
    assert datetime.fromisoformat(gap["t"]) in [datetime.fromisoformat(x)
                                                for x in r.coverage["gapList"]]


def test_no_synthetic_bars_across_weekend():
    fri = datetime(2026, 11, 20, 9, 15, tzinfo=IST)
    mon = datetime(2026, 11, 23, 9, 15, tzinfo=IST)
    bars = [
        (fri, 100.0, {(100.0, "CE"): (8.0, True)}),
        (fri + timedelta(minutes=1), 101.0, {(100.0, "CE"): (8.5, True)}),
        (mon, 102.0, {(100.0, "CE"): (9.0, True)}),
    ]
    r = build_replay([leg()], fri, mon, FakeProvider(bars), lot_size=1,
                     costs=False)

    dates = {datetime.fromisoformat(f["t"]).date() for f in r.frames}
    assert dates == {fri.date(), mon.date()}
    assert all(datetime.fromisoformat(f["t"]).weekday() < 5 for f in r.frames)


def test_costs_come_from_costs_module_and_net_pnl_subtracts_them():
    provider = FakeProvider(spread_bars())
    legs = [leg(strike=100.0), leg(action="SELL", strike=110.0)]
    kwargs = dict(entry_ts=T0, end_ts=T0 + timedelta(minutes=4),
                  provider=provider, lot_size=1)
    with_costs = build_replay(legs, costs=True, **kwargs)
    without = build_replay(legs, costs=False, **kwargs)

    last = with_costs.frames[-1]
    expected = sum(option_entry_cost(
        l["entryPremium"], l["qty"],
        is_short=(l["action"] == "SELL"))["costs"]
        for l in with_costs.legs)
    assert with_costs.costs_total == pytest.approx(expected, abs=0.01)
    assert last["netPnl"] == pytest.approx(last["grossPnl"] - expected, abs=0.01)
    assert without.costs_total == 0.0
    assert without.frames[-1]["netPnl"] == pytest.approx(
        without.frames[-1]["grossPnl"], abs=1e-9)


def test_entry_costs_do_not_depend_on_a_future_mark():
    bars = spread_bars()
    legs = [leg(strike=100.0), leg(action="SELL", strike=110.0)]
    kwargs = dict(legs=legs, entry_ts=T0, end_ts=T0 + timedelta(minutes=4),
                  lot_size=1, costs=True)
    early = build_replay(provider=FakeProvider(bars), **kwargs)
    changed_tail = list(bars)
    ts, spot, premiums = changed_tail[-1]
    changed_tail[-1] = (ts, spot, {key: (px * 4, priced)
                                   for key, (px, priced) in premiums.items()})
    late = build_replay(provider=FakeProvider(changed_tail), **kwargs)

    assert early.costs_total == pytest.approx(late.costs_total, abs=1e-9)
    assert early.frames[0]["netPnl"] == pytest.approx(
        late.frames[0]["netPnl"], abs=1e-9)


# ---------------------------------------------------------------------------
# Payoff (delegated to structures.py) and payload
# ---------------------------------------------------------------------------
def test_bull_call_spread_payoff_breakevens_and_max_pnl():
    bars = [(T0 + timedelta(minutes=i), 105.0, {
        (100.0, "CE"): (8.0, True), (110.0, "CE"): (3.0, True),
    }) for i in range(4)]
    r = build_replay([leg(strike=100.0), leg(action="SELL", strike=110.0)],
                     T0, T0 + timedelta(minutes=3), FakeProvider(bars),
                     lot_size=1, costs=False)

    assert r.skipped is None
    assert r.net_debit == pytest.approx(5.0, abs=1e-9)
    assert r.max_profit == pytest.approx(5.0, abs=1e-6)
    assert r.max_loss == pytest.approx(-5.0, abs=1e-6)
    assert r.breakevens == pytest.approx([105.0], abs=0.05)
    assert len(r.payoff["spots"]) == len(r.payoff["expiry"])

    payload = r.as_dict()
    assert payload["netDebit"] == pytest.approx(5.0, abs=1e-9)
    assert payload["breakevens"] == pytest.approx([105.0], abs=0.05)
    assert payload["coverage"]["frames"] == len(payload["frames"])
    assert payload["summary"]["maxDrawdown"] >= 0.0
    json.dumps(payload)  # JSON-safe camelCase payload


def test_ist_handling_with_naive_request():
    naive = T0.replace(tzinfo=None)
    bars = [(T0 + timedelta(minutes=i), 100.0, {(100.0, "CE"): (8.0, True)})
            for i in range(3)]
    r = build_replay([leg()], naive, (T0 + timedelta(minutes=2)).replace(tzinfo=None),
                     FakeProvider(bars), lot_size=1, costs=False)

    assert r.fill_time.utcoffset() == timedelta(hours=5, minutes=30)
    assert all(datetime.fromisoformat(f["t"]).utcoffset() == timedelta(hours=5, minutes=30)
               for f in r.frames)


def test_deterministic_output():
    kwargs = dict(entry_ts=T0, end_ts=T0 + timedelta(minutes=4),
                  provider=FakeProvider(spread_bars()), lot_size=1)
    legs = [leg(strike=100.0), leg(action="SELL", strike=110.0)]
    a = build_replay(legs, **kwargs).as_dict()
    b = build_replay(legs, **kwargs).as_dict()
    assert a == b


# ---------------------------------------------------------------------------
# Skipped reasons (never raise)
# ---------------------------------------------------------------------------
def test_skipped_no_fill_bar():
    bars = [(T0, 100.0, {(100.0, "CE"): (8.0, True)})]
    r = build_replay([leg()], T0, T0, FakeProvider(bars), lot_size=1)
    assert isinstance(r, ReplayResult)
    assert r.skipped == "no fill bar"


def test_skipped_leg_unpriced_at_entry():
    bars = [
        (T0, 100.0, {(100.0, "CE"): (8.0, True)}),
        (T0 + timedelta(minutes=1), 100.0, {(100.0, "CE"): (0.0, False)}),
        (T0 + timedelta(minutes=2), 100.0, {(100.0, "CE"): (8.5, True)}),
    ]
    r = build_replay([leg()], T0, T0 + timedelta(minutes=2),
                     FakeProvider(bars), lot_size=1)
    assert r.skipped == "leg unpriced at entry"


def test_skipped_mixed_expiries():
    bars = [(T0 + timedelta(minutes=i), 100.0, {(100.0, "CE"): (8.0, True)})
            for i in range(3)]
    legs = [leg(strike=100.0), leg(action="SELL", strike=110.0,
                                   expiry="2026-11-30")]
    r = build_replay(legs, T0, T0 + timedelta(minutes=2),
                     FakeProvider(bars), lot_size=1)
    assert r.skipped == "mixed expiries"


def test_skipped_no_marks_after_entry():
    bars = [
        (T0, 100.0, {(100.0, "CE"): (8.0, True)}),
        (T0 + timedelta(minutes=1), 100.0, {(100.0, "CE"): (8.5, True)}),
        (T0 + timedelta(minutes=2), 100.0, {(100.0, "CE"): (0.0, False)}),
    ]
    r = build_replay([leg()], T0, T0 + timedelta(minutes=2),
                     FakeProvider(bars), lot_size=1)
    assert r.skipped == "no marks after entry"


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
def test_snapshot_provider_chain_and_series_with_fake_session():
    rows = [
        snap_row(0, 100.0, "CE", 8.0, spot=100.0),
        snap_row(0, 110.0, "PE", 2.0, spot=100.0),
        snap_row(1, 100.0, "CE", None, spot=101.0),
        snap_row(1, 110.0, "PE", 2.5, spot=101.0),
    ]
    p = SnapshotChainProvider(session_factory=lambda: FakeSession(rows))

    q = p.chain_at("IRFC", EXPIRY, T0 + timedelta(minutes=1))
    assert q is not None and q.source == "snapshot"
    assert q.spot == 101.0 and q.ladder == (100.0, 110.0)
    assert q.premiums[(110.0, "PE")] == 2.5
    assert q.t.utcoffset() == timedelta(hours=5, minutes=30)

    series = p.premium_series("IRFC", EXPIRY, 100.0, "CE", T0,
                              T0 + timedelta(minutes=1))
    assert len(series) == 2
    assert series[0][1] == 8.0 and series[0][2] is True
    assert series[1][1] == 8.0 and series[1][2] is False


def test_snapshot_readers_use_newest_window_not_oldest_rows(db, tmp_path):
    """A global oldest-first cap hides the requested window in a large table."""
    from db.models.option_snapshot import OptionChainSnapshot

    class _Borrowed:
        def __init__(self, real):
            self._real = real

        def query(self, *args, **kwargs):
            return self._real.query(*args, **kwargs)

        def close(self):
            pass

    old_base = datetime(2026, 11, 1, 9, 15)      # naive IST wall clock in SQLite
    target = datetime(2026, 11, 20, 9, 47)
    rows = []
    for i in range(MAX_ROWS + 8):
        ts = old_base - timedelta(minutes=i)
        rows.append(OptionChainSnapshot(
            ts=ts, underlying="IRFC", expiry=EXPIRY, strike=99.0, side="CE",
            ltp=1.0, spot=99.0, session_date=ts.date().isoformat(),
        ))
    for i in range(8):
        ts = target + timedelta(minutes=i)
        for strike, ltp in ((100.0, 8.0), (110.0, 3.0)):
            rows.append(OptionChainSnapshot(
                ts=ts, underlying="IRFC", expiry=EXPIRY, strike=strike, side="CE",
                ltp=ltp, spot=100.0 + i, session_date=ts.date().isoformat(),
            ))
    db.add_all(rows)
    db.commit()

    provider = SnapshotChainProvider(session_factory=lambda: _Borrowed(db))
    at = (target + timedelta(seconds=30)).replace(tzinfo=IST)
    quote = provider.chain_at("IRFC", EXPIRY, at)
    assert quote is not None
    assert timedelta(0) <= quote.t - target.replace(tzinfo=IST) <= timedelta(minutes=1)
    assert quote.spot == 100.0
    assert quote.premiums[(100.0, "CE")] == 8.0

    series = provider.premium_series(
        "IRFC", EXPIRY, 100.0, "CE", target.replace(tzinfo=IST),
        (target + timedelta(minutes=7)).replace(tzinfo=IST),
    )
    assert len(series) == 8
    assert [point[1] for point in series] == [8.0] * 8
    assert all(point[2] for point in series)

    from api.options_paper import service

    assert "2026-11-20" in available_sessions(
        "IRFC", root=tmp_path, session_factory=lambda: _Borrowed(db))
    assert service.resolve_expiry(db, "IRFC", "2026-11-20") == EXPIRY
    assert any(s["date"] == "2026-11-20" for s in service.replay_sessions(db))


def test_file_provider_reads_recorded_jsonl(tmp_path):
    d = tmp_path / "options_chain10s" / "IRFC"
    d.mkdir(parents=True)
    rows = [
        {"t": (T0 + timedelta(minutes=i)).isoformat(), "spot": 100.0 + i,
         "expiry": EXPIRY,
         "rows": [[100.0, 8.0 + i, 10, 1, 2.0, 5, 0],
                  [110.0, 3.0, 8, 1, 4.0, 6, 0]]}
        for i in range(3)
    ]
    (d / "2026-11-20.jsonl").write_text(
        "\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")

    p = FileChainProvider(root=tmp_path)
    q = p.chain_at("IRFC", EXPIRY, T0 + timedelta(minutes=1))
    assert q is not None and q.source == "file"
    assert q.spot == 101.0 and q.ladder == (100.0, 110.0)
    assert q.premiums[(100.0, "CE")] == 9.0
    assert q.t.utcoffset() == timedelta(hours=5, minutes=30)

    series = p.premium_series("IRFC", EXPIRY, 110.0, "PE", T0,
                              T0 + timedelta(minutes=2))
    assert [x[1] for x in series] == [4.0, 4.0, 4.0]
    assert all(x[2] for x in series)


def test_available_sessions_from_db_and_files(tmp_path):
    d = tmp_path / "options_chain10s" / "IRFC"
    d.mkdir(parents=True)
    (d / "2026-11-19.jsonl").write_text("{}\n", encoding="utf-8")
    rows = [snap_row(0, 100.0, "CE", 8.0)]
    sessions = available_sessions(
        "IRFC", root=tmp_path, session_factory=lambda: FakeSession(rows))
    assert sessions == ["2026-11-19", "2026-11-20"]


def test_composite_reports_serving_source():
    p = CompositeChainProvider([
        EmptyProvider(),
        FakeProvider([(T0 + timedelta(minutes=i), 100.0,
                       {(100.0, "CE"): (8.0, True)}) for i in range(3)]),
    ])
    assert p.chain_at("IRFC", EXPIRY, T0).source == "fake"
    assert p.premium_series("IRFC", EXPIRY, 100.0, "CE", T0,
                            T0 + timedelta(minutes=2))
    assert p.last_sources["chain_at"] == "fake"
    assert p.last_sources["premium_series"] == "fake"


def test_upstox_provider_has_explicit_seam_and_bounded_window():
    p = UpstoxChainProvider()
    with pytest.raises(NotImplementedError):
        p.chain_at("IRFC", EXPIRY, T0)
    with pytest.raises(NotImplementedError):
        p.premium_series("IRFC", EXPIRY, 100.0, "CE", T0, T0)

    calls = []

    def resolve_key(underlying, expiry, strike, opt):
        return f"NSE_FO|{underlying}-{strike:g}-{opt}"

    def fetch_candles(key, lo, hi):
        calls.append((key, lo, hi))
        return [(lo + timedelta(minutes=i), 8.0 + i) for i in range(2)]

    p2 = UpstoxChainProvider(resolve_key=resolve_key,
                             fetch_candles=fetch_candles, enabled=True)
    far_past = T0 - timedelta(days=90)
    series = p2.premium_series("IRFC", EXPIRY, 100.0, "CE", far_past, T0)
    assert series
    assert calls[0][1] >= T0 - p2.MAX_WINDOW
    assert all(s[2] is True for s in series)


def test_file_provider_rejects_path_traversal(tmp_path):
    from options_paper.replay_data import FileChainProvider

    provider = FileChainProvider(root=tmp_path)
    for hostile in ("../secret", "..", "A/B", "A" * 40):
        with pytest.raises(ValueError):
            provider._path(hostile, datetime(2026, 11, 17).date())
