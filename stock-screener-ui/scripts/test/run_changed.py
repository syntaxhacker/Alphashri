"""Fast local runner for the backend tests affected by a diff.

This is a local convenience tool: it never replaces CI, starts servers, or
installs anything. It maps changed backend files to likely tests, drops the
heavy categories with CI's marker expression, then runs the remaining node ids
under pytest-xdist with a small worker count.

Usage (from the repo root or from stock-screener-ui/):
    .venv/bin/python scripts/test/run_changed.py --dry-run
    .venv/bin/python scripts/test/run_changed.py --list --from HEAD~1
    .venv/bin/python scripts/test/run_changed.py --paths api/replay_api.py
"""

from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_BASE_REF = "origin/develop"

# CI's PR gate uses an include filter that only sees marked tests (~660 of
# ~9,200). This runner maps mostly *unmarked* tests, so it uses CI's other
# selection: the exclusion expression from the same workflow. It drops exactly
# the heavy categories while keeping unmarked unit/API tests.
CI_FAST_MARKER = "unit and not slow"
CI_EXCLUDE_MARKER = (
    "not (slow or slow_testcontainers or integration or contract "
    "or e2e or testcontainers or postgres)"
)
DEFAULT_MARKER = CI_EXCLUDE_MARKER

CONTRACT_TEST = "tests/contract/test_openapi_sync.py"

# These paths are tagged by tests/conftest.py and/or pytest.ini norecursedirs;
# running them locally is slow and needs Docker or credentials.
EXCLUDED_TEST_DIRS = (
    "tests/integration/",
    "tests/contract/",
    "tests/e2e/",
    "tests/testcontainers/",
    "tests/needs_review/",
    "tests/backtest/",
    "tests/strategies/",
)

# Frontend/tool roots: this runner only understands backend Python tests.
IGNORED_SOURCE_DIRS = (
    "src/",
    "docs/",
    "changelog/",
    "scripts/",
    "experiments/",
    ".prime/",
    "node_modules/",
    "reports/",
    "backups/",
    "logs/",
    "data/",
    "dist/",
    "test_cases/",
)

FROM_IMPORT_RE = re.compile(
    r"^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+([A-Za-z_][\w,\s]*)"
)
IMPORT_RE = re.compile(r"^\s*import\s+([A-Za-z_][\w.]*)")
QUOTED_MODULE_RE = re.compile(r"""["']([A-Za-z_][\w]*(?:\.[\w]+)+)["']""")
ROUTE_RE = re.compile(
    r"APIRouter\s*\(|@(?:app|router|api_router)\."
    r"(?:get|post|put|patch|delete|head|options|websocket)\s*\("
)


class RunnerError(Exception):
    """Raised for a bad diff ref or an unusable filesystem root."""


@dataclass
class Selection:
    tests: list[str] = field(default_factory=list)
    forced: list[str] = field(default_factory=list)
    reasons: dict[str, list[str]] = field(default_factory=dict)
    skipped: dict[str, str] = field(default_factory=dict)
    unmapped: list[str] = field(default_factory=list)

    @property
    def node_ids(self) -> list[str]:
        return sorted(set(self.tests) | set(self.forced))

    @property
    def empty(self) -> bool:
        return not self.tests and not self.forced


def to_relative(raw: str, root: Path) -> str | None:
    """Accept absolute paths under the project without leaking them to git paths."""
    candidate = Path(raw.strip().replace("\\", "/"))
    if not candidate.is_absolute():
        return raw
    try:
        return candidate.relative_to(root).as_posix()
    except ValueError:
        return None


def normalize_path(raw: str, project_name: str | None = None) -> str | None:
    """Turn a git-style path into a project-relative POSIX path."""
    path = re.sub(r"/+", "/", raw.strip().replace("\\", "/"))
    while path.startswith("./"):
        path = path[2:]
    if not path or path.startswith(("../", "/")):
        return None
    parts = path.split("/")
    if project_name and len(parts) > 1 and parts[0] == project_name:
        path = "/".join(parts[1:])
    return path or None


