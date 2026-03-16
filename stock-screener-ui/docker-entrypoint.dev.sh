#!/bin/bash
set -e

echo "🚀 Starting Alphashri Dev Server (SQLite)..."

# No database wait needed for SQLite

# Run seed script if SEED_DATA=true
if [ "${SEED_DATA:-false}" = "true" ]; then
  echo "🌱 Seeding initial data..."
  python scripts/seed_qa_data.py --clean 2>/dev/null || echo "⚠️ Seed script failed (may already be seeded)"
  echo "✅ Seeding complete!"
fi

# Start the server with reload for development
echo "🎯 Starting FastAPI server..."
exec uvicorn api_server_fastapi:app --host 0.0.0.0 --port 8765 --reload
