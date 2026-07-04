#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export EMA_FAST="${EMA_FAST:-9}"
export EMA_SLOW="${EMA_SLOW:-21}"
export EMA_SL="${EMA_SL:-1.0}"
export EMA_TP="${EMA_TP:-1.5}"
export EMA_COOLDOWN="${EMA_COOLDOWN:-3}"
export EMA_SHORTS="${EMA_SHORTS:-0}"
export EMA_EOD_HOUR="${EMA_EOD_HOUR:-14}"
export EMA_EOD_MINUTE="${EMA_EOD_MINUTE:-45}"
export EMA_TRADE_CAPITAL="${EMA_TRADE_CAPITAL:-100000}"
export EMA_CACHE_DIR="${EMA_CACHE_DIR:-./experiments/data}"

python3 "$SCRIPT_DIR/experiments/ema_benchmark.py"
