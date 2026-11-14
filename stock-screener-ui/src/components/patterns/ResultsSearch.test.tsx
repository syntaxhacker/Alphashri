// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { PatternFilters } from "@/types/chartPatterns";
import { ResultsSearch } from "./ResultsSearch";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});

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

/** Renders ResultsSearch against a filter store the test can echo back into. */
function renderHarness(initialFilters: PatternFilters, setFilter: (key: string, value: unknown) => void) {
  let echo!: (f: PatternFilters) => void;
  const result = render(() => {
    const [filters, setFilters] = createSignal(initialFilters);
    echo = setFilters;
    return <ResultsSearch filters={filters()} setFilter={setFilter} />;
  });
  return { ...result, echo: (f: PatternFilters) => echo(f) };
}

describe("ResultsSearch", () => {
  afterEach(() => cleanup());

  test("typing commits a debounced filters.q once", async () => {
    const setFilter = vi.fn();
    renderHarness(makeFilters(), setFilter);
    const input = screen.getByTestId("patterns-results-search");

    fireEvent.input(input, { target: { value: "bank" } });

    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("q", "bank"));
    expect(setFilter).toHaveBeenCalledTimes(1);
  });

  test("renders the current value", () => {
    renderHarness(makeFilters({ q: "infy" }), vi.fn());
    expect(screen.getByTestId("patterns-results-search")).toHaveValue("infy");
  });

  test("keeps characters typed after a commit when the parent echoes q back", async () => {
    const setFilter = vi.fn();
    const { echo } = renderHarness(makeFilters(), setFilter);
    const input = screen.getByTestId("patterns-results-search");

    fireEvent.input(input, { target: { value: "bank" } });
    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("q", "bank"));

    // User keeps typing before the store echo lands.
    fireEvent.input(input, { target: { value: "banks" } });
    expect(input).toHaveValue("banks");

    // The late echo of our own commit (filters.q === "bank") must NOT clobber it.
    echo(makeFilters({ q: "bank" }));
    expect(input).toHaveValue("banks");
    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("q", "banks"));
  });

  test("propagates an external q reset (Clear filters) to the input", () => {
    const { echo } = renderHarness(makeFilters({ q: "bank" }), vi.fn());
    const input = screen.getByTestId("patterns-results-search");
    expect(input).toHaveValue("bank");

    echo(makeFilters({ q: "" }));
    expect(input).toHaveValue("");
  });

  test("does not commit on mount or when filters.q already matches", async () => {
    const setFilter = vi.fn();
    const { echo } = renderHarness(makeFilters({ q: "bank" }), setFilter);
    // Longer than the 300ms debounce: an unchanged query must never re-commit.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(setFilter).not.toHaveBeenCalled();

    echo(makeFilters({ q: "bank" }));
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(setFilter).not.toHaveBeenCalled();
  });

  test("parent echo of a commit does not trigger a second commit", async () => {
    const setFilter = vi.fn();
    const { echo } = renderHarness(makeFilters(), setFilter);
    const input = screen.getByTestId("patterns-results-search");

    fireEvent.input(input, { target: { value: "bank" } });
    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("q", "bank"));

    // Late store echo of our own commit must not re-commit.
    echo(makeFilters({ q: "bank" }));
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(setFilter).toHaveBeenCalledTimes(1);
  });
});
