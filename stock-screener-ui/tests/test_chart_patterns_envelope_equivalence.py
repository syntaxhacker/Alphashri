"""Differential equivalence asset for the two O(m^2) envelope implementations.

``features.envelope_line(df, pivots, side, tol)`` and
``trendlines._envelope_line(boundary, xs, qs, tol, side)`` are two independent
implementations of the same "bounding envelope" search. They must agree exactly
on every returned field before they can be safely unified.

The known mechanical differences are: the cell cap (1M in features vs 2M in
trendlines, which only changes block chunking), features' frame-scoped memo,
its internal pivot sort + ``keep`` mask, and the dtype of ``xs`` (int64 vs
float64). This corpus feeds both functions the *same* ascending, unique pivot
positions (the shared contract), with features additionally receiving a
shuffled copy to exercise its sort/keep path. Float assertions are exact: the
ops are deterministic and identical in order, so any mismatch is a real
divergence, not tolerance noise.

If a case is ever found to diverge, do NOT change either implementation and do
NOT weaken the assertion -- record it in ``_XFAIL`` below with the exact
diverging field so it stays visible instead of being hidden.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from chart_patterns import features as F
from chart_patterns import trendlines as T

_FIELDS = ("slope", "intercept", "x0", "q0", "x1", "q1", "viol", "worst")
_PAIR_FIELDS = ("x0", "q0", "x1", "q1")

# Genuinely diverging cases: case-id -> one-line reason naming the field.
# Discovered empirically by this corpus -- do NOT fix either implementation or
# weaken the assertions above; record the divergence here instead.
#
# These cases force ``features.envelope_line`` past its 1M-cell block boundary
# (num_pairs > 1_000_000 // n) while trendlines' 2M cap keeps them in a single
# block. They previously raised ValueError because ``np.bincount`` indexed by
# GLOBAL pair ids sized its result to the global max instead of the block, so
# it could not broadcast into ``viol[p0:p1]``. Both functions now offset the
# ids by ``p0``; these cases are asserted like every other one so the chunked
# path stays covered.
#
# A divergence here means the cell-cap difference has started changing results,
# which is the exact thing this corpus exists to catch.
_XFAIL: dict[str, str] = {}


def _make_frame(rng: np.random.Generator, n: int) -> pd.DataFrame:
    """Trending + noisy OHLCV frame of exactly ``n`` bars."""
    t = np.arange(n, dtype=float)
    drift = rng.uniform(-0.7, 0.7)
    noise = np.cumsum(rng.normal(0.0, 1.5, n))
    close = 100.0 + drift * t + noise
    high = close + rng.uniform(0.2, 2.0, n)
    low = close - rng.uniform(0.2, 2.0, n)
    idx = pd.date_range("2024-01-01", periods=n, freq="D", tz="UTC")
    return pd.DataFrame(
        {"open": close, "high": high, "low": low, "close": close,
         "volume": np.full(n, 1000.0)},
        index=idx,
    )


def _pivots(rng: np.random.Generator, boundary: np.ndarray, m: int):
    """``m`` ascending, unique pivot positions whose q sits on the boundary."""
    n = len(boundary)
    pos = np.sort(rng.choice(np.arange(n), size=m, replace=False))
    return [(int(p), float(boundary[p])) for p in pos]


def _build_cases():
    rng = np.random.default_rng(20240601)
    lengths = [60, 85, 120, 150, 200, 260, 320, 400, 72, 140, 230, 380]
    tols = (0.0, 0.25, 1.0, 3.0)
    subsets = (4, 10, 22)
    cases = []
    for fi, n in enumerate(lengths):
        df = _make_frame(rng, n)
        for side in ("upper", "lower"):
            boundary = df["high" if side == "upper" else "low"].to_numpy(dtype=float)
            for si, m in enumerate(subsets):
                pivots = _pivots(rng, boundary, min(m, n))
                shuffled = list(pivots)
                rng.shuffle(shuffled)  # features must sort internally
                tol = tols[(fi + si + (0 if side == "upper" else 2)) % len(tols)]
                cases.append({
                    "id": f"frame{fi}-{side}-m{m}",
                    "df": df, "pivots": pivots, "pivots_shuffled": shuffled,
                    "side": side, "tol": tol,
                })

    # Stress the 1M-vs-2M cell-cap difference: at n=400 features chunks at
    # 2500 pairs while trendlines stays in one block. This is the empirical
    # check that block chunking never changes the running-best winner.
    df = _make_frame(rng, 400)
    for m in (80, 95):
        for side in ("upper", "lower"):
            boundary = df["high" if side == "upper" else "low"].to_numpy(dtype=float)
            pivots = _pivots(rng, boundary, m)
            cases.append({
                "id": f"chunk-n400-m{m}-{side}",
                "df": df, "pivots": pivots, "pivots_shuffled": list(reversed(pivots)),
                "side": side, "tol": 0.25,
            })
    return cases


_CASES = _build_cases()


def _compare(case):
    cid = case["id"]
    if cid in _XFAIL:
        pytest.xfail(_XFAIL[cid])
    df, pivots = case["df"], case["pivots"]
    side, tol = case["side"], case["tol"]
    boundary = df["high" if side == "upper" else "low"].to_numpy(dtype=float)

    # features sorts its input and applies the keep mask; hand it a shuffled
    # copy so that path is exercised, while trendlines gets the canonical
    # ascending arrays it contracts for.
    got_f = F.envelope_line(df, case["pivots_shuffled"], side, tol)
    xs = np.asarray([p for p, _ in pivots], dtype=np.float64)
    qs = np.asarray([q for _, q in pivots], dtype=np.float64)
    got_t = T._envelope_line(boundary, xs, qs, tol, side)

    assert (got_f is None) == (got_t is None), (
        f"{cid}: None-mismatch features={got_f} trendlines={got_t}"
    )
    if got_f is None:
        return

    # Requirement 2: identical winner-selection tie-break -> same pivot pair.
    fp = tuple(got_f[k] for k in _PAIR_FIELDS)
    tp = tuple(got_t[k] for k in _PAIR_FIELDS)
    assert fp == tp, f"{cid}: chosen pivot pair differs features={fp} trendlines={tp}"

    # Requirement 1: exact equality on every returned field (no tolerance).
    for k in _FIELDS:
        assert got_f[k] == got_t[k], (
            f"{cid}: field={k} diverged features={got_f[k]!r} trendlines={got_t[k]!r}"
        )


@pytest.mark.parametrize("case", _CASES, ids=[c["id"] for c in _CASES])
def test_envelope_implementations_agree(case):
    _compare(case)


def test_flat_boundary_tiebreak_agrees():
    """All-zero-violation pairs -> longest span wins; pins the tie-break."""
    n = 40
    boundary = np.full(n, 50.0)
    df = pd.DataFrame(
        {"open": boundary, "high": boundary, "low": boundary,
         "close": boundary, "volume": np.full(n, 1000.0)},
        index=pd.date_range("2024-01-01", periods=n, freq="D", tz="UTC"),
    )
    for side in ("upper", "lower"):
        pivots = [(int(p), 50.0) for p in (2, 7, 15, 26, 38)]
        got_f = F.envelope_line(df, list(reversed(pivots)), side, 0.0)
        xs = np.asarray([p for p, _ in pivots], dtype=np.float64)
        qs = np.asarray([q for _, q in pivots], dtype=np.float64)
        got_t = T._envelope_line(boundary, xs, qs, 0.0, side)
        assert got_f == got_t, f"flat tie-break side={side} f={got_f} t={got_t}"
        assert (got_f["x0"], got_f["x1"]) == (2, 38)  # longest span wins
