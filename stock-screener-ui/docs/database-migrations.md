# Database Migrations: Why We Need Alembic

## The Problem

Alphashri's database schema changes **every ~2 days** (16 commits to `db/models.py` in 27 days). Right now, we rely on SQLAlchemy's `Base.metadata.create_all()` which only creates **missing tables** — it never adds, removes, or modifies columns on existing tables.

This means every time we add a column to a model, we must **manually** run `ALTER TABLE` against production. We've already been burned by this twice:

| Date | Column | Impact |
|------|--------|--------|
| Mar 2026 | `ema_fast_period`, `ema_slow_period` | Production 500 errors on `/api/strategies/variations` |
| Mar 2026 | `qty_multiplier` | Instruments table queries failed silently |

Each incident required:
1. User reports 500 error from production
2. Investigate logs to find `UndefinedColumn` error
3. Connect to production PostgreSQL manually
4. Run `ALTER TABLE` by hand
5. Restart the service

This is **slow, error-prone, and unsustainable**.

---

## What We Have Now

### `db/database.py` — Current Initialization

```python
def init_db():
    Base.metadata.create_all(bind=engine)  # Only creates MISSING tables
    _migrate_missing_columns()              # Hardcoded list of 3 columns
```

### `_migrate_missing_columns()` — The Band-Aid

```python
def _migrate_missing_columns():
    migrations = [
        ("ema_fast_period", "INTEGER DEFAULT 9"),
        ("ema_slow_period", "INTEGER DEFAULT 21"),
        ("qty_multiplier", "FLOAT"),
    ]
    # ALTER TABLE for each missing column...
```

**Problems with this approach:**
- Hardcoded list — every new column requires a code change here
- No tracking — doesn't know what's already been applied
- No rollback — changes are permanent
- No data transformations — can't migrate or split data
- SQLite/PostgreSQL DDL differences not handled
- Doesn't handle column renames, type changes, or removals

### Manual Migration Scripts

```
migrate_to_multiuser.py       — Filesystem migration (Feb 2026)
migrate_strategy_variations.py — Schema migration, SQLite only (Mar 2026)
```

These are one-off scripts that must be run manually. They're not versioned, not tracked, and not idempotent.

---

## How Production Currently Works

```
Deploy → Docker build → Container start → init_db() → create_all()
                                                    → _migrate_missing_columns()
                                                    → uvicorn starts
```

If a new column exists in the model but not in the database:
- `create_all()` skips it (table already exists)
- `_migrate_missing_columns()` skips it (not in hardcoded list)
- Server starts successfully
- **First query that touches the new column → 500 error**

There is **zero validation** that the database schema matches the code.

---

## How Enterprises Handle Migrations

### The Industry Standard: Migration Frameworks

Every production application with a database uses a **versioned migration system**:

| Language | Framework | Used By |
|----------|-----------|---------|
| Python | **Alembic** (SQLAlchemy) | Every SQLAlchemy project |
| Ruby | ActiveRecord Migrations | Rails, GitHub, Shopify |
| Node.js | Prisma Migrate / Knex | Stripe, Vercel |
| Java | Flyway / Liquibase | Spring Boot, Apache |
| Go | golang-migrate / goose | Uber, Lyft |
| Rust | sqlx migrate | Discord, Mozilla |
| C# | Entity Framework Migrations | Microsoft |

