// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { CorrelationChart } from "./CorrelationChart";
import type { CorrelationDataPoint } from "../../api/correlation";

const mockSetChartOption = vi.fn();
const mockChartRef = { current: document.createElement("div") };

vi.mock("../../hooks/useECharts", () => ({
  useECharts: vi.fn(() => ({
    chartRef: mockChartRef,
    chartInstance: { current: null },
    setChartOption: mockSetChartOption,
  })),
}));

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider> });
}

describe("CorrelationChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("renders chart container even when normalized is null", () => {
    r(
      <CorrelationChart
        normalized={null as unknown as Record<string, CorrelationDataPoint[]>}
        symbols={["RELIANCE"]}
      />,
    );
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
    expect(screen.getByText("No chart data available")).toBeInTheDocument();
  });

  test("renders chart container even when symbols are empty", () => {
    r(<CorrelationChart normalized={{}} symbols={[]} />);
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
    expect(screen.getByText("No chart data available")).toBeInTheDocument();
  });

  test("renders chart container when data is valid", () => {
    const normalized: Record<string, CorrelationDataPoint[]> = {
      RELIANCE: [
        { timestamp: "2024-01-01", value: 100 },
        { timestamp: "2024-01-02", value: 102 },
      ],
      TCS: [
        { timestamp: "2024-01-01", value: 100 },
        { timestamp: "2024-01-02", value: 98 },
      ],
    };

    r(<CorrelationChart normalized={normalized} symbols={["RELIANCE", "TCS"]} />);
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
  });

  test("hides empty overlay when data is present", () => {
    const normalized: Record<string, CorrelationDataPoint[]> = {
      RELIANCE: [
        { timestamp: "2024-01-01", value: 100 },
        { timestamp: "2024-01-02", value: 102 },
      ],
    };

    r(<CorrelationChart normalized={normalized} symbols={["RELIANCE"]} />);
    expect(screen.queryByText("No chart data available")).not.toBeInTheDocument();
  });

  test("handles symbols with no matching data in normalized", () => {
    const normalized: Record<string, CorrelationDataPoint[]> = {
      RELIANCE: [{ timestamp: "2024-01-01", value: 100 }],
    };

    r(<CorrelationChart normalized={normalized} symbols={["RELIANCE", "TCS", "INFY"]} />);
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
  });

  test("calls setChartOption with valid data", () => {
    const normalized: Record<string, CorrelationDataPoint[]> = {
      RELIANCE: [
        { timestamp: "2024-01-01", value: 100 },
        { timestamp: "2024-01-02", value: 102 },
      ],
    };

    r(<CorrelationChart normalized={normalized} symbols={["RELIANCE"]} />);

    expect(mockSetChartOption).toHaveBeenCalled();
    const option = mockSetChartOption.mock.calls[0][0];
    expect(option.series).toHaveLength(1);
    expect(option.series[0].name).toBe("RELIANCE");
  });

  test("does not call setChartOption with empty data", () => {
    r(<CorrelationChart normalized={{}} symbols={[]} />);
    expect(mockSetChartOption).not.toHaveBeenCalled();
  });

  test("shows loading overlay when isLoading is true", () => {
    r(<CorrelationChart normalized={{}} symbols={[]} isLoading={true} />);
    expect(screen.getByText("Loading chart data...")).toBeInTheDocument();
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
  });

  test("does not show loading overlay when isLoading is false", () => {
    r(<CorrelationChart normalized={{}} symbols={[]} isLoading={false} />);
    expect(screen.queryByText("Loading chart data...")).not.toBeInTheDocument();
  });
});
