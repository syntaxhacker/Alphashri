#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/../.."

if [ -f "$ROOT_DIR/.env.dev" ]; then
    set -a
    . "$ROOT_DIR/.env.dev"
    set +a
fi

SR_SL="${SR_SL:-0.6}"
SR_TP="${SR_TP:-2.0}"
SR_BUFFER="${SR_BUFFER:-0.1}"
SR_PIVOT="${SR_PIVOT:-camarilla}"
SR_MIN_HOUR="${SR_MIN_HOUR:-10}"
SR_MIN_MIN="${SR_MIN_MIN:-30}"
SR_MAX_HOUR="${SR_MAX_HOUR:-15}"
SR_MAX_MIN="${SR_MAX_MIN:-15}"

export SR_SL SR_TP SR_BUFFER SR_PIVOT SR_MIN_HOUR SR_MIN_MIN SR_MAX_HOUR SR_MAX_MIN

cd "$SCRIPT_DIR"
python3 benchmark.py
