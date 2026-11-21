"""Guard that the trendline detector uses the single shared envelope search.

``features.envelope_line`` is now the only implementation of the O(m^2)
bounding-envelope search. This file used to differential-test it against a
private copy in ``trendlines``; the copy is gone, so the remaining value is a
guard that prevents the duplicate from being reintroduced, plus the flat-line
tie-break check that pins ``(violations, -span)`` first-wins selection.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from chart_patterns import features as F
from chart_patterns import trendlines as T


def test_trendlines_has_no_private_envelope_implementation():
    assert not hasattr(T, "_envelope_line")
    assert not hasattr(T, "_ENVELOPE_CELL_CAP")
    assert T.F.envelope_line is F.envelope_line


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
