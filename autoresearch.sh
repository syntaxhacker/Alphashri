#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
source stock-screener-ui/.venv/bin/activate 2>/dev/null || source .venv/bin/activate 2>/dev/null || true
OR_MIN="${OR_MIN:-15}"
TF="${TF:-3}"
EFF_THR="${EFF_THR:-0.50}"
HL_THR="${HL_THR:-3}"
TP_R="${TP_R:-1.2}"
RETEST="${RETEST:-0}"
python3 experiments/benchmark_orb_winrate.py
