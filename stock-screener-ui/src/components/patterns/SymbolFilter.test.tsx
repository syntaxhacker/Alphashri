// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import type { PatternFilters } from "@/types/chartPatterns";

const searchSymbols = vi.fn();
vi.mock("@/api/symbols", () => ({
  searchSymbols: (...args: unknown[]) => searchSymbols(...args),
}));

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});

import { SymbolFilter } from "./SymbolFilter";

type FiltersFixture = PatternFilters & { symbols?: string[] };

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


describe("SymbolFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchSymbols.mockResolvedValue([
      { symbol: "RELIANCE", name: "Reliance Industries" },
    ]);
  });
  afterEach(() => cleanup());

  test("typing searches and selecting a symbol calls setFilter('symbols', ...)", async () => {
    const setFilter = vi.fn();
    render(() => <SymbolFilter filters={makeFilters()} setFilter={setFilter} />);

    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    // The local MultiSelect opens its listbox on focus (the previous one opened on change).
    fireEvent.focus(combo);
    fireEvent.input(combo, { target: { value: "reli" } });

    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("reli", 20));

    const option = await screen.findByRole("option", { name: /RELIANCE/ });
    fireEvent.click(within(option).getByRole("checkbox"));

    await waitFor(() =>
      expect(setFilter).toHaveBeenCalledWith("symbols", ["RELIANCE"]),
    );
  });

  test("shows the helper text", () => {
    render(() => <SymbolFilter filters={makeFilters()} setFilter={vi.fn()} />);
    expect(screen.getByText("Show patterns only for these symbols")).toBeInTheDocument();
  });

  test("keeps typed text after async options resolve (controlled searchValue)", async () => {
    const setFilter = vi.fn();
    render(() => <SymbolFilter filters={makeFilters()} setFilter={setFilter} />);

    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.input(combo, { target: { value: "reli" } });

    // Wait for the debounced search + options state update to land.
    await screen.findByRole("option", { name: /RELIANCE/ });
    // Regression: the input must keep the typed text after options resolve.
    expect(combo).toHaveValue("reli");
  });

  test("clearing empties selected symbols", async () => {
    const setFilter = vi.fn();
    render(() => <SymbolFilter filters={makeFilters({ symbols: ["TCS"] })} setFilter={setFilter} />);

    expect(screen.getByTestId("patterns-symbol-chip-TCS")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("patterns-symbol-clear"));

    expect(setFilter).toHaveBeenCalledWith("symbols", []);
  });

  test("chip remove is a labelled button reachable by keyboard", async () => {
    const setFilter = vi.fn();
    render(() => <SymbolFilter filters={makeFilters({ symbols: ["TCS"] })} setFilter={setFilter} />);

    const remove = screen.getByRole("button", { name: "Remove TCS" });
    expect(remove).toBeInTheDocument();

    remove.focus();
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: "Enter" });
    fireEvent.click(remove);
    expect(setFilter).toHaveBeenCalledWith("symbols", []);
  });

  test("debounces search: rapid keystrokes fire one search for the final term", async () => {
    const setFilter = vi.fn();
    render(() => <SymbolFilter filters={makeFilters()} setFilter={setFilter} />);
    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.input(combo, { target: { value: "rel" } });
    fireEvent.input(combo, { target: { value: "reli" } });

    await screen.findByRole("option", { name: /RELIANCE/ });
    expect(searchSymbols).toHaveBeenCalledWith("reli", 20);
    expect(searchSymbols).not.toHaveBeenCalledWith("rel", 20);
  });

  test("does not search on mount or for an empty query", () => {
    render(() => <SymbolFilter filters={makeFilters()} setFilter={vi.fn()} />);
    expect(searchSymbols).not.toHaveBeenCalled();
  });

  test("selecting a second symbol appends (multi-select)", async () => {
    searchSymbols.mockResolvedValue([
      { symbol: "RELIANCE", name: "Reliance Industries" },
      { symbol: "HDFCBANK", name: "HDFC Bank" },
    ]);
    const setFilter = vi.fn();
    render(() => <SymbolFilter filters={makeFilters({ symbols: ["TCS"] })} setFilter={setFilter} />);

    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.input(combo, { target: { value: "h" } });
    const option = await screen.findByRole("option", { name: /HDFCBANK/ });
    fireEvent.click(within(option).getByRole("checkbox"));

    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("symbols", ["TCS", "HDFCBANK"]));
  });

  test("onChange override (scope mode) receives selections instead of setFilter", async () => {
    const setFilter = vi.fn();
    const onChange = vi.fn();
    render(() => <SymbolFilter filters={makeFilters()} setFilter={setFilter} onChange={onChange} />);

    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.input(combo, { target: { value: "reli" } });
    fireEvent.click(within(await screen.findByRole("option", { name: /RELIANCE/ })).getByRole("checkbox"));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["RELIANCE"]));
    expect(setFilter).not.toHaveBeenCalled();
  });

  test("remove and clear route through onChange when provided", async () => {
    const setFilter = vi.fn();
    const onChange = vi.fn();
    render(() =>       <SymbolFilter
        filters={makeFilters({ symbols: ["TCS", "RELIANCE"] })}
        setFilter={setFilter}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove RELIANCE" }));
    expect(onChange).toHaveBeenCalledWith(["TCS"]);
    expect(setFilter).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("patterns-symbol-clear"));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(setFilter).not.toHaveBeenCalled();
  });

  test("clicking a chip remove drops just that symbol (default setFilter)", async () => {
    const setFilter = vi.fn();
    render(() => <SymbolFilter filters={makeFilters({ symbols: ["TCS", "RELIANCE"] })} setFilter={setFilter} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove RELIANCE" }));
    expect(setFilter).toHaveBeenCalledWith("symbols", ["TCS"]);
  });

  test("supports placeholder and helper text overrides", () => {
    render(() =>       <SymbolFilter
        filters={makeFilters()}
        setFilter={vi.fn()}
        placeholder="Pick symbols…"
        helperText="Custom helper"
      />,
    );
    expect(screen.getByPlaceholderText("Pick symbols…")).toBeInTheDocument();
    expect(screen.getByText("Custom helper")).toBeInTheDocument();
    expect(screen.queryByText("Show patterns only for these symbols")).not.toBeInTheDocument();
  });
});
