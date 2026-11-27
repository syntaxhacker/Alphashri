// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Select } from "./Select";
import { ToolbarRow } from "../layout/ToolbarRow";
import { CompactPanel } from "../../components/common/compact";
import type { UISelectProps } from "../types";

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

function UniverseHarness(props: { onChange?: (v: string | null) => void }) {
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

  // A single-select combobox supported aria-multiselectable="false" nowhere:
  // the attribute is only valid on the listbox role, so it was removed outright.
  test("neither the combobox nor the single-select listbox carries aria-multiselectable", async () => {
    render(() => <UniverseHarness />);
    await openMenu();

    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-multiselectable");
    expect(screen.getByRole("listbox")).not.toHaveAttribute("aria-multiselectable");
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

describe("Select — legacy props are outside the public type", () => {
  test("the swallowed Mantine props are rejected by UISelectProps", () => {
    const props: UISelectProps = { data: ["a"] };
    // @ts-expect-error allowDeselect is not a public Select prop
    expect(props.allowDeselect).toBeUndefined();
    // @ts-expect-error maxDropdownHeight is not a public Select prop
    expect(props.maxDropdownHeight).toBeUndefined();
    // @ts-expect-error comboboxProps is not a public Select prop
    expect(props.comboboxProps).toBeUndefined();
    // @ts-expect-error withinPortal is not public; the listbox is always portalled
    expect(props.withinPortal).toBeUndefined();
  });
});

const GROUPED_OPTIONS = [
  { value: "mom_1", label: "Momentum 1", group: "Momentum" },
  { value: "mom_2", label: "Momentum 2", group: "Momentum" },
  { value: "trend_1", label: "Trend 1", group: "Trend" },
  { value: "size_1", label: "Size 1", group: "Size" },
];

const headers = () => [...document.querySelectorAll<HTMLElement>('li[data-part="select-group-header"]')];
const highlightedText = () =>
  document.querySelector<HTMLElement>('li[role="option"].bg-fin-surface-alt')?.textContent?.trim();

/** Grouped options are a new capability; a row that has no header cannot be "skipped". */
describe("Select — grouped options", () => {
  test("(a) native <select> nests each group's options in an <optgroup label>", () => {
    const { container } = render(() => <Select data={GROUPED_OPTIONS} />);
    const groups = [...container.querySelectorAll("optgroup")];
    expect(groups.map((g) => g.getAttribute("label"))).toEqual(["Momentum", "Trend", "Size"]);
    expect([...groups[0].querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value)).toEqual([
      "mom_1",
      "mom_2",
    ]);
    expect([...groups[1].querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value)).toEqual(["trend_1"]);
    expect([...groups[2].querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value)).toEqual(["size_1"]);
    expect(container.querySelectorAll("select > option").length).toBe(0);
  });

  test("(b) listbox renders a non-selectable header, never role=option", async () => {
    render(() => <Select searchable data={GROUPED_OPTIONS} aria-label="Grouped" />);
    await openMenu();
    expect(headers().length).toBe(3);
    expect(headers().every((h) => h.getAttribute("role") === "presentation")).toBe(true);
    expect(headers().some((h) => h.getAttribute("role") === "option")).toBe(false);
    expect([...document.querySelectorAll('li[role="option"]')].length).toBe(4);
  });

  test("(c) ArrowDown from the last option of group A lands on the first of group B, skipping the header", async () => {
    const onChange = vi.fn();
    render(() => <Select searchable data={GROUPED_OPTIONS} onChange={onChange} aria-label="Grouped" />);
    const combo = screen.getByRole("combobox");
    fireEvent.focus(combo);
    await screen.findByRole("listbox");

    // The header has to exist as a non-option row — otherwise "skipping" it is vacuous.
    expect(headers().map((h) => h.textContent?.trim())).toEqual(["Momentum", "Trend", "Size"]);

    fireEvent.keyDown(combo, { key: "ArrowDown" });
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    expect(highlightedText()).toBe("Momentum 2"); // last option of group A

    fireEvent.keyDown(combo, { key: "ArrowDown" });
    expect(highlightedText()).toBe("Trend 1"); // first option of group B, header skipped

    fireEvent.keyDown(combo, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("trend_1");
  });

  test("(d) a search matching only group B drops group A's now-empty header", async () => {
    render(() => <Select searchable data={GROUPED_OPTIONS} aria-label="Grouped" />);
    const combo = screen.getByRole("combobox");
    fireEvent.focus(combo);
    await screen.findByRole("listbox");
    (combo as HTMLInputElement).value = "trend";
    fireEvent.input(combo);
    expect(headers().map((h) => h.textContent?.trim())).toEqual(["Trend"]);
    expect([...document.querySelectorAll('li[role="option"]')].map((li) => li.textContent?.trim())).toEqual([
      "Trend 1",
    ]);
  });

  test("(e) ungrouped callers keep the original DOM shape — same options, no optgroup or header", async () => {
    const native = render(() => <Select data={UNIVERSES} />);
    expect([...native.container.querySelectorAll("select option")].map((o) => o.textContent?.trim())).toEqual([
      "All NSE",
      "Nifty 500",
      "Nifty 50",
    ]);
    expect(native.container.querySelectorAll("optgroup").length).toBe(0);
    native.unmount();

    render(() => <Select searchable data={UNIVERSES} aria-label="Ungrouped universe" />);
    await openMenu();
    const rows = [...document.querySelectorAll<HTMLElement>('li[role="option"]')];
    expect(rows.map((r) => r.textContent?.trim())).toEqual(["All NSE", "Nifty 500", "Nifty 50"]);
    expect(rows[0].className).toBe("px-3 py-2 text-xs cursor-pointer select-none");
    expect(headers().length).toBe(0);
  });
});

/**
 * Solid writes `value={expr}` on a native <select> as a property, but its
 * generated effect tracks only that expression — not the option list. A value
 * arriving after the options, options rebuilt after the value, or an unmatched
 * value (which the browser turns into a blank selection) all need the Select
 * itself to move `el.value`.
 */
describe("Select — controlled value follows the signal", () => {
  test("initial controlled value selects a non-first option", () => {
    render(() => <Select data={["", "a", "b"]} value="b" data-testid="initial-value" />);
    const select = screen
      .getByTestId("initial-value")
      .querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("b");
    expect(select.selectedOptions[0]?.textContent).toBe("b");
  });

  test("nested-in-row controlled value follows the signal", async () => {
    const [value, setValue] = createSignal("");
    render(() => (
      <CompactPanel>
        <ToolbarRow>
          <Select data={["", "a", "b"]} value={value()} data-testid="nested-value" />
        </ToolbarRow>
      </CompactPanel>
    ));
    const select = screen.getByTestId("nested-value").querySelector("select") as HTMLSelectElement;
    setValue("b");
    await waitFor(() => expect(select.value).toBe("b"));
  });
  const native = (testId: string) =>
    screen.getByTestId(testId).querySelector("select") as HTMLSelectElement;

  test("(a) a value that arrives after the options render selects the right option", async () => {
    const [value, setValue] = createSignal<string | null>(null);
    render(() => <Select data={["a", "b", "c"]} value={value()} data-testid="late-value" />);
    const select = native("late-value");
    expect(select.options.length).toBe(3);

    setValue("c");
    await waitFor(() => expect(select.selectedIndex).toBe(2));
    expect(select.value).toBe("c");
  });

  test("(b) changing the value prop moves the DOM selection", async () => {
    const [value, setValue] = createSignal("a");
    render(() => <Select data={["a", "b", "c"]} value={value()} data-testid="move-value" />);
    const select = native("move-value");
    expect(select.value).toBe("a");

    setValue("b");
    await waitFor(() => expect(select.value).toBe("b"));
    expect(select.selectedIndex).toBe(1);
  });

  test("(c) a value with no matching option leaves the selection alone", async () => {
    const [value, setValue] = createSignal("b");
    render(() => <Select data={["a", "b"]} value={value()} data-testid="guard-value" />);
    const select = native("guard-value");
    expect(select.value).toBe("b");

    setValue("no-such-option");
    await waitFor(() => expect(select.value).toBe("b"));
    expect(select.selectedIndex).toBe(1);

    // The guard must not freeze the control: a later valid value still applies.
    setValue("a");
    await waitFor(() => expect(select.value).toBe("a"));
  });

  test("(d) the uncontrolled defaultValue path is unchanged", () => {
    const onChange = vi.fn();
    render(() => (
      <Select
        data={["a", "b", "c"]}
        defaultValue="b"
        onChange={onChange}
        data-testid="uncontrolled-value"
      />
    ));
    const select = native("uncontrolled-value");
    expect(select.value).toBe("b");

    fireEvent.input(select, { target: { value: "c" } });
    expect(select.value).toBe("c");
    expect(onChange).toHaveBeenCalledWith("c");
  });

  test("(e) a controlled value survives a rebuilt option list", async () => {
    const [data, setData] = createSignal(["a", "b"]);
    render(() => <Select data={data()} value="b" data-testid="rebuilt-value" />);
    const select = native("rebuilt-value");
    expect(select.value).toBe("b");

    // Solid's <For> is keyed by reference: a fresh array replaces every option
    // node, and the browser falls back to option 0 unless we re-apply the value.
    setData(["x", "b", "y"]);
    await waitFor(() => expect(select.value).toBe("b"));
    expect(select.selectedIndex).toBe(1);
  });
});

describe("Select — form error accessibility", () => {
  test("a string error is associated with the native select", () => {
    render(() => <Select data-testid="sel" id="universe" data={["a"]} error="Pick a universe" />);
    const select = screen.getByTestId("sel").querySelector("select")!;
    const message = screen.getByText("Pick a universe");

    expect(message.id).toBe("universe-error");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAttribute("aria-describedby", message.id);
  });

  test("a JSX error renders as elements, never [object Object]", () => {
    const { container } = render(() => (
      <Select
        data-testid="sel"
        id="universe"
        data={["a"]}
        error={<span data-testid="jsx-error"><b>Invalid</b> universe</span>}
      />
    ));
    const select = screen.getByTestId("sel").querySelector("select")!;

    expect(screen.getByTestId("jsx-error").querySelector("b")).not.toBeNull();
    expect(container.textContent).not.toContain("[object Object]");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAttribute("aria-describedby", "universe-error");
  });

  test("the searchable combobox gets the same error wiring and keeps working", async () => {
    render(() => (
      <Select searchable data-testid="sel" id="universe" data={["a", "b"]} error="Pick a universe" />
    ));
    const combo = screen.getByTestId("sel").querySelector('[role="combobox"]')!;

    expect(combo).toHaveAttribute("aria-invalid", "true");
    expect(combo).toHaveAttribute("aria-describedby", "universe-error");
    fireEvent.focus(combo);
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(combo).toHaveAttribute("aria-expanded", "true");
  });

  test("a description is described by the select with aria-invalid false", () => {
    render(() => <Select data-testid="sel" id="universe" data={["a"]} description="Choose one" />);
    const select = screen.getByTestId("sel").querySelector("select")!;

    expect(select).toHaveAttribute("aria-invalid", "false");
    expect(select).toHaveAttribute("aria-describedby", "universe-error");
    expect(screen.getByText("Choose one")).toHaveAttribute("id", "universe-error");
  });
});
