"""Tests for GET /api/reports/breakouts (synthetic frames, mocked universe/candles)."""
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.reports_api.breakouts as br


# ---------------------------------------------------------------------------
# Frame builders (programmatic candles, never inline JSON blobs)
# ---------------------------------------------------------------------------

def _flat(n=300, price=100.0, vol=1000.0, end="2026-09-01"):
    idx = pd.date_range(end=end, periods=n, freq="D", tz="UTC")
    return pd.DataFrame(
        {"open": price, "high": price, "low": price, "close": price, "volume": vol},
        index=idx,
    )


def _set_last(df, o, h, l, c, v):
    df.iloc[-1] = [o, h, l, c, v]
    return df


def _flat_breakout_high(vol=3000.0, close=110.0):
    """Flat 100 prior, today rips to ``close`` (52w-high setup)."""
    df = _flat()
    return _set_last(df, close - 0.5, close, close - 1.0, close, vol)


def _fake_fetch_factory(frames):
    def _fake(symbol, *args, **kwargs):
        return frames.get(str(symbol).upper())
    return _fake


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(br, "get_universe", lambda u: [])
    monkeypatch.setattr(br, "fetch_for_timeframe", _fake_fetch_factory({}))
    # Isolate the past-date disk cache: explicit-date tests must never touch
    # the real experiments/ dir.
    monkeypatch.setattr(br, "REPORT_DIR", tmp_path)
    br.clear_today_cache()
    app = FastAPI()
    app.include_router(br.router)
    with TestClient(app) as c:
        yield c
    br.clear_today_cache()


# ---------------------------------------------------------------------------
# analyze_frame unit tests
# ---------------------------------------------------------------------------

class TestAnalyzeFrame:
    def test_short_frame_skipped(self):
        assert br.analyze_frame(_flat(n=10)) is None
        assert br.analyze_frame(None) is None

    def test_52w_high_beats_base_20(self):
        sig = br.analyze_frame(_flat_breakout_high())
        assert sig is not None
        assert sig["type"] == "52w_high"
        assert sig["level"] == pytest.approx(100.0)
        assert sig["pct_above"] == pytest.approx(10.0)
        assert sig["volume_ratio"] == pytest.approx(3.0)

    def test_base_20_when_52w_blocked(self):
        df = _flat()
        df.iloc[50, df.columns.get_loc("high")] = 200.0  # old spike blocks 52w
        _set_last(df, 101.0, 105.0, 104.5, 105.0, 3000.0)
        df.iloc[-1, df.columns.get_loc("open")] = 101.0  # below gap trigger
        sig = br.analyze_frame(df)
        assert sig is not None
        assert sig["type"] == "base_20"
        assert sig["level"] == pytest.approx(100.0)

    def test_base_50_when_20_fails_range_gate(self):
        # 19 flat bars + 1 dip (low 75.22): 20d range_pct ~25.09 (fail),
        # 50d window (30 extra flat bars dilute the mean) ~24.90 (pass).
        df = _flat()
        dip = df.index[-3]  # inside the last-20 prior window, not the final bar
        df.loc[dip, ["high", "low", "close"]] = [100.0, 75.22, 75.22]
        df.iloc[50, df.columns.get_loc("high")] = 200.0
        _set_last(df, 100.0, 101.0, 100.0, 101.0, 3000.0)
        sig = br.analyze_frame(df)
        assert sig is not None
        assert sig["type"] == "base_50", sig

    def test_volume_gate(self):
        df = _flat_breakout_high(vol=1000.0)  # ratio 1.0 < 1.5
        assert br.analyze_frame(df) is None

    def test_base_range_gate_blocks(self):
        # Last 20 prior bars oscillate 70..100 (range 30 / mean ~85 > 25%).
        df = _flat()
        for i, ts in enumerate(df.index[-21:-1]):
            hi = 100.0 if i % 2 == 0 else 100.0
            lo = 70.0 if i % 2 == 0 else 70.0
            df.loc[ts, ["high", "low", "close"]] = [hi, lo, 85.0]
        df.iloc[50, df.columns.get_loc("high")] = 200.0
        _set_last(df, 99.0, 101.0, 98.0, 101.0, 3000.0)  # open blocks gap
        assert br.analyze_frame(df) is None

    def test_gap_break(self):
        df = _flat()
        df.iloc[50, df.columns.get_loc("high")] = 200.0  # blocks 52w
        _set_last(df, 103.5, 104.0, 103.0, 103.8, 3000.0)
        sig = br.analyze_frame(df)
        assert sig is not None
        assert sig["type"] == "gap"
        assert sig["level"] == pytest.approx(100.0)

    def test_new_52w_low(self):
        df = _flat()
        _set_last(df, 96.0, 96.0, 94.5, 95.0, 3000.0)
        sig = br.analyze_frame(df)
        assert sig is not None
        assert sig["type"] == "52w_low"
        assert sig["pct_above"] == pytest.approx(-5.0)

    def test_break_20_when_52w_low_blocked(self):
        df = _flat()
        df.iloc[50, df.columns.get_loc("low")] = 50.0  # old dip blocks 52w_low
        _set_last(df, 95.5, 96.0, 94.5, 95.0, 3000.0)
        sig = br.analyze_frame(df)
        assert sig is not None
        assert sig["type"] == "break_20"

    def test_break_50_when_20_fails_range_gate(self):
        # Mirror of the base_50 boundary: a hump bar (high 125.5, close 100)
        # plus 30 extra bars parked at 125.5 -> 20d ~25.5 (fail), 50d ~22.1.
        df = _flat()
        hump = df.index[-3]
        df.loc[hump, ["high", "low", "close"]] = [125.5, 100.0, 100.0]
        for ts in df.index[-52:-22]:  # 30 extra bars inside the 50d window only
            df.loc[ts, ["open", "high", "low", "close"]] = [125.5, 125.5, 125.5, 125.5]
        df.iloc[50, df.columns.get_loc("high")] = 200.0  # blocks 52w_high
        df.iloc[60, df.columns.get_loc("low")] = 50.0  # blocks 52w_low
        _set_last(df, 99.5, 99.5, 98.5, 99.0, 3000.0)
        sig = br.analyze_frame(df)
        assert sig is not None
        assert sig["type"] == "break_50", sig

    def test_spark_normalized(self):
        sig = br.analyze_frame(_flat_breakout_high())
        assert sig is not None
        spark = sig["spark"]
        assert len(spark) == 30
        assert min(spark) == pytest.approx(0.0)
        assert max(spark) == pytest.approx(1.0)

    def test_to_52w_high_none_when_short(self):
        df = _flat(n=100)
        _set_last(df, 101.0, 110.0, 109.0, 110.0, 3000.0)  # open blocks gap
        sig = br.analyze_frame(df)
        assert sig is not None
        assert sig["type"] == "base_20"
        assert sig["to_52w_high"] is None


