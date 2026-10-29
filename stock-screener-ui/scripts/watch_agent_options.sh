#!/usr/bin/env bash
# Second-layer watchdog: keep the agent options loop alive until 15:30 IST.
# The supervisor restarts the runner; this restarts the supervisor if both die.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
LOG="$ROOT/logs/agent_options.log"
mkdir -p "$ROOT/logs"

restart_supervisor() {
  echo "[watchdog] runner missing at $(date +%H:%M:%S) — restarting supervisor" >> "$LOG"
  setsid nohup bash -c "
    cd '$ROOT'
    while [ \"\$(date +%H%M)\" -lt 1531 ]; do
      .venv/bin/python -m options_paper.live
      rc=\$?
      echo \"[supervisor] runner exited rc=\$rc at \$(date +%H:%M:%S)\"
      [ \"\$(date +%H%M)\" -ge 1531 ] && break
      sleep 5
    done
  " >> "$LOG" 2>&1 < /dev/null &
}

echo "[watchdog] started at $(date +%H:%M:%S) (pid $$)" >> "$LOG"
while [ "$(date +%H%M)" -lt 1531 ]; do
  if ! pgrep -f '\.venv/bin/python -m options_paper\.live' >/dev/null 2>&1; then
    restart_supervisor
  fi
  sleep 30
done
echo "[watchdog] market closed at $(date +%H:%M:%S) — exiting" >> "$LOG"
