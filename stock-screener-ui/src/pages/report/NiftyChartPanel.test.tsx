// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { MOBILE_CHART_TARGET, NiftyChartPanel } from "./NiftyChartPanel";
import type { NiftyReport } from "@/types/niftyReport";

vi.mock("@/components/chart/TradingViewChart", async () => {
  const { onMount } = await import("solid-js");
  return {
    TradingViewChart: (props: {
      candles?: { open: number; high: number; low: number; close: number }[];
      markLines?: { label: { formatter: string } }[];
      emaData?: unknown[];
      fitMarkLines?: boolean;
      touchMarkers?: {
        time: string;
        value: number;
        shape?: string;
        color?: string;
        text?: string;
      }[];
    }) => {
      onMount(() => {
        panelMocks.tvMounts += 1;
      });
      const first = () => props.candles?.[0];
      return (
        <div
          data-testid="tradingview-chart"
          data-candles={props.candles?.length ?? 0}
          data-first-open={first()?.open}
          data-first-high={first()?.high}
          data-first-low={first()?.low}
          data-first-close={first()?.close}
          data-marklines={props.markLines?.length ?? 0}
          data-markline-labels={(props.markLines ?? []).map((l) => l.label.formatter).join("|")}
          data-emas={props.emaData?.length ?? 0}
          data-fit-marklines={props.fitMarkLines ? "1" : "0"}
          data-touch-markers={props.touchMarkers?.length ?? 0}
          data-touch-details={(props.touchMarkers ?? [])
            .map((m) => `${m.shape ?? "circle"}:${m.color ?? ""}:${m.text ?? ""}`)
            .join("|")}
        />
      );
    },
  };
});

const panelMocks = vi.hoisted(() => ({ tvMounts: 0, depthMounts: 0 }));

// DepthChart mock: counts mounts; renders a stand-in with the same testid.
vi.mock("./DepthChart", async () => {
  const { onMount } = await import("solid-js");
  const MockDepthChart = () => {
    onMount(() => {
      panelMocks.depthMounts += 1;
    });
    return <div data-testid="nifty-depth-echarts" />;
  };
  return { DepthChart: MockDepthChart };
});

vi.mock("@/api/chartPatterns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chartPatterns")>();
  return {
    ...actual,
    detectPatterns: vi.fn(async () => ({
      hits: [
        {
          pattern_id: "double-bottom",
          pattern_name: "Double bottom",
          direction: "bullish",
          status: "confirmed",
          breakout_level: 25650,
          target: 25800,
          stop: 25500,
          confidence: 80,
          bars_ago: 0,
        },
      ],
    })),
  };
});

const CHART_SOURCE_KEY = "nifty.chartSource";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(CHART_SOURCE_KEY);
  vi.clearAllMocks();
  panelMocks.tvMounts = 0;
  panelMocks.depthMounts = 0;
});

