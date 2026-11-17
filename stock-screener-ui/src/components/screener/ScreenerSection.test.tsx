// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { ScreenerSection } from "./ScreenerSection";
import { UIProvider } from "@/ui";

vi.mock("./ScreenerStockView", () => ({
  ScreenerStockView: (props: any) => (
    <div data-testid="screener-stock-view" data-section={props.section}>
      Stock View
    </div>
  ),
}));

describe("ScreenerSection", () => {
  const defaultProps = {
    title: "Approaching (3)",
    description: "Stocks nearing the high",
    testId: "screener-section-test",
    stocks: [],
    columns: [],
    touchedSymbols: new Set<string>(),
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
    section: "approaching" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders CompactPanel with title and description", () => {
    render(() => (
      <UIProvider>
        <ScreenerSection {...defaultProps} />
      </UIProvider>
    ));
    expect(screen.getByText("Approaching (3)")).toBeInTheDocument();
    expect(screen.getByText("Stocks nearing the high")).toBeInTheDocument();
  });

  it("reserves the description line when a profile has no description", () => {
    render(() => (
      <UIProvider>
        <ScreenerSection {...defaultProps} description="" />
      </UIProvider>
    ));
    // CompactPanel omits the line when the description is empty; a placeholder
    // keeps the header height identical across screener definitions. Read raw
    // textContent — toHaveTextContent trims the non-breaking space to "".
    expect(screen.getByTestId("status").textContent).toBe("\u00a0");
  });

  it("renders the same responsive description slot for real and missing descriptions", () => {
    const slotOf = (description: string) => {
      cleanup();
      render(() => (
        <UIProvider>
          <ScreenerSection {...defaultProps} description={description} />
        </UIProvider>
      ));
      const slot = screen.getByTestId("status").querySelector("span");
      expect(slot).not.toBeNull();
      return slot as HTMLSpanElement;
    };

    const realSlot = slotOf("Stocks nearing the high");
    expect(realSlot.className).toContain("hidden");
    expect(realSlot.className).toContain("sm:block");
    expect(realSlot.textContent).toBe("Stocks nearing the high");

    const emptySlot = slotOf("");
    expect(emptySlot.className).toBe(realSlot.className);
    // The nbsp fallback still applies at >=sm (the slot is display:none below
    // sm, block above), keeping the one-line reservation on desktop.
    expect(emptySlot.textContent).toBe("\u00a0");
  });

  it("delegates to ScreenerStockView", () => {
    render(() => (
      <UIProvider>
        <ScreenerSection {...defaultProps} />
      </UIProvider>
    ));
    expect(screen.getByTestId("screener-stock-view")).toBeInTheDocument();
  });
});
