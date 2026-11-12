// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";

const searchSymbols = vi.fn();
vi.mock("@/api/symbols", () => ({
  searchSymbols: (...args: unknown[]) => searchSymbols(...args),
}));

import SymbolAutocomplete from "./SymbolAutocomplete";

beforeEach(() => {
  searchSymbols.mockReset();
  searchSymbols.mockResolvedValue([{ symbol: "RELIANCE", name: "Reliance Industries" }]);
});

describe("SymbolAutocomplete", () => {
  test("debounces the query and commits the selected symbol", async () => {
    const onChange = vi.fn();
    render(() => <SymbolAutocomplete value="NETWEB" onChange={onChange} />);

    const input = screen.getByLabelText("Symbol");
    await fireEvent.input(input);
    await fireEvent.input(input, "RELI");

    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("RELI", 10));

    const option = await screen.findByText("RELIANCE");
    await fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith("RELIANCE");
  });

  test("keeps typed text after async options resolve", async () => {
    render(() => <SymbolAutocomplete value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Symbol");

    await fireEvent.input(input, "RELI");
    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("RELI", 10));
    await screen.findByText("RELIANCE");

    // Regression: the previous reset on options load used to wipe the uncontrolled input.
    expect(input).toHaveValue("RELI");
  });

  test("syncs the input to an external value change", () => {
    const { rerender } = render(() => <SymbolAutocomplete value="NETWEB" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Symbol")).toHaveValue("NETWEB");

    rerender(<SymbolAutocomplete value="INFY" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Symbol")).toHaveValue("INFY");
  });
});
