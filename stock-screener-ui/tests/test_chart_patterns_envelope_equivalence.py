"""Guard for the single shared envelope search in ``features.envelope_line``.

The O(m^2) bounding-envelope implementation lives once in
:mod:`chart_patterns.features`; pattern-boundary detectors reuse it. The
flat-line tie-break below pins the ``(violations, -span)`` first-wins rule.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from chart_patterns import features as F


def test_flat_boundary_tiebreak_uses_longest_span():
    """All-zero-violation pairs -> longest span wins; pins the tie-break."""
    n = 40
    boundary = np.full(n, 50.0)
    df = pd.DataFrame(
        {
            "open": boundary,
            "high": boundary,
            "low": boundary,
            "close": boundary,
            "volume": np.full(n, 1000.0),
        },
        index=pd.date_range("2024-01-01", periods=n, freq="D", tz="UTC"),
    )
    for side in ("upper", "lower"):
        pivots = [(int(p), 50.0) for p in (2, 7, 15, 26, 38)]
        got = F.envelope_line(df, list(reversed(pivots)), side, 0.0)
        assert got is not None
        assert (got["x0"], got["x1"]) == (2, 38)
        assert got["viol"] == 0
