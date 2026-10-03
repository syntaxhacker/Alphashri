// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { MultiSelect } from "./MultiSelect";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("MultiSelect search handling", () => {
  afterEach(() => cleanup());

  test("forwards genuine typing to onSearchChange with reason 'input'", () => {
    const onSearchChange = vi.fn();
    r(
      <MultiSelect
        data={[]}
        searchValue=""
        onSearchChange={onSearchChange}
        searchable
        placeholder="Search"
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "abc" } });
    expect(onSearchChange).toHaveBeenCalledWith("abc", "input");
  });

  test("does not forward the empty blur/reset (would wipe caller search state)", () => {
    const onSearchChange = vi.fn();
    r(
      <MultiSelect
        data={[]}
        searchValue="abc"
        onSearchChange={onSearchChange}
        searchable
        placeholder="Search"
      />,
    );
    fireEvent.blur(screen.getByRole("combobox"));
    expect(onSearchChange).not.toHaveBeenCalledWith("", expect.anything());
    expect(onSearchChange).not.toHaveBeenCalledWith("", undefined);
  });

  test("keeps a selected chip when async options omit it", () => {
    const { rerender } = r(
      <MultiSelect data={[{ value: "TCS", label: "TCS" }]} value={["TCS"]} onChange={vi.fn()} searchable />,
    );
    expect(screen.getByText("TCS")).toBeInTheDocument();

    // New search page only returns INFY: the TCS chip must survive (union).
    rerender(
      <MultiSelect data={[{ value: "INFY", label: "INFY" }]} value={["TCS"]} onChange={vi.fn()} searchable />,
    );
    expect(screen.getByText("TCS")).toBeInTheDocument();
  });
});
