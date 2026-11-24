// @vitest-environment happy-dom
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { Center } from "./Center";

describe("Center", () => {
  it("centres its children with flex alignment", () => {
    render(() => (
      <Center data-testid="center">
        <span data-testid="child">body</span>
      </Center>
    ));

    const center = screen.getByTestId("center");
    expect(center).toHaveClass("flex", "items-center", "justify-center");
    expect(center).not.toHaveClass("inline-flex");
    expect(center).toContainElement(screen.getByTestId("child"));
  });

  it("inline swaps flex for inline-flex without leaking the prop", () => {
    render(() => (
      <Center inline data-testid="center">
        content
      </Center>
    ));

    const center = screen.getByTestId("center");
    expect(center).toHaveClass("inline-flex", "items-center", "justify-center");
    expect(center).not.toHaveClass("flex");
    expect(center).not.toHaveAttribute("inline");
  });

  it("forwards identity props, caller class and caller style", () => {
    render(() => (
      <Center
        id="hero-center"
        data-testid="center"
        className="mx-auto gap-2"
        style={{ "background-color": "var(--color-fin-surface)", width: "120px" }}
      >
        content
      </Center>
    ));

    const center = screen.getByTestId("center");
    expect(center.id).toBe("hero-center");
    expect(center).toHaveClass("mx-auto", "gap-2");
    expect(center.style.backgroundColor).toBe("var(--color-fin-surface)");
    expect(center.style.width).toBe("120px");
  });

  it("spreads unknown attributes onto the host element", () => {
    render(() => <Center data-testid="center" role="region" aria-label="Loading area" />);

    const center = screen.getByTestId("center");
    expect(center).toHaveAttribute("role", "region");
    expect(center).toHaveAttribute("aria-label", "Loading area");
    expect(center).not.toHaveAttribute("className");
  });
});
