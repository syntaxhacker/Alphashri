"""Single-source guards for numeric coercion.

``common/numbers.py`` owns the bodies. api.utils, trading.week52.math, agri,
TV prefilter and the sync script only re-export or delegate to them.
"""
from __future__ import annotations

import ast
import importlib
import subprocess
import sys
from pathlib import Path

import pytest

import common.numbers as numbers

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CANONICAL_PATH = "common/numbers.py"
CANONICAL_MODULE = "common.numbers"
TARGET_NAMES = {"to_float", "optional_float", "finite_or_none"}
# These spellings used to evade TARGET_NAMES entirely: seven of the audited
# modules owned a real float() body under one of them.
EVASIVE_NAMES = {"_f", "safe_float", "_to_float", "float_or_none"}
VARIANT_NAMES = {
    "strict_float", "float_or_default", "nan_guarded_float", "strict_optional_float",
}
PRODUCTION_PATHS = (
    "common", "api", "trading", "chart_patterns", "scripts",
    "options_paper", "edge_scanner_tv",
)
# research/one-off scripts are analysis-only (AGENTS.md); their private _f
# clones are a separate cleanup. The canonical-name scan above still covers
# every production path, scripts included.
EVASIVE_SCAN_PATHS = tuple(p for p in PRODUCTION_PATHS if p != "scripts")
# Each audited module binds its old helper name to one canonical helper object.
AUDITED_ALIASES = {
    "chart_patterns/candles.py": ("_f", "to_float"),
    "api/options_screener.py": ("_f", "strict_float"),
    "api/broker_hub/adapters/fyers.py": ("_f", "float_or_default"),
    "api/options_levels.py": ("_f", "to_float"),
    "api/reports_api/_numeric.py": ("safe_float", "to_float"),
    "options_paper/tape.py": ("_f", "to_float"),
    "edge_scanner_tv/tv_feed.py": ("_f", "nan_guarded_float"),
    "chart_patterns/tv_prefilter.py": ("_to_float", "strict_optional_float"),
}
# aggregate.to_float is the one documented wrapper: it keeps the nullable
# semantics its callers already rely on while delegating to the canonical body.
# Values map the local wrapper name to the canonical helper it delegates to.
DELEGATING_WRAPPERS = {"api/agri/aggregate.py": ("to_float", "optional_float")}


class _BadFloat:
    def __float__(self):
        raise RuntimeError("boom")


NAN = float("nan")
INF = float("inf")


def _tree(rel: str) -> ast.Module:
    return ast.parse((PROJECT_ROOT / rel).read_text(encoding="utf-8"), filename=rel)


def _production_modules(paths: tuple[str, ...] = PRODUCTION_PATHS) -> list[tuple[str, Path]]:
    modules = []
    for rel in paths:
        for file in sorted((PROJECT_ROOT / rel).rglob("*.py")):
            parts = file.relative_to(PROJECT_ROOT).parts
            if {"__pycache__", "tests"} & set(parts):
                continue
            modules.append(("/".join(parts), file))
    return modules


def _definitions(tree: ast.AST) -> dict[str, ast.FunctionDef | ast.AsyncFunctionDef]:
    return {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _canonical_aliases(tree: ast.AST, name: str) -> set[str]:
    return {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == CANONICAL_MODULE
        for alias in node.names
        if alias.name == name
    }


def _is_thin_delegation(tree: ast.AST, func: ast.AST, name: str) -> bool:
    body = [
        node for node in func.body
        if not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str))
    ]
    if len(body) != 1 or not isinstance(body[0], ast.Return):
        return False
    aliases = _canonical_aliases(tree, name)
    value = body[0].value
    if isinstance(value, ast.Call):
        return isinstance(value.func, ast.Name) and value.func.id in aliases
    return isinstance(value, ast.Name) and value.id in aliases


