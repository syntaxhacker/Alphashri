// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { CorrelationHeatmap } from "./CorrelationHeatmap";

const mockEcharts = {
  init: vi.fn().mockReturnValue({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
  }),
  setOption: vi.fn(),
  dispose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as any).echarts = mockEcharts;
});

afterEach(() => {
  cleanup();
  delete (window as any).echarts;
});

function renderWithProvider(ui: React.ReactElement) {
  return render(<UIProvider>{ui}</UIProvider>);
}

describe("CorrelationHeatmap", () => {
  it("renders ECharts heatmap with matrix data", () => {
    const matrix = [
      [1.0, 0.5],
      [0.5, 1.0],
    ];
    renderWithProvider(
      <CorrelationHeatmap matrix={matrix} symbols={["AAPL", "MSFT"]} testId="correlation-heatmap" />,
    );
    expect(screen.getByTestId("correlation-heatmap")).toBeTruthy();
  });

  it("does not show loading when isLoading is false", () => {
    renderWithProvider(
      <CorrelationHeatmap matrix={[]} symbols={[]} isLoading={false} />,
    );
    expect(screen.queryByText("Loading correlation data...")).not.toBeInTheDocument();
  });

  it("shows loading state", () => {
    renderWithProvider(
      <CorrelationHeatmap matrix={[]} symbols={[]} isLoading />,
    );
    expect(screen.getByText("Loading correlation data...")).toBeInTheDocument();
  });

  it("shows no data message when no data", () => {
    renderWithProvider(
      <CorrelationHeatmap matrix={[]} symbols={[]} />,
    );
    expect(screen.getByText("No correlation data available")).toBeInTheDocument();
  });

  it("renders with testId", () => {
    const matrix = [[1.0]];
    renderWithProvider(
      <CorrelationHeatmap matrix={matrix} symbols={["TEST"]} testId="my-heatmap" />,
    );
    expect(screen.getByTestId("my-heatmap")).toBeTruthy();
  });

  it("uses custom valueFormatter when provided", () => {
    const matrix = [[1.0]];
    const formatter = (v: number) => `${(v * 100).toFixed(1)}%`;
    renderWithProvider(
      <CorrelationHeatmap
        matrix={matrix}
        symbols={["TEST"]}
        valueFormatter={formatter}
        testId="correlation-heatmap"
      />,
    );
    expect(screen.getByTestId("correlation-heatmap")).toBeTruthy();
  });

  it("supports dark mode theme", () => {
    const matrix = [[1.0]];
    renderWithProvider(
      <CorrelationHeatmap matrix={matrix} symbols={["TEST"]} isDark testId="correlation-heatmap" />,
    );
    expect(screen.getByTestId("correlation-heatmap")).toBeTruthy();
  });
});
