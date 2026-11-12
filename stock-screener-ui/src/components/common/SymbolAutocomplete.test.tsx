// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";

const searchSymbols = vi.fn();
vi.mock("@/api/symbols", () => ({
  searchSymbols: (...args: unknown[]) => searchSymbols(...args),
}));

import SymbolAutocomplete from "./SymbolAutocomplete";

const optionTexts = () =>
  screen.queryAllByRole("option").map((o) => o.textContent ?? "");

beforeEach(() => {
  searchSymbols.mockReset();
  searchSymbols.mockResolvedValue([{ symbol: "RELIANCE", name: "Reliance Industries" }]);
});

describe("SymbolAutocomplete", () => {
  test("debounces the query and commits the selected symbol", async () => {
        const onChange = vi.fn();
    render(() => (<SymbolAutocomplete value="NETWEB" onChange={onChange} />));

    const input = screen.getByLabelText("Symbol");
    await fireEvent.input(input, { target: { value: "" } });
    await fireEvent.input(input, { target: { value: "RELI" } });

    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("RELI", 10));

    const option = await screen.findByText("RELIANCE");
    await fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith("RELIANCE");
  });

  test("keeps typed text after async options resolve", async () => {
        render(() => (<SymbolAutocomplete value="" onChange={vi.fn()} />));
    const input = screen.getByLabelText("Symbol");

    await fireEvent.input(screen.getByLabelText("Symbol"), { target: { value: "RELI" } });
    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("RELI", 10));
    await screen.findByText("RELIANCE");

    // Regression: the previous reset on options load used to wipe the uncontrolled input.
    expect(input).toHaveValue("RELI");
  });

  test("shows extra options when the input is empty", async () => {
        render(() => (<SymbolAutocomplete
        value=""
        onChange={vi.fn()}
        extraOptions={["NIFTY", "BANKNIFTY", "nifty"]}
      />),
    );

    await fireEvent.click(screen.getByLabelText("Symbol"));

    await waitFor(() => {
      const texts = optionTexts();
      expect(texts.some((t) => t.includes("NIFTY"))).toBe(true);
      expect(texts.some((t) => t.includes("BANKNIFTY"))).toBe(true);
    });
    // Case-insensitive dedupe keeps a single NIFTY row.
    expect(optionTexts().filter((t) => t.startsWith("NIFTY"))).toHaveLength(1);
  });

  test("filters extras by substring and appends API results", async () => {
        searchSymbols.mockResolvedValue([{ symbol: "TATASTEEL", name: "Tata Steel Limited" }]);
    render(() => (<SymbolAutocomplete
        value=""
        onChange={vi.fn()}
        extraOptions={["NIFTY", "TATA"]}
      />),
    );

    await fireEvent.input(screen.getByLabelText("Symbol"), { target: { value: "TATA" } });
    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("TATA", 10));
    await screen.findByText("TATASTEEL");

    const texts = optionTexts();
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("TATA");
    expect(texts[1]).toContain("TATASTEEL");
  });

  test("dedupes an API result that is already an extra option", async () => {
        searchSymbols.mockResolvedValue([{ symbol: "RELIANCE", name: "Reliance Industries" }]);
    render(() => (<SymbolAutocomplete
        value=""
        onChange={vi.fn()}
        extraOptions={["RELIANCE"]}
      />),
    );

    await fireEvent.input(screen.getByLabelText("Symbol"), { target: { value: "RELI" } });
    await waitFor(() => expect(searchSymbols).toHaveBeenCalledWith("RELI", 10));
    await screen.findByText("RELIANCE");

    expect(optionTexts().filter((t) => t.includes("RELIANCE"))).toHaveLength(1);
  });

  test("compact mode drops the floating label and uses a placeholder", () => {
    render(() => (<SymbolAutocomplete
        value="NIFTY"
        onChange={vi.fn()}
        extraOptions={["NIFTY"]}
        compact
        testid="compact-symbol"
      />),
    );

    expect(screen.queryByLabelText("Symbol")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Index or F&O stock")).toHaveValue("NIFTY");
    expect(screen.getByTestId("compact-symbol")).toBeInTheDocument();
  });

  test("selects a static extra option", async () => {
        const onChange = vi.fn();
    render(() => (<SymbolAutocomplete
        value=""
        onChange={onChange}
        extraOptions={["NIFTY", "BANKNIFTY"]}
        compact
      />),
    );

    await fireEvent.click(screen.getByPlaceholderText("Index or F&O stock"));
    await fireEvent.click(await screen.findByText("BANKNIFTY"));

    expect(onChange).toHaveBeenCalledWith("BANKNIFTY");
  });
});
