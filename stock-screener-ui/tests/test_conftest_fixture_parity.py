"""AST-only parity check for the API fixtures mirrored in the root conftest.

The ``tests/conftest.py`` "API-only fixtures (mirrored from
tests/api/conftest.py)" block exists because pytest may load only the first
explicit file argument's conftest chain. This guard compares fixture names,
dependencies and scope without importing app modules. It skips when either
source cannot be parsed or the marker is ambiguous.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
ROOT_CONFTEST = REPO_ROOT / "tests" / "conftest.py"
API_CONFTEST = REPO_ROOT / "tests" / "api" / "conftest.py"
SECTION_MARKER = "mirrored from tests/api/conftest.py"

# Keep in sync with the mirrored block in tests/conftest.py. Comparing every
# shared name would be wrong: e.g. `test_user` intentionally has a different
# signature in each conftest.
MIRRORED_FIXTURES = ("test_engine", "db", "auth_client")


@dataclass(frozen=True)
class FixtureSig:
    name: str
    args: tuple[str, ...]
    scope: str | None


def _dotted(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_dotted(node.value)}.{node.attr}"
    return ""


def _fixture_decorator(node: ast.FunctionDef | ast.AsyncFunctionDef) -> ast.AST | None:
    for decorator in node.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        if _dotted(target) in {"pytest.fixture", "fixture"}:
            return decorator
    return None


def _keyword(decorator: ast.AST, key: str) -> ast.AST | None:
    if isinstance(decorator, ast.Call):
        return next((kw.value for kw in decorator.keywords if kw.arg == key), None)
    return None


def _string(node: ast.AST | None) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def _fixtures(tree: ast.Module) -> dict[str, FixtureSig]:
    fixtures: dict[str, FixtureSig] = {}
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        decorator = _fixture_decorator(node)
        if decorator is None:
            continue
        alias = _string(_keyword(decorator, "name"))
        name = alias or node.name
        args = tuple(
            arg.arg
            for group in (node.args.posonlyargs, node.args.args, node.args.kwonlyargs)
            for arg in group
        )
        scope_node = _keyword(decorator, "scope")
        scope = "function" if scope_node is None else _string(scope_node)
        fixtures[name] = FixtureSig(name, args, scope)
    return fixtures


def _mismatches(
    root_fixtures: dict[str, FixtureSig],
    api_fixtures: dict[str, FixtureSig],
    names: tuple[str, ...],
) -> list[str]:
    problems = []
    for name in names:
        root = root_fixtures.get(name)
        api = api_fixtures.get(name)
        if root is None:
            problems.append(f"{name}: missing from tests/conftest.py")
        elif api is None:
            problems.append(f"{name}: missing from tests/api/conftest.py")
        elif root != api:
            problems.append(f"{name}: root {root} != api {api}")
    return problems


def test_mirrored_fixtures_match_api_conftest():
    try:
        root_source = ROOT_CONFTEST.read_text(encoding="utf-8")
        api_source = API_CONFTEST.read_text(encoding="utf-8")
    except OSError as exc:
        pytest.skip(f"conftest source unavailable: {exc}")
    if SECTION_MARKER not in root_source:
        pytest.skip("mirrored-fixture section marker changed; comparison is ambiguous")
    try:
        root_tree = ast.parse(root_source, filename=str(ROOT_CONFTEST))
        api_tree = ast.parse(api_source, filename=str(API_CONFTEST))
    except SyntaxError as exc:
        pytest.skip(f"conftest source is not parseable: {exc}")

    root_fixtures = _fixtures(root_tree)
    api_fixtures = _fixtures(api_tree)
    compared = [(name, root_fixtures.get(name), api_fixtures.get(name)) for name in MIRRORED_FIXTURES]
    if any(sig is not None and sig.scope is None for _, root, api in compared for sig in (root, api)):
        pytest.skip("dynamic fixture scope cannot be compared statically")

    problems = _mismatches(root_fixtures, api_fixtures, MIRRORED_FIXTURES)
    assert not problems, (
        "tests/conftest.py mirrors a subset of tests/api/conftest.py; update both "
        f"when either changes:\n  " + "\n  ".join(problems)
    )


def test__fixture_signatures_extract_name_dependencies_and_scope():
    tree = ast.parse(
        "import pytest\n"
        "@pytest.fixture(scope='session', name='alias')\n"
        "def _impl(test_engine, *, flag=True):\n    yield test_engine\n"
    )
    assert _fixtures(tree)["alias"] == FixtureSig("alias", ("test_engine", "flag"), "session")


def test__parity_helper_flags_missing_and_changed_fixtures():
    root = {
        "test_engine": FixtureSig("test_engine", (), "function"),
        "db": FixtureSig("db", ("test_engine",), "function"),
        "auth_client": FixtureSig("auth_client", ("db",), "function"),
    }
    api = {
        "test_engine": FixtureSig("test_engine", (), "function"),
        "db": FixtureSig("db", ("other_engine",), "function"),
    }
    problems = _mismatches(root, api, MIRRORED_FIXTURES)
    assert len(problems) == 2
    assert any("missing from tests/api/conftest.py" in problem for problem in problems)
    assert any(problem.startswith("db: root ") for problem in problems)
