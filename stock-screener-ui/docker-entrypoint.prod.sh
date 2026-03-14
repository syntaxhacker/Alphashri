#!/bin/bash
set -e

echo "🚀 Starting Alphashri Production Server..."

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

# Start the server
echo "🎯 Starting FastAPI server..."
exec uvicorn api_server_fastapi:app --host 0.0.0.0 --port ${PORT:-8765}