### The Enterprise Migration Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                    DEVELOPMENT WORKFLOW                      │
│                                                              │
│  1. Developer changes model (e.g., adds column)             │
│  2. Developer runs: alembic revision --autogenerate         │
│  3. Framework generates migration file:                      │
│     migrations/versions/001_add_ema_columns.py               │
│  4. Developer reviews the generated SQL                      │
│  5. Developer tests locally: alembic upgrade head            │
│  6. Commit model change + migration file together           │
│  7. PR review requires migration file                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    CI/CD PIPELINE                             │
│                                                              │
│  1. Build container                                          │
│  2. Run tests (with alembic upgrade head)                    │
│  3. Run migration on staging: alembic upgrade head           │
│  4. Verify schema matches models                              │
│  5. Deploy to production                                     │
│  6. Run migration on production: alembic upgrade head        │
│  7. Start application                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PRODUCTION DATABASE                        │
│                                                              │
│  alembic_version table tracks current schema version          │
│  Each migration is applied exactly once, in order            │
│  Failed migrations are rolled back                           │
│  Full audit trail of all schema changes                      │
└─────────────────────────────────────────────────────────────┘
```

### Key Enterprise Principles

#### 1. **Schema as Code**

Migrations are **code files** checked into git, not ad-hoc SQL run against production:

```
migrations/
  versions/
    001_create_initial_schema.py
    002_add_bot_configs.py
    003_add_ema_columns.py
    004_add_instruments_table.py
    005_add_news_tables.py
    006_add_broker_connections.py
```

Each file is **immutable** once merged — never modified, only appended.

#### 2. **Idempotent Tracking**

```
SELECT version_num FROM alembic_version;
-- Returns: '005_add_news_tables'

-- On next deploy, only runs 006_add_broker_connections.py
-- Never re-runs 001-005
```

#### 3. **Up + Down (Rollback)**

```python
def upgrade():
    op.add_column('strategy_configs', sa.Column('ema_fast_period', sa.Integer()))

def downgrade():
    op.drop_column('strategy_configs', 'ema_fast_period')
```

If something goes wrong, `alembic downgrade -1` reverses the last migration.

#### 4. **Auto-Generation with Human Review**

```bash
$ alembic revision --autogenerate -m "add ema columns"
INFO  [alembic.autogenerate.compare] Detected added column 'strategy_configs.ema_fast_period'
INFO  [alembic.autogenerate.compare] Detected added column 'strategy_configs.ema_slow_period'
  Generating /app/migrations/versions/003_add_ema_columns.py ... done
```

The framework **detects** schema differences automatically, but a human reviews and commits the generated file.

#### 5. **Environment Parity**

The **same migration files** run on:
- Developer's local SQLite
- CI test database
- Staging PostgreSQL
- Production PostgreSQL

No "works on my machine" — if the migration passes CI, it passes production.

#### 6. **Zero-Downtime Deployments**

Enterprise migrations handle large tables carefully:

```python
def upgrade():
    # Phase 1: Add nullable column (instant, no table lock)
    op.add_column('strategy_configs', sa.Column('ema_fast_period', sa.Integer(), nullable=True))

    # Phase 2: Backfill data (batch updates)
    op.execute("UPDATE strategy_configs SET ema_fast_period = 9 WHERE ema_fast_period IS NULL")

    # Phase 3: Set NOT NULL (instant, data already filled)
    op.alter_column('strategy_configs', 'ema_fast_period', nullable=False)
