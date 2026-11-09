import { describe, expect, test } from "vitest";
import type {
  SimCombinedResult,
  SimRunResult,
  SimStrategyResult,
  SimTrade,
} from "@/types/reportSim";
import {
  closedTradesAt,
  combinedViewAt,
  filterTradesAt,
  isOpenTrade,
  selectedStrategy,
  strategyViewAt,
} from "./simView";

function trade(overrides: Partial<SimTrade> = {}): SimTrade {
  return {
    id: "t-1",
    strategyId: "sc-1",
    strategyName: "Long call",
    legs: [],
    entryTime: "2026-11-09T09:16:00+05:30",
    exitTime: "2026-11-09T09:20:00+05:30",
    entrySpot: 24900,
    exitSpot: 24950,
    entryPremium: 100,
    exitPremium: 120,
    lots: 1,
    qty: 75,
    grossPnl: 1500,
    costs: 40,
    netPnl: 1460,
    points: 20,
    exitReason: "TP",
    holdMin: 4,
    priced: true,
    ...overrides,
  };
}

const TRADES: SimTrade[] = [
  trade({ id: "a", entryTime: "2026-11-09T09:16:00+05:30", exitTime: "2026-11-09T09:20:00+05:30", netPnl: 100 }),
  trade({ id: "b", entryTime: "2026-11-09T09:25:00+05:30", exitTime: "2026-11-09T09:30:00+05:30", netPnl: 150 }),
];

const EQUITY = [
  { t: "2026-11-09T09:15:00+05:30", pnl: 0 },
  { t: "2026-11-09T09:20:00+05:30", pnl: 100 },
  { t: "2026-11-09T09:30:00+05:30", pnl: 250 },
];

function strategy(overrides: Partial<SimStrategyResult> = {}): SimStrategyResult {
  return {
    id: "sc-1",
    name: "Long call",
    legs: [],
    netDebit: 7500,
    maxProfit: 0,
    maxLoss: 7500,
    breakevens: [24975],
    marginEst: 0,
    trades: TRADES,
    open: [],
    realized: 250,
    unrealized: 0,
    total: 250,
    stats: { trades: 2, winRate: 100, profitFactor: 0, avgHoldMin: 4.5, maxDrawdown: 0 },
    equity: EQUITY,
    payoff: { spots: [], expiry: [] },
    skipped: null,
    ...overrides,
  };
}

const COMBINED: SimCombinedResult = {
  realized: 250,
  unrealized: 0,
  total: 250,
  equity: EQUITY,
};

function runResult(): SimRunResult {
  return {
    symbol: "NIFTY",
    date: "2026-11-09",
    expiry: "2026-11-12",
    dte: 3,
    asOf: "2026-11-09T09:30:00+05:30",
    spot: 24900,
    lotSize: 75,
    lotVerified: true,
    coverage: { frames: 3, first: EQUITY[0].t, last: EQUITY[2].t, gaps: 0 },
    strategies: [strategy()],
    combined: COMBINED,
    tapeLagSec: 4,
    fillModel: "next-minute close",
  };
}

