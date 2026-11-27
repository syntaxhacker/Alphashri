"""Static contract between the TV scanner profile table and the UI profile metadata.

``SCREENER_PROFILES`` (``scanners/trending_upside.py``) owns the TV query config,
while ``PROFILE_META`` (``api/screener_api/screener_models.py``) owns the UI
labels/filters. They are parsed with ``ast`` rather than imported: the TV scanner
pulls in ``tradingview_screener`` and other optional deps that are absent in CI,
and importing the API package would drag in the FastAPI app.

The two layers intentionally do not carry the same ``columns``: the UI reads its
columns from ``get_screener_profiles()`` (which is built from ``SCREENER_PROFILES``),
and ``PROFILE_META`` only repeats ``default_sort``. So this module asserts the
required domain keys in the union of both column maps, not map equality.
"""

from __future__ import annotations

import ast
import copy
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]

TV_SOURCE = PROJECT_ROOT.parent / "scanners" / "trending_upside.py"
UI_SOURCE = PROJECT_ROOT / "api" / "screener_api" / "screener_models.py"
BUCKETS_SOURCE = PROJECT_ROOT / "trading" / "week52" / "config.py"

REQUIRED_52W_PROFILES = frozenset({"52w_high", "near_52w_breakout", "touched_52w_high"})

# UI-only profile: ``intraday_momentum`` is a UI aggregation selector, not a TV
# scanner profile. screener_scan.py maps it onto the 15-minute TV data path
# (``'intraday_momentum': 'move_15m'``), so it legitimately has no TV query row.
UI_ONLY_PROFILES = frozenset({"intraday_momentum"})

# Domain keys that must survive a profile rename in the TV/UI column contract.
# These are checked in the union of both column maps because PROFILE_META does
# not declare ``columns`` today (see module docstring).
REQUIRED_COLUMNS = {
    "52w_high": frozenset({"symbol", "touched_52w", "to_52w_high", "days_ago", "high_52w"}),
    "near_52w_breakout": frozenset({"symbol", "to_52w_high", "rsi", "adx"}),
    "touched_52w_high": frozenset({"symbol", "days_ago", "high_52w", "recent_return_5d"}),
}