```

---

## Comparison: Current vs Alembic

| Feature | Current Approach | With Alembic |
|---------|-----------------|--------------|
| Add column | Manual ALTER TABLE or hardcoded list | Auto-detected + generated |
| Rename column | **Impossible** — breaks silently | `op.alter_column('old', new_column_name='new')` |
| Remove column | Manual ALTER TABLE | `op.drop_column()` with rollback |
| Change column type | Manual + data migration | `op.alter_column(type_=...)` |
| Add table | `create_all()` handles this | `op.create_table()` with rollback |
| Add index | Manual CREATE INDEX | `op.create_index()` with rollback |
| Add foreign key | Manual | `op.create_foreign_key()` with rollback |
| Data transformation | Ad-hoc scripts | `op.batch_alter_table()` + SQL |
| Rollback | **None** — permanent | `alembic downgrade` |
| Track applied migrations | **None** | `alembic_version` table |
| Schema validation | **None** | Compare models vs DB |
| Cross-DB (SQLite/PG) | Raw SQL, fragile | Dialect-aware DDL generation |
| CI integration | None | Run migrations in test pipeline |
| Multiple environments | Manual per-env SQL | Same files everywhere |
| Production safety | Low (hope it works) | High (explicit, reviewable) |
| Audit trail | Git blame on model file | Versioned migration files + DB tracking |
| New developer onboarding | "Run these scripts in order" | `alembic upgrade head` |

---

## What Breaks Without Proper Migrations

### Scenario 1: Column Rename

```python
# Developer renames column
- sl_pct = Column(Float)
+ stop_loss_pct = Column(Float)
```

**Current behavior:**
- `create_all()` does nothing (table exists)
- All queries using `sl_pct` still work
- All queries using `stop_loss_pct` fail with `UndefinedColumn`
- No error at startup — only at runtime
- Production crashes when user hits the affected endpoint

**With Alembic:**
```bash
$ alembic revision --autogenerate -m "rename sl_pct to stop_loss_pct"
$ alembic upgrade head  # Runs: ALTER TABLE ... RENAME COLUMN sl_pct TO stop_loss_pct
```
- Explicit migration file generated and reviewed
- Runs atomically on deploy
- Rollback available if something goes wrong

### Scenario 2: Column Type Change

```python
# Developer changes type
- or_minutes = Column(Integer)
+ or_minutes = Column(String)  # Now supports "45m" format
```

**Current behavior:**
- PostgreSQL stores `45` as integer
- App tries to read it as string
- Silent data corruption or casting errors
- No migration path for existing data

**With Alembic:**
```python
def upgrade():
    op.alter_column('strategy_configs', 'or_minutes',
                    existing_type=Integer(),
                    type_=String(),
                    postgresql_using='or_minutes::text')
```
- Explicit type conversion with data handling
- Reviewed before deploy

### Scenario 3: Deploy to New Environment

**Current behavior:**
1. Spin up new environment
2. `create_all()` creates all tables with current schema
3. No historical data
4. Old migration scripts may not work (hardcoded paths, SQLite-only)
5. Manual data setup required

**With Alembic:**
1. Spin up new environment
2. `alembic upgrade head`
3. All migrations run in order
4. Database is in known, versioned state
5. Consistent across all environments

---

## Proposed Implementation

### Phase 1: Setup (1 hour)

```
alembic init migrations
# Configure alembic.ini and env.py
# Set target_metadata = Base.metadata
# Configure for both SQLite and PostgreSQL
```

### Phase 2: Initial Migration (15 minutes)

```
alembic revision --autogenerate -m "initial schema"
# Generates migration from current models.py
# Review generated SQL
# Test locally
```

### Phase 3: Integrate into Deploy Pipeline (15 minutes)

```bash
# docker-entrypoint.prod.sh
alembic upgrade head  # Run before uvicorn starts
uvicorn api_server_fastapi:app --host 0.0.0.0
```

### Phase 4: CI Integration (15 minutes)

```yaml
# .github/workflows/test.yml
- name: Run migrations (test)
  run: alembic upgrade head
```

### Phase 5: Developer Workflow (ongoing)

```bash
# After changing db/models.py:
alembic revision --autogenerate -m "description of change"
# Review generated migration
# Commit both model change and migration together
```

---

## Cost/Benefit Summary

| | Current | With Alembic |
|---|---|---|
| **Setup effort** | 0 (already done) | ~1 hour |
| **Per-change effort** | 0 (skip it, fix later) | ~30 seconds |
| **Production incidents** | 2 in 2 months | 0 |
| **Incident resolution time** | 15-30 minutes (manual DB access) | 0 (automatic on deploy) |
| **Developer confidence** | Low ("hope it works") | High (explicit, tested) |
| **New developer friction** | High (which scripts to run?) | Low (`alembic upgrade head`) |
| **Rollback capability** | None | Full |
| **Schema drift risk** | High | None |

**Bottom line:** We've spent more time fixing production schema mismatches manually (30+ minutes each) than it would take to set up Alembic once (1 hour). Every new column or table we add increases the risk of the next production incident.
