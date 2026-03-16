#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

UI_HOST="${UI_HOST:-127.0.0.1}"
UI_PORT="${UI_PORT:-5173}"
LOG_FILE="${LOG_FILE:-/tmp/alphashri-dev-prod.log}"

ENV_FILE=".env.development.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Create it with prod URLs:"
  echo "  VITE_API_BASE_URL=https://earner-production.up.railway.app"
  echo "  VITE_WS_BASE_URL=wss://earner-production.up.railway.app"
  exit 1
fi

kill_port() {
  local port=$1
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Killing existing listener(s) on port $port: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

cleanup() {
  echo
  echo "Stopping UI..."
  if [[ -n "${UI_PID:-}" ]] && kill -0 "$UI_PID" 2>/dev/null; then
    kill "$UI_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

kill_port "$UI_PORT"

: > "$LOG_FILE"
echo "Logging to: $LOG_FILE"

echo "Starting UI (prod backend) on http://${UI_HOST}:${UI_PORT}"
echo "API: $(grep VITE_API_BASE_URL $ENV_FILE | cut -d= -f2)"
bun run dev --host "${UI_HOST}" --port "${UI_PORT}" >> "$LOG_FILE" 2>&1 &
UI_PID=$!

echo "UI PID: ${UI_PID}"
echo "Press Ctrl+C to stop."
echo "Tail logs: tail -f $LOG_FILE"

wait "$UI_PID"
