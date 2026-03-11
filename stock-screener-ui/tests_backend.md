# Backend Testing Patterns & Conventions

This document outlines the established patterns for writing backend tests in the Alphashri project. Following these conventions ensures consistency, readability, and ease of maintenance.

## 1. Tooling & Framework
- **Framework:** [Pytest](https://docs.pytest.org/)
- **API Client:** [FastAPI TestClient](https://fastapi.tiangolo.com/advanced/testing/) (requests-based synchronous client)
- **Database:** SQLite (Temporary file-based for testing)
- **Execution:** `uv run pytest tests/api/test_filename.py -v`

## 2. Directory Structure
Tests are mirrored against the `api/` directory:
- `tests/api/`: Integration tests for FastAPI endpoints.
- `tests/unit/`: Pure logic/mathematical tests.
- `tests/conftest.py`: Global fixtures and setup.

## 3. File Anatomy
Every test file should follow this structure:

### A. Documentation Header
Start with a multi-line docstring explaining the scope of the tests.
```python
"""
Tests for [Feature] API endpoints.

Test cases cover:
- Basic CRUD operations
- Validation and error handling
- Business logic integration
"""
```

### B. Path Management
Ensure the project root is in `sys.path` so imports work regardless of where pytest is run.
```python
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
```

### C. Class-Based Organization
Group tests into logical classes. This keeps the test output organized.
```python
class TestFeatureLogic:
    """Suites for pure logic."""
    def test_math(self):
        assert 1 + 1 == 2

class TestFeatureEndpoints:
    """Suites for API integration."""
    def test_get_status(self, client):
        response = client.get("/api/feature")
        assert response.status_code == 200
```

## 4. Standard Fixtures
We rely heavily on fixtures defined in `tests/api/conftest.py`:
- `client`: A pre-configured `TestClient(app)` with database overrides.
- `db`: A fresh SQLAlchemy session for each test (automatically cleaned up).
- `auth_headers`: Provides a Bearer token for protected routes.
- `test_user`: Creates a default active user in the database.

## 5. Best Practices
1. **Isolated Database:** Never run tests against production data. Use the `db` fixture which creates/drops tables for every test.
2. **Mock External APIs:** Use `unittest.mock` or `monkeypatch` to prevent tests from hitting real Upstox/Market servers.
3. **Descriptive Names:** Method names should be sentences: `test_create_order_fails_on_insufficient_funds`.
4. **Assert Structures:** When testing APIs, always verify the JSON schema, not just the status code.
   ```python
   data = response.json()
   assert "id" in data
   assert isinstance(data["items"], list)
   ```
5. **Soft Assertions:** Use `if response.status_code == 200:` for tests that might depend on external availability (like live chain data) and `pytest.skip()` if conditions aren't met.

## 6. How to Run
```bash
# Run all tests
uv run pytest

# Run a specific file with verbose output
uv run pytest tests/api/test_options.py -v

# Run tests matching a specific name
uv run pytest -k "sentiment"
```
