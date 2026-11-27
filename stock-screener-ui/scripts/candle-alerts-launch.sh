#!/usr/bin/env bash
# Dock launcher: focus the running window instead of opening a second copy.
set -e

ROOT="$HOME/Documents/Alphashri/stock-screener-ui"

if pgrep -f "candle_alert_desktop\.py" >/dev/null 2>&1; then
    WINDOW=$(xdotool search --name "Candle Close Alerts" 2>/dev/null | tail -1 || true)
    if [ -n "$WINDOW" ]; then
        xdotool windowactivate --sync "$WINDOW" 2>/dev/null || true
    fi
    exit 0
fi

exec "$ROOT/.venv/bin/python" -u "$ROOT/scripts/candle_alert_desktop.py"
