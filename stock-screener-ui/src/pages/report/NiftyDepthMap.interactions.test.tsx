// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { NiftyDepthMap } from "./NiftyDepthMap";
import type { NiftyReport } from "@/types/niftyReport";

const depthMocks = vi.hoisted(() => ({
  mounts: 0,
  setOption: vi.fn(),
  resize: vi.fn(),
  lastShouldSetOption: null as null | (() => boolean),
}));

vi.mock("./DepthChart", async () => {
  const { onMount } = await import("solid-js");
  // Faithful-enough stand-in: records mount-time readiness and every imperative
  // call so the panel's single-driver contract can be asserted.
  const MockDepthChart = (props: {
    option?: { series?: unknown[] };
    onChartReady?: (instance: unknown) => void;
    "data-series"?: number;
  }) => {
    const instance = { setOption: depthMocks.setOption, resize: depthMocks.resize };
    onMount(() => {
      depthMocks.mounts += 1;
      props.onChartReady?.(instance);
    });
    return (
      <div data-testid="nifty-depth-echarts" data-series={props["data-series"] ?? props.option?.series?.length ?? 0} />
    );
  };
  return { DepthChart: MockDepthChart };
});

function r(ui: () => JSX.Element) {
  return render(() => <UIProvider>{ui()}</UIProvider>);
}

function strikeAt(strike: number, ceOi: number, peOi: number, chg = 0) {
  return {
    strike,
    ce: { ltp: 1, close: 1, oi: ceOi, prevOi: ceOi, oiChange: chg, priceChange: 0, sentiment: "NEUTRAL" },
    pe: { ltp: 1, close: 1, oi: peOi, prevOi: peOi, oiChange: chg, priceChange: 0, sentiment: "NEUTRAL" },
  };
}

function mockReport(overrides?: Partial<NiftyReport>): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-12",
    expiry: "weekly",
    spot: 25750,
    ohlc: { open: 25600, high: 25800, low: 25550, close: 25750 },
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
    strikes: [
      strikeAt(24000, 100, 100),
      strikeAt(25700, 2000, 2500),
      strikeAt(25800, 9000, 1000),
      strikeAt(27500, 100, 100),
    ],
    timeline: [],
    candles: [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
      { time: "2026-10-12T09:30:00", open: 25620, high: 25760, low: 25600, close: 25750, volume: 1200 },
    ],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  depthMocks.mounts = 0;
  depthMocks.lastShouldSetOption = null;
  depthMocks.setOption.mockClear();
  depthMocks.resize.mockClear();
});

describe("NiftyDepthMap render", () => {
  test("happy path: stats, legend, chart and honesty note", () => {
    r(() => <NiftyDepthMap report={mockReport()} />);
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-stats")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-echarts")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-legend")).toBeInTheDocument();

    const stats = screen.getByTestId("nifty-depth-stats");
    expect(within(stats).getByText("25,750")).toBeInTheDocument();
    expect(within(stats).getByText("1.12")).toBeInTheDocument();
    expect(within(stats).getByText("25,700")).toBeInTheDocument();

    const legend = screen.getByTestId("nifty-depth-legend");
    expect(within(legend).getByTestId("nifty-depth-legend-ce-dom")).toHaveTextContent("CE over PE");
    expect(within(legend).getByTestId("nifty-depth-legend-pe-dom")).toHaveTextContent("PE over CE");
    expect(within(legend).getByTestId("nifty-depth-legend-total")).toHaveTextContent("Total OI");
    expect(within(legend).getByTestId("nifty-depth-legend-poc")).toHaveTextContent("OI POC");
    expect(within(legend).getByTestId("nifty-depth-legend-chg")).toHaveTextContent("OI Chg");

    expect(screen.getByTestId("nifty-depth-note")).toHaveTextContent("no tick footprint");
  });

  test("empty strikes shows empty state instead of chart", () => {
    r(() => <NiftyDepthMap report={mockReport({ strikes: [] })} />);
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depth-echarts")).not.toBeInTheDocument();
  });

  test("empty candles shows dash placeholders in stats", () => {
    r(() => <NiftyDepthMap report={mockReport({ candles: [] })} />);
    const stats = screen.getByTestId("nifty-depth-stats");
    expect(within(screen.getByTestId("nifty-depth-stat-hilo")).getByText("—")).toBeInTheDocument();
    expect(within(stats).getByTestId("nifty-depth-stat-chg")).toHaveTextContent("—");
  });
});

