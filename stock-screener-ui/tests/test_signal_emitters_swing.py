"""Offline tests for ``india_board/scripts/signal_emitters_swing.py`` (W3b).

No network, no Fyers client, no dashboard. Every external call is injected and
every disk write goes to ``tmp_path`` (``signal_log.DATA_DIR`` /
``rollover_data.DATA_DIR`` are monkeypatched). Covers the P5-P7 detectors, the
sector map fallback, the scan aggregation, the dedupe/re-emit ledger, and the
injectable ``run_once`` orchestration.
"""
from __future__ import annotations

import json
import types
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from india_board.scripts import rollover_data, signal_emitters_swing as swing
from india_board.scripts import signal_log

IST = ZoneInfo("Asia/Kolkata")
DAY = "2026-09-28"  # a Monday
NOW = datetime(2026, 9, 28, 10, 0, tzinfo=IST)


def _patch_all(name, attr, value, monkeypatch):
    """Patch ``attr`` on every ``sys.modules`` entry named ``name``.

    The India-board scripts are importable both flat (``signal_log``, for the
    modules under ``india_board/scripts``) and as a package
    (``india_board.scripts.signal_log``). Those are *two module objects* over
    one file, so a test must patch both or fixtures leak into the live archive.
    """
    import sys

    patched = set()
    for mod_name, mod in list(sys.modules.items()):
        if mod is None or not (mod_name == name or mod_name.endswith("." + name)):
            continue
        if id(mod) in patched:
            continue
        patched.add(id(mod))
        monkeypatch.setattr(mod, attr, value, raising=False)
    return patched


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """Every test writes signals/rollover into tmp_path and starts clean.

    Patching must hit **every** registered module object: the test imports
    ``india_board.scripts.signal_log`` while the emitters use the flat
    ``signal_log`` (same file, different ``sys.modules`` keys). Patching only
    one instance is how fixture values once leaked into the live archive.
    """
    import signal_log as _flat_signal_log  # noqa: F401  (pre-load both instances)
    import rollover_data as _flat_rollover  # noqa: F401
    from india_board.scripts import signal_log as _pkg_signal_log  # noqa: F401
    from india_board.scripts import rollover_data as _pkg_rollover  # noqa: F401

    _patch_all("signal_log", "DATA_DIR", tmp_path / "signals", monkeypatch)
    _patch_all("rollover_data", "DATA_DIR", tmp_path / "rollover", monkeypatch)
    for env_name in swing.SECTOR_MAP_ENVS:
        monkeypatch.delenv(env_name, raising=False)
    swing.reset_ledger()
    yield


# ---------------------------------------------------------------------------
# builders
# ---------------------------------------------------------------------------


def _rollover(*, pct=0.72, call=0.80, put=0.60, ticker="NIFTY",
              next_call=300.0, near_call=100.0):
    return {
        "ticker": ticker,
        "rollover_pct": pct,
        "rollover_pct_call": call,
        "rollover_pct_put": put,
        "near_expiry": "29-09-2026",
        "next_expiry": "06-10-2026",
        "near_dte": 1,
        "next_dte": 8,
        "spot": 22000.0,
        "strikes": [{
            "strike": 22000.0,
            "near_call_oi": near_call,
            "next_call_oi": next_call,
            "near_put_oi": near_call,
            "next_put_oi": next_call,
        }],
    }


def _basis(*, price=22050.0, basis=50.0, spot=22000.0, ts="2026-09-28T10:00:00+05:30",
           prev=None, ticker="NIFTY"):
    out = {
        "ticker": ticker,
        "spot": spot,
        "ts": ts,
        "near": {"price": price, "basis": basis, "annualized_basis": 55.0, "dte": 1},
    }
    if prev is not None:
        out["basis_prev"] = prev
    return out


def _iv(*, rr=0.03, atm_iv=0.18, ticker="NIFTY", as_of=DAY):
    return {"ticker": ticker, "atm_iv": atm_iv, "risk_reversal": rr,
            "butterfly": 0.01, "as_of": as_of}


def _vrp(*, verdict="EXPENSIVE", vrp=0.03, vrp_pct=3.0, hv20=0.15):
    return {"verdict": verdict, "vrp": vrp, "vrp_pct": vrp_pct, "hv20": hv20}


# ---------------------------------------------------------------------------
# P5 — rollover positional
# ---------------------------------------------------------------------------


