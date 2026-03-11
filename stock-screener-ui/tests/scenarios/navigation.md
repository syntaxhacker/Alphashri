# Navigation Test Scenarios

This document tracks E2E test scenarios for navigation features in the Alphashri Stock Screener application.

**Legend:**

- [x] = Test implemented and passing
- [ ] = Test not implemented
- [~] = Partially implemented / failing (needs investigation)
- N/A = Feature not yet implemented in app

---

## Navigation - Sidemenu

| Status | Scenario                          | Test File          |
| ------ | --------------------------------- | ------------------ |
| [x]    | Display all navigation items      | navigation.spec.ts |
| [x]    | Highlight active navigation item  | navigation.spec.ts |
| [x]    | Navigate to Paper Trading         | navigation.spec.ts |
| [x]    | Navigate to Backtest              | navigation.spec.ts |
| [x]    | Navigate to Sector Analysis       | navigation.spec.ts |
| [x]    | Navigate to Strategies            | navigation.spec.ts |
| [x]    | Navigate to Bots                  | navigation.spec.ts |
| [x]    | Navigate to Screener              | navigation.spec.ts |
| [x]    | Update active state on navigation | navigation.spec.ts |

---

## Navigation - URL Routing

| Status | Scenario                         | Test File          |
| ------ | -------------------------------- | ------------------ |
| [x]    | Load Paper Trading from /paper   | navigation.spec.ts |
| [x]    | Load Backtest from /backtest     | navigation.spec.ts |
| [x]    | Load Sector from /sector         | navigation.spec.ts |
| [x]    | Load Strategies from /strategies | navigation.spec.ts |
| [x]    | Load Bots from /bots             | navigation.spec.ts |
| [x]    | Redirect unknown routes to home  | navigation.spec.ts |

---

## Market Ticker

| Status | Scenario                     | Test File          |
| ------ | ---------------------------- | ------------------ |
| [x]    | Display market ticker at top | navigation.spec.ts |
| [x]    | Show loading state           | navigation.spec.ts |
| [x]    | Handle API error gracefully  | navigation.spec.ts |

---

## Summary

| Category                 | Passed | Total  | Coverage |
| ------------------------ | ------ | ------ | -------- |
| Navigation - Sidemenu    | 9      | 9      | 100%     |
| Navigation - URL Routing | 6      | 6      | 100%     |
| Market Ticker            | 3      | 3      | 100%     |
| **TOTAL**                | **18** | **18** | **100%** |

---

_Last Updated: March 3, 2026_
