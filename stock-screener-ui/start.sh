#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

# ── Config ───────────────────────────────────────────────────────────
API_PORT="${API_PORT:-8765}"
API_HOST="${API_HOST:-127.0.0.1}"
UI_HOST="${UI_HOST:-127.0.0.1}"
UI_PORT="${UI_PORT:-5173}"
API_LOG="${API_LOG:-logs/alphashri.log}"
API_PID="/tmp/alphashri-api.pid"
UI_PID="/tmp/alphashri-ui.pid"
START_BOTS="${START_BOTS:-false}"
QA_EMAIL="${QA_EMAIL:-qa@test.com}"
QA_PASS="${QA_PASS:-qa123}"
RELOAD_FLAG="${RELOAD_FLAG---reload}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Cleanup trap (Ctrl+C for `dev`/`prod` mode) ────────────────────────
cleanup() {
  echo
  echo "Stopping services..."
  stop_frontend 2>/dev/null || true
  stop_backend 2>/dev/null || true
  echo "All stopped."
}
trap cleanup INT TERM

# ── Prerequisites ─────────────────────────────────────────────────────
check_prereqs() {
  local ok=true
  if ! command -v lsof &>/dev/null; then
    echo "WARNING: lsof not found — port killing may be unreliable" >&2
  fi
  if [ ! -f .venv/bin/activate ]; then
    echo "ERROR: .venv not found — run 'uv venv && uv pip install -r requirements.txt'" >&2
    ok=false
  fi
  if [ ! -d node_modules ]; then
    echo "WARNING: node_modules not found — run 'bun install'" >&2
  fi
  $ok
}

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

# ── Port killer ───────────────────────────────────────────────────────
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

# ── PID helpers ───────────────────────────────────────────────────────
is_running() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
cleanup_pid() { rm -f "$1"; }

# ── Log helpers ───────────────────────────────────────────────────────
setup_log() {
  mkdir -p "$(dirname "$API_LOG")"
  : > "$API_LOG"
  echo "Logging to: $API_LOG"
}

activate_venv() {
  local venv="${1:-.venv}"
  if [ -d "$venv/bin" ]; then
    # shellcheck disable=SC1091
    source "$venv/bin/activate"
    echo "Activated venv: $venv"
  fi
}

