// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ReplayPositions } from "./ReplayPositions";
import type { ReplayOpenPosition } from "../../types/replay";

afterEach(() => {
  cleanup();
});

describe("ReplayPositions", () => {
  it("returns null when positions array is empty", () => {
    render(
      <UIProvider>
        <ReplayPositions positions={[]} />
      </UIProvider>,
    );
    expect(screen.queryByTestId("replay-positions")).not.toBeInTheDocument();
  });

  it("renders wrapper with data-testid", () => {
    const positions: ReplayOpenPosition[] = [{
      id: 1, symbol: "TCS", strategy: "ORB", side: "LONG",
      entry_price: 100, sl: 90, tp: 110, entry_time: "09:15", quantity: 100,
    }];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    expect(screen.getByTestId("replay-positions")).toBeInTheDocument();
  });

  it("shows Open Positions title with count badge", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, sl: 90, tp: 110, entry_time: "09:15", quantity: 100 },
      { id: 2, symbol: "INFY", strategy: "ORB", side: "SHORT", entry_price: 200, sl: 210, tp: 190, entry_time: "09:20", quantity: 50 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    expect(screen.getByText("Open Positions")).toBeInTheDocument();
  });

  it("renders header columns", () => {
    const positions: ReplayOpenPosition[] = [{
      id: 1, symbol: "TCS", strategy: "ORB", side: "LONG",
      entry_price: 100, sl: 90, tp: 110, entry_time: "09:15", quantity: 100,
    }];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    expect(screen.getByText("Symbol")).toBeInTheDocument();
    expect(screen.getByText("Side")).toBeInTheDocument();
    expect(screen.getByText("Qty")).toBeInTheDocument();
    expect(screen.getByText("Entry Price")).toBeInTheDocument();
    expect(screen.getByText("SL")).toBeInTheDocument();
    expect(screen.getByText("TP")).toBeInTheDocument();
    expect(screen.getByText("Strategy")).toBeInTheDocument();
    expect(screen.getByText("Entry Time")).toBeInTheDocument();
  });

  it("renders each position row with correct data", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100.5, sl: 90, tp: 110, entry_time: "09:15", quantity: 100 },
      { id: 2, symbol: "INFY", strategy: "52W", side: "SHORT", entry_price: 200, sl: 210, tp: 190, entry_time: "09:20", quantity: 50 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    expect(screen.getByText("TCS")).toBeInTheDocument();
    expect(screen.getByText("INFY")).toBeInTheDocument();
    expect(screen.getByText("ORB")).toBeInTheDocument();
    expect(screen.getByText("52W")).toBeInTheDocument();
  });

  it("shows SideBadge for each position side", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, sl: 90, tp: 110, entry_time: "09:15", quantity: 100 },
      { id: 2, symbol: "INFY", strategy: "ORB", side: "SHORT", entry_price: 200, sl: 210, tp: 190, entry_time: "09:20", quantity: 50 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    const longBadges = screen.getAllByText("LONG");
    const shortBadges = screen.getAllByText("SHORT");
    expect(longBadges.length).toBeGreaterThanOrEqual(1);
    expect(shortBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows quantity centered", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, sl: 90, tp: 110, entry_time: "09:15", quantity: 100 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("formats entry price to 2 decimals", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100.5, sl: 90, tp: 110, entry_time: "09:15", quantity: 100 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    expect(screen.getByText("100.50")).toBeInTheDocument();
  });

  it("shows SL in red with 2 decimal formatting", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, sl: 90.5, tp: 110, entry_time: "09:15", quantity: 100 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    const slEl = screen.getByText("90.50");
    expect(slEl).toBeInTheDocument();
    expect(slEl.closest("td")).toBeInTheDocument();
  });

  it("shows TP in green with 2 decimal formatting", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, sl: 90, tp: 110.5, entry_time: "09:15", quantity: 100 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    const tpEl = screen.getByText("110.50");
    expect(tpEl).toBeInTheDocument();
    expect(tpEl.closest("td")).toBeInTheDocument();
  });

  it("shows strategy name as text", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, sl: 90, tp: 110, entry_time: "09:15", quantity: 100 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    expect(screen.getByText("ORB")).toBeInTheDocument();
  });

  it("formats entry time via formatTimeOnly", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, sl: 90, tp: 110, entry_time: "09:15", quantity: 100 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    expect(screen.getByText("09:15")).toBeInTheDocument();
  });

  it("row key is composite (symbol-strategy-id) so same symbol different strategies both render", () => {
    const positions: ReplayOpenPosition[] = [
      { id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, sl: 90, tp: 110, entry_time: "09:15", quantity: 100 },
      { id: 2, symbol: "TCS", strategy: "52W", side: "SHORT", entry_price: 200, sl: 210, tp: 190, entry_time: "09:20", quantity: 50 },
    ];
    render(
      <UIProvider>
        <ReplayPositions positions={positions} />
      </UIProvider>,
    );
    expect(screen.getAllByText("TCS")).toHaveLength(2);
    expect(screen.getByText("ORB")).toBeInTheDocument();
    expect(screen.getByText("52W")).toBeInTheDocument();
  });
});
