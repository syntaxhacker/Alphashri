// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import type { Trade } from "../../types/backtest";

interface SortEntry {
  id: string;
  desc: boolean;
}

// Seed/prefs writes are observable through the mocked useTablePrefs hook.
const prefsMock = vi.hoisted(() => ({
  ids: [] as string[],
  setPrefs: null as ((next: { sorting: SortEntry[]; order: string[]; hidden: string[] }) => void) | null,
  sortingCalls: [] as SortEntry[][],
}));

vi.mock("../common/useTablePrefs", async () => {
  const { createSignal } = await import("solid-js");
  const [get, set] = createSignal<{ sorting: SortEntry[]; order: string[]; hidden: string[] }>({
    sorting: [],
    order: [],
    hidden: [],
  });
  prefsMock.setPrefs = set;
  return {
    useTablePrefs: (tableId: string) => {
      prefsMock.ids.push(tableId);
      return {
        prefs: () => get(),
        hydrated: () => true,
        status: () => "ready",
        error: () => null,
        setSorting: (next: SortEntry[]) => {
          prefsMock.sortingCalls.push(next);
        },
        setColumnPrefs: () => {},
        retry: () => {},
      };
    },
  };
});

// A probe for the props the page hands to the unified (prop-sorted) table.
const tradeTable = vi.hoisted(() => ({
  props: [] as Array<{ sortColumn: string; sortDirection: string; onSort: (col: string) => void }>,
}));

vi.mock("./index", async () => {
  const { createEffect } = await import("solid-js");
  return {
    BacktestConfig: () => null,
    BacktestProgress: () => null,
    TradeHistoryTable: (props: {
      sortColumn: string;
      sortDirection: string;
      onSort: (col: string) => void;
    }) => {
      createEffect(() => {
        tradeTable.props.push({
          sortColumn: props.sortColumn,
          sortDirection: props.sortDirection,
          onSort: props.onSort,
        });
      });
      const el = document.createElement("div");
      el.setAttribute("data-testid", "trade-table-probe");
      const button = document.createElement("button");
      button.setAttribute("data-testid", "probe-sort-entry-price");
      button.textContent = "sort entry_price";
      button.addEventListener("click", () => props.onSort("entry_price"));
      el.appendChild(button);
      return el;
    },
  };
});

vi.mock("../../api/backtest", () => ({
  runBacktest: vi.fn(),
  fetchStrategies: vi.fn(async () => {}),
  fetchVariations: vi.fn(async () => {}),
  fetchCosts: vi.fn(async () => {}),
  fetchChartData: vi.fn(async () => {}),
}));

vi.mock("../../state/holidays", () => ({
  getHolidayState: () => ({ holidays: [] }),
  subscribeToHolidays: () => () => {},
  loadHolidays: vi.fn(),
}));

vi.mock("./BacktestChart", () => ({ zoomToTrade: vi.fn() }));

import { BacktestPage } from "./BacktestPage";
import { resetBacktestState, setTradeHistory } from "../../state/backtest";

function makeTrade(): Trade {
  return {
    entry_price: 100,
    exit_price: 110,
    entry_time: "2025-06-15T09:30:00Z",
    exit_time: "2025-06-15T10:45:00Z",
    quantity: 10,
    gross_pnl: 100,
    gross_pnl_pct: 1,
    trading_costs: 5,
    net_pnl: 95,
    net_pnl_pct: 0.95,
    exit_reason: "TP",
    hold_duration_minutes: 75,
    date: "2025-06-15",
  };
}

function mountPage() {
  return render(() => (
    <UIProvider>
      <BacktestPage />
    </UIProvider>
  ));
}

const lastProps = () => tradeTable.props[tradeTable.props.length - 1];
const seed = (sorting: SortEntry[]) =>
  prefsMock.setPrefs?.({ sorting, order: [], hidden: [] });

beforeEach(() => {
  localStorage.clear();
  prefsMock.ids.length = 0;
  prefsMock.sortingCalls.length = 0;
  tradeTable.props.length = 0;
  seed([]);
  resetBacktestState();
  setTradeHistory([makeTrade()], "TEST");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BacktestPage viewport shell", () => {
  it("keeps the route fixed so panels and the trade chart own scrolling", () => {
    mountPage();
    const shell = screen.getByTestId("backtest-view");
    expect(shell).toHaveClass("h-full", "min-h-0", "flex", "flex-col", "overflow-hidden");
    expect(screen.getByTestId("backtest-rail")).toHaveClass("h-full", "min-h-0", "overflow-hidden");
  });
});

describe("BacktestPage trade-history sort persistence", () => {
  it("hydrates a single saved sort entry into sortColumn/sortDirection", async () => {
    seed([{ id: "net_pnl", desc: false }]);
    mountPage();

    await waitFor(() => {
      expect(lastProps()?.sortColumn).toBe("net_pnl");
      expect(lastProps()?.sortDirection).toBe("asc");
    });
    expect(prefsMock.ids).toContain("backtest.trades");
    // Hydration must never echo back as a write.
    expect(prefsMock.sortingCalls).toHaveLength(0);
  });

  it("writes the new {id,desc} pair when a different column is sorted", async () => {
    seed([{ id: "net_pnl", desc: false }]);
    mountPage();
    await waitFor(() => expect(lastProps()?.sortColumn).toBe("net_pnl"));

    fireEvent.click(screen.getByTestId("probe-sort-entry-price"));

    await waitFor(() => {
      expect(prefsMock.sortingCalls.at(-1)).toEqual([{ id: "entry_price", desc: true }]);
    });
    expect(lastProps()?.sortColumn).toBe("entry_price");
    expect(lastProps()?.sortDirection).toBe("desc");
  });

  it("toggles direction (and persists the flipped desc flag) on the same column", async () => {
    seed([{ id: "entry_price", desc: true }]);
    mountPage();
    await waitFor(() => expect(lastProps()?.sortDirection).toBe("desc"));

    fireEvent.click(screen.getByTestId("probe-sort-entry-price"));

    await waitFor(() => {
      expect(prefsMock.sortingCalls.at(-1)).toEqual([{ id: "entry_price", desc: false }]);
    });
    expect(lastProps()?.sortDirection).toBe("asc");
  });

  it("keeps the page default and does not write when saved sorting is empty", async () => {
    seed([]);
    mountPage();

    await waitFor(() => expect(lastProps()).toBeDefined());
    expect(lastProps()?.sortColumn).toBe("entry_time");
    expect(lastProps()?.sortDirection).toBe("desc");
    expect(prefsMock.sortingCalls).toHaveLength(0);
  });
});
