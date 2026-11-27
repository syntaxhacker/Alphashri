// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Code } from "./Code";
import * as palette from "@/ui/palette";
import { TYPE_CLASS } from "@/ui/typography";

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

  it("uses the body text token with no private font size", () => {
    render(() => <Code data-testid="c">npm install</Code>);
    render(() => <Code data-testid="b" block>npm install</Code>);
    for (const id of ["c", "b"]) {
      const el = screen.getByTestId(id);
      expect(el).toHaveClass(TYPE_CLASS.body);
      expect(el.style.fontSize).toBe("");
    }
  });

  it("applies a colored background via color", () => {
    render(() => <Code data-testid="c" block color="info">npm install</Code>);
    expect(screen.getByTestId("c")).toHaveStyle(`background-color: ${palette.INFO}`);
    expect(screen.getByTestId("c")).toHaveStyle(`color: ${palette.BG}`);
  });
});
