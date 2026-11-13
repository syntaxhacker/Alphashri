// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import { Accordion } from "./Accordion";

describe("Accordion", () => {
  test("controlled value changes reach the control, chevron and panel", () => {
    const [value, setValue] = createSignal<string | string[] | null>(null);

    render(() => (
      <Accordion value={value() as any} onChange={(next) => setValue(next as any)}>
        <Accordion.Item value="a">
          <Accordion.Control>Section A</Accordion.Control>
          <Accordion.Panel>Panel A</Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    ));

    const control = screen.getByRole("button", { name: /Section A/ });
    const panel = screen.getByText("Panel A");
    const chevron = control.querySelector("svg") as SVGElement;

    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveProperty("hidden", true);
    expect(chevron.style.transform).toBe("");

    setValue("a");

    expect(control).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveProperty("hidden", false);
    expect(chevron.style.transform).toBe("rotate(180deg)");
  });
});
