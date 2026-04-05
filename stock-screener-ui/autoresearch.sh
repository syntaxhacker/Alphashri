#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/../.env.dev" ]; then
    set -a
    . "$SCRIPT_DIR/../.env.dev"
    set +a
fi

SR_SL="${SR_SL:-1.0}"
SR_TP="${SR_TP:-3.0}"
SR_BUFFER="${SR_BUFFER:-0.1}"
SR_PIVOT="${SR_PIVOT:-classic}"
SR_MIN_HOUR="${SR_MIN_HOUR:-9}"
SR_MIN_MIN="${SR_MIN_MIN:-15}"
SR_MAX_HOUR="${SR_MAX_HOUR:-15}"
SR_MAX_MIN="${SR_MAX_MIN:-15}"

export SR_SL SR_TP SR_BUFFER SR_PIVOT SR_MIN_HOUR SR_MIN_MIN SR_MAX_HOUR SR_MAX_MIN

python3 "$SCRIPT_DIR/scripts/sr_benchmark.py"
