// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import { Menu } from "./Menu";

describe("Menu.Label / Menu.Divider", () => {
  test("label children follow a signal", () => {
    const [label, setLabel] = createSignal("Alpha");

    render(() => <Menu.Label data-testid="menu-label">{label()}</Menu.Label>);

    expect(screen.getByTestId("menu-label").textContent).toBe("Alpha");
    setLabel("Beta");
    expect(screen.getByTestId("menu-label").textContent).toBe("Beta");
  });

  test("divider className follows a signal", () => {
    const [extra, setExtra] = createSignal("first");

    render(() => <Menu.Divider className={extra()} />);

    const divider = screen.getByRole("separator");
    expect(divider.className).toContain("first");
    setExtra("second");
    expect(divider.className).toContain("second");
    expect(divider.className).not.toContain("first");
  });
});
