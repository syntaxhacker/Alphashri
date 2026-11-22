"""Structural guards for the test tree.

Pure filesystem/AST checks: no app imports, no Docker, no network. Playwright
specs are detected by their explicit ``@playwright/test`` import, because a
vitest guard in ``src/`` also uses the ``.spec.ts`` suffix (colorHygiene.spec.ts).
"""

from __future__ import annotations

import ast
import os
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

PRUNED_DIRS = {
    ".git", ".venv", "node_modules", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", "htmlcov", "dist", "build",
    "playwright-report", "test-results", "reports", "backups", "logs", "data",
}

# pytest.ini sets `testpaths = tests`, so these standalone test files are never
# collected by the CI suite. They are legitimate, intentional exceptions.
LEGACY_PYTHON_TEST_ROOTS = {
    "experiments": "research experiments run explicitly",
    "scripts": "standalone tool self-checks",
    "edge_scanner_tv": "separate tool with its own tests/ directory",
    ".prime": "agent skill tests, run explicitly",
}

PLAYWRIGHT_IMPORT_RE = re.compile(
    r"""(?:from\s*['"](?:@playwright/test|playwright/test)['"]"""
    r"""|require\(\s*['"](?:@playwright/test|playwright/test)['"]\s*\))"""
)

# A file is a Playwright spec when it imports the *test runner binding*, whatever
# its suffix. playwright.config.ts imports defineConfig and shared mocks import
# only Page types, so neither is a spec. The braces span newlines on purpose.
PLAYWRIGHT_TEST_RUNNER_RE = re.compile(
    r"""\bimport\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"](?:@playwright/test|playwright/test)['"]"""
    r"""|\bconst\s*\{[^}]*\btest\b[^}]*\}\s*=\s*require\s*\(\s*['"](?:@playwright/test|playwright/test)['"]\s*\)"""
)

# Module specifiers in TS/TSX: `from "..."`, `import("...")`, `require("...")`,
# and bare `import "..."`. Resolving relative specifiers avoids a filename scan.
TS_MODULE_SPECIFIER_RE = re.compile(
    r"""(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]"""
)

LEGACY_HELPERS_DIR = Path("tests") / "helpers"
LEGACY_HELPERS_SPECIFIER_RE = re.compile(r"(?:^|/)tests/helpers(?:/|$)")

# Known exceptions, keyed by repo-relative POSIX path. Adding an entry is a
# promise to remove it once the stray file is moved; keep these sets empty unless
# a legacy import is deliberately retained (see TEST_RULES.md §4).
PLAYWRIGHT_SPEC_ALLOWLIST: set[str] = set()
LEGACY_HELPER_IMPORT_ALLOWLIST: set[str] = set()
E2E_UNIT_STYLE_ALLOWLIST: set[str] = set()


def _walk_files(root: Path, suffix: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in PRUNED_DIRS]
        for name in filenames:
            if name.endswith(suffix):
                yield Path(dirpath) / name


def _is_playwright_spec(path: Path) -> bool:
    try:
        source = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return bool(PLAYWRIGHT_IMPORT_RE.search(source))


def _defines_pytest_tests(path: Path) -> bool:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"), filename=str(path))
    except (OSError, SyntaxError, ValueError):
        return False
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
            return True
        if isinstance(node, ast.ClassDef) and node.name.startswith("Test"):
            return True
    return False


def _playwright_specs_outside_e2e(root: Path) -> list[Path]:
    e2e = (root / "tests" / "e2e").resolve()
    return [
        path for path in _walk_files(root, ".spec.ts")
        if _is_playwright_spec(path) and e2e not in path.resolve().parents
    ]


def _misplaced_python_tests(root: Path) -> list[Path]:
    offenders = []
    for path in _walk_files(root, ".py"):
        if not path.name.startswith("test_"):
            continue
        parts = path.relative_to(root).parts
        if parts[0] == "tests" or parts[0] in LEGACY_PYTHON_TEST_ROOTS:
            continue
        if _defines_pytest_tests(path):
            offenders.append(path)
    return offenders


def _relative(paths: list[Path], root: Path) -> list[str]:
    return sorted(path.relative_to(root).as_posix() for path in paths)


def _imports_playwright_runner(path: Path) -> bool:
    try:
        source = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return bool(PLAYWRIGHT_TEST_RUNNER_RE.search(source))


