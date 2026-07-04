#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# ── Config ───────────────────────────────────────────────────────────
API_PORT="${API_PORT:-8765}"
UI_HOST="${UI_HOST:-127.0.0.1}"
UI_PORT="${UI_PORT:-5173}"
API_LOG="${API_LOG:-logs/alphashri.log}"
API_PID="/tmp/alphashri-api.pid"
UI_PID="/tmp/alphashri-ui.pid"

# ── Health check ──────────────────────────────────────────────────────
wait_for() {
  local label="$1" url="$2" max="$3" i=0
  while [ $i -lt "$max" ]; do
    if curl -s "$url" > /dev/null 2>&1; then
      echo "  $label started"
      return 0
    fi
    sleep 1
    i=$((i+1))
  done
  echo "  WARNING: $label may not be ready after ${max}s"
  return 1
}

# ── Port killer ────────────────────────────────────────────────────────
kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
}

# ── PID helpers ─────────────────────────────────────────────────────────
is_running() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
cleanup_pid() { rm -f "$1"; }

# ── Log helpers ─────────────────────────────────────────────────────────
setup_log() {
  mkdir -p "$(dirname "$API_LOG")"
  : > "$API_LOG"
  echo "Logging to: $API_LOG"
}

# ── Prerequisites ───────────────────────────────────────────────────────
activate_venv() {
  local venv="${1:-.venv}"
  if [ -d "$venv/bin" ]; then
    # shellcheck disable=SC1091
    source "$venv/bin/activate"
    echo "Activated venv: $venv"
  fi
}

# ── Service management ───────────────────────────────────────────────────
start_backend() {
  if is_running "$API_PID"; then
    echo "Backend already running (PID $(cat "$API_PID"))"
    return
  fi
  kill_port "$API_PORT"
  echo "Starting API on http://localhost:${API_PORT} ..."
  uvicorn api_server_fastapi:app --host :: --port "$API_PORT" --reload --reload-delay 60 >> "$API_LOG" 2>&1 &
  echo $! > "$API_PID"
  wait_for "API" "http://localhost:${API_PORT}/api/replay/configs" 15
}

start_frontend() {
  if is_running "$UI_PID"; then
    echo "Frontend already running (PID $(cat "$UI_PID"))"
    return
  fi
  kill_port "$UI_PORT"
  echo "Starting UI on http://${UI_HOST}:${UI_PORT} ..."
  bun run dev --host "$UI_HOST" --port "$UI_PORT" >> "$API_LOG" 2>&1 &
  echo $! > "$UI_PID"
  wait_for "UI" "http://${UI_HOST}:${UI_PORT}" 30
}

stop_backend() {
  echo "  Stopping backend..."
  kill_port "$API_PORT"
  cleanup_pid "$API_PID"
}

stop_frontend() {
  echo "  Stopping frontend..."
  kill_port "$UI_PORT"
  cleanup_pid "$UI_PID"
}

show_status() {
  echo "── Alphashri Services ──"
  local ok=true
  if is_running "$API_PID"; then
    echo "  API:       RUNNING (PID $(cat "$API_PID")) → http://localhost:$API_PORT"
  else
    echo "  API:       STOPPED"; ok=false
  fi
  if is_running "$UI_PID"; then
    echo "  UI:        RUNNING (PID $(cat "$UI_PID")) → http://$UI_HOST:$UI_PORT"
  else
    echo "  UI:        STOPPED"; ok=false
  fi
  $ok && echo "  Status:    ✓ All running" || echo "  Status:    ✗ Some down"
}

# ── Main ─────────────────────────────────────────────────────────────────
setup_log
activate_venv ".venv"

case "${1:-status}" in
  start)
    start_backend
    start_frontend
    show_status
    echo "Tail logs: tail -f $API_LOG"
    ;;
  stop)
    echo "Stopping services..."
    stop_frontend
    stop_backend
    echo "All stopped."
    ;;
  restart)
    echo "Restarting..."
    stop_frontend
    stop_backend
    sleep 1
    start_backend
    start_frontend
    show_status
    ;;
  dev)
    start_backend
    start_frontend
    show_status
    echo "Tail logs: tail -f $API_LOG"
    echo "Press Ctrl+C to stop."
    wait
    ;;
  status)
    show_status
    ;;
  backend)
    start_backend
    ;;
  frontend)
    start_frontend
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|dev|status|backend|frontend}"
    exit 1
    ;;
esac
