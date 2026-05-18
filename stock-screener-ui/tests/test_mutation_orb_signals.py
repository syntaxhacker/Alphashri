"""
Mutation tests for ORB Signal Generator — verify tests catch logic bugs.

Each mutation makes ONE deliberate change to the source file, runs the
relevant test(s), and reports killed or survived. Original is restored
after each mutation even on failure.
"""

import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent

SOURCE = PROJECT / "trading" / "orb_signals.py"
TEST_FILE = PROJECT / "tests" / "test_orb_signals.py"

PYTHON = sys.executable


def _run_test(test_name: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [PYTHON, "-m", "pytest", str(TEST_FILE) + f"::{test_name}", "-x", "-q"],
        capture_output=True, text=True, timeout=30,
    )


def _apply(target: Path, old: str, new: str) -> str:
    original = target.read_text()
    assert old in original, f"old string not found in {target.name}"
    target.write_text(original.replace(old, new))
    return original


def _restore(target: Path, original: str) -> None:
    target.write_text(original)


def _diff(old: str, new: str) -> str:
    lines = []
    for o, n in zip(old.splitlines(), new.splitlines()):
        if o != n:
            lines.append(f"  - {o}")
            lines.append(f"  + {n}")
    return "\n".join(lines[:6])


MUTATIONS = [
    # ── EOD Exit Logic ──────────────────────────────────────────────────
    {
        "name": "EOD exit: flip minute >= to >",
        "file": SOURCE,
        "old": (
            "        if now.hour >= self.FORCE_EXIT[0] and now.minute >= self.FORCE_EXIT[1]:\n"
        ),
        "new": (
            "        if now.hour >= self.FORCE_EXIT[0] and now.minute > self.FORCE_EXIT[1]:  # MUTATED\n"
        ),
        "tests": [
            "TestCheckExit::test_eod_force_exit_long",
            "TestCheckExit::test_eod_force_exit_short",
        ],
        "expect": "killed",
    },
    # ── Long Position SL/TP Operators ───────────────────────────────────
    {
        "name": "Long SL: flip <= to <",
        "file": SOURCE,
        "old": "            if current_price <= stop_loss:\n",
        "new": "            if current_price < stop_loss:  # MUTATED\n",
        "tests": [
            "TestCheckExit::test_long_exit_exact_stop_loss",
        ],
        "expect": "killed",
    },
    {
        "name": "Long TP: flip >= to >",
        "file": SOURCE,
        "old": "            if current_price >= take_profit:\n",
        "new": "            if current_price > take_profit:  # MUTATED\n",
        "tests": [
            "TestCheckExit::test_long_exit_exact_take_profit",
        ],
        "expect": "killed",
    },
    # ── OR Range Boundary ───────────────────────────────────────────────
    {
        "name": "OR range min: flip < to <=",
        "file": SOURCE,
        "old": (
            "        if or_range_pct < self.min_or_range_pct or or_range_pct > self.max_or_range_pct:\n"
        ),
        "new": (
            "        if or_range_pct <= self.min_or_range_pct or or_range_pct > self.max_or_range_pct:  # MUTATED: < flipped to <=\n"
        ),
        "tests": [
            "TestCheckBreakout::test_boundary_or_range_pct_min",
        ],
        "expect": "killed",
    },
    {
        "name": "OR range max: flip > to >=",
        "file": SOURCE,
        "old": (
            "        if or_range_pct < self.min_or_range_pct or or_range_pct > self.max_or_range_pct:\n"
        ),
        "new": (
            "        if or_range_pct < self.min_or_range_pct or or_range_pct >= self.max_or_range_pct:  # MUTATED: > flipped to >=\n"
        ),
        "tests": [
            "TestCheckBreakout::test_boundary_or_range_pct_max",
        ],
        "expect": "killed",
    },
    {
        "name": "Remove OR range validation entirely",
        "file": SOURCE,
        "old": (
            "        # Validate OR range\n"
            "        if or_range_pct < self.min_or_range_pct or or_range_pct > self.max_or_range_pct:\n"
            "            return None\n"
        ),
        "new": (
            "        # MUTATED: removed OR range validation entirely\n"
            "        pass\n"
        ),
        "tests": [
            "TestCheckBreakout::test_or_range_too_small_no_signal",
            "TestCheckBreakout::test_or_range_too_large_no_signal",
        ],
        "expect": "killed",
    },
]


def main():
    passed = 0
    failed = 0
    results = []

    for m in MUTATIONS:
        original = _apply(m["file"], m["old"], m["new"])
        all_killed = True
        for test in m["tests"]:
            proc = _run_test(test)
            if proc.returncode != 0:
                print(f"  \u2705  killed by {test.split('::')[-1]}")
            else:
                print(f"  \u274c  SURVIVED on {test.split('::')[-1]}")
                all_killed = False
        _restore(m["file"], original)

        status = "KILLED" if all_killed else "SURVIVED"
        if all_killed:
            passed += 1
        else:
            failed += 1
        results.append((m["name"], status))
        print()

    total = len(MUTATIONS)
    print(f"{'='*60}")
    print(f"Results: {passed}/{total} killed, {failed}/{total} survived")
    print(f"{'='*60}")
    for name, status in results:
        icon = "\u2705" if status == "KILLED" else "\u274c"
        print(f"  {icon}  {name}")
    print(f"{'='*60}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
