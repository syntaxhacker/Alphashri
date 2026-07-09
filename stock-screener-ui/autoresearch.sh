#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

source .venv/bin/activate 2>/dev/null || true

# Read params from env (set by autoresearch loop), with defaults matching baseline
BTST_SL_PCT="${BTST_SL_PCT:-2.0}"
BTST_TP_PCT="${BTST_TP_PCT:-3.0}"
BTST_ENTRY_THRESHOLD="${BTST_ENTRY_THRESHOLD:-0.5}"
BTST_ENTRY_MODE="${BTST_ENTRY_MODE:-up_day}"
BTST_MIN_MCAP_CR="${BTST_MIN_MCAP_CR:-1000}"
BTST_MIN_PRICE="${BTST_MIN_PRICE:-50}"
BTST_LIMIT="${BTST_LIMIT:-100}"

python3 experiments/benchmark_btst.py
