"""Tests for the daily GEX snapshot store (temp DB only — never data/gex.db)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import gex_history as G  # noqa: E402


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("UW_GEX_DB", str(tmp_path / "gex.db"))
    G._reset()
    yield G
    G._reset()


def _patch_matrix(monkeypatch, holder):
    """Patch `symbol_data._build_gexmatrix` to serve cells from a mutable holder."""
    import symbol_data  # noqa: PLC0415

    monkeypatch.setattr(
        symbol_data,
        "_build_gexmatrix",
        lambda ticker, *a, **k: {"spot": 100.0, "expiries": [], "strikes": [], "cells": holder["cells"]},
    )


EXP = "2026-10-17"


def _cell(strike, gex, delta=1.0, charm=2.0, vanna=3.0):
    return {"e": EXP, "k": strike, "gex": gex, "delta": delta, "charm": charm, "vanna": vanna}


def test_capture_round_trip_and_idempotent(store, monkeypatch):
    holder = {"cells": [_cell(100.0, 150.0), _cell(110.0, 60.0)]}
    _patch_matrix(monkeypatch, holder)
    monkeypatch.setattr(store, "et_date", lambda: "2026-10-02")

    assert store.capture("mu") == 2
    # second call hits the in-process 'already captured today' flag (no refetch)
    assert store.capture("mu") == 0

    rows = store.history("MU", 10)
    assert len(rows) == 2
    assert {r["date"] for r in rows} == {"2026-10-02"}

    # DB-level idempotency: clearing the flag then re-capturing must not duplicate
    store._captured.discard(("MU", "2026-10-02"))
    assert store.capture("MU") == 2
    assert len(store.history("MU", 10)) == 2


def test_changes_sign_and_none_baseline(store, monkeypatch):
    holder = {
        "cells": [
            _cell(100.0, 100.0),
            _cell(110.0, 0.0),
            _cell(120.0, 100.0),
        ]
    }
    _patch_matrix(monkeypatch, holder)
    # seed the prior session explicitly
    assert store.capture("MU", "2026-10-01") == 3
    # today's matrix moves each strike
    holder["cells"] = [_cell(100.0, 150.0), _cell(110.0, 60.0), _cell(120.0, 50.0)]
    monkeypatch.setattr(store, "et_date", lambda: "2026-10-02")

    out = store.changes("MU", "gex")
    assert out["ticker"] == "MU"
    assert out["date"] == "2026-10-02"
    assert out["prev_date"] == "2026-10-01"
    assert out["metric"] == "gex"

    by_k = {c["k"]: c for c in out["cells"]}
    assert by_k[100.0]["value"] == 150.0 and by_k[100.0]["prev"] == 100.0
    assert by_k[100.0]["chg_pct"] == 50.0            # +50%
    assert by_k[120.0]["value"] == 50.0 and by_k[120.0]["chg_pct"] == -50.0  # -50%
    # zero baseline -> None, never a divide-by-zero blow-up
    assert by_k[110.0]["prev"] == 0.0 and by_k[110.0]["chg_pct"] is None


def test_changes_without_prior_session(store, monkeypatch):
    holder = {"cells": [_cell(100.0, 150.0)]}
    _patch_matrix(monkeypatch, holder)
    monkeypatch.setattr(store, "et_date", lambda: "2026-10-02")

    out = store.changes("MU", "gex")
    assert out["date"] == "2026-10-02"
    assert out["prev_date"] is None
    assert out["cells"][0]["value"] == 150.0
    assert out["cells"][0]["prev"] is None
    assert out["cells"][0]["chg_pct"] is None


def test_changes_metric_selection(store, monkeypatch):
    holder = {"cells": [_cell(100.0, 10.0, delta=2.0), _cell(110.0, 20.0, delta=4.0)]}
    _patch_matrix(monkeypatch, holder)
    store.capture("MU", "2026-10-01")
    holder["cells"] = [_cell(100.0, 10.0, delta=3.0), _cell(110.0, 20.0, delta=2.0)]
    monkeypatch.setattr(store, "et_date", lambda: "2026-10-02")

    out = store.changes("MU", "delta")
    assert out["metric"] == "delta"
    by_k = {c["k"]: c for c in out["cells"]}
    assert by_k[100.0]["chg_pct"] == 50.0
    assert by_k[110.0]["chg_pct"] == -50.0
    # unknown metric falls back to gex
    assert store.changes("MU", "bogus")["metric"] == "gex"


def test_empty_and_garbage_inputs(store):
    assert store.capture("") == 0
    assert store.changes("")["cells"] == []
    assert store.history("") == []
    assert store.history("NOPE", 10) == []
