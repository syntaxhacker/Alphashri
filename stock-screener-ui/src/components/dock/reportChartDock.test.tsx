// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { NiftyReport } from "@/types/niftyReport";
import { DockHost } from "./DockHost";
import { normalizeLayout } from "./layout";
import {
  makeReportChartSpec,
  ReportChartDockDemo,
  type ReportChartSources,
} from "./reportChartDock";

// The chart engine is a browser canvas component; the dock harness only cares
// that the real NiftyChartPanel mounts and wires its props/callbacks.
vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: () => <div data-testid="tradingview-chart" />,
}));
vi.mock("@/pages/report/DepthChart", () => ({
  DepthChart: () => <div data-testid="nifty-depth-echarts" />,
}));

function mockReport(overrides: Record<string, unknown> = {}): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-12",
    expiry: "weekly",
    spot: 25750.5,
    ohlc: { open: 25600, high: 25800, low: 25550, close: 25750.5 },
    pcrOi: 1.12,
    pcrVol: 0.95,
    maxPain: 25700,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    candles: [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
      { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25640, volume: 1100 },
      { time: "2026-10-12T09:20:00", open: 25640, high: 25700, low: 25610, close: 25680, volume: 1200 },
    ],
    ...overrides,
  } as unknown as NiftyReport;
}

type TestSources = ReportChartSources & { setSymbol: (v: string) => void };

function sources(): TestSources {
  const [report] = createSignal(mockReport());
  const [symbol, setSymbol] = createSignal("NIFTY");
  const [timeframe] = createSignal<"1m" | "5m" | "15m">("1m");
  return { report, symbol, timeframe, setSymbol };
}

afterEach(() => cleanup());

describe("report.chart through the dock host", () => {
  it("(e) mounts the REAL NiftyChartPanel with today's ReportWorkspace props", () => {
    render(() => (
      <UIProvider>
        <ReportChartDockDemo sources={sources()} />
      </UIProvider>
    ));

    expect(screen.getByTestId("dock-pane-report.chart")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-panel")).toHaveTextContent("NIFTY chart");
    expect(screen.getByTestId("nifty-tf-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-size")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
  });

  it("(a) re-renders the real panel when an injected data source changes", async () => {
    const src = sources();
    render(() => (
      <UIProvider>
        <ReportChartDockDemo sources={src} />
      </UIProvider>
    ));

    expect(screen.getByTestId("nifty-chart-panel")).toHaveTextContent("NIFTY chart");
    src.setSymbol("SENSEX");
    await waitFor(() => expect(screen.getByTestId("nifty-chart-panel")).toHaveTextContent("SENSEX chart"));
  });

  it("(c) onTimeframeChange fires through the dock and reaches the parent", async () => {
    const onTimeframeChange = vi.fn();
    render(() => (
      <UIProvider>
        <ReportChartDockDemo sources={sources()} commands={{ onTimeframeChange }} />
      </UIProvider>
    ));

    fireEvent.click(screen.getByRole("button", { name: "5m" }));
    await waitFor(() => expect(onTimeframeChange).toHaveBeenCalledWith("5m"));
  });

  it("(b) the real panel renders through the dock even with no commands", () => {
    const spec = makeReportChartSpec(sources());
    const layout = normalizeLayout({ panes: [{ id: spec.id, size: 1 }], hidden: [] }, [spec]);
    render(() => (
      <UIProvider>
        <DockHost
          specs={[spec]}
          layout={layout}
          context={() => ({ symbol: "NIFTY" })}
          onLayoutChange={() => {}}
          stacked={false}
        />
      </UIProvider>
    ));

    expect(screen.getByTestId("nifty-chart-panel")).toBeInTheDocument();
    // Expand affordance is wired only when onExpand exists; none was supplied.
    expect(screen.queryByTestId("nifty-chart-expand")).not.toBeInTheDocument();
  });
});
