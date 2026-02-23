#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-8765}"
UI_HOST="${UI_HOST:-127.0.0.1}"
UI_PORT="${UI_PORT:-5173}"
LOG_FILE="${LOG_FILE:-/tmp/stock-screener.log}"

kill_port() {
  local port=$1
  local pid
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    echo "Killing existing process on port $port (PID: $pid)..."
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
}

cleanup() {
  echo
  echo "Stopping services..."
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${UI_PID:-}" ]] && kill -0 "$UI_PID" 2>/dev/null; then
    kill "$UI_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

# Kill existing processes on ports
kill_port "$API_PORT"
kill_port "$UI_PORT"

# Fresh log file on each start
: > "$LOG_FILE"
echo "Logging to: $LOG_FILE"

echo "Starting API on http://localhost:${API_PORT} ..."
uvicorn api_server_fastapi:app --host localhost --port "${API_PORT}" --reload >> "$LOG_FILE" 2>&1 &
API_PID=$!

echo "Starting UI on http://${UI_HOST}:${UI_PORT} ..."
bun run dev --host "${UI_HOST}" --port "${UI_PORT}" >> "$LOG_FILE" 2>&1 &
UI_PID=$!

echo "API PID: ${API_PID}"
echo "UI PID: ${UI_PID}"
echo "Press Ctrl+C to stop both."
echo "Tail logs: tail -f $LOG_FILE"

wait "$API_PID" "$UI_PID"
