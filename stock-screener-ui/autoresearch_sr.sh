#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
source .venv/bin/activate 2>/dev/null || true

# Read params from env (set by autoresearch loop), with defaults
MIN_MCAP_CR="${MIN_MCAP_CR:-2000}"
MIN_ATR_PCT="${MIN_ATR_PCT:-1.5}"
MIN_PRICE="${MIN_PRICE:-100}"
MIN_VOLUME="${MIN_VOLUME:-500000}"
SR_SL="${SR_SL:-3.0}"
SR_TP="${SR_TP:-4.5}"
SR_BUFFER="${SR_BUFFER:-0.1}"
SR_MAX_DIST="${SR_MAX_DIST:-5.0}"
SR_PIVOT="${SR_PIVOT:-classic}"

python3 experiments/benchmark_sr_params.py \
    --min-mcap-cr "$MIN_MCAP_CR" \
    --min-atr-pct "$MIN_ATR_PCT" \
    --min-price "$MIN_PRICE" \
    --min-volume "$MIN_VOLUME" \
    --sl-pct "$SR_SL" \
    --tp-pct "$SR_TP" \
    --buffer-pct "$SR_BUFFER" \
    --max-dist-pct "$SR_MAX_DIST" \
    --pivot-type "$SR_PIVOT"
