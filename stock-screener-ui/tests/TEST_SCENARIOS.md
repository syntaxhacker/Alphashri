# Test Scenarios Coverage

This document tracks all E2E test scenarios for the Alphashri Stock Screener application.

**Legend:**

- [x] = Test implemented and passing
- [ ] = Test not implemented
- [~] = Partially implemented / failing (needs investigation)
- N/A = Feature not yet implemented in app

---

## Test Scenario Files by Route

### Core Routes

- [Authentication & Authorization](./scenarios/authentication.md) - Login, register, logout, session management
- [Navigation](./scenarios/navigation.md) - Sidemenu, URL routing, market ticker
- [Screener](./scenarios/screener.md) - Data display, filters, auto-refresh, trading lists

### Trading Features

- [Paper Trading](./scenarios/paper-trading.md) - Live positions, trade history, settings, bot controls
- [Backtest](./scenarios/backtest.md) - Strategy testing and results visualization
- [Strategies](./scenarios/strategies.md) - Strategy management and configuration
- [Bots](./scenarios/bots.md) - Trading bot management and monitoring

### Common & Advanced Features

- [Common Features](./scenarios/common.md) - Table sorting, filters, UI controls, notifications
- [Advanced Features](./scenarios/advanced.md) - Sector analysis, charts, news, multi-strategy

---

## Summary

| Category                      | Passed  | Total   | Coverage |
| ----------------------------- | ------- | ------- | -------- |
| Authentication                | 14      | 14      | 100%     |
| Navigation                    | 16      | 16      | 100%     |
| Market Ticker                 | 3       | 3       | 100%     |
| Screener - Data               | 6       | 6       | 100%     |
| Screener - Nav                | 3       | 3       | 100%     |
| Screener - Filters            | 3       | 3       | 100%     |
| Screener - Refresh            | 3       | 3       | 100%     |
| Screener - Trading List       | 2       | 2       | 100%     |
| Screener - Errors             | 2       | 2       | 100%     |
| Table Sorting                 | 4       | 4       | 100%     |
| Filters                       | 6       | 6       | 100%     |
| UI Controls                   | 5       | 5       | 100%     |
| Notifications                 | 4       | 4       | 100%     |
| Buyer Interest+               | 3       | 3       | 100%     |
| Paper Trading - Live          | 10      | 10      | 100%     |
| Paper Trading - History       | 11      | 11      | 100%     |
| Paper Trading - Settings      | 6       | 6       | 100%     |
| Paper Trading - API           | 3       | 3       | 100%     |
| Paper Trading - Bot Controls  | 2       | 2       | 100%     |
| Paper Trading - Strategy Tabs | 3       | 3       | 100%     |
| Backtest View                 | 21      | 21      | 100%     |
| Strategies View               | 24      | 24      | 100%     |
| Bots View                     | 30      | 30      | 100%     |
| Sector Analysis               | 4       | 4       | 100%     |
| Chart View                    | 6       | 6       | 100%     |
| News Panel                    | 4       | 4       | 100%     |
| Multi-Strategy                | 14      | 14      | 100%     |
| **TOTAL**                     | **259** | **259** | **100%** |

---

## Test Files Created

| File                   | Tests | Status      |
| ---------------------- | ----- | ----------- |
| auth.spec.ts           | 15    | All passing |
| navigation.spec.ts     | 16    | All passing |
| screener.spec.ts       | 16    | All passing |
| trade-history.spec.ts  | 11    | All passing |
| sorting.spec.ts        | 4     | All passing |
| filters.spec.ts        | 6     | All passing |
| controls.spec.ts       | 5     | All passing |
| notifications.spec.ts  | 4     | All passing |
| buyer-interest.spec.ts | 3     | All passing |
| paper-trading.spec.ts  | 18    | All passing |
| app.spec.ts            | 6     | All passing |
| backtest.spec.ts       | 21    | All passing |
| strategies.spec.ts     | 24    | All passing |
| bots.spec.ts           | 30    | All passing |
| multi-strategy.spec.ts | 14    | All passing |
| sector.spec.ts         | 18    | All passing |
| chart.spec.ts          | 35    | All passing |
| news.spec.ts           | 13    | All passing |

---

## Priority Tests to Implement

### High Priority (Core Features)

1. ✅ Create backtest.spec.ts - Done
2. ✅ Create strategies.spec.ts - Done
3. ✅ Create bots.spec.ts - Done
4. ✅ Create multi-strategy.spec.ts - Done
5. ✅ Fix auth.spec.ts selector issues - Done
6. ✅ Fix screener.spec.ts selector issues - Done

### Medium Priority

1. Create chart.spec.ts
2. Create sector.spec.ts
3. Create news.spec.ts
4. ✅ Fix trade-history.spec.ts column names - Done

### Low Priority

1. Add more edge case tests
2. Add performance tests
3. Add accessibility tests

---

## Running Tests

```bash
# Run all E2E tests (headless mode by default)
npx playwright test

# Run with visible browser
HEADLESS=false npx playwright test

# Run specific test file
npx playwright test tests/e2e/paper-trading.spec.ts

# Run specific test
npx playwright test -g "should display paper trading view"
```

---

_Last Updated: March 3, 2026_

---

## Test Execution Results

**Latest Run:** 193 passed / 0 failed / 193 total (100% pass rate)

### All Test Suites Passing

- ✅ Authentication (14/14)
- ✅ Navigation (16/16)
- ✅ Market Ticker (3/3)
- ✅ Screener - Data (6/6)
- ✅ Screener - Nav (3/3)
- ✅ Screener - Filters (3/3)
- ✅ Screener - Refresh (3/3)
- ✅ Screener - Trading List (2/2)
- ✅ Screener - Errors (2/2)
- ✅ Table Sorting (4/4)
- ✅ Filters (6/6)
- ✅ UI Controls (5/5)
- ✅ Notifications (4/4)
- ✅ Buyer Interest+ (3/3)
- ✅ Paper Trading - Live (10/10)
- ✅ Paper Trading - History (11/11)
- ✅ Paper Trading - Settings (6/6)
- ✅ Paper Trading - API (3/3)
- ✅ Paper Trading - Bot Controls (2/2)
- ✅ Paper Trading - Strategy Tabs (3/3)
- ✅ Backtest View (21/21)
- ✅ Strategies View (24/24)
- ✅ Bots View (30/30)
- ✅ Multi-Strategy System (14/14)
