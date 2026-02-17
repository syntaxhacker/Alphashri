#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-8765}"
UI_HOST="${UI_HOST:-127.0.0.1}"
UI_PORT="${UI_PORT:-5173}"

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

echo "Starting API on http://localhost:${API_PORT} ..."
python3 -u api_server.py --port "${API_PORT}" &
API_PID=$!

echo "Starting UI on http://${UI_HOST}:${UI_PORT} ..."
bun run dev --host "${UI_HOST}" --port "${UI_PORT}" &
UI_PID=$!

echo "API PID: ${API_PID}"
echo "UI PID: ${UI_PID}"
echo "Press Ctrl+C to stop both."

wait "$API_PID" "$UI_PID"
