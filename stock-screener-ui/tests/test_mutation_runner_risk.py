"""
Mutation tests for runner_risk.py fetch_daily_data intraday price override.

Verifies all 4 critical invariants survive deliberate code mutations.
Run:  uv run --python 3.11 python tests/test_mutation_runner_risk.py
"""

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).parent.parent
TARGET = REPO / "trading" / "runner_risk.py"
TEST = "tests/test_runner_risk.py"

MUTATIONS = [
    {
        "name": "Remove intraday try/except block entirely",
        "old": (
            "            current_price = closes[-1]\n"
            "            try:\n"
            "                intraday = fetcher.upstox_api.fetch_intraday_data_v3(\n"
            "                    symbol=symbol, interval='1'\n"
            "                )\n"
            "            except Exception:\n"
            "                intraday = None\n"
            "\n"
            "            if intraday is not None and not intraday.empty:\n"
            "                current_price = float(intraday['close'].iloc[-1])\n"
        ),
        "new": "            current_price = closes[-1]\n",
    },
    {
        "name": "Remove 'not intraday.empty' check",
        "old": "if intraday is not None and not intraday.empty:",
        "new": "if intraday is not None:",
    },
    {
        "name": "Remove 'intraday is not None' check",
        "old": "if intraday is not None and not intraday.empty:",
        "new": "if not intraday.empty:",
    },
    {
        "name": "Remove try/except (let exception propagate)",
        "old": (
            "            try:\n"
            "                intraday = fetcher.upstox_api.fetch_intraday_data_v3(\n"
            "                    symbol=symbol, interval='1'\n"
            "                )\n"
            "            except Exception:\n"
            "                intraday = None\n"
            "\n"
            "            if intraday is not None and not intraday.empty:\n"
            "                current_price = float(intraday['close'].iloc[-1])\n"
        ),
        "new": (
            "            intraday = fetcher.upstox_api.fetch_intraday_data_v3(\n"
            "                symbol=symbol, interval='1'\n"
            "            )\n"
            "\n"
            "            if intraday is not None and not intraday.empty:\n"
            "                current_price = float(intraday['close'].iloc[-1])\n"
        ),
    },
]


def main():
    original = TARGET.read_text()
    failures = []

    for m in MUTATIONS:
        if m["old"] not in original:
            print(f"  ⚠  SKIP (old string not found): {m['name']}")
            continue

        modified = original.replace(m["old"], m["new"])
        TARGET.write_text(modified)

        result = subprocess.run(
            [sys.executable, "-m", "pytest", TEST, "-x", "-q"],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(REPO),
        )

        if result.returncode != 0:
            print(f"  ✅ KILLED: {m['name']}")
        else:
            print(f"  ❌ SURVIVED: {m['name']}")
            failures.append(m["name"])

        TARGET.write_text(original)

    print()
    if failures:
        print(f"FAILED ({len(failures)} survivor(s)):")
        for name in failures:
            print(f"  ❌ {name}")
        sys.exit(1)
    else:
        print("🎉 All mutations killed by tests!")


if __name__ == "__main__":
    main()
