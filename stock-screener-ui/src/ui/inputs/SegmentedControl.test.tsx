// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl — view switch", () => {
  test("renders every item and one shared track", () => {
    render(() => <SegmentedControl data={["a", "b"]} defaultValue="a" data-testid="seg" />);
    const track = screen.getByTestId("seg");
    expect(track).toHaveAttribute("role", "group");
    expect(track.querySelectorAll("button")).toHaveLength(2);
  });

  test("the track is a 6px bordered rail and items are 4px", () => {
    render(() => <SegmentedControl data={["a", "b"]} data-testid="seg2" />);
    const track = screen.getByTestId("seg2");
    const item = track.querySelector("button") as HTMLButtonElement;
    expect(track.style.borderRadius).toBe("6px");
    expect(track.style.border).toContain("1px solid");
    expect(item.style.borderRadius).toBe("4px");
    expect(item.style.height).toBe("24px");
  });

  test("the active item is a filled inset block, the others are not", () => {
    render(() => <SegmentedControl value="b" data={["a", "b"]} data-testid="seg3" />);
    const [a, b] = [...screen.getByTestId("seg3").querySelectorAll("button")] as HTMLButtonElement[];
    expect(a).toHaveAttribute("aria-pressed", "false");
    expect(a.className).not.toContain("bg-fin-surface-alt");
    expect(b).toHaveAttribute("aria-pressed", "true");
    expect(b.className).toContain("bg-fin-surface-alt");
  });

  test("an uncontrolled selection moves aria-pressed after a click", () => {
    render(() => <SegmentedControl data={["a", "b"]} defaultValue="a" data-testid="seg4" />);
    const b = screen.getByRole("button", { name: "b" });
    expect(b).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(b);
    expect(b).toHaveAttribute("aria-pressed", "true");
  });

  test("reports the clicked value through onChange", () => {
    const onChange = vi.fn();
    render(() => <SegmentedControl data={["a", "b"]} onChange={onChange} data-testid="seg5" />);
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  test("a disabled item does not switch the view", () => {
    const onChange = vi.fn();
    render(() => (
      <SegmentedControl data={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta", disabled: true }]} onChange={onChange} data-testid="seg6" />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("re-reads data after mount", () => {
    const [data, setData] = createSignal<string[]>(["a", "b"]);
    render(() => <SegmentedControl data={data()} data-testid="seg7" />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    setData(["a", "b", "c"]);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
