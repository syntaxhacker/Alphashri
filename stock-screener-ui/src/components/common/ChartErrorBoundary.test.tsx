import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartErrorBoundary } from "./ChartErrorBoundary";

function Boom(): never {
  throw new Error("chart blew up");
}

describe("ChartErrorBoundary", () => {
  test("renders children when nothing throws", () => {
    render(
      <ChartErrorBoundary label="Test chart">
        <div data-testid="ok">chart</div>
      </ChartErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-error")).not.toBeInTheDocument();
  });

  test("renders a local fallback when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ChartErrorBoundary label="Price × gamma chart">
        <Boom />
      </ChartErrorBoundary>,
    );
    expect(screen.getByTestId("chart-error")).toHaveTextContent(
      "Price × gamma chart unavailable",
    );
    spy.mockRestore();
  });
});
