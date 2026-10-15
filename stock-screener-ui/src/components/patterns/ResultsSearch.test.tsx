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
    expect(screen.getByLabelText("Filter results")).toHaveValue("infy");
  });

  test("keeps characters typed after a commit when the parent echoes q back", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    const { rerender } = r(<ResultsSearch filters={makeFilters()} setFilter={setFilter} />);
    const input = screen.getByTestId("patterns-results-search");

    await user.type(input, "bank");
    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("q", "bank"));

    // User keeps typing before the store echo lands.
    await user.type(input, "s");
    expect(input).toHaveValue("banks");

    // The late echo of our own commit (filters.q === "bank") must NOT clobber it.
    rerender(<ResultsSearch filters={makeFilters({ q: "bank" })} setFilter={setFilter} />);
    expect(input).toHaveValue("banks");
    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("q", "banks"));
  });

  test("propagates an external q reset (Clear filters) to the input", () => {
    const { rerender } = r(
      <ResultsSearch filters={makeFilters({ q: "bank" })} setFilter={vi.fn()} />,
    );
    const input = screen.getByTestId("patterns-results-search");
    expect(input).toHaveValue("bank");

    rerender(<ResultsSearch filters={makeFilters({ q: "" })} setFilter={vi.fn()} />);
    expect(input).toHaveValue("");
  });

  test("does not commit on mount or when filters.q already matches", async () => {
    const setFilter = vi.fn();
    const { rerender } = r(
      <ResultsSearch filters={makeFilters({ q: "bank" })} setFilter={setFilter} />,
    );
    // Longer than the 300ms debounce: an unchanged query must never re-commit.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(setFilter).not.toHaveBeenCalled();

    rerender(<ResultsSearch filters={makeFilters({ q: "bank" })} setFilter={setFilter} />);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(setFilter).not.toHaveBeenCalled();
  });

  test("parent echo of a commit does not trigger a second commit", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    const { rerender } = r(<ResultsSearch filters={makeFilters()} setFilter={setFilter} />);

    await user.type(screen.getByTestId("patterns-results-search"), "bank");
    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("q", "bank"));

    // Late store echo of our own commit must not re-commit.
    rerender(<ResultsSearch filters={makeFilters({ q: "bank" })} setFilter={setFilter} />);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(setFilter).toHaveBeenCalledTimes(1);
  });
});