# ── Service management ─────────────────────────────────────────────────
start_backend() {
  local reload_args=""
  if is_running "$API_PID"; then
    echo "Backend already running (PID $(cat "$API_PID"))"
    return
  fi
  kill_port "$API_PORT"
  if [ -n "$RELOAD_FLAG" ]; then
    reload_args="$RELOAD_FLAG --reload-delay 60"
  fi
  echo "Starting API on http://${API_HOST}:${API_PORT} ..."
  # shellcheck disable=SC2086
  uvicorn api_server_fastapi:app --host "$API_HOST" --port "$API_PORT" $reload_args >> "$API_LOG" 2>&1 &
  echo $! > "$API_PID"
  wait_for "API" "http://localhost:${API_PORT}/api/health" 20
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

stop_bots() {
  echo "  Stopping running bots..."
  if ! curl -s -X POST "http://localhost:${API_PORT}/api/bots/internal/stop-all" > /dev/null 2>&1; then
    local bot_pids
    bot_pids="$(pgrep -f "runner_cli.py" 2>/dev/null || true)"
    if [ -n "$bot_pids" ]; then
      echo "  Killing ${bot_pids// /, }..."
      kill $bot_pids 2>/dev/null || true
      sleep 2
      bot_pids="$(pgrep -f "runner_cli.py" 2>/dev/null || true)"
      [ -n "$bot_pids" ] && kill -9 $bot_pids 2>/dev/null || true
    fi
  fi
}

start_bots() {
  echo "  Starting all bots for QA user..."
  local token
  token="$(curl -s -X POST "http://localhost:${API_PORT}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${QA_EMAIL}\",\"password\":\"${QA_PASS}\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)"
  if [ -z "$token" ]; then
    echo "  Failed to get auth token — skipping bot start"
    return 1
  fi
  curl -s -L -H "Authorization: Bearer $token" "http://localhost:${API_PORT}/api/bots/" \
    | python3 -c "
import json,sys
data = json.load(sys.stdin)
for b in data:
    print(b['id'])
" 2>/dev/null | while read -r bot_id; do
    curl -s -X POST -H "Authorization: Bearer $token" \
      "http://localhost:${API_PORT}/api/bots/${bot_id}/start" > /dev/null 2>&1
  done
  echo "  Done."
}

stop_backend() {
  stop_bots
  sleep 1
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
  local bot_status
  bot_status="$(curl -s http://localhost:${API_PORT}/api/bots/internal/status 2>/dev/null || echo '{"running":0}')"
  local bot_count
  bot_count="$(echo "$bot_status" | python3 -c "import json,sys; print(json.load(sys.stdin).get('running',0))" 2>/dev/null || echo "0")"
  if [ "$bot_count" -gt 0 ]; then
    echo "  Bots:      $bot_count RUNNING"
  else
    echo "  Bots:      0 running"
  fi
  $ok && echo "  Status:    ✓ All running" || echo "  Status:    ✗ Some down"
}

# ── Logs ──────────────────────────────────────────────────────────────
show_logs() {
  local lines="${1:-50}"
  tail -f "$API_LOG" -n "$lines"
}

# ── Main ──────────────────────────────────────────────────────────────
check_prereqs || exit 1
setup_log
activate_venv ".venv"

case "${1:-status}" in
  start)
    start_backend
    start_frontend
    $START_BOTS && start_bots
    show_status
    echo "Tail logs: tail -f $API_LOG"
    echo "Manage bots: $0 bots start|stop"
    ;;
  stop)
    echo "Stopping services..."
    stop_frontend
    stop_backend
    echo "All stopped."
    ;;
  restart)
    mode="${2:-dev}"
    [ "$mode" = "prod" ] && RELOAD_FLAG=""
    echo "Restarting in $mode mode..."
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
    $START_BOTS && start_bots
    show_status
    echo "Tail logs: tail -f $API_LOG"
    echo "Press Ctrl+C to stop."
    wait
    ;;
  prod)
    RELOAD_FLAG=""
    echo "Starting in production mode (no reload)..."
    start_backend
    start_frontend
    $START_BOTS && start_bots
    show_status
    echo "Tail logs: tail -f $API_LOG"
    echo "Press Ctrl+C to stop."
    wait
    ;;
  bots)
    case "${2:-status}" in
      start) start_bots ;;
      stop)  stop_bots ;;
      status)
        curl -s "http://localhost:${API_PORT}/api/bots/internal/status" 2>/dev/null \
          | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{d[\"running\"]} bot(s) running')" 2>/dev/null \
          || echo "API unreachable"
        ;;
      *) echo "Usage: $0 bots {start|stop|status}" ;;
    esac
    ;;
  status)
    show_status
    ;;
  logs)
    shift
    show_logs "${1:-50}"
    ;;
  backend|api)
    start_backend
    ;;
  frontend|ui)
    start_frontend
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|dev|prod|bots|status|logs|backend|frontend}"
    echo ""
    echo "  start       Start API + UI (background, reload on)"
    echo "  stop        Stop all services + bots"
    echo "  restart     Restart API + UI (./start.sh restart prod for no reload)"
    echo "  dev         Start API (reload) + UI (foreground, Ctrl+C to stop)"
    echo "  prod        Start API (no reload) + UI (foreground, Ctrl+C to stop)"
    echo "  bots        Manage bots: $0 bots start|stop|status"
    echo "  status      Show service status"
    echo "  logs        Tail API log: $0 logs [lines]"
    echo ""
    echo "Environment:"
    echo "  START_BOTS=true   Auto-start bots after API is ready"
    echo "  API_PORT=8765     API server port"
    echo "  API_HOST=127.0.0.1 API bind host"
    echo "  API_LOG=path      Log file path"
    echo "  RELOAD_FLAG=''    Disable --reload"
    echo ""
    echo "Examples:"
    echo "  START_BOTS=true ./start.sh prod   # prod mode + auto-start bots"
    echo "  ./start.sh bots start             # start all bots"
    echo "  ./start.sh stop                   # stop everything"
    exit 1
    ;;
esac
