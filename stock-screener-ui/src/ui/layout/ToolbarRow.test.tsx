// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { ToolbarRow } from "./ToolbarRow";

describe("ToolbarRow", () => {
  it("renders children in a centered gap row", () => {
    render(() => (
      <ToolbarRow data-testid="tr" gap={12} justify="center">
        <button data-testid="b1">a</button>
        <button data-testid="b2">b</button>
      </ToolbarRow>
    ));
    const tr = screen.getByTestId("tr");
    expect(tr).toHaveClass("flex items-center min-w-0 flex-wrap");
    expect(tr).toHaveStyle("gap: 12px");
    expect(tr).toHaveStyle("justify-content: center");
    expect(screen.getByTestId("b1")).toBeInTheDocument();
    expect(screen.getByTestId("b2")).toBeInTheDocument();
  });

  it("disables wrap and clips overflow when requested", () => {
    render(() => <ToolbarRow data-testid="tr" wrap={false} clip />);
    const tr = screen.getByTestId("tr");
    expect(tr).toHaveClass("flex-nowrap");
    expect(tr).toHaveClass("overflow-hidden");
    expect(tr).not.toHaveClass("flex-wrap");
  });

  it("defaults gap to 8px and justify to flex-start", () => {
    render(() => <ToolbarRow data-testid="tr" />);
    const tr = screen.getByTestId("tr");
    expect(tr).toHaveStyle("gap: 8px");
    expect(tr).toHaveStyle("justify-content: flex-start");
  });
});
