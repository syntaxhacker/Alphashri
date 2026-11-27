// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";

const searchSymbols = vi.fn();
vi.mock("@/api/symbols", () => ({
  searchSymbols: (...args: unknown[]) => searchSymbols(...args),
}));

import SymbolAutocomplete, { placeMenuBox, type BoxRect } from "./SymbolAutocomplete";

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

    await fireEvent.focus(screen.getByLabelText("Symbol"));

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

    await fireEvent.focus(screen.getByPlaceholderText("Index or F&O stock"));
    await fireEvent.click(await screen.findByText("BANKNIFTY"));

    expect(onChange).toHaveBeenCalledWith("BANKNIFTY");
  });
});

const listbox = () => document.querySelector<HTMLElement>('[data-part="symbol-autocomplete-list"]');

/**
 * Both consumers render the field inside an `overflow:hidden` band (the
 * simulator header, the replay cards). An `absolute` child of the field is cut
 * off at that edge — the same defect that forced Select/MultiSelect to portal.
 */
describe("SymbolAutocomplete — portalled list", () => {
  test("renders the list outside the field subtree and positions it fixed", async () => {
    const { container } = render(() => (
      <div style={{ overflow: "hidden" }}>
        <SymbolAutocomplete value="" onChange={vi.fn()} extraOptions={["NIFTY"]} />
      </div>
    ));

    await fireEvent.focus(screen.getByLabelText("Symbol"));
    await screen.findByText("NIFTY");

    const list = listbox()!;
    expect(container.contains(list)).toBe(false);
    expect(list.style.position).toBe("fixed");
  });

  test("a mousedown inside the list does not dismiss it, and the option still commits", async () => {
    const onChange = vi.fn();
    render(() => (<SymbolAutocomplete value="" onChange={onChange} extraOptions={["NIFTY", "BANKNIFTY"]} />));

    await fireEvent.focus(screen.getByLabelText("Symbol"));
    const option = await screen.findByText("BANKNIFTY");

    fireEvent.mouseDown(option);
    expect(listbox()).not.toBeNull();

    // A real pointer presses before it clicks; the value must survive the
    // mousedown that (correctly) does not dismiss the list.
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("BANKNIFTY");
    expect(listbox()).toBeNull();
  });

  test("an outside mousedown closes the list", async () => {
    render(() => (<SymbolAutocomplete value="" onChange={vi.fn()} extraOptions={["NIFTY"]} />));

    await fireEvent.focus(screen.getByLabelText("Symbol"));
    await screen.findByText("NIFTY");
    expect(listbox()).not.toBeNull();

    fireEvent.mouseDown(document.body);
    expect(listbox()).toBeNull();
  });

  test("keyboard: Escape closes, Enter commits the typed text (unchanged behaviour)", async () => {
    const onChange = vi.fn();
    render(() => (<SymbolAutocomplete value="" onChange={onChange} extraOptions={["NIFTY", "BANKNIFTY"]} />));

    const input = screen.getByLabelText("Symbol");
    fireEvent.focus(input);
    await screen.findByText("NIFTY");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(listbox()).toBeNull();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  test("Enter commits a mouse-highlighted option", async () => {
    const onChange = vi.fn();
    render(() => (<SymbolAutocomplete value="" onChange={onChange} extraOptions={["NIFTY", "BANKNIFTY"]} />));

    const input = screen.getByLabelText("Symbol");
    fireEvent.focus(input);
    const row = await screen.findByRole("option", { name: /BANKNIFTY/ });

    fireEvent.mouseEnter(row);
    expect(row).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("BANKNIFTY");
    expect(listbox()).toBeNull();
  });

  test("a list orphaned by a detached field is cleared before another opens", async () => {
    // A never-disposed tree would leave its portalled list in <body> answering
    // queries for the next field's options.
    const first = render(() => (<SymbolAutocomplete value="" onChange={vi.fn()} extraOptions={["NIFTY"]} />));
    await fireEvent.focus(screen.getByLabelText("Symbol"));
    await screen.findByText("NIFTY");
    first.container.remove();
    expect(listbox()).not.toBeNull();

    render(() => (<SymbolAutocomplete value="" onChange={vi.fn()} extraOptions={["NIFTY"]} />));
    await fireEvent.focus(screen.getByLabelText("Symbol"));
    await screen.findByText("NIFTY");
    expect(document.querySelectorAll('[data-part="symbol-autocomplete-list"]').length).toBe(1);
  });

  test("withinPortal={false} keeps the inline absolute list", async () => {
    const { container } = render(() => (
      <SymbolAutocomplete value="" onChange={vi.fn()} extraOptions={["NIFTY"]} withinPortal={false} />
    ));

    await fireEvent.focus(screen.getByLabelText("Symbol"));
    await screen.findByText("NIFTY");

    const list = listbox()!;
    expect(container.contains(list)).toBe(true);
    expect(list.style.position).toBe("absolute");
  });
});

/**
 * Geometry cannot be measured in happy-dom (every rect is zero), so the
 * placement maths is asserted directly. A real browser is still needed for the
 * rendered rects — see the report.
 */
describe("placeMenuBox", () => {
  const viewport = { width: 1200, height: 800 };
  const fieldAt = (top: number, bottom: number, left = 200, width = 220): BoxRect => ({ top, bottom, left, width });

  test("opens below the field at the field's width when there is room", () => {
    const p = placeMenuBox(fieldAt(100, 124), 0, viewport, 220);
    expect(p.top).toBe(128);
    expect(p.left).toBe(200);
    expect(p.width).toBe(220);
    expect(p.maxHeight).toBe(240);
  });

  test("flips above when the field sits near the bottom edge", () => {
    const p = placeMenuBox(fieldAt(740, 764), 240, viewport, 220);
    expect(p.top).toBe(496);
    // Never above the 8px gutter even with a flipped 240px list.
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + 240).toBeLessThanOrEqual(764);
  });

  test("clamps to the right gutter instead of overflowing the viewport", () => {
    const p = placeMenuBox(fieldAt(100, 124, 1150, 220), 0, viewport, 220);
    expect(p.left).toBe(1200 - 220 - 8);
    expect(p.left + p.width!).toBeLessThanOrEqual(1200 - 8);
  });

  test("shrinks the list height when neither side fits the full 240px", () => {
    // A short viewport: 168px below and 92px above. The list must stay below and
    // shrink, never render at 240px and hang off the bottom edge.
    const p = placeMenuBox(fieldAt(100, 124), 240, { width: 1200, height: 300 }, 220);
    expect(p.maxHeight).toBeLessThan(240);
    expect(p.maxHeight).toBeLessThanOrEqual(300 - 124 - 8);
    expect(p.top).toBe(128);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(300 - 8);
  });

  test("an unmeasurable field yields no width rather than a zero-width list", () => {
    const p = placeMenuBox({ top: 0, bottom: 0, left: 0, width: 0 }, 0, viewport, 220);
    expect(p.width).toBeUndefined();
  });
});