def _playwright_runner_specs_outside_e2e(root: Path) -> list[Path]:
    e2e = (root / "tests" / "e2e").resolve()
    offenders = []
    for suffix in (".ts", ".tsx", ".js", ".mjs", ".cjs"):
        for path in _walk_files(root, suffix):
            if path.relative_to(root).as_posix() in PLAYWRIGHT_SPEC_ALLOWLIST:
                continue
            if e2e in path.resolve().parents:
                continue
            if _imports_playwright_runner(path):
                offenders.append(path)
    return offenders


def _imports_legacy_helpers(path: Path, root: Path) -> bool:
    try:
        source = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    legacy = (root / LEGACY_HELPERS_DIR).resolve()
    for specifier in TS_MODULE_SPECIFIER_RE.findall(source):
        if specifier.startswith("."):
            target = (path.parent / specifier).resolve()
            if target == legacy or legacy in target.parents:
                return True
        elif LEGACY_HELPERS_SPECIFIER_RE.search(specifier):
            return True
    return False


def _ts_files_importing_legacy_helpers(root: Path) -> list[Path]:
    offenders = []
    for suffix in (".ts", ".tsx"):
        for path in _walk_files(root, suffix):
            if path.relative_to(root).as_posix() in LEGACY_HELPER_IMPORT_ALLOWLIST:
                continue
            if _imports_legacy_helpers(path, root):
                offenders.append(path)
    return offenders


def _e2e_unit_style_files(root: Path) -> list[Path]:
    e2e = root / "tests" / "e2e"
    if not e2e.is_dir():
        return []
    found = list(_walk_files(e2e, ".test.ts")) + list(_walk_files(e2e, ".test.tsx"))
    return [
        path for path in found
        if path.relative_to(root).as_posix() not in E2E_UNIT_STYLE_ALLOWLIST
    ]


def test_playwright_specs_live_under_tests_e2e():
    offenders = _relative(_playwright_specs_outside_e2e(REPO_ROOT), REPO_ROOT)
    assert not offenders, (
        "Playwright specs must live under tests/e2e/ (playwright.config.ts testDir); "
        f"found: {offenders}"
    )


def test_python_tests_live_under_tests_root():
    offenders = _relative(_misplaced_python_tests(REPO_ROOT), REPO_ROOT)
    assert not offenders, (
        "pytest collects testpaths=tests; new Python tests belong there (legacy "
        f"roots are documented in LEGACY_PYTHON_TEST_ROOTS); found: {offenders}"
    )


def test__playwright_detection_ignores_vitest_guard(tmp_path):
    spec = tmp_path / "colorHygiene.spec.ts"
    spec.write_text('import { describe, it, expect } from "vitest";\ndescribe("guard", () => {});\n')
    assert not _is_playwright_spec(spec)


def test__playwright_detection_accepts_import_variants(tmp_path):
    for source in (
        'import { test, expect } from "@playwright/test";\ntest("x", async () => {});\n',
        "const { test } = require('playwright/test');\n",
    ):
        spec = tmp_path / "stray.spec.ts"
        spec.write_text(source)
        assert _is_playwright_spec(spec), source
        spec.unlink()


def test__layout_helpers_catch_strays_and_allow_known_roots(tmp_path):
    (tmp_path / "tests" / "e2e").mkdir(parents=True)
    (tmp_path / "tests" / "e2e" / "app.spec.ts").write_text(
        'import { test } from "@playwright/test";\n'
    )
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "stray.spec.ts").write_text(
        'import { test } from "@playwright/test";\n'
    )
    (tmp_path / "src" / "vitestGuard.spec.ts").write_text(
        'import { test } from "vitest";\n'
    )
    (tmp_path / "api").mkdir()
    (tmp_path / "api" / "test_new.py").write_text("def test_thing():\n    assert True\n")
    (tmp_path / "experiments").mkdir()
    (tmp_path / "experiments" / "test_research.py").write_text(
        "def test_research():\n    assert True\n"
    )
    (tmp_path / "manual_check.py").write_text("print('not a pytest test')\n")

    assert _relative(_playwright_specs_outside_e2e(tmp_path), tmp_path) == ["src/stray.spec.ts"]
    assert _relative(_misplaced_python_tests(tmp_path), tmp_path) == ["api/test_new.py"]


def test_playwright_runner_imports_live_under_tests_e2e():
    offenders = _relative(_playwright_runner_specs_outside_e2e(REPO_ROOT), REPO_ROOT)
    assert not offenders, (
        "Files importing the Playwright test runner are specs and belong under "
        f"tests/e2e/; found: {offenders}"
    )