def _module_assignment(path: Path, name: str) -> ast.AST:
    """Return the single top-level assignment value for ``name`` in ``path``."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in tree.body:
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        else:
            continue
        if any(isinstance(target, ast.Name) and target.id == name for target in targets):
            found.append(node.value)
    assert len(found) == 1, f"{path}: expected exactly one {name} assignment, got {len(found)}"
    return found[0]


def _literal_fields(node: ast.AST) -> dict:
    """Extract literal key/value pairs, skipping non-literal config expressions.

    ``SCREENER_PROFILES['*']['query']['filters']`` contains ``Column(...) >= N``
    expressions, which ``ast.literal_eval`` cannot evaluate. Only the literal
    profile fields (id, label, columns, default_sort, ...) are relevant here.
    """
    assert isinstance(node, ast.Dict), f"expected a dict literal, got {type(node).__name__}"
    fields = {}
    for key_node, value_node in zip(node.keys, node.values):
        if key_node is None:
            continue
        try:
            key = ast.literal_eval(key_node)
        except (ValueError, TypeError, SyntaxError):
            continue
        try:
            value = ast.literal_eval(value_node)
        except (ValueError, TypeError, SyntaxError):
            if isinstance(value_node, ast.Dict):
                value = _literal_fields(value_node)
            else:
                continue
        fields[key] = value
    return fields


def _load_profiles(path: Path, name: str) -> dict:
    profiles = _literal_fields(_module_assignment(path, name))
    assert profiles, f"{path}: no profile rows parsed from {name}"
    return profiles


TV_PROFILES = _load_profiles(TV_SOURCE, "SCREENER_PROFILES")
PROFILE_META = _load_profiles(UI_SOURCE, "PROFILE_META")
PROFILES_WITH_52W_BUCKETS = ast.literal_eval(_module_assignment(BUCKETS_SOURCE, "PROFILES_WITH_52W_BUCKETS"))
assert isinstance(PROFILES_WITH_52W_BUCKETS, (set, frozenset)), "bucket set must be a set literal"

# Every bucket profile is a 52W profile, so it shares the sort contract too.
SORTED_PROFILES = REQUIRED_52W_PROFILES | PROFILES_WITH_52W_BUCKETS


def _assert_profile_id_contract(tv, ui, ui_only, buckets):
    for profile in sorted(REQUIRED_52W_PROFILES):
        assert profile in tv, f"SCREENER_PROFILES missing 52W profile {profile!r}"
        assert profile in ui, f"PROFILE_META missing 52W profile {profile!r}"
    for profile in sorted(buckets):
        assert profile in tv, f"PROFILES_WITH_52W_BUCKETS id {profile!r} missing from SCREENER_PROFILES"
        assert profile in ui, f"PROFILES_WITH_52W_BUCKETS id {profile!r} missing from PROFILE_META"
    missing_from_tv = sorted(set(ui) - set(tv) - set(ui_only))
    assert not missing_from_tv, f"PROFILE_META ids missing from SCREENER_PROFILES: {missing_from_tv}"


def _assert_sort_contract(tv, ui, profiles):
    for profile in sorted(profiles):
        tv_sort = tv[profile].get("default_sort")
        ui_sort = ui[profile].get("default_sort")
        assert tv_sort == ui_sort, (
            f"default_sort drift for {profile!r}: TV={tv_sort!r}, UI={ui_sort!r}"
        )
        assert isinstance(tv_sort, dict) and {"column", "direction"} <= set(tv_sort), (
            f"{profile!r} default_sort must declare column and direction: {tv_sort!r}"
        )


def _assert_columns_contract(tv, ui, required):
    for profile, keys in sorted(required.items()):
        tv_columns = frozenset(tv[profile].get("columns") or ())
        ui_columns = frozenset(ui[profile].get("columns") or ())
        assert tv_columns, f"SCREENER_PROFILES[{profile!r}] has no columns"
        union = tv_columns | ui_columns
        missing = sorted(keys - union)
        assert not missing, f"{profile!r} column contract missing keys {missing}; union={sorted(union)}"
        sort_column = tv[profile]["default_sort"]["column"]
        assert sort_column in union, (
            f"{profile!r} default_sort column {sort_column!r} is not a declared column"
        )


def test_static_parsers_find_both_tables_and_bucket_set():
    assert len(TV_PROFILES) == 17
    assert len(PROFILE_META) == 18
    assert len(PROFILES_WITH_52W_BUCKETS) == 4
    assert set(TV_PROFILES) == set(PROFILE_META) - UI_ONLY_PROFILES
    assert not UI_ONLY_PROFILES & set(TV_PROFILES)


def test_every_ui_profile_id_is_declared_in_tv_or_allowlisted():
    _assert_profile_id_contract(TV_PROFILES, PROFILE_META, UI_ONLY_PROFILES, PROFILES_WITH_52W_BUCKETS)


def test_52w_profiles_exist_in_both_layers():
    for profile in sorted(REQUIRED_52W_PROFILES):
        assert profile in TV_PROFILES
        assert profile in PROFILE_META


def test_bucket_profiles_are_subset_of_both_layers():
    assert PROFILES_WITH_52W_BUCKETS <= set(TV_PROFILES)
    assert PROFILES_WITH_52W_BUCKETS <= set(PROFILE_META)


def test_52w_default_sort_matches_across_layers():
    _assert_sort_contract(TV_PROFILES, PROFILE_META, SORTED_PROFILES)


def test_52w_column_contract_holds_required_keys():
    _assert_columns_contract(TV_PROFILES, PROFILE_META, REQUIRED_COLUMNS)


def test_negative_renamed_ui_profile_id_fails():
    mutated = copy.deepcopy(PROFILE_META)
    mutated["price_surge_v2"] = mutated.pop("price_surge")
    with pytest.raises(AssertionError, match="missing from SCREENER_PROFILES"):
        _assert_profile_id_contract(TV_PROFILES, mutated, UI_ONLY_PROFILES, PROFILES_WITH_52W_BUCKETS)


def test_negative_renamed_tv_52w_profile_fails():
    mutated = copy.deepcopy(TV_PROFILES)
    mutated["52w_high_v2"] = mutated.pop("52w_high")
    with pytest.raises(AssertionError, match="SCREENER_PROFILES missing 52W profile"):
        _assert_profile_id_contract(mutated, PROFILE_META, UI_ONLY_PROFILES, PROFILES_WITH_52W_BUCKETS)


@pytest.mark.parametrize("layer", ["tv", "ui"])
def test_negative_missing_52w_profile_fails(layer):
    mutated_tv = copy.deepcopy(TV_PROFILES)
    mutated_ui = copy.deepcopy(PROFILE_META)
    if layer == "tv":
        mutated_tv.pop("touched_52w_high")
    else:
        mutated_ui.pop("touched_52w_high")
    with pytest.raises(AssertionError, match="missing 52W profile"):
        _assert_profile_id_contract(mutated_tv, mutated_ui, UI_ONLY_PROFILES, PROFILES_WITH_52W_BUCKETS)


def test_negative_default_sort_drift_fails():
    mutated = copy.deepcopy(PROFILE_META)
    mutated["52w_high"]["default_sort"] = {"column": "to_52w_high", "direction": "desc"}
    with pytest.raises(AssertionError, match="default_sort drift"):
        _assert_sort_contract(TV_PROFILES, mutated, SORTED_PROFILES)


def test_negative_missing_required_column_fails():
    mutated = copy.deepcopy(TV_PROFILES)
    mutated["52w_high"]["columns"].remove("days_ago")
    with pytest.raises(AssertionError, match="column contract missing keys"):
        _assert_columns_contract(mutated, PROFILE_META, REQUIRED_COLUMNS)