def test_p5_fires_on_high_rollover_and_rising_basis():
    rec = swing.p5_rollover(_rollover(), _basis(prev=40.0))
    assert rec is not None
    assert rec["playbook"] == "P5"
    assert rec["ticker"] == "NIFTY"
    assert rec["side"] == "CE"  # call rollover (0.80) > put (0.60)
    assert rec["source"] == "rollover"
    assert rec["entry_ref"] == pytest.approx(22050.0)
    # risk = max(0.5*50, 0.004*22000) = max(25, 88) = 88
    assert rec["stop_ref"] == pytest.approx(22050.0 - 88.0)
    assert rec["target_ref"] == pytest.approx(22050.0 + 176.0)

    feats = rec["features"]
    assert feats["rollover_pct"] == pytest.approx(0.72)
    assert feats["basis"] == pytest.approx(50.0)
    assert feats["basis_prev"] == pytest.approx(40.0)
    assert feats["stop_basis"] == pytest.approx(50.0 - 88.0)
    assert feats["dte_near"] == 1 and feats["dte_next"] == 8
    # from the per-strike next-vs-near shift
    assert feats["next_oi_build"] == pytest.approx(200.0)


def test_p5_does_not_fire_on_falling_basis():
    assert swing.p5_rollover(_rollover(), _basis(basis=50.0, prev=60.0)) is None


def test_p5_does_not_fire_below_percentile_gate():
    assert swing.p5_rollover(_rollover(pct=0.40), _basis(prev=40.0)) is None
    # injected threshold: 0.72 clears 0.70
    assert swing.p5_rollover(_rollover(pct=0.72), _basis(prev=40.0),
                             pct_pctl=0.70) is not None
    assert swing.p5_rollover(_rollover(pct=0.72), _basis(prev=40.0),
                             pct_pctl=0.90) is None


def test_p5_side_falls_back_to_basis_direction():
    # Equal call/put rollover -> basis sign decides.
    rec = swing.p5_rollover(
        _rollover(call=0.50, put=0.50), _basis(basis=-30.0, prev=-40.0, price=21970.0)
    )
    assert rec is not None and rec["side"] == "PE"
    # PE stop is above entry, target below.
    assert rec["stop_ref"] > rec["entry_ref"] > rec["target_ref"]
    assert rec["features"]["stop_basis"] > rec["features"]["basis"]


def test_p5_next_chain_gate_blocks_without_build():
    # rollover strikes say no next-side build (next < near) -> gate blocks.
    roll = _rollover(next_call=50.0, near_call=500.0)
    basis = _basis(prev=40.0)
    next_chain = {"strikes": [{"strike": 22000.0, "ce_oi": 10.0}]}
    assert swing.p5_rollover(roll, basis, next_chain=next_chain) is None
    # Without next_chain the build requirement is skipped.
    assert swing.p5_rollover(roll, basis) is not None


def test_p5_uses_rollover_history_for_prev_basis(tmp_path):
    rec = {"ts": "2026-09-27T15:00:00+05:30", "ticker": "NIFTY", "spot": 21000.0,
           "basis": {"near": {"basis": 10.0}}, "rollover": None}
    assert rollover_data.persist(rec)  # default root == monkeypatched DATA_DIR
    # basis has no injected basis_prev -> read from history (10.0 < 50.0).
    out = swing.p5_rollover(_rollover(), _basis(basis=50.0))
    assert out is not None
    assert out["features"]["basis_prev"] == pytest.approx(10.0)


def test_p5_no_crash_when_history_empty(tmp_path):
    # No persisted captures at all -> cannot confirm rising -> None, no raise.
    assert swing.p5_rollover(_rollover(), _basis(basis=50.0)) is None


def test_p5_none_on_unavailable_inputs():
    assert swing.p5_rollover(None, None) is None
    assert swing.p5_rollover({"unavailable": True}, _basis(prev=1.0)) is None
    assert swing.p5_rollover({"ticker": "NIFTY", "rollover_pct": None},
                             _basis(prev=1.0)) is None


# ---------------------------------------------------------------------------
# P6 — VRP premium sale
# ---------------------------------------------------------------------------


