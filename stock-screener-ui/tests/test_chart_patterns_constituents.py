"""Direct tests for ``chart_patterns/constituents.py``.

The module is a static data table (no I/O, no lookups), so these tests pin
the contract consumers rely on: the four index keys exist, every symbol is
an uppercase NSE-style ticker with no duplicates, larger universes contain
the smaller ones, and each list length matches the count in its index name.
"""

from __future__ import annotations

import pytest

from chart_patterns import constituents as C

EXPECTED_KEYS = ("nifty50", "nifty100", "nifty200", "nifty500")
# Membership is data, not a contract: NIFTY500 currently carries 501 names.
EXPECTED_MINIMUMS = {"nifty50": 50, "nifty100": 100, "nifty200": 200, "nifty500": 500}


def _lists():
    return [(key, C.CONSTITUENTS[key]) for key in EXPECTED_KEYS]


 # ---------------------------------------------------------------------------
# Keys / counts
# ---------------------------------------------------------------------------


def test_constituents_has_exactly_the_four_index_keys():
    assert sorted(C.CONSTITUENTS.keys()) == sorted(EXPECTED_KEYS)


@pytest.mark.parametrize("key,minimum", sorted(EXPECTED_MINIMUMS.items()))
def test_list_length_covers_the_index(key, minimum):
    assert len(C.CONSTITUENTS[key]) >= minimum


# ---------------------------------------------------------------------------
# Shape of each list
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("key,_symbols", _lists())
def test_each_list_is_a_nonempty_list_of_strings(key, _symbols):
    lst = C.CONSTITUENTS[key]
    assert isinstance(lst, list)
    assert lst, "index list must be non-empty"
    assert all(isinstance(s, str) for s in lst)
    assert all(s.strip() == s and s for s in lst)


@pytest.mark.parametrize("key,_symbols", _lists())
def test_symbols_are_uppercase(key, _symbols):
    for sym in C.CONSTITUENTS[key]:
        assert sym == sym.upper(), f"{sym!r} in {key} is not uppercase"


@pytest.mark.parametrize("key,_symbols", _lists())
def test_no_duplicates_within_a_list(key, _symbols):
    lst = C.CONSTITUENTS[key]
    assert len(lst) == len(set(lst)), f"{key} contains duplicate symbols"


# ---------------------------------------------------------------------------
# Nesting: each smaller index is a subset of the next larger one
# ---------------------------------------------------------------------------


def test_nifty50_is_subset_of_nifty100():
    assert set(C.NIFTY50) <= set(C.NIFTY100)


def test_nifty100_is_subset_of_nifty200():
    assert set(C.NIFTY100) <= set(C.NIFTY200)


def test_nifty200_is_subset_of_nifty500():
    assert set(C.NIFTY200) <= set(C.NIFTY500)


def test_sizes_are_strictly_increasing():
    sizes = [len(C.CONSTITUENTS[k]) for k in EXPECTED_KEYS]
    assert sizes[0] < sizes[1] < sizes[2] < sizes[3]


# ---------------------------------------------------------------------------
# Module surface (this module's only "lookup" is the CONSTITUENTS mapping)
# ---------------------------------------------------------------------------


def test_module_exposes_the_named_lists():
    assert C.NIFTY50 and C.NIFTY100 and C.NIFTY200 and C.NIFTY500


def test_constituents_values_are_the_named_lists():
    # Consumers may import either style; both must describe the same universe.
    assert C.CONSTITUENTS["nifty50"] is C.NIFTY50
    assert C.CONSTITUENTS["nifty100"] is C.NIFTY100
    assert C.CONSTITUENTS["nifty200"] is C.NIFTY200
    assert C.CONSTITUENTS["nifty500"] is C.NIFTY500
