# Paper Trading Test Scenarios

This document contains E2E test scenarios for the Paper Trading feature of the Alphashri Stock Screener application.

**Legend:**

- [x] = Test implemented and passing
- [ ] = Test not implemented
- [~] = Partially implemented / failing (needs investigation)
- N/A = Feature not yet implemented in app

---

## 16. Paper Trading - Live Positions

| Status | Scenario                                | Test File             |
| ------ | --------------------------------------- | --------------------- |
| [x]    | Display paper trading view with tabs    | paper-trading.spec.ts |
| [x]    | Display bot selector dropdown           | paper-trading.spec.ts |
| [x]    | List available bots                     | paper-trading.spec.ts |
| [x]    | Show portfolio summary                  | paper-trading.spec.ts |
| [x]    | Show scan items from multi-strategy bot | paper-trading.spec.ts |
| [x]    | Show positions with strategy tabs       | paper-trading.spec.ts |
| [x]    | Filter positions by strategy tab        | paper-trading.spec.ts |
| [x]    | Show bot status running/pid             | paper-trading.spec.ts |
| [x]    | Show auto-refresh toggle                | paper-trading.spec.ts |
| [x]    | Show empty state when no positions      | paper-trading.spec.ts |

---

## 17. Paper Trading - Trade History

| Status | Scenario                    | Test File             |
| ------ | --------------------------- | --------------------- |
| [x]    | Display trade history tab   | trade-history.spec.ts |
| [x]    | Display trade history table | trade-history.spec.ts |
| [x]    | Show trade details in table | trade-history.spec.ts |
| [x]    | Filter by date range        | trade-history.spec.ts |
| [x]    | Filter by symbol            | trade-history.spec.ts |
| [x]    | Filter by strategy          | trade-history.spec.ts |
| [x]    | Show P&L for each trade     | trade-history.spec.ts |
| [x]    | Show entry and exit prices  | trade-history.spec.ts |
| [x]    | Show trade duration         | trade-history.spec.ts |
| [x]    | Export trade history        | trade-history.spec.ts |
| [x]    | Show empty state            | trade-history.spec.ts |

---

## 18. Paper Trading - Settings

| Status | Scenario                         | Test File   |
| ------ | -------------------------------- | ----------- |
| [x]    | Display all settings sections    | app.spec.ts |
| [x]    | Update Max Positions and persist | app.spec.ts |
| [x]    | Reset settings to defaults       | app.spec.ts |
| [x]    | ORB Strategy settings            | app.spec.ts |
| [x]    | Risk Management settings         | app.spec.ts |
| [x]    | Trading Costs settings           | app.spec.ts |

---

## 19. Paper Trading - API Polling

| Status | Scenario                         | Test File             |
| ------ | -------------------------------- | --------------------- |
| [x]    | Call bots API on load            | paper-trading.spec.ts |
| [x]    | Call portfolio API on bot select | paper-trading.spec.ts |
| [x]    | Call scan API on bot select      | paper-trading.spec.ts |

---

## 20. Paper Trading - Bot Controls

| Status | Scenario                        | Test File             |
| ------ | ------------------------------- | --------------------- |
| [x]    | Show Start Bot when not running | paper-trading.spec.ts |
| [x]    | Show Stop Bot when running      | paper-trading.spec.ts |

---

## 21. Paper Trading - Strategy Tabs

| Status | Scenario                        | Test File             |
| ------ | ------------------------------- | --------------------- |
| [x]    | Show all positions in All tab   | paper-trading.spec.ts |
| [x]    | Filter scan items by strategy   | paper-trading.spec.ts |
| [x]    | Show strategy P&L in tab badges | paper-trading.spec.ts |

---

## Summary

| Category                      | Passed | Total  | Coverage |
| ----------------------------- | ------ | ------ | -------- |
| Paper Trading - Live          | 10     | 10     | 100%     |
| Paper Trading - History       | 11     | 11     | 100%     |
| Paper Trading - Settings      | 6      | 6      | 100%     |
| Paper Trading - API           | 3      | 3      | 100%     |
| Paper Trading - Bot Controls  | 2      | 2      | 100%     |
| Paper Trading - Strategy Tabs | 3      | 3      | 100%     |
| **TOTAL**                     | **35** | **35** | **100%** |

---

## Related Test Files

| File                   | Tests | Status      |
| ---------------------- | ----- | ----------- |
| paper-trading.spec.ts  | 18    | All passing |
| trade-history.spec.ts  | 11    | All passing |
| app.spec.ts            | 6     | All passing |
| multi-strategy.spec.ts | 14    | All passing |

---

_Last Updated: March 3, 2026_