# ---------------------------------------------------------------------------
# Endpoint tests
# ---------------------------------------------------------------------------

_ROW_KEYS = {"symbol", "name", "type", "level", "close", "pct_above",
             "volume_ratio", "change", "to_52w_high", "sector", "spark"}


class TestEndpoint:
    def test_shape_and_sorting(self, client, monkeypatch):
        aaa = _flat_breakout_high(close=110.0)          # score 10*3 = 30
        bbb = _flat()
        bbb.iloc[50, bbb.columns.get_loc("high")] = 200.0
        _set_last(bbb, 101.0, 105.0, 104.5, 105.0, 4000.0)  # score 5*4 = 20
        bbb.iloc[-1, bbb.columns.get_loc("open")] = 101.0
        monkeypatch.setattr(br, "get_universe", lambda u: ["AAA", "BBB"])
        monkeypatch.setattr(
            br, "fetch_for_timeframe", _fake_fetch_factory({"AAA": aaa, "BBB": bbb}))
        r = client.get("/api/reports/breakouts?universe=tu&date=2026-09-01")
        assert r.status_code == 200
        p = r.json()
        assert set(p) == {"date", "universe", "as_of", "cached", "scanned",
                          "breakouts", "breakdowns"}
        assert p["scanned"] == 2
        assert p["breakouts"]["count"] == 2
        assert [row["symbol"] for row in p["breakouts"]["rows"]] == ["AAA", "BBB"]
        assert _ROW_KEYS <= set(p["breakouts"]["rows"][0])
        assert p["breakdowns"] == {"count": 0, "by_type": {}, "rows": []}

    def test_by_type_counts(self, client, monkeypatch):
        s52 = _flat_breakout_high()
        sb = _flat()
        sb.iloc[50, sb.columns.get_loc("high")] = 200.0
        _set_last(sb, 101.0, 105.0, 104.5, 105.0, 3000.0)
        sb.iloc[-1, sb.columns.get_loc("open")] = 101.0
        sg = _flat()
        sg.iloc[50, sg.columns.get_loc("high")] = 200.0
        _set_last(sg, 103.5, 104.0, 103.0, 103.8, 3000.0)
        monkeypatch.setattr(br, "get_universe", lambda u: ["S52", "SB", "SG"])
        monkeypatch.setattr(br, "fetch_for_timeframe",
                            _fake_fetch_factory({"S52": s52, "SB": sb, "SG": sg}))
        p = client.get("/api/reports/breakouts?universe=tu&date=2026-09-01").json()
        assert p["breakouts"]["by_type"] == {"52w_high": 1, "gap": 1, "base_20": 1}
        assert p["breakouts"]["count"] == 3

    def test_breakdowns_section(self, client, monkeypatch):
        dn = _flat()
        _set_last(dn, 96.0, 96.0, 94.5, 95.0, 3000.0)
        monkeypatch.setattr(br, "get_universe", lambda u: ["DN"])
        monkeypatch.setattr(br, "fetch_for_timeframe",
                            _fake_fetch_factory({"DN": dn}))
        p = client.get("/api/reports/breakouts?universe=tu&date=2026-09-01").json()
        assert p["breakouts"]["count"] == 0
        assert p["breakdowns"]["count"] == 1
        assert p["breakdowns"]["by_type"] == {"52w_low": 1}
        assert p["breakdowns"]["rows"][0]["pct_above"] == pytest.approx(-5.0)

    def test_fail_soft_symbol_error(self, client, monkeypatch):
        ok = _flat_breakout_high()
        monkeypatch.setattr(br, "get_universe", lambda u: ["OK", "BAD"])

        def _fetch(symbol, *a, **k):
            if str(symbol).upper() == "BAD":
                raise RuntimeError("boom")
            return ok

        monkeypatch.setattr(br, "fetch_for_timeframe", _fetch)
        p = client.get("/api/reports/breakouts?universe=tu&date=2026-09-01").json()
        assert p["breakouts"]["count"] == 1
        assert p["scanned"] == 2

    def test_fail_soft_unknown_universe(self, client, monkeypatch):
        monkeypatch.setattr(br, "get_universe", lambda u: (_ for _ in ()).throw(
            ValueError(f"Unknown universe {u!r}")))
        r = client.get("/api/reports/breakouts?universe=nope")
        assert r.status_code == 200
        p = r.json()
        assert p["breakouts"]["count"] == 0 and p["breakdowns"]["count"] == 0

    def test_fail_soft_bad_date(self, client):
        r = client.get("/api/reports/breakouts?date=not-a-date")
        assert r.status_code == 200
        assert r.json()["breakouts"]["count"] == 0

    def test_today_cache_second_hit_cached(self, client, monkeypatch):
        calls = []

        def _fetch(symbol, *a, **k):
            calls.append(symbol)
            return _flat_breakout_high()

        monkeypatch.setattr(br, "get_universe", lambda u: ["AAA"])
        monkeypatch.setattr(br, "fetch_for_timeframe", _fetch)
        # Pin "today" to the fixture end so the today-cache path is exercised
        # on any weekday (weekends remap today to the last completed session).
        monkeypatch.setattr(br, "_today_str", lambda: "2026-09-01")
        import datetime as _dt

        monkeypatch.setattr(
            "chart_patterns.candles._last_completed_session",
            lambda now=None: _dt.date(2026, 9, 1),
        )
        first = client.get("/api/reports/breakouts?universe=tu").json()
        assert first["cached"] is False
        n = len(calls)
        assert n == 1
        second = client.get("/api/reports/breakouts?universe=tu").json()
        assert second["cached"] is True
        assert len(calls) == n  # served from the 60 s memory cache
        assert second["breakouts"]["count"] == 1

    def test_past_date_disk_cache(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(br, "REPORT_DIR", tmp_path)
        calls = []

        def _fetch(symbol, *a, **k):
            calls.append(symbol)
            return _flat_breakout_high()

        monkeypatch.setattr(br, "get_universe", lambda u: ["AAA"])
        monkeypatch.setattr(br, "fetch_for_timeframe", _fetch)
        url = "/api/reports/breakouts?universe=tu&date=2026-09-01"
        first = client.get(url).json()
        assert first["cached"] is False
        assert first["breakouts"]["count"] == 1
        assert (tmp_path / "2026-09-01_tu.json").exists()
        n = len(calls)
        second = client.get(url).json()
        assert second["cached"] is True
        assert len(calls) == n  # immutable disk cache: no refetch
        assert second["breakouts"]["count"] == 1
