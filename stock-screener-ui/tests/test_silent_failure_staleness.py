"""Silent-failure / staleness regressions.

These tests pin the "confident but wrong" class: a real upstream error that
turns into ``None``/empty, or a stale frame that is served as current. Each fix
in this file was proved to fail against the pre-fix code.
"""
import json
import logging
import time
from datetime import date
from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy.orm import sessionmaker

from chart_patterns import candles as candles_mod
from chart_patterns import scan, store
import market_data.market_data as md

pytest.importorskip("trading.timezone")


def _make_df(n: int = 10) -> pd.DataFrame:
    idx = pd.date_range("2026-09-01", periods=n, freq="D", tz="UTC")
    base = [100.0 + i for i in range(n)]
    return pd.DataFrame(
        {
            "open": base,
            "high": [b + 1.0 for b in base],
            "low": [b - 1.0 for b in base],
            "close": base,
            "volume": [1000.0] * n,
        },
        index=idx,
    )


def _write_entry(path, df, ts: float, session: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        import pickle

        pickle.dump(df, fh)
    with open(path.with_suffix(".meta"), "w") as fh:
        json.dump({"ts": ts, "session": session}, fh)


@pytest.fixture
def cdir(monkeypatch, tmp_path):
    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def closed_weekday(monkeypatch):
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    monkeypatch.setattr("trading.utils.is_trading_holiday", lambda d: False)


@pytest.fixture
def cp_store(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    try:
        yield factory
    finally:
        store.reset_session_factory()


# ---------------------------------------------------------------------------
# Staleness: calendar-day tolerance cannot distinguish a weekend from missing
# sessions. Before = 3 calendar days; after = at most one completed session.
# ---------------------------------------------------------------------------


def test_three_calendar_day_tolerance_served_two_missing_sessions(
    cdir, closed_weekday, monkeypatch
):
    """A frame stamped Monday served while Thursday is the last completed
    session is 3 calendar days behind but THREE sessions stale (Tue/Wed/Thu).

    Regression: the old ``lag <= 3 calendar days`` rule accepted it and the
    chart claimed to be current. The fix counts sessions, so it is rejected.
    """
    df = _make_df()
    path = cdir / "AAA.pkl"
    _write_entry(path, df, time.time(), "2026-10-05")  # Monday
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 8)
    )  # Thursday
    assert candles_mod._read_cached(path, True, is_daily=True) is None


def test_friday_to_monday_bridge_still_served(cdir, closed_weekday, monkeypatch):
    """A legitimate Fri->Mon weekend bridge is ONE session and stays fresh."""
    df = _make_df()
    path = cdir / "BBB.pkl"
    _write_entry(path, df, time.time(), "2026-10-02")  # Friday
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 5)
    )  # Monday
    assert candles_mod._read_cached(path, True, is_daily=True) is not None


def test_one_session_behind_still_served(cdir, closed_weekday, monkeypatch):
    df = _make_df()
    path = cdir / "CCC.pkl"
    _write_entry(path, df, time.time(), "2026-10-07")  # Wednesday
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 8)
    )  # Thursday
    assert candles_mod._read_cached(path, True, is_daily=True) is not None


# ---------------------------------------------------------------------------
# Staleness proofs that hold on the current code (no fix required)
# ---------------------------------------------------------------------------


def test_meta_session_stamped_from_frame_not_expected_session(cdir, monkeypatch):
    """The 1D cache pin must equal the frame's own last bar, not the wall-clock
    last completed session. A lagging official feed cannot self-report current.
    """
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)
    monkeypatch.setattr("trading.utils.is_trading_holiday", lambda d: False)
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 8)
    )
    df = _make_df()
    df.index = pd.date_range("2026-10-01", periods=len(df), freq="D", tz="UTC")
    # Frame ends Monday 2026-10-05 even though Thursday is the last session.
    df = df.iloc[:5]
    df.index = pd.date_range("2026-10-01", periods=5, freq="D", tz="UTC")
    monkeypatch.setattr(
        md, "fetch_candles_for_timeframe", lambda *a, **k: df.copy()
    )
    candles_mod.fetch_for_timeframe("AAA", "1D", force_refresh=True)
    path = candles_mod._cache_path("1D", "AAA")
    with open(path.with_suffix(".meta")) as fh:
        meta = json.load(fh)
    assert meta["session"] == "2026-10-05"


