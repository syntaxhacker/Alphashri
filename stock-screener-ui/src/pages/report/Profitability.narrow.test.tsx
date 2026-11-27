// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { For } from "solid-js";
import { UIProvider } from "@/ui";
import { ProfitabilityPage } from "./Profitability";
import { ProfitabilityWithDock } from "../../App";
import { SymbolDockContext, type SymbolDockApi } from "@/components/common/symbolDockContext";
import { fetchProfitability } from "../../api/profitability";

vi.mock("../../api/profitability", () => ({ fetchProfitability: vi.fn() }));

vi.mock("@/components/common/TanStackTable", () => ({
  TanStackTable: (props: any) => (
    <div data-testid={props.dataTestId}>
      <For each={props.data}>
        {(row: any, i: () => number) => (
          <div
            data-testid={props.getRowTestId ? props.getRowTestId(row, i()) : undefined}
            onClick={() => props.onRowClick?.(row)}
          >
            {props.columns.map((col: any) =>
              col.cell ? (
                <span>
                  {col.cell({
                    row: { original: row, index: i(), isExpanded: () => false, toggle: () => {} },
                  })}
                </span>
              ) : null,
            )}
          </div>
        )}
      </For>
    </div>
  ),
}));

const payload = {
  weeks: 4,
  universe: "nifty500",
  as_of: "2026-10-07T15:30:00+05:30",
  cached: false,
  strategies: [
    { id: "orb", label: "Opening Range Breakout", trades: 5, win_rate: 0.6, net_pnl: 1200.5, expectancy: 240.1, profit_factor: 2.1, max_dd: 300, avg_hold_days: 2 },
    { id: "sr_breakout", label: "S/R Breakout", trades: 3, win_rate: 0.3333, net_pnl: -400.25, expectancy: -133.42, profit_factor: 0.4, max_dd: 800, avg_hold_days: 5 },
  ],
  top_signals: [
    { symbol: "RELIANCE", strategy: "orb", entry_date: "2026-09-20", entry: 2850, exit: 2890, net: 900 },
    { symbol: "INFY", strategy: "sr_breakout", entry_date: "2026-09-21", entry: 1500, exit: 1480, net: -1350 },
  ],
};

function stubNarrow(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow && query.includes("max-width: 899px"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function mount() {
  return render(() => (
    <UIProvider>
      <ProfitabilityPage />
    </UIProvider>
  ));
}

function dockWith(open: (symbol: string) => void): SymbolDockApi {
  return {
    open,
    preview: vi.fn(),
    endPreview: vi.fn(),
    close: vi.fn(),
    pinned: false,
    setOutlet: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchProfitability).mockResolvedValue(payload as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("profitability KPI rail", () => {
  test("shows net P&L, PF and max drawdown at desktop width", async () => {
    stubNarrow(false);
    mount();
    await screen.findByTestId("profitability-strategies");
    const rail = screen.getByTestId("profitability-kpi-rail");
    expect(rail).toContainElement(screen.getByTestId("profit-kpi-net"));
    expect(rail).toContainElement(screen.getByTestId("profit-kpi-pf"));
    expect(rail).toContainElement(screen.getByTestId("profit-kpi-maxdd"));
    expect(screen.getByTestId("profit-kpi-net")).toHaveTextContent("+₹800");
    expect(screen.getByTestId("profit-kpi-maxdd")).toHaveTextContent("-₹800");
  });

  test("keeps the same rail visible at 390", async () => {
    stubNarrow(true);
    mount();
    await screen.findByTestId("profitability-strategy-cards");
    expect(screen.getByTestId("profitability-kpi-rail")).toBeVisible();
    expect(screen.getByTestId("profit-kpi-net")).toHaveTextContent("+₹800");
    expect(screen.getByTestId("profit-kpi-pf")).toBeVisible();
    expect(screen.getByTestId("profit-kpi-maxdd")).toBeVisible();
  });
});

describe("profitability at 390", () => {
  beforeEach(() => stubNarrow(true));

  test("replaces both tables with stacked cards and keeps NET first", async () => {
    mount();
    await screen.findByTestId("profitability-strategy-cards");
    expect(screen.queryByTestId("profitability-strategies")).toBeNull();
    expect(screen.queryByTestId("profitability-signals")).toBeNull();
    expect(screen.queryByTestId("profitability-strategies-scroll-hint")).toBeNull();

    const strategyCard = screen.getByTestId("profitability-strategy-card-orb");
    for (const label of ["Exp/trade", "PF", "MaxDD", "Hold(d)", "Win%"]) {
      expect(strategyCard).toHaveTextContent(label);
    }
    expect(strategyCard).toHaveTextContent("+₹1.2K");
    expect(screen.getByTestId("profitability-signal-card-RELIANCE-0")).toHaveTextContent("+₹900");
  });

  test("shows in/out prices and signed net on every signal card", async () => {
    const onOpenSymbol = vi.fn();
    render(() => (
      <UIProvider>
        <ProfitabilityPage onOpenSymbol={onOpenSymbol} />
      </UIProvider>
    ));
    await screen.findByTestId("profitability-signal-cards");
    const losing = screen.getByTestId("profitability-signal-card-INFY-1");
    expect(losing).toHaveTextContent("NET");
    expect(losing).toHaveTextContent("In ₹");
    expect(losing).toHaveTextContent("Out ₹");
    expect(losing).toHaveTextContent("-₹1.4K");
    losing.click();
    await waitFor(() => expect(onOpenSymbol).toHaveBeenCalledWith("INFY"));
  });
});

describe("/report/profit route wiring", () => {
  function mountRoute(open: (symbol: string) => void) {
    return render(() => (
      <UIProvider>
        <SymbolDockContext.Provider value={dockWith(open)}>
          <ProfitabilityWithDock />
        </SymbolDockContext.Provider>
      </UIProvider>
    ));
  }

  test("signal card click opens the app-wide dock for that symbol", async () => {
    stubNarrow(true);
    const open = vi.fn();
    mountRoute(open);
    const card = await screen.findByTestId("profitability-signal-card-INFY-1");
    fireEvent.click(card);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("INFY");
  });

  test("signal card Enter/Space opens the dock (keyboard parity)", async () => {
    stubNarrow(true);
    const open = vi.fn();
    mountRoute(open);
    const card = await screen.findByTestId("profitability-signal-card-RELIANCE-0");
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith("RELIANCE");
  });

  test("desktop signal row click opens the dock", async () => {
    stubNarrow(false);
    const open = vi.fn();
    mountRoute(open);
    const row = await screen.findByTestId("profitability-signal-row-INFY-1");
    fireEvent.click(row);
    expect(open).toHaveBeenCalledWith("INFY");
  });
});
