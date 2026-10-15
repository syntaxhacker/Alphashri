"""Unit tests for the NSE tape + opportunities diff in ``scan_data``.

Pure/offline: no network, no Fyers client. Only the diff + ranking +
persistence helpers are exercised (``_diff_window``, ``_build_state``,
``_persist_state`` / ``_hydrate_state`` and the small score helper).

``scan_data`` lives in ``india_board/scripts`` (not a package), so the test
adds that directory to ``sys.path`` before importing it.
"""
import json
import math
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "india_board" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import scan_data  # noqa: E402

TS = "2026-09-29T10:00:00+05:30"
WINDOW = 300
BASE_EPOCH = 1_800_000_000.0


# ---------------------------------------------------------------------------
# Helpers — build raw strikes lists + state dicts without any network.
# ---------------------------------------------------------------------------

def _strikes(strike=100.0, **kw):
    """One raw strike leg with explicit per-side values (defaults 0)."""
    return [{
        "strike": strike,
        "ce_vol": kw.get("ce_vol", 0.0),
        "ce_ltp": kw.get("ce_ltp", 0.0),
        "ce_oi": kw.get("ce_oi", 0.0),
        "ce_oich": kw.get("ce_oich", 0.0),
        "pe_vol": kw.get("pe_vol", 0.0),
        "pe_ltp": kw.get("pe_ltp", 0.0),
        "pe_oi": kw.get("pe_oi", 0.0),
        "pe_oich": kw.get("pe_oich", 0.0),
    }]


def _state(ts_epoch, tickers):
    """``tickers`` = list of ``(ticker, expiry, strikes)`` tuples."""
    return scan_data._build_state(tickers, TS, ts_epoch)


def _one(ticker, expiry, strikes, ts_epoch):
    return _state(ts_epoch, [(ticker, expiry, strikes)])


@pytest.fixture(autouse=True)
def _reset_prev_state():
    """Never leak the module-global baseline across tests."""
    saved = scan_data._PREV_STATE
    yield
    scan_data._PREV_STATE = saved


# ---------------------------------------------------------------------------
# (a) Δvolume × LTP math + descending top-N ranking
# ---------------------------------------------------------------------------

def test_tape_premium_math_and_descending_rank():
    prev = _state(BASE_EPOCH, [
        ("RELIANCE", "29-09-2026", _strikes(1300.0, ce_vol=1000.0, ce_ltp=10.0,
                                            ce_oi=5000.0, ce_oich=200.0)),
        ("TCS", "29-09-2026", _strikes(3100.0, pe_vol=2000.0, pe_ltp=30.0,
                                       pe_oi=1000.0, pe_oich=100.0)),
    ])
    cur = _state(BASE_EPOCH + WINDOW, [
        ("RELIANCE", "29-09-2026", _strikes(1300.0, ce_vol=1500.0, ce_ltp=12.0,
                                            ce_oi=5000.0, ce_oich=12000.0)),
        ("TCS", "29-09-2026", _strikes(3100.0, pe_vol=2600.0, pe_ltp=30.0,
                                       pe_oi=1000.0, pe_oich=85000.0)),
    ])

    tape, opps = scan_data._diff_window(prev, cur, TS, WINDOW)

    assert tape["status"] == "ok"
    assert tape["window_sec"] == WINDOW
    assert [r["ticker"] for r in tape["rows"]] == ["TCS", "RELIANCE"]

    tcs, rel = tape["rows"]
    # TCS PE: Δvol 600 × LTP 30 = 18000. RELIANCE CE: Δvol 500 × LTP 12 = 6000.
    assert tcs["side"] == "PE" and tcs["strike"] == 3100.0
    assert tcs["premium"] == pytest.approx(18000.0)
    assert tcs["volume"] == pytest.approx(600.0)
    assert tcs["oi_change"] == pytest.approx(85000.0)
    assert tcs["ltp"] == pytest.approx(30.0)
    assert tcs["expiry"] == "29-09-2026"
    assert tcs["ts"] == TS

    assert rel["side"] == "CE" and rel["strike"] == 1300.0
    assert rel["premium"] == pytest.approx(6000.0)
    assert rel["volume"] == pytest.approx(500.0)
    assert rel["oi_change"] == pytest.approx(12000.0)
    assert rel["ltp"] == pytest.approx(12.0)


def test_tape_caps_at_top_12_by_premium():
    prev_tickers = []
    cur_tickers = []
    for i in range(15):
        prev_tickers.append((f"T{i}", "E", _strikes(100.0 + i, ce_vol=100.0,
                                                     ce_ltp=10.0)))
        # premium increases with i -> top 12 are T14..T3
        cur_tickers.append((f"T{i}", "E", _strikes(100.0 + i, ce_vol=100.0 + i,
                                                   ce_ltp=10.0)))
    tape, _ = scan_data._diff_window(
        _state(BASE_EPOCH, prev_tickers),
        _state(BASE_EPOCH + WINDOW, cur_tickers),
        TS, WINDOW,
    )
    assert len(tape["rows"]) == scan_data.TAPE_LIMIT == 12
    assert tape["rows"][0]["ticker"] == "T14"
    assert tape["rows"][-1]["ticker"] == "T3"


