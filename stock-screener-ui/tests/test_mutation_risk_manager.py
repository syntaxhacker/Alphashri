"""
Mutation tests for RiskManager — verify tests catch logic bugs.

Each mutation makes ONE deliberate change to the source file, runs the
relevant test(s), and reports killed or survived. Original is restored
after each mutation even on failure.
"""

import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent

RISK_MANAGER = PROJECT / "trading" / "risk_manager.py"
TEST_FILE = PROJECT / "tests" / "test_risk_manager.py"

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
    # ── calculate_position_size ────────────────────────────────────────
    {
        "name": "calculate_position_size: remove stop_loss <= 0 guard",
        "file": RISK_MANAGER,
        "old": (
            "        if entry_price <= 0 or stop_loss <= 0:\n"
            "            return 0\n"
        ),
        "new": (
            "        if entry_price <= 0:  # MUTATED: removed stop_loss <= 0 check\n"
            "            return 0\n"
        ),
        "tests": [
            "TestCalculatePositionSize::test_zero_stop_loss",
            "TestCalculatePositionSize::test_negative_stop_loss",
        ],
        "expect": "killed",
    },
    # ── can_open_position: max positions ───────────────────────────────
    {
        "name": "can_open_position: remove max positions check",
        "file": RISK_MANAGER,
        "old": (
            "        # Check max positions\n"
            "        if current_positions >= self.config.max_positions:\n"
            "            return False, f\"Max positions ({self.config.max_positions}) reached\"\n"
        ),
        "new": (
            "        # Check max positions — MUTATED: removed\n"
            "        # if current_positions >= self.config.max_positions:\n"
            "        #     return False, f\"Max positions ({self.config.max_positions}) reached\"\n"
        ),
        "tests": [
            "TestCanOpenPosition::test_max_positions_reached",
            "TestCanOpenPosition::test_max_positions_exceeded",
            "TestValidateTrade::test_rejected_by_position_limit",
        ],
        "expect": "killed",
    },
    # ── can_open_position: exposure comparison ─────────────────────────
    {
        "name": "can_open_position: flip > to >= in exposure check",
        "file": RISK_MANAGER,
        "old": "        if exposure_pct > self.config.max_total_exposure:\n",
        "new": "        if exposure_pct >= self.config.max_total_exposure:  # MUTATED: > flipped to >=\n",
        "tests": [
            "TestCanOpenPosition::test_total_exposure_exactly_at_limit",
        ],
        "expect": "killed",
    },
    # ── can_open_position: daily loss limit flag ───────────────────────
    {
        "name": "can_open_position: remove daily loss limit flag check",
        "file": RISK_MANAGER,
        "old": (
            "        # Check daily loss limit\n"
            "        if self.daily_start_loss_limit_hit:\n"
            "            return False, \"Daily loss limit reached - trading halted\"\n"
        ),
        "new": (
            "        # Check daily loss limit — MUTATED: removed\n"
            "        # if self.daily_start_loss_limit_hit:\n"
            "        #     return False, \"Daily loss limit reached - trading halted\"\n"
        ),
        "tests": [
            "TestCanOpenPosition::test_daily_loss_limit_hit",
            "TestIntegrationScenarios::test_after_loss_trading_halted",
        ],
        "expect": "killed",
    },
    # ── check_daily_loss_limit: comparison ─────────────────────────────
    {
        "name": "check_daily_loss_limit: flip >= to >",
        "file": RISK_MANAGER,
        "old": "        if loss_pct >= self.config.max_daily_loss:\n",
        "new": "        if loss_pct > self.config.max_daily_loss:  # MUTATED: >= flipped to >\n",
        "tests": [
            "TestCheckDailyLossLimit::test_loss_exactly_at_limit",
        ],
        "expect": "killed",
    },
    # ── singleton: always create new instance ──────────────────────────
    {
        "name": "get_risk_manager: always create new instance",
        "file": RISK_MANAGER,
        "old": (
            "    global _risk_manager\n"
            "    if _risk_manager is None:\n"
            "        _risk_manager = RiskManager(config_name=config_name)\n"
            "    elif config_name is not None:\n"
            "        import logging\n"
            "        logging.getLogger(__name__).warning(\n"
            "            \"get_risk_manager called with config_name=%s but singleton already initialized\", config_name\n"
            "        )\n"
            "    return _risk_manager\n"
        ),
        "new": (
            "    global _risk_manager\n"
            "    _risk_manager = RiskManager(config_name=config_name)  # MUTATED: always create new\n"
            "    return _risk_manager\n"
        ),
        "tests": [
            "TestSingletonFunctions::test_get_risk_manager_returns_same_instance",
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
