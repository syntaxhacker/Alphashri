// @vitest-environment happy-dom
import type { JSX } from "solid-js";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { PositionNarrowCards } from "./PositionNarrowCards";
import { StrategyCard } from "./StrategyCard";
import { mockPosition } from "./testFixtures";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function mount(ui: () => JSX.Element) {
  return render(() => <UIProvider>{ui()}</UIProvider>);
}

describe("PositionNarrowCards", () => {
  it("shows symbol → qty → entry → LTP → P&L in one card", () => {
    const { container } = mount(() => (
      <PositionNarrowCards positions={[mockPosition({ symbol: "TCS" })]} />
    ));
    const card = screen.getByTestId("positions-narrow-cards");
    const text = card.textContent ?? "";
    const at = (label: string) => text.indexOf(label);
    expect(at("TCS")).toBeGreaterThanOrEqual(0);
    expect(at("Qty")).toBeLessThan(at("Entry"));
    expect(at("Entry")).toBeLessThan(at("LTP"));
    expect(at("LTP")).toBeLessThan(at("P&L"));

    expect(screen.getByTestId("position-narrow-qty-1-TCS")).toHaveTextContent("100");
    expect(screen.getByTestId("position-narrow-entry-1-TCS")).toHaveTextContent("₹2500.00");
    expect(screen.getByTestId("position-narrow-ltp-1-TCS")).toHaveTextContent("₹2550.00");
    expect(screen.getByTestId("position-narrow-pnl-1-TCS")).toHaveTextContent("+₹");
    expect(screen.getByTestId("position-narrow-pnl-1-TCS")).toHaveTextContent("2.00%");
    expect(container.querySelector('[data-testid$="-scroll-hint"]')).toBeNull();
  });

  it("renders an option contract in canonical form and keeps the raw close payload", () => {
    const onClose = vi.fn();
    const pos = mockPosition({ symbol: "NIFTY26OCT23000PE", current_price: 150 });
    mount(() => (
      <PositionNarrowCards positions={[pos]} onClose={onClose} />
    ));
    const link = screen.getByTestId("symbol-link-1-NIFTY26OCT23000PE");
    expect(link).toHaveTextContent("NIFTY 23000 PE");
    expect(link).toHaveAttribute("title", "NIFTY26OCT23000PE");
    fireEvent.click(screen.getByLabelText("Close position NIFTY 23000 PE"));
    expect(onClose).toHaveBeenCalledWith("NIFTY26OCT23000PE", 150);
  });

  it("renders missing numbers as dashes, never NaN", () => {
    const { container } = mount(() => (
      <PositionNarrowCards positions={[mockPosition({
        symbol: "NAN",
        quantity: Number.NaN,
        entry_price: Number.NaN,
        current_price: Number.NaN,
        pnl: Number.NaN,
        pnl_pct: Number.NaN,
      })]} />
    ));
    expect(screen.getByTestId("position-narrow-qty-1-NAN")).toHaveTextContent("—");
    expect(screen.getByTestId("position-narrow-entry-1-NAN")).toHaveTextContent("—");
    expect(screen.getByTestId("position-narrow-ltp-1-NAN")).toHaveTextContent("—");
    expect(screen.getByTestId("position-narrow-pnl-1-NAN")).toHaveTextContent("—");
    expect(container.textContent).not.toContain("NaN");
  });

  it("selects and closes through the card actions", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    mount(() => (
      <PositionNarrowCards
        positions={[mockPosition({ symbol: "TCS" })]}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));
    const symbolButton = screen.getByTestId("symbol-link-1-TCS");
    expect(symbolButton.className).toContain("focus-visible:outline");
    expect(symbolButton.className).not.toContain("focus:outline-none");
    await fireEvent.click(symbolButton);
    expect(onSelect).toHaveBeenCalledWith(
      "TCS", "ord-1", "ORB Strategy", undefined, 1, "2026-03-20T09:30:00Z",
    );
    await fireEvent.click(screen.getByTestId("close-position-1-TCS"));
    expect(onClose).toHaveBeenCalledWith("TCS", 2550);
  });
});

describe("StrategyCard at 390px", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", ((query: string) => ({
      matches: /max-width:\s*599px/.test(query),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia);
  });

  it("replaces the retained positions table with stacked cards", () => {
    const { container } = mount(() => (
      <StrategyCard
        strategyName="ORB Strategy"
        positions={[mockPosition({ symbol: "TCS" })]}
        maxCapacity={5}
        onSelectSymbol={vi.fn()}
        onClosePosition={vi.fn()}
        onCloseAll={vi.fn()}
      />
    ));
    expect(screen.getByTestId("positions-narrow-cards")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="positions-table"]')).toBeNull();
    expect(container.querySelector('[data-testid$="-scroll-hint"]')).toBeNull();
    expect(container.textContent).not.toContain("Scroll →");
  });
});