# ---------------------------------------------------------------------------
# (b) Δvolume <= 0 is skipped
# ---------------------------------------------------------------------------

def test_flat_or_negative_volume_delta_skipped():
    prev = _state(BASE_EPOCH, [
        ("A", "E", _strikes(100.0, ce_vol=1000.0, ce_ltp=10.0)),
        ("B", "E", _strikes(100.0, pe_vol=900.0, pe_ltp=5.0)),
    ])
    cur = _state(BASE_EPOCH + WINDOW, [
        ("A", "E", _strikes(100.0, ce_vol=1000.0, ce_ltp=10.0)),   # delta 0
        ("B", "E", _strikes(100.0, pe_vol=800.0, pe_ltp=5.0)),     # delta < 0
    ])
    tape, opps = scan_data._diff_window(prev, cur, TS, WINDOW)
    assert tape["status"] == "ok"
    assert tape["rows"] == []
    assert opps["rows"] == []


# ---------------------------------------------------------------------------
# (c) first scan / missing baseline -> warming_up, empty rows
# ---------------------------------------------------------------------------

def test_missing_baseline_is_warming_up():
    cur = _one("RELIANCE", "E", _strikes(100.0, ce_vol=1000.0, ce_ltp=10.0),
               BASE_EPOCH)
    tape, opps = scan_data._diff_window(None, cur, TS, WINDOW)

    assert tape["status"] == "warming_up"
    assert tape["rows"] == []
    assert tape["window_sec"] == WINDOW
    assert opps["status"] == "warming_up"
    assert opps["rows"] == []


def test_empty_tickers_baseline_is_warming_up():
    empty = _state(BASE_EPOCH, [])
    cur = _state(BASE_EPOCH + WINDOW,
                 [("A", "E", _strikes(100.0, ce_vol=10.0, ce_ltp=1.0))])
    tape, _ = scan_data._diff_window(empty, cur, TS, WINDOW)
    assert tape["status"] == "warming_up"
    assert tape["rows"] == []


# ---------------------------------------------------------------------------
# (d) expiry change -> that ticker contributes nothing
# ---------------------------------------------------------------------------

def test_expiry_change_skips_ticker():
    prev = _one("RELIANCE", "29-09-2026",
                _strikes(1300.0, ce_vol=1000.0, ce_ltp=10.0), BASE_EPOCH)
    cur = _one("RELIANCE", "06-10-2026",
               _strikes(1300.0, ce_vol=1500.0, ce_ltp=12.0), BASE_EPOCH + WINDOW)
    tape, _ = scan_data._diff_window(prev, cur, TS, WINDOW)
    # Baseline is fresh so status is ok, but the rolled contract yields no rows.
    assert tape["status"] == "ok"
    assert tape["rows"] == []


# ---------------------------------------------------------------------------
# (e) strike absent from previous scan -> skipped
# ---------------------------------------------------------------------------

def test_new_strike_skipped_but_known_strike_reported():
    prev = _one("RELIANCE", "E",
                _strikes(1300.0, ce_vol=1000.0, ce_ltp=10.0), BASE_EPOCH)
    cur = _state(BASE_EPOCH + WINDOW, [
        ("RELIANCE", "E", _strikes(1300.0, ce_vol=1100.0, ce_ltp=10.0)
         + _strikes(1400.0, ce_vol=500.0, ce_ltp=8.0)),  # 1400 is brand new
    ])
    tape, _ = scan_data._diff_window(prev, cur, TS, WINDOW)
    assert [r["strike"] for r in tape["rows"]] == [1300.0]
    assert tape["rows"][0]["premium"] == pytest.approx(100.0 * 10.0)


# ---------------------------------------------------------------------------
# (f) persist -> hydrate round trip; corrupt/missing JSON ignored
# ---------------------------------------------------------------------------

def test_state_persist_hydrate_round_trip(tmp_path):
    state = _state(BASE_EPOCH, [
        ("RELIANCE", "E", _strikes(1300.0, ce_vol=1000.0, ce_ltp=10.0,
                                   ce_oi=5.0, ce_oich=2.0)),
    ])
    assert scan_data._persist_state(state, root=tmp_path) is True
    assert (tmp_path / "strike_state.json").is_file()

    scan_data._PREV_STATE = None
    restored = scan_data._hydrate_state(root=tmp_path)
    assert restored == state
    assert scan_data._PREV_STATE == state


def test_hydrate_missing_file_is_none(tmp_path):
    assert scan_data._hydrate_state(root=tmp_path) is None


def test_hydrate_corrupt_json_ignored(tmp_path):
    (tmp_path / "strike_state.json").write_text("{not valid json", encoding="utf-8")
    scan_data._PREV_STATE = "sentinel"
    assert scan_data._hydrate_state(root=tmp_path) is None
    # untouched on failure
    assert scan_data._PREV_STATE == "sentinel"


