// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { MultiSelect, tagFoldCount } from "./MultiSelect";

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

