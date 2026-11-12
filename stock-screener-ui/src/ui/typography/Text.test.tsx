// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Text } from "./Text";

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

  it("applies tone color via c", () => {
    render(() => <Text data-testid="t" c="success">up</Text>);
    expect(screen.getByTestId("t")).toHaveStyle("color: #3FB950");
  });

  it("applies size from the type scale", () => {
    render(() => <Text data-testid="t" size="xs">tiny</Text>);
    expect(screen.getByTestId("t")).toHaveStyle("font-size: 12px");
  });

  it("applies font weight and text align", () => {
    render(() => <Text data-testid="t" fw={600} ta="right">n</Text>);
    expect(screen.getByTestId("t")).toHaveStyle("font-weight: 600");
    expect(screen.getByTestId("t")).toHaveStyle("text-align: right");
  });

  it("applies truncation styles", () => {
    render(() => <Text data-testid="t" truncate style={{ "max-width": 200 }}>long</Text>);
    expect(screen.getByTestId("t")).toHaveStyle("overflow: hidden");
    expect(screen.getByTestId("t")).toHaveStyle("text-overflow: ellipsis");
    expect(screen.getByTestId("t")).toHaveStyle("white-space: nowrap");
  });

  it("forwards title as a native tooltip attribute", () => {
    render(() => <Text data-testid="t" title="hover me">tip</Text>);
    expect(screen.getByTestId("t")).toHaveAttribute("title", "hover me");
  });
});
