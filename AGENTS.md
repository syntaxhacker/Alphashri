# AGENTS.md

## Project Overview

Alphashri is a stock screening, backtesting, and paper trading platform. Python/FastAPI backend, React/TypeScript frontend. Docker-based dev with SQLite locally, PostgreSQL in production.

## Commands

### Backend (Python)

```bash
uvicorn api_server_fastapi:app --reload --port 8765   # run dev server
pytest                                                   # run all tests
pytest tests/ -v                                         # verbose
pytest tests/test_risk_manager.py -v                     # single file
pytest tests/test_risk_manager.py::TestClass::test_method -v  # single test
pytest tests/ -k "auth" -v                               # by keyword
pytest tests/api/ -v                                     # API tests only
pytest tests/integration/ -v                             # integration tests only
pytest -n auto                                           # parallel (xdist)
pytest --cov=. --cov-report=html                         # coverage
```

### Frontend (TypeScript / Bun)

```bash
bun install          # install deps
bun run dev          # dev server
bun run build        # production build
bun run test         # unit tests (vitest)
bun run test:e2e     # E2E tests (playwright)
bun run lint         # lint (oxlint)
bun run lint:fix     # lint + fix
bun run format       # format (oxfmt)
```

### Docker

```bash
docker-compose -f docker-compose.dev.yml up --build     # dev (SQLite + Redis)
docker-compose -f docker-compose.prod.yml up --build    # prod (PostgreSQL + Redis)
```

## Project Structure

```
stock-screener-ui/
├── api/                # FastAPI route modules (auth, bots, brokers, options, etc.)
├── backtest/           # Backtesting engine + strategies/
├── cache/              # Redis caching layer (graceful degradation)
├── db/                 # SQLAlchemy models, database.py, alphashri.db (local)
│   └── migrations/     # Alembic migration scripts and versions
├── services/           # News persistence, instrument mapping
├── trading/            # Risk manager, paper trader, journal, signals
├── src/                # React frontend (api/, components/, store/, types/, hooks/)
├── tests/              # Python tests (unit, api/, integration/, contract/)
│   ├── conftest.py     # shared fixtures (DB, auth, mocks)
│   └── api/conftest.py # API-specific fixtures (TestClient, candles, news)
├── api_server_fastapi.py  # Main FastAPI app (routes defined here)
├── config.py           # Central config (env vars via python-dotenv)
└── api/requirements.txt    # Python deps
```

## Code Style — Python

### Formatting
- No comments unless asked. Code should be self-documenting.
- Use Google-style docstrings for modules and complex functions only.
- Section separators: `# ======` for major sections, `# -----` for subsections.
- 4-space indentation. No trailing whitespace.

### Imports
Group in order: stdlib, third-party, local. No blank lines between groups is acceptable but keep it consistent within a file.

```python
from datetime import datetime, timedelta
from typing import Optional, Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import config
from db.models import User
from cache.redis_client import cache_get, cache_set
```

### Types
Use `from typing import Optional, Dict, Any, List` style (not Python 3.10+ `X | Y`).
Use lowercase for return type annotations: `-> list[dict]`, `-> tuple[str, str]`.

### Naming
- Functions: `snake_case` (`get_current_user`, `calculate_position_size`)
- Classes: `PascalCase` (`RiskManager`, `StrategyConfig`)
- Constants: `UPPER_SNAKE_CASE` (`JWT_SECRET_KEY`, `BACKTEST_CACHE_TTL`)
- Private: `_leading_underscore` (`_redis_client`, `_sanitize_for_json`)
- Pydantic models: `PascalCase` (`UserRegister`, `BacktestRunRequest`)

### Error Handling
- API errors: `raise HTTPException(status_code=4xx, detail="message")`
- Cache/external deps: `try/except Exception as e:` with `logger.warning()`
- Optional imports: `try: import module; except ImportError: module = None`
- Never expose secrets, internal paths, or stack traces in API responses.

### Config
Access via `import config` then `config.DATABASE_URL`, `config.REDIS_URL`, etc.
Env vars loaded in `config.py` via `python-dotenv` from `.env.local`.

### Database
SQLAlchemy 2.0 ORM. Models in `db/models.py`. Session via `Depends(get_db)`.
Tests use in-memory SQLite with `StaticPool` and savepoint-based isolation.

### Database Migrations (Alembic)
Schema changes are managed via Alembic. Never modify the database schema without a migration.

