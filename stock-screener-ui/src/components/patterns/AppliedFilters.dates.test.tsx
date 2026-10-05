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

describe("AppliedFilters date chips", () => {
  test("builds Date chips for from_date/to_date that reset to null", () => {
    const chips = buildAppliedFilterChips(
      makeFilters({ from_date: "2026-06-01", to_date: "2026-09-30T14:30" }),
      PATTERNS,
    );
    expect(chips).toMatchObject([
      { id: "from_date", group: "Date", label: "formed ≥ 2026-06-01", nextValue: null },
      { id: "to_date", group: "Date", label: "formed ≤ 2026-09-30 14:30", nextValue: null },
    ]);
    expect(chips[0].key).toBe("from_date");
    expect(chips[1].key).toBe("to_date");
  });

  test("omits date chips when unset", () => {
    expect(buildAppliedFilterChips(makeFilters(), PATTERNS)).toEqual([]);
  });

  test("renders date chips with Date group prefix", () => {
    r(
      <AppliedFilters
        filters={makeFilters({ from_date: "2026-06-01", to_date: "2026-09-30T14:30" })}
        patterns={PATTERNS}
        setFilter={vi.fn()}
        resetFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("Date: formed ≥ 2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("Date: formed ≤ 2026-09-30 14:30")).toBeInTheDocument();
  });

  test("removing a date chip resets it to null", () => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ from_date: "2026-06-01", to_date: "2026-09-30T14:30" })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId("patterns-applied-filter-from_date").querySelector(
        ".MuiChip-deleteIcon",
      ) as Element,
    );
    expect(setFilter).toHaveBeenCalledWith("from_date", null);
    fireEvent.click(
      screen.getByTestId("patterns-applied-filter-to_date").querySelector(
        ".MuiChip-deleteIcon",
      ) as Element,
    );
    expect(setFilter).toHaveBeenCalledWith("to_date", null);
  });
});
