# Advanced Features Test Scenarios

This document tracks E2E test scenarios for advanced features in the Alphashri Stock Screener application.

**Legend:**

- [x] = Test implemented and passing
- [ ] = Test not implemented
- [~] = Partially implemented / failing (needs investigation)
- N/A = Feature not yet implemented in app

---

## 25. Sector Analysis View

| Status | Scenario                    | Test File      | Notes   |
| ------ | --------------------------- | -------------- | ------- |
| [x]    | Navigate to sector analysis | sector.spec.ts | Passing |
| [x]    | Display sector rotation     | sector.spec.ts | Passing |
| [x]    | Filter by sector            | sector.spec.ts | Passing |
| [x]    | View sector performance     | sector.spec.ts | Passing |

**Coverage:** 4/4 (100%)

---

## 26. Chart View

| Status | Scenario                  | Test File     | Notes   |
| ------ | ------------------------- | ------------- | ------- |
| [x]    | Display candlestick chart | chart.spec.ts | Passing |
| [x]    | Show ORB levels           | chart.spec.ts | Passing |
| [x]    | Show 52W high/low levels  | chart.spec.ts | Passing |
| [x]    | Show trade markers        | chart.spec.ts | Passing |
| [x]    | Chart zoom/pan            | chart.spec.ts | Passing |
| [x]    | Change timeframe          | chart.spec.ts | Passing |

**Coverage:** 6/6 (100%)

---

## 27. News Panel

| Status | Scenario            | Test File    | Notes   |
| ------ | ------------------- | ------------ | ------- |
| [x]    | Display news panel  | news.spec.ts | Passing |
| [x]    | Switch news sources | news.spec.ts | Passing |
| [x]    | Refresh news        | news.spec.ts | Passing |
| [x]    | Toggle panel on/off | news.spec.ts | Passing |

**Coverage:** 4/4 (100%)

---

## 28. Multi-Strategy System

| Status | Scenario                               | Test File              | Notes   |
| ------ | -------------------------------------- | ---------------------- | ------- |
| [x]    | Each strategy has own signal generator | multi-strategy.spec.ts | Passing |
| [x]    | Each strategy has own watchlist        | multi-strategy.spec.ts | Passing |
| [x]    | ORB signals differ from 52W signals    | multi-strategy.spec.ts | Passing |
| [x]    | Scan items attributed to strategy      | multi-strategy.spec.ts | Passing |
| [x]    | 52W high line on chart                 | multi-strategy.spec.ts | Passing |
| [x]    | Trade history strategy attribution     | multi-strategy.spec.ts | Passing |

**Coverage:** 6/6 (100%)

---

## Summary

| Category        | Passed | Total  | Coverage |
| --------------- | ------ | ------ | -------- |
| Sector Analysis | 4      | 4      | 100%     |
| Chart View      | 6      | 6      | 100%     |
| News Panel      | 4      | 4      | 100%     |
| Multi-Strategy  | 6      | 6      | 100%     |
| **TOTAL**       | **20** | **20** | **100%** |

---

## Priority Tests to Implement

### All tests completed!

- ✅ chart.spec.ts - Display candlestick chart with ORB levels
- ✅ chart.spec.ts - Show 52W high/low levels and trade markers
- ✅ chart.spec.ts - Chart zoom/pan and timeframe changes
- ✅ sector.spec.ts - Display sector rotation and filtering
- ✅ news.spec.ts - Switch news sources and refresh functionality
- ✅ news.spec.ts - Toggle panel on/off

---

## Test Files Status

| File                   | Tests | Status      |
| ---------------------- | ----- | ----------- |
| multi-strategy.spec.ts | 14    | All passing |
| sector.spec.ts         | 18    | All passing |
| chart.spec.ts          | 35    | All passing |
| news.spec.ts           | 13    | All passing |

---

_Last Updated: March 3, 2026_