def test_p6_fires_on_expensive_and_rich_skew():
    rec = swing.p6_vrp_premium(_iv(), _vrp())
    assert rec is not None
    assert rec["playbook"] == "P6"
    assert rec["side"] == "NA"
    assert rec["source"] == "greeks"
    # IV-point convention: entry = credit, target = half credit, stop = 2x.
    assert rec["entry_ref"] == pytest.approx(3.0)
    assert rec["target_ref"] == pytest.approx(1.5)
    assert rec["stop_ref"] == pytest.approx(6.0)

    feats = rec["features"]
    assert feats["atm_iv"] == pytest.approx(0.18)
    assert feats["hv20"] == pytest.approx(0.15)
    assert feats["vrp"] == pytest.approx(0.03)
    assert feats["vrp_pct"] == pytest.approx(3.0)
    assert feats["risk_reversal"] == pytest.approx(0.03)
    assert feats["butterfly"] == pytest.approx(0.01)
    assert feats["verdict"] == "EXPENSIVE"
    assert feats["skew_rich"] is True
    assert feats["event_check"] == "unknown"  # events not supplied


@pytest.mark.parametrize("verdict", ["CHEAP", "FAIR", "UNKNOWN"])
def test_p6_not_fired_on_non_expensive(verdict):
    assert swing.p6_vrp_premium(_iv(), _vrp(verdict=verdict)) is None


def test_p6_skew_rule_and_override():
    # rr magnitude below 1 vol point -> not rich -> suppressed.
    assert swing.p6_vrp_premium(_iv(rr=0.005), _vrp()) is None
    # see-saw both ways: a call-rich negative rr is also rich by magnitude.
    assert swing.p6_vrp_premium(_iv(rr=-0.03), _vrp()) is not None
    # explicit ablation flag suppresses regardless of rr.
    assert swing.p6_vrp_premium(_iv(rr=0.05), _vrp(), skew_rich=False) is None


def test_p6_event_window():
    near = ["2026-09-30"]  # 2 days after as_of 2026-09-28
    far = ["2026-12-01"]
    assert swing.p6_vrp_premium(_iv(), _vrp(), event_days=near) is None
    ok = swing.p6_vrp_premium(_iv(), _vrp(), event_days=far)
    assert ok is not None and ok["features"]["event_check"] == "clear"


def test_p6_ticker_fallback_and_missing_vrp_pct():
    rec = swing.p6_vrp_premium({"atm_iv": 0.20, "risk_reversal": 0.02},
                               {"verdict": "EXPENSIVE", "hv20": 0.15})
    assert rec is not None
    assert rec["ticker"] == "NIFTY"  # documented fallback
    # vrp_pct derived from atm_iv - hv20.
    assert rec["features"]["vrp_pct"] == pytest.approx(5.0)


# ---------------------------------------------------------------------------
# P7 — sector rotation
# ---------------------------------------------------------------------------


def _sector(name, chg, *, adv=3, dec=1, n=4, top=1.0, top_name="X"):
    return {"sector": name, "strength": chg, "chg_pct": chg,
            "advancers": adv, "decliners": dec, "n_names": n,
            "top_chg": top, "top_name": top_name}


def test_p7_top_decile_and_breadth_confirmation():
    rows = [
        _sector("AUTO", 2.5, top=4.0, top_name="MARUTI"),
        _sector("BANKS", 0.5),
        _sector("IT", -0.2),
        _sector("PHARMA", 1.0),
    ]
    out = swing.p7_sector_rotation(rows, {"pct_advancing": 60.0,
                                          "advancers": 120, "decliners": 80},
                                   top_decile=1.5)
    assert [r["ticker"] for r in out] == ["AUTO"]
    rec = out[0]
    assert rec["side"] == "LONG"
    assert rec["entry_ref"] == pytest.approx(4.0)  # leader chg_pct
    feats = rec["features"]
    assert feats["strength"] == pytest.approx(2.5)
    assert feats["pct_advancing"] == pytest.approx(60.0)
    assert feats["breadth_adv"] == pytest.approx(120.0)
    assert feats["breadth_dec"] == pytest.approx(80.0)
    assert feats["n_names"] == 4

    # Negative market breadth blocks everything.
    assert swing.p7_sector_rotation(rows, {"pct_advancing": 40.0},
                                    top_decile=1.5) == []


def test_p7_sector_level_breadth_blocks_high_strength():
    rows = [_sector("AUTO", 5.0, adv=1, dec=5)]
    assert swing.p7_sector_rotation(rows, {"pct_advancing": 60.0},
                                    top_decile=1.0) == []


