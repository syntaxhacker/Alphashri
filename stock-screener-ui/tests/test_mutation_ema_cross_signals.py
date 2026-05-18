"""
Mutation tests for EMA Cross Signal Generator — verify tests catch logic bugs.

Each mutation makes ONE deliberate change to the source file, runs the
relevant test(s), and reports killed or survived. Original is restored
after each mutation even on failure.
"""

import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent

SOURCE = PROJECT / "trading" / "ema_cross_signals.py"
TEST_FILE = PROJECT / "tests" / "test_ema_cross_signals.py"

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


MUTATIONS = [
    {
        "name": "Bullish cross: <= on prev changed to <",
        "file": SOURCE,
        "old": (
            "        bullish_cross = ema_fast_prev <= ema_slow_prev "
            "and ema_fast_current > ema_slow_current"
        ),
        "new": (
            "        bullish_cross = ema_fast_prev < ema_slow_prev "
            "and ema_fast_current > ema_slow_current  # MUTATED"
        ),
        "tests": [
            "TestEMACrossSignalGenerator::test_check_entry_scenarios[bullish_from_equal]",
        ],
        "expect": "killed",
    },
    {
        "name": "Bullish cross: > on current changed to >=",
        "file": SOURCE,
        "old": (
            "        bullish_cross = ema_fast_prev <= ema_slow_prev "
            "and ema_fast_current > ema_slow_current"
        ),
        "new": (
            "        bullish_cross = ema_fast_prev <= ema_slow_prev "
            "and ema_fast_current >= ema_slow_current  # MUTATED"
        ),
        "tests": [
            "TestEMACrossSignalGenerator::test_check_entry_scenarios[equal_no_cross]",
        ],
        "expect": "killed",
    },
    {
        "name": "Bearish cross: >= on prev changed to >",
        "file": SOURCE,
        "old": (
            "        bearish_cross = ema_fast_prev >= ema_slow_prev "
            "and ema_fast_current < ema_slow_current"
        ),
        "new": (
            "        bearish_cross = ema_fast_prev > ema_slow_prev "
            "and ema_fast_current < ema_slow_current  # MUTATED"
        ),
        "tests": [
            "TestEMACrossSignalGenerator::test_check_entry_scenarios[bearish_from_equal]",
        ],
        "expect": "killed",
    },
    {
        "name": "Remove cooldown check after exit",
        "file": SOURCE,
        "old": (
            "        if self._last_exit_bar is not None and self.cooldown_bars > 0:\n"
            "            if (self._bar_number - self._last_exit_bar) < self.cooldown_bars:\n"
            "                return None"
        ),
        "new": (
            "        # MUTATED: removed cooldown check\n"
            "        pass"
        ),
        "tests": [
            "TestEMACrossSignalGenerator::test_check_entry_cooldown",
        ],
        "expect": "killed",
    },
    {
        "name": "Remove enable_shorts gate (always allow shorts)",
        "file": SOURCE,
        "old": "        if bearish_cross and self.enable_shorts:",
        "new": "        if bearish_cross:  # MUTATED: removed enable_shorts gate",
        "tests": [
            "TestEMACrossSignalGenerator::test_check_entry_enable_shorts_false",
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
                print(f"  ✅  killed by {test.split('::')[-1]}")
            else:
                print(f"  ❌  SURVIVED on {test.split('::')[-1]}")
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
        icon = "✅" if status == "KILLED" else "❌"
        print(f"  {icon}  {name}")
    print(f"{'='*60}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