def test_frame_last_date_rejects_integer_index():
    """pd.Timestamp(1) is 1970-01-01: an int index must yield None, not a
    confident epoch date that a chart formats as a real session."""
    df = pd.DataFrame({"close": [1.0, 2.0]}, index=[0, 1])
    assert candles_mod.frame_last_date(df) is None


def test_lookback_variant_cannot_serve_another_lookback(cdir, closed_weekday, monkeypatch):
    """lb250 and lb500 are separate namespaces: a stale lb250 frame can never
    be read as an lb500 frame (disproves cross-lookback contamination)."""
    df = _make_df()
    p250 = candles_mod._cache_path("1D", "AAA", variant="lb250")
    p500 = candles_mod._cache_path("1D", "AAA", variant="lb500")
    assert p250 != p500
    _write_entry(p250, df, time.time(), "2026-10-02")
    monkeypatch.setattr(
        candles_mod, "_last_completed_session", lambda now=None: date(2026, 10, 2)
    )
    assert candles_mod._read_cached(p250, True, is_daily=True) is not None
    assert candles_mod._read_cached(p500, True, is_daily=True) is None


# ---------------------------------------------------------------------------
# Swallowed errors that must become observable
# ---------------------------------------------------------------------------


def test_historical_fetch_error_is_logged_with_context(caplog):
    """An expired token / 429 on the historical endpoint must not silently
    look like 'no candles' -- the operator needs symbol + error in the log.
    """

    class Boom:
        def fetch_historical_data_v3(self, **kwargs):
            raise RuntimeError("token expired")

    with caplog.at_level(logging.WARNING, logger="market_data.market_data"):
        out = md._fetch_historical_window(Boom(), "AAA", 240, "2026-10-01", "2026-10-08")
    assert out is None
    assert "AAA" in caplog.text
    assert "token expired" in caplog.text


def test_db_query_failure_is_logged_with_context(monkeypatch, caplog):
    """A DB error inside a read currently renders 'no patterns found' with no
    operator signal: fail-soft is fine, invisible is not.
    """

    class BrokenSession:
        def query(self, *a, **k):
            raise RuntimeError("db connection lost")

        def close(self):
            pass

    monkeypatch.setattr(store, "_new_session", BrokenSession)
    with caplog.at_level(logging.WARNING, logger="chart_patterns.store"):
        items, total, summary = store.query_results({"universe": "nifty50"})
    assert items == [] and total == 0
    assert "db connection lost" in caplog.text


def test_all_symbols_failed_marks_job_failed(cp_store, monkeypatch):
    """A scan where every symbol failed is an error, not a clean empty result.

    Before: status=completed -> the fresh-scan gate reuses it as 'success' for
    the whole session. After: status=failed -> it is never reused.
    """
    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", lambda *a, **k: None)
    monkeypatch.setattr(
        scan,
        "universes_mod",
        SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB"]),
    )
    job_id = "sf_all_failed"
    store.save_job(
        {"job_id": job_id, "universe": "sf_fail_universe", "timeframe": "1D", "status": "queued"}
    )
    scan.run_job(job_id)
    row = store.get_job(job_id)
    assert row["failed"] == 2
    assert row["status"] == "failed"
    assert "failed" in (row.get("error") or "").lower()


def test_dropped_hit_is_logged(cp_store, monkeypatch, caplog):
    """A detector hit that cannot be serialized must not vanish silently."""
    from chart_patterns.detectors.common import PatternHit

    hit = PatternHit(
        pattern_id="double_bottom",
        pattern_name="Double Bottom",
        family="reversal",
        direction="bullish",
        status="confirmed",
        quality="strong",
        confidence=70.0,
        start_date="2026-01-01",
        end_date="2026-02-01",
        start_price=100.0,
        end_price=110.0,
        breakout_level=110.0,
        target=120.0,
        stop=95.0,
        rr=2.0,
        bars_ago=1,
        volume_confirmed=True,
        trendlines=[],
        notes="x",
        symbol="AAA",
        timeframe="1D",
    )

    class Unserializable:
        def __dict__(self):
            raise RuntimeError("bad hit")

    monkeypatch.setattr(scan, "_detect", lambda *a, **k: [hit, Unserializable()])
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80)
    )
    with caplog.at_level(logging.WARNING, logger="chart_patterns.scan"):
        result = scan._process_symbol("AAA", "1D", "sf_drop")
    assert result["status"] == "ok"
    assert len(result["hits"]) == 1
    assert "AAA" in caplog.text
