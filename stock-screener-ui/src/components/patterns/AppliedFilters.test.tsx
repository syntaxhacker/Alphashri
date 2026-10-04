// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";
import type { PatternDef, PatternFilters } from "@/types/chartPatterns";
import { AppliedFilters, buildAppliedFilterChips } from "./AppliedFilters";

const PATTERNS: PatternDef[] = [
  { pattern_id: "double_bottom", name: "Double Bottom", family: "reversal", direction: "bullish", description: "" },
];

function makeFilters(overrides: Partial<PatternFilters> = {}): PatternFilters {
  return { ...DEFAULT_PATTERN_FILTERS, ...overrides };
}

function r(ui: React.ReactElement) {
  return render(ui, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

afterEach(() => cleanup());

describe("buildAppliedFilterChips", () => {
  test("returns nothing when no filters are applied", () => {
    expect(buildAppliedFilterChips(makeFilters(), PATTERNS)).toEqual([]);
  });

  test("renders pattern ids as readable names", () => {
    const chips = buildAppliedFilterChips(makeFilters({ pattern_id: ["double_bottom"] }), PATTERNS);
    expect(chips).toHaveLength(1);
    expect(chips[0].group).toBe("Pattern");
    expect(chips[0].label).toBe("Double Bottom");
  });

  test("omits symbols and q (already shown inline in the toolbar)", () => {
    const chips = buildAppliedFilterChips(makeFilters({ symbols: ["BSE"], q: "foo" }), PATTERNS);
    expect(chips).toEqual([]);
  });

  test("carries the next value for each active value", () => {
    const chips = buildAppliedFilterChips(makeFilters({ direction: ["bullish", "bearish"] }), PATTERNS);
    const bullish = chips.find((c) => c.id === "direction:bullish");
    expect(bullish?.nextValue).toEqual(["bearish"]);
  });

  test("omits the trendlines chip when the view is both", () => {
    expect(buildAppliedFilterChips(makeFilters({ trendlines: "both" }), PATTERNS)).toEqual([]);
  });

  test("builds a trendlines chip that resets to both", () => {
    const chips = buildAppliedFilterChips(makeFilters({ trendlines: "support" }), PATTERNS);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      id: "trendlines",
      group: "Trendlines",
      label: "Support only",
      key: "trendlines",
      nextValue: "both",
    });
    expect(
      buildAppliedFilterChips(makeFilters({ trendlines: "resistance" }), PATTERNS)[0].label,
    ).toBe("Resistance only");
    expect(
      buildAppliedFilterChips(makeFilters({ trendlines: "none" }), PATTERNS)[0].label,
    ).toBe("Hidden");
  });
});

describe("AppliedFilters", () => {
  test("renders nothing when no filters are applied", () => {
    const { container } = r(
      <AppliedFilters filters={makeFilters()} patterns={PATTERNS} setFilter={vi.fn()} resetFilters={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("shows a chip per applied filter", () => {
    r(
      <AppliedFilters
        filters={makeFilters({ direction: ["bullish"], quality: "strong", min_rr: 2 })}
        patterns={PATTERNS}
        setFilter={vi.fn()}
        resetFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("Direction: Bullish")).toBeInTheDocument();
    expect(screen.getByText("Quality: Strong")).toBeInTheDocument();
    expect(screen.getByText("R:R: ≥ 2")).toBeInTheDocument();
  });

  test("removing an array chip drops only that value", () => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ direction: ["bullish", "bearish"] })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("patterns-applied-filter-direction:bullish");
    fireEvent.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
    expect(setFilter).toHaveBeenCalledWith("direction", ["bearish"]);
  });

  test("removing a scalar chip clears it", () => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ quality: "strong" })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("patterns-applied-filter-quality:strong");
    fireEvent.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
    expect(setFilter).toHaveBeenCalledWith("quality", null);
  });

  test("Clear all resets every filter", () => {
    const resetFilters = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ status: ["failed"] })}
        patterns={PATTERNS}
        setFilter={vi.fn()}
        resetFilters={resetFilters}
      />,
    );
    fireEvent.click(screen.getByTestId("patterns-applied-clear-all"));
    expect(resetFilters).toHaveBeenCalledTimes(1);
  });

  test("clicking the trendlines chip resets the view to both", () => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ trendlines: "none" })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("Trendlines: Hidden")).toBeInTheDocument();
    const chip = screen.getByTestId("patterns-applied-filter-trendlines");
    fireEvent.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
    expect(setFilter).toHaveBeenCalledWith("trendlines", "both");
  });
});
