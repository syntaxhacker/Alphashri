#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

python3 -c "import autoresearch" 2>/dev/null || { echo "FAIL: import error"; exit 1; }

python3 autoresearch.py
