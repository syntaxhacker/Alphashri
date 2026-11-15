// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { MultiSelect, tagFoldCount } from "./MultiSelect";

afterEach(cleanup);

describe("MultiSelect search handling", () => {
  test("forwards genuine typing to onSearchChange with reason 'input'", () => {
    const onSearchChange = vi.fn();
    render(() => (
      <MultiSelect
        data={[]}
        searchValue=""
        onSearchChange={onSearchChange}
        searchable
        placeholder="Search"
      />
    ));
    const box = screen.getByRole("combobox");
    (box as HTMLInputElement).value = "abc";
    fireEvent.input(box);
    expect(onSearchChange).toHaveBeenCalledWith("abc", "input");
  });

  test("does not forward the empty blur/reset (would wipe caller search state)", () => {
    const onSearchChange = vi.fn();
    render(() => (
      <MultiSelect
        data={[]}
        searchValue="abc"
        onSearchChange={onSearchChange}
        searchable
        placeholder="Search"
      />
    ));
    fireEvent.blur(screen.getByRole("combobox"));
    expect(onSearchChange).not.toHaveBeenCalledWith("", expect.anything());
    expect(onSearchChange).not.toHaveBeenCalledWith("", undefined);
  });

  test("keeps a selected chip when async options omit it", () => {
    const onChange = vi.fn();
    const [data, setData] = createSignal([{ value: "TCS", label: "TCS" }]);

    render(() => (
      <>
        <MultiSelect data={data()} value={["TCS"]} onChange={onChange} searchable />
        <button data-testid="switch" onClick={() => setData([{ value: "INFY", label: "INFY" }])} />
      </>
    ));
    expect(screen.getByText("TCS")).toBeInTheDocument();

    // New search page only returns INFY: the TCS chip must survive (union).
    fireEvent.click(screen.getByTestId("switch"));
    expect(screen.getByText("TCS")).toBeInTheDocument();
  });

  test("hideTags renders no inline selected tags", () => {
    render(() => (
      <MultiSelect
        data={[{ value: "BSE", label: "BSE" }]}
        value={["BSE"]}
        onChange={vi.fn()}
        hideTags
      />
    ));
    // The tag renders the selected label; with hideTags it must be absent.
    // (The "keeps a selected chip" test above is the positive control.)
    expect(screen.queryByText("BSE")).toBeNull();
  });
});

const SECTORS = [
  { value: "financials", label: "Financials" },
  { value: "it", label: "IT" },
  { value: "energy", label: "Energy" },
];

function SectorHarness(props: { onChange?: (v: string[]) => void }) {
  const [value, setValue] = createSignal<string[]>([]);
  return (
    <MultiSelect
      data={SECTORS}
      value={value()}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
      placeholder="All sectors"
      clearable
    />
  );
}

const listboxEl = () => document.querySelector<HTMLElement>('[data-part="multiselect-listbox"]');
const chipLabels = () =>
  [...document.querySelectorAll<HTMLElement>('[data-part="multiselect-tag"]')].map((c) => c.firstElementChild?.textContent ?? "");

