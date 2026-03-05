# Testing Roadmap

## Test Pyramid

```
                    ┌─────────┐
                    │   E2E   │  ← Few, slow, expensive
                    │  Tests  │     (Playwright, Cypress)
                   ╱└─────────┘╲
                  ╱             ╲
                 ╱  ┌─────────┐  ╲
                ╱   │Integration│   ╲
               ╱    │  Tests   │     ╲   ← Moderate number
              ╱     └─────────┘       ╲     (Testcontainers, real DB)
             ╱                         ╲
            ╱      ┌─────────────┐      ╲
           ╱       │  Contract   │       ╲
          ╱        │   Tests     │        ╲  ← API schema validation
         ╱         └─────────────┘         ╲
        ╱                                   ╲
       ╱         ┌─────────────────┐         ╲
      ╱          │    Unit Tests    │          ╲
     ╱           │  (Fast, Many)    │           ╲ ← Most tests here
    ╱            └─────────────────┘            ╲
───╱─────────────────────────────────────────────╱───
```

---

## Test Environments

| Environment | Description | Database | APIs | Tests |
|-------------|-------------|----------|------|-------|
| **Local** | Developer machine | SQLite in-memory / Docker PostgreSQL | Mocked | Unit, Integration |
| **CI** | GitHub Actions | Docker PostgreSQL / Testcontainers | Mocked + Contract | All except smoke |
| **Staging** | Pre-production mirror | Real PostgreSQL (test data) | Real APIs (sandbox) | All including smoke |
| **Production** | Live system | Production PostgreSQL | Real APIs (live) | Smoke tests only |

---

## Test Categories

| Priority | Category | Tool | Frequency | Environment | Status |
|----------|----------|------|-----------|-------------|--------|
| 1 | **Unit Tests** | pytest + mocks | Every commit | Local, CI | ✅ Complete (1,436 tests) |
| 2 | **Integration Tests** | pytest + Testcontainers | Every PR | CI, Staging | ✅ Complete (50 tests) |
| 3 | **Contract Tests** | Schemathesis | Every PR | CI | ✅ Complete (27 tests) |
| 4 | **API Smoke Tests** | httpx / requests | Every deploy | Staging, Prod | ⏳ Pending |
| 5 | **Load Tests** | Locust / k6 | Weekly / Before release | Staging | ⏳ Pending |
| 6 | **E2E Tests** | Playwright | Daily / Before release | Staging | ✅ Complete (19 tests) |
| 7 | **Chaos Tests** | Custom | Monthly | Staging | ⏳ Pending |

---

## Implementation Plan

### Phase 1: Contract Tests ✅

**Goal**: Auto-generate tests from OpenAPI spec to catch schema drift.

```python
# tests/contract/test_api_contract.py
import schemathesis
from hypothesis import settings

schema = schemathesis.from_path("openapi.yaml")

@schema.parametrize()
@settings(max_examples=50)
def test_api_compliance(case):
    """Test that API matches its OpenAPI specification."""
    response = case.call()
    case.validate_response(response)
```

**Why**: 
- Catches schema drift
- Validates all endpoints automatically
- No manual test writing needed

---

### Phase 2: Integration Tests with Testcontainers ✅

**Goal**: Test with real PostgreSQL, not SQLite.

```python
# tests/integration/test_real_db.py
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="session")
def postgres_container():
    """Spin up real PostgreSQL in Docker."""
    with PostgresContainer("postgres:15") as postgres:
        yield postgres
```

**Why**:
- SQLite ≠ PostgreSQL behavior
- Catches DB-specific bugs
- Tests real migrations

---

### Phase 3: Live API Smoke Tests (Week 2)

**Goal**: Verify server starts and responds correctly.

```python
# tests/smoke/test_live_api.py
@pytest.mark.smoke
class TestLiveAPI:
    BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8765")
    
    def test_health_check(self):
        response = httpx.get(f"{self.BASE_URL}/health", timeout=5)
        assert response.status_code == 200
```

**Run**: `RUN_SMOKE_TESTS=true pytest -m smoke`

---

### Phase 4: API Integration Tests (Week 2-3)

**Goal**: Test complete flows against running server.

```python
# tests/integration/test_api_flow.py
@pytest.fixture
def authenticated_client(api_client):
    """Client with valid auth token."""
    response = api_client.post("/api/auth/login", json={...})
    token = response.json()["access_token"]
    api_client.headers["Authorization"] = f"Bearer {token}"
    return api_client
```

---

### Phase 5: Load Testing (Week 3)

**Goal**: Find performance bottlenecks.

```python
# tests/load/locustfile.py
from locust import HttpUser, task

class TradingUser(HttpUser):
    @task(3)
    def get_bots(self):
        self.client.get("/api/bots")
```

