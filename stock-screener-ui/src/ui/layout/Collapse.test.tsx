// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { createSignal } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import { Collapse } from "./Collapse";

describe("Collapse", () => {
  test("height follows the `in` signal after mount", () => {
    const [open, setOpen] = createSignal(false);
    render(() => (
      <Collapse in={open()} data-testid="collapse">
        <div>content</div>
      </Collapse>
    ));
    const el = screen.getByTestId("collapse");
    expect(el.style.height).toBe("0px");
    expect(el).toHaveAttribute("aria-hidden", "true");

    setOpen(true);
    expect(el.style.height).toBe("auto");
    expect(el).toHaveAttribute("aria-hidden", "false");

    setOpen(false);
    expect(el.style.height).toBe("0px");
  });
});