def test_no_ts_file_imports_legacy_tests_helpers_tree():
    offenders = _relative(_ts_files_importing_legacy_helpers(REPO_ROOT), REPO_ROOT)
    assert not offenders, (
        "TypeScript E2E helpers have one canonical tree, tests/e2e/helpers/ (see "
        f"its README); imports of legacy tests/helpers/ found in: {offenders}"
    )


def test_e2e_has_no_unit_style_test_files():
    offenders = _relative(_e2e_unit_style_files(REPO_ROOT), REPO_ROOT)
    assert not offenders, (
        "E2E uses *.spec.ts; *.test.ts(x) are vitest unit specs and belong beside "
        f"the source under src/; found: {offenders}"
    )


def test__playwright_runner_detection_ignores_configs_and_type_only_imports(tmp_path):
    (tmp_path / "tests" / "e2e").mkdir(parents=True)
    spec = tmp_path / "tests" / "e2e" / "app.spec.ts"
    spec.write_text('import { test, expect } from "@playwright/test";\ntest("x", async () => {});\n')
    assert _imports_playwright_runner(spec)

    multiline = tmp_path / "tests" / "e2e" / "multi.spec.ts"
    multiline.write_text('import {\n  test,\n  expect,\n} from "@playwright/test";\n')
    assert _imports_playwright_runner(multiline)

    cjs = tmp_path / "legacy.spec.js"
    cjs.write_text("const { test } = require('playwright/test');\n")
    assert _imports_playwright_runner(cjs)

    config = tmp_path / "playwright.config.ts"
    config.write_text("import { defineConfig, devices } from '@playwright/test';\n")
    assert not _imports_playwright_runner(config)

    types_only = tmp_path / "types.ts"
    types_only.write_text('import type { Page } from "@playwright/test";\n')
    assert not _imports_playwright_runner(types_only)

    dynamic_type = tmp_path / "mock.ts"
    dynamic_type.write_text('export function f(p: import("@playwright/test").Page) {}\n')
    assert not _imports_playwright_runner(dynamic_type)

    vitest_unit = tmp_path / "unit.test.ts"
    vitest_unit.write_text('import { describe, it } from "vitest";\n')
    assert not _imports_playwright_runner(vitest_unit)


def test__legacy_helper_import_detection_resolves_relative_paths(tmp_path):
    (tmp_path / "tests" / "e2e").mkdir(parents=True)

    canonical = tmp_path / "tests" / "e2e" / "app.spec.ts"
    canonical.write_text('import { gotoChart } from "./helpers/chartHelpers";\n')
    assert not _imports_legacy_helpers(canonical, tmp_path)

    relative = tmp_path / "tests" / "e2e" / "stray.spec.ts"
    relative.write_text('import { x } from "../helpers/chartHelpers";\n')
    assert _imports_legacy_helpers(relative, tmp_path)

    (tmp_path / "src").mkdir()
    cross_tree = tmp_path / "src" / "cross.ts"
    cross_tree.write_text('import { db } from "../tests/helpers/db";\n')
    assert _imports_legacy_helpers(cross_tree, tmp_path)

    aliased = tmp_path / "src" / "aliased.tsx"
    aliased.write_text('const { db } = require("@/tests/helpers/db");\n')
    assert _imports_legacy_helpers(aliased, tmp_path)


def test__new_layout_helpers_catch_strays_in_one_tree(tmp_path):
    e2e = tmp_path / "tests" / "e2e"
    (e2e / "helpers").mkdir(parents=True)
    (tmp_path / "src").mkdir()

    (e2e / "app.spec.ts").write_text('import { test } from "@playwright/test";\n')
    (e2e / "unit.test.ts").write_text('import { describe } from "vitest";\n')
    (tmp_path / "src" / "stray.spec.ts").write_text(
        'import { test } from "@playwright/test";\n'
    )
    (tmp_path / "src" / "legacy.ts").write_text(
        'import { db } from "../tests/helpers/db";\n'
    )

    assert _relative(_playwright_runner_specs_outside_e2e(tmp_path), tmp_path) == [
        "src/stray.spec.ts"
    ]
    assert _relative(_ts_files_importing_legacy_helpers(tmp_path), tmp_path) == [
        "src/legacy.ts"
    ]
    assert _relative(_e2e_unit_style_files(tmp_path), tmp_path) == [
        "tests/e2e/unit.test.ts"
    ]
