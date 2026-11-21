"""Tests for scripts/market/options_calibration.py.

In-memory SQLite seeded with synthetic snapshots. No network, no server, no
writes to the real DB. Covers the IV rank math, cone coverage/PIT bins, empty
and missing-table handling, duplicate minutes and missing IVs.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import scripts.market.options_calibration as oc

CREATE_SQL = """
CREATE TABLE option_chain_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts DATETIME NOT NULL,
    underlying VARCHAR(20) NOT NULL,
    expiry VARCHAR(10) NOT NULL,
    strike FLOAT NOT NULL,
    side VARCHAR(2) NOT NULL,
    ltp FLOAT,
    iv FLOAT,
    delta FLOAT,
    gamma FLOAT,
    theta FLOAT,
    vega FLOAT,
    oi FLOAT,
    volume FLOAT,
    spot FLOAT,
    session_date VARCHAR(10) NOT NULL,
    quotes_live BOOLEAN NOT NULL DEFAULT 0,
    iv_source VARCHAR(20) NOT NULL DEFAULT 'upstox',
    UNIQUE (underlying, expiry, strike, side, ts)
)
"""
INSERT_SQL = (
    "INSERT INTO option_chain_snapshots "
    "(ts, underlying, expiry, strike, side, iv, spot, session_date) "
    "VALUES (:ts, :underlying, :expiry, :strike, :side, :iv, :spot, :session_date)"
)


@pytest.fixture
def engine():
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with eng.begin() as conn:
        conn.execute(text(CREATE_SQL))
    yield eng
    eng.dispose()


@pytest.fixture
def conn(engine):
    connection = engine.connect()
    yield connection
    connection.close()


@pytest.fixture
def session(engine):
    sess = sessionmaker(bind=engine)()
    yield sess
    sess.close()


def leg(session_date, expiry, strike, side, iv, spot, *, time="15:00:00", underlying="NIFTY"):
    return {
        "ts": f"{session_date} {time}",
        "underlying": underlying,
        "expiry": expiry,
        "strike": float(strike),
        "side": side,
        "iv": iv,
        "spot": float(spot),
        "session_date": session_date,
    }


def chain(session_date, spot, iv, *, underlying="NIFTY", expiry=None, time="15:00:00"):
    """Three strikes x CE/PE, all at the given IV (so ATM interpolation is exact)."""
    if expiry is None:
        expiry = (date.fromisoformat(session_date) + timedelta(days=7)).isoformat()
    rows = []
    for strike in (spot - 100, spot, spot + 100):
        for side in ("CE", "PE"):
            rows.append(leg(session_date, expiry, strike, side, iv, spot,
                            time=time, underlying=underlying))
    return rows


def seed(engine, rows):
    with engine.begin() as c:
        if rows:
            c.execute(text(INSERT_SQL), rows)


def business_days(n, start=date(2026, 1, 5)):
    days = []
    cursor = start
    while len(days) < n:
        if cursor.weekday() < 5:
            days.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return days


# ---------------------------------------------------------------------------
# Loader: raw SQL and model-first paths, empty / missing table
# ---------------------------------------------------------------------------

def test_load_snapshots_raw_sql_filters_by_underlying_and_since(engine, conn):
    rows = chain("2026-01-05", 20000, 12) + chain("2026-01-06", 20100, 13)
    rows += chain("2026-01-05", 20000, 12, underlying="RELIANCE")
    seed(engine, rows)

    fetched, error = oc.load_snapshots(conn, "NIFTY", since="2026-01-06")
    assert error is None
    assert fetched and all(r["underlying"] == "NIFTY" for r in fetched)
    assert {r["session_date"] for r in fetched} == {"2026-01-06"}


def test_load_snapshots_orm_path_when_model_available(engine, session):
    try:
        from db.models.option_snapshot import OptionChainSnapshot  # noqa: F401
    except Exception:
        pytest.skip("option snapshot model not importable")
    # Table created manually matches the model columns, so the ORM query works.
    seed(engine, chain("2026-01-05", 20000, 12))
    fetched, error = oc.load_snapshots(session, "NIFTY")
    assert error is None and len(fetched) == 6


def test_load_snapshots_missing_table_is_graceful():
    eng = create_engine("sqlite:///:memory:")
    conn = eng.connect()
    try:
        fetched, error = oc.load_snapshots(conn, "NIFTY")
        assert fetched == []
        assert error == "table_missing"
    finally:
        conn.close()
        eng.dispose()


def test_empty_report_message(capsys):
    report = oc.build_report([], "NIFTY", 90, 1)
    oc.render_report(report)
    out = capsys.readouterr().out
    assert "no sessions with usable snapshots" in out
    assert report["sessions"] == 0


def test_insufficient_history_still_emits(capsys):
    rows = []
    for day, spot, iv in zip(business_days(5), [20000 + i * 10 for i in range(5)],
                             [12, 13, 14, 15, 16]):
        rows.extend(chain(day, spot, iv))
    report = oc.build_report(rows, "NIFTY", 90, 1)
    oc.render_report(report)
    out = capsys.readouterr().out
    assert "insufficient history (5/20)" in out
    assert "ATM IV series" in out  # emits what exists
    assert "12.00%" in out and "16.00%" in out


# ---------------------------------------------------------------------------
# ATM IV series, rank / percentile, realised vol (known values)
# ---------------------------------------------------------------------------

def test_iv_series_rank_percentile_and_realised_vol(engine, conn):
    days = business_days(30)
    ivs = [10 + (i * 7) % 30 for i in range(30)]
    spots = [20000 + i * 10 for i in range(30)]
    rows = []
    for day, iv, spot in zip(days, ivs, spots):
        rows.extend(chain(day, spot, iv))
    seed(engine, rows)

    fetched, error = oc.load_snapshots(conn, "NIFTY")
    assert error is None
    series = oc.build_session_series(fetched)

    assert len(series) == 30
    assert [s["date"] for s in series] == days  # weekends excluded
    assert [s["atm_iv"] for s in series] == pytest.approx(ivs)
    assert all(s["front_expiry"] is not None and s["dte"] == 7 for s in series)

    rank = oc.iv_rank_percentile(series)
    assert rank["n"] == 30
    assert rank["min"] == pytest.approx(min(ivs))
    assert rank["max"] == pytest.approx(max(ivs))
    assert rank["latest"] == pytest.approx(ivs[-1])
    expected_rank = (ivs[-1] - min(ivs)) / (max(ivs) - min(ivs))
    assert rank["rank"] == pytest.approx(expected_rank)
    expected_pct = 100.0 * sum(1 for iv in ivs if iv <= ivs[-1]) / len(ivs)
    assert rank["percentile"] == pytest.approx(expected_pct)

    # RV over constant +10 increments is deterministic and > 0.
    hv = oc.realised_vol(series, window=20)
    assert hv is not None and hv > 0
    report = oc.build_report(fetched, "NIFTY", 90, 1)
    assert report["iv_hv_ratio"] == pytest.approx(ivs[-1] / hv)


def test_realised_vol_needs_window_plus_one():
    series = [{"spot": 100.0 + i} for i in range(20)]
    assert oc.realised_vol(series, window=20) is None
    assert oc.realised_vol(series + [{"spot": 121.0}], window=20) is not None


# ---------------------------------------------------------------------------
# Cone coverage + PIT histogram
# ---------------------------------------------------------------------------

def test_cone_coverage_counts_bands():
    # Make sigma constant (=1) across a growing spot by scaling IV inversely:
    # sigma = spot * (iv/100) * sqrt(1/252) == 1 when iv = 100*sqrt(252)/spot.
    # Then alternating 0.5 / 1.5 point moves give 50% / 100% band coverage.
    k = 100.0 * math.sqrt(252)
    increments = [0.5, 1.5] * 40
    spots, spot = [], 100.0
    spots.append(spot)
    for inc in increments:
        spot += inc
        spots.append(spot)
    series = [{"spot": s, "atm_iv": k / s, "dte": 7, "front_expiry": "2026-01-12"}
              for s in spots]

    cone = oc.cone_coverage(series, horizon=1)
    assert cone["n"] == len(increments)
    assert cone["coverage68"] == pytest.approx(50.0)
    assert cone["coverage95"] == pytest.approx(100.0)
    assert sum(cone["pit"]) == cone["n"]


def test_pit_bins_extremes():
    # Small IV -> small sigma, so the huge jumps land in the first/last bins.
    series = [
        {"spot": 100.0, "atm_iv": 15.0},
        {"spot": 50.0, "atm_iv": 15.0},   # strong down move -> PIT ~ 0
        {"spot": 200.0, "atm_iv": 15.0},  # strong up move -> PIT ~ 1
    ]
    cone = oc.cone_coverage(series, horizon=1)
    assert cone["n"] == 2
    assert cone["pit"][0] >= 1 and cone["pit"][-1] >= 1
    assert cone["coverage68"] == 0.0 and cone["coverage95"] == 0.0


# ---------------------------------------------------------------------------
# Duplicate minutes and missing IV
# ---------------------------------------------------------------------------

def test_duplicate_minutes_keep_latest_observation(engine, conn):
    day = "2026-01-05"
    expiry = "2026-01-12"
    rows = []
    for strike in (19900, 20000, 20100):
        for side in ("CE", "PE"):
            rows.append(leg(day, expiry, strike, side, 12.0, 20000, time="10:00:00"))
            rows.append(leg(day, expiry, strike, side, 15.0, 20000, time="10:01:00"))
    seed(engine, rows)

    fetched, error = oc.load_snapshots(conn, "NIFTY")
    assert error is None
    series = oc.build_session_series(fetched)
    assert len(series) == 1
    assert series[0]["atm_iv"] == pytest.approx(15.0)  # 10:01, not 10:00
    assert series[0]["spot"] == 20000.0


def test_missing_iv_is_ignored_not_zero(engine, conn):
    day = "2026-01-05"
    expiry = "2026-01-12"
    rows = []
    for strike in (19900, 20000, 20100):
        for side in ("CE", "PE"):
            iv = None if strike == 19900 else 18.0
            rows.append(leg(day, expiry, strike, side, iv, 20000))
    seed(engine, rows)

    fetched, _ = oc.load_snapshots(conn, "NIFTY")
    assert oc.build_session_series(fetched)[0]["atm_iv"] == pytest.approx(18.0)

    # All-IVs-missing chain yields no ATM IV rather than a fabricated 0.
    missing = [leg(day, expiry, s, side, None, 20000)
               for s in (19900, 20000, 20100) for side in ("CE", "PE")]
    assert oc.atm_iv(missing, 20000) is None


def test_term_snapshot_by_dte(engine, conn):
    day = "2026-01-05"
    rows = chain(day, 20000, 12, expiry="2026-01-09")
    rows += chain(day, 20000, 14, expiry="2026-01-16")
    rows += chain("2026-01-06", 20100, 13, expiry="2026-01-09")
    seed(engine, rows)

    fetched, _ = oc.load_snapshots(conn, "NIFTY")
    term = oc.term_snapshot(fetched, "2026-01-05")
    assert [t["dte"] for t in term] == [4, 11]
    assert [t["atm_iv"] for t in term] == pytest.approx([12.0, 14.0])