describe("NiftyDepthMap active gate", () => {
  test("active={false} renders the container but performs no ECharts work", () => {
    r(() => <NiftyDepthMap report={mockReport()} active={false} />);
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-depth-echarts")).toBeInTheDocument();
    expect(depthMocks.mounts).toBe(1);
    expect(depthMocks.setOption).not.toHaveBeenCalled();
    expect(depthMocks.resize).not.toHaveBeenCalled();
  });

  test("the chart never self-applies an option — the parent is the only driver", () => {
    r(() => <NiftyDepthMap report={mockReport()} />);
    // DepthChart applies nothing on its own; the single mount-time setOption
    // came from the panel's driver effect, and `notMerge` keeps it exact.
    expect(depthMocks.setOption).toHaveBeenCalledTimes(1);
    expect(depthMocks.setOption.mock.calls[0]?.[1]).toEqual({ notMerge: true, lazyUpdate: false });
  });

  test("report change while hidden stays silent; activate resizes + catches up", () => {
    const [report, setReport] = createSignal(mockReport());
    const [active, setActive] = createSignal(false);
    r(() => <NiftyDepthMap report={report()} active={active()} />);
    expect(depthMocks.setOption).not.toHaveBeenCalled();
    expect(depthMocks.resize).not.toHaveBeenCalled();

    // Report updates while hidden: still zero ECharts work.
    setReport(mockReport({ spot: 25800 }));
    expect(depthMocks.setOption).not.toHaveBeenCalled();
    expect(depthMocks.resize).not.toHaveBeenCalled();

    // Flipping to active: exactly one resize + one setOption with latest.
    setActive(true);
    expect(depthMocks.resize).toHaveBeenCalledTimes(1);
    expect(depthMocks.setOption).toHaveBeenCalledTimes(1);
    expect(depthMocks.mounts).toBe(1);
  });

  test("active report change pushes the new option exactly once", () => {
    const [report, setReport] = createSignal(mockReport());
    r(() => <NiftyDepthMap report={report()} />);
    expect(depthMocks.setOption).toHaveBeenCalledTimes(1);
    expect(depthMocks.resize).toHaveBeenCalledTimes(1);
    setReport(mockReport({ spot: 25800 }));
    expect(depthMocks.setOption).toHaveBeenCalledTimes(2);
  });

  test("the option is pushed with notMerge so a long-lived tab cannot accumulate", () => {
    r(() => <NiftyDepthMap report={mockReport()} />);
    // Second arg of the first setOption call: full replacement, no merge-mode
    // re-patching of ECharts' internal model on every 10s poll.
    expect(depthMocks.setOption.mock.calls[0]?.[1]).toEqual({
      notMerge: true,
      lazyUpdate: false,
    });
  });

  test("a report update does not re-layout the chart (resize is activation-only)", () => {
    const [report, setReport] = createSignal(mockReport());
    r(() => <NiftyDepthMap report={report()} />);
    expect(depthMocks.resize).toHaveBeenCalledTimes(1);
    setReport(mockReport({ spot: 25800 }));
    setReport(mockReport({ spot: 25810 }));
    expect(depthMocks.resize).toHaveBeenCalledTimes(1);
    expect(depthMocks.setOption).toHaveBeenCalledTimes(3);
  });

  test("a transient empty poll keeps the ECharts engine mounted", () => {
    const [report, setReport] = createSignal(mockReport());
    r(() => <NiftyDepthMap report={report()} />);
    expect(depthMocks.mounts).toBe(1);

    setReport(mockReport({ strikes: [] }));
    expect(screen.getByTestId("nifty-depth-empty")).toBeInTheDocument();
    // Engine stays mounted (hidden) instead of being disposed and re-inited on
    // the next poll — see the echarts-for-react unmount-before-`finished` leak.
    expect(screen.getByTestId("nifty-depth-echarts")).toBeInTheDocument();
    expect(depthMocks.mounts).toBe(1);

    setReport(mockReport());
    expect(screen.queryByTestId("nifty-depth-empty")).not.toBeInTheDocument();
    expect(depthMocks.mounts).toBe(1);
  });
});
