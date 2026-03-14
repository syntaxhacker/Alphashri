#!/bin/bash
set -e

echo "🚀 Starting Alphashri Production Server..."

# Wait for PostgreSQL (only if DATABASE_URL is set)
if [ -n "$DATABASE_URL" ] && [[ "$DATABASE_URL" == postgres* ]]; then
  echo "⏳ Waiting for PostgreSQL..."
  # Extract host from DATABASE_URL
  DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:\/]*\):.*/\1/p')
  DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
  DB_PORT=${DB_PORT:-5432}
  
  until pg_isready -h $DB_HOST -p $DB_PORT -U postgres 2>/dev/null; do
    echo "  Database not ready, retrying in 2s..."
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
