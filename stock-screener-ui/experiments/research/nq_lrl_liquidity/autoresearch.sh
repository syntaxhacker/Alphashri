#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."
source .venv/bin/activate
cd experiments

python -m py_compile lrl_liquidity_reversion.py research/nq_lrl_liquidity/autoresearch_loop.py
python -m pytest test_lrl_liquidity_reversion.py -q
python research/nq_lrl_liquidity/autoresearch_loop.py
