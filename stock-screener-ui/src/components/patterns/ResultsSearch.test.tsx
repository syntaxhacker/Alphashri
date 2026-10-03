// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternFilters } from "@/types/chartPatterns";
import { ResultsSearch } from "./ResultsSearch";

type FiltersFixture = PatternFilters & { q?: string };

function makeFilters(overrides: Partial<FiltersFixture> = {}): PatternFilters {
  return {
    family: [],
    pattern_id: [],
    direction: [],
    status: [],
    quality: null,
    formed_within_bars: null,
    volume_confirmed: null,
    min_rr: null,
    symbol: null,
    min_base_days: null,
    max_range_pct: null,
    sort: "confidence",
    ...overrides,
  } as PatternFilters;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("ResultsSearch", () => {
  afterEach(() => cleanup());

  test("typing commits a debounced filters.q once", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    r(<ResultsSearch filters={makeFilters()} setFilter={setFilter} />);

    await user.type(screen.getByTestId("patterns-results-search"), "bank");

    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("q", "bank"));
    expect(setFilter).toHaveBeenCalledTimes(1);
  });

  test("renders the label and current value", () => {
    r(<ResultsSearch filters={makeFilters({ q: "infy" })} setFilter={vi.fn()} />);
    expect(screen.getByLabelText("Search results")).toHaveValue("infy");
  });
});
