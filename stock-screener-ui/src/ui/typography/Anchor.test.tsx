// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Anchor } from "./Anchor";
import * as palette from "@/ui/palette";

describe("Anchor", () => {
  it("renders an anchor with href and target", () => {
    render(() => (
      <Anchor data-testid="a" href="https://example.com" target="_blank">
        visit
      </Anchor>
    ));
    const el = screen.getByTestId("a");
    expect(el.tagName).toBe("A");
    expect(el).toHaveAttribute("href", "https://example.com");
    expect(el).toHaveAttribute("target", "_blank");
    expect(el).toHaveTextContent("visit");
  });

  it("renders as a span when span is set (no href)", () => {
    render(() => <Anchor data-testid="a" span>plain</Anchor>);
    expect(screen.getByTestId("a").tagName).toBe("SPAN");
    expect(screen.getByTestId("a").getAttribute("href")).toBeNull();
  });

  it("underlines when underline=always", () => {
    render(() => <Anchor data-testid="a" href="#" underline="always">always</Anchor>);
    expect(screen.getByTestId("a")).toHaveStyle("text-decoration: underline");
  });

  it("removes underline when underline=never", () => {
    render(() => <Anchor data-testid="a" href="#" underline="never">never</Anchor>);
    expect(screen.getByTestId("a")).toHaveStyle("text-decoration: none");
    expect(screen.getByTestId("a")).not.toHaveClass("hover:underline");
  });

  it("applies tone color via c", () => {
    render(() => <Anchor data-testid="a" href="#" c="primary">link</Anchor>);
    expect(screen.getByTestId("a")).toHaveStyle(`color: ${palette.PRIMARY}`);
  });

  it("forwards title as a native tooltip attribute", () => {
    render(() => <Anchor data-testid="a" href="#" title="hover me">tip</Anchor>);
    expect(screen.getByTestId("a")).toHaveAttribute("title", "hover me");
  });
});
