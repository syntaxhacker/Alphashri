// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Code } from "./Code";

describe("Code", () => {
  it("renders inline code with font-mono", () => {
    render(() => <Code data-testid="c">npx vite build</Code>);
    const el = screen.getByTestId("c");
    expect(el.tagName).toBe("CODE");
    expect(el).toHaveClass("font-mono");
    expect(el).toHaveTextContent("npx vite build");
  });

  it("renders a block as pre > code", () => {
    render(() => (
      <Code data-testid="c" block>
        const x = 1;
      </Code>
    ));
    const pre = screen.getByTestId("c");
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveClass("font-mono");
    expect(pre.querySelector("code")).not.toBeNull();
  });

  it("applies a colored background via color", () => {
    render(() => <Code data-testid="c" block color="info">npm install</Code>);
    expect(screen.getByTestId("c")).toHaveStyle("background-color: #58A6FF");
    expect(screen.getByTestId("c")).toHaveStyle("color: white");
  });
});
