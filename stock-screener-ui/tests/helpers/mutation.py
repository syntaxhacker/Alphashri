"""Shared harness for mutation-test scripts.

Each mutation script applies one deliberate source edit, runs the named
tests, and reports killed/survived. The source file is restored after every
mutation, including when a test fails.
"""

import subprocess
import sys
from pathlib import Path


def run_test(
    test_name: str,
    test_file: Path,
    python: str | None = None,
) -> subprocess.CompletedProcess:
    """Run one pinned test in a subprocess so source mutations take effect."""
    return subprocess.run(
        [python or sys.executable, "-m", "pytest", f"{test_file}::{test_name}", "-x", "-q"],
        capture_output=True,
        text=True,
        timeout=30,
    )


def apply(target: Path, old: str, new: str) -> str:
    original = target.read_text()
    assert old in original, f"old string not found in {target.name}"
    target.write_text(original.replace(old, new))
    return original


def restore(target: Path, original: str) -> None:
    target.write_text(original)


def diff(old: str, new: str) -> str:
    lines = []
    for o, n in zip(old.splitlines(), new.splitlines()):
        if o != n:
            lines.append(f"  - {o}")
            lines.append(f"  + {n}")
    return "\n".join(lines[:6])


def run_mutations(mutations, test_file: Path, python: str | None = None) -> int:
    passed = 0
    failed = 0
    results = []

    for m in mutations:
        original = apply(m["file"], m["old"], m["new"])
        all_killed = True
        for test in m["tests"]:
            proc = run_test(test, test_file, python)
            if proc.returncode != 0:
                print(f"  \u2705  killed by {test.split('::')[-1]}")
            else:
                print(f"  \u274c  SURVIVED on {test.split('::')[-1]}")
                all_killed = False
        restore(m["file"], original)

        status = "KILLED" if all_killed else "SURVIVED"
        if all_killed:
            passed += 1
        else:
            failed += 1
        results.append((m["name"], status))
        print()

    total = len(mutations)
    print(f"{'=' * 60}")
    print(f"Results: {passed}/{total} killed, {failed}/{total} survived")
    print(f"{'=' * 60}")
    for name, status in results:
        icon = "\u2705" if status == "KILLED" else "\u274c"
        print(f"  {icon}  {name}")
    print(f"{'=' * 60}")

    return 0 if failed == 0 else 1
