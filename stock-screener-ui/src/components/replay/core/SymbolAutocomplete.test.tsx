// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SymbolAutocomplete value="NETWEB" onChange={onChange} />);

    const input = screen.getByLabelText("Symbol");
    await user.clear(input);
    await user.type(input, "RELI");

    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("RELI", 10));

    const option = await screen.findByText("RELIANCE");
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith("RELIANCE");
  });
});
