"""Shared nullable numeric coercion used by agri aggregates and TV prefilter."""

import pytest

from api.utils import optional_float


@pytest.mark.parametrize("value", [
    None, "", "not-a-number", object(), float("nan"), float("inf"), float("-inf"),
])
def test_missing_and_non_finite_values_are_none(value):
    assert optional_float(value) is None


@pytest.mark.parametrize("value,expected", [
    (0, 0.0), ("12.5", 12.5), (-3, -3.0), (True, 1.0),
])
def test_finite_values_keep_their_numeric_value(value, expected):
    assert optional_float(value) == expected


def test_reject_bool_keeps_tv_placeholder_out():
    assert optional_float(True, reject_bool=True) is None
    assert optional_float(False, reject_bool=True) is None
    assert optional_float(0, reject_bool=True) == 0.0
