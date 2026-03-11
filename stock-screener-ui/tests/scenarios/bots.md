# Bots View Test Scenarios

This document tracks E2E test scenarios for the Bots View feature of the Alphashri Stock Screener application.

**Legend:**

- [x] = Test implemented and passing
- [ ] = Test not implemented
- [~] = Partially implemented / failing (needs investigation)
- N/A = Feature not yet implemented in app

---

## Bot Management Test Scenarios

| Status | Scenario             | Test File    | Notes   |
| ------ | -------------------- | ------------ | ------- |
| [x]    | Display trading bots | bots.spec.ts | Passing |
| [x]    | Create new bot       | bots.spec.ts | Passing |
| [x]    | Edit bot config      | bots.spec.ts | Passing |
| [x]    | Delete bot           | bots.spec.ts | Passing |
| [x]    | Assign strategies    | bots.spec.ts | Passing |
| [x]    | View bot status/logs | bots.spec.ts | Passing |

---

## Test Coverage Summary

| Category  | Passed | Total | Coverage |
| --------- | ------ | ----- | -------- |
| Bots View | 30     | 30    | 100%     |

---

## Running Bots Tests

```bash
# Run all bots tests
npx playwright test tests/e2e/bots.spec.ts

# Run specific test
npx playwright test -g "Display trading bots"

# Run with visible browser
HEADLESS=false npx playwright test tests/e2e/bots.spec.ts
```

---

_Last Updated: March 3, 2026_
