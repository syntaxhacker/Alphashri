"""Pattern display dates must follow the IST session, not the UTC bar stamp."""

import pandas as pd
import pytest

from chart_patterns.detectors.common import fmt_date


@pytest.mark.parametrize(
    "stamp, expected",
    [
        # Daily bar: 18:30Z on the 16th is the 17th's IST session.
        ("2026-11-16T18:30:00+00:00", "2026-11-17"),
        ("2026-11-16T18:30:00", "2026-11-17"),
        # Intraday bar: same instant, IST clock — the session is still the 17th.
        ("2026-11-17T09:20:00+05:30", "2026-11-17 09:20"),
        ("2026-11-17T03:50:00+00:00", "2026-11-17 09:20"),
    ],
)
def test_fmt_date_resolves_ist_session(stamp, expected):
    assert fmt_date(pd.Timestamp(stamp)) == expected


def test_fmt_date_keeps_unparseable_input():
    assert fmt_date("not-a-timestamp") == "not-a-timestamp"
