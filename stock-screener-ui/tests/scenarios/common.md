# Common Features Test Scenarios

This document tracks common E2E test scenarios for the Alphashri Stock Screener application.

**Legend:**

- [x] = Test implemented and passing
- [ ] = Test not implemented
- [~] = Partially implemented / failing (needs investigation)
- N/A = Feature not yet implemented in app

---

## 11. Table Sorting

| Status | Scenario                       | Test File       |
| ------ | ------------------------------ | --------------- |
| [x]    | Sort by Score column           | sorting.spec.ts |
| [x]    | Toggle sort direction          | sorting.spec.ts |
| [x]    | Sort by Symbol column          | sorting.spec.ts |
| [x]    | Show clickable sort indicators | sorting.spec.ts |

---

## 12. Filters

| Status | Scenario                      | Test File       |
| ------ | ----------------------------- | --------------- |
| [x]    | Score filter input exists     | filters.spec.ts |
| [x]    | Price filter input exists     | filters.spec.ts |
| [x]    | Sector filter dropdown exists | filters.spec.ts |
| [x]    | Reset filters button exists   | filters.spec.ts |
| [x]    | Change filter value           | filters.spec.ts |
| [x]    | Click reset filters           | filters.spec.ts |

---

## 13. UI Controls

| Status | Scenario                        | Test File        |
| ------ | ------------------------------- | ---------------- |
| [x]    | Refresh data on button click    | controls.spec.ts |
| [x]    | Copy trading list to clipboard  | controls.spec.ts |
| [x]    | Change auto-refresh interval    | controls.spec.ts |
| [x]    | Show error state on API failure | controls.spec.ts |
| [x]    | Show loading state during fetch | controls.spec.ts |

---

## 14. Notifications

| Status | Scenario                      | Test File             |
| ------ | ----------------------------- | --------------------- |
| [x]    | Toggle notification panel     | notifications.spec.ts |
| [x]    | Show notification filter tabs | notifications.spec.ts |
| [x]    | Clear notifications           | notifications.spec.ts |
| [x]    | Filter notifications by type  | notifications.spec.ts |

---

## 15. Buyer Interest+ Screener

| Status | Scenario                  | Test File              |
| ------ | ------------------------- | ---------------------- |
| [x]    | Load Buyer Interest+ data | buyer-interest.spec.ts |
| [x]    | Display bullish stocks    | buyer-interest.spec.ts |
| [x]    | Show sentiment data       | buyer-interest.spec.ts |

---

## Summary

| Category        | Passed | Total  | Coverage |
| --------------- | ------ | ------ | -------- |
| Table Sorting   | 4      | 4      | 100%     |
| Filters         | 6      | 6      | 100%     |
| UI Controls     | 5      | 5      | 100%     |
| Notifications   | 4      | 4      | 100%     |
| Buyer Interest+ | 3      | 3      | 100%     |
| **TOTAL**       | **22** | **22** | **100%** |

---

_Last Updated: March 3, 2026_
