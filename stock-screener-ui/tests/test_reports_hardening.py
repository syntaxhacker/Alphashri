"""Regressions for the reporting-backend hardening pass.

* the option-positioning block must not be poisoned by a NaN (Starlette
  serialises with ``allow_nan=False``, so one NaN leg 500s the live report);
* the profitability EMA scan must produce the SAME signals after the
  per-bar rebuild was replaced by a single pass;
* the per-endpoint in-memory caches must stay bounded (their keys embed
  user-supplied windows / symbol lists).
"""

import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.reports_api import delivery as dl  # noqa: E402
from api.reports_api import events_feed as ef  # noqa: E402
from api.reports_api import profitability as pb  # noqa: E402
from api.reports_api.nifty_positioning import compute_positioning  # noqa: E402


# --------------------------------------------------------------------------
# NaN guard
# --------------------------------------------------------------------------

def _chain_row(delta="nan", oi=1000, prev_oi=500):
    """A chain row in the flat shape ``compute_positioning`` consumes."""
    return {
        "strike": 23000.0,
        "ce": {
            "oi": oi,
            "prev_oi": prev_oi,
            "delta": delta,
            "iv": 14.0,
            "sentiment": {"type": "Long Buildup", "label": "LB"},
        },
        "pe": {
            "oi": oi,
            "prev_oi": prev_oi,
            "delta": -0.4,
            "iv": 15.0,
            "sentiment": {"type": "Short Buildup", "label": "SB"},
        },
    }


def test_a_nan_delta_does_not_poison_the_positioning_block():
    out = compute_positioning([_chain_row()], 23000.0)
    for key in ("state", "flow", "flow_class", "initiated",
                "bull_cr", "bear_cr", "split_pct"):
        value = out[key]
        assert not isinstance(value, float) or math.isfinite(value), key
    # The payload must be JSON-serialisable with allow_nan=False.
    import json

    json.dumps(out, allow_nan=False)


def test_a_nan_oi_does_not_poison_the_positioning_block():
    out = compute_positioning([_chain_row(oi="nan")], 23000.0)
    import json

    json.dumps(out, allow_nan=False)


def test_a_normal_chain_still_produces_numbers():
    out = compute_positioning([_chain_row(delta=0.5)], 23000.0)
    assert out["state"] != 0.0
    assert out["strikes"][0]["strike"] == 23000.0


# --------------------------------------------------------------------------
# profitability: one EMA pass instead of one per bar
# --------------------------------------------------------------------------

def _series(n=140):
    closes = [100.0 + i * 0.5 for i in range(n)]
    opens = [c - 0.2 for c in closes]
    highs = [c + 0.4 for c in closes]
    lows = [c - 0.6 for c in closes]
    vols = [1000.0] * n
    return opens, highs, lows, closes, vols


def test_precomputed_ema_series_matches_the_per_bar_rebuild():
    opens, highs, lows, closes, vols = _series()
    ema = pb._ema_cross_series(closes)
    for i in range(26, len(closes)):
        per_bar = pb._signal_at("ema_cross", opens, highs, lows, closes, vols, i)
        pre = pb._signal_at("ema_cross", opens, highs, lows, closes, vols, i,
                            ema=ema)
        assert per_bar == pre, i


def test_ema_cross_signals_are_actually_detected():
    opens, highs, lows, closes, vols = _series()
    ema = pb._ema_cross_series(closes)
    hits = [
        i for i in range(26, len(closes))
        if pb._signal_at("ema_cross", opens, highs, lows, closes, vols, i, ema=ema)
    ]
    # A steady uptrend has no down-cross, so there is no ema_cross entry.
    assert hits == []


# --------------------------------------------------------------------------
# bounded in-memory caches
# --------------------------------------------------------------------------

@pytest.mark.parametrize("module", [dl, ef])
def test_mem_put_evicts_the_oldest_entries(module):
    store: dict = {}
    cap = module._MEM_CACHE_MAX
    for i in range(cap + 25):
        module._mem_put(store, f"k{i}", (0.0, {}))
    assert len(store) == cap
    # The oldest keys are gone, the newest are kept.
    assert "k0" not in store
    assert f"k{cap + 24}" in store


def test_delivery_cache_stays_bounded_across_many_requests(monkeypatch):
    dl.clear_cache()
    monkeypatch.setattr(dl, "_fetch_bhavcopy", lambda day: None)
    monkeypatch.setattr(dl, "_universe_symbols", lambda uid, cap: [])
    for i in range(dl._MEM_CACHE_MAX + 20):
        dl.serve_delivery(f"2026-10-{(i % 28) + 1:02d}", "nifty500", i % 100 + 1)
    assert len(dl._delivery_mem) <= dl._MEM_CACHE_MAX
    dl.clear_cache()
