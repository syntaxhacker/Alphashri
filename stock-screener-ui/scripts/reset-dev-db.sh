#!/bin/bash
# Reset development SQLite database

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(dirname "$SCRIPT_DIR")/db"
DB_FILE="$DB_DIR/alphashri.db"
LLM_CACHE="$DB_DIR/llm_cache.db"

echo "🔄 Resetting development database..."

# Backup existing DB
if [ -f "$DB_FILE" ]; then
  BACKUP="$DB_FILE.backup.$(date +%Y%m%d_%H%M%S)"
  echo "📦 Backing up to $BACKUP"
  mv "$DB_FILE" "$BACKUP"
fi

# Remove LLM cache
if [ -f "$LLM_CACHE" ]; then
  rm "$LLM_CACHE"
  echo "🗑️ Removed LLM cache"
fi

# Recreate empty DB directory
mkdir -p "$DB_DIR"

echo "✅ Database reset complete!"
echo ""
echo "To seed fresh data, run:"
echo "  python scripts/seed_qa_data.py --clean"
echo ""
echo "Or restart Docker with SEED_DATA=true"
