#!/bin/bash
set -e

echo "🚀 Starting Alphashri Production Server..."

# Debug: Show current directory and files
echo "Current directory: $(pwd)"
echo "Files in current directory:"
ls -la /app/stock-screener-ui/
echo ""
echo "Checking for config.py:"
if [ ! -f /app/stock-screener-ui/config.py ]; then
  if [ -f /app/stock-screener-ui/config_template.py ]; then
    echo "📋 Copying config_template.py to config.py..."
    cp /app/stock-screener-ui/config_template.py /app/stock-screener-ui/config.py
    echo "✅ config.py created from template"
  else
    echo "❌ Neither config.py nor config_template.py found!"
    exit 1
  fi
else
  echo "✅ config.py found"
fi
echo "PYTHONPATH=$PYTHONPATH"
echo ""

# Wait for PostgreSQL (only if DATABASE_URL is set)
if [ -n "$DATABASE_URL" ] && [[ "$DATABASE_URL" == postgres* ]]; then
  echo "⏳ Waiting for PostgreSQL..."
  echo "  DATABASE_URL detected"
  
  # Try connecting with Python (more reliable than pg_isready)
  MAX_RETRIES=30
  RETRY_COUNT=0
  
  until python -c "
import sys
import psycopg2
try:
    conn = psycopg2.connect('$DATABASE_URL', connect_timeout=5)
    conn.close()
    sys.exit(0)
except Exception as e:
    print(f'Connection failed: {e}', file=sys.stderr)
    sys.exit(1)
" 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
      echo "❌ Database connection failed after $MAX_RETRIES attempts"
      exit 1
    fi
    echo "  Database not ready, retrying in 2s... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  done
  echo "✅ Database ready!"
fi

# Never auto-seed in production (SEED_DATA defaults to false)
if [ "${SEED_DATA:-false}" = "true" ]; then
  echo "⚠️ SEED_DATA=true in production! This should only be used for initial setup."
  cd /app/stock-screener-ui
  python scripts/seed_qa_data.py --clean 2>/dev/null || echo "⚠️ Seed script failed"
fi

# Auto-seed instruments if table is empty (runs in background)
cd /app/stock-screener-ui
INSTRUMENTS_COUNT=$(python -c "
from db.database import SessionLocal
from db.models import Instrument
db = SessionLocal()
try:
    print(db.query(Instrument).count())
finally:
    db.close()
" 2>/dev/null || echo "0")

if [ "$INSTRUMENTS_COUNT" = "0" ]; then
  echo "📊 Instruments table is empty. Seeding in background..."
  nohup python scripts/seed_instruments.py > /tmp/seed_instruments.log 2>&1 &
  echo "✅ Seed started in background (PID: $!)"
else
  echo "✅ Instruments table has $INSTRUMENTS_COUNT records"
fi

# Start the server
echo "🎯 Starting FastAPI server..."
cd /app/stock-screener-ui
exec python run_server.py