def test_p7_default_top_decile_ranks_and_sorts():
    rows = [_sector("A", 1.0), _sector("B", 5.0), _sector("C", 3.0),
            _sector("D", 0.5), _sector("E", 4.0)]
    out = swing.p7_sector_rotation(rows, {"pct_advancing": 55.0})
    # nearest-rank 90th percentile of 5 = the max -> only B fires.
    assert [r["ticker"] for r in out] == ["B"]
    # With an explicit low threshold the survivors are strength-sorted.
    out2 = swing.p7_sector_rotation(rows, {"pct_advancing": 55.0}, top_decile=3.0)
    assert [r["ticker"] for r in out2] == ["B", "E", "C"]


def test_p7_ignores_negative_and_missing_strength():
    rows = [_sector("A", -3.0), {"sector": "B"}]
    assert swing.p7_sector_rotation(rows, {"pct_advancing": 60.0}) == []
    assert swing.p7_sector_rotation([], {"pct_advancing": 60.0}) == []


# ---------------------------------------------------------------------------
# sector map
# ---------------------------------------------------------------------------


def test_builtin_sector_map_size_and_uniqueness():
    m = swing.BUILTIN_SECTOR_MAP
    assert len(m) >= 50
    keys = [str(k).strip().upper() for k in m]
    assert len(keys) == len(set(keys))
    assert all(str(v).strip() for v in m.values())


def test_load_sector_map_json_override(tmp_path, monkeypatch):
    p = tmp_path / "sm.json"
    p.write_text(json.dumps({"AAA": "X", "BBB": "Y"}), encoding="utf-8")
    assert swing.load_sector_map(path=str(p)) == {"AAA": "X", "BBB": "Y"}

    monkeypatch.setenv("INDIA_BOARD_SECTOR_MAP", str(p))
    assert swing.load_sector_map() == {"AAA": "X", "BBB": "Y"}

    # Inverted {"sectors": {SECTOR: [names]}} form.
    p2 = tmp_path / "inv.json"
    p2.write_text(json.dumps({"sectors": {"BANKS": ["HDFCBANK", "ICICIBANK"]}}),
                  encoding="utf-8")
    assert swing.load_sector_map(path=str(p2)) == {
        "HDFCBANK": "BANKS", "ICICIBANK": "BANKS",
    }

    # Corrupt / empty override falls back to the built-in map.
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert swing.load_sector_map(path=str(bad)) == swing.BUILTIN_SECTOR_MAP


def test_load_sector_map_defaults_to_builtin_without_env():
    assert swing.load_sector_map() == swing.BUILTIN_SECTOR_MAP


# ---------------------------------------------------------------------------
# build_sector_rows aggregation
# ---------------------------------------------------------------------------


def test_build_sector_rows_exact_aggregation():
    scan = {
        "sections": {
            "rows": [
                {"ticker": "AAA", "chg_pct": 2.0},
                {"ticker": "BBB", "chg_pct": -1.0},
                {"ticker": "CCC", "chg_pct": 3.0},
                {"ticker": "DDD", "chg_pct": 9.0},  # not in the map
            ],
            "tape": {"rows": [
                {"ticker": "AAA", "volume": 100.0, "oi_change": 50.0},
                {"ticker": "AAA", "volume": 50.0, "oi_change": -20.0},
                {"ticker": "CCC", "volume": 10.0, "oi_change": 5.0},
                {"ticker": "DDD", "volume": 999.0, "oi_change": 999.0},
            ]},
        }
    }
    out = swing.build_sector_rows(scan, sector_map={"AAA": "S1", "BBB": "S1",
                                                    "CCC": "S2"})
    assert [r["sector"] for r in out] == ["S2", "S1"]  # strength-sorted
    s2, s1 = out
    assert s2["chg_pct"] == pytest.approx(3.0)
    assert s2["strength"] == pytest.approx(3.0)
    assert s2["advancers"] == 1 and s2["decliners"] == 0
    assert s2["n_names"] == 1
    assert s2["delta_oi"] == pytest.approx(5.0)
    assert s2["delta_vol"] == pytest.approx(10.0)
    assert s2["top_chg"] == pytest.approx(3.0) and s2["top_name"] == "CCC"

    assert s1["chg_pct"] == pytest.approx(0.5)
    assert s1["advancers"] == 1 and s1["decliners"] == 1
    assert s1["n_names"] == 2
    assert s1["delta_oi"] == pytest.approx(30.0)
    assert s1["delta_vol"] == pytest.approx(150.0)
    assert s1["top_chg"] == pytest.approx(2.0) and s1["top_name"] == "AAA"


