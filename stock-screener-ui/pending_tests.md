# Pending Test Failures (Future Work)

**Date:** 2026-03-10  
**Total:** ~184 tests fail when running full suite (isolation issues)

## Known Issue: Test Isolation Problems

When running the full pytest suite, many tests fail due to shared state pollution between test modules. The same tests pass when run individually or in smaller groups. This indicates the test suite needs isolation improvements (fixture cleanup, database transaction handling, mock leaks).

**Evidence:**
- `tests/test_orb_signals.py` - 47+ failures in full run, but each test passes individually
- `tests/test_strategies_api.py` - some failures when run with full suite
- Several other test files show similar patterns

## Affected Test Files

### Primary (test_orb_signals.py - worst case)
- `TestORBSignalGeneratorIntegration::test_full_workflow_long_signal`
- `TestORBSignalGeneratorIntegration::test_full_workflow_short_signal`
- `TestORBSignalGeneratorIntegration::test_full_workflow_no_signal`
- `TestEdgeCases::test_zero_price_handling`
- `TestEdgeCases::test_very_large_price_values`
- `TestEdgeCases::test_very_small_or_range`
- `TestEdgeCases::test_or_levels_missing_keys`
- `TestEdgeCases::test_exact_or_boundary_prices`
- `TestEdgeCases::test_different_or_minutes_settings`
- `TestEdgeCases::test_signal_immutability`
- **+37 more edge case tests**

### Secondary (various files)
- `tests/test_strategies_api.py::TestListStrategies::test_list_with_include_templates_true`
- `tests/test_strategies_api.py::TestListTemplates::*` (5 tests)
- `tests/test_strategies_api.py::TestGetStrategy::test_get_existing_strategy`
- `tests/test_strategies_api.py::TestCreateStrategy::test_verify_strategy_created_in_database`
- `tests/test_strategies_api.py::TestGetStrategyVariations::*`
- `tests/test_week52_chaser.py::*` (multiple)
- `tests/test_week52_target.py::*` (multiple)
- `tests/test_portfolio.py::*` (multiple)
- `tests/test_position_manager.py::*` (multiple)
- `tests/test_trade_journal.py::*` (multiple)

### Tertiary
- `tests/test_bots_api.py::TestBotCRUD::test_list_bots`
- `tests/test_bots_api.py::TestBotCRUD::test_get_bot`
- Various position, portfolio, and strategy runner integration tests

**Note:** The integration tests we fixed (`tests/integration/`) are **completely isolated** and pass consistently (51 passed).

## Root Causes (Assessment)

1. **Global module-level state** - Some test modules modify global singletons that persist across test collection
2. **Database fixture leakage** - Database sessions/transactions not properly rolled back between tests
3. **Mock contamination** - `unittest.mock.patch` not properly reset, affecting later tests
4. **Class-level fixtures** - `@pytest.fixture(scope="class")` causing state carryover
5. **Conftest pollution** - `tests/conftest.py` may be applying patches globally without proper scoping

## Recommended Fix Strategy

### Phase 1: Isolation Audit
- Run tests with `pytest --tb=short` and capture failure details per file
- Identify which tests are flaky vs truly broken
- Create a baseline: `pytest -x --lf` to run last failures only

### Phase 2: Fixture Cleanup
- Ensure all database fixtures use `function` scope with proper rollback
- Add `autouse=True` fixtures to clear global state before each test
- Wrap all tests in transactions with rollback

### Phase 3: Mock Management
- Replace `sys.modules` mocks with context managers (`with patch(...)`)
- Use `pytest-mock`'s `mocker` fixture for auto-cleanup
- Audit `conftest.py` for overly broad patches

### Phase 4: Parallel Execution
- Verify tests pass with `pytest -n auto` (requires proper isolation)

## Files Likely Needing Work

- `tests/conftest.py` - Global patches
- `tests/test_orb_signals.py` - 47+ tests; reduce class-level setup
- `tests/test_strategies_api.py` - database fixtures
- `tests/test_week52_chaser.py`
- `tests/test_week52_target.py`
- `tests/test_portfolio.py`
- `tests/test_position_manager.py`
- `tests/test_trade_journal.py`
- `tests/api/test_bots.py` (7 pre-existing failures unrelated to isolation)

---

**Status:** Not blocking current work. All critical integration tests fixed. Test isolation is a test architecture issue, not a product bug.
