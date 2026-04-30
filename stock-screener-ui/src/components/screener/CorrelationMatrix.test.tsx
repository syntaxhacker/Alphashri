// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { CorrelationMatrix } from "./CorrelationMatrix";

vi.mock("../../hooks/useECharts", () => {
  const mockRef = { current: document.createElement("div") };
  return {
    useECharts: () => ({
      chartRef: mockRef,
      setChartOption: vi.fn(),
    }),
  };
});

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider> });
}

describe("CorrelationMatrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("renders chart container even when loading", () => {
    r(<CorrelationMatrix matrix={[]} symbols={[]} isLoading />);
    expect(screen.getByTestId("correlation-matrix")).toBeInTheDocument();
    expect(screen.getByText("Loading correlation data...")).toBeInTheDocument();
  });

  test("renders chart container even when empty", () => {
    r(<CorrelationMatrix matrix={[]} symbols={[]} />);
    expect(screen.getByTestId("correlation-matrix")).toBeInTheDocument();
    expect(screen.getByText("No correlation data available")).toBeInTheDocument();
  });

  test("renders chart container with valid data", () => {
    const matrix = [[1.0, 0.75], [0.75, 1.0]];
    const symbols = ["RELIANCE", "TCS"];

    r(<CorrelationMatrix matrix={matrix} symbols={symbols} />);

    expect(screen.getByTestId("correlation-matrix")).toBeInTheDocument();
  });

  test("renders with multiple symbols", () => {
    const matrix = [
      [1, 0.5, 0.3, 0.1, 0.2],
      [0.5, 1, 0.2, 0.4, 0.3],
      [0.3, 0.2, 1, 0.6, 0.5],
      [0.1, 0.4, 0.6, 1, 0.7],
      [0.2, 0.3, 0.5, 0.7, 1],
    ];
    const symbols = ["A", "B", "C", "D", "E"];

    r(<CorrelationMatrix matrix={matrix} symbols={symbols} />);

    expect(screen.getByTestId("correlation-matrix")).toBeInTheDocument();
  });

  test("loading state takes priority over empty state", () => {
    r(<CorrelationMatrix matrix={[]} symbols={[]} isLoading />);
    expect(screen.getByText("Loading correlation data...")).toBeInTheDocument();
    expect(screen.queryByText("No correlation data available")).not.toBeInTheDocument();
  });

  test("hides empty overlay when data is present", () => {
    const matrix = [[1.0]];
    const symbols = ["RELIANCE"];

    r(<CorrelationMatrix matrix={matrix} symbols={symbols} />);

    expect(screen.queryByText("No correlation data available")).not.toBeInTheDocument();
  });
});
