#!/bin/bash
set -e

echo "🚀 Starting Alphashri Dev Server (SQLite)..."

# No database wait needed for SQLite

# Seed instruments if table is empty
python -c "
from db.database import SessionLocal
from db.models import Instrument
db = SessionLocal()
count = db.query(Instrument).count()
db.close()
exit(0 if count > 0 else 1)
" 2>/dev/null || {
  echo "🌱 Seeding instruments..."
  python scripts/seed_instruments.py 2>/dev/null || echo "⚠️ Instrument seed failed"
}

# Run seed script if SEED_DATA=true
if [ "${SEED_DATA:-false}" = "true" ]; then
  echo "🌱 Seeding initial data..."
  python scripts/seed_qa_data.py --clean 2>/dev/null || echo "⚠️ Seed script failed (may already be seeded)"
  echo "✅ Seeding complete!"
fi

# Sync broker tokens from production if PROD_DATABASE_URL is set
if [ -n "${PROD_DATABASE_URL:-}" ]; then
  echo "🔄 Syncing broker tokens from production..."
  python scripts/sync_broker_tokens.py 2>/dev/null || echo "⚠️ Token sync failed"
fi

# Start the server with reload for development
echo "🎯 Starting FastAPI server..."
exec uvicorn api_server_fastapi:app --host 0.0.0.0 --port 8765 --reload
