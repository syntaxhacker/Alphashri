// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Text } from "./Text";
import { TYPE_CLASS, TYPE_SCALE } from "../typography";

describe("Text", () => {
  it("renders children as a paragraph by default", () => {
    render(() => <Text data-testid="t">hello</Text>);
    const el = screen.getByTestId("t");
    expect(el.tagName).toBe("P");
    expect(el).toHaveTextContent("hello");
  });

  it("renders as a span when span is set", () => {
    render(() => <Text data-testid="t" span>inline</Text>);
    expect(screen.getByTestId("t").tagName).toBe("SPAN");
  });

  it("applies a tone via a colour token, not a baked-in hex", () => {
    render(() => <Text data-testid="t" c="success">up</Text>);
    const el = screen.getByTestId("t");
    expect(el).toHaveClass("text-fin-positive");
    expect(el.getAttribute("style") ?? "").not.toContain("color:");
  });

  it.each([
    ["xs", TYPE_CLASS.micro],
    ["sm", TYPE_CLASS.label],
    ["md", TYPE_CLASS.title],
    ["lg", TYPE_CLASS.heading],
    ["xl", TYPE_CLASS.heading],
  ] as const)("maps size=%s to token class %s with no inline font-size", (size, tokenClass) => {
    const testId = `t-${size}`;
    render(() => <Text data-testid={testId} size={size}>sized</Text>);
    const el = screen.getByTestId(testId);
    expect(el).toHaveClass(tokenClass);
    expect(el.style.fontSize).toBe("");
  });

  it("has no 18px step and keeps the 12px floor", () => {
    const sizes = Object.values(TYPE_SCALE).map((s) => s.size);
    expect(sizes).toEqual([12, 13, 14, 16, 20, 24]);
    expect(Math.min(...sizes)).toBe(12);
  });

  it("does not turn an unknown or custom size into an inline font-size", () => {
    render(() => (
      <>
        <Text data-testid="unknown" size="h4">legacy alias</Text>
        <Text data-testid="number" size={18}>number</Text>
      </>
    ));
    expect(screen.getByTestId("unknown").style.fontSize).toBe("");
    expect(screen.getByTestId("number").style.fontSize).toBe("");
  });

  it("applies font weight and text align", () => {
    render(() => <Text data-testid="t" fw={600} ta="right">n</Text>);
    expect(screen.getByTestId("t")).toHaveStyle("font-weight: 600");
    expect(screen.getByTestId("t")).toHaveStyle("text-align: right");
  });

  it("applies truncation styles", () => {
    render(() => <Text data-testid="t" truncate style={{ "max-width": "200px" }}>long</Text>);
    expect(screen.getByTestId("t")).toHaveStyle("overflow: hidden");
    expect(screen.getByTestId("t")).toHaveStyle("text-overflow: ellipsis");
    expect(screen.getByTestId("t")).toHaveStyle("white-space: nowrap");
  });

  it("forwards title as a native tooltip attribute", () => {
    render(() => <Text data-testid="t" title="hover me">tip</Text>);
    expect(screen.getByTestId("t")).toHaveAttribute("title", "hover me");
  });
});
