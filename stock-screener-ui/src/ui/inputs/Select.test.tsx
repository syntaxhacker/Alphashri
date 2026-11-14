// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import * as palette from "../palette";
import { Select } from "./Select";

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
    expect((container.querySelector("select") as HTMLSelectElement).style.color).toBe(palette.TEXT);
    unmount();

    const { container: empty } = render(() => <Select data={["a"]} placeholder="Pick" value={null} />);
    expect((empty.querySelector("select") as HTMLSelectElement).style.color).toBe(palette.TEXT_MUTED);
  });

  test("the searchable variant also carries a chevron", () => {
    render(() => <Select searchable data={["a"]} data-testid="sel3" />);
    const combo = screen.getByTestId("sel3").querySelector('[role="combobox"]')!;
    expect(combo.parentElement!.querySelector('[data-part="chevron"]')).not.toBeNull();
  });
});
