// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { WatchlistNarrowCards } from "./WatchlistNarrowCards";
import type { PaperScanItem } from "../../types/paperTrading";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const item = {
  symbol: "RELIANCE",
  status: "signal",
  side: "LONG",
  price: 2520,
  or_high: 2525,
  or_low: 2500,
  reason: "ORB breakout",
  strategy_name: "ORB Strategy",
  strategy_id: 1,
  timestamp: new Date().toISOString(),
} as unknown as PaperScanItem;

describe("WatchlistNarrowCards", () => {
  it("keeps the symbol click on the local onSelect handler with a visible focus ring", () => {
    const onSelect = vi.fn();
    render(() => (
      <UIProvider>
        <WatchlistNarrowCards items={[item]} selectedSymbol={null} onSelect={onSelect} />
      </UIProvider>
    ));
    const button = screen.getByTestId("watchlist-narrow-symbol-RELIANCE");
    expect(button.tagName).toBe("BUTTON");
    expect(button.className).toContain("focus-visible:outline");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(item);
  });
});
