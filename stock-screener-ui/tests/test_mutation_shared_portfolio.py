"""
Mutation tests for SharedPortfolioManager — verify tests catch logic bugs.

Each mutation makes ONE deliberate change to the source file, runs the
relevant test(s), and reports killed or survived. Original is restored
after each mutation even on failure.
"""

import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent

PORTFOLIO = PROJECT / "trading" / "portfolio" / "portfolio_core.py"
TEST_FILE = PROJECT / "tests" / "test_shared_portfolio.py"

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
    {
        "name": "close_position: BUY P&L formula inverted",
        "file": PORTFOLIO,
        "old": (
            "            pnl = (exit_price - position.entry_price) * position.quantity\n"
            "            pnl_pct = (exit_price - position.entry_price) / position.entry_price * 100\n"
        ),
        "new": (
            "            pnl = (position.entry_price - exit_price) * position.quantity  # MUTATED\n"
            "            pnl_pct = (position.entry_price - exit_price) / position.entry_price * 100\n"
        ),
        "tests": [
            "TestClosePosition::test_close_buy_position_profit",
        ],
        "expect": "killed",
    },
    {
        "name": "open_position: cash deduction removed",
        "file": PORTFOLIO,
        "old": "        self.cash -= trade_value\n",
        "new": "        # self.cash -= trade_value  # MUTATED: removed cash deduction\n",
        "tests": [
            "TestOpenPosition::test_open_buy_position",
        ],
        "expect": "killed",
    },
    {
        "name": "open_position: capital_used not updated",
        "file": PORTFOLIO,
        "old": "            self.strategy_allocations[strategy_id].capital_used += trade_value\n",
        "new": "            # self.strategy_allocations[strategy_id].capital_used += trade_value  # MUTATED\n",
        "tests": [
            "TestOpenPosition::test_open_position_updates_strategy_tracking",
        ],
        "expect": "killed",
    },
    {
        "name": "update_prices: BUY/SELL P&L formulas swapped",
        "file": PORTFOLIO,
        "old": (
            "                if position.side == OrderSide.BUY:\n"
            "                    position.unrealized_pnl = (current_price - position.entry_price) * position.quantity\n"
            "                    position.unrealized_pnl_pct = (current_price - position.entry_price) / position.entry_price * 100\n"
        ),
        "new": (
            "                if position.side == OrderSide.SELL:  # MUTATED: BUY/SELL swapped\n"
            "                    position.unrealized_pnl = (current_price - position.entry_price) * position.quantity\n"
            "                    position.unrealized_pnl_pct = (current_price - position.entry_price) / position.entry_price * 100\n"
        ),
        "tests": [
            "TestPnLCalculations::test_buy_pnl_calculation",
        ],
        "expect": "killed",
    },
    {
        "name": "close_position: realized_pnl accumulation removed",
        "file": PORTFOLIO,
        "old": "            self.strategy_allocations[strategy_id].realized_pnl += net_pnl\n",
        "new": "            # self.strategy_allocations[strategy_id].realized_pnl += net_pnl  # MUTATED\n",
        "tests": [
            "TestClosePosition::test_close_position_updates_strategy_tracking",
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
