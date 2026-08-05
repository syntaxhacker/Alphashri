#!/usr/bin/env bash
# Continuously run the paper SENSEX strategy monitor until 15:20 IST.
# Self-healing: if the monitor process dies, restart it.
# Logs to experiments/data/paper_monitor.log
set -u
cd "$(dirname "$0")/.." || exit 1

source .venv/bin/activate 2>/dev/null || true

END="15:20"
INTERVAL="${1:-120}"

echo "[watchdog $(date '+%H:%M:%S')] starting monitor loop until $END IST (interval ${INTERVAL}s)"

while true; do
  NOW_H=$(date +%H); NOW_M=$(date +%M)
  if [ "$NOW_H" -gt 15 ] || { [ "$NOW_H" -eq 15 ] && [ "$NOW_M" -ge 20 ]; }; then
    echo "[watchdog] reached $END IST — stopping."
    break
  fi
  if ! pgrep -f "python3 scripts/paper_options_monitor" >/dev/null; then
    echo "[watchdog $(date '+%H:%M:%S')] monitor not running — starting..."
    python3 scripts/paper_options_monitor.py --interval "$INTERVAL" --max-samples 100000 --until "$END" --strategy >> experiments/data/paper_monitor.log 2>&1 &
    echo "[watchdog] started pid $!"
  fi
  sleep 60
done

# final kill after end time
pkill -f "python3 scripts/paper_options_monitor" 2>/dev/null
echo "[watchdog] done."
