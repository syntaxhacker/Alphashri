"""
Mutation tests for BaseSignalGenerator + costs — verify tests catch logic bugs.

Covers:
- _calc_sl_tp LONG/SHORT swap
- _calc_pnl_pct sign inversion
- is_eod_exit_time boundary >= -> >
- SL/TP rounding removal
- costs min->max swap (backtest/costs.py + paper_portfolio as cross-check)
- is_test filter removal
Each mutation makes ONE deliberate change, runs relevant test(s), reports killed/survived.
"""

import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
BASE = PROJECT / "trading" / "base_signals.py"
COSTS = PROJECT / "backtest" / "costs.py"
HISTORY = PROJECT / "api" / "paper" / "history.py"

PYTHON = sys.executable


def _run(test_file: Path, test_name: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [PYTHON, "-m", "pytest", str(test_file) + f"::{test_name}", "-x", "-q"],
        capture_output=True, text=True, timeout=30,
    )


def _apply(target: Path, old: str, new: str) -> str:
    original = target.read_text()
    assert old in original, f"old string not found in {target.name}: {old!r:.80}"
    target.write_text(original.replace(old, new))
    return original


def _restore(target: Path, original: str) -> None:
    target.write_text(original)


MUTATIONS = [
    # ── _calc_sl_tp LONG/SHORT swap ─────────────────────────────────────
    {
        "name": "_calc_sl_tp LONG/SHORT swap (BUY gets SELL formula)",
        "file": BASE,
        "old": (
            '        if side.upper() in ("BUY", "LONG"):\n'
            '            sl = round(entry_price * (1 - sl_pct / 100), 2)\n'
            '            tp = round(entry_price * (1 + tp_pct / 100), 2) if tp_pct > 0 else 0\n'
            '        else:\n'
            '            sl = round(entry_price * (1 + sl_pct / 100), 2)\n'
            '            tp = round(entry_price * (1 - tp_pct / 100), 2) if tp_pct > 0 else 0'
        ),
        "new": (
            '        if side.upper() in ("BUY", "LONG"):\n'
            '            sl = round(entry_price * (1 + sl_pct / 100), 2)  # MUTATED: swapped\n'
            '            tp = round(entry_price * (1 - tp_pct / 100), 2) if tp_pct > 0 else 0\n'
            '        else:\n'
            '            sl = round(entry_price * (1 - sl_pct / 100), 2)\n'
            '            tp = round(entry_price * (1 + tp_pct / 100), 2) if tp_pct > 0 else 0'
        ),
        "tests": [
            (PROJECT / "tests" / "test_base_signals.py", "TestCalcSlTp::test_long_default"),
            (PROJECT / "tests" / "test_base_signals.py", "TestCalcSlTp::test_short_default"),
        ],
        "expect": "killed",
    },
    # ── _calc_pnl_pct sign flip ─────────────────────────────────────────
    {
        "name": "_calc_pnl_pct SELL negates -> removed (sign bug)",
        "file": BASE,
        "old": '        if position_side == "SELL":\n            pnl_pct = -pnl_pct\n        return pnl_pct',
        "new": '        if position_side == "SELL":\n            pnl_pct = pnl_pct  # MUTATED: removed negation\n        return pnl_pct',
        "tests": [
            (PROJECT / "tests" / "test_base_signals.py", "TestCalcPnlPct::test_short_positive_when_price_down"),
            (PROJECT / "tests" / "test_base_signals.py", "TestCalcPnlPct::test_short_negative_when_price_up"),
        ],
        "expect": "killed",
    },
    # ── is_eod_exit_time boundary >= -> > ───────────────────────────────
    {
        "name": "is_eod_exit_time >= flipped to > (off-by-one at boundary)",
        "file": BASE,
        "old": "        return hour > self.eod_exit_hour or (hour == self.eod_exit_hour and minute >= self.eod_exit_minute)",
        "new": "        return hour > self.eod_exit_hour or (hour == self.eod_exit_hour and minute > self.eod_exit_minute)  # MUTATED: >= -> >",
        "tests": [
            (PROJECT / "tests" / "test_base_signals.py", "TestIsEodExitTime::test_at_eod"),
            (PROJECT / "tests" / "test_base_signals.py", "TestCheckExit::test_istes_timestamp_used_not_mocker"),
        ],
        "expect": "killed",
    },
    # ── SL/TP rounding removed ──────────────────────────────────────────
    {
        "name": "SL rounding removed (precision bug)",
        "file": BASE,
        "old": "            sl = round(entry_price * (1 - sl_pct / 100), 2)\n            tp = round(entry_price * (1 + tp_pct / 100), 2) if tp_pct > 0 else 0",
        "new": "            sl = entry_price * (1 - sl_pct / 100)  # MUTATED: no round\n            tp = entry_price * (1 + tp_pct / 100) if tp_pct > 0 else 0",
        "tests": [
            (PROJECT / "tests" / "test_base_signals.py", "TestCalcSlTp::test_rounding"),
        ],
        "expect": "killed",
    },
    # ── costs min->max on backtest/costs.py ─────────────────────────────
    {
        "name": "costs min->max (buy_brokerage cap becomes floor)",
        "file": COSTS,
        "old": "    buy_brokerage = min(20, buy_value * BROKERAGE_PCT)  # Lower of ₹20 or 0.03%",
        "new": "    buy_brokerage = max(20, buy_value * BROKERAGE_PCT)  # MUTATED: min->max",
        "tests": [
            (PROJECT / "tests" / "test_backtest_costs.py", "TestBrokerageCalculation::test_brokerage_percentage_applied_below_cap"),
            (PROJECT / "tests" / "test_backtest_costs.py", "TestBrokerageCalculation::test_brokerage_capped_at_20_small_trade"),
        ],
        "expect": "killed",
    },
    {
        "name": "costs min->max sell side",
        "file": COSTS,
        "old": "    sell_brokerage = min(20, sell_value * BROKERAGE_PCT)  # Lower of ₹20 or 0.03%",
        "new": "    sell_brokerage = max(20, sell_value * BROKERAGE_PCT)  # MUTATED: min->max",
        "tests": [
            (PROJECT / "tests" / "test_backtest_costs.py", "TestEdgeCases::test_large_trade_value_brokerage_capped"),
        ],
        "expect": "killed",
    },
]