function r(ui: () => JSX.Element) {
  return render(() => <UIProvider>{ui()}</UIProvider>);
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
  test("renders chart, size + timeframe toggles and wrap (legend hidden)", () => {
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tf-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-size")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-fit-marklines", "1");
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-empty")).not.toBeInTheDocument();
  });

  test("mobile chart contract: the fill body declares the >=240px target", () => {
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    const wrap = screen.getByTestId("nifty-chart-wrap");
    expect(wrap).toHaveAttribute("data-fill", "1");
    expect(wrap).toHaveAttribute("data-mobile-chart-min", String(MOBILE_CHART_TARGET));
    // No fixed pixel height on the flex body — the row grows after the flow
    // band collapses, and the body fills it via flex-1 / min-h-0.
    expect(wrap.className).toContain("flex-1");
    expect(wrap.className).toContain("min-h-0");
    expect(wrap.style.height).toBe("");
  });

  test("default fills; size toggle pins S 180px → XL 760px", async () => {
    const user = userEvent.setup();
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    const wrap = screen.getByTestId("nifty-chart-wrap");
    expect(wrap).toHaveAttribute("data-fill", "1");
    expect(wrap).not.toHaveStyle({ height: "180px" });
    // Size is a secondary action behind the desktop disclosure.
    await user.click(screen.getByTestId("nifty-chart-controls-more-desktop"));
    await user.click(screen.getByRole("button", { name: "XL" }));
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ height: "760px" });
    expect(screen.getByTestId("nifty-chart-wrap")).not.toHaveAttribute("data-fill");
    await user.click(screen.getByRole("button", { name: "S" }));
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ height: "180px" });
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-emas", "2");
  });

  test("fill mode caps the body; size changes notify the parent", async () => {
    const user = userEvent.setup();
    const onSizeChange = vi.fn();
    r(() => (
      <NiftyChartPanel
        report={mockReport({ candles: candles3() })}
        mode="live"
        view="chart"
        onSizeChange={onSizeChange}
      />
    ));
    const wrap = screen.getByTestId("nifty-chart-wrap");
    // DESK reads at a glance: the auto chart stops at 300px (floor 260).
    expect(wrap).toHaveStyle({ maxHeight: "300px", minHeight: "260px" });
    await user.click(screen.getByTestId("nifty-chart-controls-more-desktop"));
    await user.click(screen.getByRole("button", { name: "XL" }));
    // A manual preset drops the cap so S/M/L/XL keep their exact height.
    const xl = screen.getByTestId("nifty-chart-wrap");
    expect(xl).toHaveStyle({ height: "760px" });
    expect(xl).not.toHaveStyle({ maxHeight: "300px" });
    expect(onSizeChange).toHaveBeenLastCalledWith("xl");
  });

  test("timeframe toggle resamples 1m → 5m client-side", async () => {
    const user = userEvent.setup();
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    // 09:15 + 09:16 fold into one 5m bucket, 09:20 starts the next → 2 bars
    await user.click(screen.getByRole("button", { name: "5m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "2");
    await user.click(screen.getByRole("button", { name: "1m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
  });

  test("depth view keeps the chart mounted but hidden; toggles stay hidden", async () => {
    const [view, setView] = createSignal<"chart" | "depth">("chart");
    const [report] = createSignal(mockReport({ candles: candles3() }));
    r(() => <NiftyChartPanel report={report()} mode="live" view={view()} />);
    setView("depth");
    expect(await screen.findByTestId("nifty-depthmap")).toBeInTheDocument();
    // Both views stay mounted now (instant switching): the chart wrapper is
    // display:none instead of unmounted.
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });
    expect(screen.queryByTestId("nifty-tf-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-size")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
  });

  test("lazy depth mount: no depth subtree until first depth view", () => {
    const [view, setView] = createSignal<"chart" | "depth">("chart");
    const [report] = createSignal(depthReport());
    r(() => <NiftyChartPanel report={report()} mode="live" view={view()} />);
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depth-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depthmap")).not.toBeInTheDocument();
    expect(panelMocks.depthMounts).toBe(0);

    setView("depth");
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(panelMocks.depthMounts).toBe(1);
  });

  test("Chart→Depth→Chart→Depth mounts ECharts once and never remounts the chart", () => {
    const [view, setView] = createSignal<"chart" | "depth">("chart");
    const [report] = createSignal(depthReport());
    r(() => <NiftyChartPanel report={report()} mode="live" view={view()} />);
    expect(panelMocks.tvMounts).toBe(1);
    expect(panelMocks.depthMounts).toBe(0);

    setView("depth");
    expect(panelMocks.depthMounts).toBe(1);
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });

    setView("chart");
    expect(screen.getByTestId("nifty-chart-view")).not.toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).toHaveStyle({ display: "none" });

    setView("depth");
    expect(panelMocks.depthMounts).toBe(1);
    expect(panelMocks.tvMounts).toBe(1);
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
  });

  test("depth wrapper fills the panel and scrolls a short desk row instead of clipping", () => {
    const [view, setView] = createSignal<"chart" | "depth">("chart");
    const [report] = createSignal(depthReport());
    r(() => <NiftyChartPanel report={report()} mode="live" view={view()} />);
    setView("depth");
    const depthView = screen.getByTestId("nifty-depth-view");
    // Same flex contract as the chart view: grow into a tall panel, shrink in
    // a short one, and scroll the overflowing map rather than cut it off.
    expect(depthView).toHaveClass("flex", "flex-1", "min-h-0", "h-full", "overflow-auto");
    expect(depthView).toHaveStyle({ display: "flex" });
  });

  test("depth map keeps its min-height as the content minimum behind scrolling", () => {
    const [view, setView] = createSignal<"chart" | "depth">("chart");
    const [report] = createSignal(depthReport());
    r(() => <NiftyChartPanel report={report()} mode="live" view={view()} />);
    setView("depth");
    // The map's own floor is what forces the wrapper to scroll in a short row.
    // Removing it would silently shrink the depth chart below a readable size.
    expect(screen.getByTestId("nifty-depth-chart")).toHaveClass("min-h-[380px]");
  });

  test("chart → depth → chart keeps the chart wrapper's flex contract and DOM node", () => {
    const [view, setView] = createSignal<"chart" | "depth">("chart");
    const [report] = createSignal(depthReport());
    r(() => <NiftyChartPanel report={report()} mode="live" view={view()} />);
    const chartView = screen.getByTestId("nifty-chart-view");
    expect(chartView).toHaveClass("flex", "flex-col");
    expect(chartView).toHaveStyle({ display: "flex" });

    setView("depth");
    expect(chartView).toHaveStyle({ display: "none" });

    setView("chart");
    expect(screen.getByTestId("nifty-chart-view")).toBe(chartView);
    expect(chartView).toHaveClass("flex", "flex-col");
    expect(chartView).toHaveStyle({ display: "flex" });
    expect(chartView.style.flex).toBeTruthy();
  });

  test("empty candles render the empty state, not the chart", () => {
    r(() => <NiftyChartPanel report={mockReport()} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-wrap")).not.toBeInTheDocument();
  });

  test("a poll with no candles hides the chart instead of unmounting it", () => {
    const [report, setReport] = createSignal(mockReport({ candles: candles3() }));
    r(() => <NiftyChartPanel report={report()} mode="live" view="chart" />);
    expect(panelMocks.tvMounts).toBe(1);

    // Transient empty poll (feed hiccup / replay boundary): the empty state
    // shows, but the engine stays mounted so the next poll does not rebuild
    // every canvas, series and price line from scratch.
    setReport(mockReport());
    expect(screen.getByTestId("nifty-chart-empty")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    expect(panelMocks.tvMounts).toBe(1);

    setReport(mockReport({ candles: candles3() }));
    expect(screen.queryByTestId("nifty-chart-empty")).not.toBeInTheDocument();
    expect(panelMocks.tvMounts).toBe(1);
  });

  test("parent-driven prop updates keep the wrap DOM node mounted", () => {
    const [flipAt, setFlipAt] = createSignal<string | undefined>(undefined);
    const [report] = createSignal(mockReport({ candles: candles3() }));
    r(() => <NiftyChartPanel report={report()} mode="live" view="chart" flipAt={flipAt()} />);
    const wrap = screen.getByTestId("nifty-chart-wrap");
    setFlipAt("2026-10-12T09:16:00");
    expect(screen.getByTestId("nifty-chart-wrap")).toBe(wrap);
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
  });
});

describe("NiftyChartPanel three-way chart source", () => {
  const toggle = () => screen.getByTestId("nifty-chart-source");
  const choose = async (label: "LIVE" | "PATTERNS" | "OFFLINE") => {
    await userEvent.setup().click(within(toggle()).getByRole("button", { name: label }));
  };
  const sourceReport = () =>
    mockReport({
      candles: [
        { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
        { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25640, volume: 1100 },
        { time: "2026-10-12T09:20:00", open: 25640, high: 25700, low: 25610, close: 25680, volume: 1200 },
      ],
    });

  test("(a) renders LIVE / PATTERNS / OFFLINE with exact labels", () => {
    r(() => <NiftyChartPanel report={sourceReport()} mode="live" view="chart" />);
    const buttons = within(toggle()).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["LIVE", "PATTERNS", "OFFLINE"]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  });

  test("(b) selecting each source changes the emitted candle / overlay input", async () => {
    r(() => (
      <NiftyChartPanel
        report={sourceReport()}
        mode="eod"
        view="chart"
        asOf="2026-10-12T09:16:00"
      />
    ));
    const chart = () => screen.getByTestId("tradingview-chart");
    // Every source is clipped at the playhead while one is supplied: replay is
    // orthogonal to which pipeline feeds the chart, so LIVE must not draw the
    // 09:20 bar that has not happened yet. Only the overlay distinguishes them.
    expect(chart()).toHaveAttribute("data-candles", "2");
    const baseMarks = Number(chart().getAttribute("data-marklines"));

    // PATTERNS: same clipped series + the pattern overlay levels.
    await choose("PATTERNS");
    await userEvent.setup().click(screen.getByTestId("nifty-patterns-scan"));
    expect(await screen.findByTestId("nifty-patterns-strip")).toHaveAttribute("data-status", "ready");
    expect(chart()).toHaveAttribute("data-candles", "2");
    expect(Number(chart().getAttribute("data-marklines"))).toBeGreaterThan(baseMarks);

    // OFFLINE: recorded/replay series clipped at the playhead, overlay gone.
    await choose("OFFLINE");
    expect(chart()).toHaveAttribute("data-candles", "2");
    expect(Number(chart().getAttribute("data-marklines"))).toBe(baseMarks);

    // Switching sources never remounts the chart engine.
    expect(panelMocks.tvMounts).toBe(1);
    await choose("LIVE");
    expect(chart()).toHaveAttribute("data-candles", "2");
    expect(panelMocks.tvMounts).toBe(1);
  });

  test("(c) PATTERNS with no scan shows the run affordance", async () => {
    r(() => <NiftyChartPanel report={sourceReport()} mode="live" view="chart" />);
    await choose("PATTERNS");
    const run = screen.getByTestId("nifty-patterns-run");
    expect(run).toBeInTheDocument();
    expect(run).toHaveTextContent(/run/i);
    expect(screen.queryByTestId("nifty-patterns-strip")).not.toBeInTheDocument();
  });

  test("(d) OFFLINE with no recording shows an honest empty state", async () => {
    r(() => <NiftyChartPanel report={sourceReport()} mode="live" view="chart" />);
    await choose("OFFLINE");
    const empty = screen.getByTestId("nifty-chart-offline-empty");
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveTextContent(/no recorded data/i);
    expect(screen.queryByTestId("nifty-chart-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ display: "none" });
  });

  test("(e) source choice persists across a remount", async () => {
    const first = r(() => <NiftyChartPanel report={sourceReport()} mode="live" view="chart" />);
    await choose("OFFLINE");
    expect(window.localStorage.getItem(CHART_SOURCE_KEY)).toBe("offline");
    first.unmount();
    r(() => <NiftyChartPanel report={sourceReport()} mode="live" view="chart" />);
    expect(within(toggle()).getByRole("button", { name: "OFFLINE" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("nifty-chart-offline-empty")).toBeInTheDocument();
  });
});

describe("NiftyChartPanel mobile flex chain", () => {
  const withCandles = () => mockReport({ candles: candles3() });

  test("(a) the fill chart wrap grows with flex-1/min-h-0 and pins no height", () => {
    r(() => <NiftyChartPanel report={withCandles()} mode="live" view="chart" fillContainer />);
    const wrap = screen.getByTestId("nifty-chart-wrap");
    expect(wrap).toHaveClass("flex-1", "min-h-0");
    expect(wrap).toHaveAttribute("data-fill", "1");
    expect(wrap.style.flex).toBe("1 1 0%");
    expect(wrap.style.minHeight).toBe("0px");
    expect(wrap.style.height).toBe("");
    expect(wrap).not.toHaveStyle({ maxHeight: "300px", minHeight: "260px" });
  });

  test("(b) the offline empty card sits in a constrained flex slot inside the panel", () => {
    window.localStorage.setItem(CHART_SOURCE_KEY, "offline");
    r(() => <NiftyChartPanel report={withCandles()} mode="live" view="chart" />);
    const slot = screen.getByTestId("nifty-chart-offline-slot");
    const empty = screen.getByTestId("nifty-chart-offline-empty");
    expect(slot).toHaveClass("flex", "flex-1", "min-h-0", "overflow-auto");
    expect(slot).toContainElement(empty);
    expect(slot.parentElement).toBe(screen.getByTestId("nifty-chart-view"));
    // The panel body owns the leftover height; the card never gets a pixel
    // budget of its own, so it can neither overflow the panel nor push a
    // sibling out of the way on a short (390px) row.
    const body = screen.getByTestId("nifty-chart-panel").querySelector("[data-compact-card-content]");
    expect(body).toHaveClass("flex-1", "min-h-0");
    expect(body).toContainElement(slot);
  });

  test("(c) no overflow:auto ancestor clips the chart inside the panel", () => {
    r(() => <NiftyChartPanel report={withCandles()} mode="live" view="chart" />);
    const wrap = screen.getByTestId("nifty-chart-wrap");
    const panel = screen.getByTestId("nifty-chart-panel");
    // The body carries a legacy `overflow-auto` class from LocalCompactPanel;
    // the panel overrides it at build time via an arbitrary descendant variant
    // (in-browser: getComputedStyle(body).overflow === "hidden"). No ancestor
    // sets an inline overflow that could clip the chart.
    const override = "[&_[data-compact-card-content]]:overflow-hidden";
    expect(panel.className).toContain(override);
    let node: HTMLElement | null = wrap;
    let sawBody = false;
    while (node && node !== panel) {
      expect(node.style.overflow).not.toBe("auto");
      expect(node.style.overflowY).not.toBe("auto");
      if (node.hasAttribute("data-compact-card-content")) {
        sawBody = true;
        expect(node).toHaveClass("overflow-auto");
      } else {
        expect(node.className).not.toMatch(/(^|\s)overflow-(auto|y-auto)(\s|$)/);
      }
      node = node.parentElement;
    }
    expect(sawBody).toBe(true);
    expect(node).toBe(panel);
  });
});