def test_build_sector_rows_empty_and_missing():
    assert swing.build_sector_rows(None, sector_map={"A": "S"}) == []
    assert swing.build_sector_rows({}, sector_map={"A": "S"}) == []


# ---------------------------------------------------------------------------
# dedupe ledger
# ---------------------------------------------------------------------------


def _p7_record(strength, ticker="AUTO"):
    return signal_log.make_signal(
        "P7", ticker, side="LONG",
        features={"sector": ticker, "strength": strength},
        source="scan",
    )


def test_dedupe_first_passes_repeat_skips_and_20pct_reemit():
    first = _p7_record(10.0)
    kept = swing.apply_dedupe(first, now=NOW)
    assert kept is first

    # identical metric -> skipped
    assert swing.apply_dedupe(_p7_record(10.0), now=NOW) is None

    # +30% > 20% -> re-emit annotated with the previous signal_id
    changed = _p7_record(13.0)
    kept2 = swing.apply_dedupe(changed, now=NOW)
    assert kept2 is changed
    assert changed["features"]["reemit_of"] == first["signal_id"]

    # +7.7% vs 13.0 -> below threshold, skipped
    assert swing.apply_dedupe(_p7_record(14.0), now=NOW) is None

    # a different side is a different key
    other_side = signal_log.make_signal(
        "P7", "AUTO", side="SHORT", features={"strength": 10.0}, source="scan")
    assert swing.apply_dedupe(other_side, now=NOW) is not None


def test_dedupe_keyed_per_playbook_and_day():
    p5 = signal_log.make_signal("P5", "NIFTY", side="CE",
                                features={"rollover_pct": 0.8}, source="rollover")
    assert swing.apply_dedupe(p5, now=NOW) is p5
    # same ticker/side but a different playbook is a distinct key
    p6 = signal_log.make_signal("P6", "NIFTY", side="CE",
                                features={"vrp_pct": 3.0}, source="greeks")
    assert swing.apply_dedupe(p6, now=NOW) is p6
    # a later day starts a fresh bucket
    later = NOW + timedelta(days=1)
    again = signal_log.make_signal("P5", "NIFTY", side="CE",
                                   features={"rollover_pct": 0.8}, source="rollover")
    assert swing.apply_dedupe(again, now=later) is again


# ---------------------------------------------------------------------------
# run_once — all external calls injected
# ---------------------------------------------------------------------------


def _scan_payload():
    return {
        "sections": {
            "rows": [{"ticker": "AAA", "chg_pct": 5.0},
                     {"ticker": "BBB", "chg_pct": 1.0}],
            "tape": {"rows": [{"ticker": "AAA", "volume": 100.0, "oi_change": 40.0}]},
            "breadth": {"advancers": 120, "decliners": 80, "pct_advancing": 60.0,
                        "rows": []},
        }
    }


def test_run_once_injected_writes_valid_jsonl(tmp_path, monkeypatch):
    # Sector map for the synthetic P7 payload.
    smap = tmp_path / "sectors.json"
    smap.write_text(json.dumps({"AAA": "S1", "BBB": "S2"}), encoding="utf-8")
    monkeypatch.setenv("INDIA_BOARD_SECTOR_MAP", str(smap))

    calls = {"rollover": 0, "greeks": 0}

    def rollover_fn(ticker):
        calls["rollover"] += 1
        return {"rollover": _rollover(ticker=ticker), "basis": _basis(prev=40.0)}

    def greeks_fn(ticker):
        calls["greeks"] += 1
        return {"ticker": ticker, "iv": _iv(ticker=ticker), "vrp": _vrp()}

    result = swing.run_once(
        ["NIFTY"],
        chains={"NIFTY": {"strikes": [{"strike": 22000.0, "ce_oi": 500.0}]}},
        rollover_fn=rollover_fn,
        greeks_fn=greeks_fn,
        scan=_scan_payload(),
        now=NOW,
    )

    assert calls == {"rollover": 1, "greeks": 1}
    assert result["P5"] == 1
    assert result["P6"] == 1
    assert result["P7"] == 1
    assert result["emitted"] == 3
    assert result["skipped"] == 0
    assert {r["playbook"] for r in result["signals"]} == {"P5", "P6", "P7"}

    # JSONL re-reads cleanly through the public reader.
    back = signal_log.read_signals(root=signal_log.DATA_DIR)
    assert len(back) == 3
    assert all(r["signal_id"] and r["ts"] for r in back)
    assert {r["source"] for r in back} == {"rollover", "greeks", "scan"}