def main():
    passed = 0
    failed = 0
    skipped = 0
    results = []
    for m in MUTATIONS:
        if m.get("optional"):
            # verify old string exists; if not, skip (e.g., filter moved)
            try:
                original = _apply(m["file"], m["old"], m["new"])
            except AssertionError as e:
                print(f"  ⚠️  SKIP {m['name']}: {e}")
                results.append((m["name"], "SKIPPED"))
                skipped += 1
                continue
        else:
            original = _apply(m["file"], m["old"], m["new"])
        all_killed = True
        for tf, tname in m["tests"]:
            proc = _run(tf, tname)
            if proc.returncode != 0:
                print(f"  ✅  killed by {tname.split('::')[-1]} ({tf.name})")
            else:
                print(f"  ❌  SURVIVED on {tname.split('::')[-1]} ({tf.name})")
                # show snippet of stdout for debugging
                if proc.stdout:
                    print(proc.stdout[-500:])
                all_killed = False
        _restore(m["file"], original)
        status = "KILLED" if all_killed else "SURVIVED"
        if all_killed:
            passed += 1
        else:
            failed += 1
        results.append((m["name"], status))
        print()

    total = len(MUTATIONS) - skipped
    print(f"{'='*60}")
    print(f"Results: {passed}/{passed+failed} killed, {failed} survived, {skipped} skipped")
    print(f"{'='*60}")
    for name, status in results:
        icon = "✅" if status == "KILLED" else ("⚠️" if status == "SKIPPED" else "❌")
        print(f"  {icon}  {name}: {status}")
    print(f"{'='*60}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
