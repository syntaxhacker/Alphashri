#!/usr/bin/env bash
# Adds the backend paths to the pull_request CI filter.
#
# Why you have to run this: the current GitHub token has scopes
#   admin:public_key, codespace, gist, read:org, repo, user
# — no `workflow`. GitHub refuses any push or merge that touches
# .github/workflows/**, with:
#   "refusing to allow an OAuth App to create or update workflow ... without
#    workflow scope"
#
# That refusal is what silently closed PR #232 without merging.
#
# What it fixes: a Python-only PR currently runs ZERO tests (only GitGuardian),
# because the filter lists src/ and tests/ but never api/. Verified by
# simulating the filter — tv-limit, movers-columns, trading/, chart_patterns/
# and backtest/ changes all SKIP today and all run after.
#
# Usage:
#   bash scripts/dev/add-backend-to-ci-paths.sh
#   git add .github/workflows/test.yml
#   git commit -m "ci: run checks for Python-only changes"
#   git push -u origin <branch>     # needs workflow scope on your token
#
# Alternative if you would rather edit by hand: open .github/workflows/test.yml
# and add the seven lines below under `pull_request: paths:`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WF="$ROOT/.github/workflows/test.yml"

[ -f "$WF" ] || { echo "not found: $WF" >&2; exit 1; }
grep -q "stock-screener-ui/api/\*\*" "$WF" && { echo "already present — nothing to do"; exit 0; }

python3 - "$WF" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
s = p.read_text()
anchor = "      - 'stock-screener-ui/src/**'\n      - 'stock-screener-ui/tests/**'\n"
if anchor not in s:
    sys.exit("anchor not found — the filter changed shape; edit by hand")
addition = (
    "      # Python-only changes had NO checks: the filter listed src/ but never\n"
    "      # the backend, so an api/**-only PR ran just GitGuardian. Caught when a\n"
    "      # one-line dashboard constant change produced no test run at all.\n"
    "      - 'stock-screener-ui/api/**'\n"
    "      - 'stock-screener-ui/trading/**'\n"
    "      - 'stock-screener-ui/chart_patterns/**'\n"
    "      - 'stock-screener-ui/backtest/**'\n"
    "      - 'stock-screener-ui/db/**'\n"
    "      - 'stock-screener-ui/config.py'\n"
    "      - 'stock-screener-ui/api_server_fastapi.py'\n"
)
p.write_text(s.replace(anchor, anchor + addition, 1))
print(f"patched {p}")
PY

python3 -c "
import yaml, sys
yaml.safe_load(open('$WF'))
print('workflow YAML still valid')
" || { echo "YAML INVALID — revert with: git checkout -- $WF" >&2; exit 1; }

echo
echo "Next:"
echo "  git add .github/workflows/test.yml"
echo "  git commit -m 'ci: run checks for Python-only changes'"
echo "  git push -u origin <branch>   # needs workflow scope"
