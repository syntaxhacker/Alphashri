"""
Mutation tests for backtest/costs.py — verify tests catch logic bugs.

Each mutation makes ONE deliberate change to the source file, runs the
relevant test(s), and reports killed or survived. Original is restored
after each mutation even on failure.
"""

import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent

SOURCE = PROJECT / "backtest" / "costs.py"
TEST_FILE = PROJECT / "tests" / "test_backtest_costs.py"

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
    # ── Brokerage cap at 20 INR ────────────────────────────────────────
    {
        "name": "Brokerage cap raised to ₹50",
        "file": SOURCE,
        "old": "min(20, ",
        "new": "min(50, ",  # MUTATED: cap raised to 50
        "tests": [
            "TestBrokerageCalculation::test_brokerage_exactly_at_cap_boundary",
            "TestEdgeCases::test_large_trade_value_brokerage_capped",
        ],
        "expect": "killed",
    },
    # ── STT sell-side-only ─────────────────────────────────────────────
    {
        "name": "STT removed from sell side",
        "file": SOURCE,
        "old": "sell_stt = sell_value * STT_PCT  # STT only on sell side for intraday",
        "new": "sell_stt = 0  # MUTATED: STT removed from sell side",
        "tests": [
            "TestSTTAndStampDuty::test_stt_only_on_sell_side",
            "TestSTTAndStampDuty::test_stt_calculation_accuracy",
        ],
        "expect": "killed",
    },
    # ── Stamp duty buy-side-only ───────────────────────────────────────
    {
        "name": "Stamp duty removed from buy side",
        "file": SOURCE,
        "old": "buy_stamp_duty = buy_value * STAMP_DUTY_PCT",
        "new": "buy_stamp_duty = 0  # MUTATED: stamp duty removed from buy side",
        "tests": [
            "TestSTTAndStampDuty::test_stamp_duty_calculation_accuracy",
            "TestSTTAndStampDuty::test_stamp_duty_only_on_buy_side",
        ],
        "expect": "killed",
    },
    # ── SEBI fee constant ──────────────────────────────────────────────
    {
        "name": "SEBI fee constant doubled",
        "file": SOURCE,
        "old": "SEBI_FEE_PCT = 0.000001       # 0.0001%",
        "new": "SEBI_FEE_PCT = 0.000002       # 0.0001% — MUTATED: doubled",
        "tests": [
            "TestCostConstants::test_sebi_fee_percentage",
        ],
        "expect": "killed",
    },
    # ── GST computed on sell side includes STT ─────────────────────────
    {
        "name": "GST on sell side includes STT",
        "file": SOURCE,
        "old": "sell_gst = GST_PCT * (sell_brokerage + sell_exchange + sell_sebi)",
        "new": "sell_gst = GST_PCT * (sell_brokerage + sell_exchange + sell_sebi + sell_stt)  # MUTATED: includes STT",
        "tests": [
            "TestGSTCalculation::test_gst_on_sell_side_components",
            "TestGSTCalculation::test_gst_excludes_stt_and_stamp_duty",
        ],
        "expect": "killed",
    },
    # ── GST computed on buy side includes stamp duty ───────────────────
    {
        "name": "GST on buy side includes stamp duty",
        "file": SOURCE,
        "old": "buy_gst = GST_PCT * (buy_brokerage + buy_exchange + buy_sebi)",
        "new": "buy_gst = GST_PCT * (buy_brokerage + buy_exchange + buy_sebi + buy_stamp_duty)  # MUTATED: includes stamp duty",
        "tests": [
            "TestGSTCalculation::test_gst_on_buy_side_components",
            "TestGSTCalculation::test_gst_excludes_stt_and_stamp_duty",
        ],
        "expect": "killed",
    },
    # ── calculate_trading_costs as single source of truth ──────────────
    {
        "name": "Brokerage percentage constant doubled",
        "file": SOURCE,
        "old": "BROKERAGE_PCT = 0.0003        # 0.03% (lower of ₹20 or 0.03% - using % for large trades)",
        "new": "BROKERAGE_PCT = 0.0006        # 0.03% — MUTATED: doubled",
        "tests": [
            "TestCostConstants::test_brokerage_percentage",
            "TestBrokerageCalculation::test_brokerage_percentage_applied_below_cap",
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
