#!/usr/bin/env bash
# Reproducible Python duplicate audit; findings are tracked in docs/DRY_OPPORTUNITIES.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -x node_modules/.bin/jscpd ]]; then
  echo "ERROR: jscpd is unavailable (node_modules/.bin/jscpd not found)." >&2
  echo "Install dependencies first: bun install  (or: npm install)" >&2
  exit 1
fi

exec node_modules/.bin/jscpd api scripts trading backtest db -f python --min-lines 5 --reporters console