def _top_level_definitions(tree: ast.AST) -> dict[str, ast.FunctionDef | ast.AsyncFunctionDef]:
    return {
        node.name: node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _delegates_to_import(tree: ast.AST, func: ast.AST) -> bool:
    """A single return forwarding to an imported helper owns no coercion rule."""
    body = [
        node for node in func.body
        if not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str))
    ]
    if len(body) != 1 or not isinstance(body[0], ast.Return):
        return False
    value = body[0].value
    if not isinstance(value, ast.Call) or not isinstance(value.func, ast.Name):
        return False
    imported = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }
    return value.func.id in imported


class TestSingleSource:
    def test_canonical_module_owns_the_bodies(self):
        tree = _tree(CANONICAL_PATH)
        assert {"to_float", "optional_float"} | VARIANT_NAMES <= set(_definitions(tree))
        alias_names = {
            target.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Name)
        }
        assert "finite_or_none" in alias_names
        assert numbers.finite_or_none is numbers.optional_float

    def test_no_duplicate_definitions_outside_canonical_module(self):
        found: dict[str, list[str]] = {}
        for rel, _ in _production_modules():
            if rel == CANONICAL_PATH:
                continue
            names = TARGET_NAMES & set(_definitions(_tree(rel)))
            if names:
                found[rel] = sorted(names)
        assert found == {"api/agri/aggregate.py": ["to_float"]}, (
            f"numeric helper bodies outside {CANONICAL_PATH}: {found}"
        )

    def test_no_local_float_bodies_under_evasive_names(self):
        found: dict[str, list[str]] = {}
        for rel, _ in _production_modules(EVASIVE_SCAN_PATHS):
            if rel == CANONICAL_PATH:
                continue
            tree = _tree(rel)
            defs = EVASIVE_NAMES & set(_top_level_definitions(tree))
            bodies = sorted(
                name for name in defs
                if not _delegates_to_import(tree, _top_level_definitions(tree)[name])
            )
            if bodies:
                found[rel] = bodies
        assert found == {}, f"local float coercion under evasive names: {found}"

    @pytest.mark.parametrize("rel,names", sorted(AUDITED_ALIASES.items()))
    def test_evasive_names_are_canonical_object_aliases(self, rel, names):
        local_name, canonical_name = names
        tree = _tree(rel)
        assert local_name not in _top_level_definitions(tree), rel
        module = importlib.import_module(rel.removesuffix(".py").replace("/", "."))
        assert getattr(module, local_name) is getattr(numbers, canonical_name), rel

    @pytest.mark.parametrize("rel,names", sorted(DELEGATING_WRAPPERS.items()))
    def test_allowed_wrapper_only_delegates(self, rel, names):
        name, canonical_name = names
        tree = _tree(rel)
        assert _is_thin_delegation(tree, _definitions(tree)[name], canonical_name)

    def test_legacy_names_are_object_aliases(self):
        import api.utils as utils
        from scripts import sync_refresh_assets as sync
        from trading.week52 import math as week52_math

        assert utils._to_float is numbers.to_float
        assert utils.optional_float is numbers.optional_float
        assert utils.finite_or_none is numbers.finite_or_none
        assert week52_math._to_float is numbers.to_float
        assert sync._to_float is numbers.optional_float

    def test_canonical_module_imports_only_stdlib(self):
        modules = set()
        for node in ast.walk(_tree(CANONICAL_PATH)):
            if isinstance(node, ast.Import):
                modules.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                modules.add(node.module.split(".")[0])
        assert modules <= {"math", "typing"}, modules

    def test_import_is_db_free_in_fresh_interpreter(self):
        code = """
import sys
import common.numbers as numbers
assert numbers.to_float(None) == 0.0
for name in ("api", "db", "trading", "numpy", "pandas"):
    assert name not in sys.modules, name
"""
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr


