// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Title } from "./Title";
import { TYPE_CLASS } from "../typography";
import * as palette from "@/ui/palette";

describe("Title", () => {
  it("defaults to an h3", () => {
    render(() => <Title data-testid="t">heading</Title>);
    expect(screen.getByTestId("t").tagName).toBe("H3");
  });

  it("renders the heading tag from order", () => {
    render(() => <Title data-testid="t1" order={1}>h1</Title>);
    expect(screen.getByTestId("t1").tagName).toBe("H1");
    render(() => <Title data-testid="t6" order={6}>h6</Title>);
    expect(screen.getByTestId("t6").tagName).toBe("H6");
  });

  it("applies tone color via c", () => {
    render(() => <Title data-testid="t" order={3} c="info">teal</Title>);
    expect(screen.getByTestId("t")).toHaveStyle(`color: ${palette.INFO}`);
  });

  it.each([
    ["xs", TYPE_CLASS.micro],
    ["sm", TYPE_CLASS.label],
    ["md", TYPE_CLASS.title],
    ["lg", TYPE_CLASS.heading],
    ["xl", TYPE_CLASS.display],
  ] as const)("maps size=%s to token class %s with no inline font-size", (size, tokenClass) => {
    const testId = `t-${size}`;
    render(() => <Title data-testid={testId} order={2} size={size}>big</Title>);
    const el = screen.getByTestId(testId);
    expect(el).toHaveClass(tokenClass);
    expect(el.style.fontSize).toBe("");
  });

  it("ignores a legacy non-tier alias instead of painting a private size", () => {
    render(() => <Title data-testid="t" order={2} size="h4">old</Title>);
    const el = screen.getByTestId("t");
    expect(el.style.fontSize).toBe("");
    expect(Object.values(TYPE_CLASS).some((cls) => el.classList.contains(cls))).toBe(false);
  });

  it("forwards title as a native tooltip attribute", () => {
    render(() => <Title data-testid="t" order={3} title="hover me">tip</Title>);
    expect(screen.getByTestId("t")).toHaveAttribute("title", "hover me");
  });
});
