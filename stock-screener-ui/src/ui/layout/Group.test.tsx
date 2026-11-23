// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Group } from "./Group";

describe("Group", () => {
  test("is a wrapping flex row by default and keeps its children", () => {
    render(() => (
      <Group data-testid="group" spacing="xs">
        <span>alpha</span>
        <span>beta</span>
      </Group>
    ));

    const group = screen.getByTestId("group");
    expect(group).toHaveStyle("display: flex");
    expect(group.style.flexDirection).toBe("row");
    expect(group.style.flexWrap).toBe("wrap");
    expect(group.style.gap).toBe("4px");
    expect([...group.children].map((child) => child.textContent)).toEqual(["alpha", "beta"]);
  });

  test("supports nowrap, column direction and alignment overrides", () => {
    render(() => (
      <Group
        data-testid="group"
        direction="column"
        wrap="nowrap"
        align="flex-end"
        justify="space-between"
        gap="md"
        spacing={9}
      />
    ));

    const group = screen.getByTestId("group");
    expect(group.style.flexDirection).toBe("column");
    expect(group.style.flexWrap).toBe("nowrap");
    expect(group.style.alignItems).toBe("flex-end");
    expect(group.style.justifyContent).toBe("space-between");
    expect(group.style.gap).toBe("16px");
  });

  test("does not paint layout-only props onto the element", () => {
    render(() => (
      <Group data-testid="group" grow preventGrowOverflow role="group" aria-label="Toolbar" />
    ));

    const group = screen.getByTestId("group");
    expect(group).toHaveAttribute("role", "group");
    expect(group).toHaveAttribute("aria-label", "Toolbar");
    expect(group).not.toHaveAttribute("grow");
    expect(group).not.toHaveAttribute("preventGrowOverflow");
    expect(group).not.toHaveAttribute("spacing");
  });

  test("component selects a semantic element and forwards identity, style and clicks", () => {
    const onClick = vi.fn();
    render(() => (
      <Group
        component="nav"
        data-testid="group"
        className="my-group"
        style={{ "margin-top": "6px" }}
        onClick={onClick}
      >
        nav item
      </Group>
    ));

    const group = screen.getByTestId("group");
    expect(group.tagName).toBe("NAV");
    expect(group).toHaveClass("my-group");
    expect(group.style.marginTop).toBe("6px");
    expect(group).toHaveTextContent("nav item");
    fireEvent.click(group);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