describe("filterTradesAt", () => {
  test("returns every trade when the playhead is unset", () => {
    expect(filterTradesAt(TRADES, null)).toBe(TRADES);
  });

  test("keeps trades entered at or before the playhead", () => {
    const result = filterTradesAt(TRADES, "2026-11-09T09:22:00+05:30");
    expect(result.map((item) => item.id)).toEqual(["a"]);
  });

  test("includes a trade entered exactly on the playhead", () => {
    const result = filterTradesAt(TRADES, "2026-11-09T09:25:00+05:30");
    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("closedTradesAt", () => {
  test("returns every trade when the playhead is unset", () => {
    expect(closedTradesAt(TRADES, null)).toBe(TRADES);
  });

  test("keeps only trades already exited", () => {
    const result = closedTradesAt(TRADES, "2026-11-09T09:22:00+05:30");
    expect(result.map((item) => item.id)).toEqual(["a"]);
  });

  test("a trade exiting exactly on the playhead counts as closed", () => {
    const result = closedTradesAt(TRADES, "2026-11-09T09:20:00+05:30");
    expect(result.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("strategyViewAt", () => {
  test("slices equity and books realized P&L at the playhead", () => {
    const view = strategyViewAt(strategy(), "2026-11-09T09:22:00+05:30");
    expect(view.equity).toEqual(EQUITY.slice(0, 2));
    expect(view.trades.map((item) => item.id)).toEqual(["a"]);
    expect(view.realized).toBe(100);
    expect(view.total).toBe(100);
    expect(view.unrealized).toBe(0);
  });

  test("uses the last equity point as the total", () => {
    const view = strategyViewAt(strategy(), null);
    expect(view.equity).toEqual(EQUITY);
    expect(view.total).toBe(250);
    expect(view.realized).toBe(250);
    expect(view.unrealized).toBe(0);
  });

  test("includes a still-open entry in the trade list without booking it", () => {
    const openTrade = trade({ id: "c", entryTime: "2026-11-09T09:31:00+05:30", exitTime: "" });
    const result = strategy({
      trades: [...TRADES, openTrade],
      equity: [...EQUITY, { t: "2026-11-09T09:40:00+05:30", pnl: 300 }],
      total: 300,
    });
    const view = strategyViewAt(result, "2026-11-09T09:35:00+05:30");
    expect(view.realized).toBe(250);
    expect(view.total).toBe(250);
    expect(view.unrealized).toBe(0);
  });

  test("an in-progress trade is OPEN at the playhead, not at its future exit", () => {
    const mid = trade({
      id: "mid",
      entryTime: "2026-11-09T09:16:00+05:30",
      exitTime: "2026-11-09T09:40:00+05:30",
      netPnl: 999,
      exitReason: "MAX_HOLD",
      holdMin: 24,
    });
    const result = strategy({
      trades: [mid],
      equity: [
        { t: "2026-11-09T09:15:00+05:30", pnl: 0 },
        { t: "2026-11-09T09:30:00+05:30", pnl: -200 },
        { t: "2026-11-09T09:40:00+05:30", pnl: -543 },
      ],
      total: -543,
    });
    const view = strategyViewAt(result, "2026-11-09T09:30:00+05:30");
    expect(view.trades).toHaveLength(1);
    expect(view.trades[0].exitReason).toBe("OPEN");
    expect(view.trades[0].exitTime).toBe("");
    expect(view.trades[0].netPnl).toBe(-200);
    expect(view.realized).toBe(0);
    expect(view.unrealized).toBe(-200);
    expect(view.total).toBe(-200);
    expect(view.stats.trades).toBe(1);
    expect(view.stats.maxDrawdown).toBe(200);
  });

  test("a live open position is appended as an OPEN row", () => {
    const result = strategy({
      trades: [TRADES[0]],
      open: [
        {
          strategyId: "sc-1",
          strategyName: "Long call",
          legs: [],
          entryTime: "2026-11-09T09:35:00+05:30",
          entrySpot: 25000,
          markTime: "2026-11-09T09:50:00+05:30",
          markSpot: 25010,
          entryPremium: -100,
          markPremium: -90,
          grossPnl: 650,
          netPnl: 600,
          points: 8,
          priced: true,
        },
      ],
      equity: [
        { t: "2026-11-09T09:15:00+05:30", pnl: 0 },
        { t: "2026-11-09T09:50:00+05:30", pnl: 700 },
      ],
      total: 700,
    });
    const view = strategyViewAt(result, null);
    expect(view.trades).toHaveLength(2);
    expect(view.trades[1].exitReason).toBe("OPEN");
    expect(view.trades[1].netPnl).toBe(600);
    expect(view.realized).toBe(100);
    expect(view.unrealized).toBe(600);
  });

  test("an empty equity curve totals zero", () => {
    const view = strategyViewAt(strategy({ equity: [], trades: [] }), null);
    expect(view.total).toBe(0);
    expect(view.realized).toBe(0);
    expect(view.unrealized).toBe(0);
  });
});

describe("combinedViewAt", () => {
  test("reports the combined total and realized from the payload", () => {
    const view = combinedViewAt(runResult(), null);
    expect(view.equity).toEqual(EQUITY);
    expect(view.trades).toEqual([]);
    expect(view.total).toBe(250);
    expect(view.realized).toBe(250);
    expect(view.unrealized).toBe(0);
  });

  test("slices the combined equity to the playhead", () => {
    const view = combinedViewAt(runResult(), "2026-11-09T09:22:00+05:30");
    expect(view.equity).toEqual(EQUITY.slice(0, 2));
    expect(view.total).toBe(100);
    expect(view.realized).toBe(100);
    expect(view.unrealized).toBe(0);
  });
});

describe("isOpenTrade", () => {
  test("is true between entry and exit", () => {
    expect(isOpenTrade(TRADES[0], "2026-11-09T09:18:00+05:30")).toBe(true);
  });

  test("is inclusive at entry and exclusive at exit", () => {
    expect(isOpenTrade(TRADES[0], "2026-11-09T09:16:00+05:30")).toBe(true);
    expect(isOpenTrade(TRADES[0], "2026-11-09T09:20:00+05:30")).toBe(false);
  });

  test("is false without a playhead", () => {
    expect(isOpenTrade(TRADES[0], null)).toBe(false);
  });
});

describe("selectedStrategy", () => {
  test("finds the strategy by id", () => {
    expect(selectedStrategy(runResult(), "sc-1")?.name).toBe("Long call");
  });

  test("returns null for a missing id or result", () => {
    expect(selectedStrategy(runResult(), "sc-9")).toBeNull();
    expect(selectedStrategy(null, "sc-1")).toBeNull();
  });
});