**Run**: `locust -f tests/load/locustfile.py`

---

### Phase 6: Chaos Testing (Week 4)

**Goal**: Test resilience under failure.

```python
# tests/chaos/test_resilience.py
class TestResilience:
    async def test_database_failure_handling(self):
        with patch("db.database.engine") as mock_engine:
            mock_engine.connect.side_effect = Exception("DB failed")
            # Verify graceful degradation
```

---

## CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run unit tests
        run: uv run pytest tests/test_*.py -m "not smoke"
    
  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
    steps:
      - name: Run integration tests
        run: uv run pytest tests/integration/
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/test
  
  contract-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run contract tests
        run: uv run pytest tests/contract/
  
  smoke-tests:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    needs: [unit-tests, integration-tests]
    steps:
      - name: Deploy to staging
        run: ./deploy.sh staging
      - name: Run smoke tests
        run: uv run pytest -m smoke
        env:
          API_BASE_URL: https://staging.example.com
          RUN_SMOKE_TESTS: true
```

---

## Timeline

| Week | Tasks | Effort | Impact | Status |
|------|-------|--------|--------|--------|
| 1 | Contract tests (Schemathesis) | 2 days | High | ✅ Complete |
| 1 | Testcontainers for DB | 1 day | High | ✅ Complete |
| 2 | Live API smoke tests | 1 day | High | ⏳ Pending |
| 2 | API integration tests | 2 days | High | ⏳ Pending |
| 3 | Load testing (Locust) | 1 day | Medium | ⏳ Pending |
| 3 | CI/CD pipeline | 1 day | High | ⏳ Pending |
| 4 | Chaos tests | 2 days | Medium | ⏳ Pending |

---

## Commands

```bash
# Unit tests (fast)
uv run pytest tests/test_*.py -m "not smoke"

# Integration tests with real DB
uv run pytest tests/integration/

# Contract tests
uv run pytest tests/contract/

# Smoke tests (against running server)
RUN_SMOKE_TESTS=true uv run pytest -m smoke

# Load tests
locust -f tests/load/locustfile.py --host=http://localhost:8765

# All tests
uv run pytest

# Coverage report
uv run pytest --cov=. --cov-report=html
```

---

## Current Status

| Category | Tests | Status | Requirement |
|----------|-------|--------|-------------|
| Unit Tests | 1,436 | ✅ Complete | None |
| Contract Tests | 27 | ✅ Complete | Running API server |
| Testcontainers | 50 | ✅ Complete | Docker daemon |
| Security Tests | 82 | ✅ Complete | None |
| E2E Tests | 19 | ✅ Complete | None |
| Smoke Tests | - | ⏳ Pending | Running server |
| Load Tests | - | ⏳ Pending | Running server |
| Chaos Tests | - | ⏳ Pending | - |
| CI/CD Pipeline | - | ⏳ Pending | GitHub |

**Total: 1,614 tests passing**

## Files Created

| File | Lines | Description |
|------|-------|-------------|
| `openapi.yaml` | 2,372 | OpenAPI 3.1 specification |
| `tests/contract/test_api_contract.py` | ~300 | Contract tests (27 tests) |
| `tests/integration/testcontainers/conftest.py` | 224 | PostgreSQL container fixtures |
| `tests/integration/testcontainers/test_real_db_auth.py` | 405 | Auth tests with real DB |
| `tests/integration/testcontainers/test_real_db_bots.py` | 455 | Bot tests with real DB |
| `tests/integration/testcontainers/test_real_db_strategies.py` | 601 | Strategy tests with real DB |
| `tests/test_security.py` | ~1,500 | Security tests (82 tests) |

## Dependencies Added

```txt
schemathesis>=4.11.0
testcontainers>=4.14.1
psycopg2-binary>=2.9.0
bcrypt>=5.0.0
pyjwt>=2.11.0
email-validator>=2.3.0
requests>=2.28.0
```

## PostgreSQL vs SQLite Differences Found

| Issue | PostgreSQL Behavior | SQLite Behavior |
|-------|---------------------|-----------------|
| `strategy_type` column | NOT NULL enforced | May be lenient |
| Primary key constraint | Raises at execute time | May defer to commit |
| Case sensitivity | Case-sensitive comparisons | May be case-insensitive |
| Cascade deletes | Enforced | May differ |

## Security Vulnerabilities Found

1. No input validation on `initial_capital` (negative values accepted)
2. No quantity validation (type coercion issues)
3. No symbol validation (empty symbols may pass)
4. No rate limiting on login attempts
5. Hardcoded dev JWT secret key
6. No resource ownership scoping (bots/strategies global)
