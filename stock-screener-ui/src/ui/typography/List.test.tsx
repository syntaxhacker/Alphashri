// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { List } from "./List";
import { TYPE_CLASS } from "../typography";

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

  it.each([
    ["xs", TYPE_CLASS.micro],
    ["sm", TYPE_CLASS.label],
    ["md", TYPE_CLASS.title],
    ["lg", TYPE_CLASS.heading],
    ["xl", TYPE_CLASS.heading],
  ] as const)("maps size=%s to token class %s with no inline font-size", (size, tokenClass) => {
    const testId = `lst-${size}`;
    render(() => <List data-testid={testId} size={size} />);
    const el = screen.getByTestId(testId);
    expect(el).toHaveClass(tokenClass);
    expect(el.style.fontSize).toBe("");
  });

  it("defaults unordered list marker to disc", () => {
    render(() => <List data-testid="lst" />);
    expect(screen.getByTestId("lst")).toHaveStyle("list-style-type: disc");
  });

  it("separates a list icon from its text", () => {
    render(() => (
      <List data-testid="lst">
        <List.Item icon={<span>01</span>}>One source of truth</List.Item>
      </List>
    ));
    const icon = screen.getByText("01").parentElement as HTMLElement;
    expect(icon.style.marginRight).toBe("8px");
  });
});