def _test_files(root: Path) -> list[str]:
    tests_dir = root / "tests"
    if not tests_dir.is_dir():
        return []
    result = []
    for path in tests_dir.rglob("test_*.py"):
        rel = path.relative_to(root).as_posix()
        if "__pycache__" in path.parts or any(
            part in {".pytest_cache", "node_modules"} for part in path.parts
        ):
            continue
        result.append(rel)
    return sorted(result)


def is_excluded_test_path(path: str) -> bool:
    """Mirror the path-based tags from tests/conftest.py and pytest.ini."""
    if path.startswith(EXCLUDED_TEST_DIRS):
        return True
    # tests/api/test_news_integration.py is fully mocked and stays in the fast
    # tier; only root-level *_integration.py modules are path-tagged.
    return (
        path.startswith("tests/")
        and "/" not in path[len("tests/") :]
        and path.endswith("_integration.py")
    )


def _import_targets(root: Path, cache: dict[str, set[str]], path: str) -> set[str]:
    if path in cache:
        return cache[path]
    targets: set[str] = set()
    try:
        text = (root / path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        cache[path] = targets
        return targets
    for line in text.splitlines():
        match = FROM_IMPORT_RE.match(line)
        if match:
            package = match.group(1)
            targets.add(package)
            for name in match.group(2).split(","):
                found = re.match(r"\s*([A-Za-z_]\w*)", name)
                if found:
                    targets.add(f"{package}.{found.group(1)}")
            continue
        match = IMPORT_RE.match(line)
        if match:
            targets.add(match.group(1))
    # @patch("api.replay_api.fetch") and monkeypatch.setattr("...") are the
    # other common way a test names the module it exercises.
    targets.update(QUOTED_MODULE_RE.findall(text))
    cache[path] = targets
    return targets


def _module_matches(module: str, targets: set[str]) -> bool:
    return any(target == module or target.startswith(f"{module}.") for target in targets)


def _exact_candidates(module: str, root: Path) -> list[str]:
    stem = module.rsplit(".", 1)[-1]
    return [
        candidate
        for candidate in (f"tests/test_{stem}.py", f"tests/api/test_{stem}.py")
        if (root / candidate).is_file()
    ]


def _package_test_files(pkg_rel: str, root: Path) -> list[str]:
    """Tests co-located with a package that just changed its __init__."""
    stem = pkg_rel.rsplit("/", 1)[-1]
    dirs: set[Path] = set()
    if pkg_rel == "api":
        dirs.add(root / "tests" / "api")
    for candidate in (
        root / "tests" / "api" / f"test_{stem}",
        root / "tests" / f"test_{stem}",
        root / "tests" / pkg_rel,
    ):
        if candidate.is_dir():
            dirs.add(candidate)
    for found in root.glob(f"tests/**/test_{stem}"):
        if found.is_dir():
            dirs.add(found)
    result: set[str] = set()
    for directory in dirs:
        for path in directory.rglob("test_*.py"):
            result.add(path.relative_to(root).as_posix())
    return sorted(result)


def is_api_contract_relevant(path: str, root: Path) -> bool:
    """True for route modules, API models and the generated OpenAPI spec."""
    if path in {"openapi.yaml", "api_server_fastapi.py"}:
        return True
    if path.startswith("db/models") and path.endswith(".py"):
        return True
    if not (path.startswith("api/") and path.endswith(".py")):
        return False
    name = Path(path).name
    if any(word in name for word in ("router", "routes", "_api", "model", "schema")):
        return True
    try:
        text = (root / path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return bool(ROUTE_RE.search(text) or "response_model" in text or "BaseModel" in text)


def _add(selection: Selection, test: str, reason: str) -> None:
    selection.reasons.setdefault(test, []).append(reason)


def select_tests(changed_paths: list[str], root: Path) -> Selection:
    """Map normalized changed paths to backend test node ids.

    Pure filesystem work: no git, no network, no pytest.
    """
    selection = Selection()
    all_tests = _test_files(root)
    if not all_tests:
        return selection
    import_cache: dict[str, set[str]] = {}
    is_init_cache: dict[str, set[str]] = {}

    for path in dict.fromkeys(changed_paths):
        if path.startswith("tests/"):
            if is_excluded_test_path(path):
                selection.skipped[path] = "heavy category (CI marker/paths)"
                continue
            if path in all_tests:
                _add(selection, path, "changed test file")
            elif path.endswith("/__init__.py"):
                for test in _package_test_files(path[: -len("/__init__.py")], root):
                    if not is_excluded_test_path(test):
                        _add(selection, test, f"package init {path}")
            continue

        if path.startswith(IGNORED_SOURCE_DIRS) or not (
            path.endswith(".py") or path == "openapi.yaml"
        ):
            selection.skipped[path] = "not a backend source/test file"
            continue

        if path == "openapi.yaml":
            module = None
            pkg_rel = None
        else:
            module = path[: -len(".py")].replace("/", ".")
            if module.endswith(".__init__"):
                module = module[: -len(".__init__")]
                pkg_rel = path[: -len("/__init__.py")]
            else:
                pkg_rel = None

        matched = False
        if module:
            for candidate in _exact_candidates(module, root):
                if not is_excluded_test_path(candidate):
                    _add(selection, candidate, f"exact stem of {path}")
                    matched = True
            for test in all_tests:
                if is_excluded_test_path(test):
                    continue
                if _module_matches(module, _import_targets(root, import_cache, test)):
                    _add(selection, test, f"imports/patches {module}")
                    matched = True
        if pkg_rel:
            if pkg_rel not in is_init_cache:
                is_init_cache[pkg_rel] = [
                    test
                    for test in _package_test_files(pkg_rel, root)
                    if not is_excluded_test_path(test)
                ]
            for test in is_init_cache[pkg_rel]:
                _add(selection, test, f"package init {path}")
                matched = True

        if is_api_contract_relevant(path, root) and (root / CONTRACT_TEST).is_file():
            _add(selection, CONTRACT_TEST, f"API route/model change {path}")
            if CONTRACT_TEST not in selection.forced:
                selection.forced.append(CONTRACT_TEST)
            matched = True

        if not matched:
            selection.unmapped.append(path)

    selection.tests = sorted(
        test for test in selection.reasons if test in all_tests and test not in selection.forced
    )
    return selection


def full_fallback(selection: Selection, root: Path) -> Selection:
    """Replace an empty selection with the whole fast tier."""
    for test in _test_files(root):
        if is_excluded_test_path(test):
            continue
        _add(selection, test, "full-if-empty fallback")
    selection.tests = sorted(set(selection.reasons) - set(selection.forced))
    return selection


def available_cores() -> int:
    count = os.cpu_count() or 1
    try:
        count = min(count, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        pass
    return max(1, count)


def cap_jobs(requested: int | None = None) -> int:
    """Local runs stay small: at most 4 workers, never more than the box has."""
    available = available_cores()
    if requested is None:
        return min(4, available)
    return max(1, min(requested, available))


def build_command(
    node_ids: list[str], jobs: int, marker: str = DEFAULT_MARKER, force: bool = False
) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "pytest",
        "-o",
        "addopts=",
        "-n",
        str(jobs),
        "--dist",
        "loadfile",
        "-q",
        "--tb=short",
    ]
    # CI's marker expression deselects `contract`; the explicitly required
    # OpenAPI test runs in its own invocation so it is not silently dropped.
    if marker and not force:
        command += ["-m", marker]
    return command + sorted(node_ids)


def git_changed_files(ref: str, root: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", f"{ref}...HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise RunnerError(
            f"git diff {ref}...HEAD failed: {(exc.stderr or exc.stdout).strip()}"
        ) from exc
    return [line for line in result.stdout.splitlines() if line.strip()]


def expand_paths(paths: list[str], root: Path) -> list[str]:
    expanded: list[str] = []
    for raw in paths:
        for item in raw.split(","):
            item = item.strip()
            if not item:
                continue
            candidate = Path(item)
            if not candidate.is_absolute():
                candidate = root / candidate
            if candidate.is_dir():
                try:
                    expanded.extend(
                        path.relative_to(root).as_posix()
                        for path in candidate.rglob("test_*.py")
                    )
                except ValueError:
                    continue
            else:
                expanded.append(item)
    return expanded


def _print_capped(items: list[str], limit: int = 25, prefix: str = "  ") -> None:
    for item in items[:limit]:
        print(f"{prefix}{item}")
    if len(items) > limit:
        print(f"{prefix}... and {len(items) - limit} more")


def _reasons(selection: Selection, test: str) -> str:
    reasons = selection.reasons.get(test, [])
    shown = ", ".join(reasons[:5])
    return shown + (f" (+{len(reasons) - 5} more)" if len(reasons) > 5 else "")


def print_selection(selection: Selection, changed: list[str], jobs: int, marker: str) -> None:
    print(f"Changed files: {len(changed)}")
    _print_capped([f"- {path}" for path in changed])
    print(f"\nSelected node ids ({len(selection.tests)}):")
    for test in selection.tests:
        print(f"  {test}  <- {_reasons(selection, test)}")
    if selection.forced:
        print(f"\nForced contract check ({len(selection.forced)}):")
        for test in selection.forced:
            print(f"  {test}  <- {_reasons(selection, test)}")
    if selection.skipped:
        print(f"\nSkipped ({len(selection.skipped)}):")
        _print_capped(
            [f"{path}  ({reason})" for path, reason in sorted(selection.skipped.items())]
        )
    if selection.unmapped:
        print(f"\nChanged source with no inferred test ({len(selection.unmapped)}):")
        for path in selection.unmapped:
            print(f"  {path}")
    print(f"\njobs={jobs}  marker={marker!r}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--from",
        dest="from_ref",
        default=DEFAULT_BASE_REF,
        help=f"git ref for `<ref>...HEAD` (default: {DEFAULT_BASE_REF})",
    )
    parser.add_argument(
        "--paths",
        nargs="+",
        metavar="PATH",
        help="use these changed paths instead of git (comma-separated or repeated)",
    )
    parser.add_argument("--dry-run", action="store_true", help="print commands without running them")
    parser.add_argument("--list", action="store_true", help="print node ids only and exit")
    parser.add_argument(
        "--full-if-empty",
        action="store_true",
        help="run the whole fast tier when no test maps to the diff",
    )
    parser.add_argument(
        "--marker",
        default=DEFAULT_MARKER,
        help=f"pytest -m expression (default: {DEFAULT_MARKER})",
    )
    parser.add_argument("--jobs", "-n", type=int, default=None, help="pytest-xdist workers")
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parents[2]
    try:
        changed = (
            expand_paths(args.paths, root)
            if args.paths
            else git_changed_files(args.from_ref, root)
        )
    except RunnerError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    project_name = root.name
    changed = sorted(
        {
            normalized
            for raw in changed
            if (relative := to_relative(raw, root)) is not None
            if (normalized := normalize_path(relative, project_name)) is not None
        }
    )
    selection = select_tests(changed, root)
    if selection.empty and args.full_if_empty:
        selection = full_fallback(selection, root)

    if args.list:
        for node_id in selection.node_ids:
            print(node_id)
        return 0

    jobs = cap_jobs(args.jobs)
    print_selection(selection, changed, jobs, args.marker)

    if selection.empty:
        print(
            "\nerror: no tests mapped to this diff. Nothing was run. "
            "Use --full-if-empty to run the whole fast tier.",
            file=sys.stderr,
        )
        return 2

    commands: list[list[str]] = []
    if selection.tests:
        commands.append(build_command(selection.tests, jobs, args.marker))
    if selection.forced:
        commands.append(build_command(selection.forced, jobs, force=True))

    print("\nCommands:")
    for command in commands:
        print("  " + shlex.join(command))

    if args.dry_run:
        return 0

    failed = 0
    for command in commands:
        print(f"\n$ {shlex.join(command)}", flush=True)
        failed |= subprocess.run(command, cwd=root).returncode
    return failed


if __name__ == "__main__":
    raise SystemExit(main())