function optionInput(label: string): HTMLInputElement {
  const row = [...document.querySelectorAll<HTMLElement>('li[role="option"]')].find((li) => li.textContent?.includes(label));
  if (!row) throw new Error(`option ${label} not rendered`);
  return row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

async function openMenu(): Promise<HTMLElement> {
  fireEvent.focus(screen.getByRole("combobox"));
  const menu = await screen.findByRole("listbox");
  return menu;
}

/**
 * The listbox is portalled to <body> so the filter rail's `overflow-y-auto`
 * cannot clip it. Outside-click detection used to test only the root, so a
 * mousedown inside the menu counted as "outside": the menu unmounted before the
 * checkbox's click could commit and the selection vanished.
 */
describe("MultiSelect — portalled listbox selection", () => {
  test("a mousedown inside the listbox does not dismiss it", async () => {
    render(() => <SectorHarness />);
    await openMenu();
    fireEvent.mouseDown(optionInput("Financials"));
    expect(listboxEl()).not.toBeNull();
  });

  test("selecting one option commits and renders a chip", async () => {
    const onChange = vi.fn();
    render(() => <SectorHarness onChange={onChange} />);
    await openMenu();
    fireEvent.mouseDown(optionInput("Financials"));
    fireEvent.click(optionInput("Financials"));
    expect(onChange).toHaveBeenCalledWith(["financials"]);
    expect(chipLabels()).toEqual(["Financials"]);
    expect(listboxEl()).not.toBeNull();
  });

  test("selecting a second option keeps the first selection", async () => {
    const onChange = vi.fn();
    render(() => <SectorHarness onChange={onChange} />);
    await openMenu();
    fireEvent.mouseDown(optionInput("Financials"));
    fireEvent.click(optionInput("Financials"));
    fireEvent.mouseDown(optionInput("Energy"));
    fireEvent.click(optionInput("Energy"));
    expect(onChange).toHaveBeenLastCalledWith(["financials", "energy"]);
    expect(chipLabels()).toEqual(["Financials", "Energy"]);
  });

  test("deselecting an option removes only that chip", async () => {
    const onChange = vi.fn();
    render(() => <SectorHarness onChange={onChange} />);
    await openMenu();
    for (const label of ["Financials", "Energy"]) {
      fireEvent.mouseDown(optionInput(label));
      fireEvent.click(optionInput(label));
    }
    fireEvent.mouseDown(optionInput("Financials"));
    fireEvent.click(optionInput("Financials"));
    expect(onChange).toHaveBeenLastCalledWith(["energy"]);
    expect(chipLabels()).toEqual(["Energy"]);
  });

  test("clicking outside the portal still closes the menu", async () => {
    render(() => <SectorHarness />);
    await openMenu();
    fireEvent.mouseDown(document.body);
    expect(listboxEl()).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("scrolling inside the listbox keeps it open", async () => {
    render(() => <SectorHarness />);
    await openMenu();
    fireEvent.scroll(listboxEl()!);
    expect(listboxEl()).not.toBeNull();
  });

  test("a menu orphaned by a detached trigger is cleared before another opens", async () => {
    // A rootless tree never disposes, so its portalled menu would otherwise sit
    // in <body> and answer queries for the next picker's options.
    const first = render(() => <SectorHarness />);
    await openMenu();
    first.container.remove();
    expect(listboxEl()).not.toBeNull();

    render(() => <SectorHarness />);
    await openMenu();
    expect(document.querySelectorAll('[data-part="multiselect-listbox"]').length).toBe(1);
  });
});

/**
 * The tag must live INSIDE the bordered field. Painting it above the box made it
 * read as a label instead of a selected value, which is the whole complaint.
 */
describe("MultiSelect — tag picker geometry", () => {
  test("renders the tags as descendants of the field root", () => {
    const { container } = render(() => (
      <MultiSelect
        data={[{ value: "NIFTY 50", label: "NIFTY 50" }]}
        value={["NIFTY 50"]}
        onChange={vi.fn()}
      />
    ));
    const field = container.querySelector('[data-part="multiselect-field"]')!;
    const tag = container.querySelector('[data-part="multiselect-tag"]')!;
    expect(field).not.toBeNull();
    expect(tag).not.toBeNull();
    expect(field.contains(tag)).toBe(true);
  });

  test("carries a chevron and a clear button when a value exists", () => {
    const { container } = render(() => (
      <MultiSelect
        data={[{ value: "BSE", label: "BSE" }]}
        value={["BSE"]}
        onChange={vi.fn()}
        clearable
      />
    ));
    expect(container.querySelector('[data-part="chevron"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeInTheDocument();
  });

  test("no clear button when the selection is empty", () => {
    render(() => <MultiSelect data={["BSE"]} value={[]} onChange={vi.fn()} clearable />);
    expect(screen.queryByRole("button", { name: "Clear selection" })).toBeNull();
  });

  test("keeps the placeholder visible in the empty field", () => {
    const { container } = render(() => (
      <MultiSelect data={["BSE"]} value={[]} onChange={vi.fn()} placeholder="Universes" />
    ));
    const combo = container.querySelector('[role="combobox"]') as HTMLInputElement;
    expect(combo.placeholder).toBe("Universes");
    expect(container.querySelector('[data-part="multiselect-tag"]')).toBeNull();
  });

  test("forwards aria-label to the combobox", () => {
    const { container } = render(() => (
      <MultiSelect data={["BSE"]} value={[]} onChange={vi.fn()} aria-label="Universes picker" />
    ));
    expect(container.querySelector('[role="combobox"]')).toHaveAttribute("aria-label", "Universes picker");
  });

  test("tagFoldCount folds only when the tags exceed the two-row ceiling", () => {
    // Three 57px tags in a 280px field: all fit on one row.
    expect(tagFoldCount([57, 57, 57], 280)).toBe(0);
    // The same tags in a 111px field: one per row, so two tags fit (the second
    // row also holds the +N chip) and the third folds.
    expect(tagFoldCount([57, 57, 57], 111)).toBe(1);
    expect(tagFoldCount([], 280)).toBe(0);
  });
});

