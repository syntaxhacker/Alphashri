# Testing & performance — index

Short pointers to the authoritative docs. Don't duplicate their contents here.

| Doc / file | What it owns |
| --- | --- |
| [TEST_RULES.md](../TEST_RULES.md) | Test shape, mocks, assertions and guards — read before writing or changing a test. |
| [docs/TESTING_SPEED.md](./TESTING_SPEED.md) | Fast changed-test runner (backend), vitest pool findings, timing pipeline. |
| [docs/PERFORMANCE.md](./PERFORMANCE.md) | Budget index, check cadence, measurement methodology. |
| [docs/AGRI_DATA_USAGE.md](./AGRI_DATA_USAGE.md) | Agri mandi data: sources, ₹/quintal units, partial days — read before touching `/agri`. |
| [tests/README.md](../tests/README.md) | Suite map: counts, folder ownership, fixtures, guards, run recipes. |
| [tests/api/README.md](../tests/api/README.md) | Backend API modules and their conftest/fixture conventions. |
| [tests/e2e/helpers/README.md](../tests/e2e/helpers/README.md) | The one canonical TypeScript E2E helper tree (`tests/e2e/helpers/`). |
| [perf/budgets.json](../perf/budgets.json) | Machine-readable wall/test budgets (read-only). |
| [perf/api_budgets.json](../perf/api_budgets.json) | Machine-readable per-route API latency budgets (read-only). |
