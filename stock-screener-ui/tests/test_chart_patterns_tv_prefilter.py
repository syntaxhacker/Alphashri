"""Tests for chart_patterns/tv_prefilter.py (TV volume/rel-volume pre-filter)."""
import pandas as pd
import pytest

from chart_patterns import tv_prefilter


def _tv_df(rows):
    return pd.DataFrame(rows, columns=[
        "ticker", "name", "volume", "relative_volume_10d_calc",
        "average_volume_10d_calc", "close", "change", "market_cap_basic",
    ])


class _FakeQuery:
    """Stands in for tradingview_screener.Query; serves one canned frame."""
    last_kwargs = {}
    frame = None
    raise_on_fetch = False

    def __init__(self, *args, **kwargs):
        self.calls = {}

    def set_tickers(self, *tickers):
        self.calls["tickers"] = tickers
        return self

    def set_markets(self, *markets):
        self.calls["markets"] = markets
        return self

    def select(self, *columns):
        self.calls["columns"] = columns
        return self

    def where(self, *exprs):
        self.calls["where"] = exprs
        return self

    def limit(self, n):
        self.calls["limit"] = n
        return self

    def get_scanner_data(self, **kwargs):
        if _FakeQuery.raise_on_fetch:
            raise RuntimeError("TV down")
        _FakeQuery.last_kwargs = dict(kwargs)
        return 0, _FakeQuery.frame


@pytest.fixture
def fake_tv(monkeypatch):
    import tradingview_screener

    _FakeQuery.frame = None
    _FakeQuery.raise_on_fetch = False
    monkeypatch.setattr(tradingview_screener, "Query", _FakeQuery)
    return _FakeQuery


def test_metrics_mapping(fake_tv):
    fake_tv.frame = _tv_df([{
        "ticker": "NSE:RELIANCE", "name": "RELIANCE", "volume": 5_000_000.0,
        "relative_volume_10d_calc": 1.8, "average_volume_10d_calc": 2_800_000.0,
        "close": 2500.0, "change": 1.2, "market_cap_basic": 1_700_000_000_000.0,
    }])
    got = tv_prefilter.fetch_tv_volume_metrics(["reliance"])
    assert set(got) == {"RELIANCE"}
    m = got["RELIANCE"]
    assert m == {
        "volume": 5_000_000.0,
        "rel_volume": 1.8,
        "rel_volume_calc": pytest.approx(5_000_000.0 / 2_800_000.0),
        "avg_volume_10d": 2_800_000.0,
        "close": 2500.0,
        "change": 1.2,
        "market_cap": 1_700_000_000_000.0,
    }


def test_metrics_missing_symbol_absent(fake_tv):
    fake_tv.frame = _tv_df([{
        "ticker": "NSE:AAA", "name": "AAA", "volume": 1_000_000.0,
        "relative_volume_10d_calc": 2.0, "average_volume_10d_calc": 500_000.0,
        "close": 100.0, "change": 0.5, "market_cap_basic": 1_000_000_000.0,
    }])
    got = tv_prefilter.fetch_tv_volume_metrics(["AAA", "BBB"])
    assert set(got) == {"AAA"}
    assert "BBB" not in got


def test_metrics_never_raises_on_tv_error(fake_tv):
    fake_tv.raise_on_fetch = True
    assert tv_prefilter.fetch_tv_volume_metrics(["AAA"]) == {}


def test_metrics_empty_frame_returns_empty(fake_tv):
    fake_tv.frame = _tv_df([])
    assert tv_prefilter.fetch_tv_volume_metrics(["AAA"]) == {}


def test_metrics_empty_symbols_no_query(fake_tv, monkeypatch):
    called = []

    class _Boom(_FakeQuery):
        def get_scanner_data(self, **kwargs):
            called.append(1)
            raise AssertionError("no query for empty symbols")

    import tradingview_screener

    monkeypatch.setattr(tradingview_screener, "Query", _Boom)
    assert tv_prefilter.fetch_tv_volume_metrics([]) == {}
    assert called == []


def test_prefilter_threshold_filtering(monkeypatch):
    metrics = {
        "HOT": {"volume": 5_000_000.0, "rel_volume": 2.5, "avg_volume_10d": 2_000_000.0,
                "close": 100.0, "change": 1.0, "market_cap": 1e9},
        "COLD": {"volume": 100_000.0, "rel_volume": 0.4, "avg_volume_10d": 250_000.0,
                 "close": 50.0, "change": -0.5, "market_cap": 1e8},
        "QUIET": {"volume": 9_000_000.0, "rel_volume": 0.9, "avg_volume_10d": 10_000_000.0,
                  "close": 75.0, "change": 0.1, "market_cap": 5e8},
    }
    monkeypatch.setattr(tv_prefilter, "fetch_tv_volume_metrics", lambda syms, **k: metrics)

    kept, info = tv_prefilter.prefilter_by_volume(
        ["HOT", "COLD", "QUIET"], min_rel_volume=1.0, min_volume_m=1.0,
    )
    assert kept == ["HOT"]
    assert info["before"] == 3 and info["after"] == 1
    assert info["message"] == "TV prefilter: 3 → 1"

    # Rel-volume gate alone: QUIET has volume but low rel-vol.
    kept, _ = tv_prefilter.prefilter_by_volume(["HOT", "QUIET"], min_rel_volume=1.0)
    assert kept == ["HOT"]

    # Volume gate alone (millions): COLD is thin.
    kept, _ = tv_prefilter.prefilter_by_volume(["HOT", "COLD"], min_volume_m=1.0)
    assert kept == ["HOT"]

    # No gates: passthrough without any TV call.
    def _boom(syms, **kwargs):
        raise AssertionError("fetch must not run without filters")

    monkeypatch.setattr(tv_prefilter, "fetch_tv_volume_metrics", _boom)
    kept, info = tv_prefilter.prefilter_by_volume(["HOT", "COLD"])
    assert kept == ["HOT", "COLD"]
    assert info == {}


