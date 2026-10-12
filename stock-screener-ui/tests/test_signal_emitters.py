"""Unit tests for india_board/scripts/signal_emitters.py (no network).

Covers the four intraday playbook detectors (P1-P4), the dedupe/cooldown
ledger, legacy ``spot: None`` snapshots, malformed-line skipping, and an
end-to-end ``run_once`` over the **real** persisted NIFTY snapshot file.
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from india_board.scripts import signal_emitters as se
from india_board.scripts import signal_log

IST = ZoneInfo("Asia/Kolkata")
DAY = "2026-09-28"  # a Monday
DAY_DT = datetime(2026, 9, 28, 14, 5, tzinfo=IST)
_REAL_NIFTY = (
    Path(__file__).resolve().parents[1]
    / "india_board" / "data" / "oi_flow" / "NIFTY" / f"{DAY}.jsonl"
)

# ---------------------------------------------------------------------------
# fixtures + synthetic snapshot builders
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate():
    """Fresh cooldown ledger and default roots for every test."""
    se.reset_ledger()
    old_dir, old_root = se.OI_FLOW_DIR, se._SIGNAL_ROOT
    yield
    se.reset_ledger()
    se.OI_FLOW_DIR = old_dir
    se._SIGNAL_ROOT = old_root


def _row(strike, ce_oi, pe_oi, ce_vol=0.0, pe_vol=0.0):
    return {
        "strike": float(strike),
        "ce_oi": float(ce_oi), "pe_oi": float(pe_oi),
        "ce_oich": 0.0, "pe_oich": 0.0,
        "ce_vol": float(ce_vol), "pe_vol": float(pe_vol),
    }


def _snap(ts, spot, rows, ticker="NIFTY"):
    return {"ts": ts, "ticker": ticker, "spot": spot, "strikes": rows}


def _ts(minute, hour=10):
    return datetime(2026, 9, 28, hour, minute, tzinfo=IST).isoformat()


def _write_day(root: Path, ticker: str, snaps: list, day: str = DAY) -> Path:
    """Write a synthetic day file; return the ``oi_flow`` base dir (loader root)."""
    base = root / "oi_flow"
    d = base / ticker
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{day}.jsonl"
    path.write_text(
        "\n".join(json.dumps(s) for s in snaps) + "\n", encoding="utf-8"
    )
    return base


# ---------------------------------------------------------------------------
# P1 — OI-burst continuation
# ---------------------------------------------------------------------------


def _p1_sequence(spot_cur=22600.0):
    prev = _snap(_ts(0), 22450.0, [_row(22500, 100000, 1000), _row(22600, 1000, 1000)])
    cur = _snap(
        _ts(2), spot_cur,
        [_row(22500, 100000, 1000), _row(22600, 50000, 1000, ce_vol=5000)],
    )
    return [prev, cur]


def test_p1_fires_on_writing_and_breakout():
    rec = se.p1_burst("nifty", _p1_sequence())
    assert rec is not None
    assert rec["playbook"] == "P1"
    assert rec["ticker"] == "NIFTY"
    assert rec["side"] == "CE"
    assert rec["strike"] == 22500.0
    assert rec["entry_ref"] == 22600.0
    for key in (
        "delta_oi", "delta_vol", "oi_vol_ratio", "wall_strike", "spot",
        "distance_bp", "spread_bp", "atr", "spread_ok", "stop_basis",
    ):
        assert key in rec["features"]
    assert rec["features"]["delta_oi"] > 0
    assert rec["features"]["delta_vol"] > 0
    assert rec["features"]["spread_bp"] is None
    assert rec["features"]["spread_ok"] is None  # missing spread is recorded


def test_p1_suppressed_when_spot_has_not_crossed_wall():
    assert se.p1_burst("nifty", _p1_sequence(spot_cur=22400.0)) is None


def test_p1_stop_uses_pct_fallback_when_atr_is_none():
    rec = se.p1_burst("nifty", _p1_sequence(), atr=None)
    assert rec["features"]["stop_basis"] == "pct_fallback"
    # wall (22500) - 0.35% of spot (22600) = 22500 - 79.1
    assert rec["stop_ref"] == pytest.approx(22500.0 - 0.0035 * 22600.0)


def test_p1_stop_uses_atr_when_provided():
    rec = se.p1_burst("nifty", _p1_sequence(), atr=50.0)
    assert rec["features"]["stop_basis"] == "atr"
    assert rec["stop_ref"] == pytest.approx(22500.0 - 0.35 * 50.0)


def test_p1_spread_filter_blocks_wide_spreads():
    assert se.p1_burst("nifty", _p1_sequence(), spread_bp=25.0) is None
    rec = se.p1_burst("nifty", _p1_sequence(), spread_bp=12.0)
    assert rec["features"]["spread_ok"] is True


# ---------------------------------------------------------------------------
# P2 — absorption fade
# ---------------------------------------------------------------------------


def _p2_sequence(ce_oi_values):
    spots = [22500, 22501, 22500, 22499, 22501, 22502]
    return [
        _snap(_ts(i), spots[i], [_row(22500, oi, 500)]) for i, oi in enumerate(ce_oi_values)
    ]


def test_p2_fires_at_two_sigma():
    # lookback deltas [8,10,12,10] -> pstdev 1.414; latest 25 -> z ~17.7
    recs = se.p2_absorption("nifty", _p2_sequence([1000, 1008, 1018, 1030, 1040, 1065]))
    assert len(recs) == 1
    rec = recs[0]
    assert rec["playbook"] == "P2"
    assert rec["side"] == "CE"
    assert rec["strike"] == 22500.0
    assert rec["features"]["strike"] == 22500.0
    assert rec["features"]["side"] == "CE"
    assert rec["features"]["zscore"] >= 2.0
    assert "absorption_score" in rec["features"]


def test_p2_does_not_fire_at_one_sigma():
    # latest delta 1 -> z ~0.7, below sigma_mult=2
    assert se.p2_absorption("nifty", _p2_sequence([1000, 1008, 1018, 1030, 1040, 1041])) == []


def test_p2_sigma_boundary_fires_at_two_not_one():
    # lookback deltas [0,20,0,20] -> pstdev 10.
    # latest 20 -> z == 2.0 (>= 2 -> fires); latest 10 -> z == 1.0 (no fire).
    two_sigma = [1000, 1000, 1020, 1020, 1040, 1060]
    one_sigma = [1000, 1000, 1020, 1020, 1040, 1050]
    assert len(se.p2_absorption("nifty", _p2_sequence(two_sigma))) == 1
    assert se.p2_absorption("nifty", _p2_sequence(one_sigma)) == []


# ---------------------------------------------------------------------------
# P3 — wall migration
# ---------------------------------------------------------------------------


def test_p3_fires_on_wall_change():
    a = _snap(_ts(0), 22500.0, [_row(22500, 100000, 1000), _row(22600, 100, 1000)])
    b = _snap(_ts(2), 22500.0, [_row(22500, 100000, 1000), _row(22600, 200000, 1000)])
    recs = se.p3_wall_migration("nifty", [a, b])
    assert len(recs) == 1
    rec = recs[0]
    assert rec["playbook"] == "P3"
    assert rec["side"] == "CE"
    assert rec["features"]["event"] == "migration"
    assert rec["features"]["from_strike"] == 22500.0
    assert rec["features"]["to_strike"] == 22600.0
    for key in ("from_strike", "to_strike", "side", "delta_oi", "sigma", "volume_confirm"):
        assert key in rec["features"]


def test_p3_fires_on_sigma_oi_spike():
    # wall stays 22500; deltas [1,4,-1,6,90] -> lookback pstdev ~2.69, 2*2.69 < 90
    series = [100, 101, 105, 104, 110, 200]
    snaps = [
        _snap(_ts(i), 22500.0, [_row(22500, v, 1000), _row(22600, 50, 1000)])
        for i, v in enumerate(series)
    ]
    recs = se.p3_wall_migration("nifty", snaps)
    ce = [r for r in recs if r["side"] == "CE"]
    assert len(ce) == 1
    assert ce[0]["features"]["event"] == "oi_spike"
    assert ce[0]["features"]["from_strike"] == ce[0]["features"]["to_strike"] == 22500.0
    assert ce[0]["features"]["delta_oi"] == 90.0


# ---------------------------------------------------------------------------
# P4 — expiry pin
# ---------------------------------------------------------------------------


def _p4_strikes():
    return [_row(22400, 100, 100), _row(22500, 100000, 100000), _row(22600, 100, 100)]


def _p4_chain(expiry=DAY_DT.strftime("%d-%m-%Y")):
    return {"expiry": expiry, "strikes": _p4_strikes(), "spot": 22500.0}


def test_p4_fires_inside_window_within_near_pct():
    snaps = [_snap("2026-09-28T14:04:00+05:30", 22500.0, _p4_strikes())]
    rec = se.p4_expiry_pin("nifty", snaps, chain=_p4_chain(), now=DAY_DT)
    assert rec is not None
    assert rec["playbook"] == "P4"
    assert rec["features"]["max_pain"] == 22500.0
    assert rec["features"]["distance_pct"] <= 0.3
    assert rec["features"]["dte"] == 0
    assert rec["target_ref"] == 22500.0
    for key in ("spot", "max_pain", "distance_pct", "gamma_flip", "dte"):
        assert key in rec["features"]


def test_p4_only_inside_last_90_minutes():
    snaps = [_snap("2026-09-28T13:55:00+05:30", 22500.0, _p4_strikes())]
    early = datetime(2026, 9, 28, 13, 59, tzinfo=IST)
    assert se.p4_expiry_pin("nifty", snaps, chain=_p4_chain(), now=early) is None


def test_p4_only_within_near_pct_of_max_pain():
    snaps = [_snap("2026-09-28T14:04:00+05:30", 22590.0, _p4_strikes())]
    assert se.p4_expiry_pin("nifty", snaps, chain=_p4_chain(), now=DAY_DT) is None


def test_p4_requires_gamma_flip_opposite_side_when_gex_given():
    snaps = [_snap("2026-09-28T14:04:00+05:30", 22488.0, _p4_strikes())]
    opp = se.p4_expiry_pin(
        "nifty", snaps, chain=_p4_chain(), gex={"gamma_flip": 22400.0}, now=DAY_DT
    )
    assert opp is not None
    same = se.p4_expiry_pin(
        "nifty", snaps, chain=_p4_chain(), gex={"gamma_flip": 22550.0}, now=DAY_DT
    )
    assert same is None


def test_p4_requires_chain_expiry_day():
    snaps = [_snap("2026-09-28T14:04:00+05:30", 22500.0, _p4_strikes())]
    assert se.p4_expiry_pin("nifty", snaps, chain=None, now=DAY_DT) is None
    other = _p4_chain(expiry="29-09-2026")
    assert se.p4_expiry_pin("nifty", snaps, chain=other, now=DAY_DT) is None


# ---------------------------------------------------------------------------
# robustness: legacy spot:None, malformed lines, no-raise
# ---------------------------------------------------------------------------


def test_spot_none_snapshots_do_not_raise():
    legacy_prev = {"ts": _ts(0), "ticker": "NIFTY", "strikes": [_row(22500, 1000, 1000)]}
    legacy_cur = {"ts": _ts(2), "ticker": "NIFTY", "strikes": [_row(22600, 50000, 1000)]}
    snaps = [legacy_prev, legacy_cur]
    assert se.p1_burst("nifty", snaps) is None
    assert se.p2_absorption("nifty", snaps) == []
    assert isinstance(se.p3_wall_migration("nifty", snaps), list)
    assert se.p4_expiry_pin("nifty", snaps, chain=_p4_chain(), now=DAY_DT) is None
    # Defensive: None / wrong types never raise.
    assert se.p1_burst("nifty", None) is None
    assert se.p2_absorption("nifty", "not a list") == []
    assert se.p3_wall_migration("nifty", [{"ts": "x"}]) == []
    assert se.p4_expiry_pin("nifty", None) is None


def test_load_snapshots_skips_malformed_lines(tmp_path):
    d = tmp_path / "NIFTY"
    d.mkdir()
    good = _snap(_ts(0), 22500.0, [_row(22500, 1, 1)])
    payload = "\n".join([
        "{not json at all",
        json.dumps(good),
        json.dumps(["a", "list", "is", "not", "a", "snapshot"]),
        json.dumps({"ticker": "NIFTY"}),           # dict but no ts
        json.dumps({"ts": _ts(2), "ticker": "NIFTY"}),  # no strikes
        "",
    ])
    (d / f"{DAY}.jsonl").write_text(payload + "\n", encoding="utf-8")
    snaps = se.load_snapshots("NIFTY", day=DAY, root=tmp_path)
    assert snaps == [good]
    assert se.load_snapshots("NIFTY", day="2026-09-27", root=tmp_path) == []
    assert se.load_snapshots("RELIANCE", day=DAY, root=tmp_path) == []


def test_load_snapshots_treats_old_lines_as_spot_none(tmp_path):
    legacy = {"ts": _ts(0), "ticker": "NIFTY", "strikes": [_row(22500, 1, 1)]}
    d = tmp_path / "NIFTY"
    d.mkdir()
    (d / f"{DAY}.jsonl").write_text(json.dumps(legacy) + "\n", encoding="utf-8")
    snaps = se.load_snapshots("NIFTY", day=DAY, root=tmp_path)
    assert snaps == [legacy]
    assert se._snap_spot(snaps[0]) is None


# ---------------------------------------------------------------------------
# dedupe / cooldown + run_once
# ---------------------------------------------------------------------------


def _wall_change_snaps():
    a = _snap(_ts(0), 22500.0, [_row(22500, 100000, 1000), _row(22600, 100, 1000)])
    b = _snap(_ts(2), 22500.0, [_row(22500, 100000, 1000), _row(22600, 200000, 1000)])
    return [a, b]


def test_run_once_writes_and_cooldown_suppresses_duplicate(tmp_path):
    oi_root = _write_day(tmp_path, "NIFTY", _wall_change_snaps())

    kwargs = dict(tickers=["NIFTY"], now=DAY_DT, day=DAY, enrich=False,
                  signal_root=tmp_path, oi_root=oi_root)
    first = se.run_once(**kwargs)
    assert first["P3"] == 1
    assert first["P1"] == first["P2"] == first["P4"] == 0

    # Same 30-minute bucket -> the ledger suppresses the repeat.
    second = se.run_once(**kwargs)
    assert second == {"P1": 0, "P2": 0, "P3": 0, "P4": 0}

    recs = signal_log.read_signals(DAY, root=tmp_path)
    assert len(recs) == 1
    assert recs[0]["playbook"] == "P3"
    assert recs[0]["ts"] == DAY_DT.isoformat()


def test_dedupe_key_shape_and_30min_bucketing():
    rec = signal_log.make_signal("P3", "NIFTY", side="CE", features={}, strike=22500.0)
    rec["ts"] = "2026-09-28T14:05:00+05:30"
    key = se._dedupe_key(rec)
    assert key == ("P3", "NIFTY", "CE", 22500.0, "2026-09-28T14:00")
    rec["ts"] = "2026-09-28T14:29:59+05:30"
    assert se._dedupe_key(rec) == key  # same bucket
    rec["ts"] = "2026-09-28T14:30:00+05:30"
    assert se._dedupe_key(rec) != key  # next bucket


def test_run_once_skips_non_session_days(tmp_path):
    oi_root = _write_day(tmp_path, "NIFTY", _wall_change_snaps(), day="2026-10-03")
    sat = datetime(2026, 10, 3, 11, 0, tzinfo=IST)  # a Saturday
    counts = se.run_once(tickers=["NIFTY"], now=sat, day="2026-10-03", enrich=False,
                         signal_root=tmp_path, oi_root=oi_root)
    assert counts == {"P1": 0, "P2": 0, "P3": 0, "P4": 0}


# ---------------------------------------------------------------------------
# integration — real persisted NIFTY snapshots
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _REAL_NIFTY.is_file(), reason="real NIFTY snapshot missing")
def test_run_once_over_real_nifty_file(tmp_path):
    oi_root = tmp_path / "oi_flow"
    dest = oi_root / "NIFTY"
    dest.mkdir(parents=True)
    shutil.copy(_REAL_NIFTY, dest / f"{DAY}.jsonl")

    counts = se.run_once(
        tickers=["NIFTY"], now=DAY_DT, day=DAY, enrich=False,
        signal_root=tmp_path, oi_root=oi_root,
    )
    assert set(counts) == {"P1", "P2", "P3", "P4"}
    assert all(isinstance(v, int) and v >= 0 for v in counts.values())

    # The real file really was loaded (not an empty-universe no-op).
    real = se.load_snapshots("NIFTY", day=DAY, root=oi_root)
    expected_lines = [ln for ln in _REAL_NIFTY.read_text(encoding="utf-8").splitlines()
                      if ln.strip()]
    assert len(real) == len(expected_lines) > 0
    assert all(s["ticker"] == "NIFTY" for s in real)

    # Everything written stays under tmp_path (nothing lands in the repo).
    written = list(tmp_path.glob("*.jsonl"))
    for path in written:
        assert path.parent == tmp_path
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            obj = json.loads(line)  # raises on malformed JSON
            assert obj["playbook"] in ("P1", "P2", "P3", "P4")
            assert isinstance(obj["features"], dict)

    back = signal_log.read_signals(DAY, root=tmp_path)
    assert len(back) == sum(counts.values())
    for rec in back:
        assert rec["ticker"] == "NIFTY"
        assert rec["ts"] == DAY_DT.isoformat()
