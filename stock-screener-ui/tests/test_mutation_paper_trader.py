"""
Mutation tests for PaperTrader — verify tests catch logic bugs.

Each mutation makes ONE deliberate change to the source file, runs the
relevant test(s), and reports killed or survived. Original is restored
after each mutation even on failure.
"""

import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent

TARGET = PROJECT / "trading" / "paper" / "paper_portfolio.py"
TEST_FILE = PROJECT / "tests" / "test_paper_trader.py"

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
    # ── SL/TP price trigger comparison operators ──────────────────────
    {
        "name": "SL trigger BUY: <= flipped to <",
        "file": TARGET,
        "old": "                elif current_price <= position.stop_loss:\n",
        "new": "                elif current_price < position.stop_loss:  # MUTATED\n",
        "tests": [
            "TestIntegrationScenarios::test_exact_sl_tp_boundaries",
        ],
        "expect": "killed",
    },
    {
        "name": "TP trigger BUY: >= flipped to >",
        "file": TARGET,
        "old": "                if current_price >= position.take_profit:\n",
        "new": "                if current_price > position.take_profit:  # MUTATED\n",
        "tests": [
            "TestIntegrationScenarios::test_full_trade_cycle_profit",
        ],
        "expect": "killed",
    },
    {
        "name": "SL trigger SELL: >= flipped to >",
        "file": TARGET,
        "old": "                elif current_price >= position.stop_loss:\n",
        "new": "                elif current_price > position.stop_loss:  # MUTATED\n",
        "tests": [
            "TestPaperTraderSimulations::test_sell_sl_exact_boundary",
        ],
        "expect": "killed",
    },
    # ── Slippage math ─────────────────────────────────────────────────
    {
        "name": "Slippage exit BUY: wrong direction (1 + instead of 1 -)",
        "file": TARGET,
        "old": "            actual_exit_price = exit_price * (1 - self.slippage_pct)\n",
        "new": "            actual_exit_price = exit_price * (1 + self.slippage_pct)  # MUTATED: wrong direction\n",
        "tests": [
            "TestPaperTraderSimulations::test_slippage_on_exit_buy",
        ],
        "expect": "killed",
    },
    # ── Commission / fee calculations ─────────────────────────────────
    {
        "name": "Remove min_brokerage from cost calculation",
        "file": TARGET,
        "old": "        brokerage = max(trade_value * self.brokerage_pct, self.min_brokerage)\n",
        "new": "        brokerage = trade_value * self.brokerage_pct  # MUTATED: no min brokerage\n",
        "tests": [
            "TestCalculateCosts::test_brokerage_minimum",
        ],
        "expect": "killed",
    },
    # ── Order placement validation ────────────────────────────────────
    {
        "name": "Remove insufficient cash check (flip condition)",
        "file": TARGET,
        "old": "        if not has_sufficient_cash(self.cash, margin_required):\n",
        "new": (
            "        if has_sufficient_cash(self.cash, margin_required):"
            "  # MUTATED: removed NOT\n"
        ),
        "tests": [
            "TestPlaceOrder::test_insufficient_cash_cancels_order",
        ],
        "expect": "killed",
    },
    # ── Position management / margin tracking ─────────────────────────
    {
        "name": "Wrong margin_used in close_position (entry_price → actual_exit_price)",
        "file": TARGET,
        "old": "        self.margin_used -= position.entry_price * position.quantity\n",
        "new": "        self.margin_used -= actual_exit_price * position.quantity  # MUTATED\n",
        "tests": [
            "TestClosePosition::test_close_position_updates_margin",
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