def test_prefilter_missing_symbol_excluded(monkeypatch):
    metrics = {
        "AAA": {"volume": 5_000_000.0, "rel_volume": 2.0, "avg_volume_10d": 2_500_000.0,
                "close": 100.0, "change": 1.0, "market_cap": 1e9},
    }
    monkeypatch.setattr(tv_prefilter, "fetch_tv_volume_metrics", lambda syms, **k: metrics)
    kept, info = tv_prefilter.prefilter_by_volume(["AAA", "GHOST"], min_rel_volume=1.0)
    assert kept == ["AAA"]
    assert info["before"] == 2 and info["after"] == 1


def test_prefilter_keeps_symbols_from_a_failed_batch(monkeypatch):
    """A batch that errored (``unqueried``) must fail open, not be dropped."""
    metrics = {
        "AAA": {"volume": 5_000_000.0, "rel_volume": 2.0, "avg_volume_10d": 2_500_000.0,
                "close": 100.0, "change": 1.0, "market_cap": 1e9},
        "BBB": {"unqueried": True},
    }
    monkeypatch.setattr(tv_prefilter, "fetch_tv_volume_metrics", lambda syms, **k: metrics)
    kept, info = tv_prefilter.prefilter_by_volume(["AAA", "BBB", "GHOST"], min_rel_volume=1.5)
    assert kept == ["AAA", "BBB"], "the failed-batch symbol must be kept (fail open)"
    assert "GHOST" not in kept, "a genuinely absent symbol is still excluded"
    assert info["after"] == 2


def test_prefilter_fail_open_on_tv_error(monkeypatch):
    monkeypatch.setattr(tv_prefilter, "fetch_tv_volume_metrics", lambda syms, **k: {})
    kept, info = tv_prefilter.prefilter_by_volume(
        ["AAA", "BBB"], min_rel_volume=1.5, min_volume_m=2.0,
    )
    assert kept == ["AAA", "BBB"]
    assert info == {"fail_open": True}


def test_rel_volume_calc_none_without_average(fake_tv):
    fake_tv.frame = _tv_df([{
        "ticker": "NSE:AAA", "name": "AAA", "volume": 1_000_000.0,
        "relative_volume_10d_calc": 2.0, "average_volume_10d_calc": None,
        "close": 100.0, "change": 0.5, "market_cap_basic": 1_000_000_000.0,
    }, {
        "ticker": "NSE:ZERO", "name": "ZERO", "volume": 1_000_000.0,
        "relative_volume_10d_calc": 2.0, "average_volume_10d_calc": 0.0,
        "close": 100.0, "change": 0.5, "market_cap_basic": 1_000_000_000.0,
    }])
    got = tv_prefilter.fetch_tv_volume_metrics(["AAA", "ZERO"])
    assert got["AAA"]["rel_volume_calc"] is None
    assert got["ZERO"]["rel_volume_calc"] is None
    # TV's own field is untouched (different denominator, kept as-is).
    assert got["AAA"]["rel_volume"] == 2.0


def test_low_coverage_logs_warning(fake_tv, caplog):
    rows = [{
        "ticker": "NSE:AAA", "name": "AAA", "volume": 1_000_000.0,
        "relative_volume_10d_calc": 2.0, "average_volume_10d_calc": 500_000.0,
        "close": 100.0, "change": 0.5, "market_cap_basic": 1_000_000_000.0,
    }]
    fake_tv.frame = _tv_df(rows)
    with caplog.at_level("WARNING", logger="chart_patterns.tv_prefilter"):
        got = tv_prefilter.fetch_tv_volume_metrics(
            ["AAA", "BBB", "CCC", "DDD", "EEE"]
        )
    assert set(got) == {"AAA"}
    warnings = [r for r in caplog.records if "low coverage" in r.getMessage()]
    assert warnings, "expected a low-coverage WARNING with the ratio"
    assert "1/5" in warnings[0].getMessage()


def test_full_coverage_logs_no_warning(fake_tv, caplog):
    fake_tv.frame = _tv_df([{
        "ticker": "NSE:AAA", "name": "AAA", "volume": 1_000_000.0,
        "relative_volume_10d_calc": 2.0, "average_volume_10d_calc": 500_000.0,
        "close": 100.0, "change": 0.5, "market_cap_basic": 1_000_000_000.0,
    }])
    with caplog.at_level("WARNING", logger="chart_patterns.tv_prefilter"):
        got = tv_prefilter.fetch_tv_volume_metrics(["AAA"])
    assert set(got) == {"AAA"}
    assert not [r for r in caplog.records if "low coverage" in r.getMessage()]
