"""Offline tests for the F9 breadth + per-row %change wiring in ``scan_data``.

Pure/offline: no network and no Fyers client. Only the injectable quote path is
exercised (``build_breadth`` / ``apply_chg_pct`` / the small coercion helpers),
so a fake ``quote_fn`` supplies every value.

``scan_data`` lives in ``india_board/scripts``; importing it as
``india_board.scripts.scan_data`` works via ``pythonpath = .`` (pytest.ini).
"""
from __future__ import annotations

import pytest

from india_board.scripts import scan_data


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _quote(chp, ltp=100.0):
    """One quote payload shaped like ``fyers_data.get_quotes`` values."""
    return {"ltp": ltp, "ch": chp, "chp": chp, "volume": None, "oi": None}


def _fake_quotes(payload, calls=None):
    """``quote_fn`` returning ``payload`` (symbol -> quote) and recording calls."""

    def fn(symbols):
        if calls is not None:
            calls.append(list(symbols))
        return {s: payload[s] for s in symbols if s in payload}

    return fn


# ---------------------------------------------------------------------------
# (a) counts + pct_advancing
# ---------------------------------------------------------------------------


def test_build_breadth_counts_advancers_decliners_unchanged():
    payload = {
        "A": _quote(1.25),
        "B": _quote(-0.40),
        "C": _quote(0.0),          # exactly flat -> unchanged
        "D": _quote(-2.0),
        "E": _quote(3.1),
    }
    out = scan_data.build_breadth(["A", "B", "C", "D", "E"], quote_fn=_fake_quotes(payload))

    assert out["advancers"] == 2
    assert out["decliners"] == 2
    assert out["unchanged"] == 1
    assert out["pct_advancing"] == pytest.approx(40.0)
    assert out["as_of"]


def test_build_breadth_ignores_missing_and_none_chp():
    payload = {
        "A": _quote(2.0),
        "B": _quote(None),         # chp present but unparseable -> ignored
        # "C" absent from the quote payload entirely -> ignored
    }
    out = scan_data.build_breadth(["A", "B", "C"], quote_fn=_fake_quotes(payload))

    assert out["advancers"] == 1
    assert out["decliners"] == 0
    assert out["unchanged"] == 0
    assert out["pct_advancing"] == pytest.approx(100.0)


def test_build_breadth_pct_none_when_total_zero():
    # No symbols at all.
    out = scan_data.build_breadth([], quote_fn=_fake_quotes({}))
    assert out["advancers"] == out["decliners"] == out["unchanged"] == 0
    assert out["pct_advancing"] is None

    # Symbols present but every chp unusable -> total 0 -> None.
    out2 = scan_data.build_breadth(
        ["A", "B"], quote_fn=_fake_quotes({"A": _quote(None), "B": _quote(None)})
    )
    assert out2["pct_advancing"] is None


def test_build_breadth_accepts_pairs_and_dedupes():
    payload = {"A": _quote(1.0), "B": _quote(-1.0)}
    out = scan_data.build_breadth(
        [("A", "NSE:A-EQ"), ("B", "NSE:B-EQ"), ("A", "NSE:A-EQ")],
        quote_fn=_fake_quotes(payload),
    )
    assert out["advancers"] == 1
    assert out["decliners"] == 1
    assert out["pct_advancing"] == pytest.approx(50.0)


# ---------------------------------------------------------------------------
# (b) batch splitting at the Fyers 50-symbol limit
# ---------------------------------------------------------------------------


def test_build_breadth_splits_into_batches_of_50():
    symbols = [f"S{i}" for i in range(120)]
    payload = {s: _quote(1.0 if i % 2 == 0 else -1.0) for i, s in enumerate(symbols)}
    calls: list[list[str]] = []

    out = scan_data.build_breadth(symbols, quote_fn=_fake_quotes(payload, calls))

    # 120 symbols -> 50 + 50 + 20 -> three calls.
    assert len(calls) == 3
    assert [len(c) for c in calls] == [50, 50, 20]
    assert out["advancers"] == 60
    assert out["decliners"] == 60
    assert out["pct_advancing"] == pytest.approx(50.0)


