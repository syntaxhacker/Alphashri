// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Divider } from "./Divider";

describe("Divider", () => {
  test("defaults to a horizontal rule with the separator role", () => {
    render(() => <Divider id="rule" data-testid="rule" className="my-rule" aria-label="Section break" />);

    const rule = screen.getByTestId("rule");
    expect(rule.tagName).toBe("HR");
    expect(rule).toHaveClass("border-fin-border", "my-rule");
    expect(rule.id).toBe("rule");
    expect(rule).toHaveAttribute("aria-label", "Section break");
    expect(screen.getByRole("separator", { name: "Section break" })).toBe(rule);
  });

  test("vertical orientation is an explicitly oriented separator, not a rule", () => {
    render(() => (
      <Divider orientation="vertical" data-testid="rule" label="column break" />
    ));

    const rule = screen.getByTestId("rule");
    expect(rule.tagName).toBe("DIV");
    expect(rule).toHaveAttribute("role", "separator");
    expect(rule).toHaveAttribute("aria-orientation", "vertical");
    expect(rule).toHaveClass("h-full", "border-r");
    expect(rule).toHaveTextContent("column break");
    // Orientation and the Mantine compatibility props must not leak to the DOM.
    expect(rule).not.toHaveAttribute("orientation");
    expect(rule).not.toHaveAttribute("labelPosition");
    expect(rule).not.toHaveAttribute("size");
    expect(rule).not.toHaveAttribute("color");
  });

  test("a horizontal divider shows its label", () => {
    render(() => <Divider data-testid="rule" label="Input row" labelPosition="left" />);

    const rule = screen.getByTestId("rule");
    expect(rule).toHaveAttribute("role", "separator");
    expect(rule).toHaveTextContent("Input row");
    expect(rule).not.toHaveAttribute("aria-orientation", "vertical");
  });

  test("vertical dividers render children when no label is supplied", () => {
    render(() => (
      <Divider orientation="vertical" data-testid="rule">
        <span data-testid="child">rail</span>
      </Divider>
    ));

    const rule = screen.getByTestId("rule");
    expect(rule).toContainElement(screen.getByTestId("child"));
    expect(rule.textContent).toBe("rail");
  });
});
