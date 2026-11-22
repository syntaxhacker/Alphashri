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
