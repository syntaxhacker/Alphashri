# Screener Test Scenarios

This document tracks all E2E test scenarios for the Screener feature of the Alphashri Stock Screener application.

**Legend:**

- [x] = Test implemented and passing
- [ ] = Test not implemented
- [~] = Partially implemented / failing (needs investigation)
- N/A = Feature not yet implemented in app

---

## 1. Screener - Data Display

| Status | Scenario                             | Test File        |
| ------ | ------------------------------------ | ---------------- |
| [x]    | Display stock data table             | screener.spec.ts |
| [x]    | Display correct columns              | screener.spec.ts |
| [x]    | Display stock symbols as links       | screener.spec.ts |
| [x]    | Display approaching/touched sections | screener.spec.ts |
| [x]    | Display last updated timestamp       | screener.spec.ts |
| [x]    | Display summary strip                | screener.spec.ts |

---

## 2. Screener - Navigation

| Status | Scenario                         | Test File        |
| ------ | -------------------------------- | ---------------- |
| [x]    | Display screener navigation tabs | screener.spec.ts |
| [x]    | Switch between screeners         | screener.spec.ts |
| [x]    | Show active screener highlighted | screener.spec.ts |

---

## 3. Screener - Profile Filters

| Status | Scenario                                   | Test File        |
| ------ | ------------------------------------------ | ---------------- |
| [x]    | Display profile filters for buyer interest | screener.spec.ts |
| [x]    | Filter by direction                        | screener.spec.ts |
| [x]    | Filter by minimum score                    | screener.spec.ts |

---

## 4. Screener - Auto Refresh

| Status | Scenario                    | Test File        |
| ------ | --------------------------- | ---------------- |
| [x]    | Have auto-refresh input     | screener.spec.ts |
| [x]    | Set auto-refresh interval   | screener.spec.ts |
| [x]    | Disable auto-refresh when 0 | screener.spec.ts |

---

## 5. Screener - Trading List

| Status | Scenario                       | Test File        |
| ------ | ------------------------------ | ---------------- |
| [x]    | Display trading list textarea  | screener.spec.ts |
| [x]    | Copy trading list to clipboard | screener.spec.ts |

---

## 6. Screener - Error Handling

| Status | Scenario                        | Test File        |
| ------ | ------------------------------- | ---------------- |
| [x]    | Show error state when API fails | screener.spec.ts |
| [x]    | Retry on error                  | screener.spec.ts |

---

## Summary

| Category                | Passed | Total  | Coverage |
| ----------------------- | ------ | ------ | -------- |
| Screener - Data         | 6      | 6      | 100%     |
| Screener - Nav          | 3      | 3      | 100%     |
| Screener - Filters      | 3      | 3      | 100%     |
| Screener - Refresh      | 3      | 3      | 100%     |
| Screener - Trading List | 2      | 2      | 100%     |
| Screener - Errors       | 2      | 2      | 100%     |
| **TOTAL**               | **19** | **19** | **100%** |

---

## Test Files Created

| File             | Tests | Status      |
| ---------------- | ----- | ----------- |
| screener.spec.ts | 16    | All passing |

---

_Last Updated: March 3, 2026_
