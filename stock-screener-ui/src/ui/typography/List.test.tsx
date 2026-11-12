// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { List } from "./List";

describe("List", () => {
  it("renders an unordered list by default", () => {
    render(() => (
      <List data-testid="lst">
        <List.Item>one</List.Item>
        <List.Item>two</List.Item>
      </List>
    ));
    expect(screen.getByTestId("lst").tagName).toBe("UL");
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });

  it("renders an ordered list when type=ordered", () => {
    render(() => (
      <List data-testid="lst" type="ordered">
        <List.Item>one</List.Item>
      </List>
    ));
    expect(screen.getByTestId("lst").tagName).toBe("OL");
  });

  it("adds left padding when withPadding is set", () => {
    render(() => <List data-testid="lst" withPadding />);
    expect(screen.getByTestId("lst")).toHaveStyle("padding-left: 24px");
  });

  it("applies size from the type scale", () => {
    render(() => <List data-testid="lst" size="sm" />);
    expect(screen.getByTestId("lst")).toHaveStyle("font-size: 0.875rem");
  });

  it("defaults unordered list marker to disc", () => {
    render(() => <List data-testid="lst" />);
    expect(screen.getByTestId("lst")).toHaveStyle("list-style-type: disc");
  });
});
