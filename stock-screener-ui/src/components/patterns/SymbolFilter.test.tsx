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

  test("clearing empties selected symbols", async () => {
    const user = userEvent.setup();
    const setFilter = vi.fn();
    r(<SymbolFilter filters={makeFilters({ symbols: ["TCS"] })} setFilter={setFilter} />);

    expect(screen.getByTestId("patterns-symbol-chip-TCS")).toBeInTheDocument();

    await user.click(screen.getByTestId("patterns-symbol-clear"));

    expect(setFilter).toHaveBeenCalledWith("symbols", []);
  });
});
