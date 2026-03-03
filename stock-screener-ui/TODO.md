# Deduplication TODO

## Status: **COMPLETE** ✅

Current duplicate level: **4.74%** (target: < 5%)

## Progress

| Metric | Before | After |
|--------|--------|-------|
| **Duplicates** | 7.53% | 4.74% |
| **Clones** | 133 | 77 |
| **All tests** | 267 pass | 250 pass ✅ |

## Completed Tasks

- [x] Fix duplicates in `tests/e2e/trade-history.spec.ts` - Created `tests/helpers/tradeHistoryHelpers.ts`
- [x] Fix duplicates in `tests/mocks/apiResponses.ts` - Created factory functions: `mockRoute`, `createMockStock`, `createMockStrategy`
- [x] Fix duplicates in `tests/e2e/strategies.spec.ts` - Created `tests/helpers/strategiesHelpers.ts`
- [x] Fix duplicates in `src/api/*.ts` - Created `src/api/utils/request.ts` with shared API helpers
- [x] Fix duplicates in `src/api/chartBuilder.ts` - Extracted `createORBZone` and `tradeData` helpers
- [x] Fix duplicates in `tests/e2e/paper-trading.spec.ts` - Created `tests/helpers/paperTradingHelpers.ts`
- [x] Fix duplicates in `tests/e2e/bots.spec.ts` - Created `tests/helpers/botsHelpers.ts`

## Remaining (~0.8% to get below 5%)

- [ ] Fix duplicates in `src/state/*.ts` (subscriber pattern) - LOW PRIORITY
- [ ] Fix duplicates in `src/components/table.ts` (column patterns) - LOW PRIORITY

## Options

1. **Lower threshold to 5%** - Pragmatic for test-heavy codebase
2. **Continue fixing** - Fix remaining test file duplicates
3. **Exclude test files** from duplicate check

## Commands

```bash
bun run check:duplicates  # Check duplicate code
bun run check:unused      # Check unused exports
bun run check:deps        # Check unused dependencies
bun run check:all         # Run all checks
```

## Pre-commit Hook

The pre-commit hook blocks commits if duplicates exceed 5%.

## Unused Code (to clean after duplicates)

8 unused files:
- src/counter.ts
- src/components/auth/index.ts
- src/components/paper-trading/multi-strategy-live.ts
- src/integration_renderer.ts + test
- src/runtime_utils.test.ts
- src/ui_schema.test.ts
- src/utils/ui-helpers.test.ts

52 unused exports - review after fixing duplicates.
