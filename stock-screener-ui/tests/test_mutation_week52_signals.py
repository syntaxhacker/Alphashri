"""
Mutation tests for 52W Signal Generators — verify tests catch logic bugs.

Each mutation makes ONE deliberate change to the source file, runs the
relevant test(s), and reports killed or survived. Original is restored
after each mutation even on failure.
"""

import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent

CHASER = PROJECT / "trading" / "week52_chaser_signals.py"
TARGET = PROJECT / "trading" / "week52_target_signals.py"
TEST_FILE = PROJECT / "tests" / "test_signal_generators.py"

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
    return "\n".join(lines[:6])  # show at most 6 lines


MUTATIONS = [
    # ── Week52Chaser ──────────────────────────────────────────────────
    {
        "name": "Chaser: remove min_breakout_pct guard (enter at or below 52W high)",
        "file": CHASER,
        "old": (
            "        if pct_above < self.min_breakout_pct or pct_above > self.entry_threshold_pct:\n"
        ),
        "new": (
            "        if pct_above > self.entry_threshold_pct:  # MUTATED: removed min_breakout_pct guard\n"
        ),
        "tests": [
            "TestWeek52ChaserSignalGenerator::test_check_entry_below_52w_high_rejected",
        ],
        "expect": "killed",
    },
    {
        "name": "Chaser: flip entry_threshold > to < (with min_breakout_pct)",
        "file": CHASER,
        "old": "        if pct_above < self.min_breakout_pct or pct_above > self.entry_threshold_pct:\n",
        "new": "        if pct_above < self.min_breakout_pct or pct_above < self.entry_threshold_pct:  # MUTATED: > flipped to <\n",
        "tests": [
            "TestWeek52ChaserSignalGenerator::test_check_entry_too_far_above_52w_high",
        ],
        "expect": "killed",
    },
    {
        "name": "Chaser: remove trailing activation on 52W cross",
        "file": CHASER,
        "old": (
            "        if enable_trailing_stop and not trailing_active and entry_52w_high is not None:\n"
            "            if current_price >= entry_52w_high:\n"
            "                trailing_active = True\n"
        ),
        "new": (
            "        # MUTATED: removed trailing activation logic\n"
            "        pass\n"
        ),
        "tests": [
            "TestWeek52ChaserSignalGenerator::test_check_exit_trailing_stop_activates_on_52w_cross",
        ],
        "expect": "killed",
    },
    {
        "name": "Chaser: remove NEW_52W_HIGH momentum fade",
        "file": CHASER,
        "old": (
            "        elif entry_52w_high is not None and current_52w_high is not None:\n"
            "            if current_52w_high > entry_52w_high * 1.10:\n"
            "                exit_reason = \"NEW_52W_HIGH\"\n"
        ),
        "new": (
            "        # MUTATED: removed NEW_52W_HIGH check\n"
            "        pass\n"
        ),
        "tests": [
            "TestWeek52ChaserSignalGenerator::test_check_exit_new_52w_high_momentum_fade",
        ],
        "expect": "killed",
    },
    # ── Week52Target ──────────────────────────────────────────────────
    {
        "name": "Target: remove above-52W-high rejection",
        "file": TARGET,
        "old": (
            "        # Target buys BELOW the 52W high, sells at it\n"
            "        if current_price > calculated_high:\n"
            "            return None\n"
        ),
        "new": (
            "        # MUTATED: removed above-52W rejection\n"
            "        pass\n"
        ),
        "tests": [
            "TestWeek52TargetSignalGenerator::test_check_entry_above_52w_high_rejected",
        ],
        "expect": "killed",
    },
    {
        "name": "Target: TP not set to 0 (non-zero TP set)",
        "file": TARGET,
        "old": "        take_profit = 0.0",
        "new": "        take_profit = 100.0  # MUTATED: non-zero TP",
        "tests": [
            "TestWeek52TargetSignalGenerator::test_check_entry_no_tp",
        ],
        "expect": "killed",
    },
    {
        "name": "Target: remove near-high activation (always use wide trail)",
        "file": TARGET,
        "old": (
            "                trail_pct = trailing_stop_pct if current_price > entry_52w_high else near_high_trail_pct\n"
            "                trailing_stop_price = highest_price_since_entry * (1 - trail_pct / 100)\n"
        ),
        "new": (
            "                trailing_stop_price = highest_price_since_entry * (1 - trailing_stop_pct / 100)  # MUTATED: always wide\n"
        ),
        "tests": [
            "TestWeek52TargetSignalGenerator::test_check_exit_trailing_stop_activates_near_52w_high",
        ],
        "expect": "killed",
    },
    {
        "name": "Target: use near_high_trail even above 52W (never wider)",
        "file": TARGET,
        "old": (
            "                trail_pct = trailing_stop_pct if current_price > entry_52w_high else near_high_trail_pct\n"
        ),
        "new": (
            "                trail_pct = near_high_trail_pct  # MUTATED: always tight\n"
        ),
        "tests": [
            "TestWeek52TargetSignalGenerator::test_check_exit_above_52w_uses_wider_trail",
        ],
        "expect": "killed",
    },
    {
        "name": "Target: remove max_holding check",
        "file": TARGET,
        "old": (
            "        if exit_reason is None and days_in_position >= max_holding_days:\n"
            "            exit_reason = \"MAX_HOLDING\"\n"
        ),
        "new": (
            "        # MUTATED: removed MAX_HOLDING check\n"
            "        pass\n"
        ),
        "tests": [
            "TestWeek52TargetSignalGenerator::test_check_exit_max_holding",
        ],
        "expect": "killed",
    },
    {
        "name": "Target: remove SL check",
        "file": TARGET,
        "old": (
            "        sl_price = entry_price * (1 - sl_pct / 100)\n"
            "        if current_price <= sl_price:\n"
            "            exit_reason = \"SL\"\n"
        ),
        "new": (
            "        # MUTATED: removed SL check\n"
            "        pass\n"
        ),
        "tests": [
            "TestWeek52TargetSignalGenerator::test_check_exit_stop_loss_always_active",
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