def test_run_once_dedupes_identical_second_cycle(tmp_path, monkeypatch):
    monkeypatch.setenv("INDIA_BOARD_SECTOR_MAP", "nonexistent.json")
    roll = {"rollover": _rollover(), "basis": _basis(prev=40.0)}
    grk = {"ticker": "NIFTY", "iv": _iv(), "vrp": _vrp()}
    payload = _scan_payload()

    first = swing.run_once(["NIFTY"], rollover_fn=lambda t: roll, greeks_fn=lambda t: grk,
                           scan=payload, now=NOW)
    second = swing.run_once(["NIFTY"], rollover_fn=lambda t: roll, greeks_fn=lambda t: grk,
                            scan=payload, now=NOW)

    assert first["emitted"] >= 1
    # Same metrics the same day -> everything deduped.
    assert second["emitted"] == 0
    assert second["skipped"] == second["P5"] + second["P6"] + second["P7"]


def test_run_once_never_hits_network_without_injection(monkeypatch):
    # Guard: with every call injected, no fyers_data import is attempted.
    import builtins

    real_import = builtins.__import__

    def guarded(name, *args, **kwargs):
        if name in ("fyers_data", "scan_data") or name.startswith("fyers_data."):
            raise AssertionError(f"unexpected import {name}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded)
    roll = {"rollover": _rollover(), "basis": _basis(prev=40.0)}
    grk = {"ticker": "NIFTY", "iv": _iv(), "vrp": _vrp()}
    out = swing.run_once(["NIFTY"], rollover_fn=lambda t: roll,
                         greeks_fn=lambda t: grk, scan=_scan_payload(), now=NOW)
    assert out["P5"] == 1 and out["P6"] == 1


def test_run_once_live_path_rotates_and_caps_tickers(monkeypatch):
    seen = []

    def fake_roll(t):
        seen.append(t)
        return {"rollover": _rollover(ticker=t), "basis": _basis(prev=40.0)}

    def fake_greeks(t):
        return {"ticker": t, "iv": _iv(ticker=t), "vrp": _vrp()}

    # Default fns (both None) -> budget-capped, rotating live path; stub them.
    monkeypatch.setattr(swing, "_default_rollover_fn", fake_roll)
    monkeypatch.setattr(swing, "_default_greeks_fn", fake_greeks)
    monkeypatch.setattr(swing, "_TICKER_CURSOR", 0)

    tickers = ["A", "B", "C", "D", "E", "F"]
    for _ in range(3):
        swing.run_once(tickers, scan={"sections": {}}, now=NOW)

    assert swing.MAX_LIVE_TICKERS == 2
    assert seen[:2] == ["A", "B"]
    assert seen[2:4] == ["C", "D"]
    assert seen[4:6] == ["E", "F"]


# ---------------------------------------------------------------------------
# scheduler plumbing
# ---------------------------------------------------------------------------


def test_interval_env_override(monkeypatch):
    monkeypatch.delenv("SWING_EMITTER_INTERVAL_SEC", raising=False)
    assert swing._env_interval() == 1800.0
    monkeypatch.setenv("SWING_EMITTER_INTERVAL_SEC", "90")
    assert swing._env_interval() == 90.0
    monkeypatch.setenv("SWING_EMITTER_INTERVAL_SEC", "nope")
    assert swing._env_interval() == 1800.0


def test_market_hours_gate():
    def at(h, m, day=DAY):
        y, mo, d = (int(x) for x in day.split("-"))
        return datetime(y, mo, d, h, m, tzinfo=IST)

    assert swing._is_market_open(at(9, 15)) is True
    assert swing._is_market_open(at(15, 30)) is True
    assert swing._is_market_open(at(9, 14)) is False
    assert swing._is_market_open(at(15, 31)) is False
    assert swing._is_market_open(at(11, 0, day="2026-10-03")) is False  # Saturday


def test_ensure_started_is_idempotent_without_real_thread(monkeypatch):
    started = []

    class _FakeThread:
        def __init__(self, *_, target=None, name=None, daemon=None, **__):
            self.target = target

        def start(self):
            started.append("start")

    monkeypatch.setattr(swing, "threading",
                        types.SimpleNamespace(Thread=_FakeThread, Lock=swing.threading.Lock))
    monkeypatch.setattr(swing, "_STARTED", False)

    swing.ensure_started()
    swing.ensure_started()
    assert started == ["start"]
