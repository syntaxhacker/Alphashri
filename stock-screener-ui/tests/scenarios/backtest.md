# Backtest View Test Scenarios

This document tracks E2E test scenarios for the Backtest View feature of the Alphashri Stock Screener application.

**Legend:**

- [x] = Test implemented and passing
- [ ] = Test not implemented
- [~] = Partially implemented / failing (needs investigation)
- N/A = Feature not yet implemented in app

---

## 22. Backtest View

| Status | Scenario                  | Test File        | Notes   |
| ------ | ------------------------- | ---------------- | ------- |
| [x]    | Navigate to backtest view | backtest.spec.ts | Passing |
| [x]    | Select strategy           | backtest.spec.ts | Passing |
| [x]    | Add/remove symbols        | backtest.spec.ts | Passing |
| [x]    | Configure parameters      | backtest.spec.ts | Passing |
| [x]    | Run backtest              | backtest.spec.ts | Passing |
| [x]    | View results              | backtest.spec.ts | Passing |
| [x]    | View charts               | backtest.spec.ts | Passing |

---

## Coverage Summary

| Category      | Passed | Total | Coverage |
| ------------- | ------ | ----- | -------- |
| Backtest View | 7      | 7     | 100%     |

---

## Running Backtest Tests

```bash
# Run all backtest tests
npx playwright test tests/e2e/backtest.spec.ts

# Run specific backtest test
npx playwright test -g "Navigate to backtest view"
```

---

_Last Updated: March 3, 2026_
