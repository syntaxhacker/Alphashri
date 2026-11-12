// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { MultiSelect } from "./MultiSelect";

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
    box.value = "abc";
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
