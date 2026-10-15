"""Unit tests for india_board/scripts/eval_harness.py (no network).

Synthetic candle series only. Covers forward_return boundaries, stop/target
ordering, R multiple maths (LONG/SHORT, CE/PE sign), MAE/MFE, evaluate
aggregation (exact expectancy), feature ablation, the injected-history disk
path (caching + failure skipping), and report rendering.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from india_board.scripts import eval_harness, signal_log

IST = ZoneInfo("Asia/Kolkata")
#: Fixed entry instant so candle epochs are deterministic (2026-09-28 10:00 IST).
BASE_DT = datetime(2026, 9, 28, 10, 0, tzinfo=IST)
BASE = BASE_DT.timestamp()
DAY = "2026-09-28"


def row(off_min: float, o, h, l, c, base: float = BASE) -> list:
    """One Fyers-style candle row ``[epoch, o, h, l, c, volume]``."""
    return [base + off_min * 60.0, o, h, l, c, 1000]


def ts(base: float = BASE) -> str:
    return datetime.fromtimestamp(base, tz=IST).isoformat()


def sig(
    *,
    playbook: str = "P1",
    ticker: str = "RELIANCE",
    side: str = "LONG",
    entry: float | None = 100.0,
    stop: float | None = 95.0,
    target: float | None = 110.0,
    features: dict | None = None,
    signal_id: str = "s1",
    when: str | None = None,
) -> dict:
    return {
        "signal_id": signal_id,
        "ts": when or ts(),
        "playbook": playbook,
        "ticker": ticker,
        "side": side,
        "features": features or {},
        "entry_ref": entry,
        "stop_ref": stop,
        "target_ref": target,
    }


# ---------------------------------------------------------------------------
# forward_return
# ---------------------------------------------------------------------------


def test_forward_return_exact_boundaries():
    candles = [
        row(0, 100, 101, 99, 100),
        row(5, 100, 102, 99, 105),
        row(10, 105, 106, 104, 110),
    ]
    assert eval_harness.forward_return(100, candles, 0) == 0.0
    assert eval_harness.forward_return(100, candles, 5) == 5.0
    assert eval_harness.forward_return(100, candles, 10) == 10.0
    # 7 min -> first candle at/after +420s is the +10 min candle.
    assert eval_harness.forward_return(100, candles, 7) == 10.0


def test_forward_return_not_enough_candles_is_none():
    candles = [row(0, 100, 101, 99, 100), row(5, 100, 102, 99, 105)]
    assert eval_harness.forward_return(100, candles, 15) is None
    assert eval_harness.forward_return(100, [], 5) is None
    assert eval_harness.forward_return(None, candles, 5) is None
    assert eval_harness.forward_return(0, candles, 5) is None


def test_eod_return_uses_last_close():
    candles = [row(0, 100, 101, 99, 100), row(5, 100, 102, 99, 108)]
    assert eval_harness.eod_return(100, candles) == 8.0
    assert eval_harness.eod_return(100, []) is None


def test_mae_mfe():
    candles = [row(0, 100, 101, 97, 100), row(5, 100, 112, 99, 108)]
    # MAE uses min low (97), MFE uses max high (112).
    assert eval_harness.max_adverse_excursion(100, candles) == pytest.approx(-3.0)
    assert eval_harness.max_favourable_excursion(100, candles) == pytest.approx(12.0)
    assert eval_harness.max_adverse_excursion(100, []) is None
    assert eval_harness.max_favourable_excursion(100, []) is None


# ---------------------------------------------------------------------------
# stop / target ordering + R maths
# ---------------------------------------------------------------------------


def test_stop_touched_before_target_long():
    candles = [row(0, 100, 101, 99, 100), row(5, 96, 101, 94, 96)]
    out = eval_harness.score_signal(sig(side="LONG"), candles)
    assert out["outcome"] == "stop"
    assert out["exit_ref"] == 95.0
    assert out["r_multiple"] == pytest.approx(-1.0)
    assert out["realized_pct"] == pytest.approx(-5.0)
    assert out["mae"] == pytest.approx(-6.0)
    assert out["mfe"] == pytest.approx(1.0)


def test_target_touched_before_stop_long():
    candles = [row(0, 100, 101, 99, 100), row(5, 110, 111, 99, 110)]
    out = eval_harness.score_signal(sig(side="LONG"), candles)
    assert out["outcome"] == "target"
    assert out["exit_ref"] == 110.0
    assert out["r_multiple"] == pytest.approx(2.0)
    assert out["realized_pct"] == pytest.approx(10.0)


def test_stop_wins_when_single_candle_straddles_both():
    candles = [row(0, 100, 100, 100, 100), row(5, 100, 111, 89, 100)]
    out = eval_harness.score_signal(sig(side="LONG"), candles)
    assert out["outcome"] == "stop"
    assert out["r_multiple"] == pytest.approx(-1.0)


def test_short_stop_and_target_r_maths():
    stop_candles = [row(0, 100, 100, 100, 100), row(5, 104, 106, 100, 105)]
    out = eval_harness.score_signal(sig(side="SHORT", stop=105, target=90), stop_candles)
    assert out["outcome"] == "stop"
    assert out["exit_ref"] == 105.0
    assert out["r_multiple"] == pytest.approx(-1.0)
    assert out["realized_pct"] == pytest.approx(-5.0)

    target_candles = [row(0, 100, 100, 100, 100), row(5, 95, 96, 89, 90)]
    out = eval_harness.score_signal(sig(side="SHORT", stop=105, target=90), target_candles)
    assert out["outcome"] == "target"
    assert out["exit_ref"] == 90.0
    assert out["r_multiple"] == pytest.approx(2.0)
    assert out["realized_pct"] == pytest.approx(10.0)


def test_timeout_exits_at_last_close():
    candles = [row(0, 100, 101, 99, 100), row(5, 101, 103, 100, 102)]
    out = eval_harness.score_signal(sig(side="LONG"), candles)
    assert out["outcome"] == "timeout"
    assert out["exit_ref"] == 102.0
    assert out["r_multiple"] == pytest.approx(0.4)
    assert out["realized_pct"] == pytest.approx(2.0)


def test_ce_pe_signed_return_and_sign_handling():
    assert eval_harness.signed_return("CE", 3.0) == 3.0
    assert eval_harness.signed_return("LONG", 3.0) == 3.0
    assert eval_harness.signed_return("PE", 3.0) == -3.0
    assert eval_harness.signed_return("SHORT", 3.0) == -3.0
    assert eval_harness.signed_return("NA", 3.0) == 3.0
    assert eval_harness.signed_return("PE", None) is None

    # A bearish PE leg profits when price falls: positive realized_pct.
    down = [row(0, 100, 100, 100, 100), row(5, 95, 96, 94, 95)]
    out = eval_harness.score_signal(sig(side="PE", stop=105, target=90), down)
    assert out["outcome"] == "timeout"
    assert out["realized_pct"] == pytest.approx(5.0)  # -1 * (-5%)


def test_na_side_infers_direction_from_stop():
    candles = [row(0, 100, 100, 99, 100), row(5, 96, 101, 94, 96)]
    out = eval_harness.score_signal(sig(side="NA", stop=95, target=110), candles)
    assert out["outcome"] == "stop"
    assert out["r_multiple"] == pytest.approx(-1.0)


def test_score_signal_trims_to_entry_ts_and_reports_none_without_candles():
    candles = [row(-30, 100, 100, 100, 100), row(0, 100, 101, 99, 100), row(5, 105, 106, 104, 105)]
    out = eval_harness.score_signal(sig(side="LONG"), candles)
    # The -30 min candle is before the signal and must not be used.
    assert out["n_candles"] == 2
    assert out["mae"] == pytest.approx(-1.0)

    empty = eval_harness.score_signal(sig(side="LONG"), [])
    assert empty["outcome"] is None
    assert empty["r_multiple"] is None
    assert empty["fwd_15"] is None


# ---------------------------------------------------------------------------
# evaluate aggregation (hand-computed)
# ---------------------------------------------------------------------------


def test_evaluate_tiny_set_exact_expectancy():
    signals = [
        sig(ticker="AAA", signal_id="a"),
        sig(ticker="BBB", signal_id="b"),
    ]
    candles_by_ticker = {
        "AAA": [row(0, 100, 100, 99, 100), row(5, 96, 101, 94, 96)],   # stop -1R / -5%
        "BBB": [row(0, 100, 101, 99, 100), row(5, 110, 111, 99, 110)],  # target +2R / +10%
    }
    result = eval_harness.evaluate(signals, candles_by_ticker)

    assert result["n"] == 2
    agg = result["playbooks"]["P1"]
    assert agg["n"] == 2
    assert agg["hit_rate"] == pytest.approx(0.5)
    assert agg["avg_R"] == pytest.approx(0.5)
    assert agg["median_R"] == pytest.approx(0.5)
    assert agg["expectancy"] == pytest.approx(2.5)  # mean(-5, +10)
    assert agg["target_rate"] == pytest.approx(0.5)
    assert result["overall"]["avg_R"] == pytest.approx(0.5)


def test_evaluate_without_candles_yields_unscored_signal():
    result = eval_harness.evaluate([sig(ticker="AAA")], {})
    assert result["n"] == 1
    assert result["playbooks"]["P1"]["n"] == 1
    assert result["playbooks"]["P1"]["avg_R"] is None
    assert result["overall"]["expectancy"] is None


# ---------------------------------------------------------------------------
# feature ablation
# ---------------------------------------------------------------------------


def _ablation_signals():
    """Four long timeout signals whose realized % equals their index."""
    signals, candles = [], {}
    spreads = [5.0, 10.0, 15.0, 20.0]
    for i, spread in enumerate(spreads):
        ticker = f"T{i}"
        signals.append(sig(ticker=ticker, stop=None, target=None,
                           features={"spread_bp": spread}, signal_id=f"s{i}"))
        candles[ticker] = [row(0, 100, 100, 100, 100), row(5, 100, 100, 100, 100 + i)]
    return signals, candles


def test_ablation_splits_by_feature_quantile():
    signals, candles = _ablation_signals()
    result = eval_harness.evaluate(signals, candles, min_sample=2, n_groups=2)

    abl = result["ablation"]["spread_bp"]
    assert abl is not None
    assert abl["n"] == 4
    assert [b["n"] for b in abl["buckets"]] == [2, 2]
    # Low-spread half (5, 10) realized 0%/1% -> 0.5%; high half (15, 20) -> 2.5%.
    assert abl["buckets"][0]["expectancy"] == pytest.approx(0.5)
    assert abl["buckets"][1]["expectancy"] == pytest.approx(2.5)
    assert abl["buckets"][0]["lo"] == 5.0
    assert abl["buckets"][1]["hi"] == 20.0


def test_ablation_refuses_below_min_sample():
    signals, candles = _ablation_signals()
    result = eval_harness.evaluate(signals, candles, min_sample=5, n_groups=2)
    assert result["ablation"]["spread_bp"] is None


def test_ablation_ignores_non_numeric_features():
    signals, candles = _ablation_signals()
    for s in signals:
        s["features"]["label"] = "abc"
        s["features"]["flag"] = True
    result = eval_harness.evaluate(signals, candles, min_sample=2, n_groups=2)
    assert "label" not in result["ablation"]
    assert "flag" not in result["ablation"]


# ---------------------------------------------------------------------------
# evaluate_from_disk (injected history, caching, failure skipping)
# ---------------------------------------------------------------------------


def _log(root, ticker, *, side="LONG", entry=100.0, stop=95.0, target=110.0, when=None):
    rec = {
        "ts": when or ts(),
        "playbook": "P1",
        "ticker": ticker,
        "side": side,
        "features": {"spread_bp": 10.0},
        "entry_ref": entry,
        "stop_ref": stop,
        "target_ref": target,
    }
    return signal_log.log_signal(rec, root=root)


def test_evaluate_from_disk_caches_and_skips_failures(tmp_path):
    _log(tmp_path, "RELIANCE")
    _log(tmp_path, "RELIANCE")       # same ticker/day -> must reuse cache
    _log(tmp_path, "BADNAME")

    calls: dict[str, int] = {}

    def history_fn(symbol, resolution, range_from, range_to):
        calls[symbol] = calls.get(symbol, 0) + 1
        if "BADNAME" in symbol:
            raise RuntimeError("boom")
        return [row(0, 100, 100, 99, 100), row(5, 110, 111, 99, 110)]

    result = eval_harness.evaluate_from_disk(
        DAY, root=tmp_path, history_fn=history_fn, min_sample=2
    )

    assert result["n"] == 2
    assert result["skipped"] == 1
    # RELIANCE fetched once despite two signals; BADNAME attempted once then skipped.
    assert calls == {"NSE:RELIANCE-EQ": 1, "NSE:BADNAME-EQ": 1}
    assert result["playbooks"]["P1"]["avg_R"] == pytest.approx(2.0)


def test_evaluate_from_disk_uses_index_map(tmp_path):
    _log(tmp_path, "NIFTY")
    seen: list[str] = []

    def history_fn(symbol, resolution, range_from, range_to):
        seen.append(symbol)
        return [row(0, 100, 100, 99, 100), row(5, 100, 101, 99, 105)]

    eval_harness.evaluate_from_disk(DAY, root=tmp_path, history_fn=history_fn)
    assert seen == ["NSE:NIFTY50-INDEX"]


# ---------------------------------------------------------------------------
# render_report
# ---------------------------------------------------------------------------


def test_render_report_contains_playbook_rows():
    signals = [sig(ticker="AAA", signal_id="a"), sig(ticker="BBB", signal_id="b")]
    candles = {
        "AAA": [row(0, 100, 100, 99, 100), row(5, 96, 101, 94, 96)],
        "BBB": [row(0, 100, 101, 99, 100), row(5, 110, 111, 99, 110)],
    }
    text = eval_harness.render_report(eval_harness.evaluate(signals, candles))
    assert "# Signal evaluation" in text
    assert "| P1 |" in text
    assert "hit_rate" in text
    assert "| ALL |" in text
    assert "## Feature ablation" in text
