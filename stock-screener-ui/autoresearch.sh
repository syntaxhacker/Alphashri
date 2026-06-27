#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

source .venv/bin/activate 2>/dev/null || true

# Read params from env (set by autoresearch loop), with defaults matching baseline
MIN_MCAP_CR="${MIN_MCAP_CR:-1000}"
MIN_ATR_PCT="${MIN_ATR_PCT:-3.0}"
MIN_PRICE="${MIN_PRICE:-100}"
MIN_VOLUME="${MIN_VOLUME:-500000}"

python3 experiments/benchmark_screener_params.py \
    --min-mcap-cr "$MIN_MCAP_CR" \
    --min-atr-pct "$MIN_ATR_PCT" \
    --min-price "$MIN_PRICE" \
    --min-volume "$MIN_VOLUME"
