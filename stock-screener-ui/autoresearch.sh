#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export ORB_OR_MIN="${ORB_OR_MIN:-45}"
export ORB_SL="${ORB_SL:-0.4}"
export ORB_TP="${ORB_TP:-1.2}"
export ORB_BUFFER="${ORB_BUFFER:-0.3}"
export ORB_COOLDOWN="${ORB_COOLDOWN:-3}"
export ORB_SHORTS="${ORB_SHORTS:-0}"
export ORB_TRADE_SIZE="${ORB_TRADE_SIZE:-100}"
export ORB_MIN_ENTRY="${ORB_MIN_ENTRY:-0}"
export ORB_MAX_PER_DAY="${ORB_MAX_PER_DAY:-0}"
export ORB_EOD_EXIT="${ORB_EOD_EXIT:-900}"
export ORB_CACHE_DIR="${ORB_CACHE_DIR:-../experiments/data}"

python3 "$SCRIPT_DIR/experiments/orb_benchmark.py"