```bash
cd stock-screener-ui
alembic revision --autogenerate -m "description"   # generate migration
alembic upgrade head                                # apply migrations
alembic check                                       # verify DB is in sync
```

- Config: `alembic.ini` (uses date-prefixed file template)
- Env: `db/migrations/env.py` (imports all models, uses app engine)
- Versions: `db/migrations/versions/`
- `init_db()` in `db/database.py` runs `alembic upgrade head` on startup
- Docker entrypoints run migrations before server start (hard-fail on error)
- CI validates migration status on PRs that touch `db/models.py` or `db/migrations/`

### Schema Documentation
`docs/schema.md` is auto-generated from `db/models.py`. Do not edit manually.

```bash
cd stock-screener-ui
python scripts/generate_schema_docs.py   # regenerate
```

- Pre-commit hook auto-regenerates when `db/models.py` is staged
- CI fails if `docs/schema.md` is out of sync with models

## Code Style — TypeScript

### Imports
```typescript
import { useState, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { SomeType } from "./types/market";
```

### Components
- Feature-based directories under `src/components/` (auth/, backtest/, chart/, etc.)
- Co-located test files: `component.tsx` + `component.test.tsx`
- Redux Toolkit for state, typed hooks in `src/store/hooks.ts`

### Types
Use `interface` not `type`. Types defined in `src/types/`.

## Testing

### Python Test Patterns
- Test classes: `TestFeature` (e.g., `TestRiskManager`, `TestCacheStats`)
- Test methods: `test_<method>_<scenario>` (e.g., `test_calculate_position_size_basic`)
- Fixtures in `conftest.py` (DB sessions, auth headers, mock objects)
- Mocking: `unittest.mock.patch`, `MagicMock`, `monkeypatch`
- API tests: `fastapi.testclient.TestClient` with dependency overrides
- Integration tests mock external modules (`upstox_trader`, `nautilus_trader`) via `sys.modules`
- Cache tests mock Redis with `fakeredis` or patch `get_redis_client` to return `None`
- Use `autouse=True` fixtures to reset module-level state between tests

### Frontend Test Patterns
- Vitest for unit tests, co-located `.test.ts`/`.test.tsx` files
- Playwright for E2E in `tests/e2e/*.spec.ts`
- Mock API responses in `tests/mocks/apiResponses.ts`

## Key Patterns

### Cache Pattern (Redis with graceful degradation)
```python
from cache.redis_client import cache_get, cache_set, make_cache_key

cache_key = make_cache_key("domain", identifier, param=value)
cached = cache_get(cache_key)
if cached is not None:
    return cached
result = expensive_operation()
cache_set(cache_key, result, ttl=60)
return result
```

### API Route Pattern
```python
@app.get("/api/resource")
async def get_resource(param: str = Query(...), current_user=Depends(get_current_user)):
    result = await asyncio.to_thread(some_sync_function, param)
    return _sanitize_for_json(result)
```

### Admin Endpoints
Require `current_user.is_admin` check, return appropriate status codes.

### Embeddings (FastEmbed + ONNX)
Semantic embeddings use `fastembed` (ONNX Runtime, no PyTorch) instead of `sentence-transformers`. Model: `BAAI/bge-small-en-v1.5` (384-dim, 67MB). Defined in `services/news_instrument_mapper.py`. Do not add `sentence-transformers` to requirements — it pulls PyTorch (~2.3GB) and is unnecessary for inference-only workloads.

```python
from fastembed import TextEmbedding

model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
embeddings = np.array(list(model.embed(["text1", "text2"])))
```

## Git / Pull Requests

Use the `gh` CLI for all PR operations. Never create commits unless explicitly asked.

```bash
gh pr create --base develop --title "feat: description" --body "..."   # create PR
gh pr list                                                            # list open PRs
gh pr view <number>                                                   # view PR details
gh pr checks <number>                                                 # check CI status
gh pr merge <number> --squash                                         # merge PR
gh api repos/OWNER/REPO/pulls/<number>/comments                       # view PR comments
gh run list --branch feat/branch                                      # check workflow runs
gh run view <run-id>                                                   # debug failed CI run
```

## Docker / Deployment

- Dev: SQLite + Redis via `docker-compose.dev.yml`
- Prod: PostgreSQL + Redis via `docker-compose.prod.yml`
- Redis data persists in named Docker volumes (survives container restart)
- Frontend deploys to Cloudflare Pages via `bun run deploy`
- Backend deploys to Render with PostgreSQL managed database