def test_hydrate_non_dict_without_tickers_ignored(tmp_path):
    (tmp_path / "strike_state.json").write_text(
        json.dumps({"nope": 1}), encoding="utf-8")
    assert scan_data._hydrate_state(root=tmp_path) is None


# ---------------------------------------------------------------------------
# (g) stale baseline (> 3x interval) -> warming_up
# ---------------------------------------------------------------------------

def test_stale_baseline_is_warming_up():
    prev = _one("A", "E", _strikes(100.0, ce_vol=1000.0, ce_ltp=10.0),
                BASE_EPOCH)
    cur = _one("A", "E", _strikes(100.0, ce_vol=1500.0, ce_ltp=10.0),
               BASE_EPOCH + 4 * WINDOW)  # 4x interval > 3x
    tape, opps = scan_data._diff_window(prev, cur, TS, WINDOW)
    assert tape["status"] == "warming_up"
    assert tape["rows"] == []
    assert opps["status"] == "warming_up"


def test_fresh_baseline_just_inside_3x_is_ok():
    prev = _one("A", "E", _strikes(100.0, ce_vol=1000.0, ce_ltp=10.0),
                BASE_EPOCH)
    cur = _one("A", "E", _strikes(100.0, ce_vol=1500.0, ce_ltp=10.0),
               BASE_EPOCH + 2.9 * WINDOW)
    tape, _ = scan_data._diff_window(prev, cur, TS, WINDOW)
    assert tape["status"] == "ok"
    assert len(tape["rows"]) == 1


def test_baseline_exactly_3x_is_not_stale():
    # "older than 3x" — exactly 3x is still a usable baseline.
    prev = _one("A", "E", _strikes(100.0, ce_vol=1000.0, ce_ltp=10.0),
                BASE_EPOCH)
    cur = _one("A", "E", _strikes(100.0, ce_vol=1500.0, ce_ltp=10.0),
               BASE_EPOCH + 3.0 * WINDOW)
    assert scan_data._baseline_missing_or_stale(prev, cur, WINDOW) is False
    tape, _ = scan_data._diff_window(prev, cur, TS, WINDOW)
    assert tape["status"] == "ok"


# ---------------------------------------------------------------------------
# (h) opportunities filter + score ordering
# ---------------------------------------------------------------------------

def test_opportunities_filter_and_score_ordering():
    # A: oi=1000 oich=500 -> ratio .5;  premium 1000 -> score .5*log1p(1000)
    # B: oi=1000 oich=100 -> ratio .1;  premium 1000 -> score .1*log1p(1000)
    # C: oich=0 -> excluded from opportunities (still on the tape)
    prev = _state(BASE_EPOCH, [
        ("A", "E", _strikes(100.0, ce_vol=0.0, ce_ltp=10.0)),
        ("B", "E", _strikes(100.0, ce_vol=0.0, ce_ltp=10.0)),
        ("C", "E", _strikes(100.0, ce_vol=0.0, ce_ltp=10.0)),
    ])
    cur = _state(BASE_EPOCH + WINDOW, [
        ("A", "E", _strikes(100.0, ce_vol=100.0, ce_ltp=10.0,
                            ce_oi=1000.0, ce_oich=500.0)),
        ("B", "E", _strikes(100.0, ce_vol=100.0, ce_ltp=10.0,
                            ce_oi=1000.0, ce_oich=100.0)),
        ("C", "E", _strikes(100.0, ce_vol=100.0, ce_ltp=10.0,
                            ce_oi=1000.0, ce_oich=0.0)),
    ])
    tape, opps = scan_data._diff_window(prev, cur, TS, WINDOW)

    assert len(tape["rows"]) == 3  # C is a valid print even with oich == 0
    assert {r["ticker"] for r in opps["rows"]} == {"A", "B"}
    assert [r["ticker"] for r in opps["rows"]] == ["A", "B"]

    top = opps["rows"][0]
    assert top["ratio"] == pytest.approx(0.5)
    assert top["premium"] == pytest.approx(1000.0)
    assert top["score"] == pytest.approx(0.5 * math.log1p(1000.0))
    assert opps["rows"][1]["score"] < top["score"]


def test_opportunity_ratio_uses_max_oi_one():
    # oi == 0 -> ratio = |oich| / 1
    prev = _one("A", "E", _strikes(100.0, ce_vol=0.0, ce_ltp=1.0), BASE_EPOCH)
    cur = _one("A", "E", _strikes(100.0, ce_vol=10.0, ce_ltp=1.0,
                                  ce_oi=0.0, ce_oich=7.0),
               BASE_EPOCH + WINDOW)
    _, opps = scan_data._diff_window(prev, cur, TS, WINDOW)
    assert opps["rows"][0]["ratio"] == pytest.approx(7.0)


def test_score_helper_clamps_negatives():
    assert scan_data._score_opportunity(-1.0, 100.0) == pytest.approx(0.0)
    assert scan_data._score_opportunity(1.0, -100.0) == pytest.approx(0.0)
    assert scan_data._score_opportunity(None, None) == pytest.approx(0.0)