def test_build_breadth_single_call_for_50_or_fewer():
    symbols = [f"S{i}" for i in range(50)]
    payload = {s: _quote(-1.0) for s in symbols}
    calls: list[list[str]] = []
    scan_data.build_breadth(symbols, quote_fn=_fake_quotes(payload, calls))
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# (c) failures degrade, never raise
# ---------------------------------------------------------------------------


def test_build_breadth_quote_fn_raising_is_unavailable():
    def boom(symbols):
        raise RuntimeError("429 too many requests")

    out = scan_data.build_breadth(["A", "B", "C"], quote_fn=boom)
    assert out == {"unavailable": True}


def test_build_breadth_failure_on_second_batch_is_unavailable():
    calls: list[int] = []

    def flaky(symbols):
        calls.append(1)
        if len(calls) > 1:
            raise RuntimeError("network")
        return {s: _quote(1.0) for s in symbols}

    out = scan_data.build_breadth([f"S{i}" for i in range(120)], quote_fn=flaky)
    assert out == {"unavailable": True}
    assert len(calls) == 2  # first batch ok, second raises


# ---------------------------------------------------------------------------
# (d) per-row chg_pct injection
# ---------------------------------------------------------------------------


def test_apply_chg_pct_sets_value_and_none_for_missing():
    rows = [{"ticker": "A"}, {"ticker": "B"}, {"ticker": "C"}]
    quotes = {"A": _quote(1.5), "C": _quote(None)}  # B has no quote at all

    scan_data.apply_chg_pct(rows, quotes, True)

    assert rows[0]["chg_pct"] == pytest.approx(1.5)
    assert rows[1]["chg_pct"] is None   # no quote -> never fabricated
    assert rows[2]["chg_pct"] is None   # None chp -> never fabricated


def test_apply_chg_pct_not_ok_forces_all_none():
    rows = [{"ticker": "A"}]
    scan_data.apply_chg_pct(rows, {"A": _quote(9.9)}, False)
    assert rows[0]["chg_pct"] is None


def test_apply_chg_pct_tolerates_junk_rows():
    rows = [{"ticker": "A"}, "not-a-dict", None]
    scan_data.apply_chg_pct(rows, {"A": _quote(-2.0)}, True)
    assert rows[0]["chg_pct"] == pytest.approx(-2.0)
    assert rows[1] == "not-a-dict"
    assert rows[2] is None


# ---------------------------------------------------------------------------
# (e) _finalize carries the breadth section without breaking existing callers
# ---------------------------------------------------------------------------


def test_finalize_defaults_breadth_unavailable():
    payload = scan_data._finalize([], [], [], [], [])
    assert payload["sections"]["breadth"] == {"unavailable": True}


def test_finalize_accepts_breadth_kwarg():
    breadth = {"advancers": 3, "decliners": 1, "unchanged": 0,
               "pct_advancing": 75.0, "as_of": "2026-09-28T10:00:00+05:30"}
    payload = scan_data._finalize([], [], [], [], [], breadth=breadth)
    assert payload["sections"]["breadth"] == breadth


# ---------------------------------------------------------------------------
# (f) breadth rows — the UI's top/bottom-5 contract
# ---------------------------------------------------------------------------


def test_breadth_rows_sorted_and_skip_missing_chp():
    quotes = {
        "A": _quote(1.5),
        "B": _quote(-2.5),
        "C": {"ltp": 10.0},          # no chp -> skipped, never fabricated as 0
        "D": _quote(0.0),            # exactly flat still counts + appears
    }
    out = scan_data._breadth_from_quotes(["A", "B", "C", "D"], quotes)
    assert [r["ticker"] for r in out["rows"]] == ["A", "D", "B"]  # desc by chp
    assert all(set(r) == {"ticker", "chp"} for r in out["rows"])
    assert out["advancers"] == 1 and out["decliners"] == 1 and out["unchanged"] == 1


def test_breadth_rows_empty_when_no_usable_quotes():
    out = scan_data._breadth_from_quotes(["A"], {"A": {"ltp": 1.0}})
    assert out["rows"] == []
    assert out["pct_advancing"] is None
