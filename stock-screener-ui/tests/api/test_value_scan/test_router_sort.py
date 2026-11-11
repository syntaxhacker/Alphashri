"""``_apply_sort`` must produce the same order without shaping every row.

It used to build the FULL response shape for every row of the frame (25
field conversions each) and then throw the shapes away - only the raw rows
were returned. The sort key is derived from the raw row instead.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.value_scan.router import _apply_sort, _shape_row  # noqa: E402


def _row(name, **over):
    row = {
        "name": name,
        "close": 100.0,
        "price_earnings_ttm": 12.0,
        "price_sales_ratio": 1.0,
        "price_book_fq": 2.0,
        "return_on_equity_fq": 15.0,
        "market_cap_basic": 10e9,
        "free_cash_flow_ttm": 1e9,
        "price_52_week_high": 150.0,
        "score": 50.0,
    }
    row.update(over)
    return row


def _legacy_order(rows, sort):
    """The previous implementation, kept here as the reference."""
    shaped = [(_shape_row(r), r) for r in rows]

    def _key(pair):
        s, _ = pair
        if sort == "pe":
            v = s.get("pe")
            return (v is None, v if v is not None else 0.0)
        if sort == "fcf_yield":
            v = s.get("fcf_yield")
            return (v is None, -(v if v is not None else 0.0))
        if sort == "roe":
            v = s.get("roe")
            return (v is None, -(v if v is not None else 0.0))
        if sort == "dist_52w":
            v = s.get("off_52w_high")
            return (v is None, v if v is not None else 0.0)
        v = s.get("score")
        return (v is None, -(v if v is not None else 0.0))

    shaped.sort(key=_key)
    return [raw for _, raw in shaped]


def _frame():
    return [
        _row("A", price_earnings_ttm=8.0, return_on_equity_fq=30.0, score=90.0),
        _row("B", price_earnings_ttm=25.0, return_on_equity_fq=5.0, score=10.0),
        _row("C", price_earnings_ttm=12.0, return_on_equity_fq=15.0, score=50.0),
        _row("D", price_earnings_ttm=None, return_on_equity_fq=None, score=None),
        _row("E", price_earnings_ttm=8.0, return_on_equity_fq=30.0, score=90.0),
    ]


def test_sort_order_matches_the_previous_implementation():
    for sort in ("score", "pe", "fcf_yield", "roe", "dist_52w"):
        rows = _frame()
        assert [r["name"] for r in _apply_sort(rows, sort)] == [
            r["name"] for r in _legacy_order(rows, sort)
        ], sort


def test_sort_returns_the_raw_rows_untouched():
    rows = _frame()
    out = _apply_sort(rows, "score")
    assert all(r in rows for r in out)
    assert out[0]["name"] in {r["name"] for r in rows}
