// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { NiftyChartPanel } from "./NiftyChartPanel";
import type { NiftyReport } from "@/types/niftyReport";

vi.mock("@/components/chart/TradingViewChart", async () => {
  const React = await import("react");
  return {
    TradingViewChart: ({ candles, markLines, emaData }: {
      candles?: unknown[];
      markLines?: { label: { formatter: string } }[];
      emaData?: unknown[];
    }) => {
      React.useEffect(() => {
        panelMocks.tvMounts += 1;
      }, []);
      return (
        <div
          data-testid="tradingview-chart"
          data-candles={candles?.length ?? 0}
          data-marklines={markLines?.length ?? 0}
          data-emas={emaData?.length ?? 0}
        />
      );
    },
  };
});

const panelMocks = vi.hoisted(() => ({ tvMounts: 0, depthMounts: 0 }));

// forwardRef: NiftyDepthMap passes a ref for its manual resize/setOption
// driver (React 19 would tolerate a plain mock, but the ref would be lost).
vi.mock("echarts-for-react", async () => {
  const React = await import("react");
  const MockDepthChart = React.forwardRef(function MockDepthChart() {
    React.useEffect(() => {
      panelMocks.depthMounts += 1;
    }, []);
    return <div data-testid="nifty-depth-echarts" />;
  });
  return { default: MockDepthChart };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  panelMocks.tvMounts = 0;
  panelMocks.depthMounts = 0;
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: Wrapper });
}

function mockReport(overrides?: Record<string, unknown>): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-12",
    expiry: "weekly",
    spot: 25750.5,
    ohlc: { open: 25600, high: 25800, low: 25550, close: 25750.5 },
    pcrOi: 1.12,
    pcrVol: 0.95,
    maxPain: 25700,
    walls: {
      calls: [
        { strike: 25800, oi: 5000 },
        { strike: 25900, oi: 4000 },
      ],
      puts: [
        { strike: 25600, oi: 6000 },
        { strike: 25500, oi: 4500 },
      ],
    },
    strikes: [],
    timeline: [],
    pivots: null,
    gex: null,
    intraday: [],
    candles: [],
    ...overrides,
  } as unknown as NiftyReport;
}

function candles3() {
  return [
    { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
    { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25640, volume: 1100 },
    { time: "2026-10-12T09:20:00", open: 25640, high: 25700, low: 25610, close: 25680, volume: 1200 },
  ];
}

/** Report with strikes inside ATM ±750 so the depth map renders its chart. */
function depthReport() {
  return mockReport({
    candles: candles3(),
    strikes: [
      { strike: 25700, ce: { oi: 2000 }, pe: { oi: 2500 } },
      { strike: 25800, ce: { oi: 9000 }, pe: { oi: 1000 } },
    ],
  });
}

describe("NiftyChartPanel", () => {
  test("renders chart, size + timeframe toggles, wrap and legend", () => {
    r(<NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tf-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-size")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    expect(screen.getByTestId("nifty-level-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-empty")).not.toBeInTheDocument();
  });

  test("size toggle changes only the wrap height (S 180px → XL 760px)", async () => {
    const user = userEvent.setup();
    r(<NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ height: "180px" });
    await user.click(screen.getByRole("button", { name: "XL" }));
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ height: "760px" });
    // same candles, same overlays — only the height changed
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-emas", "2");
  });

  test("timeframe toggle resamples 1m → 5m client-side", async () => {
    const user = userEvent.setup();
    r(<NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    // 09:15 + 09:16 fold into one 5m bucket, 09:20 starts the next → 2 bars
    await user.click(screen.getByRole("button", { name: "5m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "2");
    await user.click(screen.getByRole("button", { name: "1m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
  });

  test("depth view keeps the chart mounted but hidden; toggles stay hidden", async () => {
    const user = userEvent.setup();
    const { rerender } = r(
      <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />,
    );
    rerender(
      <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="depth" />,
    );
    expect(await screen.findByTestId("nifty-depthmap")).toBeInTheDocument();
    // Both views stay mounted now (instant switching): the chart wrapper is
    // display:none instead of unmounted.
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });
    expect(screen.queryByTestId("nifty-tf-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-size")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-level-legend")).toBeInTheDocument();
    void user;
  });

  test("lazy depth mount: no depth subtree until first depth view", () => {
    const { rerender } = r(
      <NiftyChartPanel report={depthReport()} mode="live" view="chart" />,
    );
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depth-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depthmap")).not.toBeInTheDocument();
    expect(panelMocks.depthMounts).toBe(0);

    rerender(<NiftyChartPanel report={depthReport()} mode="live" view="depth" />);
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(panelMocks.depthMounts).toBe(1);
  });

  test("Chart→Depth→Chart→Depth mounts ECharts once and never remounts the chart", () => {
    const report = depthReport();
    const { rerender } = r(
      <NiftyChartPanel report={report} mode="live" view="chart" />,
    );
    expect(panelMocks.tvMounts).toBe(1);
    expect(panelMocks.depthMounts).toBe(0);

    rerender(<NiftyChartPanel report={report} mode="live" view="depth" />);
    expect(panelMocks.depthMounts).toBe(1);
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });

    rerender(<NiftyChartPanel report={report} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-view")).not.toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).toHaveStyle({ display: "none" });

    rerender(<NiftyChartPanel report={report} mode="live" view="depth" />);
    // Still exactly one mount each — switching only flips visibility.
    expect(panelMocks.depthMounts).toBe(1);
    expect(panelMocks.tvMounts).toBe(1);
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
  });

  test("empty candles render the empty state, not the chart", () => {
    r(<NiftyChartPanel report={mockReport()} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-wrap")).not.toBeInTheDocument();
  });

  test("memo: same report reference keeps the wrap DOM node across parent re-renders", () => {
    const report = mockReport({ candles: candles3() });
    const { rerender } = r(<NiftyChartPanel report={report} mode="live" view="chart" />);
    const wrap = screen.getByTestId("nifty-chart-wrap");
    rerender(
      <NiftyChartPanel report={report} mode="live" view="chart" />,
    );
    // React.memo bailed out — the identical DOM node survived the re-render.
    expect(screen.getByTestId("nifty-chart-wrap")).toBe(wrap);
    expect(within(screen.getByTestId("nifty-level-legend")).getByText("MP", { exact: true })).toBeInTheDocument();
  });
});
