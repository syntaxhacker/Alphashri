#!/usr/bin/env bash
# One-shot experiment runner for newgen-orb-15m.
# Usage: ./run.sh <run_num> <status> "<description>" [ENV_OVERRIDES...]
# ENV_OVERRIDES are passed as name=value pairs (exported for the benchmark).
set -euo pipefail

cd "$(dirname "$0")/../../.."

RUN="$1"
STATUS="$2"
DESC="$3"
shift 3

# export overrides
for kv in "$@"; do
  export "$kv"
done

source .venv/bin/activate
COMMIT=$(git rev-parse --short HEAD)

OUT=$(python3 experiments/newgen/newgen-orb-15m/benchmark.py 2>&1)
echo "$OUT"

pf=$(echo "$OUT" | grep -oP 'METRIC pf=\K[0-9.]+')
wr=$(echo "$OUT" | grep -oP 'METRIC win_rate=\K[0-9.]+')
net=$(echo "$OUT" | grep -oP 'METRIC net_pnl=\K[-0-9.]+')
nt=$(echo "$OUT" | grep -oP 'METRIC total_trades=\K[0-9]+')
tp=$(echo "$OUT" | grep -oP 'METRIC tp_exits=\K[0-9]+')
sl=$(echo "$OUT" | grep -oP 'METRIC sl_exits=\K[0-9]+')
eod=$(echo "$OUT" | grep -oP 'METRIC eod_exits=\K[0-9]+')

python3 experiments/newgen/newgen-orb-15m/log.py "$RUN" "$COMMIT" "$pf" "$wr" "$net" "$nt" "$tp" "$sl" "$eod" "$STATUS" "$DESC"

# append worklog
{
  echo "### Run $RUN: $DESC — pf=$pf ($STATUS)"
  echo "- Timestamp: $(date '+%Y-%m-%d %H:%M')"
  echo "- What changed: $DESC"
  echo "- Result: PF=$pf WR=${wr}% net_pnl=$net trades=$nt tp=$tp sl=$sl eod=$eod"
  echo ""
} >> experiments/worklog_newgen-orb-15m.md
