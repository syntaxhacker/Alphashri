// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { Select } from "./Select";

afterEach(cleanup);

/**
 * The dropdown tell: a select must carry a chevron and a box that differs from
 * `TextInput` (which is 2px radius, no glyph). Colour alone is not enough — a
 * monochrome render has to communicate "this opens a list".
 */
describe("Select — reads as a dropdown", () => {
  test("renders a chevron inside the field", () => {
    render(() => <Select data={["a", "b"]} value="a" data-testid="sel" />);
    const root = screen.getByTestId("sel");
    const select = root.querySelector("select")!;
    const chevron = select.parentElement!.querySelector('[data-part="chevron"]');
    expect(chevron).not.toBeNull();
    expect(chevron!.closest("div")).toBe(select.parentElement);
  });

  test("applies a 6px radius field with a 34px default height", () => {
    render(() => <Select data={["a"]} data-testid="sel2" />);
    const select = screen.getByTestId("sel2").querySelector("select")!;
    expect(select.style.borderRadius).toBe("6px");
    expect(select.style.height).toBe("34px");
  });

  test("uses the size height map xs 24 / sm 30 / md 34", () => {
    for (const [size, expected] of [["xs", "24px"], ["sm", "30px"], ["md", "34px"]] as const) {
      const { container, unmount } = render(() => <Select data={["a"]} size={size} />);
      expect((container.querySelector("select") as HTMLSelectElement).style.height).toBe(expected);
      unmount();
    }
  });

  test("paints the selected value in TEXT and the placeholder in TEXT_MUTED", () => {
    const { container, unmount } = render(() => <Select data={["a"]} value="a" />);
    expect((container.querySelector("select") as HTMLSelectElement).style.color).toBe("var(--color-fin-text)");
    unmount();

    const { container: empty } = render(() => <Select data={["a"]} placeholder="Pick" value={null} />);
    expect((empty.querySelector("select") as HTMLSelectElement).style.color).toBe("var(--color-fin-text-muted)");
  });

  test("the searchable variant also carries a chevron", () => {
    render(() => <Select searchable data={["a"]} data-testid="sel3" />);
    const combo = screen.getByTestId("sel3").querySelector('[role="combobox"]')!;
    expect(combo.parentElement!.querySelector('[data-part="chevron"]')).not.toBeNull();
  });
});

const UNIVERSES = [
  { value: "all_equity", label: "All NSE" },
  { value: "nifty500", label: "Nifty 500" },
  { value: "nifty50", label: "Nifty 50" },
];

function UniverseHarness(props: { onChange?: (v: string | null) => void; withinPortal?: boolean }) {
  const [value, setValue] = createSignal<string | null>(null);
  return (
    <Select
      searchable
      data={UNIVERSES}
      value={value()}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
      withinPortal={props.withinPortal}
      aria-label="Universe"
      placeholder="Universe"
    />
  );
}

const listboxEl = () => document.querySelector<HTMLElement>('[data-part="select-listbox"]');

function option(label: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('li[role="option"]')].find((li) => li.textContent?.trim() === label);
  if (!row) throw new Error(`option ${label} not rendered`);
  return row;
}

async function openMenu(): Promise<HTMLElement> {
  fireEvent.focus(screen.getByRole("combobox"));
  return screen.findByRole("listbox");
}

/**
 * The listbox is portalled to <body> and `fixed`. It used to be an `absolute`
 * child of the field, so the market toolbar's `overflow-hidden` cut the
 * universe list off at the field's height. Portalling moved the list outside
 * the root, and the outside-click handler only tested the root: a mousedown on
 * an option counted as "outside" and unmounted the list before the value was
 * committed. Geometry needs a real browser (see the report); the containment
 * and commit paths are asserted here.
 */
describe("Select — portalled listbox (searchable)", () => {
  test("renders the listbox outside the field's container, not clipped by it", async () => {
    const { container } = render(() => <UniverseHarness />);
    const menu = await openMenu();
    expect(container.contains(menu)).toBe(false);
    expect(menu.classList.contains("fixed")).toBe(true);
    expect(menu.classList.contains("absolute")).toBe(false);
  });

  test("selecting an option calls onChange with its value (mousedown + click)", async () => {
    const onChange = vi.fn();
    render(() => <UniverseHarness onChange={onChange} />);
    await openMenu();
    const row = option("Nifty 500");
    // A real pointer presses before it clicks; the value must survive the
    // mousedown that (correctly) dismisses the menu.
    fireEvent.mouseDown(row);
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("nifty500");
    expect(screen.getByRole("combobox")).toHaveValue("Nifty 500");
  });

  test("a mousedown inside the listbox does not dismiss it", async () => {
    render(() => <UniverseHarness />);
    const menu = await openMenu();
    fireEvent.mouseDown(menu);
    expect(listboxEl()).not.toBeNull();
  });

  test("scrolling inside the listbox keeps it open", async () => {
    render(() => <UniverseHarness />);
    const menu = await openMenu();
    fireEvent.scroll(menu);
    expect(listboxEl()).not.toBeNull();
  });

  test("clicking outside closes it", async () => {
    render(() => <UniverseHarness />);
    await openMenu();
    fireEvent.mouseDown(document.body);
    expect(listboxEl()).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("the query narrows the list and Enter commits the highlighted option", async () => {
    const onChange = vi.fn();
    render(() => <UniverseHarness onChange={onChange} />);
    const combo = screen.getByRole("combobox");
    fireEvent.focus(combo);
    (combo as HTMLInputElement).value = "50";
    fireEvent.input(combo);
    await screen.findByRole("listbox");
    expect([...document.querySelectorAll('li[role="option"]')].map((li) => li.textContent)).toEqual([
      "Nifty 500",
      "Nifty 50",
    ]);
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("nifty500");
    expect(listboxEl()).toBeNull();
  });
});

describe("Select — withinPortal={false} keeps the inline listbox", () => {
  test("renders the listbox inside the field container with absolute positioning", async () => {
    const { container } = render(() => <UniverseHarness withinPortal={false} />);
    const menu = await openMenu();
    expect(container.contains(menu)).toBe(true);
    expect(menu.classList.contains("absolute")).toBe(true);
    expect(menu.classList.contains("fixed")).toBe(false);
  });

  test("still commits on mousedown", async () => {
    const onChange = vi.fn();
    render(() => <UniverseHarness onChange={onChange} withinPortal={false} />);
    await openMenu();
    const row = option("Nifty 50");
    fireEvent.mouseDown(row);
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith("nifty50");
  });
});
