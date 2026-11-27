// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";

// A live-price tick replaces the whole snapshot object (setPositions in the
// store) while `trades` and the filters keep their references. The harness
// reproduces that exactly: `getState()` returns a fresh object every tick.
const harness = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let state: any = {};
  return {
    calls: { strategies: 0, bots: 0, byRange: 0, book: 0 },
    getState: () => state,
    setState: (next: any) => { state = next; },
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    tick: () => listeners.forEach((cb) => cb()),
  };
});

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: () => harness.getState(),
  subscribe: (cb: () => void) => harness.subscribe(cb),
  setSelectedSymbol: vi.fn(),
  setFilterStrategy: vi.fn(),
  setFilterBot: vi.fn(),
  setFilterSource: vi.fn(),
  setFilterFromDate: vi.fn(),
  setFilterToDate: vi.fn(),
  setSelectedTradeId: vi.fn(),
  setShowAllTrades: vi.fn(),
  updateTradeNotesAction: vi.fn(),
  deleteTradeAction: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  fetchPaperChart: vi.fn().mockResolvedValue(undefined),
  refreshHistoryData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api/paperTrading", () => ({
  fetchPaperChart: apiMocks.fetchPaperChart,
  refreshHistoryData: apiMocks.refreshHistoryData,
}));

vi.mock("../../utils/tradeHistoryUtils", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getUniqueStrategies: (trades: any) => {
      harness.calls.strategies++;
      return actual.getUniqueStrategies(trades);
    },
    getUniqueBots: (trades: any) => {
      harness.calls.bots++;
      return actual.getUniqueBots(trades);
    },
    filterByRange: (trades: any, from: any, to: any) => {
      harness.calls.byRange++;
      return actual.filterByRange(trades, from, to);
    },
  };
});

vi.mock("./optionTradeUtils", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    tradeMatchesBook: (trade: any, book: any) => {
      harness.calls.book++;
      return actual.tradeMatchesBook(trade, book);
    },
  };
});

const prefsHarness = vi.hoisted(() => ({ set: null as ((next: any[]) => void) | null }));

vi.mock("../common/useTablePrefs", async () => {
  const { createSignal } = await import("solid-js");
  const [get, set] = createSignal<any[]>([]);
  prefsHarness.set = set;
  return {
    useTablePrefs: () => ({
      prefs: () => ({ sorting: get(), order: [], hidden: [] }),
      setSorting: set,
      status: () => "ready",
      error: () => null,
      hydrated: () => true,
      setColumnPrefs: () => {},
      retry: () => {},
    }),
  };
});

import { PaperHistoryTable } from "./PaperHistoryTable";
import { mockTrade, mockPosition } from "./testFixtures";

// Stable across ticks: only `positions` changes on a live-price tick.
const stableTrades = [
  mockTrade({
    trade_id: "t1",
    exit_time: "2026-05-09T10:30:00Z",
    strategy_id: 1,
    strategy_name: "ORB",
    bot_id: "b1",
    bot_name: "Alpha",
  }),
  mockTrade({
    trade_id: "t2",
    exit_time: "2026-05-09T11:30:00Z",
    symbol: "TCS",
    strategy_id: 2,
    strategy_name: "SR",
    bot_id: "b2",
    bot_name: "Beta",
  }),
];

function snapshot(overrides: Record<string, any> = {}) {
  return {
    currentView: "history",
    positions: [],
    portfolio: null,
    trades: stableTrades,
    filterSymbol: null,
    filterFromDate: "2026-05-01",
    filterToDate: "2026-05-31",
    filterStrategy: null,
    filterBot: null,
    filterSource: "equity",
    selectedSymbol: null,
    selectedTradeId: null,
    isLoading: false,
    availableBots: [],
    ...overrides,
  };
}

beforeEach(() => {
  harness.calls.strategies = 0;
  harness.calls.bots = 0;
  harness.calls.byRange = 0;
  harness.calls.book = 0;
  prefsHarness.set!([]);
  harness.setState(snapshot());
});

afterEach(() => cleanup());

describe("PaperHistoryTable live-tick derivations", () => {
  test("position price ticks do not re-filter, re-sort or rebuild trade rows", () => {
    render(() => <PaperHistoryTable />);

    const rowT1 = screen.getByTestId("trade-row-t1");
    const rowT2 = screen.getByTestId("trade-row-t2");
    const group = screen.getByTestId("day-group-2026-05-09");
    const rowOrder = () =>
      Array.from(document.querySelectorAll("tbody tr[data-row='stock']")).map(
        (tr) => (tr as HTMLElement).dataset.testid,
      );
    // Default sort is newest exit_time first — this must not change.
    expect(rowOrder()).toEqual(["trade-row-t2", "trade-row-t1"]);

    const afterMount = { ...harness.calls };
    expect(afterMount).toEqual({ strategies: 1, bots: 1, byRange: 1, book: 2 });

    for (let i = 0; i < 20; i++) {
      harness.setState(snapshot({ positions: [mockPosition({ current_price: 2500 + i })] }));
      harness.tick();
    }

    // The derivations keyed on `trades` + filters must not re-run on a tick
    // that only touched positions. Before the fix each of the 20 ticks ran
    // the full filter pipeline again.
    expect(harness.calls.byRange).toBe(afterMount.byRange);
    expect(harness.calls.book).toBe(afterMount.book);
    expect(harness.calls.strategies).toBe(afterMount.strategies);
    expect(harness.calls.bots).toBe(afterMount.bots);
    expect(harness.calls).toEqual({ strategies: 1, bots: 1, byRange: 1, book: 2 });

    // Row identity and ordering survive the ticks unchanged.
    expect(screen.getByTestId("trade-row-t1")).toBe(rowT1);
    expect(screen.getByTestId("trade-row-t2")).toBe(rowT2);
    expect(screen.getByTestId("day-group-2026-05-09")).toBe(group);
    expect(rowOrder()).toEqual(["trade-row-t2", "trade-row-t1"]);
  });

  test("a real trade change still re-derives the table", () => {
    render(() => <PaperHistoryTable />);
    const byRangeAfterMount = harness.calls.byRange;

    harness.setState(snapshot({
      trades: [
        mockTrade({ trade_id: "t3", exit_time: "2026-05-10T10:30:00Z", strategy_id: 1, strategy_name: "ORB" }),
      ],
    }));
    harness.tick();

    expect(harness.calls.byRange).toBeGreaterThan(byRangeAfterMount);
    expect(screen.getByTestId("trade-row-t3")).toBeInTheDocument();
  });
});
