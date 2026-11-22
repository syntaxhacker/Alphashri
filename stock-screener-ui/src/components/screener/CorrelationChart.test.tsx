// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { createSignal } from "solid-js";
import { loadEcharts } from "../../utils/loadEcharts";
import { CorrelationChart } from "./CorrelationChart";
import type { CorrelationDataPoint } from "../../api/correlation";

const mockSetChartOption = vi.fn();
const mockChartInstance = {
  setOption: (...args: unknown[]) => mockSetChartOption(...args),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
};

vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(() => Promise.resolve({ init: vi.fn(() => mockChartInstance) })),
}));

function r(jsx: () => any) {
  return render(() => <UIProvider>{jsx()}</UIProvider>);
}

describe("CorrelationChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadEcharts).mockImplementation(() =>
      Promise.resolve({ init: vi.fn(() => mockChartInstance) } as never),
    );
  });

  afterEach(() => {
    cleanup();
  });

  test("renders chart container even when normalized is null", () => {
    r(
      () => (
        <CorrelationChart
          normalized={null as unknown as Record<string, CorrelationDataPoint[]>}
          symbols={["RELIANCE"]}
        />
      ),
    );
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
    expect(screen.getByText("No chart data available")).toBeInTheDocument();
  });

  test("renders chart container even when symbols are empty", () => {
    r(() => <CorrelationChart normalized={{}} symbols={[]} />);
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
    expect(screen.getByText("No chart data available")).toBeInTheDocument();
  });

  test("renders chart container when data is valid", async () => {
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

    r(() => <CorrelationChart normalized={normalized} symbols={["RELIANCE", "TCS"]} />);
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
  });

  test("hides empty overlay when data is present", () => {
    const normalized: Record<string, CorrelationDataPoint[]> = {
      RELIANCE: [
        { timestamp: "2024-01-01", value: 100 },
        { timestamp: "2024-01-02", value: 102 },
      ],
    };

    r(() => <CorrelationChart normalized={normalized} symbols={["RELIANCE"]} />);
    expect(screen.queryByText("No chart data available")).not.toBeInTheDocument();
  });

  test("handles symbols with no matching data in normalized", () => {
    const normalized: Record<string, CorrelationDataPoint[]> = {
      RELIANCE: [{ timestamp: "2024-01-01", value: 100 }],
    };

    r(() => <CorrelationChart normalized={normalized} symbols={["RELIANCE", "TCS", "INFY"]} />);
    expect(screen.getByTestId("correlation-chart")).toBeInTheDocument();
  });

  test("calls setChartOption with valid data", async () => {
    const normalized: Record<string, CorrelationDataPoint[]> = {
      RELIANCE: [
        { timestamp: "2024-01-01", value: 100 },
        { timestamp: "2024-01-02", value: 102 },
      ],
    };

    r(() => <CorrelationChart normalized={normalized} symbols={["RELIANCE"]} />);

    await vi.waitFor(() => expect(mockSetChartOption).toHaveBeenCalled());
    const option = mockSetChartOption.mock.calls[0][0];
    expect(option.series).toHaveLength(1);
    expect(option.series[0].name).toBe("RELIANCE");
  });

  test("does not call setChartOption with empty data", async () => {
    r(() => <CorrelationChart normalized={{}} symbols={[]} />);
    // Let the microtask queue flush; the effect may still fire with an empty chart.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockSetChartOption).not.toHaveBeenCalled();
  });

  test("a slower earlier chart load cannot paint over newer data", async () => {
    let resolveFirst!: (lib: unknown) => void;
    const lib = { init: vi.fn(() => mockChartInstance) };
    vi.mocked(loadEcharts)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => Promise.resolve(lib as never));

    const [symbol, setSymbol] = createSignal("AAA");
    r(() => (
      <CorrelationChart
        normalized={{
          AAA: [{ timestamp: "2024-01-01", value: 100 }],
          BBB: [{ timestamp: "2024-01-02", value: 200 }],
        }}
        symbols={[symbol()]}
      />
    ));

    await vi.waitFor(() => expect(vi.mocked(loadEcharts)).toHaveBeenCalledTimes(1));
    setSymbol("BBB");
    await vi.waitFor(() => expect(mockSetChartOption).toHaveBeenCalledTimes(1));
    expect(mockSetChartOption.mock.calls[0][0].series[0].name).toBe("BBB");

    resolveFirst(lib);
    await Promise.resolve();
    expect(mockSetChartOption).toHaveBeenCalledTimes(1);
  });
});
