#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# ── Config ──────────────────────────────────────────────────────────────────
API_PORT="${API_PORT:-8765}"
UI_PORT="${UI_PORT:-5173}"

API_LOG="${API_LOG:-logs/api.log}"
UI_LOG="${UI_LOG:-logs/ui.log}"

API_PID="/tmp/alphashri-api.pid"
UI_PID="/tmp/alphashri-ui.pid"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Prerequisites ────────────────────────────────────────────────────────────
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

# ── PID helpers ──────────────────────────────────────────────────────────────
is_running() {
  [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null
}

# ── Port killing ─────────────────────────────────────────────────────────────
kill_port() {
  local port=$1
  local pids
  pids="$(lsof -ti:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo -e "  ${YELLOW}Killing process(es) on port $port: $pids${NC}"
    kill $pids 2>/dev/null || true
    sleep 1
    local remaining
    remaining="$(lsof -ti:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$remaining" ]; then
      echo -e "  ${RED}Force killing: $remaining${NC}"
      kill -9 $remaining 2>/dev/null || true
      sleep 1
    fi
  fi
}

kill_service() {
  local name="$1" pid_file="$2" port="${3:-}"

  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "  Stopping $name (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
      fi
    fi
    rm -f "$pid_file"
  fi

  if [ -n "$port" ]; then
    kill_port "$port"
  fi
}

# ── Health check ─────────────────────────────────────────────────────────────
wait_for_port() {
  local name="$1" port="$2" timeout="$3"
  echo -n "  Waiting for $name..."
  for i in $(seq 1 "$timeout"); do
    if curl -s "http://localhost:$port" >/dev/null 2>&1 ||
       curl -s "http://localhost:$port/docs" >/dev/null 2>&1; then
      echo -e " ${GREEN}ready (${i}s)${NC}"
      return 0
    fi
    sleep 1
    echo -n "."
  done
  echo -e " ${RED}FAILED after ${timeout}s${NC}"
  return 1
}

# ── Service start functions ─────────────────────────────────────────────────

start_api() {
  if is_running "$API_PID"; then
    echo -e "  ${YELLOW}API already running (PID $(cat "$API_PID"))${NC}"
    return 0
  fi
  kill_port "$API_PORT"

  echo -e "  ${CYAN}Starting API (port $API_PORT)...${NC}"
  mkdir -p logs
  source .venv/bin/activate

  (
    exec uvicorn api_server_fastapi:app \
      --host 127.0.0.1 \
      --port "$API_PORT" \
      --reload >> "$API_LOG" 2>&1
  ) &
  echo $! > "$API_PID"

  wait_for_port "API" "$API_PORT" 30
  echo -e "  ${GREEN}API started (PID $(cat "$API_PID"))${NC}"
}

start_ui() {
  if is_running "$UI_PID"; then
    echo -e "  ${YELLOW}UI already running (PID $(cat "$UI_PID"))${NC}"
    return 0
  fi
  kill_port "$UI_PORT"

  echo -e "  ${CYAN}Starting UI (port $UI_PORT)...${NC}"
  (
    exec bun run dev --host 127.0.0.1 --port "$UI_PORT" >> "$UI_LOG" 2>&1
  ) &
  echo $! > "$UI_PID"

  wait_for_port "UI" "$UI_PORT" 60
  echo -e "  ${GREEN}UI started (PID $(cat "$UI_PID"))${NC}"
}

# ── Status ───────────────────────────────────────────────────────────────────
show_status() {
  echo ""
  echo -e "${CYAN}── Project Services ──${NC}"
  echo ""

  local all_ok=true

  if is_running "$API_PID"; then
    echo -e "  ${GREEN}●${NC} API   RUNNING (PID $(cat "$API_PID")) → http://localhost:$API_PORT"
  else
    echo -e "  ${RED}○${NC} API   STOPPED"
    all_ok=false
  fi

  if is_running "$UI_PID"; then
    echo -e "  ${GREEN}●${NC} UI    RUNNING (PID $(cat "$UI_PID")) → http://localhost:$UI_PORT"
  else
    echo -e "  ${RED}○${NC} UI    STOPPED"
    all_ok=false
  fi

  echo ""
  if $all_ok; then
    echo -e "  ${GREEN}Status: ✓ All services running${NC}"
  else
    echo -e "  ${RED}Status: ✗ Some services are down${NC}"
  fi
  echo ""
}

# ── Logs ─────────────────────────────────────────────────────────────────────
show_logs() {
  local service="$1"
  local lines="${2:-50}"
  case "$service" in
    api|API)     tail -f "$API_LOG" -n "$lines" ;;
    ui|UI)       tail -f "$UI_LOG" -n "$lines" ;;
    all)         tail -f "$API_LOG" "$UI_LOG" -n "$lines" ;;
    *)           echo "Usage: $0 logs {api|ui|all} [lines]" ;;
  esac
}

# ── Commands ─────────────────────────────────────────────────────────────────
check_prereqs

case "${1:-status}" in
  start|dev)
    echo -e "${CYAN}Starting API + UI...${NC}"
    start_api
    start_ui
    show_status
    ;;

  stop)
    echo -e "${RED}Stopping services...${NC}"
    kill_service "UI"    "$UI_PID"   "$UI_PORT"
    kill_service "API"   "$API_PID"  "$API_PORT"
    echo -e "${GREEN}Services stopped.${NC}"
    echo ""
    echo "Note: bots are managed via API: POST /api/bots/{bot_id}/start"
    ;;

  restart)
    echo -e "${YELLOW}Restarting services...${NC}"
    kill_service "UI"    "$UI_PID"   "$UI_PORT"
    kill_service "API"   "$API_PID"  "$API_PORT"
    sleep 1
    start_api
    start_ui
    show_status
    ;;

  status)
    show_status
    ;;

  logs)
    shift
    show_logs "${1:-all}" "${2:-50}"
    ;;

  api)
    start_api
    ;;

  ui)
    start_ui
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|dev|status|logs|api|ui}"
    echo ""
    echo "  start       Start API + UI"
    echo "  stop        Stop API + UI"
    echo "  restart     Restart API + UI"
    echo "  status      Show running status"
    echo "  logs [svc]  Tail logs (api|ui|all, default: all)"
    echo "  api         Start only API"
    echo "  ui          Start only UI"
    echo ""
    echo "Bots are managed via the API:"
    echo "  curl -X POST http://localhost:$API_PORT/api/bots/{bot_id}/start?test_mode=true -H 'Authorization: Bearer <token>'"
    exit 1
    ;;
esac
