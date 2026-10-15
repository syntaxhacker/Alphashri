// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternFilters } from "@/types/chartPatterns";

const searchSymbols = vi.fn();
vi.mock("@/api/symbols", () => ({
  searchSymbols: (...args: unknown[]) => searchSymbols(...args),
}));

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

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
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
    const user = userEvent.setup();
    const setFilter = vi.fn();
    r(<SymbolFilter filters={makeFilters()} setFilter={setFilter} />);

    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    // NOTE: userEvent.type per-keystroke simulation is swallowed by MUI
    // Autocomplete in happy-dom when the parent re-renders (stateful data);
    // fireEvent exercises the same onSearchChange path. Real-browser E2E
    // covers actual typing.
    fireEvent.change(combo, { target: { value: "reli" } });

    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("reli", 20));

    const option = await screen.findByRole("option", { name: /RELIANCE/ });
    await user.click(option);

    await waitFor(() =>
      expect(setFilter).toHaveBeenCalledWith("symbols", ["RELIANCE"]),
    );
  });

  test("shows the helper text", () => {
    r(<SymbolFilter filters={makeFilters()} setFilter={vi.fn()} />);
    expect(screen.getByText("Show patterns only for these symbols")).toBeInTheDocument();
  });

  test("keeps typed text after async options resolve (controlled searchValue)", async () => {
    const setFilter = vi.fn();
    r(<SymbolFilter filters={makeFilters()} setFilter={setFilter} />);

    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    fireEvent.change(combo, { target: { value: "reli" } });

    // Wait for the debounced search + options state update to land.
    await screen.findByRole("option", { name: /RELIANCE/ });
    // Regression: MUI used to reset the uncontrolled input here, wiping "reli".
    expect(combo).toHaveValue("reli");
  });

  test("clearing empties selected symbols", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    r(<SymbolFilter filters={makeFilters({ symbols: ["TCS"] })} setFilter={setFilter} />);

    expect(screen.getByTestId("patterns-symbol-chip-TCS")).toBeInTheDocument();

    await user.click(screen.getByTestId("patterns-symbol-clear"));

    expect(setFilter).toHaveBeenCalledWith("symbols", []);
  });

  test("chip remove is a labelled button reachable by keyboard", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    r(<SymbolFilter filters={makeFilters({ symbols: ["TCS"] })} setFilter={setFilter} />);

    const remove = screen.getByRole("button", { name: "Remove TCS" });
    expect(remove).toBeInTheDocument();

    remove.focus();
    expect(remove).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(setFilter).toHaveBeenCalledWith("symbols", []);
  });

  test("debounces search: rapid keystrokes fire one search for the final term", async () => {
    const setFilter = vi.fn();
    r(<SymbolFilter filters={makeFilters()} setFilter={setFilter} />);
    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    fireEvent.change(combo, { target: { value: "rel" } });
    fireEvent.change(combo, { target: { value: "reli" } });

    await screen.findByRole("option", { name: /RELIANCE/ });
    expect(searchSymbols).toHaveBeenCalledWith("reli", 20);
    expect(searchSymbols).not.toHaveBeenCalledWith("rel", 20);
  });

  test("does not search on mount or for an empty query", () => {
    r(<SymbolFilter filters={makeFilters()} setFilter={vi.fn()} />);
    expect(searchSymbols).not.toHaveBeenCalled();
  });

  test("selecting a second symbol appends (multi-select)", async () => {
    const user = userEvent.setup();
    searchSymbols.mockResolvedValue([
      { symbol: "RELIANCE", name: "Reliance Industries" },
      { symbol: "HDFCBANK", name: "HDFC Bank" },
    ]);
    const setFilter = vi.fn();
    r(<SymbolFilter filters={makeFilters({ symbols: ["TCS"] })} setFilter={setFilter} />);

    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    fireEvent.change(combo, { target: { value: "h" } });
    const option = await screen.findByRole("option", { name: /HDFCBANK/ });
    await user.click(option);

    await waitFor(() => expect(setFilter).toHaveBeenCalledWith("symbols", ["TCS", "HDFCBANK"]));
  });

  test("onChange override (scope mode) receives selections instead of setFilter", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    const onChange = vi.fn();
    r(<SymbolFilter filters={makeFilters()} setFilter={setFilter} onChange={onChange} />);

    const combo = within(screen.getByTestId("patterns-symbol-filter")).getByRole("combobox");
    fireEvent.change(combo, { target: { value: "reli" } });
    await user.click(await screen.findByRole("option", { name: /RELIANCE/ }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["RELIANCE"]));
    expect(setFilter).not.toHaveBeenCalled();
  });

  test("remove and clear route through onChange when provided", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    const onChange = vi.fn();
    r(
      <SymbolFilter
        filters={makeFilters({ symbols: ["TCS", "RELIANCE"] })}
        setFilter={setFilter}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove RELIANCE" }));
    expect(onChange).toHaveBeenCalledWith(["TCS"]);
    expect(setFilter).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("patterns-symbol-clear"));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(setFilter).not.toHaveBeenCalled();
  });

  test("clicking a chip remove drops just that symbol (default setFilter)", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    r(<SymbolFilter filters={makeFilters({ symbols: ["TCS", "RELIANCE"] })} setFilter={setFilter} />);

    await user.click(screen.getByRole("button", { name: "Remove RELIANCE" }));
    expect(setFilter).toHaveBeenCalledWith("symbols", ["TCS"]);
  });

  test("supports placeholder and helper text overrides", () => {
    r(
      <SymbolFilter
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
