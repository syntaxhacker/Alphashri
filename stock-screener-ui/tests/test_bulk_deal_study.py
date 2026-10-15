"""Unit tests for india_board/scripts/bulk_deal_study.py (no network).

Synthetic candles only. Covers the volume z-score maths (hand-computed, zero
variance, short series), forward metrics (+1/+5/+20, MAE/MFE, insufficient
candles), the stop/target chronological walk, symbol resolution fallback, the
same-day candle disk cache, the captured-deal cohort reader / gate, cost
application, and the pytest no-live-writes guard.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from india_board.scripts import bulk_deal_study as study

IST = ZoneInfo("Asia/Kolkata")
BASE = datetime(2025, 12, 1, 15, 30, tzinfo=IST)


def C(i, close, *, high=None, low=None, volume=1000.0, base=BASE):
    """One normalised candle dict at session ``i``."""
    d = (base + timedelta(days=i)).date().isoformat()
    return {
        "date": d,
        "open": close,
        "high": close + 1 if high is None else high,
        "low": close - 2 if low is None else low,
        "close": close,
        "volume": volume,
    }


def raw_row(i, close, *, high=None, low=None, volume=1000.0, base=BASE):
    """One raw Fyers row ``[epoch, o, h, l, c, v]``."""
    epoch = (base + timedelta(days=i)).timestamp()
    return [epoch, close, close + 1 if high is None else high,
            close - 2 if low is None else low, close, volume]


# ---------------------------------------------------------------------------
# volume z-score
# ---------------------------------------------------------------------------


def test_volume_zscore_hand_computed():
    prior = [10.0, 20.0, 30.0]
    # mean 20, population sigma sqrt(200/3) = 8.164965...
    assert study.volume_zscore(30, prior) == pytest.approx(1.224744871, rel=1e-6)
    assert study.volume_zscore(10, prior) == pytest.approx(-1.224744871, rel=1e-6)
    assert study.volume_zscore(20, prior) == pytest.approx(0.0, abs=1e-12)


def test_volume_zscore_zero_variance_is_none():
    assert study.volume_zscore(10, [5, 5, 5, 5]) is None
    assert study.volume_zscore(0, [0, 0]) is None


def test_volume_zscore_short_or_bad_is_none():
    assert study.volume_zscore(10, [5]) is None          # < min_lookback
    assert study.volume_zscore(10, []) is None
    assert study.volume_zscore(None, [1, 2, 3]) is None
    assert study.volume_zscore(10, [None, None]) is None


def test_volume_zscores_aligned_and_windowed():
    vols = [10, 11, 12, 10, 11, 12, 10, 11, 40]
    zs = study.volume_zscores(vols, window=8)
    assert len(zs) == len(vols)
    assert zs[0] is None  # no prior
    assert zs[8] is not None and zs[8] > 2  # 40 vs varied ten-elevens
    # zero-variance prior is None
    flat = study.volume_zscores([10, 10, 10, 10, 10], window=4)
    assert flat[4] is None


# ---------------------------------------------------------------------------
# forward metrics
# ---------------------------------------------------------------------------


def _series():
    closes = [100, 110, 105, 106, 107, 120] + [130] * 14 + [150]
    candles = [C(i, c) for i, c in enumerate(closes)]
    candles[2]["low"] = 95.0  # an adverse dip below entry on session +2
    return candles


def test_forward_return_exact_horizons():
    candles = _series()
    assert study.forward_return(candles, 0, 1) == pytest.approx(10.0)
    assert study.forward_return(candles, 0, 5) == pytest.approx(20.0)
    assert study.forward_return(candles, 0, 20) == pytest.approx(50.0)


def test_forward_metrics_mae_mfe():
    candles = _series()
    m = study.forward_metrics(candles, 0)
    assert m["ret_1"] == pytest.approx(10.0)
    assert m["ret_5"] == pytest.approx(20.0)
    assert m["ret_20"] == pytest.approx(50.0)
    # adverse dip on session +2: low 95 vs entry 100 -> -5%
    assert m["mae_20"] == pytest.approx(-5.0)
    # max forward high = 150 + 1 = 151 -> +51%
    assert m["mfe_20"] == pytest.approx(51.0)


def test_forward_metrics_not_enough_candles_is_none():
    candles = [C(0, 100), C(1, 110), C(2, 105)]
    m = study.forward_metrics(candles, 0)
    assert m["ret_1"] == pytest.approx(10.0)
    assert m["ret_5"] is None
    assert m["ret_20"] is None
    assert m["mae_20"] is None and m["mfe_20"] is None
    # no forward candle at all
    assert study.forward_return([C(0, 100)], 0, 1) is None
    assert study.excursions([C(0, 100)], 0, 1) == (None, None)


# ---------------------------------------------------------------------------
# stop / target chronological walk
# ---------------------------------------------------------------------------


def test_stop_hit_first():
    candles = [C(0, 100), C(1, 100, high=101, low=90)]
    out = study.simulate_trade(candles, 0, stop_pct=8, target_pct=15)
    assert out["outcome"] == "stop"
    assert out["exit_price"] == pytest.approx(92.0)
    assert out["gross_pct"] == pytest.approx(-8.0)


def test_target_hit_first():
    candles = [C(0, 100), C(1, 105, high=120, low=99)]
    out = study.simulate_trade(candles, 0, stop_pct=8, target_pct=15)
    assert out["outcome"] == "target"
    assert out["exit_price"] == pytest.approx(115.0)
    assert out["gross_pct"] == pytest.approx(15.0)


def test_single_candle_straddle_stop_wins():
    candles = [C(0, 100), C(1, 100, high=120, low=90)]
    out = study.simulate_trade(candles, 0, stop_pct=8, target_pct=15)
    assert out["outcome"] == "stop"  # conservative, documented
    assert out["exit_price"] == pytest.approx(92.0)


def test_stop_target_timeout_at_last_close():
    candles = [C(0, 100), C(1, 101, high=102, low=100), C(2, 103, high=104, low=101)]
    out = study.simulate_trade(candles, 0, stop_pct=8, target_pct=15, max_sessions=5)
    assert out["outcome"] == "timeout"
    assert out["exit_price"] == pytest.approx(103.0)
    assert out["sessions_held"] == 2


# ---------------------------------------------------------------------------
# costs
# ---------------------------------------------------------------------------


def test_net_return_pct_applies_costs():
    entry, exit_, qty = 100.0, 110.0, 100
    ref = study.calculate_trading_costs(entry, exit_, qty)
    expected_cost_pct = ref["total_costs"] / (entry * qty) * 100.0
    net = study.net_return_pct(entry, exit_, qty)
    assert net == pytest.approx(10.0 - expected_cost_pct)
    # Hand-check: entry 10,000 notional, ₹11.24 round-trip -> 0.1124% -> ~9.8876%
    assert ref["total_costs"] == pytest.approx(11.24)
    assert net == pytest.approx(9.8876, abs=0.01)
    assert study.net_return_pct(entry, exit_, 0) is None
    assert study.net_return_pct(None, exit_, qty) is None


# ---------------------------------------------------------------------------
# symbol resolution
# ---------------------------------------------------------------------------


def test_symbol_variants_order_and_dedupe():
    assert study.symbol_variants("foo") == ["NSE:FOO-EQ", "NSE:FOO-BE", "NSE:FOO-BZ", "FOO"]
    assert study.symbol_variants("NSE:FOO-EQ") == ["NSE:FOO-EQ"]
    assert study.symbol_variants("") == []


def test_resolve_symbol_uses_next_variant():
    calls = []

    def fetch(symbol, resolution, range_from, range_to):
        calls.append(symbol)
        if symbol.endswith("-EQ"):
            return []
        return [raw_row(0, 100), raw_row(1, 101)]

    res = study.resolve_symbol("FOO", "Foo Ltd", fetch, range_from="2025-01-01", range_to="2025-06-01")
    assert res["resolved"] is True
    assert res["fyers_symbol"] == "NSE:FOO-BE"
    assert calls == ["NSE:FOO-EQ", "NSE:FOO-BE"]
    assert len(res["candles"]) == 2


def test_resolve_symbol_all_empty_is_unresolved():
    def fetch(symbol, resolution, range_from, range_to):
        return []

    res = study.resolve_symbol("NOPE", "Nope Ltd", fetch)
    assert res["resolved"] is False
    assert res["fyers_symbol"] is None
    assert res["candles"] == []
    assert "reason" in res and res["reason"]


def test_resolve_symbol_name_fallback():
    def fetch(symbol, resolution, range_from, range_to):
        return [raw_row(0, 50)] if symbol == "NSE:SSWL-EQ" else []

    master = {"NSE:SSWL26OCTFUT": {"underSym": "SSWL", "symDetails": "Some Company Ltd"}}
    res = study.resolve_symbol("BOGUS", "Some Company Ltd", fetch, master=master)
    assert res["resolved"] is True
    assert res["fyers_symbol"] == "NSE:SSWL-EQ"


# ---------------------------------------------------------------------------
# candle disk cache
# ---------------------------------------------------------------------------


def test_candle_cache_second_call_no_fetch(tmp_path):
    calls = {"n": 0}

    def fetch(symbol, resolution, range_from, range_to):
        calls["n"] += 1
        return [raw_row(i, 100 + i) for i in range(5)]

    day = "2026-09-30"
    first = study.load_candles(tmp_path, "FOO", fetch_fn=fetch,
                               range_from="2026-01-01", range_to=day, today=day)
    second = study.load_candles(tmp_path, "FOO", fetch_fn=fetch,
                                range_from="2026-01-01", range_to=day, today=day)
    assert calls["n"] == 1  # second call served from the same-day cache
    assert first == second and len(second) == 5


def test_candle_cache_offline_uses_cache_only(tmp_path):
    def fetch(symbol, resolution, range_from, range_to):
        raise AssertionError("offline must not fetch")

    assert study.load_candles(tmp_path, "MISSING", fetch_fn=fetch, offline=True) == []
    study.write_cached_candles(tmp_path, "FOO", [C(0, 100)], stamp="2020-01-01")
    cached = study.load_candles(tmp_path, "FOO", fetch_fn=fetch, offline=True)
    assert len(cached) == 1


def test_candle_cache_stale_refetches(tmp_path):
    calls = {"n": 0}

    def fetch(symbol, resolution, range_from, range_to):
        calls["n"] += 1
        return [raw_row(i, 100) for i in range(3)]

    study.load_candles(tmp_path, "FOO", fetch_fn=fetch, today="2026-09-29")
    study.load_candles(tmp_path, "FOO", fetch_fn=fetch, today="2026-09-30")
    assert calls["n"] == 2  # new IST day -> refetch


def test_cached_provider_roundtrip(tmp_path):
    study.write_cached_candles(tmp_path, "NSE:FOO-EQ", [C(0, 100)], provider="upstox")
    assert study.cached_provider(tmp_path, "NSE:FOO-EQ") == "upstox"
    assert study.cached_provider(tmp_path, "NSE:MISSING-EQ") is None
    study.write_cached_candles(tmp_path, "NSE:BAR-EQ", [C(0, 100)])
    assert study.cached_provider(tmp_path, "NSE:BAR-EQ") is None


# ---------------------------------------------------------------------------
# cohort reader + gate
# ---------------------------------------------------------------------------


def test_captured_deals_empty_dir_is_empty(tmp_path):
    assert study.read_captured_deals(tmp_path) == []
    assert study.read_captured_deals(tmp_path / "does-not-exist") == []


def test_qualifying_filter_excludes_false_and_bad_side():
    deals = [
        {"symbol": "AAA", "qualifying": True, "side": "BUY"},
        {"symbol": "BBB", "qualifying": False, "side": "BUY"},
        {"symbol": "CCC", "qualifying": True, "side": "SELL"},
        {"symbol": "DDD", "qualifying": True, "side": "BUY"},
        {"symbol": "EEE", "side": "BUY"},  # missing qualifying
        "not-a-dict",
    ]
    out = study.qualifying_events(deals)
    assert [d["symbol"] for d in out] == ["AAA", "DDD"]


def test_read_captured_deals_skips_malformed(tmp_path):
    day_dir = tmp_path / "bulk_deals"
    day_dir.mkdir()
    (day_dir / "2026-09-30.jsonl").write_text(
        '{"symbol":"AAA","qualifying":true,"side":"BUY"}\n'
        '\n'
        'not json\n'
        '["a","list"]\n'
        '{"symbol":"BBB","qualifying":false,"side":"BUY"}\n',
        encoding="utf-8",
    )
    deals = study.read_captured_deals(day_dir)
    assert [d["symbol"] for d in deals] == ["AAA", "BBB"]
    assert [d["symbol"] for d in study.qualifying_events(deals)] == ["AAA"]


def test_cohort_empty_is_insufficient_sample():
    def fetch(symbol, resolution, range_from, range_to):
        raise AssertionError("no qualifying events -> no fetch")

    coh = study.build_cohort(root=None, fetch_fn=fetch, deals_root="/tmp/does-not-exist-bds")
    assert coh["n_deals"] == 0
    assert coh["n_qualifying"] == 0
    assert coh["n_scored"] == 0
    assert "insufficient sample" in coh["verdict"]


def test_stats_gate_withholds_expectancy_below_min_sample():
    low = study._stats([1.0, 2.0, 3.0], min_sample=20)
    assert low["n"] == 3
    assert low["expectancy"] is None
    assert low["insufficient"] is True
    assert "insufficient sample" in low["note"]
    assert low["mean"] == pytest.approx(2.0)  # descriptive stats still visible

    high = study._stats([1.0] * 20, min_sample=20)
    assert high["expectancy"] == pytest.approx(1.0)
    assert high["insufficient"] is False


def test_summarize_reports_n_per_horizon():
    rows = [
        {"ret_1": 1.0, "ret_5": 2.0, "ret_10": 3.0, "ret_20": 4.0,
         "mae_20": -2.0, "mfe_20": 5.0},
        {"ret_1": -1.0, "ret_5": None, "ret_10": None, "ret_20": None,
         "mae_20": -1.0, "mfe_20": 2.0},
    ]
    s = study.summarize(rows)
    assert s["n"] == 2
    assert s["ret_1"]["n"] == 2
    assert s["ret_5"]["n"] == 1
    assert s["ret_5"]["expectancy"] is None  # n < 20


# ---------------------------------------------------------------------------
# JSON safety + no-live-writes guard
# ---------------------------------------------------------------------------


def test_json_safe_nan_and_inf_become_none():
    safe = study._json_safe({"a": float("nan"), "b": float("inf"), "c": [1.0, float("-inf")]})
    assert safe == {"a": None, "b": None, "c": [1.0, None]}
    # Round-trips through json without NaN tokens.
    text = json.dumps(safe)
    assert "NaN" not in text and "Infinity" not in text


def test_pytest_study_root_redirects_live_defaults():
    root = study._pytest_study_root()
    assert root is not None
    assert "india_board_test_bulk_deal_study" in str(root)
    # Even when a caller omits root, the live tree is never the write target.
    assert study.data_root() == root
    assert study.data_root(None) == root


def test_parse_candles_and_date_conversion():
    rows = [raw_row(0, 100, volume=500), ["bad"], [1, 2, 3]]
    candles = study.parse_candles(rows)
    assert len(candles) == 1
    assert candles[0]["close"] == 100.0
    assert candles[0]["volume"] == 500.0
    assert candles[0]["date"] == BASE.date().isoformat()


def test_top_volume_days_needs_full_window():
    # 25 varied sessions then a volume spike on the last day.
    closes = [100] * 25 + [105]
    candles = [
        C(i, c, volume=(1000 + (i % 5) * 10) if i < 25 else 9000)
        for i, c in enumerate(closes)
    ]
    top = study.top_volume_days(candles, today=candles[-1]["date"])
    assert top and top[0] == 25
    # A spike that lacks a full 20-session trailing window is not selectable.
    short = [C(i, 100, volume=9000 if i == 5 else 1000) for i in range(8)]
    assert study.top_volume_days(short, today=short[-1]["date"]) == []


def test_sample_sessions_deterministic_and_forward_window():
    candles = [C(i, 100) for i in range(50)]
    a = study.sample_sessions(candles, k=5, seed=1)
    b = study.sample_sessions(candles, k=5, seed=1)
    assert a == b and len(a) == 5
    assert all(i + 20 < len(candles) for i in a)  # full forward window only
    assert study.sample_sessions([C(i, 100) for i in range(5)], k=5) == []


def test_render_study_md_keeps_honesty_sections():
    result = {
        "generated_at": "2026-09-30T00:00:00+05:30",
        "window": {"from": "2026-01-01", "to": "2026-09-30"},
        "sources": [{"source": "NSE", "status": 503, "rows": 0, "note": "HTTP 503"}],
        "examples": [],
        "variants": {},
        "cohort": None,
        "controls": None,
    }
    md = study.render_study_md(result)
    # No-archive honesty notice survives (a 503 must not read as "archive available").
    assert "No official bulk-deal archive was reachable" in md
    assert "Official archive available" not in md
    assert "What is proven vs unproven" in md
    assert "What we would need for a real event study" in md
    assert "not be read as expectancy" in md
