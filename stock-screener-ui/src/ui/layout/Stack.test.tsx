// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Stack } from "./Stack";

describe("Stack", () => {
  test("is a vertical flex column by default and keeps its children in order", () => {
    render(() => (
      <Stack data-testid="stack" spacing="sm">
        <span>one</span>
        <span>two</span>
      </Stack>
    ));

    const stack = screen.getByTestId("stack");
    expect(stack).toHaveStyle("display: flex");
    expect(stack.style.flexDirection).toBe("column");
    expect(stack.style.gap).toBe("8px");
    expect([...stack.children].map((child) => child.textContent)).toEqual(["one", "two"]);
  });

  test("accepts horizontal direction, alignment and explicit gap overrides", () => {
    render(() => (
      <Stack
        data-testid="stack"
        direction="row-reverse"
        flexDirection="row"
        align="center"
        justify="flex-end"
        spacing={5}
        gap="lg"
      />
    ));

    const stack = screen.getByTestId("stack");
    expect(stack.style.flexDirection).toBe("row");
    expect(stack.style.alignItems).toBe("center");
    expect(stack.style.justifyContent).toBe("flex-end");
    expect(stack.style.gap).toBe("24px");
  });

  test("component selects a semantic element and forwards props and handlers", () => {
    const onClick = vi.fn();
    render(() => (
      <Stack
        component="section"
        id="panel"
        data-testid="stack"
        className="custom-stack"
        style={{ opacity: "0.8" }}
        aria-label="Panel"
        onClick={onClick}
      >
        content
      </Stack>
    ));

    const stack = screen.getByTestId("stack");
    expect(stack.tagName).toBe("SECTION");
    expect(stack.id).toBe("panel");
    expect(stack).toHaveClass("custom-stack");
    expect(stack).toHaveStyle("opacity: 0.8");
    expect(stack).toHaveAttribute("aria-label", "Panel");
    fireEvent.click(stack);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