class TestToFloatBehavior:
    @pytest.mark.parametrize("value,expected", [
        (None, 0.0), ("", 0.0), ("x", 0.0), (object(), 0.0), (_BadFloat(), 0.0),
        (NAN, 0.0), (INF, 0.0), (-INF, 0.0),
        (True, 1.0), (False, 0.0), (0, 0.0), ("1.5", 1.5), (-2.5, -2.5),
    ])
    def test_finite_values_and_default_substitution(self, value, expected):
        assert numbers.to_float(value) == expected

    @pytest.mark.parametrize("value", [
        None, "", "x", object(), _BadFloat(), NAN, INF, -INF,
    ])
    def test_custom_default_is_returned_for_missing_or_invalid(self, value):
        assert numbers.to_float(value, default=0.25) == 0.25
        assert numbers.to_float(value, default=-1) == -1

    def test_valid_value_ignores_default(self):
        assert numbers.to_float(3.5, default=9) == 3.5


class TestOptionalFloatBehavior:
    @pytest.mark.parametrize("value,expected", [
        (None, None), ("", None), ("x", None), (object(), None),
        (NAN, None), (INF, None), (-INF, None),
        (True, 1.0), (False, 0.0), (0, 0.0), ("1.5", 1.5), (-2.5, -2.5),
    ])
    def test_nullable_coercion_matches_both_names(self, value, expected):
        assert numbers.optional_float(value) == expected
        assert numbers.finite_or_none(value) == expected

    @pytest.mark.parametrize("value", [True, False])
    def test_reject_bool_is_opt_in(self, value):
        assert numbers.optional_float(value, reject_bool=True) is None
        assert numbers.optional_float(value, reject_bool=False) == float(value)
        assert numbers.finite_or_none(value) == float(value)

    def test_zero_is_not_missing(self):
        assert numbers.optional_float(0, reject_bool=True) == 0.0
        assert numbers.finite_or_none(0) == 0.0


class TestCoercionVariants:
    @pytest.mark.parametrize("value,expected", [
        (None, 0.0), (True, 0.0), (False, 0.0), ("", 0.0), ("x", 0.0),
        (object(), 0.0), (_BadFloat(), 0.0), (NAN, 0.0), (INF, 0.0), (-INF, 0.0),
        (0, 0.0), ("1.5", 1.5), (-2.5, -2.5),
    ])
    def test_strict_float_rejects_bool_and_non_finite(self, value, expected):
        assert numbers.strict_float(value) == expected

    @pytest.mark.parametrize("value", [None, True, False, NAN, INF, -INF, "x"])
    def test_strict_float_custom_default_for_invalid(self, value):
        assert numbers.strict_float(value, default=0.25) == 0.25

    def test_strict_float_valid_value_ignores_default(self):
        assert numbers.strict_float("1.5", default=9) == 1.5
        assert numbers.strict_float(0, default=9) == 0.0

    @pytest.mark.parametrize("value,expected", [
        (None, 0.0), ("", 0.0), ("x", 0.0), (object(), 0.0), (_BadFloat(), 0.0),
        (True, 1.0), (False, 0.0), (NAN, NAN), (INF, INF), (-INF, -INF),
        ("1.5", 1.5), (-2.5, -2.5),
    ])
    def test_float_or_default_keeps_non_finite_and_bool(self, value, expected):
        out = numbers.float_or_default(value)
        if expected != expected:
            assert out != out
        else:
            assert out == expected
        assert numbers.float_or_default(None, default=-1.0) == -1.0

    @pytest.mark.parametrize("value,expected", [
        (None, 0.0), ("", 0.0), ("x", 0.0), (object(), 0.0), (_BadFloat(), 0.0),
        (NAN, 0.0), (INF, INF), (-INF, -INF),
        (True, 1.0), (False, 0.0), ("1.5", 1.5), (-2.5, -2.5),
    ])
    def test_nan_guarded_float_keeps_inf_but_drops_nan(self, value, expected):
        assert numbers.nan_guarded_float(value) == expected
        assert numbers.nan_guarded_float(None, default=-1.0) == -1.0

    @pytest.mark.parametrize("value,expected", [
        (None, None), (True, None), (False, None), ("", None), ("x", None),
        (NAN, None), (INF, None), (-INF, None),
        (0, 0.0), ("1.5", 1.5), (-2.5, -2.5),
    ])
    def test_strict_optional_float_matches_reject_bool_rule(self, value, expected):
        assert numbers.strict_optional_float(value) == expected
