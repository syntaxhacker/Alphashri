"""Dump trades and positions from production PostgreSQL to local SQLite."""
import sys
import sqlite3
import psycopg2

PROD_URL = os.environ.get("DATABASE_URL", "")
if not PROD_URL:
    print("ERROR: DATABASE_URL env var not set")
    sys.exit(1)
LOCAL_DB = "stock-screener-ui/db/alphashri.db"

conn = psycopg2.connect(PROD_URL)
cur = conn.cursor()

local = sqlite3.connect(LOCAL_DB)
lc = local.cursor()

for table in ["trades", "positions"]:
    print(f"\n=== {table} ===")
    cur.execute(f"SELECT * FROM {table}")
    cols = [desc[0] for desc in cur.description]
    rows = cur.fetchall()

    print(f"  Prod rows: {len(rows)}")

    if not rows:
        continue

    placeholders = ", ".join(["?"] * len(cols))
    col_names = ", ".join(cols)
    sql = f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})"

    lc.execute(f"SELECT COUNT(*) FROM {table}")
    existing = lc.fetchone()[0]
    print(f"  Local rows before: {existing}")

    inserted = 0
    for row in rows:
        try:
            lc.execute(sql, row)
            inserted += 1
        except Exception as e:
            print(f"  SKIP row (id={row[0]}): {e}")

    local.commit()
    lc.execute(f"SELECT COUNT(*) FROM {table}")
    after = lc.fetchone()[0]
    print(f"  Inserted: {inserted}")
    print(f"  Local rows after: {after}")

cur.close()
conn.close()
lc.close()
local.close()
print("\nDone!")
