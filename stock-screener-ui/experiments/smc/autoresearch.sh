#!/usr/bin/env bash
# Autoresearch runner: SMC PF benchmark. Outputs METRIC name=number lines.
set -euo pipefail
cd "$(dirname "$0")/../.."
source .venv/bin/activate
python -m pytest tests/test_smc_ifvg.py -q 2>&1 | tail -1
python experiments/smc/bench.py
